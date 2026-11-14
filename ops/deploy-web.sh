#!/bin/bash
# Build and upload the website, the Explorer files and the Caddy configuration, then reload Caddy.
# Nodes are not restarted: they read the Explorer files from disk on every request.
# Usage: ops/deploy-web.sh root@SERVER
set -euo pipefail
HOST=${1:?usage: deploy-web.sh root@SERVER}
REPO=$(cd "$(dirname "$0")/.." && pwd)
(cd "$REPO" && node packages/website/src/build.mjs)
ssh "$HOST" "mkdir -p /var/www/quinvium /opt/quinvium/packages/explorer/public"
rsync -az --delete "$REPO/packages/website/public/" "$HOST:/var/www/quinvium/"
rsync -az --delete "$REPO/packages/explorer/public/" "$HOST:/opt/quinvium/packages/explorer/public/"
scp -q "$REPO/ops/caddy/Caddyfile" "$HOST:/etc/caddy/Caddyfile"
ssh "$HOST" 'chown -R root:root /var/www/quinvium /opt/quinvium/packages/explorer && chmod -R u=rwX,go=rX /var/www/quinvium /opt/quinvium/packages/explorer && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy'
