# Security model and status

## Status

The code has passed automated tests, attacks against its own code and the official Ethereum EVM test suite, **but not an independent security audit**. An audit is necessary for a network with real value, especially for consensus, the network layer, the contracts and the wallet. The rules are described in [SPECIFICATION.md](SPECIFICATION.md).

The review of newer code is in [REVIEW.md](REVIEW.md) and load measurements are in [CAPACITY.md](CAPACITY.md). How to report a vulnerability is described in [SECURITY.md](../SECURITY.md).

## What the tests cover

| Area | Verified |
| --- | --- |
| EVM | Official `ethereum/tests` GeneralStateTests run through the real node code, `packages/node/test/statetests.mjs` |
| Ethash | Byte-for-byte match with eight real Ethereum blocks in epochs 1 to 517, in JavaScript and in Rust. A real graphics card crossed an epoch boundary. |
| Cryptography | WebAssembly cross-test against the reference implementation, including malicious inputs |
| Block validation | State, receipts, transactions, fees, gas, difficulty, time, PoW, size, a change to every header field |
| Forks | Heaviest-branch selection, random branches in random order, state rollback, restart after a reorganisation, the finality boundary |
| Upgrades | Rules change exactly at the fork height; old software disconnects cleanly |
| Mempool | Signature, nonce, a sender's total commitments, fee, replacement, memory cap, the queue surviving a restart, a full queue without nonce gaps, handing the queue to a new node |
| Network | Batched sync, network split and rejoin, garbage in every message type, traffic limits |
| Crashes | Repeated hard kills in the middle of work, database integrity checks |
| Data integrity | Forged reward, altered transaction, header and balance in the database, a planted block and a fake index, see `integrity.test.js` and `quinvium audit` |
| Checkpoints | A foreign branch with more work, a new node on a foreign chain, an old database |
| Difficulty | Simulation of the real LWMA against miners with 30 and 49 % of hashrate and invented timestamps |
| Command line | Real processes against real nodes: wallet, transfers, swap, liquidity, pools and the bridge including delivery by validators |
| RPC | ethers.js and Solidity, malformed requests, infinite loops in `eth_call` |
| Contracts | Normal scenarios, unauthorised access, front-running, re-entrancy, a vanished arbiter |
| Pools | Real Ethash and a real graphics card: shares, blocks for the contract, automatic payout, ETHPROXY and EthereumStratum, forged shares, re-entrancy, an operator who leaves |
| Explorer | Every app clicked through in real Chromium against a real node |
| Wallet | Real Chromium: encryption, approval, rejection, locking, site isolation |
| Wallet connection | The guide in the Explorer: MetaMask behaviour including a stuck request, adding the network, a node going down and coming back |
| Desktop app | Real Electron: GPU mining, the app's node connecting to a regular node, the wallet in the Explorer window |

## Vulnerabilities found and fixed

An adversarial review before release found these bugs. Each has a test in `packages/node/test/attacks.test.js` that must never fail again.

| Severity | Bug | Fix |
| --- | --- | --- |
| Critical | A forged body of someone else's block cut a node off from the network permanently | Invalidity is recorded only after execution fails |
| Critical | Cheap transactions full of zeros produced a block above the size limit; mining would lose its work and the network would stop | The block template checks size |
| Critical | The worst block took 40 s to validate against a 15 s block time | State cache, native Keccak, WebAssembly, MODEXP and BLAKE2F pricing, a 10 M gas limit |
| Critical | The HTTP path `/%ff` or a `null` WebSocket message crashed the node | Input checks; a request error does not end the process |
| High | A false claim of work stopped mining and block propagation | Verified downloading, switching peers, penalties for not delivering |
| High | Flooding with addresses allowed eclipsing a node | Separate verified addresses, random selection by range |
| High | An infinite loop in `eth_call` blocked the node | Separate worker threads with a 5 s limit |
| High | PREVRANDAO always returned zero | Correct field, caught by an official test |
| High | A peer that did not read responses filled the victim's memory | Queue cap, disconnect |
| High | A disk failure could mark a valid block as invalid | EVM rejection is separated from node errors |
| Medium | The RPC limit behind a proxy shared one account for everyone, batches counted as one request | `--trust-proxy`, counting per item |
| Medium | The transaction queue had no memory cap and no check of total commitments | 64 MiB cap, total per sender |

Contracts: a hash in the Notary and a certificate number could be front-run and blocked, a name could be stolen from pending transactions, a vanished arbiter locked an escrow forever, and a multisig could not replace an owner. All are fixed. Names use two-step registration.

Two bugs are in the EthereumJS 10.1.3 library and the node works around them in `core/executor.js`: `createEVM` ignores the `bn254` option and `putStorage` writes to the trie even with the cache enabled. This must be checked again before updating the library.

## Risks the code cannot remove by itself

### 51 % attack

