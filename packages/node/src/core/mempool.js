// Fronta nepotvrzených transakcí. Přijímá jen to, co by mohlo projít v dalším bloku,
// a po každé změně špičky řetězce sama odstraní, co už platit nemůže.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Capability } from '@ethereumjs/tx';
import { Address } from '@ethereumjs/util';
import { CONSENSUS as C } from '../params.js';
import { toHex } from '../util/bytes.js';
import { nextBaseFee } from './economics.js';
import { decodeTx } from './types.js';

export class MempoolError extends Error {}

// Soubor s frontou: značka a pak záznamy. Transakce: [0][čas přidání 8 B][příznaky 1 B][délka 4 B][transakce].
// Nahrazená transakce: [1][hash 32 B], připisuje se hned, aby ji starší uložení po pádu nevrátilo.
const JOURNAL_MAGIC = Buffer.from('QMP1');
const TX_RECORD = 0;
const REPLACED_RECORD = 1;
const LOCAL = 1;

const MAX_POOL = 5000;
const MAX_POOL_BYTES = 64 * 1024 * 1024;
const MAX_PER_SENDER = 64;
const MAX_NONCE_GAP = 64n;
const MAX_TX_GAS = 8_000_000n;       // jedna transakce nesmí zabrat celý blok, stačí i na největší kontrakt
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
  /** @param {object} [o] @param {number} [o.maxPool] nejvíc transakcí ve frontě */
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

  /** Co čeká na blok se základním poplatkem baseFee, pro doporučení poplatků. */
  competing(baseFee) {
    return this.all().filter((tx) => maxFee(tx) >= baseFee).map((tx) => ({ tip: effectiveTip(tx, baseFee), gas: tx.gasLimit }));
  }

  /**
   * Fronta pro Explorer: souhrn a jedna stránka transakcí. U každé je vidět, proč případně nemůže do dalšího bloku:
   * od odesílatele chybí dřívější nonce, nebo poplatek nepokryje základní poplatek sítě.
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
   * Přidá transakci. Při chybě vyhodí MempoolError s důvodem.
   * @param {object} [o]
   * @param {boolean} [o.local] přišla přes RPC tohoto uzlu, uzel ji proto občas pošle sousedům znovu
   * @param {number} [o.addedAt] čas přidání, při načtení fronty po restartu ten původní
   */
  async add(tx, { local = false, addedAt = Date.now() } = {}) {
    const hash = toHex(tx.hash());
    if (this.byHash.has(hash)) throw new MempoolError('transakce už je ve frontě');
    if (this.chain.store.txLocation(tx.hash())) throw new MempoolError('transakce už je potvrzená');
    if (tx.type > 2) throw new MempoolError('nepodporovaný typ transakce');
    const size = tx.serialize().length;
    if (size > C.maxTxBytes) throw new MempoolError('transakce je příliš velká');
    if (!tx.isSigned() || !tx.isValid()) throw new MempoolError(`neplatná transakce: ${tx.getValidationErrors().join(', ')}`);
    if (tx.type === 0 && !tx.supports(Capability.EIP155ReplayProtection)) throw new MempoolError('chybí ochrana chainId');

    const head = this.chain.head;
    if (tx.gasLimit > head.gasLimit || tx.gasLimit > MAX_TX_GAS) throw new MempoolError('gas překračuje limit transakce');
    if (tx.gasLimit < tx.getIntrinsicGas()) throw new MempoolError('gas je nižší než základní cena transakce');
    if (maxFee(tx) < C.minBaseFee) throw new MempoolError('poplatek je pod minimem sítě');

    let sender;
    try {
      sender = tx.getSenderAddress();
    } catch (e) {
      throw new MempoolError(`neplatný podpis: ${e.message}`);
    }

    const state = await this.chain.stateAt(head.stateRoot);
    const account = await state.stateManager.getAccount(sender);
    const stateNonce = account?.nonce ?? 0n;
    const balance = account?.balance ?? 0n;
    if (tx.nonce < stateNonce) throw new MempoolError('nonce je příliš nízké');
    if (tx.nonce > stateNonce + MAX_NONCE_GAP) throw new MempoolError('nonce je příliš vysoké');

    const key = sender.toString();
    let list = this.bySender.get(key);

    // Odesílatel musí mít prostředky na všechny své čekající transakce s nižším nonce dohromady.
    // Jinak by jeden malý účet zadarmo držel ve frontě transakce, které nikdy nezaplatí.
    let committed = cost(tx);
    for (const e of list?.values() ?? []) if (e.tx.nonce < tx.nonce) committed += cost(e.tx);
    if (balance < committed) throw new MempoolError('nedostatek prostředků');

    const existing = list?.get(tx.nonce);
    if (existing) {
      const needFee = (maxFee(existing.tx) * REPLACE_BUMP) / 100n;
      const needTip = (maxTip(existing.tx) * REPLACE_BUMP) / 100n;
      if (maxFee(tx) < needFee || maxTip(tx) < needTip) throw new MempoolError('náhrada musí mít alespoň o 10 % vyšší poplatek');
    } else if (list && list.size >= MAX_PER_SENDER) {
      throw new MempoolError('příliš mnoho čekajících transakcí od jednoho odesílatele');
    }

    // Plná fronta vytlačí nejlevnější. Kdo neplatí víc než ona, zůstává venku. Místo po nahrazované transakci se
    // počítá jako volné, ale odstraní se až potom: kdyby se náhrada nevešla, původní transakce musí ve frontě zůstat.
    const freedCount = existing ? 1 : 0;
    const freedBytes = existing ? existing.size : 0;
    while (this.byHash.size - freedCount >= this.maxPool || this.bytes - freedBytes + size > MAX_POOL_BYTES) {
      const lowest = this._lowest(key);
      if (!lowest || maxFee(lowest.tx) >= maxFee(tx)) throw new MempoolError('fronta je plná, zvyšte poplatek');
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
   * Kandidát na vytlačení: nejlevnější z posledních transakcí jednotlivých odesílatelů. Transakce z konce řady
   * nikomu nevytvoří mezeru v nonce, jinak by za vyřazenou zůstaly viset všechny pozdější. Vlastní dřívější
   * transakce odesílatele kvůli jeho další nevytlačí nic, i ta by mezeru vytvořila.
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
   * Transakce z RPC tohoto uzlu, které čekají déle než minAgeMs, seřazené podle nonce. Uzel je posílá sousedům
   * znovu: první rozeslání se mohlo ztratit, třeba když soused ještě neměl poslední blok a transakci odmítl.
   */
  local(minAgeMs, limit = 64) {
    const before = Date.now() - minAgeMs;
    return [...this.byHash.values()].filter((e) => e.local && e.addedAt <= before)
      .sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : a.tx.nonce > b.tx.nonce ? 1 : a.addedAt - b.addedAt))
      .slice(0, limit).map((e) => e.tx);
  }

  /** Kolik transakcí přišlo do fronty za poslední dobu a pořád čeká. */
  countSince(ms) {
    const from = Date.now() - ms;
    let n = 0;
    for (const e of this.byHash.values()) if (e.addedAt >= from) n += 1;
    return n;
  }

  /** Všechny čekající transakce seřazené podle nonce, aby je příjemce bral ve správném pořadí. */
  ordered() {
    return [...this.byHash.values()].sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : a.tx.nonce > b.tx.nonce ? 1 : 0)).map((e) => e.tx);
  }

  /**
   * Uloží frontu na disk, jen když se od minula změnila. Zápis přes dočasný soubor, takže po pádu zůstane
   * buď stará, nebo nová celá fronta. Plný disk uzel nezastaví, fronta se jen neuloží.
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
   * Načte frontu uloženou před restartem. Každá transakce projde stejnou kontrolou jako nová, takže co mezitím
   * přestalo platit nebo už je v bloku, do fronty nevstoupí. Starší než 6 hodin se zahodí jako za běhu.
   * @returns {Promise<number>} počet načtených transakcí
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
      try { saved.push({ tx: decodeTx(data.subarray(at, at + length), common), addedAt, local }); } catch { /* poškozená položka */ }
      at += length;
    }
    const oldest = Date.now() - MAX_AGE_MS;
    saved.sort((a, b) => (a.tx.nonce < b.tx.nonce ? -1 : a.tx.nonce > b.tx.nonce ? 1 : 0));
    let restored = 0;
    for (const { tx, addedAt, local } of saved) {
      // Nahrazená transakce se nevrací: zrušení nebo zrychlení platí, i když uzel spadl dřív, než frontu uložil celou.
      if (addedAt < oldest || replaced.has(toHex(tx.hash()))) continue;
      try {
        await this.add(tx, { local, addedAt });
        restored += 1;
      } catch { /* mezitím vytěžená nebo už neplatná */ }
    }
    this.dirty = restored !== saved.length || replaced.size > 0;
    return restored;
  }

  /**
   * Nahrazení se do souboru připíše hned, ne až s dalším uložením fronty. Jinak by po pádu uzlu starší uložení vrátilo
   * původní transakci a třeba zrušená platba by prošla. Jeden krátký záznam na konec souboru nic nestojí.
   */
  _journalReplaced(tx) {
    if (!this.journal) return;
    try {
      if (!existsSync(this.journal)) writeFileSync(this.journal, JOURNAL_MAGIC, { mode: 0o600 });
      appendFileSync(this.journal, Buffer.concat([Buffer.from([REPLACED_RECORD]), Buffer.from(tx.hash())]));
    } catch { /* plný disk: zbývá pravidelné uložení */ }
  }

  /** Vyřadí vše, co nová špička zneplatnila, a vrátí do fronty transakce z opuštěné větve. */
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

  /** Počká na dokončení úklidu po posledním bloku. */
  settled() { return this.pruning; }

  /**
   * Transakce pro další blok: u každého odesílatele jen souvislá řada nonce,
   * napříč odesílateli podle nejvyššího dýžka.
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
