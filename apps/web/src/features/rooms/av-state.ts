// Local mic/camera intent, persisted so it survives a reload and a door.
//
// `audio`/`video` are what the student has ASKED for; whether a track is
// actually publishing is the AV manager's business, and whether anyone can hear
// it is the proximity engine's.
export type AvState = {
  audio: boolean;
  video: boolean;
  /** Chosen input/output devices. Absent means "whatever the browser picks". */
  micId?: string;
  camId?: string;
  speakerId?: string;
};

const STORAGE_KEY = 'retry.rooms.av';

/**
 * Mic and camera both start OFF, and this is the most consequential default in
 * the AV code.
 *
 * They used to default ON, which was harmless for exactly as long as no LiveKit
 * server existed: `setMicrophoneEnabled(true)` on a manager that never connects
 * publishes nothing. The moment one exists — which is now — that default means
 * every student who opens a room starts broadcasting their microphone and
 * camera without having agreed to anything.
 *
 * Nobody should ever be unknowingly live. The pre-join screen is where consent
 * is given, and the dock is one click away afterwards.
 */
const DEFAULT: AvState = { audio: false, video: false };

/**
 * Read persisted intent.
 *
 * The stored shape grew from `{audio, video}` to carry device ids, and the key
 * is deliberately NOT versioned: a student holding the old two-field shape
 * should keep their preferences rather than be silently reset. Anything missing
 * or malformed falls back to the default, field by field.
 */
export function loadAvState(): AvState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<AvState>;
    const id = (value: unknown): string | undefined =>
      typeof value === 'string' && value !== '' ? value : undefined;
    const micId = id(parsed.micId);
    const camId = id(parsed.camId);
    const speakerId = id(parsed.speakerId);
    return {
      // `=== true`, not `!== false`. The old idiom read a MISSING key as on,
      // which is the behaviour this change exists to remove — and a student
      // whose stored value predates device ids has exactly that shape.
      audio: parsed.audio === true,
      video: parsed.video === true,
      ...(micId ? { micId } : {}),
      ...(camId ? { camId } : {}),
      ...(speakerId ? { speakerId } : {}),
    };
  } catch {
    // Corrupt storage falls through to the default.
    return DEFAULT;
  }
}

export function saveAvState(state: AvState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/blocked — the toggle still works for this session.
  }
}
