import { AVControls } from '../AVControls.js';
import { EmoteBar } from '../EmoteBar.js';
import { roomEvents } from '../event-bus.js';
import { SayBar } from '../SayBar.js';
import type { AvState } from '../av-state.js';

type DockProps = {
  av: AvState;
  onToggleAv: (next: AvState) => void;
};

/**
 * The bottom dock: everything you DO, in one row, centred under the world.
 *
 * These controls used to be two clusters — one anchored `bottom-4 left-3` and
 * one centred at `bottom-4 left-1/2`. At 1024px the left cluster ran ~660px
 * wide and the centred one started at ~412px, so they overlapped and the AV
 * panel (a later DOM sibling, same z) silently ate the say bar's clicks.
 *
 * One row, one flow, no insets. It cannot overlap itself.
 */
export function Dock({ av, onToggleAv }: DockProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-t border-edge bg-surface/80 px-3 py-2 backdrop-blur">
      <AVControls av={av} onToggle={onToggleAv} />

      <span className="h-6 w-px shrink-0 bg-edge" aria-hidden />

      <SayBar />
      <EmoteBar />

      <button
        type="button"
        onClick={() => roomEvents.emit('creator:open')}
        className="shrink-0 rounded-card border border-edge px-3 py-1.5 font-mono text-[11px] text-ink-muted hover:text-ink"
      >
        Change look
      </button>

      <span
        className="shrink-0 font-mono text-[10px] text-ink-muted"
        title="WASD or arrow keys to walk · E to sit or enter a door · 1–8 to react · Enter to speak"
      >
        WASD · E · 1–8
      </span>
    </div>
  );
}
