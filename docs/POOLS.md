# Mining pools

A pool lets many miners work together and share the rewards by the work each of them proves. A small miner gets smaller but regular payouts instead of waiting a long time for a block of its own.

On Quinvium a pool is a **smart contract**, not a company account:

- Blocks found by the pool name the pool contract as the reward recipient. The coins never pass through the operator.
- A share is a block header with the miner's address and the share difficulty inside, covered by the proof of work. The contract checks the work with a built-in function of the network (`0x…0100`), so nobody can fake a share or move it to another miner.
- Rewards are split by **PPLNS** over the last few rounds, so jumping between pools brings nothing.
- The operator fee is fixed when the pool is created, **at most 5 %**, and can never be changed. The operator can withdraw only the fee.
- Anyone can submit shares and trigger payouts, even if the operator disappears.

Pools are created through the network's **PoolFactory** at `0xae00…000c` (part of the chain since the `pools` fork at block 1). The Explorer and the command line tool only accept pools from this factory.

## For miners

1. Pick a pool on [explorer.quinvium.com/pools](https://explorer.quinvium.com/pools): its page shows the operator, fee, hashrate, miners and payouts.
2. Point your miner at the pool server and the pool contract:

   ```bash
   quintium-miner --address YOUR_ADDRESS --node https://pool.example.org --pool 0xPOOL --worker rig1
   ```

   In the Quinvium app choose the pool under Mining. Other Ethash miners (including ASICs) connect to the pool server over Stratum (port 3333 on mainnet).
3. Earnings accumulate in the contract. Withdraw them in the app, on the pool page in the Explorer, or with `quinvium pool claim 0xPOOL`. Payouts the operator triggers go straight to your address.

## For operators

### 1. Create the pool contract

In the Explorer: **Pools → Create a pool**, or on the command line:

```bash
quinvium pool create --name "My Pool" --url https://pool.example.org --fee-percent 1 --round 32 --window 16
```

| Setting | Meaning | Limits |
| --- | --- | --- |
| `name` | shown in the Explorer and the app | 1–64 characters |
| `url` | address of your pool server, where miners connect | public HTTPS address |
| `fee-percent` | operator fee | 0–5 %, fixed forever |
| `round` | round length in blocks | 16–5,760 |
| `window` | how many recent rounds share a reward (PPLNS) | 1–256 |

The transaction is sent from your wallet; that address becomes the operator and receives the fee.

### 2. Run the pool server

The pool server is an ordinary Quinvium node with `--pool`:

```bash
node packages/node/src/cli.js --network mainnet --pool 0xPOOL --rpc-host 127.0.0.1 --rpc-port 8545 --stratum-port 3333
```

- On first start the node creates its own account key `pool.key` in the data folder (or `--pool-key-file`). This account pays the gas for writing shares to the chain. Send it a small amount of QU and keep it topped up; the Explorer shows its balance on the pool page.
- Put an HTTPS reverse proxy in front of the RPC port and publish that address as the pool `url` (see [RUNNING-A-PUBLIC-NODE.md](RUNNING-A-PUBLIC-NODE.md) and `ops/caddy/Caddyfile`). Open the Stratum port for miners that use Stratum.
- The key never leaves the server and is never printed. It can only pay gas for shares; it cannot move pooled rewards.

### 3. Operate

- Withdraw your fee with `quinvium pool withdraw-fee 0xPOOL` or on the pool page.
- The pool page in the Explorer shows connected devices, miners in the current window, blocks found and payouts.
- If the share account runs out of QU, shares stop being recorded until it is topped up; miners' coins already in the contract are safe.

## Solo mining

Without a pool, a miner mines for its own address and receives the whole block reward and all fees whenever it finds a block. The Explorer lists solo miners on [Miners](https://explorer.quinvium.com/miners); on the Pools page the largest solo miners are shown one by one and the rest are summed up in one row.
