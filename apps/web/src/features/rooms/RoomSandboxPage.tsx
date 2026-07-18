import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { AVControls } from './AVControls.js';
import { loadAvState, saveAvState, type AvState } from './av-state.js';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';
import { PresenceStrip } from './PresenceStrip.js';
import { RoomCanvas } from './RoomCanvas.js';

const ROOM_WS_URL =
  (import.meta.env.VITE_ROOM_WS_URL as string | undefined) ?? 'ws://localhost:4100/ws';

// Phase 3 sandbox: multiplayer + proximity bubbles + AV toggle state.
export default function RoomSandboxPage() {
  const { user } = useAuth();
  const [interactions, setInteractions] = useState<string[]>([]);
  const [av, setAv] = useState<AvState>(loadAvState);
  const avRef = useRef(av);
  avRef.current = av;

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

  // Restore persisted mic/cam state on every (re)join (FR-ROOM-21).
  useEffect(
    () =>
      roomEvents.on('net:status', (status) => {
        if (status === 'open') roomSocket.send({ t: 'media', ...avRef.current });
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

  const onToggleAv = (next: AvState): void => {
    setAv(next);
    saveAvState(next);
    roomSocket.send({ t: 'media', ...next });
  };

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Room sandbox</h2>
        <p className="font-mono text-xs text-ink-muted">
          WASD / arrows to move · E to interact · phase 3 · proximity
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <PresenceStrip selfUserId={user.id} />
        <AVControls av={av} onToggle={onToggleAv} />
      </div>
      <RoomCanvas userId={user.id} displayName={user.name} selfAudio={av.audio} />
      <div className="rounded-panel border border-edge bg-surface px-4 py-3">
        <p className="font-mono text-[11px] uppercase text-ink-muted">EventBus log</p>
        {interactions.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">
            Walk to the whiteboard on the north wall and press E. Open a second browser window and
            walk together to see proximity bubbles.
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
