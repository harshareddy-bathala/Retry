import { useEffect, useRef } from 'react';
import { BubbleOverlay } from './BubbleOverlay.js';
import { roomEvents } from './event-bus.js';
import { createRoomGame } from './game/create-game.js';

type RoomCanvasProps = {
  userId: string;
  displayName: string;
  selfAudio: boolean;
};

// Mounts a Phaser.Game into a ref'd div. React communicates with the game only
// through the typed EventBus (event-bus.ts) — never through Phaser internals.
// The effect cleanup destroys the game and removes its canvas, which makes
// StrictMode's double-invoke and route changes leak-free: every create is
// paired with a destroy.
//
// The canvas fills this element and Phaser follows it on resize (W2), so the
// world is as big as whatever the page gives it. The bubble overlay sits in the
// same box, which is what keeps proximity bubbles glued to avatars at any size.
export function RoomCanvas({ userId, displayName, selfAudio }: RoomCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The name is only the scene's INITIAL label. Keeping it out of the effect's
  // dependencies matters: renaming yourself used to destroy the whole game and
  // re-decode every texture mid-walk. The live value is pushed to the scene
  // below instead.
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const game = createRoomGame(container, { userId, displayName: displayNameRef.current });

    // Phaser's Scale.RESIZE listens to `window.resize` and nothing else, so it
    // never sees the container change on its own. The canvas now lives in a
    // grid track that narrows when the sidebar opens — without this observer
    // the world would silently keep its old width and the camera fit would
    // drift. rAF-throttled because the sidebar animates its track over 180ms.
    let pending = 0;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width === 0 || box.height === 0) return;
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        // The game may already be destroyed by the time the frame lands.
        if (game.scale) game.scale.resize(container.clientWidth, container.clientHeight);
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (pending) cancelAnimationFrame(pending);
      // Phaser DEFERS destroy to its next step, so a game torn down before it
      // has ever stepped — StrictMode's double-invoke in development, or a
      // fast route change — never removes its canvas. The dead canvas then
      // stacks on top of the live one and the world renders as a black
      // rectangle, which is exactly what the first browser drive found.
      // Removing this game's own canvas is precise and idempotent.
      const canvas = game.canvas;
      game.destroy(true);
      canvas?.remove();
    };
  }, [userId]);

  // A rename is a label change, not a world rebuild.
  useEffect(() => {
    roomEvents.emit('self:rename', { displayName });
  }, [displayName]);

  return (
    <div className="absolute inset-0 z-world overflow-hidden">
      {/*
        A 2D world driven by a keyboard has no honest screen-reader story: there
        is no reading order for "a room with people standing in it". Rather than
        pretend, the canvas is labelled with what it is and where the equivalent
        content lives, and the Workspace view — same chat, same board, same
        whiteboard, no canvas — is the accessible path by design rather than by
        accident. See docs/rooms-next-steps.md.
      */}
      {/*
        tabIndex makes the world reachable by keyboard at all. It was a
        role="application" div with no tab stop, so movement only worked
        because Phaser binds to window — you could never deliberately return
        focus here after closing a panel. It is also the element a dialog
        restores focus to when it closes.
      */}
      <div
        ref={containerRef}
        role="application"
        tabIndex={0}
        aria-label="Room world. A 2D space you walk around with the arrow keys. Everything in this room is also available without the map on the room's Workspace page."
        className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      />
      {/* DOM layer over the canvas — the <video> elements live here too. */}
      <BubbleOverlay selfUserId={userId} selfDisplayName={displayName} selfAudio={selfAudio} />
    </div>
  );
}
