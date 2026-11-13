// Pool s automatickým rozdělováním na skutečném uzlu se skutečným Ethash, včetně pokusů o podvod.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { RLP } from '@ethereumjs/rlp';
import { AetherNode, loadAlloc } from '../../node/src/node.js';
import { Header } from '../../node/src/core/types.js';
import { POW_VERIFY_ADDRESS } from '../../node/src/core/precompiles.js';
import { bytesToBigInt } from '../../node/src/crypto/ethash.js';
import { NETWORKS, WEI } from '../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../node/test/helpers/chain.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const net = { ...NETWORKS.dev };
const [operator, alice, bob, carol, stranger] = Array.from({ length: 5 }, () => ethers.Wallet.createRandom());
const TWO_256 = 1n << 256n;
const FEE_BPS = 200n;
const ROUND = 16;
const WINDOW = 2;
const MAX_AGE = 32;
const REJECT = { proof: 1, pool: 2, age: 3, chain: 4, miner: 5, work: 6, duplicate: 7 };
let clock = Number(net.genesisTimestamp);

const alloc = { ...loadAlloc() };
for (const w of [operator, alice, bob, carol, stranger]) alloc[w.address] = { balance: 10000n * WEI };
const node = new AetherNode({
  network: net, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
  alloc, now: () => clock, log: () => {},
});

let provider;
const factory = (signer = operator) => new ethers.Contract(artifacts.PoolFactory.address, artifacts.PoolFactory.abi, signer.connect(provider));
const poolAt = (address, signer = operator) => new ethers.Contract(address, artifacts.AetherPool.abi, signer.connect(provider));
const height = () => node.chain.head.number;

async function mineBlock(miner = '0x' + 'bb'.repeat(20)) {
  clock += 15;
  const w = await node.work.getWork(ethers.getBytes(miner));
  const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
  const sealed = await seal(node.chain, tpl);
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  assert.ok(r.accepted, r.reason);
  await node.mempool.settled();
}

async function mineUntil(number, miner) {
  while (height() < BigInt(number)) await mineBlock(miner);
}

async function ok(pending) {
  const tx = await pending;
  await mineBlock();
  const r = await provider.getTransactionReceipt(tx.hash);
  assert.equal(r.status, 1);
  return r;
}

const fields = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('_')));
const shareExtra = (miner, credit) => ethers.getBytes(ethers.concat([miner, ethers.zeroPadValue(ethers.toBeHex(credit), 12)]));

/** Vytěží podíl: skutečnou hlavičku s adresou těžaře a splněnou prací. */
async function share({ coinbase, miner, credit, claim = credit, mutate = (h) => h }) {
  const tpl = await node.chain.buildTemplate({ miner: ethers.getBytes(coinbase), txs: [] });
  const header = mutate(new Header({ ...fields(tpl.header), extraData: shareExtra(miner, claim) }));
  for (let n = 1n; ; n++) {
    const nonce = ethers.getBytes(ethers.zeroPadValue(ethers.toBeHex(n), 8));
    const { mixDigest, result } = await node.chain.pow.compute(header.sealHash(), nonce, header.number);
    const value = bytesToBigInt(result);
    if (TWO_256 / (value + 1n) >= credit) return new Header({ ...fields(header), mixHash: mixDigest, nonce });
  }
}

const rejected = (pending, code) => assert.rejects(pending, (e) => {
  const data = e.data ?? e.info?.error?.data;
  const parsed = new ethers.Interface(artifacts.AetherPool.abi).parseError(data);
  assert.equal(parsed.name, 'ShareRejected');
  assert.equal(Number(parsed.args[0]), code);
  return true;
});

async function createPool(fee = FEE_BPS, round = ROUND, windowRounds = WINDOW) {
  const r = await ok(factory().createPool('Testovací pool', 'http://pool.example:8546', fee, round, windowRounds));
  const address = factory().interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === artifacts.PoolFactory.address)).args.pool;
  return poolAt(address);
}

async function nextRound(pool, roundBlocks = ROUND) {
  const round = height() / BigInt(roundBlocks);
  await mineUntil((round + 1n) * BigInt(roundBlocks));
  return pool;
}

