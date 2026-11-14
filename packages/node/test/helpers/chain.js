// Test helpers: real Ethash mining at difficulty 1 and a controlled clock.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createFeeMarket1559Tx, createLegacyTx } from '@ethereumjs/tx';
import { privateToAddress, randomBytes } from '@ethereumjs/util';
import { Chain } from '../../src/core/chain.js';
import { Header, Block } from '../../src/core/types.js';
import { Mempool } from '../../src/core/mempool.js';
import { NETWORKS, GWEI } from '../../src/params.js';
import { targetForDifficulty, bytesToBigInt } from '../../src/crypto/ethash.js';

export const POW_DIR = join(tmpdir(), 'aether-test-ethash');

export async function newChain({ alloc, network = NETWORKS.dev, dataDir = ':memory:' } = {}) {
  let clock = Number(network.genesisTimestamp);
  const chain = await Chain.open({ network, dataDir, powDir: POW_DIR, alloc, now: () => clock });
  chain.tick = (s = 15) => { clock += s; return clock; };
  chain.setClock = (t) => { clock = t; };
  chain.mempool = new Mempool(chain);
  return chain;
}

export const tmpData = () => mkdtempSync(join(tmpdir(), 'aether-test-'));

export function wallet() {
  const key = randomBytes(32);
  return { key, address: privateToAddress(key) };
}

/** Searches for a valid nonce and returns the finished block. */
export async function seal(chain, block) {
  const h = block.header;
  const target = targetForDifficulty(h.difficulty);
  for (let n = 0n; ; n++) {
    const nonce = new Uint8Array(Buffer.from(n.toString(16).padStart(16, '0'), 'hex'));
    const { mixDigest, result } = await chain.pow.compute(h.sealHash(), nonce, h.number);
    if (bytesToBigInt(result) <= target) {
      const f = Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('_')));
      return new Block(new Header({ ...f, mixHash: mixDigest, nonce }), block.txs);
    }
  }
}

export async function mine(chain, { miner = new Uint8Array(20).fill(0xaa), txs = [], mutate, step = 15 } = {}) {
  chain.tick(step);
  // No time limit: a test on a busy computer must produce the same block as on an idle one.
  let block = await chain.buildTemplate({ miner, txs, budgetMs: Infinity });
  if (mutate) block = (await mutate(block)) ?? block;
  const sealed = await seal(chain, block);
  const res = await chain.insertBlock(sealed);
  return { block: sealed, res };
}

export async function mineMany(chain, n, opts) {
  let last;
  for (let i = 0; i < n; i++) last = await mine(chain, opts);
  return last;
}

export function transfer(chain, from, to, value, nonce, { fee = 2n * GWEI, tip = GWEI, gas = 21000n, data } = {}) {
  return createFeeMarket1559Tx({
    chainId: chain.network.chainId, nonce, to, value, gasLimit: gas, maxFeePerGas: fee, maxPriorityFeePerGas: tip, data,
  }, { common: chain.common }).sign(from.key);
}

export function legacy(chain, from, to, value, nonce, { gasPrice = 2n * GWEI, gas = 21000n } = {}) {
  return createLegacyTx({ nonce, to, value, gasLimit: gas, gasPrice }, { common: chain.common }).sign(from.key);
}
