// Explorer filters on a large database: how long a query takes when the chain has millions of transactions.
import { rmSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/node/src/core/store.js';

const TXS = Number(process.argv[2] ?? 5_000_000);
const PER_BLOCK = 100;
const ADDRESSES = 200_000;
const dir = mkdtempSync(join(tmpdir(), 'aether-index-'));
const store = new Store(join(dir, 'chain.db'));
const { db } = store;
const address = (n) => { const b = Buffer.alloc(20); b.writeUInt32BE(n >>> 0, 16); b.writeUInt32BE((n * 2654435761) >>> 0, 0); return b; };

console.log(`Plním ${TXS.toLocaleString('cs')} transakcí…`);
let t = performance.now();
db.exec('BEGIN');
const insertTx = db.prepare('INSERT INTO tx_index (number,idx,time,sender,recipient,kind,ok,value,fee) VALUES (?,?,?,?,?,?,?,?,?)');
const insertBlock = db.prepare('INSERT INTO block_index (number,time,miner,difficulty,solve,txs,gas,income) VALUES (?,?,?,?,?,?,?,?)');
let seed = 12345;
const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
for (let i = 0; i < TXS; i++) {
  const number = Math.floor(i / PER_BLOCK);
  if (i % PER_BLOCK === 0) insertBlock.run(number, 1_700_000_000 + number * 15, address(number % 500), 9e7, 15, PER_BLOCK, 2_100_000, 4e18);
  // Some addresses are very active, like exchanges and pools.
  const from = next() % 8 === 0 ? next() % 50 : next() % ADDRESSES;
  insertTx.run(number, i % PER_BLOCK, 1_700_000_000 + number * 15, address(from), address(next() % ADDRESSES), next() % 3, next() % 50 ? 1 : 0, (next() % 1000) * 1e15, 21000e9);
  if (i % 500_000 === 499_999) { db.exec('COMMIT'); db.exec('BEGIN'); }
}
db.exec('COMMIT');
console.log(`Naplněno za ${((performance.now() - t) / 1000).toFixed(0)} s, soubor ${(statSync(join(dir, 'chain.db')).size / 1024 / 1024).toFixed(0)} MB`);

const busy = address(7);
const quiet = address(123456);
const time = (name, fn) => {
  const runs = [];
  for (let i = 0; i < 5; i++) { const s = performance.now(); fn(); runs.push(performance.now() - s); }
  runs.sort((a, b) => a - b);
  console.log(`${name.padEnd(44)} ${runs[2].toFixed(1).padStart(9)} ms`);
};
time('poslední transakce', () => store.findTxs({ limit: 25, offset: 0 }));
time('poslední bloky', () => store.findBlocks({ limit: 25, offset: 0 }));
time('tichá adresa', () => store.findTxs({ address: quiet, limit: 25, offset: 0 }));
time('velmi aktivní adresa', () => store.findTxs({ address: busy, limit: 25, offset: 0 }));
time('aktivní adresa, odchozí', () => store.findTxs({ address: busy, direction: 'out', limit: 25, offset: 0 }));
time('aktivní adresa, hluboká stránka', () => store.findTxs({ address: busy, limit: 25, offset: 20_000 }));
time('jen neúspěšné', () => store.findTxs({ ok: 0, limit: 25, offset: 0 }));
time('jen volání kontraktů', () => store.findTxs({ kind: 1, limit: 25, offset: 0 }));
time('hodnota nad minimem', () => store.findTxs({ minValue: 900e15, limit: 25, offset: 0 }));
time('časové okno 24 hodin', () => store.findTxs({ fromTime: 1_700_000_000 + 10_000 * 15, toTime: 1_700_000_000 + 15_760 * 15, limit: 25, offset: 0 }));
time('stará hluboká stránka', () => store.findTxs({ limit: 25, offset: 1_000_000 }));
time('prázdné bloky', () => store.findBlocks({ onlyEmpty: true, limit: 25, offset: 0 }));
time('bloky těžaře', () => store.findBlocks({ miner: address(3), limit: 25, offset: 0 }));
time('souhrn tiché adresy', () => store.addressSummary(quiet));
time('souhrn aktivní adresy', () => store.addressSummary(busy));
time('graf přes celou historii', () => store.chartSeries(0, Math.floor(TXS / PER_BLOCK), Math.ceil(TXS / PER_BLOCK / 600)));
store.close?.();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
