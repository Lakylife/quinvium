// Proof-of-work verification from a contract runs on every node over data from anyone. An exception or a different result would split the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RLP } from '@ethereumjs/rlp';
import { randomBytes } from 'node:crypto';
import { POW_VERIFY_ADDRESS, POW_VERIFY_GAS, powVerifyPrecompile } from '../src/core/precompiles.js';
import { Pow } from '../src/core/pow.js';
import { Header } from '../src/core/types.js';
import { bytesToBigInt } from '../src/crypto/ethash.js';
import { POW_DIR } from './helpers/chain.js';

const EPOCH = 30000n;
const base = {
  parentHash: new Uint8Array(32).fill(1), miner: new Uint8Array(20).fill(2), stateRoot: new Uint8Array(32).fill(3), txRoot: new Uint8Array(32).fill(4),
  receiptsRoot: new Uint8Array(32).fill(5), logsBloom: new Uint8Array(256), difficulty: 1000n, number: 7n, gasLimit: 10_000_000n, gasUsed: 0n,
  timestamp: 1793404800n, extraData: new Uint8Array(32).fill(6), baseFee: 1_000_000_000n, mixHash: new Uint8Array(32), nonce: new Uint8Array(8),
};
const pow = new Pow(POW_DIR);
const run = (data, number = 100n, gasLimit = POW_VERIFY_GAS, using = pow) => powVerifyPrecompile(using, number).function({ data, gasLimit });
const counting = () => {
  const fake = { calls: 0, compute: async () => { fake.calls += 1; return { mixDigest: new Uint8Array(32), result: new Uint8Array(32).fill(255) }; } };
  return fake;
};
async function sealed(fields = {}) {
  const h = new Header({ ...base, ...fields });
  const { mixDigest } = await pow.compute(h.sealHash(), h.nonce, h.number);
  return new Header({ ...base, ...fields, mixHash: mixDigest });
}

test('the address and price are fixed; a change is a hard fork', () => {
  assert.equal(POW_VERIFY_ADDRESS, '0x0000000000000000000000000000000000000100');
  assert.equal(POW_VERIFY_GAS, 100_000n);
});

test('a valid header returns seven words and the correct work', async () => {
  const h = await sealed();
  const r = await run(h.encode());
  assert.equal(r.executionGasUsed, POW_VERIFY_GAS);
  assert.equal(r.exceptionError, undefined);
  assert.equal(r.returnValue.length, 7 * 32);
  const word = (i) => r.returnValue.subarray(i * 32, (i + 1) * 32);
  assert.deepEqual(word(0).subarray(12), h.miner);
  assert.equal(bytesToBigInt(word(1)), 7n);
  assert.deepEqual(word(2), h.parentHash);
  assert.equal(bytesToBigInt(word(3)), 1000n);
  const { result } = await pow.compute(h.sealHash(), h.nonce, h.number);
  assert.equal(bytesToBigInt(word(4)), (1n << 256n) / (bytesToBigInt(result) + 1n));
  assert.deepEqual(word(5), h.extraData);
  assert.deepEqual(word(6), h.hash());
});

test('too little gas is a call error and uses the whole limit', async () => {
  const h = await sealed();
  const r = await run(h.encode(), 100n, POW_VERIFY_GAS - 1n);
  assert.equal(r.executionGasUsed, POW_VERIFY_GAS - 1n);
  assert.equal(r.exceptionError.error, 'out of gas');
  assert.equal(r.returnValue.length, 0);
});

test('the cache of a foreign epoch is never computed', async () => {
  const fake = counting();
  const ask = (number, at) => run(new Header({ ...base, number }).encode(), at, POW_VERIFY_GAS, fake);
  // A header from the future and a too-old epoch end without computation.
  assert.equal((await ask(101n, 100n)).returnValue.length, 0);
  assert.equal((await ask(EPOCH - 1n, EPOCH * 2n)).returnValue.length, 0);
  assert.equal((await ask(1n, EPOCH * 500n)).returnValue.length, 0);
  assert.equal((await ask(0n, 100n)).returnValue.length, 0);
  assert.equal(fake.calls, 0);
  // The current and the previous epoch are computed; mixHash then decides.
  await ask(EPOCH, EPOCH * 2n - 1n);
  await ask(EPOCH * 2n, EPOCH * 2n);
  assert.equal(fake.calls, 2);
});

test('random data or corrupted headers do not crash the node and always cost the same', async () => {
  const good = (await sealed()).encode();
  const fake = counting();
  const check = async (data) => {
    const r = await run(data, 100n, 1_000_000n, fake);
    assert.equal(r.executionGasUsed, POW_VERIFY_GAS);
    assert.equal(r.exceptionError, undefined);
    assert.equal(r.returnValue.length, 0, 'poškozený vstup nesmí projít');
  };
  for (const size of [0, 1, 2, 31, 32, 33, 55, 56, 500, 2048, 2049, 70000]) await check(new Uint8Array(randomBytes(size)));
  for (let i = 0; i < 1500; i++) {
    const data = new Uint8Array(good);
    const edits = 1 + (i % 4);
    for (let k = 0; k < edits; k++) data[Math.floor(Math.random() * data.length)] ^= 1 + Math.floor(Math.random() * 255);
    await check(data);
  }
  for (let i = 0; i < 300; i++) await check(new Uint8Array(good.subarray(0, Math.floor(Math.random() * good.length))));
  const fields = new Header(base).fields();
  const nasty = [
    [...fields, new Uint8Array(1)],                      // 16 fields
    fields.slice(0, 14),                                 // 14 fields
    fields.map((f, i) => (i === 3 ? [f] : f)),           // nested list
    fields.map((f, i) => (i === 7 ? new Uint8Array(40).fill(255) : f)),  // height over 256 bits
    fields.map((f, i) => (i === 6 ? new Uint8Array(40).fill(255) : f)),  // difficulty over 256 bits
    fields.map((f, i) => (i === 6 ? new Uint8Array(0) : f)),             // zero difficulty
    fields.map((f, i) => (i === 11 ? new Uint8Array(33) : f)),           // long extraData
    fields.map((f, i) => (i === 7 ? new Uint8Array([0, 7]) : f)),        // non-canonical height
  ];
  for (const n of nasty) await check(RLP.encode(n));
  assert.equal(fake.calls > 0, true, 'část poškozených hlaviček došla až k ověření práce');
});

test('the result does not depend on how often and in what order it is called', async () => {
  const a = await sealed({ number: 11n });
  const b = await sealed({ number: 12n });
  const first = [await run(a.encode()), await run(b.encode())];
  const second = [await run(b.encode()), await run(a.encode())];
  assert.deepEqual(first[0].returnValue, second[1].returnValue);
  assert.deepEqual(first[1].returnValue, second[0].returnValue);
});

test('a node error does not pass for invalid work', async () => {
  const broken = { compute: async () => { throw new Error('disk je plný'); } };
  await assert.rejects(run((await sealed()).encode(), 100n, POW_VERIFY_GAS, broken), /disk je plný/);
});
