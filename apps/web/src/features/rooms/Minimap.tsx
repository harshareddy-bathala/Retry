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
    // Remembered across frames so the canvas is only resized when the room is,
    // which is once per door rather than sixty times a second.
    let drawnFor = '';

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const world = minimapWorld.current;
      const canvas = canvasRef.current;
      if (!world || !canvas) return;

      const scale = Math.max(
        MIN_TILE_PX,
        Math.floor(MAX_PX / Math.max(world.width, world.height)),
      );
      const w = world.width * scale;
      const h = world.height * scale;
      const key = `${world.width}x${world.height}`;
      if (key !== drawnFor) {
        drawnFor = key;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        setSize({ w, h });
        const setup = canvas.getContext('2d');
        if (setup) setup.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      // Floor, then the collision grid: the shape of the room is what makes a
      // dot mean something. A scatter of dots in an empty rectangle tells you
      // nothing about whether someone is across the room or behind a shelf.
      ctx.fillStyle = 'rgba(245, 243, 238, 0.75)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(45, 41, 38, 0.35)';
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          if (world.blocked[y * world.width + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }

      const dot = Math.max(2, scale + 1);
      for (const [userId, pos] of avatarTilePositions) {
        const isSelf = userId === selfUserId;
        ctx.fillStyle = isSelf ? '#d08a4f' : '#4f83cc';
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
