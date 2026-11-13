// Vestavěné funkce sítě Quinvium. Ověření Proof of Work z kontraktu umožňuje pool, který nemusí věřit provozovateli:
// práci těžařů počítá přímo řetězec, takže ji nikdo nemůže přikreslit ani ubrat. Výsledek musí být na všech uzlech stejný.
import { EVMError } from '@ethereumjs/evm';
import { createAddressFromString } from '@ethereumjs/util';
import { bytesToBigInt, epochOf } from '../crypto/ethash.js';
import { equal, intToBytes } from '../util/bytes.js';
import { Header } from './types.js';

export const POW_VERIFY_ADDRESS = '0x0000000000000000000000000000000000000100';
export const POW_VERIFY_GAS = 100_000n;   // ověření trvá asi 6 ms, plný blok takových volání tak nezdrží ani starý procesor
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
 * Vstup je RLP celé hlavičky včetně mixHash a nonce. Výstup je sedm 32bajtových slov:
 * těžař, výška, rodič, obtížnost, odvedená práce, extraData zarovnané vlevo a hash hlavičky.
 * Neplatný vstup vrátí prázdno a stojí stejně, o všem ostatním rozhoduje kontrakt.
 * Chyba uzlu (třeba plný disk) se záměrně nezachytává: blok tím neplatný není.
 * @param {import('./pow.js').Pow} pow
 * @param {bigint} blockNumber výška prováděného bloku
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
    // Cache jiné epochy by se počítala sekundy a platil by to každý uzel, proto jen aktuální a předchozí.
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
