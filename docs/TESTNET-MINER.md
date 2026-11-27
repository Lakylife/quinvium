# Testnet CPU miner

The testnet (chainId 52402) only produces blocks while someone mines it. Upgrades must run on the testnet
for 60 days before they are offered for mainnet ([GOVERNANCE.md](GOVERNANCE.md)), so the testnet cannot
depend on someone leaving a graphics card on. The public server therefore runs a small CPU miner,
`packages/node/src/cpu-miner.js`, as the service `quinvium-testnet-miner`.

- It connects to the testnet node's Stratum on `127.0.0.1:3334` (open only on the server itself) and never
  talks to mainnet.
- It holds the full DAG of the current epoch in memory (about 1 GB, kept in `/var/lib/quinvium/testnet-miner`
  between restarts). Generating it takes a while at first start and once per epoch (30,000 blocks).
- systemd runs it at the lowest priority (`Nice=19`, idle scheduling) and caps it at `CPUQuota=30%` of one
  core, so the mainnet node and the pool always come first. The difficulty adjusts to whatever hashrate it
  has, so a low quota still gives blocks about every 15 seconds.
- Rewards go to an address derived from `/var/lib/quinvium/testnet-miner/payout.key`, created on first start.
  Testnet coins have no value; the key can fund test accounts.
- When someone mines the testnet with a graphics card, they simply win most blocks; after they leave the
  difficulty falls back within a couple of hours.

## Deploy or update

The miner runs from its own copy of the code in `/opt/quinvium-testnet-miner`, so deploying it never
changes the code the mainnet node and the pool run.

```bash
git archive origin/main packages/node ops/systemd/quinvium-testnet-miner.service | ssh root@SERVER 'set -e; rm -rf /opt/quinvium-testnet-miner; mkdir -p /opt/quinvium-testnet-miner; tar -x -C /opt/quinvium-testnet-miner; cd /opt/quinvium-testnet-miner/packages/node; npm install --omit=dev --no-audit --no-fund; cp /opt/quinvium-testnet-miner/ops/systemd/quinvium-testnet-miner.service /etc/systemd/system/; systemctl daemon-reload; systemctl enable quinvium-testnet-miner; systemctl restart quinvium-testnet-miner'
```

Watch it with `journalctl -u quinvium-testnet-miner -f`. To change the CPU share, edit `CPUQuota` in the
unit (or `systemctl set-property quinvium-testnet-miner CPUQuota=20%`).
