import Phaser from 'phaser';
import studioA from '@retry/maps/studio_a.json';
import commons from '@retry/maps/commons.json';
import classroom from '@retry/maps/classroom.json';
import lounge from '@retry/maps/lounge.json';
import conference from '@retry/maps/conference.json';
import { TILESET_URLS } from '@retry/maps/generated/tilesets';
import { ANIMATED } from '@retry/maps/generated/animated';
import { DEFAULT_SPRITE } from '@retry/maps';
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
import { ensureAvatarTexture, frameFor, preloadCharacterLayers } from './compose-avatar.js';

// Every Tiled template ships in the bundle; the server's snapshot names which
// one to render (mapId is the instance — a room uuid — template is the file).
const TEMPLATES: Record<string, unknown> = {
  studio_a: studioA,
  classroom,
  lounge,
  conference,
  commons,
};

/**
 * A map declares only the sheets it draws from, so the loader takes the union
 * across templates rather than every sheet the pack build produced. Sheets are
 * ~100-400 kB each and the full set is over a megabyte for maps that use three.
 */
const REQUIRED_TILESETS: string[] = [
  ...new Set(
    Object.values(TEMPLATES).flatMap((map) =>
      ((map as { tilesets?: Array<{ name: string }> }).tilesets ?? []).map((t) => t.name),
    ),
  ),
];

/** Texture key per tileset — a map may draw on several sheets at once. */
const tilesKey = (name: string): string => `tiles-${name}`;
/** Texture key per animated object strip. */
const animKey = (name: string): string => `anim-${name}`;

// Commons doors. Frame 0 is shut and the last frame is a clear doorway, so
// opening is the strip played forwards and closing is the same strip reversed.
const DOOR_FPS = 14;
/** How close (in tiles, Chebyshev) a person must be for a door to swing open. */
const DOOR_OPEN_RANGE = 2;

/**
 * Contact shadow under every avatar. Without one a 32x64 sprite reads as a
 * sticker floating over the floor rather than a person standing on it — the
 * pack's own furniture is drawn with shadows, so characters need them to sit
 * in the same world.
 */
const SHADOW = { radiusX: 8, radiusY: 3, alpha: 0.28, offsetY: 22 } as const;

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
// them, and the server validates collision on the wire position. Pack frames
// are 32x64 (head above the occupied tile), so the feet sit 24px below the
// sprite centre; the feet box itself hugs the frame's bottom.
const FEET_OFFSET_Y = 24;
const FEET_BOX = { width: 18, height: 12, offsetX: 7, offsetY: 50 } as const;
/** Name tags float just above the head, which is 32px above the centre. */
const TAG_OFFSET_Y = 44;
/**
 * Top of everything the scene draws above an avatar (the name tag's upper
 * edge). This — not the head — is the anchor published to the React overlay,
 * so the overlay's clearance is a small constant instead of a number that has
 * to grow with camera zoom to stay clear of the tag.
 */
const OVERLAY_ANCHOR_Y = TAG_OFFSET_Y + 8;

// Send cadence and remote smoothing (rooms build plan Phase 2).
const MOVE_SEND_INTERVAL_MS = 50;
const INTERPOLATION_MS = 100;
const REMOTE_IDLE_TIMEOUT_MS = 200;

// Phase 4 door transition: 100ms out + 100ms in = the plan's 200ms fade.
const FADE_MS = 100;

// Depth bands. Actors y-sort within [0, map height in px]; the objects_above
// layer (wall caps, furniture tops — "the part you walk behind") draws over
// every actor, and UI pills float over the lot.
const DEPTH_ABOVE = 5000;
const DEPTH_UI = 10000;
const DEPTH_HINT = 10001;

