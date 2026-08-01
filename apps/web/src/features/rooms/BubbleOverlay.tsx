import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MicOff } from 'lucide-react';
import type { Zone } from '@retry/protocol';
import { avatarScreenPositions } from './avatar-positions.js';
import { BUBBLE_CLEARANCE_PX, BUBBLE_SIZE, SELF_BUBBLE_SIZE } from './overlay-metrics.js';
import { avStore } from './av/av-store.js';
import { roomEvents } from './event-bus.js';
import { useRoomActors } from './useRoomActors.js';

type BubbleOverlayProps = {
  selfUserId: string;
  selfDisplayName: string;
  selfAudio: boolean;
};

// AV bubbles (rooms build plan Phases 3+5). Rendered as a DOM overlay
// positioned from Phaser coordinates — NOT inside the canvas, because a
// <video> element cannot reach a Phaser texture without a per-frame GPU copy
// and the bubble has to host one the instant a track arrives. A peer with a
// live subscribed video track gets a real <video>; audio-only (or no-AV) peers
// show initials with a speaking ring — never a black rectangle.
//
// Sizes and the clearance live in overlay-metrics.ts, shared with RoomScene.

const PALETTE = ['#4f83cc', '#cc7a4f', '#5aa06c', '#a06ca0', '#c2544f', '#4fa3b8'];

function colorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? '#4f83cc';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// The video element needs srcObject managed imperatively; muted because the
// audio path runs through the AvManager's WebAudio gain chain, not this tag.
function BubbleVideo({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />;
}

export function BubbleOverlay({ selfUserId, selfDisplayName, selfAudio }: BubbleOverlayProps) {
  const [zones, setZones] = useState<Map<string, Zone>>(new Map());
  const actors = useRoomActors();
  const peerAv = useSyncExternalStore(avStore.subscribe, avStore.getSnapshot);
  const bubbleRefs = useRef(new Map<string, HTMLDivElement | null>());

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t === 'snapshot') {
          // Resync: zone state is rebuilt from fresh proximity events.
          setZones(new Map());
          return;
        }
        if (msg.t !== 'proximity') return;
        setZones((prev) => {
          const next = new Map(prev);
          for (const pair of msg.pairs) {
            if (pair.zone === 'out') next.delete(pair.userId);
            else next.set(pair.userId, pair.zone);
          }
          return next;
        });
      }),
    [],
  );

  // Bubbles follow avatars via rAF + direct style writes — per-frame positions
  // never pass through React state.
  //
  // The loop writes and NEVER READS, which matters more than it looks.
  //
  // It used to read `el.offsetWidth`/`offsetHeight` every frame to centre each
  // bubble. On its own that read was harmless: the loop only wrote `visibility`
  // and `transform`, neither of which dirties layout, so there was nothing to
  // flush. (Measured: zero layouts per second with one avatar on screen.)
  //
  // What made it expensive was the SIZE transition. A bubble changing proximity
  // zone animated `width` and `height` for 200ms, and those do dirty layout —
  // so for the length of every crossing the per-frame read became a genuine
  // forced synchronous reflow. Two students walking in and out of each other's
  // range measured 76 layouts over 8 seconds; this version measures 0.
  //
  // Both halves of the fix are structural. The OUTER element is a zero-size
  // point carrying only the anchor translate, and the INNER element centres
  // itself against it with a static `translate(-50%, -100%)` — so the loop has
  // nothing to measure. And the size change animates as `scale` rather than
  // `width`/`height`, so it composites instead of laying out.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      for (const [userId, el] of bubbleRefs.current) {
        if (!el) continue;
        const pos = avatarScreenPositions.get(userId);
        if (!pos) {
          el.style.opacity = '0';
          continue;
        }
        el.style.opacity = '1';
        el.style.transform = `translate3d(${pos.x}px, ${pos.y - BUBBLE_CLEARANCE_PX}px, 0)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const peers = [...zones.entries()]
    .filter(([, zone]) => zone === 'close' || zone === 'near')
    .map(([userId, zone]) => ({ actor: actors.get(userId), zone: zone as 'close' | 'near' }))
    .filter((p): p is { actor: NonNullable<typeof p.actor>; zone: 'close' | 'near' } => !!p.actor);

  const bubble = (
    userId: string,
    name: string,
    size: number,
    opacity: number,
    muted: boolean,
  ) => {
    const av = peerAv.get(userId);
    const speaking = av?.speaking ?? false;
    return (
      // Outer: a zero-size anchor point. The rAF loop touches only this, and
      // only its transform and opacity — both composited, neither laying out.
      <div
        key={userId}
        ref={(el) => {
          bubbleRefs.current.set(userId, el);
          if (!el) bubbleRefs.current.delete(userId);
        }}
        className="absolute left-0 top-0 h-0 w-0 will-change-transform"
        style={{ opacity: 0 }}
      >
        {/* Inner: centres itself on the anchor with a static transform, so its
            size is the browser's problem rather than the loop's. A zone change
            animates as `scale`, which composites; `width`/`height` did not. */}
        <div
          className={`absolute flex items-center justify-center rounded-full border-2 font-display font-semibold text-accent-ink shadow-lg transition-[transform,opacity] duration-200 ${
            speaking ? 'border-success ring-2 ring-success/60 animate-pulse' : 'border-ink/60'
          }`}
          style={{
            width: BUBBLE_SIZE.close,
            height: BUBBLE_SIZE.close,
            fontSize: BUBBLE_SIZE.close * 0.32,
            opacity,
            backgroundColor: colorFor(userId),
            transform: `translate(-50%, -100%) scale(${size / BUBBLE_SIZE.close})`,
          }}
        >
          {av?.videoTrack ? (
            // Clip the video to the circle without clipping the mute badge.
            <span className="absolute inset-0 overflow-hidden rounded-full">
              <BubbleVideo track={av.videoTrack} />
            </span>
          ) : (
            initials(name)
          )}
          {muted && (
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-danger-ink">
              <MicOff size={11} aria-hidden />
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {bubble(selfUserId, selfDisplayName, SELF_BUBBLE_SIZE, 0.9, !selfAudio)}
      {peers.map(({ actor, zone }) =>
        bubble(
          actor.userId,
          actor.displayName,
          BUBBLE_SIZE[zone],
          zone === 'close' ? 1 : 0.7,
          !actor.audio,
        ),
      )}
    </div>
  );
}
