// Pool version 2 on a real node with real Ethash: the pool server's gas for shares and payouts comes back from the mined
// rewards, never from coins that already belong to miners, at a capped price and at most 1 % of the pool's income.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { AetherNode, loadAlloc } from '../../node/src/node.js';
import { Header } from '../../node/src/core/types.js';
import { bytesToBigInt } from '../../node/src/crypto/ethash.js';
import { GWEI, NETWORKS, WEI } from '../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../node/test/helpers/chain.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const net = { ...NETWORKS.dev };
const [operator, relayer, alice, bob, stranger] = Array.from({ length: 5 }, () => ethers.Wallet.createRandom());
const TWO_256 = 1n << 256n;
const FEE_BPS = 100n;
const ROUND = 16;
const WINDOW = 2;
const MAX_AGE = 32;
let clock = Number(net.genesisTimestamp);

const alloc = { ...loadAlloc() };
for (const w of [operator, relayer, alice, bob, stranger]) alloc[w.address] = { balance: 10000n * WEI };
const node = new AetherNode({
  network: net, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
  alloc, now: () => clock, log: () => {},
});

let provider;
let factory;
const poolAt = (address, signer = operator) => new ethers.Contract(address, artifacts.AetherPool2.abi, signer.connect(provider));
const height = () => node.chain.head.number;
const OTHER = '0x' + 'bb'.repeat(20);
// A gas estimate runs at price zero and so without the refund; the pool server sets its own generous limits too.
const G = { gasLimit: 2_000_000n };

async function mineBlock(miner = OTHER) {
  clock += 15;
  const w = await node.work.getWork(ethers.getBytes(miner));
  const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
  const sealed = await seal(node.chain, tpl);
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  assert.ok(r.accepted, r.reason);
  await node.mempool.settled();
}
const mineUntil = async (number, miner) => { while (height() < BigInt(number)) await mineBlock(miner); };
async function ok(pending) {
  const tx = await pending;
  await mineBlock();
  const r = await provider.getTransactionReceipt(tx.hash);
  assert.equal(r.status, 1);
  return r;
}

const fields = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('_')));
const shareExtra = (miner, credit) => ethers.getBytes(ethers.concat([miner, ethers.zeroPadValue(ethers.toBeHex(credit), 12)]));
async function share({ coinbase, miner, credit }) {
  const tpl = await node.chain.buildTemplate({ miner: ethers.getBytes(coinbase), txs: [] });
  const header = new Header({ ...fields(tpl.header), extraData: shareExtra(miner, credit) });
  for (let n = 1n; ; n++) {
    const nonce = ethers.getBytes(ethers.zeroPadValue(ethers.toBeHex(n), 8));
    const { mixDigest, result } = await node.chain.pow.compute(header.sealHash(), nonce, header.number);
    if (TWO_256 / (bytesToBigInt(result) + 1n) >= credit) return new Header({ ...fields(header), mixHash: mixDigest, nonce });
  }
}

async function createPool(relayerAddress = relayer.address) {
  const r = await ok(factory.createPool('Test pool 2', 'http://pool.example:8546', FEE_BPS, ROUND, WINDOW, relayerAddress));
  const address = factory.interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === factory.target.toLowerCase())).args.pool;
  return poolAt(address);
}
/** The relayer's real cost of a transaction: what left its balance, minus the refund. */
const spent = (r) => r.gasUsed * r.gasPrice;
const refundIn = (pool, r) => r.logs.filter((l) => l.address.toLowerCase() === pool.target.toLowerCase())
  .map((l) => pool.interface.parseLog(l)).filter((e) => e?.name === 'GasRefunded').reduce((s, e) => s + e.args.amount, 0n);

test.before(async () => {
  await node.start();
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
  await mineBlock();
  const deploy = await new ethers.ContractFactory(artifacts.PoolFactory2.abi, artifacts.PoolFactory2.bytecode, operator.connect(provider)).deploy();
  await mineBlock();
  factory = deploy;
});

test.after(async () => {
  provider.destroy();
  await node.stop();
});

test('the factory is an ordinary contract whose code apps can check', async () => {
  const code = await provider.getCode(factory.target);
  assert.equal(createHash('sha256').update(ethers.getBytes(code)).digest('hex'), artifacts.PoolFactory2.runtimeSha256);
  const pool = await createPool();
  assert.equal(await factory.isPool(pool.target), true);
  assert.equal(await pool.operator(), operator.address);
  assert.equal(await pool.relayer(), relayer.address);
  const own = await createPool(ethers.ZeroAddress);
  assert.equal(await own.relayer(), operator.address, 'zero means the operator');
  await assert.rejects(factory.createPool('x', '', 501, ROUND, WINDOW, relayer.address));
});

test('the relayer gets its gas back from undistributed coins; other callers pay their own', async () => {
  const pool = await createPool();
  const coinbase = pool.target;
  for (let i = 0; i < 3; i++) await mineBlock(coinbase);
  const income = await provider.getBalance(coinbase);

  const a = await share({ coinbase, miner: alice.address, credit: 30n });
  const b = await share({ coinbase, miner: bob.address, credit: 10n });
  const before = await provider.getBalance(relayer.address);
  const r = await ok(pool.connect(relayer.connect(provider)).submitShares([a.encode(), b.encode()], G));
  const refund = refundIn(pool, r);
  const after = await provider.getBalance(relayer.address);
  assert.ok(refund > 0n, 'a refund was paid');
  assert.equal(after, before - spent(r) + refund);
  // The refund covers the cost to within a small margin (calldata is estimated), in both directions.
  const diff = refund > spent(r) ? refund - spent(r) : spent(r) - refund;
  assert.ok(diff * 10n < spent(r), `refund ${refund} vs cost ${spent(r)}`);
  assert.equal(await pool.gasRefunded(), refund);
  assert.equal(await provider.getBalance(coinbase), income - refund);

  const c = await share({ coinbase, miner: alice.address, credit: 5n });
  const r2 = await ok(pool.connect(stranger.connect(provider)).submitShare(c.encode()));
  assert.equal(refundIn(pool, r2), 0n, 'a stranger pays its own gas');
  assert.equal(await pool.gasRefunded(), refund);
});

