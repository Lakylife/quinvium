// Explorer index: block and transaction filters, address details, history for charts and behaviour during a reorganisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, bytesToHex } from '@ethereumjs/util';
import { createMethods } from '../src/rpc/methods.js';
import { GWEI, NETWORKS, WEI } from '../src/params.js';
import { join } from 'node:path';
import { Store } from '../src/core/store.js';
import { keccak } from '../src/util/bytes.js';
import { mine, mineMany, newChain, tmpData, transfer, wallet } from './helpers/chain.js';

const a = wallet();
const b = wallet();
const minerA = new Uint8Array(20).fill(0xa1);
const minerB = new Uint8Array(20).fill(0xb2);
const hex = (x) => bytesToHex(x);

async function setup() {
  const alloc = { [hex(a.address)]: { balance: 100n * WEI }, [hex(b.address)]: { balance: 100n * WEI } };
  const c = await newChain({ alloc });
  const { methods } = createMethods({ chain: c, mempool: c.mempool, network: null, work: null, version: 'x', sendTx: () => {} });
  const to = new Address(b.address);
  await mine(c, { miner: minerA, txs: [transfer(c, a, to, 5n * WEI, 0n)] });                                                  // 1: transfer
  await mine(c, { miner: minerB });                                                                                            // 2: empty
  await mine(c, { miner: minerA, txs: [transfer(c, a, to, 1n, 1n, { gas: 60000n, data: new Uint8Array([1, 2]) })] });           // 3: call, data to a plain address goes through
  await mine(c, { miner: minerA, txs: [transfer(c, b, new Address(a.address), 2n * WEI, 0n)] });                                // 4: back
  return { c, methods };
}

test('when mining stops, the network hashrate estimate drops to zero', async () => {
  const c = await newChain({ network: { ...NETWORKS.dev, genesisDifficulty: 64n, minDifficulty: 64n } });
  await mineMany(c, 4);
  const { methods } = createMethods({ chain: c, mempool: c.mempool, network: null, work: null, version: 'x', sendTx: () => {} });
  const running = BigInt(methods.aether_stats().hashrate);
  assert.ok(running > 0n, 'při těžbě je výkon vidět');
  c.tick(120);
  assert.ok(BigInt(methods.aether_stats().hashrate) > 0n, 'krátká pauza mezi bloky výkon nevynuluje');
  c.tick(100);
  assert.equal(methods.aether_stats().hashrate, '0', 'tři minuty bez bloku znamenají, že síť netěží');
  c.tick(86400);
  assert.equal(methods.aether_stats().hashrate, '0');
});

test('blocks can be filtered by miner, content, time and range', async () => {
  const { c, methods } = await setup();
  const numbers = async (f) => (await methods.aether_blocks([f])).items.map((x) => x.number);
  assert.deepEqual(await numbers({}), [4, 3, 2, 1]);
  assert.equal((await methods.aether_blocks([{}])).total, 4);
  assert.deepEqual(await numbers({ order: 'asc', limit: 2 }), [1, 2]);
  assert.deepEqual(await numbers({ limit: 1, offset: 1 }), [3]);
  assert.deepEqual(await numbers({ miner: hex(minerB) }), [2]);
  assert.deepEqual(await numbers({ miner: hex(minerA), minTxs: 1 }), [4, 3, 1]);
  assert.deepEqual(await numbers({ onlyEmpty: true }), [2]);
  assert.deepEqual(await numbers({ fromBlock: 2, toBlock: 3 }), [3, 2]);
  const second = c.getHeaderByNumber(2n);
  assert.deepEqual(await numbers({ fromTime: Number(second.timestamp), toTime: Number(second.timestamp) }), [2]);
  await assert.rejects(methods.aether_blocks([{ fromBlock: 'x' }]), /invalid number/);
});

