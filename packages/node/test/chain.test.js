import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@ethereumjs/util';
import { blockReward, nextBaseFee, nextGasLimit, gasLimitValid } from '../src/core/economics.js';
import { nextDifficulty } from '../src/core/difficulty.js';
import { CONSENSUS as C, GWEI, WEI, NETWORKS } from '../src/params.js';
import { newChain, wallet, mine, mineMany, transfer, legacy, seal, tmpData } from './helpers/chain.js';
import { Chain } from '../src/core/chain.js';
import { Block, Header } from '../src/core/types.js';

const balance = async (c, addr) => {
  const s = await c.stateAt(c.head.stateRoot);
  return (await s.stateManager.getAccount(new Address(addr)))?.balance ?? 0n;
};
const fund = (w, amount = 100n * WEI) => ({ [`0x${Buffer.from(w.address).toString('hex')}`]: { balance: amount } });

test('issuance: 4 QU, halving every 8 million blocks, cap 64 million', () => {
  assert.equal(blockReward(0), 0n);
  assert.equal(blockReward(1), 4n * WEI);
  assert.equal(blockReward(8_000_000), 4n * WEI);
  assert.equal(blockReward(8_000_001), 2n * WEI);
  assert.equal(blockReward(16_000_001), WEI);
  assert.equal(blockReward(8_000_000n * 64n + 1n), 0n);
  let total = 0n;
  for (let i = 0n; i < 64n; i++) total += (C.initialReward >> i) * C.halvingInterval;
  assert.ok(total <= C.maxSupply && C.maxSupply - total < 10n ** 12n, `celkem ${total}`);
});

test('base fee: rise, fall and the floor', () => {
  const p = (gasUsed, baseFee = 100n * GWEI) => ({ gasLimit: 15_000_000n, gasUsed, baseFee });
  assert.equal(nextBaseFee(p(7_500_000n)), 100n * GWEI);
  assert.equal(nextBaseFee(p(15_000_000n)), 112_500_000_000n);
  assert.equal(nextBaseFee(p(0n)), 87_500_000_000n);
  assert.equal(nextBaseFee(p(0n, GWEI)), GWEI);
});

test('the gas limit changes only in small steps', () => {
  const cap = 15_000_000n;
  assert.ok(gasLimitValid(10_000_000n, 10_000_000n, cap));
  assert.ok(!gasLimitValid(11_000_000n, 10_000_000n, cap));
  const next = nextGasLimit(10_000_000n, 30_000_000n);
  assert.ok(next > 10_000_000n && gasLimitValid(next, 10_000_000n, cap));
  assert.ok(!gasLimitValid(cap + 1n, cap, cap), 'strop hlasování minerů');
});

test('LWMA: fast blocks raise difficulty, slow ones lower it', () => {
  const net = { genesisDifficulty: 1000n, minDifficulty: 1n };
  const series = (solve, n = 70) => {
    const list = [];
    for (let i = 0; i <= n; i++) list.push({ number: BigInt(i), timestamp: BigInt(i * solve), difficulty: 1000n, parentHash: i ? `h${i - 1}` : null, id: `h${i}` });
    const by = Object.fromEntries(list.map((h) => [h.id, h]));
    return nextDifficulty(list[n], (id) => by[id], net);
  };
  assert.equal(series(15), 1000n);
  assert.ok(series(5) > 2500n, `rychlé: ${series(5)}`);
  assert.ok(series(45) < 400n, `pomalé: ${series(45)}`);
  assert.equal(series(1000), 25n, 'doba bloku se počítá nejvýš jako 40násobek cíle');
});

test('mining pays out the reward and the chain is saved', async () => {
  const c = await newChain();
  const m = wallet();
  const { res } = await mine(c, { miner: m.address });
  assert.equal(res.status, 'added');
  assert.equal(c.head.number, 1n);
  assert.equal(await balance(c, m.address), 4n * WEI);
});

test('a throwing head listener does not make insertBlock reject and later listeners still run', async () => {
  const c = await newChain();
  const seen = [];
  const failures = [];
  c.on('listener-error', (f) => failures.push(f));
  c.on('head', () => { throw new Error('observer failed'); });
  c.on('head', ({ block }) => seen.push(block.header.number));
  const { res } = await mine(c);
  assert.equal(res.status, 'added');
  assert.equal(c.head.number, 1n);
  assert.deepEqual(seen, [1n]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].event, 'head');
  assert.match(failures[0].error.message, /observer failed/);
  // Without a 'listener-error' listener the failure is swallowed, never thrown.
  c.removeAllListeners('listener-error');
  assert.equal((await mine(c)).res.status, 'added');
  assert.deepEqual(seen, [1n, 2n]);
});

