import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_SPRITE } from '@retry/maps';
import { ART_SOURCE } from '@retry/maps/generated/tilesets';
import { useAuth } from '../auth/AuthContext.js';
import { getAccessToken } from '../../lib/api.js';
import { Button, buttonClass } from '../../components/ui/button.js';
import { ErrorBoundary } from '../../components/ui/error-boundary.js';
import { CharacterCreator } from './CharacterCreator.js';
import { DesktopOnlyGate, useWorldFit } from './DesktopOnlyGate.js';
import { Dock } from './hud/Dock.js';
import { RoomHud } from './hud/RoomHud.js';
import { Sidebar } from './hud/Sidebar.js';
import { SidebarRail } from './hud/SidebarRail.js';
import { ToastRegion } from './hud/ToastRegion.js';
import { TopBar } from './hud/TopBar.js';
import { toastStore } from './hud/toast-store.js';
import { hudStore, useHud } from './hud/hud-store.js';
import { useInputLayer, useInputRoot } from './input/useInputLayer.js';
import { Minimap } from './Minimap.js';
import { loadAvState, saveAvState, type AvState } from './av-state.js';
import { avManager } from './av/av-manager.js';
import { PreJoinDialog } from './av/PreJoinDialog.js';
import { KnockLayer } from './KnockLayer.js';
import { useRoomPanels } from './panels/use-room-panels.js';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';
import { RoomCanvas } from './RoomCanvas.js';

// tldraw is enormous; only pull it when the whiteboard actually opens.
const WhiteboardPanel = lazy(() => import('./panels/WhiteboardPanel.js'));

const ROOM_WS_URL =
  (import.meta.env.VITE_ROOM_WS_URL as string | undefined) ?? 'ws://localhost:4100/ws';

const STATIC_MAP_NAMES: Record<string, string> = {
  commons: 'The Commons',
  studio_a: 'Sandbox studio',
};

/**
 * Connection lifecycle, deliberately separated from anything about layout.
 *
 * Its dependencies are the user and the map and NOTHING else. `canRenderWorld`
 * used to be in here, so narrowing the browser window past 1024px ran this
 * effect's cleanup — disconnecting the socket, stopping LiveKit and dropping
 * your avatar out of the map. The gate is a display decision; this is a session.
 */
function useRoomSession(userId: string | undefined, mapId: string | undefined, name: string): void {
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const token = getAccessToken();
    if (!userId || !token) return;
    // AV first: the manager must be listening before the server can push the
    // avToken that follows the join snapshot.
    avManager.start(loadAvState());
    roomSocket.connect({
      url: ROOM_WS_URL,
      token,
      mapId,
      displayName: nameRef.current,
      sprite: DEFAULT_SPRITE,
    });
    return () => {
      roomSocket.disconnect();
      avManager.stop();
      toastStore.clear();
    };
  }, [userId, mapId]);
}

/** Connection state, as a toast rather than a floating banner of its own. */
function useConnectionToast(): void {
  useEffect(
    () =>
      roomSocket.subscribe(() => {
        const status = roomSocket.getStatus();
        if (status === 'open' || status === 'closed' || status === 'connecting') {
          toastStore.dismiss('connection');
          return;
        }
        toastStore.show(
          status === 'failed'
            ? {
                id: 'connection',
                tone: 'danger',
                body: 'Lost the connection to the world.',
                action: { label: 'Rejoin', run: () => roomSocket.rejoin() },
              }
            : {
                id: 'connection',
                tone: 'warn',
                body: 'Reconnecting — the people around you may be out of date.',
              },
        );
      }),
    [],
  );
}

const PRE_JOIN_KEY = 'retry.rooms.prejoin';

/**
 * Has the pre-join check been offered yet in this browsing session?
 *
 * `sessionStorage`, and the choice of storage IS the definition of "session":
 * it survives a reload and every client-side navigation, and it is cleared when
 * the tab closes. That is exactly the behaviour wanted — a student who walks
 * through four doors in ten minutes is asked once, a student who hits refresh
 * is not asked again, and a student who comes back tomorrow (headset unplugged,
 * laptop somewhere else, roommate in the room) is.
 *
 * A module-level boolean was the first attempt and is subtly wrong: a page
 * reload resets it, so refreshing re-prompts. localStorage is wrong in the
 * other direction — asked once, never again, forever, on a check whose entire
 * value is catching a setup that changed since last time.
 */
