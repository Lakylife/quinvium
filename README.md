<p align="center"><img src="assets/brand/quinvium-logo.svg" width="120" alt="Quinvium"></p>

# Quinvium

**A programmable proof-of-work blockchain mined on graphics cards.**

Quinvium (ticker QU) combines Ethash proof-of-work with the Ethereum Virtual Machine. Blocks arrive about every 15 seconds, smart contracts and wallets built for Ethereum work unchanged, and every coin is created by mining: no premine, no presale, no team allocation, no treasury. Quinvium is a decentralised network, not a company. Nobody owns it, holds an admin key or can change its rules; anyone can run a node, mine or build on it.

[Website](https://quinvium.com) · [Whitepaper](https://quinvium.com/whitepaper/) · [Explorer](https://explorer.quinvium.com) · [Download](https://quinvium.com/download/) · [Releases](https://github.com/Lakylife/quinvium/releases) · [X](https://x.com/Quinvium) · [Telegram](https://t.me/Quinvium) · [Bitcointalk](https://bitcointalk.org/index.php?topic=5600215.0)

> Quinvium is experimental software. No independent security audit has been done yet. Use it at your own risk.

## Network

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain ID | 52401 | 52402 |
| Currency | QU | tQU (no value) |
| Genesis | 14 November 2026 00:00 CET, `0x49c889ad…ac39` | `0x4845f69c…d121` |
| Public RPC | https://rpc.quinvium.com | https://rpc1.quinvium.com |
| WebSocket | wss://rpc.quinvium.com | wss://rpc1.quinvium.com |
| Explorer | https://explorer.quinvium.com | https://testnet.quinvium.com |
| P2P seed | seed.quinvium.com:30524 | seed.quinvium.com:30525 |

Machine-readable parameters: [`networks/mainnet.json`](networks/mainnet.json), [`networks/testnet.json`](networks/testnet.json).

| Parameter | Value |
| --- | --- |
| Consensus | Proof-of-work, Ethash, LWMA difficulty adjusted after every block (60-block window) |
| Block time | 15 s |
| Reward | 4 QU, halving every 8,000,000 blocks (about 3.8 years) |
| Maximum supply | 64,000,000 QU, no premined coins |
| Fees | EIP-1559; the miner receives both the base fee and the tip, nothing is burned |
| Smart contracts | EVM (Shanghai plus selected Cancun features, no blobs), Solidity, Ethereum tools and wallets |
| Capacity | 10 million gas per block (about 31 transfers per second), up to 15 million by miner vote |
| Built-in apps | Notary, names, credentials, supply chain, escrow, polls, token and NFT factories, multisig, wrapped QU, multicall |
| Mining pools | Rewards are held by a contract and split by work verified by the network; the operator cannot take them |
| Reorg protection | Reorganisations deeper than 256 blocks need twice the work |
| Upgrades | Forks with an activation height; nodes identify each other by an EIP-2124 fork ID |

## Repository

| Folder | Purpose |
| --- | --- |
| [`packages/node`](packages/node) | Full node: consensus, EVM, P2P, JSON-RPC, Stratum, pool server, built-in Explorer |
| [`packages/miner`](packages/miner) | `quintium-miner`, GPU miner in Rust (OpenCL, Vulkan, DirectX 12, Metal) |
| [`packages/contracts`](packages/contracts) | System contracts in Solidity and their compiled artifacts |
| [`packages/explorer`](packages/explorer) | Block explorer with the network apps and developer docs |
| [`packages/desktop`](packages/desktop) | Desktop app for Windows and macOS: wallet, node, mining, pools, Swap and Bridge |
| [`packages/extension`](packages/extension) | Quinvium Wallet for Chrome |
| [`packages/cli`](packages/cli) | `quinvium` command line for wallets, transfers, apps, pools and mining |
| [`packages/bridge`](packages/bridge) | Bridge validators for EVM chains and Bitcoin (not deployed) |
| [`packages/website`](packages/website) | The quinvium.com website |
| [`networks`](networks) | Network parameters, genesis and system contract addresses |
| [`ops`](ops) | Server setup for a public node: systemd units, Caddy, deployment scripts |
| [`scripts`](scripts) | Release, deployment and load-test scripts |
| [`docs`](docs) | Specification, whitepaper and guides |

## Quick start

You need Node.js 24, and Rust for the miner.

```bash
npm install
cd packages/miner && cargo build --release && cd ../..
node packages/node/src/cli.js --network mainnet
./packages/miner/target/release/quintium-miner --address YOUR_ADDRESS --node http://127.0.0.1:8545
```

The Explorer then runs at http://127.0.0.1:8545. Ready-made builds of the app, the wallet and the node are on the [download page](https://quinvium.com/download/) and in [Releases](https://github.com/Lakylife/quinvium/releases).

Connect a wallet or a tool:

```js
const provider = new ethers.JsonRpcProvider('https://rpc.quinvium.com', 52401);
```

## Documentation

| Document | Contents |
| --- | --- |
| [Whitepaper](docs/WHITEPAPER.md) | Design, consensus, monetary policy, security and roadmap |
| [Specification](docs/SPECIFICATION.md) | Exact consensus rules for auditors and other implementations |
| [Guide](docs/GUIDE.md) | Using the app, the Explorer, wallets and mining |
| [Command line](docs/CLI.md) | The `quinvium` command |
| [Running a public node](docs/RUNNING-A-PUBLIC-NODE.md) | Servers, seeds, outages and network upgrades |
| [Chain integrity](docs/CHAIN-INTEGRITY.md) | Why balances cannot be changed, `quinvium audit`, readiness |
| [Security model](docs/SECURITY-MODEL.md) | What is tested, fixed vulnerabilities, known risks |
| [Internal review](docs/REVIEW.md) | Findings of internal code reviews (not an independent audit) |
| [Capacity](docs/CAPACITY.md) | Load measurements and scaling |
| [Bridge](docs/BRIDGE.md) | Bridge and stablecoins |
| [Mainnet launch](docs/MAINNET-LAUNCH.md) | Launch parameters and open items |
| [Brand](docs/BRAND.md) | Name, logo and design rules |

Developer documentation with runnable examples and the RPC and contract reference is in the Explorer at https://explorer.quinvium.com/docs.

## Tests

```bash
npm test --workspace packages/node
npm test --workspace packages/contracts
node --test --test-concurrency=1 packages/bridge/test/*.test.js
node --no-warnings --test packages/cli/test/cli.test.js
node packages/explorer/test/e2e.mjs
node packages/explorer/test/pages.mjs
node packages/explorer/test/docs.mjs
node packages/extension/test/e2e.mjs
node packages/desktop/test/e2e.mjs
node --test packages/desktop/test/updater.test.cjs
cargo test --release --manifest-path packages/miner/Cargo.toml
```

Official EVM tests from `ethereum/tests` (tag v14.1) and Ethash in high epochs:

```bash
node packages/node/test/statetests.mjs <path>/GeneralStateTests Cancun
AETHER_SLOW=1 node --test packages/node/test/ethash.test.js
```

Longer random runs over the contracts: `AETHER_FUZZ_STEPS=300 node --test --test-concurrency=1 packages/contracts/test/invariants.test.js`.

Windows packages: `bash scripts/release.sh`. macOS build and install: `bash scripts/install-mac.sh`.

## Contributing and security

Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Changes to the consensus rules follow the public QIP process in [docs/GOVERNANCE.md](docs/GOVERNANCE.md): at least 30 days of review, 60 days on testnet and 90 days of notice before a mainnet fork. Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Bundled third-party code keeps its own licence (for example AirSwap and Solady under MIT in `packages/contracts/vendor`, WalletConnect under Apache-2.0).
