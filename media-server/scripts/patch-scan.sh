#!/bin/bash
# Scan for available security patches on the software this mini exposes.
#
# WHY THIS EXISTS
#
# Port 443 is now open from the internet to this machine (Caddy -> the media
# server), so Caddy, Node and the npm dependency tree are internet-facing. The one
# ongoing chore that direct hosting creates is keeping them patched, and a chore
# nobody is reminded about doesn't get done.
#
# ⚠️ THIS ONLY REPORTS. It deliberately does NOT run `brew upgrade` or
# `npm audit fix` on its own: an unattended upgrade of Caddy or Node on a machine
# the whole family's photos depend on can break media serving at 3am with nobody
# watching. Findings surface on the owner's Media server admin card, where applying
# them is a deliberate act.
#
# Writes JSON to logs/patch-status.json for /admin/media-server-status to read.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

OUT="logs/patch-status.json"
mkdir -p logs

BREW="/opt/homebrew/bin/brew"
[ -x "$BREW" ] || BREW="$(command -v brew || true)"

outdated_json="[]"
if [ -n "$BREW" ]; then
  # Only the formulae this mini actually exposes to the internet or depends on for
  # media. A full `brew outdated` would list every unrelated tool and turn the card
  # into noise nobody reads.
  watched="caddy node ffmpeg"
  found=""
  for f in $watched; do
    if "$BREW" outdated --quiet 2>/dev/null | grep -qx "$f"; then
      cur=$("$BREW" list --versions "$f" 2>/dev/null | awk '{print $2}')
      new=$("$BREW" info --json=v2 "$f" 2>/dev/null | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); print(d['formulae'][0]['versions']['stable'])
except Exception: print('')" 2>/dev/null)
      found="${found}{\"name\":\"$f\",\"current\":\"${cur:-?}\",\"latest\":\"${new:-?}\"},"
    fi
  done
  outdated_json="[${found%,}]"
fi

# npm audit, production dependencies only — a dev-only advisory isn't reachable
# from the internet and shouldn't nag.
audit_json='{"critical":0,"high":0,"moderate":0,"low":0,"error":null}'
if command -v npm >/dev/null 2>&1; then
  raw=$(npm audit --omit=dev --json 2>/dev/null || true)
  if [ -n "$raw" ]; then
    audit_json=$(printf '%s' "$raw" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    v=(d.get('metadata') or {}).get('vulnerabilities') or {}
    print(json.dumps({k:int(v.get(k,0)) for k in ('critical','high','moderate','low')} | {'error':None}))
except Exception as e:
    print(json.dumps({'critical':0,'high':0,'moderate':0,'low':0,'error':str(e)[:120]}))
" 2>/dev/null || echo "$audit_json")
  fi
fi

python3 - "$outdated_json" "$audit_json" <<'PY' > "$OUT"
import sys, json, datetime
outdated = json.loads(sys.argv[1] or "[]")
audit = json.loads(sys.argv[2] or "{}")
# One number the card can colour on: anything internet-facing that's behind, or a
# high/critical advisory in a production dependency.
attention = len(outdated) + int(audit.get("critical", 0)) + int(audit.get("high", 0))
print(json.dumps({
    "scannedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "outdated": outdated,
    "audit": audit,
    "needsAttention": attention > 0,
}, indent=2))
PY

echo "$(date '+%Y-%m-%dT%H:%M:%S%z') scanned: $(python3 -c "
import json;d=json.load(open('$OUT'));print(f\"{len(d['outdated'])} outdated, audit high/crit {d['audit'].get('high',0)}/{d['audit'].get('critical',0)}\")" 2>/dev/null)" >> logs/patch-scan.log
