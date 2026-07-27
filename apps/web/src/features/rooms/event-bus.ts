// The single bridge between React and Phaser (rooms build plan, Phase 1).
// React NEVER reaches into Phaser internals and Phaser NEVER imports React —
// both sides import only this module. Add new cross-boundary events to
// RoomEventMap; ad-hoc channels are not allowed.

import type { ServerMessage } from '@retry/protocol';

// 'closed' is a deliberate disconnect (leaving the world). 'failed' is the
// socket giving up after MAX_RECONNECT_ATTEMPTS — the two look identical to a
// dot but mean opposite things to a person, so only 'failed' offers a Rejoin.
export type RoomSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export type RoomEventMap = {
  'interact:whiteboard': undefined;
  'net:server-message': ServerMessage;
  'net:status': RoomSocketStatus;
  // Phase 6: a panel holds keyboard focus — the scene must release input so
  // typing in chat never moves the avatar.
  'panel:state': { open: boolean };
  // Reopen the character creator from the HUD (a look is editable, not a vow).
  'creator:open': undefined;
  // A rename repaints the name tag; it must not rebuild the world.
  'self:rename': { displayName: string };
  // Show me where someone is: the camera leaves the player, pans to them, and
  // comes back. A room is bigger than the viewport, so "who is here" is not
  // the same question as "where are they".
  'camera:locate': { userId: string };
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
