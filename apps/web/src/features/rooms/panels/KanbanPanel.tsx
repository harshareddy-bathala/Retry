import { useEffect, useState } from 'react';
import type { KanbanCard, KanbanColumnKey } from '@foundry/protocol';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

type KanbanPanelProps = { roomId: string };

type Board = {
  columns: Array<{ key: KanbanColumnKey; label: string }>;
  cards: Map<string, KanbanCard>;
};

// Kanban (FR-ROOM-18..20): mutations go over the world socket; the server
// persists, then broadcasts — this panel only ever renders server state.
// Drags write ONE fractional position, so two members dragging at once
// never fight over a reindex.
export function KanbanPanel({ roomId }: KanbanPanelProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [draft, setDraft] = useState<Partial<Record<KanbanColumnKey, string>>>({});
  const [renaming, setRenaming] = useState<KanbanColumnKey | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

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
                    columns: prev.columns.map((c) =>
                      c.key === msg.column.key ? msg.column : c,
                    ),
                  }
                : prev,
            );
            break;
          default:
            break;
        }
      }),
    [roomId],
  );

  if (!board) {
    return <p className="px-3 py-4 text-xs text-ink-muted">Loading board…</p>;
  }

  const cardsIn = (key: KanbanColumnKey): KanbanCard[] =>
    [...board.cards.values()]
      .filter((c) => c.column === key)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  /** Drop before `target` (or at the end): one fractional position, one write. */
  const dropOn = (column: KanbanColumnKey, target: KanbanCard | null): void => {
    if (!dragId) return;
    const list = cardsIn(column).filter((c) => c.id !== dragId);
    let position: number;
    if (!target || !list.some((c) => c.id === target.id)) {
      position = (list.at(-1)?.position ?? 0) + 1;
    } else {
      const idx = list.findIndex((c) => c.id === target.id);
      const prev = list[idx - 1];
      position = prev ? (prev.position + target.position) / 2 : target.position - 1;
    }
    roomSocket.send({ t: 'kanbanMove', cardId: dragId, column, position });
    setDragId(null);
  };

  const createCard = (column: KanbanColumnKey): void => {
    const title = (draft[column] ?? '').trim();
    if (!title) return;
    roomSocket.send({ t: 'kanbanCreate', column, title });
    setDraft((d) => ({ ...d, [column]: '' }));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2">
      {board.columns.map(({ key, label }) => (
        <section
          key={key}
          className="mb-2 rounded-card border border-edge bg-page p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dropOn(key, null);
          }}
        >
          {renaming === key ? (
            <input
              autoFocus
              defaultValue={label}
              maxLength={40}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== label) {
                  roomSocket.send({ t: 'kanbanRenameColumn', column: key, label: next });
                }
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="mb-1 w-full rounded-card border border-edge bg-surface px-1.5 py-0.5 font-mono text-[11px] uppercase text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => setRenaming(key)}
              title="Double-click to rename"
              className="mb-1 font-mono text-[11px] uppercase text-ink-muted hover:text-ink"
            >
              {label} · {cardsIn(key).length}
            </button>
          )}

          {cardsIn(key).map((card) => (
            <div
              key={card.id}
              draggable
              onDragStart={() => setDragId(card.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dropOn(key, card);
              }}
              title={card.moveNote ?? undefined}
              className="group mb-1 cursor-grab rounded-card border border-edge bg-surface px-2 py-1.5"
            >
              <div className="flex items-start justify-between gap-1">
                <p className="text-sm text-ink">{card.title}</p>
                <button
                  type="button"
                  onClick={() => roomSocket.send({ t: 'kanbanDelete', cardId: card.id })}
                  className="hidden text-xs text-ink-muted hover:text-red-500 group-hover:block"
                >
                  ✕
                </button>
              </div>
              {card.description && (
                <p className="mt-0.5 text-xs text-ink-muted">{card.description}</p>
              )}
            </div>
          ))}

          <div className="mt-1 flex gap-1">
            <input
              value={draft[key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createCard(key);
              }}
              placeholder="Add a card…"
              maxLength={200}
              className="min-w-0 flex-1 rounded-card border border-edge bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => createCard(key)}
              className="rounded-card border border-edge px-2 text-xs text-ink-muted hover:text-ink"
            >
              +
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
