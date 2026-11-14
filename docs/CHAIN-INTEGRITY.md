# Chain integrity and operational readiness

This document answers whether anyone can hack Quinvium, take it over or modify data to gain coins, and lists what has to be done for the network to be considered mature.

In short: **modifying data to gain coins is not possible.** The chain does not allow it by design, and tests verify it. No blockchain is indestructible though. What remains is a 51 % attack and bugs that no independent party has looked for yet. Both are described below.

## Why balances cannot be changed

Balances are not stored in one place that could be overwritten. Every node keeps its own copy and recomputes every block itself.

1. Every block header contains the hash of the whole network state, i.e. all balances and all contracts. Changing a single balance changes this hash.
2. Every node executes every block it receives and compares the result with the header. It does not trust what anyone sent it.
3. A header contains the hash of the previous block. Changing an old block would break all following blocks and each would have to be mined again.
4. Coins are created only as a block reward. There is no other path in the code or the rules. A transfer is signed by a private key only the owner has.

Whoever modifies their own database only fools themselves. Other nodes reject their blocks and stay on the correct chain.

## What exactly is verified

Every row has an automated test that actually performs the attempt. The tests are in `packages/node/test/integrity.test.js` and `attacks.test.js`.

| Attempt | What stops it |
| --- | --- |
| A miner credits itself 1000 extra QU and honestly mines a block on it | The state hash does not match; the network rejects the block |
| Changing the amount in someone else's transaction | The signature then points to a different sender who does not have the coins |
| The same transaction a second time | Nonce; the block is invalid |
| A transaction from another network | The chain ID is part of the signature |
| Overwriting a balance directly in the database | The state node does not match its hash; `quinvium audit` finds it |
| Changing a transaction or header in the database | The hash does not match; `quinvium audit` identifies the exact block |
| A planted block in the chain | The block does not follow the previous one |
| A fake balance in the Explorer index | `quinvium audit` compares the index with the state |
| A chain from scratch with more work | A rewrite deeper than 256 blocks succeeds only with twice the work since the split |
| A rewrite below a checkpoint | The block at that height must be exactly the one from the release |
| Invented block times to lower difficulty | A miner with 49 % of hashrate changes the block pace by no more than a quarter |
| Exceeding the 64 million cap | Issuance is given by a formula and the sum of all coins is checked |
| A hard kill of the node | After a restart the chain passes the full check again |

## Checking the whole chain

The `quinvium audit` command trusts nothing the node computed earlier. It takes the blocks from the database and executes them again from genesis in an empty folder: it verifies work, signatures, state and receipts. Then it sums the balances of all accounts directly from the state and compares them with issuance.

```
quinvium audit --network mainnet
```

It only reads the database; the node and mining can keep running. A check on the real testnet on 1 November 2026 passed: 191 blocks, 60 transactions, 1715 state nodes, exactly 764 tQU in the chain and exactly 764 tQU allowed by issuance.

A network test on 1 November 2026 ran for 15 minutes on four nodes: one node was hard-killed and a new one joined during the run. All 1231 transactions sent were confirmed, the nodes agreed on the same block and state, and the hard-killed node passed the full check afterwards: 160 blocks and exactly 640 coins from issuance. It ran on the development network with CPU mining, not on a real card.

Operating recommendation: run the check regularly on every server, after every crash and before every release. The quick variant `--quick` verifies only the hashes of state nodes and the database file.

## What the code cannot solve by itself

### 51 % attack

Whoever has more hashrate than everyone else combined can rewrite the **latest** blocks and spend their coins twice. They cannot create coins, steal someone else's or change the rules, and the rewrite is limited to 256 blocks, about an hour. A deeper rewrite would need twice the hashrate of the whole network. Nodes reject a block with a wrong state even if it comes with 99 % of the hashrate.

Quinvium is more vulnerable to this than large networks because it mines plain Ethash. The same cards and ASIC machines also mine EthereumPoW and Ethereum Classic (Etchash), whose hashrate is many times larger and can be rented. A small fraction of it is enough. While the network is small, rewriting the latest blocks is cheap. Defences:

