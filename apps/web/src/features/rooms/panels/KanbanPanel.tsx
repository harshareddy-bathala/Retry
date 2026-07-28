import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { KanbanCard, KanbanColumnKey } from '@retry/protocol';
import { roomSocket } from '../net/room-socket.js';
import { ErrorState, SkeletonList } from '../../../components/ui/states.js';
import type { BoardState } from './use-kanban-board.js';

type KanbanPanelProps = { state: BoardState };

// Kanban (FR-ROOM-18..20): mutations go over the world socket; the server
// persists, then broadcasts — this panel only ever renders server state.
// Drags write ONE fractional position, so two members dragging at once
// never fight over a reindex. The board itself is tracked by useKanbanBoard
// above this component, because the snapshot arrives on room entry rather
// than on panel open.
export function KanbanPanel({ state }: KanbanPanelProps) {
  const [draft, setDraft] = useState<Partial<Record<KanbanColumnKey, string>>>({});
  const [renaming, setRenaming] = useState<KanbanColumnKey | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const { board, status, retry } = state;

  // The board arrives once, unprompted, from a fire-and-forget push on the
  // server whose only failure path is a logged warning. So "still loading" had
  // to become a state that can END: this used to read "Loading board…" forever.
  if (status === 'timeout') {
    return (
      <div className="p-3">
        <ErrorState
          title="The board didn't arrive."
          detail="Nothing has been lost — ask the room for it again."
          onRetry={retry}
        />
      </div>
    );
  }
  if (!board) return <SkeletonList rows={3} className="p-3" />;

  const cardsIn = (key: KanbanColumnKey): KanbanCard[] =>
    [...board.cards.values()]
      .filter((c) => c.column === key)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  /** The end of `column`, as a fractional position. */
  const endOf = (column: KanbanColumnKey, exceptId: string): number =>
    (cardsIn(column)
      .filter((c) => c.id !== exceptId)
      .at(-1)?.position ?? 0) + 1;

  /**
   * The keyboard equivalent of a drag. Dragging was the ONLY way to move a
   * card, which meant a keyboard user could create cards and delete them but
   * never advance one — the single thing a board is for.
   */
  const moveTo = (card: KanbanCard, column: KanbanColumnKey): void => {
    if (column === card.column) return;
    roomSocket.send({ t: 'kanbanMove', cardId: card.id, column, position: endOf(column, card.id) });
  };

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
          className="group/col mb-2 rounded-card border border-edge bg-page p-2"
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
            <div className="mb-1 flex items-center gap-1">
              <h3 className="font-mono text-[11px] uppercase text-ink-muted">
                {label} · {cardsIn(key).length}
              </h3>
              {/* Renaming used to be double-click only, on a <button> where
                  Enter and Space did nothing at all. */}
              <button
                type="button"
                onClick={() => setRenaming(key)}
                aria-label={`Rename the ${label} column`}
                className="rounded-card p-0.5 text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover/col:opacity-100"
              >
                <Pencil size={11} aria-hidden />
              </button>
            </div>
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
                {/* `hidden … group-hover:block` put this out of the DOM's focus
                    order entirely, so it could not be reached by keyboard at
                    all. Opacity keeps it focusable; `focus-within` on the card
                    keeps it visible once it is. */}
                <button
                  type="button"
                  onClick={() => roomSocket.send({ t: 'kanbanDelete', cardId: card.id })}
                  aria-label={`Delete ${card.title}`}
                  className="shrink-0 rounded-card p-0.5 text-ink-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
              {card.description && (
                <p className="mt-0.5 text-xs text-ink-muted">{card.description}</p>
              )}
              <label className="mt-1 block">
                <span className="sr-only">Move {card.title} to a column</span>
                <select
                  value={card.column}
                  onChange={(e) => moveTo(card, e.target.value as KanbanColumnKey)}
                  className="w-full rounded-card border border-edge bg-page px-1 py-0.5 font-mono text-[10px] uppercase text-ink-muted opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  {board.columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
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
