#!/usr/bin/env bash
# Provision the LiveKit box. Run as root on a fresh Ubuntu VPS.
#
#   ./setup.sh livekit.example.edu admin@example.edu
#
# Idempotent: safe to re-run after changing the hostname or rotating keys. It
# prints the three environment lines for apps/room-server/.env at the end —
# that is the only thing you carry back to the application box.
set -euo pipefail

HOSTNAME="${1:-}"
ADMIN_EMAIL="${2:-}"
if [[ -z "$HOSTNAME" || -z "$ADMIN_EMAIL" ]]; then
  echo "usage: $0 <livekit-hostname> <admin-email>" >&2
  echo "  e.g. $0 livekit.retry.example.edu ops@example.edu" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Checking DNS before anything else"
# Caddy will fail to issue a certificate without this, and the failure mode is
# a confusing ACME error rather than "your A record is missing".
resolved="$(getent hosts "$HOSTNAME" | awk '{print $1}' | head -1 || true)"
public="$(curl -fsS https://api.ipify.org || true)"
if [[ -z "$resolved" ]]; then
  echo "!! $HOSTNAME does not resolve. Add an A record to $public and re-run." >&2
  exit 1
fi
if [[ -n "$public" && "$resolved" != "$public" ]]; then
  echo "!! $HOSTNAME resolves to $resolved but this box is $public." >&2
  echo "   Fix the A record (or wait for propagation) and re-run." >&2
  exit 1
fi
echo "    $HOSTNAME -> $resolved, matches this host"

echo "==> Installing Docker if absent"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Opening the firewall"
# Read docs/livekit-vps.md §3 before narrowing any of these. 443/TCP carries
# BOTH signalling and the TURN relay that campus and mobile networks depend on.
if command -v ufw >/dev/null 2>&1; then
  ufw allow 443/tcp    >/dev/null
  ufw allow 80/tcp     >/dev/null   # ACME HTTP-01 challenge
  ufw allow 7881/tcp   >/dev/null   # ICE/TCP fallback
  ufw allow 50000:60000/udp >/dev/null
  echo "    443/tcp 80/tcp 7881/tcp 50000-60000/udp"
fi

echo "==> Generating API keys"
mkdir -p /etc/livekit/tls /etc/caddy /var/log/caddy /opt/retry-livekit
KEYFILE=/etc/livekit/keys.env
if [[ ! -f "$KEYFILE" ]]; then
  # LiveKit's own generator, so the key format is never in question.
  generated="$(docker run --rm livekit/livekit-server generate-keys)"
  api_key="$(echo "$generated"   | awk '/API Key/    {print $NF}')"
  api_secret="$(echo "$generated" | awk '/API Secret/ {print $NF}')"
  printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\n' "$api_key" "$api_secret" > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "    new keys written to $KEYFILE"
else
  echo "    reusing existing keys in $KEYFILE (delete it to rotate)"
fi
# shellcheck disable=SC1090
source "$KEYFILE"

echo "==> Writing configuration"
sed -e "s|<API_KEY>|$LIVEKIT_API_KEY|" \
    -e "s|<API_SECRET>|$LIVEKIT_API_SECRET|" \
    -e "s|<LIVEKIT_HOSTNAME>|$HOSTNAME|" \
    "$HERE/livekit.yaml" > /etc/livekit/livekit.yaml
chmod 600 /etc/livekit/livekit.yaml

sed -e "s|<LIVEKIT_HOSTNAME>|$HOSTNAME|" \
    -e "s|<ADMIN_EMAIL>|$ADMIN_EMAIL|" \
    "$HERE/Caddyfile" > /etc/caddy/Caddyfile

cp "$HERE/docker-compose.yml" /opt/retry-livekit/docker-compose.yml
cp "$HERE/sync-certs.sh" /usr/local/bin/livekit-sync-certs
chmod +x /usr/local/bin/livekit-sync-certs

echo "==> Starting"
cd /opt/retry-livekit
docker compose up -d

echo "==> Waiting for the certificate, then handing it to the TURN relay"
# Caddy issues on first request; the relay reads the cert off disk and will not
# start serving TLS until it exists.
for _ in $(seq 1 60); do
  if /usr/local/bin/livekit-sync-certs "$HOSTNAME" 2>/dev/null; then break; fi
  sleep 5
done

# Keep it fresh: Caddy renews silently, and a stale copy on disk breaks exactly
# the users who most need the relay.
cat > /etc/cron.d/livekit-certs <<CRON
17 4 * * * root /usr/local/bin/livekit-sync-certs $HOSTNAME >/dev/null 2>&1
CRON

echo
echo "======================================================================"
echo " LiveKit is up on $HOSTNAME"
echo
echo " Add these three lines to apps/room-server/.env and RESTART the room"
echo " server (tsx watch does not reload .env):"
echo
echo "   LIVEKIT_URL=wss://$HOSTNAME"
echo "   LIVEKIT_API_KEY=$LIVEKIT_API_KEY"
echo "   LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET"
echo
echo " Then, from the repo:  pnpm --filter @retry/e2e livekit:check"
echo "======================================================================"
