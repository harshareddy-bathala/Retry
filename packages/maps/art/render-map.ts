import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas } from './canvas.js';
import { decodePng } from './png-decode.js';

// Renders a committed map to a pixel canvas exactly as the game layers it, so a
// bad tile pick is visible before a browser ever loads the map. This is the only
// feedback loop map authoring has — there is no generator to check the work.
//
// Multi-tileset gids resolve through each map's own firstgid table. Maps pin
// their own firstgids, so this can never be simplified to "one sheet at 1".

export const TILE = 32;

// The order Phaser stacks them. `collision` is deliberately absent: it is
// invisible in game, and drawing it here would hide the room behind wall tiles.
const DRAW_ORDER = ['ground', 'ground_overlay', 'objects', 'objects_above'];

type TilesetRef = {
  name: string;
  firstgid: number;
  image: string;
  columns: number;
  tilecount: number;
};
type TileLayer = { type: 'tilelayer'; name: string; data: number[]; visible: boolean };
type MapJson = {
  width: number;
  height: number;
  tilesets: TilesetRef[];
  layers: Array<TileLayer | { type: string; name: string }>;
};

export type RenderedMap = { canvas: Canvas; width: number; height: number };

export function renderMap(root: string, name: string, scale = 1): RenderedMap {
  const mapDir = resolve(root, 'maps');
  const map = JSON.parse(readFileSync(resolve(mapDir, `${name}.json`), 'utf8')) as MapJson;

  const sheets = map.tilesets
    .map((t) => ({ ...t, pixels: decodePng(readFileSync(resolve(mapDir, t.image))) }))
    .sort((a, b) => a.firstgid - b.firstgid);

  const flat = new Canvas(map.width * TILE, map.height * TILE);

  for (const layerName of DRAW_ORDER) {
    const layer = map.layers.find(
      (l): l is TileLayer => l.type === 'tilelayer' && l.name === layerName,
    );
    if (!layer) continue;
    layer.data.forEach((gid, i) => {
      if (gid === 0) return;
      const sheet = [...sheets].reverse().find((s) => gid >= s.firstgid);
      if (!sheet) throw new Error(`${name}: gid ${gid} matches no tileset`);
      const local = gid - sheet.firstgid;
      const sx = (local % sheet.columns) * TILE;
      const sy = Math.floor(local / sheet.columns) * TILE;
      const dx = (i % map.width) * TILE;
      const dy = Math.floor(i / map.width) * TILE;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const c = sheet.pixels.get(sx + x, sy + y);
          if (c[3] > 0) flat.set(dx + x, dy + y, c);
        }
      }
    });
  }

  if (scale === 1) return { canvas: flat, width: map.width, height: map.height };

  const scaled = new Canvas(flat.width * scale, flat.height * scale);
  for (let y = 0; y < scaled.height; y++) {
    for (let x = 0; x < scaled.width; x++) {
      scaled.set(x, y, flat.get(Math.floor(x / scale), Math.floor(y / scale)));
    }
  }
  return { canvas: scaled, width: map.width, height: map.height };
}
