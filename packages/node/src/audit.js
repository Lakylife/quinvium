// Nezávislá kontrola celého řetězce. Nevěří ničemu, co uzel dřív spočítal: každý blok provede znovu od genesis,
// ověří práci i podpisy, přepočítá stav a sečte všechny mince. Databázi jen čte, může tedy běžet vedle uzlu.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountFromRLP } from '@ethereumjs/util';
import { Chain } from './core/chain.js';
import { emitted } from './core/economics.js';
import { openState } from './core/executor.js';
import { Block, Header } from './core/types.js';
import { equal, keccak, toHex } from './util/bytes.js';
import { loadAlloc } from './node.js';
import { L } from './lang.js';

const HASH_BYTES = 32;
const CODE_PREFIX_BYTES = 1;      // kód kontraktu je uložený pod hashem s jednobajtovou předponou
const MAX_PROBLEMS = 50;
const PROGRESS_EVERY = 1000;

const u8 = (b) => new Uint8Array(b);

/** Databáze uzlu jen pro čtení. */
class Source {
  constructor(path) {
    if (!existsSync(path)) throw new Error(L(`Databáze ${path} neexistuje.`, `The database ${path} does not exist.`));
    this.db = new DatabaseSync(path, { readOnly: true });
    this.canon = this.db.prepare('SELECT hash FROM canonical WHERE number=?');
    this.block = this.db.prepare('SELECT header, body, receipts FROM blocks WHERE hash=?');
  }

  headNumber() { return BigInt(this.db.prepare('SELECT MAX(number) AS n FROM canonical').get().n ?? 0); }
  canonicalHash(n) { const r = this.canon.get(Number(n)); return r ? u8(r.hash) : null; }
  blockByHash(hash) { return this.block.get(Buffer.from(hash)); }
  quickCheck() { return this.db.prepare('PRAGMA quick_check').all().map((r) => r.quick_check).filter((x) => x !== 'ok'); }
  stateNodes() { return this.db.prepare('SELECT k, v FROM kv').iterate(); }
  accounts() { return this.db.prepare('SELECT addr, balance_hex FROM accounts').iterate(); }
  close() { this.db.close(); }
}

/** Stavové uzly jsou adresované obsahem: klíč je hash hodnoty. Změna jediného bajtu se tím prozradí bez spuštění čehokoli. */
function checkStateNodes(source, problems) {
  let nodes = 0;
  for (const { k, v } of source.stateNodes()) {
    nodes += 1;
    const key = u8(k);
    const hash = key.length === HASH_BYTES + CODE_PREFIX_BYTES ? key.subarray(CODE_PREFIX_BYTES) : key;
    if (!equal(hash, keccak(u8(v)))) problems.push(L(`stavový uzel ${toHex(key)} nesouhlasí se svým hashem, někdo změnil zůstatek nebo kód`, `state node ${toHex(key)} does not match its hash, someone changed a balance or code`));
  }
  return nodes;
}

/** Sečte zůstatky přímo ze stromu účtů, ne z pomocného rejstříku. */
async function sumBalances(store, common, root) {
  const { trie } = await openState(store, common, root);
  let accounts = 0;
  let total = 0n;
  await trie.walkAllValueNodes(async (node) => {
    const account = createAccountFromRLP(node.value());
    accounts += 1;
    total += account.balance;
  });
  return { accounts, total };
}

/**
 * @param {object} o
 * @param {object} o.network parametry sítě
 * @param {string} o.dataDir složka dat uzlu
 * @param {string} [o.powDir] cache Ethash, výchozí je ta vedle dat
 * @param {object} [o.alloc] genesis, výchozí systémové kontrakty
 * @param {boolean} [o.quick] jen rychlé kontroly bez nového provedení bloků
 * @param {(done: bigint, total: bigint) => void} [o.onProgress]
 * @returns {Promise<{ok: boolean, height: string, blocks: number, transactions: number, stateNodes: number, accounts?: number, supply?: bigint, emitted: bigint, burned?: bigint, problems: string[]}>}
 */
