import { useEffect, useRef } from 'react';
import { BubbleOverlay } from './BubbleOverlay.js';
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const game = createRoomGame(container, { userId, displayName });
    return () => {
      game.destroy(true);
    };
  }, [userId, displayName]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {/* DOM layer over the canvas — the <video> elements live here too. */}
      <BubbleOverlay selfUserId={userId} selfDisplayName={displayName} selfAudio={selfAudio} />
    </div>
  );
}