const closeRound = async (shareRound, roundBlocks = ROUND) => mineUntil((BigInt(shareRound) + 1n) * BigInt(roundBlocks) + BigInt(MAX_AGE));

test.before(async () => {
  await node.start();
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
  await mineBlock();
});

test.after(async () => {
  provider.destroy();
  await node.stop();
});

test('ověření práce vrátí údaje jen pro skutečně vytěženou hlavičku', async () => {
  const coinbase = ethers.hexlify(ethers.randomBytes(20));
  const h = await share({ coinbase, miner: alice.address, credit: 4n });
  const out = await provider.call({ to: POW_VERIFY_ADDRESS, data: ethers.hexlify(h.encode()) });
  const [miner, number, parent, difficulty, work, extra, hash] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['address', 'uint256', 'bytes32', 'uint256', 'uint256', 'bytes32', 'bytes32'], out,
  );
  assert.equal(miner.toLowerCase(), coinbase);
  assert.equal(number, h.number);
  assert.equal(parent, ethers.hexlify(h.parentHash));
  assert.equal(difficulty, h.difficulty);
  assert.ok(work >= 4n);
  assert.equal(extra, ethers.hexlify(h.extraData));
  assert.equal(hash, ethers.hexlify(h.hash()));

  const forged = new Header({ ...fields(h), mixHash: new Uint8Array(32).fill(7) });
  assert.equal(await provider.call({ to: POW_VERIFY_ADDRESS, data: ethers.hexlify(forged.encode()) }), '0x', 'cizí mixHash');
  assert.equal(await provider.call({ to: POW_VERIFY_ADDRESS, data: '0xdeadbeef' }), '0x', 'nesmyslný vstup');
  assert.equal(await provider.call({ to: POW_VERIFY_ADDRESS, data: '0x' }), '0x', 'prázdný vstup');
  const future = new Header({ ...fields(h), number: h.number + 100n });
  assert.equal(await provider.call({ to: POW_VERIFY_ADDRESS, data: ethers.hexlify(future.encode()) }), '0x', 'hlavička z budoucnosti');
  const huge = new Header({ ...fields(h), difficulty: TWO_256 });
  assert.equal(await provider.call({ to: POW_VERIFY_ADDRESS, data: ethers.hexlify(huge.encode()) }), '0x', 'obtížnost přes 256 bitů');
  await assert.rejects(provider.call({ to: POW_VERIFY_ADDRESS, data: ethers.hexlify(h.encode()), gasLimit: 50000n }), (e) => /out of gas/.test(JSON.stringify(e.info ?? e.message)));
});

test('továrna je na pevné adrese a hlídá meze nastavení', async () => {
  const f = factory();
  assert.equal(await f.poolCount(), 0n);
  const pool = await createPool();
  assert.equal(await f.poolCount(), 1n);
  assert.equal(await f.isPool(await pool.getAddress()), true);
  assert.equal(await f.isPool(alice.address), false);
  assert.deepEqual([...(await f.list(0, 10))], [await pool.getAddress()]);
  assert.deepEqual([...(await f.list(5, 10))], []);
  assert.equal(await pool.operator(), operator.address);
  assert.equal(await pool.feeBps(), FEE_BPS);
  assert.equal(await pool.name(), 'Testovací pool');
  for (const args of [
    ['x', '', 501, ROUND, WINDOW], ['x', '', 0, 15, WINDOW], ['x', '', 0, 5761, WINDOW], ['x', '', 0, ROUND, 0], ['x', '', 0, ROUND, 257],
    ['', '', 0, ROUND, WINDOW], ['x'.repeat(65), '', 0, ROUND, WINDOW], ['x', 'x'.repeat(129), 0, ROUND, WINDOW],
  ]) await assert.rejects(f.createPool(...args), undefined, `nastavení ${JSON.stringify(args)}`);
  await assert.rejects(pool.connect(stranger.connect(provider)).setUrl('http://podvod'));
  await ok(pool.setUrl('http://novy'));
  assert.equal(await pool.url(), 'http://novy');
});

