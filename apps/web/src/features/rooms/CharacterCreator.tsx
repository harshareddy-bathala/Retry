import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AVATAR_PRESETS,
  decodeAvatar,
  DEFAULT_SPRITE,
  encodeAvatar,
  type AvatarSelection,
} from '@retry/maps';
import { CHARACTER_GEOMETRY, CHARACTER_LAYERS } from '@retry/maps/generated/characters';
import { Button } from '../../components/ui/button.js';
import { Dialog } from '../../components/ui/dialog.js';
import { cn } from '../../lib/cn.js';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';

// The character creator (FR-ROOM-24, grown from six presets into a builder).
// Opens the first time a student enters any live space — the server answers
// "have you ever chosen?", because they may have built a character months ago
// on another device — and again from the HUD whenever they want a new look.
//
// The preview IS the product: a live, walking composite of the five pack
// layers, drawn the same way the world will draw it.

const GEO = CHARACTER_GEOMETRY;
const SCALE = 3;
// Walk row, facing the viewer (down), for the preview loop.
const WALK_ROW = GEO.animations.findIndex((a) => a.key === 'walk');
const DOWN_GROUP = (GEO.directions as readonly string[]).indexOf('down');
const WALK_RATE = GEO.animations[Math.max(0, WALK_ROW)]?.frameRate ?? 8;

type LayerKey = keyof typeof CHARACTER_LAYERS;
const LAYER_ORDER: LayerKey[] = ['body', 'eyes', 'outfit', 'hair', 'accessory'];
const OPTIONAL_LAYERS: ReadonlySet<LayerKey> = new Set(['hair', 'accessory'] as LayerKey[]);
const LAYER_TITLES: Record<LayerKey, string> = {
  body: 'Skin',
  eyes: 'Eyes',
  outfit: 'Outfit',
  hair: 'Hair',
  accessory: 'Extra',
};

// Layer strips load once per page and are shared with everything else that
// draws characters (the browser cache holds the same bundled URLs Phaser uses).
const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadLayerImage(url: string): Promise<HTMLImageElement> {
  let cached = imageCache.get(url);
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
    imageCache.set(url, cached);
  }
  return cached;
}

function urlFor(layer: LayerKey, id: string | null): string | null {
  if (id === null) return null;
  return CHARACTER_LAYERS[layer].find((e) => e.id === id)?.url ?? null;
}

function selectionUrls(sel: AvatarSelection): string[] {
  return LAYER_ORDER.map((layer) => urlFor(layer, sel[layer])).filter(
    (u): u is string => u !== null,
  );
}

export function CharacterCreator() {
  const [open, setOpen] = useState(false);
  /** Whether the server knows a saved character (controls Cancel vs must-save). */
  const [chosen, setChosen] = useState(false);
  const [selection, setSelection] = useState<AvatarSelection>(
    () => decodeAvatar(DEFAULT_SPRITE) ?? AVATAR_PRESETS[0]!.selection,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t !== 'avatarState') return;
        const sel = decodeAvatar(msg.sprite);
        if (sel) setSelection(sel);
        setChosen(msg.chosen);
        if (!msg.chosen) setOpen(true);
      }),
    [],
  );
  useEffect(() => roomEvents.on('creator:open', () => setOpen(true)), []);

  const urls = useMemo(() => selectionUrls(selection), [selection]);

  // The live preview: composite the five strips, then step the walk cycle.
  useEffect(() => {
    if (!open) return;
    let stop = false;
    let raf = 0;
    void Promise.all(urls.map(loadLayerImage)).then((images) => {
      if (stop) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.imageSmoothingEnabled = false;
      const started = performance.now();
      const draw = (now: number): void => {
        if (stop) return;
        const step = Math.floor(((now - started) / 1000) * WALK_RATE) % GEO.framesPerDirection;
        const sx = (DOWN_GROUP * GEO.framesPerDirection + step) * GEO.frameWidth;
        const sy = Math.max(0, WALK_ROW) * GEO.frameHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const img of images) {
          ctx.drawImage(
            img,
            sx,
            sy,
            GEO.frameWidth,
            GEO.frameHeight,
            0,
            0,
            GEO.frameWidth * SCALE,
            GEO.frameHeight * SCALE,
          );
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    });
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [open, urls]);

  const cycle = useCallback(
    (layer: LayerKey, delta: number): void => {
      setSelection((prev) => {
        const options: Array<string | null> = CHARACTER_LAYERS[layer].map((e) => e.id);
        if (OPTIONAL_LAYERS.has(layer)) options.unshift(null);
        const at = options.indexOf(prev[layer]);
        const next = options[(at + delta + options.length) % options.length] ?? options[0]!;
        return { ...prev, [layer]: next };
      });
    },
    [setSelection],
  );

  const labelFor = (layer: LayerKey): string => {
    const id = selection[layer];
    if (id === null) return 'None';
    return CHARACTER_LAYERS[layer].find((e) => e.id === id)?.label ?? id;
  };

  const save = (): void => {
    roomSocket.send({ t: 'avatar', sprite: encodeAvatar(selection) });
    setChosen(true);
    setOpen(false);
  };

  return (
    // A real dialog: focus is trapped, the background is inert, and focus
    // returns to whatever opened it. This used to be a bare `absolute inset-0`
    // div with a scrim — Tab from behind it walked straight through to the
    // Leave link and the presence chips underneath.
    //
    // `dismissible` is false until a character has been chosen. On a first-ever
    // entry there is nothing to cancel back to, and letting Escape or an
    // outside click close it would leave the student in the world as nobody.
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && chosen) setOpen(false);
      }}
      dismissible={chosen}
      title="Build your character"
      description="This is you in every room. You can change it any time from the world."
      className="w-[min(36rem,calc(100vw-2rem))]"
    >
      <div>
        <div className="flex gap-5">
          <div className="flex shrink-0 items-start justify-center rounded-card border border-edge bg-page p-3">
            <canvas
              ref={canvasRef}
              width={GEO.frameWidth * SCALE}
              height={GEO.frameHeight * SCALE}
              style={{ imageRendering: 'pixelated' }}
              aria-label="Character preview"
            />
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            {LAYER_ORDER.map((layer) => (
              <div key={layer} className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {LAYER_TITLES[layer]}
                </span>
                <button
                  type="button"
                  onClick={() => cycle(layer, -1)}
                  aria-label={`Previous ${LAYER_TITLES[layer]}`}
                  className="rounded-card border border-edge px-2 py-1 text-sm text-ink-muted hover:border-accent/60 hover:text-ink"
                >
                  ‹
                </button>
                <span className="min-w-0 flex-1 truncate text-center text-sm text-ink">
                  {labelFor(layer)}
                </span>
                <button
                  type="button"
                  onClick={() => cycle(layer, 1)}
                  aria-label={`Next ${LAYER_TITLES[layer]}`}
                  className="rounded-card border border-edge px-2 py-1 text-sm text-ink-muted hover:border-accent/60 hover:text-ink"
                >
                  ›
                </button>
              </div>
            ))}

            <div className="pt-2">
              <p className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                Starting points
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {AVATAR_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    title={preset.blurb}
                    onClick={() => setSelection(preset.selection)}
                    className={cn(
                      'rounded-card border px-2 py-1 text-xs transition-colors',
                      encodeAvatar(preset.selection) === encodeAvatar(selection)
                        ? 'border-accent bg-accent-tint text-ink'
                        : 'border-edge text-ink-muted hover:border-accent/60 hover:text-ink',
                    )}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {chosen && (
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )}
          <Button onClick={save}>{chosen ? 'Save' : "That's me"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
