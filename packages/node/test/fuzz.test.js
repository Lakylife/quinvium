// Random and exhaustive tests: what cannot be listed by hand is tried here in bulk.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Address, bytesToHex } from '@ethereumjs/util';
import { Block, Header } from '../src/core/types.js';
import { Chain } from '../src/core/chain.js';
import { forkId } from '../src/core/forks.js';
import { Network } from '../src/p2p/network.js';
import { MSG, SecureChannel } from '../src/p2p/wire.js';
import { PROTOCOL_VERSION } from '../src/p2p/peer.js';
import { NETWORKS, WEI } from '../src/params.js';
import { intToBytes } from '../src/util/bytes.js';
import { blockReceipts, effectivePrice } from '../src/rpc/format.js';
import { POW_DIR, mine, newChain, seal, tmpData, transfer, wallet } from './helpers/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const fund = (...ws) => Object.fromEntries(ws.map((w) => [bytesToHex(w.address), { balance: 1000n * WEI }]));
const until = async (cond, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
};
const fieldsOf = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('_')));
const flip = (b, i = 0) => { const c = new Uint8Array(b); c[i] ^= 1; return c; };

test('changing any header field is rejected even with valid work, and the honest block passes', async () => {
  const a = wallet();
  const honest = await newChain({ alloc: fund(a) });
  const victim = await newChain({ alloc: fund(a) });
  const tx = transfer(honest, a, new Address(wallet().address), 1n, 0n);
  const { block } = await mine(honest, { txs: [tx] });
  victim.setClock(honest.now());
  const h = block.header;
  const changes = {
    parentHash: flip(h.parentHash), stateRoot: flip(h.stateRoot), txRoot: flip(h.txRoot), receiptsRoot: flip(h.receiptsRoot),
    logsBloom: flip(h.logsBloom), difficulty: h.difficulty + 1n, number: h.number + 1n, gasLimit: h.gasLimit + 1000000n, gasUsed: h.gasUsed + 1n,
    timestamp: h.timestamp + 100000n, extraData: new Uint8Array(33), baseFee: h.baseFee + 1n,
  };
  let rejected = 0;
  for (const [field, value] of Object.entries(changes)) {
    const forged = await seal(victim, new Block(new Header({ ...fieldsOf(h), [field]: value }), block.txs));
    const outcome = await victim.insertBlock(forged).then((r) => r.status, (e) => e);
    if (outcome instanceof Error) rejected += 1;
    else assert.ok(['orphan'].includes(outcome), `${field}: blok prošel jako ${outcome}`);
  }
  assert.ok(rejected >= 11, `odmítnuto ${rejected}`);
  assert.equal(victim.head.number, 0n);

  // The changed miner gets the reward instead of the honest one, but then the state does not match.
  const forgedMiner = await seal(victim, new Block(new Header({ ...fieldsOf(h), miner: flip(h.miner) }), block.txs));
  await assert.rejects(victim.insertBlock(forgedMiner), /kořen stavu/);
  assert.equal((await victim.insertBlock(block)).status, 'added');
});

