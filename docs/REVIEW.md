# Internal security review, November 2026

This is an internal review carried out by the authors of the code. **It is not an independent audit** and does not replace one. An independent audit of the contracts is necessary before the bridge or pools hold real value.

## Scope

New code since version 2.0: pools (`AetherPool`, `PoolFactory`, the built-in function `0x…0100`, the pool server), the bridge (`BridgeGateway`, `WrappedAsset`, validators, Bitcoin), Swap (`SwapPair`, `SwapFactory`, `SwapRouter`), stablecoins (`StableToken`, `TokenRegistry`), new RPC methods, remote updates, wallet sign-in and the app lock. Consensus and networking have their own adversarial tests from earlier, see [SECURITY-MODEL.md](SECURITY-MODEL.md).

## Methods

| Method | Scope | Result |
| --- | --- | --- |
| Random action sequences against invariants | Pool: 3 runs of 300 steps. Bridge: 3 runs of 300 steps. Swap: a run of 120 steps | No violations |
| Cheating attempts | Fake shares, a foreign recipient, a dishonest proposer, forged signatures, repeated delivery | All rejected |
| Cross-check with independent code | Bitcoin addresses, transactions and signatures against bitcoinjs-lib and tiny-secp256k1 | Match |
| Load | RPC, Stratum, full blocks, 5 million transactions, see [CAPACITY.md](CAPACITY.md) | Problems found were fixed |
| Dependencies | `npm audit --omit=dev` | 0 known vulnerabilities in code that runs on users' machines |
| Rust static analysis | `cargo clippy` | Style only, no security issue |
| Code reading | All new contracts and services | See findings |

Invariants checked after every step of a random run:

- Pool: the contract balance covers all obligations. Coins received equal the balance plus payouts; none disappear or appear. The operator never gets more than the fee. A miner's payout never decreases. Miners together never get more than the pool received.
- Swap: reserves equal balances after every step, the product of reserves never decreases on a swap, and the value of a share never decreases when liquidity changes.
- Bridge: the gateway balance equals the locked amount exactly. Exactly as much is locked as is issued plus in flight. Repeated delivery, a changed amount or a single signature never succeed.

The runs showed the exact fee: 2.5 % of 776 is 19.4, and the rest goes to miners with no loss apart from rounding dust.

## Findings fixed

| # | Severity | Problem | Fix |
| --- | --- | --- | --- |
| 1 | High | A bridge transfer to an EVM chain with a recipient of a length other than 20 bytes would lock the coins permanently | The gateway rejects such a transfer |
| 2 | High | Anyone can imitate the withdrawal marker on the Bitcoin network and a withdrawal would look paid | The transaction spending the custody decides, not the marker |
| 3 | High | The update script did not start on Windows and the app stayed off after closing | New versions start from a folder without an external script, with rollback on failure |
| 4 | Medium | Explorer filters ran on the main thread; a repeated heavy query would delay blocks | Queries run in worker threads with a bounded queue |
| 5 | Medium | Cheap registration of a deposit address triggered a slow Bitcoin scan | Scanning happens in batches, one per pass |
| 6 | Medium | `aether_poolPayouts` summed up to 2000 payouts on every query | The sum is computed only on a new payout |
| 7 | Medium | Mining did not prevent the computer from sleeping; the miner silently stopped | The app blocks system sleep while mining |
| 8 | Low | Stratum connections walked the list of all sessions, needlessly slow with thousands of devices | A counter per address |
| 9 | Low | The validator requested logs over a wider range than the node allows | Reading in parts |
| 10 | Low | During a transfer from another network the wallet returned before confirmation | Return only after confirmation |
| 11 | High | The Network and nodes, Rich list and Pending transactions pages were lost during an Explorer rewrite and tests did not catch it | Pages restored; `explorer/test/pages.mjs` walks every page in 5 languages |
| 12 | Medium | The network hashrate estimate never dropped to zero after mining stopped and showed hashrate that did not exist | After 180 s without a block the estimate is zero and the overview says so |
| 13 | Medium | The app and charts showed the last known hashrate even for a stopped miner | The number next to the chart is current; history stays in the chart |
| 14 | Medium | `aether_tokenInfo` would silently count balances as zero with a full queue | The queue error is returned; only a rejected call counts as zero |
| 15 | Low | A foreign node could feed the command line a fake router through `deployments.json` | Addresses from the release take precedence over data from the node |
| 16 | Low | The chart showed a false drop in hashrate at the end and the first block after genesis distorted it | Hashrate is computed over the time actually covered; the first block is not counted |

