# Changelog

## Unreleased

## 2.16.2 (18 November 2026)

- The official pool moves to `0xd7B63BCE0E77E0e53D7309e7E64cA4346e0dF5c8` (version 2); the version 2 pool factory is `0x0c381536835836Fb1AFFEc95BA9121d388E5D90c`. Miners keep connecting to `pool.quinvium.com`.
- App on weaker computers: mining does not start without a usable graphics card, enough card memory for the current epoch, RAM or disk, each with its own message; Stop always stops the miner; node and miner run at lower priority; the node's sync stage is shown (#66).
- Windows installer: the program folder is Quinvium; an earlier Aether or Quintium folder is replaced (#63).
- Wallet: a strong password generator with show and hide and copy when creating an account (#64).
- App: a clearer offer to share the node publicly (#65).
- Fixes from the independent review of 18 November 2026:
  - Node: a long network split that forked right at a checkpoint (or above it, when the peer's headers started with shared blocks) was refused as "below a checkpoint"; the fork point is now where the peer's headers leave our chain, and only a fork below the checkpoint is refused.
  - RPC: with `--trust-proxy`, proxy headers count only from the proxy on this computer; a request from a web page other than the node's own Explorer is a foreign caller and cannot control the node. The wallet never passes node-control or mining methods from a page.
  - Mempool: a transaction rejected for a full queue no longer pushes out anyone else's.
  - Bridge: a delivered transfer is closed only once the delivery is confirmed; a queued transfer is not paid in another token after its route was remapped (new error `RouteChangedWhileQueued`); Bitcoin validator settings left out of the configuration keep their defaults and nonsense stops the validator at start.
  - Wallet: the EIP-712 type shown is the one the schema signs; a page naming another type is refused before the dialog.
  - App: update descriptions are cut off at 16 KiB while they arrive.
- Pools that pay their server's gas from the mined rewards (version 2: `AetherPool2` and `PoolFactory2`). The operator names the server account; its gas for shares, payouts and closing rounds comes back after each call, priced at most at the base fee plus 2 gwei, only from coins not yet distributed and at most 1 % of the pool's income. The factory is an ordinary contract deployed from the Explorer and trusted only when its code matches the build. Node (`aether_poolVersion`, pool lists), pool server, Explorer, app and CLI recognise these pools. No consensus change.

## 2.16.1 (18 November 2026)

- Miner: switches to the backup node after 3 failed requests (about 20 s instead of minutes) and reports its hashrate to the node in use (#44).
- Pool server: refuses the pool's own address and the zero address as a payout address (#47).
- Explorer: pool charts (#46), who is mining now on the Miners page (#48), address pages load in under a second again (#45).
- Container image of the full node for amd64 and arm64, published with every release as `ghcr.io/lakylife/quinvium-node` (`ops/docker/Dockerfile`, workflow `docker`; guide in Running a public node).
- Explorer on a domain falls back to the node on the visitor's own computer (127.0.0.1, default port of the network, chain ID and genesis checked) when none of the network's nodes answers; it is never asked while they do. The node answers the browser's private network preflight.
- Explorer: the home page hides pool share transactions (a switch shows them), the Miners subtitle matches the whole-history numbers, an unknown address shows Page not found, and Swap and Bridge move under More, marked soon, on networks where they do not run.
- Node: coin supply as a plain number for coin trackers (`/api/supply/total`, `/circulating`, `/max`); mainnet checkpoint at block 20 000.
- Explorer: contract source verification without a server. The source is compiled in the browser by the official Solidity compiler (checked against its published SHA-256) and compared with the code on chain and with the creation transaction; a match is published on chain in the new ownerless Source registry contract (deployed by a user from the Explorer), and every visitor checks it again on the contract's Code tab.

## 2.16.0 (16 November 2026)

- English is the default language everywhere: node log, errors, RPC and Stratum messages, miner output, app log and package descriptions. Czech stays a translation (`QUINTIUM_LANG=cs`, or the app window in Czech).
- The network keeps working without our servers: home nodes open only the node port in the router by UPnP (`--upnp`, switch "Accept connections from other nodes"); the public server is also a seed by IP address; the Chrome wallet, the website and the Explorer switch to verified community nodes (chain ID and genesis checked) when the main RPC is down; `nodes.json` with community nodes is saved into the GitHub Pages sites.
- The app asks once, at the first mining start, whether to share the node publicly, and warns when mining earns nothing (the node does not answer, has no peers, sees no new block, or the card computes nothing).
- The node and the miner stop together with the app (`--exit-with-parent`), so a crash no longer leaves a node holding the ports.
- Explorer: a "Who serves the data" card on the Network page with the visitor's own node; documents `quinvium_publicNodes`, `quinvium_setPublicUrl`, `--tunnel-port`, `--upnp` and `--exit-with-parent`.
- Security fixes from the review of 16 November (#39): RPC limits for heavy calls, public node list, Explorer node choice, pool and Stratum flooding.
- P2P: a seed is no longer banned for a slow sync, second mainnet seed (#38, issue #37).

### Earlier, unreleased until now

- Miner: `--fallback <url,…>` keeps mining solo through your own node when the pool stops answering and returns to the pool when it answers again; the app passes its own node.
- Community nodes: the app's "Share node publicly" (off by default) opens a Cloudflare quick tunnel to a local-only tunnel port of the node (`--tunnel-port`; every request there is foreign, limited per `Cf-Connecting-IP`, no mining or control methods). The node announces the address to its peers signed by its node key (`PUBLIC_NODES`, short validity); every node checks an address itself before listing it in `quinvium_publicNodes`. The Explorer falls back to those nodes when its configured nodes do not answer. cloudflared is downloaded only from the official release, pinned by version and SHA-256. Draft Cloudflare Worker for one stable address in `ops/cloudflare/`.
- Explorer: .qu name registration can be finished later, step 2 is its own click, the first name becomes primary; primary names in lists, on the address page and in the wallet menu.
- Explorer and wallet: the currency can be shown as QU or as the Quinvium symbol (Profile settings in the Explorer, Settings in the wallet).
- Profile pictures as NFTs: Quinvium Avatars (on-chain SVG, mint for the network fee) and the Profiles contract; a picture shows only while the address owns the NFT. Both contracts are deployed from the Explorer's Profile card.

## 2.15.2 (15 November 2026)

- App and Chrome wallet in eight languages: English, Czech, German, Spanish, French, Japanese, Chinese and Arabic (right to left).
- New lock screen: a centred card with the mark, show/hide password, a Caps Lock hint and what keeps running in the background.
- Receive: the QR code carries the Quinvium mark in the middle (error correction H, it still scans).
- Send: an asset picker with icons, balances and search; the recipient can be read from a QR code with the camera (app) or from a photo.
- Notifications: found blocks, incoming payments, mining that stopped by itself and new versions, each can be switched off in Settings.
- Updates: the app checks GitHub for a new version, shows what is new and downloads the build; it opens it only when its SHA-256 matches the checksum lists on GitHub and quinvium.com. Installing stays with the user.
- Menu bar / tray and the Mining page show all blocks found by the payout address, not only this session.
- Whitepaper PDF with a cover, key facts, contents, running header and page numbers.
- Nodes watch each other: every two minutes at most, a node asks each peer for its block a few blocks below the head (the answer must carry valid work). A different block means the peer follows another branch; the node logs a warning and reports it in `quinvium_watch`. Deep reorganisations are recorded too. Peers are named by their key, never by IP address.
- Nodes check the public website and Explorer every 6 hours: each file at quinvium.com, explorer.quinvium.com and testnet.quinvium.com must match the protected main branch on GitHub or this node's release (`site-manifest.json`). A change made outside GitHub is logged as "the website differs from the release". `--no-site-check` turns it off.
- Explorer with several nodes compares their blocks and uses only nodes that agree with the majority; a node on another branch is named in a notice. The Network page shows the node's watch.
- Announcer: Telegram alerts for a changed website file, a peer on another branch and deep reorganisations, each once, and an all-clear.
- Explorer in Japanese, Chinese (Simplified) and Arabic (right-to-left); green dot on `/pools` for miners with a block in the last hour.

## 2.15.1 (14 November 2026)

- Miner: JSON-RPC over `https://`, so the app and the miner can mine into pools behind HTTPS such as the official pool `https://pool.quinvium.com`. Before, mining into a pool stopped with "address must start with http://".
- Pools guide (`docs/POOLS.md`), official pool details, clearer solo miners on the Explorer Pools page.

## 2.15.0 (14 November 2026)

- Desktop app runs in the background: closing the window keeps the node and mining running. A Q icon in the macOS menu bar or next to the Windows clock shows the network, block height and hashrate, starts or stops mining, opens the window, sets "Start at login" and quits the app.
- Mainnet is the default network. The choice of network is remembered; testnet can be selected under Node settings.
- The Explorer and the wallet inside the app follow the running node after switching networks (before, the Explorer kept asking the old port, for example "node at http://127.0.0.1:8546 is not responding").

## 2.14.2 (14 November 2026)

- Desktop app: the built-in wallet uses the app's own node again. In 2.14.1 it tried the public RPC, which the app's security policy blocks, and showed "Node https://rpc.quinvium.com is not reachable".
- Explorer `/pools`: the largest share and the majority warning are computed from the last hour, not from the selected period.
- Explorer: fork signalling card on the Network page (`quinvium_signals`).
- Public RPC no longer returns the IP addresses of connected peers to foreign callers.
- New logo: the letter Q as a hexagon in Quinvium yellow `#FFCD02`, drawn from the glyph in `assets/brand/Quinvium-Symbol.ttf`. App, wallet, Explorer and website icons are regenerated.
- Currency identity: name Quinvium, ticker QU, symbol in the `Quinvium Symbol` font (U+E000), shown on the website's Tokenomics page.

## 2.14.1 (14 November 2026)

- Mainnet can be selected in the desktop app (it was disabled in 2.14.0 and earlier).
- The Chrome wallet uses the public nodes `rpc.quinvium.com` and `rpc1.quinvium.com` when there is no local node.
- New blocks are tagged `Quinvium` instead of `aether`.

## 2.14.0 (13 November 2026)

- **Mainnet launch** on 14 November 2026 00:00 CET, genesis `0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39`, initial difficulty 2^27.
- Remote app updates are switched off on mainnet until the update-signing key is kept off the development machine.
- Testnet restarted from zero as testnet-5 (genesis `0x4845f69c…d121`) with the Quinvium name in on-chain texts; contracts at the same addresses.
- Public seed `seed.quinvium.com` with a pinned node key for mainnet and testnet.

## 2.13.x (13 November 2026)

- Renamed from Quintium to Quinvium. The `quintium` command, `quintium_*` RPC and `window.quintium` keep working next to `quinvium`, `quinvium_*` and `window.quinvium`.
- Public testnet node and Explorer on quinvium.com; the Explorer chooses its RPC by hostname.
- `AETHER_NO_SEEDS=1` keeps test nodes away from the real network.

## 2.12.x (12–13 November 2026)

- Access from the internet: UPnP, public address detection, double NAT and CGNAT detection.
- Fixes from the internal review of 13 November 2026: caller-aware RPC for public nodes, rate limits, `--trust-proxy`.
- AirSwap SwapERC20 v4.3 P2P settlement contract on testnet.

## 2.11.x (4–10 November 2026)

- Fixes from the internal reviews of 7, 8 and 10 November 2026 (see [docs/REVIEW.md](docs/REVIEW.md)): deep-reorg rule with twice the work, side-branch sync, signed update platform, Ed25519 node identity with pinned seeds, hash announcements, `--no-mining-rpc`, `/health`.
- Command line `quintium`/`quinvium` in English and Czech.
