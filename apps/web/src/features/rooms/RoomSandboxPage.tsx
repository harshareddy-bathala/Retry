import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { roomEvents } from './event-bus.js';
import { RoomCanvas } from './RoomCanvas.js';

// Phase 1 sandbox: one local avatar in studio_a, no networking. The event log
// below the canvas is the React side of the EventBus bridge — Phaser emits
// interact:whiteboard, React records it. Nothing else happens yet by design.
export default function RoomSandboxPage() {
  const { user } = useAuth();
  const [interactions, setInteractions] = useState<string[]>([]);

  useEffect(
    () =>
      roomEvents.on('interact:whiteboard', () => {
        setInteractions((prev) => [
          ...prev,
          `interact:whiteboard — ${new Date().toLocaleTimeString()}`,
        ]);
      }),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Room sandbox</h2>
        <p className="font-mono text-xs text-ink-muted">
          WASD / arrows to move · E to interact · phase 1 · single-player
        </p>
      </div>
      <RoomCanvas displayName={user?.name ?? 'Explorer'} />
      <div className="rounded-panel border border-edge bg-surface px-4 py-3">
        <p className="font-mono text-[11px] uppercase text-ink-muted">EventBus log</p>
        {interactions.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">
            Walk to the whiteboard on the north wall and press E.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {interactions.map((entry, i) => (
              <li key={i} className="font-mono text-xs text-ink">
                {entry}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
