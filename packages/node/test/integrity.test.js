// Can someone change data and gain coins by it? Each test performs such an attempt and verifies that it fails and is detected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import { Account, Address, bytesToHex } from '@ethereumjs/util';
import { auditChain } from '../src/audit.js';
import { Chain } from '../src/core/chain.js';
import { blockReward, emitted } from '../src/core/economics.js';
import { InvalidBlock, openState } from '../src/core/executor.js';
import { nextDifficulty } from '../src/core/difficulty.js';
import { Block, Header } from '../src/core/types.js';
import { CONSENSUS as C, NETWORKS, WEI } from '../src/params.js';
import { toHex } from '../src/util/bytes.js';
import { POW_DIR, mine, mineMany, newChain, seal, tmpData, transfer, wallet } from './helpers/chain.js';

const fund = (...ws) => Object.fromEntries(ws.map((w) => [bytesToHex(w.address), { balance: 1000n * WEI }]));
const opening = (...ws) => BigInt(ws.length) * 1000n * WEI;
const fields = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('_')));
const audit = (dataDir, network, alloc, extra = {}) => auditChain({ network, dataDir, powDir: POW_DIR, alloc, now: () => Number(network.genesisTimestamp) + 10 ** 7, ...extra });

/** A chain on disk with transfers, so there is something to forge. */
async function sampleChain() {
  const a = wallet();
  const b = wallet();
  const alloc = fund(a, b);
  const dataDir = tmpData();
  const chain = await newChain({ alloc, dataDir });
  for (let i = 0; i < 6; i++) await mine(chain, { txs: [transfer(chain, a, b.address, WEI, BigInt(i))] });
  const head = chain.head;
  await chain.close();
  return { a, b, alloc, dataDir, head };
}

const edit = (dataDir, fn) => {
  const db = new DatabaseSync(join(dataDir, 'chain.db'));
  fn(db);
  db.close();
};

test('a clean chain passes and all coins have an origin', async () => {
  const { a, b, alloc, dataDir, head } = await sampleChain();
  const r = await audit(dataDir, NETWORKS.dev, alloc);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.height, head.number.toString());
  assert.equal(r.blocks, 6);
  assert.equal(r.transactions, 6);
  assert.equal(r.supply, emitted(6n) + opening(a, b), 'součet všech účtů je přesně emise');
  assert.equal(r.burned, 0n);
  assert.ok(r.stateNodes > 0);
});

test('a balance overwritten in the database is detected even while the node keeps running', async () => {
  const { alloc, dataDir } = await sampleChain();
  edit(dataDir, (db) => {
    const row = db.prepare('SELECT k, v FROM kv WHERE length(v) > 60 LIMIT 1').get();
    const v = Buffer.from(row.v);
    v[v.length - 1] ^= 1;
    db.prepare('UPDATE kv SET v=? WHERE k=?').run(v, row.k);
  });
  const r = await audit(dataDir, NETWORKS.dev, alloc, { quick: true });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /nesouhlasí se svým hashem/);
});

test('a changed transaction in a stored block is detected', async () => {
  const { alloc, dataDir } = await sampleChain();
  edit(dataDir, (db) => {
    const row = db.prepare("SELECT hash, body FROM blocks WHERE number=3").get();
    const body = Buffer.from(row.body);
    body[body.length - 40] ^= 1;
    db.prepare('UPDATE blocks SET body=? WHERE hash=?').run(body, row.hash);
  });
  const r = await audit(dataDir, NETWORKS.dev, alloc);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /blok 3|bloku 3/);
});

test('a changed header is detected; the hash protects it', async () => {
  const { alloc, dataDir } = await sampleChain();
  edit(dataDir, (db) => {
    const row = db.prepare('SELECT hash, header FROM blocks WHERE number=2').get();
    const header = Buffer.from(row.header);
    header[50] ^= 1;
    db.prepare('UPDATE blocks SET header=? WHERE hash=?').run(header, row.hash);
  });
  const r = await audit(dataDir, NETWORKS.dev, alloc);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /hlavička bloku 2|bloku 2/);
});

test('a block slipped into the canonical chain is detected', async () => {
  const { alloc, dataDir } = await sampleChain();
  edit(dataDir, (db) => {
    const other = db.prepare('SELECT hash FROM canonical WHERE number=4').get();
    db.prepare('UPDATE canonical SET hash=? WHERE number=5').run(other.hash);
  });
  const r = await audit(dataDir, NETWORKS.dev, alloc);
  assert.equal(r.ok, false);
});

