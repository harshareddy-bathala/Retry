// The single bridge between React and Phaser (rooms build plan, Phase 1).
// React NEVER reaches into Phaser internals and Phaser NEVER imports React —
// both sides import only this module. Add new cross-boundary events to
// RoomEventMap; ad-hoc channels are not allowed.

import type { ServerMessage } from '@retry/protocol';

export type RoomSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type RoomEventMap = {
  'interact:whiteboard': undefined;
  'net:server-message': ServerMessage;
  'net:status': RoomSocketStatus;
  // Phase 6: a panel holds keyboard focus — the scene must release input so
  // typing in chat never moves the avatar.
  'panel:state': { open: boolean };
  // Reopen the character creator from the HUD (a look is editable, not a vow).
  'creator:open': undefined;
};

type Handler<T> = (payload: T) => void;

// [T] extends [undefined] keeps the conditional non-distributive so union
// payloads (e.g. ServerMessage) stay a single tuple argument.
type EmitArgs<T> = [T] extends [undefined] ? [] : [payload: T];

class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscribe. Returns an unsubscribe function (usable as a useEffect cleanup). */
  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof Events>(event: K, ...args: EmitArgs<Events[K]>): void {
    const payload = args[0] as Events[K];
    this.handlers.get(event)?.forEach((handler) => {
      (handler as Handler<Events[K]>)(payload);
    });
  }
}

export const roomEvents = new EventBus<RoomEventMap>();
