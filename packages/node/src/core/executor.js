// Executing transactions in the EVM on top of the parent block's state.
// State nodes are content-addressed, so writing a failed block damages nothing:
// changes are also kept in an overlay and go to disk only after successful execution.
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

/** EVM configuration for the rules of the given height. */
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

/** A temporary overlay above the permanent storage of state nodes. */
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
  async del() { /* archive node: state nodes are never deleted */ }
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
 * Memory of reads from the account trie. The trie is content-addressed, so the same root means the same result.
 * The library's cache is tied to checkpoints and forgets the account after REVERT; this read does not.
 * Without it a loop of calls ending in REVERT would walk the trie again and again.
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
  // The cache lives for one block only. Without it every contract call would walk the trie again.
  const caches = new Caches();
  const stateManager = new MerkleStateManager({ common, trie, prefixCodeHashes: true, caches });
  // Because of a bug the library writes the value into the trie on every SSTORE, even when it is already in the cache
  // (`put() ?? write`, while put returns nothing). Only flush moves it into the trie correctly.
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
 * EVM for executing blocks and for eth_call.
 * @param {object} [o]
 * @param {import('./pow.js').Pow} [o.pow] proof-of-work verification, required from the `powPrecompile` fork
 * @param {bigint} [o.number] height of the block being executed
 */
export async function newVm(common, stateManager, blockchain, { pow, number } = {}) {
  const { params, rules } = common[INTERNAL];
  const evmOpts = { params };
  if (rules.powPrecompile) evmOpts.customPrecompiles = [powVerifyPrecompile(pow, number)];
  const vm = await createVM({ common, stateManager, blockchain, evmOpts });
  // createEVM ignores the bn254 option and always sets the slower variant, so it is changed only here.
  vm.evm._bn254 = await bn254();
  return vm;
}

/**
 * Replays the block's transactions up to the given one and returns how it ended: the EVM error, revert data (from which the error
 * contract) and the gas used. The parent state is opened only in memory; nothing is written to storage.
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

/** Root of an ordered list as in Ethereum: the key is the RLP of the index. */
export async function orderedRoot(values, common) {
  const t = await createMPT({ common });
  for (let i = 0; i < values.length; i++) await t.put(RLP.encode(intToBytes(BigInt(i))), values[i]);
  return t.root();
}

const BLOCK_OVERHEAD = 1024;  // reserve for the header and the block envelope
const TX_OVERHEAD = 4;        // length of an item in an RLP list

export class InvalidBlock extends Error {}

/**
 * Why the rules reject a transaction: nonce, funds, gas, fee, signature, sender with code (EIP-3607).
 * These are the same checks EthereumJS does in `runTx`, rewritten in our own code. The library still decides whether the block passes.
 * Here we only determine whether its error is an error of the block or of the node (full disk, missing state node). Previously it was recognised
 * by the error text, and a changed message in a new library version would make the node mark a valid block invalid, or the other way round.
 * @returns {Promise<string|null>} the reason, or null when the transaction meets the rules and the error is on the node's side
 */
export async function txRejection(tx, stateManager, baseFee) {
  let sender;
  try {
    sender = tx.getSenderAddress();
  } catch {
    return 'invalid signature';
  }
  if (tx.value < 0n) return 'negative value';
  if (tx.gasLimit < tx.getIntrinsicGas()) return 'intrinsic gas too low';
  const maxFee = tx.type === 2 ? tx.maxFeePerGas : tx.gasPrice;
  if (maxFee < baseFee) return 'max fee per gas is less than the block base fee';
  if (tx.type === 2 && tx.maxPriorityFeePerGas > tx.maxFeePerGas) return 'max priority fee per gas is higher than max fee per gas';
  const account = await stateManager.getAccount(sender);
  if (account?.isContract()) return 'sender is a contract (EIP-3607)';
  const balance = account?.balance ?? 0n;
  if (balance < tx.getUpfrontCost(baseFee) || balance < tx.value + tx.gasLimit * maxFee) return 'insufficient funds';
  if ((account?.nonce ?? 0n) !== tx.nonce) return 'wrong nonce';
  return null;
}

/** Blockchain for the BLOCKHASH opcode on the branch being executed. */
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
 * @param {object} o.store storage
 * @param {object} o.common konfigurace EVM
 * @param {Header} o.parent parent
 * @param {object} o.ctx header fields known before execution
 * @param {Iterable} o.txs transactions; in build mode they may be skipped
 * @param {'verify'|'build'} o.mode
 * @param {(n: bigint) => Uint8Array} o.ancestorHash
 * @param {import('./pow.js').Pow} [o.pow] proof-of-work verification for contracts
 * @param {{address: string, code: string}[]} [o.upgrades] contracts added by a fork at this height
 * @param {number} [o.budgetMs] build mode only: time limit for template transactions
 */
export async function executeBlock({ store, common, parent, ctx, txs, mode, ancestorHash, pow, upgrades = [], onSkip, budgetMs = Infinity }) {
  const { db, stateManager } = await openState(store, common, parent.stateRoot);

  // We track affected accounts for the rich list, including internal transfers in contracts.
  const touched = new Map();
  const putAccount = stateManager.putAccount.bind(stateManager);
  stateManager.putAccount = (address, account) => {
    touched.set(address.toString(), address);
    return putAccount(address, account);
  };

  // A contract from a fork is created before the first transaction, the same way when building a block and when verifying it.
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
      // A zero byte costs only 4 gas, so the gas limit does not guard block size.
      const size = tx.serialize().length + TX_OVERHEAD;
      if (bytes + size > C.maxBlockBytes) continue;
      bytes += size;
    }
    if (gasUsed + tx.gasLimit > ctx.gasLimit) {
      if (mode === 'verify') throw new InvalidBlock('block gas limit exceeded');
      bytes -= mode === 'build' ? tx.serialize().length + TX_OVERHEAD : 0;
      continue;
    }
    let r;
    try {
      r = await runTx(vm, { tx, block, blockGasUsed: gasUsed, skipHardForkValidation: true });
    } catch (e) {
      if (mode === 'verify') {
        const reason = await txRejection(tx, stateManager, ctx.baseFee);
        if (reason) throw new InvalidBlock(`invalid transaction: ${reason}`);
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

  // Fees are not burned. The EVM has already credited the tip to the miner; the base fee comes with the block reward.
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

