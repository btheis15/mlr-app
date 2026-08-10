#!/bin/bash
# Keep mlr-media.duckdns.org pointed at this house's public IP.
#
# Comcast hands out a residential IP that rotates every so often. The app's media
# URLs resolve through this hostname, so if the record goes stale every photo and
# video 404s for everyone until it's fixed by hand. This runs on a launchd timer
# and is the whole reason the free-DNS route is viable.
#
# Credentials live in media-server/.env (gitignored) — never in the repo.
# DuckDNS's API is a plain GET; it replies with the literal text "OK" or "KO".

set -uo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
LOG="$(cd "$(dirname "$0")/.." && pwd)/logs/duckdns.log"
mkdir -p "$(dirname "$LOG")"

# Read only the two keys we need. Sourcing the whole .env would choke on other
# values (there's at least one multi-line key in there that zsh/bash can't parse).
DOMAIN=$(grep -m1 '^DUCKDNS_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ')
TOKEN=$(grep -m1 '^DUCKDNS_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ')

stamp() { date "+%Y-%m-%dT%H:%M:%S%z"; }

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  echo "$(stamp) ERROR: DUCKDNS_DOMAIN / DUCKDNS_TOKEN missing from $ENV_FILE" >> "$LOG"
  exit 1
fi

# Empty `ip` lets DuckDNS use the requesting address, which is what we want —
# no need to detect our own public IP, and it can't get it wrong.
RESP=$(curl -fsS --max-time 30 \
  "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=" 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$(stamp) FAIL curl rc=$RC: $RESP" >> "$LOG"
  exit 1
fi

case "$RESP" in
  OK*)
    # Only log when the answer actually changed, so this doesn't grow a line
    # every 5 minutes forever.
    CUR=$(dig +short "${DOMAIN}.duckdns.org" 2>/dev/null | head -1)
    LAST_FILE="$(dirname "$LOG")/.duckdns-last-ip"
    LAST=$(cat "$LAST_FILE" 2>/dev/null || echo "")
    if [ "$CUR" != "$LAST" ]; then
      echo "$(stamp) OK ${DOMAIN}.duckdns.org -> ${CUR:-unknown}" >> "$LOG"
      printf '%s' "$CUR" > "$LAST_FILE"
    fi
    ;;
  *)
    echo "$(stamp) DuckDNS refused the update (response: $RESP) — check the token" >> "$LOG"
    exit 1
    ;;
esac
