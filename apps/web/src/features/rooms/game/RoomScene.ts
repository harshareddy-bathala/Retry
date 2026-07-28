import Phaser from 'phaser';
import studioA from '@retry/maps/studio_a.json';
import commons from '@retry/maps/commons.json';
import classroom from '@retry/maps/classroom.json';
import lounge from '@retry/maps/lounge.json';
import conference from '@retry/maps/conference.json';
import { TILESET_URLS } from '@retry/maps/generated/tilesets';
import { ANIMATED } from '@retry/maps/generated/animated';
import {
  EMOTE_CHOICES,
  EMOTE_FRAME_SIZE,
  EMOTE_STRIP,
  TYPING_FRAME,
} from '@retry/maps/generated/emotes';
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
import { avatarScreenPositions, avatarTilePositions, minimapWorld } from '../avatar-positions.js';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';
import {
  ensureAvatarTexture,
  frameFor,
  preloadCharacterLayers,
  pruneAvatarTextures,
  resetAvatarTextureCache,
} from './compose-avatar.js';

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

/** How faded a remote avatar goes while the socket is down. */
const STALE_REMOTE_ALPHA = 0.45;

// "Show me where they are": pan out, hold on them, pan back.
const LOCATE_PAN_MS = 400;
const LOCATE_HOLD_MS = 1_200;

/** Texture key for the emote/typing strip. */
const EMOTE_TEXTURE = 'emotes';
/** How long a bubble stays up. Long enough to be seen across a room. */
const EMOTE_HOLD_MS = 3_000;
/**
 * How long a typing bubble survives without another `actorTyping`. The server
 * re-broadcasts at most every 2s, so this has to outlast that gap or the
 * bubble strobes while somebody writes a long message.
 */
