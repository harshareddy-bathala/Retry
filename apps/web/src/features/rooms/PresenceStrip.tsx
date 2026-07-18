import { useEffect, useState } from 'react';
import { roomEvents, type RoomSocketStatus } from './event-bus.js';
import { useRoomActors } from './useRoomActors.js';
import { cn } from '../../lib/cn.js';

type PresenceStripProps = {
  selfUserId: string;
};

const STATUS_LABEL: Record<RoomSocketStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
};

// Member strip (rooms build plan Phase 2): everyone currently in the map,
// updated live from snapshot / actorJoin / actorLeave over the EventBus.
export function PresenceStrip({ selfUserId }: PresenceStripProps) {
  const actors = useRoomActors();
  const [status, setStatus] = useState<RoomSocketStatus>('connecting');

  useEffect(() => roomEvents.on('net:status', setStatus), []);

  const list = [...actors.values()].sort((a, b) =>
    a.userId === selfUserId ? -1 : b.userId === selfUserId ? 1 : a.displayName.localeCompare(b.displayName),
  );

  return (
    <div className="flex items-center gap-3 rounded-panel border border-edge bg-surface px-4 py-2">
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          status === 'open' ? 'bg-emerald-500' : status === 'closed' ? 'bg-red-500' : 'bg-amber-500',
        )}
        title={STATUS_LABEL[status]}
      />
      <span className="font-mono text-[11px] uppercase text-ink-muted">{STATUS_LABEL[status]}</span>
      <div className="flex flex-wrap items-center gap-2">
        {list.map((actor) => (
          <span
            key={actor.userId}
            className="flex items-center gap-1.5 rounded-card border border-edge px-2 py-0.5"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint font-display text-[10px] font-semibold text-accent">
              {initials(actor.displayName)}
            </span>
            <span className="text-xs text-ink">
              {actor.displayName}
              {actor.userId === selfUserId ? ' (you)' : ''}
            </span>
          </span>
        ))}
        {list.length === 0 && <span className="text-xs text-ink-muted">Nobody here yet</span>}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
