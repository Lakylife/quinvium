// Trvalá identita uzlů: podpis v HELLO váže klíč ke spojení, útočník uprostřed ani podvržený seed neprojde.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Network } from '../src/p2p/network.js';
import { SecureChannel } from '../src/p2p/wire.js';
import { NodeIdentity, nodeIdOf } from '../src/p2p/identity.js';
import { newChain } from './helpers/chain.js';

const until = async (cond, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await sleep(25); }
  return false;
};

async function node(o = {}) {
  const chain = await newChain();
  const netw = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1', allowPrivate: true, ...o });
  await netw.start();
  return { chain, net: netw };
}
const stopAll = async (...ns) => { for (const n of ns) await n.net.stop(); };

test('klíč uzlu se uloží jen pro vlastníka a po restartu zůstane stejný', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'aether-id-')), 'node.key');
  const a = NodeIdentity.load(file);
  const b = NodeIdentity.load(file);
  assert.deepEqual(a.publicKey, b.publicKey);
  assert.deepEqual(a.id, nodeIdOf(a.publicKey));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0);
});

test('uzly se navzájem ověří podpisem a znají svůj klíč', async () => {
  const a = await node(); const b = await node();
  a.net.connect('127.0.0.1', b.net.port);
  assert.ok(await until(() => a.net.peerCount === 1 && b.net.peerCount === 1));
  const [pa] = a.net.peers; const [pb] = b.net.peers;
  assert.equal(pa.verified, true);
  assert.deepEqual(Buffer.from(pa.publicKey), b.net.identity.publicKey);
  assert.deepEqual(Buffer.from(pb.publicKey), a.net.identity.publicKey);
  assert.equal(a.net.peersInfo()[0].id, Buffer.from(b.net.nodeId).toString('hex'));
  await stopAll(a, b);
});

test('útočník, který spojení přeposílá mezi dvěma uzly, neprojde', async () => {
  const a = await node(); const b = await node();
  // Útočník má s každou stranou vlastní šifrované spojení a zprávy jen předává dál.
  const mitm = net.createServer((socket) => {
    const inner = new SecureChannel(socket, false);
    const outer = new SecureChannel(net.connect({ host: '127.0.0.1', port: b.net.port }), true);
    inner.on('frame', (type, payload) => outer.send(type, Buffer.from(payload)));
    outer.on('frame', (type, payload) => inner.send(type, Buffer.from(payload)));
    inner.on('close', () => outer.close('konec')); outer.on('close', () => inner.close('konec'));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => mitm.once('listening', r));
  const reasons = [];
  a.net.on('peer-disconnected', (_, reason) => reasons.push(reason));
  a.net.connect('127.0.0.1', mitm.address().port);
  assert.ok(await until(() => reasons.length > 0), 'spojení se ukončí');
  assert.match(reasons[0], /podpis identity/);
  assert.equal(a.net.peerCount, 0);
  assert.equal(b.net.peerCount, 0);
  mitm.close();
  await stopAll(a, b);
});

test('seed s připnutým klíčem: správný klíč projde, cizí ne', async () => {
  const b = await node();
  const good = await node({ seeds: [`${Buffer.from(b.net.identity.publicKey).toString('hex')}@127.0.0.1:${b.net.port}`] });
  assert.ok(await until(() => good.net.peerCount === 1), 'seed se správným klíčem se připojí');
  const wrong = await node({ seeds: [`${'ab'.repeat(32)}@127.0.0.1:${b.net.port}`] });
  const reasons = [];
  wrong.net.on('peer-disconnected', (_, reason) => reasons.push(reason));
  assert.ok(await until(() => reasons.length > 0));
  assert.match(reasons[0], /jiným klíčem/);
  assert.equal(wrong.net.peerCount, 0);
  await stopAll(good, wrong, b);
});

test('starší uzel bez identity projde jen tam, kde se identita nevyžaduje', async () => {
  const legacy = await node();
  legacy.net._helloBody = function legacyHello(peer) { return Network.prototype._helloBody.call(this, peer).slice(0, 11); };
  const open = await node();
  open.net.connect('127.0.0.1', legacy.net.port);
  assert.ok(await until(() => open.net.peerCount === 1), 'testnet: starší verze se připojí');
  assert.equal([...open.net.peers][0].verified, false);
  const strict = await node({ requireIdentity: true });
  const reasons = [];
  strict.net.on('peer-disconnected', (_, reason) => reasons.push(reason));
  strict.net.connect('127.0.0.1', legacy.net.port);
  assert.ok(await until(() => reasons.length > 0));
  assert.match(reasons[0], /identitu/);
  await stopAll(open, strict, legacy);
});
