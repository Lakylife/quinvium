# Mainnet launch

| Item | Value |
| --- | --- |
| Launch | 14 November 2026 00:00 CET (13 November 23:00 UTC), `genesisTimestamp: 1794610800n` |
| First block | 14 November 2026 00:00:23 CET |
| Genesis hash | `0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39` |
| Chain ID | 52401, coin QU |
| Initial difficulty | 2^27 (about 9 MH/s for a 15 s block), minimum 2^24, LWMA over 60 blocks |
| Reward | 4 QU per block, halving every 8M blocks, cap 64M QU, no premine |
| Genesis state | system contracts without owners and without balances; `predeploys.json` identical to testnet |
| Seed | `2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d@seed.quinvium.com:30524` |
| Public RPC | `https://rpc.quinvium.com`, WebSocket `wss://rpc.quinvium.com` |
| Explorer | `https://explorer.quinvium.com` |
| Software | 2.14.0 at launch, 2.14.1 first release after launch |

Machine-readable parameters are in [`networks/mainnet.json`](../networks/mainnet.json).

Launch decisions:

- No remote app updates on mainnet until the update-signing key is kept off the development machine; new versions are installed by hand.
- No token registry on mainnet until it can be owned by a multisig.
- Initial difficulty 2^27 so that a few graphics cards can produce blocks from the start.
- The genesis text still carries the earlier project name: `Quintium: vlastni sit pro kazdy ` (32 bytes, Czech for "own network for every field"). It is part of the genesis hash and stays as a historical trace.

## Open items

- **Update-signing key** off the development machine (hardware device or offline computer); only its public part goes into the app. Then remote updates can be switched on.
- **Multisig** for the token registry owner, with keys on hardware wallets.
- **Independent audit** and a bug bounty.
- **Legal review (MiCA)** and a trademark check of the name Quinvium and the ticker QU.
- **Code signing** for Windows and macOS, and the Chrome Web Store.
- **More independent public nodes** (other providers and operators) as seeds and RPC endpoints. At launch the network was carried by one public server and the first miner's node.
- **Bridge** on mainnet only with independent validators.
- **Checkpoints** (`checkpoints`) added with later releases.
