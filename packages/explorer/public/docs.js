// Developer documentation. Code examples are run in the test packages/explorer/test/docs.mjs,
// the list of methods and options is compared with the node code there. Nothing here may be written "by eye".
(() => {
  const L = (cs, en) => ({ cs, en });

  // Network values are filled in according to the node the Explorer is connected to.
  const EXAMPLES = {
    startDev: { lang: 'bash', code: () => `npm install
node packages/node/src/cli.js --network dev --dev-mine --miner-address 0xYOUR_ADDRESS` },

    newKey: { lang: 'js', run: true, code: () => `import { ethers } from 'ethers';

const wallet = ethers.Wallet.createRandom();
console.log('address', wallet.address);
console.log('private key', wallet.privateKey);` },

    blockNumber: { lang: 'bash', run: true, code: (n) => `curl -s -X POST ${n.rpc} -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'` },

    stats: { lang: 'bash', run: true, code: (n) => `curl -s -X POST ${n.rpc} -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"quinvium_stats","params":[]}'` },

    restBalance: { lang: 'bash', run: true, code: (n) => `curl -s "${n.rpc}/api?module=account&action=balance&address=0xYOUR_ADDRESS&tag=latest"` },

    restTxlist: { lang: 'bash', run: true, code: (n) => `curl -s "${n.rpc}/api?module=account&action=txlist&address=0xYOUR_ADDRESS&page=1&offset=10&sort=desc"` },

    restJs: { lang: 'js', run: true, code: (n) => `const api = '${n.rpc}/api';

const query = new URLSearchParams({ module: 'account', action: 'txlist', address: '0xYOUR_ADDRESS', page: '1', offset: '25', sort: 'desc' });
const { status, message, result } = await (await fetch(\`\${api}?\${query}\`)).json();
console.log(status, message, Array.isArray(result) ? result.length : result);` },

    addNetwork: { lang: 'js', code: (n) => `await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '${n.chainHex}',
    chainName: 'Quinvium ${n.network}',
    rpcUrls: ['${n.rpc}'],
    nativeCurrency: { name: 'Quinvium', symbol: '${n.coin}', decimals: 18 },
    blockExplorerUrls: ['${n.rpc}'],
  }],
});` },

    connectBrowser: { lang: 'js', code: () => `import { BrowserProvider } from 'ethers';

const injected = window.quinvium ?? window.ethereum;
const provider = new BrowserProvider(injected);
const signer = await provider.getSigner();
console.log(await signer.getAddress());` },

    read: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const height = await provider.getBlockNumber();
const balance = await provider.getBalance('0xYOUR_ADDRESS');
console.log(height, ethers.formatEther(balance), '${n.coin}');` },

    send: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const wallet = new ethers.Wallet(process.env.QUINVIUM_KEY, provider);

const tx = await wallet.sendTransaction({ to: '0xRECIPIENT', value: ethers.parseEther('0.1') });
const receipt = await tx.wait();
console.log('block', receipt.blockNumber, 'fee', ethers.formatEther(receipt.fee));` },

    deploy: { lang: 'js', run: true, code: (n) => `import solc from 'solc';
import { ethers } from 'ethers';

const source = \`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract Counter {
  uint256 public value;
  event Increased(uint256 value);
  function increase() external { value += 1; emit Increased(value); }
}\`;

const input = {
  language: 'Solidity',
  sources: { 'Counter.sol': { content: source } },
  settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const { abi, evm } = JSON.parse(solc.compile(JSON.stringify(input))).contracts['Counter.sol'].Counter;

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const wallet = new ethers.Wallet(process.env.QUINVIUM_KEY, provider);

const counter = await new ethers.ContractFactory(abi, evm.bytecode.object, wallet).deploy();
await counter.waitForDeployment();
await (await counter.increase()).wait();
console.log(await counter.getAddress(), await counter.value());` },

    hardhat: { lang: 'js', file: 'hardhat.config.cjs', code: (n) => `require('@nomicfoundation/hardhat-ethers');

module.exports = {
  solidity: { version: '0.8.28', settings: { evmVersion: 'cancun' } },
  networks: {
    quinvium: { url: '${n.rpc}', chainId: ${n.chainId}, accounts: [process.env.QUINVIUM_KEY] },
  },
};` },

    notary: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const wallet = new ethers.Wallet(process.env.QUINVIUM_KEY, provider);
const notary = new ethers.Contract('${n.address.Notary}', [
  'function notarize(bytes32 hash, string note)',
  'function verify(bytes32 hash, address author) view returns (bool exists, uint64 timestamp, uint64 revokedAt, string note)',
], wallet);

const hash = ethers.keccak256(ethers.toUtf8Bytes('document content ' + Date.now()));
await (await notary.notarize(hash, 'Purchase agreement')).wait();
console.log(await notary.verify(hash, wallet.address));` },

    names: { lang: 'js', run: true, slow: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const wallet = new ethers.Wallet(process.env.QUINVIUM_KEY, provider);
const names = new ethers.Contract('${n.address.AetherNames}', [
  'function commitment(string name, address owner, address target, bytes32 secret) pure returns (bytes32)',
  'function commit(bytes32 hash)',
  'function pricePerYear(string name) pure returns (uint256)',
  'function register(string name, uint256 yearsCount, address target, bytes32 secret) payable',
  'function resolve(string name) view returns (address)',
], wallet);

const name = 'my-company';
const secret = ethers.hexlify(ethers.randomBytes(32));
const hash = await names.commitment(name, wallet.address, wallet.address, secret);
await (await names.commit(hash)).wait();
await new Promise((done) => setTimeout(done, 65_000));

const value = await names.pricePerYear(name);
await (await names.register(name, 1, wallet.address, secret, { value })).wait();
console.log(await names.resolve(name));` },

    credentials: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const wallet = new ethers.Wallet(process.env.QUINVIUM_KEY, provider);
const credentials = new ethers.Contract('${n.address.Credentials}', [
  'function registerIssuer(string name, string website)',
  'function issue(bytes32 id, address subject, bytes32 schema, uint64 expiresAt)',
  'function isValid(address issuer, bytes32 id) view returns (bool)',
], wallet);

const id = ethers.keccak256(ethers.toUtf8Bytes('diploma ' + Date.now()));
await (await credentials.registerIssuer('My School', 'school.example')).wait();
await (await credentials.issue(id, wallet.address, ethers.id('diploma'), 0)).wait();
console.log(await credentials.isValid(wallet.address, id));` },

    multicall: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const multicall = new ethers.Contract('${n.address.Multicall}', [
  'function balances(address[] accounts) view returns (uint256[])',
], provider);

console.log(await multicall.balances(['0xYOUR_ADDRESS', '${n.address.WAET}']));` },

    logs: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const notary = new ethers.Contract('${n.address.Notary}', [
  'event Notarized(bytes32 indexed hash, address indexed author, string note)',
], provider);

