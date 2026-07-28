import { useCallback, useEffect, useState } from 'react';
import type { KanbanCard, KanbanColumnKey } from '@retry/protocol';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

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
export type BoardState = {
  board: Board | null;
  status: 'idle' | 'loading' | 'ready' | 'timeout';
  retry: () => void;
};

/**
 * How long to wait for `kanbanState` before admitting it is not coming.
 *
 * The server pushes the board on room entry from a fire-and-forget promise
 * whose only failure path is `.catch(err => log.warn(...))`. So if that read
 * fails there is no error frame, no retry and no signal of any kind — the panel
 * simply said "Loading board…" forever. Ten seconds is far longer than the
 * measured p99 and short enough that nobody sits staring at it.
 */
const BOARD_TIMEOUT_MS = 10_000;

export function useKanbanBoard(roomId: string | null): BoardState {
  const [board, setBoard] = useState<Board | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // A new room means a new board; drop the old one so nothing leaks across.
  useEffect(() => {
    setBoard(null);
    setTimedOut(false);
  }, [roomId]);

  useEffect(() => {
    if (!roomId || board) return;
    const timer = setTimeout(() => setTimedOut(true), BOARD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [roomId, board, attempt]);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        switch (msg.t) {
          case 'kanbanState':
            setBoard({ columns: msg.columns, cards: new Map(msg.cards.map((c) => [c.id, c])) });
            setTimedOut(false);
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

  // A bare `join` is the protocol's resync request: the server re-enters the
  // current map, which re-pushes the snapshot AND the board.
  const retry = useCallback((): void => {
    setTimedOut(false);
    setAttempt((n) => n + 1);
    roomSocket.send({ t: 'join' });
  }, []);

  const status: BoardState['status'] = !roomId
    ? 'idle'
    : board
      ? 'ready'
      : timedOut
        ? 'timeout'
        : 'loading';

  return { board, status, retry };
}
