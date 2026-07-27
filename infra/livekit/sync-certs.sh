#!/usr/bin/env bash
# Copy Caddy's certificate to where LiveKit's TURN relay reads it, and reload.
#
#   livekit-sync-certs livekit.example.edu
#
# LiveKit's embedded TURN/TLS relay reads cert files off disk rather than
# talking to Caddy, so a renewal that nobody copies leaves the relay serving an
# expired certificate. That breaks precisely the students who depend on it —
# campus and mobile-data networks where UDP is blocked — and it breaks them
# ninety days after everything looked fine.
set -euo pipefail

HOSTNAME="${1:?usage: livekit-sync-certs <hostname>}"
SRC="/var/lib/docker/volumes/retry-livekit_caddy-data/_data/caddy/certificates"
DEST=/etc/livekit/tls

cert="$(find "$SRC" -name "${HOSTNAME}.crt" 2>/dev/null | head -1)"
key="$(find "$SRC" -name "${HOSTNAME}.key" 2>/dev/null | head -1)"
if [[ -z "$cert" || -z "$key" ]]; then
  echo "no certificate for $HOSTNAME yet" >&2
  exit 1
fi

mkdir -p "$DEST"
# Only restart when something actually changed — this runs daily from cron and
# a restart drops everyone in a call.
if cmp -s "$cert" "$DEST/cert.pem" && cmp -s "$key" "$DEST/key.pem"; then
  exit 0
fi

install -m 644 "$cert" "$DEST/cert.pem"
install -m 600 "$key"  "$DEST/key.pem"
docker restart livekit >/dev/null
echo "certificate for $HOSTNAME synced; livekit restarted"
