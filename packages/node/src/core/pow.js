// Ověřování Proof of Work. Cache epoch se ukládá na disk, protože výpočet trvá sekundy.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheSize, datasetSize, epochOf, generateCache, hashimotoLight, quickResult, seedHash, targetForDifficulty, bytesToBigInt } from '../crypto/ethash.js';
import { equal, keccak } from '../util/bytes.js';

const SUM_BYTES = 32;
// Cache další epochy se začne počítat tolik bloků předem (asi 4 hodiny). Jinak by ji všechny uzly počítaly naráz
// s prvním blokem nové epochy a ověření bloků by se v celé síti na několik sekund zastavilo.
export const PREPARE_AHEAD = 1000;
// Jak daleko nad špičkou smí ležet ověřovaná hlavička. Cache epochy se počítá úměrně jejímu číslu, takže výšku z cizí
// hlavičky je nutné omezit dřív, než se na ni sáhne. Rezerva pokryje hlubokou větev (50 000 hlaviček) i s přesahem.
export const VERIFY_HORIZON = 100_000n;

export class Pow {
  constructor(dir) {
    this.dir = dir;
    this.caches = new Map();  // epocha -> Promise<Uint8Array>
    this.maxNumber = null;    // nejvyšší výška, kterou verify připustí; nastavuje řetězec podle špičky
    if (dir) mkdirSync(dir, { recursive: true });
  }

  cache(epoch) {
    let c = this.caches.get(epoch);
    if (!c) {
      c = this._load(epoch);
      this.caches.set(epoch, c);
      // Selhání nesmí zůstat v paměti, jinak by uzel do restartu odmítal všechny bloky.
      c.catch(() => this.caches.delete(epoch));
      // V paměti držíme jen nejnovější epochy.
      if (this.caches.size > 3) this.caches.delete(Math.min(...this.caches.keys()));
    }
    return c;
  }

  async _load(epoch) {
    const size = cacheSize(epoch);
    const file = this.dir ? join(this.dir, `cache-${epoch}.bin`) : null;
    if (file && existsSync(file)) {
      // Na konci souboru je kontrolní součet. Poškozený soubor by vedl k odmítání platných bloků.
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
      } catch { /* plný disk nevadí, cache se příště spočítá znovu */ }
    }
    return c;
  }

  /** Nastaví strop výšky pro verify podle špičky řetězce. */
  setHorizon(headNumber) {
    this.maxNumber = BigInt(headNumber) + VERIFY_HORIZON;
  }

  /** Volá se s každou novou špičkou. Výpočet běží na pozadí po kouscích a ověřování bloků nebrzdí. */
  prepareFor(number) {
    this.setHorizon(number);
    const epoch = epochOf(number);
    if (epochOf(BigInt(number) + BigInt(PREPARE_AHEAD)) === epoch || this.caches.has(epoch + 1)) return;
    this.cache(epoch + 1).catch(() => {});
  }

  /** Levná kontrola bez cache. */
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
