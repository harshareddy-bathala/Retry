import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import {
  parseClientMessage,
  type Actor,
  type Dir,
  type JoinMessage,
  type MediaMessage,
  type MoveMessage,
  type ServerMessage,
  type Zone,
} from '@foundry/protocol';
import type { AuthedUser } from '../lib/auth.js';
import { getWorldMap, isBlocked, type WorldMap } from '../world/maps.js';
import { ProximityEngine, type PairChange } from './proximity.js';

const MOVES_PER_SECOND = 20;
const MAX_STEP_TILES = 2;
// Settles pending proximity transitions when actors stop moving mid-debounce.
const PROXIMITY_TICK_MS = 100;

type Session = {
  socket: WebSocket;
  log: FastifyBaseLogger;
  userId: string;
  displayName: string;
  sprite: string;
  map: WorldMap | null;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  audio: boolean;
  video: boolean;
  moveWindowStart: number;
  movesInWindow: number;
};

// Server-authoritative world state (rooms build plan Phase 2). All positions
// are TILE units. Identity comes exclusively from the verified JWT — nothing
// in a message body can speak for another user.
export class RoomHub {
  private mapSessions = new Map<string, Map<string, Session>>();
  private all = new Set<Session>();
  private proximity = new ProximityEngine();
  private ticker: ReturnType<typeof setInterval> | null = null;

  /** Open sessions (joined or not) — lets tests prove nothing leaks. */
  get sessionCount(): number {
    return this.all.size;
  }

