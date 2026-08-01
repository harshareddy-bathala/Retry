import { useEffect, useRef, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button.js';
import { avStore } from './av-store.js';
import { useRoomActors } from '../useRoomActors.js';

// Someone's screen, over the world.
//
// It fills the STAGE, not the viewport — a child of the grid area, so the top
// bar, the dock, the rail and the sidebar all keep working and none of it needs
// a z-index argument. That is the whole reason the HUD became a grid in
// Phase 2: a new full-size thing is a slot, not an inset.
//
// The world is dimmed rather than unmounted. Phaser keeps running, avatars keep
// moving, proximity keeps working — walking away from a presentation is still
// walking, and tearing down the scene to show a video would make "close the
// share" mean "reload the world".

type ScreenShareViewProps = { selfUserId: string };

export function ScreenShareView({ selfUserId }: ScreenShareViewProps) {
  const peers = useSyncExternalStore(avStore.subscribe, avStore.getSnapshot);
  // A screen with no owner is a screen nobody trusts.
  const actors = useRoomActors();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Whoever is presenting, excluding yourself: you are already looking at your
  // own screen, and showing it back is a hall of mirrors.
  let sharerId: string | null = null;
  for (const [userId, peer] of peers) {
    if (peer.screenTrack && userId !== selfUserId) {
      sharerId = userId;
      break;
    }
  }
  const track = sharerId ? (peers.get(sharerId)?.screenTrack ?? null) : null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  if (!track || !sharerId) return null;

  return (
    <div className="absolute inset-0 z-overlay flex flex-col bg-black/80 backdrop-blur-[2px]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <p className="truncate font-display text-sm text-ink">
          {actors.get(sharerId)?.displayName ?? 'Someone'} is sharing their screen
        </p>
        {/*
          Hiding it is a LOCAL choice — it does not stop the presenter, and it
          must not: a viewer closing a window cannot be allowed to end someone
          else's demo. The track stays subscribed, which is also what makes
          reopening instant.
        */}
        <IconButton
          label="Hide the shared screen"
          side="bottom"
          onClick={() => avStore.setScreenTrack(sharerId, null)}
          icon={<X size={16} aria-hidden />}
        />
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="min-h-0 w-full flex-1 object-contain"
      />
    </div>
  );
}
