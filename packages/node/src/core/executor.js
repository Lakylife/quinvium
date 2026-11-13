// Spouštění transakcí v EVM nad stavem rodičovského bloku.
// Stavové uzly jsou adresované obsahem, proto zápis neúspěšného bloku nic nepoškodí:
// změny se navíc drží v překryvu a na disk jdou až po úspěšném provedení.
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common';
import { MerklePatriciaTrie, createMPT } from '@ethereumjs/mpt';
import { Caches, MerkleStateManager } from '@ethereumjs/statemanager';
import { createBlock } from '@ethereumjs/block';
import { paramsEVM } from '@ethereumjs/evm';
import { RLP } from '@ethereumjs/rlp';
import { Account, ValueEncoding, Address, createAddressFromString, hexToBytes, unpadBytes } from '@ethereumjs/util';
import { Bloom, createVM, encodeReceipt, runTx } from '@ethereumjs/vm';
import { CONSENSUS as C, GENESIS_RULES } from '../params.js';
import { blockReward } from './economics.js';
import { equal, intToBytes, keccak } from '../util/bytes.js';
import { bn254, ecrecover, sha256 } from '../crypto/native.js';
import { powVerifyPrecompile } from './precompiles.js';

export const EIPS = GENESIS_RULES.eips;

const INTERNAL = Symbol('rules');

/** Konfigurace EVM pro pravidla dané výšky. */
export function makeCommon(network, rules = GENESIS_RULES) {
  const common = createCustomCommon(
    { name: `aether-${network.name}`, chainId: Number(network.chainId) },
    Mainnet,
    { hardfork: Hardfork.Shanghai, eips: [...rules.eips], customCrypto: { keccak256: keccak, ecrecover, sha256 } },
  );
  const params = structuredClone(paramsEVM);
  params[1679].blake2RoundGas = rules.blake2RoundGas;
  common[INTERNAL] = { params, rules };
  return common;
}

/** Dočasný překryv nad trvalým úložištěm stavových uzlů. */
export class Overlay {
  constructor(store) {
    this.store = store;
    this.map = new Map();
  }
  async get(key) {
    const hit = this.map.get(key);
    if (hit) return hit;
    return this.store.kvGet(Buffer.from(key, 'hex'));
  }
  async put(key, value) { this.map.set(key, value); }
  async del() { /* archivní uzel: stavové uzly se nemažou */ }
  async batch(ops) {
    for (const op of ops) if (op.type === 'put') this.map.set(op.key, op.value);
  }
  shallowCopy() { return this; }
  async open() {}
  flush() {
    if (this.map.size) this.store.kvPutMany(this.map);
    this.map = new Map();
  }
}

/**
 * Paměť čtení ze stromu účtů. Strom je adresovaný obsahem, takže stejný kořen znamená stejný výsledek.
 * Cache knihovny je vázaná na kontrolní body a po REVERT účet zapomene, tohle čtení ne.
 * Bez toho by smyčka volání končících REVERT stále znovu procházela strom.
 */
function rememberReads(trie) {
  const read = trie.get.bind(trie);
  let root = trie.root();
  let memo = new Map();
  trie.get = async (key, throwIfMissing) => {
    if (!equal(root, trie.root())) {
      root = trie.root();
      memo = new Map();
    }
    const k = Buffer.from(key).toString('latin1');
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const value = await read(key, throwIfMissing);
    memo.set(k, value);
    return value;
  };
}

export async function openState(store, common, root) {
  const db = new Overlay(store);
  const trie = new MerklePatriciaTrie({ db, useKeyHashing: true, valueEncoding: ValueEncoding.Bytes, common, cacheSize: 0 });
  // Cache žije jen po dobu jednoho bloku. Bez ní by každé volání kontraktu znovu procházelo strom.
  const caches = new Caches();
  const stateManager = new MerkleStateManager({ common, trie, prefixCodeHashes: true, caches });
  // Knihovna kvůli chybě zapisuje hodnotu do stromu při každém SSTORE, i když už je v cache
  // (`put() ?? zápis`, přitom put nic nevrací). Do stromu ji správně přenese až flush.
  stateManager.putStorage = async function putStorage(address, key, value) {
    if (key.length !== 32) throw new Error('Storage key must be 32 bytes long');
    if (value.length > 32) throw new Error('Storage value cannot be longer than 32 bytes');
    if (!(await this.getAccount(address))) throw new Error('putStorage() called on non-existing account');
    caches.storage.put(address, key, RLP.encode(unpadBytes(value)));
  };
  if (root) await stateManager.setStateRoot(root, false);
  rememberReads(trie);
  return { db, trie, stateManager };
}

/**
 * EVM pro provádění bloků i pro eth_call.
 * @param {object} [o]
 * @param {import('./pow.js').Pow} [o.pow] ověřování práce, nutné od forku `powPrecompile`
 * @param {bigint} [o.number] výška prováděného bloku
 */
