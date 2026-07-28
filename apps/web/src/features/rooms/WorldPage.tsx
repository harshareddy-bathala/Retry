import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_SPRITE } from '@retry/maps';
import { ART_SOURCE } from '@retry/maps/generated/tilesets';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { CharacterCreator } from './CharacterCreator.js';
import { AVControls } from './AVControls.js';
import { DesktopOnlyGate, useCanRenderWorld } from './DesktopOnlyGate.js';
import { EmoteBar } from './EmoteBar.js';
import { useInputLayer, useInputRoot } from './input/useInputLayer.js';
import { Minimap } from './Minimap.js';
import { SayBar } from './SayBar.js';
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

/**
 * Non-blocking connection banner (build plan Phase 8.1). Deliberately does not
 * cover the world: while it is up you can still walk around, and the people
 * around you are dimmed rather than deleted. 'failed' is the only state that
 * asks the student to do something, because it is the only one where waiting
 * will not help.
 */
function ConnectionBanner() {
  const status = useSyncExternalStore(roomSocket.subscribe, roomSocket.getStatus);
  if (status === 'open' || status === 'closed' || status === 'connecting') return null;
  const failed = status === 'failed';
  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-card border border-amber-500/40 bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur">
      <span
        className={`inline-block h-2 w-2 rounded-full ${failed ? 'bg-red-500' : 'animate-pulse bg-amber-500'}`}
      />
      <p className="text-xs text-ink">
        {failed
          ? 'Lost the connection to the world.'
          : 'Reconnecting — the people around you may be out of date.'}
      </p>
      {failed && (
        <button
          type="button"
          onClick={() => roomSocket.rejoin()}
          className="rounded-card border border-edge px-2.5 py-1 text-xs text-ink hover:bg-accent-tint"
        >
          Rejoin
        </button>
      )}
    </div>
  );
}

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
  const canRenderWorld = useCanRenderWorld();
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
    if (!user || !token || !canRenderWorld) return;
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
  }, [user, mapId, canRenderWorld]);

  // A world that fills the window must not also scroll the page behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // The world installs the single keydown listener and keeps Phaser in step
  // with whoever currently owns the keyboard.
  useInputRoot();

  // The base layer, always at the bottom of the stack. Escape reaches it only
  // once every panel, modal and text field above it has been peeled — so
  // leaving the world is the LAST thing Escape can do, never the first.
  useInputLayer(true, {
    kind: 'canvas',
    name: 'world',
    onEscape: () => {
      navigate('/rooms');
      return true;
    },
  });

  const onToggleAv = (next: AvState): void => {
    setAv(next);
    saveAvState(next);
    roomSocket.send({ t: 'media', ...next });
    avManager.setLocal(next);
  };

  if (!user) return null;

  // A phone gets an explanation, not a canvas it cannot drive. Checked before
  // the art gate: on a phone the pack is irrelevant either way, and "install
  // the art pack" would be advice nobody there can act on.
  if (!canRenderWorld) return <DesktopOnlyGate roomId={mapId} />;

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
            <PresenceStrip
              selfUserId={user.id}
              onLocate={(userId) => roomEvents.emit('camera:locate', { userId })}
            />
          </div>
        </div>

        <ConnectionBanner />

        {/* Bottom left: the panel rail owns the top-right corner. */}
        <div className="absolute bottom-4 left-3 flex items-end gap-2">
          <p className="rounded-card border border-edge bg-surface/80 px-3 py-1.5 font-mono text-[11px] text-ink-muted backdrop-blur">
            WASD or arrows · E to sit or enter · 1–8 to react
          </p>
          <SayBar />
          <EmoteBar />
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

        {/* Bottom right, clear of the panel rail at the top right. */}
        <div className="absolute bottom-4 right-3">
          <Minimap selfUserId={user.id} />
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
