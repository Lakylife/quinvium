# Running a public node

Anyone can run a Quinvium node, a public RPC endpoint, a seed or an Explorer. This guide describes the setup used for the public endpoints `rpc.quinvium.com`, `rpc1.quinvium.com`, `explorer.quinvium.com` and `seed.quinvium.com`; the files are in [`ops/`](../ops). More independent public nodes in different places make the network more resilient, so new operators are welcome.

## Requirements

- A server with a public IP, Ubuntu 24.04, at least 2 vCPU, 4 GB RAM and 100 GB SSD. The node is an archive node and grows with use.
- A domain name for HTTPS (for example `rpc.example.org`).
- Node.js 24 (installed by `ops/setup-server.sh`).
- Do not mine on a rented server unless the provider's terms allow it; many forbid it. A public node does not need to mine.

## Setup

```bash
# 1. On the server, as root: updates, firewall, fail2ban, Node.js 24, Caddy, the `quinvium` user, SSH keys only
bash ops/setup-server.sh

# 2. From a computer with this repository: upload the node and the Explorer and start the service
ops/deploy-node.sh root@SERVER mainnet
ops/deploy-node.sh root@SERVER testnet      # optional, a second service next to mainnet

# 3. HTTPS: point DNS (A and AAAA) of your domain to the server and install a Caddy configuration
#    ops/caddy/Caddyfile.single-node is a minimal example; ops/caddy/Caddyfile is the quinvium.com setup
```

What runs on the server:

| Service | Purpose | Ports |
| --- | --- | --- |
| `quinvium-mainnet` (systemd) | mainnet node, also serves the Explorer; user `quinvium`, data `/var/lib/quinvium/mainnet` including `node.key` | RPC 127.0.0.1:8545, P2P 30524 |
| `quinvium-testnet` (systemd) | testnet node, data `/var/lib/quinvium/testnet` | RPC 127.0.0.1:8546, P2P 30525 |
| `caddy` | HTTPS reverse proxy with automatic certificates | 80, 443 |
| `ufw`, `fail2ban`, `unattended-upgrades` | firewall (22, 80, 443, 30524, 30525), SSH protection, security updates | |

Rules for a public node:

- Keep JSON-RPC on `127.0.0.1` and expose it only through the HTTPS proxy.
- Run with `--no-mining-rpc` so nobody can submit work or fake the hashrate through the public endpoint, and with `--trust-proxy` only when the node sits behind your own proxy (otherwise clients could invent their IP and bypass the rate limit).
- Keep `--rate-limit` (600 requests per minute per IP in the templates).
- Open the P2P port (30524 mainnet, 30525 testnet) so other nodes can connect.

## Docker

Each release is also published as a container image for `linux/amd64` and `linux/arm64`: `ghcr.io/lakylife/quinvium-node:<version>` and `:latest`. It is built from [`ops/docker/Dockerfile`](../ops/docker/Dockerfile) by the `docker` workflow; the image runs as a non-root user and keeps all data, including `node.key`, in the volume `/data`.

```bash
# Mainnet node: P2P open to the world, JSON-RPC and the Explorer only on this server
docker run -d --name quinvium --restart unless-stopped \
  -p 30524:30524 -p 127.0.0.1:8545:8545 \
  -v quinvium-mainnet:/data \
  ghcr.io/lakylife/quinvium-node:latest

docker logs -f quinvium            # log
docker stop quinvium               # clean shutdown (SIGTERM)
```

Testnet: `-p 30525:30525 -p 127.0.0.1:8546:8546 -e RPC_PORT=8546 -v quinvium-testnet:/data ghcr.io/lakylife/quinvium-node:latest --network testnet`. Options after the image name replace the default `--network mainnet`, so repeat the network there, for example `... quinvium-node:latest --network mainnet --no-mining-rpc --trust-proxy`.

- Inside the container JSON-RPC listens on all interfaces, so publish it only on `127.0.0.1` as above. Docker forwards connections from a private address, so the node treats every caller as local (mining methods allowed, no rate limit per IP).
- For a public endpoint put your HTTPS proxy in front (see Setup) and add `--no-mining-rpc --trust-proxy`; the proxy then passes the real client address and the rate limit works per client.
- Stratum for your own miners: add `-p 3333:3333` and `--stratum-host 0.0.0.0`.
- Update: `docker pull ghcr.io/lakylife/quinvium-node:latest`, then remove and start the container again with the same volume.

## Operations

