// Chain: block verification, choosing the branch with the most work, reorganisations and indexes.
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { RLP } from '@ethereumjs/rlp';
import { Capability } from '@ethereumjs/tx';
import { Address } from '@ethereumjs/util';
import { CONSENSUS as C } from '../params.js';
import { forkIndex, rulesAt, upgradesAt } from './forks.js';
import { equal, fromHex, toHex } from '../util/bytes.js';
import { Block, Header } from './types.js';
import { nextDifficulty } from './difficulty.js';
import { blockReward, gasLimitValid, nextBaseFee, nextGasLimit } from './economics.js';
import { InvalidBlock, executeBlock, makeCommon, openState, orderedRoot, replayTx } from './executor.js';
import { buildGenesis } from './genesis.js';
import { Pow } from './pow.js';
import { Store } from './store.js';
import { blockReceipts, effectivePrice } from '../rpc/format.js';

const HEADER_CACHE = 2048;
const INDEX_BATCH = 200;
const BUILD_BUDGET_MS = 800;   // the miner waits no longer; the template is built from what was ready by then
const utf8 = new TextEncoder();
const min = (a, b) => (a < b ? a : b);

/** A temporary error: the block may be valid later; we do not penalise the peer for it. */
export class TemporaryBlockError extends Error {}

/**
 * A block or rewrite beyond the finality boundary. An honest node from the other half of a split network sends such a block in good faith,
 * so it is not a reason for a block.
 */
export class FinalityError extends Error {}

/**
 * A rewrite deeper than the finality boundary succeeds only with much more work. A split network thus converges after reconnecting
 * and a node that got a cheap fake branch on its first sync escapes it. The attacker must have
 * twice the work of the whole network since the split.
 */
export const DEEP_REORG_WORK_RATIO = 2n;
const DEEP_PERMIT_MS = 30 * 60_000;

export class Chain extends EventEmitter {
  constructor(o) {
    super();
    this.setMaxListeners(100);
    Object.assign(this, o);
    this.headers = new Map();
    this.commons = new Map();
    this.queue = Promise.resolve();
    this.commonAt = this.commonAt.bind(this);
  }

  /** EVM configuration valid for a block at the given height. */
  commonAt(number) {
    const i = forkIndex(this.network, number);
    let c = this.commons.get(i);
    if (!c) {
      c = i === 0 ? this.common : makeCommon(this.network, rulesAt(this.network, number));
      this.commons.set(i, c);
    }
    return c;
  }

  /**
   * @param {object} o
   * @param {object} o.network network parameters from params.js
   * @param {string} o.dataDir data folder, or ':memory:' for tests
   * @param {string} [o.powDir] folder with the Ethash cache
   * @param {object} [o.alloc] predeployed contracts
   * @param {() => number} [o.now] clock in seconds
   */
  static async open({ network, dataDir, powDir, alloc = {}, now, gasTarget }) {
    const store = new Store(dataDir === ':memory:' ? ':memory:' : join(dataDir, 'chain.db'));
    const common = makeCommon(network);
    const pow = new Pow(powDir ?? (dataDir === ':memory:' ? null : join(dataDir, 'ethash')));
    // A rejection applies only to this run of the program. A block the old version could not handle (for example the first block after a fork)
    // the new version would keep rejecting it and the node would stay cut off from the network forever after the update.
    store.clearBad();
    const chain = new Chain({
      network, store, common, pow, alloc, dataDir,
      now: now ?? (() => Math.floor(Date.now() / 1000)),
      gasTarget: gasTarget ?? C.genesisGasLimit,
      checkpoints: new Map((network.checkpoints ?? []).map((c) => [c.number, fromHex(c.hash)])),
      reorgs: { count: 0, deepest: 0, refused: 0 },   // for monitoring: a deep rewrite is the first sign of an attack
    });
    await chain._init();
    return chain;
  }

