import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import {
  parseClientMessage,
  type Actor,
  type Dir,
  type DoorInfo,
  type JoinMessage,
  type KnockCancelMessage,
  type KnockRespondMessage,
  type MediaMessage,
  type MoveMessage,
  type ServerMessage,
  type TransitionMessage,
  type Zone,
} from '@foundry/protocol';
import type { AuthedUser } from '../lib/auth.js';
import {
  COMMONS_DOOR_SLOTS,
  COMMONS_MAP_ID,
  STATIC_MAP_IDS,
  instantiate,
  isBlocked,
  type WorldMap,
} from '../world/maps.js';
import type { LastPosition, RoomRecord, RoomStore } from '../world/store.js';
import { ProximityEngine, type PairChange } from './proximity.js';

const MOVES_PER_SECOND = 20;
const MAX_STEP_TILES = 2;
// Settles pending proximity transitions when actors stop moving mid-debounce.
const PROXIMITY_TICK_MS = 100;
export const KNOCK_TIMEOUT_MS = 60_000;

type Session = {
  socket: WebSocket;
  log: FastifyBaseLogger;
  userId: string;
  role: string;
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
  /** Rooms this connection was knock-admitted to — session-only, dies with the socket. */
  granted: Set<string>;
  /** Serializes join/transition — overlapping async ops are dropped, not queued. */
  busy: boolean;
};

type PendingKnock = {
  requestId: string;
  roomId: string;
  roomName: string;
  requesterId: string;
  timer: ReturnType<typeof setTimeout>;
};

export type RoomHubDeps = {
  store: RoomStore;
  knockTimeoutMs?: number;
};

// Server-authoritative world state (rooms build plan Phases 2–4). All positions
// are TILE units. Identity comes exclusively from the verified JWT — nothing
// in a message body can speak for another user. Phase 4: multiple map
// instances behind ONE socket per user; the connection is never torn down on a
// door, the session simply moves between map registries.
export class RoomHub {
  private mapSessions = new Map<string, Map<string, Session>>();
  private all = new Set<Session>();
  private proximity = new ProximityEngine();
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Ephemeral positions for static maps (commons/sandbox) — never persisted. */
  private staticPositions = new Map<string, LastPosition>();
  private pendingKnocks = new Map<string, PendingKnock>();
  private store: RoomStore;
  private knockTimeoutMs: number;

