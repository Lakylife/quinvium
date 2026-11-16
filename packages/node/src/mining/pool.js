// Pool server: hands out work to miners and submits shares to the AetherPool contract. Only the contract distributes coins,
// the server can do no more than deliver a share and trigger a payout. Each miner hashes its own header with its address in extraData,
// so a share cannot be redirected to someone else. When the server disappears, anyone else can submit shares and the payout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import { Address, privateToAddress } from '@ethereumjs/util';
import { nextBaseFee } from '../core/economics.js';
import { Block, Header } from '../core/types.js';
import { bytesToBigInt, quickResult, targetForDifficulty } from '../crypto/ethash.js';
import { GWEI } from '../params.js';
import { equal, fromHex, keccak, toHex } from '../util/bytes.js';
import { L } from '../lang.js';

const SHARE_SECONDS = 20;            // how often one device should send a share
const SHARES_PER_BLOCK = 24;         // no more fits into the chain cheaply; for a large pool shares get more expensive
const MIN_SHARES_PER_BLOCK = 6;      // with full blocks: shares give way to payments, but payout variance stays bearable
const BUSY_FULLNESS = 0.5;           // above half a block the base fee rises; the network is busy
const FULLNESS_BLOCKS = 5;
const BLOCK_SECONDS = 15;
const RETARGET_SHARES = 6;           // after how many shares difficulty is recomputed
const MIN_SHARE_DIFFICULTY = 1n << 16n;
const SHARES_PER_NETWORK_WORK = 4096n; // a share must earn more than its gas costs: 4 coins / 4096 is more than 150,000 gas
const CREDIT_BYTES = 12;
const MAX_CREDIT = (1n << 96n) - 1n;
const MAX_JOBS = 16_384;
const MAX_SESSIONS = 16_384;
// Devices that have not delivered a single share yet. Asking for work is free, so anyone can create them in bulk; they are
// evicted among themselves and never push out the work of a device that is really mining.
const MAX_FRESH_SESSIONS = 4096;
const MAX_FRESH_JOBS = 4096;
const DEVICE_PAGE = 200;             // connected devices per page
const MAX_DEVICE_PAGE = 500;
const MAX_QUEUE = 4096;
const FLUSH_MS = 10_000;
const PAYOUT_MS = 5 * 60_000;
const MAX_BATCH = 32;
const MAX_PAYOUT = 24;
const MAX_SHARE_AGE = 32n;           // the same limit as in the contract
const AGE_MARGIN = 4n;               // the share must make it before the block, otherwise it is not sent
const BASE_GAS = 400_000n;           // closing several rounds and the first share in a new round
const GAS_PER_SHARE = 220_000n;
const GAS_PER_SETTLE = 90_000n;
const SETTLE_STEPS = 8n;
const MAX_TX_GAS = 7_000_000n;       // the node accepts at most 8 million
const TIP = 2n * GWEI;
const MIN_PAYOUT = 10n ** 17n;       // 0.1 coin: the miner withdraws smaller amounts themselves, or they wait
const RATE_WINDOW_MS = 10 * 60_000;

const utf8 = new TextEncoder();
const selector = (signature) => keccak(utf8.encode(signature)).subarray(0, 4);
const SUBMIT = selector('submitShares(bytes[])');
const PAYOUT = selector('payout(address[])');
const PENDING = selector('pendingOf(address)');
const READY = selector('readyToSettle()');
const SETTLE = selector('settle(uint256)');
const FACTORY = fromHex('0xae0000000000000000000000000000000000000c');

function word(value) {
  const out = new Uint8Array(32);
  const hex = BigInt(value).toString(16).padStart(64, '0');
  out.set(Buffer.from(hex, 'hex'));
  return out;
}

const addressWord = (bytes) => {
  const out = new Uint8Array(32);
  out.set(bytes, 12);
  return out;
};

/** ABI: funkce(bytes[]) */
export function encodeBytesArray(prefix, items) {
  const offsets = [];
  const tails = [];
  let offset = BigInt(items.length) * 32n;
  for (const item of items) {
    offsets.push(word(offset));
    const padded = new Uint8Array(Math.ceil(item.length / 32) * 32);
    padded.set(item);
    tails.push(word(item.length), padded);
    offset += 32n + BigInt(padded.length);
  }
  return Buffer.concat([prefix, word(32), word(items.length), ...offsets, ...tails]);
}

/** ABI: funkce(address[]) */
export const encodeAddressArray = (prefix, items) => Buffer.concat([prefix, word(32), word(items.length), ...items.map(addressWord)]);