function preJoinOffered(): boolean {
  try {
    return sessionStorage.getItem(PRE_JOIN_KEY) === 'yes';
  } catch {
    // Storage blocked (private mode, embedded webview): offer it, every time.
    // Asking twice is a smaller failure than never asking.
    return false;
  }
}

function markPreJoinOffered(): void {
  try {
    sessionStorage.setItem(PRE_JOIN_KEY, 'yes');
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * Open the pre-join check once, and only once the character creator is done
 * with the screen.
 *
 * The creator opens by itself on a first-ever entry (driven by the server's
 * `avatarState.chosen`, which is the only place that question can be answered),
 * so on a brand-new account both modals want the same moment. Two stacked
 * dialogs is a trap: Radix traps focus in the topmost, and the one underneath
 * is the one that cannot be dismissed.
 */
function usePreJoin(ready: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  const creatorOpen = useRef(false);

  useEffect(() => roomEvents.on('creator:state', ({ open: o }) => {
    creatorOpen.current = o;
  }), []);

  useEffect(() => {
    if (!ready || preJoinOffered()) return;
    // Poll rather than react: the creator may never open at all (a returning
    // student), in which case there is no state change to listen for.
    const timer = setInterval(() => {
      if (creatorOpen.current || preJoinOffered()) return;
      markPreJoinOffered();
      setOpen(true);
      clearInterval(timer);
    }, 300);
    return () => clearInterval(timer);
  }, [ready]);

  return [open, setOpen];
}

// The Live Space, full bleed (W2).
//
// This route deliberately renders OUTSIDE AppShell: the app shell wraps its
// children in `max-w-5xl px-4 py-8`, and a world inside an article column reads
// as a widget no matter how good the art is.
export default function WorldPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mapId = searchParams.get('map') ?? undefined;
  const fit = useWorldFit();
  const [av, setAv] = useState<AvState>(loadAvState);
  const avRef = useRef(av);
  avRef.current = av;

  const { sidebar, minimapOpen } = useHud();
  const { roomId, unread, active, board } = useRoomPanels(user?.id ?? '');
  const [placeName, setPlaceName] = useState<string | null>(null);

  useRoomSession(user?.id, mapId, user?.name ?? '');
  useConnectionToast();

  // Name the place from the snapshot. A room instance has a uuid mapId, so the
  // template is the only name available until the workspace names it properly.
  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t === 'snapshot') {
          setPlaceName(STATIC_MAP_NAMES[msg.mapId] ?? msg.template.replace(/_/g, ' '));
        }
        if (msg.t !== 'evicted') return;
        toastStore.show({
          id: 'evicted',
          tone: 'warn',
          dismissible: true,
          body:
            msg.reason === 'roomDeleted'
              ? 'That room was deleted. You are back in the Commons.'
              : 'You are no longer a member of that room. You are back in the Commons.',
        });
      }),
    [],
  );

  // Restore persisted mic/cam state on every (re)join (FR-ROOM-21).
  useEffect(
    () =>
      roomEvents.on('net:status', (status) => {
        // Only the two booleans. `AvState` also carries device ids now, and
        // spreading it would put a stable per-device fingerprint on the wire
        // for a server that has no use for one.
        if (status === 'open') {
          roomSocket.send({ t: 'media', audio: avRef.current.audio, video: avRef.current.video });
        }
      }),
    [],
  );

  // Below the gate the SESSION survives but the canvas does not: there is no
  // reason to run a game loop behind an explanation nobody can read past. The
  // socket and the LiveKit room stay up, so widening the window puts you back
  // where you were standing — a bare `join` is the protocol's own resync
  // request, which is exactly what a scene with no world needs.
  const wasGated = useRef(false);
  useEffect(() => {
    if (fit !== 'ok') {
      wasGated.current = true;
      return;
    }
    if (!wasGated.current) return;
    wasGated.current = false;
    roomSocket.send({ t: 'join' });
  }, [fit]);

  // A world that fills the window must not also scroll the page behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Back where you came from. "← Leave" always went to /rooms, even when you
  // had walked in from a specific room's Workspace one click earlier.
  const leaveTo = roomId ? `/rooms/${roomId}` : '/rooms';

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
      navigate(leaveTo);
      return true;
    },
  });

  const onToggleAv = (next: AvState): void => {
    setAv(next);
    saveAvState(next);
    roomSocket.send({ t: 'media', audio: next.audio, video: next.video });
    avManager.setLocal(next);
  };

  // Offered once the world is actually up — asking "can they hear you?" over a
  // blank canvas would be asking about a room nobody has arrived in yet.
  const [preJoinOpen, setPreJoinOpen] = usePreJoin(fit === 'ok' && placeName !== null);
  useEffect(() => roomEvents.on('av:check', () => setPreJoinOpen(true)), [setPreJoinOpen]);

  if (!user) return null;

  // A phone will never drive this world, so nothing is mounted and no session
  // is opened. A NARROW DESKTOP is different — see the overlay below.
  if (fit === 'pointer') return <DesktopOnlyGate roomId={mapId} />;

  // No licensed art, no world. The pack cannot be committed (its licence
  // forbids redistribution), so a fresh clone reaches here with typed stubs —
  // explain the one-time setup instead of throwing inside Phaser.
  if (ART_SOURCE !== 'limezu') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-page">
        <div className="max-w-md rounded-panel border border-edge bg-surface p-6 shadow-lg">
          <h1 className="font-display text-lg text-ink">The world&apos;s art is not built</h1>
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
    <>
      <RoomHud
        sidebarOpen={sidebar !== null && sidebar !== 'whiteboard' && roomId !== null}
        top={<TopBar selfUserId={user.id} leaveTo={leaveTo} placeName={placeName} />}
        stage={
          <>
            {fit === 'ok' && (
              // A boundary around the CANVAS specifically, not the page. A
              // throw inside Phaser's create() used to blank the entire app;
              // now the socket, the panels and the way out all survive it.
              <ErrorBoundary
                what="The world"
                fallback={(retry) => (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm text-ink">The map didn&apos;t draw.</p>
                    <p className="max-w-sm text-xs text-ink-muted">
                      Everything else in this room still works — the chat, the board and the
                      whiteboard are all on its Workspace page.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={retry}>
                        Try again
                      </Button>
                      <Link to={leaveTo} className={buttonClass('secondary', 'sm')}>
                        Open the Workspace
                      </Link>
                    </div>
                  </div>
                )}
              >
                <RoomCanvas userId={user.id} displayName={user.name} selfAudio={av.audio} />
                {minimapOpen && <Minimap selfUserId={user.id} />}
              </ErrorBoundary>
            )}
            <ToastRegion />
            <KnockLayer />
          </>
        }
        dock={<Dock av={av} onToggleAv={onToggleAv} />}
        rail={
          <SidebarRail
            active={active}
            unread={unread}
            minimapOpen={minimapOpen}
            roomId={roomId}
          />
        }
        sidebar={
          <Sidebar active={active} roomId={roomId} selfUserId={user.id} board={board} />
        }
        modal={
          <>
            {/* Nothing modal belongs over a world that is not being drawn —
                you cannot build a character you cannot see walking. */}
            {fit === 'ok' && <CharacterCreator />}
            {/* Publishing is gated here; the SOCKET never is. `useRoomSession`
                keeps its [userId, mapId] deps precisely so this dialog cannot
                delay or tear down the world behind it. */}
            <PreJoinDialog
              open={preJoinOpen}
              onOpenChange={setPreJoinOpen}
              av={av}
              onJoin={onToggleAv}
            />
            {active === 'whiteboard' && roomId && (
              <Suspense
                fallback={
                  <div className="absolute inset-0 z-modal flex items-center justify-center bg-black/40">
                    <p className="rounded-panel bg-surface px-4 py-2 text-sm text-ink">
                      Loading whiteboard…
                    </p>
                  </div>
                }
              >
                <WhiteboardPanel
                  key={roomId}
                  roomId={roomId}
                  onClose={() => hudStore.closePanel()}
                />
              </Suspense>
            )}
          </>
        }
      />

      {/*
        Narrow, but a real pointer: an OVERLAY, not an early return. The world,
        the socket and the LiveKit room all keep running underneath, so widening
        the window puts you back where you were standing instead of rejoining.
      */}
      {fit === 'narrow' && <DesktopOnlyGate roomId={roomId ?? mapId} />}
    </>
  );
}