test('podvržené podíly neprojdou', async () => {
  const pool = await createPool();
  const coinbase = await pool.getAddress();
  const good = await share({ coinbase, miner: alice.address, credit: 4n });
  await ok(pool.submitShare(good.encode()));
  assert.equal((await pool.windowWork(alice.address)).own, 4n);

  await rejected(pool.submitShare.staticCall(good.encode()), REJECT.duplicate);
  // Stejná hlavička s jinak zapsanou výškou nesmí být nový podíl.
  const longNumber = [...good.fields()];
  longNumber[7] = new Uint8Array([0, ...longNumber[7]]);
  await rejected(pool.submitShare.staticCall(RLP.encode(longNumber)), REJECT.proof);

  // Provozovatel přepíše adresu těžaře na svou: práce pak nesedí.
  const stolen = new Header({ ...fields(good), extraData: shareExtra(operator.address, 4n) });
  await rejected(pool.submitShare.staticCall(stolen.encode()), REJECT.proof);
  const inflated = new Header({ ...fields(good), extraData: shareExtra(alice.address, 4000n) });
  await rejected(pool.submitShare.staticCall(inflated.encode()), REJECT.proof);

  const other = await share({ coinbase: alice.address, miner: alice.address, credit: 2n });
  await rejected(pool.submitShare.staticCall(other.encode()), REJECT.pool);
  const greedy = await share({ coinbase, miner: alice.address, credit: 2n, claim: 1n << 90n });
  await rejected(pool.submitShare.staticCall(greedy.encode()), REJECT.work);
  const noMiner = await share({ coinbase, miner: ethers.ZeroAddress, credit: 2n });
  await rejected(pool.submitShare.staticCall(noMiner.encode()), REJECT.miner);
  const noCredit = await share({ coinbase, miner: alice.address, credit: 1n, claim: 0n });
  await rejected(pool.submitShare.staticCall(noCredit.encode()), REJECT.work);
  const foreign = await share({ coinbase, miner: alice.address, credit: 2n, mutate: (h) => new Header({ ...fields(h), parentHash: new Uint8Array(32).fill(9) }) });
  await rejected(pool.submitShare.staticCall(foreign.encode()), REJECT.chain);

  const old = await share({ coinbase, miner: alice.address, credit: 2n });
  // eth_call běží v kontextu dalšího bloku.
  await mineUntil(old.number + BigInt(MAX_AGE) - 1n);
  await pool.submitShare.staticCall(old.encode());
  await mineBlock();
  await rejected(pool.submitShare.staticCall(old.encode()), REJECT.age);

  await assert.rejects(pool.submitShares.staticCall([old.encode(), foreign.encode()]), (e) => {
    assert.equal(new ethers.Interface(artifacts.AetherPool.abi).parseError(e.data).name, 'NoValidShares');
    return true;
  });
});