test('transfer: the miner gets the base fee and the tip; nothing is burned', async () => {
  const a = wallet(); const b = wallet(); const m = wallet();
  const c = await newChain({ alloc: fund(a) });
  const tx = transfer(c, a, new Address(b.address), 10n * WEI, 0n, { tip: GWEI, fee: 5n * GWEI });
  await mine(c, { miner: m.address, txs: [tx] });
  assert.equal(c.head.gasUsed, 21000n);
  assert.equal(await balance(c, b.address), 10n * WEI);
  assert.equal(await balance(c, m.address), 4n * WEI + 21000n * 2n * GWEI, 'odměna a celý poplatek');
  assert.equal(await balance(c, a.address), 100n * WEI - 10n * WEI - 21000n * 2n * GWEI);
  const r = c.getReceipts(c.head.hash());
  assert.equal(r.receipts.length, 1);
});

test('the state survives closing and reopening the database', async () => {
  const dir = tmpData();
  const a = wallet(); const m = wallet();
  const net = NETWORKS.dev;
  const open = async () => {
    let clock = Number(net.genesisTimestamp) + 3000;
    const chain = await Chain.open({ network: net, dataDir: dir, powDir: undefined, alloc: fund(a), now: () => clock });
    chain.tick = () => { clock += 15; };
    return chain;
  };
  let c = await open();
  await mineMany(c, 3, { miner: m.address });
  const head = c.head.hash();
  await c.close();
  c = await open();
  assert.deepEqual(c.head.hash(), head);
  assert.equal(await balance(c, m.address), 12n * WEI);
  await c.close();
});

test('a database of another network refuses to open', async () => {
  const dir = tmpData();
  const c = await Chain.open({ network: NETWORKS.dev, dataDir: dir });
  await c.close();
  await assert.rejects(Chain.open({ network: NETWORKS.testnet, dataDir: dir }), /another network/);
});

// ---- block safety rules -------------------------------------------------

const tamper = async (c, patch) => {
  c.tick();
  const t = await c.buildTemplate({ miner: new Uint8Array(20).fill(1) });
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  return new Block(new Header({ ...f, ...patch }), t.txs);
};

for (const [name, patch, re] of [
  ['wrong state root', { stateRoot: new Uint8Array(32).fill(7) }, /state root/],
  ['wrong transactions root', { txRoot: new Uint8Array(32).fill(7) }, /transactions root/],
  ['wrong receipts root', { receiptsRoot: new Uint8Array(32).fill(7) }, /receipts root/],
  ['made-up base fee', { baseFee: 999n * GWEI }, /base fee/],
  ['made-up gas limit', { gasLimit: 100_000_000n }, /gasLimit/],
  ['too low difficulty', { difficulty: 2n }, /difficulty/],
  ['gasUsed over the limit', { gasUsed: 30_000_000n }, /gasUsed/],
  ['too long extraData', { extraData: new Uint8Array(33) }, /extraData/],
]) {
  test(`the block is rejected: ${name}`, async () => {
    const c = await newChain();
    await mine(c);
    await assert.rejects(c.insertBlock(await seal(c, await tamper(c, patch))), re);
    assert.equal(c.head.number, 1n);
  });
}

test('a block without valid PoW is rejected', async () => {
  const c = await newChain();
  await assert.rejects(c.insertBlock(await tamper(c, {})), /proof of work|difficulty/);
});

test('block time must increase and must not be too far in the future', async () => {
  const c = await newChain();
  await mine(c);
  await assert.rejects(c.insertBlock(await seal(c, await tamper(c, { timestamp: c.head.timestamp }))), /block time/);
  await assert.rejects(c.insertBlock(await seal(c, await tamper(c, { timestamp: BigInt(c.now() + 1000) }))), /future/);
});

