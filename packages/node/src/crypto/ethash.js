// Ethash: paměťově náročný Proof of Work pro grafické karty.
// Implementace odpovídá specifikaci Ethash, takže síť mohou těžit běžné GPU minery.
// Ověřování používá pouze lehkou cache (16 MB a více), plný DAG (1 GB a více) drží jen miner.
import { keccak_256, keccak_512 } from '@noble/hashes/sha3.js';

export const EPOCH_LENGTH = 30000;
const DATASET_BYTES_INIT = 2 ** 30;
const DATASET_BYTES_GROWTH = 2 ** 23;
const CACHE_BYTES_INIT = 2 ** 24;
const CACHE_BYTES_GROWTH = 2 ** 17;
const HASH_BYTES = 64;
const MIX_BYTES = 128;
const DATASET_PARENTS = 256;
const CACHE_ROUNDS = 3;
const ACCESSES = 64;
const FNV_PRIME = 0x01000193;

if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) {
  throw new Error('Ethash vyžaduje little-endian procesor');
}

const fnv = (a, b) => (Math.imul(a, FNV_PRIME) ^ b) >>> 0;

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

export const epochOf = (blockNumber) => Math.floor(Number(blockNumber) / EPOCH_LENGTH);

export function cacheSize(epoch) {
  let size = CACHE_BYTES_INIT + CACHE_BYTES_GROWTH * epoch - HASH_BYTES;
  while (!isPrime(size / HASH_BYTES)) size -= 2 * HASH_BYTES;
  return size;
}

export function datasetSize(epoch) {
  let size = DATASET_BYTES_INIT + DATASET_BYTES_GROWTH * epoch - MIX_BYTES;
  while (!isPrime(size / MIX_BYTES)) size -= 2 * MIX_BYTES;
  return size;
}

export function seedHash(epoch) {
  let seed = new Uint8Array(32);
  for (let i = 0; i < epoch; i++) seed = keccak_256(seed);
  return seed;
}

/**
 * Vygeneruje lehkou cache. Průběžně uvolňuje event loop, takže uzel během
 * přechodu na novou epochu dál odpovídá.
 * @returns {Promise<Uint8Array>}
 */
export async function generateCache(size, seed) {
  const rows = Math.floor(size / HASH_BYTES);
  const cache = new Uint8Array(rows * HASH_BYTES);
  const words = new Uint32Array(cache.buffer);
  const yieldEvery = 8192;
  const pause = () => new Promise((resolve) => setImmediate(resolve));

  cache.set(keccak_512(seed), 0);
  for (let i = 1; i < rows; i++) {
    cache.set(keccak_512(cache.subarray((i - 1) * HASH_BYTES, i * HASH_BYTES)), i * HASH_BYTES);
    if (i % yieldEvery === 0) await pause();
  }

  const temp = new Uint8Array(HASH_BYTES);
  const tempWords = new Uint32Array(temp.buffer);
  for (let round = 0; round < CACHE_ROUNDS; round++) {
    for (let j = 0; j < rows; j++) {
      const src = ((j - 1 + rows) % rows) * 16;
      const xor = (words[j * 16] % rows) * 16;
      for (let k = 0; k < 16; k++) tempWords[k] = words[src + k] ^ words[xor + k];
      cache.set(keccak_512(temp), j * HASH_BYTES);
      if (j % yieldEvery === 0) await pause();
    }
  }
  return cache;
}

const itemBytes = new Uint8Array(HASH_BYTES);
const itemWords = new Uint32Array(itemBytes.buffer);

/** Spočítá jednu 64bajtovou položku DAG z lehké cache a zapíše ji do out[outOffset..]. */
function datasetItem(cacheWords, rows, index, out, outOffset) {
  const start = (index % rows) * 16;
  for (let k = 0; k < 16; k++) itemWords[k] = cacheWords[start + k];
  itemWords[0] = (itemWords[0] ^ index) >>> 0;
  itemBytes.set(keccak_512(itemBytes));
  for (let j = 0; j < DATASET_PARENTS; j++) {
    const parent = (fnv((index ^ j) >>> 0, itemWords[j % 16]) % rows) * 16;
    for (let k = 0; k < 16; k++) {
      itemWords[k] = (Math.imul(itemWords[k], FNV_PRIME) ^ cacheWords[parent + k]) >>> 0;
    }
  }
  itemBytes.set(keccak_512(itemBytes));
  for (let k = 0; k < 16; k++) out[outOffset + k] = itemWords[k];
}

const concat = (a, b) => {
  const r = new Uint8Array(a.length + b.length);
  r.set(a);
  r.set(b, a.length);
  return r;
};

/** Seed výpočtu: keccak512(hlavička || nonce v pořadí little-endian). */
function mixSeed(headerHash, nonce) {
  const data = new Uint8Array(40);
  data.set(headerHash);
  for (let i = 0; i < 8; i++) data[32 + i] = nonce[7 - i];
  return keccak_512(data);
}

/**
 * Lehký výpočet hashimoto.
 * @param {Uint8Array} cache lehká cache dané epochy
 * @param {number} fullSize velikost DAG v bajtech
 * @param {Uint8Array} headerHash 32bajtový seal hash hlavičky
 * @param {Uint8Array} nonce 8 bajtů big-endian
 * @returns {{mixDigest: Uint8Array, result: Uint8Array}}
 */
export function hashimotoLight(cache, fullSize, headerHash, nonce) {
  const cacheWords = new Uint32Array(cache.buffer, cache.byteOffset, Math.floor(cache.length / 4));
  const cacheRows = Math.floor(cache.length / HASH_BYTES);
  const pages = Math.floor(fullSize / MIX_BYTES);

  const seed = mixSeed(headerHash, nonce);
  const seedCopy = seed.slice();
  const seedWords = new Uint32Array(seedCopy.buffer, seedCopy.byteOffset, 16);
  const mix = new Uint32Array(32);
  for (let i = 0; i < 32; i++) mix[i] = seedWords[i % 16];

  const page = new Uint32Array(32);
  const seedHead = seedWords[0];
  for (let i = 0; i < ACCESSES; i++) {
    const parent = fnv((i ^ seedHead) >>> 0, mix[i % 32]) % pages;
    datasetItem(cacheWords, cacheRows, parent * 2, page, 0);
    datasetItem(cacheWords, cacheRows, parent * 2 + 1, page, 16);
    for (let k = 0; k < 32; k++) mix[k] = (Math.imul(mix[k], FNV_PRIME) ^ page[k]) >>> 0;
  }

  const digest = new Uint32Array(8);
  for (let i = 0; i < 32; i += 4) {
    digest[i / 4] = fnv(fnv(fnv(mix[i], mix[i + 1]), mix[i + 2]), mix[i + 3]);
  }
  const mixDigest = new Uint8Array(digest.buffer.slice(0));
  return { mixDigest, result: keccak_256(concat(seed, mixDigest)) };
}

/** Rychlá kontrola bez cache: zahodí nesmyslné bloky dřív, než se počítá plné ověření. */
export function quickResult(headerHash, nonce, mixHash) {
  return keccak_256(concat(mixSeed(headerHash, nonce), mixHash));
}

export const bytesToBigInt = (bytes) => {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
};

/** 2^256 / obtížnost: hash musí být menší nebo roven tomuto cíli. */
export const targetForDifficulty = (difficulty) => (2n ** 256n) / BigInt(difficulty);