export async function newVm(common, stateManager, blockchain, { pow, number } = {}) {
  const { params, rules } = common[INTERNAL];
  const evmOpts = { params };
  if (rules.powPrecompile) evmOpts.customPrecompiles = [powVerifyPrecompile(pow, number)];
  const vm = await createVM({ common, stateManager, blockchain, evmOpts });
  // createEVM volbu bn254 ignoruje a vždy nastaví pomalejší variantu, proto se mění až tady.
  vm.evm._bn254 = await bn254();
  return vm;
}

/**
 * Přehraje transakce bloku až po zadanou a vrátí, jak dopadla: chybu EVM, data revertu (z nich se pozná chyba
 * kontraktu) a spotřebovaný gas. Stav rodiče se otevře jen v paměti, do úložiště se nic nezapíše.
 */
export async function replayTx({ store, common, parent, ctx, txs, index, ancestorHash, pow, upgrades = [] }) {
  const { stateManager } = await openState(store, common, parent.stateRoot);
  for (const { address, code } of upgrades) {
    const a = createAddressFromString(address);
    await stateManager.putAccount(a, new Account(1n, (await stateManager.getAccount(a))?.balance ?? 0n));
    await stateManager.putCode(a, hexToBytes(code));
  }
  const vm = await newVm(common, stateManager, new Ancestors(ancestorHash), { pow, number: ctx.number });
  const block = contextBlock(common, ctx, parent.mixHash);
  let gasUsed = 0n;
  for (let i = 0; i < index; i++) gasUsed += (await runTx(vm, { tx: txs[i], block, blockGasUsed: gasUsed, skipHardForkValidation: true })).totalGasSpent;
  const r = await runTx(vm, { tx: txs[index], block, blockGasUsed: gasUsed, skipHardForkValidation: true });
  return { error: r.execResult.exceptionError?.error ?? null, returnValue: r.execResult.returnValue, gasUsed: r.totalGasSpent };
}

/** Kořen uspořádaného seznamu stejně jako v Ethereu: klíč je RLP indexu. */
export async function orderedRoot(values, common) {
  const t = await createMPT({ common });
  for (let i = 0; i < values.length; i++) await t.put(RLP.encode(intToBytes(BigInt(i))), values[i]);
  return t.root();
}

const BLOCK_OVERHEAD = 1024;  // rezerva na hlavičku a obálku bloku
const TX_OVERHEAD = 4;        // délka položky v seznamu RLP

export class InvalidBlock extends Error {}

/**
 * Proč pravidla odmítají transakci: nonce, prostředky, gas, poplatek, podpis, odesílatel s kódem (EIP-3607).
 * Jde o tytéž kontroly, které dělá EthereumJS v `runTx`, napsané znovu vlastním kódem. Zda blok projde, rozhoduje dál knihovna.
 * Tady se jen určí, jestli je její chyba chybou bloku, nebo uzlu (plný disk, chybějící stavový uzel). Dřív se to poznávalo
 * podle textu chyby a změna hlášky v nové verzi knihovny by uzel přiměla označit platný blok za neplatný, nebo naopak.
 * @returns {Promise<string|null>} důvod, nebo null, když transakce pravidla splňuje a chyba je na straně uzlu
 */
export async function txRejection(tx, stateManager, baseFee) {
  let sender;
  try {
    sender = tx.getSenderAddress();
  } catch {
    return 'neplatný podpis';
  }
  if (tx.value < 0n) return 'záporná hodnota';
  if (tx.gasLimit < tx.getIntrinsicGas()) return 'gas je nižší než základní cena transakce';
  const maxFee = tx.type === 2 ? tx.maxFeePerGas : tx.gasPrice;
  if (maxFee < baseFee) return 'poplatek je nižší než základní poplatek bloku';
  if (tx.type === 2 && tx.maxPriorityFeePerGas > tx.maxFeePerGas) return 'dýško je vyšší než nejvyšší poplatek';
  const account = await stateManager.getAccount(sender);
  if (account?.isContract()) return 'odesílatel je kontrakt (EIP-3607)';
  const balance = account?.balance ?? 0n;
  if (balance < tx.getUpfrontCost(baseFee) || balance < tx.value + tx.gasLimit * maxFee) return 'nedostatek prostředků';
  if ((account?.nonce ?? 0n) !== tx.nonce) return 'špatné nonce';
  return null;
}

/** Blockchain pro opcode BLOCKHASH na právě prováděné větvi. */
class Ancestors {
  constructor(lookup) { this.lookup = lookup; }
  async getBlock(n) {
    const hash = this.lookup(BigInt(n));
    return { hash: () => hash };
  }
  shallowCopy() { return this; }
}