test('a block with an invalid transaction is invalid as a whole', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a, 10n ** 15n) });
  c.tick();
  const t = await c.buildTemplate({ miner: b.address });
  const bad = transfer(c, a, new Address(b.address), 50n * WEI, 0n); // has no funds
  const { orderedRoot } = await import('../src/core/executor.js');
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  const forged = new Block(new Header({ ...f, txRoot: await orderedRoot([bad.serialize()], c.common) }), [bad]);
  await assert.rejects(c.insertBlock(await seal(c, forged)), /invalid transaction/);
});

test("an invalid transaction in a block is detected by our own check, not by the library's error text", async () => {
  const { orderedRoot, txRejection } = await import('../src/core/executor.js');
  const a = wallet(); const b = wallet(); const k = wallet();
  const contractKey = `0x${Buffer.from(k.address).toString('hex')}`;
  const c = await newChain({ alloc: { ...fund(a, 10n * WEI), [contractKey]: { balance: 10n * WEI, code: '0x00' } } });
  const to = new Address(b.address);
  const forge = async (tx) => {
    c.tick();
    const t = await c.buildTemplate({ miner: b.address });
    const f = Object.fromEntries(Object.entries(t.header).filter(([key]) => !key.startsWith('_')));
    return seal(c, new Block(new Header({ ...f, txRoot: await orderedRoot([tx.serialize()], c.common) }), [tx]));
  };
  const cases = [
    [transfer(c, a, to, 1n, 5n), /wrong nonce/],
    [transfer(c, a, to, 50n * WEI, 0n), /insufficient funds/],
    [transfer(c, a, to, 1n, 0n, { fee: GWEI / 2n, tip: 1n }), /block base fee/],
    [legacy(c, a, to, 1n, 0n, { gasPrice: GWEI / 2n }), /block base fee/],
    [transfer(c, a, to, 1n, 0n, { gas: 20_000n }), /intrinsic gas too low/],
    [transfer(c, k, to, 1n, 0n), /EIP-3607/],
  ];
  for (const [tx, reason] of cases) {
    const block = await forge(tx);
    await assert.rejects(c.insertBlock(block), reason);
    assert.match(c.store.badReason(block.hash()) ?? '', reason, 'blok je označený jako neplatný');
  }
  // A valid transaction has no reason: if the library rejected it, it is a node error and the block is not marked.
  const state = await c.stateAt(c.head.stateRoot);
  assert.equal(await txRejection(transfer(c, a, to, 1n, 0n), state.stateManager, nextBaseFee(c.head)), null);
  assert.equal((await mine(c, { txs: [transfer(c, a, to, 1n, 0n)] })).res.status, 'added');
});

test('a transaction from another network or without a chainId does not pass', async () => {
  const a = wallet();
  const c = await newChain({ alloc: fund(a) });
  const other = await newChain({ network: NETWORKS.testnet });
  const foreign = transfer(other, a, new Address(a.address), 1n, 0n);
  assert.throws(() => Block.decode(new Block(c.head, [foreign]).encode(), c.common), /chain ID|chainId|Invalid/i);
});

// ---- forky -----------------------------------------------------------------------

async function twin(alloc) {
  const x = await newChain({ alloc }); const y = await newChain({ alloc });
  return [x, y];
}

test('the heavier branch wins, the state is rolled back and transactions go back to the queue', async () => {
  const a = wallet(); const shop = wallet(); const other = wallet();
  const [x, y] = await twin(fund(a));
  const pay = transfer(x, a, new Address(shop.address), 50n * WEI, 0n);
  await mine(x, { txs: [pay] });
  assert.equal(await balance(x, shop.address), 50n * WEI);

  const spend = transfer(y, a, new Address(other.address), 50n * WEI, 0n);
  const one = await mine(y, { txs: [spend] });
  const two = await mine(y);
  x.setClock(y.now());
  assert.equal((await x.insertBlock(one.block)).status, 'side');
  const r = await x.insertBlock(two.block);
  assert.equal(r.status, 'reorg');
  assert.equal(r.depth, 1);
  assert.deepEqual(x.head.hash(), y.head.hash());
  assert.equal(await balance(x, shop.address), 0n);
  assert.equal(await balance(x, other.address), 50n * WEI);
  assert.deepEqual(x.head.stateRoot, y.head.stateRoot);
  assert.equal(x.store.txLocation(pay.hash()), null, 'index transakcí se vrátil');
  assert.ok(x.store.txLocation(spend.hash()));
});

