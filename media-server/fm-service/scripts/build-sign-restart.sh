#!/usr/bin/env bash
#
# Build the fm-service, code-sign it with a real Apple identity + the Foundation
# Models entitlements, and restart its LaunchAgent. Run ON THE MINI.
#
# Why this exists: a plain `swift build` binary is ad-hoc ("linker-signed") with
# no Team identifier, which is one of the gates on Private Cloud Compute
# inference (third-party builds get ModelManagerError 1046). Signing with a
# Developer identity + entitlements is the prerequisite for PCC *if/when* Apple
# enables it for third parties — see PCC-ENABLEMENT.md. Until then the service
# runs on-device regardless (its startup probe decides), so this script is safe
# to run today and is the ONE-STEP FLIP once the paid account + entitlement land.
#
#   ./scripts/build-sign-restart.sh
#   FM_SIGN_IDENTITY="Apple Development: you (TEAMID)" ./scripts/build-sign-restart.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # media-server/fm-service
cd "$DIR"

BIN=".build/release/fm-service"
ENTITLEMENTS="fm-service.entitlements"
LABEL="com.mlr.fm-service"

# 1. Pick a signing identity (env override, else the first usable Apple cert).
IDENTITY="${FM_SIGN_IDENTITY:-$(security find-identity -v -p codesigning \
  | awk -F'"' '/Apple (Development|Distribution)|Developer ID Application/{print $2; exit}')}"
if [ -z "${IDENTITY:-}" ]; then
  echo "✗ No codesigning identity found." >&2
  echo "  Sign into your (paid) Apple account in Xcode → Settings → Accounts," >&2
  echo "  let it create an 'Apple Development' cert, then re-run." >&2
  exit 1
fi
echo "→ Signing identity: $IDENTITY"

# 2. Build. The CLT beta ships SwiftPM's build frameworks off the tool's rpath,
#    and the `swift` driver strips DYLD_* (restricted binary) — so when full Xcode
#    isn't selected, call swift-build directly with a fallback framework path.
if xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
  swift build -c release
else
  PM=/Library/Developer/CommandLineTools/usr/lib/swift/pm
  DYLD_FALLBACK_FRAMEWORK_PATH="$PM:$PM/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/Frameworks" \
    /Library/Developer/CommandLineTools/usr/bin/swift-build -c release
fi

# 3. Sign with the entitlements (local loopback service → no hardened runtime;
#    add `--options runtime` only when notarizing/distributing).
codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" "$BIN"

echo "=== signature ===" && codesign -dvvv "$BIN" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier" || true
echo "=== entitlements ===" && codesign -d --entitlements - "$BIN" 2>&1 || true

# 4. Restart the LaunchAgent so the freshly-signed binary re-runs its startup
#    PCC probe. (Falls back to a plain relaunch hint if the agent isn't loaded.)
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  echo "→ Restarted $LABEL."
else
  echo "⚠ $LABEL not loaded — start it with your normal LaunchAgent setup."
fi
echo "→ Now run: ./scripts/pcc-probe.sh"