const TYPING_HOLD_MS = 4_000;
/** How long a line of nearby speech hangs over a head. */
const SPEECH_HOLD_MS = 6_000;
/** Longer than this is trimmed: the panel is where reading happens. */
const SPEECH_MAX_CHARS = 60;

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
/** Emote and typing bubbles float above the name tag, clear of it. */
const BUBBLE_OFFSET_Y = TAG_OFFSET_Y + 14;
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
  kind: 'whiteboard' | 'exit' | 'door' | 'seat';
  doorSlot: number | null;
  /** Seats only: which way a sitter looks. */
  facing: Dir | null;
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
  /**
   * Whether the socket is currently live. While it is not, remote avatars are
   * stale by definition — they are dimmed and frozen rather than removed, so a
   * dropped connection reads as "these people are out of date" instead of
   * "everyone left" (build plan Phase 8.1). Local movement keeps working.
   */
  private connected = true;
  /** Sitting on a seat tile: input is ignored until a movement key stands us up. */
  private seated = false;
  /**
   * The bubble currently over each actor (self included), with the time it
   * expires. One per person: a new emote replaces the old rather than stacking,
   * and a typing bubble yields to an actual emote.
   */
  private bubbles = new Map<string, { sprite: Phaser.GameObjects.Sprite; until: number }>();
  /** Nearby speech currently shown over each actor's head. */
  private speech = new Map<string, { pill: Phaser.GameObjects.Container; until: number }>();

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
    // Emote + typing bubbles: one strip, two frames each.
    if (EMOTE_STRIP) {
      this.load.spritesheet(EMOTE_TEXTURE, EMOTE_STRIP, {
        frameWidth: EMOTE_FRAME_SIZE,
        frameHeight: EMOTE_FRAME_SIZE,
      });
    }
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
    // While any DOM layer above the canvas holds the keyboard, the scene
    // surrenders it entirely — "typing in chat never moves the avatar"
    // (Phase 6 acceptance). The stack decides; the scene just obeys.
    const unsubscribePanel = roomEvents.on('input:canvas-keys', ({ enabled }) => {
      keyboard.enabled = enabled;
      if (!enabled && this.currentTemplate) {
        keyboard.resetKeys();
        this.playerBody.setVelocity(0, 0);
        this.wasMoving = false;
        this.sendMove(false);
      }
    });
    const unsubscribeStatus = roomEvents.on('net:status', (status) => {
      this.setConnected(status === 'open');
    });
    const unsubscribeLocate = roomEvents.on('camera:locate', ({ userId }) => {
      this.locate(userId);
    });
    // The HUD picker and the number keys both come through here, so the scene
    // has one path for "I emoted" regardless of how it was triggered.
    const unsubscribeEmote = roomEvents.on('self:emote', ({ key }) => {
      roomSocket.send({ t: 'emote', key });
      // Optimistic: the server does not echo an emote to its sender, exactly
      // like movement, so the local bubble is drawn here.
      this.showBubble(this.userId, this.emoteFrame(key), EMOTE_HOLD_MS);
    });
    const cleanup = (): void => {
      unsubscribe();
      unsubscribePanel();
      unsubscribeRename();
      unsubscribeStatus();
      unsubscribeLocate();
      unsubscribeEmote();
      avatarScreenPositions.clear();
      avatarTilePositions.clear();
      minimapWorld.current = null;
      resetAvatarTextureCache();
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

  /**
   * Pan to someone, hold, then hand the camera back to the player. The pan is
   * deliberately short and self-reversing: this answers "where are they?", it
   * is not a follow mode, and a camera that stays away from your own avatar
   * while you can still walk is disorienting.
   */
  private locate(userId: string): void {
    const remote = this.remotes.get(userId);
    if (!remote || !this.currentTemplate) return;
    const camera = this.cameras.main;
    camera.stopFollow();
    camera.pan(remote.sprite.x, remote.sprite.y, LOCATE_PAN_MS, 'Sine.easeInOut');
    // A ring under their feet, so the pan lands on something that says "here".
    const ring = this.add
      .ellipse(0, 0, SHADOW.radiusX * 4, SHADOW.radiusY * 4)
      .setStrokeStyle(2, 0xd08a4f, 0.9)
      .setDepth(DEPTH_UI);
    this.tweens.add({
      targets: ring,
      scale: { from: 1, to: 1.6 },
      alpha: { from: 1, to: 0 },
      duration: LOCATE_HOLD_MS,
      onUpdate: () => {
        const live = this.remotes.get(userId);
        if (live) ring.setPosition(live.sprite.x, live.sprite.y + SHADOW.offsetY);
      },
      onComplete: () => ring.destroy(),
    });
    this.time.delayedCall(LOCATE_PAN_MS + LOCATE_HOLD_MS, () => {
      // The scene may have swapped maps mid-pan; startFollow on a stale camera
      // is harmless, but re-checking keeps the intent obvious.
      this.cameras.main.pan(
        this.player.x,
        this.player.y,
        LOCATE_PAN_MS,
        'Sine.easeInOut',
        false,
        (_camera, progress) => {
          if (progress === 1) this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        },
      );
    });
  }

  /** Dim (or restore) everyone else when the connection drops or returns. */
  private setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    const alpha = connected ? 1 : STALE_REMOTE_ALPHA;
    for (const remote of this.remotes.values()) {
      remote.sprite.setAlpha(alpha);
      remote.tag.setAlpha(alpha);
      remote.shadow.setAlpha(connected ? SHADOW.alpha : SHADOW.alpha * STALE_REMOTE_ALPHA);
      // Freeze the walk cycle: with no updates arriving, a looping walk is a
      // sprite jogging on the spot and claiming to be live.
      if (!connected) remote.moving = false;
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

    // Any movement key gets you out of a chair — hunting for the key that
    // released you would be a puzzle, and E is already taken by "sit again".
    if (this.seated && (left || right || up || down)) this.stand();

    let vx = this.seated ? 0 : (right ? 1 : 0) - (left ? 1 : 0);
    let vy = this.seated ? 0 : (down ? 1 : 0) - (up ? 1 : 0);
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
    this.updateBubbles(this.time.now);
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
        this.pruneTextures();
        break;
      case 'actorEmote':
        this.showBubble(msg.userId, this.emoteFrame(msg.key), EMOTE_HOLD_MS);
        break;
      case 'actorTyping':
        // Never over-write a live emote with a typing bubble: the emote was a
        // deliberate act and this is a side effect of writing.
        if (!this.bubbles.has(msg.userId)) {
          this.showBubble(msg.userId, TYPING_FRAME, TYPING_HOLD_MS);
        } else {
          this.extendBubble(msg.userId, TYPING_HOLD_MS);
        }
        break;
      case 'chatMessage':
        // Speech belongs in the world, not only in a panel: a line said nearby
        // appears over the speaker's head, which is the whole point of saying
        // it nearby rather than to the room.
        if (msg.scope === 'nearby') {
          this.clearBubble(msg.userId);
          this.showSpeech(msg.userId, msg.body);
        }
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
    // A map change replaces the whole cast, which is exactly when a session's
    // texture cache is most likely to be holding characters nobody is wearing.
    this.pruneTextures();
  }

  /** Evict composited characters nobody on this map is wearing any more. */
  private pruneTextures(): void {
    const inUse = new Set<string>([this.selfSprite]);
    for (const remote of this.remotes.values()) inUse.add(remote.sprite_key);
    pruneAvatarTextures(this, inUse);
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
    const alpha = this.connected ? 1 : STALE_REMOTE_ALPHA;
    const sprite = this.add
      .sprite(x, y, textureKey, frameFor('idle', actor.dir))
      .setDepth(y + FEET_OFFSET_Y)
      .setAlpha(alpha);
    const tag = this.buildPill(actor.displayName, 0xffffff, '#2d2926');
    tag.setPosition(x, y - TAG_OFFSET_Y);
    tag.setAlpha(alpha);
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
    avatarTilePositions.delete(userId);
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
      // Tile coordinates too, for the minimap — which draws the whole room and
      // therefore cannot use a screen position that is mostly off screen.
      avatarTilePositions.set(userId, {
        x: worldX / TILE_SIZE,
        y: (worldY + FEET_OFFSET_Y) / TILE_SIZE,
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
    for (const userId of [...this.bubbles.keys()]) this.clearBubble(userId);
    for (const userId of [...this.speech.keys()]) this.clearSpeech(userId);
    // A chair does not follow you through a door.
    this.seated = false;
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

    this.publishMinimap(map, collision);
    this.collectInteractables(map);
    this.spawnProps(map);
    this.currentTemplate = template;
    this.player.setVisible(true);
    this.playerShadow.setVisible(true);
    this.nameTag.setVisible(true);
    this.renderDoors();
  }

  /**
   * Hand the minimap the room's shape: dimensions plus a flattened collision
   * grid. Published once per world build, not per frame — the geometry only
   * changes at a door, and a 40x16 grid rebuilt sixty times a second would be
   * the most expensive thing on screen for no reason at all.
   */
  private publishMinimap(
    map: Phaser.Tilemaps.Tilemap,
    collision: Phaser.Tilemaps.TilemapLayer,
  ): void {
    const blocked = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = collision.getTileAt(x, y);
        if (tile && tile.index !== -1) blocked[y * map.width + x] = 1;
      }
    }
    minimapWorld.current = { width: map.width, height: map.height, blocked };
  }

  /** Read objects with an `interactive` custom property from the map. */
  private collectInteractables(map: Phaser.Tilemaps.Tilemap): void {
    for (const obj of map.getObjectLayer('interactables')?.objects ?? []) {
      const properties = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
      const kindProp = properties.find((p) => p.name === 'interactive')?.value;
      if (
        kindProp !== 'whiteboard' &&
        kindProp !== 'exit' &&
        kindProp !== 'door' &&
        kindProp !== 'seat'
      ) {
        continue;
      }
      const slotProp = properties.find((p) => p.name === 'door_slot')?.value;
      const facingProp = properties.find((p) => p.name === 'facing')?.value;
      const facing = isDir(facingProp) ? facingProp : null;

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
      const label =
        kindProp === 'exit' ? 'E — to Commons'
        : kindProp === 'seat' ? 'E — sit'
        : 'Press E';
      const hint = this.buildPill(label, 0x2d2926, '#f5f3ee');
      hint.setPosition(x + width / 2, kindProp === 'door' ? y + height + 10 : y - 8);
      hint.setVisible(false);
      hint.setDepth(DEPTH_HINT);
      this.interactables.push({
        kind: kindProp,
        doorSlot: typeof slotProp === 'number' ? slotProp : null,
        facing,
        tiles,
        hint,
      });
    }
  }

  /**
   * The interactable the player stands next to (Chebyshev distance ≤ 1), the
   * genuinely NEAREST one rather than the first in map order — a chair you are
   * standing on (distance 0) must win over a door one tile away, or sitting at
   * a desk beside a doorway walks you into the next room instead.
   */
  private nearestInteractable(): Interactable | null {
    const tileX = pixelToTile(this.player.x);
    const tileY = pixelToTile(this.player.y + FEET_OFFSET_Y);
    let best: Interactable | null = null;
    let bestDistance = Infinity;
    for (const i of this.interactables) {
      for (const t of i.tiles) {
        const distance = Math.max(Math.abs(t.x - tileX), Math.abs(t.y - tileY));
        if (distance <= 1 && distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  private updateInteractables(): void {
    const near = this.nearestInteractable();
    for (const i of this.interactables) {
      // A door with no assigned room is just wall dressing — no hint, no action.
      const usable = i.kind !== 'door' || this.doorFor(i.doorSlot)?.room !== undefined;
      // While seated, only the chair you are in offers anything; every other
      // affordance within reach would be pressable without standing up.
      const reachable = !this.seated || i.kind === 'seat';
      i.hint.setVisible(i === near && usable && reachable);
    }
  }

  private activate(interactable: Interactable): void {
    switch (interactable.kind) {
      case 'seat':
        if (this.seated) this.stand();
        else this.sit(interactable);
        break;
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
  // Emote / typing bubbles
  // ---------------------------------------------------------------------------

  /** First frame of an emote key; the typing dots if the key is unknown. */
  private emoteFrame(key: string): number {
    return EMOTE_CHOICES.find((e) => e.key === key)?.frame ?? TYPING_FRAME;
  }

  /**
   * Put a bubble over someone's head. Both frames of the pair are played as a
   * two-frame loop — the pack draws emotes as a gentle bob, and a static one
   * reads as a stuck UI element rather than a reaction.
   */
  private showBubble(userId: string, frame: number, holdMs: number): void {
    if (!EMOTE_STRIP) return;
    this.clearBubble(userId);
    const sprite = this.add.sprite(0, 0, EMOTE_TEXTURE, frame).setDepth(DEPTH_HINT);
    const key = `bubble-${frame}`;
    if (!this.anims.exists(key)) {
      this.anims.create({
        key,
        frames: [{ key: EMOTE_TEXTURE, frame }, { key: EMOTE_TEXTURE, frame: frame + 1 }],
        frameRate: 3,
        repeat: -1,
      });
    }
    sprite.anims.play(key);
    this.bubbles.set(userId, { sprite, until: this.time.now + holdMs });
  }

  /**
   * A line of speech over someone's head. Long lines are trimmed rather than
   * wrapped: this is a glance-at-it affordance and the full text is in the
   * chat panel, where reading belongs.
   */
  private showSpeech(userId: string, body: string): void {
    this.clearSpeech(userId);
    const text = body.length > SPEECH_MAX_CHARS ? `${body.slice(0, SPEECH_MAX_CHARS - 1)}…` : body;
    const pill = this.buildPill(text, 0xffffff, '#2d2926');
    pill.setDepth(DEPTH_HINT);
    this.speech.set(userId, { pill, until: this.time.now + SPEECH_HOLD_MS });
  }

  private clearSpeech(userId: string): void {
    const existing = this.speech.get(userId);
    if (!existing) return;
    existing.pill.destroy();
    this.speech.delete(userId);
  }

  private extendBubble(userId: string, holdMs: number): void {
    const bubble = this.bubbles.get(userId);
    if (bubble) bubble.until = this.time.now + holdMs;
  }

  private clearBubble(userId: string): void {
    const bubble = this.bubbles.get(userId);
    if (!bubble) return;
    bubble.sprite.destroy();
    this.bubbles.delete(userId);
  }

  /** Where an actor's head is, or null once they have left the map. */
  private headOf(userId: string): { x: number; y: number } | null {
    if (userId === this.userId) return { x: this.player.x, y: this.player.y };
    const remote = this.remotes.get(userId);
    return remote ? { x: remote.sprite.x, y: remote.sprite.y } : null;
  }

  /** Follow heads, and expire. Called every frame. */
  private updateBubbles(now: number): void {
    for (const [userId, bubble] of [...this.bubbles]) {
      const at = this.headOf(userId);
      if (now >= bubble.until || !at) {
        this.clearBubble(userId);
        continue;
      }
      bubble.sprite.setPosition(Math.round(at.x), Math.round(at.y) - BUBBLE_OFFSET_Y);
    }
    for (const [userId, said] of [...this.speech]) {
      const at = this.headOf(userId);
      if (now >= said.until || !at) {
        this.clearSpeech(userId);
        continue;
      }
      // Above the emote bubble when both are up — speech is the newer thing to
      // read, and it should never sit on top of the name tag.
      const lift = this.bubbles.has(userId) ? BUBBLE_OFFSET_Y + 22 : BUBBLE_OFFSET_Y;
      said.pill.setPosition(Math.round(at.x), Math.round(at.y) - lift);
    }
  }

  // ---------------------------------------------------------------------------
  // Sitting
  // ---------------------------------------------------------------------------

  /**
   * Park the avatar on a seat tile, facing whichever way the map says.
   *
   * Entirely client-side: the server sees an ordinary position on a walkable
   * tile and needs no new state, which is why the sittable chair blocks carry
   * no collision. Nothing is persisted either — standing up is one keypress
   * and a disconnect leaves nobody welded to a chair.
   */
  private sit(seat: Interactable): void {
    const tile = seat.tiles[0];
    if (!tile) return;
    this.seated = true;
    this.playerBody.setVelocity(0, 0);
    // Feet centred on the seat tile; the sprite sits FEET_OFFSET_Y above it.
    this.playerBody.reset(
      tile.x * TILE_SIZE + TILE_SIZE / 2,
      tile.y * TILE_SIZE + TILE_SIZE / 2 - FEET_OFFSET_Y,
    );
    this.facing = seat.facing ?? this.facing;
    this.player.anims.play(`idle-${this.selfSprite}-${this.facing}`, true);
    this.wasMoving = false;
    this.sendMove(false);
    this.setHintLabel(seat, 'E — stand');
  }

  private stand(): void {
    if (!this.seated) return;
    this.seated = false;
    for (const i of this.interactables) {
      if (i.kind === 'seat') this.setHintLabel(i, 'E — sit');
    }
  }

  /** Swap a hint's text. Pills are baked at build time, so this rebuilds one. */
  private setHintLabel(interactable: Interactable, label: string): void {
    const { x, y } = interactable.hint;
    const visible = interactable.hint.visible;
    interactable.hint.destroy();
    interactable.hint = this.buildPill(label, 0x2d2926, '#f5f3ee');
    interactable.hint.setPosition(x, y).setDepth(DEPTH_HINT).setVisible(visible);
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

/** Narrow a Tiled custom property to a direction. */
function isDir(value: unknown): value is Dir {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}
