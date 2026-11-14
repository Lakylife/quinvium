Quinvium: node and GPU miner for Windows

Mainnet
1. Run start-node-mainnet.bat and keep the window open. The node joins the network through seed.quinvium.com.
   If Windows asks for network access, allow it. The Explorer is then at http://127.0.0.1:8545
2. Run start-mining-mainnet.bat and enter your wallet address.

Testnet (coins without value, for trying things out)
   start-node-testnet.bat and start-mining-testnet.bat, Explorer at http://127.0.0.1:8546

Common miners (lolMiner, T-Rex, TeamRedMiner) connect over Stratum:
   Run stratum-for-miners-mainnet.bat
   lolMiner --algo ETHASH --pool NODE_ADDRESS:3333 --user YOUR_ADDRESS.rig1
   t-rex -a ethash -o stratum+tcp://NODE_ADDRESS:3333 -u YOUR_ADDRESS -w rig1 -p x
   (testnet uses port 3334)

Quinvium miner: quintium-miner.exe --list shows the cards.
Mining into a pool: quintium-miner.exe --address YOUR_ADDRESS --node http://POOL_SERVER:8545 --pool 0xPOOL_ADDRESS --worker name
Stratum miners and ASICs connect to a pool the same way as to a node, only to the pool server's address.

Command line: quinvium.cmd (or quintium.cmd) does everything the app and the Explorer can do:
   quinvium.cmd search 7100
   quinvium.cmd wallet create
   quinvium.cmd balance
   quinvium.cmd notary stamp contract.pdf
   quinvium.cmd mine
   quinvium.cmd --help
It speaks English, or Czech depending on the Windows language. Switch permanently: quinvium.cmd lang en

Help: quintium-node.exe --help and quintium-miner.exe --help

Windows may show a SmartScreen warning for programs that are not code-signed yet.
Verify downloads with the SHA256SUMS.txt published at https://quinvium.com/download/
Experimental software, provided as is, without warranty. https://quinvium.com
