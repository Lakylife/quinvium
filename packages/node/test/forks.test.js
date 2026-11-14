// Upgrade plan: rules change exactly at the fork height and nodes recognise each other by it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Network } from '../src/p2p/network.js';
import { forkCompatible, forkId, forkIndex, rulesAt } from '../src/core/forks.js';
import { GENESIS_RULES, NETWORKS } from '../src/params.js';
import { mine, mineMany, newChain } from './helpers/chain.js';
import { Address } from '@ethereumjs/util';
import { fromHex } from '../src/util/bytes.js';
import upgrades from '../src/genesis/upgrades.json' with { type: 'json' };

const GENESIS = new Uint8Array(32).fill(9);
const until = async (cond, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
};

const withFork = (block, rules = { maxGasLimit: 12_000_000n }) => ({ ...NETWORKS.dev, forks: [{ name: 'test', block, rules }] });

test('the rules apply exactly from the fork height', () => {
  const n = withFork(100n);
  assert.equal(rulesAt(n, 99n).maxGasLimit, GENESIS_RULES.maxGasLimit);
  assert.equal(rulesAt(n, 100n).maxGasLimit, 12_000_000n);
  assert.equal(forkIndex(n, 99n), 0);
  assert.equal(forkIndex(n, 100n), 1);
  assert.deepEqual(rulesAt(n, 100n).eips, GENESIS_RULES.eips, 'co fork nemění, zůstává');
});

test('the identifier changes with every fork and depends on the genesis', () => {
  const plain = forkId({ ...NETWORKS.dev, forks: [] }, GENESIS, 0n);
  assert.equal(plain.next, 0n);
  const n = withFork(100n);
  const before = forkId(n, GENESIS, 99n);
  const after = forkId(n, GENESIS, 100n);
  assert.equal(before.next, 100n);
  assert.equal(after.next, 0n);
  assert.notDeepEqual(before.hash, after.hash);
  assert.deepEqual(before.hash, plain.hash);
  assert.notDeepEqual(forkId(n, new Uint8Array(32).fill(1), 0n).hash, before.hash);
});

test('compatibility per EIP-2124', () => {
  const n = withFork(100n);
  const old = { ...NETWORKS.dev, forks: [] }; // software bez znalosti forku
  const stale = forkId(old, GENESIS, 200n); // old node past the fork height
  const synced = forkId(n, GENESIS, 200n);
  const syncing = forkId(n, GENESIS, 50n);

  assert.ok(forkCompatible(n, GENESIS, 200n, synced), 'stejná verze');
  assert.ok(forkCompatible(n, GENESIS, 50n, syncing), 'oba před forkem');
  assert.ok(forkCompatible(n, GENESIS, 200n, syncing), 'protistrana dohání a fork zná');
  assert.ok(forkCompatible(n, GENESIS, 50n, synced), 'my doháníme a fork známe');
  assert.ok(!forkCompatible(n, GENESIS, 200n, stale), 'starý software za výškou forku je pryč');
  assert.ok(!forkCompatible(old, GENESIS, 200n, syncing), 'protistrana čeká fork, který jsme minuli');
  assert.ok(forkCompatible(old, GENESIS, 50n, syncing), 'před výškou forku spolu ještě mluví');
  assert.ok(!forkCompatible(n, GENESIS, 50n, { hash: new Uint8Array(4), next: 0n }), 'cizí historie');
});

test('a fork really changes the consensus rules at the given height', async () => {
  // The gas limit cap drops below the current limit, so a block with the original limit does not pass after the fork.
  const network = withFork(3n, { maxGasLimit: 9_000_000n });
  const c = await newChain({ network });
  await mineMany(c, 2);
  assert.equal(c.head.number, 2n);
  await assert.rejects(mine(c), /gasLimit/, 'limit nad novým stropem je od výšky forku neplatný');
});

