import { useSyncExternalStore } from 'react';

// Everything the world needs to tell you, in one ordered place.
//
// There used to be three: a connection banner at top-centre, an eviction notice
// at top-centre 16px lower, and a knock card also at top-centre. Reconnecting
// while knocking drew two of them on top of each other and the knock card won
// on z-index. A queue with one region cannot do that, and — because it is one
// region — it can also be a single aria-live area, where before the only
// announced element in the whole app was the AV status line.

export type ToastTone = 'info' | 'warn' | 'danger';

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  /** Stable per subject: re-notifying replaces rather than stacks. */
  id: string;
  tone: ToastTone;
  body: string;
  action?: ToastAction;
  /** Absent = sticky until dismissed or replaced. */
  ttlMs?: number;
  dismissible?: boolean;
};

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish(next: Toast[]): void {
  toasts = next;
  listeners.forEach((fn) => fn());
}

function clearTimer(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

export const toastStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot(): Toast[] {
    return toasts;
  },
  /** Add or replace by id. Order is oldest-first, so nothing jumps around. */
  show(toast: Toast): void {
    clearTimer(toast.id);
    const at = toasts.findIndex((t) => t.id === toast.id);
    publish(at === -1 ? [...toasts, toast] : toasts.map((t) => (t.id === toast.id ? toast : t)));
    if (toast.ttlMs !== undefined) {
      timers.set(
        toast.id,
        setTimeout(() => toastStore.dismiss(toast.id), toast.ttlMs),
      );
    }
  },
  dismiss(id: string): void {
    clearTimer(id);
    if (!toasts.some((t) => t.id === id)) return;
    publish(toasts.filter((t) => t.id !== id));
  },
  clear(): void {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    if (toasts.length > 0) publish([]);
  },
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot);
}
