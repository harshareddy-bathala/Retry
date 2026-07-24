import Phaser from 'phaser';
import studioA from '@foundry/maps/studio_a.json';
import commons from '@foundry/maps/commons.json';
import tilesetUrl from '@foundry/maps/tilesets/placeholder.png';
import { TILE_SIZE, pixelToTile } from '@foundry/protocol';
import type {
  Actor,
  ActorMoveMessage,
  Dir,
  DoorInfo,
  ServerMessage,
  SnapshotMessage,
} from '@foundry/protocol';
import avatarUrl from '../assets/avatar.png';
import { avatarScreenPositions } from '../avatar-positions.js';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

// Both Tiled templates ship in the bundle; the server's snapshot names which
// one to render (mapId is the instance — a room uuid — template is the file).
const TEMPLATES: Record<string, unknown> = { studio_a: studioA, commons };

const TILES_KEY = 'tiles';
const AVATAR_KEY = 'avatar';

// SRS movement speed: 4 tiles/second. Arcade physics integrates velocity with
// delta time, so this is frame-rate independent by construction.
const WALK_SPEED = 4 * TILE_SIZE;
export const CAMERA_ZOOM = 2;

// Wire positions are the avatar's collision anchor (feet-box centre), in TILE
// units — the sprite centre would sit inside wall tiles when standing against
// them, and the server validates collision on the wire position.
const FEET_OFFSET_Y = 8;

// Send cadence and remote smoothing (rooms build plan Phase 2).
const MOVE_SEND_INTERVAL_MS = 50;
const INTERPOLATION_MS = 100;
const REMOTE_IDLE_TIMEOUT_MS = 200;

// Phase 4 door transition: 100ms out + 100ms in = the plan's 200ms fade.
const FADE_MS = 100;

const DIRS = ['down', 'left', 'right', 'up'] as const;
type Facing = (typeof DIRS)[number];

export type RoomSceneData = { userId: string; displayName: string };

type MoveKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

type Remote = {
  sprite: Phaser.GameObjects.Sprite;
  tag: Phaser.GameObjects.Container;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  dir: Dir;
  moving: boolean;
  lastUpdateAt: number;
};

type Interactable = {
  kind: 'whiteboard' | 'exit' | 'door';
  doorSlot: number | null;
  tiles: Array<{ x: number; y: number }>;
  hint: Phaser.GameObjects.Container;
};

export class RoomScene extends Phaser.Scene {
  private userId = '';
  private displayName = 'Explorer';
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: MoveKeys;
  private facing: Facing = 'down';
  private nameTag!: Phaser.GameObjects.Container;
  private remotes = new Map<string, Remote>();
  private wasMoving = false;
  private sinceLastSend = 0;

  // Multi-map world (Phase 4)
  private currentTemplate: string | null = null;
  private mapLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private collider: Phaser.Physics.Arcade.Collider | null = null;
  private interactables: Interactable[] = [];
  private doorVisuals: Phaser.GameObjects.GameObject[] = [];
  private doorsInfo: DoorInfo[] = [];
  private fading = false;
  private pendingSnapshot: SnapshotMessage | null = null;

  constructor() {
    super('room');
  }

  init(data: RoomSceneData): void {
    this.userId = data.userId;
    if (data.displayName) this.displayName = data.displayName;
  }

  preload(): void {
    // Map JSONs are bundled (the same files the server validates against), so
    // they go straight into the cache instead of through a URL load.
    for (const [key, data] of Object.entries(TEMPLATES)) {
      this.cache.tilemap.add(key, { format: Phaser.Tilemaps.Formats.TILED_JSON, data });
    }
    this.load.image(TILES_KEY, tilesetUrl);
    this.load.spritesheet(AVATAR_KEY, avatarUrl, { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    // Everything map-independent boots here; the world itself is built from
    // the first snapshot (the server decides where this user spawns).
    this.player = this.physics.add.sprite(0, 0, AVATAR_KEY, 0).setVisible(false);
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) throw new Error('player has no arcade body');
    this.playerBody = body;
    // Feet-box collision so the avatar's head can overlap wall tiles top-down style.
    this.playerBody.setSize(18, 12).setOffset(7, 18);

    DIRS.forEach((dir, row) => {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(AVATAR_KEY, {
          frames: [row * 4 + 1, row * 4 + 2, row * 4 + 3, row * 4 + 2],
        }),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: `idle-${dir}`,
        frames: [{ key: AVATAR_KEY, frame: row * 4 }],
      });
    });
    this.player.anims.play('idle-down');

