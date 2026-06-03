#!/usr/bin/env bash
# Tidy pre-layout media: move the flat files sitting at MEDIA_DIR root
# (MEDIA_DIR/<uuid>.<ext>) into posts/legacy/. The server's /f fallback mount
# serves posts/legacy, so the flat "/f/<uuid>.<ext>" URLs already saved in the
# database keep resolving — no DB changes, zero broken images. Safe to re-run.
#
# Usage (on the mini, after deploying the new server.js):
#   MEDIA_DIR=/Users/brian/mlr-app/media-server/media bash organize-legacy.sh
set -euo pipefail
MEDIA_DIR="${MEDIA_DIR:-$(cd "$(dirname "$0")/.." && pwd)/media}"
LEGACY="$MEDIA_DIR/posts/legacy"
mkdir -p "$LEGACY"
shopt -s nullglob
moved=0
for f in "$MEDIA_DIR"/*; do
  [ -f "$f" ] || continue            # only top-level files; skip posts/ chat/ dirs
  mv -n "$f" "$LEGACY/" && moved=$((moved + 1))
done
echo "Moved $moved legacy file(s) into $LEGACY"
echo "Top level of $MEDIA_DIR now:"
ls -1 "$MEDIA_DIR"
