import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { AVControls } from './AVControls.js';
import { loadAvState, saveAvState, type AvState } from './av-state.js';
import { avManager } from './av/av-manager.js';
import { KnockLayer } from './KnockLayer.js';
import { RoomPanels } from './panels/RoomPanels.js';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';
import { PresenceStrip } from './PresenceStrip.js';
import { RoomCanvas } from './RoomCanvas.js';

const ROOM_WS_URL =
  (import.meta.env.VITE_ROOM_WS_URL as string | undefined) ?? 'ws://localhost:4100/ws';

// Live Space (rooms build plan Phase 4): the multi-map world. ?map=<id> enters
// a specific room or the Commons; without it the server resolves the spawn
// (last-active room, else Commons). Walk onto a door and press E to move —
// the WebSocket survives every transition.
export default function RoomLivePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const mapId = searchParams.get('map') ?? undefined;
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
    // AV first: the manager must be listening before the server can push the
    // avToken that follows the join snapshot.
    avManager.start(avRef.current);
    roomSocket.connect({
      url: ROOM_WS_URL,
      token,
      mapId,
      displayName: user.name,
      sprite: 'default',
    });
    return () => {
      roomSocket.disconnect();
      avManager.stop();
    };
  }, [user, mapId]);

  const onToggleAv = (next: AvState): void => {
    setAv(next);
    saveAvState(next);
    roomSocket.send({ t: 'media', ...next });
    avManager.setLocal(next);
  };

  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">Live space</h2>
          <Link to="/rooms" className="text-sm text-accent hover:underline">
            ← my rooms
          </Link>
        </div>
        <p className="font-mono text-xs text-ink-muted">
          WASD / arrows to move · E at a door to walk through · phase 4 · multi-map
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <PresenceStrip selfUserId={user.id} />
        <AVControls av={av} onToggle={onToggleAv} />
      </div>
      <div className="relative">
        <RoomCanvas userId={user.id} displayName={user.name} selfAudio={av.audio} />
        <KnockLayer />
        <RoomPanels selfUserId={user.id} />
      </div>
      <div className="rounded-panel border border-edge bg-surface px-4 py-3">
        <p className="font-mono text-[11px] uppercase text-ink-muted">EventBus log</p>
        {interactions.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">
            You spawn in your last room (or the Commons). Doors along the Commons&apos; north wall
            lead into public rooms — locked ones make you knock. Rooms have an exit door on the
            south wall.
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
