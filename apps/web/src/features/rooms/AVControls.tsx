import { useSyncExternalStore } from 'react';
import { cn } from '../../lib/cn.js';
import { avStore, type AvStatus } from './av/av-store.js';
import type { AvState } from './av-state.js';

type AVControlsProps = {
  av: AvState;
  onToggle: (next: AvState) => void;
};

/**
 * What each AV state says to a student. A silent room is otherwise
 * indistinguishable from a broken one — the worst failure mode for a beta,
 * because it teaches people the product does not work when in fact nobody has
 * spoken. `off` is honest about being a supported state rather than a fault.
 */
const STATUS_TEXT: Record<AvStatus, string | null> = {
  // Nothing to say: the toggles already show mic and camera intent, and no
  // configured server is the shipped state until one is provisioned.
  off: null,
  connecting: 'Connecting audio…',
  live: null,
  denied: 'Your browser blocked the mic — others can’t hear you',
  failed: 'Audio unavailable right now — the rest of the room still works',
};

// Mic / camera toggles for the room HUD, plus an honest word about whether
// audio is actually working.
export function AVControls({ av, onToggle }: AVControlsProps) {
  const status = useSyncExternalStore(avStore.subscribe, avStore.getStatus);
  const note = STATUS_TEXT[status];
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
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        {button('Mic', av.audio, () => ({ ...av, audio: !av.audio }))}
        {button('Cam', av.video, () => ({ ...av, video: !av.video }))}
      </div>
      {note && (
        <p
          role="status"
          className={cn(
            'font-mono text-[10px]',
            status === 'denied' || status === 'failed' ? 'text-red-500' : 'text-ink-muted',
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}
