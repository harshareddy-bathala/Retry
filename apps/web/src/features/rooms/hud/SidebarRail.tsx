import { cn } from '../../../lib/cn.js';
import { hudStore, type PanelKind } from './hud-store.js';

// Icons are still emoji here; they become a real icon set in the design-system
// pass. What changed is that the rail is now a grid COLUMN — the sidebar can no
// longer cover it, and the knock toast can no longer render underneath it.
const PANELS: Array<{ kind: PanelKind; icon: string; label: string }> = [
  { kind: 'chat', icon: '💬', label: 'Chat' },
  { kind: 'kanban', icon: '📋', label: 'Board' },
  { kind: 'whiteboard', icon: '✏️', label: 'Whiteboard' },
  { kind: 'presence', icon: '👥', label: 'Members' },
];

type SidebarRailProps = {
  active: PanelKind | null;
  unread: number;
  minimapOpen: boolean;
  /** Null in the Commons, which is a corridor and has no panels to open. */
  roomId: string | null;
};

export function SidebarRail({ active, unread, minimapOpen, roomId }: SidebarRailProps) {
  return (
    <div className="flex h-full flex-col items-center gap-1 border-l border-edge bg-surface/80 p-1 backdrop-blur">
      {/* The Commons keeps no chat log, has no board and no whiteboard. The
          buttons are absent there rather than present and inert — a control
          that does nothing when clicked is worse than no control. */}
      {roomId && PANELS.map(({ kind, icon, label }) => (
        <button
          key={kind}
          type="button"
          title={label}
          aria-label={
            kind === 'chat' && unread > 0 ? `${label}, ${unread} unread` : label
          }
          aria-pressed={active === kind}
          onClick={() => hudStore.togglePanel(kind)}
          className={cn(
            'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-card text-lg transition-colors',
            active === kind ? 'bg-accent-tint' : 'hover:bg-page',
          )}
        >
          <span aria-hidden>{icon}</span>
          {kind === 'chat' && unread > 0 && active !== 'chat' && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] text-accent-ink"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      ))}

      {/* Bottom of the rail: the map toggle. It lives here rather than beside
          the minimap itself because a hidden map used to hide its own
          "show" button under an open panel. */}
      <button
        type="button"
        title={minimapOpen ? 'Hide the map' : 'Show the map'}
        aria-label={minimapOpen ? 'Hide the map' : 'Show the map'}
        aria-pressed={minimapOpen}
        onClick={() => hudStore.toggleMinimap()}
        className={cn(
          'mt-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-card text-lg transition-colors',
          minimapOpen ? 'bg-accent-tint' : 'hover:bg-page',
        )}
      >
        <span aria-hidden>🗺️</span>
      </button>
    </div>
  );
}
