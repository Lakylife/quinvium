// Every EVM subscribes to hardforkChanged on its Common. The chain keeps one Common per fork, so a VM built on it
// directly stayed reachable through that listener forever, with the whole state overlay of its block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCommon, newVm, openState } from '../src/core/executor.js';
import { NETWORKS } from '../src/params.js';

test('a VM does not leave a listener on the shared Common, so it can be garbage collected', async () => {
  const common = makeCommon(NETWORKS.dev);
  const store = { kvGet: () => undefined };
  const blockchain = { getBlock: async () => ({ hash: () => new Uint8Array(32) }), shallowCopy() { return this; } };
  const before = common.events.listenerCount('hardforkChanged');
  for (let i = 0; i < 50; i++) {
    const { stateManager } = await openState(store, common, null);
    const vm = await newVm(common, stateManager, blockchain);
    assert.equal(vm.common.hardfork(), common.hardfork(), 'the VM runs the same rules');
    assert.deepEqual(vm.common.eips(), common.eips());
  }
  assert.equal(common.events.listenerCount('hardforkChanged'), before);
});
