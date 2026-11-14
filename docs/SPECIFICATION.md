# Quinvium consensus specification

This document describes the rules a node uses to decide what a valid block is. It is the basis for audits and for a possible second implementation. Where this document and the code in `packages/node/src` disagree, that is a bug to be fixed. Parameters live in `packages/node/src/params.js`.

All numbers are unbounded integers. `//` is integer division. RLP and Keccak-256 are the same as in Ethereum.

## 1. Networks

| Network | Chain ID | P2P | RPC | Stratum | Initial difficulty | Minimum difficulty |
| --- | --- | --- | --- | --- | --- | --- |
| mainnet | 52401 | 30524 | 8545 | 3333 | 2^27 | 2^24 |
| testnet | 52402 | 30525 | 8546 | 3334 | 2^22 | 2^16 |
| dev | 52403 | 30526 | 8547 | 3335 | 1 | 1 |

Mainnet genesis: 14 November 2026 00:00 CET (`genesisTimestamp` 1794610800), hash `0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39`. A public overview is in [WHITEPAPER.md](WHITEPAPER.md).

## 2. Block format

The header is an RLP list of exactly 15 items. Numbers use the shortest encoding; a leading zero is rejected.

| # | Field | Type |
| --- | --- | --- |
| 0 | parentHash | 32 B |
| 1 | miner | 20 B |
| 2 | stateRoot | 32 B |
| 3 | txRoot | 32 B |
| 4 | receiptsRoot | 32 B |
| 5 | logsBloom | 256 B |
| 6 | difficulty | number |
| 7 | number | number |
| 8 | gasLimit | number |
| 9 | gasUsed | number |
| 10 | timestamp | number, seconds |
| 11 | extraData | at most 32 B |
| 12 | baseFee | number |
| 13 | mixHash | 32 B |
| 14 | nonce | 8 B |

- `sealHash = keccak(rlp(fields 0 to 12))`
- `hash = keccak(rlp(fields 0 to 14))`
- A block is `rlp([header, [transactions...]])`; transactions are byte strings as in Ethereum's transaction trie.
- The block hash covers the body only through `txRoot`. A node must therefore never mark a hash as invalid because of a body that does not match txRoot: an attacker could send someone else's block with a forged body and cut the victim off permanently. Invalidity is recorded permanently only after execution fails for a block with the correct body and valid work.

Quinvium has no uncle blocks and no withdrawals. The header has no fields for them.

## 3. Header rules

Block `h` with parent `p` is valid when all of the following hold:

1. `h.number = p.number + 1`
2. `h.timestamp > p.timestamp`
3. `h.timestamp <= now + 60`. A violation is temporary: the block is rejected without penalty and without being recorded, and may become valid later.
4. `len(h.extraData) <= 32`
5. `h.gasUsed <= h.gasLimit`
6. `|h.gasLimit - p.gasLimit| < p.gasLimit // 1024`, `h.gasLimit >= 5 000 000`, `h.gasLimit <= maxGasLimit` from the rules at that height
7. `h.baseFee = nextBaseFee(p)`, see 6
8. `h.difficulty = nextDifficulty(p)`, see 7
9. Ethash is valid, see 8

A block with `number + 256 <= head.number` is rejected.

## 4. Body rules

1. `len(block) <= 2 097 152` bytes
2. Each transaction is at most 131 072 bytes
3. Transaction types 0, 1 and 2. Type 0 must carry chain ID protection per EIP-155.
4. `txRoot` is the root of the ordered trie keyed by `rlp(index)`
5. The running sum of `tx.gasLimit` must not exceed what is left of the block limit
6. The execution result must match `stateRoot`, `receiptsRoot`, `gasUsed` and `logsBloom` exactly

## 5. Execution

The EVM follows the Shanghai rules plus EIP-1153, EIP-5656, EIP-6780, EIP-7823 and EIP-7883. The network has no blobs and no EIP-4788, so address `0x0a` is not a precompile and opcodes `0x49` and `0x4a` are invalid.

Quinvium does not adopt EIP-7623; block size is limited by the rule in section 4.

Differences from Ethereum:

| Item | Quinvium | Reason |
| --- | --- | --- |
| Base fee | Paid to the miner, not burned | Miner income |
| BLAKE2F | 3 gas per round instead of 1 | Otherwise the slowest operation relative to its price |
| PREVRANDAO (`0x44`) | `p.mixHash` | There is no beacon chain. The miner can influence the value; do not use it for lotteries. |
| MODEXP | EIP-7823 and EIP-7883 | The same change as Fusaka in Ethereum |

Order within a block:

1. Transactions execute in block order on top of the parent state.
2. The priority fee is paid to the miner as each transaction executes, as in Ethereum.
3. After the last transaction the `miner` account is credited with `blockReward(number) + gasUsed × baseFee`.

`BLOCKHASH` returns the hash of the ancestor on the branch of the block being executed.

## 6. Economics

```
blockReward(n):
    n == 0: 0
    h = (n - 1) // 8 000 000
    h >= 64: 0
    otherwise: 4 × 10^18 >> h

nextBaseFee(p):
    target = p.gasLimit // 2
    p.gasUsed == target: base = p.baseFee
    p.gasUsed >  target: base = p.baseFee + max(p.baseFee × (p.gasUsed - target) // target // 8, 1)
    p.gasUsed <  target: base = p.baseFee - p.baseFee × (target - p.gasUsed) // target // 8
    result = max(base, 1 gwei)
```

The miner receives the block reward and the full fee of every transaction. Nothing is burned; coins are created only by block rewards. The sum of all rewards is at most 64 000 000 QU, in practice slightly lower because of rounding. There is no premine. The genesis contains only 11 system contracts with zero balance.

The genesis `gasLimit` is 10 000 000 and the cap for miner voting is 15 000 000. The limit is based on measurement: the worst known block validates in about 6 s on an Intel Core i5 desktop, against a 15 s block time.

## 7. Difficulty

LWMA over the last 60 blocks, `T = 15`:

```
nextDifficulty(p):
    p.number < 6: the network's initial difficulty
    n = min(p.number, 60)
    c[n] = p, c[i-1] = parent of c[i]
    weighted = 0, sum = 0
    for i from 1 to n:
        st = c[i].timestamp - c[i-1].timestamp
        st = min(st, 40 × T)
        st = max(st, 1)
        weighted += st × i
        sum += c[i].difficulty
    weighted = max(weighted, n² × T // 20)
    d = sum × (n + 1) × T // (2 × weighted)
    result = max(d, minimum difficulty)
```

The 40T cap shortens recovery after most of the hashrate leaves. In simulation, the departure of 99.9 % of hashrate takes about half a day to recover from, against three days with a 6T cap. A search over 352 combinations of false timestamps, even with 100 % of hashrate, did not push issuance below 15.1 s per block.

## 8. Proof of work

Ethash identical to Ethereum, including cache and DAG sizes, epoch length 30 000 blocks, `epoch = number // 30000`.

```
(mix, result) = hashimoto(sealHash, nonce, epoch)
valid when mix == h.mixHash and result <= 2^256 // h.difficulty
```

The implementation is verified against eight real Ethereum blocks in epochs 1 to 517, in both JavaScript and Rust.

## 9. Chain selection

The branch with the greatest total difficulty wins. On a tie the node keeps the branch it saw first. A reorganisation deeper than 256 blocks is accepted only if the new branch carries at least twice the work of our branch since the common ancestor. The node first downloads and verifies the work of all headers of the new branch and only then accepts its blocks.

The finality rule is not part of block validity: a new node has no such boundary on its first sync and chooses the heaviest branch. A network split for longer than 256 blocks converges after reconnecting on the side with at least twice the work. If both sides have similar work, nodes stay on their branches, log it and do not block each other. History below a checkpoint (`checkpoints`) is never rewritten.

## 10. Network upgrades

A fork in `network.forks` changes the rules from a fixed height:

```js
{ name: 'name', block: 1000000n, rules: { maxGasLimit: 20_000_000n, eips: [...] } }
```

Rules that can change: `eips`, `blake2RoundGas`, `maxGasLimit`, `powPrecompile`. More will be added as needed together with the rules version.

A fork can add a system contract: the `upgrades` field names contracts from `genesis/upgrades.json`. At the fork height, before the first transaction of the block, the code and nonce 1 are written; the balance of the address does not change. The genesis of a running network therefore never has to change.

### Fork `pools`

Activation: mainnet and dev from block 1, testnet per `network.forks`. It adds two things.

The `PoolFactory` contract at `0xae0000000000000000000000000000000000000c`.

A built-in proof-of-work check at `0x0000000000000000000000000000000000000100`. It always costs 100 000 gas, which corresponds to about 6 ms of computation. With a lower gas limit it fails with out of gas.

The input is the RLP of a whole header. It returns empty output when any of the following holds:

- the input is longer than 2048 bytes or is not a canonical header with 15 fields
- `number < 1` or `number` is higher than the height of the block being executed
- `difficulty` is 0 or at least 2^256, or `extraData` is longer than 32 bytes
- the header's epoch is older than the previous epoch of the executing block, otherwise nodes would have to compute foreign caches
- `mixHash` does not match `hashimoto(sealHash, nonce)`

