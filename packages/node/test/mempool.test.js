// Pending transactions must not get stuck: they survive a node restart and a full queue creates no nonce gap for anyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Address } from '@ethereumjs/util';
import { ethers } from 'ethers';
import { AetherNode } from '../src/node.js';
import { Mempool } from '../src/core/mempool.js';
import { decodeTx } from '../src/core/types.js';
import { GWEI, NETWORKS, WEI } from '../src/params.js';
import { POW_DIR, mine, newChain, tmpData, transfer, wallet } from './helpers/chain.js';

const fund = (...ws) => Object.fromEntries(ws.map((w) => [`0x${Buffer.from(w.address).toString('hex')}`, { balance: 100n * WEI }]));
const hashes = (pool) => new Set(pool.all().map((tx) => ethers.hexlify(tx.hash())));
const hex = (tx) => ethers.hexlify(tx.hash());

test("a full queue evicts the sender's last transaction, never a middle one", async () => {
  const a = wallet(); const b = wallet(); const c = wallet(); const d = wallet();
  const chain = await newChain({ alloc: fund(a, b, c, d) });
  const pool = new Mempool(chain, { maxPool: 4 });
  const to = new Address(wallet().address);
  const tx = (w, nonce, fee) => transfer(chain, w, to, 1n, nonce, { fee: fee * GWEI, tip: GWEI });
  const a0 = tx(a, 0n, 9n); const a1 = tx(a, 1n, 3n); const a2 = tx(a, 2n, 9n); const b0 = tx(b, 0n, 5n);
  for (const t of [a0, a1, a2, b0]) await pool.add(t);

  // The cheapest is a1 in the middle of a sequence. Evicting it would block a2, so b0 from the end of its sequence goes out.
  const c0 = tx(c, 0n, 6n);
  await pool.add(c0);
  assert.deepEqual(hashes(pool), new Set([a0, a1, a2, c0].map(hex)));

  // Nobody at the end of a sequence is cheaper than the new one: the queue rejects it and evicts nothing.
  await assert.rejects(pool.add(tx(d, 0n, 4n)), /fronta je plná/);
  assert.equal(pool.size, 4);

  // Further transactions from the same sender do not push out its own earlier one, which would then be missing.
  const a3 = tx(a, 3n, 20n);
  await pool.add(a3);
  assert.deepEqual(hashes(pool), new Set([a0, a1, a2, a3].map(hex)));
  const order = [];
  for await (const t of pool.pending()) order.push(t.nonce);
  assert.deepEqual(order, [0n, 1n, 2n, 3n], 'celá řada jde do bloku');
});

test('the queue is saved and loaded after a restart; mined and old transactions are dropped', async () => {
  const a = wallet(); const b = wallet(); const c = wallet();
  const chain = await newChain({ alloc: fund(a, b, c) });
  const to = new Address(wallet().address);
  const path = join(tmpData(), 'mempool.bin');
  const a0 = transfer(chain, a, to, 1n, 0n); const a1 = transfer(chain, a, to, 2n, 1n); const b0 = transfer(chain, b, to, 3n, 0n);
  const old = transfer(chain, c, to, 4n, 0n);
  await chain.mempool.add(a0, { local: true, addedAt: Date.now() - 60_000 });
  await chain.mempool.add(a1, { local: true });
  await chain.mempool.add(b0);
  await chain.mempool.add(old, { addedAt: Date.now() - 7 * 3600_000 });
  assert.ok(chain.mempool.save(path) && existsSync(path));
  const savedAt = [...chain.mempool.byHash.values()].find((e) => e.tx === a0).addedAt;

  // Meanwhile b0 gets mined. After a restart only what is still pending returns to the queue.
  await mine(chain, { txs: [b0] });
  await chain.mempool.settled();
  const restarted = new Mempool(chain);
  assert.equal(await restarted.restore(path), 2);
  assert.deepEqual(hashes(restarted), new Set([a0, a1].map(hex)));
  assert.equal([...restarted.byHash.values()].find((e) => hex(e.tx) === hex(a0)).addedAt, savedAt, 'čas přidání zůstal, šestihodinová lhůta běží dál');
  assert.deepEqual(restarted.local(30_000).map(hex), [hex(a0)], 'znovu se rozesílá jen vlastní transakce, která čeká déle');
  assert.equal(restarted.dirty, true, 'soubor se přepíše bez zahozených položek');

  assert.equal(await new Mempool(chain).restore(join(tmpData(), 'neexistuje.bin')), 0);
});

