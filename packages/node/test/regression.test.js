// Regression tests for critical findings from the audit of the previous version (K1 to K7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import { Address, bytesToHex } from '@ethereumjs/util';
import { Chain } from '../src/core/chain.js';
import { Mempool } from '../src/core/mempool.js';
import { CONSENSUS as C, GWEI, NETWORKS, WEI } from '../src/params.js';
import { POW_DIR, mine, mineMany, newChain, tmpData, transfer, wallet } from './helpers/chain.js';

const balance = async (c, addr) => (await (await c.stateAt(c.head.stateRoot)).stateManager.getAccount(new Address(addr)))?.balance ?? 0n;
const fund = (w) => ({ [bytesToHex(w.address)]: { balance: 100n * WEI } });

test('K1: the transaction ID is the hash of the content and cannot be chosen', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  const t1 = transfer(c, a, new Address(b.address), 1n, 0n);
  const t2 = transfer(c, a, new Address(b.address), 2n, 0n);
  assert.notDeepEqual(t1.hash(), t2.hash());
  const raw = t1.serialize();
  raw[raw.length - 40] ^= 1; // changing the signed data changes both the hash and the sender
  const { decodeTx } = await import('../src/core/types.js');
  let changed;
  try { changed = decodeTx(raw, c.common); } catch { changed = null; }
  if (changed) assert.notDeepEqual(changed.hash(), t1.hash());
});

test('K2: the node does not change signed data; a transaction with any fee does not stop mining', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  const tx = createFeeMarket1559Tx({
    chainId: c.network.chainId, nonce: 0n, to: new Address(b.address), value: 1n, gasLimit: 50000n, maxFeePerGas: 9n * GWEI, maxPriorityFeePerGas: 0n,
  }, { common: c.common }).sign(a.key);
  await c.mempool.add(tx);
  const r = await mine(c, { txs: c.mempool.pending() });
  assert.equal(r.res.status, 'added');
  assert.equal(c.getBlock(c.head.hash()).txs.length, 1);
  assert.equal((await mine(c, { txs: c.mempool.pending() })).res.status, 'added');
});

test('K4: difficulty does not change after a restart; it is derived from the chain', async () => {
  const dir = tmpData();
  let clock = Number(NETWORKS.dev.genesisTimestamp);
  const open = async () => {
    const chain = await Chain.open({ network: NETWORKS.dev, dataDir: dir, powDir: POW_DIR, now: () => clock });
    chain.tick = (s) => { clock += s; };
    chain.mempool = new Mempool(chain);
    return chain;
  };
  let c = await open();
  await mineMany(c, 12, { step: 2 });
  const expected = c.nextDifficulty(c.head);
  assert.ok(expected > 1n, 'rychlé bloky zvedly obtížnost');
  await c.close();
  c = await open();
  assert.equal(c.nextDifficulty(c.head), expected);
  assert.equal((await mine(c, { step: 2 })).res.status, 'added');
  await c.close();
});

test('K5: a reorganisation to a shorter heavier branch survives a restart', async () => {
  const dir = tmpData();
  let clock = Number(NETWORKS.dev.genesisTimestamp);
  const x = await Chain.open({ network: NETWORKS.dev, dataDir: dir, powDir: POW_DIR, now: () => clock });
  x.tick = (s) => { clock += s; };
  x.mempool = new Mempool(x);
  const y = await newChain();
  const m = wallet();
  await mineMany(x, 12, { step: 60 });
  const blocks = [];
  for (let i = 0; i < 11; i++) blocks.push((await mine(y, { step: 1, miner: m.address })).block);
  assert.ok(y.headTd > x.headTd, `práce ${y.headTd} proti ${x.headTd}`);
  clock = y.now() + 1000;
  const statuses = [];
  for (const b of blocks) statuses.push((await x.insertBlock(b)).status);
  assert.ok(statuses.includes('reorg'), statuses.join(','));
  assert.equal(x.head.number, 11n);
  assert.equal(x.store.canonicalHash(12), undefined, 'stará špička zmizela z řetězce');
  const root = x.head.stateRoot;
  await x.close();
  const r = await Chain.open({ network: NETWORKS.dev, dataDir: dir, powDir: POW_DIR, now: () => clock });
  assert.equal(r.head.number, 11n);
  assert.deepEqual(r.head.stateRoot, root);
  assert.equal(await balance(r, m.address), 44n * WEI);
  assert.deepEqual(r.getBlockByNumber(11).hash(), blocks[10].hash());
  await r.close();
});

