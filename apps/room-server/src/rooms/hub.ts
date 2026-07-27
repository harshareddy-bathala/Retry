import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import {
  parseClientMessage,
  type Actor,
  type BlueprintUpdateMessage,
  type AvatarMessage,
  type ChatMessage,
  type EmoteMessage,
  type ContextUpdateMessage,
  type Dir,
  type DoorInfo,
  type EvictReason,
  type JourneyEntry,
  type ProjectStage,
  type JoinMessage,
  type KanbanCard,
  type KanbanCreateMessage,
  type KanbanDeleteMessage,
  type KanbanMoveMessage,
  type KanbanRenameColumnMessage,
  type KanbanUpdateMessage,
  type KnockCancelMessage,
  type KnockRespondMessage,
  type MediaMessage,
  type MoveMessage,
  type ServerMessage,
  type TransitionMessage,
  type WatchMessage,
  type Zone,
} from '@retry/protocol';
import type { AuthedUser } from '../lib/auth.js';
import type { AvGrant, AvProvider } from '../av/livekit.js';
import { DEFAULT_SPRITE, EMOTE_KEYS, isAvatarSprite } from '@retry/maps';
import {
  COMMONS_DOOR_SLOTS,
  COMMONS_MAP_ID,
  STATIC_MAP_IDS,
  instantiate,
  isBlocked,
  type WorldMap,
} from '../world/maps.js';
import type {
  JourneyEntryRecord,
  KanbanCardRecord,
  LastPosition,
  RoomRecord,
  RoomStore,
} from '../world/store.js';
import { ProximityEngine, type PairChange } from './proximity.js';

const MOVES_PER_SECOND = 20;
const MAX_STEP_TILES = 2;
/**
 * Minimum gap between emotes from one connection. Slow enough that a bubble
 * cannot be used as a strobe, fast enough that a quick "yes" then "nice" still
 * reads as two reactions rather than one being swallowed.
 */
const EMOTE_INTERVAL_MS = 1_500;
/**
 * Minimum gap between typing notices. The client debounces too, but this is
 * the number that matters: a keystroke-per-frame client cannot be talked out
 * of flooding, only refused.
 */
const TYPING_INTERVAL_MS = 2_000;
// Settles pending proximity transitions when actors stop moving mid-debounce.
const PROXIMITY_TICK_MS = 100;
export const KNOCK_TIMEOUT_MS = 60_000;
/**
 * How often live presence is refreshed in the database (R3). Must stay well
 * under the API's 30 s presence window (NFR-REL-02) so a user standing still
 * for an hour never looks absent, while a socket that dies without a close
 * frame disappears from "who's here" within that window.
 */
const PRESENCE_HEARTBEAT_MS = 20_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What a Workspace watcher receives from a room's broadcast channel (R4).
 *
 * Deliberately not everything: movement and proximity are the highest-volume
 * messages on the wire and mean nothing to a page with no canvas, so they stop
 * at the map boundary. Panels, workspace edits and who-is-in-the-room do cross.
 */
const WATCHER_EVENTS: ReadonlySet<ServerMessage['t']> = new Set([
  'chatMessage',
  'kanbanState',
  'kanbanCard',
  'kanbanCardRemoved',
  'kanbanColumn',
  'workspaceState',
  'contextState',
  'blueprintField',
  'journeyEntry',
  'actorJoin',
  'actorLeave',
  // A Workspace has no avatar to draw a bubble over, but it does have the chat
  // panel, and "Ana is typing…" is exactly as useful there.
  'actorTyping',
]);

const STAGE_LABEL: Record<ProjectStage, string> = {
  ideation: 'Ideation',
  planning: 'Planning',
  building: 'Building',
  testing: 'Testing',
  complete: 'Complete',
};

const BLUEPRINT_LABEL = {
  problem: 'What problem are we solving',
  audience: 'Who experiences this problem',
  existing: 'What already exists',
} as const;

