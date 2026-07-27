import { useSyncExternalStore } from 'react';
import type { RoomSocketStatus } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';
import { useRoomActors } from './useRoomActors.js';
import { cn } from '../../lib/cn.js';

type PresenceStripProps = {
  selfUserId: string;
  /** Pan the camera to someone. Omitted in views with no camera. */
  onLocate?: (userId: string) => void;
};

const STATUS_LABEL: Record<RoomSocketStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
  failed: 'Disconnected',
};

// Member strip (rooms build plan Phase 2): everyone currently in the map,
// updated live from snapshot / actorJoin / actorLeave over the EventBus.
//
// Status is READ from the socket rather than accumulated from events. This
// strip mounts and unmounts around route changes and transitions, so seeding
// it with a guess left it showing a status the socket had already moved on
// from — the "Reconnecting… while everything works" report.
export function PresenceStrip({ selfUserId, onLocate }: PresenceStripProps) {
  const actors = useRoomActors();
  const status = useSyncExternalStore(roomSocket.subscribe, roomSocket.getStatus);

  const list = [...actors.values()].sort((a, b) =>
    a.userId === selfUserId ? -1 : b.userId === selfUserId ? 1 : a.displayName.localeCompare(b.displayName),
  );

  return (
    <div className="flex items-center gap-3 rounded-panel border border-edge bg-surface px-4 py-2">
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          status === 'open'
            ? 'bg-emerald-500'
            : status === 'closed' || status === 'failed'
              ? 'bg-red-500'
              : 'bg-amber-500',
        )}
        title={STATUS_LABEL[status]}
      />
      <span className="font-mono text-[11px] uppercase text-ink-muted">{STATUS_LABEL[status]}</span>
      <div className="flex flex-wrap items-center gap-2">
        {list.map((actor) => {
          const isSelf = actor.userId === selfUserId;
          const label = (
            <>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint font-display text-[10px] font-semibold text-accent">
                {initials(actor.displayName)}
              </span>
              <span className="text-xs text-ink">
                {actor.displayName}
                {isSelf ? ' (you)' : ''}
              </span>
            </>
          );
          const shared = 'flex items-center gap-1.5 rounded-card border border-edge px-2 py-0.5';
          // Finding a person in a room you can only see a corner of is the
          // whole reason this list is here; clicking a name takes you to them.
          return onLocate && !isSelf ? (
            <button
              key={actor.userId}
              type="button"
              onClick={() => onLocate(actor.userId)}
              title={`Show me ${actor.displayName}`}
              className={cn(shared, 'transition-colors hover:border-accent hover:bg-accent-tint/40')}
            >
              {label}
            </button>
          ) : (
            <span key={actor.userId} className={shared}>
              {label}
            </span>
          );
        })}
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
