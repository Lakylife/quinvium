#!/bin/bash
# Deploy or update the node and the Explorer from this repository to a server prepared with setup-server.sh.
# Usage: ops/deploy-node.sh root@SERVER [mainnet|testnet]
# The chosen network's service is restarted; the other one keeps running.
set -euo pipefail
HOST=${1:?usage: deploy-node.sh root@SERVER [mainnet|testnet]}
NET=${2:-mainnet}
REPO=$(cd "$(dirname "$0")/.." && pwd)
ssh "$HOST" "mkdir -p /opt/quinvium/packages/node /opt/quinvium/packages/explorer/public"
rsync -az --delete --exclude test --exclude node_modules --exclude package-lock.json "$REPO/packages/node/" "$HOST:/opt/quinvium/packages/node/"
rsync -az --delete "$REPO/packages/explorer/public/" "$HOST:/opt/quinvium/packages/explorer/public/"
ssh "$HOST" 'chown -R root:root /opt/quinvium && chmod -R u=rwX,go=rX /opt/quinvium && cd /opt/quinvium/packages/node && npm install --omit=dev --no-audit --no-fund'
scp "$REPO/ops/systemd/quinvium-$NET.service" "$HOST:/etc/systemd/system/quinvium-$NET.service"
ssh "$HOST" "systemctl daemon-reload && systemctl enable quinvium-$NET && systemctl restart quinvium-$NET; sleep 3; systemctl --no-pager status quinvium-$NET | head -5"
