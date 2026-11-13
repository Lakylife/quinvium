import { createHash, getHashes } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';

// OpenSSL v Node počítá Keccak mnohem rychleji. Electron má BoringSSL bez Keccaku,
// proto zůstává záložní implementace. Výsledek je v obou případech stejný.
const NATIVE_KECCAK = getHashes().includes('keccak-256');
export const keccak = NATIVE_KECCAK
  ? (b) => new Uint8Array(createHash('keccak-256').update(b).digest())
  : (b) => keccak_256(b);
export const toHex = (b) => '0x' + Buffer.from(b).toString('hex');
export const fromHex = (h) => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error('neplatný hex');
  return new Uint8Array(Buffer.from(s, 'hex'));
};
export const quantity = (v) => '0x' + BigInt(v).toString(16);
export const equal = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0;

/** Minimální big-endian zápis celého čísla pro RLP (0 je prázdné pole). */
export function intToBytes(v) {
  const n = BigInt(v);
  if (n < 0n) throw new Error('záporné číslo');
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  return new Uint8Array(Buffer.from(h, 'hex'));
}

export function bytesToInt(b) {
  if (b.length === 0) return 0n;
  if (b[0] === 0) throw new Error('nekanonické celé číslo');
  return BigInt('0x' + Buffer.from(b).toString('hex'));
}

export const fixed = (b, len, name) => {
  if (!(b instanceof Uint8Array) || b.length !== len) throw new Error(`pole ${name} musí mít ${len} bajtů`);
  return b;
};
