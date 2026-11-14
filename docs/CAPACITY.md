# Capacity and load

Measured on 1 November 2026 with the scripts in `scripts/zatez`. Machine: a desktop with an Intel Core i3-8100 (4 cores, 3.6 GHz), 32 GB RAM, Node.js 24; the node ran next to GPU mining. The numbers show the order of magnitude, not the limit of a server: a typical server has more cores and a faster disk. Block propagation between nodes was measured on one computer, so it does not include internet latency.

## What one network can carry

| Area | Measured | What it means |
| --- | --- | --- |
| Network throughput | 476 transfers per block, **31.7 tx/s**; tokens 171 per block, 11.4 tx/s | Hard consensus limit until the gas limit is raised |
| Full block on a node | building 350 to 500 ms, validation and storage 520 to 670 ms | Uses about 1.2 s of the 15 s; computation has headroom |
| Transaction intake | 664 tx/s over RPC | Higher than network throughput; the queue is not flooded by intake |
| RPC reads | 9 500/s block number, 5 400/s block, 2 900/s balance, 500/s `eth_call` | One node serves thousands of wallets |
| `eth_call` overload | above a queue of 128 it returns "node overloaded" | Intentional: the node keeps processing blocks |
| Stratum | **10 000 devices**, new work to all in 261 ms, RPC still within 3 ms, 100 MB extra | One node handles a large farm; the default limit is 1024 |
| Explorer filters | 5 million transactions, 1 GB index, worst query 237 ms | Run in worker threads and do not delay blocks |
| Block propagation | 4 to 8 ms per node when connected on one computer | The internet adds its own latency |
| Synchronisation | 10 blocks/s for empty blocks | A year of chain downloads in 2.5 days, a full chain in several weeks |
| Proof-of-work check | 13 ms | A hundred shares per block cost 1.3 s |
| Data | **8.5 kB per transaction** | A full network adds 8.5 TB per year |

## Millions of users

**Money and transfers.** A million active users making two transactions a day is 23 tx/s, almost the whole capacity. Ten million is 230 tx/s, seven times more than the network can take. The base layer therefore cannot carry millions of people directly, and fees would rise until most were pushed out. Bitcoin and Ethereum have the same constraint. There are three solutions that can be combined:

1. Raise the gas limit with a fork. Computation has about tenfold headroom, but the brake is data growth and block propagation over the internet. Tripling it (95 tx/s) is a sensible first step after testing on a testnet with nodes in different networks.
2. A second layer: a rollup or payment channels. Routine payments move off the base layer, which only keeps settlement.
3. Many independent public nodes behind load balancing. Reads scale by adding nodes; writes do not.

**Reads.** A wallet makes tens of queries per minute in normal use. One node with 3 000 queries per second serves tens of thousands of simultaneously active people. A million people means roughly 30 to 50 servers, which is ordinary infrastructure.

**Miners.** Solo mining and a classic pool over Stratum scale well: 10 000 devices per node, and more devices simply mean more nodes. A public node assumes a limit of 128 devices per address; a farm can raise it with `--stratum-sessions-per-ip`.

**Trustless pools.** This is the real limit. Each share costs about 220 000 gas and at most 45 fit in a block, i.e. 3 per second for the whole network. A pool with 24 shares per block is a reasonable ceiling. Small pools handle this as they should: share difficulty rises with pool size, so a miner with a small card gets paid less often but just as fairly. With hundreds of thousands of devices in one pool, a small miner would wait days for a share. That scale needs a further step: shares are summed into a Merkle tree and the contract verifies only a random sample, so the cost stops growing with the number of shares. That is a contract change, the design must be verified, and it is not done yet.

Since 8 November 2026 the pool server submits fewer shares when blocks fill up: 24 per block up to half a block, 6 with full blocks. Pools therefore do not crowd out payments or raise fees for others; the only cost is higher payout variance (`PoolServer.sharesPerBlock`). The network-wide limit of 3 shares per second remains until the Merkle-sample design exists.

**Propagation.** Since 8 November 2026 only the square root of the number of peers receives the full transaction or block, the others get the hash (see SPECIFICATION, section 11). With 32 peers a node sends the full message 6 times instead of 32.

**Data.** The node currently stores the state of all blocks, so it behaves like an archive node. With a full network that is 8.5 TB per year, which a home computer cannot sustain long-term. Before heavy production use:

1. Pruning of old state; a regular node keeps only the last few hundred blocks.
2. Fast sync from a state snapshot. Today a new node recomputes the whole history.

Until the network is full this is not a problem: blocks are currently in the order of kilobytes.

## What has to be done before millions of users

| Priority | Task | Why |
| --- | --- | --- |
| High | State pruning and snapshot sync | Otherwise ordinary people stop running nodes |
| High | Public bootstrap nodes in different networks | Without them a new node has nowhere to connect |
| High | Measurement over the internet, not on one computer | Block propagation is the main risk of a higher gas limit |
| Medium | Raising the gas limit after measurement | Three times the capacity |
| Medium | Batched shares in pools | Pools with hundreds of thousands of devices |
| Medium | A second layer for payments | The only way to tens of millions of users |

## How to repeat the measurements

```bash
node scripts/zatez/rpc.mjs                       # reads
node scripts/zatez/transakce.mjs                 # writes and full blocks
node scripts/zatez/stratum.mjs 1000,5000,10000   # Stratum devices
node scripts/zatez/index.mjs 5000000             # Explorer filters
node scripts/zatez/sit.mjs                       # propagation and sync
```
