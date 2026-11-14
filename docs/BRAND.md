# Brand

## Name

**Quinvium**, ticker **QU**. On testnet tQU, on the development network dQU.

The name comes from the Latin *quinta essentia*, the fifth essence. That is aether, the fifth element next to earth, water, air and fire. Ethereum is derived from it, and this project was originally named after it. The -ium ending is the same as for metals, so the name suits a currency that is mined.

Earlier names were Aether (AET), Sidereum (SIDR) and Quintium. Quintium became Quinvium on 13 November 2026 because the domain quintium.com was taken. A check on that day found quinvium.com, .net, .org, .io, .cz, .eu and .xyz free (whois); no project or cryptocurrency of the same name was found. Similar-sounding names exist (the Quantinium blockchain, the Qinv platform). Trademarks have not been reviewed by a lawyer.

## Why two letters

A one-letter ticker is not possible: all 26 letters are used by some token, and MetaMask's documentation says the native currency symbol of a network must have 2 to 6 characters. Two letters are the shortest possible length.

## Uniqueness check

The check ran on 2 November 2026 for the earlier name Quintium. Neither the name nor the ticker appeared in any of these sources:

| Source | Scope |
| --- | --- |
| CoinMarketCap | 37,422 coins and tokens |
| CoinGecko | 22,684 coins and tokens |
| CoinPaprika | 62,457 entries including discontinued ones |
| ChainList | 2,853 networks and their native coins |
| DexScreener and GeckoTerminal | name and ticker search on decentralised exchanges |
| Web search | no coin, token or blockchain of this name |

What the check cannot guarantee: new tokens appear every day and anyone can pick any ticker, so a token is always verified by its address.

## Logo

The mark is the letter Q made from a pentagon: five sides for the fifth essence. The tail runs along the axis of the fifth vertex and enters the shape so that it does not look like a magnifying glass. The mark holds up at 16 pixels and uses no gradients or shadows.

| Colour | Value | Use |
| --- | --- | --- |
| Star gold | `#F2B544` | the mark, the coin |
| Night blue | `#0B1622` | icon background, the mark on light backgrounds |

Files are in `assets/brand`. All icons are generated from one shape by `node scripts/make-brand.mjs`.

## Look

The Explorer, the app and the wallet share the same rules:

- Sections are white surfaces on a light grey page. Boundaries come from the surface tone, not frames. Each surface has a small gap from its neighbour, so it is clear what belongs together.
- List rows are separated only by a thin line so a row can be followed across the full width. Grids, frames and lines around blocks are not used.
- Fields have a grey fill in a white section and white directly on the page. A button is one tone darker than a field.
- The selected menu item and tab have a subtle surface so you can see where you are.
- Each page has one main thing. What is not needed right away is one click away: filters behind a button, forms in Apps after expanding, network status, language and theme in the footer.
- Empty things are not shown: a chart without data or an empty list takes no space.
- Overviews have four numbers; a list row is one line. A table holds what the row is looked up by; the rest is on the detail page.
- Only the main link in a row is blue; other links get colour on hover.
- No gradients and no glow. Blue is the accent; gold appears only in the logo.

The rules are checked by `packages/explorer/test/design.test.mjs` and `packages/explorer/test/pages.mjs`. The website (`packages/website`) has its own light look that differs from the Explorer.

## What keeps the older names

These remain on purpose; users normally do not see them:

| What | Why |
| --- | --- |
| Data folders `Aether` and `~/.aether` | They hold the wallet and the chain; moving them could lose data |
| `Aether.exe` launcher | Older apps update through it and new versions do not change it |
| Internal contract name `WAET` | Code only. Users see Wrapped QU (WQU) |
| `aether_*` in JSON-RPC, `window.aether`, `AETHER_*` | Programming interfaces; changing them would break older versions |
| Protocol `aether-p2p-v1`, `AetherBridge.v1` | Nodes and validators would stop understanding each other |
| Genesis text "Quintium: …" on mainnet | Part of the genesis hash |
| The `quintium` command, `quintium_*` RPC, `window.quintium` | Keep working next to the new `quinvium`, `quinvium_*` and `window.quinvium` |
| Files `quintium-miner`, `quintium-node`, `quintium.cmd`, package `@quintium/cli` | File and package names referenced by older versions and guides |
| Variables `QUINTIUM_LANG`, `QUINTIUM_KEY` | Users have them in their shell configuration |
| Node label `quintium-node/…` in P2P and `/health` | Nodes only display it; it can change later |
| Update package `quintium-<version>.zip` | The name older apps look for |
| Node identity `quintium-hello-v1` | Part of the identity signature |