test('transactions can be filtered by address, direction, kind and amount', async () => {
  const { methods } = await setup();
  const blocks = async (f) => (await methods.aether_txs([f])).items.map((x) => Number(x.blockNumber));
  assert.deepEqual(await blocks({}), [4, 3, 1]);
  assert.deepEqual(await blocks({ address: hex(a.address), direction: 'out' }), [3, 1]);
  assert.deepEqual(await blocks({ address: hex(a.address), direction: 'in' }), [4]);
  assert.deepEqual(await blocks({ address: hex(a.address) }), [4, 3, 1]);
  assert.deepEqual(await blocks({ kind: 'call' }), [3]);
  assert.deepEqual(await blocks({ kind: 'transfer' }), [4, 1]);
  assert.deepEqual(await blocks({ minValue: (3n * WEI).toString() }), [1]);
  assert.deepEqual(await blocks({ status: 'failed' }), []);
  assert.deepEqual(await blocks({ status: 'ok', order: 'asc' }), [1, 3, 4]);
  const item = (await methods.aether_txs([{ limit: 1 }])).items[0];
  assert.equal(item.status, 1);
  assert.ok(item.timestamp > 0);
  assert.equal((await methods.aether_txs([{ address: hex(minerA) }])).total, 0);
});

test('address details show the transaction summary and mined blocks', async () => {
  const { c, methods } = await setup();
  const i = await methods.aether_addressInfo([hex(a.address)]);
  assert.equal(i.sent.count, 2);
  assert.equal(i.received.count, 1);
  assert.ok(Math.abs(i.sent.value - 5e18) < 1e6);
  assert.ok(Math.abs(i.received.value - 2e18) < 1e6);
  assert.ok(i.sent.fees > 0);
  assert.equal(i.first.number, 1);
  assert.equal(i.last.number, 4);
  assert.equal(i.nonce, 2);
  assert.equal(i.isContract, false);
  const m = await methods.aether_addressInfo([hex(minerA)]);
  assert.equal(m.mined.blocks, 3);
  assert.ok(m.mined.income >= 12e18);
  assert.equal(m.mined.last, 4);
  assert.equal(m.first.number, 1);
  const empty = await methods.aether_addressInfo([hex(new Uint8Array(20).fill(7))]);
  assert.equal(empty.first, null);
  assert.equal(empty.mined.blocks, 0);
  assert.equal(c.head.number, 4n);
});

test('chart history consists of intervals and rests on real blocks', async () => {
  const { c, methods } = await setup();
  await mineMany(c, 40);
  const s = await methods.aether_chartSeries([{ points: 10 }]);
  assert.ok(s.items.length >= 5 && s.items.length <= 11);
  const blocks = s.items.reduce((n, p) => n + p.blocks, 0);
  assert.equal(blocks, 44);
  assert.ok(s.items.every((p) => p.difficulty > 0 && p.hashrate > 0 && p.blockTime > 0));
  assert.equal(s.items.reduce((n, p) => n + p.txs, 0), 3);
  const narrow = await methods.aether_chartSeries([{ from: s.first, to: s.first + 30, points: 10 }]);
  assert.ok(narrow.items.reduce((n, p) => n + p.blocks, 0) < 10);
  assert.ok(narrow.bucket < s.bucket);
});

test('a reorganisation rewrites the index and old blocks can be backfilled', async () => {
  const { c, methods } = await setup();
  const { store } = c;
  store.db.exec('DELETE FROM block_index; DELETE FROM tx_index;');
  assert.equal(store.indexedTip(), 0n);
  await c.backfillIndex(2);
  assert.equal(store.indexedTip(), 4n);
  assert.equal((await methods.aether_txs([{}])).total, 3);
  assert.deepEqual((await methods.aether_blocks([{ miner: hex(minerB) }])).items.map((x) => x.number), [2]);
  assert.equal((await methods.aether_txs([{ address: hex(b.address), direction: 'out' }])).items[0].status, 1);
});