type Session = {
  socket: WebSocket;
  log: FastifyBaseLogger;
  userId: string;
  role: string;
  displayName: string;
  sprite: string;
  /** Whether the user has ever saved a character (drives the creator prompt). */
  avatarChosen: boolean;
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
  /**
   * The room whose Workspace this session is subscribed to, if any (R4). A
   * session watches at most one room: the Workspace is one page. Watching is
   * orthogonal to standing in a map — a member can do either, both, or neither.
   */
  watching: string | null;
  /**
   * Last send time per rate-limited message kind ('emote', 'typing'). Kept per
   * SESSION rather than per user: the limit protects the fan-out, and a second
   * tab is a second fan-out.
   */
  lastSentAt: Map<string, number>;
  /** Last AV grant, so a resync re-sends it without minting a new token. */
  avGrant: { mapId: string; grant: AvGrant } | null;
  /** First avToken timestamp — participant-time accounting (SRS §3.4). */
  avStartedAt: number | null;
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
  /** LiveKit orchestration; absent = AV disabled, placeholder bubbles remain. */
  av?: AvProvider;
  /** For work that belongs to no session (timers, internal calls). */
  logger?: FastifyBaseLogger;
};

// Server-authoritative world state (rooms build plan Phases 2–4). All positions
// are TILE units. Identity comes exclusively from the verified JWT — nothing
// in a message body can speak for another user. Phase 4: multiple map
// instances behind ONE socket per user; the connection is never torn down on a
// door, the session simply moves between map registries.
export class RoomHub {
  private mapSessions = new Map<string, Map<string, Session>>();
  /** roomId → sessions subscribed to its Workspace without standing in it (R4). */
  private watchers = new Map<string, Set<Session>>();
  private all = new Set<Session>();
  private proximity = new ProximityEngine();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private presenceTicker: ReturnType<typeof setInterval> | null = null;
  /** Ephemeral positions for static maps (commons/sandbox) — never persisted. */
  private staticPositions = new Map<string, LastPosition>();
  private pendingKnocks = new Map<string, PendingKnock>();
  private store: RoomStore;
  private knockTimeoutMs: number;
  private av: AvProvider | null;
  private log: FastifyBaseLogger | null;
  /** Cumulative live-space participant seconds — free-tier usage monitoring. */
  avSecondsTotal = 0;

