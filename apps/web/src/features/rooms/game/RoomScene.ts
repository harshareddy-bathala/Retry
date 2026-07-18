import Phaser from 'phaser';
import studioA from '@foundry/maps/studio_a.json';
import tilesetUrl from '@foundry/maps/tilesets/placeholder.png';
import { TILE_SIZE, pixelToTile } from '@foundry/protocol';
import avatarUrl from '../assets/avatar.png';
import { roomEvents } from '../event-bus.js';

const MAP_KEY = 'studio_a';
const TILES_KEY = 'tiles';
const AVATAR_KEY = 'avatar';

// SRS movement speed: 4 tiles/second. Arcade physics integrates velocity with
// delta time, so this is frame-rate independent by construction.
const WALK_SPEED = 4 * TILE_SIZE;
export const CAMERA_ZOOM = 2;

const DIRS = ['down', 'left', 'right', 'up'] as const;
type Facing = (typeof DIRS)[number];

export type RoomSceneData = { displayName: string };

type MoveKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

export class RoomScene extends Phaser.Scene {
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

  constructor() {
    super('room');
  }

  init(data: RoomSceneData): void {
    if (data.displayName) this.displayName = data.displayName;
  }

  preload(): void {
    // The map JSON is bundled (same file the server will use in Phase 2), so
    // it goes straight into the cache instead of through a URL load.
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

    this.player = this.physics.add.sprite(spawnX, spawnY, AVATAR_KEY, 0);
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
  }

  override update(): void {
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
    this.playerBody.setVelocity(vx * WALK_SPEED, vy * WALK_SPEED);

    if (vx !== 0 || vy !== 0) {
      this.facing = vy < 0 ? 'up' : vy > 0 ? 'down' : vx < 0 ? 'left' : 'right';
      this.player.anims.play(`walk-${this.facing}`, true);
    } else {
      this.player.anims.play(`idle-${this.facing}`, true);
    }

    this.nameTag.setPosition(Math.round(this.player.x), Math.round(this.player.y) - 26);

    const tileX = pixelToTile(this.player.x);
    const tileY = pixelToTile(this.player.y);
    const nearWhiteboard = this.whiteboardTiles.some(
      (t) => Math.max(Math.abs(t.x - tileX), Math.abs(t.y - tileY)) <= 1,
    );
    this.hint.setVisible(nearWhiteboard);
    if (nearWhiteboard && Phaser.Input.Keyboard.JustDown(this.keyE)) {
      roomEvents.emit('interact:whiteboard');
    }
  }

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
