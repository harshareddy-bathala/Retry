import { parseServerMessage, type ClientMessage } from '@retry/protocol';
import { reportWarning } from '../../../lib/report.js';
import { roomEvents, type RoomSocketStatus } from '../event-bus.js';

// Client networking layer (rooms build plan Phase 2). Owns the single
// WebSocket to the room server; delivers inbound messages over the EventBus so
// both React (presence) and Phaser (avatars) consume them without knowing
// about each other. Reconnects with exponential backoff: 1s, 2s, 4s, 8s…
// capped at 30s; a fresh join on reopen resyncs state from the snapshot.
//
// Status is BOTH broadcast (`net:status`, for Phaser) and readable
// (`getStatus`/`subscribe`, for React). Broadcast alone was a bug: a component
// mounting after a transition — the presence strip, every time — started from a
// guess and only learned the truth at the next change, which is why the world
// could read "Reconnecting…" while it was plainly working.

export type RoomSocketOptions = {
  url: string;
  token: string;
  /**
   * 'world' puts an avatar on a map (the Live Space). 'watch' subscribes to a
   * room's Workspace channel with no actor, no proximity and no AV (R4).
   */
  mode?: 'world' | 'watch';
  /** Required for 'watch'. */
  roomId?: string;
  /** Omit to let the server resolve the spawn map (last-active room, else Commons). */
  mapId?: string;
  displayName: string;
  sprite: string;
};

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const CLOSE_UNAUTHORIZED = 4401;

/**
 * Retrying forever is worse than stopping: the world looks alive, nothing
 * works, and there is nothing to press. After this many failures the socket
 * gives up and the HUD offers an explicit Rejoin (build plan Phase 8.1).
 */
const MAX_RECONNECT_ATTEMPTS = 5;

// Application-level liveness. A half-open socket still reads as OPEN in the
// browser, so silence is the only symptom — and silence is indistinguishable
// from a quiet room without a heartbeat.
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_MISSED_HEARTBEATS = 3;

class RoomSocket {
  private ws: WebSocket | null = null;
  private options: RoomSocketOptions | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private joinedOnce = false;
  private status: RoomSocketStatus = 'closed';
  private listeners = new Set<() => void>();

  connect(options: RoomSocketOptions): void {
    this.teardown();
    this.options = options;
    this.attempt = 0;
    this.joinedOnce = false;
    this.open();
  }

  disconnect(): void {
    this.teardown();
    this.setStatus('closed');
  }

  /**
   * Manual retry after the socket gave up. Distinct from connect(): the
   * options — and with them the token and the first-join mapId — are the ones
   * the world was opened with.
   */
  rejoin(): void {
    if (!this.options || this.ws) return;
    this.attempt = 0;
    this.open();
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // --- Readable status (useSyncExternalStore) -------------------------------

  getStatus = (): RoomSocketStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setStatus(next: RoomSocketStatus): void {
    if (this.status === next) return;
    this.status = next;
    roomEvents.emit('net:status', next);
    for (const listener of this.listeners) listener();
  }

  /**
   * Ask the server for a fresh snapshot (+ current zones) of the CURRENT map.
   * The Phaser scene calls this when it finishes booting: the original join
   * snapshot often arrives while assets are still loading, before the scene
   * has subscribed — without this, actors present at join never render. A bare
   * join (no mapId) is a resync of whatever map the session is in — after a
   * door transition the connect-time mapId would be stale.
   */
  requestResync(): void {
    const options = this.options;
    if (!options || this.ws?.readyState !== WebSocket.OPEN) return;
    // A watching session has no scene and no avatar; a join here would give it one.
    if (options.mode === 'watch') return;
    this.send({ t: 'join', displayName: options.displayName, sprite: options.sprite });
  }

  private teardown(): void {
    this.closeSocket();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.options = null;
  }

  /** Drop the socket but keep the options, so a rejoin still has somewhere to go. */
  private closeSocket(): void {
    this.stopHeartbeat();
    if (this.ws) {
      // Detach handlers BEFORE closing: the close event of a discarded socket
      // must never reach the reconnect logic (StrictMode remounts would
      // otherwise spawn a second competing connection).
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private open(): void {
    const options = this.options;
    if (!options) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(`${options.url}?token=${encodeURIComponent(options.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      // Subscribe first, then announce open — listeners react to 'open' by
      // sending (e.g. media state), which must never precede the subscription.
      if (options.mode === 'watch' && options.roomId) {
        // The Workspace never joins a map: opening a room's page must not put
        // your avatar in it, or "reading the board" would look like presence.
        this.send({ t: 'watch', roomId: options.roomId, displayName: options.displayName });
      } else {
        // The explicit mapId applies to the FIRST join only: after door
        // transitions it is stale, so reconnects use a bare join (server-side
        // spawn resolution).
        this.send({
          t: 'join',
          ...(options.mapId && !this.joinedOnce ? { mapId: options.mapId } : {}),
          displayName: options.displayName,
          sprite: options.sprite,
        });
        this.joinedOnce = true;
      }
      this.startHeartbeat();
      this.setStatus('open');
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      // ANY inbound frame proves the connection is alive, not just a pong —
      // a busy room may never be quiet enough for a heartbeat to matter.
      this.missedHeartbeats = 0;
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        reportWarning('rooms: dropped unparseable server frame', parsed.error);
        return;
      }
      // 'pong' exists only to reset the counter above; nothing subscribes to it.
      if (parsed.message.t === 'pong') return;
      roomEvents.emit('net:server-message', parsed.message);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws || !this.options) return;
      this.stopHeartbeat();
      this.ws = null;
      if (event.code === CLOSE_UNAUTHORIZED) {
        // A stale token never becomes valid by retrying.
        reportWarning('rooms: server rejected the token; not reconnecting');
        this.teardown();
        this.setStatus('closed');
        return;
      }
      if (this.attempt >= MAX_RECONNECT_ATTEMPTS) {
        reportWarning(`rooms: gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
        this.setStatus('failed');
        return;
      }
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_CAP_MS);
      this.attempt += 1;
      this.setStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        reportWarning('rooms: no reply to heartbeat; treating the socket as dead');
        // Reconnect through the normal path: re-open() rather than close(),
        // because a half-open socket's close event may never arrive either.
        this.closeSocket();
        this.attempt = 1;
        this.setStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => this.open(), BACKOFF_BASE_MS);
        return;
      }
      this.send({ t: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.missedHeartbeats = 0;
  }
}

export const roomSocket = new RoomSocket();

if (import.meta.env.DEV) {
  // Dev-only handle for the headless drives: when the world stops responding,
  // "is the socket actually open?" is the first question and there is no other
  // way to ask it from outside the bundle.
  (window as unknown as { __roomSocket?: RoomSocket }).__roomSocket = roomSocket;
}
