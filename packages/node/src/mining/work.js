// getwork-style work for miners: the node does not mine itself, it only hands out templates and verifies results.
// The payout goes to the address the miner specifies. No account on the node is needed; any node can be used for mining.
import { EventEmitter } from 'node:events';
import { Block, Header } from '../core/types.js';
import { seedHash, epochOf, targetForDifficulty } from '../crypto/ethash.js';
import { Bucket } from '../p2p/peer.js';
import { equal, toHex } from '../util/bytes.js';
import { L } from '../lang.js';

const REBUILD_MS = 2000;
const MAX_TEMPLATE_AGE_MS = 15_000;  // the time in a block should match reality; LWMA computes difficulty from it
const MAX_TEMPLATES = 512;
const BUILD_RATE = [2, 32];          // builds with transactions per second and the allowed burst; above the limit a template without transactions
const FREE_BUILDS_PER_HEAD = 4;      // an attacker cannot produce a new block for free, so the first build after it does not count against the limit
const MAX_HASHRATES = 4096;

export class WorkError extends Error {}

export class WorkManager extends EventEmitter {
  constructor({ chain, mempool, network, extra = 'Quinvium', log = () => {} }) {
    super();
    this.setMaxListeners(1000);
    Object.assign(this, { chain, mempool, network, extra, log });
    this.templates = new Map();   // sealHash -> Block
    this.current = new Map();     // adresa -> { block, builtAt, headHash, pool }
    this.seeds = new Map();
    this.hashrates = new Map();
    this.building = new Map();
    this.buildBudget = new Bucket(...BUILD_RATE);
    this.freeBuilds = FREE_BUILDS_PER_HEAD;
    this._onHead = () => {
      this.current.clear();
      this.freeBuilds = FREE_BUILDS_PER_HEAD;
      this.emit('new-head');
    };
    chain.on('head', this._onHead);
  }

  stop() { this.chain.off('head', this._onHead); }

  _seed(number) {
    const epoch = epochOf(number);
    let s = this.seeds.get(epoch);
    if (!s) { s = seedHash(epoch); this.seeds.set(epoch, s); }
    return s;
  }

  async _build(miner) {
    const key = toHex(miner);
    const running = this.building.get(key);
    if (running) return running;
    const p = (async () => {
      // Executing transactions costs CPU and anyone chooses the payout address. Without a limit it would be enough
      // send requests with random addresses and the node would manage nothing else.
      const allowed = this.freeBuilds > 0 || this.buildBudget.take();
      this.freeBuilds -= 1;
      const block = await this.chain.buildTemplate({
        miner, txs: allowed ? this.mempool.pending() : [], extra: this.extra,
        onSkip: (tx, e) => this.log(`${L('Transakce přeskočena', 'Transaction skipped')}: ${e.message}`),
      });
      const seal = toHex(block.header.sealHash());
      this.templates.set(seal, block);
      if (this.templates.size > MAX_TEMPLATES) this.templates.delete(this.templates.keys().next().value);
      this.current.set(key, { block, builtAt: Date.now(), headHash: this.chain.head.hash(), pool: this.mempool.size });
      return block;
    })();
    this.building.set(key, p);
    try {
      return await p;
    } finally {
      this.building.delete(key);
    }
  }

  /** Returns work for the given payout address. The template is refreshed on a new block or a queue change. */
  async getWork(miner) {
    if (this.network?.behind) throw new WorkError('uzel se synchronizuje');
    const c = this.current.get(toHex(miner));
    const age = c ? Date.now() - c.builtAt : Infinity;
    const fresh = c && equal(c.headHash, this.chain.head.hash())
      && age < MAX_TEMPLATE_AGE_MS && (c.pool === this.mempool.size || age < REBUILD_MS);
    const block = fresh ? c.block : await this._build(miner);
    const h = block.header;
    return {
      sealHash: h.sealHash(), seedHash: this._seed(h.number), number: h.number, difficulty: h.difficulty,
      target: targetForDifficulty(h.difficulty),
    };
  }

  /**
   * Accepts a result from the miner.
   * @returns {Promise<{accepted: boolean, reason?: string, hash?: Uint8Array, number?: bigint}>}
   */
  async submit(nonce, sealHash, mixDigest) {
    const tpl = this.templates.get(toHex(sealHash));
    if (!tpl) return { accepted: false, reason: 'neznámá nebo stará práce' };
    const fields = Object.fromEntries(Object.entries(tpl.header).filter(([k]) => !k.startsWith('_')));
    const block = new Block(new Header({ ...fields, nonce, mixHash: mixDigest }), tpl.txs);
    if (!this.chain.pow.quickCheck(block.header)) return { accepted: false, reason: 'výsledek nesplňuje obtížnost' };
    try {
      const r = await this.chain.insertBlock(block);
      if (r.status === 'added' || r.status === 'reorg') {
        this.log(`${L('Vytěžen blok', 'Mined block')} #${block.header.number} ${toHex(r.hash).slice(0, 18)}`);
        return { accepted: true, hash: r.hash, number: block.header.number };
      }
      // A valid block that lost to a concurrent block brings no reward.
      return { accepted: r.status === 'side', stale: true, reason: r.status, hash: r.hash, number: block.header.number };
    } catch (e) {
      return { accepted: false, reason: e.message };
    }
  }

  reportHashrate(id, rate) {
    if (this.hashrates.size >= MAX_HASHRATES && !this.hashrates.has(id)) this.hashrate();
    if (this.hashrates.size < MAX_HASHRATES || this.hashrates.has(id)) this.hashrates.set(id, { rate: BigInt(rate), at: Date.now() });
  }

  /** Sum of hashrate reported by miners over the last 2 minutes. */
  hashrate() {
    let total = 0n;
    for (const [id, v] of this.hashrates) {
      if (Date.now() - v.at > 120_000) this.hashrates.delete(id);
      else total += v.rate;
    }
    return total;
  }
}
