import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import {
  parseClientMessage,
  type Actor,
  type Dir,
  type JoinMessage,
  type MoveMessage,
  type ServerMessage,
} from '@foundry/protocol';
import type { AuthedUser } from '../lib/auth.js';
import { getWorldMap, isBlocked, type WorldMap } from '../world/maps.js';

const MOVES_PER_SECOND = 20;
const MAX_STEP_TILES = 2;

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
  moveWindowStart: number;
  movesInWindow: number;
};

// Server-authoritative world state (rooms build plan Phase 2). All positions
// are TILE units. Identity comes exclusively from the verified JWT — nothing
// in a message body can speak for another user.
export class RoomHub {
  private mapSessions = new Map<string, Map<string, Session>>();
  private all = new Set<Session>();

  /** Open sessions (joined or not) — lets tests prove nothing leaks. */
  get sessionCount(): number {
    return this.all.size;
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
        this.send(session, this.snapshotOf(world));
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

    session.map = world;
    session.x = world.spawn.x;
    session.y = world.spawn.y;
    session.dir = 'down';
    session.moving = false;
    sessions.set(session.userId, session);

    this.send(session, this.snapshotOf(world));
    this.broadcast(world.id, { t: 'actorJoin', actor: toActor(session) }, session.userId);
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
      this.send(session, this.snapshotOf(world));
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
    }
  }

  private snapshotOf(world: WorldMap): ServerMessage {
    return { t: 'snapshot', mapId: world.id, actors: this.actorsIn(world.id) };
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
  };
}
