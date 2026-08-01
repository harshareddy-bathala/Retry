# The LiveKit box

Rooms audio/video runs on a LiveKit SFU we operate (ADR-012). **AV stays off
until all three env vars are set** — rooms work fine without it, bubbles show
initials, and the HUD says so. That is a supported state, not a fault.

`docs/livekit-vps.md` explains *why* each decision is what it is. This is the
part you run.

## Provision (once the VPS and hostname exist)

On a fresh Ubuntu VPS, as root, with an A record already pointing at it:

```bash
git clone <repo> retry && cd retry/infra/livekit
./setup.sh livekit.<domain> ops@<domain>
```

It checks DNS first (a missing A record otherwise surfaces as a confusing ACME
error), installs Docker, opens the firewall, generates keys with LiveKit's own
generator, writes the config, starts both containers, waits for the
certificate, hands a copy to the TURN relay, and installs a daily cron to keep
that copy fresh.

It finishes by printing the three lines you need. That is the only thing you
carry back:

```
LIVEKIT_URL=wss://livekit.<domain>
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

## Wire it up

Paste those into `apps/room-server/.env` and **restart the room server** —
`tsx watch` does not reload `.env`. On boot it either logs the "AV is off"
warning or says nothing, which is how you know the config was picked up.

No code changes. `livekitConfig()` is all-or-nothing by design: a
half-configured AV is worse than none.

## Verify

```bash
pnpm --filter @retry/e2e livekit:check
```

Checks what a script can: that the signalling endpoint accepts a token signed
with your secret, that the WebSocket upgrade reaches LiveKit, and that there is
a trusted TLS listener on **443** with a certificate that is not about to
expire. It then prints the five things that need ears, eyes and a phone —
because pretending a script covered those would be worse than saying it did not.

## The two things most likely to bite you

**TURN on 443 is not an optimisation.** NTTF campus networks and a meaningful
share of Indian mobile carriers block arbitrary outbound UDP. Without a TCP/443
relay those students get a call that silently never connects, and report it as
"the app is broken". Test from a phone on mobile data before any beta invite.

**The relay reads its certificate off disk, not from Caddy.** Caddy renews
silently; if nobody copies the new files, the relay serves an expired
certificate and breaks exactly the users who depend on it — ninety days after
everything looked fine. `sync-certs.sh` runs daily from cron for this reason,
and only restarts LiveKit when the certificate actually changed, because a
restart drops everyone in a call.

## Files

| File | Goes to | What it is |
|---|---|---|
| `setup.sh` | run once | Everything below, in order, idempotently |
| `livekit.yaml` | `/etc/livekit/livekit.yaml` | SFU config: ports, keys, TURN, no recording |
| `Caddyfile` | `/etc/caddy/Caddyfile` | TLS termination for the signalling WebSocket |
| `docker-compose.yml` | `/opt/retry-livekit/` | The two containers, host-networked |
| `sync-certs.sh` | `/usr/local/bin/livekit-sync-certs` | Keeps the relay's certificate current |
