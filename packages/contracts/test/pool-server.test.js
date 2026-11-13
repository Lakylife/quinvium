// Server poolu na skutečném uzlu: těžaři přes RPC i Stratum, dávky podílů a automatická výplata.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { RLP } from '@ethereumjs/rlp';
import { AetherNode, loadAlloc } from '../../node/src/node.js';
import { Header } from '../../node/src/core/types.js';
import { bytesToBigInt, targetForDifficulty } from '../../node/src/crypto/ethash.js';
import { encodeAddressArray, encodeBytesArray } from '../../node/src/mining/pool.js';
import { NETWORKS, WEI } from '../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../node/test/helpers/chain.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const net0 = { ...NETWORKS.dev, genesisDifficulty: 64n, minDifficulty: 64n };
const [operator, alice, bob, carol] = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
const payerKey = ethers.getBytes(ethers.randomBytes(32));
const payer = new ethers.Wallet(ethers.hexlify(payerKey));
let clock = Number(net0.genesisTimestamp);

const alloc = { ...loadAlloc() };
for (const w of [operator, alice, bob, carol, payer]) alloc[w.address] = { balance: 1000n * WEI };
const node = new AetherNode({
  network: net0, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
  alloc, now: () => clock, log: () => {},
});

let provider;
let pool;
let poolAddress;
const rpc = async (method, params = []) => {
  const r = await fetch(`http://127.0.0.1:${node.rpc.port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

async function mineBlock(miner = '0x' + 'bb'.repeat(20)) {
  clock += 15;
  const w = await node.work.getWork(ethers.getBytes(miner));
  const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
  const sealed = await seal(node.chain, tpl);
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  assert.ok(r.accepted, r.reason);
  await node.mempool.settled();
}

async function ok(pending) {
  const tx = await pending;
  await mineBlock();
  assert.equal((await provider.getTransactionReceipt(tx.hash)).status, 1);
}

/** Hledá nonce pro cíl jako skutečný miner. */
async function solve(seal_, number, target, filter = () => true) {
  const hash = ethers.getBytes(seal_);
  for (let n = 1n; ; n++) {
    const nonce = ethers.getBytes(ethers.zeroPadValue(ethers.toBeHex(n), 8));
    const { mixDigest, result } = await node.chain.pow.compute(hash, nonce, number);
    const value = bytesToBigInt(result);
    if (value <= BigInt(target) && filter(value)) return { nonce, mixDigest, value };
  }
}

test.before(async () => {
  await node.start();
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
  await mineBlock();
  const factory = new ethers.Contract(artifacts.PoolFactory.address, artifacts.PoolFactory.abi, operator.connect(provider));
  const tx = await factory.createPool('Server', 'http://127.0.0.1', 100, 16, 4);
  await mineBlock();
  const receipt = await provider.getTransactionReceipt(tx.hash);
  poolAddress = factory.interface.parseLog(receipt.logs.find((l) => l.address.toLowerCase() === artifacts.PoolFactory.address)).args.pool;
  pool = new ethers.Contract(poolAddress, artifacts.AetherPool.abi, operator.connect(provider));
});

test.after(async () => {
  provider.destroy();
  await node.stop();
});

test('kódování dávek je stejné jako ABI', () => {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const items = [new Uint8Array(0), new Uint8Array(31).fill(1), new Uint8Array(32).fill(2), new Uint8Array(33).fill(3), new Uint8Array(620).fill(4)];
  assert.equal(ethers.hexlify(encodeBytesArray(new Uint8Array(0), items)), coder.encode(['bytes[]'], [items]));
  const addresses = [alice.address, bob.address];
  assert.equal(ethers.hexlify(encodeAddressArray(new Uint8Array(0), addresses.map((a) => ethers.getBytes(a)))), coder.encode(['address[]'], [addresses]));
});

test('bez poolu těžba poolu nefunguje a cizí kontrakt pool nespustí', async () => {
  assert.equal(await rpc('aether_poolInfo'), null);
  await assert.rejects(rpc('aether_poolWork', [alice.address]), /nevede pool/);
  await assert.rejects(node.startPool(ethers.getBytes(alice.address), payerKey), /není pool z továrny/);
  await assert.rejects(node.startPool(ethers.getBytes(artifacts.Notary.address), payerKey), /není pool z továrny/);
  assert.equal(node.pool, undefined);
});

test('každý těžař hashuje vlastní hlavičku a podíly jdou do kontraktu', async () => {
  await node.startPool(ethers.getBytes(poolAddress), payerKey, { minShareDifficulty: 4n });
  const [sealA, seed, target, number, fieldsA, address] = await rpc('aether_poolWork', [alice.address, 'rig1']);
  const [sealB] = await rpc('aether_poolWork', [bob.address]);
  assert.notEqual(sealA, sealB);
  assert.equal(address, poolAddress.toLowerCase());
  assert.equal(ethers.keccak256(fieldsA), sealA, 'těžař si může ověřit, co hashuje');
  const decoded = RLP.decode(ethers.getBytes(fieldsA));
  assert.equal(ethers.hexlify(decoded[1]), poolAddress.toLowerCase());
  assert.equal(ethers.hexlify(decoded[11].subarray(0, 20)), alice.address.toLowerCase());
  assert.equal(BigInt(ethers.hexlify(decoded[11].subarray(20))), 4n);
  assert.equal(BigInt(target), targetForDifficulty(4n));
  assert.ok(seed.startsWith('0x'));

  const reject = async (nonce, mix, reason, s = sealA) => {
    const r = await rpc('aether_poolSubmit', [ethers.hexlify(nonce), s, ethers.hexlify(mix)]);
    assert.equal(r.accepted, false);
    assert.match(r.reason, reason);
  };
  await reject(new Uint8Array(8), new Uint8Array(32), /obtížnost|práce/);
  await reject(new Uint8Array(8), new Uint8Array(32), /stará/, '0x' + '11'.repeat(32));

  const n = BigInt(number);
  const a = await solve(sealA, n, target, (v) => v > targetForDifficulty(64n));
  const b = await solve(sealB, n, target, (v) => v > targetForDifficulty(64n));
  const r = await rpc('aether_poolSubmit', [ethers.hexlify(a.nonce), sealA, ethers.hexlify(a.mixDigest)]);
  assert.equal(r.accepted, true);
  assert.equal(r.block, null);
  await reject(a.nonce, a.mixDigest, /už byl/);
  assert.equal((await rpc('aether_poolSubmit', [ethers.hexlify(b.nonce), sealB, ethers.hexlify(b.mixDigest)])).accepted, true);

  const info = await rpc('aether_poolInfo');
  assert.equal(info.workers, 2);
  assert.equal(info.queue, 2);
  assert.equal(info.shares, 2);
  assert.equal(info.payer, payer.address.toLowerCase());
  assert.ok(info.hashrate > 0);

  await node.pool.flush();
  assert.equal(node.mempool.size, 1);
  const before = await provider.getBalance(payer.address);
  await mineBlock();
  assert.ok((await provider.getBalance(payer.address)) < before, 'gas platí účet serveru');
  assert.deepEqual([...(await pool.windowWork(alice.address))], [8n, 4n]);
});

test('podíl splňující obtížnost sítě vytěží blok pro kontrakt', async () => {
  const [sealA, , target, number] = await rpc('aether_poolWork', [alice.address, 'rig1']);
  const balance = await provider.getBalance(poolAddress);
  const difficulty = node.chain.head.difficulty;
  clock += 15;
  const a = await solve(sealA, BigInt(number), target, (v) => v <= targetForDifficulty(difficulty));
  const r = await rpc('aether_poolSubmit', [ethers.hexlify(a.nonce), sealA, ethers.hexlify(a.mixDigest)]);
  assert.equal(r.accepted, true);
  assert.equal(r.block?.number, Number(number));
  const block = await provider.getBlock(Number(number));
  assert.equal(block.miner.toLowerCase(), poolAddress.toLowerCase());
  assert.equal(block.extraData.slice(0, 42), alice.address.toLowerCase());
  assert.ok((await provider.getBalance(poolAddress)) > balance);
  assert.equal(node.pool.stats.blocks, 1);
  await node.mempool.settled();
  await mineBlock();
  assert.deepEqual([...(await pool.windowWork(alice.address))].map(BigInt), [12n, 8n]);
});

function client() {
  const socket = net.connect(node.stratum.port, '127.0.0.1');
  socket.setEncoding('utf8');
  const lines = [];
  const waiters = [];
  let buffer = '';
  socket.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const m = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      const w = waiters.findIndex((f) => f.test(m));
      if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
      else lines.push(m);
    }
  });
  const send = (o) => socket.write(`${JSON.stringify(o)}\n`);
  const wait = (test_) => {
    const i = lines.findIndex(test_);
    if (i >= 0) return Promise.resolve(lines.splice(i, 1)[0]);
    return new Promise((resolve) => waiters.push({ test: test_, resolve }));
  };
  return { socket, send, wait };
}

test('těžař přes ETHPROXY dostane podíl připsaný na svou adresu', async () => {
  const c = client();
  c.send({ id: 1, method: 'eth_submitLogin', params: [`${carol.address}.asic1`] });
  assert.equal((await c.wait((m) => m.id === 1)).result, true);
  c.send({ id: 2, method: 'eth_getWork', params: [] });
  const [sealHash, , target] = (await c.wait((m) => m.id === 2)).result;
  assert.equal(BigInt(target), targetForDifficulty(4n), 'ASIC dostane cíl podílu');
  const number = node.chain.head.number + 1n;
  const s = await solve(sealHash, number, target, (v) => v > targetForDifficulty(node.chain.head.difficulty));
  c.send({ id: 3, method: 'eth_submitWork', params: [ethers.hexlify(s.nonce), sealHash, ethers.hexlify(s.mixDigest)] });
  assert.equal((await c.wait((m) => m.id === 3)).result, true);
  c.socket.destroy();
  await node.pool.flush();
  await mineBlock();
  assert.equal((await pool.windowWork(carol.address)).own, 4n);
});

test('těžař přes EthereumStratum dostane obtížnost podílu a podíl projde', async () => {
  const c = client();
  c.send({ id: 1, method: 'mining.subscribe', params: ['test/1.0', 'EthereumStratum/1.0.0'] });
  const sub = await c.wait((m) => m.id === 1);
  const extranonce = sub.result[1];
  c.send({ id: 2, method: 'mining.authorize', params: [`${bob.address}.asic2`, 'x'] });
  assert.equal((await c.wait((m) => m.id === 2)).result, true);
  const diff = await c.wait((m) => m.method === 'mining.set_difficulty');
  assert.ok(Math.abs(diff.params[0] - 4 / 4294967296) < 1e-15);
  const job = await c.wait((m) => m.method === 'mining.notify');
  const [jobId, , sealHash] = job.params;
  const number = node.chain.head.number + 1n;
  const head = ethers.getBytes(`0x${sealHash}`);
  const networkTarget = targetForDifficulty(node.chain.head.difficulty);
  let submitted;
  for (let n = 1n; ; n++) {
    const suffix = n.toString(16).padStart(12, '0');
    const nonce = ethers.getBytes(`0x${extranonce}${suffix}`);
    const { result } = await node.chain.pow.compute(head, nonce, number);
    const value = bytesToBigInt(result);
    if (value <= targetForDifficulty(4n) && value > networkTarget) {
      submitted = suffix;
      break;
    }
  }
  c.send({ id: 3, method: 'mining.submit', params: [`${bob.address}.asic2`, jobId, submitted] });
  const r = await c.wait((m) => m.id === 3);
  assert.equal(r.result, true, JSON.stringify(r.error));
  c.socket.destroy();
  await node.pool.flush();
  await mineBlock();
  assert.ok((await pool.windowWork(bob.address)).own >= 8n);
});

test('server sám spustí výplatu a mince jdou přímo těžařům', async () => {
  // Odměna z bloků poolu a uzavření všech kol.
  await mineBlock(poolAddress);
  const last = (await pool.stepCount()) - 1n;
  const step = await pool.steps(last);
  while (node.chain.head.number < (step.round + 1n) * 16n + 32n) await mineBlock();
  await ok(pool.settle(10));
  const pending = await pool.pendingOf(alice.address);
  assert.ok(pending >= 10n ** 17n, 'Alice má co vybírat');
  const before = await Promise.all([alice, bob, carol].map((w) => provider.getBalance(w.address)));
  const payerBefore = await provider.getBalance(payer.address);
  await node.pool.payout();
  await mineBlock();
  const after = await Promise.all([alice, bob, carol].map((w) => provider.getBalance(w.address)));
  assert.equal(after[0] - before[0], pending);
  assert.ok(after[1] > before[1]);
  assert.ok(after[2] > before[2]);
  assert.ok((await provider.getBalance(payer.address)) < payerBefore, 'server jen platí gas, mince nedostane');
  assert.equal(await pool.pendingOf(alice.address), 0n);
  assert.equal(await node.pool.payout(), null, 'bez čekajících výplat se nic neodešle');
});

test('tichý pool uzavře kola sám a po restartu serveru zná své těžaře', async () => {
  const [sealA, , target, number] = await rpc('aether_poolWork', [alice.address, 'rig1']);
  const networkTarget = targetForDifficulty(node.chain.head.difficulty);
  const a = await solve(sealA, BigInt(number), target, (v) => v > networkTarget);
  assert.equal((await rpc('aether_poolSubmit', [ethers.hexlify(a.nonce), sealA, ethers.hexlify(a.mixDigest)])).accepted, true);
  await node.pool.flush();
  await mineBlock();
  await mineBlock(poolAddress);
  const step = await pool.steps((await pool.stepCount()) - 1n);
  while (node.chain.head.number < (step.round + 1n) * 16n + 32n) await mineBlock();
  assert.equal(await pool.readyToSettle(), true);
  const settled = await pool.settledSteps();
  assert.ok(await node.pool.payout(), 'server sám uzavře kolo');
  await mineBlock();
  assert.ok((await pool.settledSteps()) > settled);

  node.pool._saveMiners();
  const saved = [...node.pool.miners];
  node.pool.miners.clear();
  node.pool._loadMiners();
  assert.deepEqual([...node.pool.miners], saved);
  assert.ok(saved.includes(alice.address.toLowerCase()));
});

test('obtížnost podílu se přizpůsobí výkonu zařízení a velikosti poolu', () => {
  const p = node.pool;
  const network = 1n << 40n;
  const s = { difficulty: null, shares: 0, since: Date.now() };
  p._retarget(s, network);
  assert.equal(s.difficulty, network / 64n);
  // Rychlé zařízení posílá podíly moc často.
  s.shares = 6;
  s.since = Date.now() - 6000;
  const start = s.difficulty;
  p._retarget(s, network);
  assert.equal(s.difficulty, start * 4n);
  // Pomalé zařízení nic nenašlo.
  s.shares = 0;
  s.since = Date.now() - 400_000;
  p._retarget(s, network);
  assert.equal(s.difficulty, start * 2n);
  assert.equal(s.shares, 0);
  // Nikdy nad obtížnost sítě ani pod spodní mez.
  s.difficulty = network;
  s.shares = 6;
  s.since = Date.now() - 1000;
  p._retarget(s, network);
  assert.equal(s.difficulty, network);
  // Podíl se musí vyplatit: nikdy levnější než 1/4096 práce sítě, jinak by účet na gas vysával i malý těžař.
  const floor = network / 4096n;
  s.difficulty = floor;
  s.shares = 0;
  s.since = Date.now() - 400_000;
  p._retarget(s, network);
  assert.equal(s.difficulty, floor);
  const low = { difficulty: 8n, shares: 0, since: Date.now() - 400_000 };
  p._retarget(low, 1024n);
  assert.equal(low.difficulty, 4n, 'v malé síti platí spodní mez z nastavení');

  assert.equal(p._interval(), 20);
  const many = new Map(p.sessions);
  for (let i = 0; i < 960; i++) many.set(`idle${i}`, { seen: Date.now(), done: 0n, previous: 0n });
  const real = p.sessions;
  p.sessions = many;
  assert.equal(p._interval(), 20, 'žádosti o práci bez podílů nikomu podíly nezdraží');
  for (let i = 0; i < 960; i++) many.set(`x${i}`, { seen: Date.now(), done: 1n, previous: 0n });
  assert.ok(p._interval() >= 960 * 15 / 24);
  p.sessions = real;
});
