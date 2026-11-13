// Řetězec: ověřování bloků, výběr větve s největší prací, reorganizace a indexy.
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
const BUILD_BUDGET_MS = 800;   // déle miner nečeká, šablona vznikne z toho, co se do té doby stihlo
const utf8 = new TextEncoder();
const min = (a, b) => (a < b ? a : b);

/** Dočasná chyba: blok může být platný později, peera za něj netrestáme. */
export class TemporaryBlockError extends Error {}

/**
 * Blok nebo přepis za hranicí finality. Poctivý uzel z druhé půlky rozdělené sítě takový blok posílá v dobré víře,
 * proto to není důvod k zablokování.
 */
export class FinalityError extends Error {}

/**
 * Přepis hlubší než hranice finality projde jen s výrazně větší prací. Rozdělená síť se tak po spojení srovná
 * a uzel, který při první synchronizaci dostal levnou falešnou větev, se z ní dostane. Útočník musí mít
 * dvojnásobek práce celé sítě od místa rozdělení.
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

  /** Konfigurace EVM platná pro blok dané výšky. */
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
   * @param {object} o.network parametry sítě z params.js
   * @param {string} o.dataDir složka dat, nebo ':memory:' pro testy
   * @param {string} [o.powDir] složka s cache Ethash
   * @param {object} [o.alloc] předinstalované kontrakty
   * @param {() => number} [o.now] hodiny v sekundách
   */
  static async open({ network, dataDir, powDir, alloc = {}, now, gasTarget }) {
    const store = new Store(dataDir === ':memory:' ? ':memory:' : join(dataDir, 'chain.db'));
    const common = makeCommon(network);
    const pow = new Pow(powDir ?? (dataDir === ':memory:' ? null : join(dataDir, 'ethash')));
    // Odmítnutí platí jen pro tento běh programu. Blok, který stará verze neuměla (třeba první blok po forku),
    // by jinak nová verze odmítala dál a uzel by po aktualizaci zůstal navždy odříznutý od sítě.
    store.clearBad();
    const chain = new Chain({
      network, store, common, pow, alloc, dataDir,
      now: now ?? (() => Math.floor(Date.now() / 1000)),
      gasTarget: gasTarget ?? C.genesisGasLimit,
      checkpoints: new Map((network.checkpoints ?? []).map((c) => [c.number, fromHex(c.hash)])),
      reorgs: { count: 0, deepest: 0, refused: 0 },   // pro dohled: hluboký přepis je první známka útoku
    });
    await chain._init();
    return chain;
  }

  async _init() {
    const genesis = await buildGenesis(this.network, this.store, this.common, this.alloc);
    const stored = this.store.canonicalHash(0);
    if (stored && !equal(stored, genesis.hash())) {
      throw new Error(`Databáze patří jiné síti: genesis ${toHex(stored)}, očekáváno ${toHex(genesis.hash())}`);
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
      if (stored && !equal(stored, hash)) throw new Error(`Databáze neodpovídá kontrolnímu bodu v bloku ${number}: uzel je na cizí větvi a musí stáhnout řetězec znovu.`);
    }
  }

  /**
   * Povolí přijímat bloky větve, která se odpojila hlouběji než hranice finality. Volá ji síť, až ověří hlavičky
   * celé větve a ty nesou aspoň dvojnásobek práce. Přepis pak stejně projde jen při splnění poměru práce.
   * @param {Header} ancestor společný předek na kanonickém řetězci
   */
  permitDeepFork(ancestor, ms = DEEP_PERMIT_MS) {
    this.deepPermit = { hash: ancestor.hash(), number: ancestor.number, until: Date.now() + ms };
  }

  _deepPermitted(number) {
    const p = this.deepPermit;
    return !!p && p.until > Date.now() && number >= p.number;
  }

  /** Nejvyšší kontrolní bod, který už řetězec prošel. Pod ním je historie pevná. */
  passedCheckpoint() {
    let top = -1n;
    for (const number of this.checkpoints.keys()) if (number <= this.head.number && number > top) top = number;
    return top;
  }

  close() {
    return this._exclusive(async () => this.store.close());
  }

  /** Bloky se zpracovávají po jednom. */
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

  /** Počet transakcí bez dekódování každé z nich. */
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
      if (!header) throw new Error('chybí předek pro výpočet obtížnosti');
      return header;
    }, this.network);
  }

  /** Hash předka na větvi končící rodičem, pro opcode BLOCKHASH. */
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

  /** Pravidla hlavičky, která nezávisí na obsahu bloku. */
  async validateHeader(h, parent) {
    if (h.number !== parent.number + 1n) throw new InvalidBlock('špatná výška');
    if (h.timestamp <= parent.timestamp) throw new InvalidBlock('čas bloku není větší než čas rodiče');
    if (h.timestamp > BigInt(this.now() + C.futureTimeLimit)) throw new TemporaryBlockError('blok je příliš v budoucnosti');
    if (h.extraData.length > C.maxExtraData) throw new InvalidBlock('extraData je příliš dlouhé');
    if (h.gasUsed > h.gasLimit) throw new InvalidBlock('gasUsed překračuje gasLimit');
    if (!gasLimitValid(h.gasLimit, parent.gasLimit, rulesAt(this.network, h.number).maxGasLimit)) throw new InvalidBlock('neplatná změna gasLimit');
    if (h.baseFee !== nextBaseFee(parent)) throw new InvalidBlock('špatný base fee');
    if (h.difficulty !== this.nextDifficulty(parent)) throw new InvalidBlock('špatná obtížnost');
    if (!(await this.pow.verify(h))) throw new InvalidBlock('neplatný Proof of Work');
  }

  async _validateBody(block) {
    const encoded = block.encode();
    if (encoded.length > C.maxBlockBytes) throw new InvalidBlock('blok je příliš velký');
    for (const tx of block.txs) {
      if (tx.serialize().length > C.maxTxBytes) throw new InvalidBlock('transakce je příliš velká');
      if (tx.type === 0 && !tx.supports(Capability.EIP155ReplayProtection)) {
        throw new InvalidBlock('transakce bez ochrany chainId');
      }
    }
    const txRoot = await orderedRoot(block.txs.map((t) => t.serialize()), this.commonAt(block.header.number));
    if (!equal(txRoot, block.header.txRoot)) throw new InvalidBlock('špatný kořen transakcí');
  }

  /** Přehraje transakci na jejím místě v bloku a vrátí, jak dopadla. Nic se neukládá. */
  async replayTx(block, index) {
    const h = block.header;
    const parent = this.getHeader(h.parentHash);
    return replayTx({
      store: this.store, common: this.commonAt(h.number), parent, ctx: h, txs: block.txs, index,
      ancestorHash: this._ancestorLookup(parent), pow: this.pow, upgrades: upgradesAt(this.network, h.number),
    });
  }

  /** Provede blok nad stavem rodiče a porovná výsledek s hlavičkou. */
  async _execute(block, parent) {
    const h = block.header;
    const res = await executeBlock({
      store: this.store, common: this.commonAt(h.number), parent, ctx: h, txs: block.txs, mode: 'verify',
      ancestorHash: this._ancestorLookup(parent), pow: this.pow, upgrades: upgradesAt(this.network, h.number),
    });
    if (!equal(res.stateRoot, h.stateRoot)) throw new InvalidBlock('špatný kořen stavu');
    if (!equal(res.receiptsRoot, h.receiptsRoot)) throw new InvalidBlock('špatný kořen účtenek');
    if (res.gasUsed !== h.gasUsed) throw new InvalidBlock('špatné gasUsed');
    if (!equal(res.logsBloom, h.logsBloom)) throw new InvalidBlock('špatný bloom');
    return res;
  }

  /**
   * Přijme blok ze sítě nebo od minera.
   * @returns {Promise<{status: 'known'|'orphan'|'added'|'side'|'reorg', hash: Uint8Array, depth?: number}>}
   */
  insertBlock(block) {
    return this._exclusive(async () => {
      const h = block.header;
      const hash = h.hash();
      const bad = this.store.badReason(hash);
      if (bad) throw new InvalidBlock(`dříve odmítnutý blok: ${bad}`);
      if (this.store.blockHas(hash)) return { status: 'known', hash };
      const parent = this.getHeader(h.parentHash);
      if (!parent) return { status: 'orphan', hash };
      if (this.store.badReason(h.parentHash)) throw new InvalidBlock('rodič je neplatný');
      if (h.number + BigInt(C.maxReorgDepth) <= this.head.number) {
        // Hluboko pod špičkou jen větev, kterou síť předem ověřila, a jen nad kanonickým předkem nebo jinou postranní větví.
        const deep = this._deepPermitted(h.number - 1n)
          && (equal(h.parentHash, this.deepPermit.hash) || !this.isCanonical(h.parentHash, parent.number));
        if (!deep) throw new FinalityError('blok je pod hranicí finality');
      }
      const fixed = this.checkpoints.get(h.number);
      if (fixed && !equal(fixed, hash)) throw new InvalidBlock(`blok neodpovídá kontrolnímu bodu ${h.number}`);
      if (h.number <= this.passedCheckpoint()) throw new InvalidBlock('blok je pod kontrolním bodem');

      // Tady se blok neoznačuje za neplatný. Hash kryje jen hlavičku, takže útočník může k cizímu
      // platnému bloku přidat zfalšované tělo: zápis hashe by pak uzel navždy odřízl od správného řetězce.
      // Označit jde až blok se správným tělem a platnou prací, kterému selže provedení.
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
        this.emit('head', { block, receipts: res.receipts, removed: [], added: [block] });
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

  /** Zapíše blok do kanonického řetězce a indexů. Volá se uvnitř databázové transakce. */
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

  /** Rejstřík pro Explorer: filtry, detail adresy a grafy. Konsensus ho nečte. */
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
   * Doplní rejstřík pro bloky z dřívějších verzí uzlu. Běží po malých dávkách, aby nebrzdil síť ani těžbu.
   * @returns {Promise<void>} hotovo, když rejstřík dohnal špičku
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

  /** Přechod na těžší větev. Stav se počítá znovu, starý řetězec zůstane, dokud vše neprojde. */
  async _reorg(block, td) {
    const path = [];
    let cursor = block.header;
    while (!this.isCanonical(cursor.hash(), cursor.number)) {
      path.unshift(cursor);
      cursor = this.getHeader(cursor.parentHash);
      if (!cursor) throw new Error('přerušená větev');
    }
    const ancestor = cursor;
    const depth = Number(this.head.number - ancestor.number);
    if (depth > C.maxReorgDepth) {
      if (!this._deepPermitted(ancestor.number)) {
        this.reorgs.refused += 1;
        this.emit('finality-violation', { hash: block.hash(), depth });
        throw new FinalityError(`reorganizace o ${depth} bloků je za hranicí finality`);
      }
      // Větev zůstane postranní, dokud nemá dvojnásobek práce naší větve od společného předka.
      const base = this.getTd(ancestor.hash());
      if (td - base < DEEP_REORG_WORK_RATIO * (this.headTd - base)) return { status: 'side', hash: block.hash() };
      this.emit('deep-reorg', { depth, ancestor: ancestor.number });
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
          // Neplatný je tento blok i všichni potomci na větvi.
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

    // Účty dotčené opuštěnou větví se přepočítají z nového stavu.
    const state = await this.stateAt(block.header.stateRoot);
    for (const a of touched.values()) {
      const account = await state.getAccountByBytes(a);
      this.store.accountPut(a, account?.balance ?? 0n, account?.isContract() ?? false);
    }

    this.reorgs.count += 1;
    if (depth > this.reorgs.deepest) this.reorgs.deepest = depth;
    const added = results.map((r) => r.block);
    const last = results[results.length - 1];
    this.emit('head', { block, receipts: last.res.receipts, removed, added });
    this.emit('reorg', { depth, removed, added });
    return { status: 'reorg', hash: block.hash(), depth };
  }

  /** Přístup ke stavu pro čtení, nikdy nezapisuje na disk. */
  async stateAt(root) {
    const { stateManager } = await openState(this.store, this.common, root);
    return {
      stateManager,
      getAccountByBytes: (bytes) => stateManager.getAccount(new Address(bytes)),
    };
  }

  /**
   * Sestaví šablonu bloku pro minera.
   * @param {object} o
   * @param {Uint8Array} o.miner adresa výplaty
   * @param {Iterable} o.txs transakce podle priority
   * @param {string} [o.extra] krátký popis v extraData
   * @param {number} [o.budgetMs] časový limit na transakce šablony
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