test('a cancelled payment does not come back from the saved queue after a node crash', async () => {
  const a = wallet();
  const chain = await newChain({ alloc: fund(a) });
  const path = join(tmpData(), 'mempool.bin');
  const pool = new Mempool(chain);
  assert.equal(await pool.restore(path), 0, 'zatím nic uloženého');
  const payment = transfer(chain, a, new Address(wallet().address), 5n * WEI, 0n, { fee: 10n * GWEI, tip: GWEI });
  await pool.add(payment, { local: true });
  pool.save(path);
  // Cancellation: an empty payment to oneself with the same nonce and a higher fee. The node then crashes before saving the queue again.
  const cancel = transfer(chain, a, new Address(a.address), 0n, 0n, { fee: 20n * GWEI, tip: 2n * GWEI });
  await pool.add(cancel, { local: true });
  const after = new Mempool(chain);
  assert.equal(await after.restore(path), 0, 'původní platba se nevrátila');
  assert.equal(after.size, 0);
  // The next save writes only the cancellation and the replacement record disappears.
  pool.save(path);
  const again = new Mempool(chain);
  assert.equal(await again.restore(path), 1);
  assert.deepEqual(hashes(again), new Set([hex(cancel)]));
});

test('after a restart the node knows a transaction sent before it and mines it', async () => {
  const sender = ethers.Wallet.createRandom();
  let clock = Number(NETWORKS.dev.genesisTimestamp);
  const dataDir = tmpData();
  const options = {
    network: NETWORKS.dev, dataDir, powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
    alloc: { [sender.address]: { balance: 10n * WEI } }, now: () => clock, log: () => {},
  };
  const first = await new AetherNode(options).start();
  const raw = await sender.signTransaction({ type: 2, chainId: NETWORKS.dev.chainId, nonce: 0, to: ethers.Wallet.createRandom().address, value: WEI, gasLimit: 21000n, maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: GWEI });
  const tx = ethers.Transaction.from(raw);
  await first.sendTx(decodeTx(ethers.getBytes(raw), first.chain.commonAt(1n)));
  await first.stop();

  const second = await new AetherNode(options).start();
  try {
    assert.equal(second.mempool.size, 1, 'transakce přežila restart');
    assert.ok(second.mempool.has(ethers.getBytes(tx.hash)));
    clock += 15;
    const block = await second.chain.buildTemplate({ miner: new Uint8Array(20).fill(0xbb), txs: second.mempool.pending(), budgetMs: Infinity });
    assert.equal(block.txs.length, 1, 'jde do dalšího bloku');
  } finally {
    await second.stop();
  }
});

test('a replacement in a full queue evicts nobody and the original transaction disappears only with it', async () => {
  const a = wallet(); const b = wallet();
  const chain = await newChain({ alloc: fund(a, b) });
  const pool = new Mempool(chain, { maxPool: 2 });
  const to = new Address(wallet().address);
  const tx = (w, nonce, fee, tip = 1n) => transfer(chain, w, to, 1n, nonce, { fee: fee * GWEI, tip: tip * GWEI });
  const a0 = tx(a, 0n, 5n); const b0 = tx(b, 0n, 3n);
  await pool.add(a0); await pool.add(b0);
  // A weak replacement does not pass and the original stays.
  await assert.rejects(pool.add(tx(a, 0n, 5n, 1n)), /už je ve frontě|o 10 %/);
  assert.deepEqual(hashes(pool), new Set([a0, b0].map(hex)));
  const a0b = tx(a, 0n, 10n, 2n);
  await pool.add(a0b);
  assert.deepEqual(hashes(pool), new Set([a0b, b0].map(hex)), 'náhrada zabrala místo původní, cizí transakce zůstala');
});
