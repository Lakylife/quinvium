# Command line

Everything the app and the Explorer can do also works without a window, as with Bitcoin and Ethereum: wallet, transfers, swap, bridge, mining, pools and the network apps (notary, credentials, supply chain, escrow, polls, names, custom tokens, NFTs and multisig wallets). The app and the Explorer are a layer on top; the network does not depend on them.

## Language

The main language is English; Czech switches on from the system language (`LANG=cs_CZ.UTF-8`, on Windows from the system settings). The choice can be saved permanently or given for one command only:

```
quinvium lang cs                          Czech for all later runs
quinvium lang en                          English
quinvium status --lang en                 for this command only
```

Order of precedence: `--lang`, the `QUINTIUM_LANG` variable, the saved choice in `~/.aether/cli.json`, the system language. `--json` output is the same in both languages. `quinvium node` and `quinvium audit` print in the same language.

## Installation

| Where | What to do |
| --- | --- |
| Quinvium app | In Settings under Command line press "Make the quinvium command available" and open a new terminal. To see what happens, run the line shown below the button instead. |
| Windows without the app | Unpack the Node and Miner package; `quintium.cmd` is next to `quintium-node.exe`. |
| From source | `node packages/cli/bin/quintium.js`, or add a link to your `PATH`. |

The tool connects to the local node of the chosen network. Another node is set with `--rpc`. Before anything is signed, the tool checks that the node really belongs to the chosen network.

The button adds the `bin` folder of the app data to the path (macOS `~/Library/Application Support/Aether/bin`, Windows `%APPDATA%\Aether\bin`): on a Mac with a line in `~/.zshrc`, on Windows in the user Path variable. The app rewrites the launcher in that folder on every start to the version currently in use. The command therefore stays current even after an update over the internet, which has its own version folder.

When the app is running, its node is running too and commands use it automatically. `quinvium node` is for a computer without the app. Next to a running node it explains how to start a second one with its own ports and folder instead of failing with a port in use.

The Windows line in Settings adds the folder only to the user path through PowerShell and works in both cmd and PowerShell. Do not use the older line `setx PATH "%PATH%;…"`: it truncates the path to 1024 characters, overwrites the user path with the system path, and PowerShell does not expand `%PATH%`.

## Searching and reading the chain

No wallet is needed for this.

```
quinvium search 7100                      block by number
quinvium search 0xHASH                    transaction or block by hash
quinvium search 0xADDRESS                 address overview
quinvium search alice.qu                  name and where it points
quinvium search TOKEN                     token by symbol
```

`search` recognises the same things as the Explorer search plus `.qu` names and token symbols. Details come from `status`, `block`, `tx`, `address`, `tokens`, `rich`, `miners` and other commands in the Node and network section.

## Wallet and sign-in

In the terminal there is no session-long sign-in as in the app. `quinvium login` shows which wallet you are working with, and `quinvium login <name>` selects another one. The password is entered for every signature and nothing stays unlocked between commands.

```
quinvium login                            which wallet you are using; without one it offers options
quinvium wallet import-app                the same wallet as in the Quinvium app, with the app password
quinvium wallet create                    new wallet, the phrase is shown once
quinvium wallet import savings            restore from a phrase, same addresses as in the app and MetaMask
quinvium wallet import-key mykey          wallet from a private key
quinvium wallet list                      list, an asterisk marks the default
quinvium wallet default savings           choose the default
quinvium wallet phrase                    show the phrase, terminal only
quinvium wallet password                  change the password
quinvium wallet remove mykey              delete from this computer
quinvium balance                          balances
quinvium send 0xADDRESS 1.5               send coins
quinvium send 0xADDRESS 10 --token TOKEN  send a token
quinvium send alice.qu 2                  send to a name
```

Wallets are encrypted files in `~/.aether/wallets`, the same format as geth. The password, phrase or key are never passed as arguments because they would stay in the shell history. They are read hidden from the keyboard. Scripts can use `--password-file`, `--phrase-file` or `--key-file`.

## Swap and liquidity

```
quinvium swap quote 10 tQU TOKEN          quote without sending
quinvium swap 10 tQU TOKEN                swap; --slippage sets the tolerance
quinvium swap pools                       pools and their reserves
quinvium liquidity add 1 tQU 20 TOKEN     deposit; the surplus stays in the wallet
quinvium liquidity list                   my shares
quinvium liquidity remove tQU TOKEN --percent 50
```

