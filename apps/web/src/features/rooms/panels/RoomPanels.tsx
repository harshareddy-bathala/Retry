import { lazy, Suspense, useEffect, useState } from 'react';
import { roomEvents } from '../event-bus.js';
import { ChatPanel } from './ChatPanel.js';
import { KanbanPanel } from './KanbanPanel.js';
import { PresencePanel } from './PresencePanel.js';
import { useKanbanBoard } from './use-kanban-board.js';

// tldraw is enormous; only pull it when the whiteboard actually opens.
const WhiteboardPanel = lazy(() => import('./WhiteboardPanel.js'));

export type PanelKind = 'chat' | 'kanban' | 'whiteboard' | 'presence';

const PANEL_ICONS: Array<{ kind: PanelKind; icon: string; label: string }> = [
  { kind: 'chat', icon: '💬', label: 'Chat' },
  { kind: 'kanban', icon: '📋', label: 'Board' },
  { kind: 'whiteboard', icon: '✏️', label: 'Whiteboard' },
  { kind: 'presence', icon: '👥', label: 'Members' },
];

const STATIC_MAPS = new Set(['commons', 'studio_a']);

type RoomPanelsProps = { selfUserId: string };

// Panel shell (rooms build plan Phase 6): right-side rail over the canvas,
// exactly one panel open at a time, Escape returns input to the canvas. The
// canvas underneath stays live. Panels exist only inside room instances —
// the Commons is a corridor, not a workspace — and all panel state resets on
// every map change (state never leaks between rooms).
export function RoomPanels({ selfUserId }: RoomPanelsProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [active, setActive] = useState<PanelKind | null>(null);
  const [unread, setUnread] = useState(0);
  // Tracked here, not in the panel: the board snapshot lands on room entry and
  // updates keep flowing while the panel is closed.
  const board = useKanbanBoard(roomId);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t === 'snapshot') {
          const next = STATIC_MAPS.has(msg.mapId) ? null : msg.mapId;
          setRoomId((prev) => {
            if (prev !== next) {
              setActive(null);
              setUnread(0);
            }
            return next;
          });
        }
        if (msg.t === 'chatMessage' && msg.userId !== selfUserId) {
          setUnread((count) => count + 1);
        }
      }),
    [selfUserId],
  );

  // The whiteboard desk object in the map (Phase 1) opens the same panel.
  useEffect(
    () =>
      roomEvents.on('interact:whiteboard', () => {
        setActive((prev) => (roomId ? 'whiteboard' : prev));
      }),
    [roomId],
  );

  // Tell the scene when a panel holds focus, and handle Escape.
  useEffect(() => {
    roomEvents.emit('panel:state', { open: active !== null });
    if (active === 'chat') setUnread(0);
    if (active === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!roomId) return null;

  return (
    <>
      <div className="absolute right-2 top-2 z-30 flex flex-col gap-1 rounded-panel border border-edge bg-surface p-1 shadow-lg">
        {PANEL_ICONS.map(({ kind, icon, label }) => (
          <button
            key={kind}
            type="button"
            title={label}
            onClick={() => setActive((prev) => (prev === kind ? null : kind))}
            className={`relative flex h-9 w-9 items-center justify-center rounded-card text-lg ${
              active === kind ? 'bg-accent-tint' : 'hover:bg-page'
            }`}
          >
            {icon}
            {kind === 'chat' && unread > 0 && active !== 'chat' && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        ))}
      </div>

      {active && active !== 'whiteboard' && (
        <div className="absolute bottom-2 right-14 top-2 z-30 flex w-80 flex-col overflow-hidden rounded-panel border border-edge bg-surface shadow-xl">
          {active === 'chat' && <ChatPanel key={roomId} roomId={roomId} selfUserId={selfUserId} />}
          {active === 'kanban' && <KanbanPanel key={roomId} board={board} />}
          {active === 'presence' && <PresencePanel key={roomId} roomId={roomId} />}
        </div>
      )}

      {active === 'whiteboard' && (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
              <p className="rounded-panel bg-surface px-4 py-2 text-sm text-ink">Loading whiteboard…</p>
            </div>
          }
        >
          <WhiteboardPanel key={roomId} roomId={roomId} onClose={() => setActive(null)} />
        </Suspense>
      )}
    </>
  );
}
