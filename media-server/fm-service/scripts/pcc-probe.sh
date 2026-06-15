#!/usr/bin/env bash
#
# Re-test whether Private Cloud Compute is reachable on this machine. Run after
# any macOS update, or after build-sign-restart.sh. PCC is LIVE the moment
# `fm respond --model pcc` returns text instead of "not available in this
# context" — at which point the fm-service's startup probe auto-routes to it
# with no code change (just restart the agent).
#
#   ./scripts/pcc-probe.sh
#
set -uo pipefail
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

echo "macOS: $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
echo

echo "== fm CLI (Apple's own signed binary) =="
if command -v fm >/dev/null 2>&1; then
  printf '  available: '; fm available --model pcc 2>&1 | strip | grep -aiE "available|not available|error" | head -1
  printf '  generate : '; fm respond --model pcc 'Reply with the single word: ok' 2>&1 | strip | grep -aiE "^ok$|ok|not available|error" | head -1
else
  echo "  fm CLI not installed (expected on macOS 27+)."
fi
echo

echo "== mlr fm-service (this third-party build) =="
PLIST="$HOME/Library/LaunchAgents/com.mlr.fm-service.plist"
SECRET="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:FM_SHARED_SECRET' "$PLIST" 2>/dev/null || true)"
if lsof -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; then
  curl -s --max-time 60 localhost:8788/assistant -H 'content-type: application/json' \
    ${SECRET:+-H "x-fm-token: $SECRET"} \
    -d '{"system":"Answer only from the context.","question":"ping","context":"[x] pong"}'
  echo
else
  echo "  service not listening on :8788 — start/restart the LaunchAgent."
fi
echo
echo "→ PCC is enabled when the fm CLI 'generate' line prints ok, and the service"
echo "  reports \"model\":\"private-cloud-compute\" (it falls back to on-device until then)."