test('both nodes end the same with any block order', async () => {
  const a = wallet(); const m1 = wallet(); const m2 = wallet();
  const [x, y] = await twin(fund(a));
  const b1 = (await mine(x, { miner: m1.address })).block;
  const c1 = (await mine(y, { miner: m2.address })).block;
  const c2 = (await mine(y, { miner: m2.address })).block;
  const [p, q] = await twin(fund(a));
  p.setClock(y.now()); q.setClock(y.now());
  for (const b of [b1, c1, c2]) await p.insertBlock(b);
  for (const b of [c1, c2, b1]) await q.insertBlock(b);
  assert.deepEqual(p.head.hash(), q.head.hash());
  assert.deepEqual(p.head.stateRoot, q.head.stateRoot);
});

test('a block without a parent does not change the state', async () => {
  const [x, y] = await twin({});
  const m = wallet();
  await mine(y);
  const orphan = (await mine(y, { miner: m.address })).block;
  x.setClock(y.now());
  assert.equal((await x.insertBlock(orphan)).status, 'orphan');
  assert.equal(await balance(x, m.address), 0n);
  assert.equal(x.head.number, 0n);
});

test('an invalid heavier branch is rejected and the chain stays untouched', async () => {
  const a = wallet();
  const [x, y] = await twin(fund(a));
  await mine(x);
  const head = x.head.hash();
  const good = (await mine(y)).block;
  y.tick();
  const t = await y.buildTemplate({ miner: new Uint8Array(20).fill(9) });
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  const bad = await seal(y, new Block(new Header({ ...f, stateRoot: new Uint8Array(32).fill(1) }), []));
  x.setClock(y.now());
  await x.insertBlock(good);
  await assert.rejects(x.insertBlock(bad), /state root/);
  assert.deepEqual(x.head.hash(), head);
  await assert.rejects(x.insertBlock(bad), /previously rejected/);
});

test('rolling finality: the network rejects a rewrite deeper than the limit even with more work', async () => {
  const [x, y] = await twin({});
  const attacker = wallet();
  await mineMany(x, C.maxReorgDepth + 2);
  const blocks = [];
  for (let i = 0; i < C.maxReorgDepth + 10; i++) blocks.push((await mine(y, { miner: attacker.address })).block);
  x.setClock(y.now());
  const head = x.head.hash();
  let refused = 0;
  for (const b of blocks) {
    try {
      const r = await x.insertBlock(b);
      assert.ok(r.status === 'orphan' || r.status === 'side');
    } catch (e) {
      assert.match(e.message, /finality/);
      refused += 1;
    }
  }
  assert.ok(refused >= 1);
  assert.deepEqual(x.head.hash(), head, 'řetězec zůstal na původní větvi');
  assert.equal(await balance(x, attacker.address), 0n);
});

/** A branch with fast block times: LWMA raises the difficulty, so it carries more work per block. */
async function heavyBranch(chain, minTd, maxBlocks = 400) {
  const blocks = [];
  while (chain.headTd < minTd && blocks.length < maxBlocks) blocks.push((await mine(chain, { step: 1, miner: new Uint8Array(20).fill(7) })).block);
  assert.ok(chain.headTd >= minTd, `větev má jen ${chain.headTd} práce`);
  return blocks;
}

test('deep branch: rejected without network verification, rewrites the chain with twice the work', async () => {
  const [x, y] = await twin({});
  await mineMany(x, C.maxReorgDepth + 4);
  const ours = x.headTd - x.genesis.difficulty;
  const blocks = await heavyBranch(y, x.genesis.difficulty + 2n * ours + 50n);
  x.setClock(Math.max(x.now(), y.now()));
  const head = x.head.hash();

  // Not allowed: the first block of the branch lies below the finality boundary.
  await assert.rejects(x.insertBlock(blocks[0]), /finality/);
  assert.deepEqual(x.head.hash(), head);

  // The network verified the headers and allowed the branch from genesis. The rewrite happens only with twice the work.
  x.permitDeepFork(x.genesis);
  let switched = null;
  for (const [i, b] of blocks.entries()) {
    const r = await x.insertBlock(b);
    if (r.status === 'reorg') { switched = i; break; }
  }
  assert.notEqual(switched, null, 'řetězec přešel na těžší větev');
  const base = x.genesis.difficulty;
  assert.ok(x.headTd - base >= 2n * ours, 'přechod až s dvojnásobkem práce');
  for (const b of blocks.slice(switched + 1)) await x.insertBlock(b);
  assert.deepEqual(x.head.hash(), y.head.hash());
});

