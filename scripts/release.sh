#!/bin/bash
# Builds all Windows packages into the release/ folder. Requires Node 24, Rust and mingw-w64.
set -euo pipefail
# Rust from rustup (has the x86_64-pc-windows-gnu target) before Rust from Homebrew, which does not.
[ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"
# Source paths in binaries without the user name (Rust panic messages), see release 2.14.0.
export RUSTFLAGS="--remap-path-prefix=$HOME=/build ${RUSTFLAGS:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release"
WORK="$(mktemp -d)"
VERSION="$(node -p "require('$ROOT/packages/desktop/package.json').version")"
FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
NODE_VERSION="v$(node -p 'process.versions.node')"
trap 'rm -rf "$WORK"' EXIT

echo "== Kontrakty"
(cd "$ROOT/packages/contracts" && node build.js >/dev/null)

echo "== Miner pro Windows"
(cd "$ROOT/packages/miner" && cargo build --release --target x86_64-pc-windows-gnu 2>&1 | tail -1)

echo "== Uzel v jednom souboru a soubory aplikace"
(cd "$ROOT/packages/desktop" && node scripts/prepare.mjs win | tail -1)

echo "== Aplikace pro Windows"
rm -rf "$ROOT/packages/desktop/release"
(cd "$ROOT/packages/desktop" && npx electron-builder --win --x64 --publish never 2>&1 | tail -2)

echo "== Samostatný uzel pro Windows"
cd "$WORK"
curl -fsS -o node.exe "https://nodejs.org/dist/$NODE_VERSION/win-x64/node.exe"
EXPECTED="$(curl -fsS "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | awk '$2 == "win-x64/node.exe" {print $1}')"
ACTUAL="$(shasum -a 256 node.exe | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "Kontrolní součet node.exe nesouhlasí"; exit 1; }
cp "$ROOT/packages/desktop/build/quintium-node.cjs" "$ROOT/packages/desktop/build/vm-worker.cjs" .
cat > sea.json <<'JSON'
{ "main": "quintium-node.cjs", "output": "sea.blob", "disableExperimentalSEAWarning": true, "useSnapshot": false, "useCodeCache": false, "assets": { "vm-worker.cjs": "vm-worker.cjs" } }
JSON
node --experimental-sea-config sea.json >/dev/null
"$ROOT/node_modules/.bin/postject" node.exe NODE_SEA_BLOB sea.blob --sentinel-fuse "$FUSE" >/dev/null

echo "== Balíčky"
rm -rf "$OUT"
mkdir -p "$OUT" "$WORK/quintium"
mv node.exe "$WORK/quintium/quintium-node.exe"
cp "$ROOT/packages/miner/target/x86_64-pc-windows-gnu/release/quintium-miner.exe" "$WORK/quintium/"
cp -R "$ROOT/packages/explorer/public" "$WORK/quintium/explorer"
cp "$ROOT"/scripts/windows/* "$WORK/quintium/"
(cd "$WORK" && zip -qr "$OUT/Quinvium-Uzel-a-Miner-$VERSION-Windows-x64.zip" quintium)
cp "$ROOT/packages/desktop/release/Quinvium-$VERSION-Windows-x64.exe" "$ROOT/packages/desktop/release/Quinvium-$VERSION-Windows-x64.zip" "$OUT/"
(cd "$ROOT/packages/extension" && zip -qr "$OUT/Quinvium-Wallet-Chrome-$VERSION.zip" manifest.json background.js content.js inpage.js popup.html popup.css qrcode.js jsqr.js jsqr.js.LICENSE.txt qr-tools.js quinvium-symbol.ttf popup.js i18n.js ethers.umd.min.js icons/16.png icons/48.png icons/128.png)
(cd "$OUT" && shasum -a 256 ./*.zip ./*.exe > SHA256SUMS.txt)
ls -la "$OUT"