  constructor(deps: RoomHubDeps) {
    this.store = deps.store;
    this.knockTimeoutMs = deps.knockTimeoutMs ?? KNOCK_TIMEOUT_MS;
    this.av = deps.av ?? null;
    this.log = deps.logger ?? null;
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
    this.presenceTicker = setInterval(() => void this.heartbeatPresence(), PRESENCE_HEARTBEAT_MS);
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.presenceTicker) {
      clearInterval(this.presenceTicker);
      this.presenceTicker = null;
    }
    for (const knock of this.pendingKnocks.values()) clearTimeout(knock.timer);
    this.pendingKnocks.clear();
  }

  /**
   * One UPDATE for everyone currently standing in a map. This is what makes the
   * REST API's "present members" true; it overwrites a single cell per
   * membership row and appends nothing, so no attendance history accumulates
   * (SRS line 301).
   */
  private async heartbeatPresence(): Promise<void> {
    const userIds = [...new Set([...this.all].filter((s) => s.map).map((s) => s.userId))];
    if (userIds.length === 0) return;
    try {
      await this.store.touchPresence(userIds);
    } catch (err: unknown) {
      // Presence going stale is cosmetic; the world keeps running.
      this.log?.warn({ err }, 'presence heartbeat failed');
    }
  }

  /** Fire-and-forget room activity bump for the room list's ordering. */
  private touchRoom(roomId: string): void {
    void this.store.bumpActivity(roomId).catch((err: unknown) => {
      this.log?.warn({ err, roomId }, 'activity bump failed');
    });
  }

  /**
   * Walk users out of a room's live map (R3). Called by the API over the
   * internal HTTP channel when a membership changes, because a removal that
   * only lands in Postgres leaves the removed member standing in the room.
   *
   * They are moved to the Commons rather than disconnected: the socket is the
   * user's whole session, and killing it would look like a crash.
   */
  async evict(
    roomId: string,
    target: { userIds?: string[]; except?: string[] },
    reason: EvictReason,
  ): Promise<number> {
    // Watchers hold the room's Workspace open with no avatar; losing access
    // has to close that too, or a removed member keeps reading the chat.
    const affected = new Set([
      ...(this.mapSessions.get(roomId)?.values() ?? []),
      ...(this.watchers.get(roomId) ?? []),
    ]);
    const wanted = target.userIds ? new Set(target.userIds) : null;
    const spared = target.except ? new Set(target.except) : null;
    const targets = [...affected].filter(
      (s) => (wanted ? wanted.has(s.userId) : true) && !spared?.has(s.userId),
    );
    if (targets.length === 0) return 0;

    const commons = await this.resolveMap(COMMONS_MAP_ID);
    for (const session of targets) {
      // A knock grant was permission to be in a room they have now lost.
      session.granted.delete(roomId);
      this.send(session, { t: 'evicted', roomId, reason });
      if (session.watching === roomId) this.stopWatching(session);
      if (session.map?.id === roomId) {
        if (commons) await this.enterMap(session, commons.world, null);
        else this.leaveMap(session);
      }
      session.log.info({ userId: session.userId, roomId, reason }, 'evicted from room');
    }
    return targets.length;
  }

  /**
   * Rebuild and push the Commons door plaques. Public because the API triggers
   * it after a visibility change: a room that just went public has a door
   * nobody in the Commons can see until the plaques are rebuilt.
   */
  async refreshDoors(): Promise<void> {
    await this.broadcastDoors();
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
      avatarChosen: false,
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
      watching: null,
      lastSentAt: new Map(),
      avGrant: null,
      avStartedAt: null,
    };
    this.all.add(session);
    log.info({ userId: user.userId }, 'ws connected');

    socket.on('message', (data: Buffer) => this.onMessage(session, data));
    socket.on('close', () => {
      if (session.avStartedAt !== null) {
        const seconds = Math.round((Date.now() - session.avStartedAt) / 1000);
        this.avSecondsTotal += seconds;
        // Aggregate duration only — never a session/attendance record.
        log.info(
          { userId: session.userId, seconds, totalSeconds: this.avSecondsTotal },
          'av participant time',
        );
      }
      void this.persistPosition(session);
      this.leaveMap(session);
      this.stopWatching(session);
      this.all.delete(session);
      // Static-map positions are for within-session door round-trips only —
      // a fresh connection starts at the spawn (rooms restore from the store).
      // Guarded by "no other socket for this user" so a supersede (which closes
      // the OLD socket after the new one has entered) does not wipe the live
      // connection's presence.
      if (!this.findSession(session.userId)) {
        for (const mapId of STATIC_MAP_IDS) {
          this.staticPositions.delete(`${mapId}:${session.userId}`);
        }
        void this.store.clearPresence(session.userId).catch((err: unknown) => {
          log.warn({ err, userId: session.userId }, 'clearing presence failed');
        });
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
      case 'ping':
        // Cheapest possible handler, and deliberately before everything else:
        // liveness must keep answering even while a join is in flight.
        this.send(session, { t: 'pong' });
        break;
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
        void this.onChat(session, parsed.message).catch((err: unknown) => {
          session.log.error({ err }, 'chat handler failed');
        });
        break;
      case 'emote':
        this.onEmote(session, parsed.message);
        break;
      case 'typing':
        this.onTyping(session);
        break;
      case 'kanbanCreate':
      case 'kanbanUpdate':
      case 'kanbanMove':
      case 'kanbanDelete':
      case 'kanbanRenameColumn':
        void this.onKanban(session, parsed.message).catch((err: unknown) => {
          session.log.error({ err }, 'kanban handler failed');
        });
        break;
      case 'watch':
        this.runExclusive(session, parsed.message, (msg) => this.onWatch(session, msg));
        break;
      case 'unwatch':
        this.stopWatching(session);
        break;
      case 'avatar':
        void this.onAvatar(session, parsed.message).catch((err: unknown) => {
          session.log.error({ err }, 'avatar handler failed');
        });
        break;
      case 'contextUpdate':
        void this.onContextUpdate(session, parsed.message).catch((err: unknown) => {
          session.log.error({ err }, 'context handler failed');
        });
        break;
      case 'blueprintUpdate':
        void this.onBlueprintUpdate(session, parsed.message).catch((err: unknown) => {
          session.log.error({ err }, 'blueprint handler failed');
        });
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
    // The client's sprite is a HINT, not a fact: it used to be written straight
    // onto the session, so anyone could walk around as any string they liked.
    // Every layer id is validated here; the authoritative value is resolved
    // from the user's stored character on entry.
    if (isAvatarSprite(msg.sprite)) session.sprite = msg.sprite;

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
    // One AVATAR per user: supersede every other connection of this user that
    // is standing on a map. A watch-only session (the Workspace, R4) has no
    // avatar to duplicate, so opening the Live Space in a second tab must not
    // tear down the Workspace you left open in the first.
    for (const other of [...this.all]) {
      if (other !== session && other.userId === session.userId && other.map !== null) {
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

    // Before the snapshot: the sprite has to be right in the actorJoin that
    // follows, or every peer renders a placeholder and then a correction.
    await this.resolveAvatar(session, world.id);
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

    this.pushAvToken(session, world);
    if (room) this.pushKanbanState(session, room.id);
  }

  /**
   * Decide which of the six presets this session walks around as, and tell the
   * client whether the student has ever actually chosen (FR-ROOM-24). Stored
   * per room, because a team room is a place you have a look in; the Commons
   * is a corridor, so it borrows your most recent pick.
   */
  private async resolveAvatar(session: Session, mapId: string): Promise<void> {
    let stored: string | null = null;
    try {
      stored = await this.store.avatarFor(session.userId);
    } catch (err: unknown) {
      session.log.warn({ err }, 'avatar lookup failed; using the default');
    }
    // A stored value that no longer decodes (a catalogue entry was retired —
    // which the catalogue's contract forbids, but defend anyway) counts as
    // "not chosen": they get the default and the creator opens.
    const chosen = isAvatarSprite(stored);
    session.sprite = isAvatarSprite(stored) ? stored : DEFAULT_SPRITE;
    session.avatarChosen = chosen;
    this.send(session, { t: 'avatarState', mapId, sprite: session.sprite, chosen });
  }

  private async onAvatar(session: Session, msg: AvatarMessage): Promise<void> {
    if (!isAvatarSprite(msg.sprite)) {
      session.log.warn({ sprite: msg.sprite }, 'rejected invalid avatar selection');
      return;
    }
    session.sprite = msg.sprite;
    session.avatarChosen = true;
    await this.store.setAvatar(session.userId, msg.sprite);
    const mapId = session.map?.id;
    if (!mapId) return;
    this.send(session, { t: 'avatarState', mapId, sprite: msg.sprite, chosen: true });
    // A changed character is an actor change: re-announce rather than inventing
    // a second event nobody else would know to listen for.
    this.broadcast(mapId, { t: 'actorJoin', actor: toActor(session) }, session.userId);
  }

  /**
   * Mint and push LiveKit credentials for the map just entered (Phase 5).
   * Still runs detached even though minting is now local JWT signing with no
   * network call: entry must never depend on the AV layer, so a provider that
   * throws for any reason degrades to placeholder bubbles instead of blocking
   * the door.
   */
  private pushAvToken(session: Session, world: WorldMap): void {
    const av = this.av;
    if (!av) return;
    av.grantFor(world.id, session.userId, session.displayName)
      .then((grant) => {
        // The user may have walked through another door while we minted.
        if (session.map?.id !== world.id) return;
        session.avGrant = { mapId: world.id, grant };
        if (session.avStartedAt === null) session.avStartedAt = Date.now();
        this.send(session, {
          t: 'avToken',
          mapId: world.id,
          serverUrl: grant.serverUrl,
          room: grant.room,
          token: grant.token,
        });
      })
      .catch((err: unknown) => {
        session.log.warn({ err, mapId: world.id }, 'av grant failed; AV off for this entry');
      });
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
  // Workspace (R4): the room without the map
  // ---------------------------------------------------------------------------

  /**
   * Subscribe a member to a room's panel channel with no actor, no proximity
   * and no AV. This is what makes a room usable when nobody else is online:
   * the Workspace reuses the same socket and the same panel components as the
   * Live Space, so chat, the board and the Blueprint are live in both views
   * (FR-ROOM-33, FR-ROOM-10) without a second transport.
   */
  private async onWatch(session: Session, msg: WatchMessage): Promise<void> {
    if (session.role !== 'student') {
      this.send(session, {
        t: 'error',
        code: 'FORBIDDEN',
        message: 'Rooms are a student space.',
      });
      return;
    }
    if (!(await this.store.isMember(msg.roomId, session.userId))) {
      this.send(session, {
        t: 'error',
        code: 'FORBIDDEN',
        message: 'Only room members can open this workspace.',
      });
      return;
    }
    if (msg.displayName) session.displayName = msg.displayName;
    this.stopWatching(session);
    session.watching = msg.roomId;
    let set = this.watchers.get(msg.roomId);
    if (!set) {
      set = new Set();
      this.watchers.set(msg.roomId, set);
    }
    set.add(session);

    await this.pushWorkspaceState(session, msg.roomId);
    this.pushKanbanState(session, msg.roomId);
  }

  private stopWatching(session: Session): void {
    const roomId = session.watching;
    if (!roomId) return;
    session.watching = null;
    const set = this.watchers.get(roomId);
    if (!set) return;
    set.delete(session);
    if (set.size === 0) this.watchers.delete(roomId);
  }

  private async pushWorkspaceState(session: Session, roomId: string): Promise<void> {
    const workspace = await this.store.workspace(roomId);
    if (!workspace) {
      this.send(session, { t: 'error', code: 'UNKNOWN_MAP', message: 'No such room.' });
      return;
    }
    if (session.watching !== roomId) return; // moved on while loading
    this.send(session, {
      t: 'workspaceState',
      roomId,
      name: workspace.name,
      stage: workspace.stage,
      domainTag: workspace.domainTag,
      blueprint: workspace.blueprint,
      journey: await this.journeyWithRollup(roomId, workspace.journey),
      present: this.actorsIn(roomId).map((a) => ({
        userId: a.userId,
        displayName: a.displayName,
      })),
    });
  }

  /**
   * Stored entries plus the weekly Done count (FR-ROOM-17), which is computed
   * here rather than stored: a card can move out of Done after the fact, and a
   * frozen row would keep claiming otherwise.
   */
  private async journeyWithRollup(
    roomId: string,
    stored: JourneyEntryRecord[],
  ): Promise<JourneyEntry[]> {
    const entries: JourneyEntry[] = stored.map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      createdAt: e.createdAt.toISOString(),
    }));
    const since = new Date(Date.now() - WEEK_MS);
    const done = await this.store.doneSince(roomId, since).catch(() => 0);
    if (done > 0) {
      entries.push({
        id: `weekly-done-${since.toISOString().slice(0, 10)}`,
        kind: 'weekly_done',
        body: `This week — ${done} ${done === 1 ? 'task' : 'tasks'} in Done`,
        createdAt: new Date().toISOString(),
      });
    }
    return entries;
  }

  private async onContextUpdate(session: Session, msg: ContextUpdateMessage): Promise<void> {
    const roomId = this.roomIdOf(session);
    if (!roomId) return;
    if (!(await this.requireMember(session, roomId, 'Only room members can edit this room.'))) {
      return;
    }
    const before = await this.store.workspace(roomId);
    await this.store.updateContext(roomId, {
      ...(msg.stage !== undefined ? { stage: msg.stage } : {}),
      ...(msg.domainTag !== undefined ? { domainTag: msg.domainTag } : {}),
    });
    this.touchRoom(roomId);

    const after = await this.store.workspace(roomId);
    if (!after) return;
    this.broadcast(roomId, {
      t: 'contextState',
      roomId,
      stage: after.stage,
      domainTag: after.domainTag,
    });
    // A stage change is a milestone; picking a domain tag is not.
    if (before && before.stage !== after.stage) {
      await this.appendJourney(roomId, 'stage_change', `Stage moved to ${STAGE_LABEL[after.stage]}`);
    }
  }

  private async onBlueprintUpdate(
    session: Session,
    msg: BlueprintUpdateMessage,
  ): Promise<void> {
    const roomId = this.roomIdOf(session);
    if (!roomId) return;
    if (!(await this.requireMember(session, roomId, 'Only room members can edit the blueprint.'))) {
      return;
    }
    // Free text, never validated (FR-ROOM-11) — an empty value is a real
    // answer meaning "we cleared this", so only control characters are removed.
    const value = sanitizeText(msg.value);
    const { firstEdit } = await this.store.saveBlueprintField(
      roomId,
      msg.field,
      value,
      session.userId,
    );
    this.touchRoom(roomId);
    this.broadcast(roomId, {
      t: 'blueprintField',
      field: msg.field,
      value,
      editedBy: session.userId,
      editedByName: session.displayName,
      at: new Date().toISOString(),
    });
    if (firstEdit && value.length > 0) {
      await this.appendJourney(
        roomId,
        'blueprint_first_edit',
        `${BLUEPRINT_LABEL[msg.field]}: ${value.length > 140 ? `${value.slice(0, 140)}…` : value}`,
      );
    }
  }

  private async appendJourney(
    roomId: string,
    kind: 'stage_change' | 'blueprint_first_edit',
    body: string,
  ): Promise<void> {
    const entry = await this.store.addJourneyEntry(roomId, kind, body);
    this.broadcast(roomId, {
      t: 'journeyEntry',
      entry: {
        id: entry.id,
        kind: entry.kind,
        body: entry.body,
        createdAt: entry.createdAt.toISOString(),
      },
    });
  }

  private async requireMember(
    session: Session,
    roomId: string,
    message: string,
  ): Promise<boolean> {
    if (await this.store.isMember(roomId, session.userId)) return true;
    this.send(session, { t: 'error', code: 'FORBIDDEN', message });
    return false;
  }

  // ---------------------------------------------------------------------------
  // Persistent panels (Phase 6): chat + kanban over the same socket
  // ---------------------------------------------------------------------------

  /**
   * The room this session is acting on: the room instance it is standing in,
   * or — for a Workspace with no avatar — the room it is watching. Static maps
   * are corridors and own nothing.
   */
  private roomIdOf(session: Session): string | null {
    const mapId = session.map?.id;
    if (mapId && !STATIC_MAP_IDS.has(mapId)) return mapId;
    return session.watching;
  }

  private async onChat(session: Session, msg: ChatMessage): Promise<void> {
    // Plain text only (FR-ROOM-35): sanitise on write — control chars out,
    // whitespace trimmed; the client renders as text nodes (NFR-SEC-04).
    const body = sanitizeText(msg.body);
    if (body.length === 0) return;

    // Speech needs an avatar, not a room. The Commons keeps no chat log, so it
    // is refused a room-scoped message — but it is the atrium where people
    // actually run into each other, and a hub where you cannot say hello is
    // not a hub. So the scope decides the requirement, not the map.
    if (msg.scope === 'nearby') {
      this.sayNearby(session, body);
      return;
    }

    const roomId = this.roomIdOf(session);
    if (!roomId) {
      session.log.debug('chat dropped: not inside a room instance');
      return;
    }
    const record = await this.store.appendMessage(roomId, session.userId, body);
    this.touchRoom(roomId);
    this.broadcast(roomId, {
      t: 'chatMessage',
      id: record.id,
      userId: session.userId,
      displayName: session.displayName,
      body: record.body,
      createdAt: record.createdAt.toISOString(),
      scope: 'room',
    });
  }

  /**
   * Speech: delivered only to the people the proximity engine already says are
   * close or near, and never persisted. Reuses the SAME zone state that drives
   * the audio bubbles, so what you can hear and what you can read agree with
   * each other by construction rather than by two rules that have to be kept
   * in step.
   *
   * A watcher (Workspace, no avatar) is on nobody's proximity list and hears
   * nothing — which is right: they are not in the room, they are reading it.
   */
  private sayNearby(session: Session, body: string): void {
    const map = session.map;
    if (!map) return;
    const sessions = this.mapSessions.get(map.id);
    if (!sessions) return;
    const msg: ServerMessage = {
      t: 'chatMessage',
      // Session-scoped: nothing persists this, and the client only needs it as
      // a React key for the few seconds the bubble is up.
      id: `nearby-${session.userId}-${Date.now()}`,
      userId: session.userId,
      displayName: session.displayName,
      body,
      createdAt: new Date().toISOString(),
      scope: 'nearby',
    };
    // The speaker always sees their own words.
    this.send(session, msg);
    for (const { userId } of this.proximity.zonesFor(map.id, session.userId)) {
      const peer = sessions.get(userId);
      if (peer) this.send(peer, msg);
    }
  }

  /**
   * An emote: a bubble over a head for a few seconds. The key is whitelisted
   * against the built catalogue — the same hole `sprite` had, where any client
   * could broadcast any string and every other client would try to render it.
   */
  private onEmote(session: Session, msg: EmoteMessage): void {
    const mapId = session.map?.id;
    if (!mapId) return;
    if (!EMOTE_KEYS.includes(msg.key)) {
      session.log.warn({ key: msg.key }, 'dropped emote: unknown key');
      return;
    }
    if (!this.allow(session, 'emote', EMOTE_INTERVAL_MS)) return;
    this.broadcast(mapId, { t: 'actorEmote', userId: session.userId, key: msg.key });
  }

  /**
   * "Someone is typing." Broadcast to the ROOM channel rather than the map, so
   * a Workspace with no avatar sees it in the chat panel too.
   *
   * Rate-limited here and not only on the client: this fires on keystrokes,
   * and a client that debounces badly — or does not debounce at all — would
   * otherwise turn every message into a hundred broadcasts to every member.
   */
  private onTyping(session: Session): void {
    // Wherever you are, not only inside a room. The Commons is a corridor and
    // keeps no chat log, but you can still SPEAK to the people standing next
    // to you there — so "Ana is typing" has to work there too, or the atrium
    // is the one place where someone answers you out of nowhere.
    const channel = this.roomIdOf(session) ?? session.map?.id;
    if (!channel) return;
    if (!this.allow(session, 'typing', TYPING_INTERVAL_MS)) return;
    this.broadcast(
      channel,
      { t: 'actorTyping', userId: session.userId, displayName: session.displayName },
      session.userId,
    );
  }

  /**
   * Per-session, per-kind minimum interval. Silent drop, like the move cap:
   * an error reply would itself be a channel worth flooding.
   */
  private allow(session: Session, kind: string, intervalMs: number): boolean {
    const now = Date.now();
    const last = session.lastSentAt.get(kind) ?? 0;
    if (now - last < intervalMs) return false;
    session.lastSentAt.set(kind, now);
    return true;
  }

  private async onKanban(
    session: Session,
    msg:
      | KanbanCreateMessage
      | KanbanUpdateMessage
      | KanbanMoveMessage
      | KanbanDeleteMessage
      | KanbanRenameColumnMessage,
  ): Promise<void> {
    const roomId = this.roomIdOf(session);
    if (!roomId) return;
    // FR-ROOM-18/19: any MEMBER may mutate the board; visitors see it read-only.
    if (!(await this.store.isMember(roomId, session.userId))) {
      this.send(session, {
        t: 'error',
        code: 'FORBIDDEN',
        message: 'Only room members can edit the board.',
      });
      return;
    }
    // Any board mutation counts as the room being worked in (FR-ROOM-06).
    this.touchRoom(roomId);
    switch (msg.t) {
      case 'kanbanCreate': {
        const title = sanitizeText(msg.title);
        if (!title) return;
        const card = await this.store.createCard(roomId, msg.column, title);
        this.broadcast(roomId, { t: 'kanbanCard', card: toKanbanCard(card) });
        break;
      }
      case 'kanbanUpdate': {
        const card = await this.store.updateCard(roomId, msg.cardId, {
          ...(msg.title !== undefined ? { title: sanitizeText(msg.title) } : {}),
          ...(msg.description !== undefined
            ? { description: msg.description === null ? null : sanitizeText(msg.description) }
            : {}),
          ...(msg.moveNote !== undefined
            ? { moveNote: msg.moveNote === null ? null : sanitizeText(msg.moveNote) }
            : {}),
        });
        if (card) this.broadcast(roomId, { t: 'kanbanCard', card: toKanbanCard(card) });
        break;
      }
      case 'kanbanMove': {
        const card = await this.store.moveCard(roomId, msg.cardId, msg.column, msg.position);
        if (card) this.broadcast(roomId, { t: 'kanbanCard', card: toKanbanCard(card) });
        break;
      }
      case 'kanbanDelete': {
        if (await this.store.deleteCard(roomId, msg.cardId)) {
          this.broadcast(roomId, { t: 'kanbanCardRemoved', cardId: msg.cardId });
        }
        break;
      }
      case 'kanbanRenameColumn': {
        const label = sanitizeText(msg.label);
        if (!label) return;
        await this.store.renameColumn(roomId, msg.column, label);
        this.broadcast(roomId, { t: 'kanbanColumn', column: { key: msg.column, label } });
        break;
      }
    }
  }

  /** Board snapshot for a session that just entered a room — by door or by watch. */
  private pushKanbanState(session: Session, roomId: string): void {
    this.store
      .kanbanBoard(roomId)
      .then((board) => {
        // Moved on while loading. A watcher has no map, so both bindings count.
        if (session.map?.id !== roomId && session.watching !== roomId) return;
        this.send(session, {
          t: 'kanbanState',
          columns: board.columns,
          cards: board.cards.map(toKanbanCard),
        });
      })
      .catch((err: unknown) => session.log.warn({ err }, 'kanban state load failed'));
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
    // avatarState is sent once on join, but the scene (and the creator) mount
    // lazily and can subscribe after it has passed — the same race the
    // snapshot and avToken have. Re-send the cached state with every resync
    // so a reload always learns its own character.
    this.send(session, {
      t: 'avatarState',
      mapId: world.id,
      sprite: session.sprite,
      chosen: session.avatarChosen,
    });
    const zones = this.proximity.zonesFor(world.id, session.userId);
    if (zones.length > 0) this.send(session, { t: 'proximity', pairs: zones });
    if (world.id === COMMONS_MAP_ID) {
      void this.buildDoors().then((doors) => this.send(session, { t: 'doors', doors }));
    }
    // The initial avToken can arrive before the client's AV layer subscribes
    // (same race the snapshot has) — re-send the cached grant, no re-mint.
    if (session.avGrant?.mapId === world.id) {
      this.send(session, {
        t: 'avToken',
        mapId: world.id,
        serverUrl: session.avGrant.grant.serverUrl,
        room: session.avGrant.grant.room,
        token: session.avGrant.grant.token,
      });
    }
  }

  /**
   * The single fan-out point for a room. Reaches everyone standing in the map
   * AND, for the subset of events a Workspace cares about, everyone watching it
   * (R4). Keeping this as one choke point is also what keeps the deferred
   * Redis multi-node work a contained change.
   */
  private broadcast(mapId: string, msg: ServerMessage, exceptUserId?: string): void {
    const payload = JSON.stringify(msg);
    const delivered = new Set<Session>();
    for (const peer of this.mapSessions.get(mapId)?.values() ?? []) {
      if (peer.userId === exceptUserId) continue;
      delivered.add(peer);
      if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(payload);
    }
    if (!WATCHER_EVENTS.has(msg.t)) return;
    for (const watcher of this.watchers.get(mapId) ?? []) {
      // A user with the Workspace open in one tab and the map in another holds
      // two sessions; both should hear it, and neither twice.
      if (watcher.userId === exceptUserId || delivered.has(watcher)) continue;
      if (watcher.socket.readyState === watcher.socket.OPEN) watcher.socket.send(payload);
    }
  }

  private send(session: Session, msg: ServerMessage): void {
    if (session.socket.readyState === session.socket.OPEN) {
      session.socket.send(JSON.stringify(msg));
    }
  }
}

function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
}

function toKanbanCard(record: KanbanCardRecord): KanbanCard {
  return {
    id: record.id,
    column: record.column,
    title: record.title,
    description: record.description,
    assigneeId: record.assigneeId,
    moveNote: record.moveNote,
    position: record.position,
    createdAt: record.createdAt.toISOString(),
  };
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
