import { useEffect, useRef, useState } from 'react';
import type { Zone } from '@foundry/protocol';
import { avatarScreenPositions } from './avatar-positions.js';
import { roomEvents } from './event-bus.js';
import { useRoomActors } from './useRoomActors.js';

type BubbleOverlayProps = {
  selfUserId: string;
  selfDisplayName: string;
  selfAudio: boolean;
};

// Placeholder AV bubbles (rooms build plan Phase 3). Rendered as a DOM overlay
// positioned from Phaser coordinates — NOT inside the canvas — because Phase 5
// replaces the colour blocks with real <video> elements that must live in the
// DOM. Sizes/opacity per plan: close → 72px full, near → 48px at 70%.
const SIZE: Record<'close' | 'near', number> = { close: 72, near: 48 };
const SELF_SIZE = 48;
// Vertical clearance so a bubble's bottom edge sits above the name tag
// (tag occupies roughly the 52..78px band above the avatar centre at 2x zoom).
const CLEARANCE_PX = 86;

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

export function BubbleOverlay({ selfUserId, selfDisplayName, selfAudio }: BubbleOverlayProps) {
  const [zones, setZones] = useState<Map<string, Zone>>(new Map());
  const actors = useRoomActors();
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
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const [userId, el] of bubbleRefs.current) {
        if (!el) continue;
        const pos = avatarScreenPositions.get(userId);
        if (!pos) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = 'visible';
        const x = pos.x - el.offsetWidth / 2;
        const y = pos.y - CLEARANCE_PX - el.offsetHeight;
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
      raf = requestAnimationFrame(tick);
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
  ) => (
    <div
      key={userId}
      ref={(el) => {
        bubbleRefs.current.set(userId, el);
        if (!el) bubbleRefs.current.delete(userId);
      }}
      className="absolute left-0 top-0 flex items-center justify-center rounded-full border-2 border-white/80 font-display font-semibold text-white shadow-lg transition-[width,height,opacity] duration-200"
      style={{
        width: size,
        height: size,
        opacity,
        backgroundColor: colorFor(userId),
        fontSize: size * 0.32,
        visibility: 'hidden',
      }}
    >
      {initials(name)}
      {muted && (
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px]">
          🔇
        </span>
      )}
    </div>
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {bubble(selfUserId, selfDisplayName, SELF_SIZE, 0.9, !selfAudio)}
      {peers.map(({ actor, zone }) =>
        bubble(actor.userId, actor.displayName, SIZE[zone], zone === 'close' ? 1 : 0.7, !actor.audio),
      )}
    </div>
  );
}
