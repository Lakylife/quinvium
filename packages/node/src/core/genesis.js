// Genesis block: deterministic, without premined coins. Only system contracts are predeployed.
import { Account, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { RLP } from '@ethereumjs/rlp';
import { CONSENSUS } from '../params.js';
import { keccak } from '../util/bytes.js';
import { Header } from './types.js';
import { openState } from './executor.js';

const ZERO32 = new Uint8Array(32);
export const EMPTY_TRIE_ROOT = keccak(RLP.encode(new Uint8Array(0)));

/**
 * @param {object} alloc adresa -> { balance?, code?, storage?: {slot: hodnota} }
 */
export async function buildGenesis(network, store, common, alloc = {}) {
  const { db, stateManager } = await openState(store, common, null);
  for (const [addr, a] of Object.entries(alloc)) {
    const address = createAddressFromString(addr);
    await stateManager.putAccount(address, new Account(a.code ? 1n : 0n, BigInt(a.balance ?? 0)));
    if (a.code) await stateManager.putCode(address, hexToBytes(a.code));
    for (const [slot, value] of Object.entries(a.storage ?? {})) {
      const v = hexToBytes(value);
      let start = 0;
      while (start < v.length && v[start] === 0) start++;
      await stateManager.putStorage(address, hexToBytes(slot), v.subarray(start));
    }
  }
  await stateManager.flush();
  const stateRoot = await stateManager.getStateRoot();
  db.flush();
  return new Header({
    parentHash: ZERO32, miner: new Uint8Array(20), stateRoot, txRoot: EMPTY_TRIE_ROOT, receiptsRoot: EMPTY_TRIE_ROOT,
    logsBloom: new Uint8Array(256), difficulty: network.genesisDifficulty, number: 0n, gasLimit: CONSENSUS.genesisGasLimit,
    gasUsed: 0n, timestamp: network.genesisTimestamp, extraData: new TextEncoder().encode(network.genesisExtra).subarray(0, CONSENSUS.maxExtraData),
    baseFee: CONSENSUS.minBaseFee, mixHash: ZERO32, nonce: new Uint8Array(8),
  });
}