test('the miner ranking comes from running totals and is paginated', async () => {
  const { c, methods } = await setup();
  const all = await methods.aether_minerList([{}]);
  assert.equal(all.total, 2);
  assert.equal(all.blocks, 4);
  assert.deepEqual(all.items.map((x) => [x.address, x.blocks, x.first, x.last]), [[hex(minerA), 3, 1, 4], [hex(minerB), 1, 2, 2]]);
  assert.ok(all.items[0].lastTime > 0 && all.items[0].work > 0 && all.items[0].income > 0);
  assert.equal(all.active, 2);
  assert.deepEqual((await methods.aether_minerList([{ limit: 1, offset: 1 }])).items.map((x) => x.address), [hex(minerB)]);
  assert.deepEqual((await methods.aether_minerList([{ order: 'last' }])).items.map((x) => x.last), [4, 2]);
  const found = await methods.aether_minerList([{ address: hex(minerB) }]);
  assert.equal(found.match.rank, 2);
  assert.equal(found.match.blocks, 1);
  assert.equal((await methods.aether_minerList([{ address: hex(new Uint8Array(20).fill(9)) }])).match, null);
  // The pools page reads all-time totals from the same place and they must match walking the blocks.
  const shares = await methods.aether_minerShares([{}]);
  assert.deepEqual(shares.items.map((x) => [x.address, x.blocks]).sort(), [[hex(minerA), 3], [hex(minerB), 1]]);
  // After totals are deleted by hand, the node recomputes them on the next start.
  c.store.db.exec('DELETE FROM miner_index');
  c.store._heal();
  assert.equal((await methods.aether_minerList([{}])).items[0].blocks, 3);
});

test('account counts in the network summary are maintained continuously and match reality', async () => {
  const { c, methods } = await setup();
  const real = (sql) => c.store.db.prepare(sql).get().c;
  const s = methods.aether_stats();
  assert.equal(s.accounts, real('SELECT COUNT(*) AS c FROM accounts'));
  assert.equal(s.holders, real("SELECT COUNT(*) AS c FROM accounts WHERE balance_hex <> '0'"));
  assert.ok(s.accounts >= 4, 'dva účty, dva těžaři');
  assert.equal(s.txCount, real('SELECT COUNT(*) AS c FROM tx_index'));
  assert.equal(s.txCount, 3, 'tři transakce ze čtyř bloků');
  c.store.db.exec("UPDATE counters SET v=0");
  c.store._heal();
  assert.equal(methods.aether_stats().accounts, s.accounts);
  assert.equal(methods.aether_stats().txCount, 3, 'počet transakcí se po rozbití sám opraví');
});

test('the address knows where its first coins came from and when it first and last sent', async () => {
  const { methods } = await setup();
  const infoB = await methods.aether_addressInfo([hex(b.address)]);
  assert.equal(infoB.fundedBy.from.toLowerCase(), hex(a.address), 'první mince poslal účet a');
  assert.equal(infoB.fundedBy.number, 1);
  assert.equal(infoB.firstSent.number, 4);
  assert.equal(infoB.lastSent.number, 4);
  const infoA = await methods.aether_addressInfo([hex(a.address)]);
  assert.equal(infoA.firstSent.number, 1);
  assert.equal(infoA.lastSent.number, 3);
  assert.equal(infoA.fundedBy.number, 4, 'a dostal mince až zpětným převodem');
});

test('24-hour traffic, block reward including fees and chart series', async () => {
  const { methods } = await setup();
  const a = await methods.aether_activity();
  assert.equal(a.txs, 3);
  assert.equal(a.activeAddresses, 2, 'odesílali dva účty');
  assert.equal(a.failed, 0);
  assert.ok(BigInt(a.fees) > 0n && BigInt(a.avgFee) > 0n);
  assert.equal(a.blocks, 3, 'genesis a první blok bez doby těžby se nepočítají');
  assert.equal(a.poolBlocks, 0);
  assert.equal(a.height, 4);
  assert.equal(a.safe, 0, 'bezpečný blok je 32 bloků pod špičkou');
  assert.ok(a.utilization > 0 && a.utilization < 1);
  const { items } = await methods.aether_blocks([{ limit: 10 }]);
  for (const b of items) assert.equal(BigInt(b.income), BigInt(b.reward) + BigInt(b.fees), `blok ${b.number}: odměna je součet`);
  assert.ok(BigInt(items.find((b) => b.number === 1).fees) > 0n, 'blok s převodem má poplatek');
  assert.equal(items.find((b) => b.number === 2).fees, '0', 'prázdný blok nemá poplatky');
  const series = await methods.aether_chartSeries([{ points: 10 }]);
  assert.equal(series.items.reduce((n, p) => n + p.txs, 0), 3);
  assert.ok(series.items.reduce((n, p) => n + p.activeAddresses, 0) >= 2);
  assert.ok(series.items.reduce((n, p) => n + BigInt(p.fees), 0n) > 0n);
});

