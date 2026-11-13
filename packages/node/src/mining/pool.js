// Server poolu: rozdává těžařům práci a podíly posílá do kontraktu AetherPool. Rozdělení mincí dělá jen kontrakt,
// server neumí víc než doručit podíl a spustit výplatu. Každý těžař hashuje vlastní hlavičku se svou adresou v extraData,
// takže podíl nejde přepsat na někoho jiného. Když server zmizí, podíly i výplatu může odeslat kdokoli jiný.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import { Address, privateToAddress } from '@ethereumjs/util';
import { nextBaseFee } from '../core/economics.js';
import { Block, Header } from '../core/types.js';
import { bytesToBigInt, quickResult, targetForDifficulty } from '../crypto/ethash.js';
import { GWEI } from '../params.js';
import { equal, fromHex, keccak, toHex } from '../util/bytes.js';
import { L } from '../lang.js';

const SHARE_SECONDS = 20;            // jak často má jedno zařízení posílat podíl
const SHARES_PER_BLOCK = 24;         // víc se do řetězce levně nevejde, u velkého poolu se podíly zdraží
const MIN_SHARES_PER_BLOCK = 6;      // při plných blocích: podíly ustoupí platbám, ale rozptyl výplat zůstane snesitelný
const BUSY_FULLNESS = 0.5;           // od poloviny bloku roste základní poplatek, síť je vytížená
const FULLNESS_BLOCKS = 5;
const BLOCK_SECONDS = 15;
const RETARGET_SHARES = 6;           // po kolika podílech se přepočítá obtížnost
const MIN_SHARE_DIFFICULTY = 1n << 16n;
const SHARES_PER_NETWORK_WORK = 4096n; // podíl musí vydělat víc, než stojí jeho gas: 4 mince / 4096 je víc než 150 000 gasu
const CREDIT_BYTES = 12;
const MAX_CREDIT = (1n << 96n) - 1n;
const MAX_JOBS = 16_384;
const MAX_SESSIONS = 16_384;
const DEVICE_PAGE = 200;             // připojená zařízení na jednu stránku
const MAX_DEVICE_PAGE = 500;
const MAX_QUEUE = 4096;
const FLUSH_MS = 10_000;
const PAYOUT_MS = 5 * 60_000;
const MAX_BATCH = 32;
const MAX_PAYOUT = 24;
const MAX_SHARE_AGE = 32n;           // stejná mez jako v kontraktu
const AGE_MARGIN = 4n;               // podíl musí stihnout blok, jinak se neposílá
const BASE_GAS = 400_000n;           // uzavření několika kol a první podíl v novém kole
const GAS_PER_SHARE = 220_000n;
const GAS_PER_SETTLE = 90_000n;
const SETTLE_STEPS = 8n;
const MAX_TX_GAS = 7_000_000n;       // uzel přijme nejvýše 8 milionů
const TIP = 2n * GWEI;
const MIN_PAYOUT = 10n ** 17n;       // 0,1 mince: menší částky si těžař vybere sám, nebo počkají
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

