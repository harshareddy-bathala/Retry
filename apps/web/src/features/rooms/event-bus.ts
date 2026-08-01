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
  // Who owns the keyboard. Emitted by the input-layer stack
  // (features/rooms/input/input-layers.ts) and by nothing else — the scene
  // surrenders keys entirely whenever any DOM layer above it captures them, so
  // typing in chat never moves the avatar.
  //
  // This replaced a `panel:state` boolean that three components emitted
  // independently. Closing the say bar while the chat panel was open said
  // "nothing has focus" and re-enabled WASD mid-sentence. One owner, refcounted.
  'input:canvas-keys': { enabled: boolean };
  // Reopen the character creator from the HUD (a look is editable, not a vow).
  'creator:open': undefined;
  // Whether the character creator is currently up. The pre-join check waits for
  // this to go false before opening: both are modals, and two modals stacked on
  // a first-ever entry is a trap rather than a welcome. Emitted by
  // CharacterCreator and read by WorldPage; nothing else needs it.
  'creator:state': { open: boolean };
  // Reopen the mic/camera check from the dock. It is offered once per session
  // automatically, which is only acceptable BECAUSE it is one click away after.
  'av:check': undefined;
  // A rename repaints the name tag; it must not rebuild the world.
  'self:rename': { displayName: string };
  // Show me where someone is: the camera leaves the player, pans to them, and
  // comes back. A room is bigger than the viewport, so "who is here" is not
  // the same question as "where are they".
  'camera:locate': { userId: string };
  // React the HUD picker into a bubble over your own head. The number-key
  // shortcuts route through here too, so the scene has one entry point.
  'self:emote': { key: string };
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
