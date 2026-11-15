import test from 'node:test';
import assert from 'node:assert/strict';
import { createMethods } from '../src/rpc/methods.js';
import { newChain, mineMany } from './helpers/chain.js';

test('search suggestions: a block by number, an address by its first digits, nothing invented', async () => {
  const chain = await newChain();
  await mineMany(chain, 3, { miner: new Uint8Array(20).fill(0xab) });
  const { methods } = createMethods({ chain, mempool: chain.mempool, network: null, work: null, version: 'x' });
  const block = methods.quinvium_suggest(['2']);
  assert.equal(block[0].type, 'block');
  assert.equal(block[0].id, '2');
  const byHash = methods.quinvium_suggest([block[0].hash]);
  assert.deepEqual([byHash[0].type, byHash[0].id], ['block', '2']);
  const miner = methods.quinvium_suggest(['0xabab']);
  assert.ok(miner.some((x) => x.type === 'address' && x.id === `0x${'ab'.repeat(20)}`), JSON.stringify(miner));
  assert.ok(methods.quinvium_suggest(['0xaba']).some((x) => x.id === `0x${'ab'.repeat(20)}`), 'an odd number of digits works too');
  assert.deepEqual(methods.quinvium_suggest(['0xabab', { type: 'blocks' }]), [], 'the filter narrows the answer');
  assert.deepEqual(methods.quinvium_suggest(['99999']), [], 'a block that does not exist');
  assert.deepEqual(methods.quinvium_suggest(['hello']), []);
  assert.ok(methods.quinvium_suggest(['0x', { limit: 50 }]).length === 0, 'too short a prefix');
  chain.close();
});