- **Exchanges and merchants wait for confirmations.** Small amounts 30 blocks, large amounts 256 blocks.
- **The bridge waits deeper than a normal payment.** Validators accept messages only after the configured number of confirmations, at least 240 on mainnet.
- **Checkpoints in releases.** The `checkpoints` parameter in `params.js` fixes a block, and history below it cannot be rewritten even with any amount of work.
- **Monitoring.** A deep rewrite is written to the node log and `quinvium status` shows the number of rewrites and the deepest one.

The MESS rule, which makes late rewrites more expensive and was used by Ethereum Classic for a time, is not implemented. A small network can split for half an hour even without an attack, and after such a split the parts would no longer rejoin by themselves. The outage would then be worse than the attack it is meant to prevent. It can be revisited once the network grows.

### Private keys and administrators

The chain cannot protect a key that someone steals:

- The key for app updates should be off any everyday computer, ideally in a hardware module. Whoever obtains it can send their own program to all users. Until that is the case, remote updates are switched off on mainnet.
- The administrator of the bridge and the token list should be a multisig contract, not a single key.
- Bridge validators should be independent people on separate machines, each with their own nodes of both chains.

### Independent audit

Everything above is verified by our own tests and review. Those find what someone thinks of looking for. An independent audit of consensus, the network and the contracts is necessary for a network with real value and cannot be replaced by anything.

## Readiness status

| Item | Status (14 November 2026) |
| --- | --- |
| Independent audit of consensus, network and contracts | Not started |
| Seed nodes in `params.js` | One public server; more independent ones needed |
| Fixed `genesisTimestamp` and `genesisDifficulty` for mainnet | Done: 14 November 2026 00:00 CET, 2^27 |
| Code signing for Windows and macOS | Missing certificates |
| Update key in a hardware module, multisig administrator | Pending; remote updates off on mainnet |
| Independent bridge validators | Pending; the bridge stays off |
| Bridge test against a real Bitcoin Core in regtest and testnet | Pending |
| Slither and `cargo audit` | Not run |
| Reproducible builds and published signed `SHA256SUMS` | `SHA256SUMS` published, signature missing |
| State pruning or fast sync (the node is an archive node and grows about 8.5 kB per transaction) | Not started; needed with more traffic |
| Legal review, trademark and the QU ticker | Pending |

## When something happens

| Event | Procedure |
| --- | --- |
| The log reports a rewrite of 6 or more blocks | Exchanges and the bridge raise their confirmation counts; find the source of the hashrate |
| The log reports a branch beyond the finality boundary | An attempt to rewrite history, or a split network with similar work on both sides. Compare `quinvium status` between servers. With twice the work the node switches to the branch by itself and logs a WARNING |
| `quinvium audit` finds a problem | Disconnect the node, do not use the database, download the chain again from others and find out who had access to the disk |
| A consensus bug | A fork per [RUNNING-A-PUBLIC-NODE.md](RUNNING-A-PUBLIC-NODE.md#network-upgrades), testnet first |
| Leak of the update key | Immediately release a new version with a new public key; users replace the old one by hand |

## Releasing the app

```bash
bash scripts/release.sh                                   # Windows packages
node scripts/publish-update.mjs <version> "what's new"    # signed remote update (testnet)
bash scripts/install-mac.sh                               # Quinvium.app into /Applications
```

A remote update is signed with the publisher's update key, which never leaves the publisher's computer. The app looks for `manifest.json` on Windows and `manifest-mac.json` on macOS at the `updateUrl` from its settings. The package is unpacked into `versions/<version>` in the app's data folder.

## What decides success

Competing with Bitcoin or Ethereum is not only about software. What decides is the number of independent miners, liquidity, developers writing applications and trust in long-term operation. That takes years to build and no code guarantees it. A realistic first goal is a working public network with real users and one concrete application in one field where the chain brings clear value, for example document verification.