Otherwise it returns seven 32-byte words: `miner`, `number`, `parentHash`, `difficulty`, `work`, `extraData` left-aligned, and the hash of the whole header, where `work = 2^256 // (result + 1)`, or `2^256 - 1` for a zero result. The function does not check difficulty; the calling contract decides.

Nodes identify each other with a fork identifier per EIP-2124:

```
h[0] = keccak(genesisHash)[0..4]
h[k] = keccak(genesisHash || block[1] || ... || block[k])[0..4]
```

The handshake carries the current `h` and the height of the next known fork. A node with incompatible history disconnects, so old software separates from the network cleanly instead of silently following another branch.

## 11. Peer protocol

This is not consensus; a bug here does not split the network, but it can harm it.

- TCP, X25519 key exchange, HKDF-SHA256 keys with the salt `aether-p2p-v1`, AES-256-GCM frames with a counter. The cipher must exist in both OpenSSL and BoringSSL, because the node in the desktop app runs on Electron's Node.
- Option `--lan`: every 10 s the node broadcasts `aether-lan1 <chainId> <genesis> <p2pPort> <nodeId> ask` to UDP port 30529 and answers the same message directly to its sender with `reply`. Only messages from private addresses and with the same chain are accepted. The message proves nothing; connections and blocks are verified separately. Local addresses are not spread through public address exchange.
- Frame: 4 bytes of length, encrypted type and RLP body. At most 16 KiB before the handshake, then 12 MiB.
- Node identity: a persistent Ed25519 key in `node.key` in the data directory. The node ID is the first 16 bytes of the SHA-256 of the public key. HELLO carries, after the original 11 fields, the public key, a signature and a capabilities byte. The signed data is `quintium-hello-v1`, the role (1 initiator, 0 responder) and SHA-256 of the salt and both ephemeral X25519 keys in initiator, responder order. An attacker relaying the connection has different ephemeral keys with each side, so the signature fails.
- Mainnet accepts only nodes with an identity; testnet also accepts older versions without one. A seed can have a pinned key in the form `key@host:port` (64 hex characters). A connection to it succeeds only with its signature, so not even forged DNS can lead a new node to a different network. The node key is returned by `aether_nodeInfo`.
- Announcement by hash (capability 1): the full transaction or block goes to all older peers and to the square root of the number of new ones; the other new peers get only the hash and request the content. Traffic grows with the square root of the number of peers.

| Message | Limit | Purpose |
| --- | --- | --- |
| HELLO | 1 per s | version, network, genesis, tip, forks |
| PING, PONG, STATUS | 1 per s | liveness and status |
| GET_HEADERS | 8 per s | at most 256 headers, 64 locator entries |
| GET_BLOCKS | 16 per s | at most 64 blocks and 8 MiB |
| NEW_BLOCK | 4 per s | relayed only after full validation |
| NEW_TXS | 16 per s, 64 transactions per s per peer | at most 256 per batch |
| GET_PEERS | 1 per 20 s | at most 64 addresses |
| NEW_TX_HASHES | 16 per s | at most 1024 hashes |
| GET_TXS, TXS | 16 per s | at most 256 transactions and 8 MiB |
| NEW_BLOCK_HASH | 4 per s | hash, height and work; the block is fetched with GET_BLOCKS |

A peer that does not read is disconnected at the latest when 32 MiB are queued for sending.

**Synchronisation.** A peer's claim of work proves nothing. The node downloads headers and blocks from whoever promises the most; when a peer fails to deliver, it is penalised and the next one is tried. A node considers itself behind only after 32 verified downloaded blocks, and only then stops handing out work to miners.

**Addresses.** Verified addresses the node itself connected to are kept apart from addresses heard from other nodes. Outbound connections go to at most one address per /16 range, three quarters of them from verified addresses. Inbound connections: 32 in total, 3 per IP, 6 per /16 range.

## 12. Evidence

| Area | Evidence |
| --- | --- |
| EVM | Official `ethereum/tests` v14.1 GeneralStateTests for Cancun and `execution-spec-tests` v5.4.0 for EIP-7823 and EIP-7883, script `packages/node/test/statetests.mjs` |
| Ethash | Real Ethereum blocks, `test/ethash.test.js`, high epochs with `AETHER_SLOW=1` |
| Cryptography | WebAssembly cross-test against the reference implementation, `test/crypto-diff.test.js` |
| Attacks | `test/attacks.test.js` |
| Fuzzing | `test/fuzz.test.js` |
| Forks | `test/forks.test.js` |
| Consensus unchanged | Fixed fingerprints in `test/golden.test.js` |

Dependencies that affect consensus have exact versions in `packages/node/package.json`. Updating any of them is a potential hard fork and requires running the whole suite again.
