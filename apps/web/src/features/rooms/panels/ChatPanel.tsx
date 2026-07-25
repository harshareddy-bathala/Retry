import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatHistoryResponse, RoomMessageDto } from '@retry/types';
import { api, ApiError } from '../../../lib/api.js';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

type ChatPanelProps = { roomId: string; selfUserId: string };

// Room chat (FR-ROOM-33..36): full history for members via REST, live lines
// over the world WebSocket. Plain text only — bodies render as text nodes,
// which is the second half of "sanitise on write AND on render" (NFR-SEC-04).
export function ChatPanel({ roomId, selfUserId }: ChatPanelProps) {
  const [live, setLive] = useState<RoomMessageDto[]>([]);
  const [older, setOlder] = useState<RoomMessageDto[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const history = useQuery({
    queryKey: ['room-messages', roomId],
    queryFn: () => api.get<ChatHistoryResponse>(`/rooms/${roomId}/messages`),
    retry: false,
  });
  const memberBlocked = history.error instanceof ApiError && history.error.status === 403;

  useEffect(() => {
    if (history.data) setNextBefore(history.data.nextBefore);
  }, [history.data]);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t !== 'chatMessage') return;
        setLive((prev) => [
          ...prev,
          {
            id: msg.id,
            senderId: msg.userId,
            senderName: msg.displayName,
            body: msg.body,
            createdAt: msg.createdAt,
          },
        ]);
      }),
    [],
  );

  const loadOlder = async (): Promise<void> => {
    if (!nextBefore) return;
    const page = await api.get<ChatHistoryResponse>(
      `/rooms/${roomId}/messages?before=${encodeURIComponent(nextBefore)}`,
    );
    setOlder((prev) => [...page.messages, ...prev]);
    setNextBefore(page.nextBefore);
  };

  // History rows already delivered again over the live channel are dropped by id.
  const seen = new Set<string>();
  const messages = [...older, ...(history.data?.messages ?? []), ...live].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = (): void => {
    const body = draft.trim();
    if (!body) return;
    roomSocket.send({ t: 'chat', body });
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      <p className="border-b border-edge px-3 py-2 font-mono text-[11px] uppercase text-ink-muted">
        Chat
      </p>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-y-auto px-3 py-2"
      >
        {memberBlocked && (
          <p className="mb-2 rounded-card bg-page px-2 py-1.5 text-xs text-ink-muted">
            You&apos;re visiting — only live messages are shown.
          </p>
        )}
        {nextBefore && (
          <button
            type="button"
            onClick={() => void loadOlder()}
            className="mb-2 w-full rounded-card border border-edge py-1 text-xs text-ink-muted hover:text-ink"
          >
            Load older messages
          </button>
        )}
        {messages.length === 0 && !memberBlocked && (
          <p className="text-xs text-ink-muted">No messages yet. Say hi!</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="mb-2">
            <p className="font-mono text-[10px] text-ink-muted">
              <span className={m.senderId === selfUserId ? 'text-accent' : ''}>{m.senderName}</span>
              {' · '}
              {formatTime(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{m.body}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-edge p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="Message… (Enter to send)"
          maxLength={2000}
          className="w-full rounded-card border border-edge bg-page px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}

// Plain-English times (NFR-USE-03): "2:04 PM", "Yesterday 2:04 PM" — never ISO.
function formatTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return time;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}
