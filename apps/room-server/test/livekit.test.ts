import { describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { LiveKitAvProvider, TOKEN_TTL_SECONDS, roomNameFor } from '../src/av/livekit.js';

// The token IS the access-control decision: everything the client is allowed
// to do in the SFU is encoded here, so assert the grant rather than trusting it.

const provider = new LiveKitAvProvider({
  url: 'wss://livekit.example.com',
  apiKey: 'devkey',
  apiSecret: 'devsecret-0123456789abcdef0123456789abcdef',
});

type VideoGrant = {
  room?: string;
  roomJoin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  roomRecord?: boolean;
  roomCreate?: boolean;
  roomAdmin?: boolean;
};

async function grantOf(mapId: string, userId: string, name: string) {
  const grant = await provider.grantFor(mapId, userId, name);
  const claims = decodeJwt(grant.token) as {
    sub?: string;
    name?: string;
    exp?: number;
    iat?: number;
    video?: VideoGrant;
  };
  return { grant, claims };
}

describe('livekit token minting', () => {
  it('scopes the token to one room and identifies the user by their Retry id', async () => {
    const { grant, claims } = await grantOf('map-1', 'user-42', 'Asha');
    expect(grant.serverUrl).toBe('wss://livekit.example.com');
    expect(grant.room).toBe('retry-map-1');
    // Identity is the userId so the client maps a participant onto an actor
    // with no side-channel lookup.
    expect(claims.sub).toBe('user-42');
    expect(claims.name).toBe('Asha');
    expect(claims.video?.room).toBe('retry-map-1');
    expect(claims.video?.roomJoin).toBe(true);
  });

  it('grants publish and subscribe but never recording, data or admin', async () => {
    const { claims } = await grantOf('map-1', 'user-42', 'Asha');
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    // FR-ROOM-32: no audio or video is ever recorded.
    expect(claims.video?.roomRecord).toBe(false);
    // Proximity, chat and presence ride our own socket; LiveKit carries media only.
    expect(claims.video?.canPublishData).toBe(false);
    expect(claims.video?.roomCreate).toBe(false);
    expect(claims.video?.roomAdmin).toBe(false);
  });

  it('expires in 2 hours (SECURITY.md, NFR-SEC-02)', async () => {
    const { claims } = await grantOf('map-1', 'user-42', 'Asha');
    expect(claims.exp).toBeDefined();
    const ttl = claims.exp! - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(TOKEN_TTL_SECONDS - 60);
    expect(ttl).toBeLessThanOrEqual(TOKEN_TTL_SECONDS + 5);
  });

  it('gives each map instance its own namespaced room', async () => {
    const a = await provider.grantFor('commons', 'user-1', 'A');
    const b = await provider.grantFor('room-uuid', 'user-1', 'A');
    expect(a.room).not.toBe(b.room);
    expect(roomNameFor('commons')).toBe('retry-commons');
  });

  it('mints locally — a grant needs no network round-trip', async () => {
    // Daily needed a REST call per room and per token, which put a third-party
    // outage in the room-entry path. LiveKit rooms are implicit, so this must
    // resolve with fetch unavailable.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('no network calls allowed while minting');
    }) as typeof fetch;
    try {
      await expect(provider.grantFor('map-1', 'user-1', 'A')).resolves.toMatchObject({
        room: 'retry-map-1',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
