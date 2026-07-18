// The single bridge between React and Phaser (rooms build plan, Phase 1).
// React NEVER reaches into Phaser internals and Phaser NEVER imports React —
// both sides import only this module. Add new cross-boundary events to
// RoomEventMap; ad-hoc channels are not allowed.

export type RoomEventMap = {
  'interact:whiteboard': undefined;
};

type Handler<T> = (payload: T) => void;

type EmitArgs<T> = T extends undefined ? [] : [payload: T];

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
