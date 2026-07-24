import { TLSocketRoom, type RoomSnapshot } from '@tldraw/sync-core';
import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import type { RoomStore } from '../world/store.js';

// Shared whiteboard sync (rooms build plan Phase 6, FR-ROOM-37..39). One
// self-hosted tldraw TLSocketRoom per Foundry room, created lazily on first
// open, document persisted to rooms.whiteboard_state — debounced to at most
// one write per 5 seconds (plan §4).
const PERSIST_DEBOUNCE_MS = 5_000;

type Entry = {
  room: TLSocketRoom;
  persistTimer: ReturnType<typeof setTimeout> | null;
};

export class WhiteboardHub {
  private entries = new Map<string, Promise<Entry>>();

  constructor(
    private store: RoomStore,
    private log: FastifyBaseLogger,
  ) {}

  async connect(roomId: string, sessionId: string, socket: WebSocket): Promise<void> {
    const entry = await this.ensureRoom(roomId);
    entry.room.handleSocketConnect({ sessionId, socket });
  }

  /** Flush pending documents and drop all rooms (server shutdown). */
  async stop(): Promise<void> {
    for (const [roomId, pending] of this.entries) {
      const entry = await pending.catch(() => null);
      if (!entry) continue;
      if (entry.persistTimer) clearTimeout(entry.persistTimer);
      await this.persist(roomId, entry).catch(() => undefined);
      entry.room.close();
    }
    this.entries.clear();
  }

  private ensureRoom(roomId: string): Promise<Entry> {
    let pending = this.entries.get(roomId);
    if (!pending) {
      pending = this.createRoom(roomId).catch((err: unknown) => {
        this.entries.delete(roomId);
        throw err;
      });
      this.entries.set(roomId, pending);
    }
    return pending;
  }

  private async createRoom(roomId: string): Promise<Entry> {
    let snapshot: RoomSnapshot | undefined;
    try {
      const stored = await this.store.whiteboardState(roomId);
      if (stored) snapshot = stored as RoomSnapshot;
    } catch (err) {
      this.log.warn({ err, roomId }, 'whiteboard snapshot load failed; starting empty');
    }

    const entry: Entry = { room: null as unknown as TLSocketRoom, persistTimer: null };
    const build = (initialSnapshot: RoomSnapshot | undefined): TLSocketRoom =>
      new TLSocketRoom({
        initialSnapshot,
        onDataChange: () => {
          // Debounced persistence: at most one write per 5s, trailing edge.
          if (entry.persistTimer) return;
          entry.persistTimer = setTimeout(() => {
            entry.persistTimer = null;
            void this.persist(roomId, entry);
          }, PERSIST_DEBOUNCE_MS);
        },
      });
    try {
      entry.room = build(snapshot);
    } catch (err) {
      // A corrupt stored document must never brick the whiteboard.
      this.log.warn({ err, roomId }, 'stored whiteboard document rejected; starting empty');
      entry.room = build(undefined);
    }
    return entry;
  }

  private async persist(roomId: string, entry: Entry): Promise<void> {
    try {
      await this.store.saveWhiteboardState(roomId, entry.room.getCurrentSnapshot());
    } catch (err) {
      this.log.warn({ err, roomId }, 'whiteboard persist failed');
    }
  }
}
