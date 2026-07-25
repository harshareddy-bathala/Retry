import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  parseClientMessage,
  parseServerMessage,
  pixelToTile,
  tileToPixel,
  tileToPixelCenter,
} from '../src/index.js';

describe('parseClientMessage', () => {
  it('accepts every valid client message shape', () => {
    const messages = [
      { t: 'join', mapId: 'studio_a' },
      { t: 'join' }, // bare join = spawn resolution / resync (Phase 4)
      { t: 'join', mapId: 'studio_a', displayName: 'Asha', sprite: 'default' },
      { t: 'move', x: 3, y: 4, dir: 'left', moving: true },
      { t: 'leave' },
      { t: 'chat', body: 'hello' },
      { t: 'media', audio: false, video: true },
      { t: 'transition', toMapId: 'commons' },
      { t: 'knockRespond', requestId: 'r1', grant: true },
      { t: 'knockCancel', requestId: 'r1' },
    ];
    for (const m of messages) {
      const result = parseClientMessage(JSON.stringify(m));
      expect(result.ok, `expected ${m.t} to parse`).toBe(true);
      if (result.ok) expect(result.message).toEqual(m);
    }
  });

  it('accepts binary frames (Uint8Array)', () => {
    const raw = new TextEncoder().encode(JSON.stringify({ t: 'leave' }));
    expect(parseClientMessage(raw)).toEqual({ ok: true, message: { t: 'leave' } });
  });

  it('rejects invalid JSON without throwing', () => {
    const result = parseClientMessage('{not json');
    expect(result).toEqual({ ok: false, error: 'invalid JSON' });
  });

  it('rejects an unknown discriminator', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'teleport', x: 0, y: 0 })).ok).toBe(false);
  });

  it('rejects a known discriminator with a bad payload', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'move', x: 'three' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'join', mapId: '' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'chat', body: '' })).ok).toBe(false);
  });

  it('rejects non-object frames', () => {
    expect(parseClientMessage('"join"').ok).toBe(false);
    expect(parseClientMessage('42').ok).toBe(false);
    expect(parseClientMessage('null').ok).toBe(false);
  });
});

describe('parseServerMessage', () => {
  it('accepts a snapshot with zero actors', () => {
    const result = parseServerMessage(
      JSON.stringify({ t: 'snapshot', mapId: 'studio_a', template: 'studio_a', actors: [] }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a snapshot with actors and every other server shape', () => {
    const actor = {
      userId: 'u1',
      displayName: 'Asha',
      sprite: 'sprite_01',
      x: 5,
      y: 7,
      dir: 'down',
      moving: false,
      audio: true,
      video: false,
    };
    const messages = [
      { t: 'snapshot', mapId: 'studio_a', template: 'studio_a', actors: [actor] },
      { t: 'actorJoin', actor },
      { t: 'actorMove', userId: 'u1', x: 6, y: 7, dir: 'right', moving: true },
      { t: 'actorLeave', userId: 'u1' },
      { t: 'proximity', pairs: [{ userId: 'u2', zone: 'close' }] },
      { t: 'mediaState', userId: 'u1', audio: false, video: true },
      {
        t: 'doors',
        doors: [
          { slot: 0, x: 3, y: 0 },
          {
            slot: 1,
            x: 7,
            y: 0,
            room: { roomId: 'r1', roomName: 'Lab', accessPolicy: 'knock', occupancy: 2 },
          },
        ],
      },
      { t: 'knock', requestId: 'req1', roomId: 'r1', roomName: 'Lab', requesterName: 'Asha' },
      { t: 'knockPending', requestId: 'req1', roomId: 'r1', roomName: 'Lab' },
      { t: 'knockResult', requestId: 'req1', status: 'granted' },
      {
        t: 'avToken',
        mapId: 'commons',
        roomUrl: 'https://retry.daily.co/retry-commons',
        token: 'jwt-token',
      },
      { t: 'error', code: 'ROOM_FULL', message: 'Room is full' },
    ];
    for (const m of messages) {
      expect(parseServerMessage(JSON.stringify(m)).ok, `expected ${m.t} to parse`).toBe(true);
    }
  });

  it('rejects an actor missing required fields', () => {
    const result = parseServerMessage(
      JSON.stringify({ t: 'actorJoin', actor: { userId: 'u1' } }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('coords', () => {
  it('uses 32px tiles', () => {
    expect(TILE_SIZE).toBe(32);
  });

  it('converts tiles to pixels and back', () => {
    expect(tileToPixel(0)).toBe(0);
    expect(tileToPixel(5)).toBe(160);
    expect(tileToPixelCenter(5)).toBe(176);
    expect(pixelToTile(160)).toBe(5);
    expect(pixelToTile(191)).toBe(5);
    expect(pixelToTile(192)).toBe(6);
  });

  it('round-trips: a pixel anywhere inside a tile maps back to that tile', () => {
    for (const tile of [0, 1, 7, 19]) {
      expect(pixelToTile(tileToPixel(tile))).toBe(tile);
      expect(pixelToTile(tileToPixelCenter(tile))).toBe(tile);
      expect(pixelToTile(tileToPixel(tile + 1) - 1)).toBe(tile);
    }
  });
});
