import { describe, expect, it } from 'vitest';
import {
  AVATAR_LAYER_IDS,
  AVATAR_PRESETS,
  decodeAvatar,
  DEFAULT_SPRITE,
  encodeAvatar,
  isAvatarSprite,
  MAX_SPRITE_LENGTH,
} from '../src/avatars.js';

describe('avatar selection codec', () => {
  it('round-trips a full selection', () => {
    const sel = {
      body: 'body_03',
      eyes: 'eyes_02',
      outfit: 'outfit_07',
      hair: 'hair_04_04',
      accessory: 'acc_11',
    };
    expect(decodeAvatar(encodeAvatar(sel))).toEqual(sel);
  });

  it('round-trips empty hair and accessory as null', () => {
    const sel = { body: 'body_01', eyes: 'eyes_01', outfit: 'outfit_01', hair: null, accessory: null };
    const encoded = encodeAvatar(sel);
    expect(encoded).toBe('body_01|eyes_01|outfit_01||');
    expect(decodeAvatar(encoded)).toEqual(sel);
  });

  it('rejects unknown layer ids, wrong shapes and junk', () => {
    expect(decodeAvatar('body_99|eyes_01|outfit_01||')).toBeNull();
    expect(decodeAvatar('body_01|eyes_01|outfit_01|')).toBeNull(); // 4 segments
    expect(decodeAvatar('body_01|eyes_01|outfit_01|hair_01_01|acc_01|x')).toBeNull(); // 6
    expect(decodeAvatar('|eyes_01|outfit_01||')).toBeNull(); // required layer empty
    expect(decodeAvatar('maker')).toBeNull(); // the old preset keys are not selections
    expect(decodeAvatar(42)).toBeNull();
    expect(decodeAvatar(null)).toBeNull();
  });

  it('every preset encodes to a valid selection', () => {
    for (const preset of AVATAR_PRESETS) {
      expect(isAvatarSprite(encodeAvatar(preset.selection)), preset.key).toBe(true);
    }
  });

  it('the default sprite is valid and the longest id combination fits the wire bound', () => {
    expect(isAvatarSprite(DEFAULT_SPRITE)).toBe(true);
    const longest = encodeAvatar({
      body: [...AVATAR_LAYER_IDS.body].sort((a, b) => b.length - a.length)[0]!,
      eyes: [...AVATAR_LAYER_IDS.eyes].sort((a, b) => b.length - a.length)[0]!,
      outfit: [...AVATAR_LAYER_IDS.outfit].sort((a, b) => b.length - a.length)[0]!,
      hair: [...AVATAR_LAYER_IDS.hair].sort((a, b) => b.length - a.length)[0]!,
      accessory: [...AVATAR_LAYER_IDS.accessory].sort((a, b) => b.length - a.length)[0]!,
    });
    expect(longest.length).toBeLessThanOrEqual(MAX_SPRITE_LENGTH);
  });
});