test('K7: amounts in consensus are integers; the block format does not accept text', async () => {
  const c = await newChain();
  const { Block } = await import('../src/core/types.js');
  const { RLP } = await import('@ethereumjs/rlp');
  const b = (await mine(c)).block;
  const fields = b.header.fields();
  fields[6] = new Uint8Array([0, 1]); // non-canonical number with a leading zero
  assert.throws(() => Block.decode(RLP.encode([fields, []]), c.common), /nekanonické/);
  fields[6] = [new Uint8Array(1)];
  assert.throws(() => Block.decode(RLP.encode([fields, []]), c.common));
});

test('fees are not burned: all coins stay in circulation and the miner gets the full fee', async () => {
  const a = wallet(); const b = wallet(); const m = wallet();
  const c = await newChain({ alloc: fund(a) });
  await mine(c, { miner: m.address, txs: [transfer(c, a, new Address(b.address), WEI, 0n)] });
  await mine(c, { miner: m.address, txs: [transfer(c, a, new Address(b.address), WEI, 1n)] });
  // Base fee 1 gwei and tip 1 gwei, two transactions of 21,000 gas each.
  const fees = 2n * 21000n * (GWEI + GWEI);
  assert.equal(c.store.feesAt(c.head.number), fees);
  assert.equal(await balance(c, m.address), 2n * C.initialReward + fees, 'odměny a celý poplatek');
  const total = (await balance(c, a.address)) + (await balance(c, b.address)) + (await balance(c, m.address));
  assert.equal(total, 100n * WEI + 2n * C.initialReward, 'mince vznikají jen odměnou za blok');
});

test("PREVRANDAO returns the parent's mixHash, not zero", async () => {
  // Code: returns DIFFICULTY/PREVRANDAO (0x44) from the call and stores it in slot 0.
  const contract = '0x00000000000000000000000000000000000c0de1';
  const a = wallet();
  const c = await newChain({ alloc: { ...fund(a), [contract]: { code: '0x4460005500' } } });
  await mine(c);
  const parent = c.head;
  assert.notDeepEqual(parent.mixHash, new Uint8Array(32));
  const tx = transfer(c, a, new Address(Buffer.from(contract.slice(2), 'hex')), 0n, 0n, { gas: 100000n });
  await mine(c, { txs: [tx] });
  const s = await c.stateAt(c.head.stateRoot);
  const value = await s.stateManager.getStorage(new Address(Buffer.from(contract.slice(2), 'hex')), new Uint8Array(32));
  assert.equal(Buffer.from(value).toString('hex').replace(/^0+/, ''), Buffer.from(parent.mixHash).toString('hex').replace(/^0+/, ''));
});

test('K8: a block rejected by an old program version is accepted by the new version after the update', async () => {
  const dir = tmpData();
  const forked = { ...NETWORKS.dev, forks: [{ ...NETWORKS.dev.forks[0], block: 2n }] };
  const source = await newChain({ network: forked });
  await mine(source);
  const forkBlock = (await mine(source)).block;

  let clock = Number(forked.genesisTimestamp) + 1000;
  const open = (network) => Chain.open({ network, dataDir: dir, powDir: POW_DIR, now: () => clock });
  const old = await open({ ...forked, forks: [] });
  await old.insertBlock(source.getBlock(forkBlock.header.parentHash));
  await assert.rejects(old.insertBlock(forkBlock), /kořen stavu/);
  await assert.rejects(old.insertBlock(forkBlock), /dříve odmítnutý/);
  await old.close();

  const updated = await open(forked);
  assert.equal((await updated.insertBlock(forkBlock)).status, 'added');
  assert.equal(updated.head.number, 2n);
  await updated.close();
});
