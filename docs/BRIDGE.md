# Bridge and stablecoins

The bridge is written and tested but **not deployed** on mainnet. It will run on mainnet only with independent validators.

## How the bridge works

The `BridgeGateway` gateway runs on both chains. A send on the source network locks the original or burns the bridged token. Validators sign the message once it is deep enough in the chain, and anyone can then deliver the coins on the target network with their signatures.

| Protection | Value |
| --- | --- |
| Validator agreement | A majority and at least two; the target gateway address is part of the signature, so it is valid nowhere else. Signatures use the EIP-191 prefix. Message numbers are derived from the source gateway address, so a new gateway does not reuse the numbers of an old one |
| Large amount or exceeded daily limit | Waits 24 hours and the guardian can cancel it |
| Guardian | Can only pause and cancel a transfer, never release anything. A cancelled transfer is refunded to the sender by the validators |
| Validator change | Takes effect only after 2 days, so users have time to notice |
| Token with a transfer fee | Rejected, otherwise the backing would not match |
| Cancelled transfer | Never passes on the target network again and the sender gets the full amount back, at most once |

## Refunds

A transfer that is not supposed to or cannot arrive is cancelled and refunded to the sender. On the target network the guardian or the administrator can cancel it: a large queued transfer with `cancelQueued`, any other with `cancelDelivery`. The recipient itself can also reject it, for example a contract that does not accept coins. The gateway never delivers a cancelled transfer; `cancelled(id)` shows it.

Validators wait until the cancellation is deep enough in the target chain that a reorganisation cannot undo it. Then they send the full amount back to the sender on the source network the same way as a transfer in the opposite direction. The refund has a number derived from the original send, so one send is refunded at most once. A delivered transfer cannot be cancelled and is therefore never refunded. Refunds follow the same rules as normal transfers: a large amount waits 24 hours. The Explorer shows "Cancelled, refunding" and then "Refunded to sender" for the transfer.

Outside the bridge, the same applies as in Ethereum: a transaction that fails transfers nothing and the amount stays with the sender; only the gas used is paid. A swap with a worse rate than the allowed slippage, or after its deadline, fails entirely. A liquidity deposit returns coins the pool ratio did not need. A pool payout to a miner that fails stays in the pool for collection, and escrow refunds according to its own rules.

## Bitcoin

Bitcoin cannot run a contract, so coins are held by a multisig address of the validators.

**Deposit.** Each recipient has their own address in which their Quinvium address is encoded. Any wallet or exchange can pay to it. Anyone can compute the address themselves and check that the Explorer did not forge it. Registration with `requestBitcoinDeposit` tells validators to watch it. After the confirmations the recipient gets `qBTC` backed 1:1.

**Withdrawal.** The gateway burns the token. A proposer publishes a transaction and the others sign it only when they have verified themselves that:

- the inputs are custody coins the validator has seen itself,
- the payment goes to the address the user asked for,
- the custody loses exactly the burned amount and the withdrawer pays the network fee,
- the change returns to the custody,
- the fee does not exceed the limit and the daily withdrawal limit is not exceeded.

A proposer can at most cause a delay. After ten minutes the next one takes over. An invalid address returns the token.

## Economics

Validators pay gas for confirmations and deliveries. The bridge has no fee of its own yet, so `minAmount` on each route has to cover the costs; otherwise an attacker could send many small transfers at their expense. A bridge fee must be added before production use. For withdrawals to Bitcoin the withdrawer pays the network fee, which is deducted from the amount.

## Stablecoins

USDT, USDC and USD1 are issued by Tether, Circle and World Liberty Financial. No real stablecoin exists without them, but there are two paths:

1. **Issuance directly on Quinvium.** `StableToken` has the roles issuers use: minting limits, address blocking, emergency pause and `permit`.
2. **Through the bridge.** The token is backed 1:1 by the original locked in the gateway on Ethereum. It is an obligation of the bridge, not of the issuer.

`TokenRegistry` distinguishes a genuine token from an imitation with the same name; the Explorer and the wallet show verified tokens based on it. The owner of the list should be a multisig contract.

On testnet the registry is at `0x1F29eD151d57E51706494aB3E9579B2212102C10` and is empty. There are no preset test tokens; tokens are created by their authors, and Swap finds every token with a pool against tQU. Real BTC and ETH would come through the bridge as `qBTC` and `qETH`. The registry is not deployed on mainnet.

