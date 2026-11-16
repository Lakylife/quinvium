import { createHash, getHashes } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';

// OpenSSL in Node computes Keccak much faster. Electron has BoringSSL without Keccak,
// so a fallback implementation remains. The result is the same in both cases.
const NATIVE_KECCAK = getHashes().includes('keccak-256');
export const keccak = NATIVE_KECCAK
  ? (b) => new Uint8Array(createHash('keccak-256').update(b).digest())
  : (b) => keccak_256(b);
export const toHex = (b) => '0x' + Buffer.from(b).toString('hex');
export const fromHex = (h) => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error('invalid hex');
  return new Uint8Array(Buffer.from(s, 'hex'));
};
export const quantity = (v) => '0x' + BigInt(v).toString(16);
export const equal = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0;

/** Minimal big-endian encoding of an integer for RLP (0 is an empty array). */
export function intToBytes(v) {
  const n = BigInt(v);
  if (n < 0n) throw new Error('negative number');
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  return new Uint8Array(Buffer.from(h, 'hex'));
}

export function bytesToInt(b) {
  if (b.length === 0) return 0n;
  if (b[0] === 0) throw new Error('non-canonical integer');
  return BigInt('0x' + Buffer.from(b).toString('hex'));
}

export const fixed = (b, len, name) => {
  if (!(b instanceof Uint8Array) || b.length !== len) throw new Error(`field ${name} must have ${len} bytes`);
  return b;
};
