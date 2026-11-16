import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { Address } from '@ethereumjs/util';
import { Network } from '../src/p2p/network.js';
import { SecureChannel, MSG } from '../src/p2p/wire.js';
import { Peer } from '../src/p2p/peer.js';
import { CONSENSUS as C, WEI } from '../src/params.js';
import { equal as equalHash } from '../src/util/bytes.js';
import { newChain, wallet, mine, mineMany, transfer, seal, tmpData } from './helpers/chain.js';
import { Block, Header } from '../src/core/types.js';

const until = async (cond, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
};

async function node(alloc, seeds = []) {
  const chain = await newChain({ alloc });
  const netw = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1', seeds, allowPrivate: true });
  await netw.start();
  return { chain, net: netw, addr: () => `127.0.0.1:${netw.port}` };
}
const stopAll = async (...ns) => { for (const n of ns) await n.net.stop(); };
const fund = (w) => ({ [`0x${Buffer.from(w.address).toString('hex')}`]: { balance: 100n * WEI } });

test('two nodes connect encrypted and a new block spreads', async () => {
  const a = await node(); const b = await node({}, [a.addr()]);
  assert.ok(await until(() => a.net.peerCount === 1 && b.net.peerCount === 1));
  b.chain.setClock(a.chain.now() + 15);
  await mine(a.chain);
  assert.ok(await until(() => b.chain.head.number === 1n));
  assert.deepEqual(b.chain.head.hash(), a.chain.head.hash());
  await stopAll(a, b);
});

test('a new node downloads a longer chain in batches', async () => {
  const a = await node();
  await mineMany(a.chain, 300);
  const b = await node({}, [a.addr()]);
  b.chain.setClock(a.chain.now());
  assert.ok(await until(() => b.chain.head.number === 300n, 60000), `výška ${b.chain.head.number}`);
  assert.deepEqual(b.chain.head.stateRoot, a.chain.head.stateRoot);
  await stopAll(a, b);
});

test('a transaction spreads across the network and is confirmed on all nodes', async () => {
  const w = wallet(); const to = wallet();
  const alloc = fund(w);
  const a = await node(alloc); const b = await node(alloc, [a.addr()]); const c = await node(alloc, [b.addr()]);
  assert.ok(await until(() => a.net.peerCount >= 1 && c.net.peerCount >= 1));
  const tx = transfer(a.chain, w, new Address(to.address), WEI, 0n);
  await c.chain.mempool.add(tx);
  c.net.broadcastTxs([tx]);
  assert.ok(await until(() => a.chain.mempool.size === 1), 'transakce došla na uzel A');
  b.chain.setClock(a.chain.now() + 15); c.chain.setClock(a.chain.now() + 15);
  await mine(a.chain, { txs: a.chain.mempool.pending() });
  assert.ok(await until(() => c.chain.head.number === 1n));
  await c.chain.mempool.settled();
  assert.equal(c.chain.mempool.size, 0);
  await stopAll(a, b, c);
});

test('a node connected later gets pending transactions and the miner mines them', async () => {
  const w = wallet(); const to = new Address(wallet().address);
  const alloc = fund(w);
  const a = await node(alloc);
  // The transaction arrived while node A had no peer. The broadcast then went nowhere.
  const txs = [];
  for (let n = 0n; n < 60n; n++) txs.push(transfer(a.chain, w, to, 1n, n));
  for (const tx of txs) await a.chain.mempool.add(tx);
  const b = await node(alloc, [a.addr()]);
  assert.ok(await until(() => b.chain.mempool.size === 60), `ve frontě B je ${b.chain.mempool.size} z 60`);
  assert.ok(a.net.peerCount === 1 && b.net.peerCount === 1, 'předání fronty nevedlo k odpojení za zahlcení');
  b.chain.setClock(a.chain.now() + 15);
  await mine(b.chain, { txs: b.chain.mempool.pending() });
  assert.equal(b.chain.getBlock(b.chain.head.hash()).txs.length, 60);
  await stopAll(a, b);
});

test('a split network converges on the heavier branch after reconnecting', async () => {
  const a = await node(); const b = await node();
  await mineMany(a.chain, 3);
  await mineMany(b.chain, 6, { miner: new Uint8Array(20).fill(5) });
  a.chain.setClock(b.chain.now()); b.chain.setClock(b.chain.now());
  a.net.connect('127.0.0.1', b.net.port);
  assert.ok(await until(() => a.chain.head.number === 6n), `výška ${a.chain.head.number}`);
  assert.deepEqual(a.chain.head.hash(), b.chain.head.hash());
  await stopAll(a, b);
});

