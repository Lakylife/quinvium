// Persistent storage. SQLite is part of Node, so the node has no native dependencies
// and runs the same on Windows, macOS and Linux.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS kv(k BLOB PRIMARY KEY, v BLOB NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v BLOB);
CREATE TABLE IF NOT EXISTS blocks(
  hash BLOB PRIMARY KEY, number INTEGER NOT NULL, parent BLOB NOT NULL, td TEXT NOT NULL,
  header BLOB NOT NULL, body BLOB NOT NULL, receipts BLOB) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS blocks_number ON blocks(number);
CREATE TABLE IF NOT EXISTS canonical(number INTEGER PRIMARY KEY, hash BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS txs(hash BLOB PRIMARY KEY, number INTEGER NOT NULL, idx INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS txs_number ON txs(number DESC, idx DESC);
CREATE TABLE IF NOT EXISTS addr_txs(addr BLOB NOT NULL, number INTEGER NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY(addr, number, idx)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS addr_txs_number ON addr_txs(number);
CREATE TABLE IF NOT EXISTS logs(
  number INTEGER NOT NULL, tx_idx INTEGER NOT NULL, log_idx INTEGER NOT NULL, address BLOB NOT NULL,
  t0 BLOB, t1 BLOB, t2 BLOB, t3 BLOB, PRIMARY KEY(number, log_idx)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS logs_address ON logs(address, number);
CREATE INDEX IF NOT EXISTS logs_t0 ON logs(t0, number);
CREATE TABLE IF NOT EXISTS accounts(addr BLOB PRIMARY KEY, balance_hex TEXT NOT NULL, balance_sort REAL NOT NULL, is_contract INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS accounts_rich ON accounts(balance_sort DESC);
CREATE TABLE IF NOT EXISTS miner_fees(number INTEGER PRIMARY KEY, total TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS block_index(
  number INTEGER PRIMARY KEY, time INTEGER NOT NULL, miner BLOB NOT NULL, difficulty REAL NOT NULL,
  solve INTEGER NOT NULL, txs INTEGER NOT NULL, gas INTEGER NOT NULL, income REAL NOT NULL);
CREATE INDEX IF NOT EXISTS block_index_time ON block_index(time);
CREATE INDEX IF NOT EXISTS block_index_miner ON block_index(miner, number DESC);
CREATE TABLE IF NOT EXISTS tx_index(
  number INTEGER NOT NULL, idx INTEGER NOT NULL, time INTEGER NOT NULL, sender BLOB NOT NULL, recipient BLOB,
  kind INTEGER NOT NULL, ok INTEGER NOT NULL, value REAL NOT NULL, fee REAL NOT NULL, PRIMARY KEY(number, idx)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS tx_index_sender ON tx_index(sender, number DESC, idx DESC);
CREATE INDEX IF NOT EXISTS tx_index_recipient ON tx_index(recipient, number DESC, idx DESC);
CREATE INDEX IF NOT EXISTS tx_index_time ON tx_index(time);
-- Odesílatel a příjemce převodu tokenu, s číslem bloku: historie adresy jde od nejnovějšího bez řazení všech záznamů.
DROP INDEX IF EXISTS logs_t1;
DROP INDEX IF EXISTS logs_t2;
CREATE INDEX IF NOT EXISTS logs_t1_number ON logs(t1, t0, number, log_idx);
CREATE INDEX IF NOT EXISTS logs_t2_number ON logs(t2, t0, number, log_idx);
CREATE TABLE IF NOT EXISTS bad_blocks(hash BLOB PRIMARY KEY, reason TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS peers(addr TEXT PRIMARY KEY, last_seen INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, tried INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS peers_tried ON peers(tried, last_seen);
PRAGMA recursive_triggers=ON;
CREATE TABLE IF NOT EXISTS miner_index(
  miner BLOB PRIMARY KEY, blocks INTEGER NOT NULL, work REAL NOT NULL, income REAL NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS miner_index_blocks ON miner_index(blocks DESC, last DESC);
CREATE INDEX IF NOT EXISTS miner_index_last ON miner_index(last DESC);
CREATE INDEX IF NOT EXISTS miner_index_work ON miner_index(work DESC);
CREATE TRIGGER IF NOT EXISTS miner_index_add AFTER INSERT ON block_index WHEN NEW.number > 0 BEGIN
  INSERT INTO miner_index VALUES(NEW.miner, 1, NEW.difficulty, NEW.income, NEW.number, NEW.number)
    ON CONFLICT(miner) DO UPDATE SET blocks=blocks+1, work=work+excluded.work, income=income+excluded.income, first=MIN(first, excluded.first), last=MAX(last, excluded.last);
END;
CREATE TRIGGER IF NOT EXISTS miner_index_remove AFTER DELETE ON block_index WHEN OLD.number > 0 BEGIN
  UPDATE miner_index SET blocks=blocks-1, work=work-OLD.difficulty, income=income-OLD.income,
    first=COALESCE((SELECT MIN(number) FROM block_index WHERE miner=OLD.miner AND number>0), first),
    last=COALESCE((SELECT MAX(number) FROM block_index WHERE miner=OLD.miner), last)
    WHERE miner=OLD.miner;
  DELETE FROM miner_index WHERE miner=OLD.miner AND blocks<=0;
END;
CREATE TABLE IF NOT EXISTS counters(k TEXT PRIMARY KEY, v INTEGER NOT NULL) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS accounts_add AFTER INSERT ON accounts BEGIN
  UPDATE counters SET v=v+1 WHERE k='accounts';
  UPDATE counters SET v=v+1 WHERE k='holders' AND NEW.balance_hex<>'0';
END;
CREATE TRIGGER IF NOT EXISTS accounts_remove AFTER DELETE ON accounts BEGIN
  UPDATE counters SET v=v-1 WHERE k='accounts';
  UPDATE counters SET v=v-1 WHERE k='holders' AND OLD.balance_hex<>'0';
END;
-- Počet všech transakcí pro přehled: počítat COUNT(*) přes miliony řádků při každé návštěvě by trvalo.
CREATE TRIGGER IF NOT EXISTS txs_add AFTER INSERT ON tx_index BEGIN
  UPDATE counters SET v=v+1 WHERE k='txs';
END;
CREATE TRIGGER IF NOT EXISTS txs_remove AFTER DELETE ON tx_index BEGIN
  UPDATE counters SET v=v-1 WHERE k='txs';
END;
`;

// Triggers maintain miner and account totals on every write. Without them the network summary with millions of accounts
// walked the whole table on every query. REPLACE also fires the delete trigger thanks to recursive_triggers.

const MAX_COUNT = 100_000;     // counting results stops; pagination does not need an exact total
const MAX_TOKENS = 200;

const buf = (b) => (b instanceof Uint8Array && !Buffer.isBuffer(b) ? Buffer.from(b.buffer, b.byteOffset, b.length) : b);
const u8 = (b) => (b == null ? b : new Uint8Array(b));

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      kvGet: p('SELECT v FROM kv WHERE k=?'),
      kvPut: p('INSERT OR REPLACE INTO kv VALUES(?,?)'),
      metaGet: p('SELECT v FROM meta WHERE k=?'),
      metaPut: p('INSERT OR REPLACE INTO meta VALUES(?,?)'),
      blockPut: p('INSERT OR IGNORE INTO blocks(hash,number,parent,td,header,body,receipts) VALUES(?,?,?,?,?,?,NULL)'),
      blockGet: p('SELECT number,parent,td,header,body,receipts FROM blocks WHERE hash=?'),
      headerGet: p('SELECT header,td FROM blocks WHERE hash=?'),
      blockHas: p('SELECT 1 FROM blocks WHERE hash=?'),
      receiptsPut: p('UPDATE blocks SET receipts=? WHERE hash=?'),
      blockDel: p('DELETE FROM blocks WHERE hash=?'),
      canonGet: p('SELECT hash FROM canonical WHERE number=?'),
      canonPut: p('INSERT OR REPLACE INTO canonical VALUES(?,?)'),
      canonDelAbove: p('DELETE FROM canonical WHERE number>?'),
      badPut: p('INSERT OR REPLACE INTO bad_blocks VALUES(?,?)'),
      badGet: p('SELECT reason FROM bad_blocks WHERE hash=?'),
      txPut: p('INSERT OR REPLACE INTO txs VALUES(?,?,?)'),
      txGet: p('SELECT number,idx FROM txs WHERE hash=?'),
      txRecent: p('SELECT number,idx FROM txs ORDER BY number DESC, idx DESC LIMIT ?'),
      txDelAbove: p('DELETE FROM txs WHERE number>?'),
      addrPut: p('INSERT OR IGNORE INTO addr_txs VALUES(?,?,?)'),
      addrDelAbove: p('DELETE FROM addr_txs WHERE number>?'),
      addrList: p('SELECT number,idx FROM addr_txs WHERE addr=? ORDER BY number DESC, idx DESC LIMIT ? OFFSET ?'),
      addrCount: p(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM addr_txs WHERE addr=? LIMIT ${MAX_COUNT})`),
      counterGet: p('SELECT v FROM counters WHERE k=?'),
      logPut: p('INSERT OR REPLACE INTO logs VALUES(?,?,?,?,?,?,?,?)'),
      logDelAbove: p('DELETE FROM logs WHERE number>?'),
      accountPut: p('INSERT OR REPLACE INTO accounts VALUES(?,?,?,?)'),
      richList: p('SELECT addr,balance_hex,is_contract FROM accounts ORDER BY balance_sort DESC LIMIT ?'),
      feesPut: p('INSERT OR REPLACE INTO miner_fees VALUES(?,?)'),
      feesGet: p('SELECT total FROM miner_fees WHERE number=?'),
      feesDelAbove: p('DELETE FROM miner_fees WHERE number>?'),
      blockIndexPut: p('INSERT OR REPLACE INTO block_index VALUES(?,?,?,?,?,?,?,?)'),
      blockIndexDel: p('DELETE FROM block_index WHERE number>?'),
      blockIndexTip: p('SELECT MAX(number) AS n FROM block_index'),
      txIndexPut: p('INSERT OR REPLACE INTO tx_index VALUES(?,?,?,?,?,?,?,?,?)'),
      txIndexDel: p('DELETE FROM tx_index WHERE number>?'),
      peerConnected: p('INSERT INTO peers VALUES(?,?,0,1) ON CONFLICT(addr) DO UPDATE SET last_seen=excluded.last_seen, fails=0, tried=1'),
      peerLearned: p('INSERT OR IGNORE INTO peers VALUES(?,?,0,0)'),
      peerFail: p('UPDATE peers SET fails=fails+1 WHERE addr=?'),
      peerGroup: p('SELECT addr FROM peers WHERE tried=? AND fails<8 ORDER BY last_seen DESC LIMIT ?'),
      peerPrune: p('DELETE FROM peers WHERE (tried=0 AND fails>=3) OR fails>=20'),
      peerCount: p('SELECT COUNT(*) AS c FROM peers'),
    };
    this._heal();
  }

  /**
   * Running totals do not match after an older node version or a manual change of the index. On start they are therefore verified
   * and in that case they are recomputed once in full; afterwards triggers maintain them.
   */
  _heal() {
    const one = (sql) => this.db.prepare(sql).get();
    const blocks = one('SELECT COUNT(*) AS c FROM block_index WHERE number>0').c;
    if (one('SELECT COALESCE(SUM(blocks),0) AS c FROM miner_index').c !== blocks) {
      this.transaction(() => {
        this.db.exec('DELETE FROM miner_index');
        this.db.exec('INSERT INTO miner_index SELECT miner, COUNT(*), SUM(difficulty), SUM(income), MIN(number), MAX(number) FROM block_index WHERE number>0 GROUP BY miner');
      });
    }
    const accounts = one('SELECT COUNT(*) AS c FROM accounts').c;
    const holders = one("SELECT COUNT(*) AS c FROM accounts WHERE balance_hex <> '0'").c;
    const txs = one('SELECT COUNT(*) AS c FROM tx_index').c;
    if (this.q.counterGet.get('accounts')?.v !== accounts || this.q.counterGet.get('holders')?.v !== holders || this.q.counterGet.get('txs')?.v !== txs) {
      this.transaction(() => {
        const put = this.db.prepare('INSERT OR REPLACE INTO counters VALUES(?,?)');
        put.run('accounts', accounts);
        put.run('holders', holders);
        put.run('txs', txs);
      });
    }
  }

  close() { this.db.close(); }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  kvGet(k) { return u8(this.q.kvGet.get(k)?.v); }
  /** @param {Map<string, Uint8Array>} entries keys in hex */
  kvPutMany(entries) {
    this.transaction(() => {
      for (const [k, v] of entries) this.q.kvPut.run(Buffer.from(k, 'hex'), buf(v));
    });
  }

  metaGet(k) { return u8(this.q.metaGet.get(k)?.v); }
  metaPut(k, v) { this.q.metaPut.run(k, buf(v)); }

  blockPut(hash, number, parent, td, header, body) {
    this.q.blockPut.run(buf(hash), Number(number), buf(parent), td.toString(), buf(header), buf(body));
  }
  blockHas(hash) { return this.q.blockHas.get(buf(hash)) !== undefined; }
  blockDelete(hash) { this.q.blockDel.run(buf(hash)); }
  blockGet(hash) {
    const r = this.q.blockGet.get(buf(hash));
    if (!r) return null;
    return { number: BigInt(r.number), parent: u8(r.parent), td: BigInt(r.td), header: u8(r.header), body: u8(r.body), receipts: u8(r.receipts) };
  }
  headerGet(hash) {
    const r = this.q.headerGet.get(buf(hash));
    return r ? { header: u8(r.header), td: BigInt(r.td) } : null;
  }
  receiptsPut(hash, receipts) { this.q.receiptsPut.run(buf(receipts), buf(hash)); }
  canonicalHash(number) { return u8(this.q.canonGet.get(Number(number))?.hash); }
  markBad(hash, reason) { this.q.badPut.run(buf(hash), String(reason).slice(0, 200)); }
  badReason(hash) { return this.q.badGet.get(buf(hash))?.reason; }
  clearBad() { this.db.exec('DELETE FROM bad_blocks'); }
  txLocation(hash) {
    const r = this.q.txGet.get(buf(hash));
    return r ? { number: BigInt(r.number), index: r.idx } : null;
  }
  addressTxs(addr, limit, offset) { return this.q.addrList.all(buf(addr), limit, offset); }
  addressTxCount(addr) { return this.q.addrCount.get(buf(addr)).c; }

  /** Log filter through indexes, without walking the blooms of the whole chain. */
  queryLogs({ fromBlock, toBlock, addresses, topics }, limit = 10000) {
    const where = ['number>=?', 'number<=?'];
    const args = [Number(fromBlock), Number(toBlock)];
    if (addresses?.length) {
      where.push(`address IN (${addresses.map(() => '?').join(',')})`);
      args.push(...addresses.map(buf));
    }
    (topics ?? []).slice(0, 4).forEach((t, i) => {
      if (t == null) return;
      const list = Array.isArray(t) ? t : [t];
      if (list.length === 0) return;
      where.push(`t${i} IN (${list.map(() => '?').join(',')})`);
      args.push(...list.map(buf));
    });
    args.push(limit + 1);
    const rows = this.db.prepare(`SELECT number,tx_idx,log_idx FROM logs WHERE ${where.join(' AND ')} ORDER BY number,log_idx LIMIT ?`).all(...args);
    if (rows.length > limit) throw new Error(`dotaz vrací více než ${limit} logů, zužte rozsah`);
    return rows;
  }

  richList(limit) { return this.q.richList.all(limit).map((r) => ({ addr: u8(r.addr), balance: BigInt('0x' + r.balance_hex), isContract: !!r.is_contract })); }
  accountCount() { return this.q.counterGet.get('accounts')?.v ?? 0; }
  holderCount() { return this.q.counterGet.get('holders')?.v ?? 0; }
  accountPut(addr, balance, isContract) {
    this.q.accountPut.run(buf(addr), balance.toString(16), Number(balance), isContract ? 1 : 0);
  }
  /** Sum of all fees paid to miners up to the given height. */
  feesAt(number) { return BigInt(this.q.feesGet.get(Number(number))?.total ?? 0); }
  /** A connection we established: the address is verified. */
  peerConnected(addr) { this.q.peerConnected.run(addr, Date.now()); }
  /** An address from a foreign node: nothing is known about it; it must not change the record of a verified node. */
  peerLearned(addr) { this.q.peerLearned.run(addr, Date.now()); }
  peerFailed(addr) { this.q.peerFail.run(addr); this.q.peerPrune.run(); }
  peerCount() { return this.q.peerCount.get().c; }
  peersTried(limit) { return this.q.peerGroup.all(1, limit).map((r) => r.addr); }
  peersNew(limit) { return this.q.peerGroup.all(0, limit).map((r) => r.addr); }
  recentTxs(limit) { return this.q.txRecent.all(limit); }

  indexedTip() { return BigInt(this.q.blockIndexTip.get().n ?? 0); }

  /**
   * Blocks by filter for the Explorer. Conditions come only from this list and values go through query parameters.
   * @returns {{total: number, numbers: number[]}}
   */
  findBlocks({ miner, minTxs, onlyEmpty, fromTime, toTime, fromBlock, toBlock, limit, offset, ascending }) {
    const where = [];
    const args = [];
    const add = (sql, ...values) => { where.push(sql); args.push(...values); };
    if (miner) add('miner=?', buf(miner));
    if (minTxs) add('txs>=?', minTxs);
    if (onlyEmpty) where.push('txs=0');
    if (fromTime) add('time>=?', fromTime);
    if (toTime) add('time<=?', toTime);
    if (fromBlock) add('number>=?', fromBlock);
    if (toBlock) add('number<=?', toBlock);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM block_index ${clause} LIMIT ${MAX_COUNT})`).get(...args).c;
    const rows = this.db.prepare(`SELECT number FROM block_index ${clause} ORDER BY number ${ascending ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total, capped: total >= MAX_COUNT, numbers: rows.map((r) => r.number) };
  }

  /**
   * Transactions by filter. The address uses an index; other conditions are added to it.
   * @returns {{total: number, rows: {number: number, idx: number}[]}}
   */
  findTxs({ address, direction, kind, ok, fromTime, toTime, fromBlock, toBlock, minValue, limit, offset, ascending }) {
    const where = [];
    const args = [];
    const add = (sql, ...values) => { where.push(sql); args.push(...values); };
    if (address) {
      const a = buf(address);
      if (direction === 'in') add('recipient=?', a);
      else if (direction === 'out') add('sender=?', a);
      else add('(sender=? OR recipient=?)', a, a);
    }
    if (kind !== undefined) add('kind=?', kind);
    if (ok !== undefined) add('ok=?', ok);
    if (fromTime) add('time>=?', fromTime);
    if (toTime) add('time<=?', toTime);
    if (fromBlock) add('number>=?', fromBlock);
    if (toBlock) add('number<=?', toBlock);
    if (minValue) add('value>=?', minValue);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM tx_index ${clause} LIMIT ${MAX_COUNT})`).get(...args).c;
    const order = ascending ? 'ASC' : 'DESC';
    const rows = this.db.prepare(`SELECT number,idx FROM tx_index ${clause} ORDER BY number ${order}, idx ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total, capped: total >= MAX_COUNT, rows };
  }

  /** Address summary. Totals are floating-point numbers; that is enough for display and avoids big numbers over the whole history. */
  addressSummary(address) {
    const a = buf(address);
    const get = (sql, ...args) => this.db.prepare(sql).get(...args);
    const out = get('SELECT COUNT(*) AS n, COALESCE(SUM(value),0) AS value, COALESCE(SUM(fee),0) AS fee, COALESCE(SUM(ok=0),0) AS failed, MIN(number) AS first, MAX(number) AS last FROM tx_index WHERE sender=?', a);
    const received = get('SELECT COUNT(*) AS n, COALESCE(SUM(value),0) AS value, MIN(number) AS first, MAX(number) AS last FROM tx_index WHERE recipient=? AND ok=1', a);
    const mined = get('SELECT COUNT(*) AS n, COALESCE(SUM(income),0) AS income, MIN(number) AS first, MAX(number) AS last FROM block_index WHERE miner=?', a);
    // First and last sent transaction and where the first coins came from, like "Funded by" on Etherscan.
    const firstSent = get('SELECT number, idx FROM tx_index WHERE sender=? ORDER BY number ASC, idx ASC LIMIT 1', a) ?? null;
    const lastSent = get('SELECT number, idx FROM tx_index WHERE sender=? ORDER BY number DESC, idx DESC LIMIT 1', a) ?? null;
    const funding = get('SELECT number, idx FROM tx_index WHERE recipient=? AND ok=1 AND value>0 ORDER BY number ASC, idx ASC LIMIT 1', a) ?? null;
    // A transfer to oneself is both outgoing and incoming. It should count once in the address's transaction count.
    const self = get('SELECT COUNT(*) AS n FROM tx_index WHERE sender=? AND recipient=? AND ok=1', a, a).n;
    return { out, received, mined, firstSent, lastSent, funding, self };
  }

  /** Token contracts that ever sent the address a transfer or took one from it (Transfer event). */
  tokensOf(address, transferTopic) {
    const pad = Buffer.alloc(32);
    pad.set(buf(address), 12);
    const topic = buf(transferTopic);
    return this.db.prepare(`SELECT address FROM logs WHERE t1=? AND t0=? UNION SELECT address FROM logs WHERE t2=? AND t0=? LIMIT ${MAX_TOKENS}`)
      .all(pad, topic, pad, topic).map((r) => u8(r.address));
  }

  /** Logs with the address in the first indexed parameter, newest first. */
  /** Events of one kind from a token contract, newest first. */
  tokenEvents(token, topic, limit, offset) {
    const where = 'WHERE address=? AND t0=?';
    const [a, t0] = [buf(token), buf(topic)];
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM logs ${where} LIMIT ${MAX_COUNT})`).get(a, t0).c;
    const rows = this.db.prepare(`SELECT number,tx_idx,log_idx,t1,t2 FROM logs ${where} ORDER BY number DESC, log_idx DESC LIMIT ? OFFSET ?`).all(a, t0, limit, offset);
    return { total, capped: total >= MAX_COUNT, rows: rows.map((r) => ({ ...r, t1: u8(r.t1), t2: u8(r.t2) })) };
  }

  /** How many blocks and how much work each miner or pool has over the period. A pool is the reward recipient address in the block. */
  minerShares(from, to, limit) {
    const rows = this.db.prepare('SELECT miner, COUNT(*) AS blocks, SUM(difficulty) AS work, MAX(number) AS last FROM block_index WHERE number>0 AND time BETWEEN ? AND ? GROUP BY miner ORDER BY work DESC LIMIT ?').all(from, to, limit);
    return rows.map((r) => ({ ...r, miner: u8(r.miner) }));
  }

  /** The same over the whole history from running totals, without walking all blocks. */
  minerTotals(limit) {
    return this.db.prepare('SELECT miner, blocks, work, last FROM miner_index ORDER BY work DESC LIMIT ?').all(limit).map((r) => ({ ...r, miner: u8(r.miner) }));
  }

  /**
   * Ranking of all miners by page. The number of miners grows with history, so sorting goes by an index
   * and they are never all loaded at once.
   */
  minerList({ order, limit, offset }) {
    const sort = order === 'last' ? 'last DESC' : 'blocks DESC, last DESC';
    const total = this.db.prepare('SELECT COUNT(*) AS c FROM miner_index').get().c;
    const rows = this.db.prepare(`SELECT miner, blocks, work, income, first, last FROM miner_index ORDER BY ${sort} LIMIT ? OFFSET ?`).all(limit, offset);
    return { total, rows: rows.map((r) => ({ ...r, miner: u8(r.miner) })) };
  }

  /** One miner and its rank by number of blocks. */
  minerRank(miner) {
    const r = this.db.prepare('SELECT miner, blocks, work, income, first, last FROM miner_index WHERE miner=?').get(buf(miner));
    if (!r) return null;
    const rank = this.db.prepare('SELECT COUNT(*) + 1 AS n FROM miner_index WHERE blocks > ? OR (blocks = ? AND last > ?)').get(r.blocks, r.blocks, r.last).n;
    return { ...r, miner: u8(r.miner), rank };
  }

  /**
   * How many different miners found a block since the given time. An index by time is required: without it SQLite would for DISTINCT
   * chooses the miner index and walks the whole history (a million blocks = 6 s instead of milliseconds).
   */
  activeMiners(fromTime) {
    return this.db.prepare('SELECT COUNT(DISTINCT miner) AS c FROM block_index INDEXED BY block_index_time WHERE time>=? AND number>0').get(fromTime).c;
  }

  /** Addresses that have ever received the token. Only the contract knows the current balance. */
  tokenRecipients(token, topic, cap) {
    const rows = this.db.prepare('SELECT DISTINCT t2 FROM logs WHERE address=? AND t0=? AND t2 IS NOT NULL LIMIT ?').all(buf(token), buf(topic), cap);
    return rows.map((r) => u8(r.t2));
  }

  /**
   * Token transfers in which the address sent or received, newest first. A transfer to oneself counts once.
   * Both halves go through an index sorted by block; SQLite merges them and reads no more than the page needs.
   */
  holderTransfers(holder, topic, limit, offset) {
    const pad = Buffer.alloc(32);
    pad.set(buf(holder), 12);
    const t0 = buf(topic);
    const both = 'SELECT number,tx_idx,log_idx,address,t1,t2,t3 FROM logs WHERE t1=? AND t0=? UNION SELECT number,tx_idx,log_idx,address,t1,t2,t3 FROM logs WHERE t2=? AND t0=?';
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM (${both} LIMIT ${MAX_COUNT})`).get(pad, t0, pad, t0).c;
    const rows = this.db.prepare(`${both} ORDER BY number DESC, log_idx DESC LIMIT ? OFFSET ?`).all(pad, t0, pad, t0, limit, offset);
    return { total, capped: total >= MAX_COUNT, rows: rows.map((r) => ({ ...r, address: u8(r.address), t1: u8(r.t1), t2: u8(r.t2), t3: r.t3 ? u8(r.t3) : null })) };
  }

  /**
   * Who appears in the first indexed field in events of one contract since the given block, how often and when last.
   * For pool miners: only the pool window is read through the address and block index, not the whole history.
   */
  topicSummary(address, topic, fromNumber, limit) {
    return this.db.prepare('SELECT t1, COUNT(*) AS c, MAX(number) AS last FROM logs WHERE address=? AND number>=? AND t0=? GROUP BY t1 ORDER BY c DESC, last DESC LIMIT ?')
      .all(buf(address), fromNumber, buf(topic), limit).map((r) => ({ who: u8(r.t1), count: r.c, last: r.last }));
  }

  /**
   * Miners of one pool since the given block by page: how many shares they submitted and when last. For a pool
   * with thousands of miners they are never all loaded; the total count is computed separately.
   */
  poolMiners(address, topic, fromNumber, limit, offset) {
    const where = 'WHERE address=? AND number>=? AND t0=?';
    const args = [buf(address), fromNumber, buf(topic)];
    const total = this.db.prepare(`SELECT COUNT(DISTINCT t1) AS n FROM logs ${where}`).get(...args).n;
    const rows = this.db.prepare(`SELECT t1, COUNT(*) AS c, MAX(number) AS last FROM logs ${where} GROUP BY t1 ORDER BY c DESC, last DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total, rows: rows.map((r) => ({ who: u8(r.t1), count: r.c, last: r.last })) };
  }

  /** One pool miner including its rank, so it can be found among thousands of others. */
  poolMinerRank(address, topic, fromNumber, who) {
    const pad = Buffer.alloc(32);
    pad.set(buf(who), 12);
    const me = this.db.prepare('SELECT COUNT(*) AS c, MAX(number) AS last FROM logs WHERE t1=? AND t0=? AND number>=? AND address=?').get(pad, buf(topic), fromNumber, buf(address));
    if (!me.c) return null;
    const ahead = this.db.prepare('SELECT COUNT(*) AS n FROM (SELECT COUNT(*) AS c, MAX(number) AS last FROM logs WHERE address=? AND number>=? AND t0=? GROUP BY t1) WHERE c>? OR (c=? AND last>?)')
      .get(buf(address), fromNumber, buf(topic), me.c, me.c, me.last).n;
    return { who: u8(pad), count: me.c, last: me.last, rank: ahead + 1 };
  }

  /** Blocks of one miner since the given time, newest first. The wallet builds daily rewards from them. */
  minedSince(miner, fromTime, limit) {
    return this.db.prepare('SELECT number, time FROM block_index WHERE miner=? AND time>=? ORDER BY number DESC LIMIT ?').all(buf(miner), fromTime, limit);
  }

  /** How many different miners submitted a share to the pool since the given block. */
  poolMinerCount(address, topic, fromNumber) {
    return this.db.prepare('SELECT COUNT(DISTINCT t1) AS n FROM logs WHERE address=? AND number>=? AND t0=?').get(buf(address), fromNumber, buf(topic)).n;
  }

  /** Events of one contract with the given address in the second indexed field, newest first. For example the pools of one operator. */
  eventsBySecond(address, topic, second, limit) {
    const pad = Buffer.alloc(32);
    pad.set(buf(second), 12);
    return this.db.prepare('SELECT number,tx_idx,log_idx,t1 FROM logs WHERE t2=? AND t0=? AND address=? ORDER BY number DESC LIMIT ?')
      .all(pad, buf(topic), buf(address), limit).map((r) => ({ number: r.number, txIdx: r.tx_idx, logIdx: r.log_idx, first: u8(r.t1) }));
  }

  logsForAddress(address, topic, limit, offset) {
    const pad = Buffer.alloc(32);
    pad.set(buf(address), 12);
    const where = 'WHERE t1=? AND t0=?';
    const t0 = buf(topic);
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM logs ${where} LIMIT ${MAX_COUNT})`).get(pad, t0).c;
    const rows = this.db.prepare(`SELECT number,tx_idx,log_idx,address FROM logs ${where} ORDER BY number DESC, log_idx DESC LIMIT ? OFFSET ?`).all(pad, t0, limit, offset);
    return { total, rows: rows.map((r) => ({ ...r, address: u8(r.address) })) };
  }

  /** All transactions in the chain, from the running total. */
  txCount() { return this.q.counterGet.get('txs')?.v ?? 0; }

  /**
   * Traffic summary since the given time: transactions, fees, active addresses, blocks, utilisation and pool blocks.
   * A pool is a contract that receives the block reward. Everything goes through the time index, not the whole history.
   */
  activity(fromTime) {
    const tx = this.db.prepare('SELECT COUNT(*) AS txs, COALESCE(SUM(fee),0) AS fees, COUNT(DISTINCT sender) AS senders, COALESCE(SUM(ok=0),0) AS failed FROM tx_index INDEXED BY tx_index_time WHERE time>=?').get(fromTime);
    const blocks = this.db.prepare('SELECT COUNT(*) AS blocks, COALESCE(AVG(gas),0) AS gas, COALESCE(AVG(solve),0) AS solve, COALESCE(SUM(income),0) AS income FROM block_index INDEXED BY block_index_time WHERE time>=? AND number>1').get(fromTime);
    const pools = this.db.prepare('SELECT COUNT(*) AS c FROM block_index b INDEXED BY block_index_time JOIN accounts a ON a.addr=b.miner WHERE b.time>=? AND b.number>0 AND a.is_contract=1').get(fromTime).c;
    return { ...tx, ...blocks, poolBlocks: pools };
  }

  /** Additional chart series over the same intervals as chartSeries: active addresses, fees, new contracts, token transfers. */
  chartExtra(from, to, bucket, transferTopic) {
    const tx = this.db.prepare(`SELECT CAST((time - ?) / ? AS INTEGER) AS b, COUNT(DISTINCT sender) AS senders, COALESCE(SUM(fee),0) AS fees, COALESCE(SUM(kind=2),0) AS created, COALESCE(SUM(ok=0),0) AS failed
      FROM tx_index INDEXED BY tx_index_time WHERE time BETWEEN ? AND ? GROUP BY b`).all(from, bucket, from, to);
    const transfers = this.db.prepare(`SELECT CAST((bi.time - ?) / ? AS INTEGER) AS b, COUNT(*) AS c FROM block_index bi INDEXED BY block_index_time
      JOIN logs l ON l.number=bi.number AND l.t0=? WHERE bi.time BETWEEN ? AND ? GROUP BY b`).all(from, bucket, buf(transferTopic), from, to);
    return { tx, transfers };
  }

  /** Network history over equally long intervals. The number of points does not grow with the chain length. The first block is not counted in times: genesis has a fixed time. */
  chartSeries(from, to, bucket) {
    return this.db.prepare(`SELECT CAST((time - ?) / ? AS INTEGER) AS b, MIN(time) AS time, MIN(number) AS first, MAX(number) AS last, COUNT(*) AS blocks,
      AVG(CASE WHEN number>1 THEN solve END) AS solve, MAX(CASE WHEN number>1 THEN solve END) AS slowest, AVG(difficulty) AS difficulty, SUM(difficulty) AS work, SUM(txs) AS txs, SUM(gas) AS gas
      FROM block_index WHERE time BETWEEN ? AND ? GROUP BY b ORDER BY b`).all(from, bucket, from, to);
  }

  /** Oldest and newest time in the index. */
  indexRange() { return this.db.prepare('SELECT MIN(time) AS first, MAX(time) AS last FROM block_index WHERE number>0').get(); }
}

/** Read-only state access from another thread. WAL allows reading concurrently with the node writing. */
export class StateReader {
  constructor(path) {
    this.db = new DatabaseSync(path, { readOnly: true });
    this.kv = this.db.prepare('SELECT v FROM kv WHERE k=?');
    this.canon = this.db.prepare('SELECT hash FROM canonical WHERE number=?');
  }
  kvGet(k) { return u8(this.kv.get(k)?.v); }
  canonicalHash(number) { return u8(this.canon.get(Number(number))?.hash); }
  close() { this.db.close(); }
}

// Explorer queries run in threads so a heavy filter does not delay blocks or the network.
export const INDEX_QUERIES = ['findBlocks', 'findTxs', 'addressSummary', 'tokensOf', 'tokenEvents', 'tokenRecipients', 'minerShares', 'minerTotals', 'minerList', 'minerRank', 'activeMiners', 'logsForAddress', 'holderTransfers', 'topicSummary', 'poolMiners', 'poolMinerRank', 'poolMinerCount', 'minedSince', 'eventsBySecond', 'activity', 'chartExtra', 'chartSeries', 'indexRange'];
for (const name of INDEX_QUERIES) StateReader.prototype[name] = Store.prototype[name];

export { buf };
