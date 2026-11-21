// Display names of pools: only the operator of a pool from the given factory sets one, for a fee that stays locked,
// at most once every 30 days; names are unique per factory and the pool whose own name it is keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { AetherNode, loadAlloc } from '../../node/src/node.js';
import { NETWORKS, WEI } from '../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../node/test/helpers/chain.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const net = { ...NETWORKS.dev };
const [alice, bob, carol] = Array.from({ length: 3 }, () => ethers.Wallet.createRandom());
const FEE = 10n * WEI;
const DAY = 86400;
let clock = Number(net.genesisTimestamp);

const alloc = { ...loadAlloc() };
for (const w of [alice, bob, carol]) alloc[w.address] = { balance: 10000n * WEI };
const node = new AetherNode({
  network: net, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
  alloc, now: () => clock, log: () => {},
});

let provider;
let factory;
let names;
const OTHER = '0x' + 'bb'.repeat(20);
const G = { gasLimit: 1_000_000n };

async function mineBlock(step = 15) {
  clock += step;
  const w = await node.work.getWork(ethers.getBytes(OTHER));
  const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
  const sealed = await seal(node.chain, tpl);
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  assert.ok(r.accepted, r.reason);
  await node.mempool.settled();
}
async function ok(pending) {
  const tx = await pending;
  await mineBlock();
  const r = await provider.getTransactionReceipt(tx.hash);
  assert.equal(r.status, 1);
  return r;
}
async function fails(pending, error) {
  const tx = await pending;
  await mineBlock();
  const r = await provider.getTransactionReceipt(tx.hash);
  assert.equal(r.status, 0, `${error} expected`);
  const e = await provider.call({ ...tx, blockTag: undefined }).catch((x) => x);
  if (error) assert.equal(names.interface.parseError(e?.data ?? e?.info?.error?.data ?? "0x")?.name, error);
}
const as = (w) => names.connect(w.connect(provider));
async function createPool(owner, name) {
  const f = factory.connect(owner.connect(provider));
  const r = await ok(f.createPool(name, '', 100, 16, 2, ethers.ZeroAddress));
  return factory.interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === factory.target.toLowerCase())).args.pool;
}

test.before(async () => {
  await node.start();
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
  await mineBlock();
  factory = await new ethers.ContractFactory(artifacts.PoolFactory2.abi, artifacts.PoolFactory2.bytecode, alice.connect(provider)).deploy();
  names = await new ethers.ContractFactory(artifacts.PoolNames.abi, artifacts.PoolNames.bytecode, alice.connect(provider)).deploy();
  await mineBlock();
});

test.after(async () => {
  provider.destroy();
  await node.stop();
});

test('the registry is an ordinary contract whose code apps can check', async () => {
  const code = await provider.getCode(names.target);
  assert.equal(createHash('sha256').update(ethers.getBytes(code)).digest('hex'), artifacts.PoolNames.runtimeSha256);
});

test('only the operator of a factory pool sets a name, for the exact fee, which stays locked', async () => {
  const pool = await createPool(alice, 'Alpha Pool');
  await fails(as(bob).setName(factory.target, pool, 'Bob Pool', '', { ...G, value: FEE }), 'NotOperator');
  await fails(as(alice).setName(factory.target, OTHER, 'Alpha', '', { ...G, value: FEE }));
  await fails(as(alice).setName(factory.target, pool, 'Alpha Mining', '', { ...G, value: FEE - 1n }), 'WrongFee');
  const before = await provider.getBalance(names.target);
  await ok(as(alice).setName(factory.target, pool, 'Alpha Mining', 'https://alpha.example', { ...G, value: FEE }));
  const [name, website, changedAt] = await names.nameOf(factory.target, pool);
  assert.equal(name, 'Alpha Mining');
  assert.equal(website, 'https://alpha.example');
  assert.ok(changedAt > 0n);
  assert.equal(await provider.getBalance(names.target), before + FEE, 'the fee stays in the contract');
  assert.equal(names.interface.fragments.some((f) => f.type === 'function' && /withdraw|owner/i.test(f.name)), false, 'nobody can take it out');
});

test('a name can change only after 30 days', async () => {
  const pool = await createPool(alice, 'Beta Pool');
  await ok(as(alice).setName(factory.target, pool, 'Beta One', '', { ...G, value: FEE }));
  await fails(as(alice).setName(factory.target, pool, 'Beta Two', '', { ...G, value: FEE }), 'TooSoon');
  await mineBlock(30 * DAY);
  await ok(as(alice).setName(factory.target, pool, 'Beta Two', '', { ...G, value: FEE }));
  assert.equal((await names.nameOf(factory.target, pool))[0], 'Beta Two');
  assert.equal(await names.holderOf(factory.target, await names.keyOf('Beta One')), ethers.ZeroAddress, 'the old name is free again');
});

test('names are unique without case and separators, and invalid names are refused', async () => {
  const a = await createPool(alice, 'Gamma Pool');
  const b = await createPool(bob, 'Delta Pool');
  await ok(as(alice).setName(factory.target, a, 'Fast Pool', '', { ...G, value: FEE }));
  await fails(as(bob).setName(factory.target, b, 'fast-pool', '', { ...G, value: FEE }), 'NameTaken');
  await fails(as(bob).setName(factory.target, b, 'F.A.S.T pool', '', { ...G, value: FEE }), 'NameTaken');
  for (const bad of ['ab', ' Leading', 'Trailing ', 'two  spaces', 'Emoji 🙂', 'Ünïcode', 'x'.repeat(33), '...']) {
    assert.equal(await names.keyOf(bad), ethers.ZeroHash, bad);
  }
  await fails(as(bob).setName(factory.target, b, 'Bob Pool', 'http://insecure.example', { ...G, value: FEE }), 'InvalidWebsite');
  await fails(as(bob).setName(factory.target, b, 'Bob Pool', 'https://has space', { ...G, value: FEE }), 'InvalidWebsite');
});

test('the pool whose own name it is takes it back from an impostor', async () => {
  const impostor = await createPool(carol, 'Something');
  await ok(as(carol).setName(factory.target, impostor, 'Quinvium Pool', '', { ...G, value: FEE }));
  const original = await createPool(alice, 'Quinvium Pool');
  await ok(as(alice).setName(factory.target, original, 'quinvium-pool', '', { ...G, value: FEE }));
  assert.equal(await names.holderOf(factory.target, await names.keyOf('Quinvium Pool')), original);
  assert.equal((await names.nameOf(factory.target, impostor))[0], '', 'the impostor loses the name');
  // A second pool that is also called so in its contract cannot take it from the first one.
  const copy = await createPool(bob, 'Quinvium Pool');
  await fails(as(bob).setName(factory.target, copy, 'Quinvium Pool', '', { ...G, value: FEE }), 'NameTaken');
});

test('names are kept per factory', async () => {
  const other = await new ethers.ContractFactory(artifacts.PoolFactory2.abi, artifacts.PoolFactory2.bytecode, bob.connect(provider)).deploy();
  await mineBlock();
  const f = other.connect(bob.connect(provider));
  const r = await ok(f.createPool('Fast Pool', '', 100, 16, 2, ethers.ZeroAddress));
  const pool = other.interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === other.target.toLowerCase())).args.pool;
  // 'Fast Pool' is taken in the first factory, not in this one.
  await ok(as(bob).setName(other.target, pool, 'Fast Pool', '', { ...G, value: FEE }));
});
