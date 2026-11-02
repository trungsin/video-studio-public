#!/bin/sh
# Re-vendor shared render modules from the motion-video skill (single source of truth).
# Usage: MV_SRC=/workspace/motion-video sh scripts/sync-mvlib.sh
set -e
SRC=${MV_SRC:-/workspace/motion-video}
DST=$(dirname "$0")/../worker/mvlib
for f in tts_local.py vn_norm.py character.py charts.py pronounce.txt; do cp "$SRC/$f" "$DST/$f"; done
(cd "$SRC" && git rev-parse --short HEAD 2>/dev/null) > "$DST/VERSION" || true
echo "synced from $SRC ($(cat "$DST/VERSION"))"
