#!/bin/bash
# Upload one release folder (all files plus SHA256SUMS.txt) to /var/www/quinvium-downloads/<version> and verify the checksums there.
# Usage: ops/deploy-downloads.sh path/to/<version> root@SERVER
set -euo pipefail
SRC=${1:?usage: deploy-downloads.sh path/to/<version> root@SERVER}
HOST=${2:?usage: deploy-downloads.sh path/to/<version> root@SERVER}
VER=$(basename "$SRC")
(cd "$SRC" && shasum -a 256 -c SHA256SUMS.txt)
ssh "$HOST" "mkdir -p /var/www/quinvium-downloads/$VER"
rsync -a --partial "$SRC/" "$HOST:/var/www/quinvium-downloads/$VER/"
ssh "$HOST" "chown -R root:root /var/www/quinvium-downloads && chmod -R u=rwX,go=rX /var/www/quinvium-downloads && cd /var/www/quinvium-downloads/$VER && sha256sum -c SHA256SUMS.txt"