test('pending transactions come by page and show what they wait for', async () => {
  const { c, methods } = await setup();
  const to = new Address(b.address);
  const nonce = BigInt(await methods.eth_getTransactionCount([hex(a.address), 'latest']));
  await c.mempool.add(transfer(c, a, to, 1n, nonce, { fee: 3n * GWEI, tip: GWEI }));
  await c.mempool.add(transfer(c, a, to, 1n, nonce + 2n, { fee: 9n * GWEI, tip: 5n * GWEI }));
  await c.mempool.add(transfer(c, b, new Address(a.address), 1n, BigInt(await methods.eth_getTransactionCount([hex(b.address), 'latest'])), { fee: 4n * GWEI, tip: 2n * GWEI }));
  const v = await methods.aether_mempool([{}]);
  assert.equal(v.total, 3);
  assert.equal(v.max, 5000);
  assert.ok(v.bytes > 0 && v.oldest > 0);
  assert.deepEqual(v.items.map((x) => BigInt(x.tip)), [5n * GWEI, 2n * GWEI, GWEI], 'nejvyšší spropitné první');
  const gap = v.items.find((x) => BigInt(x.nonce) === nonce + 2n);
  assert.equal(gap.waitingFor, Number(nonce + 1n), 'chybí nonce mezi potvrzenými a čekající');
  assert.equal(v.items.find((x) => BigInt(x.nonce) === nonce).waitingFor, null);
  assert.equal((await methods.aether_mempool([{ address: hex(b.address) }])).total, 1);
  assert.equal((await methods.aether_mempool([{ limit: 1, offset: 2 }])).items.length, 1);
  assert.equal(BigInt(v.tips.max), 5n * GWEI);
});

test('a fork in progress changes filter results the same way as the chain', async () => {
  const alloc = { [hex(a.address)]: { balance: 100n * WEI } };
  const main = await newChain({ alloc });
  const fork = await newChain({ alloc });
  const { methods } = createMethods({ chain: main, mempool: main.mempool, network: null, work: null, version: 'x' });
  await mine(main, { miner: minerA, txs: [transfer(main, a, new Address(b.address), 1n, 0n, { fee: 3n * GWEI })] });
  await mine(main, { miner: minerA });
  for (let i = 0; i < 3; i++) {
    const r = await mine(fork, { miner: minerB, step: 7 });
    if (r.block) main.setClock(Number(r.block.header.timestamp) + 1);
    await main.insertBlock(r.block);
  }
  assert.equal(main.head.miner[0], 0xb2);
  assert.deepEqual((await methods.aether_blocks([{ miner: hex(minerA) }])).items, []);
  assert.equal((await methods.aether_blocks([{}])).total, 3);
  assert.equal((await methods.aether_txs([{}])).total, 0);
  // The miner ranking is recomputed with the index on a reorganisation: the abandoned branch does not stay in it.
  const miners = await methods.aether_minerList([{}]);
  assert.deepEqual(miners.items.map((x) => [x.address, x.blocks, x.first, x.last]), [[hex(minerB), 3, 1, 3]]);
});

