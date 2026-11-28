# Quinvium facts for the community assistant

This text is the assistant's whole knowledge besides the live network numbers. Keep it short and correct; every change
is read once at start (restart the announcer). Sources: README.md, docs/WHITEPAPER.md, docs/GUIDE.md, docs/POOLS.md,
docs/GOVERNANCE.md, SECURITY.md, networks/*.json.

## What Quinvium is
- Quinvium (ticker QU) is a programmable proof-of-work blockchain mined on graphics cards: Ethash proof-of-work plus the Ethereum Virtual Machine (EVM). Wallets, Solidity contracts and Ethereum tools work unchanged.
- It is a decentralised network, not a company. Nobody owns it, holds an admin key or can change its rules. Anyone can run a node, mine or build on it.
- Every coin is created by mining: no premine, no presale, no team allocation, no treasury.
- Mainnet launched on 14 November 2026 (genesis 00:00 CET). Experimental software; no independent security audit has been done yet.

## Network parameters
- Mainnet: chain ID 52401, currency QU (18 decimals). Testnet: chain ID 52402, tQU (no value).
- Public RPC mainnet: https://rpc.quinvium.com (backup https://rpc-backup.quinvium.com), WebSocket wss://rpc.quinvium.com. Testnet RPC: https://rpc1.quinvium.com.
- Explorer mainnet: https://explorer.quinvium.com (developer docs at https://explorer.quinvium.com/docs). Testnet explorer: https://testnet.quinvium.com.
- P2P seed: seed.quinvium.com:30524 (mainnet), :30525 (testnet). Default ports: RPC 8545, P2P 30524, Stratum 3333 (testnet 8546 / 30525 / 3334).
- Block time 15 s. Difficulty: LWMA, adjusted after every block over a 60-block window.
- Reward 4 QU per block, halving every 8,000,000 blocks (about 3.8 years). Maximum supply 64,000,000 QU.
- Fees: EIP-1559, the miner gets both base fee and tip; nothing is burned.
- 10 million gas per block (about 31 transfers per second), up to 15 million by miner vote.
- Reorganisations deeper than 256 blocks need twice the work.
- Add to MetaMask: network name Quinvium, RPC https://rpc.quinvium.com, chain ID 52401, symbol QU, explorer https://explorer.quinvium.com. The Explorer's Connect wallet button offers to add it automatically.

## Consensus and security details
- Ethash exactly as Ethereum used it (same cache and dataset sizes, 30,000-block epochs), checked byte for byte against real Ethereum blocks in the node and the GPU miner.
- Difficulty is recalculated after every block with a linearly weighted moving average (LWMA) over the last 60 blocks, target 15 s; a single solve time counts at most 40 × 15 s, so false timestamps have little effect and the network recovers in about half a day even if almost all hashrate leaves. Mainnet started at difficulty 2^27 (about 9 MH/s).
- The heaviest valid chain (most total difficulty) wins. A node rejects blocks more than 256 blocks (about an hour) below its head; a deeper reorganisation is accepted only with at least twice the work, after all its headers were checked. History below a checkpoint published with a release is never rewritten.
- Done: official Ethereum state tests for the supported rules, cryptography cross-checks, attack, fuzzing and fork tests, fixed fingerprints (golden tests) against accidental consensus changes, internal code reviews (7–8, 10 and 13 November 2026). Not done yet: an independent security audit.
- Known risks: a young proof-of-work network can be rewritten briefly with rented hashrate (wait for more confirmations on large payments); at launch the public RPC and seed run on one server (more independent public nodes are a priority); desktop builds are not code-signed yet (check the SHA-256 sums); PREVRANDAO can be influenced by miners and must not be used for lotteries.
- No foundation, owner or admin key; nobody can freeze funds or reverse transactions. The built-in contracts have no owner.
- EVM: Shanghai plus selected Cancun features, no blobs. Solidity, ethers.js, Hardhat-style tools work. Developer docs with runnable examples and the RPC and contract reference: https://explorer.quinvium.com/docs

## Apps and downloads
- Official downloads only from https://quinvium.com/download/ or GitHub releases https://github.com/Lakylife/quinvium/releases. Each release has SHA256SUMS. Never install "Quinvium" files from other sites or from DMs.
- Desktop app (Windows, macOS): wallet, node, mining on the graphics card, pools, Explorer. Windows SmartScreen may warn because the build is not code-signed yet: More info, Run anyway.
- On mainnet the app does not update itself; install new versions by hand from the download page. It checks GitHub for new versions and can download and verify the installer.
- Quinvium Wallet for Chrome: download the zip from the releases page and load it in chrome://extensions (Developer mode, Load unpacked). It is not in the Chrome Web Store yet.
- MetaMask works too. On Quinvium it shows only "Network suggested" fees and its Swap button does not work; swaps are done on the Explorer's Swap page.
- Built-in apps (system contracts, part of the chain, no owner), used in the Explorer's Apps page, the app and the command line: notary (stamp and verify a file's hash), credentials (issue and verify), supply chain, payment escrow, polls, address names (name registry), custom tokens (token factory), NFT collections, multisig wallets, wrapped QU and multicall.
- Tokens: anyone can create a token with any name and symbol; the token address is what matters. The Explorer's Tokens page shows verified tokens and the wallet marks whether a token is verified.
- Swap (liquidity pools, 0.3 % fee to liquidity providers) is deployed on testnet only; a verified token list and swap on mainnet are planned later.
- The bridge to other networks (EVM chains, Bitcoin) is written but not deployed; it will run on mainnet only with independent validators.

## Command line (`quinvium`)
- Install: in the app, Settings, Command line, "Make the quinvium command available"; on Windows without the app it is in the Node and Miner package; from source `node packages/cli/bin/quintium.js`.
- Examples: `quinvium status`, `quinvium search 0xADDRESS`, `quinvium wallet create`, `quinvium wallet import NAME` (from a phrase, same addresses as the app and MetaMask), `quinvium balance`, `quinvium send 0xADDRESS 1.5`, `quinvium mine`, `quinvium pool list`, `quinvium pool claim 0xPOOL`, `quinvium notary stamp FILE`, `quinvium token create`, `quinvium multisig create`, `quinvium audit` (checks the chain's integrity). It connects to the local node; `--rpc` picks another one. English by default, `quinvium lang cs` for Czech.
- The wallet's recovery phrase must be written on paper. Without it nobody can recover the funds; nobody else can reset it.

## Mining
- Desktop app: Mining tab, start mining; choose solo or a pool under "Where you mine". The card needs DirectX 12 or Vulkan and at least 2 GB of memory (grows about 8 MB every 5 days).
- Quinvium miner: `quintium-miner --address YOUR_ADDRESS --node http://127.0.0.1:8545` (solo through your own node).
- Common Ethash miners (lolMiner, T-Rex, TeamRedMiner) connect over Stratum to a node with Stratum open: user = your address, optionally `.rig1`, password x. Solo through your own node on port 3333.
- Official pool: stratum+tcp://pool.quinvium.com:4444, pool contract 0xd7B63BCE0E77E0e53D7309e7E64cA4346e0dF5c8 (version 2). Other pools are listed at https://explorer.quinvium.com/pools.
- Pools are smart contracts: block rewards go to the contract, never to the operator; work is verified by the network; fee at most 5 % and fixed forever; PPLNS over recent rounds; anyone can trigger payouts. Withdraw earnings in the app, on the pool page in the Explorer, or `quinvium pool claim 0xPOOL`.
- ASICs: plain Ethash (30,000-block epochs, not Etchash), Stratum ETHPROXY and EthereumStratum/1.0.0. Nobody has tested a real ASIC on this network yet.
- Anyone can create a pool: Explorer, Pools, Create a pool, then run the pool server (a node with `--pool`).

## Running a node
- Easiest: the desktop app runs a full node by itself (Node tab). Without the app: the Node and Miner package from the releases, or from the repository with Node.js 24: `node packages/node/src/cli.js --network mainnet`.
- A public node (RPC endpoint, seed, Explorer) on a server: Ubuntu 24.04, at least 2 vCPU, 4 GB RAM, 100 GB SSD (archive node, grows with use), a domain for HTTPS. Setup scripts are in `ops/`. Do not mine on a rented server unless the provider allows it. Guide: https://github.com/Lakylife/quinvium/blob/main/docs/RUNNING-A-PUBLIC-NODE.md
- Share my node (in the app, Node tab): makes your node's public RPC reachable through a Cloudflare quick tunnel, so the Explorer, website and wallets keep working when the main servers are down. No account, no router port, your IP address stays hidden; a few hundred MB upload a day; only while the app runs, off any time. Other nodes check the shared address before listing it. Mining and node-control methods are refused through the tunnel.

## Governance and upgrades
- Rule changes go through public Quinvium Improvement Proposals (QIPs) in docs/qips: at least 30 days of review, 14 days last call, 60 days on testnet, and a mainnet release announced 90 days before a fixed fork height. No admin key, no remote switch, no on-chain vote can change the rules; node operators choose to run a release.
- The 64 million cap, the halving schedule and "no premine" cannot be changed by a QIP.
- Miners can signal support for an accepted QIP with `QIP-<n>` in block extra data; it is informative only.

## Security
- Report vulnerabilities privately: https://github.com/Lakylife/quinvium/security (Report a vulnerability). Not in public chats or issues.
- Admins never DM first and never ask for coins, seed phrases or private keys. Anyone who does is a scammer.

## Community
- Telegram channel @Quinvium (pinned join post) and the Quinvium Community group with these topics: 📌 RULES & LINKS, 📢 ANNOUNCEMENTS, 🆘 HELP & SUPPORT, 💬 GENERAL CHAT, ⛏️ MINING CHAT, 📡 Mining feed (bot posts), 🖥️ Nodes & RPC, 👛 Wallets & App, 🛠️ Development & QIPs, 🍴 Forks & Upgrades, 💡 Ideas & Feedback, 🧩 Showcase, 🇨🇿 Czech & Slovak, 🇷🇺 Russian, 🇨🇳 Chinese, 🇯🇵 Japanese, 🇰🇷 Korean, 🌍 Other languages, 🎲 Off-topic. English in the main topics; other languages in their topics.
- Website https://quinvium.com, whitepaper https://quinvium.com/whitepaper/, X https://x.com/Quinvium, GitHub https://github.com/Lakylife/quinvium, Bitcointalk https://bitcointalk.org/index.php?topic=5600215.0
- Bugs and feature requests: GitHub issues https://github.com/Lakylife/quinvium/issues

## Roadmap (intentions, not promises)
- Next: an independent security audit, a second public node with another provider, the update-signing key off the development machine, signed Windows and macOS builds, the wallet in the Chrome Web Store.
- Later: swap and a verified token list on mainnet, a bridge with independent validators, pruning and snapshot sync.

## Price / value of QU
- QU has no official or reference price. The project publishes no price and has not listed QU on any exchange; there is no official exchange listing.
- There is no company, foundation or token sale behind QU: no premine, no ICO, no presale, no team allocation, no treasury. Quinvium is a decentralised network with no company or owner.
- QU is created only by mining: 4 QU per block since the mainnet launch on 14 November 2026 (chain ID 52401), halving every 8,000,000 blocks, at most 64,000,000 QU.
- Any trades happen peer-to-peer, between users, at their own risk. Blockchain transactions cannot be reversed; beware of scammers offering to sell or buy QU.
- The assistant never gives price predictions or investment advice and never promotes buying or selling QU. News: the 📢 ANNOUNCEMENTS topic and https://explorer.quinvium.com for live network data.

## Not known / not offered
- Exchange listings, prices and trading: the assistant has no information about them and gives none. The project makes no promise about the price or value of QU. Official news is posted in 📢 ANNOUNCEMENTS.
- Block explorers of other networks and third-party "Quinvium" sites are not official; the official explorer is https://explorer.quinvium.com