test('refunds never touch coins that already belong to miners or the operator', async () => {
  const pool = await createPool();
  const coinbase = pool.target;
  const a = await share({ coinbase, miner: alice.address, credit: 8n });
  const round = a.number / BigInt(ROUND);
  await ok(pool.connect(stranger.connect(provider)).submitShare(a.encode()));
  await mineBlock(coinbase);
  await mineUntil((round + 1n) * BigInt(ROUND) + BigInt(MAX_AGE));
  await ok(pool.connect(stranger.connect(provider)).settle(10));
  assert.equal(await pool.unsettled(), 0n, 'everything belongs to someone');
  const reserved = await pool.reserved();

  const b = await share({ coinbase, miner: alice.address, credit: 8n });
  const r = await ok(pool.connect(relayer.connect(provider)).submitShare(b.encode(), G));
  assert.equal(refundIn(pool, r), 0n, 'nothing free to refund from');
  assert.equal(await pool.reserved(), reserved);
  assert.equal(await provider.getBalance(coinbase), reserved);
  // Alice still gets everything she earned.
  const owed = await pool.pendingOf(alice.address);
  const before = await provider.getBalance(alice.address);
  await ok(pool.connect(stranger.connect(provider)).claim(alice.address));
  assert.equal(await provider.getBalance(alice.address), before + owed);
});

test('the price is capped at the base fee plus 2 gwei and all refunds at 1 % of the income', async () => {
  const pool = await createPool();
  const coinbase = pool.target;
  await mineBlock(coinbase);
  const a = await share({ coinbase, miner: alice.address, credit: 4n });
  const block = await provider.getBlock('latest');
  const r = await ok(pool.connect(relayer.connect(provider)).submitShare(a.encode(), { ...G, maxFeePerGas: 1000n * GWEI, maxPriorityFeePerGas: 500n * GWEI }));
  const refund = refundIn(pool, r);
  assert.ok(r.gasPrice > 400n * GWEI, 'the relayer overpaid on purpose');
  const baseFee = (await provider.getBlock(r.blockNumber)).baseFeePerGas;
  assert.ok(refund <= (r.gasUsed + 20000n) * (baseFee + 2n * GWEI), 'refund at the capped price');
  assert.ok(block);

  // A pool that received almost nothing refunds at most 1 % of it.
  const poor = await createPool();
  await ok(stranger.connect(provider).sendTransaction({ to: poor.target, value: 10n ** 13n }));
  const s = await share({ coinbase: poor.target, miner: alice.address, credit: 4n });
  const r2 = await ok(poor.connect(relayer.connect(provider)).submitShare(s.encode(), G));
  assert.equal(refundIn(poor, r2), 10n ** 11n);
  assert.equal(await poor.gasRefunded(), 10n ** 11n);
});

test('only the operator chooses the relayer and zero turns refunds off', async () => {
  const pool = await createPool();
  await assert.rejects(pool.connect(relayer.connect(provider)).setRelayer(relayer.address));
  await ok(pool.setRelayer(ethers.ZeroAddress));
  assert.equal(await pool.relayer(), ethers.ZeroAddress);
  await mineBlock(pool.target);
  const a = await share({ coinbase: pool.target, miner: alice.address, credit: 4n });
  const r = await ok(pool.connect(relayer.connect(provider)).submitShare(a.encode(), G));
  assert.equal(refundIn(pool, r), 0n);
  await ok(pool.setRelayer(bob.address));
  assert.equal(await pool.relayer(), bob.address);
});

test('payouts and closing rounds by the relayer are refunded only when they did something', async () => {
  const pool = await createPool();
  const coinbase = pool.target;
  const a = await share({ coinbase, miner: alice.address, credit: 8n });
  const round = a.number / BigInt(ROUND);
  await ok(pool.connect(stranger.connect(provider)).submitShare(a.encode()));
  for (let i = 0; i < 2; i++) await mineBlock(coinbase);
  const idle = await ok(pool.connect(relayer.connect(provider)).settle(10, G));
  assert.equal(refundIn(pool, idle), 0n, 'nothing to close yet');
  await mineUntil((round + 1n) * BigInt(ROUND) + BigInt(MAX_AGE));
  // New coins after the round so that something is free to refund from.
  await mineBlock(coinbase);
  const settled = await ok(pool.connect(relayer.connect(provider)).settle(10, G));
  assert.ok(refundIn(pool, settled) > 0n);
  await mineBlock(coinbase);
  const paid = await ok(pool.connect(relayer.connect(provider)).payout([alice.address], G));
  assert.ok(refundIn(pool, paid) > 0n);
  const none = await ok(pool.connect(relayer.connect(provider)).payout([alice.address], G));
  assert.equal(refundIn(pool, none), 0n, 'nobody was paid');
  // Accounting: what came in equals what is in the contract plus what went out.
  const income = (await provider.getBalance(coinbase)) + (await pool.totalPaid()) + (await pool.feesWithdrawn()) + (await pool.gasRefunded());
  assert.ok(await pool.gasRefunded() <= income / 100n);
  assert.ok((await provider.getBalance(coinbase)) >= (await pool.reserved()));
});
