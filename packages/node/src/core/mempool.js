// Queue of unconfirmed transactions. It accepts only what could pass in the next block,
// and after every change of the chain tip removes by itself what can no longer be valid.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Capability } from '@ethereumjs/tx';
import { Address } from '@ethereumjs/util';
import { CONSENSUS as C } from '../params.js';
import { toHex } from '../util/bytes.js';
import { nextBaseFee } from './economics.js';
import { decodeTx } from './types.js';

export class MempoolError extends Error {}

// Queue file: a marker followed by records. Transaction: [0][time added 8 B][flags 1 B][length 4 B][transaction].
// Replaced transaction: [1][hash 32 B], appended immediately so an older save cannot bring it back after a crash.
const JOURNAL_MAGIC = Buffer.from('QMP1');
const TX_RECORD = 0;
const REPLACED_RECORD = 1;
const LOCAL = 1;

const MAX_POOL = 5000;
const MAX_POOL_BYTES = 64 * 1024 * 1024;
const MAX_PER_SENDER = 64;
const MAX_NONCE_GAP = 64n;
const MAX_TX_GAS = 8_000_000n;       // one transaction must not take the whole block; this is enough even for the largest contract
const MAX_AGE_MS = 6 * 3600_000;
const REPLACE_BUMP = 110n;

const maxFee = (tx) => (tx.type === 2 ? tx.maxFeePerGas : tx.gasPrice);
const maxTip = (tx) => (tx.type === 2 ? tx.maxPriorityFeePerGas : tx.gasPrice);
const cost = (tx) => tx.gasLimit * maxFee(tx) + tx.value;
const effectiveTip = (tx, baseFee) => {
  const headroom = maxFee(tx) - baseFee;
  const tip = maxTip(tx);
  return headroom < tip ? headroom : tip;
};

export class Mempool {
  /** @param {object} [o] @param {number} [o.maxPool] maximum number of transactions in the queue */
  constructor(chain, { maxPool = MAX_POOL } = {}) {
    this.chain = chain;
    this.maxPool = maxPool;
    this.byHash = new Map();
    this.bySender = new Map();
    this.bytes = 0;
    this.dirty = false;
    this.pruning = Promise.resolve();
    chain.on('head', (e) => { this.pruning = this.pruning.then(() => this._onHead(e)).catch(() => {}); });
  }

  get size() { return this.byHash.size; }
  has(hash) { return this.byHash.has(toHex(hash)); }
  get(hash) { return this.byHash.get(toHex(hash))?.tx ?? null; }
  all() { return [...this.byHash.values()].map((e) => e.tx); }

  /** What waits for a block with base fee baseFee, for fee recommendations. */
  competing(baseFee) {
    return this.all().filter((tx) => maxFee(tx) >= baseFee).map((tx) => ({ tip: effectiveTip(tx, baseFee), gas: tx.gasLimit }));
  }