test('odměna se rozdělí podle práce, provozovatel dostane jen poplatek', async () => {
  const pool = await createPool();
  const coinbase = await pool.getAddress();
  await nextRound(pool);
  const a = await share({ coinbase, miner: alice.address, credit: 30n });
  const b = await share({ coinbase, miner: bob.address, credit: 10n });
  // Dávku může poslat kdokoli a neplatný podíl ji nezastaví.
  await ok(pool.connect(stranger.connect(provider)).submitShares([a.encode(), a.encode(), b.encode()]));
  assert.deepEqual([...(await pool.windowWork(alice.address))], [40n, 30n]);

  const reward = 4n * WEI;
  await mineBlock(coinbase);
  const pot = await provider.getBalance(coinbase);
  assert.equal(pot, reward);
  assert.equal(await pool.unsettled(), pot);
  assert.equal(await pool.pendingOf(alice.address), 0n, 'před uzavřením kola nic');

  const round = a.number / BigInt(ROUND);
  // Kolo jde uzavřít až po posledním možném podílu.
  await mineUntil((round + 1n) * BigInt(ROUND) + BigInt(MAX_AGE) - 2n);
  await pool.settle(10);
  assert.equal(await pool.settledSteps(), 0n);
  await closeRound(round);
  await ok(pool.connect(stranger.connect(provider)).settle(10));
  assert.equal(await pool.settledSteps(), 1n);

  const fee = (pot * FEE_BPS) / 10000n;
  const rest = pot - fee;
  assert.equal(await pool.operatorOwed(), fee);
  assert.equal(await pool.reserved(), pot);
  const rate = (rest << 128n) / 40n;
  const shareA = (30n * rate) >> 128n;
  const shareB = (10n * rate) >> 128n;
  assert.equal(await pool.pendingOf(alice.address), shareA);
  assert.equal(await pool.pendingOf(bob.address), shareB);

  // Provozovatel nemá jak vzít mince těžařů: vybere jen poplatek a jde na jeho adresu, ať to spustí kdokoli.
  const before = await provider.getBalance(operator.address);
  await ok(pool.connect(stranger.connect(provider)).withdrawFee());
  assert.equal(await provider.getBalance(operator.address), before + fee);
  await assert.rejects(pool.withdrawFee());

  // Výplatu spustí cizí účet, mince jdou těžaři.
  const aliceBefore = await provider.getBalance(alice.address);
  await ok(pool.connect(stranger.connect(provider)).claim(alice.address));
  assert.equal(await provider.getBalance(alice.address), aliceBefore + shareA);
  assert.equal(await pool.pendingOf(alice.address), 0n);
  await ok(pool.claim(alice.address));
  assert.equal(await provider.getBalance(alice.address), aliceBefore + shareA, 'podruhé nic');
  const bobBefore = await provider.getBalance(bob.address);
  await ok(pool.payout([bob.address, alice.address]));
  assert.equal(await provider.getBalance(bob.address), bobBefore + shareB);
  assert.equal(await pool.totalPaid(), shareA + shareB);
  assert.ok((await provider.getBalance(coinbase)) < 4n, 'v kontraktu zůstalo jen zaokrouhlení');
});

test('PPLNS: odměna jde mezi poslední kola v okně a stará práce vypadne', async () => {
  const pool = await createPool(0n, ROUND, WINDOW);
  const coinbase = await pool.getAddress();
  await nextRound(pool);
  const first = await share({ coinbase, miner: alice.address, credit: 12n });
  await ok(pool.submitShare(first.encode()));
  await mineBlock(coinbase);
  const firstRound = first.number / BigInt(ROUND);

  await mineUntil((firstRound + 1n) * BigInt(ROUND));
  const second = await share({ coinbase, miner: bob.address, credit: 4n });
  await ok(pool.submitShare(second.encode()));
  await closeRound(firstRound);
  await ok(pool.settle(1));
  const pot1 = await pool.reserved();
  assert.ok(pot1 >= 4n * WEI);
  // První krok má v okně jen sebe.
  const alice1 = await pool.pendingOf(alice.address);
  assert.ok(pot1 - alice1 < 4n, 'celá první odměna patří Alice');

  // Výběr během okna nesmí zablokovat další výdělek ze stejného kroku.
  await ok(pool.claim(alice.address));
  assert.equal(await pool.pendingOf(alice.address), 0n);

  await mineBlock(coinbase);
  await closeRound(second.number / BigInt(ROUND));
  await ok(pool.settle(1));
  const pot2 = (await pool.reserved()) - (pot1 - alice1);
  assert.ok(pot2 >= 4n * WEI);
  const alice2 = await pool.pendingOf(alice.address);
  const bob2 = await pool.pendingOf(bob.address);
  assert.ok(pot2 * 3n / 4n - alice2 < 4n, 'druhou odměnu dělí okno 12 : 4');
  assert.ok(pot2 / 4n - bob2 < 4n);

  await mineUntil(height() - (height() % BigInt(ROUND)) + BigInt(ROUND));
  const third = await share({ coinbase, miner: carol.address, credit: 2n });
  await ok(pool.submitShare(third.encode()));
  await mineBlock(coinbase);
  await closeRound(third.number / BigInt(ROUND));
  await ok(pool.settle(1));
  const pending = await pool.pendingOf(alice.address);
  assert.equal(pending, alice2, 'Alice je mimo okno, další odměnu nedostane');
  assert.ok((await pool.pendingOf(bob.address)) > bob2);
  assert.ok((await pool.pendingOf(carol.address)) > 0n);

  await ok(pool.payout([alice.address, bob.address, carol.address]));
  assert.ok((await provider.getBalance(coinbase)) - (await pool.unsettled()) < 16n, 'všechno rozdělené je vyplacené');
  // Těžař bez dalších podílů nesmí v cyklu výběru nic navíc.
  const carolBefore = await provider.getBalance(carol.address);
  await ok(pool.claim(carol.address));
  assert.equal(await provider.getBalance(carol.address), carolBefore);
});

