// Who owns the keyboard, right now.
//
// The world has a canvas underneath and a stack of DOM things on top of it, and
// every one of them wants keys. Before this module each of them took what it
// wanted with its own `window.addEventListener('keydown')` — six listeners,
// three of them in the capture phase specifically to beat the others — and the
// result was three bugs that all had the same shape:
//
//   * Escape inside the whiteboard closed the whole whiteboard, because the
//     panel's handler ran before tldraw's and tldraw uses Escape to deselect.
//   * Pressing "3" in the whiteboard picked a tool AND broadcast an emote,
//     because the emote hotkey only excused itself for INPUT/TEXTAREA and a
//     canvas is neither.
//   * Closing the say bar while the chat panel was open re-enabled Phaser's
//     keyboard, because the "a panel has focus" signal was one boolean that
//     three components set independently. WASD then walked your avatar while
//     you typed.
//
// All three are the same missing idea: layers, in an order, with the top one
// deciding. That is this file. There is exactly ONE keydown listener in the
// world now, installed by `useInputRoot`, and it resolves against this stack.
//
// The rule for Escape, top of the stack downwards:
//
//   1. If the layer has `onEscape` and it returns true, the layer handled it —
//      preventDefault and stop.
//   2. If the layer has `capturesKeys`, stop regardless. Nothing below it sees
//      the key, and we do NOT preventDefault, so it reaches that layer's own
//      DOM. This is how Escape gets to tldraw while the panel stays open.
//   3. Otherwise keep walking down.
//
// Escape therefore peels exactly one layer per press, and the base canvas layer
// — which leaves the world — is reached only when nothing is stacked on it.

export type LayerKind = 'canvas' | 'hud' | 'sidebar' | 'text' | 'modal';

export type LayerSpec = {
  kind: LayerKind;
  /** For debugging and for the DEV snapshot: 'chat-panel', 'whiteboard'. */
  name: string;
  /**
   * True ⇒ this layer owns raw keys: canvas hotkeys stop firing and Phaser's
   * keyboard goes inert while it is up. A layer that hosts a text input or a
   * rich editor must set this.
   */
  capturesKeys?: boolean;
  /**
   * Return true to claim Escape. Returning false/undefined declines it, but a
   * `capturesKeys` layer still stops the walk — declining means "I have nothing
   * to close", not "pass it down to whoever is under me".
   */
  onEscape?: () => boolean | void;
};

export type LayerHandle = {
  /** Remove THIS entry, wherever it now sits in the stack. */
  release(): void;
};

export type InputSnapshot = {
  /** No layer above the base is capturing — hotkeys and Phaser may have keys. */
  canvasOwnsKeys: boolean;
  topKind: LayerKind;
  depth: number;
};

type HotkeyEntry = { keys: ReadonlySet<string>; fn: (e: KeyboardEvent) => void };

/**
 * The minimum of a KeyboardEvent this module needs. Typing it structurally
 * rather than as `KeyboardEvent` is what lets the whole resolver be unit-tested
 * with a plain object and no jsdom.
 */
export type KeyLike = {
  key: string;
  defaultPrevented?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: unknown;
  preventDefault(): void;
  stopPropagation?(): void;
};

const IDLE: InputSnapshot = { canvasOwnsKeys: true, topKind: 'canvas', depth: 0 };

/**
 * Belt and braces over the layer rule: even if someone mounts an input without
 * pushing a `text` layer, typing into it must never fire a world hotkey. The
 * layer stack is the contract; this is the seatbelt.
 */
function isTextEntry(target: unknown): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

class InputLayers {
  private stack: LayerSpec[] = [];
  private hotkeys = new Set<HotkeyEntry>();
  private listeners = new Set<() => void>();
  private snapshot: InputSnapshot = IDLE;

  push(spec: LayerSpec): LayerHandle {
    this.stack.push(spec);
    this.refresh();
    let released = false;
    return {
      release: () => {
        // Identity, not name and not position: two panels of the same kind can
        // be up at once, and they can close in either order.
        if (released) return;
        released = true;
        const at = this.stack.lastIndexOf(spec);
        if (at !== -1) this.stack.splice(at, 1);
        this.refresh();
      },
    };
  }

  /**
   * A key the world responds to while the canvas has focus. Inert the moment
   * anything above the canvas captures keys — which is the whole point.
   */
  registerHotkey(keys: string | readonly string[], fn: (e: KeyboardEvent) => void): () => void {
    const entry: HotkeyEntry = {
      keys: new Set(typeof keys === 'string' ? [keys] : keys),
      fn,
    };
    this.hotkeys.add(entry);
    return () => {
      this.hotkeys.delete(entry);
    };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): InputSnapshot => this.snapshot;

  /** The single keydown resolver. `useInputRoot` is its only caller in the app. */
  handleKeyDown(e: KeyLike): void {
    if (e.defaultPrevented) return;

    if (e.key === 'Escape') {
      for (let i = this.stack.length - 1; i >= 0; i--) {
        const layer = this.stack[i];
        if (!layer) continue;
        if (layer.onEscape?.() === true) {
          e.preventDefault();
          e.stopPropagation?.();
          return;
        }
        // Declined — but a capturing layer still ends the walk. Not preventing
        // the default is deliberate: it is what lets Escape reach tldraw.
        if (layer.capturesKeys) return;
      }
      return;
    }

    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!this.snapshot.canvasOwnsKeys) return;
    if (isTextEntry(e.target)) return;

    for (const entry of this.hotkeys) {
      if (entry.keys.has(e.key)) entry.fn(e as KeyboardEvent);
    }
  }

  /** Test seam. Never call this from app code. */
  reset(): void {
    this.stack = [];
    this.hotkeys.clear();
    this.refresh();
  }

  private refresh(): void {
    const top = this.stack[this.stack.length - 1];
    const next: InputSnapshot = {
      canvasOwnsKeys: !this.stack.some((l) => l.capturesKeys === true),
      topKind: top?.kind ?? 'canvas',
      depth: this.stack.length,
    };
    const prev = this.snapshot;
    // useSyncExternalStore compares by reference, so only publish real changes.
    if (
      prev.canvasOwnsKeys === next.canvasOwnsKeys &&
      prev.topKind === next.topKind &&
      prev.depth === next.depth
    ) {
      return;
    }
    this.snapshot = next;
    this.listeners.forEach((fn) => fn());
  }
}

export const inputLayers = new InputLayers();