  /**
   * Queue for the Explorer: a summary and one page of transactions. Each shows why it may not enter the next block:
   * an earlier nonce from the sender is missing, or the fee does not cover the network's base fee.
   */
  async view({ order = 'fee', limit = 25, offset = 0, sender = null } = {}) {
    const baseFee = nextBaseFee(this.chain.head);
    const entries = [...this.byHash.values()].filter((e) => !sender || e.sender === sender);
    const tip = new Map(entries.map((e) => [e, effectiveTip(e.tx, baseFee)]));
    const byFee = (a, b) => (tip.get(a) === tip.get(b) ? a.addedAt - b.addedAt : tip.get(a) < tip.get(b) ? 1 : -1);
    entries.sort(order === 'time' ? (a, b) => b.addedAt - a.addedAt : byFee);
    const tips = [...tip.values()].map((v) => (v > 0n ? v : 0n)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const state = await this.chain.stateAt(this.chain.head.stateRoot);
    const nonces = new Map();
    const items = [];
    for (const e of entries.slice(offset, offset + limit)) {
      if (!nonces.has(e.sender)) nonces.set(e.sender, (await state.stateManager.getAccount(e.tx.getSenderAddress()))?.nonce ?? 0n);
      const list = this.bySender.get(e.sender);
      let missing = null;
      for (let n = nonces.get(e.sender); n < e.tx.nonce; n += 1n) {
        if (!list?.has(n)) { missing = n; break; }
      }
      items.push({ tx: e.tx, addedAt: e.addedAt, tip: tip.get(e), missing, underpriced: maxFee(e.tx) < baseFee });
    }
    return {
      total: entries.length, size: this.byHash.size, max: this.maxPool, bytes: this.bytes, baseFee,
      tips: tips.length ? { min: tips[0], median: tips[tips.length >> 1], max: tips[tips.length - 1] } : null,
      oldest: entries.reduce((m, e) => (m === null || e.addedAt < m ? e.addedAt : m), null),
      items,
    };
  }

  /**
   * Adds a transaction. On error throws MempoolError with the reason.
   * @param {object} [o]
   * @param {boolean} [o.local] arrived through this node's RPC, so the node occasionally resends it to peers
   * @param {number} [o.addedAt] time added; when loading the queue after a restart, the original one
   */
  async add(tx, { local = false, addedAt = Date.now() } = {}) {
    const hash = toHex(tx.hash());
    if (this.byHash.has(hash)) throw new MempoolError('transaction is already in the queue');
    if (this.chain.store.txLocation(tx.hash())) throw new MempoolError('transaction is already confirmed');
    if (tx.type > 2) throw new MempoolError('unsupported transaction type');
    const size = tx.serialize().length;
    if (size > C.maxTxBytes) throw new MempoolError('transaction is too large');
    if (!tx.isSigned() || !tx.isValid()) throw new MempoolError(`invalid transaction: ${tx.getValidationErrors().join(', ')}`);
    if (tx.type === 0 && !tx.supports(Capability.EIP155ReplayProtection)) throw new MempoolError('missing chainId replay protection');

    const head = this.chain.head;
    if (tx.gasLimit > head.gasLimit || tx.gasLimit > MAX_TX_GAS) throw new MempoolError('gas exceeds the transaction limit');
    if (tx.gasLimit < tx.getIntrinsicGas()) throw new MempoolError('intrinsic gas too low');
    if (maxFee(tx) < C.minBaseFee) throw new MempoolError('fee is below the network minimum');

    let sender;
    try {
      sender = tx.getSenderAddress();
    } catch (e) {
      throw new MempoolError(`invalid signature: ${e.message}`);
    }

    const state = await this.chain.stateAt(head.stateRoot);
    const account = await state.stateManager.getAccount(sender);
    const stateNonce = account?.nonce ?? 0n;
    const balance = account?.balance ?? 0n;
    if (tx.nonce < stateNonce) throw new MempoolError('nonce too low');
    if (tx.nonce > stateNonce + MAX_NONCE_GAP) throw new MempoolError('nonce too high');

    const key = sender.toString();
    let list = this.bySender.get(key);

    // The sender must have funds for all of its pending transactions with a lower nonce combined.
    // Otherwise one small account could keep transactions in the queue for free that would never pay.
    let committed = cost(tx);
    for (const e of list?.values() ?? []) if (e.tx.nonce < tx.nonce) committed += cost(e.tx);
    if (balance < committed) throw new MempoolError('insufficient funds for gas * price + value');

    const existing = list?.get(tx.nonce);
    if (existing) {
      const needFee = (maxFee(existing.tx) * REPLACE_BUMP) / 100n;
      const needTip = (maxTip(existing.tx) * REPLACE_BUMP) / 100n;
      if (maxFee(tx) < needFee || maxTip(tx) < needTip) throw new MempoolError('replacement transaction underpriced: the fee must be at least 10% higher');
    } else if (list && list.size >= MAX_PER_SENDER) {
      throw new MempoolError('too many pending transactions from one sender');
    }

    // A full queue pushes out the cheapest. Whoever does not pay more than it stays out. The space of a transaction being replaced is
    // counted as free but removed only afterwards: if the replacement did not fit, the original transaction must stay in the queue.
    const freedCount = existing ? 1 : 0;
    const freedBytes = existing ? existing.size : 0;
    while (this.byHash.size - freedCount >= this.maxPool || this.bytes - freedBytes + size > MAX_POOL_BYTES) {
      const lowest = this._lowest(key);
      if (!lowest || maxFee(lowest.tx) >= maxFee(tx)) throw new MempoolError('the queue is full, raise the fee');
      this._remove(lowest.tx);
    }
    if (existing) {
      this._remove(existing.tx);
      this._journalReplaced(existing.tx);
    }
    list = this.bySender.get(key);

    if (!list) this.bySender.set(key, (list = new Map()));
    const entry = { tx, sender: key, size, addedAt, local };
    list.set(tx.nonce, entry);
    this.byHash.set(hash, entry);
    this.bytes += size;
    this.dirty = true;
    return tx;
  }

  /**
   * Candidate for eviction: the cheapest of the last transactions of individual senders. Transactions from the end of a sequence
   * creates no nonce gap for anyone, otherwise all later ones would hang behind the evicted one. Own earlier
   * a sender's transaction evicts nothing because of its next one; that would also create a gap.
   */
  _lowest(except) {
    let low = null;
    for (const [sender, list] of this.bySender) {
      if (sender === except) continue;
      let tail = null;
      for (const e of list.values()) if (!tail || e.tx.nonce > tail.tx.nonce) tail = e;
      if (tail && (!low || maxFee(tail.tx) < maxFee(low.tx))) low = tail;
    }
    return low;
  }

  _remove(tx) {
    const hash = toHex(tx.hash());
    const e = this.byHash.get(hash);
    if (!e) return;
    this.byHash.delete(hash);
    this.bytes -= e.size;
    const list = this.bySender.get(e.sender);
    list?.delete(tx.nonce);
    if (list?.size === 0) this.bySender.delete(e.sender);
    this.dirty = true;
  }

  /**
   * Transactions from this node's RPC that have waited longer than minAgeMs, sorted by nonce. The node sends them to peers
   * again: the first broadcast may have been lost, for example when a peer did not have the latest block yet and rejected the transaction.
   */
  local(minAgeMs, limit = 64) {
    const before = Date.now() - minAgeMs;
    return [...this.byHash.values()].filter((e) => e.local && e.addedAt <= before)
      .sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : a.tx.nonce > b.tx.nonce ? 1 : a.addedAt - b.addedAt))
      .slice(0, limit).map((e) => e.tx);
  }

  /** How many transactions entered the queue recently and are still waiting. */
  countSince(ms) {
    const from = Date.now() - ms;
    let n = 0;
    for (const e of this.byHash.values()) if (e.addedAt >= from) n += 1;
    return n;
  }

  /** All pending transactions sorted by nonce so the receiver takes them in the right order. */
  ordered() {
    return [...this.byHash.values()].sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : a.tx.nonce > b.tx.nonce ? 1 : 0)).map((e) => e.tx);
  }

  /**
   * Saves the queue to disk only when it changed since last time. Written through a temporary file, so after a crash
   * either the old or the new whole queue. A full disk does not stop the node; the queue is just not saved.
   */
  save(path) {
    if (!this.dirty) return true;
    const parts = [JOURNAL_MAGIC];
    for (const e of this.byHash.values()) {
      const raw = e.tx.serialize();
      const meta = Buffer.alloc(14);
      meta.writeUInt8(TX_RECORD, 0);
      meta.writeBigUInt64BE(BigInt(e.addedAt), 1);
      meta.writeUInt8(e.local ? LOCAL : 0, 9);
      meta.writeUInt32BE(raw.length, 10);
      parts.push(meta, raw);
    }
    try {
      writeFileSync(`${path}.tmp`, Buffer.concat(parts), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads the queue saved before a restart. Each transaction goes through the same check as a new one, so whatever in the meantime
   * is no longer valid or is already in a block, it does not enter the queue. Older than 6 hours are dropped as during operation.
   * @returns {Promise<number>} number of transactions loaded
   */
  async restore(path) {
    this.journal = path;
    let data;
    try { data = readFileSync(path); } catch { return 0; }
    if (data.length < 4 || !data.subarray(0, 4).equals(JOURNAL_MAGIC)) return 0;
    const saved = [];
    const replaced = new Set();
    const common = this.chain.commonAt(this.chain.head.number + 1n);
    for (let at = 4; at < data.length;) {
      const kind = data.readUInt8(at);
      if (kind === REPLACED_RECORD) {
        if (at + 33 > data.length) break;
        replaced.add(toHex(data.subarray(at + 1, at + 33)));
        at += 33;
        continue;
      }
      if (kind !== TX_RECORD || at + 14 > data.length) break;
      const addedAt = Number(data.readBigUInt64BE(at + 1));
      const local = (data.readUInt8(at + 9) & LOCAL) !== 0;
      const length = data.readUInt32BE(at + 10);
      at += 14;
      if (at + length > data.length) break;
      try { saved.push({ tx: decodeTx(data.subarray(at, at + length), common), addedAt, local }); } catch { /* corrupted entry */ }
      at += length;
    }
    const oldest = Date.now() - MAX_AGE_MS;
    saved.sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : a.tx.nonce > b.tx.nonce ? 1 : 0));
    let restored = 0;
    for (const { tx, addedAt, local } of saved) {
      // A replaced transaction does not come back: a cancellation or speed-up holds even if the node crashed before saving the whole queue.
      if (addedAt < oldest || replaced.has(toHex(tx.hash()))) continue;
      try {
        await this.add(tx, { local, addedAt });
        restored += 1;
      } catch { /* mined in the meantime or no longer valid */ }
    }
    this.dirty = restored !== saved.length || replaced.size > 0;
    return restored;
  }

  /**
   * A replacement is appended to the file immediately, not with the next queue save. Otherwise after a node crash an older save would bring back
   * the original transaction, and for example a cancelled payment would go through. One short record at the end of the file costs nothing.
   */
  _journalReplaced(tx) {
    if (!this.journal) return;
    try {
      if (!existsSync(this.journal)) writeFileSync(this.journal, JOURNAL_MAGIC, { mode: 0o600 });
      appendFileSync(this.journal, Buffer.concat([Buffer.from([REPLACED_RECORD]), Buffer.from(tx.hash())]));
    } catch { /* full disk: the regular save remains */ }
  }

  /** Removes everything the new tip invalidated and returns transactions from the abandoned branch to the queue. */
  async _onHead({ removed, added }) {
    for (const b of added) for (const tx of b.txs) this._remove(tx);
    for (const b of removed) {
      for (const tx of b.txs) await this.add(tx).catch(() => {});
    }
    const state = await this.chain.stateAt(this.chain.head.stateRoot);
    const oldest = Date.now() - MAX_AGE_MS;
    for (const list of [...this.bySender.values()]) {
      const entries = [...list.values()].sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : 1));
      const account = await state.stateManager.getAccount(entries[0].tx.getSenderAddress());
      const nonce = account?.nonce ?? 0n;
      const balance = account?.balance ?? 0n;
      let committed = 0n;
      for (const e of entries) {
        committed += cost(e.tx);
        if (e.tx.nonce < nonce || balance < committed || e.addedAt < oldest) this._remove(e.tx);
      }
    }
  }

  /** Waits for the cleanup after the last block to finish. */
  settled() { return this.pruning; }

  /**
   * Transactions for the next block: for each sender only a contiguous run of nonces,
   * across senders by the highest tip.
   */
  async *pending(limit = 2000) {
    const baseFee = nextBaseFee(this.chain.head);
    const state = await this.chain.stateAt(this.chain.head.stateRoot);
    const queues = [];
    for (const list of this.bySender.values()) {
      const entries = [...list.values()].sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : 1));
      const address = new Address(entries[0].tx.getSenderAddress().bytes);
      let nonce = (await state.stateManager.getAccount(address))?.nonce ?? 0n;
      const run = [];
      for (const e of entries) {
        if (e.tx.nonce !== nonce) break;
        run.push(e.tx);
        nonce += 1n;
      }
      if (run.length) queues.push(run);
    }
    let emitted = 0;
    while (emitted < limit) {
      let best = -1;
      let bestTip = -1n;
      for (let i = 0; i < queues.length; i++) {
        const tx = queues[i][0];
        if (!tx || maxFee(tx) < baseFee) continue;
        const tip = effectiveTip(tx, baseFee);
        if (tip > bestTip) { best = i; bestTip = tip; }
      }
      if (best < 0) return;
      yield queues[best].shift();
      emitted += 1;
    }
  }
}
