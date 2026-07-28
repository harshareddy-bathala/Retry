import type { Zone } from '@retry/protocol';
import type { ZoneKind } from '@retry/maps';

// Server-side proximity engine (rooms build plan Phase 3, SRS Appendix 11.4).
// Distances are Euclidean, in TILE units, over server-authoritative positions.
//
// The two guards below are what keep a user standing on a zone boundary from
// strobing in and out of a call — the plan calls this the single most common
// failure in Gather-like clones:
//   * Hysteresis: a pair ENTERS a closer zone at the threshold but only EXITS
//     at threshold + 0.5 tiles.
//   * Debounce: a pair must hold a new zone for 300 ms before the transition
//     is emitted.

export const CLOSE_TILES = 2;
export const NEAR_TILES = 5;
export const EXIT_HYSTERESIS_TILES = 0.5;
export const DEBOUNCE_MS = 300;

export type PairChange = { mapId: string; a: string; b: string; zone: Zone };

type PairState = { zone: Zone; pending: { zone: Zone; since: number } | null };

/**
 * A user's position, plus the server-side zone they are standing in.
 *
 * The zone travels WITH the position rather than being looked up in here,
 * because this module deliberately knows nothing about maps — which is what
 * makes the hysteresis and debounce rules testable with plain numbers.
 */
type Position = {
  userId: string;
  x: number;
  y: number;
  zone?: ZoneKind | null;
  /** Which booth — two people in DIFFERENT booths are out, not close. */
  zoneName?: string | null;
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The zone a pair should be in, before hysteresis and debounce.
 *
 * Map zones override distance entirely, and their precedence is the whole
 * design:
 *
 *   quiet      wins over everything. Someone who walked into the quiet corner
 *              asked not to be in a call, and no stage and no booth overrides
 *              a person's own choice.
 *   spotlight  beats distance in the other direction: a presenter on the stage
 *              is `close` to the entire map. Without this, demo day does not
 *              work at all — proximity audio makes a presenter five tiles from
 *              the back row inaudible to it.
 *   booth      is mutual and exclusive. Two people in the SAME booth are
 *              close; a booth occupant and anyone outside it are out, however
 *              near they stand. That is what makes a booth a room.
 *
 * Distance, with the hysteresis that stops a boundary-straddler strobing, is
 * what happens when no zone has an opinion.
 */
function targetZone(
  current: Zone,
  distance: number,
  a?: ZoneKind | null,
  b?: ZoneKind | null,
  aName?: string | null,
  bName?: string | null,
): Zone {
  if (a === 'quiet' || b === 'quiet') return 'out';
  if (a === 'spotlight' || b === 'spotlight') return 'close';
  if (a === 'booth' || b === 'booth') {
    return a === 'booth' && b === 'booth' && aName === bName ? 'close' : 'out';
  }
  if (distance <= CLOSE_TILES) return 'close';
  if (current === 'close' && distance <= CLOSE_TILES + EXIT_HYSTERESIS_TILES) return 'close';
  if (distance <= NEAR_TILES) return 'near';
  if (current !== 'out' && distance <= NEAR_TILES + EXIT_HYSTERESIS_TILES) return 'near';
  return 'out';
}

/** Advance one pair toward `target`; returns true when a transition commits. */
function advance(state: PairState, target: Zone, now: number): boolean {
  if (target === state.zone) {
    state.pending = null;
    return false;
  }
  if (!state.pending || state.pending.zone !== target) {
    state.pending = { zone: target, since: now };
    return false;
  }
  if (now - state.pending.since >= DEBOUNCE_MS) {
    state.zone = target;
    state.pending = null;
    return true;
  }
  return false;
}

export class ProximityEngine {
  private maps = new Map<string, Map<string, PairState>>();

  /**
   * Re-evaluate every pair involving `movedUserId` against current positions.
   * O(actors) per call — measured under 5ms for 20 actors (see perf test).
   */
  update(mapId: string, movedUserId: string, actors: Position[], now: number): PairChange[] {
    const moved = actors.find((a) => a.userId === movedUserId);
    if (!moved) return [];
    let pairs = this.maps.get(mapId);
    if (!pairs) {
      pairs = new Map();
      this.maps.set(mapId, pairs);
    }

    const changes: PairChange[] = [];
    for (const other of actors) {
      if (other.userId === movedUserId) continue;
      const key = pairKey(movedUserId, other.userId);
      let state = pairs.get(key);
      if (!state) {
        state = { zone: 'out', pending: null };
        pairs.set(key, state);
      }
      const distance = Math.hypot(moved.x - other.x, moved.y - other.y);
      const target = targetZone(
        state.zone,
        distance,
        moved.zone,
        other.zone,
        moved.zoneName,
        other.zoneName,
      );
      if (advance(state, target, now)) {
        changes.push({ mapId, a: movedUserId, b: other.userId, zone: state.zone });
        if (state.zone === 'out') pairs.delete(key);
      }
    }
    return changes;
  }

  /**
   * Commit pending transitions whose debounce elapsed. Positions cannot have
   * drifted since the pending was recorded: the server only moves actors
   * through update(), which re-evaluates (and resets) pendings.
   */
  settle(now: number): PairChange[] {
    const changes: PairChange[] = [];
    for (const [mapId, pairs] of this.maps) {
      for (const [key, state] of pairs) {
        if (!state.pending || now - state.pending.since < DEBOUNCE_MS) continue;
        state.zone = state.pending.zone;
        state.pending = null;
        const [a, b] = key.split('|') as [string, string];
        changes.push({ mapId, a, b, zone: state.zone });
        if (state.zone === 'out') pairs.delete(key);
      }
    }
    return changes;
  }

  /** Committed non-out zones for one user — resent alongside resync snapshots. */
  zonesFor(mapId: string, userId: string): Array<{ userId: string; zone: Zone }> {
    const pairs = this.maps.get(mapId);
    if (!pairs) return [];
    const zones: Array<{ userId: string; zone: Zone }> = [];
    for (const [key, state] of pairs) {
      if (state.zone === 'out') continue;
      const [a, b] = key.split('|') as [string, string];
      if (a === userId) zones.push({ userId: b, zone: state.zone });
      else if (b === userId) zones.push({ userId: a, zone: state.zone });
    }
    return zones;
  }

  /** Drop every pair involving a departed actor, emitting 'out' for any that were visible. */
  removeActor(mapId: string, userId: string): PairChange[] {
    const pairs = this.maps.get(mapId);
    if (!pairs) return [];
    const changes: PairChange[] = [];
    for (const [key, state] of pairs) {
      const [a, b] = key.split('|') as [string, string];
      if (a !== userId && b !== userId) continue;
      if (state.zone !== 'out') changes.push({ mapId, a, b, zone: 'out' });
      pairs.delete(key);
    }
    return changes;
  }
}
