// Per-peer AV render state (rooms build plan Phase 5), published by the
// AvManager and consumed by the bubble overlay via useSyncExternalStore.
// Kept outside React so Daily's event storm never causes render churn beyond
// actual track/speaking changes.

export type PeerAv = {
  videoTrack: MediaStreamTrack | null;
  speaking: boolean;
};

type Listener = () => void;

class AvStoreImpl {
  private peers = new Map<string, PeerAv>();
  private view: ReadonlyMap<string, PeerAv> = new Map();
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReadonlyMap<string, PeerAv> => this.view;

  setVideoTrack(userId: string, track: MediaStreamTrack | null): void {
    const current = this.peers.get(userId);
    if ((current?.videoTrack ?? null) === track) return;
    this.peers.set(userId, { videoTrack: track, speaking: current?.speaking ?? false });
    this.commit();
  }

  /** Active-speaker model: at most one speaking peer at a time. */
  setSpeaking(userId: string | null): void {
    let changed = false;
    for (const [id, peer] of this.peers) {
      const speaking = id === userId;
      if (peer.speaking !== speaking) {
        this.peers.set(id, { ...peer, speaking });
        changed = true;
      }
    }
    if (userId && !this.peers.has(userId)) {
      this.peers.set(userId, { videoTrack: null, speaking: true });
      changed = true;
    }
    if (changed) this.commit();
  }

  remove(userId: string): void {
    if (this.peers.delete(userId)) this.commit();
  }

  clear(): void {
    if (this.peers.size === 0) return;
    this.peers.clear();
    this.commit();
  }

  private commit(): void {
    this.view = new Map(this.peers);
    for (const listener of this.listeners) listener();
  }
}

export const avStore = new AvStoreImpl();
