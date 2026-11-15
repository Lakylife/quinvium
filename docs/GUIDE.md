# Guide for users, miners and developers

## Regular user on Windows

1. Download `Quinvium-<version>-Windows-x64.exe` from https://quinvium.com/download/ and install the app.
2. Windows may show a SmartScreen warning because the program is not code-signed yet. Choose More info and Run anyway.
3. Create a wallet in the app and **write the recovery phrase down on paper**. Without it nobody can recover your funds.
4. The Mining tab starts mining on your graphics card. The Node tab shows the network status.

If the installer does not start or keeps showing the same error, close all its windows or restart the computer. The installer may run only once. A newer version closes and replaces the older one; the wallet stays.

The card needs DirectX 12 or Vulkan support and at least 2 GB of memory at the start of the network. Memory use grows by about 8 MB every 5 days, so after 4 years around 3.3 GB will be needed.

## Connecting several computers

Computers on the same local network find each other automatically. Open the Quinvium app on them and the Network tab shows the connected node shortly. The chain is downloaded and all of them mine the same network. A shorter chain is replaced by a heavier one, so blocks mined earlier on a computer without a connection disappear.

If the computers do not find each other, for example on a network with client isolation, enter the address by hand in the Network tab under Connect with another computer.

To open the Explorer from a computer without the app, enable sharing the Explorer and mining with other computers in the same place. The app shows the address, for example `http://192.168.1.20:8546`. This also opens Stratum for common miners. By default both are available only on that computer.

Computers outside the local network find the network through the public seed `seed.quinvium.com`.

## Connecting a wallet to the Explorer

The Connect wallet button works in three ways:

- **In the Quinvium app.** Open the Explorer with the button in the app. You confirm the request in the main window; nothing else is installed.
- **With the Quinvium Wallet extension.** If you do not have a wallet yet, you create it right when connecting.
- **With MetaMask.** After connecting, the page offers to add and switch to the Quinvium network.

Connecting only shows your address to the page. MetaMask shows a Quinvium balance only on the right network, so the second step is needed. If the MetaMask window does not appear, click its icon at the top right of Chrome; the request waits there.

**MetaMask on the Quinvium network.** Two things MetaMask cannot do on custom networks, and they cannot be enabled from our side:

- **Fee speed.** The Low, Market and Aggressive options and Network status come from a MetaMask service that supports only selected networks and does not know Quinvium. MetaMask then offers only Network suggested, i.e. the price from the node, and Advanced, where the fee and tip can be entered by hand. The Quinvium wallet has slow, normal and fast options.
- **Swap.** MetaMask's Swap button only uses MetaMask's own service on supported networks, and Quinvium tokens are not in it. On Quinvium, swaps happen on the Swap page of the Explorer or the Swap tab of the app. MetaMask only confirms the transaction there.

## History in the Explorer and the wallet

The Explorer has plain addresses: the home page is `/`, a transaction `/tx/0x…`, an address `/address/0x…`, a block `/block/123`. Older links with `#/` still work; the Explorer converts them.

**The home page** shows the total number of transactions and tx/s, the current fee (base and tip for slow, normal and fast), the last safe and final block, a 14-day transaction chart, the latest blocks with the miner's actual reward (block reward and all fees, nothing is burned) and the latest transactions with their method.

**The transaction list** shows 24-hour traffic at the top: count, pending in the last hour, total fees and the average fee. Each transaction shows the method (the called function name), block, age, from, to, amount and fee. The eye icon shows a quick preview without opening the details. **The block list** shows 24-hour network utilisation, the last safe block, miner rewards and the share of blocks from pools. There is no MEV or fee burning: blocks are mined directly by miners and pools. Each block shows gas used with utilisation, limit, base fee and the miner's reward. **Charts** also show active addresses, fees, token transfers, new contracts, failed transactions and network utilisation.

For each transaction the Explorer says what it did: transfer, token transfer, swap, token approval, bridge, liquidity, pool, `.qu` name or contract deployment. The transaction details add a sentence with the amounts, for example "0.1 TOKEN → 4,213 tQU". On an address page each transaction is marked Sent, Received or Self; More information shows the first and last sent transaction and where the first coins came from. The Token transfers tab also shows tokens that arrived in someone else's transaction, for example the output of a swap or a payment from another person.

