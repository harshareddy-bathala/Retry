// Position-broadcast latency under load (build plan Phase 8.3, NFR-PERF-06).
//
//   pnpm --filter @retry/e2e load
//
// Spawns N headless WebSocket clients in one map, walks them at the real
// client's cadence (a move every 50 ms while walking), and measures how long a
// move takes to reach another connection. It talks to the room server only —
// no browser, no rendering — because the budget being tested is the server's:
// "position broadcast under 150 ms".
//
// It mints its own tokens from JWT_SECRET rather than logging anyone in. That
// is fine for a local measurement and would not be fine against anything real,
// which is why this is a script you run and not a route.

import { setTimeout as sleep } from 'node:timers/promises';
import { SignJWT } from 'jose';
import WebSocket from 'ws';

const URL = process.env.LOAD_WS_URL ?? 'ws://127.0.0.1:4100/ws';
const SECRET = process.env.JWT_SECRET ?? 'local-dev-only-jwt-secret-0123456789abcdef0123456789abcdef';
const CLIENTS = Number(process.env.LOAD_CLIENTS ?? 50);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 20);
const MAP = process.env.LOAD_MAP ?? 'commons';

/** The real client's send cadence while a key is held (RoomScene). */
const MOVE_INTERVAL_MS = 50;
/** NFR-PERF-06. */
const BUDGET_MS = 150;

type Actor = {
  id: string;
  ws: WebSocket;
  /** Move sequence → the time we sent it, for the one client we measure. */
  sentAt: Map<number, number>;
};

const latencies: number[] = [];

async function token(sub: string): Promise<string> {
  return new SignJWT({ role: 'student' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(new TextEncoder().encode(SECRET));
}

async function spawn(index: number): Promise<Actor> {
  const id = `load-${index.toString().padStart(3, '0')}`;
  const ws = new WebSocket(`${URL}?token=${await token(id)}`);
  const actor: Actor = { id, ws, sentAt: new Map() };
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ t: 'join', mapId: MAP, displayName: id, sprite: 'maker' }));
  return actor;
}

/**
 * Latency is measured on the RECEIVING side: actor 0 listens for actor 1's
 * moves and compares the arrival time against when actor 1 sent it. Both are
 * in this process, so the clock is the same one — no cross-machine skew, and
 * no attempt to pretend this measures a real network.
 */
function measure(listener: Actor, subject: Actor): void {
  listener.ws.on('message', (data) => {
    let msg: { t?: string; userId?: string; x?: number } | null = null;
    try {
      msg = JSON.parse(String(data)) as { t?: string; userId?: string; x?: number };
    } catch {
      return;
    }
    if (msg.t !== 'actorMove' || msg.userId !== subject.id) return;
    // x is the sequence marker: each step moves by a known, unique amount.
    const sent = subject.sentAt.get(Math.round((msg.x ?? 0) * 1000));
    if (sent !== undefined) latencies.push(performance.now() - sent);
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!;
}

async function main(): Promise<void> {
  console.log(`spawning ${CLIENTS} clients on '${MAP}' for ${SECONDS}s…`);
  const actors: Actor[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    actors.push(await spawn(i));
    // Stagger: fifty simultaneous joins measures the accept path, not movement.
    await sleep(20);
  }
  const [listener, subject] = actors;
  if (!listener || !subject) throw new Error('need at least two clients');
  measure(listener, subject);
  await sleep(500);

  const started = performance.now();
  let step = 0;
  while (performance.now() - started < SECONDS * 1000) {
    step += 1;
    for (const actor of actors) {
      // A small loop around the spawn: legal steps, never into a wall, and
      // every actor moving means every move is a fan-out to CLIENTS-1 peers.
      const angle = (step / 12 + actors.indexOf(actor)) % (Math.PI * 2);
      const x = 20 + Math.cos(angle) * 3;
      const y = 11 + Math.sin(angle) * 2;
      if (actor === subject) subject.sentAt.set(Math.round(x * 1000), performance.now());
      actor.ws.send(JSON.stringify({ t: 'move', x, y, dir: 'right', moving: true }));
    }
    await sleep(MOVE_INTERVAL_MS);
  }

  for (const actor of actors) actor.ws.close();
  await sleep(300);

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  console.log(`\nsamples: ${sorted.length}`);
  console.log(`  p50 ${p50.toFixed(1)}ms`);
  console.log(`  p95 ${p95.toFixed(1)}ms`);
  console.log(`  p99 ${p99.toFixed(1)}ms   (budget ${BUDGET_MS}ms, NFR-PERF-06)`);
  if (sorted.length === 0) {
    console.error('no samples — did the moves get rate-limited or rejected?');
    process.exit(1);
  }
  process.exit(p95 <= BUDGET_MS ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('load run failed:', err);
  process.exit(1);
});