test('token transfers of an address: incoming and outgoing newest first, a self-transfer once, without sorting the whole history', () => {
  const store = new Store(join(tmpData(), 'chain.db'));
  const topic = Buffer.from(keccak(new TextEncoder().encode('Transfer(address,address,uint256)')));
  const pad = (addr) => { const p = Buffer.alloc(32); p.set(addr, 12); return p; };
  const insert = store.db.prepare('INSERT INTO logs (number,tx_idx,log_idx,address,t0,t1,t2,t3) VALUES (?,?,?,?,?,?,?,NULL)');
  const token = Buffer.alloc(20, 7);
  const A = Buffer.from(a.address); const B = Buffer.from(b.address); const C = Buffer.alloc(20, 9);
  insert.run(1, 0, 0, token, topic, pad(A), pad(B));
  insert.run(2, 0, 0, token, topic, pad(C), pad(A));
  insert.run(3, 0, 0, token, topic, pad(A), pad(A));
  insert.run(4, 0, 0, token, topic, pad(B), pad(C));
  insert.run(5, 0, 1, token, Buffer.alloc(32, 1), pad(A), pad(B));
  const all = store.holderTransfers(A, topic, 10, 0);
  assert.equal(all.total, 3);
  assert.deepEqual(all.rows.map((r) => r.number), [3, 2, 1]);
  assert.deepEqual(store.holderTransfers(A, topic, 1, 1).rows.map((r) => r.number), [2]);
  const plan = store.db.prepare('EXPLAIN QUERY PLAN SELECT number,tx_idx,log_idx,address,t1,t2,t3 FROM logs WHERE t1=? AND t0=? UNION SELECT number,tx_idx,log_idx,address,t1,t2,t3 FROM logs WHERE t2=? AND t0=? ORDER BY number DESC, log_idx DESC LIMIT 25')
    .all(pad(A), topic, pad(A), topic).map((r) => r.detail).join(' | ');
  assert.match(plan, /logs_t1_number/);
  assert.match(plan, /logs_t2_number/);
  assert.doesNotMatch(plan, /SCAN logs(?! USING)/, `plán: ${plan}`);
  store.close?.();
});

test("pool miners from shares in the window and an operator's pools only from the factory event", async () => {
  const { c, methods } = await setup();
  const topic = (sig) => Buffer.from(keccak(new TextEncoder().encode(sig)));
  const pad = (addr) => { const p = Buffer.alloc(32); p.set(addr, 12); return p; };
  const share = topic('ShareAccepted(address,uint256,uint256,uint256)');
  const created = topic('PoolCreated(address,address,string,uint256,uint256,uint256)');
  const pool = Buffer.alloc(20, 0x51); const fake = Buffer.alloc(20, 0x66); const operator = Buffer.alloc(20, 3);
  const factory = Buffer.from('ae0000000000000000000000000000000000000c', 'hex');
  const m1 = Buffer.alloc(20, 1); const m2 = Buffer.alloc(20, 2);
  const insert = c.store.db.prepare('INSERT INTO logs (number,tx_idx,log_idx,address,t0,t1,t2,t3) VALUES (?,?,?,?,?,?,?,NULL)');
  insert.run(1, 0, 10, pool, share, pad(m1), Buffer.alloc(32));
  insert.run(2, 0, 10, pool, share, pad(m1), Buffer.alloc(32));
  insert.run(3, 0, 10, pool, share, pad(m2), Buffer.alloc(32));
  insert.run(3, 0, 11, fake, share, pad(m2), Buffer.alloc(32));          // a share in another contract does not count
  insert.run(4, 0, 10, factory, created, pad(pool), pad(operator));
  insert.run(4, 0, 11, fake, created, pad(fake), pad(operator));         // the same event outside the factory does not pass for a pool
  const all = await methods.aether_poolMiners([hex(pool), 0]);
  assert.deepEqual(all.items.map((x) => [x.miner.toLowerCase(), x.shares, x.last]), [[hex(m1), 2, 2], [hex(m2), 1, 3]]);
  const window = await methods.aether_poolMiners([hex(pool), 3]);
  assert.deepEqual(window.items.map((x) => x.miner.toLowerCase()), [hex(m2)], 'jen okno od zadaného bloku');
  // A large pool: miners by page, the total count separately and the searched miner with its rank.
  const second = await methods.aether_poolMiners([hex(pool), 0, { limit: 1, offset: 1 }]);
  assert.equal(second.total, 2);
  assert.deepEqual(second.items.map((x) => x.miner.toLowerCase()), [hex(m2)], 'druhá stránka');
  const found = await methods.aether_poolMiners([hex(pool), 0, { limit: 1, miner: hex(m2) }]);
  assert.deepEqual([found.match.miner.toLowerCase(), found.match.rank, found.match.shares, found.match.last], [hex(m2), 2, 1, 3]);
  assert.equal((await methods.aether_poolMiners([hex(pool), 0, { miner: hex(operator) }])).match, null, 'kdo neposlal podíl, není v seznamu');
  const pools = await methods.aether_poolsOf([hex(operator)]);
  assert.deepEqual(pools.map((p) => p.pool.toLowerCase()), [hex(pool)]);
  assert.equal((await methods.aether_poolsOf([hex(m1)])).length, 0);
});
