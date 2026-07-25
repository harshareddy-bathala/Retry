import { parseServerMessage, type ClientMessage } from '@retry/protocol';
import { reportWarning } from '../../../lib/report.js';
import { roomEvents } from '../event-bus.js';

// Client networking layer (rooms build plan Phase 2). Owns the single
// WebSocket to the room server; delivers inbound messages over the EventBus so
// both React (presence) and Phaser (avatars) consume them without knowing
// about each other. Reconnects with exponential backoff: 1s, 2s, 4s, 8s…
// capped at 30s; a fresh join on reopen resyncs state from the snapshot.

export type RoomSocketOptions = {
  url: string;
  token: string;
  /** Omit to let the server resolve the spawn map (last-active room, else Commons). */
  mapId?: string;
  displayName: string;
  sprite: string;
};

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const CLOSE_UNAUTHORIZED = 4401;

class RoomSocket {
  private ws: WebSocket | null = null;
  private options: RoomSocketOptions | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private joinedOnce = false;

  connect(options: RoomSocketOptions): void {
    this.teardown();
    this.options = options;
    this.attempt = 0;
    this.joinedOnce = false;
    this.open();
  }

  disconnect(): void {
    this.teardown();
    roomEvents.emit('net:status', 'closed');
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
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
    this.send({ t: 'join', displayName: options.displayName, sprite: options.sprite });
  }

  private teardown(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.options = null;
  }

  private open(): void {
    const options = this.options;
    if (!options) return;
    roomEvents.emit('net:status', this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(`${options.url}?token=${encodeURIComponent(options.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      // join first, then announce open — listeners react to 'open' by sending
      // (e.g. media state), which must never precede the join. The explicit
      // mapId applies to the FIRST join only: after door transitions it is
      // stale, so reconnects use a bare join (server-side spawn resolution).
      this.send({
        t: 'join',
        ...(options.mapId && !this.joinedOnce ? { mapId: options.mapId } : {}),
        displayName: options.displayName,
        sprite: options.sprite,
      });
      this.joinedOnce = true;
      roomEvents.emit('net:status', 'open');
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        reportWarning('rooms: dropped unparseable server frame', parsed.error);
        return;
      }
      roomEvents.emit('net:server-message', parsed.message);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws || !this.options) return;
      if (event.code === CLOSE_UNAUTHORIZED) {
        // A stale token never becomes valid by retrying.
        reportWarning('rooms: server rejected the token; not reconnecting');
        this.teardown();
        roomEvents.emit('net:status', 'closed');
        return;
      }
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_CAP_MS);
      this.attempt += 1;
      roomEvents.emit('net:status', 'reconnecting');
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }
}

export const roomSocket = new RoomSocket();

if (import.meta.env.DEV) {
  // Dev-only handle for the headless drives: when the world stops responding,
  // "is the socket actually open?" is the first question and there is no other
  // way to ask it from outside the bundle.
  (window as unknown as { __roomSocket?: RoomSocket }).__roomSocket = roomSocket;
}