  constructor(deps: RoomHubDeps) {
    this.store = deps.store;
    this.knockTimeoutMs = deps.knockTimeoutMs ?? KNOCK_TIMEOUT_MS;
  }

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
    for (const knock of this.pendingKnocks.values()) clearTimeout(knock.timer);
    this.pendingKnocks.clear();
  }

  actorsIn(mapId: string): Actor[] {
    return [...(this.mapSessions.get(mapId)?.values() ?? [])].map(toActor);
  }

  connect(socket: WebSocket, user: AuthedUser, log: FastifyBaseLogger): void {
    const session: Session = {
      socket,
      log,
      userId: user.userId,
      role: user.role,
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
      granted: new Set(),
      busy: false,
    };
    this.all.add(session);
    log.info({ userId: user.userId }, 'ws connected');

    socket.on('message', (data: Buffer) => this.onMessage(session, data));
    socket.on('close', () => {
      void this.persistPosition(session);
      this.leaveMap(session);
      this.all.delete(session);
      // Static-map positions are for within-session door round-trips only —
      // a fresh connection starts at the spawn (rooms restore from the store).
      if (!this.findSession(session.userId)) {
        for (const mapId of STATIC_MAP_IDS) {
          this.staticPositions.delete(`${mapId}:${session.userId}`);
        }
      }
      this.cancelKnocksBy(session.userId, 'cancelled');
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
        this.runExclusive(session, parsed.message, (msg) => this.onJoin(session, msg));
        break;
      case 'transition':
        this.runExclusive(session, parsed.message, (msg) => this.onTransition(session, msg));
        break;
      case 'knockRespond':
        this.runExclusive(session, parsed.message, (msg) => this.onKnockRespond(session, msg));
        break;
      case 'knockCancel':
        this.onKnockCancel(session, parsed.message);
        break;
      case 'move':
        this.onMove(session, parsed.message);
        break;
      case 'leave':
        void this.persistPosition(session);
        this.leaveMap(session);
        break;
      case 'media':
        this.onMedia(session, parsed.message);
        break;
      case 'chat':
        // Chat UI lands with the panels phase; accepted by the protocol, ignored here.
        session.log.debug('chat message ignored (no chat yet)');
        break;
    }
  }

  /**
   * Join/transition hit the store and must never interleave for one session.
   * Overlapping requests are dropped with a log line — the client sends these
   * one at a time; anything else is a bug or abuse, and queueing would let a
   * client stack up expensive work.
   */
  private runExclusive<M>(session: Session, msg: M, fn: (msg: M) => Promise<void>): void {
    if (session.busy) {
      session.log.warn('dropped message: join/transition already in flight');
      return;
    }
    session.busy = true;
    fn(msg)
      .catch((err: unknown) => {
        session.log.error({ err }, 'ws handler failed');
        this.send(session, { t: 'error', code: 'INTERNAL', message: 'Something went wrong.' });
      })
      .finally(() => {
        session.busy = false;
      });
  }

  // ---------------------------------------------------------------------------
  // Joining and transitions
  // ---------------------------------------------------------------------------

  private async onJoin(session: Session, msg: JoinMessage): Promise<void> {
    // SRS §3.2/§3.3: faculty and alumni are rejected from ALL rooms — and the
    // live world generally is a student space. Enforced here, not in any UI.
    if (session.role !== 'student') {
      this.send(session, {
        t: 'error',
        code: 'FORBIDDEN',
        message: 'The live space is only available to students.',
      });
      return;
    }
    if (session.map) {
      // Rejoining the current map (or a bare join) is a resync request.
      if (!msg.mapId || session.map.id === msg.mapId) {
        this.resync(session, session.map);
      } else {
        this.send(session, { t: 'error', code: 'ALREADY_JOINED', message: 'Use transition.' });
      }
      return;
    }
    if (msg.displayName) session.displayName = msg.displayName;
    if (msg.sprite) session.sprite = msg.sprite;

    // No mapId = "spawn me": last-active room if it still admits them, else Commons.
    const targetId = msg.mapId ?? (await this.spawnMapId(session.userId));
    const resolved = await this.resolveMap(targetId);
    if (!resolved) {
      this.send(session, { t: 'error', code: 'UNKNOWN_MAP', message: `No map '${targetId}'.` });
      return;
    }

    if (resolved.room) {
      const access = await this.checkAccess(session, resolved.room);
      if (access !== 'allow') {
        // Land them in the Commons so a denied direct entry still puts them in
        // the world; a knock policy starts the knock from there.
        const commons = await this.resolveMap(COMMONS_MAP_ID);
        if (commons) await this.enterMap(session, commons.world, null);
        if (access === 'knock') {
          await this.startKnock(session, resolved.room);
        } else {
          this.send(session, {
            t: 'error',
            code: 'ROOM_ACCESS_DENIED',
            message: 'This room is invite-only.',
          });
        }
        return;
      }
    }
    await this.enterMap(session, resolved.world, resolved.room);
  }

  private async onTransition(session: Session, msg: TransitionMessage): Promise<void> {
    const from = session.map;
    if (!from) {
      this.send(session, { t: 'error', code: 'NOT_JOINED', message: 'Join a map first.' });
      return;
    }
    if (from.id === msg.toMapId) {
      this.resync(session, from);
      return;
    }
    const resolved = await this.resolveMap(msg.toMapId);
    if (!resolved) {
      this.send(session, { t: 'error', code: 'UNKNOWN_MAP', message: `No map '${msg.toMapId}'.` });
      return;
    }
    if (resolved.room) {
      const access = await this.checkAccess(session, resolved.room);
      if (access === 'knock') {
        await this.startKnock(session, resolved.room);
        return;
      }
      if (access === 'deny') {
        // A crafted WebSocket message gets the same wall as the UI (Phase 4
        // acceptance): the server is the only gate.
        this.send(session, {
          t: 'error',
          code: 'ROOM_ACCESS_DENIED',
          message: 'This room is invite-only.',
        });
        return;
      }
    }
    await this.enterMap(session, resolved.world, resolved.room);
  }

  /** Resolve an instance id: static map, or a room instance from the store. */
  private async resolveMap(
    mapId: string,
  ): Promise<{ world: WorldMap; room: RoomRecord | null } | null> {
    if (STATIC_MAP_IDS.has(mapId)) {
      const world = instantiate(mapId, mapId);
      return world ? { world, room: null } : null;
    }
    const room = await this.store.getRoom(mapId);
    if (!room) return null;
    const world = instantiate(room.id, room.mapTemplate);
    return world ? { world, room } : null;
  }

  private async spawnMapId(userId: string): Promise<string> {
    const roomId = await this.store.lastActiveRoomId(userId);
    return roomId ?? COMMONS_MAP_ID;
  }

  private async checkAccess(
    session: Session,
    room: RoomRecord,
  ): Promise<'allow' | 'knock' | 'deny'> {
    // Members always enter their own rooms regardless of policy.
    if (await this.store.isMember(room.id, session.userId)) return 'allow';
    if (session.granted.has(room.id)) return 'allow';
    if (room.accessPolicy === 'open') return 'allow';
    if (room.accessPolicy === 'knock') return 'knock';
    return 'deny';
  }

  /**
   * Move the session into a map instance — used for both the first join and
   * every transition. The socket is NEVER torn down: leaving the old map and
   * entering the new one happen on the same connection (Phase 4's one-socket
   * rule; re-handshaking would make doors feel like page loads).
   */
  private async enterMap(session: Session, world: WorldMap, room: RoomRecord | null): Promise<void> {
    // One presence per user: supersede every other connection of this user.
    for (const other of [...this.all]) {
      if (other !== session && other.userId === session.userId) {
        void this.persistPosition(other);
        this.leaveMap(other);
        this.all.delete(other);
        other.socket.close(4000, 'superseded by a newer connection');
      }
    }

    const fromRoom = session.map !== null && !STATIC_MAP_IDS.has(session.map.id);
    if (session.map) {
      await this.persistPosition(session);
      this.leaveMap(session);
    }

    // Reconnects can race the old socket's close event; drop any committed
    // pair states so this connection receives its zones as fresh transitions.
    this.emitProximity(this.proximity.removeActor(world.id, session.userId));

    const position = await this.restorePosition(session, world, room);
    session.map = world;
    session.x = position.x;
    session.y = position.y;
    session.dir = position.dir;
    session.moving = false;

    let sessions = this.mapSessions.get(world.id);
    if (!sessions) {
      sessions = new Map();
      this.mapSessions.set(world.id, sessions);
    }
    sessions.set(session.userId, session);

    await this.store.setPresence(session.userId, world.id);

    this.send(session, this.snapshotOf(world));
    this.broadcast(world.id, { t: 'actorJoin', actor: toActor(session) }, session.userId);
    this.emitProximity(
      this.proximity.update(world.id, session.userId, this.positionsIn(world.id), Date.now()),
    );

    if (world.id === COMMONS_MAP_ID) {
      this.send(session, { t: 'doors', doors: await this.buildDoors() });
    }
    // Room occupancy changed → refresh every Commons door plaque.
    if (room || fromRoom) void this.broadcastDoors();
  }

  /** Where the session lands in a map: saved position if legal, else spawn. */
  private async restorePosition(
    session: Session,
    world: WorldMap,
    room: RoomRecord | null,
  ): Promise<LastPosition> {
    const saved = room
      ? await this.store.lastPosition(room.id, session.userId)
      : (this.staticPositions.get(`${world.id}:${session.userId}`) ?? null);
    if (saved && !isBlocked(world, saved.x, saved.y)) return saved;
    return { x: world.spawn.x, y: world.spawn.y, dir: 'down' };
  }

  /** Written on transition-out, leave and disconnect only — never per move. */
  private async persistPosition(session: Session): Promise<void> {
    const world = session.map;
    if (!world) return;
    const pos: LastPosition = { x: session.x, y: session.y, dir: session.dir };
    try {
      if (STATIC_MAP_IDS.has(world.id)) {
        this.staticPositions.set(`${world.id}:${session.userId}`, pos);
      } else {
        await this.store.saveLastPosition(world.id, session.userId, pos);
      }
    } catch (err) {
      session.log.warn({ err }, 'failed to persist last position');
    }
  }

  // ---------------------------------------------------------------------------
  // Doors (Commons plaques)
  // ---------------------------------------------------------------------------

  /** Door slots + which public room owns each + live occupancy. */
  private async buildDoors(): Promise<DoorInfo[]> {
    const publicRooms = await this.store.listPublicRooms();
    const bySlotKey = new Map(publicRooms.map((r) => [`${r.doorX},${r.doorY}`, r]));
    return COMMONS_DOOR_SLOTS.map((slot) => {
      const room = bySlotKey.get(`${slot.x},${slot.y}`);
      return {
        slot: slot.slot,
        x: slot.x,
        y: slot.y,
        ...(room
          ? {
              room: {
                roomId: room.id,
                roomName: room.name,
                accessPolicy: room.accessPolicy,
                occupancy: this.mapSessions.get(room.id)?.size ?? 0,
              },
            }
          : {}),
      };
    });
  }

  private async broadcastDoors(): Promise<void> {
    const commonsSessions = this.mapSessions.get(COMMONS_MAP_ID);
    if (!commonsSessions || commonsSessions.size === 0) return;
    try {
      const msg: ServerMessage = { t: 'doors', doors: await this.buildDoors() };
      for (const peer of commonsSessions.values()) this.send(peer, msg);
    } catch (err) {
      this.all.values().next().value?.log.warn({ err }, 'failed to broadcast doors');
    }
  }

  // ---------------------------------------------------------------------------
  // Knock flow
  // ---------------------------------------------------------------------------

  private async startKnock(session: Session, room: RoomRecord): Promise<void> {
    for (const pending of this.pendingKnocks.values()) {
      if (pending.requesterId === session.userId && pending.roomId === room.id) {
        this.send(session, {
          t: 'error',
          code: 'KNOCK_PENDING',
          message: 'You already knocked on this room.',
        });
        return;
      }
    }

    const requestId = await this.store.createAccessRequest(room.id, session.userId);
    const timer = setTimeout(() => {
      void this.resolveKnock(requestId, 'timeout', null);
    }, this.knockTimeoutMs);
    this.pendingKnocks.set(requestId, {
      requestId,
      roomId: room.id,
      roomName: room.name,
      requesterId: session.userId,
      timer,
    });

    // The requester needs the requestId to cancel; the waiting UI keys off this.
    this.send(session, { t: 'knockPending', requestId, roomId: room.id, roomName: room.name });

    // Live prompt to every ONLINE member, wherever they are in the world. A
    // room with zero members online simply lets the timeout do its job.
    const memberIds = new Set(await this.store.memberUserIds(room.id));
    const prompt: ServerMessage = {
      t: 'knock',
      requestId,
      roomId: room.id,
      roomName: room.name,
      requesterName: session.displayName,
    };
    for (const peer of this.all) {
      if (memberIds.has(peer.userId) && peer.userId !== session.userId) this.send(peer, prompt);
    }
    session.log.info({ roomId: room.id, requestId }, 'knock created');
  }

  private async onKnockRespond(session: Session, msg: KnockRespondMessage): Promise<void> {
    const pending = this.pendingKnocks.get(msg.requestId);
    if (!pending) return; // already answered, timed out, or bogus — nothing to do
    if (!(await this.store.isMember(pending.roomId, session.userId))) {
      this.send(session, {
        t: 'error',
        code: 'FORBIDDEN',
        message: 'Only members can answer a knock.',
      });
      return;
    }
    await this.resolveKnock(msg.requestId, msg.grant ? 'granted' : 'denied', session.userId);
  }

  private onKnockCancel(session: Session, msg: KnockCancelMessage): void {
    const pending = this.pendingKnocks.get(msg.requestId);
    if (!pending || pending.requesterId !== session.userId) return;
    void this.resolveKnock(msg.requestId, 'cancelled', null);
  }

  private cancelKnocksBy(userId: string, status: 'cancelled'): void {
    for (const pending of [...this.pendingKnocks.values()]) {
      if (pending.requesterId === userId) void this.resolveKnock(pending.requestId, status, null);
    }
  }

  /** Single exit point for a knock: first resolution wins, the rest no-op. */
  private async resolveKnock(
    requestId: string,
    outcome: 'granted' | 'denied' | 'timeout' | 'cancelled',
    resolvedBy: string | null,
  ): Promise<void> {
    const pending = this.pendingKnocks.get(requestId);
    if (!pending) return;
    this.pendingKnocks.delete(requestId);
    clearTimeout(pending.timer);

    // The audit row only distinguishes granted/denied; timeout and cancel are denials.
    await this.store.resolveAccessRequest(
      requestId,
      outcome === 'granted' ? 'granted' : 'denied',
      resolvedBy,
    );

    const result: ServerMessage = { t: 'knockResult', requestId, status: outcome };
    const requester = this.findSession(pending.requesterId);
    if (requester) this.send(requester, result);
    // Members see the outcome too, so open toasts dismiss everywhere.
    const memberIds = new Set(await this.store.memberUserIds(pending.roomId));
    for (const peer of this.all) {
      if (memberIds.has(peer.userId)) this.send(peer, result);
    }

    if (outcome === 'granted' && requester) {
      // Admission is for THIS session only. Walk them straight in.
      requester.granted.add(pending.roomId);
      const resolved = await this.resolveMap(pending.roomId);
      if (resolved && requester.map && !requester.busy) {
        await this.enterMap(requester, resolved.world, resolved.room);
      }
    }
  }

  private findSession(userId: string): Session | null {
    for (const s of this.all) {
      if (s.userId === userId) return s;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Movement, media, presence
  // ---------------------------------------------------------------------------

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
      // A room emptied or shrank → Commons plaques need fresh occupancy.
      if (!STATIC_MAP_IDS.has(world.id)) void this.broadcastDoors();
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
    return {
      t: 'snapshot',
      mapId: world.id,
      template: world.template,
      actors: this.actorsIn(world.id),
    };
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
    if (world.id === COMMONS_MAP_ID) {
      void this.buildDoors().then((doors) => this.send(session, { t: 'doors', doors }));
    }
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