type Facing = 'down' | 'left' | 'right' | 'up';

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
  /** Composited texture key for their appearance; part of every animation key. */
  sprite_key: string;
  shadow: Phaser.GameObjects.Ellipse;
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
  /** This player's composited texture key; the server decides the selection. */
  private selfSprite = '';
  private nameTag!: Phaser.GameObjects.Container;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  /**
   * Every pill's Text, so their render resolution can follow the camera. Pills
   * are built at many different moments — some before the camera has settled on
   * a zoom, some after a resize changes it — so baking the zoom in at
   * construction is not enough on its own.
   */
  private pillTexts: Phaser.GameObjects.Text[] = [];
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
  /** Swing state per assigned door slot, so a door animates only on change. */
  private doorSprites = new Map<
    number,
    { sprite: Phaser.GameObjects.Sprite; kind: string; open: boolean }
  >();
  /** Looping ambient objects for the current map. */
  private propSprites: Phaser.GameObjects.Sprite[] = [];
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
    for (const key of REQUIRED_TILESETS) {
      const url = TILESET_URLS[key];
      if (!url) throw new Error(`map declares tileset "${key}" — run pnpm assets:build`);
      this.load.image(tilesKey(key), url);
    }
    for (const [key, sheet] of Object.entries(ANIMATED)) {
      this.load.spritesheet(animKey(key), sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }
    // Characters composite at runtime from these curated layer strips
    // (~240 KB for the whole catalogue) — there is no per-character asset.
    preloadCharacterLayers(this);
  }

  create(): void {
    // Everything map-independent boots here; the world itself is built from
    // the first snapshot (the server decides where this user spawns).
    // Animations are registered per composited texture on demand — see
    // compose-avatar.ts — so a character change is a texture swap, not a re-rig.
    this.selfSprite = ensureAvatarTexture(this, DEFAULT_SPRITE);
    this.player = this.physics.add
      .sprite(0, 0, this.selfSprite, frameFor('idle', 'down'))
      .setVisible(false);
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) throw new Error('player has no arcade body');
    this.playerBody = body;
    // Feet-box collision so the avatar's head can overlap wall tiles top-down style.
    this.playerBody
      .setSize(FEET_BOX.width, FEET_BOX.height)
      .setOffset(FEET_BOX.offsetX, FEET_BOX.offsetY);
    this.playerShadow = this.makeShadow();
    this.player.anims.play(`idle-${this.selfSprite}-down`);

    // Ambient loops (a brewing coffee machine, a blinking server, a cat) and
    // the door swings. Registered once; every placement shares them.
    for (const [key, sheet] of Object.entries(ANIMATED)) {
      const texture = animKey(key);
      const [from, to] = sheet.loop ?? [0, sheet.frames - 1];
      this.anims.create({
        key: `loop-${key}`,
        frames: this.anims.generateFrameNumbers(texture, { start: from, end: to }),
        frameRate: 6,
        repeat: -1,
      });
      this.anims.create({
        key: `open-${key}`,
        frames: this.anims.generateFrameNumbers(texture, { start: 0, end: sheet.frames - 1 }),
        frameRate: DOOR_FPS,
      });
      this.anims.create({
        key: `shut-${key}`,
        frames: this.anims.generateFrameNumbers(texture, { start: sheet.frames - 1, end: 0 }),
        frameRate: DOOR_FPS,
      });
    }

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
    // A rename repaints one label rather than rebuilding the game (which is
    // what putting displayName in RoomCanvas's effect deps used to do).
    const unsubscribeRename = roomEvents.on('self:rename', ({ displayName }) => {
      if (displayName === this.displayName) return;
      this.displayName = displayName;
      const visible = this.nameTag.visible;
      this.nameTag.destroy();
      this.nameTag = this.buildPill(displayName, 0xffffff, '#2d2926');
      this.nameTag.setVisible(visible);
    });
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
      unsubscribeRename();
      avatarScreenPositions.clear();
    };
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);

    // The join snapshot may have arrived while assets were still loading —
    // ask for a fresh one now that this scene is listening.
    roomSocket.requestResync();
  }

  /** Device pixels per world pixel at the current zoom. */
  private pillResolution(): number {
    return (window.devicePixelRatio || 1) * (this.cameras.main?.zoom || CAMERA_ZOOM);
  }

  /**
   * Re-render existing pills at the current zoom. Called whenever the camera
   * changes scale — otherwise a tag built at zoom 1 (before the first fit) or
   * before the window was resized stays soft for the rest of the session.
   */
  private refreshPillResolution(): void {
    const resolution = this.pillResolution();
    this.pillTexts = this.pillTexts.filter((t) => t.active);
    for (const text of this.pillTexts) {
      if (text.style.resolution !== resolution) text.setResolution(resolution);
    }
  }

  /** One contact shadow, drawn just under an actor's feet. */
  private makeShadow(): Phaser.GameObjects.Ellipse {
    return this.add
      .ellipse(0, 0, SHADOW.radiusX * 2, SHADOW.radiusY * 2, 0x000000, SHADOW.alpha)
      .setVisible(false);
  }

  /** Park a shadow under a sprite and sort it just behind that actor. */
  private placeShadow(shadow: Phaser.GameObjects.Ellipse, x: number, y: number): void {
    shadow.setPosition(x, y + SHADOW.offsetY);
    // Just under the actor's own depth so it never draws over another person's
    // feet, but still above the floor and any rug.
    shadow.setDepth(y + FEET_OFFSET_Y - 0.1);
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
      this.refreshPillResolution();
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
    this.refreshPillResolution();
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

    // Y-sort: whoever stands further south draws in front (feet decide).
    this.player.setDepth(this.player.y + FEET_OFFSET_Y);
    this.placeShadow(this.playerShadow, this.player.x, this.player.y);
    this.nameTag.setPosition(Math.round(this.player.x), Math.round(this.player.y) - TAG_OFFSET_Y);
    this.updateRemotes(this.time.now);
    this.publishScreenPositions();
    this.updateInteractables();
    this.updateDoors();
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
        // The server owns the selection; the scene just wears it.
        this.selfSprite = ensureAvatarTexture(this, msg.sprite);
        this.player.setTexture(this.selfSprite, frameFor('idle', this.facing));
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
    const textureKey = ensureAvatarTexture(this, actor.sprite);
    const sprite = this.add
      .sprite(x, y, textureKey, frameFor('idle', actor.dir))
      .setDepth(y + FEET_OFFSET_Y);
    const tag = this.buildPill(actor.displayName, 0xffffff, '#2d2926');
    tag.setPosition(x, y - TAG_OFFSET_Y);
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
      sprite_key: textureKey,
      shadow: this.makeShadow().setVisible(true),
    });
  }

  private removeRemote(userId: string): void {
    const remote = this.remotes.get(userId);
    if (!remote) return;
    remote.sprite.destroy();
    remote.tag.destroy();
    remote.shadow.destroy();
    this.remotes.delete(userId);
    avatarScreenPositions.delete(userId);
  }

  /**
   * Canvas-space avatar positions for the React bubble overlay (Phase 3).
   * The published anchor is the top of the name tag — a landmark the scene
   * owns — rather than the sprite centre, which only worked while both sides
   * happened to agree about frame height and zoom.
   */
  private publishScreenPositions(): void {
    const camera = this.cameras.main;
    const write = (userId: string, worldX: number, worldY: number): void => {
      avatarScreenPositions.set(userId, {
        x: (worldX - camera.worldView.x) * camera.zoom,
        y: (worldY - OVERLAY_ANCHOR_Y - camera.worldView.y) * camera.zoom,
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
      remote.sprite.setPosition(x, y).setDepth(y + FEET_OFFSET_Y);
      remote.tag.setPosition(Math.round(x), Math.round(y) - TAG_OFFSET_Y);
      this.placeShadow(remote.shadow, x, y);

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
    for (const p of this.propSprites) p.destroy();
    this.propSprites = [];
    this.clearDoorVisuals();

    const map = this.make.tilemap({ key: template });
    // A room draws on several sheets — floors, walls and one or more themed
    // furniture sets — so every tileset the map declares has to be registered,
    // and each layer is given all of them. Tiled's firstgid decides which sheet
    // any given tile actually comes from.
    const tiles = map.tilesets.map((tileset) => {
      const image = map.addTilesetImage(tileset.name, tilesKey(tileset.name));
      if (!image) throw new Error(`tileset "${tileset.name}" missing — run pnpm assets:build`);
      return image;
    });
    if (tiles.length === 0) throw new Error(`map '${template}' declares no tilesets`);

    const ground = map.createLayer('ground', tiles, 0, 0);
    const overlay = map.getLayerIndexByName('ground_overlay') !== null
      ? map.createLayer('ground_overlay', tiles, 0, 0)
      : null;
    const objects = map.createLayer('objects', tiles, 0, 0);
    const collision = map.createLayer('collision', tiles, 0, 0);
    if (!ground || !objects || !collision) throw new Error(`layers missing from map '${template}'`);
    // The walk-behind layer: wall caps and the upper tiles of tall furniture.
    // Only a prop's BOTTOM tile blocks (author convention), so an avatar can
    // stand behind a bookshelf and be drawn behind its top half.
    const above = map.getLayerIndexByName('objects_above') !== null
      ? map.createLayer('objects_above', tiles, 0, 0)
      : null;
    collision.setVisible(false);
    // Map contract: any non-empty tile in 'collision' blocks movement.
    collision.setCollisionByExclusion([-1]);
    ground.setDepth(-3);
    overlay?.setDepth(-2);
    objects.setDepth(-1);
    above?.setDepth(DEPTH_ABOVE);
    this.mapLayers = [ground, objects, collision];
    if (overlay) this.mapLayers.push(overlay);
    if (above) this.mapLayers.push(above);

    this.mapSize = { width: map.widthInPixels, height: map.heightInPixels };
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.setCollideWorldBounds(true);
    // Per-axis separation (wall sliding instead of sticking) is what arcade
    // physics colliders do; do not hand-roll collision here.
    this.collider = this.physics.add.collider(this.player, collision);

    this.fitCameraToMap();
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    // Small movements should not slide the whole room. The dead zone lets the
    // avatar drift a little before the camera commits to following.
    this.cameras.main.setDeadzone(TILE_SIZE * 2, TILE_SIZE * 1.5);

    this.collectInteractables(map);
    this.spawnProps(map);
    this.currentTemplate = template;
    this.player.setVisible(true);
    this.playerShadow.setVisible(true);
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
      hint.setDepth(DEPTH_HINT);
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
    this.doorSprites.clear();
  }

  /**
   * Real doors from the pack, one sprite per slot, standing in the wall: the
   * frame is 32x64 so it covers both the wall's cap and face rows. A door with
   * no room behind it is a shut door, and stays shut.
   */
  private renderDoors(): void {
    if (this.currentTemplate !== 'commons') return;
    this.clearDoorVisuals();
    this.doorSprites.clear();
    for (const door of this.doorsInfo) {
      const px = door.x * TILE_SIZE;
      const py = door.y * TILE_SIZE;
      // Non-open rooms get the door with a lock plate; the policy is legible
      // from across the room instead of only in the plaque's text.
      const kind = door.room && door.room.accessPolicy !== 'open' ? 'doorLocked' : 'door';
      const sprite = this.add
        .sprite(px + TILE_SIZE / 2, py + TILE_SIZE, animKey(kind), 0)
        .setOrigin(0.5, 1)
        // Doors sit in the wall, behind everyone — an avatar walking past the
        // Commons' north wall passes in front of it.
        .setDepth(-0.5);
      this.doorVisuals.push(sprite);
      if (door.room) this.doorSprites.set(door.slot, { sprite, kind, open: false });

      if (door.room) {
        const plaque = this.buildPill(
          `${door.room.roomName} · ${door.room.occupancy}`,
          0xf5f3ee,
          '#2d2926',
        );
        plaque.setPosition(px + TILE_SIZE / 2, py + TILE_SIZE + 12);
        plaque.setDepth(DEPTH_UI);
        this.doorVisuals.push(plaque);
      }
    }
  }

  /** Swing doors open when someone is near them, shut when they leave. */
  private updateDoors(): void {
    if (this.doorSprites.size === 0) return;
    const feetX = pixelToTile(this.player.x);
    const feetY = pixelToTile(this.player.y + FEET_OFFSET_Y);
    for (const door of this.doorsInfo) {
      const entry = this.doorSprites.get(door.slot);
      if (!entry) continue;
      const near =
        Math.max(Math.abs(door.x - feetX), Math.abs(door.y - feetY)) <= DOOR_OPEN_RANGE;
      if (near === entry.open) continue;
      entry.open = near;
      entry.sprite.anims.play(`${near ? 'open' : 'shut'}-${entry.kind}`, true);
    }
  }

  /**
   * Ambient animated objects placed on a map's optional `props` object layer:
   * a coffee machine brewing, a server blinking, a cat. Each object's `name`
   * is the animation key; unknown keys are skipped rather than fatal, so a map
   * can name an object the build has not been told to take yet.
   */
  private spawnProps(map: Phaser.Tilemaps.Tilemap): void {
    for (const obj of map.getObjectLayer('props')?.objects ?? []) {
      const key = obj.name;
      const sheet = ANIMATED[key];
      if (!sheet) continue;
      // Tiled anchors rectangles at their top-left; a strip taller than one
      // tile hangs upward from the tile it stands on.
      const x = (obj.x ?? 0) + TILE_SIZE / 2;
      const y = (obj.y ?? 0) + TILE_SIZE;
      const sprite = this.add
        .sprite(x, y, animKey(key), 0)
        .setOrigin(0.5, 1)
        .setDepth(y);
      sprite.anims.play(`loop-${key}`);
      this.propSprites.push(sprite);
    }
  }

  /**
   * Rounded pill with centred text. Text is rendered at device pixel ratio
   * times the LIVE camera zoom so it stays crisp instead of scaling a low-res
   * texture — using the CAMERA_ZOOM constant here left every tag, plaque and
   * hint soft on any viewport that zoomed past 2.
   */
  private buildPill(label: string, bgColor: number, textColor: string): Phaser.GameObjects.Container {
    const text = this.add
      .text(0, 0, label, {
        fontFamily: '"IBM Plex Sans", sans-serif',
        fontSize: '9px',
        color: textColor,
        resolution: this.pillResolution(),
      })
      .setOrigin(0.5);
    this.pillTexts.push(text);
    const width = Math.ceil(text.width) + 10;
    const height = Math.ceil(text.height) + 4;
    const bg = this.add.graphics();
    bg.fillStyle(bgColor, 0.95);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    return this.add.container(0, 0, [bg, text]).setDepth(DEPTH_UI);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
