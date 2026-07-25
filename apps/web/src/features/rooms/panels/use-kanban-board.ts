import { useEffect, useState } from 'react';
import type { KanbanCard, KanbanColumnKey } from '@retry/protocol';
import { roomEvents } from '../event-bus.js';

export type Board = {
  columns: Array<{ key: KanbanColumnKey; label: string }>;
  cards: Map<string, KanbanCard>;
};

/**
 * Keeps the room's board in sync from the world socket.
 *
 * This lives ABOVE the panel on purpose. `kanbanState` is sent exactly once,
 * when the session enters the room's map — which is long before anyone clicks
 * the board icon — and `kanbanCard`/`kanbanCardRemoved`/`kanbanColumn` keep
 * arriving while the panel is closed. A reducer inside the lazily-mounted
 * panel would subscribe too late to ever see the snapshot and would sit on
 * "Loading board…" forever, so the panel is a pure view over this state.
 */
export function useKanbanBoard(roomId: string | null): Board | null {
  const [board, setBoard] = useState<Board | null>(null);

  // A new room means a new board; drop the old one so nothing leaks across.
  useEffect(() => setBoard(null), [roomId]);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        switch (msg.t) {
          case 'kanbanState':
            setBoard({ columns: msg.columns, cards: new Map(msg.cards.map((c) => [c.id, c])) });
            break;
          case 'kanbanCard':
            setBoard((prev) => {
              if (!prev) return prev;
              const cards = new Map(prev.cards);
              cards.set(msg.card.id, msg.card);
              return { ...prev, cards };
            });
            break;
          case 'kanbanCardRemoved':
            setBoard((prev) => {
              if (!prev) return prev;
              const cards = new Map(prev.cards);
              cards.delete(msg.cardId);
              return { ...prev, cards };
            });
            break;
          case 'kanbanColumn':
            setBoard((prev) =>
              prev
                ? {
                    ...prev,
                    columns: prev.columns.map((c) => (c.key === msg.column.key ? msg.column : c)),
                  }
                : prev,
            );
            break;
          default:
            break;
        }
      }),
    [],
  );

  return board;
}
