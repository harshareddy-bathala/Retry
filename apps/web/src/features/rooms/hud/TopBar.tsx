import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../lib/cn.js';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';
import { PresenceStrip } from '../PresenceStrip.js';

const DOT: Record<string, string> = {
  open: 'bg-success',
  connecting: 'animate-pulse bg-warn',
  reconnecting: 'animate-pulse bg-warn',
  closed: 'bg-ink-muted',
  failed: 'bg-danger',
};

const LABEL: Record<string, string> = {
  open: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  closed: 'Offline',
  failed: 'Lost',
};

type TopBarProps = {
  selfUserId: string;
  /** Where "Leave" goes back to — the room you came from, or the list. */
  leaveTo: string;
  /** What this place is called, once the snapshot has named it. */
  placeName: string | null;
};

export function TopBar({ selfUserId, leaveTo, placeName }: TopBarProps) {
  const status = useSyncExternalStore(roomSocket.subscribe, roomSocket.getStatus);

  return (
    <div className="flex items-center gap-3 border-b border-edge bg-surface/80 px-3 py-2 backdrop-blur">
      <Link
        to={leaveTo}
        className="shrink-0 rounded-card border border-edge px-2.5 py-1 font-display text-sm text-ink hover:bg-accent-tint"
      >
        ← Leave
      </Link>

      <p className="shrink-0 truncate font-display text-sm text-ink">{placeName ?? 'Loading…'}</p>

      <span
        className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase text-ink-muted"
        title={`Connection: ${LABEL[status] ?? status}`}
      >
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', DOT[status])} />
        {LABEL[status] ?? status}
      </span>

      {/* Pushed right so the identity block reads as one unit on the left. */}
      <div className="ml-auto min-w-0">
        <PresenceStrip
          selfUserId={selfUserId}
          onLocate={(userId) => roomEvents.emit('camera:locate', { userId })}
        />
      </div>
    </div>
  );
}
