import { inflateSync } from 'node:zlib';
import { Canvas } from './canvas.js';

// Minimal PNG reader, the mirror of png.ts.
//
// Scoped deliberately to what the art pack actually contains: 8-bit RGBA,
// non-interlaced. Every sheet in Modern Interiors is colour type 6 / bit depth
// 8 / interlace 0, verified before writing this. Anything else throws rather
// than silently producing garbage — a decoder that guesses is worse than none.

type Chunk = { type: string; data: Buffer };

function* chunks(buf: Buffer): Generator<Chunk> {
  let at = 8; // past the signature
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    yield { type, data: buf.subarray(at + 8, at + 8 + length) };
    at += 12 + length; // length + type + data + crc
  }
}

/** Paeth predictor, straight from the PNG spec. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): Canvas {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  for (const chunk of chunks(buf)) {
    if (chunk.type === 'IHDR') {
      width = chunk.data.readUInt32BE(0);
      height = chunk.data.readUInt32BE(4);
      const [depth, colour, , , interlace] = [
        chunk.data[8]!,
        chunk.data[9]!,
        chunk.data[10]!,
        chunk.data[11]!,
        chunk.data[12]!,
      ];
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`);
      }
    } else if (chunk.type === 'IDAT') {
      idat.push(chunk.data);
    } else if (chunk.type === 'IEND') {
      break;
    }
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = new Canvas(width, height);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[x] = (line[x]! + a) & 0xff;
          break;
        case 2:
          line[x] = (line[x]! + b) & 0xff;
          break;
        case 3:
          line[x] = (line[x]! + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          line[x] = (line[x]! + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
    }
    line.copy(out.data, y * stride);
    prev = line;
  }
  return out;
}
