// Emote keys — the shared contract between the picker, the wire protocol and
// the room server's validation.
//
// The KEYS live here, derived from the same catalogue the asset build crops
// the strip from. The strip itself (and its frame offsets) is generated and
// imports a PNG, so it belongs to the client alone: the room server validates
// emotes and must never pull pixels into its bundle to do it. Same split as
// avatars — `assets.config.ts` is plain data with no image imports, so both
// sides can read it.

import { EMOTES } from '../assets.config.js';

/** Every emote a client may send, in picker order. */
export const EMOTE_KEYS: readonly string[] = EMOTES.map((e) => e.key);

/**
 * Whitelist check for a key off the wire. Without this a client could
 * broadcast any string and every other client would try to render it — the
 * exact hole `sprite` had before it was validated.
 */
export function isEmoteKey(value: string): boolean {
  return EMOTE_KEYS.includes(value);
}