test('a network split longer than the finality boundary converges on the branch with twice the work; the weaker side is not blocked', async () => {
  const a = await node(); const b = await node();
  await mineMany(a.chain, C.maxReorgDepth + 4);
  const ours = a.chain.headTd - a.chain.genesis.difficulty;
  while (b.chain.headTd - b.chain.genesis.difficulty < 2n * ours + 50n) await mine(b.chain, { step: 1, miner: new Uint8Array(20).fill(5) });
  const now = Math.max(a.chain.now(), b.chain.now());
  a.chain.setClock(now); b.chain.setClock(now);
  const deep = [];
  a.net.on('deep-fork', (e) => deep.push(e));
  a.net.connect('127.0.0.1', b.net.port);
  assert.ok(await until(() => equalHash(a.chain.head.hash(), b.chain.head.hash()), 60000), `výška ${a.chain.head.number}`);
  assert.equal(deep[0]?.accepted, true);
  assert.equal(b.net.bans.size + a.net.bans.size, 0, 'nikdo není zablokovaný');
  await stopAll(a, b);
});

test('a deeper branch with less work is not accepted and its node is not blocked', async () => {
  const a = await node(); const b = await node();
  await mineMany(a.chain, C.maxReorgDepth + 4);
  await mineMany(b.chain, C.maxReorgDepth + 10, { miner: new Uint8Array(20).fill(6) });
  const now = Math.max(a.chain.now(), b.chain.now());
  a.chain.setClock(now); b.chain.setClock(now);
  const head = a.chain.head.hash();
  const deep = [];
  a.net.on('deep-fork', (e) => deep.push(e));
  a.net.connect('127.0.0.1', b.net.port);
  assert.ok(await until(() => deep.length > 0, 60000), 'uzel větev ověřil');
  assert.equal(deep[0].accepted, false);
  await sleep(300);
  assert.deepEqual(a.chain.head.hash(), head);
  assert.equal(a.net.bans.size, 0, 'poctivý uzel z druhé části sítě se neblokuje');
  await stopAll(a, b);
});

test('announcement by hash: only some peers get full messages, yet they reach everyone and an older node gets them in full', async () => {
  const w = wallet();
  const alloc = fund(w);
  const hub = await node(alloc);
  const leaves = [];
  for (let i = 0; i < 5; i++) leaves.push(await node(alloc));
  // One peer is an older version: it does not support announcements and must get full messages.
  const legacy = leaves[4];
  legacy.net._helloBody = function legacyHello(peer) { return Network.prototype._helloBody.call(this, peer).slice(0, 11); };
  for (const l of leaves) hub.net.connect('127.0.0.1', l.net.port);
  assert.ok(await until(() => hub.net.peerCount === 5));
  const sent = new Map();
  for (const p of hub.net.peers) {
    const send = p.send.bind(p);
    const kind = () => (p.features & 1 ? 1 : 0);   // announcements by hash or full messages; other capabilities do not matter here
    p.send = (type, body) => { sent.set(`${kind()}:${type}`, (sent.get(`${kind()}:${type}`) ?? 0) + 1); return send(type, body); };
  }
  const tx = transfer(hub.chain, w, new Address(new Uint8Array(20).fill(3)), 1n, 0n);
  await hub.chain.mempool.add(tx);
  hub.net.broadcastTxs([tx]);
  assert.ok(await until(() => leaves.every((l) => l.chain.mempool.size === 1)), 'transakce je u všech');
  await mine(hub.chain, { txs: [tx] });
  for (const l of leaves) l.chain.setClock(hub.chain.now());
  assert.ok(await until(() => leaves.every((l) => l.chain.head.number === 1n)), 'blok je u všech');
  assert.ok((sent.get(`1:${MSG.NEW_TX_HASHES}`) ?? 0) >= 1, 'část sousedů dostala jen hash transakce');
  assert.ok((sent.get(`1:${MSG.NEW_BLOCK_HASH}`) ?? 0) >= 1, 'část sousedů dostala jen hash bloku');
  assert.equal(sent.get(`0:${MSG.NEW_TX_HASHES}`), undefined, 'starší uzel hash nedostane');
  assert.equal(sent.get(`0:${MSG.NEW_TXS}`), 1);
  assert.equal(sent.get(`0:${MSG.NEW_BLOCK}`), 1);
  await stopAll(hub, ...leaves);
});

test('a node spreading an invalid block is blocked', async () => {
  const a = await node();
  const evil = await newChain();
  evil.tick();
  const t = await evil.buildTemplate({ miner: new Uint8Array(20).fill(1) });
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  const bad = await seal(evil, new Block(new Header({ ...f, stateRoot: new Uint8Array(32).fill(3) }), []));
  a.chain.setClock(evil.now());
  const socket = net.connect({ host: '127.0.0.1', port: a.net.port });
  const ch = new SecureChannel(socket, true);
  const p = new Peer(ch, '127.0.0.1', false);
  ch.on('ready', () => {
    p.send(MSG.HELLO, new Network({ chain: evil, mempool: evil.mempool, port: 1 })._helloBody());
    setTimeout(() => p.send(MSG.NEW_BLOCK, [bad.encode()]), 100);
  });
  assert.ok(await until(() => ch.closed), 'útočník byl odpojen');
  assert.equal(a.chain.head.number, 0n);
  await stopAll(a);
});

