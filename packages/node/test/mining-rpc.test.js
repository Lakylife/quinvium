// A public node with --no-mining-rpc neither hands out nor accepts work; the rest of RPC stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MINING_METHODS, RpcError, createMethods } from '../src/rpc/methods.js';

const fakeNode = (miningRpc) => {
  const reports = [];
  const work = { reportHashrate: (id, rate) => reports.push([id, rate]), hashrate: () => 0n };
  const chain = { network: { chainId: 52403n }, head: { number: 7n } };
  return { node: { chain, mempool: {}, network: null, work, version: 'test', miningRpc }, reports };
};

test('--no-mining-rpc vypne getWork, submitWork i submitHashrate', async () => {
  const { node, reports } = fakeNode(false);
  const { methods } = createMethods(node);
  for (const name of [...MINING_METHODS, 'quintium_getWork', 'quintium_submitWork']) {
    assert.throws(() => methods[name](['0x1', '0x' + '00'.repeat(32)]), (e) => e instanceof RpcError && e.code === -32601, name);
  }
  assert.equal(reports.length, 0, 'vymyšlený výkon se nezapočítá');
  assert.equal(methods.eth_chainId(), '0xccb3', 'běžné metody fungují dál');
});

test('without the option, mining over RPC stays enabled', () => {
  const { node, reports } = fakeNode(undefined);
  const { methods } = createMethods(node);
  assert.equal(methods.eth_submitHashrate(['0x10', '0x' + '11'.repeat(32)]), true);
  assert.equal(reports.length, 1);
});

test('peer IP addresses are visible only to this computer and the local network', () => {
  const peer = { address: '203.0.113.7:30524', inbound: true, agent: 'quinvium-node/test', height: 5, td: '10', id: 'ab'.repeat(16), verified: true };
  const { node } = fakeNode(undefined);
  const { methods } = createMethods({ ...node, network: { peersInfo: () => [peer] } });
  for (const name of ['aether_peers', 'quintium_peers', 'quinvium_peers']) {
    const far = methods[name]([], { ip: '198.51.100.9', local: false });
    assert.equal(far[0].address, null, name);
    assert.equal(far[0].id, peer.id, 'the node ID stays');
    assert.equal(far[0].height, 5);
    assert.ok(!JSON.stringify(far).includes('203.0.113.7'), name);
  }
  assert.equal(methods.aether_peers([], { ip: '192.168.1.5', local: true })[0].address, peer.address);
  assert.equal(methods.aether_peers([])[0].address, peer.address, 'the node itself (the app) sees addresses');
});

test('fork signalling: QIP-<n> in the extra data of blocks is counted per QIP and miner', () => {
  const enc = (s) => new TextEncoder().encode(s);
  const miners = [new Uint8Array(20).fill(1), new Uint8Array(20).fill(2)];
  const extras = ['Quinvium QIP-2', 'QIP-2 QIP-3', 'Quinvium', 'qip-2', 'QIP-2 QIP-2'];
  const headers = extras.map((e, i) => ({ number: BigInt(i), extraData: enc(e), miner: miners[i % 2] }));
  const { node } = fakeNode(undefined);
  const chain = { ...node.chain, head: { number: 4n, hash: () => new Uint8Array(32).fill(9) }, getHeaderByNumber: (n) => headers[Number(n)] };
  const { methods } = createMethods({ ...node, chain });
  const r = methods.aether_signals([{ blocks: 5 }]);
  assert.equal(r.blocks, 5);
  assert.deepEqual(r.signals.map((s) => [s.qip, s.blocks, s.miners]), [[2, 4, 2], [3, 1, 1]], 'one block counts once per QIP');
  assert.equal(r.signals[0].share, 0.8);
  assert.equal(methods.quinvium_signals([{ blocks: 2 }]).blocks, 2, 'window from the tip');
});
