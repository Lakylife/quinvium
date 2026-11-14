// Proof-of-work verification. The epoch cache is stored on disk because computing it takes seconds.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheSize, datasetSize, epochOf, generateCache, hashimotoLight, quickResult, seedHash, targetForDifficulty, bytesToBigInt } from '../crypto/ethash.js';
import { equal, keccak } from '../util/bytes.js';

const SUM_BYTES = 32;
// The cache of the next epoch starts being computed this many blocks ahead (about 4 hours). Otherwise all nodes would compute it at once
// with the first block of a new epoch, and block verification would stop across the whole network for several seconds.
export const PREPARE_AHEAD = 1000;
// How far above the tip a verified header may lie. The epoch cache is computed in proportion to its number, so a height from a foreign
// must be limited before it is touched. The margin covers a deep branch (50,000 headers) with room to spare.
export const VERIFY_HORIZON = 100_000n;

export class Pow {
  constructor(dir) {
    this.dir = dir;
    this.caches = new Map();  // epocha -> Promise<Uint8Array>
    this.maxNumber = null;    // highest height verify allows; set by the chain according to the tip
    if (dir) mkdirSync(dir, { recursive: true });
  }

  cache(epoch) {
    let c = this.caches.get(epoch);
    if (!c) {
      c = this._load(epoch);
      this.caches.set(epoch, c);
      // A failure must not stay in memory, otherwise the node would reject all blocks until restart.
      c.catch(() => this.caches.delete(epoch));
      // Only the newest epochs are kept in memory.
      if (this.caches.size > 3) this.caches.delete(Math.min(...this.caches.keys()));
    }
    return c;
  }

  async _load(epoch) {
    const size = cacheSize(epoch);
    const file = this.dir ? join(this.dir, `cache-${epoch}.bin`) : null;
    if (file && existsSync(file)) {
      // A checksum is at the end of the file. A corrupted file would lead to rejecting valid blocks.
      const b = readFileSync(file);
      if (b.length === size + SUM_BYTES) {
        const body = new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + size));
        if (equal(keccak(body), b.subarray(size))) return body;
      }
    }
    const c = await generateCache(size, seedHash(epoch));
    if (file) {
      try {
        writeFileSync(file + '.tmp', Buffer.concat([c, keccak(c)]));
        renameSync(file + '.tmp', file);
      } catch { /* a full disk does not matter; the cache is computed again next time */ }
    }
    return c;
  }

  /** Sets the height cap for verify according to the chain tip. */
  setHorizon(headNumber) {
    this.maxNumber = BigInt(headNumber) + VERIFY_HORIZON;
  }

  /** Called with every new tip. The computation runs in the background in pieces and does not slow block verification. */
  prepareFor(number) {
    this.setHorizon(number);
    const epoch = epochOf(number);
    if (epochOf(BigInt(number) + BigInt(PREPARE_AHEAD)) === epoch || this.caches.has(epoch + 1)) return;
    this.cache(epoch + 1).catch(() => {});
  }

  /** Cheap check without the cache. */
  quickCheck(header) {
    const r = bytesToBigInt(quickResult(header.sealHash(), header.nonce, header.mixHash));
    return r <= targetForDifficulty(header.difficulty);
  }

  async compute(sealHash, nonce, number) {
    const epoch = epochOf(number);
    return hashimotoLight(await this.cache(epoch), datasetSize(epoch), sealHash, nonce);
  }

  async verify(header) {
    if (this.maxNumber !== null && header.number > this.maxNumber) return false;
    if (!this.quickCheck(header)) return false;
    const { mixDigest, result } = await this.compute(header.sealHash(), header.nonce, header.number);
    return equal(mixDigest, header.mixHash) && bytesToBigInt(result) <= targetForDifficulty(header.difficulty);
  }
}
