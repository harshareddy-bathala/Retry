import { useEffect, useRef, useState } from 'react';
import { avatarTilePositions, minimapWorld } from './avatar-positions.js';
import { useHud } from './hud/hud-store.js';

// A small plan of the room, with a dot per person.
//
// The camera shows about thirty tiles across; the Commons is forty and the
// rooms are twenty. So "who is here" (the presence strip) and "where are they"
// (this) are genuinely different questions, and clicking a name to fly there
// only helps once you know there is someone to fly to.
//
// Drawn on a canvas from the same per-frame store the bubble overlay uses. It
// never re-renders React: the whole thing is one rAF loop writing pixels.

/** Longest side of the drawing, in CSS pixels. Rooms are wider than they are tall. */
const MAX_PX = 132;
/** Smallest a room may draw at, so a 20x15 studio is not a postage stamp. */
const MIN_TILE_PX = 2;

/** Read once per world, not per frame — getComputedStyle forces a style flush. */
function palette(): { floor: string; wall: string; self: string; peer: string } {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    floor: read('--ink', '#edeae6'),
    wall: read('--edge', '#2a2f36'),
    self: read('--accent', '#e2935e'),
    peer: read('--ink-muted', '#8c929b'),
  };
}

type Props = { selfUserId: string };

export function Minimap({ selfUserId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Visibility lives in the HUD store, and its toggle lives on the rail. It
  // used to be local state with the toggle button attached to the map itself,
  // which meant an open panel covered the map AND the only way to get it back.
  const { minimapOpen: open } = useHud();
  const [size, setSize] = useState({ w: MAX_PX, h: MAX_PX });

  useEffect(() => {
    if (!open) return;
    let raf = 0;

    // Everything that changes only when the ROOM changes is hoisted out of the
    // frame loop. The old version called getContext('2d') every tick and
    // repainted the collision grid one fillRect at a time — up to 880 cells for
    // the Commons, sixty times a second, to draw something that changes once
    // per door.
    let ctx: CanvasRenderingContext2D | null = null;
    let terrain: HTMLCanvasElement | null = null;
    let drawnFor = '';
    let scale = MIN_TILE_PX;
    let w = 0;
    let h = 0;
    let colors = palette();

    const rebuild = (world: NonNullable<typeof minimapWorld.current>): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      colors = palette();
      scale = Math.max(MIN_TILE_PX, Math.floor(MAX_PX / Math.max(world.width, world.height)));
      w = world.width * scale;
      h = world.height * scale;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      setSize({ w, h });
      ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The room's shape, painted ONCE into an offscreen buffer. Per frame that
      // whole grid becomes a single drawImage.
      terrain = document.createElement('canvas');
      terrain.width = w;
      terrain.height = h;
      const tctx = terrain.getContext('2d');
      if (!tctx) return;
      tctx.globalAlpha = 0.75;
      tctx.fillStyle = colors.floor;
      tctx.fillRect(0, 0, w, h);
      tctx.globalAlpha = 0.35;
      tctx.fillStyle = colors.wall;
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          if (world.blocked[y * world.width + x]) tctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    };

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      // A world nobody is looking at does not need painting.
      if (document.visibilityState === 'hidden') return;
      const world = minimapWorld.current;
      if (!world) return;

      const key = `${world.width}x${world.height}`;
      if (key !== drawnFor) {
        drawnFor = key;
        rebuild(world);
      }
      if (!ctx || !terrain) return;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(terrain, 0, 0);

      // The shape of the room is what makes a dot mean something: a scatter of
      // dots in an empty rectangle tells you nothing about whether someone is
      // across the room or behind a shelf.
      const dot = Math.max(2, scale + 1);
      for (const [userId, pos] of avatarTilePositions) {
        const isSelf = userId === selfUserId;
        ctx.fillStyle = isSelf ? colors.self : colors.peer;
        ctx.beginPath();
        ctx.arc(pos.x * scale, pos.y * scale, dot / 2, 0, Math.PI * 2);
        ctx.fill();
        if (isSelf) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, selfUserId]);

  if (!open) return null;

  // Anchored to the STAGE, not the viewport: when the sidebar opens the stage
  // narrows and the map slides with it, instead of being buried under a panel.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: size.w, height: size.h, imageRendering: 'pixelated' }}
      className="pointer-events-none absolute bottom-3 right-3 z-hud rounded-card border border-edge shadow-lg"
    />
  );
}
