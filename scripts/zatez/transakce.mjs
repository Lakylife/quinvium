// Zápisy: kolik transakcí uzel přijme, jak dlouho trvá plný blok a kolik místa zabere jedna transakce.
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './spolecne.mjs';
import { WEI, makeChain } from '../../packages/bridge/test/helpers/chains.js';
import { seal } from '../../packages/node/test/helpers/chain.js';

const { ethers } = createRequire(`${root}/package.json`)('ethers');
const ACCOUNTS = 400;
const PER_ACCOUNT = 12;
const wallets = Array.from({ length: ACCOUNTS }, () => ethers.Wallet.createRandom());
const side = makeChain(52403n, 'zatez', wallets);
const sizeOf = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? sizeOf(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
const ms = (t) => performance.now() - t;

await side.start();
const { node } = side;
const { dataDir } = node;
const url = `http://127.0.0.1:${node.rpc.port}`;
const fee = { maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, chainId: 52403n, type: 2 };

const sizeNow = () => sizeOf(dataDir);
const baseline = sizeNow();
console.log('Podepisuji…');
const raw = [];
for (const w of wallets) for (let n = 0; n < PER_ACCOUNT; n++) raw.push(await w.signTransaction({ ...fee, nonce: n, to: wallets[(n * 7) % ACCOUNTS].address, value: 1n, gasLimit: 21000n }));

console.log(`Odesílám ${raw.length} transakcí přes RPC…`);
const send = (tx) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [tx] }) }).then((r) => r.json());
let start = performance.now();
let rejected = 0;
const BATCH = 64;
for (let i = 0; i < raw.length; i += BATCH) {
  const results = await Promise.all(raw.slice(i, i + BATCH).map(send));
  rejected += results.filter((r) => r.error).length;
}
const ingest = ms(start);
await node.mempool.settled();
console.log(`Příjem: ${Math.round(raw.length / (ingest / 1000))} tx/s, odmítnuto ${rejected}, ve frontě ${node.mempool.size}`);

const blocks = [];
const miner = ethers.getBytes(`0x${'cc'.repeat(20)}`);
for (let i = 0; i < 6; i++) {
  side.state.clock += 15;
  start = performance.now();
  const w = await node.work.getWork(miner);
  const build = ms(start);
  const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
  const sealed = await seal(node.chain, tpl);
  start = performance.now();
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  const insert = ms(start);
  if (!r.accepted) throw new Error(r.reason);
  await node.mempool.settled();
  const head = await side.provider.getBlock('latest');
  blocks.push({ txs: head.transactions.length, gas: Number(head.gasUsed), build, insert, total: build + insert });
  console.log(`Blok ${head.number}: ${head.transactions.length} tx, gas ${head.gasUsed}, sestavení šablony ${build.toFixed(0)} ms, ověření a zápis ${insert.toFixed(0)} ms`);
}
const included = blocks.reduce((s, b) => s + b.txs, 0);
console.log(`Průměr: ${(included / blocks.length).toFixed(0)} tx na blok, tedy ${(included / blocks.length / 15).toFixed(1)} tx/s při 15s bloku`);
const perTx = blocks.reduce((s, b) => s + b.total, 0) / Math.max(1, included);
console.log(`Výpočet: ${perTx.toFixed(2)} ms na transakci v jádře uzlu, strop výpočtu asi ${Math.round(1000 / perTx)} tx/s`);

const erc = await side.deploy('StableToken', wallets[0], 'T', 'T', 6, wallets[0].address);
await side.ok(erc.configureMinter(wallets[0].address, 10n ** 18n));
await side.ok(erc.mint(wallets[0].address, 10n ** 15n));
const gas = await erc.connect(side.connect(wallets[0])).transfer.estimateGas(wallets[1].address, 1n);
console.log(`Převod tokenu: ${gas} gasu, tedy ${Math.floor(10_000_000 / Number(gas))} na blok`);
node.chain.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const grown = sizeNow() - baseline;
console.log(`Data: nárůst ${(grown / 1024 / 1024).toFixed(1)} MB po ${included} transakcích, ${(grown / included).toFixed(0)} B na transakci`);
await side.stop();
console.log(WEI ? 'Hotovo.' : '');
process.exit(0);
