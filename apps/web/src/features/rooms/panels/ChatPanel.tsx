import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatScope } from '@retry/protocol';
import type { ChatHistoryResponse, RoomMessageDto } from '@retry/types';
import { api, ApiError } from '../../../lib/api.js';
import { cn } from '../../../lib/cn.js';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

type ChatPanelProps = {
  roomId: string;
  selfUserId: string;
  /**
   * Whether this panel is attached to an avatar in the map. The Workspace has
   * no avatar and therefore nobody standing near it, so "Nearby" is not a
   * scope it can offer.
   */
  canSpeakNearby?: boolean;
};

/** A live line, plus whether it was speech (not persisted) or record. */
type ChatLine = RoomMessageDto & { scope: ChatScope };

/**
 * How long a name stays in the "is typing" line without another notice. The
 * server re-broadcasts at most every 2s, so this has to outlast that gap.
 */
const TYPING_HOLD_MS = 4_000;

// Room chat (FR-ROOM-33..36): full history for members via REST, live lines
// over the world WebSocket. Plain text only — bodies render as text nodes,
// which is the second half of "sanitise on write AND on render" (NFR-SEC-04).
export function ChatPanel({ roomId, selfUserId, canSpeakNearby = false }: ChatPanelProps) {
  const [live, setLive] = useState<ChatLine[]>([]);
  const [older, setOlder] = useState<RoomMessageDto[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<ChatScope>('room');
  const [typing, setTyping] = useState<Map<string, { name: string; until: number }>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const lastTypingSentAt = useRef(0);

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
        if (msg.t === 'actorTyping') {
          if (msg.userId === selfUserId) return;
          setTyping((prev) =>
            new Map(prev).set(msg.userId, {
              name: msg.displayName,
              until: Date.now() + TYPING_HOLD_MS,
            }),
          );
          return;
        }
        if (msg.t !== 'chatMessage') return;
        // Their message landed; they are no longer typing.
        setTyping((prev) => {
          if (!prev.has(msg.userId)) return prev;
          const next = new Map(prev);
          next.delete(msg.userId);
          return next;
        });
        setLive((prev) => [
          ...prev,
          {
            id: msg.id,
            senderId: msg.userId,
            senderName: msg.displayName,
            body: msg.body,
            createdAt: msg.createdAt,
            scope: msg.scope ?? 'room',
          },
        ]);
      }),
    [selfUserId],
  );

  // Expire typing names. A ticker rather than a timer per person: one interval
  // that only runs while somebody is actually typing.
  useEffect(() => {
    if (typing.size === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = new Map([...prev].filter(([, v]) => v.until > now));
        return next.size === prev.size ? prev : next;
      });
    }, 500);
    return () => clearInterval(id);
  }, [typing.size]);

  /**
   * Tell the room somebody is writing — at most once per second, and never at
   * all for an empty box. The server rate-limits this too; the client debounce
   * exists to keep the socket quiet, not to be trusted.
   */
  const notifyTyping = useCallback((): void => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < 1_000) return;
    lastTypingSentAt.current = now;
    roomSocket.send({ t: 'typing' });
  }, []);

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
  const historyLines: ChatLine[] = [...older, ...(history.data?.messages ?? [])].map((m) => ({
    ...m,
    scope: 'room',
  }));
  const messages = [...historyLines, ...live].filter((m) => {
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
    roomSocket.send({ t: 'chat', body, scope });
    setDraft('');
  };

  const typingNames = [...typing.values()].map((t) => t.name);

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
              {m.scope === 'nearby' && ' · nearby'}
            </p>
            {/* Nearby lines are speech, not record: they are not saved and will
                not be here tomorrow, so they read quieter than the room log. */}
            <p
              className={cn(
                'whitespace-pre-wrap break-words text-sm',
                m.scope === 'nearby' ? 'italic text-ink-muted' : 'text-ink',
              )}
            >
              {m.body}
            </p>
          </div>
        ))}
      </div>

      {typingNames.length > 0 && (
        <p className="px-3 pb-1 font-mono text-[10px] text-ink-muted">
          {typingNames.length === 1 ?
            `${typingNames[0]} is typing…`
          : typingNames.length === 2 ?
            `${typingNames[0]} and ${typingNames[1]} are typing…`
          : 'Several people are typing…'}
        </p>
      )}
      <div className="border-t border-edge p-2">
        {canSpeakNearby && (
          // Who will hear this. Stated before the message is written, not
          // discovered after it is sent to the wrong audience.
          <div className="mb-1.5 flex items-center gap-1">
            {(['room', 'nearby'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={cn(
                  'rounded-card border px-2 py-0.5 font-mono text-[10px] transition-colors',
                  option === scope ?
                    'border-accent bg-accent-tint text-ink'
                  : 'border-edge text-ink-muted hover:text-ink',
                )}
              >
                {option === 'room' ? 'Whole room' : 'Nearby'}
              </button>
            ))}
            <span className="ml-1 font-mono text-[10px] text-ink-muted">
              {scope === 'room' ? 'saved to the room log' : 'spoken aloud, not saved'}
            </span>
          </div>
        )}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.length > 0) notifyTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={
            scope === 'nearby' ? 'Say something nearby… (Enter)' : 'Message… (Enter to send)'
          }
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
