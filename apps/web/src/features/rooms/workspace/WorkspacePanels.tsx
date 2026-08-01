import { lazy, Suspense, useState } from 'react';
import { cn } from '../../../lib/cn.js';
import { ChatPanel } from '../panels/ChatPanel.js';
import { KanbanPanel } from '../panels/KanbanPanel.js';
import { useKanbanBoard } from '../panels/use-kanban-board.js';

const WhiteboardPanel = lazy(() => import('../panels/WhiteboardPanel.js'));

type Tab = 'chat' | 'board' | 'whiteboard';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'board', label: 'Board' },
  { id: 'whiteboard', label: 'Whiteboard' },
];

// The same panels the Live Space overlays on the canvas, rendered inline in
// the Workspace (FR-ROOM-33: chat works in both views). They are unchanged —
// watch mode delivers them the same events over the same socket, which is the
// whole reason it was built that way.
export function WorkspacePanels({ roomId, selfUserId }: { roomId: string; selfUserId: string }) {
  const [tab, setTab] = useState<Tab>('chat');
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const board = useKanbanBoard(roomId);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              if (t.id === 'whiteboard') setWhiteboardOpen(true);
            }}
            className={cn(
              'rounded-card px-3 py-1.5 font-display text-sm',
              tab === t.id ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex h-[26rem] flex-col overflow-hidden rounded-panel border border-edge bg-surface">
        {tab === 'chat' && <ChatPanel key={roomId} roomId={roomId} selfUserId={selfUserId} />}
        {tab === 'board' && <KanbanPanel key={roomId} state={board} />}
        {tab === 'whiteboard' && (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <div>
              <p className="text-sm text-ink-muted">
                The whiteboard opens full-screen — there is no useful small version of a whiteboard.
              </p>
              <button
                type="button"
                onClick={() => setWhiteboardOpen(true)}
                className="mt-3 rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-accent-ink hover:opacity-90"
              >
                Open whiteboard
              </button>
            </div>
          </div>
        )}
      </div>

      {tab === 'whiteboard' && whiteboardOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40">
              <p className="rounded-panel bg-surface px-4 py-2 text-sm text-ink">
                Loading whiteboard…
              </p>
            </div>
          }
        >
          <div className="fixed inset-0 z-modal">
            <WhiteboardPanel
              key={roomId}
              roomId={roomId}
              onClose={() => setWhiteboardOpen(false)}
            />
          </div>
        </Suspense>
      )}
    </section>
  );
}