  async _init() {
    const genesis = await buildGenesis(this.network, this.store, this.common, this.alloc);
    const stored = this.store.canonicalHash(0);
    if (stored && !equal(stored, genesis.hash())) {
      throw new Error(`The database belongs to another network: genesis ${toHex(stored)}, expected ${toHex(genesis.hash())}`);
    }
    this.genesis = genesis;
    if (!stored) {
      const hash = genesis.hash();
      this.store.transaction(() => {
        this.store.blockPut(hash, 0n, genesis.parentHash, genesis.difficulty, genesis.encode(), RLP.encode([]));
        this.store.receiptsPut(hash, RLP.encode([[], []]));
        this.store.q.canonPut.run(0, Buffer.from(hash));
        this.store.metaPut('head', hash);
      });
    }
    const head = this.store.metaGet('head');
    this.head = this.getHeader(head);
    this.headTd = this.store.headerGet(head).td;
    this.pow.setHorizon(this.head.number);
    for (const [number, hash] of this.checkpoints) {
      const stored = number <= this.head.number ? this.store.canonicalHash(number) : null;
      if (stored && !equal(stored, hash)) throw new Error(`The database does not match the checkpoint at block ${number}: the node is on a foreign branch and must download the chain again.`);
    }
  }

  /**
   * Allows accepting blocks of a branch that diverged deeper than the finality boundary. The network calls it after verifying the headers
   * of whole branches, and they carry at least twice the work. The rewrite then still passes only when the work ratio is met.
   * @param {Header} ancestor common ancestor on the canonical chain
   */
  permitDeepFork(ancestor, ms = DEEP_PERMIT_MS) {
    this.deepPermit = { hash: ancestor.hash(), number: ancestor.number, until: Date.now() + ms };
  }

  _deepPermitted(number) {
    const p = this.deepPermit;
    return !!p && p.until > Date.now() && number >= p.number;
  }

  /** The highest checkpoint the chain has already passed. History below it is fixed. */
  passedCheckpoint() {
    let top = -1n;
    for (const number of this.checkpoints.keys()) if (number <= this.head.number && number > top) top = number;
    return top;
  }

  close() {
    return this._exclusive(async () => this.store.close());
  }