function contextBlock(common, h, prevRandao) {
  return createBlock({
    header: {
      number: h.number, coinbase: new Address(h.miner), timestamp: h.timestamp, gasLimit: h.gasLimit,
      baseFeePerGas: h.baseFee, difficulty: 0n, mixHash: prevRandao, nonce: new Uint8Array(8),
    },
  }, { common, setHardfork: false, skipConsensusFormatValidation: true });
}

/**
 * Provede blok.
 * @param {object} o
 * @param {object} o.store úložiště
 * @param {object} o.common konfigurace EVM
 * @param {Header} o.parent rodič
 * @param {object} o.ctx pole hlavičky známá před provedením
 * @param {Iterable} o.txs transakce; v režimu build mohou být přeskočeny
 * @param {'verify'|'build'} o.mode
 * @param {(n: bigint) => Uint8Array} o.ancestorHash
 * @param {import('./pow.js').Pow} [o.pow] ověřování práce pro kontrakty
 * @param {{address: string, code: string}[]} [o.upgrades] kontrakty, které přidává fork na této výšce
 * @param {number} [o.budgetMs] jen pro režim build: časový limit na transakce šablony
 */
export async function executeBlock({ store, common, parent, ctx, txs, mode, ancestorHash, pow, upgrades = [], onSkip, budgetMs = Infinity }) {
  const { db, stateManager } = await openState(store, common, parent.stateRoot);

  // Sledujeme dotčené účty kvůli žebříčku zůstatků, včetně vnitřních převodů v kontraktech.
  const touched = new Map();
  const putAccount = stateManager.putAccount.bind(stateManager);
  stateManager.putAccount = (address, account) => {
    touched.set(address.toString(), address);
    return putAccount(address, account);
  };

  // Kontrakt z forku vznikne před první transakcí a stejně při sestavení bloku i při jeho ověření.
  for (const { address, code } of upgrades) {
    const a = createAddressFromString(address);
    await stateManager.putAccount(a, new Account(1n, (await stateManager.getAccount(a))?.balance ?? 0n));
    await stateManager.putCode(a, hexToBytes(code));
  }

  const vm = await newVm(common, stateManager, new Ancestors(ancestorHash), { pow, number: ctx.number });
  const block = contextBlock(common, ctx, parent.mixHash);

  const included = [];
  const receipts = [];
  const bloom = new Bloom(undefined, common);
  let gasUsed = 0n;
  let fees = 0n;
  let bytes = BLOCK_OVERHEAD;
  const deadline = performance.now() + budgetMs;

  for await (const tx of txs) {
    if (mode === 'build') {
      if (ctx.gasLimit - gasUsed < 21000n || performance.now() > deadline) break;
      // Nulový bajt stojí jen 4 gas, limit gasu proto velikost bloku nehlídá.
      const size = tx.serialize().length + TX_OVERHEAD;
      if (bytes + size > C.maxBlockBytes) continue;
      bytes += size;
    }
    if (gasUsed + tx.gasLimit > ctx.gasLimit) {
      if (mode === 'verify') throw new InvalidBlock('překročen limit gasu bloku');
      bytes -= mode === 'build' ? tx.serialize().length + TX_OVERHEAD : 0;
      continue;
    }
    let r;
    try {
      r = await runTx(vm, { tx, block, blockGasUsed: gasUsed, skipHardForkValidation: true });
    } catch (e) {
      if (mode === 'verify') {
        const reason = await txRejection(tx, stateManager, ctx.baseFee);
        if (reason) throw new InvalidBlock(`neplatná transakce: ${reason}`);
        throw e;
      }
      bytes -= tx.serialize().length + TX_OVERHEAD;
      onSkip?.(tx, e);
      continue;
    }
    gasUsed += r.totalGasSpent;
    fees += r.amountSpent;
    included.push(tx);
    bloom.or(r.bloom);
    receipts.push({ gasUsed: r.totalGasSpent, encoded: encodeReceipt(r.receipt, tx.type), receipt: r.receipt });
  }

  // Poplatky se nepálí. Dýško připsalo těžaři už EVM, základní poplatek dostane spolu s odměnou za blok.
  const income = blockReward(ctx.number) + gasUsed * ctx.baseFee;
  if (income > 0n) {
    const address = new Address(ctx.miner);
    const account = (await stateManager.getAccount(address)) ?? new Account();
    account.balance += income;
    await stateManager.putAccount(address, account);
  }

  await stateManager.flush();
  const stateRoot = await stateManager.getStateRoot();
  const accounts = [];
  for (const address of touched.values()) {
    const account = await stateManager.getAccount(address);
    accounts.push({ addr: address.bytes, balance: account?.balance ?? 0n, isContract: account?.isContract() ?? false });
  }
  const receiptsRoot = await orderedRoot(receipts.map((r) => r.encoded), common);
  const txRoot = await orderedRoot(included.map((t) => t.serialize()), common);
  return { db, stateRoot, receiptsRoot, txRoot, gasUsed, fees, logsBloom: bloom.bitvector, receipts, txs: included, accounts };
}

