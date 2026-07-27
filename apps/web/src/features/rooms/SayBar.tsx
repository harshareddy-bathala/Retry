import { useEffect, useRef, useState } from 'react';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';

// Speak to whoever is standing near you. Enter opens it, Enter sends, Escape
// closes — the convention every game with a chat line has used for decades.
//
// This exists separately from the chat panel because the panel is ROOM chat
// and only rooms have one: the Commons keeps no log, so it has no panel. But
// the Commons is the atrium where people actually run into each other, and a
// hub where you cannot say hello is not a hub. Nearby speech is map-scoped and
// unpersisted, so it works there and needs nothing to write to.

export function SayBar() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastTypingSentAt = useRef(0);

  // Enter opens the bar from anywhere in the world. Ignored while something
  // else owns the keyboard — a panel, the character creator, another input.
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // While the bar has focus the scene must not move the avatar — the same
  // contract the panels use, over the same event.
  useEffect(() => {
    if (!open) return;
    roomEvents.emit('panel:state', { open: true });
    inputRef.current?.focus();
    return () => roomEvents.emit('panel:state', { open: false });
  }, [open]);

  const close = (): void => {
    setDraft('');
    setOpen(false);
  };

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
          // Both keys are stopped here: Enter must not re-open the bar, and
          // Escape must not fall through to WorldPage and leave the world.
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        onBlur={close}
        maxLength={2000}
        placeholder="Only people near you will hear this"
        className="w-72 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}