test('a fake balance in the Explorer index is detected', async () => {
  const { a, alloc, dataDir } = await sampleChain();
  edit(dataDir, (db) => db.prepare('UPDATE accounts SET balance_hex=? WHERE addr=?').run('ffffffffffff', Buffer.from(a.address)));
  const r = await audit(dataDir, NETWORKS.dev, alloc);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /rejstřík zůstatků lže/.test(p)), r.problems.join('; '));
});

test('a miner cannot credit itself extra coins: the network rejects a block with a forged state', async () => {
  const thief = wallet();
  const chain = await newChain({ alloc: fund(wallet()) });
  await mineMany(chain, 2);
  chain.tick();
  const template = await chain.buildTemplate({ miner: thief.address, budgetMs: Infinity });
  // A bad miner computes a state in which it has 1000 QU more and honestly mines a block on it.
  const { db, stateManager } = await openState(chain.store, chain.common, chain.head.stateRoot);
  const address = new Address(thief.address);
  await stateManager.putAccount(address, new Account(0n, blockReward(3n) + 1000n * WEI));
  await stateManager.flush();
  const forged = await stateManager.getStateRoot();
  db.flush();
  const block = new Block(new Header({ ...fields(template.header), stateRoot: forged }), template.txs);
  const sealed = await seal(chain, block);
  await assert.rejects(chain.insertBlock(sealed), (e) => e instanceof InvalidBlock && /kořen stavu/.test(e.message));
  assert.equal(chain.head.number, 2n, 'řetězec se nepohnul');
});

test('foreign coins cannot be spent: an amount changed after signing points to another sender', async () => {
  const victim = wallet();
  const chain = await newChain({ alloc: fund(victim) });
  await mineMany(chain, 1);
  const signed = transfer(chain, victim, wallet().address, WEI, 0n);
  const json = signed.toJSON();
  const tampered = createFeeMarket1559Tx({ ...json, value: 900n * WEI, type: 2 }, { common: chain.common });
  assert.notDeepEqual(tampered.getSenderAddress().bytes, new Address(victim.address).bytes, 'podpis už nepatří oběti');
  await assert.rejects(mine(chain, { mutate: (b) => new Block(b.header, [tampered]) }), /transakcí|neplatn|nelze|Invalid|invalid|nonce|sender|balance/i);
  await assert.rejects(chain.mempool.add(tampered), /./);
});

test('the same transaction cannot be counted twice', async () => {
  const a = wallet();
  const chain = await newChain({ alloc: fund(a) });
  const tx = transfer(chain, a, wallet().address, WEI, 0n);
  await mine(chain, { txs: [tx] });
  chain.tick();
  const template = await chain.buildTemplate({ miner: new Uint8Array(20).fill(1), budgetMs: Infinity });
  const { orderedRoot } = await import('../src/core/executor.js');
  const again = new Header({ ...fields(template.header), txRoot: await orderedRoot([tx.serialize()], chain.common) });
  const block = await seal(chain, new Block(again, [tx]));
  await assert.rejects(chain.insertBlock(block), InvalidBlock);
  assert.equal(chain.head.number, 1n);
});

test('issuance never exceeds the 64 million cap', () => {
  assert.equal(emitted(0n), 0n);
  assert.equal(emitted(1n), 4n * WEI);
  assert.equal(emitted(8_000_000n), 32_000_000n * WEI);
  assert.equal(emitted(8_000_001n), 32_000_000n * WEI + 2n * WEI);
  assert.ok(emitted(10n ** 12n) <= C.maxSupply);
  assert.equal(emitted(10n ** 12n), emitted(10n ** 13n), 'po posledním půlení už nic nevzniká');
});

test('checkpoint: the network rejects a foreign branch at the given height even with more work', async () => {
  const honest = await newChain();
  await mineMany(honest, 4);
  const network = { ...NETWORKS.dev, checkpoints: [{ number: 3n, hash: toHex(honest.getHeaderByNumber(3n).hash()) }] };
  const chain = await newChain({ network });
  for (let n = 1n; n <= 4n; n += 1n) await chain.insertBlock(honest.getBlockByNumber(n));
  assert.equal(chain.head.number, 4n);
  const attacker = await newChain();
  for (let i = 0; i < 8; i++) await mine(attacker, { miner: new Uint8Array(20).fill(9) });
  const results = [];
  for (let n = 1n; n <= 8n; n += 1n) results.push(await chain.insertBlock(attacker.getBlockByNumber(n)).catch((e) => e));
  assert.ok(results.some((r) => r instanceof InvalidBlock && /kontrolní/.test(r.message)), 'přepis pod kontrolním bodem je zastavený');
  assert.equal(chain.head.hash().toString(), honest.head.hash().toString(), 'řetězec zůstal na poctivé větvi');
});