test('a node from another network or garbage on the port does not crash the server', async () => {
  const a = await node();
  const s = net.connect({ host: '127.0.0.1', port: a.net.port });
  await once(s);
  s.write(Buffer.alloc(100, 0xff));
  await sleep(200);
  assert.equal(a.net.peerCount, 0);
  s.destroy();
  const s2 = net.connect({ host: '127.0.0.1', port: a.net.port });
  await once(s2);
  s2.write(Buffer.alloc(31, 1));
  s2.destroy();
  await sleep(100);
  const b = await node({}, [a.addr()]);
  assert.ok(await until(() => a.net.peerCount === 1));
  await stopAll(a, b);
});

test('node addresses spread between nodes without a central registry', async () => {
  const a = await node(); const b = await node({}, [a.addr()]);
  assert.ok(await until(() => a.net.peerCount === 1));
  const c = await node({}, [a.addr()]);
  assert.ok(await until(() => c.net.peerCount >= 2, 12000), `peerů ${c.net.peerCount}`);
  await stopAll(a, b, c);
});

test('a seed given by name: the node knows all its addresses and connects', async () => {
  const a = await node();
  const b = await node({}, [`localhost:${a.net.port}`]);
  assert.ok(b.chain.store.peersNew(100).includes(`127.0.0.1:${a.net.port}`) || b.chain.store.peersTried(100).includes(`127.0.0.1:${a.net.port}`), 'adresa ze jména je mezi známými uzly');
  assert.ok(await until(() => b.net.peerCount === 1), 'spojení přes seed se jménem');
  await stopAll(a, b);
});

function once(socket) { return new Promise((r) => socket.once('connect', r)); }

test('addresses learned from peer exchange survive a restart of the node', async () => {
  const dataDir = tmpData();
  const chain = await newChain({ dataDir });
  const n = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1', allowPrivate: false });
  const fake = { ready: true };
  n._onPeers(fake, ['8.8.4.4:30524', '1.1.1.1:30524', '10.0.0.5:30524'].map((a) => new TextEncoder().encode(a)));
  chain.close();
  const again = await newChain({ dataDir });
  const known = [...again.store.peersNew(100), ...again.store.peersTried(100)];
  assert.ok(known.includes('8.8.4.4:30524') && known.includes('1.1.1.1:30524'), `known: ${known.join(' ')}`);
  assert.ok(!known.includes('10.0.0.5:30524'), 'a private address from a stranger is not kept');
  again.close();
});

test('a late answer to a timed-out request is not misbehaviour, an unrequested one still is', async () => {
  const { EventEmitter } = await import('node:events');
  const { RLP } = await import('@ethereumjs/rlp');
  const { intToBytes } = await import('../src/util/bytes.js');
  const ch = Object.assign(new EventEmitter(), { send: () => true, close() {} });
  const p = new Peer(ch, '203.0.113.7', false);
  const late = p.request(MSG.GET_HEADERS, [[], intToBytes(1n)], 10).catch((e) => e);
  assert.match((await late).message, /in time/);
  const frame = (id) => Buffer.from(RLP.encode([intToBytes(id), []]));
  p._onFrame(MSG.HEADERS, frame(1n));
  assert.equal(p.score, 0, 'a late answer to our own request costs nothing');
  p._onFrame(MSG.HEADERS, frame(1n));
  p._onFrame(MSG.HEADERS, frame(99n));
  assert.equal(p.score, 20, 'a repeated or unrequested answer is penalised');
});

test('a pinned seed is only paused, not banned for an hour; other peers are banned for an hour', async () => {
  const { EventEmitter } = await import('node:events');
  const a = await node();
  a.net.allowPrivate = false;   // with allowPrivate, private addresses are never banned; these are public test addresses
  const wire = (ip, pinnedSeed) => {
    const socket = Object.assign(new EventEmitter(), { write: () => true, end() {}, destroy() {}, setNoDelay() {} });
    a.net._setup(socket, ip, false, 30524);
    const peer = [...a.net.peers].find((p) => p.address === ip);
    peer.verified = pinnedSeed;
    peer.pinnedSeed = pinnedSeed;
    return peer;
  };
  const now = Date.now();
  wire('203.0.113.7', true).misbehave(100, 'test');
  wire('203.0.113.8', false).misbehave(100, 'test');
  const seedFor = a.net.bans.get('203.0.113.7') - now;
  const otherFor = a.net.bans.get('203.0.113.8') - now;
  assert.ok(seedFor > 0 && seedFor <= 61_000, `the seed is only paused (${seedFor} ms)`);
  assert.ok(otherFor > 3_500_000, 'other peers are banned for an hour');
  await stopAll(a);
});
