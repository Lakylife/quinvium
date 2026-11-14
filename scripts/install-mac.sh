#!/bin/bash
# Builds Quinvium.app, installs it into /Applications and starts it. App data stays in ~/Library/Application Support/Aether.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/packages/miner" && cargo build --release 2>&1 | tail -1)
cd "$ROOT/packages/desktop"
node scripts/prepare.mjs mac | tail -1
npx electron-builder --mac dir --x64 --publish never -c.electronDist=../../node_modules/electron/dist 2>&1 | tail -1
# The older installation had a different name. App data does not change; it stays in the same folder.
for name in Aether Sidereum Quintium Quinvium; do
  if [ -d "/Applications/$name.app" ]; then
    osascript -e "tell application \"$name\" to quit" 2>/dev/null || true
    while pgrep -f "/Applications/$name.app/Contents/MacOS/" >/dev/null; do sleep 1; done
    rm -rf "/Applications/$name.app"
  fi
done
cp -R release/mac/Quinvium.app /Applications/Quinvium.app
open /Applications/Quinvium.app
