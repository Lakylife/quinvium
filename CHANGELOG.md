# Changelog

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
