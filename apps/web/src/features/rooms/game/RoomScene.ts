import Phaser from 'phaser';
import studioA from '@foundry/maps/studio_a.json';
import tilesetUrl from '@foundry/maps/tilesets/placeholder.png';
import { TILE_SIZE, pixelToTile } from '@foundry/protocol';
import type { Actor, ActorMoveMessage, Dir, ServerMessage, SnapshotMessage } from '@foundry/protocol';
import avatarUrl from '../assets/avatar.png';
import { roomEvents } from '../event-bus.js';
import { roomSocket } from '../net/room-socket.js';

const MAP_KEY = 'studio_a';
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

export class RoomScene extends Phaser.Scene {
  private userId = '';
  private displayName = 'Explorer';
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: MoveKeys;
  private keyE!: Phaser.Input.Keyboard.Key;
  private facing: Facing = 'down';
  private nameTag!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Container;
  private whiteboardTiles: Array<{ x: number; y: number }> = [];
  private remotes = new Map<string, Remote>();
  private wasMoving = false;
  private sinceLastSend = 0;

  constructor() {
    super('room');
  }

  init(data: RoomSceneData): void {
    this.userId = data.userId;
    if (data.displayName) this.displayName = data.displayName;
  }

  preload(): void {
    // The map JSON is bundled (same file the server validates against), so it
    // goes straight into the cache instead of through a URL load.
    this.cache.tilemap.add(MAP_KEY, {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: studioA,
    });
    this.load.image(TILES_KEY, tilesetUrl);
    this.load.spritesheet(AVATAR_KEY, avatarUrl, { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    const map = this.make.tilemap({ key: MAP_KEY });
    const tiles = map.addTilesetImage('placeholder', TILES_KEY);
    if (!tiles) throw new Error('tileset "placeholder" missing from map');

    map.createLayer('ground', tiles, 0, 0);
    map.createLayer('objects', tiles, 0, 0);
    const collision = map.createLayer('collision', tiles, 0, 0);
    if (!collision) throw new Error('collision layer missing from map');
    collision.setVisible(false);
    // Map contract: any non-empty tile in 'collision' blocks movement.
    collision.setCollisionByExclusion([-1]);

    const spawn = map.getObjectLayer('spawns')?.objects.find((o) => o.name === 'default');
    const spawnX = spawn?.x ?? map.widthInPixels / 2;
    const spawnY = spawn?.y ?? map.heightInPixels / 2;

    this.player = this.physics.add.sprite(spawnX, spawnY - FEET_OFFSET_Y, AVATAR_KEY, 0);
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) throw new Error('player has no arcade body');
    this.playerBody = body;
    // Feet-box collision so the avatar's head can overlap wall tiles top-down style.
    this.playerBody.setSize(18, 12).setOffset(7, 18);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.setCollideWorldBounds(true);
    // Per-axis separation (wall sliding instead of sticking) is what arcade
    // physics colliders do; do not hand-roll collision here.
    this.physics.add.collider(this.player, collision);

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
    this.collectInteractables(map);

    const camera = this.cameras.main;
    camera.setZoom(CAMERA_ZOOM);
    camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    camera.startFollow(this.player, true, 0.1, 0.1);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('keyboard input unavailable');
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as MoveKeys;
    this.keyE = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    const unsubscribe = roomEvents.on('net:server-message', (msg) => this.onServerMessage(msg));
    this.events.once(Phaser.Scenes.Events.DESTROY, unsubscribe);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  override update(_time: number, delta: number): void {
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

    const tileX = pixelToTile(this.player.x);
    const tileY = pixelToTile(this.player.y + FEET_OFFSET_Y);
    const nearWhiteboard = this.whiteboardTiles.some(
      (t) => Math.max(Math.abs(t.x - tileX), Math.abs(t.y - tileY)) <= 1,
    );
    this.hint.setVisible(nearWhiteboard);
    if (nearWhiteboard && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      roomEvents.emit('interact:whiteboard');
    }
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
      case 'error':
        break;
    }
  }

  /** Full authoritative state — initial join, reconnect, or illegal-move resync. */
  private onSnapshot(msg: SnapshotMessage): void {
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
  // World furniture
  // ---------------------------------------------------------------------------

  /** Read objects with an `interactive` custom property from the map. */
  private collectInteractables(map: Phaser.Tilemaps.Tilemap): void {
    for (const obj of map.getObjectLayer('interactables')?.objects ?? []) {
      const properties = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
      if (!properties.some((p) => p.name === 'interactive' && p.value === 'whiteboard')) continue;

      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      const width = obj.width ?? TILE_SIZE;
      const height = obj.height ?? TILE_SIZE;
      for (let ty = pixelToTile(y); ty <= pixelToTile(y + height - 1); ty++) {
        for (let tx = pixelToTile(x); tx <= pixelToTile(x + width - 1); tx++) {
          this.whiteboardTiles.push({ x: tx, y: ty });
        }
      }
      this.hint = this.buildPill('Press E', 0x2d2926, '#f5f3ee');
      this.hint.setPosition(x + width / 2, y - 8);
      this.hint.setVisible(false);
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