const latest = await provider.getBlockNumber();
const events = await notary.queryFilter('Notarized', Math.max(0, latest - 5000), latest);
for (const e of events) console.log(e.blockNumber, e.args.author, e.args.note);` },

    wsEthers: { lang: 'js', run: true, stream: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.WebSocketProvider('${n.ws}');
provider.on('block', (number) => console.log('new block', number));` },

    wsRaw: { lang: 'js', run: true, stream: true, code: (n) => `const ws = new WebSocket('${n.ws}');

ws.onopen = () => ws.send(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'],
}));
ws.onmessage = (e) => console.log(e.data);` },

    getwork: { lang: 'bash', run: true, code: (n) => `curl -s -X POST ${n.rpc} -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"quinvium_getWork","params":["0xYOUR_ADDRESS"]}'` },

    fees: { lang: 'bash', run: true, code: (n) => `curl -s -X POST ${n.rpc} -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"quinvium_feeEstimates","params":[]}'` },

    customFee: { lang: 'js', run: true, code: (n) => `import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('${n.rpc}');
const wallet = new ethers.Wallet(process.env.QUINVIUM_KEY, provider);

const { tiers } = await provider.send('quinvium_feeEstimates', []);
const tx = await wallet.sendTransaction({
  to: '0xRECIPIENT',
  value: ethers.parseEther('0.1'),
  maxPriorityFeePerGas: tiers.fast.tip,
  maxFeePerGas: tiers.fast.maxFee,
});
const receipt = await tx.wait();
console.log('block', receipt.blockNumber, 'fee', ethers.formatEther(receipt.fee));` },

    runNode: { lang: 'bash', code: () => `node packages/node/src/cli.js --network testnet --rpc-port 8546 --rate-limit 600` },
  };

  const RPC_GROUPS = [
    { title: L('Stav a účty', 'State and accounts'), rows: [
      ['eth_chainId', '[]', L('Chain ID sítě', 'Chain ID')],
      ['eth_blockNumber', '[]', L('Výška řetězce', 'Chain height')],
      ['eth_syncing', '[]', L('`false`, nebo průběh synchronizace', '`false` or sync progress')],
      ['eth_getBalance', '[address, block]', L('Zůstatek ve wei', 'Balance in wei')],
      ['eth_getTransactionCount', '[address, block]', L('Nonce, s `pending` včetně čekajících transakcí', 'Nonce, with `pending` including queued transactions')],
      ['eth_getCode', '[address, block]', L('Kód kontraktu', 'Contract code')],
      ['eth_getStorageAt', '[address, slot, block]', L('Hodnota v úložišti kontraktu', 'Contract storage value')],
      ['eth_getProof', '[address, slots, block]', L('Merkle důkaz účtu a úložiště, nejvýše 1024 položek', 'Merkle proof, up to 1024 slots')],
      ['eth_accounts', '[]', L('Vždy prázdné, uzel nedrží klíče', 'Always empty, the node holds no keys')],
      ['eth_requestAccounts', '[]', L('Vždy prázdné, účty spravuje peněženka', 'Always empty, wallets manage accounts')],
      ['eth_coinbase', '[]', L('Adresa z `--miner-address`', 'Address from `--miner-address`')],
    ] },
    { title: L('Bloky', 'Blocks'), rows: [
      ['eth_getBlockByNumber', '[block, fullTxs]', L('Blok podle čísla nebo značky', 'Block by number or tag')],
      ['eth_getBlockByHash', '[hash, fullTxs]', L('Blok podle hashe', 'Block by hash')],
      ['eth_getBlockTransactionCountByHash', '[hash]', L('Počet transakcí', 'Transaction count')],
      ['eth_getBlockTransactionCountByNumber', '[block]', L('Počet transakcí', 'Transaction count')],
      ['eth_getBlockReceipts', '[block]', L('Všechny účtenky bloku', 'All receipts of a block')],
      ['eth_getUncleCountByBlockHash', '[hash]', L('Vždy 0, síť nemá strýčkovské bloky', 'Always 0, the network has no uncles')],
      ['eth_getUncleCountByBlockNumber', '[block]', L('Vždy 0', 'Always 0')],
    ] },
    { title: L('Transakce a volání', 'Transactions and calls'), rows: [
      ['eth_sendRawTransaction', '[signedTx]', L('Odešle podepsanou transakci, vrací hash', 'Sends a signed transaction, returns its hash')],
      ['eth_getTransactionByHash', '[hash]', L('Transakce včetně čekajících', 'Transaction, including pending ones')],
      ['eth_getTransactionByBlockHashAndIndex', '[hash, index]', L('Transakce podle pozice', 'Transaction by position')],
      ['eth_getTransactionByBlockNumberAndIndex', '[block, index]', L('Transakce podle pozice', 'Transaction by position')],
      ['eth_getTransactionReceipt', '[hash]', L('Účtenka, `null` dokud není potvrzená', 'Receipt, `null` until confirmed')],
      ['eth_call', '[call, block]', L('Volání bez zápisu, limit 5 s a 50 M gasu', 'Read-only call, 5 s and 50 M gas limit')],
      ['eth_estimateGas', '[call, block]', L('Odhad gasu', 'Gas estimate')],
      ['eth_createAccessList', '[]', L('Není podporováno', 'Not supported')],
    ] },
    { title: L('Poplatky', 'Fees'), rows: [
      ['quinvium_feeEstimates', '[]', L('Doporučení pro pomalu, běžně a rychle podle posledních 20 bloků', 'Slow, normal and fast suggestions from the last 20 blocks')],
      ['eth_gasPrice', '[]', L('Základní poplatek dalšího bloku a běžné dýško', 'Next base fee plus the normal tip')],
      ['eth_maxPriorityFeePerGas', '[]', L('Běžné dýško podle posledních bloků', 'Normal tip from recent blocks')],
      ['eth_feeHistory', '[count, newest, percentiles]', L('Historie poplatků, nejvýše 1024 bloků', 'Fee history, up to 1024 blocks')],
    ] },
    { title: L('Logy a filtry', 'Logs and filters'), rows: [
      ['eth_getLogs', '[filter]', L('Logy, nejvýše 10 000 bloků a 10 000 výsledků', 'Logs, up to 10,000 blocks and results')],
      ['eth_newFilter', '[filter]', L('Filtr logů, platí 5 minut od posledního čtení', 'Log filter, valid 5 minutes since last read')],
      ['eth_newBlockFilter', '[]', L('Filtr nových bloků', 'New block filter')],
      ['eth_newPendingTransactionFilter', '[]', L('Filtr čekajících transakcí', 'Pending transaction filter')],
      ['eth_getFilterChanges', '[id]', L('Novinky od posledního čtení', 'Changes since last read')],
      ['eth_getFilterLogs', '[id]', L('Všechny logy filtru', 'All logs of a filter')],
      ['eth_uninstallFilter', '[id]', L('Zruší filtr', 'Removes a filter')],
    ] },
    { title: L('Těžba', 'Mining'), rows: [
      ['quinvium_getWork', '[address]', L('Práce pro adresu výplaty: `[sealHash, seedHash, target, number]`', 'Work for a payout address: `[sealHash, seedHash, target, number]`')],
      ['quinvium_submitWork', '[nonce, sealHash, mixDigest]', L('Řešení, vrací `{accepted, stale, reason, hash, number}`', 'Solution, returns `{accepted, stale, reason, hash, number}`')],
      ['eth_getWork', '[]', L('Práce pro `--miner-address`', 'Work for `--miner-address`')],
      ['eth_submitWork', '[nonce, sealHash, mixDigest]', L('Řešení, vrací `true` nebo `false`', 'Solution, returns `true` or `false`')],
      ['eth_submitHashrate', '[rate, id]', L('Hlášení výkonu minera', 'Reports miner hashrate')],
      ['eth_hashrate', '[]', L('Součet hlášeného výkonu za 2 minuty', 'Reported hashrate over 2 minutes')],
      ['eth_mining', '[]', L('Hlásí někdo výkon', 'Whether any miner reports hashrate')],
    ] },
    { title: L('Pool', 'Pool'), rows: [
      ['quinvium_poolInfo', '[{miner, limit, offset}]', L('Stav serveru poolu na tomto uzlu, jinak `null`. Připojená zařízení (`devices`) jdou po stránkách, `deviceCount` je jejich počet a `miner` je zúží na jednoho těžaře', 'Pool server state on this node, otherwise `null`. Connected devices (`devices`) come in pages, `deviceCount` is their number and `miner` narrows them to one miner')],
      ['quinvium_poolWork', '[address, worker]', L('Práce pro zařízení: `[sealHash, seedHash, target, number, sealFields, pool]`. `target` je cíl podílu, `sealFields` je RLP hlavičky, ze kterého si těžař ověří, co hashuje', 'Work for a device: `[sealHash, seedHash, target, number, sealFields, pool]`. `target` is the share target, `sealFields` is the header RLP so the miner can check what it hashes')],
      ['quinvium_poolSubmit', '[nonce, sealHash, mixDigest]', L('Podíl, vrací `{accepted, stale, reason, block}`', 'Share, returns `{accepted, stale, reason, block}`')],
    ] },
    { title: L('Rozšíření Quinvium', 'Quinvium extensions'), rows: [
      ['quinvium_stats', '[]', L('Výška, obtížnost, výkon, emise, poplatky těžařům, frontu a uzly', 'Height, difficulty, hashrate, supply, miner fees, mempool and peers')],
      ['quinvium_blocks', '[{miner, minTxs, onlyEmpty, fromTime, toTime, fromBlock, toBlock, order, limit, offset}]', L('Bloky s filtry, vrací `{total, capped, items}`. Počítá se do 100 000, `capped` znamená víc', 'Filtered blocks, returns `{total, capped, items}`. Counting stops at 100,000, `capped` means more')],
      ['quinvium_txs', '[{address, direction, kind, status, fromTime, toTime, fromBlock, toBlock, minValue, order, limit, offset}]', L('Transakce s filtry, vrací `{total, capped, items}`. Počítá se do 100 000, `capped` znamená víc', 'Filtered transactions, returns `{total, capped, items}`. Counting stops at 100,000, `capped` means more')],
      ['quinvium_addressInfo', '[address]', L('Zůstatek, souhrn transakcí, vytěžené bloky, tokeny a počet výplat z poolů', 'Balance, transaction summary, mined blocks, tokens and pool payout count')],
      ['quinvium_poolPayouts', '[address, limit, offset]', L('Výplaty z poolů na adresu. Jsou to vnitřní převody kontraktu, `eth_getBlockByNumber` je neukáže', 'Pool payouts to an address. They are internal contract transfers, so `eth_getBlockByNumber` does not list them')],
      ['quinvium_poolMiners', '[pool, fromBlock, {limit, offset, miner}]', L('Těžaři poolu od daného bloku podle přijatých podílů po stránkách, nejvíc podílů první: počet podílů a poslední blok, `total` je počet všech. S `miner` přijde v `match` i jeho pořadí. Bez bloku den zpátky', 'Miners of a pool since a block by accepted shares, in pages, most shares first: share count and last block, `total` counts them all. With `miner`, `match` also gives that miner’s rank. Without a block, one day back')],
      ['quinvium_pools', '[{limit, offset, query, seconds}]', L('Žebříček poolů z továrny podle podílu na blocích za období (výchozí 24 h), po stránkách a s hledáním podle jména nebo adresy. U každého poplatek, bloky, podíl, odhad výkonu, počet těžařů v okně a adresa serveru', 'Ranking of factory pools by share of blocks over a period (24 h by default), in pages and searchable by name or address. Each has its fee, blocks, share, hashrate estimate, miners in the window and server address')],
      ['quinvium_txError', '[hash]', L('Proč transakce v bloku selhala: uzel přehraje blok až po ni a vrátí chybu EVM (`error`), data revertu (`data`, z nich se pozná chyba kontraktu), spotřebovaný gas a limit. U úspěšné transakce `null`', 'Why a transaction failed in its block: the node replays the block up to it and returns the EVM error (`error`), the revert data (`data`, which tells the contract error), the gas used and the limit. `null` for a successful transaction')],
      ['quinvium_minedByDay', '[address, {days, tz}]', L('Vytěžené bloky adresy po dnech za posledních `days` dní: počet bloků a příjem, tedy odměna a poplatky. `tz` je posun časového pásma v sekundách', 'Blocks mined by an address per day over the last `days` days: block count and income, that is reward and fees. `tz` is the time zone offset in seconds')],
      ['quinvium_poolVersion', '[address]', L('Zda je adresa pool z důvěryhodné továrny: 0 ne, 1 vestavěná továrna, 2 továrna verze 2 (gas serveru platí z odměn)', 'Whether the address is a pool from a trusted factory: 0 no, 1 the built-in factory, 2 a version 2 factory (it pays its server gas from rewards)')],
      ['quinvium_poolsOf', '[address]', L('Pooly, které adresa založila a provozuje, podle události továrny poolů', 'Pools that the address created and operates, from the pool factory event')],
      ['quinvium_tokenInfo', '[token]', L('Počet převodů a držitelů tokenu a největší držitelé', 'Transfer and holder counts of a token and its largest holders')],
      ['quinvium_addressTransfers', '[address, limit, offset]', L('Převody tokenů adresy v obou směrech, i z cizích transakcí. U NFT vrací `tokenId` místo `value`', 'Token transfers of an address in both directions, including those from other people’s transactions. For NFTs it returns `tokenId` instead of `value`')],
      ['quinvium_tokenTransfers', '[token, limit, offset]', L('Převody tokenu s částkami, vrací `{total, items}`', 'Token transfers with amounts, returns `{total, items}`')],
      ['quinvium_minerShares', '[{from, to}]', L('Podíl těžařů a poolů na blocích a práci za období', 'Share of blocks and work per miner and pool over a period')],
      ['quinvium_contractLogs', '[address, topic, limit, offset]', L('Události jednoho druhu z kontraktu, nejnovější první', 'Events of one kind from a contract, newest first')],
      ['quinvium_poolSeries', '[pool, {from, to, points, bucket}]', L('Historie poolu po úsecích: vytěžené bloky a příjem, podíl na síti, odhad výkonu, přijaté podíly, aktivní těžaři a výplaty těžařům (počet a částka)', 'Pool history in buckets: blocks mined and income, share of the network, estimated hashrate, accepted shares, active miners and payouts to miners (count and amount)')],
      ['quinvium_chartSeries', '[{from, to, points, bucket}]', L('Historie sítě po úsecích: čas bloku, obtížnost, odhad výkonu, transakce, gas, aktivní adresy, poplatky, převody tokenů, nové kontrakty a neúspěšné transakce. `bucket` je pevná délka úseku v sekundách', 'Network history in buckets: block time, difficulty, estimated hashrate, transactions, gas, active addresses, fees, token transfers, new contracts and failed transactions. `bucket` is a fixed bucket length in seconds')],
      ['quinvium_blockIncome', '[block]', L('Příjem těžaře z bloku: `{miner, reward, baseFees, tips, total}`', 'Miner income from a block: `{miner, reward, baseFees, tips, total}`')],
      ['quinvium_recentBlocks', '[limit, offset]', L('Přehled bloků, nejvýše 100', 'Block summaries, up to 100')],
      ['quinvium_recentTxs', '[limit]', L('Poslední transakce, nejvýše 100', 'Latest transactions, up to 100')],
      ['quinvium_pendingTxs', '[]', L('Čekající transakce, nejvýše 200', 'Pending transactions, up to 200')],
      ['quinvium_mempool', '[{order, address, limit, offset}]', L('Fronta po stránkách se souhrnem: počet, velikost a dýška. U každé transakce `waitingFor` (chybějící nonce) a `underpriced`, tedy proč nejde do dalšího bloku', 'Paged mempool with a summary: count, size and tips. Each transaction has `waitingFor` (missing nonce) and `underpriced`, saying why it cannot enter the next block')],
      ['quinvium_addressTxs', '[address, limit, offset]', L('Historie adresy, `{total, items}`', 'Address history, `{total, items}`')],
      ['quinvium_richList', '[limit]', L('Žebříček zůstatků, nejvýše 500', 'Rich list, up to 500')],
      ['quinvium_miners', '[window]', L('Těžaři za posledních N bloků, nejvýše 2000', 'Miners over the last N blocks, up to 2000')],
      ['quinvium_minerList', '[{order, address, limit, offset}]', L('Všichni těžaři za celou historii po stránkách, řazení `blocks` nebo `last`. S `address` vrátí i pořadí jednoho těžaře', 'All miners over the whole history, paged, ordered by `blocks` or `last`. With `address` it also returns the rank of one miner')],
      ['quinvium_activity', '[]', L('Provoz za 24 hodin: transakce, poplatky, aktivní adresy, vytížení sítě, bloky poolů, čekající za hodinu, bezpečný a nevratný blok', 'Activity over 24 hours: transactions, fees, active addresses, network utilization, blocks by pools, pending in the last hour, safe and finalized block')],
      ['quinvium_charts', '[window]', L('Data pro grafy, nejvýše 1000 bloků', 'Chart data, up to 1000 blocks')],
      ['quinvium_peers', '[]', L('Připojené uzly', 'Connected peers')],
      ['quinvium_signals', '[{blocks}]', L('Signalizace forků: kolik bloků za posledních N (výchozí asi den) nese `QIP-n`. Jen informace, nic se tím nezapíná', 'Fork signalling: how many of the last N blocks (about a day by default) carry `QIP-n`. Informative only; nothing activates from it')],
      ['quinvium_watch', '[]', L('Hlídání: mají uzly na usazené výšce stejný blok, hluboké přepisy, shoduje se web a Explorer s GitHubem. Uzly jsou jen podle klíče, bez IP adres', 'Watch: do peers have the same block at a settled height, deep reorganisations, do the website and Explorer match GitHub. Peers by key only, no IP addresses')],
      ['quinvium_nodeInfo', '[]', L('Identita uzlu: veřejný klíč a záznam seedu `klíč@HOST:port`', 'Node identity: public key and seed entry `key@HOST:port`')],
      ['quinvium_publicNodes', '[]', L('Ověřené veřejné uzly komunity (adresa, ID uzlu, výška), které sdílejí svůj uzel přes tunel', 'Verified public community nodes (URL, node ID, height) that share their node through a tunnel')],
      ['quinvium_setPublicUrl', '[url]', L('Ohlásí veřejnou adresu tohoto uzlu ostatním, nebo ji s `null` zruší. Jen z tohoto počítače', 'Announces the public URL of this node to the others, or withdraws it with `null`. Only from this computer')],
      ['quinvium_endpoints', '[]', L('Adresy RPC uzlu pro tento počítač, místní síť a internet. Volající z internetu vidí jen veřejnou adresu', 'The node’s RPC addresses for this computer, the local network and the internet. Callers from the internet see only the public address')],
      ['quinvium_suggest', '[query, {type, limit}]', L('Návrhy při psaní do hledání: blok podle čísla, blok nebo transakce podle hashe a známé adresy podle začátku. `type` je `blocks`, `txs` nebo `addresses`', 'Suggestions while typing a search: a block by number, a block or transaction by hash and known addresses by their first digits. `type` is `blocks`, `txs` or `addresses`')],
      ['quinvium_search', '[query]', L('Hledání bloku, transakce nebo adresy', 'Searches blocks, transactions and addresses')],
    ] },
    { title: L('Ostatní', 'Other'), rows: [
      ['web3_clientVersion', '[]', L('Verze uzlu', 'Node version')],
      ['web3_sha3', '[hexData]', L('Keccak-256', 'Keccak-256')],
      ['net_version', '[]', L('Chain ID jako text', 'Chain ID as text')],
      ['net_listening', '[]', L('Vždy `true`', 'Always `true`')],
      ['net_peerCount', '[]', L('Počet uzlů', 'Peer count')],
      ['eth_protocolVersion', '[]', L('Verze protokolu', 'Protocol version')],
    ] },
    { title: L('Jen přes WebSocket', 'WebSocket only'), rows: [
      ['eth_subscribe', '[kind, filter]', L('Odběr `newHeads`, `logs` nebo `newPendingTransactions`', 'Subscribes to `newHeads`, `logs` or `newPendingTransactions`')],
      ['eth_unsubscribe', '[id]', L('Zruší odběr', 'Cancels a subscription')],
    ] },
  ];

  const CLI_OPTIONS = [
    ['--network', L('Síť: `mainnet`, `testnet` nebo `dev`, výchozí mainnet', 'Network: `mainnet`, `testnet` or `dev`, default mainnet')],
    ['--data-dir', L('Složka dat, výchozí `~/.aether/<síť>`', 'Data folder, default `~/.aether/<network>`')],
    ['--seeds', L('Další uzly pro první kontakt, `host:port,host:port`', 'Extra bootstrap nodes, `host:port,host:port`')],
    ['--p2p-port', L('Port sítě', 'P2P port')],
    ['--rpc-port', L('Port JSON-RPC a exploreru', 'JSON-RPC and explorer port')],
    ['--rpc-host', L('Adresa RPC, výchozí `127.0.0.1`', 'RPC bind address, default `127.0.0.1`')],
    ['--rate-limit', L('Požadavků RPC za minutu na IP, dávka se počítá po položkách', 'RPC requests per minute per IP, batches count per item')],
    ['--no-site-check', L('Nekontroluje web a Explorer sítě proti GitHubu (jinak jednou za 6 hodin)', 'Does not check the network’s website and Explorer against GitHub (otherwise every 6 hours)')],
    ['--no-mining-rpc', L('Vypne `eth_getWork`, `eth_submitWork` a `eth_submitHashrate`, pro veřejné uzly', 'Disables `eth_getWork`, `eth_submitWork` and `eth_submitHashrate`, for public nodes')],
    ['--trust-proxy', L('Číst IP klienta z `X-Forwarded-For`, jen za vlastní proxy', 'Read client IP from `X-Forwarded-For`, only behind your own proxy')],
    ['--tunnel-port', L('Port jen pro tento počítač, na který vede tunel (Sdílet uzel veřejně). Vše na něm se bere jako cizí, limit podle `Cf-Connecting-IP`', 'A local-only port that a tunnel leads to (Share node publicly). Everything on it counts as foreign, limited per `Cf-Connecting-IP`')],
    ['--exit-with-parent', L('Uzel skončí, když se zavře jeho standardní vstup. Aplikace Quinvium tak po pádu nenechá běžet uzel, který drží porty', 'The node stops when its standard input closes. This way the Quinvium app does not leave a node running and holding the ports after a crash')],
    ['--upnp', L('Otevře v routeru přes UPnP jen port pro spojení mezi uzly, aby se k uzlu mohly připojit ostatní. RPC, Explorer a Stratum zůstávají zavřené', 'Opens only the port for connections between nodes in the router (UPnP), so other nodes can connect to this one. RPC, the Explorer and Stratum stay closed')],
    ['--stratum-port', L('Port pro minery', 'Miner port')],
    ['--stratum-host', L('Adresa Stratum, `0.0.0.0` pro minery v síti', 'Stratum bind address, `0.0.0.0` for networked miners')],
    ['--stratum-sessions', L('Kolik zařízení obslouží Stratum, výchozí 1024. Změřeno 10 000', 'How many devices Stratum serves, default 1024. Measured at 10,000')],
    ['--stratum-sessions-per-ip', L('Kolik zařízení smí z jedné adresy, výchozí 128. Farma za jednou adresou potřebuje víc', 'Devices allowed per address, default 128. A farm behind one address needs more')],
    ['--miner-address', L('Adresa výplaty pro `eth_getWork`', 'Payout address for `eth_getWork`')],
    ['--explorer', L('Složka se statickým explorerem', 'Static explorer folder')],
    ['--dev-mine', L('Vestavěný procesorový miner, jen síť dev', 'Built-in CPU miner, dev network only')],
    ['--allow-private', L('Povolit uzly v lokální síti', 'Allow peers on private networks')],
    ['--public', L('Přístup z internetu: otevře porty v routeru (UPnP) a zjistí veřejnou adresu', 'Access from the internet: opens ports in the router (UPnP) and finds the public address')],
    ['--public-host', L('Veřejná adresa nebo doména uzlu, když ji chcete zadat ručně', 'Public address or domain of the node, to set it by hand')],
    ['--lan', L('Najít uzly v místní síti automaticky', 'Find nodes on the local network automatically')],
    ['--lan-port', L('Port hledání v místní síti, jen pro oddělené testy', 'Local discovery port, for isolated tests only')],
    ['--extra', L('Značka v bloku, nejvýše 32 bajtů', 'Block tag, at most 32 bytes')],
    ['--pool', L('Provozovat pool: adresa kontraktu z továrny', 'Run a pool: contract address from the factory')],
    ['--pool-key-file', L('Klíč účtu, který platí gas za podíly, vznikne sám', 'Key of the account paying gas for shares, created on first run')],
    ['--verbose', L('Podrobný výpis sítě', 'Verbose network logging')],
    ['--help', L('Nápověda', 'Help')],
  ];

  const CONTRACT_INFO = {
    Notary: L('Důkaz existence dokumentu. Každá adresa má vlastní záznam, proto cizí zápis nejde zablokovat.', 'Proof that a document existed. Each address has its own record, so nobody can block yours.'),
    AetherNames: L('Jména místo adres. Registrace má dva kroky, aby ji nešlo předběhnout. Poplatek se pálí.', 'Names instead of addresses. Registration has two steps to prevent front-running. The fee is burned.'),
    Credentials: L('Certifikáty a diplomy. Vždy ověřujte podle adresy vydavatele, jméno si uvádí každý sám.', 'Credentials and diplomas. Always verify by issuer address, anyone can claim a name.'),
    SupplyChain: L('Cesta zboží. Předání potvrzují obě strany.', 'Goods tracking. Both parties confirm each transfer.'),
    Escrow: L('Úschova plateb s rozhodcem. Bez rozhodnutí do 90 dnů se strany dělí napůl.', 'Payment escrow with an arbiter. Without a ruling in 90 days the parties split the funds.'),
    Polls: L('Hlasování s volitelným seznamem oprávněných v Merkle stromu. Hlasy jsou veřejné.', 'Voting with an optional Merkle voter list. Votes are public.'),
    TokenFactory: L('Vytvoří token ERC-20.', 'Creates an ERC-20 token.'),
    CollectionFactory: L('Vytvoří sbírku ERC-721.', 'Creates an ERC-721 collection.'),
    MultisigFactory: L('Vytvoří peněženku s více podpisy.', 'Creates a multisig wallet.'),
    Multisig: L('Peněženka s více podpisy. Majitele lze měnit schváleným návrhem na vlastní adresu.', 'Multisig wallet. Owners change through an approved proposal to its own address.'),
    AetherToken: L('Token vytvořený továrnou.', 'Token made by the factory.'),
    AetherCollection: L('Sbírka vytvořená továrnou.', 'Collection made by the factory.'),
    WAET: L('Zabalený QU jako ERC-20.', 'Wrapped QU as ERC-20.'),
    Multicall: L('Hromadné čtení z kontraktů a zůstatků.', 'Batched contract and balance reads.'),
    PoolFactory: L('Založí těžební pool. Pooly z továrny mají ověřený kód, aplikace nabízí jen je.', 'Creates a mining pool. Factory pools have verified code, the apps only offer those.'),
    AetherPool: L('Pool, který neumí okrást těžaře: práci ověřuje síť, odměny drží kontrakt a dělí je PPLNS. Provozovatel dostane jen svůj poplatek.', 'A pool that cannot rob its miners: the network verifies the work, the contract holds the rewards and splits them with PPLNS. The operator only gets the fee.'),
  };

  const SECTIONS = [
    { id: 'start', title: L('Začínáme', 'Quick start'), blocks: [
      { p: L('Quinvium je kompatibilní s nástroji pro Ethereum. Co funguje s Ethereem přes JSON-RPC, obvykle funguje i tady, stačí změnit adresu uzlu a chain ID.', 'Quinvium works with Ethereum tooling. What talks to Ethereum over JSON-RPC usually works here too, just change the node URL and chain ID.') },
      { note: L('Veřejný RPC server zatím neexistuje. Pro vývoj spusťte vlastní uzel, stojí to minutu.', 'There is no public RPC server yet. Run your own node for development, it takes a minute.') },
      { h: L('1. Klíč pro vývoj', '1. A development key') },
      { p: L('Vytvořte si klíč jen pro vývoj. Potřebujete balíček `ethers`. Klíč dejte do proměnné `QUINVIUM_KEY`.', 'Create a key for development only. You need the `ethers` package. Put the key into the `QUINVIUM_KEY` variable.') },
      { code: 'newKey' },
      { h: L('2. Vývojová síť', '2. Development network') },
      { p: L('Potřebujete Node.js 24. Ve složce projektu spusťte uzel s automatickou těžbou a odměny posílejte na svou adresu. RPC poběží na portu 8547 a první mince dorazí během pár sekund.', 'You need Node.js 24. In the project folder start a node with automatic mining and send rewards to your address. RPC runs on port 8547 and the first coins arrive within seconds.') },
      { code: 'startDev' },
      { h: L('3. První dotaz', '3. First request') },
      { code: 'blockNumber' },
    ] },

    { id: 'rest', title: L('REST API', 'REST API'), blocks: [
      { p: L('Kompletní data z řetězce přes jednoduché adresy GET: zůstatky, transakce, převody tokenů, vytěžené bloky, odměny, logy a poplatky. Dotazy mají běžný tvar modul a akce, který znají peněženky, daňové nástroje a skripty pro prohlížeče bloků; stačí jim adresa níže. API je jen pro čtení, zdarma a bez klíče.', 'Complete on-chain data through plain GET URLs: balances, transactions, token transfers, mined blocks, rewards, logs and fees. Queries use the common module and action format that wallets, tax tools and block-explorer scripts already speak; they only need the address below. The API is read-only, free and needs no key.') },
      { p: L('Adresa: `/api?module=…&action=…` na uzlu, třeba `https://rpc.quinvium.com/api`. Odpověď je `{"status":"1","message":"OK","result":…}`, chyba má `status` `0`. Stránka má nejvýše 100 řádků (`offset`), další se čtou přes `page`. Platí limit počtu požadavků jako u JSON-RPC, seznamy počítají za pět.', 'Endpoint: `/api?module=…&action=…` on a node, for example `https://rpc.quinvium.com/api`. An answer is `{"status":"1","message":"OK","result":…}`; an error has `status` `0`. A page holds up to 100 rows (`offset`); read more with `page`. The same rate limit as JSON-RPC applies; lists count as five requests.') },
      { code: 'restBalance' },
      { code: 'restTxlist' },
      { code: 'restJs' },
      { h: L('Moduly a akce', 'Modules and actions') },
      { table: { head: [L('Modul', 'Module'), L('Akce', 'Action'), L('Parametry', 'Parameters'), L('Vrací', 'Returns')], rows: [
        ['`account`', '`balance`', '`address`, `tag`', L('Zůstatek ve wei', 'Balance in wei')],
        ['`account`', '`balancemulti`', L('`address` až 20 oddělených čárkou', '`address` up to 20, comma separated'), L('Zůstatky adres', 'Balances')],
        ['`account`', '`txlist`', '`address`, `startblock`, `endblock`, `page`, `offset`, `sort`', L('Transakce adresy', 'Transactions of an address')],
        ['`account`', '`tokentx`', '`address` nebo/or `contractaddress`, `page`, `offset`, `sort`', L('Převody tokenů s názvem, symbolem a desetinnými místy', 'Token transfers with name, symbol and decimals')],
        ['`account`', '`tokenbalance`', '`contractaddress`, `address`, `tag`', L('Zůstatek tokenu', 'Token balance')],
        ['`account`', '`getminedblocks`', '`address`, `page`, `offset`', L('Bloky vytěžené adresou a odměna za každý', 'Blocks mined by the address and the reward for each')],
        ['`transaction`', '`getstatus`, `gettxreceiptstatus`', '`txhash`', L('Stav a důvod selhání', 'Status and revert reason')],
        ['`block`', '`getblockreward`', '`blockno`', L('Těžař a celá odměna včetně poplatků', 'Miner and the full reward including fees')],
        ['`block`', '`getblocknobytime`', '`timestamp`, `closest` (`before` / `after`)', L('Číslo bloku k času', 'Block number at a time')],
        ['`block`', '`getblockcountdown`', '`blockno`', L('Kolik bloků a sekund zbývá', 'Blocks and seconds remaining')],
        ['`logs`', '`getLogs`', '`fromBlock`, `toBlock`, `address`, `topic0`…`topic3`, `page`, `offset`', L('Události kontraktů', 'Contract events')],
        ['`stats`', '`ethsupply`, `coinsupply`, `nodecount`', '—', L('Vytěžené mince a počet uzlů', 'Coins mined and node count')],
        ['`/api/supply/total`, `/circulating`, `/max`', 'GET', '—', L('Zásoba v celých mincích jako prosté číslo (`90360`) pro sledovače mincí; v oběhu = vytěženo, bez premine', 'Supply in whole coins as a plain number (`90360`) for coin trackers; circulating = mined, no premine')],
        ['`gastracker`', '`gasoracle`', '—', L('Poplatky pomalu, běžně, rychle v gwei', 'Slow, normal and fast fees in gwei')],
        ['`proxy`', '`eth_blockNumber`, `eth_getBlockByNumber`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_call`, `eth_getCode`, `eth_getStorageAt`, `eth_getTransactionCount`, `eth_gasPrice`, `eth_estimateGas`', L('Parametry `tag`, `txhash`, `to`, `data` …', 'Parameters `tag`, `txhash`, `to`, `data` …'), L('Odpověď JSON-RPC', 'A JSON-RPC answer')],
      ] } },
      { note: L('Rozdíly: API nepřijímá transakce (`eth_sendRawTransaction` patří do JSON-RPC), nemá ceny ani ověřené zdrojové kódy kontraktů a interní transakce. Všechno ostatní z řetězce dává JSON-RPC níže.', 'Differences: the API does not accept transactions (`eth_sendRawTransaction` belongs to JSON-RPC), and has no prices, verified contract sources or internal transactions. Everything else on the chain is in the JSON-RPC below.') },
    ] },

    { id: 'network', title: L('Síť', 'Network'), blocks: [
      { table: { head: [L('Síť', 'Network'), 'Chain ID', 'RPC', 'P2P', 'Stratum', L('Mince', 'Coin')], rows: [
        ['mainnet', '52401', '8545', '30524', '3333', 'QU'], ['testnet', '52402', '8546', '30525', '3334', 'tQU'], ['dev', '52403', '8547', '30526', '3335', 'dQU'],
      ] } },
      { p: L('Mainnet běží od 14. 11. 2026. Testovací mince `tQU` a `dQU` nemají žádnou hodnotu.', 'Mainnet is live since 14 November 2026. The test coins `tQU` and `dQU` have no value.') },
      { h: L('Parametry', 'Parameters') },
      { table: { head: [L('Parametr', 'Parameter'), L('Hodnota', 'Value')], rows: [
        [L('Konsensus', 'Consensus'), L('Proof of Work, Ethash, obtížnost LWMA po každém bloku', 'Proof of Work, Ethash, LWMA difficulty each block')],
        [L('Čas bloku', 'Block time'), L('15 sekund', '15 seconds')],
        [L('Odměna', 'Reward'), L('4 mince, půlení po 8 000 000 blocích, strop 64 milionů', '4 coins, halving every 8,000,000 blocks, cap 64 million')],
        [L('Limit gasu', 'Gas limit'), L('10 milionů, těžaři mohou hlasovat až o 15 milionů', '10 million, miners can vote up to 15 million')],
        [L('Poplatky', 'Fees'), L('EIP-1559, základní poplatek i dýško dostane těžař, nic se nepálí, minimum 1 gwei', 'EIP-1559, the miner gets the base fee and the tip, nothing is burned, minimum 1 gwei')],
        ['EVM', L('Shanghai a Cancun bez blobů, viz Rozdíly oproti Ethereu', 'Shanghai and Cancun without blobs, see Differences from Ethereum')],
        [L('Typy transakcí', 'Transaction types'), L('0 s EIP-155, 1 a 2', '0 with EIP-155, 1 and 2')],
        [L('Velikost', 'Size'), L('Transakce nejvýše 128 KiB, blok nejvýše 2 MiB', 'Transaction up to 128 KiB, block up to 2 MiB')],
      ] } },
    ] },

    { id: 'wallets', title: L('Peněženky', 'Wallets'), blocks: [
      { p: L('Peněženka přidá síť tímto voláním. Quinvium Wallet má navíc vlastní objekt `window.quinvium` a hlásí se přes EIP-6963.', 'A wallet adds the network with this call. Quinvium Wallet also has its own `window.quinvium` object and announces itself through EIP-6963.') },
      { code: 'addNetwork' },
      { h: L('Připojení z webové stránky', 'Connecting from a web page') },
      { code: 'connectBrowser' },
    ] },

    { id: 'fees', title: L('Poplatky', 'Fees'), blocks: [
      { p: L('Poplatek je `gas × (základní poplatek + dýško)` jako v Ethereu podle EIP-1559. Celý ho dostane těžař, nic se nepálí.', 'The fee is `gas × (base fee + tip)` as in Ethereum under EIP-1559. The miner gets all of it, nothing is burned.') },
      { ul: [
        L('Gas závisí na složitosti transakce: převod stojí 21 000, volání kontraktu víc.', 'Gas depends on transaction complexity: a transfer costs 21,000, contract calls more.'),
        L('Základní poplatek určuje síť podle vytížení. Když je blok plnější než z poloviny, stoupne až o 12,5 %, jinak klesá, minimum je 1 gwei.', 'The network sets the base fee from load. A block more than half full raises it by up to 12.5 %, otherwise it falls, with a 1 gwei minimum.'),
        L('Dýško si volí odesílatel. Těžař řadí transakce od nejvyššího dýška.', 'The sender picks the tip. Miners order transactions by highest tip.'),
        L('Obtížnost těžby poplatek neovlivňuje.', 'Mining difficulty does not affect fees.'),
      ] },
      { h: L('Doporučené poplatky', 'Suggested fees') },
      { p: L('Metoda `quinvium_feeEstimates` vrací úrovně `slow`, `normal` a `fast` vypočtené z posledních 20 bloků. Když jsou bloky v průměru pod polovinou kapacity, stačí minimální dýško. Ve vytížené síti se použije 25., 50. a 90. percentil dýšek vážený gasem. Pole `seconds` je odhad čekání podle skutečné doby bloku, takže sám reaguje na počet těžařů.', 'The `quinvium_feeEstimates` method returns `slow`, `normal` and `fast` tiers from the last 20 blocks. When blocks average under half capacity the minimum tip is enough. On a busy network it uses the gas-weighted 25th, 50th and 90th percentile of tips. The `seconds` field estimates the wait from the real block time, so it follows the number of miners.') },
      { code: 'fees' },
      { h: L('Vlastní poplatek', 'Custom fee') },
      { code: 'customFee' },
      { h: L('Zrychlení a zrušení', 'Speeding up and cancelling') },
      { p: L('Čekající transakci nahradíte novou se stejným nonce a alespoň o 10 % vyšším maximálním poplatkem i dýškem. Zrušení je prázdná platba sám sobě. Quinvium Wallet nabízí obojí u čekajících transakcí.', 'Replace a pending transaction with a new one using the same nonce and at least 10 % higher max fee and tip. Cancelling is an empty payment to yourself. Quinvium Wallet offers both for pending transactions.') },
    ] },

    { id: 'ethers', title: 'ethers.js', blocks: [
      { h: L('Čtení', 'Reading') },
      { code: 'read' },
      { h: L('Odeslání platby', 'Sending a payment') },
      { code: 'send' },
    ] },

    { id: 'deploy', title: L('Nasazení kontraktu', 'Deploying contracts'), blocks: [
      { p: L('Kompilujte pro `cancun`. Instrukce `blobhash` a `block.blobbasefee` v Quinviu nefungují, jinak se Solidity chová jako na Ethereu.', 'Compile for `cancun`. The `blobhash` and `block.blobbasefee` instructions do not work on Quinvium, otherwise Solidity behaves as on Ethereum.') },
      { h: 'ethers.js a solc', hEn: 'ethers.js and solc' },
      { code: 'deploy' },
      { h: 'Hardhat' },
      { p: L('Nainstalujte `hardhat`, `ethers` a `@nomicfoundation/hardhat-ethers`, potom nasazujte s volbou `--network quinvium`.', 'Install `hardhat`, `ethers` and `@nomicfoundation/hardhat-ethers`, then deploy with `--network quinvium`.') },
      { code: 'hardhat' },
    ] },

    { id: 'contracts', title: L('Systémové kontrakty', 'System contracts'), blocks: [
      { p: L('Kontrakty jsou v genesis bloku na pevných adresách ve všech sítích a nikdo je nemůže změnit. Celé ABI je v souboru [contracts.json](/contracts.json). Přehled níže se generuje přímo z něj.', 'These contracts are in the genesis block at fixed addresses on every network and nobody can change them. The full ABI is in [contracts.json](/contracts.json). The reference below is generated from it.') },
      { html: 'contracts' },
      { h: L('Notář', 'Notary') },
      { code: 'notary' },
      { h: L('Certifikáty', 'Credentials') },
      { code: 'credentials' },
      { h: L('Jména', 'Names') },
      { p: L('Registrace trvá přes minutu: závazek musí být starý alespoň 60 sekund a nejvýše jeden den.', 'Registration takes over a minute: the commitment must be at least 60 seconds and at most one day old.') },
      { code: 'names' },
      { h: L('Hromadné čtení', 'Batched reads') },
      { code: 'multicall' },
    ] },

    { id: 'rpc', title: 'JSON-RPC', blocks: [
      { p: L('Požadavky posílejte metodou POST na adresu uzlu. Dávka má nejvýše 100 položek, tělo požadavku nejvýše 5 MiB. Uzel nedrží klíče, transakce se podepisují v aplikaci nebo peněžence a odesílají přes `eth_sendRawTransaction`.', 'Send requests with POST to the node URL. A batch has up to 100 items, a request body up to 5 MiB. The node holds no keys, transactions are signed in the app or wallet and sent through `eth_sendRawTransaction`.') },
      { p: L('Blok lze zadat číslem nebo značkou: `latest`, `pending`, `earliest`, `safe` (32 bloků za špičkou) a `finalized` (256 bloků za špičkou).', 'A block is a number or a tag: `latest`, `pending`, `earliest`, `safe` (32 blocks behind head) and `finalized` (256 blocks behind head).') },
      { p: L('Vlastní metody sítě začínají `quinvium_`. Uzel přijímá i dřívější názvy začínající `quintium_` a `aether_`, starší programy tak fungují dál.', 'The network’s own methods start with `quinvium_`. The node also accepts the earlier names starting with `quintium_` and `aether_`, so older programs keep working.') },
      { code: 'stats' },
      { h: L('Vyzkoušet', 'Try it') },
      { html: 'console' },
      { html: 'methods' },
      { h: L('Logy', 'Logs') },
      { code: 'logs' },
    ] },

    { id: 'ws', title: 'WebSocket', blocks: [
      { p: L('WebSocket běží na stejném portu jako RPC. Jedno spojení má nejvýše 32 odběrů. Odběry: `newHeads`, `logs` s filtrem a `newPendingTransactions`.', 'WebSocket shares the RPC port. One connection has up to 32 subscriptions: `newHeads`, `logs` with a filter and `newPendingTransactions`.') },
      { code: 'wsEthers' },
      { h: L('Bez knihovny', 'Without a library') },
      { code: 'wsRaw' },
    ] },

    { id: 'mining', title: L('Těžba pro vývojáře', 'Mining integration'), blocks: [
      { p: L('Uzel sám netěží, jen rozdává práci. Adresa výplaty je součástí žádosti, účet na uzlu není potřeba.', 'The node does not mine, it hands out work. The payout address is part of the request, no account is needed.') },
      { code: 'getwork' },
      { p: L('Odpověď je `[sealHash, seedHash, target, number]`. Řešení odešlete přes `quinvium_submitWork`. Pole `stale` znamená platný blok, který prohrál se souběžným blokem a nepřinese odměnu.', 'The reply is `[sealHash, seedHash, target, number]`. Submit a solution through `quinvium_submitWork`. The `stale` field means a valid block that lost to a concurrent block and earns nothing.') },
      { h: L('Pool', 'Pool') },
      { p: L('Pool je kontrakt `AetherPool`, který založí `PoolFactory`. Bloky poolu mají jako příjemce odměny kontrakt. Podíl je hlavička bloku, jejíž `extraData` nese adresu těžaře (20 bajtů) a obtížnost podílu (12 bajtů), obojí je kryté prací. Vestavěná funkce na adrese `0x…0100` práci ověří přímo v síti, proto ji provozovatel nemůže změnit. Uzel spuštěný s `--pool` rozdává práci přes `quinvium_poolWork` i Stratum a podíly posílá do kontraktu. Podíly i výplatu (`submitShares`, `claim`) může odeslat kdokoli.', 'A pool is an `AetherPool` contract created by `PoolFactory`. Pool blocks pay the contract. A share is a block header whose `extraData` carries the miner address (20 bytes) and the share difficulty (12 bytes), both covered by the work. A built-in function at `0x…0100` verifies the work on chain, so the operator cannot change it. A node started with `--pool` serves work through `quinvium_poolWork` and Stratum and sends shares to the contract. Anyone can submit shares and trigger payouts (`submitShares`, `claim`).') },
      { h: 'Stratum' },
      { p: L('Server umí režim ETHPROXY (`eth_submitLogin`, `eth_getWork`, `eth_submitWork`) a EthereumStratum/1.0.0 (`mining.subscribe`, `mining.authorize`, `mining.notify`, `mining.submit`). Přihlašovací jméno je adresa, volitelně s názvem stroje: `0xADRESA.rig1`. Výplata jde celá nálezci, pool zatím součástí není.', 'The server speaks ETHPROXY (`eth_submitLogin`, `eth_getWork`, `eth_submitWork`) and EthereumStratum/1.0.0 (`mining.subscribe`, `mining.authorize`, `mining.notify`, `mining.submit`). The login is an address, optionally with a worker name: `0xADDRESS.rig1`. The finder gets the whole reward, a pool is not included yet.') },
    ] },

    { id: 'node', title: L('Provoz uzlu', 'Running a node'), blocks: [
      { code: 'runNode' },
      { html: 'cli' },
      { p: L('RPC nikdy nevystavujte přímo do internetu. Dejte před něj reverzní proxy s HTTPS, která nastavuje `X-Forwarded-For`, a zapněte `--rate-limit` a `--trust-proxy`. Pro veřejný uzel otevřete jen port P2P.', 'Never expose RPC directly to the internet. Put a reverse proxy with HTTPS in front that sets `X-Forwarded-For`, and enable `--rate-limit` and `--trust-proxy`. For a public node open only the P2P port.') },
      { p: L('Uzel je archivní, pamatuje si stav všech bloků.', 'The node is an archive node, it keeps the state of all blocks.') },
    ] },

    { id: 'limits', title: L('Limity a chyby', 'Limits and errors'), blocks: [
      { h: L('Fronta transakcí', 'Transaction pool') },
      { ul: [
        L('Transakce do 128 KiB a 8 milionů gasu. Větší nasazení rozdělte.', 'Transactions up to 128 KiB and 8 million gas. Split larger deployments.'),
        L('Nejvýše 64 čekajících transakcí od jedné adresy a mezera v nonce nejvýše 64.', 'Up to 64 pending transactions per address and a nonce gap of at most 64.'),
        L('Účet musí pokrýt součet všech svých čekajících transakcí s nižším nonce.', 'An account must cover the sum of all its pending transactions with lower nonces.'),
        L('Náhrada transakce potřebuje alespoň o 10 % vyšší poplatek i dýško.', 'A replacement needs at least 10 % higher fee and tip.'),
        L('Čekající transakce vyprší po 6 hodinách. Plná fronta vytlačí nejlevnější.', 'Pending transactions expire after 6 hours. A full pool evicts the cheapest.'),
      ] },
      { h: L('Kódy chyb', 'Error codes') },
      { table: { head: [L('Kód', 'Code'), L('Význam', 'Meaning')], rows: [
        ['-32700', L('Neplatný JSON', 'Invalid JSON')], ['-32600', L('Neplatný požadavek nebo velikost dávky', 'Invalid request or batch size')],
        ['-32601', L('Metoda neexistuje', 'Method not found')], ['-32602', L('Neplatné parametry', 'Invalid params')],
        ['-32603', L('Vnitřní chyba', 'Internal error')], ['-32000', L('Transakce odmítnuta nebo těžba nedostupná', 'Transaction rejected or mining unavailable')],
        ['-32001', L('Blok nenalezen', 'Block not found')], ['-32005', L('Překročený limit, zkuste to později nebo zužte dotaz', 'Limit exceeded, retry later or narrow the query')],
        ['3', L('Kontrakt selhal, pole `data` nese důvod', 'Contract reverted, the `data` field holds the reason')],
      ] } },
    ] },

    { id: 'confirmations', title: L('Potvrzení', 'Confirmations'), blocks: [
      { p: L('Quinvium je Proof of Work, poslední bloky se proto mohou přepsat. Reorganizaci hlubší než 256 bloků, asi hodinu, uzel odmítne.', 'Quinvium is Proof of Work, so recent blocks can be rewritten. A node rejects reorganizations deeper than 256 blocks, about an hour.') },
      { table: { head: [L('Použití', 'Use'), L('Čekejte', 'Wait for')], rows: [
        [L('Zobrazení v aplikaci', 'Showing in an app'), L('1 potvrzení', '1 confirmation')],
        [L('Běžné platby', 'Regular payments'), L('alespoň 12 potvrzení, asi 3 minuty', 'at least 12 confirmations, about 3 minutes')],
        [L('Větší částky a burzy', 'Large amounts and exchanges'), L('alespoň 256 potvrzení nebo značka `finalized`', 'at least 256 confirmations or the `finalized` tag')],
      ] } },
      { p: L('Malá síť je zranitelnější přepisem pronajatým výkonem. Dokud je výkon sítě nízký, počítejte s větší rezervou.', 'A small network is more exposed to rented hashrate. While network hashrate is low, keep a larger margin.') },
    ] },

    { id: 'differences', title: L('Rozdíly oproti Ethereu', 'Differences from Ethereum'), blocks: [
      { ul: [
        L('Proof of Work místo stakingu. Nejsou validátoři, výběry ani beacon chain.', 'Proof of Work instead of staking. No validators, withdrawals or beacon chain.'),
        L('EVM je Shanghai plus EIP-1153, EIP-5656 a EIP-6780 z Cancunu a EIP-7823 a EIP-7883 z Fusaky.', 'The EVM is Shanghai plus EIP-1153, EIP-5656 and EIP-6780 from Cancun and EIP-7823 and EIP-7883 from Fusaka.'),
        L('Nejsou bloby: instrukce `0x49` a `0x4a` jsou neplatné a adresa `0x0a` není předkompilovaný kontrakt.', 'No blobs: opcodes `0x49` and `0x4a` are invalid and address `0x0a` is not a precompile.'),
        L('Nejsou EIP-4788, EIP-7702 ani EIP-7623.', 'No EIP-4788, EIP-7702 or EIP-7623.'),
        L('`block.prevrandao` a `block.difficulty` vracejí mixHash rodičovského bloku. Těžař ho může ovlivnit, pro loterie se nehodí.', '`block.prevrandao` and `block.difficulty` return the parent block mixHash. Miners can influence it, do not use it for lotteries.'),
        L('Základní poplatek se nepálí, dostává ho těžař spolu s odměnou po poslední transakci bloku. Kontrakt ho proto v průběhu bloku na `block.coinbase` nevidí.', 'The base fee is not burned, the miner gets it with the block reward after the last transaction. Contracts therefore do not see it on `block.coinbase` during the block.'),
        L('BLAKE2F stojí 3 gas za kolo místo 1.', 'BLAKE2F costs 3 gas per round instead of 1.'),
        L('Nejsou strýčkovské bloky.', 'There are no uncle blocks.'),
        L('Čas bloku smí těžař posunout až o 60 sekund, kontrakty s ním nesmí počítat přesněji.', 'Miners can shift block time by up to 60 seconds, contracts must not rely on more precision.'),
        L('Metody `debug_*`, `trace_*`, `eth_sendTransaction` a `eth_createAccessList` nejsou k dispozici.', 'The `debug_*`, `trace_*`, `eth_sendTransaction` and `eth_createAccessList` methods are not available.'),
      ] },
    ] },
  ];

  /** Values that are filled into the examples. */
  function networkValues({ rpcBase, stats, contracts }) {
    const chainId = stats?.chainId ?? 52402;
    const address = Object.fromEntries(Object.entries(contracts).filter(([, c]) => c.address).map(([k, c]) => [k, c.address]));
    return {
      rpc: rpcBase.replace(/\/$/, ''), ws: rpcBase.replace(/\/$/, '').replace(/^http/, 'ws'), chainId, chainHex: `0x${chainId.toString(16)}`,
      coin: stats?.currency ?? 'QU', network: stats?.network ?? 'testnet', address,
    };
  }

  function render(ctx) {
    const { app, lang, esc, head, copyBtn, contracts, rpc, section } = ctx;
    // The developer documentation is in Czech and English; the other languages show English.
    const pick = (v) => (typeof v === 'string' ? v : v?.[lang] ?? v?.en ?? v?.cs ?? '');
    const values = networkValues(ctx);
    const inline = (text) => esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    const codeBlock = (id) => {
      const ex = EXAMPLES[id];
      const code = ex.code(values);
      return `<div class="doc-code">${ex.file ? `<span class="doc-file">${esc(ex.file)}</span>` : ''}<pre><code>${esc(code)}</code></pre>${copyBtn(code)}</div>`;
    };
    const table = (t) => `<div class="table-wrap doc-table"><table><thead><tr>${t.head.map((h) => `<th>${esc(pick(h))}</th>`).join('')}</tr></thead><tbody>${
      t.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(pick(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

    const typeOf = (p) => (p.type === 'tuple' ? p.internalType?.replace(/^struct \w+\./, '') ?? 'tuple' : p.type);
    const params = (list = []) => list.map((p) => `${typeOf(p)}${p.name ? ` ${p.name}` : ''}`).join(', ');
    const signature = (f) => {
      const tags = f.stateMutability === 'view' || f.stateMutability === 'pure' ? ' view' : f.stateMutability === 'payable' ? ' payable' : '';
      const out = f.outputs?.length ? ` → ${params(f.outputs)}` : '';
      return `${f.name}(${params(f.inputs)})${tags}${out}`;
    };
    const contractBlock = (name) => {
      const c = contracts[name];
      const abi = c.abi ?? [];
      const group = (title, list) => (list.length ? `<h4>${esc(title)}</h4><ul class="doc-abi">${list.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul>` : '');
      const functions = abi.filter((x) => x.type === 'function');
      const reads = functions.filter((f) => ['view', 'pure'].includes(f.stateMutability)).map(signature);
      const writes = functions.filter((f) => !['view', 'pure'].includes(f.stateMutability)).map(signature);
      const events = abi.filter((x) => x.type === 'event').map((e) => `${e.name}(${params(e.inputs)})`);
      const errors = abi.filter((x) => x.type === 'error').map((e) => `${e.name}(${params(e.inputs)})`);
      return `<details class="doc-contract"><summary><strong>${esc(name)}</strong>${c.address ? `<span class="hash">${esc(c.address)}</span>` : ''}<small>${esc(pick(CONTRACT_INFO[name]))}</small></summary>
        ${group(lang === 'cs' ? 'Zápis' : 'Write', writes)}${group(lang === 'cs' ? 'Čtení' : 'Read', reads)}${group(lang === 'cs' ? 'Události' : 'Events', events)}${group(lang === 'cs' ? 'Chyby' : 'Errors', errors)}</details>`;
    };

    const generated = {
      contracts: () => {
        const fixed = Object.keys(contracts).filter((k) => contracts[k].address).sort((a, b) => contracts[a].address.localeCompare(contracts[b].address));
        const helpers = Object.keys(contracts).filter((k) => !contracts[k].address);
        return `${fixed.map(contractBlock).join('')}<h3>${lang === 'cs' ? 'Kontrakty vytvořené továrnami' : 'Contracts created by factories'}</h3>${helpers.map(contractBlock).join('')}`;
      },
      methods: () => RPC_GROUPS.map((g) => `<h3>${esc(pick(g.title))}</h3>${table({
        head: [lang === 'cs' ? 'Metoda' : 'Method', lang === 'cs' ? 'Parametry' : 'Params', lang === 'cs' ? 'Popis' : 'Description'],
        rows: g.rows.map(([m, p, d]) => [`\`${m}\``, `\`${p}\``, d]),
      })}`).join(''),
      cli: () => table({ head: [lang === 'cs' ? 'Volba' : 'Option', lang === 'cs' ? 'Popis' : 'Description'], rows: CLI_OPTIONS.map(([o, d]) => [`\`${o}\``, d]) }),
      console: () => `<form class="doc-console" id="doc-console">
          <label>${lang === 'cs' ? 'Metoda' : 'Method'}<input name="method" list="doc-methods" value="quinvium_stats" spellcheck="false" autocomplete="off"></label>
          <datalist id="doc-methods">${RPC_GROUPS.flatMap((g) => g.rows.map(([m]) => m)).filter((m) => !['eth_subscribe', 'eth_unsubscribe'].includes(m)).map((m) => `<option value="${m}"></option>`).join('')}</datalist>
          <label>${lang === 'cs' ? 'Parametry jako JSON' : 'Params as JSON'}<input name="params" value="[]" spellcheck="false" autocomplete="off"></label>
          <button type="submit" class="primary-btn">${lang === 'cs' ? 'Odeslat' : 'Send'}</button>
        </form><pre class="doc-output hidden" id="doc-output"></pre>`,
    };

    const blockHtml = (b) => {
      if (b.h) return `<h3>${esc(lang === 'en' && b.hEn ? b.hEn : pick(b.h))}</h3>`;
      if (b.p) return `<p>${inline(pick(b.p))}</p>`;
      if (b.note) return `<p class="doc-note">${inline(pick(b.note))}</p>`;
      if (b.ul) return `<ul>${b.ul.map((x) => `<li>${inline(pick(x))}</li>`).join('')}</ul>`;
      if (b.code) return codeBlock(b.code);
      if (b.table) return table(b.table);
      if (b.html) return generated[b.html]();
      return '';
    };

    const toc = SECTIONS.map((s) => `<a href="/api/${s.id}" data-doc="${s.id}">${esc(pick(s.title))}</a>`).join('');
    app.innerHTML = `${head(lang === 'cs' ? 'Dokumentace' : 'Documentation',
      lang === 'cs' ? `Jak stavět na síti Quinvium. Příklady jsou doplněné pro síť ${esc(values.network)} a uzel ${esc(values.rpc)}.` : `How to build on Quinvium. Examples are filled in for the ${esc(values.network)} network and node ${esc(values.rpc)}.`)}
      <div class="docs-layout">
        <nav class="docs-toc">${toc}</nav>
        <div class="docs-main">${SECTIONS.map((s) => `<section class="card prose doc-section" id="doc-${s.id}"><h2>${esc(pick(s.title))}</h2>${s.blocks.map(blockHtml).join('')}</section>`).join('')}</div>
      </div>`;

    const consoleForm = app.querySelector('#doc-console');
    const output = app.querySelector('#doc-output');
    consoleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      output.classList.remove('hidden', 'bad');
      output.textContent = '…';
      try {
        const data = new FormData(consoleForm);
        const list = JSON.parse(String(data.get('params')).trim() || '[]');
        if (!Array.isArray(list)) throw new Error(lang === 'cs' ? 'Parametry musí být pole' : 'Params must be an array');
        output.textContent = JSON.stringify(await rpc(String(data.get('method')).trim(), list), null, 2);
      } catch (err) {
        output.classList.add('bad');
        output.textContent = err.message;
      }
    });

    const current = section && SECTIONS.some((s) => s.id === section) ? section : null;
    if (current) {
      app.querySelector(`[data-doc="${current}"]`)?.classList.add('active');
      document.getElementById(`doc-${current}`)?.scrollIntoView({ block: 'start' });
    }
  }

  window.AetherDocs = { render, EXAMPLES, RPC_GROUPS, CLI_OPTIONS, SECTIONS, networkValues };
})();
