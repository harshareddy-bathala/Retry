import { useEffect, useRef, useState } from 'react';
import { useHotkey, useInputLayer } from './input/useInputLayer.js';
import { roomSocket } from './net/room-socket.js';

// Speak to whoever is standing near you. Enter opens it, Enter sends, Escape
// closes — the convention every game with a chat line has used for decades.
//
// This exists separately from the chat panel because the panel is ROOM chat
// and only rooms have one: the Commons keeps no log, so it has no panel. But
// the Commons is the atrium where people actually run into each other, and a
// hub where you cannot say hello is not a hub. Nearby speech is map-scoped and
// unpersisted, so it works there and needs nothing to write to.
//
// Losing focus does NOT close the bar. It used to, and clicking the emote
// picker mid-sentence silently threw the sentence away.

export function SayBar() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastTypingSentAt = useRef(0);

  const close = (): void => {
    setDraft('');
    setOpen(false);
  };

  // Enter opens the bar from anywhere in the world. Inert whenever anything
  // above the canvas owns the keyboard — a panel, the creator, a text field —
  // so the stack decides rather than a tag check.
  useHotkey('Enter', (e) => {
    e.preventDefault();
    setOpen(true);
  });

  // Open, the bar takes the keyboard: the scene must not move the avatar while
  // you type, and Escape must close the line rather than leave the world.
  useInputLayer(open, { kind: 'text', name: 'say-bar', capturesKeys: true, onEscape: () => {
    close();
    return true;
  } });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = (): void => {
    const body = draft.trim();
    if (body) roomSocket.send({ t: 'chat', body, scope: 'nearby' });
    close();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto rounded-card border border-edge bg-surface/80 px-3 py-1.5 font-mono text-[11px] text-ink-muted backdrop-blur hover:text-ink"
      >
        Say something · Enter
      </button>
    );
  }

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-card border border-accent bg-surface/95 px-2 py-1.5 shadow-lg backdrop-blur">
      <span className="font-mono text-[10px] uppercase text-ink-muted">Nearby</span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const now = Date.now();
          if (e.target.value && now - lastTypingSentAt.current > 1_000) {
            lastTypingSentAt.current = now;
            roomSocket.send({ t: 'typing' });
          }
        }}
        onKeyDown={(e) => {
          // Enter sends. Escape is the input layer's job, not this input's —
          // it peels the say bar and nothing below it.
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        }}
        maxLength={2000}
        placeholder="Only people near you will hear this"
        className="w-72 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}
