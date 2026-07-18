import { cn } from '../../lib/cn.js';
import type { AvState } from './av-state.js';

type AVControlsProps = {
  av: AvState;
  onToggle: (next: AvState) => void;
};

// Mic / camera toggles for the room top bar. Placeholder AV: no capture yet,
// but the state is real — persisted, broadcast, and rendered on bubbles.
export function AVControls({ av, onToggle }: AVControlsProps) {
  const button = (label: string, on: boolean, next: () => AvState) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onToggle(next())}
      className={cn(
        'rounded-card border px-3 py-1.5 font-display text-sm',
        on
          ? 'border-edge text-ink hover:text-accent'
          : 'border-red-600/40 bg-red-600/10 text-red-500',
      )}
    >
      {label} {on ? 'on' : 'off'}
    </button>
  );

  return (
    <div className="flex items-center gap-2">
      {button('Mic', av.audio, () => ({ ...av, audio: !av.audio }))}
      {button('Cam', av.video, () => ({ ...av, video: !av.video }))}
    </div>
  );
}
