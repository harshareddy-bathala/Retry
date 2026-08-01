import { useState } from 'react';
import { EMOTE_CHOICES, EMOTE_STRIP, TYPING_FRAME } from '@retry/maps/generated/emotes';
import { roomEvents } from './event-bus.js';
import { useHotkey } from './input/useInputLayer.js';

// The emote bar. Eight reactions from the pack's thought-bubble atlas, picked
// by click or by number key — the two ways people actually use these in a
// Gather-like world, and neither should require the other.
//
// Emotes are ephemeral by design: the server fans one out to the map, every
// client shows it for three seconds, and nothing is written down. A reaction
// that persists is a comment, and comments belong in chat.

/** How big each button draws the source frame. */
const BUTTON_PX = 28;
/** Frames in the whole strip: every emote's pair, plus the typing pair last. */
const STRIP_FRAMES = TYPING_FRAME + 2;
/** Displayed strip width, so a frame offset is a whole number of buttons. */
const STRIP_PX = STRIP_FRAMES * BUTTON_PX;

export function EmoteBar() {
  const [open, setOpen] = useState(false);

  // 1..8 fire the emote in picker order without opening anything.
  //
  // Registered as CANVAS hotkeys, so they are inert the moment any layer above
  // the canvas captures keys. The old version guarded on INPUT/TEXTAREA/
  // contentEditable, and the whiteboard is none of those — picking a tldraw
  // tool with "3" also broadcast an emote to the whole room.
  useHotkey(['1', '2', '3', '4', '5', '6', '7', '8'], (e) => {
    const choice = EMOTE_CHOICES[Number(e.key) - 1];
    if (choice) roomEvents.emit('self:emote', { key: choice.key });
  });

  // No pack, no strip — the world does not render at all in that state, but
  // this component is cheap to make honest rather than conditional upstream.
  if (!EMOTE_STRIP || EMOTE_CHOICES.length === 0) return null;

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1">
      {open && (
        <div className="flex items-center gap-0.5 rounded-panel border border-edge bg-surface/95 p-1 shadow-lg backdrop-blur">
          {EMOTE_CHOICES.map((choice, i) => (
            <button
              key={choice.key}
              type="button"
              title={`${choice.label}  ·  ${i + 1}`}
              aria-label={choice.label}
              onClick={() => roomEvents.emit('self:emote', { key: choice.key })}
              className="rounded-card p-1 transition-colors hover:bg-accent-tint"
            >
              <span
                className="block"
                style={{
                  width: BUTTON_PX,
                  height: BUTTON_PX,
                  backgroundImage: `url(${EMOTE_STRIP})`,
                  // The strip is one row: scale the whole thing so each frame
                  // is exactly BUTTON_PX wide, then slide to the frame. Keeps
                  // the sprite crisp and the offset a whole number of buttons.
                  backgroundSize: `${STRIP_PX}px ${BUTTON_PX}px`,
                  backgroundPosition: `-${choice.frame * BUTTON_PX}px 0`,
                  backgroundRepeat: 'no-repeat',
                  imageRendering: 'pixelated',
                }}
              />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="rounded-card border border-edge bg-surface/90 px-3 py-1.5 font-mono text-[11px] text-ink-muted backdrop-blur hover:text-ink"
      >
        {open ? 'Close' : 'React'}
      </button>
    </div>
  );
}
