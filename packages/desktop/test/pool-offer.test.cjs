const test = require('node:test');
const assert = require('node:assert/strict');
const { poolOfferDue, OFFICIAL_POOLS, WARMUP_MS } = require('../src/pool-offer.cjs');

const T0 = 1_800_000_000_000;
const base = { network: 'mainnet', pool: null, off: false, offered: false, startedAt: T0, now: T0 + WARMUP_MS + 1, rates: [3e6, 3.2e6, 2.9e6], networkHashrate: 4.4e9 };

test('a small solo miner on mainnet gets the official pool after the warm-up', () => {
  const r = poolOfferDue(base);
  assert.equal(r.pool, OFFICIAL_POOLS.mainnet);
  assert.ok(r.share > 0 && r.share < 0.01);
  assert.ok(Math.abs(r.rate - 3.033e6) < 1e4);
});

test('no offer during the warm-up, without enough samples, or for a large miner', () => {
  assert.equal(poolOfferDue({ ...base, now: T0 + 60_000 }), null, 'still computing the DAG');
  assert.equal(poolOfferDue({ ...base, rates: [0, 3e6] }), null, 'too few real samples');
  assert.equal(poolOfferDue({ ...base, rates: [2e9, 2e9, 2e9] }), null, 'almost half of the network');
  assert.equal(poolOfferDue({ ...base, networkHashrate: 0 }), null, 'unknown network hashrate');
});

test('no offer in a pool, after "do not ask again", twice in one session, or on a network without an official pool', () => {
  assert.equal(poolOfferDue({ ...base, pool: { address: '0x1' } }), null);
  assert.equal(poolOfferDue({ ...base, off: true }), null);
  assert.equal(poolOfferDue({ ...base, offered: true }), null);
  assert.equal(poolOfferDue({ ...base, network: 'testnet' }), null);
});

test('the official pool address is a valid address on https', () => {
  for (const p of Object.values(OFFICIAL_POOLS)) {
    assert.match(p.address, /^0x[0-9a-fA-F]{40}$/);
    assert.match(p.url, /^https:\/\//);
  }
});