## Review of 7 and 8 November 2026

A second reading of the whole codebase, again by the authors, not an independent audit.

| # | Severity | Problem | Fix |
| --- | --- | --- | --- |
| 17 | High | A rewrite deeper than 256 blocks was always rejected. A split network did not rejoin by itself, and a new node fed a cheap branch by an attacker stayed on it forever | A deep rewrite succeeds with twice the work since the split. The node first verifies the work of all headers of the branch; an honest node from the other side is not blocked |
| 18 | High | Syncing a side branch got stuck after the first batch of 256 headers | The locator continues from the last downloaded header |
| 19 | High | The bridge waited only 12 confirmations on Quinvium; a small network can be rewritten for a few minutes with rented hashrate | A validator does not start with fewer than 240 confirmations on Quinvium mainnet and 64 on Ethereum |
| 20 | High | The update signature did not cover the platform, the download had no cap and extraction on Windows did not check `\` | A `platform` field in the signed manifest, abort above the signed size, stricter path checks |
| 21 | Medium | Node identity was not verified; an attacker in the middle could relay connections | A persistent Ed25519 key, a signed connection fingerprint, seeds with pinned keys |
| 22 | Medium | Transactions and blocks were sent in full to all peers | In full only to the square root of peers, the hash to the rest |
| 23 | Medium | A library error during block validation was classified by its message text | An own check of the reason. EthereumJS still decides whether the block is accepted |
| 24 | Medium | On a public node the network hashrate could be faked through `eth_submitHashrate` | The `--no-mining-rpc` option |
| 25 | Medium | `/health` trusted the height of a single peer | The second-highest height |
| 26 | Medium | Pools could crowd out payments when blocks were full | Fewer shares per block depending on how full blocks are |
| 27 | Low | The cache of a new Ethash epoch was computed only with its first block | It is computed 1 000 blocks in advance |
| 28 | Low | `backfillIndex` read a block before checking that it exists | Fixed |
| 29 | Low | CI actions were not pinned and CI ran only on Windows | Pinned to a commit hash; a Linux job was added |

Verified and unchanged: `npm audit` reports for WalletConnect concern libraries that are not in `walletconnect.js`. Totals in the Explorer index are floating-point numbers on purpose; exact amounts are read from blocks.

## Review of 10 November 2026

Reading of the node, contracts, bridge validator and wallet with the help of Claude. Not an independent third-party audit.

| # | Severity | Problem | Fix |
| --- | --- | --- | --- |
| 30 | Critical | During deep-branch sync the height of the first batch of headers was not checked. One header with difficulty 1 and height 10^30 triggered the Ethash cache computation for its epoch and blocked the node permanently | Heights must follow from the common ancestor; `Pow.verify` rejects a header more than 100 000 blocks above the tip |
| 31 | High | A deep branch with invented difficulty 1 could be produced for free and every node spent minutes verifying it. The pause after rejection applied only to the connection | Difficulty per LWMA and timestamps are checked before computing Ethash; the pause applies to the address |
| 32 | Medium | A new bridge gateway on the same chain would issue the same message numbers as the old one and their IDs would collide in the target gateway | The upper half of the message number is derived from the gateway address; the address is also part of the send ID |
| 33 | Medium | On a site's request the wallet also signed for an account from the vault other than the selected one | `personal_sign` and `eth_signTypedData_v4` sign only for the selected account |
| 34 | Low | Bridge validators signed a bare hash | Signature with the EIP-191 prefix; the gateway rejects a bare signature |
| 35 | Low | Replacing a transaction that did not fit into a full queue also removed the original transaction | The original is removed only when space is certain |
| 36 | Low | `personal_sign` with the order (address, message) signed the address as the message | The order is detected from the address |
| 37 | Low | The check for non-public addresses did not cover CGNAT, `0.0.0.0/8` and reserved ranges | `net.BlockList` with all non-public ranges |

Fixes 32 and 34 change the `BridgeGateway` contract and the validator signature. The gateway has to be deployed again on both sides and the validators run in the new version; old and new versions do not understand each other.

## Review of 13 November 2026

A node started with `--public` now distinguishes the caller: mining RPC methods are available only to the local computer and the local network, foreign callers have a limit of 1200 requests per minute, and `aether_endpoints` shows them only the public address. A request with a proxy header is treated as foreign unless `--trust-proxy` is set, so nodes behind a tunnel or proxy must run with `--trust-proxy`. Stratum without a pool accepts only local miners in public mode. The public address reported by the router is compared with an external lookup, and router responses are read with a size limit.

## Remaining risks

- **The bridge is only as secure as its validators are independent.** A majority can make the contract issue tokens. Limits, delays and a guardian reduce the damage but do not rule it out. No single party should hold more than one key.
- **Bitcoin without a contract.** Custody is a multisig address. A validator must keep its key safe, ideally in a hardware module.
- **The Bitcoin side has not been tested against a real Bitcoin Core node.** Transactions were verified by an independent library and a node simulation, not the network. A regtest and testnet run is required before use.
- **A Bitcoin reorganisation deeper than the number of confirmations** would mean an unbacked token. The default of 6 confirmations is a compromise; large deposits wait in a queue.
- **The administrator of the bridge and the token list should be a multisig contract**, not a single key. The testnet uses a single key.
- **Swap is based on the proven Uniswap V2 design, but it is a new implementation.** It has not been independently audited. The price in a small pool is easy to move, so the page warns about price impact.
- **The app lock protects against a person at the computer, not against malware.** The password is checked by the app window; whoever controls the user account can bypass it. The wallet vault stays encrypted.
- **The MetaMask connection runs through a local page on 127.0.0.1.** It is protected by a random token, Host and Origin header checks and a signature proving ownership of the address. Whoever controls the user account can plant a request, but the user still has to confirm it in MetaMask.
- **The bridge has no fee.** Validators pay gas themselves; spam with small transfers is limited only by `minAmount`.
- **Relying on a public node.** A validator must run its own nodes of both chains. A foreign node could lie to it.
- **The built-in function `0x…0100` is consensus.** A bug in it would mean a fork, so it has its own tests including forged headers.
- **`NvAPI` for card performance is a non-public interface.** It runs in a separate process and its failure does not endanger mining.
- **Slither and other Solidity static analysers have not been run.** Installing them belongs to an audit, together with `cargo audit`.
- **Development tool dependencies** have `npm audit` reports (electron-builder, WalletConnect libraries). They do not end up in the user package; `ws`, `zod` and AppKit are not in it.
- **A pool share does not have to be a valid block.** `AetherPool` verifies the work, the reward recipient, the age and the parent, not the rest of the header. A miner can send shares that would not be a valid block even when hitting the network difficulty: it gets paid but never brings the pool a reward, and this cannot be detected from a single share. Block withholding is a general weakness of pools and there is no complete fix. A partial fix (the built-in function also returns the difficulty and the contract compares it with the network) is a consensus change and waits for a future fork. Until then the operator should watch the ratio of shares to found blocks per miner.
- **The miner receives the base fee.** A miner can therefore fill its own blocks with its own transactions for free and raise the base fee for others. This is a deliberate design choice; the 1/8 per block change limit caps the damage.
- **The name Quinvium and the ticker QU** have not had a legal trademark review.
