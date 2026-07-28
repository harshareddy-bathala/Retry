import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Desktop gate for the Live Space (build plan Phase 8.4, SRS §10).
//
// The world is a keyboard-driven 2D canvas. On a phone there is nothing to
// press, the camera zoom is picked from viewport height and clamps at 2, and
// the HUD assumes a pointer. A broken canvas teaches a student that Retry is
// broken; a sentence explaining where to go teaches them where to go.
//
// This gates ONE route. The rest of Retry — including the Workspace, which is
// the half of a room that works when nobody else is online — stays fully
// usable at any size, and that is what this screen points at.

const MIN_WIDTH_PX = 1024;

const WIDE = `(min-width: ${MIN_WIDTH_PX}px)`;
const COARSE = '(pointer: coarse)';

/**
 * Why the world cannot draw here — and the two answers mean different things.
 *
 * `pointer` is a phone. It will never drive this world no matter what happens
 * to the viewport, so there is nothing to keep alive: mount no canvas, open no
 * socket, and say so.
 *
 * `narrow` is a desktop window one drag away from working. That session must
 * SURVIVE. The gate used to be an early return for both cases, and because
 * `canRenderWorld` also sat in the connect effect's dependencies, dragging a
 * window narrower for one second disconnected the socket, stopped LiveKit and
 * dropped your avatar out of the map — then rejoined from scratch on the way
 * back. A slow drag across the boundary thrashed it dozens of times.
 */
export type WorldFit = 'ok' | 'narrow' | 'pointer';

function measure(): WorldFit {
  if (typeof window === 'undefined') return 'ok';
  if (window.matchMedia(COARSE).matches) return 'pointer';
  return window.matchMedia(WIDE).matches ? 'ok' : 'narrow';
}

/**
 * Two media queries, not a resize listener. `matchMedia` fires only when a
 * threshold is actually crossed, so this is not a debounced resize handler —
 * it is the absence of one.
 */
export function useWorldFit(): WorldFit {
  const [fit, setFit] = useState(measure);
  useEffect(() => {
    const queries = [window.matchMedia(WIDE), window.matchMedia(COARSE)];
    const update = (): void => setFit(measure());
    queries.forEach((q) => q.addEventListener('change', update));
    update();
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return fit;
}

/** Shown instead of the canvas. Modelled on the missing-art setup screen. */
export function DesktopOnlyGate({ roomId }: { roomId?: string }) {
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-page p-6">
      <div className="max-w-md rounded-panel border border-edge bg-surface p-6 shadow-lg">
        <h1 className="font-display text-lg text-ink">The world needs a bigger screen</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Walking around a room takes a keyboard and a window at least {MIN_WIDTH_PX}px wide. Open
          this on a laptop and you&apos;ll get the full space — people, proximity video, the lot.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          Everything else works here. A room&apos;s <strong className="text-ink">Workspace</strong> —
          its blueprint, board, chat and whiteboard — is designed to work without the map, on any
          screen.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {roomId && (
            <Link
              to={`/rooms/${roomId}`}
              className="rounded-card bg-accent px-3 py-1.5 font-display text-sm font-medium text-white hover:opacity-90"
            >
              Open the Workspace
            </Link>
          )}
          <Link
            to="/rooms"
            className="rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            ← Back to rooms
          </Link>
        </div>
      </div>
    </div>
  );
}