test('checkpoint: a new node rejects a foreign chain and does not open a database on a foreign branch', async () => {
  const honest = await newChain();
  await mineMany(honest, 3);
  const fake = await newChain();
  await mine(fake, { miner: new Uint8Array(20).fill(7) });
  await mine(fake, { miner: new Uint8Array(20).fill(7) });
  const network = { ...NETWORKS.dev, checkpoints: [{ number: 2n, hash: toHex(honest.getHeaderByNumber(2n).hash()) }] };
  const fresh = await newChain({ network });
  await fresh.insertBlock(fake.getBlockByNumber(1n));
  await assert.rejects(fresh.insertBlock(fake.getBlockByNumber(2n)), /kontrolnímu bodu/);
  const dataDir = tmpData();
  const onDisk = await newChain({ dataDir });
  await mine(onDisk, { miner: new Uint8Array(20).fill(7) });
  await mine(onDisk, { miner: new Uint8Array(20).fill(7) });
  await onDisk.close();
  await assert.rejects(Chain.open({ network, dataDir, powDir: POW_DIR }), /kontrolnímu bodu/);
});

/**
 * Mining by the real rules but without nonce search: difficulty and times go through the real `nextDifficulty`.
 * The attacker has a `share` of the hashrate and writes whatever time suits it into blocks, within the bounds nodes accept.
 */
function simulate({ blocks, share, stamp, seed = 1 }) {
  let x = seed;
  const random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
  const network = { genesisDifficulty: 10n ** 12n, minDifficulty: 2n ** 16n };
  const hashrate = 10n ** 12n / 15n;
  const byHash = new Map();
  let parent = { number: 0n, timestamp: 0n, difficulty: network.genesisDifficulty, hash: 0n, parentHash: -1n };
  byHash.set(0n, parent);
  let clock = 0;
  const out = [];
  for (let i = 1n; i <= BigInt(blocks); i += 1n) {
    const difficulty = nextDifficulty(parent, (h) => byHash.get(h), network);
    const solve = -Math.log(1 - random()) * (Number(difficulty) / Number(hashrate));
    clock += solve;
    const evil = random() < share;
    const earliest = parent.timestamp + 1n;
    const honestTime = BigInt(Math.floor(clock));
    const wanted = evil ? stamp({ clock, parent, earliest }) : honestTime;
    const latest = BigInt(Math.floor(clock) + C.futureTimeLimit);
    const timestamp = wanted < earliest ? earliest : wanted > latest ? latest : wanted;
    const block = { number: i, timestamp, difficulty, hash: i, parentHash: parent.hash };
    byHash.set(i, block);
    if (i > 100n) { const old = byHash.get(i - 100n); if (old) byHash.delete(old.parentHash); }
    parent = block;
    out.push({ clock, difficulty: Number(difficulty) });
  }
  const skip = 500;
  const tail = out.slice(skip);
  return { blockTime: (tail.at(-1).clock - tail[0].clock) / (tail.length - 1), low: Math.min(...tail.map((b) => b.difficulty)), high: Math.max(...tail.map((b) => b.difficulty)) };
}

test('difficulty: without an attack the network keeps the target block time', () => {
  const r = simulate({ blocks: 8000, share: 0, stamp: ({ clock }) => BigInt(Math.floor(clock)) });
  assert.ok(Math.abs(r.blockTime - C.targetBlockTime) < 1.2, `čas bloku ${r.blockTime}`);
});

test('difficulty: a miner with 30 % of hashrate cannot pull difficulty down by shifting time into the future', () => {
  const r = simulate({ blocks: 8000, share: 0.3, stamp: ({ clock }) => BigInt(Math.floor(clock) + C.futureTimeLimit) });
  assert.ok(r.blockTime > 12 && r.blockTime < 18.5, `čas bloku ${r.blockTime}`);
  assert.ok(r.low > 2e11, `nejnižší obtížnost ${r.low}`);
});

test('difficulty: a miner with 30 % of hashrate cannot drive it up with the shortest times', () => {
  const r = simulate({ blocks: 8000, share: 0.3, stamp: ({ earliest }) => earliest });
  assert.ok(r.blockTime > 12 && r.blockTime < 18.5, `čas bloku ${r.blockTime}`);
});

test('difficulty: even a miner with 49 % of hashrate does not change the block pace by more than a quarter', () => {
  for (const seed of [1, 7, 42]) {
    const forward = simulate({ blocks: 8000, seed, share: 0.49, stamp: ({ clock }) => BigInt(Math.floor(clock) + C.futureTimeLimit) });
    const back = simulate({ blocks: 8000, seed, share: 0.49, stamp: ({ earliest }) => earliest });
    for (const r of [forward, back]) assert.ok(r.blockTime > 11.25 && r.blockTime < 18.75, `čas bloku ${r.blockTime}`);
  }
});