  /** Blocks are processed one at a time. */
  _exclusive(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  getHeader(hash) {
    const key = toHex(hash);
    let h = this.headers.get(key);
    if (h) return h;
    const r = this.store.headerGet(hash);
    if (!r) return null;
    h = Header.decode(r.header);
    this.headers.set(key, h);
    if (this.headers.size > HEADER_CACHE) this.headers.delete(this.headers.keys().next().value);
    return h;
  }

  getHeaderByNumber(n) {
    const hash = this.store.canonicalHash(n);
    return hash ? this.getHeader(hash) : null;
  }

  getTd(hash) { return this.store.headerGet(hash)?.td ?? null; }

  getBlock(hash) {
    const r = this.store.blockGet(hash);
    if (!r) return null;
    return Block.decodeBody(Header.decode(r.header), r.body, this.commonAt);
  }

  getBlockByNumber(n) {
    const hash = this.store.canonicalHash(n);
    return hash ? this.getBlock(hash) : null;
  }

  /** Number of transactions without decoding each of them. */
  txCount(hash) {
    const r = this.store.blockGet(hash);
    return r ? RLP.decode(r.body).length : 0;
  }

  /** @returns {{receipts: Uint8Array[], touched: Uint8Array[]}|null} */
  getReceipts(hash) {
    const r = this.store.blockGet(hash);
    if (!r?.receipts) return null;
    const [receipts, touched] = RLP.decode(r.receipts);
    return { receipts, touched };
  }

  isCanonical(hash, number) {
    const c = this.store.canonicalHash(number);
    return !!c && equal(c, hash);
  }

  nextDifficulty(parent) {
    return nextDifficulty(parent, (h) => {
      const header = this.getHeader(h);
      if (!header) throw new Error('missing ancestor for the difficulty calculation');
      return header;
    }, this.network);
  }

  /** Hash of the ancestor on the branch ending with the parent, for the BLOCKHASH opcode. */
  _ancestorLookup(parent) {
    return (n) => {
      if (n > parent.number) return new Uint8Array(32);
      let h = parent;
      while (h.number > n) {
        if (this.isCanonical(h.hash(), h.number)) {
          return this.store.canonicalHash(n) ?? new Uint8Array(32);
        }
        h = this.getHeader(h.parentHash);
      }
      return h.hash();
    };
  }

  /** Header rules that do not depend on the block content. */
  async validateHeader(h, parent) {
    if (h.number !== parent.number + 1n) throw new InvalidBlock('wrong height');
    if (h.timestamp <= parent.timestamp) throw new InvalidBlock('block time is not later than the parent time');
    if (h.timestamp > BigInt(this.now() + C.futureTimeLimit)) throw new TemporaryBlockError('block is too far in the future');
    if (h.extraData.length > C.maxExtraData) throw new InvalidBlock('extraData is too long');
    if (h.gasUsed > h.gasLimit) throw new InvalidBlock('gasUsed exceeds gasLimit');
    if (!gasLimitValid(h.gasLimit, parent.gasLimit, rulesAt(this.network, h.number).maxGasLimit)) throw new InvalidBlock('invalid gasLimit change');
    if (h.baseFee !== nextBaseFee(parent)) throw new InvalidBlock('wrong base fee');
    if (h.difficulty !== this.nextDifficulty(parent)) throw new InvalidBlock('wrong difficulty');
    if (!(await this.pow.verify(h))) throw new InvalidBlock('invalid proof of work');
  }

  async _validateBody(block) {
    const encoded = block.encode();
    if (encoded.length > C.maxBlockBytes) throw new InvalidBlock('block is too large');
    for (const tx of block.txs) {
      if (tx.serialize().length > C.maxTxBytes) throw new InvalidBlock('transaction is too large');
      if (tx.type === 0 && !tx.supports(Capability.EIP155ReplayProtection)) {
        throw new InvalidBlock('transaction without chainId replay protection');
      }
    }
    const txRoot = await orderedRoot(block.txs.map((t) => t.serialize()), this.commonAt(block.header.number));
    if (!equal(txRoot, block.header.txRoot)) throw new InvalidBlock('wrong transactions root');
  }

  /** Replays the transaction at its place in the block and returns how it ended. Nothing is stored. */
  async replayTx(block, index) {
    const h = block.header;
    const parent = this.getHeader(h.parentHash);
    return replayTx({
      store: this.store, common: this.commonAt(h.number), parent, ctx: h, txs: block.txs, index,
      ancestorHash: this._ancestorLookup(parent), pow: this.pow, upgrades: upgradesAt(this.network, h.number),
    });
  }

  /** Executes the block on the parent state and compares the result with the header. */
  async _execute(block, parent) {
    const h = block.header;
    const res = await executeBlock({
      store: this.store, common: this.commonAt(h.number), parent, ctx: h, txs: block.txs, mode: 'verify',
      ancestorHash: this._ancestorLookup(parent), pow: this.pow, upgrades: upgradesAt(this.network, h.number),
    });
    if (!equal(res.stateRoot, h.stateRoot)) throw new InvalidBlock('wrong state root');
    if (!equal(res.receiptsRoot, h.receiptsRoot)) throw new InvalidBlock('wrong receipts root');
    if (res.gasUsed !== h.gasUsed) throw new InvalidBlock('wrong gasUsed');
    if (!equal(res.logsBloom, h.logsBloom)) throw new InvalidBlock('wrong logs bloom');
    return res;
  }

  /**
   * Accepts a block from the network or from a miner.
   * @returns {Promise<{status: 'known'|'orphan'|'added'|'side'|'reorg', hash: Uint8Array, depth?: number}>}
   */
  insertBlock(block) {
    return this._exclusive(async () => {
      const h = block.header;
      const hash = h.hash();
      const bad = this.store.badReason(hash);
      if (bad) throw new InvalidBlock(`previously rejected block: ${bad}`);
      if (this.store.blockHas(hash)) return { status: 'known', hash };
      const parent = this.getHeader(h.parentHash);
      if (!parent) return { status: 'orphan', hash };
      if (this.store.badReason(h.parentHash)) throw new InvalidBlock('parent is invalid');
      if (h.number + BigInt(C.maxReorgDepth) <= this.head.number) {
        // Deep below the tip only a branch the network verified in advance, and only on top of the canonical ancestor or another side branch.
        const deep = this._deepPermitted(h.number - 1n)
          && (equal(h.parentHash, this.deepPermit.hash) || !this.isCanonical(h.parentHash, parent.number));
        if (!deep) throw new FinalityError('block is below the finality limit');
      }
      const fixed = this.checkpoints.get(h.number);
      if (fixed && !equal(fixed, hash)) throw new InvalidBlock(`block does not match the checkpoint ${h.number}`);
      if (h.number <= this.passedCheckpoint()) throw new InvalidBlock('block is below a checkpoint');

      // The block is not marked invalid here. The hash covers only the header, so an attacker could attach
      // a forged body to a valid block: recording the hash would cut the node off from the correct chain forever.
      // Only a block with the correct body and valid work whose execution fails may be marked.
      await this.validateHeader(h, parent);
      await this._validateBody(block);

      const td = this.getTd(h.parentHash) + h.difficulty;

      if (equal(h.parentHash, this.head.hash())) {
        let res;
        try {
          res = await this._execute(block, parent);
        } catch (e) {
          if (e instanceof InvalidBlock) this.store.markBad(hash, e.message);
          throw e;
        }
        res.db.flush();
        this.store.transaction(() => {
          this.store.blockPut(hash, h.number, h.parentHash, td, h.encode(), block.encodeBody());
          this._connect(block, res);
          this._setHead(h, td);
        });
        this._notify('head', { block, receipts: res.receipts, removed: [], added: [block] });
        return { status: 'added', hash };
      }

      this.store.blockPut(hash, h.number, h.parentHash, td, h.encode(), block.encodeBody());
      if (td <= this.headTd) return { status: 'side', hash };
      return this._reorg(block, td);
    });
  }

  _setHead(h, td) {
    this.head = h;
    this.headTd = td;
    this.store.metaPut('head', h.hash());
    this.pow.prepareFor(h.number);
  }

  /** Writes a block into the canonical chain and indexes. Called inside a database transaction. */
  _connect(block, res) {
    const { store } = this;
    const h = block.header;
    const hash = h.hash();
    const number = Number(h.number);
    const q = store.q;
    const touched = res.accounts.map((a) => a.addr);
    store.receiptsPut(hash, RLP.encode([res.receipts.map((r) => r.encoded), touched]));
    q.canonPut.run(number, Buffer.from(hash));
    q.feesPut.run(number, (store.feesAt(number - 1) + res.fees).toString());
    let logIndex = 0;
    block.txs.forEach((tx, i) => {
      q.txPut.run(Buffer.from(tx.hash()), number, i);
      q.addrPut.run(Buffer.from(tx.getSenderAddress().bytes), number, i);
      if (tx.to) q.addrPut.run(Buffer.from(tx.to.bytes), number, i);
      for (const [address, topics] of res.receipts[i].receipt.logs) {
        q.logPut.run(number, i, logIndex++, Buffer.from(address), ...[0, 1, 2, 3].map((t) => (topics[t] ? Buffer.from(topics[t]) : null)));
      }
    });
    for (const a of res.accounts) store.accountPut(a.addr, a.balance, a.isContract);
    this._index(block, res.receipts.map((r) => ({ gasUsed: r.gasUsed, ok: !!r.receipt.status })));
  }

  /** Index for the Explorer: filters, address details and charts. Consensus does not read it. */
  _index(block, receipts) {
    const { q } = this.store;
    const h = block.header;
    const number = Number(h.number);
    const parent = this.getHeader(h.parentHash);
    let fees = 0n;
    block.txs.forEach((tx, i) => {
      const { gasUsed, ok } = receipts[i];
      const fee = gasUsed * effectivePrice(tx, h.baseFee);
      fees += fee;
      const kind = !tx.to ? 2 : tx.data.length ? 1 : 0;
      q.txIndexPut.run(number, i, Number(h.timestamp), Buffer.from(tx.getSenderAddress().bytes), tx.to ? Buffer.from(tx.to.bytes) : null, kind, ok ? 1 : 0, Number(tx.value), Number(fee));
    });
    const solve = parent ? Number(h.timestamp - parent.timestamp) : 0;
    q.blockIndexPut.run(number, Number(h.timestamp), Buffer.from(h.miner), Number(h.difficulty), solve, block.txs.length, Number(h.gasUsed), Number(blockReward(h.number) + fees));
  }

  /**
   * Fills the index for blocks from earlier node versions. Runs in small batches so it does not slow the network or mining.
   * @returns {Promise<void>} done when the index has caught up with the tip
   */
  async backfillIndex(batch = INDEX_BATCH) {
    for (;;) {
      const next = this.store.indexedTip() + 1n;
      if (next > this.head.number) return;
      this.store.transaction(() => {
        for (let n = next; n < next + BigInt(batch) && n <= this.head.number; n += 1n) {
          const block = this.getBlockByNumber(n);
          const stored = block && this.getReceipts(block.hash());
          if (!stored) return;
          this._index(block, blockReceipts(block, stored.receipts).map((r) => ({ gasUsed: r.gasUsed, ok: r.status === 1 })));
        }
      });
      await new Promise((r) => setImmediate(r));
    }
  }

  /** Switch to a heavier branch. The state is recomputed; the old chain stays until everything passes. */
  async _reorg(block, td) {
    const path = [];
    let cursor = block.header;
    while (!this.isCanonical(cursor.hash(), cursor.number)) {
      path.unshift(cursor);
      cursor = this.getHeader(cursor.parentHash);
      if (!cursor) throw new Error('broken branch');
    }
    const ancestor = cursor;
    const depth = Number(this.head.number - ancestor.number);
    if (depth > C.maxReorgDepth) {
      if (!this._deepPermitted(ancestor.number)) {
        this.reorgs.refused += 1;
        this._notify('finality-violation', { hash: block.hash(), depth });
        throw new FinalityError(`a reorganisation of ${depth} blocks is beyond the finality limit`);
      }
      // The branch stays a side branch until it has twice the work of our branch since the common ancestor.
      const base = this.getTd(ancestor.hash());
      if (td - base < DEEP_REORG_WORK_RATIO * (this.headTd - base)) return { status: 'side', hash: block.hash() };
      this._notify('deep-reorg', { depth, ancestor: ancestor.number });
    }

    const results = [];
    let parent = ancestor;
    for (const header of path) {
      const b = this.getBlock(header.hash());
      let res;
      try {
        res = await this._execute(b, parent);
      } catch (e) {
        if (e instanceof InvalidBlock) {
          // This block and all its descendants on the branch are invalid.
          for (const x of path.slice(path.indexOf(header))) this.store.markBad(x.hash(), e.message);
        }
        throw e;
      }
      res.db.flush();
      results.push({ block: b, res });
      parent = header;
    }

    const removed = [];
    for (let n = this.head.number; n > ancestor.number; n--) removed.push(this.getBlockByNumber(n));

    const touched = new Map();
    for (const b of removed) {
      for (const a of this.getReceipts(b.hash())?.touched ?? []) touched.set(toHex(a), a);
    }

    const { q } = this.store;
    const keep = Number(ancestor.number);
    this.store.transaction(() => {
      q.canonDelAbove.run(keep);
      q.txDelAbove.run(keep);
      q.addrDelAbove.run(keep);
      q.logDelAbove.run(keep);
      q.feesDelAbove.run(keep);
      q.blockIndexDel.run(keep);
      q.txIndexDel.run(keep);
      for (const { block: b, res } of results) this._connect(b, res);
      this._setHead(block.header, td);
    });

    // Accounts affected by the abandoned branch are recomputed from the new state.
    const state = await this.stateAt(block.header.stateRoot);
    for (const a of touched.values()) {
      const account = await state.getAccountByBytes(a);
      this.store.accountPut(a, account?.balance ?? 0n, account?.isContract() ?? false);
    }

    this.reorgs.count += 1;
    if (depth > this.reorgs.deepest) this.reorgs.deepest = depth;
    const added = results.map((r) => r.block);
    const last = results[results.length - 1];
    this._notify('head', { block, receipts: last.res.receipts, removed, added });
    this._notify('reorg', { depth, removed, added });
    return { status: 'reorg', hash: block.hash(), depth };
  }

  /**
   * Tells observers about a chain event. Observers never change the outcome of block insertion: each listener runs
   * on its own, and one that throws is reported as 'listener-error' (when someone listens for it) instead of
   * stopping the listeners after it or the insertion that is already stored.
   */
  _notify(event, payload) {
    const report = (error) => {
      if (this.listenerCount('listener-error') === 0) return;
      try { this.emit('listener-error', { event, error }); } catch { /* a failing reporter changes nothing either */ }
    };
    for (const listener of this.rawListeners(event)) {
      try {
        const result = listener.call(this, payload);
        if (result && typeof result.then === 'function') result.then(undefined, report);
      } catch (error) {
        report(error);
      }
    }
  }

  /** Read access to the state; never writes to disk. */
  async stateAt(root) {
    const { stateManager } = await openState(this.store, this.common, root);
    return {
      stateManager,
      getAccountByBytes: (bytes) => stateManager.getAccount(new Address(bytes)),
    };
  }

  /**
   * Builds a block template for the miner.
   * @param {object} o
   * @param {Uint8Array} o.miner payout address
   * @param {Iterable} o.txs transakce podle priority
   * @param {string} [o.extra] short description in extraData
   * @param {number} [o.budgetMs] time limit for template transactions
   */
  buildTemplate({ miner, txs = [], extra = 'aether', onSkip, budgetMs = BUILD_BUDGET_MS }) {
    return this._exclusive(async () => {
      const parent = this.head;
      const ctx = {
        number: parent.number + 1n,
        miner,
        gasLimit: nextGasLimit(parent.gasLimit, min(this.gasTarget, rulesAt(this.network, parent.number + 1n).maxGasLimit)),
        timestamp: BigInt(Math.max(this.now(), Number(parent.timestamp) + 1)),
        baseFee: nextBaseFee(parent),
      };
      const res = await executeBlock({
        store: this.store, common: this.commonAt(ctx.number), parent, ctx, txs, mode: 'build',
        ancestorHash: this._ancestorLookup(parent), pow: this.pow, upgrades: upgradesAt(this.network, ctx.number),
        onSkip, budgetMs,
      });
      const header = new Header({
        ...ctx,
        parentHash: parent.hash(), stateRoot: res.stateRoot, txRoot: res.txRoot, receiptsRoot: res.receiptsRoot,
        logsBloom: res.logsBloom, difficulty: this.nextDifficulty(parent), gasUsed: res.gasUsed,
        extraData: utf8.encode(extra).subarray(0, C.maxExtraData), mixHash: new Uint8Array(32), nonce: new Uint8Array(8),
      });
      return new Block(header, res.txs);
    });
  }
}
