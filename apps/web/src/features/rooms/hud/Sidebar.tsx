import { ChatPanel } from '../panels/ChatPanel.js';
import { KanbanPanel } from '../panels/KanbanPanel.js';
import { PresencePanel } from '../panels/PresencePanel.js';
import type { Board } from '../panels/use-kanban-board.js';
import { hudStore, type PanelKind } from './hud-store.js';

const TITLE: Record<PanelKind, string> = {
  chat: 'Chat',
  kanban: 'Board',
  whiteboard: 'Whiteboard',
  presence: 'Members',
};

type SidebarProps = {
  active: PanelKind | null;
  roomId: string | null;
  selfUserId: string;
  board: Board | null;
};

/**
 * The sidebar panel host.
 *
 * It fills a grid column rather than floating at `right-14 w-80`, so the two
 * magic numbers that had to stay in sync with the rail's width are gone, and
 * so is the bug where an open panel completely buried the minimap.
 */
export function Sidebar({ active, roomId, selfUserId, board }: SidebarProps) {
  // The whiteboard is a modal, not a sidebar panel — it needs the whole stage.
  if (!active || active === 'whiteboard' || !roomId) return null;

  return (
    <aside
      aria-label={TITLE[active]}
      className="flex h-full w-full flex-col border-l border-edge bg-surface"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-1.5">
        <h2 className="font-mono text-[11px] uppercase text-ink-muted">{TITLE[active]}</h2>
        <button
          type="button"
          onClick={() => hudStore.closePanel()}
          aria-label={`Close ${TITLE[active]}`}
          className="rounded-card border border-edge px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {active === 'chat' && (
          // The Live Space has an avatar, so it has a "nearby" to speak to.
          <ChatPanel key={roomId} roomId={roomId} selfUserId={selfUserId} canSpeakNearby />
        )}
        {active === 'kanban' && <KanbanPanel key={roomId} board={board} />}
        {active === 'presence' && <PresencePanel key={roomId} roomId={roomId} />}
      </div>
    </aside>
  );
}
