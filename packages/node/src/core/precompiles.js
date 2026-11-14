// Built-in functions of the Quinvium network. Proof-of-work verification from a contract enables a pool that does not have to trust its operator:
// the chain itself counts miners' work, so nobody can add to it or take from it. The result must be the same on all nodes.
import { EVMError } from '@ethereumjs/evm';
import { createAddressFromString } from '@ethereumjs/util';
import { bytesToBigInt, epochOf } from '../crypto/ethash.js';
import { equal, intToBytes } from '../util/bytes.js';
import { Header } from './types.js';

export const POW_VERIFY_ADDRESS = '0x0000000000000000000000000000000000000100';
export const POW_VERIFY_GAS = 100_000n;   // verification takes about 6 ms, so a full block of such calls does not slow down even an old CPU
const MAX_INPUT = 2048;
const WORDS = 7;
const TWO_256 = 1n << 256n;

const word = (value) => {
  const out = new Uint8Array(32);
  const bytes = typeof value === 'bigint' ? intToBytes(value) : value;
  out.set(bytes, 32 - bytes.length);
  return out;
};

const rejected = { executionGasUsed: POW_VERIFY_GAS, returnValue: new Uint8Array(0) };

/**
 * The input is the RLP of a whole header including mixHash and nonce. The output is seven 32-byte words:
 * miner, height, parent, difficulty, work done, extraData left-aligned and the header hash.
 * Invalid input returns empty and costs the same; the contract decides everything else.
 * A node error (for example a full disk) is deliberately not caught: it does not make the block invalid.
 * @param {import('./pow.js').Pow} pow
 * @param {bigint} blockNumber height of the block being executed
 */
export function powVerifyPrecompile(pow, blockNumber) {
  const run = async ({ data, gasLimit }) => {
    if (gasLimit < POW_VERIFY_GAS) {
      return { executionGasUsed: gasLimit, returnValue: new Uint8Array(0), exceptionError: new EVMError(EVMError.errorMessages.OUT_OF_GAS) };
    }
    if (data.length > MAX_INPUT) return rejected;
    let header;
    try {
      header = Header.decode(data);
    } catch {
      return rejected;
    }
    const { number, difficulty, extraData } = header;
    if (number < 1n || number > blockNumber || difficulty < 1n || difficulty >= TWO_256 || extraData.length > 32) return rejected;
    // The cache of another epoch would take seconds to compute and every node would pay for it, so only the current and previous ones.
    if (epochOf(number) + 1 < epochOf(blockNumber)) return rejected;
    const { mixDigest, result } = await pow.compute(header.sealHash(), header.nonce, number);
    if (!equal(mixDigest, header.mixHash)) return rejected;
    const value = bytesToBigInt(result);
    const work = value === 0n ? TWO_256 - 1n : TWO_256 / (value + 1n);
    const extra = new Uint8Array(32);
    extra.set(extraData);
    const out = new Uint8Array(32 * WORDS);
    [word(header.miner), word(number), header.parentHash, word(difficulty), word(work), extra, header.hash()].forEach((w, i) => out.set(w, i * 32));
    return { executionGasUsed: POW_VERIFY_GAS, returnValue: out };
  };
  return { address: createAddressFromString(POW_VERIFY_ADDRESS), function: run };
}