test('podíly samy uzavírají hotová kola a po odchodu provozovatele výplata funguje dál', async () => {
  const pool = await createPool();
  const coinbase = await pool.getAddress();
  await nextRound(pool);
  const a = await share({ coinbase, miner: alice.address, credit: 8n });
  await ok(pool.submitShare(a.encode()));
  await mineBlock(coinbase);
  await closeRound(a.number / BigInt(ROUND));
  const b = await share({ coinbase, miner: alice.address, credit: 8n });
  await ok(pool.submitShare(b.encode()));
  assert.equal(await pool.settledSteps(), 1n, 'odeslání podílu uzavřelo staré kolo');
  assert.equal(await pool.readyToSettle(), false);
  // Poslední krok v okně nikdy nezavře další kolo, přesto jde vybrat vše rozdělené.
  await mineBlock(coinbase);
  await closeRound(b.number / BigInt(ROUND));
  assert.equal(await pool.readyToSettle(), true);
  // Tichý pool uzavře kolo i samotný výběr.
  await ok(pool.connect(alice.connect(provider)).claim(alice.address));
  assert.equal(await pool.settledSteps(), 2n);
  assert.equal(await pool.pendingOf(alice.address), 0n);
  assert.ok((await pool.paidTo(alice.address)) > 7n * WEI);
});

test('těžař, který je kontrakt, nemůže vybrat dvakrát ani zablokovat výplatu ostatním', async () => {
  const solc = createRequire(import.meta.url)('solc');
  const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
interface P { function claim(address) external returns (uint256); function settle(uint256) external returns (uint256); function withdrawFee() external; }
contract Attacker {
  P p; uint256 public hits;
  constructor(P p_) { p = p_; }
  receive() external payable { hits++; try p.claim(address(this)) {} catch {} try p.settle(1) {} catch {} }
}
contract Refuser { receive() external payable { revert(); } }`;
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { 'A.sol': { content: source } },
    settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  const pool = await createPool(0n);
  const coinbase = await pool.getAddress();
  const art = out.contracts['A.sol'].Attacker;
  const attacker = await new ethers.ContractFactory(art.abi, `0x${art.evm.bytecode.object}`, operator.connect(provider)).deploy(coinbase);
  await mineBlock();
  const ref = out.contracts['A.sol'].Refuser;
  const refuser = await new ethers.ContractFactory(ref.abi, `0x${ref.evm.bytecode.object}`, operator.connect(provider)).deploy();
  await mineBlock();
  const [attackerAddress, refuserAddress] = await Promise.all([attacker.getAddress(), refuser.getAddress()]);

  await nextRound(pool);
  const shares = [];
  for (const miner of [attackerAddress, refuserAddress, alice.address]) shares.push(await share({ coinbase, miner, credit: 4n }));
  await ok(pool.submitShares(shares.map((s) => s.encode())));
  await mineBlock(coinbase);
  await closeRound(shares[0].number / BigInt(ROUND));
  await ok(pool.settle(1));
  const each = await pool.pendingOf(alice.address);
  assert.ok(each > 1n * WEI);
  assert.equal(await pool.pendingOf(attackerAddress), each);

  await ok(pool.payout([refuserAddress, attackerAddress, alice.address]));
  assert.equal(await provider.getBalance(attackerAddress), each, 'opětovný vstup nic nepřidal');
  assert.equal(await pool.paidTo(alice.address), each);
  assert.equal(await provider.getBalance(refuserAddress), 0n);
  assert.equal(await pool.owed(refuserAddress), each, 'nedoručená výplata zůstává těžaři');
  assert.equal(await pool.pendingOf(refuserAddress), each);
  assert.equal(await provider.getBalance(coinbase), await pool.reserved());
});
