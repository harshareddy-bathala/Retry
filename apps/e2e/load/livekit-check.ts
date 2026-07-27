// Preflight for the LiveKit box, run from the repo once the env vars land.
//
//   pnpm --filter @retry/e2e livekit:check
//
// Everything here is checkable without a browser and without two humans. What
// it CANNOT check is listed at the end, because those four things need ears,
// eyes and a phone — and pretending a script covered them would be worse than
// saying it did not.

import { readFileSync } from 'node:fs';
import { connect as tlsConnect } from 'node:tls';
import { AccessToken } from 'livekit-server-sdk';
import WebSocket from 'ws';

type Config = { url: string; apiKey: string; apiSecret: string };

let pass = 0;
let fail = 0;
const ok = (label: string, detail = ''): void => {
  pass++;
  console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
};
const bad = (label: string, detail = ''): void => {
  fail++;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Read the room server's .env without importing its env module (which exits). */
function loadConfig(): Config | null {
  const path = new URL('../../room-server/.env', import.meta.url);
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const read = (key: string): string | undefined => {
    const line = text.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
    return line?.slice(line.indexOf('=') + 1).trim() || undefined;
  };
  const url = read('LIVEKIT_URL');
  const apiKey = read('LIVEKIT_API_KEY');
  const apiSecret = read('LIVEKIT_API_SECRET');
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

/** The signalling endpoint should accept a validly signed token. */
async function checkSignalling(config: Config): Promise<void> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: 'preflight',
    ttl: '5m',
  });
  token.addGrant({ roomJoin: true, room: 'retry-preflight', canPublish: true, canSubscribe: true });
  const jwt = await token.toJwt();

  const url = `${config.url.replace(/\/$/, '')}/rtc/validate?access_token=${jwt}`;
  const httpUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  try {
    const res = await fetch(httpUrl);
    const body = await res.text();
    if (res.ok) ok('signalling accepts a signed token', body.trim().slice(0, 40));
    else bad('signalling rejected the token', `${res.status} ${body.slice(0, 120)}`);
  } catch (err) {
    bad('signalling unreachable', err instanceof Error ? err.message : String(err));
  }
}

/** The WebSocket upgrade itself, which is what the browser actually does. */
async function checkWebSocket(config: Config): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`${config.url.replace(/\/$/, '')}/rtc`, { handshakeTimeout: 8000 });
    const done = (good: boolean, detail: string): void => {
      ws.removeAllListeners();
      ws.close();
      if (good) ok('websocket upgrade reaches LiveKit', detail);
      else bad('websocket upgrade failed', detail);
      resolve();
    };
    // A 401 here is a PASS: the handshake reached LiveKit and it refused an
    // unauthenticated connection, which is exactly what it should do.
    ws.on('unexpected-response', (_req, res) => done(res.statusCode === 401, `HTTP ${res.statusCode}`));
    ws.on('open', () => done(true, 'accepted'));
    ws.on('error', (err) => done(false, err.message));
  });
}

/**
 * The check that matters most and is least likely to be run by hand: is there
 * a TLS listener on 443 at all? Campus and Indian mobile networks block
 * arbitrary UDP, and without this relay those students get a call that
 * silently never connects and a bug report that says "the app is broken".
 */
async function checkTurn443(config: Config): Promise<void> {
  const host = new URL(config.url).hostname;
  await new Promise<void>((resolve) => {
    const socket = tlsConnect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      const expires = cert.valid_to ? new Date(cert.valid_to) : null;
      const daysLeft = expires ? Math.round((expires.getTime() - Date.now()) / 86_400_000) : NaN;
      if (!socket.authorized) {
        bad('TURN/TLS on 443', `certificate not trusted: ${socket.authorizationError}`);
      } else if (Number.isFinite(daysLeft) && daysLeft < 10) {
        // A stale copy on disk is the documented failure mode of the relay:
        // Caddy renews, nobody copies, and it breaks 90 days after it worked.
        bad('TURN/TLS on 443', `certificate expires in ${daysLeft} days — is sync-certs running?`);
      } else {
        ok('TURN/TLS listening on 443', `cert valid ${daysLeft} more days`);
      }
      socket.end();
      resolve();
    });
    socket.on('timeout', () => {
      bad('TURN/TLS on 443', 'timed out — campus and mobile users will not connect');
      socket.destroy();
      resolve();
    });
    socket.on('error', (err) => {
      bad('TURN/TLS on 443', err.message);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log('LiveKit is not configured.\n');
    console.log('  All three of LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET must be');
    console.log('  set in apps/room-server/.env. Until then AV is OFF, which is a fully');
    console.log('  supported state — rooms work, bubbles show initials, and the HUD says so.\n');
    console.log('  To provision: infra/livekit/setup.sh <hostname> <admin-email>');
    process.exit(0);
  }

  console.log(`checking ${config.url}\n`);
  await checkSignalling(config);
  await checkWebSocket(config);
  await checkTurn443(config);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`
Still to check by hand — these need ears, eyes and a phone (docs/livekit-vps.md §6):
  1. Audio connects in under a second when two avatars walk within 2 tiles.
  2. chrome://webrtc-internals: inbound streams track the number of close/near
     peers. Walking away must DROP subscriptions, not merely mute them — that
     is the whole mechanic and nothing automated can confirm it.
  3. The gain ramp is audible rather than a step: 1.0 close, 0.5 near, 200ms.
  4. Refuse camera permission: bubbles fall back to initials, audio keeps
     working, and the HUD says the mic was blocked.
  5. Repeat (1) on a phone tethering mobile data. This is the check that most
     resembles a real tester's network.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('livekit check failed:', err);
  process.exit(1);
});
