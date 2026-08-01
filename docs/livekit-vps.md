# Self-hosted LiveKit — deployment runbook

> Rooms audio/video runs on a LiveKit SFU we operate (ADR-012). This document is the **production**
> recipe. For local development you do not need any of it — see §0.
>
> **The recipe is executable.** Every config snippet below exists as a real file in
> `infra/livekit/`, and `infra/livekit/setup.sh <hostname> <admin-email>` runs the whole of
> sections 2–4 on a fresh VPS. Read this document for *why*; run that script for *how*. Once the
> env vars are in place, `pnpm --filter @retry/e2e livekit:check` verifies what a script can and
> names what it cannot.

---

## 0. Local development — start here

`docker compose up -d` runs a real LiveKit server in dev mode. There is no config file, no TLS, no
certificate and no TURN relay, and none of that is needed to exercise the code:

```bash
docker compose up -d                                  # includes the `livekit` service
# apps/room-server/.env — these credentials are fixed by LiveKit, not secrets
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Two flags in `docker-compose.yml` are load-bearing and neither is obvious:

- **`--bind 0.0.0.0`** — LiveKit binds its signal server to `127.0.0.1` by default, which inside a
  container means unreachable from the host however the ports are published.
- **`--node-ip 127.0.0.1`** — otherwise it advertises the container's internal address (172.x) in
  its ICE candidates. Signalling succeeds, tracks report as subscribed, and not one packet arrives.
  From the UI that is indistinguishable from a muted microphone.

Verify with `pnpm --filter @retry/e2e livekit:check` (signalling + upgrade; it reports TURN/443 as
*not applicable* rather than failed) and then
`pnpm --filter @retry/e2e exec playwright test --project=edge-av`, which drives two browsers and
asserts the proximity mechanic against real WebRTC — including inbound RTP bytes, because
"subscribed" alone would still pass with ICE broken.

**What local dev proves and does not.** It proves the code. It does not prove the network: a student
on NTTF campus wifi still needs TURN on TCP/443, and nothing below §2 has been exercised.

---

## 1. Why a separate box

The SFU wants UDP, a public IP, and CPU headroom that spikes with concurrent publishers. Putting it
on the application droplet would let a busy Live Space starve the API. Keep it separate and it can
also be resized or moved without touching the app.

**Sizing for our population.** 4000–5000 registered students does not mean 4000 concurrent AV
participants — Live Space is a fraction of the app, and proximity means each participant subscribes
to only the handful of peers within 5 tiles, not the whole room. A 4 vCPU / 8 GB VPS comfortably
carries a few hundred concurrent publishers at bubble resolution. Watch `livekit_participant_total`
and CPU before scaling; LiveKit clusters via Redis when one node stops being enough.

## 2. DNS and TLS

One hostname, e.g. `livekit.<domain>` (the domain is not chosen yet — see ADR-011). It needs:

- an A record to the VPS public IP,
- a TLS certificate for the signalling WebSocket (`wss://`).

Caddy in front of LiveKit is the least-effort option and renews certificates itself.

## 3. Ports — read this before opening a firewall

| Port | Protocol | Purpose |
|---|---|---|
| 443 | TCP | Signalling (`wss://`) **and** the embedded TURN/TLS relay |
| 50000–60000 | UDP | Media, the normal path |
| 7881 | TCP | ICE/TCP fallback |

**The TURN relay on 443/TCP is mandatory, not an optimisation.** NTTF campus networks and a
meaningful share of Indian mobile carriers block arbitrary outbound UDP. Without a TCP/443 fallback
those users get a connection that silently never establishes — which will be reported as "the app is
broken", not "my network blocks UDP". Configure it and test from a phone on mobile data before beta.

## 4. Configuration

`/etc/livekit/livekit.yaml`:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  # key: secret — generate with `livekit-server generate-keys`.
  # The secret goes ONLY in apps/room-server/.env; never apps/api, never the client.
  <API_KEY>: <API_SECRET>
turn:
  enabled: true
  domain: livekit.<domain>
  tls_port: 443
room:
  # No recording anywhere: tokens deny roomRecord and no egress service exists.
  empty_timeout: 300
  max_participants: 0   # our own access policy is the gate, not this
logging:
  level: info
```

Run it with Docker:

```bash
docker run -d --restart unless-stopped --name livekit \
  -v /etc/livekit:/etc/livekit \
  --network host \
  livekit/livekit-server --config /etc/livekit/livekit.yaml
```

`--network host` is deliberate: the UDP port range makes per-port publishing impractical.

## 5. Wiring it to the room server

Same three variables as §0, pointing at the real box instead of the container:

```bash
# apps/room-server/.env (or /etc/retry/room-server.env in production)
LIVEKIT_URL=wss://livekit.<domain>
LIVEKIT_API_KEY=<API_KEY>
LIVEKIT_API_SECRET=<API_SECRET>
```

Restart the room server — `tsx watch` does **not** reload `.env`. On boot it logs either the
"AV is off" warning or nothing, which is how you confirm the config was picked up.

Nothing else changes: `apps/room-server/src/av/livekit.ts` signs a token per user per map instance
(2 h TTL, `roomJoin` + publish + subscribe, `roomRecord` denied), the hub pushes it as `avToken`
after every map-entry snapshot, and the client connects with `autoSubscribe: false`, subscribing a
peer's tracks only while proximity reports `close`/`near`.

## 6. Verifying it for real

Checks 1–4 are now also run automatically against the dev container by
`playwright test --project=edge-av`. Repeat them here anyway: the VPS is a different network, and
that is the entire point of the box.

1. **Audio connects in under a second** when two avatars walk within 2 tiles.
2. **Bandwidth scales with proximity, not population.** Open `chrome://webrtc-internals` and confirm
   the number of inbound streams tracks the number of close/near peers — walking away must drop
   subscriptions, not merely mute them. (`av.spec.ts` asserts exactly this, plus inbound byte
   counts, so a broken ICE path cannot masquerade as a working one.)
3. **The gain ramp is audible**, not a step: 1.0 close, 0.5 near, over 200 ms.
4. **Permission denied is survivable**: refuse camera access and confirm bubbles fall back to
   initials with audio still working, never a black rectangle.
5. **TURN fallback works**: repeat check 1 on a phone tethering mobile data, or with UDP blocked at
   the firewall. This is the check that most resembles a real tester's network.

## 7. Operations

- **Backups: none needed.** LiveKit holds no persistent state; rooms are created implicitly on join
  and disappear when empty.
- **Restart impact:** everyone in a call reconnects. The world socket is unaffected — avatars,
  chat, board and whiteboard keep working, which is the whole point of AV being a separate concern.
- **Monitoring:** LiveKit exposes Prometheus metrics; alert on CPU and on participant count
  approaching the sizing above.
- **Cost:** one fixed VPS line item. There is no per-minute billing to watch, which is the main
  reason we left Daily.co.