export async function auditChain({ network, dataDir, powDir, alloc = loadAlloc(), quick = false, onProgress = () => {}, now }) {
  const source = new Source(join(dataDir, 'chain.db'));
  const problems = [];
  const report = { ok: false, height: '0', blocks: 0, transactions: 0, stateNodes: 0, emitted: 0n, problems };
  const stop = () => problems.length >= MAX_PROBLEMS;
  const tmp = mkdtempSync(join(tmpdir(), 'aether-audit-'));
  let fresh;
  try {
    for (const issue of source.quickCheck()) problems.push(`${L('soubor databáze je poškozený', 'the database file is damaged')}: ${issue}`);
    report.stateNodes = checkStateNodes(source, problems);
    const height = source.headNumber();
    report.height = height.toString();
    report.emitted = emitted(height);
    if (quick) { report.ok = problems.length === 0; return report; }

    fresh = await Chain.open({ network, dataDir: tmp, powDir: powDir ?? join(dataDir, 'ethash'), alloc, now });
    const genesis = source.canonicalHash(0n);
    if (!genesis || !equal(genesis, fresh.genesis.hash())) problems.push(L('genesis v databázi neodpovídá této síti', 'the genesis in the database does not match this network'));
    for (const [number, hash] of fresh.checkpoints) {
      const stored = source.canonicalHash(number);
      if (stored && !equal(stored, hash)) problems.push(L(`blok ${number} neodpovídá kontrolnímu bodu`, `block ${number} does not match the checkpoint`));
    }

    for (let n = 1n; n <= height && !stop(); n += 1n) {
      const hash = source.canonicalHash(n);
      const row = hash && source.blockByHash(hash);
      if (!row) { problems.push(L(`blok ${n} v databázi chybí`, `block ${n} is missing from the database`)); break; }
      const header = Header.decode(u8(row.header));
      if (!equal(header.hash(), hash)) { problems.push(L(`hlavička bloku ${n} byla změněna: její hash nesouhlasí`, `the header of block ${n} was changed: its hash does not match`)); break; }
      let block;
      try {
        block = Block.decodeBody(header, u8(row.body), fresh.commonAt);
      } catch (e) {
        problems.push(`${L(`tělo bloku ${n} nejde přečíst`, `the body of block ${n} cannot be read`)}: ${e.message}`);
        break;
      }
      try {
        const r = await fresh.insertBlock(block);
        if (r.status !== 'added') { problems.push(L(`blok ${n} nenavazuje na předchozí (${r.status})`, `block ${n} does not follow the previous one (${r.status})`)); break; }
      } catch (e) {
        problems.push(`${L(`blok ${n} neprošel kontrolou`, `block ${n} failed validation`)}: ${e.message}`);
        break;
      }
      const redone = fresh.store.blockGet(hash);
      if (!equal(redone.receipts, u8(row.receipts ?? new Uint8Array()))) problems.push(L(`účtenky bloku ${n} v databázi nesouhlasí s provedením`, `the receipts of block ${n} in the database do not match the execution`));
      report.blocks += 1;
      report.transactions += block.txs.length;
      if (n % BigInt(PROGRESS_EVERY) === 0n) onProgress(n, height);
    }

    if (fresh.head.number === height) {
      const opening = Object.values(alloc).reduce((sum, a) => sum + BigInt(a.balance ?? 0), 0n);
      const { accounts, total } = await sumBalances(fresh.store, fresh.common, fresh.head.stateRoot);
      report.accounts = accounts;
      report.supply = total;
      const limit = report.emitted + opening;
      report.burned = limit - total;
      // Mince smí zaniknout (SELFDESTRUCT na sebe sama), vzniknout mimo odměnu za blok nikdy.
      if (total > limit) problems.push(L(`v řetězci je ${total} jednotek, smělo jich vzniknout jen ${limit}`, `the chain holds ${total} units, only ${limit} were allowed to exist`));
      // Běžící uzel mezitím mohl přidat blok. Rejstřík pak odpovídá novější výšce a porovnání by nic neříkalo.
      const state = await fresh.stateAt(fresh.head.stateRoot);
      const wrong = [];
      for (const { addr, balance_hex: hex } of source.accounts()) {
        const account = await state.getAccountByBytes(u8(addr));
        if ((account?.balance ?? 0n) !== BigInt(`0x${hex}`)) wrong.push(`rejstřík zůstatků lže u adresy ${toHex(u8(addr))}`);
        if (wrong.length >= MAX_PROBLEMS) break;
      }
      if (source.headNumber() === height) problems.push(...wrong);
    }
    report.ok = problems.length === 0;
    return report;
  } finally {
    await fresh?.close().catch(() => {});
    source.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
