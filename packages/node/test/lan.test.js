// Hledání uzlů v místní síti: nové PC se má připojit bez ručního zadávání, cizí zprávy nesmí nic způsobit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { broadcastAddress, LanDiscovery } from '../src/p2p/discovery.js';
import { Network } from '../src/p2p/network.js';
import { mineMany, newChain } from './helpers/chain.js';

const GENESIS = 'ab'.repeat(32);
const NODE = '11'.repeat(16);
const OTHER = '22'.repeat(16);
const LOCAL = { address: '192.168.1.20', port: 41000 };
const until = async (cond, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
};

function harness() {
  const heard = [];
  const sent = [];
  const d = new LanDiscovery({
    chainId: 52402, genesis: GENESIS, port: 30525, nodeId: NODE, accepts: (ip) => ip.startsWith('192.168.'),
    onPeer: (...a) => heard.push(a), targets: () => [],
  });
  d._send = (message, host, port) => sent.push([message.toString(), host, port]);
  return { d, heard, sent };
}
const packet = (over = {}) => {
  const m = { chainId: 52402, genesis: GENESIS, port: 30525, nodeId: OTHER, kind: 'ask', ...over };
  return Buffer.from(`aether-lan1 ${m.chainId} ${m.genesis} ${m.port} ${m.nodeId} ${m.kind}`);
};

test('adresa pro všesměrové zprávy se počítá podle masky sítě', () => {
  assert.equal(broadcastAddress('192.168.1.235', '255.255.255.0'), '192.168.1.255');
  assert.equal(broadcastAddress('10.20.30.40', '255.255.0.0'), '10.20.255.255');
  assert.equal(broadcastAddress('172.16.5.9', '255.255.255.252'), '172.16.5.11');
});

test('uzel z místní sítě se ohlásí a dostane odpověď přímo', () => {
  const { d, heard, sent } = harness();
  d._onMessage(packet(), LOCAL);
  assert.deepEqual(heard, [['192.168.1.20', 30525, OTHER]]);
  assert.equal(sent.length, 1);
  assert.match(sent[0][0], / reply$/);
  assert.deepEqual(sent[0].slice(1), [LOCAL.address, LOCAL.port]);
});

test('na odpověď se znovu neodpovídá, zprávy se nemohou honit dokola', () => {
  const { d, heard, sent } = harness();
  d._onMessage(packet({ kind: 'reply' }), LOCAL);
  assert.equal(heard.length, 1);
  assert.equal(sent.length, 0);
});

test('cizí síť, jiný genesis, vlastní zpráva, smetí a zdroj mimo místní síť se ignorují', () => {
  const { d, heard, sent } = harness();
  d._onMessage(packet({ chainId: 52401 }), LOCAL);
  d._onMessage(packet({ genesis: 'cd'.repeat(32) }), LOCAL);
  d._onMessage(packet({ nodeId: NODE }), LOCAL);
  d._onMessage(packet({ port: 0 }), LOCAL);
  d._onMessage(packet({ port: 70000 }), LOCAL);
  d._onMessage(Buffer.from('smetí'), LOCAL);
  d._onMessage(Buffer.alloc(100000, 97), LOCAL);
  d._onMessage(packet(), { address: '8.8.8.8', port: 41000 });
  assert.deepEqual(heard, []);
  assert.deepEqual(sent, []);
});

test('bez volby lan uzel žádný UDP port neotevírá', async () => {
  const chain = await newChain();
  const n = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1' });
  await n.start();
  assert.equal(n.discovery, undefined);
  await n.stop();
});

test('počet uzlů ohlášených v místní síti má strop', async () => {
  const chain = await newChain();
  const n = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1' });
  n.connect = () => {};   // bez vytáčení, jde jen o evidenci
  for (let i = 0; i < 1000; i++) n._onLanPeer(`192.168.${i >> 8}.${i & 255}`, 30525, OTHER);
  assert.equal(n.lanPeers.size, 64);
});

test('dva uzly se najdou bez adresy a předají si řetězec', async () => {
  const [a, b] = await Promise.all([newChain(), newChain()]);
  await mineMany(a, 5);
  b.setClock(a.now() + 15);
  const [portA, portB] = [39411, 39412];
  const netA = new Network({ chain: a, mempool: a.mempool, port: 0, host: '127.0.0.1', lan: { listenPort: portA, targets: () => [['127.0.0.1', portB]] } });
  const netB = new Network({ chain: b, mempool: b.mempool, port: 0, host: '127.0.0.1', lan: { listenPort: portB, targets: () => [['127.0.0.1', portA]] } });
  await netA.start();
  await netB.start();
  try {
    assert.ok(await until(() => b.head.number === a.head.number), 'nový uzel stáhl řetězec');
    assert.equal(Buffer.from(b.head.hash()).toString('hex'), Buffer.from(a.head.hash()).toString('hex'));
    assert.equal(netA.peersInfo().length, 1);
    assert.equal(netB.peersInfo().length, 1);
  } finally {
    await netA.stop();
    await netB.stop();
  }
});
