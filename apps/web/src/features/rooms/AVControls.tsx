import { useSyncExternalStore } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { IconButton } from '../../components/ui/icon-button.js';
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

const BAD: AvStatus[] = ['denied', 'failed'];

// Mic / camera toggles for the room dock, plus an honest word about whether
// audio is actually working.
export function AVControls({ av, onToggle }: AVControlsProps) {
  const status = useSyncExternalStore(avStore.subscribe, avStore.getStatus);
  const note = STATUS_TEXT[status];
  const broken = BAD.includes(status);

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        // The name states the ACTION, not the state: `aria-pressed` already
        // carries the state, and "Mic on, pressed" for a button that turns the
        // mic off is exactly backwards. The mic being blocked by the browser is
        // in the status line, which is now a live region.
        label={av.audio ? 'Turn the microphone off' : 'Turn the microphone on'}
        aria-pressed={av.audio}
        side="top"
        onClick={() => onToggle({ ...av, audio: !av.audio })}
        icon={av.audio ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
        className={cn(
          !av.audio && 'text-danger hover:text-danger',
          av.audio && broken && 'text-warn hover:text-warn',
        )}
      />
      <IconButton
        label={av.video ? 'Turn the camera off' : 'Turn the camera on'}
        aria-pressed={av.video}
        side="top"
        onClick={() => onToggle({ ...av, video: !av.video })}
        icon={av.video ? <Video size={18} aria-hidden /> : <VideoOff size={18} aria-hidden />}
        className={cn(!av.video && 'text-danger hover:text-danger')}
      />
      {note && (
        <p
          role="status"
          className={cn('max-w-56 font-mono text-[10px]', broken ? 'text-danger' : 'text-ink-muted')}
        >
          {note}
        </p>
      )}
    </div>
  );
}
