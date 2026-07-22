#!/usr/bin/env bash
#
# Build the embed-service and restart its LaunchAgent. Run ON THE MINI.
#
# Unlike fm-service, this needs NO code-signing / entitlements: it uses only
# Apple's NaturalLanguage framework (no FoundationModels / PCC), which requires
# no entitlement. A plain `swift build` binary runs fine.
#
#   ./scripts/build-restart.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # media-server/embed-service
cd "$DIR"
LABEL="com.mlr.embed-service"

# Build. Match fm-service's CLT-vs-Xcode handling: the `swift` driver strips
# DYLD_* (restricted binary), so when full Xcode isn't selected call swift-build
# directly with a fallback framework path.
if xcode-select -p 2>/dev/null | grep -q "Xcode.*\.app"; then
  swift build -c release
else
  PM=/Library/Developer/CommandLineTools/usr/lib/swift/pm
  DYLD_FALLBACK_FRAMEWORK_PATH="$PM:$PM/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/Frameworks" \
    /Library/Developer/CommandLineTools/usr/bin/swift-build -c release
fi

echo "→ built $(pwd)/.build/release/embed-service"

# Restart the LaunchAgent (no-op hint if it isn't loaded yet).
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  echo "→ restarted $LABEL"
else
  echo "⚠ $LABEL not loaded — bootstrap it once:"
  echo "  launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/$LABEL.plist"
fi
