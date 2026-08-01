import { useRoomActors } from './useRoomActors.js';
import { cn } from '../../lib/cn.js';

type PresenceStripProps = {
  selfUserId: string;
  /** Pan the camera to someone. Omitted in views with no camera. */
  onLocate?: (userId: string) => void;
};

// Member strip (rooms build plan Phase 2): everyone currently in the map,
// updated live from snapshot / actorJoin / actorLeave over the EventBus.
//
// This is WHO is here, and only that. Connection status used to sit in front of
// the names, and once the world grew a top bar the same word appeared twice on
// one row — the strip is a passenger in that bar now, so the bar owns status.
export function PresenceStrip({ selfUserId, onLocate }: PresenceStripProps) {
  const actors = useRoomActors();

  const list = [...actors.values()].sort((a, b) =>
    a.userId === selfUserId ? -1 : b.userId === selfUserId ? 1 : a.displayName.localeCompare(b.displayName),
  );

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="flex items-center gap-2 overflow-x-auto">
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