    this.nameTag = this.buildPill(this.displayName, 0xffffff, '#2d2926');
    this.nameTag.setVisible(false);
    this.cameras.main.setZoom(CAMERA_ZOOM);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('keyboard input unavailable');
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as MoveKeys;
    // Event-driven interact key — polling JustDown misses fast taps.
    keyboard.on('keydown-E', () => {
      if (!this.currentTemplate) return;
      const near = this.nearestInteractable();
      if (near) this.activate(near);
    });

    const unsubscribe = roomEvents.on('net:server-message', (msg) => this.onServerMessage(msg));
    // While a panel holds focus, the scene surrenders the keyboard entirely —
    // "typing in chat never moves the avatar" (Phase 6 acceptance).
    const unsubscribePanel = roomEvents.on('panel:state', ({ open }) => {
      keyboard.enabled = !open;
      if (open && this.currentTemplate) {
        keyboard.resetKeys();
        this.playerBody.setVelocity(0, 0);
        this.wasMoving = false;
        this.sendMove(false);
      }
    });
    const cleanup = (): void => {
      unsubscribe();
      unsubscribePanel();
      avatarScreenPositions.clear();
    };
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);

    // The join snapshot may have arrived while assets were still loading —
    // ask for a fresh one now that this scene is listening.
    roomSocket.requestResync();
  }

  override update(_time: number, delta: number): void {
    if (!this.currentTemplate) return;

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    let vx = (right ? 1 : 0) - (left ? 1 : 0);
    let vy = (down ? 1 : 0) - (up ? 1 : 0);
    if (vx !== 0 && vy !== 0) {
      // Normalise so diagonal movement is not faster than cardinal.
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }
    // Local avatar renders from local input immediately (client-side
    // prediction) — never wait for server confirmation.
    this.playerBody.setVelocity(vx * WALK_SPEED, vy * WALK_SPEED);

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      this.facing = vy < 0 ? 'up' : vy > 0 ? 'down' : vx < 0 ? 'left' : 'right';
      this.player.anims.play(`walk-${this.facing}`, true);
    } else {
      this.player.anims.play(`idle-${this.facing}`, true);
    }

    // Fixed 50ms send tick while input is active, plus one final message when
    // input stops — never one per frame.
    this.sinceLastSend += delta;
    if (moving && this.sinceLastSend >= MOVE_SEND_INTERVAL_MS) {
      this.sendMove(true);
    } else if (!moving && this.wasMoving) {
      this.sendMove(false);
    }
    this.wasMoving = moving;

    this.nameTag.setPosition(Math.round(this.player.x), Math.round(this.player.y) - 26);
    this.updateRemotes(this.time.now);
    this.publishScreenPositions();
    this.updateInteractables();
  }

  // ---------------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------------

  private sendMove(moving: boolean): void {
    this.sinceLastSend = 0;
    roomSocket.send({
      t: 'move',
      x: round3(this.player.x / TILE_SIZE),
      y: round3((this.player.y + FEET_OFFSET_Y) / TILE_SIZE),
      dir: this.facing,
      moving,
    });
  }

  private onServerMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'snapshot':
        this.onSnapshot(msg);
        break;
      case 'actorJoin':
        if (msg.actor.userId !== this.userId) this.upsertRemote(msg.actor);
        break;
      case 'actorMove':
        this.onActorMove(msg);
        break;
      case 'actorLeave':
        this.removeRemote(msg.userId);
        break;
      case 'doors':
        this.doorsInfo = msg.doors;
        this.renderDoors();
        break;
      default:
        break;
    }
  }

  /**
   * Full authoritative state — join, reconnect, resync, or a door transition.
   * A template change swaps the tilemap in place behind a 200ms fade; the
   * Scene (and the socket beneath it) is never destroyed.
   */
  private onSnapshot(msg: SnapshotMessage): void {
    if (this.fading) {
      // A newer snapshot during the fade wins; applied when the fade lands.
      this.pendingSnapshot = msg;
      return;
    }
    if (msg.template === this.currentTemplate) {
      this.applySnapshot(msg);
      return;
    }
    if (this.currentTemplate === null) {
      // First world build: no fade, just appear.
      this.buildWorld(msg.template);
      this.applySnapshot(msg);
      return;
    }
    this.fading = true;
    this.pendingSnapshot = msg;
    this.cameras.main.fadeOut(FADE_MS, 23, 21, 18);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      const pending = this.pendingSnapshot;
      this.pendingSnapshot = null;
      this.fading = false;
      if (pending) {
        this.buildWorld(pending.template);
        this.applySnapshot(pending);
      }
      this.cameras.main.fadeIn(FADE_MS, 23, 21, 18);
    });
  }

  private applySnapshot(msg: SnapshotMessage): void {
    for (const userId of [...this.remotes.keys()]) this.removeRemote(userId);
    for (const actor of msg.actors) {
      if (actor.userId === this.userId) {
        this.playerBody.reset(actor.x * TILE_SIZE, actor.y * TILE_SIZE - FEET_OFFSET_Y);
      } else {
        this.upsertRemote(actor);
      }
    }
  }

  private onActorMove(msg: ActorMoveMessage): void {
    const remote = this.remotes.get(msg.userId);
    if (!remote) return;
    const now = this.time.now;
    // Interpolate from wherever the sprite currently is toward the new
    // position over 100ms. Never snap — snapping is what makes multiplayer
    // feel cheap.
    remote.fromX = remote.sprite.x;
    remote.fromY = remote.sprite.y;
    remote.toX = msg.x * TILE_SIZE;
    remote.toY = msg.y * TILE_SIZE - FEET_OFFSET_Y;
    remote.startedAt = now;
    remote.lastUpdateAt = now;
    remote.dir = msg.dir;
    remote.moving = msg.moving;
  }

  private upsertRemote(actor: Actor): void {
    this.removeRemote(actor.userId);
    const x = actor.x * TILE_SIZE;
    const y = actor.y * TILE_SIZE - FEET_OFFSET_Y;
    const row = DIRS.indexOf(actor.dir);
    const sprite = this.add.sprite(x, y, AVATAR_KEY, (row < 0 ? 0 : row) * 4);
    const tag = this.buildPill(actor.displayName, 0xffffff, '#2d2926');
    tag.setPosition(x, y - 26);
    this.remotes.set(actor.userId, {
      sprite,
      tag,
      fromX: x,
      fromY: y,
      toX: x,
      toY: y,
      startedAt: 0,
      dir: actor.dir,
      moving: actor.moving,
      lastUpdateAt: this.time.now,
    });
  }

  private removeRemote(userId: string): void {
    const remote = this.remotes.get(userId);
    if (!remote) return;
    remote.sprite.destroy();
    remote.tag.destroy();
    this.remotes.delete(userId);
    avatarScreenPositions.delete(userId);
  }

  /** Canvas-space avatar positions for the React bubble overlay (Phase 3). */
  private publishScreenPositions(): void {
    const camera = this.cameras.main;
    const write = (userId: string, worldX: number, worldY: number): void => {
      avatarScreenPositions.set(userId, {
        x: (worldX - camera.worldView.x) * camera.zoom,
        y: (worldY - camera.worldView.y) * camera.zoom,
      });
    };
    write(this.userId, this.player.x, this.player.y);
    for (const [userId, remote] of this.remotes) write(userId, remote.sprite.x, remote.sprite.y);
  }

  private updateRemotes(now: number): void {
    for (const remote of this.remotes.values()) {
      const t = Phaser.Math.Clamp((now - remote.startedAt) / INTERPOLATION_MS, 0, 1);
      const x = Phaser.Math.Linear(remote.fromX, remote.toX, t);
      const y = Phaser.Math.Linear(remote.fromY, remote.toY, t);
      remote.sprite.setPosition(x, y);
      remote.tag.setPosition(Math.round(x), Math.round(y) - 26);

      // Stop the walk cycle when updates dry up rather than looping in place.
      if (remote.moving && now - remote.lastUpdateAt > REMOTE_IDLE_TIMEOUT_MS) {
        remote.moving = false;
      }
      if (remote.moving) {
        remote.sprite.anims.play(`walk-${remote.dir}`, true);
      } else {
        remote.sprite.anims.play(`idle-${remote.dir}`, true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // World building (Phase 4: swap tilemaps in place, never destroy the Scene)
  // ---------------------------------------------------------------------------

  private buildWorld(template: string): void {
    // Tear down the previous map's objects; the player, remotes and camera
    // survive — they are repositioned by the snapshot that follows.
    if (this.collider) {
      this.collider.destroy();
      this.collider = null;
    }
    for (const layer of this.mapLayers) layer.destroy();
    this.mapLayers = [];
    for (const i of this.interactables) i.hint.destroy();
    this.interactables = [];
    this.clearDoorVisuals();

    const map = this.make.tilemap({ key: template });
    const tiles = map.addTilesetImage('placeholder', TILES_KEY);
    if (!tiles) throw new Error('tileset "placeholder" missing from map');

    const ground = map.createLayer('ground', tiles, 0, 0);
    const objects = map.createLayer('objects', tiles, 0, 0);
    const collision = map.createLayer('collision', tiles, 0, 0);
    if (!ground || !objects || !collision) throw new Error(`layers missing from map '${template}'`);
    collision.setVisible(false);
    // Map contract: any non-empty tile in 'collision' blocks movement.
    collision.setCollisionByExclusion([-1]);
    this.mapLayers = [ground, objects, collision];
    // Player renders above tiles.
    this.player.setDepth(1);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.setCollideWorldBounds(true);
    // Per-axis separation (wall sliding instead of sticking) is what arcade
    // physics colliders do; do not hand-roll collision here.
    this.collider = this.physics.add.collider(this.player, collision);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    camera.startFollow(this.player, true, 0.1, 0.1);

    this.collectInteractables(map);
    this.currentTemplate = template;
    this.player.setVisible(true);
    this.nameTag.setVisible(true);
    this.renderDoors();
  }

  /** Read objects with an `interactive` custom property from the map. */
  private collectInteractables(map: Phaser.Tilemaps.Tilemap): void {
    for (const obj of map.getObjectLayer('interactables')?.objects ?? []) {
      const properties = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
      const kindProp = properties.find((p) => p.name === 'interactive')?.value;
      if (kindProp !== 'whiteboard' && kindProp !== 'exit' && kindProp !== 'door') continue;
      const slotProp = properties.find((p) => p.name === 'door_slot')?.value;

      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      const width = obj.width ?? TILE_SIZE;
      const height = obj.height ?? TILE_SIZE;
      const tiles: Array<{ x: number; y: number }> = [];
      for (let ty = pixelToTile(y); ty <= pixelToTile(y + height - 1); ty++) {
        for (let tx = pixelToTile(x); tx <= pixelToTile(x + width - 1); tx++) {
          tiles.push({ x: tx, y: ty });
        }
      }
      const label = kindProp === 'exit' ? 'E — to Commons' : 'Press E';
      const hint = this.buildPill(label, 0x2d2926, '#f5f3ee');
      hint.setPosition(x + width / 2, kindProp === 'door' ? y + height + 10 : y - 8);
      hint.setVisible(false);
      hint.setDepth(11);
      this.interactables.push({
        kind: kindProp,
        doorSlot: typeof slotProp === 'number' ? slotProp : null,
        tiles,
        hint,
      });
    }
  }

  /** The interactable the player stands next to (Chebyshev distance ≤ 1). */
  private nearestInteractable(): Interactable | null {
    const tileX = pixelToTile(this.player.x);
    const tileY = pixelToTile(this.player.y + FEET_OFFSET_Y);
    for (const i of this.interactables) {
      if (i.tiles.some((t) => Math.max(Math.abs(t.x - tileX), Math.abs(t.y - tileY)) <= 1)) {
        return i;
      }
    }
    return null;
  }

  private updateInteractables(): void {
    const near = this.nearestInteractable();
    for (const i of this.interactables) {
      // A door with no assigned room is just wall dressing — no hint, no action.
      const usable = i.kind !== 'door' || this.doorFor(i.doorSlot)?.room !== undefined;
      i.hint.setVisible(i === near && usable);
    }
  }

  private activate(interactable: Interactable): void {
    switch (interactable.kind) {
      case 'whiteboard':
        roomEvents.emit('interact:whiteboard');
        break;
      case 'exit':
        roomSocket.send({ t: 'transition', toMapId: 'commons' });
        break;
      case 'door': {
        const room = this.doorFor(interactable.doorSlot)?.room;
        if (room) roomSocket.send({ t: 'transition', toMapId: room.roomId });
        break;
      }
    }
  }

  private doorFor(slot: number | null): DoorInfo | undefined {
    return slot === null ? undefined : this.doorsInfo.find((d) => d.slot === slot);
  }

  // ---------------------------------------------------------------------------
  // Commons doors: plaque (room name), live occupancy, lock glyph
  // ---------------------------------------------------------------------------

  private clearDoorVisuals(): void {
    for (const v of this.doorVisuals) v.destroy();
    this.doorVisuals = [];
  }

  private renderDoors(): void {
    if (this.currentTemplate !== 'commons') return;
    this.clearDoorVisuals();
    for (const door of this.doorsInfo) {
      const px = door.x * TILE_SIZE;
      const py = door.y * TILE_SIZE;
      const g = this.add.graphics();
      // Door leaf: assigned doors look warm and inviting, unassigned stay plain.
      g.fillStyle(door.room ? 0x8a5a33 : 0x4a4440, 1);
      g.fillRoundedRect(px + 6, py + 4, 2 * TILE_SIZE - 12, TILE_SIZE - 6, 4);
      g.fillStyle(door.room ? 0xd9b06c : 0x5d564f, 1);
      g.fillCircle(px + 2 * TILE_SIZE - 18, py + TILE_SIZE / 2 + 2, 2);
      g.setDepth(0.5);
      this.doorVisuals.push(g);

      if (door.room) {
        const lock = door.room.accessPolicy !== 'open' ? ' 🔒' : '';
        const plaque = this.buildPill(
          `${door.room.roomName} · ${door.room.occupancy}${lock}`,
          0xf5f3ee,
          '#2d2926',
        );
        plaque.setPosition(px + TILE_SIZE, py + TILE_SIZE + 12);
        plaque.setDepth(10);
        this.doorVisuals.push(plaque);
      }
    }
  }

  /**
   * Rounded pill with centred text. Text is rendered at device pixel ratio
   * times camera zoom so it stays crisp instead of scaling a low-res texture.
   */
  private buildPill(label: string, bgColor: number, textColor: string): Phaser.GameObjects.Container {
    const resolution = (window.devicePixelRatio || 1) * CAMERA_ZOOM;
    const text = this.add
      .text(0, 0, label, {
        fontFamily: '"IBM Plex Sans", sans-serif',
        fontSize: '9px',
        color: textColor,
        resolution,
      })
      .setOrigin(0.5);
    const width = Math.ceil(text.width) + 10;
    const height = Math.ceil(text.height) + 4;
    const bg = this.add.graphics();
    bg.fillStyle(bgColor, 0.95);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    return this.add.container(0, 0, [bg, text]).setDepth(10);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
