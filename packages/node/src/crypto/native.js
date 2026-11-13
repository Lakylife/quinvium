// Rychlá kryptografie pro provádění bloků: libsecp256k1 a rustbn ve WebAssembly.
// Výsledky musí být bajt po bajtu stejné jako u referenční implementace v JavaScriptu,
// což hlídá křížový test test/crypto-diff.test.js.
import { createHash, getHashes } from 'node:crypto';
import { RustBN254 } from '@ethereumjs/evm';
import { setLengthLeft } from '@ethereumjs/util';
import { initRustBN } from 'rustbn-wasm';
import { recover } from 'tiny-secp256k1';

const SHA256 = getHashes().includes('sha256');

export const sha256 = SHA256 ? (b) => new Uint8Array(createHash('sha256').update(b).digest()) : undefined;

function recoveryId(v, chainId) {
  if (v === 0n || v === 1n) return v;
  return chainId === undefined ? v - 27n : v - (chainId * 2n + 35n);
}

/** Stejné rozhraní a chování jako ecrecover z @ethereumjs/util. */
export function ecrecover(msgHash, v, r, s, chainId) {
  const id = recoveryId(v, chainId);
  if (id !== 0n && id !== 1n) throw new Error('Invalid signature v value');
  const signature = new Uint8Array(64);
  signature.set(setLengthLeft(r, 32), 0);
  signature.set(setLengthLeft(s, 32), 32);
  const key = recover(msgHash, signature, Number(id), false);
  if (!key) throw new Error('Invalid signature');
  return key.slice(1);
}

let bn254Ready = null;

/** @returns {Promise<RustBN254>} sdílená instance, inicializuje se jednou */
export function bn254() {
  bn254Ready ??= initRustBN().then((wasm) => new RustBN254(wasm));
  return bn254Ready;
}
