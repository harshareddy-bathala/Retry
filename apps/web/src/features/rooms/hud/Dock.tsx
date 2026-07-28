import { HelpCircle, UserRound } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button.js';
import { AVControls } from '../AVControls.js';
import { EmoteBar } from '../EmoteBar.js';
import { roomEvents } from '../event-bus.js';
import { SayBar } from '../SayBar.js';
import type { AvState } from '../av-state.js';

type DockProps = {
  av: AvState;
  onToggleAv: (next: AvState) => void;
};

const KEYS = [
  'WASD or the arrow keys to walk',
  'E to sit down or go through a door',
  'Enter to speak to whoever is near you',
  '1–8 to react',
].join(' · ');

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

      <IconButton
        label="Change how you look"
        side="top"
        onClick={() => roomEvents.emit('creator:open')}
        icon={<UserRound size={18} aria-hidden />}
      />

      {/* The key list used to be a permanently visible 300px pill in the
          bottom-left cluster — the single widest thing in the row that
          collided, and read once and never again. */}
      <IconButton label={KEYS} side="top" icon={<HelpCircle size={18} aria-hidden />} />
    </div>
  );
}
