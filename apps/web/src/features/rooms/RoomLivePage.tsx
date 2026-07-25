import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { DEFAULT_AVATAR } from '@retry/maps';
import { AvatarPicker } from './AvatarPicker.js';
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
  const [av, setAv] = useState<AvState>(loadAvState);
  const avRef = useRef(av);
  avRef.current = av;

  // Being moved out of a room is jarring unless the world says why (R3). The
  // server sends this immediately before the Commons snapshot arrives.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t !== 'evicted') return;
        setNotice(
          msg.reason === 'roomDeleted'
            ? 'That room was deleted. You are back in the Commons.'
            : 'You are no longer a member of that room. You are back in the Commons.',
        );
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
      sprite: DEFAULT_AVATAR,
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
          WASD or arrows to move · E at a door to walk through
        </p>
      </div>
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-panel border border-edge bg-accent-tint px-4 py-2.5">
          <p className="text-sm text-ink">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-card border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <PresenceStrip selfUserId={user.id} />
        <AVControls av={av} onToggle={onToggleAv} />
      </div>
      <div className="relative">
        <RoomCanvas userId={user.id} displayName={user.name} selfAudio={av.audio} />
        <KnockLayer />
        <AvatarPicker />
        <RoomPanels selfUserId={user.id} />
      </div>
      <p className="text-sm text-ink-muted">
        You spawn in your last room, or the Commons. Doors along the Commons&apos; north wall lead
        into public rooms — locked ones make you knock. Each room has an exit door on its south
        wall.
      </p>
    </div>
  );
}