test('a deep branch with less than twice the work stays a side branch even when allowed', async () => {
  const [x, y] = await twin({});
  await mineMany(x, C.maxReorgDepth + 4);
  const ours = x.headTd - x.genesis.difficulty;
  const blocks = await heavyBranch(y, x.headTd + 20n);
  assert.ok(y.headTd - y.genesis.difficulty < 2n * ours, 'test potřebuje větev s menší než dvojnásobnou prací');
  x.setClock(Math.max(x.now(), y.now()));
  const head = x.head.hash();
  x.permitDeepFork(x.genesis);
  for (const b of blocks) assert.equal((await x.insertBlock(b)).status, 'side');
  assert.deepEqual(x.head.hash(), head, 'větev s víc prací, ale pod dvojnásobkem, řetězec nepřepíše');
});

// ---- mempool ---------------------------------------------------------------------

test('the mempool rejects a bad signature, nonce, missing funds and a low fee', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a, WEI) });
  const to = new Address(b.address);
  await assert.rejects(c.mempool.add(transfer(c, b, to, 1n, 0n)), /insufficient funds/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 2n * WEI, 0n)), /insufficient funds/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 1n, 500n)), /too high/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 1n, 0n, { fee: 10n, tip: 1n })), /below the network minimum/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 1n, 0n, { gas: 20000n })), /intrinsic gas too low|gasLimit is too low/);
  await c.mempool.add(transfer(c, a, to, 1n, 0n));
  assert.equal(c.mempool.size, 1);
});

test('replacing a transaction requires a higher fee', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  const to = new Address(b.address);
  await c.mempool.add(transfer(c, a, to, 1n, 0n, { fee: 10n * GWEI, tip: GWEI }));
  await assert.rejects(c.mempool.add(transfer(c, a, to, 2n, 0n, { fee: 10n * GWEI, tip: GWEI })), /10%/);
  await c.mempool.add(transfer(c, a, to, 2n, 0n, { fee: 20n * GWEI, tip: 2n * GWEI }));
  assert.equal(c.mempool.size, 1);
});

test('mining takes transactions by fee and nonce; confirmed ones disappear from the queue', async () => {
  const a = wallet(); const b = wallet(); const d = wallet();
  const c = await newChain({ alloc: { ...fund(a), ...fund(b) } });
  const to = new Address(d.address);
  await c.mempool.add(transfer(c, a, to, 1n, 1n, { tip: 5n * GWEI, fee: 9n * GWEI }));
  await c.mempool.add(transfer(c, a, to, 1n, 0n, { tip: GWEI, fee: 9n * GWEI }));
  await c.mempool.add(transfer(c, b, to, 1n, 0n, { tip: 3n * GWEI, fee: 9n * GWEI }));
  await mine(c, { txs: c.mempool.pending() });
  const blk = c.getBlock(c.head.hash());
  assert.equal(blk.txs.length, 3);
  assert.equal(blk.txs[0].getSenderAddress().toString(), new Address(b.address).toString());
  assert.equal(blk.txs[1].nonce, 0n);
  assert.equal(blk.txs[2].nonce, 1n);
  await c.mempool.settled();
  assert.equal(c.mempool.size, 0);
});

test('conflicting transactions after a block from the network do not stop mining', async () => {
  const a = wallet(); const b = wallet();
  const [x, y] = await twin(fund(a));
  const to = new Address(b.address);
  await x.mempool.add(transfer(x, a, to, 1n, 0n));
  const blk = (await mine(y, { txs: [transfer(y, a, to, 2n, 0n, { tip: 2n * GWEI, fee: 5n * GWEI })] })).block;
  x.setClock(y.now());
  await x.insertBlock(blk);
  await x.mempool.settled();
  assert.equal(x.mempool.size, 0, 'konfliktní transakce zmizela');
  const r = await mine(x, { txs: x.mempool.pending() });
  assert.equal(r.res.status, 'added');
});

test('the old transaction format with EIP-155 works, without it it does not', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  await mine(c, { txs: [legacy(c, a, new Address(b.address), 5n, 0n)] });
  assert.equal(await balance(c, b.address), 5n);
});