/** A share carries the miner's address and its difficulty, both covered by work. */
export function shareExtra(miner, difficulty) {
  const out = new Uint8Array(32);
  out.set(miner);
  out.set(word(difficulty).subarray(32 - CREDIT_BYTES), 32 - CREDIT_BYTES);
  return out;
}

const copy = (header) => Object.fromEntries(Object.entries(header).filter(([k]) => !k.startsWith('_')));

export class PoolError extends Error {}

export class PoolServer {
  /**
   * @param {object} o
   * @param {object} o.chain
   * @param {object} o.work
   * @param {object} o.mempool
   * @param {Uint8Array} o.address adresa kontraktu poolu
   * @param {Uint8Array} o.key key of the account that pays gas for shares and payouts
   * @param {(tx: object) => Promise<object>} o.send send a transaction to the network
   * @param {(params: object) => Promise<string>} o.call read from a contract
   * @param {(params: object) => Promise<string>} o.estimate odhad gasu
   * @param {bigint} [o.minShareDifficulty] lowest share difficulty
   * @param {string} [o.stateFile] list of miners for payouts after a restart
   */
  constructor({ chain, work, mempool, address, key, send, call, estimate, minShareDifficulty = MIN_SHARE_DIFFICULTY, stateFile, log = () => {} }) {
    Object.assign(this, { chain, work, mempool, address, key, send, call, estimate, minShareDifficulty, stateFile, log });
    this.sender = privateToAddress(key);
    this.sessions = new Map();   // address.device -> state
    this.fresh = new Set();      // ids of sessions without an accepted share, oldest first
    this.jobs = new Map();       // sealHash -> { block, session, target }
    this.freshJobs = new Set();  // sealHashes of jobs of fresh sessions, oldest first
    this.provenJobs = new Set(); // sealHashes of jobs of sessions that delivered a share, oldest first
    this.queue = [];             // { header, number, parent }
    this.seen = new Set();
    this.miners = new Set();
    this.stats = { shares: 0, rejected: 0, stale: 0, blocks: 0, sent: 0, paid: 0, failed: 0 };
    this.lastError = null;
    this.timers = [];
    this.flushing = false;
    this.sending = Promise.resolve();
  }

  /** Verifies that the contract comes from the factory; otherwise miners' coins would go to unknown code. */
  async start() {
    const data = Buffer.concat([selector('isPool(address)'), addressWord(this.address)]);
    const result = await this.call({ to: toHex(FACTORY), data: toHex(data) });
    if (BigInt(result === '0x' ? 0 : result) !== 1n) throw new PoolError(`${toHex(this.address)} is not a pool from the factory, mining into it will not start`);
    this._loadMiners();
    this.timers = [
      setInterval(() => this.flush().catch((e) => this._fail(e)), FLUSH_MS),
      setInterval(() => this.payout().catch((e) => this._fail(e)), PAYOUT_MS),
    ];
    for (const t of this.timers) t.unref();
    this.log(L(`Pool ${toHex(this.address)}, poplatky za podíly platí ${toHex(this.sender)}`, `Pool ${toHex(this.address)}, share fees are paid by ${toHex(this.sender)}`));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this._saveMiners();
  }