Proof-of-work security depends on the network's hashrate. A small network can be overpowered with rented hashrate, because Ethash runs on many machines around the world. An attacker with the majority of hashrate can briefly rewrite the latest blocks and spend coins twice.

Quinvium therefore rejects reorganisations deeper than 256 blocks, about an hour. This prevents a deep rewrite of history but does not prevent rewriting the last few blocks. Exchanges and merchants should wait for **at least 256 confirmations** for larger amounts. A deeper rewrite succeeds only with twice the work of the whole network since the split. An attacker would need twice the hashrate of everyone else combined. Thanks to this, a split network converges after reconnecting, and a new node that was fed a cheap fake branch on its first sync switches to the real chain.

### ASICs

Specialised machines more powerful than graphics cards exist for Ethash. While the network is small they have no reason to mine it. If Quinvium gains value, they will come and push out home miners. The defence would be a hard fork to a modified algorithm. Common miners would stop working until they adopted the change, leaving only the Quinvium miner.

### Pools

The `AetherPool` contract holds rewards and splits them by work verified by the network. The tests try real Ethash and attempts at cheating: overwriting the miner address, inflating a share, double counting including through differently encoded RLP, a foreign pool, a foreign chain, an old share, re-entrancy during payout and a miner who refuses payment.

What the operator cannot do: take miners' coins, change the fee or the rules, redirect a share to another address.

What the operator can do and the contract does not prevent:

- Not accept or not submit shares. The miner loses them until moving elsewhere, and can see in the Explorer how much work the contract actually credited. The miner can submit a share directly, but the Quinvium miner cannot do that yet.
- Give an ASIC work with someone else's address. The Quinvium miner detects this; a Stratum client does not. Such a machine has to watch its credited work in the Explorer.
- Shut down the server. The coins stay in the contract and anyone can trigger the withdrawal.

What a miner can do: withhold found blocks and submit only shares. This hurts the pool and earns the miner less, as with any other pool. A share with an invented header has no greater effect than withholding a block.

Each share costs about 150 000 gas and around 60 fit in a block. The server therefore raises the share difficulty for a large pool, and a small miner in a large pool gets shares credited less often, not paid less.

### Fees go to miners

The base fee is not burned. This raises miners' income, but a miner can fill its own block with its own transactions practically for free, because the fee comes back to it. That way it can make the following blocks more expensive for others. It gives up the tips of other transactions and the higher fee also goes to other miners, so this does not normally pay off, but it should be watched.

### Young code

The chain uses the EthereumJS libraries for the EVM and noble for cryptography. The network rules, the network layer and the contracts are new code without an operating history.

### Node performance

The node runs in JavaScript. The limit of 10 million gas per block corresponds to about 31 transfers per second and is based on measurement: the worst known block validates in about 6 s on an Intel Core i5 desktop, a 2.5× margin against the block time. A stronger computer has it easier, a weak single-threaded server harder. Miners can vote the limit up to at most 15 million; higher requires a fork. Heavy traffic will need a native implementation.

### Data size

The node is an archive node and does not delete the state of old blocks. With heavy traffic the data will grow quickly; state pruning is not finished yet.

## Operating guidelines

- Never expose JSON-RPC directly to the internet. Use a reverse proxy with HTTPS and `--rate-limit`.
- The node holds no keys; a stolen server does not endanger coins.
- A recovery phrase belongs on paper only. No administrator may know it.
- PREVRANDAO is only a weak source of randomness and miners can influence it. Do not use it for lotteries.
- A miner can shift the block time by up to 60 seconds; contracts must not rely on it more precisely.

## Known limitations

- Connections between nodes are encrypted and, since 8 November 2026, authenticated: the node signs the connection fingerprint with a persistent key, so an attacker in the middle cannot relay. A new node recognises a seed with a pinned key even with forged DNS. The testnet still accepts older versions without an identity; mainnet does not.
- A standalone node with old software only disconnects after a fork. On testnet the app updates itself; a command-line node does not. On mainnet remote updates are currently switched off.
- There are no uncle blocks, so the miner of an orphaned block gets nothing.
- The wrapped coin at `0xae…0a` is called Wrapped QU (WQU). The internal contract name `WAET` remains only in the code.
- A pool cannot detect block withholding. See Pools.
- EIP-4844 blob transactions are intentionally not supported. Opcodes `0x49`, `0x4a` and address `0x0a` are therefore missing compared with Cancun. There are no other differences from Cancun in the EVM except the pricing of BLAKE2F and MODEXP.
- The `solc` dependency used only in development has a reported vulnerability in the `tmp` tool. It does not end up in released programs.
- Voting is public. It is not suitable for secret ballots.
- The issuer name in Credentials is chosen by each issuer. Only an address from an official source can be trusted.
- The network switch in the Explorer assumes the default ports.
- The real MetaMask is not tested automatically. The test imitates its error codes; adding the network should be verified by hand from time to time.
