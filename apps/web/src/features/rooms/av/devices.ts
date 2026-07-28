import { useSyncExternalStore } from 'react';
import { reportWarning } from '../../../lib/report.js';

// The microphones, cameras and speakers this browser can see.
//
// A `useSyncExternalStore` module store, like av-store.ts and hud-store.ts —
// device lists change from outside React (a headset is plugged in, a permission
// is granted) and nothing here belongs in component state.
//
// THE thing that makes device enumeration awkward, and the reason this is a
// store rather than one call:
//
//   Before permission is granted, the browser returns devices with EMPTY
//   labels and, in some browsers, a single placeholder entry per kind.
//
// So a picker rendered from a cold `enumerateDevices()` is a list of blank
// rows. That is not a bug to work around — it is the browser refusing to
// fingerprint the user before they have agreed to anything. The store reports
// `labelled` so the UI can ask for permission instead of rendering nonsense.

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export type Device = { deviceId: string; label: string; kind: DeviceKind };

export type DeviceState = {
  mics: Device[];
  cams: Device[];
  speakers: Device[];
  /**
   * True once the browser is willing to name the devices — i.e. permission has
   * been granted at least once. False means "ask before showing a picker".
   */
  labelled: boolean;
  /** False where `navigator.mediaDevices` does not exist (insecure origin). */
  supported: boolean;
};

const EMPTY: DeviceState = { mics: [], cams: [], speakers: [], labelled: false, supported: true };

let state: DeviceState = EMPTY;
const listeners = new Set<() => void>();
let started = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function media(): MediaDevices | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return null;
  return navigator.mediaDevices;
}

async function refresh(): Promise<void> {
  const devices = media();
  if (!devices) {
    state = { ...EMPTY, supported: false };
    emit();
    return;
  }
  try {
    const all = await devices.enumerateDevices();
    const pick = (kind: DeviceKind): Device[] =>
      all
        .filter((d) => d.kind === kind)
        // A device with no id is a placeholder the browser emits pre-permission.
        .filter((d) => d.deviceId !== '')
        .map((d) => ({ deviceId: d.deviceId, label: d.label, kind }));

    const mics = pick('audioinput');
    const cams = pick('videoinput');
    const speakers = pick('audiooutput');
    state = {
      mics,
      cams,
      speakers,
      // Any non-empty label anywhere means permission has been granted. Testing
      // one list is not enough: a machine with a mic and no camera would look
      // unlabelled forever.
      labelled: [...mics, ...cams, ...speakers].some((d) => d.label !== ''),
      supported: true,
    };
    emit();
  } catch (err) {
    reportWarning('rooms: could not enumerate media devices', err);
  }
}

/**
 * Begin watching. Idempotent, and safe to call from an effect.
 *
 * The `devicechange` listener is never removed: the store is a module
 * singleton whose lifetime is the page, and unsubscribing on the last React
 * consumer would mean a device plugged in while the dialog is closed goes
 * unnoticed.
 */
export function startDeviceWatch(): void {
  if (started) return;
  started = true;
  const devices = media();
  if (!devices) {
    state = { ...EMPTY, supported: false };
    emit();
    return;
  }
  devices.addEventListener('devicechange', () => void refresh());
  void refresh();
}

/**
 * Ask for permission, then re-enumerate so the labels arrive.
 *
 * The tracks are stopped immediately. This is a permission prompt, not a
 * capture — leaving the stream open would light the camera indicator on a
 * screen whose whole purpose is deciding whether to turn the camera on.
 *
 * Returns whether permission was granted, so a caller can say so; a refusal is
 * a supported state, not an error.
 */
export async function requestDeviceAccess(kind: 'audio' | 'video' | 'both'): Promise<boolean> {
  const devices = media();
  if (!devices) return false;
  try {
    const stream = await devices.getUserMedia({
      audio: kind !== 'video',
      video: kind !== 'audio',
    });
    for (const track of stream.getTracks()) track.stop();
    await refresh();
    return true;
  } catch (err) {
    reportWarning('rooms: media permission refused', err);
    await refresh();
    return false;
  }
}

export const deviceStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot(): DeviceState {
    return state;
  },
  refresh,
};

export function useDevices(): DeviceState {
  return useSyncExternalStore(deviceStore.subscribe, deviceStore.getSnapshot);
}