**Pools.** A pool page shows its accounts: block rewards, paid to miners, what miners are owed and waiting for payout, what waits to be distributed and the operator fee (available and withdrawn). It also lists miners in the pool window with their share of the work, number of shares and amount to withdraw, and, on the node where the pool server runs, the connected devices. The pool contract receives block rewards directly from the network and pays miners inside the contract, so these do not appear as Received and Sent transactions. The address page explains this for a pool and links to the overview. A pool creator sees the pools they run, with the fee to withdraw, on their address page.

**Wallet activity** is grouped by day (Today, Yesterday, date) and shows everything that happened on the account, not only what was sent: received payments, token transfers in both directions (for a swap both sides, for example −10 tQU and +19.8 TOKEN), pool payouts with the pool name and block rewards summed per day. Each item has an icon for its kind, the counterparty, time and signed amounts; pending and failed ones have a label. An opened item shows status, both sides, to and from, the fee paid, the nonce, time, transaction and a link to the Explorer; for block rewards the day, count and range of blocks.

You can sign in in several ways: create a new wallet, restore one with a phrase, import a private key, connect MetaMask, the Quinvium Wallet or another browser wallet, and a phone wallet through WalletConnect. The same applies in the app: MetaMask is a browser extension, so the app opens a local page in the browser and relays signatures through it. Keep the tab open; the keys stay in MetaMask. Mining payouts always go to the signed-in wallet. WalletConnect needs a free Project ID from dashboard.reown.com, written into `packages/explorer/public/config.js` by the Explorer operator. Without it the page asks the visitor for one.

## When a transaction is pending

Until a transaction is in a block, it has transferred nothing. Coins and tokens stay on the account and a pending transaction cannot take them away. Each transaction has a sequence number (nonce) and goes through at most once, or not at all. If it fails in a block, nothing is transferred and only the gas used is paid.

- **Slow confirmation.** In the Quinvium wallet press Speed up on a pending payment to send it again with a higher fee. Cancel sends an empty payment to yourself instead. Only one of them ever goes through; the other ends as Did not happen.
- **The node forgot the transaction.** The node saves its queue to disk and loads it after a restart or update. The Quinvium wallet also detects that the node does not know the transaction and sends the same one again. The node hands its whole queue to new nodes in the network.
- **A gap in the sequence.** The Explorer says which earlier number a pending transaction waits for. In MetaMask, Settings → Advanced → Clear activity tab data and sending again helps.
- **Nobody is mining.** The Explorer says so for the transaction. It is confirmed with the first mined block.

The queue drops a transaction after six hours of waiting. Even then nothing is transferred; just send it again. The wallet never sends anything to the zero address or to the token contract's own address, because coins would never come back from either.

**Failed transaction.** The Explorer details give the reason: the node replays the block up to the transaction and the Explorer translates the contract error, for example "The rate changed between the estimate and mining by more than the set tolerance" (`SlippageExceeded`), and advises how to avoid it. A typical case is the same swap sent twice in quick succession: the first changes the rate and takes the tokens, the slippage protection stops the second and only the gas fee is paid. Swap, Liquidity and Bridge therefore allow the next transaction only after the previous one from the same account is confirmed.

## App lock

An unlocked app stays unlocked while you work with it. After inactivity it locks completely and waits for the wallet password; you choose the time in Settings (5 to 60 minutes, default 15). Mining and the node keep running in the meantime. The Lock app button in the menu locks it immediately. Changing the pool always requires the password, because it decides where mined coins go. With a wallet outside the app there is no app password; you confirm signatures directly in that wallet.

## Swap

The Swap tab in the app and the same page in the Explorer swap tokens through liquidity pools. Swap is currently deployed on testnet only. The rate is set by the ratio of reserves in the pool; the 0.3 % fee stays with liquidity providers. Before a swap you see the rate, the price impact and the minimum amount you will receive. If the rate moves by more than the set tolerance before confirmation, the transaction reverts. On the Liquidity tab you can add coins to a pool and withdraw your share later. Anyone can create a pool with the first deposit; its ratio sets the first rate.

