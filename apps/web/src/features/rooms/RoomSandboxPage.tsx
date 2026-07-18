import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';
import { PresenceStrip } from './PresenceStrip.js';
import { RoomCanvas } from './RoomCanvas.js';

const ROOM_WS_URL =
  (import.meta.env.VITE_ROOM_WS_URL as string | undefined) ?? 'ws://localhost:4100/ws';

// Phase 2 sandbox: studio_a with live multiplayer. React owns the socket
// lifecycle; Phaser and the presence strip both consume the same EventBus.
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

  useEffect(() => {
    const token = getAccessToken();
    if (!user || !token) return;
    roomSocket.connect({
      url: ROOM_WS_URL,
      token,
      mapId: 'studio_a',
      displayName: user.name,
      sprite: 'default',
    });
    return () => {
      roomSocket.disconnect();
    };
  }, [user]);

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Room sandbox</h2>
        <p className="font-mono text-xs text-ink-muted">
          WASD / arrows to move · E to interact · phase 2 · multiplayer
        </p>
      </div>
      <PresenceStrip selfUserId={user.id} />
      <RoomCanvas userId={user.id} displayName={user.name} />
      <div className="rounded-panel border border-edge bg-surface px-4 py-3">
        <p className="font-mono text-[11px] uppercase text-ink-muted">EventBus log</p>
        {interactions.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">
            Walk to the whiteboard on the north wall and press E. Open a second browser window to
            see multiplayer.
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
