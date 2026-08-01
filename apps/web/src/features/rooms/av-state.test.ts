import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAvState, saveAvState } from './av-state.js';

// The persisted AV shape, which changed twice in one commit: it gained device
// ids, and its default flipped from on to off. Both are the kind of change
// whose failure is silent — a student either loses settings they had, or
// starts broadcasting without asking to.
//
// No jsdom: a tiny localStorage stand-in is enough, and keeps this in the same
// no-environment vitest run as input-layers.test.ts.

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const KEY = 'retry.rooms.av';

describe('loadAvState', () => {
  it('defaults to muted and dark with nothing stored', () => {
    // The whole point of the change: no stored preference must never mean
    // "publish my microphone".
    expect(loadAvState()).toEqual({ audio: false, video: false });
  });

  it('reads a stored preference back', () => {
    store.set(KEY, JSON.stringify({ audio: true, video: false }));
    expect(loadAvState()).toEqual({ audio: true, video: false });
  });

  it('treats the OLD two-field shape as off, not as on', () => {
    // The previous reader used `parsed.audio !== false`, so a shape with the
    // key missing came back ON. Every student carrying a pre-devices value has
    // exactly this shape, and the day a LiveKit server exists that idiom is the
    // difference between muted and broadcasting.
    store.set(KEY, JSON.stringify({ video: true }));
    expect(loadAvState().audio).toBe(false);
  });

  it('keeps device ids through a round trip', () => {
    saveAvState({ audio: true, video: true, micId: 'mic-1', camId: 'cam-1', speakerId: 'spk-1' });
    expect(loadAvState()).toEqual({
      audio: true,
      video: true,
      micId: 'mic-1',
      camId: 'cam-1',
      speakerId: 'spk-1',
    });
  });

  it('drops empty and non-string device ids rather than storing them', () => {
    // '' is what an unavailable device enumerates as; passing it to
    // switchActiveDevice throws rather than falling back.
    store.set(KEY, JSON.stringify({ audio: true, video: false, micId: '', camId: 7 }));
    expect(loadAvState()).toEqual({ audio: true, video: false });
  });

  it('does not lose the old shape entirely — video survives the migration', () => {
    // Not versioning the key is deliberate: a student's other preferences must
    // come through, or "we changed the default" becomes "we reset everyone".
    store.set(KEY, JSON.stringify({ audio: true, video: true }));
    expect(loadAvState()).toEqual({ audio: true, video: true });
  });

  it('falls back to the default on corrupt storage', () => {
    store.set(KEY, 'not json');
    expect(loadAvState()).toEqual({ audio: false, video: false });
  });
});
