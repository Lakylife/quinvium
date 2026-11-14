// /health: nobody confirms the peers' height, so one liar does not mark the node as lagging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RpcServer } from '../src/rpc/server.js';

function health(peerHeights, height = 100) {
  const peers = new Set(peerHeights.map((h) => ({ ready: true, headNumber: BigInt(h) })));
  const node = {
    chain: { network: { name: 'testnet', chainId: 52402n }, head: { number: BigInt(height), timestamp: 1000n }, now: () => 1010 },
    network: { peers, behind: false }, mempool: {}, work: null, version: 'test',
  };
  const server = new RpcServer(node, {});
  let status = 0;
  let body = '';
  server._health({ url: '/health' }, { writeHead: (s) => { status = s; }, end: (b) => { body = b; } });
  return { status, ...JSON.parse(body) };
}

test('one peer with an invented height does not mark the node as lagging', () => {
  const r = health([100, 100, 1_000_000]);
  assert.equal(r.status, 200);
  assert.equal(r.bestPeerHeight, 100);
});

test('when two peers agree on a higher height, the node is behind', () => {
  const r = health([110, 120, 100]);
  assert.equal(r.status, 503);
  assert.deepEqual(r.problems, ['behind']);
  assert.equal(r.bestPeerHeight, 110);
});

test('with a single peer its height counts; without peers our own', () => {
  assert.equal(health([105]).status, 503);
  assert.equal(health([]).status, 200);
});