Swap is currently deployed on testnet only.

## Network apps

The same apps as on the Apps page of the Explorer. A command without a subcommand shows its help, for example `quinvium escrow`.

```
quinvium notary stamp contract.pdf --note "signed"       record a file fingerprint; the content stays with you
quinvium notary verify contract.pdf                      who recorded the fingerprint and when
quinvium notary revoke contract.pdf --reason "replaced"
quinvium credential register "University" --website https://…   issuer, once per address
quinvium credential issue DIPLOMA-1 0xHOLDER --type Bachelor [--days 365]
quinvium credential verify DIPLOMA-1 0xISSUER
quinvium supply create COFFEE-001                        item, returns its number
quinvium supply step 1 Prague shipped --evidence delivery-note.pdf
quinvium supply offer 1 0xRECIPIENT                      hand-over, the recipient confirms: supply accept 1
quinvium escrow create 0xSELLER 0xARBITER 2 --days 14    payment into escrow
quinvium escrow release 1                                the buyer releases the payment, the seller: escrow withdraw
quinvium poll create "Where to go?" Mountains Sea Home --days 7
quinvium poll vote 1 2                                   vote for the second option
quinvium name info alice                                 whether the name is free and its price
quinvium name register alice                             two signatures and about a minute of waiting
quinvium name target alice 0xADDRESS | primary | renew | transfer
quinvium token create "Loyalty points" PTS 1000          custom token with a fixed supply
quinvium nft create Tickets TIX                          collection, then: nft mint <collection> <recipient> ipfs://…
quinvium multisig create 0xA,0xB,0xC 2                   wallet with 2 of 3 signatures
quinvium multisig propose 0xWALLET 0xRECIPIENT 1.5       another owner: multisig approve, then execute
```

A file fingerprint is the SHA-256 of its content and the fingerprint of text from `--text` is keccak256, as in the Explorer. Verification in the Explorer and in the terminal therefore gives the same result. Document numbers and item labels are stored as fingerprints, so `DIPLOMA-1` in the terminal is the same document as `DIPLOMA-1` in the Explorer.

## Bridge

The bridge is not deployed on mainnet, see [BRIDGE.md](BRIDGE.md).

```
quinvium bridge routes                    routes and bridge status
quinvium bridge out 5 QU                  from Quinvium to another network
quinvium bridge in 0.1 ETH                from another network to Quinvium, signed by the same key
quinvium bridge deposit-btc               deposit address for Bitcoin
quinvium bridge status                    my transfers
```

## Mining and pools

```
quinvium mine                             mine to the default wallet
quinvium mine --intensity 60 --device 0   lower intensity, one card
quinvium mine --list                      list of cards
quinvium mine --pool 0xPOOL               mine into a pool from the network's factory
quinvium pool list                        pools
quinvium pool info 0xPOOL                 details and my earnings
quinvium pool claim 0xPOOL                withdraw earnings
quinvium pool create --name Mine --url http://server:8546 --fee-percent 1
```

The tool refuses to mine into an address that is not a pool from the network's factory.

## Node and network

```
quinvium node --network mainnet           full node
quinvium status                           network status
quinvium block 100                        block
quinvium tx 0xHASH                        transaction with method, and the reason for a failed one
quinvium address 0xADDRESS                address overview
quinvium peers | mempool | miners | rich  nodes, pending transactions, miners, rich list
quinvium tokens                           verified tokens with price, holders and transfers
quinvium token TOKEN                      token details
quinvium gas                              current fees
quinvium rpc eth_blockNumber              direct query to the node
quinvium audit                            check of the whole chain
```

## Which node you connect to

Commands read from a node: from the app on the same computer, or from another one through `--rpc`. Computers on one home network find each other automatically; the other commands then work without a node of your own, for example `quinvium status --rpc http://192.168.1.20:8546`. Signing always happens on the computer where the wallet is; the node only receives the finished transaction.

Public nodes: mainnet `--rpc https://rpc.quinvium.com`, testnet `--rpc https://rpc1.quinvium.com`. New nodes find the network through the seeds in `packages/node/src/params.js` (`seed.quinvium.com`).

## Scripts

`--json` gives machine-readable output, `--yes` skips confirmations and `--no-wait` does not wait for a block. Without `--yes` and without a terminal nothing is sent.

```
quinvium balance --json
quinvium send 0xADDRESS 1 --yes --password-file ~/.password --json
```