test('thousands of random bytes never decode into a valid block and never crash the decoder', async () => {
  const c = await newChain();
  const { block } = await mine(c);
  const good = block.encode();
  for (let i = 0; i < 4000; i++) {
    const raw = i % 2 ? new Uint8Array(randomBytes(randomInt(1, 800))) : (() => {
      const m = new Uint8Array(good);
      for (let j = 0; j < 1 + randomInt(8); j++) m[randomInt(m.length)] = randomInt(256);
      return m;
    })();
    try {
      const b = Block.decode(raw, c.common);
      const r = await c.insertBlock(b).then((x) => x.status, (e) => e);
      if (typeof r === 'string') assert.ok(['known', 'orphan'].includes(r), `poškozený blok prošel jako ${r}`);
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  }
  assert.equal(c.head.number, 1n);
});

for (const seedRound of [1, 2, 3]) {
  test(`random branches with conflicting transactions ${seedRound}: the delivery order does not change the result`, async () => {
    const sender = wallet(); const other = wallet();
    const alloc = fund(sender, other);
    const A = await newChain({ alloc });
    const B = await newChain({ alloc });
    const minerA = new Uint8Array(20).fill(0xa1);
    const minerB = new Uint8Array(20).fill(0xb2);
    const all = [];
    let nonceA = 0n; let nonceB = 0n;

    const extend = async (chain, miner, nonce) => {
      const txs = [];
      for (let i = 0; i < randomInt(4); i++) {
        txs.push(transfer(chain, sender, new Address(other.address), BigInt(randomInt(1000)), nonce + BigInt(i), { tip: BigInt(1 + randomInt(9)) * 10n ** 8n }));
      }
      const { block, res } = await mine(chain, { miner, txs, step: 1 + randomInt(40) });
      assert.ok(['added', 'reorg'].includes(res.status), res.status);
      all.push(block);
      return nonce + BigInt(txs.length);
    };
    const exchange = async () => {
      // Both sides' clocks are aligned, otherwise blocks of the other branch would be "in the future".
      const t = Math.max(A.now(), B.now()) + 1;
      A.setClock(t); B.setClock(t);
      for (const b of all) {
        await A.insertBlock(b).catch(() => {});
        await B.insertBlock(b).catch(() => {});
      }
      const nonceOf = async (c) => (await (await c.stateAt(c.head.stateRoot)).stateManager.getAccount(new Address(sender.address)))?.nonce ?? 0n;
      nonceA = await nonceOf(A); nonceB = await nonceOf(B);
    };

    for (let round = 0; round < 7; round++) {
      for (let i = 0; i < 1 + randomInt(4); i++) nonceA = await extend(A, minerA, nonceA);
      for (let i = 0; i < 1 + randomInt(4); i++) nonceB = await extend(B, minerB, nonceB);
      if (round % 2) await exchange();
    }
    await exchange();
    await extend(A, minerA, nonceA);        // clearly the heaviest tip
    await exchange();
    assert.deepEqual(A.head.hash(), B.head.hash());

    const C = await newChain({ alloc });
    C.setClock(Math.max(A.now(), B.now()) + 10);
    const queue = [...all].sort(() => randomInt(3) - 1);
    for (let moved = true; moved && queue.length;) {
      moved = false;
      for (let i = queue.length - 1; i >= 0; i--) {
        const r = await C.insertBlock(queue[i]).then((x) => x.status, () => 'chyba');
        if (r !== 'orphan') { queue.splice(i, 1); moved = true; }
      }
    }
    assert.equal(queue.length, 0, 'všechny bloky se doručily');
    assert.deepEqual(C.head.hash(), A.head.hash(), 'stejná špička');
    assert.deepEqual(C.head.stateRoot, A.head.stateRoot, 'stejný stav');

    // After all reorganisations the indexes match the actual state and the canonical chain.
    let confirmed = 0;
    for (let n = 0n; n <= C.head.number; n++) confirmed += C.getBlockByNumber(n).txs.length;
    assert.equal(C.store.db.prepare('SELECT COUNT(*) AS c FROM txs').get().c, confirmed, 'index transakcí');
    const state = await C.stateAt(C.head.stateRoot);
    for (const r of C.store.richList(50)) {
      const acct = await state.getAccountByBytes(r.addr);
      assert.equal(r.balance, acct?.balance ?? 0n, 'žebříček zůstatků');
    }
    let fees = 0n;
    for (let n = 1n; n <= C.head.number; n++) {
      const b = C.getBlockByNumber(n);
      const receipts = C.getReceipts(b.hash()).receipts;
      for (const r of blockReceipts(b, receipts)) fees += effectivePrice(r.tx, b.header.baseFee) * r.gasUsed;
    }
    assert.equal(C.store.feesAt(C.head.number), fees, 'součet poplatků těžařům po všech reorganizacích');
  });
}

test('garbage in every message type does not stop the node and an honest node stays connected', async () => {
  const chain = await newChain();
  const victim = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  await victim.start();
  const friend = await newChain();
  const honest = new Network({ chain: friend, mempool: friend.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  await honest.start();
  honest.connect('127.0.0.1', victim.port);
  assert.ok(await until(() => victim.peerCount === 1));

  const fork = forkId(chain.network, chain.genesis.hash(), 0n);
  const { RLP } = await import('@ethereumjs/rlp');
  for (let round = 0; round < 40; round++) {
    const socket = net.connect(victim.port, '127.0.0.1');
    socket.on('error', () => {});
    await new Promise((r) => socket.once('connect', r));
    const ch = new SecureChannel(socket, true);
    ch.on('close', () => {});
    await new Promise((r) => { ch.once('ready', r); setTimeout(r, 500); });
    ch.unlock();
    if (round % 3) {
      ch.send(MSG.HELLO, Buffer.from(RLP.encode([
        intToBytes(BigInt(PROTOCOL_VERSION)), intToBytes(chain.network.chainId), chain.genesis.hash(), chain.genesis.hash(),
        intToBytes(0n), intToBytes(0n), intToBytes(0n), randomBytes(16), new TextEncoder().encode('fuzz'), fork.hash, intToBytes(fork.next),
      ])));
    }
    for (let i = 0; i < 12 && !ch.closed; i++) {
      const type = randomInt(0, 14);
      const body = i % 2 ? randomBytes(randomInt(0, 300)) : Buffer.from(RLP.encode([randomBytes(randomInt(0, 40)), [randomBytes(8)], randomBytes(4)]));
      ch.send(type, body);
    }
    if (round % 5 === 0) socket.write(randomBytes(randomInt(1, 2000)));   // garbage outside the encrypted channel
    await sleep(5);
    ch.close('konec');
  }
  await sleep(200);
  assert.equal(victim.peerCount, 1, 'poctivý uzel zůstal');
  const before = chain.head.number;
  friend.setClock(chain.now() + 15);
  await mine(friend);
  chain.setClock(friend.now());
  assert.ok(await until(() => chain.head.number === before + 1n), 'blok od poctivého uzlu pořád prochází');
  await victim.stop(); await honest.stop();
});

test('a hard crash in the middle of work does not damage the database', async () => {
  const dir = tmpData();
  const key = '0x000000000000000000000000000000000000aaaa';
  const run = () => spawn(process.execPath, ['--no-warnings', join(here, '..', 'src', 'cli.js'), '--network', 'dev', '--data-dir', dir, '--dev-mine', '--miner-address', key,
    '--rpc-port', String(23000 + randomInt(9000)), '--p2p-port', '0', '--stratum-port', '0'], { stdio: 'ignore' });
  for (let i = 0; i < 5; i++) {
    const child = run();
    await sleep(2500 + randomInt(4000));
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
  }
  const c = await Chain.open({ network: NETWORKS.dev, dataDir: dir, powDir: POW_DIR, alloc: (await import('../src/node.js')).loadAlloc() });
  const head = c.head;
  assert.equal(c.store.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  // Every canonical block must have a state and follow its ancestor.
  for (let n = head.number; n > 0n; n--) {
    const h = c.getHeaderByNumber(n);
    assert.deepEqual(h.parentHash, c.getHeaderByNumber(n - 1n).hash());
  }
  const state = await c.stateAt(head.stateRoot);
  assert.ok((await state.getAccountByBytes(new Address(Buffer.from(key.slice(2), 'hex')).bytes))?.balance >= 0n || head.number === 0n);
  await c.close();
});
