import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from './consensus-guard.mjs';

const accepted = (n) => (n === 7 ? '---\nqip: 7\nstatus: Accepted\n---' : n === 8 ? '---\nqip: 8\nstatus: Draft\n---' : null);

test('changes outside consensus code pass', () => {
  assert.equal(judge({ changed: ['packages/explorer/public/app.js'], body: '', qipStatusOnBase: accepted }).ok, true);
});

test('consensus code needs an accepted QIP or the statement "No consensus change"', () => {
  const changed = ['packages/node/src/core/difficulty.js'];
  assert.equal(judge({ changed, body: 'refactor', qipStatusOnBase: accepted }).ok, false);
  assert.equal(judge({ changed, body: 'No consensus change, only comments', qipStatusOnBase: accepted }).ok, true);
  assert.equal(judge({ changed, body: 'Implements QIP-7', qipStatusOnBase: accepted }).ok, true);
  assert.equal(judge({ changed, body: 'Implements QIP-8', qipStatusOnBase: accepted }).ok, false, 'a draft is not enough');
  assert.equal(judge({ changed, body: 'Implements QIP-9', qipStatusOnBase: accepted }).ok, false, 'an unknown QIP is not enough');
  assert.equal(judge({ changed: ['packages/node/src/crypto/ethash.js'], body: '', qipStatusOnBase: accepted }).ok, false, 'folders count too');
});

test('changed golden tests always need an accepted QIP', () => {
  const changed = ['packages/node/src/params.js', 'packages/node/test/golden.test.js'];
  assert.equal(judge({ changed, body: 'No consensus change', qipStatusOnBase: accepted }).ok, false);
  assert.equal(judge({ changed, body: 'QIP-7', qipStatusOnBase: accepted }).ok, true);
});