  /** A miner who left must get paid even after the server restarts. */
  _loadMiners() {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      for (const a of JSON.parse(readFileSync(this.stateFile, 'utf8'))) if (/^0x[0-9a-f]{40}$/.test(a)) this.miners.add(a);
    } catch { /* a corrupted list does not matter; miners can choose themselves */ }
  }

  _saveMiners() {
    if (!this.stateFile) return;
    try {
      writeFileSync(this.stateFile, JSON.stringify([...this.miners]));
    } catch (e) {
      this.log(`${L('Pool: seznam těžařů nejde uložit', 'Pool: the miner list cannot be saved')}: ${e.message}`);
    }
  }

  _fail(e) {
    this.lastError = e.message;
    this.stats.failed += 1;
    this.log(`Pool: ${e.message}`);
  }

  _session(miner, worker) {
    const id = `${toHex(miner)}.${worker}`;
    let s = this.sessions.get(id);
    if (!s) {
      if (this.fresh.size >= MAX_FRESH_SESSIONS) this._dropSession(this.fresh.values().next().value);
      if (this.sessions.size >= MAX_SESSIONS) this._dropSession(this.fresh.size ? this.fresh.values().next().value : this.sessions.keys().next().value);
      s = { id, miner, difficulty: null, shares: 0, since: Date.now(), done: 0n, windowStart: Date.now(), previous: 0n, seen: Date.now(), proven: false };
      this.sessions.set(id, s);
      this.fresh.add(id);
    }
    s.seen = Date.now();
    return s;
  }

  _dropSession(id) {
    this.sessions.delete(id);
    this.fresh.delete(id);
  }

  /** Jobs of devices that already mined something and of new devices are evicted separately. */
  _addJob(key, job) {
    this.jobs.set(key, job);
    const list = job.session.proven ? this.provenJobs : this.freshJobs;
    const limit = job.session.proven ? MAX_JOBS : MAX_FRESH_JOBS;
    list.add(key);
    while (list.size > limit) {
      const old = list.values().next().value;
      list.delete(old);
      this.jobs.delete(old);
    }
  }

  /**
   * The more devices, the rarer the shares: the chain fits only a limited number into a block.
   * Only devices that mined something are counted. Asking for work costs nothing, otherwise shares could be made more expensive for everyone else.
   */
  _interval() {
    const now = Date.now();
    const active = [...this.sessions.values()].filter((s) => s.done + s.previous > 0n && now - s.seen < RATE_WINDOW_MS).length;
    const limit = (active * BLOCK_SECONDS) / this.sharesPerBlock();
    return limit > SHARE_SECONDS ? limit : SHARE_SECONDS;
  }

  /**
   * How many shares per block the pool submits. One share costs about 220,000 gas, so 24 shares are over half a block.
   * As long as blocks are not full, nobody is missing space. As they fill, shares give way down to a quarter so that pools
   * did not crowd out payments or raise fees for others. Fewer shares only mean a slightly larger payout variance.
   */
  sharesPerBlock() {
    const head = this.chain.head;
    const key = Buffer.from(head.hash()).toString('hex');
    if (this._fullness?.key !== key) {
      let used = 0;
      let n = 0;
      for (let h = head; h && n < FULLNESS_BLOCKS && h.number > 0n; n += 1) {
        used += Number(h.gasUsed) / Number(h.gasLimit);
        h = this.chain.getHeader(h.parentHash);
      }
      this._fullness = { key, value: n ? used / n : 0 };
    }
    const fullness = this._fullness.value;
    if (fullness <= BUSY_FULLNESS) return SHARES_PER_BLOCK;
    const share = Math.min(1, (fullness - BUSY_FULLNESS) / (1 - BUSY_FULLNESS));
    return Math.round(SHARES_PER_BLOCK - share * (SHARES_PER_BLOCK - MIN_SHARES_PER_BLOCK));
  }

  _retarget(s, network) {
    const top = network < MAX_CREDIT ? network : MAX_CREDIT;
    const floor = this.minShareDifficulty > network / SHARES_PER_NETWORK_WORK ? this.minShareDifficulty : network / SHARES_PER_NETWORK_WORK;
    const bottom = floor < top ? floor : top;
    const clamp = (d) => (d > top ? top : d < bottom ? bottom : d);
    const now = Date.now();
    if (s.difficulty === null) {
      s.difficulty = clamp(network / 64n);
      s.since = now;
      return;
    }
    const seconds = (now - s.since) / 1000;
    const interval = this._interval();
    if (s.shares >= RETARGET_SHARES) {
      const hashes = BigInt(s.shares) * s.difficulty;
      const next = (hashes * BigInt(Math.round(interval))) / BigInt(Math.max(1, Math.round(seconds)));
      // A big jump could cut off a weak device by chance, hence at most four times.
      s.difficulty = clamp(next > s.difficulty * 4n ? s.difficulty * 4n : next < s.difficulty / 4n ? s.difficulty / 4n : next);
    } else if (seconds >= interval * 4) {
      s.difficulty = clamp(s.shares === 0 ? s.difficulty / 2n : (BigInt(s.shares) * s.difficulty * BigInt(Math.round(interval))) / BigInt(Math.round(seconds)));
    } else {
      return;
    }
    s.shares = 0;
    s.since = now;
  }

  /**
   * Work for one device. The header is only its own, thanks to the address in extraData.
   * @param {Uint8Array} miner payout address
   * @param {string} [worker] device name
   */
  async workFor(miner, worker = 'rig') {
    const base = await this.work.getWork(this.address);
    const template = this.work.templates.get(toHex(base.sealHash));
    const s = this._session(miner, worker);
    this._retarget(s, base.difficulty);
    if (s.job?.base !== template || s.job?.difficulty !== s.difficulty) {
      const header = new Header({ ...copy(template.header), extraData: shareExtra(miner, s.difficulty) });
      const job = { base: template, block: new Block(header, template.txs), session: s, difficulty: s.difficulty, target: targetForDifficulty(s.difficulty) };
      s.job = job;
      this._addJob(toHex(header.sealHash()), job);
    }
    const { header } = s.job.block;
    return {
      sealHash: header.sealHash(), seedHash: base.seedHash, number: base.number, difficulty: s.difficulty, target: s.job.target,
      networkDifficulty: base.difficulty, sealFields: header,
    };
  }

  /**
   * Accepts a share.
   * @returns {Promise<{accepted: boolean, reason?: string, stale?: boolean, block?: object}>}
   */
  async submit(nonce, sealHash, mixDigest) {
    const key = toHex(sealHash);
    const job = this.jobs.get(key);
    if (!job) {
      this.stats.stale += 1;
      return { accepted: false, stale: true, reason: 'unknown or stale work' };
    }
    const reject = (reason) => {
      this.stats.rejected += 1;
      return { accepted: false, reason };
    };
    const id = key + toHex(nonce);
    if (this.seen.has(id)) return reject('share already submitted');
    if (nonce.length !== 8 || mixDigest.length !== 32) return reject('invalid format');
    if (bytesToBigInt(quickResult(sealHash, nonce, mixDigest)) > job.target) return reject('share does not meet the difficulty');
    const { header: h, txs } = job.block;
    const { mixDigest: mix, result } = await this.chain.pow.compute(sealHash, nonce, h.number);
    if (!equal(mix, mixDigest)) return reject('invalid work');
    const value = bytesToBigInt(result);
    if (value > job.target) return reject('share does not meet the difficulty');
    this.seen.add(id);
    if (this.seen.size > MAX_JOBS) this.seen.delete(this.seen.values().next().value);

    const s = job.session;
    const now = Date.now();
    if (now - s.windowStart >= RATE_WINDOW_MS) {
      s.previous = s.done;
      s.done = 0n;
      s.windowStart = now;
    }
    s.shares += 1;
    s.done += job.difficulty;
    if (!s.proven) {
      s.proven = true;
      this.fresh.delete(s.id);
      // Its current job moves among the protected ones; the next jobs are created there.
      if (this.freshJobs.delete(key)) this._addJob(key, job);
    }
    this.stats.shares += 1;
    this.miners.add(toHex(s.miner));

    const header = new Header({ ...copy(h), nonce, mixHash: mixDigest });
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(header);

    if (value > targetForDifficulty(h.difficulty)) return { accepted: true };
    // The share is also a block: it goes to the network immediately and the contract receives it like any other share.
    this.work.templates.set(key, new Block(new Header(copy(h)), txs));
    const block = await this.work.submit(nonce, sealHash, mixDigest);
    if (block.accepted && !block.stale) {
      this.stats.blocks += 1;
      this.log(L(`Pool vytěžil blok #${h.number}`, `The pool mined block #${h.number}`));
    }
    await this.flush().catch((e) => this._fail(e));
    return { accepted: true, block };
  }

  _fresh(header) {
    const head = this.chain.head.number;
    if (header.number + MAX_SHARE_AGE <= head + AGE_MARGIN) return false;
    const parent = this.chain.store.canonicalHash(header.number - 1n);
    return !!parent && equal(parent, header.parentHash);
  }

  /** Transactions go one at a time: concurrent ones would get the same nonce. */
  _send(data, gasLimit) {
    const run = this.sending.then(() => this._sendNow(data, gasLimit));
    this.sending = run.catch(() => {});
    return run;
  }

  async _sendNow(data, gasLimit) {
    const head = this.chain.head;
    const baseFee = nextBaseFee(head);
    const state = await this.chain.stateAt(head.stateRoot);
    const senderAddress = new Address(this.sender);
    let nonce = (await state.stateManager.getAccount(senderAddress))?.nonce ?? 0n;
    const waiting = this.mempool.bySender.get(senderAddress.toString());
    while (waiting?.has(nonce)) nonce += 1n;
    const common = this.chain.commonAt(head.number + 1n);
    const tx = createFeeMarket1559Tx({
      chainId: this.chain.network.chainId, nonce, to: this.address, value: 0n, gasLimit, data,
      maxFeePerGas: baseFee * 2n + TIP, maxPriorityFeePerGas: TIP,
    }, { common }).sign(this.key);
    await this.send(tx);
    return tx;
  }

  /** Sends a batch of shares to the contract. A share off the chain or too old would only cost gas. */
  async flush() {
    if (this.flushing || !this.queue.length) return null;
    this.flushing = true;
    try {
      const before = this.queue.length;
      this.queue = this.queue.filter((h) => this._fresh(h));
      this.stats.stale += before - this.queue.length;
      if (!this.queue.length) return null;
      const batch = this.queue.slice(0, MAX_BATCH);
      const tx = await this._send(encodeBytesArray(SUBMIT, batch.map((h) => h.encode())), BASE_GAS + GAS_PER_SHARE * BigInt(batch.length));
      this.queue = this.queue.slice(batch.length);
      this.stats.sent += batch.length;
      this.lastError = null;
      return tx;
    } finally {
      this.flushing = false;
    }
  }

  /** Triggers payouts to miners who have something to be paid. Coins always go directly to them. */
  async payout() {
    this._saveMiners();
    const due = [];
    for (const miner of this.miners) {
      const bytes = fromHex(miner);
      const result = await this.call({ to: toHex(this.address), data: toHex(Buffer.concat([PENDING, addressWord(bytes)])) });
      if (BigInt(result === '0x' ? 0 : result) >= MIN_PAYOUT) due.push(bytes);
      if (due.length >= MAX_PAYOUT) break;
    }
    if (!due.length) {
      // In a quiet pool nobody closes rounds; the payout would otherwise not come.
      const ready = await this.call({ to: toHex(this.address), data: toHex(READY) });
      if (BigInt(ready === '0x' ? 0 : ready) !== 1n) return null;
      return this._send(Buffer.concat([SETTLE, word(SETTLE_STEPS)]), BASE_GAS + GAS_PER_SETTLE * SETTLE_STEPS);
    }
    // The payout cost depends on how many rounds the miner worked in. If not everyone fits, the rest waits for the next payout round.
    for (let list = due; list.length; list = list.slice(0, list.length >> 1)) {
      const data = encodeAddressArray(PAYOUT, list);
      const gas = await this.estimate({ from: toHex(this.sender), to: toHex(this.address), data: toHex(data) }).catch(() => null);
      if (gas !== null && BigInt(gas) < MAX_TX_GAS) {
        const tx = await this._send(data, (BigInt(gas) * 12n) / 10n);
        this.stats.paid += list.length;
        return tx;
      }
    }
    throw new PoolError('the payout does not fit into the transaction limit');
  }

  /** Hashrate of one device from accepted shares, zero for a device that has not reported for a long time. */
  _rate(s, now) {
    const seconds = (now - s.windowStart) / 1000;
    if (seconds <= 0 || now - s.seen > RATE_WINDOW_MS) return 0;
    const span = seconds + (s.previous > 0n ? RATE_WINDOW_MS / 1000 : 0);
    return Number(s.done + s.previous) / span;
  }

  /** Hashrate estimate from accepted shares. */
  hashrate() {
    const now = Date.now();
    let total = 0;
    for (const s of this.sessions.values()) total += this._rate(s, now);
    return Math.round(total);
  }

  /**
   * Pool server status. Connected devices come by page and can be narrowed to one miner,
   * because a large pool has thousands of them. The miner's address is public in its shares; IP addresses are not shown.
   */
  async info({ miner = null, limit = DEVICE_PAGE, offset = 0 } = {}) {
    const account = await (await this.chain.stateAt(this.chain.head.stateRoot)).stateManager.getAccount(new Address(this.sender));
    const now = Date.now();
    const active = [...this.sessions.values()].filter((s) => now - s.seen < RATE_WINDOW_MS);
    const shown = active.filter((s) => !miner || toHex(s.miner).toLowerCase() === miner.toLowerCase())
      .map((s) => ({ miner: toHex(s.miner), worker: s.id.slice(s.id.indexOf('.') + 1), hashrate: Math.round(this._rate(s, now)), seen: Math.floor(s.seen / 1000) }))
      .sort((a, b) => b.hashrate - a.hashrate);
    const size = Math.min(MAX_DEVICE_PAGE, limit ?? DEVICE_PAGE) || DEVICE_PAGE;
    return {
      address: toHex(this.address), payer: toHex(this.sender), payerBalance: (account?.balance ?? 0n).toString(),
      workers: active.length, minersOnline: new Set(active.map((s) => toHex(s.miner))).size,
      miners: this.miners.size, hashrate: this.hashrate(), queue: this.queue.length, lastError: this.lastError, ...this.stats,
      deviceCount: shown.length, devices: shown.slice(offset ?? 0, (offset ?? 0) + size),
    };
  }
}
