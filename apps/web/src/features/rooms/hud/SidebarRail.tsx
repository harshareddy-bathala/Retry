import { Kanban, Map, MessageSquare, PenTool, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button.js';
import { hudStore, type PanelKind } from './hud-store.js';

// A real icon set, not emoji. 💬📋✏️👥 rendered as full-colour glyphs on
// Windows, monochrome on Linux and at different metrics on every platform —
// inside a product whose whole identity is a hand-tuned copper palette. Lucide
// takes `currentColor`, so a hover or active state is one class rather than a
// second crop.
const PANELS: Array<{ kind: PanelKind; Icon: LucideIcon; label: string }> = [
  { kind: 'chat', Icon: MessageSquare, label: 'Chat' },
  { kind: 'kanban', Icon: Kanban, label: 'Board' },
  { kind: 'whiteboard', Icon: PenTool, label: 'Whiteboard' },
  { kind: 'presence', Icon: Users, label: 'Members' },
];

type SidebarRailProps = {
  active: PanelKind | null;
  unread: number;
  minimapOpen: boolean;
  /** Null in the Commons, which is a corridor and has no panels. */
  roomId: string | null;
};

export function SidebarRail({ active, unread, minimapOpen, roomId }: SidebarRailProps) {
  return (
    <div className="flex h-full flex-col items-center gap-1 border-l border-edge bg-surface/80 p-1.5 backdrop-blur">
      {/* The Commons keeps no chat log, has no board and no whiteboard. The
          buttons are absent there rather than present and inert — a control
          that does nothing when clicked is worse than no control. */}
      {roomId &&
        PANELS.map(({ kind, Icon, label }) => (
          <IconButton
            key={kind}
            label={
              // The unread count was a visual badge inside a button whose only
              // name was "Chat", so it was never announced at all.
              kind === 'chat' && unread > 0
                ? `${label}, ${unread} unread`
                : label
            }
            active={active === kind}
            aria-pressed={active === kind}
            onClick={() => hudStore.togglePanel(kind)}
            icon={<Icon size={18} aria-hidden />}
            badge={
              kind === 'chat' && unread > 0 && active !== 'chat' ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] text-accent-ink"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null
            }
          />
        ))}

      {/* Bottom of the rail. The map toggle lives here rather than attached to
          the map itself, where an open panel used to cover the map AND the only
          button that would bring it back. */}
      <IconButton
        className="mt-auto"
        label={minimapOpen ? 'Hide the map' : 'Show the map'}
        active={minimapOpen}
        aria-pressed={minimapOpen}
        onClick={() => hudStore.toggleMinimap()}
        icon={<Map size={18} aria-hidden />}
      />
    </div>
  );
}
