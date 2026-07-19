import { useEffect, useRef, useState } from 'react';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';

// Knock UX (rooms build plan Phase 4).
// Requester: a waiting card with a live countdown and a cancel button.
// Members: non-blocking toasts with Grant / Deny.
// Denials and rejections surface as plain sentences — never raw error codes.

const KNOCK_TIMEOUT_S = 60;

type MyKnock = { requestId: string; roomName: string; startedAt: number };
type IncomingKnock = { requestId: string; roomName: string; requesterName: string };

const NOTICE_TEXT: Record<string, string> = {
  denied: 'They didn’t let you in this time.',
  timeout: 'No one answered the door.',
  ROOM_ACCESS_DENIED: 'That room is invite-only.',
  FORBIDDEN: 'The live space is only available to students.',
  KNOCK_PENDING: 'You already knocked — hang on.',
};

export function KnockLayer() {
  const [myKnock, setMyKnock] = useState<MyKnock | null>(null);
  const [incoming, setIncoming] = useState<IncomingKnock[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myKnockRef = useRef(myKnock);
  myKnockRef.current = myKnock;

  const showNotice = (text: string): void => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        switch (msg.t) {
          case 'knockPending':
            setMyKnock({ requestId: msg.requestId, roomName: msg.roomName, startedAt: Date.now() });
            break;
          case 'knock':
            setIncoming((prev) =>
              prev.some((k) => k.requestId === msg.requestId)
                ? prev
                : [
                    ...prev,
                    {
                      requestId: msg.requestId,
                      roomName: msg.roomName,
                      requesterName: msg.requesterName,
                    },
                  ],
            );
            break;
          case 'knockResult':
            setIncoming((prev) => prev.filter((k) => k.requestId !== msg.requestId));
            if (myKnockRef.current?.requestId === msg.requestId) {
              setMyKnock(null);
              const text = NOTICE_TEXT[msg.status];
              if (text) showNotice(text);
            }
            break;
          case 'error': {
            const text = NOTICE_TEXT[msg.code];
            if (text) showNotice(text);
            break;
          }
          default:
            break;
        }
      }),
    [],
  );

  // Tick the countdown only while a knock is pending. Sync immediately: the
  // mount-time `now` is stale and would skew the first render's countdown.
  useEffect(() => {
    if (!myKnock) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [myKnock]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const respond = (requestId: string, grant: boolean): void => {
    roomSocket.send({ t: 'knockRespond', requestId, grant });
    setIncoming((prev) => prev.filter((k) => k.requestId !== requestId));
  };

  const cancel = (): void => {
    if (myKnock) roomSocket.send({ t: 'knockCancel', requestId: myKnock.requestId });
    setMyKnock(null);
  };

  const secondsLeft = myKnock
    ? Math.min(KNOCK_TIMEOUT_S, Math.max(0, KNOCK_TIMEOUT_S - Math.floor((now - myKnock.startedAt) / 1000)))
    : 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center">
      {myKnock && (
        <div className="pointer-events-auto mt-6 flex items-center gap-4 rounded-panel border border-edge bg-surface px-5 py-3 shadow-lg">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
          <div>
            <p className="font-display text-sm text-ink">Knocking on {myKnock.roomName}…</p>
            <p className="font-mono text-[11px] text-ink-muted">waiting {secondsLeft}s</p>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="rounded-card border border-edge px-3 py-1 text-sm text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}
      {notice && (
        <div className="pointer-events-auto mt-6 rounded-panel border border-edge bg-surface px-5 py-2.5 shadow-lg">
          <p className="text-sm text-ink">{notice}</p>
        </div>
      )}
      <div className="absolute right-4 top-4 flex flex-col gap-2">
        {incoming.map((k) => (
          <div
            key={k.requestId}
            className="pointer-events-auto flex items-center gap-3 rounded-panel border border-edge bg-surface px-4 py-2.5 shadow-lg"
          >
            <p className="text-sm text-ink">
              <span className="font-semibold">{k.requesterName}</span> wants to join{' '}
              <span className="font-semibold">{k.roomName}</span>
            </p>
            <button
              type="button"
              onClick={() => respond(k.requestId, true)}
              className="rounded-card bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90"
            >
              Grant
            </button>
            <button
              type="button"
              onClick={() => respond(k.requestId, false)}
              className="rounded-card border border-edge px-3 py-1 text-sm text-ink-muted hover:text-ink"
            >
              Deny
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