/** Podíl nese adresu těžaře a svou obtížnost, obojí je kryté prací. */
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
   * @param {Uint8Array} o.key klíč účtu, který platí gas za podíly a výplaty
   * @param {(tx: object) => Promise<object>} o.send odeslání transakce do sítě
   * @param {(params: object) => Promise<string>} o.call čtení z kontraktu
   * @param {(params: object) => Promise<string>} o.estimate odhad gasu
   * @param {bigint} [o.minShareDifficulty] nejnižší obtížnost podílu
   * @param {string} [o.stateFile] seznam těžařů pro výplaty po restartu
   */
  constructor({ chain, work, mempool, address, key, send, call, estimate, minShareDifficulty = MIN_SHARE_DIFFICULTY, stateFile, log = () => {} }) {
    Object.assign(this, { chain, work, mempool, address, key, send, call, estimate, minShareDifficulty, stateFile, log });
    this.sender = privateToAddress(key);
    this.sessions = new Map();   // adresa.zařízení -> stav
    this.jobs = new Map();       // sealHash -> { block, session, target }
    this.queue = [];             // { header, number, parent }
    this.seen = new Set();
    this.miners = new Set();
    this.stats = { shares: 0, rejected: 0, stale: 0, blocks: 0, sent: 0, paid: 0, failed: 0 };
    this.lastError = null;
    this.timers = [];
    this.flushing = false;
    this.sending = Promise.resolve();
  }

  /** Ověří, že kontrakt pochází z továrny, jinak by mince těžařů šly do neznámého kódu. */
  async start() {
    const data = Buffer.concat([selector('isPool(address)'), addressWord(this.address)]);
    const result = await this.call({ to: toHex(FACTORY), data: toHex(data) });
    if (BigInt(result === '0x' ? 0 : result) !== 1n) throw new PoolError(`${toHex(this.address)} není pool z továrny, těžba do něj se nespustí`);
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

  /** Těžař, který odešel, má dostat výplatu i po restartu serveru. */
  _loadMiners() {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      for (const a of JSON.parse(readFileSync(this.stateFile, 'utf8'))) if (/^0x[0-9a-f]{40}$/.test(a)) this.miners.add(a);
    } catch { /* poškozený seznam nevadí, těžaři si mohou vybrat sami */ }
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
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
      s = { id, miner, difficulty: null, shares: 0, since: Date.now(), done: 0n, windowStart: Date.now(), previous: 0n, seen: Date.now() };
      this.sessions.set(id, s);
    }
    s.seen = Date.now();
    return s;
  }

  /**
   * Čím víc zařízení, tím vzácnější podíly: řetězec jich do bloku pojme jen omezeně.
   * Počítají se jen zařízení, která něco vytěžila. Žádost o práci nic nestojí, jinak by šlo podíly zdražit všem ostatním.
   */
  _interval() {
    const now = Date.now();
    const active = [...this.sessions.values()].filter((s) => s.done + s.previous > 0n && now - s.seen < RATE_WINDOW_MS).length;
    const limit = (active * BLOCK_SECONDS) / this.sharesPerBlock();
    return limit > SHARE_SECONDS ? limit : SHARE_SECONDS;
  }

  /**
   * Kolik podílů za blok pool posílá. Jeden podíl stojí asi 220 000 gasu, 24 podílů tedy přes polovinu bloku.
   * Dokud bloky nejsou plné, místo nikomu nechybí. Když se plní, podíly ustupují až na čtvrtinu, aby pooly
   * nevytlačily platby a nezvedaly poplatky ostatním. Méně podílů znamená jen o něco větší rozptyl výplat.
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
      // Velký skok by při náhodě odstřihl slabé zařízení, proto nejvýše čtyřnásobek.
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
   * Práce pro jedno zařízení. Hlavička je jen jeho, díky adrese v extraData.
   * @param {Uint8Array} miner adresa výplaty
   * @param {string} [worker] název zařízení
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
      this.jobs.set(toHex(header.sealHash()), job);
      if (this.jobs.size > MAX_JOBS) this.jobs.delete(this.jobs.keys().next().value);
    }
    const { header } = s.job.block;
    return {
      sealHash: header.sealHash(), seedHash: base.seedHash, number: base.number, difficulty: s.difficulty, target: s.job.target,
      networkDifficulty: base.difficulty, sealFields: header,
    };
  }

  /**
   * Přijme podíl.
   * @returns {Promise<{accepted: boolean, reason?: string, stale?: boolean, block?: object}>}
   */
  async submit(nonce, sealHash, mixDigest) {
    const key = toHex(sealHash);
    const job = this.jobs.get(key);
    if (!job) {
      this.stats.stale += 1;
      return { accepted: false, stale: true, reason: 'neznámá nebo stará práce' };
    }
    const reject = (reason) => {
      this.stats.rejected += 1;
      return { accepted: false, reason };
    };
    const id = key + toHex(nonce);
    if (this.seen.has(id)) return reject('podíl už byl odeslán');
    if (nonce.length !== 8 || mixDigest.length !== 32) return reject('neplatný formát');
    if (bytesToBigInt(quickResult(sealHash, nonce, mixDigest)) > job.target) return reject('podíl nesplňuje obtížnost');
    const { header: h, txs } = job.block;
    const { mixDigest: mix, result } = await this.chain.pow.compute(sealHash, nonce, h.number);
    if (!equal(mix, mixDigest)) return reject('neplatná práce');
    const value = bytesToBigInt(result);
    if (value > job.target) return reject('podíl nesplňuje obtížnost');
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
    this.stats.shares += 1;
    this.miners.add(toHex(s.miner));

    const header = new Header({ ...copy(h), nonce, mixHash: mixDigest });
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(header);

    if (value > targetForDifficulty(h.difficulty)) return { accepted: true };
    // Podíl je zároveň blok: jde do sítě hned a kontrakt ho dostane jako každý jiný podíl.
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

  /** Transakce jdou po jedné: souběžné by dostaly stejné nonce. */
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

  /** Pošle dávku podílů do kontraktu. Podíl mimo řetězec nebo moc starý by jen stál gas. */
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

  /** Spustí výplatu těžařům, kteří mají něco k vyplacení. Mince jdou vždy přímo jim. */
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
      // V tichém poolu nikdo kola neuzavře, výplata by jinak nepřišla.
      const ready = await this.call({ to: toHex(this.address), data: toHex(READY) });
      if (BigInt(ready === '0x' ? 0 : ready) !== 1n) return null;
      return this._send(Buffer.concat([SETTLE, word(SETTLE_STEPS)]), BASE_GAS + GAS_PER_SETTLE * SETTLE_STEPS);
    }
    // Cena výplaty závisí na tom, ve kolika kolech těžař pracoval. Když se všichni nevejdou, zbytek počká na další kolo výplat.
    for (let list = due; list.length; list = list.slice(0, list.length >> 1)) {
      const data = encodeAddressArray(PAYOUT, list);
      const gas = await this.estimate({ from: toHex(this.sender), to: toHex(this.address), data: toHex(data) }).catch(() => null);
      if (gas !== null && BigInt(gas) < MAX_TX_GAS) {
        const tx = await this._send(data, (BigInt(gas) * 12n) / 10n);
        this.stats.paid += list.length;
        return tx;
      }
    }
    throw new PoolError('výplata se nevešla do limitu transakce');
  }

  /** Výkon jednoho zařízení z přijatých podílů, nula u zařízení, které se dlouho neozvalo. */
  _rate(s, now) {
    const seconds = (now - s.windowStart) / 1000;
    if (seconds <= 0 || now - s.seen > RATE_WINDOW_MS) return 0;
    const span = seconds + (s.previous > 0n ? RATE_WINDOW_MS / 1000 : 0);
    return Number(s.done + s.previous) / span;
  }

  /** Odhad výkonu z přijatých podílů. */
  hashrate() {
    const now = Date.now();
    let total = 0;
    for (const s of this.sessions.values()) total += this._rate(s, now);
    return Math.round(total);
  }

  /**
   * Stav serveru poolu. Připojená zařízení jdou po stránkách a dají se zúžit na jednoho těžaře,
   * protože u velkého poolu jich jsou tisíce. Adresa těžaře je veřejná v jeho podílech, IP adresy se neukazují.
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
