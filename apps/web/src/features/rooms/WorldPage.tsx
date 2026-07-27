import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_SPRITE } from '@retry/maps';
import { ART_SOURCE } from '@retry/maps/generated/tilesets';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { CharacterCreator } from './CharacterCreator.js';
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

// The Live Space, full bleed (W2).
//
// This route deliberately renders OUTSIDE AppShell: the app shell wraps its
// children in `max-w-5xl px-4 py-8`, and a world inside an article column reads
// as a widget no matter how good the art is. Everything that used to sit above
// and below the canvas is now a HUD floating on top of it.
export default function WorldPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mapId = searchParams.get('map') ?? undefined;
  const [av, setAv] = useState<AvState>(loadAvState);
  const avRef = useRef(av);
  avRef.current = av;

  // Being moved out of a room is jarring unless the world says why (R3).
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
      sprite: DEFAULT_SPRITE,
    });
    return () => {
      roomSocket.disconnect();
      avManager.stop();
    };
  }, [user, mapId]);

  // A world that fills the window must not also scroll the page behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape leaves the world — but only when no panel has taken the key first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) navigate('/rooms');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const onToggleAv = (next: AvState): void => {
    setAv(next);
    saveAvState(next);
    roomSocket.send({ t: 'media', ...next });
    avManager.setLocal(next);
  };

  if (!user) return null;

  // No licensed art, no world. The pack cannot be committed (its licence
  // forbids redistribution), so a fresh clone reaches here with typed stubs —
  // explain the one-time setup instead of throwing inside Phaser.
  if (ART_SOURCE !== 'limezu') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-page">
        <div className="max-w-md rounded-panel border border-edge bg-surface p-6 shadow-lg">
          <h1 className="font-display text-lg text-ink">The world's art is not built</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Rooms are drawn from a licensed art pack that is not in the repository. Follow{' '}
            <code className="font-mono text-xs">docs/assets-setup.md</code> to get the pack, then
            run:
          </p>
          <pre className="mt-3 rounded-card border border-edge bg-page px-3 py-2 font-mono text-xs text-ink">
            pnpm --filter @retry/maps assets:build
          </pre>
          <Link
            to="/rooms"
            className="mt-4 inline-block rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            ← Back to rooms
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-page">
      <RoomCanvas userId={user.id} displayName={user.name} selfAudio={av.audio} />

      {/* HUD. `pointer-events-none` on the frame so clicks fall through to the
          world; each control re-enables them for itself. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-2">
          <Link
            to="/rooms"
            className="rounded-card border border-edge bg-surface/90 px-3 py-1.5 font-display text-sm text-ink backdrop-blur hover:bg-surface"
          >
            ← Leave
          </Link>
          <div className="rounded-card border border-edge bg-surface/90 px-3 py-1.5 backdrop-blur">
            <PresenceStrip selfUserId={user.id} />
          </div>
        </div>

        {/* Bottom left: the panel rail owns the top-right corner. */}
        <div className="absolute bottom-4 left-3 flex items-center gap-2">
          <p className="rounded-card border border-edge bg-surface/80 px-3 py-1.5 font-mono text-[11px] text-ink-muted backdrop-blur">
            WASD or arrows · E at a door
          </p>
          <button
            type="button"
            onClick={() => roomEvents.emit('creator:open')}
            className="pointer-events-auto rounded-card border border-edge bg-surface/80 px-3 py-1.5 font-mono text-[11px] text-ink-muted backdrop-blur hover:text-ink"
          >
            Change look
          </button>
        </div>

        {notice && (
          <div className="pointer-events-auto absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-3 rounded-panel border border-edge bg-surface px-4 py-2.5 shadow-lg">
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

        <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 rounded-panel border border-edge bg-surface/90 px-2 py-2 shadow-lg backdrop-blur">
          <AVControls av={av} onToggle={onToggleAv} />
        </div>

        <div className="pointer-events-auto">
          <KnockLayer />
          <CharacterCreator />
          <RoomPanels selfUserId={user.id} />
        </div>
      </div>
    </div>
  );
}