## Launching a bridge

What needs to be decided and secured:

1. At least three independent validators, each on its own server and with its own nodes of both chains. Two machines of one person are not independence.
2. Administrator and guardian: multisig contracts, not a single key.
3. An independent audit of the contracts and the validator.
4. Gas on both chains for every validator.
5. Limits according to the amount of funds. Start low.
6. Enough confirmations. A validator does not start with fewer than 240 confirmations on Quinvium mainnet (an hour, below the 256-block finality boundary) and 64 on Ethereum. A small proof-of-work network can be rewritten for a few minutes with rented hashrate, and the same coins could then be sent twice. Daily limits should correspond to what such a rewrite would cost.

Procedure:

```bash
# 1. Deploy BridgeGateway on both networks, create bridged tokens (createWrapped) and open routes (setRoute, setOutbound)
# 2. For each validator: its own keys with mode 600 and configuration based on the example
cp packages/bridge/config.example.json bridge.json
node packages/bridge/src/cli.js bridge.json
# 3. Write the addresses into packages/explorer/public/deployments.json
```

Example `deployments.json`:

```json
{
  "52402": {
    "registry": "0x…", "gateway": "0x…",
    "networks": [
      { "id": 11155111, "name": "Sepolia", "rpc": "https://…", "gateway": "0x…", "currency": { "name": "Ether", "symbol": "ETH", "decimals": 18 } },
      { "id": 11631617, "name": "Bitcoin", "bitcoin": "testnet", "keys": ["02…", "03…", "02…"], "threshold": 2, "confirmations": 6 }
    ],
    "assets": [
      { "symbol": "ETH", "token": "0x… qETH", "burn": true, "decimals": 18, "network": 11155111, "min": "1000000000000000", "remoteToken": "0x0000000000000000000000000000000000000000" },
      { "symbol": "qBTC", "token": "0x…", "burn": true, "decimals": 8, "network": 11631617, "min": "50000" }
    ]
  }
}
```

The Bitcoin identifier is fixed: `0xB17C01`, decimal 11631617.

## Test bridge with Sepolia

The testnet has a prepared bridge Quinvium testnet ↔ Ethereum Sepolia with only the ETH ↔ qETH route. It is for trying things out: its validators are not independent, and the administrator and guardian are plain keys, not multisig contracts. It is not deployed yet.

- `node scripts/nasadit-most.mjs` deploys the gateways on both networks, creates qETH, opens routes, sends validators gas, writes their configuration and adds the bridge to `deployments.json`. It stores progress in a state file, so an interrupted deployment continues. It needs at least 0.2 tQU and 0.02 Sepolia ETH on the administrator address. Keys are read from a private folder of the operator and are never copied.
- `scripts/most-validatori.sh start` runs the validators as macOS services that start again after a reboot. `status` shows whether they run and the last lines of their log, `stop` turns them off.
- Sepolia is reached through the public node `https://ethereum-sepolia-rpc.publicnode.com`.
- Limits: smallest transfer 0.001 ETH, daily cap 5 ETH, transfers above 1 ETH wait 24 hours. 12 confirmations on each network.

## Tests

| Suite | What it verifies |
| --- | --- |
| `packages/contracts/test/bridge.test.js` | Contracts including theft attempts |
| `packages/contracts/test/invariants.test.js` | Backing after every step of random runs |
| `packages/bridge/test/nasazeni.test.js` | The test bridge deployment script on two local chains, a repeated run and an ETH ↔ qETH transfer with the validator configuration from the script |
| `packages/bridge/test/relayer.test.js` | Validators between two real nodes, refunds of cancelled and rejected transfers, a delivered transfer is never refunded |
| `packages/bridge/test/btc-bridge.test.js` | Bitcoin from deposit to withdrawal, a dishonest proposer, reorganisations |
| `packages/bridge/test/bitcoin.test.js` | Computations against an independent library |
| `packages/explorer/test/bridge.mjs` | Pages in a real browser with live validators, including the refund of a cancelled transfer |

Bitcoin is simulated in tests by `test/helpers/mock-bitcoin.js`, which accepts only transactions with valid signatures. A test against a real node is prepared but has not run yet. It is required before use:

```bash
BITCOIND=/path/to/bitcoind node --test packages/bridge/test/btc-regtest.test.js
```
