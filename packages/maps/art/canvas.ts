// Pixel canvas for the art generators. Everything is integer-addressed RGBA
// with source-over blending, because pixel art is decided one pixel at a time
// and anti-aliasing is the enemy of a crisp 32px tile.

export type RGBA = readonly [number, number, number, number];

export function rgb(hex: string, alpha = 255): RGBA {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha,
  ];
}

/** Deterministic PRNG — the art must be byte-identical on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix two colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const l = (i: number): number => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return [l(0), l(1), l(2), l(3)];
}

/** Lighten (t > 0) or darken (t < 0) towards white/black. */
export function shade(c: RGBA, t: number): RGBA {
  return t >= 0 ? mix(c, [255, 255, 255, c[3]], t) : mix(c, [0, 0, 0, c[3]], -t);
}

export class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  /** Source-over blend of one pixel. Out-of-bounds writes are ignored. */
  set(x: number, y: number, c: RGBA): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const i = (py * this.width + px) * 4;
    const sa = c[3] / 255;
    if (sa >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    if (sa <= 0) return;
    const da = this.data[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      const src = c[k]! * sa;
      const dst = this.data[i + k]! * da * (1 - sa);
      this.data[i + k] = Math.round((src + dst) / oa);
    }
    this.data[i + 3] = Math.round(oa * 255);
  }

  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, c);
    }
  }

  /** Outline only — the 1px border of a rect. */
  frame(x: number, y: number, w: number, h: number, c: RGBA): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  hline(x: number, y: number, w: number, c: RGBA): void {
    this.rect(x, y, w, 1, c);
  }

  vline(x: number, y: number, h: number, c: RGBA): void {
    this.rect(x, y, 1, h, c);
  }

  /**
   * Top/left lit, bottom/right shaded. One light source, upper-left, for every
   * object in the world — the single biggest thing that makes a tileset read
   * as one set rather than a pile of sprites.
   */
  bevel(x: number, y: number, w: number, h: number, light: RGBA, dark: RGBA): void {
    this.hline(x, y, w, light);
    this.vline(x, y, h, light);
    this.hline(x, y + h - 1, w, dark);
    this.vline(x + w - 1, y, h, dark);
  }

  /** Rounded-ish rect: clips the four corner pixels. Reads as soft at 32px. */
  softRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    this.rect(x, y, w, h, c);
    for (const [cx, cy] of [
      [x, y],
      [x + w - 1, y],
      [x, y + h - 1],
      [x + w - 1, y + h - 1],
    ] as const) {
      const i = (cy * this.width + cx) * 4;
      if (cx >= 0 && cy >= 0 && cx < this.width && cy < this.height) this.data[i + 3] = 0;
    }
  }

  /** Scattered single pixels — plank grain, carpet fibre, wall texture. */
  speckle(
    x: number,
    y: number,
    w: number,
    h: number,
    c: RGBA,
    density: number,
    seed: number,
  ): void {
    const r = rng(seed);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (r() < density) this.set(x + dx, y + dy, c);
      }
    }
  }

  /** Contact shadow under furniture: a soft ellipse, always the same recipe. */
  shadow(cx: number, cy: number, rx: number, ry: number, alpha = 60): void {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
        if (d <= 1) this.set(cx + dx, cy + dy, [0, 0, 0, Math.round(alpha * (1 - d * 0.55))]);
      }
    }
  }

  blit(src: Canvas, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c[3] > 0) this.set(dx + x, dy + y, c);
      }
    }
  }
}
