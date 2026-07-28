import { useEffect, useState } from 'react';
import { roomEvents } from '../event-bus.js';
import { hudStore, useHud, type PanelKind } from '../hud/hud-store.js';
import { useInputLayer } from '../input/useInputLayer.js';
import { useKanbanBoard } from './use-kanban-board.js';

// Static maps are corridors, not workspaces: the Commons keeps no chat log and
// has no board, so it has no panels. `studio_a` is the sandbox map id, which
// happens to share a name with the studio_a TEMPLATE — the id is what is
// checked here.
const STATIC_MAPS = new Set(['commons', 'studio_a']);

/**
 * Owns which panel is open, the unread count, and the board snapshot.
 *
 * The board lives here rather than inside the Kanban panel because
 * `kanbanState` lands once on room entry and keeps updating while the panel is
 * closed — tracking it inside a lazily-mounted panel would lose the snapshot.
 */
export function useRoomPanels(selfUserId: string) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const { sidebar } = useHud();
  const board = useKanbanBoard(roomId);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t === 'snapshot') {
          const next = STATIC_MAPS.has(msg.mapId) ? null : msg.mapId;
          setRoomId((prev) => {
            if (prev !== next) {
              // Panel state never leaks between rooms.
              hudStore.reset();
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

  // The whiteboard desk object in the map opens the same panel a click does.
  useEffect(
    () =>
      roomEvents.on('interact:whiteboard', () => {
        if (roomId) hudStore.openPanel('whiteboard');
      }),
    [roomId],
  );

  useEffect(() => {
    if (sidebar === 'chat') setUnread(0);
  }, [sidebar]);

  // An open sidebar panel owns the keyboard and owns Escape. The whiteboard is
  // excluded: it pushes its own modal layer that DECLINES Escape, so the key
  // reaches tldraw to deselect instead of tearing the board down mid-stroke.
  useInputLayer(sidebar !== null && sidebar !== 'whiteboard', {
    kind: 'sidebar',
    name: `panel:${sidebar ?? 'none'}`,
    capturesKeys: true,
    onEscape: () => {
      hudStore.closePanel();
      return true;
    },
  });

  return { roomId, unread, active: sidebar as PanelKind | null, board };
}
