import Phaser from 'phaser';
import studioA from '@retry/maps/studio_a.json';
import commons from '@retry/maps/commons.json';
import tilesetUrl from '@retry/maps/tilesets/retry.png';
import { AVATARS, DEFAULT_AVATAR } from '@retry/maps';
import makerUrl from '@retry/maps/avatars/maker.png';
import plannerUrl from '@retry/maps/avatars/planner.png';
import nightowlUrl from '@retry/maps/avatars/nightowl.png';
import explorerUrl from '@retry/maps/avatars/explorer.png';
import tinkererUrl from '@retry/maps/avatars/tinkerer.png';
import connectorUrl from '@retry/maps/avatars/connector.png';
import { TILE_SIZE, pixelToTile } from '@retry/protocol';
import type {
  Actor,
  ActorMoveMessage,
  Dir,
  DoorInfo,
  ServerMessage,
  SnapshotMessage,
} from '@retry/protocol';
import { avatarScreenPositions } from '../avatar-positions.js';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

// Both Tiled templates ship in the bundle; the server's snapshot names which
// one to render (mapId is the instance — a room uuid — template is the file).
const TEMPLATES: Record<string, unknown> = { studio_a: studioA, commons };

const TILES_KEY = 'tiles';

// One sheet per preset (R5). Keyed by the same string the server stores and
// the wire carries, so an actor's `sprite` IS its texture key.
const AVATAR_URLS: Record<string, string> = {
  maker: makerUrl,
  planner: plannerUrl,
  nightowl: nightowlUrl,
  explorer: explorerUrl,
  tinkerer: tinkererUrl,
  connector: connectorUrl,
};
const textureFor = (sprite: string): string =>
  `avatar-${sprite in AVATAR_URLS ? sprite : DEFAULT_AVATAR}`;

// SRS movement speed: 4 tiles/second. Arcade physics integrates velocity with
// delta time, so this is frame-rate independent by construction.
const WALK_SPEED = 4 * TILE_SIZE;
/**
 * Fallback zoom for text resolution before the first resize. The live value
 * comes from the viewport — see zoomForViewport.
 */
export const CAMERA_ZOOM = 2;

/**
 * Pixel art only stays crisp at whole-number scales, so zoom is an integer
 * picked from viewport height rather than a ratio: roughly 15 tiles tall on a
 * laptop, more on a big monitor, never a half-pixel.
 */
export function zoomForViewport(height: number): number {
  return Math.max(2, Math.min(MAX_ZOOM, Math.floor(height / 400)));
}

