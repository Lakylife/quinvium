#!/bin/bash
# One-time preparation of an Ubuntu 24.04 server for a public Quinvium node. Run as root.
# Installs security updates, fail2ban, the ufw firewall, Node.js 24 and Caddy, and creates the `quinvium` user.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install unattended-upgrades fail2ban ufw curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https
dpkg-reconfigure -f noninteractive unattended-upgrades
# Node.js 24 from NodeSource
if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get -y install nodejs
fi
# Caddy from its official repository
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get -y install caddy
fi
id quinvium >/dev/null 2>&1 || useradd --system --home /var/lib/quinvium --shell /usr/sbin/nologin quinvium
install -d -o quinvium -g quinvium -m 750 /var/lib/quinvium
install -d -m 755 /opt/quinvium
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 30524/tcp   # mainnet P2P
ufw allow 30525/tcp   # testnet P2P
ufw --force enable
systemctl enable --now fail2ban
# Log in with SSH keys only (check that key login works in a second session before closing this one)
printf "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n" > /etc/ssh/sshd_config.d/10-quinvium.conf
sshd -t && systemctl reload ssh