test('every rules version has its own EVM configuration', async () => {
  const noMcopy = { ...GENESIS_RULES, eips: GENESIS_RULES.eips.filter((e) => e !== 5656) };
  const network = { ...NETWORKS.dev, forks: [{ name: 'mcopy', block: 3n, rules: { eips: [...GENESIS_RULES.eips] } }] };
  const c = await newChain({ network });
  assert.notEqual(c.commonAt(1n), c.commonAt(3n), 'každá verze pravidel má vlastní konfiguraci');
  assert.ok(c.commonAt(5n).isActivatedEIP(5656));
  const base = { ...NETWORKS.dev, forks: [{ name: 'bez', block: 1n, rules: noMcopy }] };
  const d = await newChain({ network: base });
  assert.ok(!d.commonAt(5n).isActivatedEIP(5656));
  assert.ok(d.commonAt(0n).isActivatedEIP(5656));
});

test('a node with old software disconnects cleanly from the network after a fork', async () => {
  const fresh = await newChain({ network: withFork(2n, {}) });
  const old = await newChain();
  // Both have the same genesis and differ only in knowing the fork. The new node is past its height.
  assert.deepEqual(fresh.genesis.hash(), old.genesis.hash());
  await mineMany(fresh, 3);
  const a = new Network({ chain: fresh, mempool: fresh.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  const b = new Network({ chain: old, mempool: old.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  await a.start(); await b.start();
  const reasons = [];
  a.on('peer-disconnected', (_, r) => reasons.push(r));
  b.on('peer-disconnected', (_, r) => reasons.push(r));
  b.connect('127.0.0.1', a.port);
  assert.ok(await until(() => reasons.some((r) => /neslučitelná pravidla/.test(r))), `důvody: ${reasons.join('; ')}`);
  assert.equal(old.head.number, 0n, 'starý uzel nepřevzal nic z nové větve');
  await a.stop(); await b.stop();
});

test('two nodes with the same fork plan talk to each other and sync across the fork', async () => {
  const network = withFork(3n, {});
  const a = await newChain({ network });
  const b = await newChain({ network });
  await mineMany(a, 6);
  const na = new Network({ chain: a, mempool: a.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  const nb = new Network({ chain: b, mempool: b.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  b.setClock(a.now());
  await na.start(); await nb.start();
  nb.connect('127.0.0.1', na.port);
  assert.ok(await until(() => b.head.number === 6n), `výška ${b.head.number}`);
  assert.deepEqual(a.head.stateRoot, b.head.stateRoot);
  await na.stop(); await nb.stop();
});

test('the pools fork adds the factory exactly at its height and a second node reaches the same state', async () => {
  const network = { ...NETWORKS.dev, forks: [{ ...NETWORKS.dev.forks[0], block: 3n }] };
  const c = await newChain({ network });
  const factory = new Address(fromHex(upgrades.PoolFactory.address));
  const codeAt = async (chain) => (await chain.stateAt(chain.head.stateRoot)).stateManager.getCode(factory);
  const blocks = [];
  blocks.push((await mine(c)).block, (await mine(c)).block);
  assert.equal((await codeAt(c)).length, 0, 'před forkem kontrakt není');
  blocks.push((await mine(c)).block);
  assert.deepEqual(await codeAt(c), fromHex(upgrades.PoolFactory.code));
  const account = await (await c.stateAt(c.head.stateRoot)).stateManager.getAccount(factory);
  assert.equal(account.nonce, 1n);
  blocks.push((await mine(c)).block);
  assert.deepEqual(await codeAt(c), fromHex(upgrades.PoolFactory.code), 'zůstane i v dalším bloku');

  const d = await newChain({ network });
  for (const b of blocks) {
    d.setClock(Number(b.header.timestamp));
    assert.equal((await d.insertBlock(b)).status, 'added');
  }
  assert.deepEqual(d.head.stateRoot, c.head.stateRoot);

  // A node without the fork rejects the same block: that is exactly why it disconnects in time.
  const old = await newChain({ network: { ...NETWORKS.dev, forks: [] } });
  old.setClock(Number(blocks[0].header.timestamp));
  await old.insertBlock(blocks[0]);
  old.setClock(Number(blocks[1].header.timestamp));
  await old.insertBlock(blocks[1]);
  old.setClock(Number(blocks[2].header.timestamp));
  await assert.rejects(old.insertBlock(blocks[2]), /kořen stavu/);
});