/** Beyond this the world stops reading as a room and starts reading as a wall. */
const MAX_ZOOM = 4;

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
  /** Which preset they chose; part of every animation key. */
  sprite_key: string;
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
  /** Which of the six presets this player is; the server decides it. */
  private selfSprite = DEFAULT_AVATAR;
  private nameTag!: Phaser.GameObjects.Container;
  private remotes = new Map<string, Remote>();
  private wasMoving = false;
  private sinceLastSend = 0;

  // Multi-map world (Phase 4)
  private currentTemplate: string | null = null;
  private mapLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  /** Pixel size of the current map; the camera fit needs it on every resize. */
  private mapSize = { width: 0, height: 0 };
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
    for (const spec of AVATARS) {
      this.load.spritesheet(textureFor(spec.key), AVATAR_URLS[spec.key]!, {
        frameWidth: 32,
        frameHeight: 32,
      });
    }
  }

  create(): void {
    // Everything map-independent boots here; the world itself is built from
    // the first snapshot (the server decides where this user spawns).
    this.player = this.physics.add.sprite(0, 0, textureFor(DEFAULT_AVATAR), 0).setVisible(false);
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) throw new Error('player has no arcade body');
    this.playerBody = body;
    // Feet-box collision so the avatar's head can overlap wall tiles top-down style.
    this.playerBody.setSize(18, 12).setOffset(7, 18);

    // Every preset gets its own eight animations; the sprite key is part of the
    // animation key so a character change is a texture swap, not a re-rig.
    for (const spec of AVATARS) {
      const key = textureFor(spec.key);
      DIRS.forEach((dir, row) => {
        this.anims.create({
          key: `walk-${spec.key}-${dir}`,
          frames: this.anims.generateFrameNumbers(key, {
            frames: [row * 4 + 1, row * 4 + 2, row * 4 + 3, row * 4 + 2],
          }),
          frameRate: 8,
          repeat: -1,
        });
        this.anims.create({
          key: `idle-${spec.key}-${dir}`,
          frames: [{ key, frame: row * 4 }],
        });
      });
    }
    this.player.anims.play(`idle-${this.selfSprite}-down`);

    this.nameTag = this.buildPill(this.displayName, 0xffffff, '#2d2926');
    this.nameTag.setVisible(false);
    this.cameras.main.setZoom(zoomForViewport(this.scale.height));
    // The world follows the window: full-bleed means the canvas changes size
    // whenever the browser does, and the camera has to keep up or the map
    // drifts out from under the player.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });

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

  private onResize(size: Phaser.Structs.Size): void {
    this.cameras.main.setSize(size.width, size.height);
    this.fitCameraToMap();
  }

  /**
   * Zoom and bounds for a world that fills the window.
   *
   * Two problems appear the moment the canvas is full bleed. A map smaller than
   * the viewport leaves dead space around it, and Phaser pins it to the top-left
   * corner rather than the middle. So: zoom up in WHOLE steps until the map
   * covers the viewport (pixel art blurs at fractional zoom), and if it still
   * cannot — a small map on a big monitor — pad the camera bounds symmetrically
   * so the map sits centred instead of shoved into a corner.
   */
  private fitCameraToMap(): void {
    const camera = this.cameras.main;
    const view = { w: this.scale.width, h: this.scale.height };
    if (this.mapSize.width === 0) {
      camera.setZoom(zoomForViewport(view.h));
      return;
    }
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        zoomForViewport(view.h),
        Math.ceil(view.w / this.mapSize.width),
        Math.ceil(view.h / this.mapSize.height),
      ),
    );
    camera.setZoom(zoom);
    const padX = Math.max(0, (view.w / zoom - this.mapSize.width) / 2);
    const padY = Math.max(0, (view.h / zoom - this.mapSize.height) / 2);
    camera.setBounds(
      -padX,
      -padY,
      this.mapSize.width + padX * 2,
      this.mapSize.height + padY * 2,
    );
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
      this.player.anims.play(`walk-${this.selfSprite}-${this.facing}`, true);
    } else {
      this.player.anims.play(`idle-${this.selfSprite}-${this.facing}`, true);
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
      case 'avatarState':
        // The server owns which preset we are; the scene just wears it.
        this.selfSprite = msg.sprite in AVATAR_URLS ? msg.sprite : DEFAULT_AVATAR;
        this.player.setTexture(textureFor(this.selfSprite));
        this.player.anims.play(`idle-${this.selfSprite}-${this.facing}`, true);
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
    const sprite = this.add.sprite(x, y, textureFor(actor.sprite), (row < 0 ? 0 : row) * 4);
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
      sprite_key: actor.sprite in AVATAR_URLS ? actor.sprite : DEFAULT_AVATAR,
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
        remote.sprite.anims.play(`walk-${remote.sprite_key}-${remote.dir}`, true);
      } else {
        remote.sprite.anims.play(`idle-${remote.sprite_key}-${remote.dir}`, true);
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
    const tiles = map.addTilesetImage('retry', TILES_KEY);
    if (!tiles) throw new Error('tileset "retry" missing from map');

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

    this.mapSize = { width: map.widthInPixels, height: map.heightInPixels };
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.setCollideWorldBounds(true);
    // Per-axis separation (wall sliding instead of sticking) is what arcade
    // physics colliders do; do not hand-roll collision here.
    this.collider = this.physics.add.collider(this.player, collision);

    this.fitCameraToMap();
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

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
