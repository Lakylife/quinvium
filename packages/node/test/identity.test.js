// Persistent node identity: the signature in HELLO binds the key to the connection; neither an attacker in the middle nor a forged seed gets through.
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

test('the node key is saved for the owner only and stays the same after a restart', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'aether-id-')), 'node.key');
  const a = NodeIdentity.load(file);
  const b = NodeIdentity.load(file);
  assert.deepEqual(a.publicKey, b.publicKey);
  assert.deepEqual(a.id, nodeIdOf(a.publicKey));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0);
});

test("nodes verify each other by signature and know each other's key", async () => {
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

test('an attacker relaying the connection between two nodes does not get through', async () => {
  const a = await node(); const b = await node();
  // The attacker has its own encrypted connection with each side and only relays messages.
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
  assert.match(reasons[0], /identity signature/);
  assert.equal(a.net.peerCount, 0);
  assert.equal(b.net.peerCount, 0);
  mitm.close();
  await stopAll(a, b);
});

test('seed with a pinned key: the right key passes, a foreign one does not', async () => {
  const b = await node();
  const good = await node({ seeds: [`${Buffer.from(b.net.identity.publicKey).toString('hex')}@127.0.0.1:${b.net.port}`] });
  assert.ok(await until(() => good.net.peerCount === 1), 'seed se správným klíčem se připojí');
  const wrong = await node({ seeds: [`${'ab'.repeat(32)}@127.0.0.1:${b.net.port}`] });
  const reasons = [];
  wrong.net.on('peer-disconnected', (_, reason) => reasons.push(reason));
  assert.ok(await until(() => reasons.length > 0));
  assert.match(reasons[0], /different key/);
  assert.equal(wrong.net.peerCount, 0);
  await stopAll(good, wrong, b);
});

test('an older node without an identity passes only where no identity is required', async () => {
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
  assert.match(reasons[0], /identity/);
  await stopAll(open, strict, legacy);
});
