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

/**
 * Whether this device can drive the world. Both conditions matter: a narrow
 * desktop window is a resize away from working, but a coarse pointer means
 * there is no keyboard, which no amount of resizing fixes.
 */
function canRenderWorld(): boolean {
  if (typeof window === 'undefined') return true;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return !coarse && window.innerWidth >= MIN_WIDTH_PX;
}

export function useCanRenderWorld(): boolean {
  const [ok, setOk] = useState(canRenderWorld);
  useEffect(() => {
    // A desktop user who narrows the window should get the explanation, and
    // get the world back when they widen it again.
    const update = (): void => setOk(canRenderWorld());
    window.addEventListener('resize', update);
    const pointer = window.matchMedia('(pointer: coarse)');
    pointer.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      pointer.removeEventListener('change', update);
    };
  }, []);
  return ok;
}

/** Shown instead of the canvas. Modelled on the missing-art setup screen. */
export function DesktopOnlyGate({ roomId }: { roomId?: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-page p-6">
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