The testnet has no preset tokens. A token is created by its author in Apps, a pool with tQU on the Pools tab (a token without a pool is selected by pasting its address into the search), and from then on Swap finds it. Tokens on testnet have no value.

## Apps

The Apps page in the Explorer has nine apps: notary, credentials, supply chain, payment escrow, polls, address names, custom token, NFT collection and multisig wallet. Each has tasks at the top, for example Record, Verify and Revoke, and the chosen task shows only the fields it needs. A verification result is an overview with the status, addresses as links and times. After creating an item, deal, poll, token, collection or wallet, its number or address is shown and filled into the form, so the next step (add a route step, vote, send tokens, propose a payment) already has it. Reading is free; writing is signed by the connected wallet and only the network fee is paid, plus the name price for names.

## Tokens and the bridge

The Tokens page in the Explorer shows verified tokens and can check a token address. Anyone can choose a name and symbol; the address on the list is what matters. The wallet says for every token whether it is verified.

The Bridge tab transfers coins between Quinvium and other networks. It is not deployed yet and needs independent validators, see [BRIDGE.md](BRIDGE.md).

## App updates

On testnet the app downloads a new version by itself, verifies its signature, unpacks it into its own folder and restarts. Mining continues after the restart. If the new version fails to start, the app returns to the previous one and never downloads the faulty one again. While mining, the app prevents the computer from sleeping; the screen can still turn off. **On mainnet remote updates are currently switched off**; install new versions from https://quinvium.com/download/.

## Mining

### Quinvium miner

```
quintium-miner --list
quintium-miner --address YOUR_ADDRESS --node http://127.0.0.1:8545
```

The miner computes the DAG on the card, checks it against the CPU and recomputes every solution before submitting it.

### Common miners

The node must have Stratum open to the network: `quintium-node --network mainnet --stratum-host 0.0.0.0`. The login name is the address, optionally with a machine name. No registration is needed.

```
lolMiner --algo ETHASH --pool NODE_ADDRESS:3333 --user YOUR_ADDRESS.rig1
t-rex -a ethash -o stratum+tcp://NODE_ADDRESS:3333 -u YOUR_ADDRESS -w rig1 -p x
teamredminer -a ethash -o stratum+tcp://NODE_ADDRESS:3333 -u YOUR_ADDRESS.rig1 -p x
```

Port 3333 is mainnet, 3334 testnet. A node without a pool works solo: every found block pays the full reward to the finder.

### Pools

A pool combines the hashrate of several miners and splits rewards by work done, so even a weaker card has a steady income. In Quinvium a pool is a smart contract:

- Block rewards go directly to the contract; the operator cannot reach them.
- The network verifies every miner's work. The miner's address is part of the hashed header, so a share cannot be redirected to someone else.
- The fee is at most 5 % and cannot be changed after creation.
- Rewards are split over the last rounds (PPLNS), so pool hopping brings nothing.
- The pool server triggers payouts itself. If it disappears, anyone can trigger a withdrawal in the Explorer and the coins always go to the miner.

Mining into a pool in the app: Mining, Where you mine, choose a pool. The list shows the ten strongest pools by blocks in 24 hours with fee, share and number of miners; search finds others by name or address and all are in the Explorer. A pool page in the Explorer has connection instructions like large pools (server, name, password and ready-made commands for the Quinvium miner, lolMiner, T-Rex, TeamRedMiner and ASICs). From the command line:

```
quintium-miner --address YOUR_ADDRESS --node http://POOL_SERVER:8545 --pool 0xPOOL_ADDRESS --worker rig1
```

The Quinvium miner checks for every job that it pays into the chosen pool and carries its address.

With `--fallback http://127.0.0.1:8545` (one or more nodes, separated by commas) the miner keeps mining solo through your own node when the pool stops answering for about 10 seconds, and returns to the pool as soon as it answers again (checked every minute). The app does this by itself.

Creating a pool: open Pools in the Explorer and fill in the name, server address and fee. Then start the server in the app under Settings, Run a pool, or with:

```
quintium-node --network mainnet --pool 0xPOOL_ADDRESS --rpc-host 0.0.0.0 --stratum-host 0.0.0.0 --rate-limit 6000
```

On first start the server creates a gas account (`pool.key` in the data folder). Send a small amount to it; it pays for submitting shares and payouts. Neither your coins nor the miners' coins are on it.

### ASICs

The network uses plain Ethash with the same parameters as Ethereum before proof-of-stake, including the 30 000-block epoch length. Stratum supports ETHPROXY and EthereumStratum/1.0.0, the protocols these machines use. Login works as with common miners, for pools and solo:

```
address:  stratum+tcp://SERVER:3333
user:     YOUR_ADDRESS.machine_name
password: x
```

The pool sets share difficulty for each machine according to its hashrate.

The machine needs firmware for Ethash, not Etchash: Ethereum Classic has used longer epochs since 2020. The firmware of some machines checks the DAG size or coin name and may not work with the small DAG of a young network. Nobody has tried a real ASIC on this network yet; verify this before buying a machine for Quinvium.

## Command line

Wallet, transfers, swap, bridge, pools, mining and the node can all be controlled without a window with the `quinvium` command, see [CLI.md](CLI.md).

## Running a node

```
quintium-node --network mainnet
```

| Network | RPC and Explorer | P2P | Stratum |
| --- | --- | --- | --- |
| mainnet | 8545 | 30524 | 3333 |
| testnet | 8546 | 30525 | 3334 |
| dev | 8547 | 30526 | 3335 |

A public node needs an open P2P port. Expose RPC to the internet only behind a reverse proxy with HTTPS and `--rate-limit`. Data lives in `~/.aether/<network>`; the node is an archive node, so it keeps the state of all blocks. A complete public setup is in [RUNNING-A-PUBLIC-NODE.md](RUNNING-A-PUBLIC-NODE.md).

## Developers

Full documentation with examples and the RPC and contract reference is in the Explorer at https://explorer.quinvium.com/docs.

The network is compatible with Ethereum tools. Hardhat:

```js
networks: {
  quinvium: { url: 'https://rpc.quinvium.com', chainId: 52401, accounts: [process.env.KEY] },
  quinviumTestnet: { url: 'https://rpc1.quinvium.com', chainId: 52402, accounts: [process.env.KEY] },
}
```

Compile Solidity for `cancun`. The network has no EIP-4844 blobs, so `blobhash()` and `block.blobbasefee` fail in a contract. `block.prevrandao` returns the parent block's mixHash and the miner can influence it, so it is not suitable for lotteries.

Development network with automatic mining:

```
quintium-node --network dev --dev-mine --miner-address YOUR_ADDRESS
```

### System contracts

They are in the genesis block at fixed addresses. Interfaces are in `packages/contracts/src`.

| Contract | Address | Use |
| --- | --- | --- |
| Notary | `0xae00…0001` | Proof of existence of a document: law, healthcare, archiving. Each address has its own record. |
| AetherNames | `0xae00…0002` | Names instead of addresses, two-step registration against front-running |
| Credentials | `0xae00…0003` | Diplomas, licences, qualifications. Verified by the issuer's address. |
| SupplyChain | `0xae00…0004` | Origin and route of goods: food, medicine, logistics |
| Escrow | `0xae00…0005` | Payment escrow: trade, services, real estate. Without a decision within 90 days the parties split it in half. |
| Polls | `0xae00…0006` | Voting: municipalities, associations, cooperatives |
| TokenFactory | `0xae00…0007` | Custom tokens, loyalty points |
| CollectionFactory | `0xae00…0008` | NFTs: tickets, warranty cards, art |
| MultisigFactory | `0xae00…0009` | Multisig wallets for organisations; owners can be changed by an approved proposal |
| WQU (Wrapped QU) | `0xae00…000a` | Wrapped QU for exchanges |
| Multicall | `0xae00…000b` | Batched reads for apps |
| PoolFactory | `0xae00…000c` | Mining pools that pay out through a contract (added by the `pools` fork at block 1) |

The extended `aether_*` / `quinvium_*` RPC methods are described on the developer page of the Explorer.