- **Update the node:** `ops/deploy-node.sh root@SERVER mainnet`.
- **Logs:** `journalctl -u quinvium-mainnet -f`, for Caddy `journalctl -u caddy`.
- **Health:** `curl https://rpc.example.org/health` returns 200, or 503 while syncing or when more than 3 blocks behind; `?maxAge=600` also checks that a block arrived recently.
- **Node identity:** `aether_nodeInfo` returns the node's public key (`curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"aether_nodeInfo","params":[]}' http://127.0.0.1:8545`).
- **Chain check:** run `quinvium audit` regularly, after every crash and before every release, see [CHAIN-INTEGRITY.md](CHAIN-INTEGRITY.md).

## Becoming a seed

A seed is the first contact for new nodes; after that, nodes exchange addresses among themselves.

1. Run a public node as above with an open P2P port.
2. Get its public key from `aether_nodeInfo`.
3. Propose the entry `publickey@your.host:30524` for `seeds` in `packages/node/src/params.js` in a pull request. New nodes accept a seed with a pinned key only if it proves that key, so not even forged DNS can lead them elsewhere.
4. Keep `node.key` when moving the server: copy it into the new data folder, otherwise the seed announces a different key and new nodes reject it.

## When one node goes down

The chain is not held by any single computer. Every full node has a complete copy, verifies every block itself, and a new or restored node downloads missing blocks from the others. The chain lives as long as at least one node runs, and new blocks appear as long as at least one miner mines.

For an outage of one machine to go unnoticed, four things are needed:

| What | How | Status in code |
| --- | --- | --- |
| At least two nodes in different places (different power and connectivity) | servers with different providers | ready, more operators needed |
| A new node finds the network even if one server is down | several seeds of different operators in `seeds`, at least one by IP address so DNS is not needed | the node records all addresses behind a name and remembers every peer it met |
| The Explorer, the website and wallets keep working | `rpc: [...]` in `config.js`, then community nodes from `quinvium_publicNodes` and `nodes.json` (written at each Pages deploy by `ops/pages/nodes.mjs`); a community node is used only with the expected chain ID and genesis | `packages/explorer/test/failover.mjs`, `packages/node/test/outage.test.js`, `packages/extension/test/community-fallback.test.cjs` |
| An outage is noticed | an uptime monitor on `/health` | `/health` returns 200 or 503 |

Mining: when a pool server goes down, `quintium-miner` mines solo through the backup nodes given with `--fallback` (the app passes its own node) and returns to the pool later. Common miners (lolMiner, T-Rex) support a backup pool in their settings. The app warns when mining earns nothing (no answer, no peers, no new blocks).

## Network upgrades

Rules change with a fork in `network.forks` in `params.js`, see [SPECIFICATION.md](SPECIFICATION.md#10-network-upgrades). Procedure:

1. Test the fork on testnet first.
2. Choose a height with enough margin for miners and exchanges to update; on mainnet at least several weeks.
3. Before release, run the whole suite including `statetests.mjs` and update `test/golden.test.js`.
4. Nodes without the update disconnect from the network after the fork height.

Dependencies that affect consensus have exact versions. Updating EthereumJS or the cryptographic libraries is treated as a possible hard fork.

## Legal note

In the EU, issuing and offering crypto-assets is governed by the MiCA regulation. A purely mined coin without sales to the public is in a different position than a token sold to investors, but where the line lies is for a lawyer to judge. Anyone who sells coins, promises returns, or runs an exchange or custody service should sort this out with a lawyer **beforehand**. Wallets and the node are designed without custody of other people's funds, which helps but does not settle everything.


## Sharing a node from home (community nodes)

The desktop app has **Share node publicly** under Node → Connect to another computer. It is off by default.

- The node opens a tunnel port that only this computer can reach (`--tunnel-port`, 8565 on mainnet). Everything arriving there counts as a request from the internet: mining and node-control methods are refused, peer IP addresses are hidden and each visitor (by `Cf-Connecting-IP`) has the public limit of 1,200 requests a minute.
- The app starts a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:8565`, no account). The router opens no port and the operator's IP address stays behind Cloudflare; Cloudflare sees the requests that pass through.
- The tunnel's `https://….trycloudflare.com` address is announced to peers, signed by the node key and valid for two hours (renewed while sharing). Every node that receives it checks the address itself (same chain ID, same block six blocks below its head, head at most 20 blocks behind) before listing it in `quinvium_publicNodes` and passing it on.
- The Explorer stores the verified list and switches to a community node only when none of its configured nodes answers; it returns to them when they are back.
- `cloudflared` is downloaded from Cloudflare's GitHub release only, pinned by version and SHA-256 in `packages/desktop/src/share-node.cjs`.
