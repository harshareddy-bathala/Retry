// Local mic/camera toggle state (rooms build plan Phase 3, SRS FR-ROOM-21):
// persists in localStorage and is restored on rejoin. No real capture happens
// until AV lands in Phase 5 — this is the state the badges and future
// tracks key off.
export type AvState = { audio: boolean; video: boolean };

const STORAGE_KEY = 'retry.rooms.av';

export function loadAvState(): AvState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AvState>;
      return { audio: parsed.audio !== false, video: parsed.video !== false };
    }
  } catch {
    // Corrupt storage falls through to the default.
  }
  return { audio: true, video: true };
}

export function saveAvState(state: AvState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/blocked — the toggle still works for this session.
  }
}
