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
