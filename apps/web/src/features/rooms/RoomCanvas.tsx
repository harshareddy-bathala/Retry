import { useEffect, useRef } from 'react';
import { createRoomGame } from './game/create-game.js';

type RoomCanvasProps = {
  userId: string;
  displayName: string;
};

// Mounts a Phaser.Game into a ref'd div. React communicates with the game only
// through the typed EventBus (event-bus.ts) — never through Phaser internals.
// The effect cleanup destroys the game and removes its canvas, which makes
// StrictMode's double-invoke and route changes leak-free: every create is
// paired with a destroy.
export function RoomCanvas({ userId, displayName }: RoomCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const game = createRoomGame(container, { userId, displayName });
    return () => {
      game.destroy(true);
    };
  }, [userId, displayName]);

  return <div ref={containerRef} className="overflow-hidden rounded-panel border border-edge" />;
}