  start(): void {
    if (this.ticker) return;
    this.ticker = setInterval(
      () => this.emitProximity(this.proximity.settle(Date.now())),
      PROXIMITY_TICK_MS,
    );
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  actorsIn(mapId: string): Actor[] {
    return [...(this.mapSessions.get(mapId)?.values() ?? [])].map(toActor);
  }

  connect(socket: WebSocket, user: AuthedUser, log: FastifyBaseLogger): void {
    const session: Session = {
      socket,
      log,
      userId: user.userId,
      displayName: 'Anonymous',
      sprite: 'default',
      map: null,
      x: 0,
      y: 0,
      dir: 'down',
      moving: false,
      audio: true,
      video: true,
      moveWindowStart: 0,
      movesInWindow: 0,
    };
    this.all.add(session);
    log.info({ userId: user.userId }, 'ws connected');

    socket.on('message', (data: Buffer) => this.onMessage(session, data));
    socket.on('close', () => {
      this.leaveMap(session);
      this.all.delete(session);
      log.info({ userId: session.userId }, 'ws disconnected');
    });
    socket.on('error', (err: Error) => log.warn({ err }, 'ws connection error'));
  }

  private onMessage(session: Session, data: Buffer): void {
    const parsed = parseClientMessage(data.toString());
    if (!parsed.ok) {
      session.log.warn({ reason: parsed.error }, 'dropped unparseable ws message');
      return;
    }
    switch (parsed.message.t) {
      case 'join':
        this.onJoin(session, parsed.message);
        break;
      case 'move':
        this.onMove(session, parsed.message);
        break;
      case 'leave':
        this.leaveMap(session);
        break;
      case 'media':
        this.onMedia(session, parsed.message);
        break;
      case 'chat':
        // Chat UI lands with the panels phase; accepted by the protocol, ignored here.
        session.log.debug('chat message ignored (no chat in phase 2)');
        break;
    }
  }

  private onJoin(session: Session, msg: JoinMessage): void {
    const world = getWorldMap(msg.mapId);
    if (!world) {
      this.send(session, { t: 'error', code: 'UNKNOWN_MAP', message: `No map '${msg.mapId}'.` });
      return;
    }
    if (session.map) {
      // Rejoining the current map is a resync request; switching maps is Phase 4.
      if (session.map.id === world.id) {
        this.resync(session, world);
      } else {
        this.send(session, { t: 'error', code: 'ALREADY_JOINED', message: 'Leave first.' });
      }
      return;
    }
    if (msg.displayName) session.displayName = msg.displayName;
    if (msg.sprite) session.sprite = msg.sprite;

    let sessions = this.mapSessions.get(world.id);
    if (!sessions) {
      sessions = new Map();
      this.mapSessions.set(world.id, sessions);
    }
    // Same user joining twice (second tab): the newer connection supersedes.
    const previous = sessions.get(session.userId);
    if (previous) {
      previous.map = null;
      sessions.delete(previous.userId);
      previous.socket.close(4000, 'superseded by a newer connection');
    }

    // Reconnects and superseded tabs leave committed pair states behind; drop
    // them so the fresh connection receives its zones as new transitions —
    // otherwise a rejoining client never learns it is still 'close' to someone.
    this.emitProximity(this.proximity.removeActor(world.id, session.userId));

    session.map = world;
    session.x = world.spawn.x;
    session.y = world.spawn.y;
    session.dir = 'down';
    session.moving = false;
    sessions.set(session.userId, session);

    this.send(session, this.snapshotOf(world));
    this.broadcast(world.id, { t: 'actorJoin', actor: toActor(session) }, session.userId);
    this.emitProximity(
      this.proximity.update(world.id, session.userId, this.positionsIn(world.id), Date.now()),
    );
  }

  private onMedia(session: Session, msg: MediaMessage): void {
    session.audio = msg.audio;
    session.video = msg.video;
    if (!session.map) return;
    this.broadcast(
      session.map.id,
      { t: 'mediaState', userId: session.userId, audio: msg.audio, video: msg.video },
      session.userId,
    );
  }

  private onMove(session: Session, msg: MoveMessage): void {
    const world = session.map;
    if (!world) return;

    // Cap at 20 move/s per connection; excess dropped silently, never queued.
    const now = Date.now();
    if (now - session.moveWindowStart >= 1000) {
      session.moveWindowStart = now;
      session.movesInWindow = 0;
    }
    if (++session.movesInWindow > MOVES_PER_SECOND) return;

    const step = Math.hypot(msg.x - session.x, msg.y - session.y);
    const legal =
      Number.isFinite(msg.x) &&
      Number.isFinite(msg.y) &&
      step <= MAX_STEP_TILES &&
      !isBlocked(world, msg.x, msg.y);
    if (!legal) {
      // Teleport or wall clip: don't apply, don't broadcast — resync the offender.
      session.log.warn({ userId: session.userId, x: msg.x, y: msg.y, step }, 'illegal move; resync');
      this.resync(session, world);
      return;
    }

    session.x = msg.x;
    session.y = msg.y;
    session.dir = msg.dir;
    session.moving = msg.moving;
    this.broadcast(
      world.id,
      { t: 'actorMove', userId: session.userId, x: msg.x, y: msg.y, dir: msg.dir, moving: msg.moving },
      session.userId,
    );
    this.emitProximity(
      this.proximity.update(world.id, session.userId, this.positionsIn(world.id), now),
    );
  }

  private leaveMap(session: Session): void {
    const world = session.map;
    if (!world) return;
    session.map = null;
    const sessions = this.mapSessions.get(world.id);
    // Only broadcast if this session still owns its registry slot (a superseded
    // connection was already evicted by its replacement).
    if (sessions?.get(session.userId) === session) {
      sessions.delete(session.userId);
      this.broadcast(world.id, { t: 'actorLeave', userId: session.userId });
      this.emitProximity(this.proximity.removeActor(world.id, session.userId));
    }
  }

  private positionsIn(mapId: string): Array<{ userId: string; x: number; y: number }> {
    return [...(this.mapSessions.get(mapId)?.values() ?? [])].map((s) => ({
      userId: s.userId,
      x: s.x,
      y: s.y,
    }));
  }

  /** Fan changed pairs out to exactly the two clients each pair involves. */
  private emitProximity(changes: PairChange[]): void {
    if (changes.length === 0) return;
    const perUser = new Map<string, { mapId: string; pairs: Array<{ userId: string; zone: Zone }> }>();
    const add = (mapId: string, to: string, peer: string, zone: Zone): void => {
      let entry = perUser.get(to);
      if (!entry) {
        entry = { mapId, pairs: [] };
        perUser.set(to, entry);
      }
      entry.pairs.push({ userId: peer, zone });
    };
    for (const change of changes) {
      add(change.mapId, change.a, change.b, change.zone);
      add(change.mapId, change.b, change.a, change.zone);
    }
    for (const [userId, { mapId, pairs }] of perUser) {
      const session = this.mapSessions.get(mapId)?.get(userId);
      if (session) this.send(session, { t: 'proximity', pairs });
    }
  }

  private snapshotOf(world: WorldMap): ServerMessage {
    return { t: 'snapshot', mapId: world.id, actors: this.actorsIn(world.id) };
  }

  /**
   * Snapshot + current zones. A client rebuilds ALL state from a snapshot
   * (including its bubble list), so committed zones must ride along — they
   * are not transitions and would otherwise never be re-sent.
   */
  private resync(session: Session, world: WorldMap): void {
    this.send(session, this.snapshotOf(world));
    const zones = this.proximity.zonesFor(world.id, session.userId);
    if (zones.length > 0) this.send(session, { t: 'proximity', pairs: zones });
  }

  private broadcast(mapId: string, msg: ServerMessage, exceptUserId?: string): void {
    const payload = JSON.stringify(msg);
    for (const peer of this.mapSessions.get(mapId)?.values() ?? []) {
      if (peer.userId === exceptUserId) continue;
      if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(payload);
    }
  }

  private send(session: Session, msg: ServerMessage): void {
    if (session.socket.readyState === session.socket.OPEN) {
      session.socket.send(JSON.stringify(msg));
    }
  }
}

function toActor(session: Session): Actor {
  return {
    userId: session.userId,
    displayName: session.displayName,
    sprite: session.sprite,
    x: session.x,
    y: session.y,
    dir: session.dir,
    moving: session.moving,
    audio: session.audio,
    video: session.video,
  };
}
