import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes, bytesToHex } from '@ethereumjs/util';
import { RLP } from '@ethereumjs/rlp';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { cacheSize, datasetSize, seedHash, generateCache, hashimotoLight, quickResult, targetForDifficulty, bytesToBigInt, epochOf } from '../src/crypto/ethash.js';

const hex = (b) => bytesToHex(b).slice(2);

test('cache and DAG sizes match the Ethash tables', () => {
  assert.equal(cacheSize(0), 16776896);
  assert.equal(datasetSize(0), 1073739904);
  assert.equal(cacheSize(1), 16907456);
  assert.equal(datasetSize(1), 1082130304);
  assert.equal(epochOf(29999), 0);
  assert.equal(epochOf(30000), 1);
});

test('the seed hash of epoch 1 is keccak256 of the zero seed', () => {
  assert.equal(hex(seedHash(0)), '00'.repeat(32));
  assert.equal(hex(seedHash(1)), '290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563');
});

test('hashimoto: real Ethereum block no. 1 including the header hash', async () => {
  const f = (h) => hexToBytes('0x' + h);
  const fields = [
    f('d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3'),
    f('1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'),
    f('05a56e2d52c817161883f50c441c3228cfe54d9f'),
    f('d67e4d450343046425ae4271474353857ab860dbc0a1dde64b41b5cd3a532bf3'),
    f('56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'),
    f('56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'),
    new Uint8Array(256),
    f('03ff800000'), f('01'), f('1388'), new Uint8Array(0), f('55ba4224'),
    f('476574682f76312e302e302f6c696e75782f676f312e342e32'),
  ];
  const mix = f('969b900de27b6ac6a67742365dd65f55a0526c41fd18e1b16f1a1215c2e66f59');
  const nonce = f('539bd4979fef1ec4');
  const sealHash = keccak_256(RLP.encode(fields));
  assert.equal(hex(keccak_256(RLP.encode([...fields, mix, nonce]))), '88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6');
  const cache = await generateCache(cacheSize(0), seedHash(0));
  const { mixDigest, result } = hashimotoLight(cache, datasetSize(0), sealHash, nonce);
  assert.equal(hex(mixDigest), hex(mix));
  assert.ok(bytesToBigInt(result) <= targetForDifficulty(0x3ff800000n));
});

test('hashimoto: real Ethereum block no. 22 (full epoch 0 cache)', async () => {
  const t0 = Date.now();
  const cache = await generateCache(cacheSize(0), seedHash(0));
  const t1 = Date.now();
  const header = hexToBytes('0x372eca2454ead349c3df0ab5d00b0b706b23e49d469387db91811cee0358fc6d');
  const nonce = hexToBytes('0x495732e0ed7a801c');
  const { mixDigest, result } = hashimotoLight(cache, datasetSize(0), header, nonce);
  const t2 = Date.now();
  assert.equal(hex(mixDigest), '2f74cdeb198af0b9abe65d22d372e22fb2d474371774a9583c1cc427a07939f5');
  assert.equal(hex(result), '00000b184f1fdd88bfd94c86c39e65db0c36144d5e43f745f722196e730cb614');
  assert.equal(hex(quickResult(header, nonce, mixDigest)), hex(result));
  console.log(`cache epochy 0: ${t1 - t0} ms, ověření bloku: ${t2 - t1} ms`);
});

test('difficulty target', () => {
  assert.equal(targetForDifficulty(1n), 2n ** 256n);
  assert.equal(targetForDifficulty(2n), 2n ** 255n);
  assert.equal(bytesToBigInt(new Uint8Array([1, 0])), 256n);
});

test('real Ethereum blocks across epochs: cache, DAG, result and difficulty', async () => {
  const { readFileSync } = await import('node:fs');
  // High epochs take minutes; the full set runs with AETHER_SLOW=1 and before every release.
  const vectors = JSON.parse(readFileSync(new URL('./fixtures/ethash-mainnet.json', import.meta.url)))
    .filter((v) => process.env.AETHER_SLOW || v.number <= 1000000);
  const caches = new Map();
  for (const v of vectors) {
    const epoch = epochOf(v.number);
    if (!caches.has(epoch)) caches.set(epoch, await generateCache(cacheSize(epoch), seedHash(epoch)));
    const seal = hexToBytes(v.sealHash);
    const nonce = hexToBytes(v.nonce);
    const { mixDigest, result } = hashimotoLight(caches.get(epoch), datasetSize(epoch), seal, nonce);
    assert.equal(bytesToHex(mixDigest), v.mixHash, `mixHash bloku ${v.number}, epocha ${epoch}`);
    assert.ok(bytesToBigInt(result) <= targetForDifficulty(BigInt(v.difficulty)), `obtížnost bloku ${v.number}`);
    assert.deepEqual(quickResult(seal, nonce, mixDigest), result);
    caches.delete(epoch - 1);
  }
});

test('the cache of the next epoch is computed in advance, not with its first block', async () => {
  const { Pow, PREPARE_AHEAD } = await import('../src/core/pow.js');
  const { POW_DIR } = await import('./helpers/chain.js');
  const early = new Pow(POW_DIR);
  early.prepareFor(30000 - PREPARE_AHEAD - 1);
  assert.equal(early.caches.has(1), false, 'daleko od hranice se nic nepočítá');
  const near = new Pow(POW_DIR);
  near.prepareFor(30000 - PREPARE_AHEAD);
  assert.equal(near.caches.has(1), true, 'blízko hranice se cache epochy 1 už připravuje');
  await near.caches.get(1);
});
