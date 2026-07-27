# Self-hosted LiveKit — deployment runbook

> Rooms audio/video runs on a LiveKit SFU we operate (ADR-012). **Nothing here is provisioned yet.**
> Until `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are all set in
> `apps/room-server/.env`, AV is off and rooms work exactly as they do today with placeholder
> proximity bubbles. This document is the recipe for when you do provision it.
>
> **The recipe is now executable.** Every config snippet below exists as a real file in
> `infra/livekit/`, and `infra/livekit/setup.sh <hostname> <admin-email>` runs the whole of
> sections 2–4 on a fresh VPS. Read this document for *why*; run that script for *how*. Once the
> env vars are in place, `pnpm --filter @retry/e2e livekit:check` verifies what a script can and
> names what it cannot.

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

Once the server is up, the checks Phase 5 could never run:

1. **Audio connects in under a second** when two avatars walk within 2 tiles.
2. **Bandwidth scales with proximity, not population.** Open `chrome://webrtc-internals` and confirm
   the number of inbound streams tracks the number of close/near peers — walking away must drop
   subscriptions, not merely mute them.
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
