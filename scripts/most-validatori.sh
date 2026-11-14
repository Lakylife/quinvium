#!/bin/zsh
# Starts three test bridge validators as macOS services (LaunchAgent). They start again by themselves after a reboot.
# Configuration and keys are created by scripts/nasadit-most.mjs in the operator's private folder. Testnet only.
# Usage: scripts/most-validatori.sh spustit | zastavit | stav   (start | stop | status)
set -euo pipefail
DIR="$HOME/.aether/most-testnet"
AGENTS="$HOME/Library/LaunchAgents"
NODE="${NODE:-$HOME/.nvm/versions/node/v24.22.2/bin/node}"
CLI="$(cd "$(dirname "$0")/.." && pwd)/packages/bridge/src/cli.js"
DOMAIN="gui/$(id -u)"

case "${1:-stav}" in
  spustit)
    mkdir -p "$AGENTS"
    for n in 1 2 3; do
      label="org.quintium.most.validator-$n"
      [ -f "$DIR/validator-$n.json" ] || { echo "Chybí $DIR/validator-$n.json, nejdřív spusťte nasadit-most.mjs"; exit 1; }
      cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$CLI</string><string>$DIR/validator-$n.json</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$DIR/validator-$n.log</string>
  <key>StandardErrorPath</key><string>$DIR/validator-$n.log</string>
</dict>
</plist>
EOF
      launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
      launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
      echo "validátor $n spuštěn"
    done
    ;;
  zastavit)
    for n in 1 2 3; do
      launchctl bootout "$DOMAIN/org.quintium.most.validator-$n" 2>/dev/null && echo "validátor $n zastaven" || echo "validátor $n neběží"
    done
    ;;
  stav)
    for n in 1 2 3; do
      if launchctl print "$DOMAIN/org.quintium.most.validator-$n" >/dev/null 2>&1; then echo "validátor $n běží"; else echo "validátor $n neběží"; fi
      [ -f "$DIR/validator-$n.log" ] && tail -2 "$DIR/validator-$n.log"
    done
    ;;
  *) echo "Použití: $0 spustit | zastavit | stav"; exit 1 ;;
esac
