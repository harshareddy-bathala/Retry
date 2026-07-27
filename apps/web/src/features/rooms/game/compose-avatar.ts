import type Phaser from 'phaser';
import { CHARACTER_GEOMETRY, CHARACTER_LAYERS } from '@retry/maps/generated/characters';
import { decodeAvatar, DEFAULT_SPRITE, type AvatarSelection } from '@retry/maps';

// Runtime character compositing.
//
// A character is five pack layers alpha-blended in the documented order
// body → eyes → outfit → hairstyle → accessory. With a full creator the
// combination space is ~300,000, so characters are composited on demand from
// the 768x128 layer strips the asset build ships, cached as one Phaser
// texture per DISTINCT APPEARANCE — the canonical selection string is the
// cache key, so two students wearing the same build share a texture, and a
// room of twenty distinct characters costs ~8 MB of GPU memory.

const GEO = CHARACTER_GEOMETRY;
const STRIP_WIDTH = GEO.columns * GEO.frameWidth;
const STRIP_HEIGHT = GEO.animations.length * GEO.frameHeight;

/**
 * How many composited characters to keep. Each costs ~393 KB of GPU memory
 * (768x128 RGBA), so this is roughly 16 MB — comfortable on the integrated
 * graphics a college laptop actually has, and far more than the ~20 distinct
 * looks a room holds. Without a cap the cache only cleared on scene shutdown,
 * so a busy Commons climbed all session.
 */
const MAX_CACHED_AVATARS = 40;

/** Texture key → when it was last asked for. Insertion order is not enough: a
 *  character present since join is used constantly and must not look oldest. */
const lastUsed = new Map<string, number>();

/** Preload texture key for one layer strip. */
const layerKey = (id: string): string => `charlayer-${id}`;

/** Queue every curated layer strip (~240 KB total). Call from preload(). */
export function preloadCharacterLayers(scene: Phaser.Scene): void {
  for (const entries of Object.values(CHARACTER_LAYERS)) {
    for (const entry of entries) scene.load.image(layerKey(entry.id), entry.url);
  }
}

/** The five layer ids of a selection, in compositing order. Nulls skipped. */
function layerIds(sel: AvatarSelection): string[] {
  return [sel.body, sel.eyes, sel.outfit, sel.hair, sel.accessory].filter(
    (id): id is string => id !== null,
  );
}

/**
 * Composite (or fetch from cache) the texture for a wire sprite string and
 * make sure its animations exist. Invalid strings — a peer on a newer
 * catalogue, junk — render as the default character rather than nothing.
 * Returns the texture key, which is also the animation-key infix.
 */
export function ensureAvatarTexture(scene: Phaser.Scene, sprite: string): string {
  const sel = decodeAvatar(sprite) ?? decodeAvatar(DEFAULT_SPRITE);
  if (!sel) throw new Error('DEFAULT_SPRITE does not decode — catalogue broken');
  const canonical = decodeAvatar(sprite) ? sprite : DEFAULT_SPRITE;
  const key = `char-${canonical}`;
  lastUsed.set(key, performance.now());
  if (scene.textures.exists(key)) return key;

  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = STRIP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  for (const id of layerIds(sel)) {
    const source = scene.textures.get(layerKey(id)).getSourceImage();
    // Phaser's source image is a decoded HTMLImageElement for image loads;
    // the RenderTexture variant would force this through the GL pipeline for
    // no benefit at 768x128.
    ctx.drawImage(source as CanvasImageSource, 0, 0);
  }

  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) throw new Error(`texture key collision for ${key}`);
  let frame = 0;
  for (let row = 0; row < GEO.animations.length; row++) {
    for (let col = 0; col < GEO.columns; col++) {
      texture.add(frame++, 0, col * GEO.frameWidth, row * GEO.frameHeight, GEO.frameWidth, GEO.frameHeight);
    }
  }

  // One clip per animation row per facing: idle-<key>-left, walk-<key>-down…
  GEO.animations.forEach((anim, row) => {
    GEO.directions.forEach((dir, d) => {
      const start = row * GEO.columns + d * GEO.framesPerDirection;
      scene.anims.create({
        key: `${anim.key}-${key}-${dir}`,
        frames: Array.from({ length: anim.frames }, (_, i) => ({ key, frame: start + i })),
        frameRate: anim.frameRate,
        repeat: -1,
      });
    });
  });

  return key;
}

/** Every animation clip key generated alongside one composited texture. */
function animKeysFor(textureKey: string): string[] {
  return GEO.animations.flatMap((anim) =>
    GEO.directions.map((dir) => `${anim.key}-${textureKey}-${dir}`),
  );
}

/**
 * Drop the least-recently-used characters once the cache is over budget.
 * `inUse` is every texture currently worn by somebody on screen — evicting one
 * of those would blank a live sprite, so they are never candidates however old
 * they are. Call this whenever the set of actors changes.
 */
export function pruneAvatarTextures(scene: Phaser.Scene, inUse: ReadonlySet<string>): void {
  if (lastUsed.size <= MAX_CACHED_AVATARS) return;
  const candidates = [...lastUsed.entries()]
    .filter(([key]) => !inUse.has(key))
    .sort((a, b) => a[1] - b[1]);
  let over = lastUsed.size - MAX_CACHED_AVATARS;
  for (const [key] of candidates) {
    if (over <= 0) break;
    // The clips reference the texture's frames; leaving them behind would leak
    // the animation keys and resurrect a dead texture on the next play().
    for (const animKey of animKeysFor(key)) scene.anims.remove(animKey);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    lastUsed.delete(key);
    over -= 1;
  }
}

/**
 * Forget everything. The textures themselves belong to the scene and die with
 * it; this clears the bookkeeping that would otherwise outlive them and make
 * the next scene think it had a cache it does not have.
 */
export function resetAvatarTextureCache(): void {
  lastUsed.clear();
}

/** First frame of an animation row facing `dir` — for sprites created at rest. */
export function frameFor(animKey: (typeof GEO.animations)[number]['key'], dir: string): number {
  const row = GEO.animations.findIndex((a) => a.key === animKey);
  const d = (GEO.directions as readonly string[]).indexOf(dir);
  return Math.max(0, row) * GEO.columns + Math.max(0, d) * GEO.framesPerDirection;
}
