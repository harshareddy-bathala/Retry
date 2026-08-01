import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inputLayers, type KeyLike, type LayerSpec } from './input-layers.js';

// The resolver takes a structural KeyLike, so every case here runs with a plain
// object and no DOM. Each of these tests is a bug that shipped.

function key(k: string, extra: Partial<KeyLike> = {}): KeyLike & { prevented: boolean } {
  const e = {
    key: k,
    prevented: false,
    preventDefault(): void {
      e.prevented = true;
    },
    stopPropagation(): void {},
    ...extra,
  };
  return e as KeyLike & { prevented: boolean };
}

const layer = (over: Partial<LayerSpec> = {}): LayerSpec => ({
  kind: 'sidebar',
  name: 'test',
  ...over,
});

beforeEach(() => inputLayers.reset());

describe('escape peels one layer at a time', () => {
  it('gives Escape to the top layer, not the one under it', () => {
    const under = vi.fn(() => true);
    const top = vi.fn(() => true);
    inputLayers.push(layer({ name: 'under', onEscape: under }));
    inputLayers.push(layer({ name: 'top', onEscape: top }));

    const e = key('Escape');
    inputLayers.handleKeyDown(e);

    expect(top).toHaveBeenCalledOnce();
    expect(under).not.toHaveBeenCalled();
    expect(e.prevented).toBe(true);
  });

  it('falls through a layer that declines and does not capture', () => {
    const base = vi.fn(() => true);
    const passive = vi.fn(() => false);
    inputLayers.push(layer({ kind: 'canvas', name: 'world', onEscape: base }));
    inputLayers.push(layer({ kind: 'hud', name: 'knock', onEscape: passive }));

    inputLayers.handleKeyDown(key('Escape'));

    expect(passive).toHaveBeenCalledOnce();
    expect(base).toHaveBeenCalledOnce();
  });

  it('reaches the base canvas layer only when nothing is stacked on it', () => {
    const leaveWorld = vi.fn(() => true);
    inputLayers.push(layer({ kind: 'canvas', name: 'world', onEscape: leaveWorld }));
    const panel = inputLayers.push(
      layer({ name: 'chat', capturesKeys: true, onEscape: () => true }),
    );

    inputLayers.handleKeyDown(key('Escape'));
    expect(leaveWorld).not.toHaveBeenCalled();

    panel.release();
    inputLayers.handleKeyDown(key('Escape'));
    expect(leaveWorld).toHaveBeenCalledOnce();
  });

  it('lets Escape reach a capturing layer that declines it — the whiteboard case', () => {
    // tldraw uses Escape to deselect. A layer with no onEscape must stop the
    // walk (so the panel below does not close) WITHOUT preventing the default
    // (so tldraw still receives the key).
    const panelBelow = vi.fn(() => true);
    inputLayers.push(layer({ name: 'panel', onEscape: panelBelow }));
    inputLayers.push(layer({ kind: 'modal', name: 'whiteboard', capturesKeys: true }));

    const e = key('Escape');
    inputLayers.handleKeyDown(e);

    expect(panelBelow).not.toHaveBeenCalled();
    expect(e.prevented).toBe(false);
  });

  it('swallows Escape for a capturing layer that has nothing to close', () => {
    // The character creator on a first-ever entry: there is no previous look to
    // cancel back to, and Escape must not eject you from the room instead.
    const leaveWorld = vi.fn(() => true);
    inputLayers.push(layer({ kind: 'canvas', name: 'world', onEscape: leaveWorld }));
    inputLayers.push(
      layer({ kind: 'modal', name: 'creator', capturesKeys: true, onEscape: () => false }),
    );

    inputLayers.handleKeyDown(key('Escape'));

    expect(leaveWorld).not.toHaveBeenCalled();
  });

  it('ignores a key another handler already claimed', () => {
    const onEscape = vi.fn(() => true);
    inputLayers.push(layer({ onEscape }));
    inputLayers.handleKeyDown(key('Escape', { defaultPrevented: true }));
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe('release is by identity, not by order', () => {
  it('re-enables canvas keys only when the LAST capturing layer goes', () => {
    // The bug: closing the say bar while the chat panel was open re-enabled
    // Phaser's keyboard, so WASD walked your avatar while you typed.
    const panel = inputLayers.push(layer({ name: 'chat', capturesKeys: true }));
    const say = inputLayers.push(layer({ kind: 'text', name: 'say', capturesKeys: true }));

    expect(inputLayers.getSnapshot().canvasOwnsKeys).toBe(false);

    say.release();
    expect(inputLayers.getSnapshot().canvasOwnsKeys).toBe(false);

    panel.release();
    expect(inputLayers.getSnapshot().canvasOwnsKeys).toBe(true);
  });

  it('removes the right entry when layers close out of order', () => {
    const a = inputLayers.push(layer({ name: 'a' }));
    inputLayers.push(layer({ name: 'b' }));
    const c = inputLayers.push(layer({ kind: 'modal', name: 'c' }));

    a.release();
    expect(inputLayers.getSnapshot().depth).toBe(2);
    expect(inputLayers.getSnapshot().topKind).toBe('modal');

    c.release();
    expect(inputLayers.getSnapshot().topKind).toBe('sidebar');
  });

  it('is idempotent — a double release cannot pop someone else off', () => {
    const a = inputLayers.push(layer({ name: 'a' }));
    inputLayers.push(layer({ name: 'b' }));
    a.release();
    a.release();
    expect(inputLayers.getSnapshot().depth).toBe(1);
  });
});

describe('hotkeys', () => {
  it('fires while the canvas owns the keyboard', () => {
    const emote = vi.fn();
    inputLayers.registerHotkey(['1', '2', '3'], emote);
    inputLayers.handleKeyDown(key('2'));
    expect(emote).toHaveBeenCalledOnce();
  });

  it('goes inert under a capturing layer — the emote-in-tldraw bug', () => {
    // Pressing "3" in the whiteboard used to pick a tool AND broadcast an
    // emote, because the old guard only excused INPUT/TEXTAREA and a canvas is
    // neither.
    const emote = vi.fn();
    inputLayers.registerHotkey(['3'], emote);
    const board = inputLayers.push(
      layer({ kind: 'modal', name: 'whiteboard', capturesKeys: true }),
    );

    inputLayers.handleKeyDown(key('3'));
    expect(emote).not.toHaveBeenCalled();

    board.release();
    inputLayers.handleKeyDown(key('3'));
    expect(emote).toHaveBeenCalledOnce();
  });

  it('stays inert for a non-capturing layer', () => {
    const emote = vi.fn();
    inputLayers.registerHotkey('1', emote);
    inputLayers.push(layer({ kind: 'hud', name: 'knock' }));
    inputLayers.handleKeyDown(key('1'));
    expect(emote).toHaveBeenCalledOnce();
  });

  it('never fires for a modifier combination', () => {
    const emote = vi.fn();
    inputLayers.registerHotkey('1', emote);
    inputLayers.handleKeyDown(key('1', { ctrlKey: true }));
    inputLayers.handleKeyDown(key('1', { metaKey: true }));
    expect(emote).not.toHaveBeenCalled();
  });

  it('unregisters', () => {
    const emote = vi.fn();
    const off = inputLayers.registerHotkey('1', emote);
    off();
    inputLayers.handleKeyDown(key('1'));
    expect(emote).not.toHaveBeenCalled();
  });
});

describe('snapshot', () => {
  it('keeps the same reference when nothing changed', () => {
    const first = inputLayers.getSnapshot();
    const a = inputLayers.push(layer({ name: 'a' }));
    const b = inputLayers.push(layer({ name: 'b' }));
    b.release();
    a.release();
    // Same VALUES as the start, so useSyncExternalStore must not see churn on
    // the way back to idle.
    expect(inputLayers.getSnapshot()).toEqual(first);
  });

  it('notifies subscribers only on a real change', () => {
    const fn = vi.fn();
    inputLayers.subscribe(fn);
    const a = inputLayers.push(layer({ name: 'a', capturesKeys: true }));
    expect(fn).toHaveBeenCalledTimes(1);
    a.release();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
