// Datové struktury bloku. Formát na drátě i v databázi je RLP.
import { RLP } from '@ethereumjs/rlp';
import { createTxFromRLP } from '@ethereumjs/tx';
import { keccak, toHex, quantity, intToBytes, bytesToInt, fixed } from '../util/bytes.js';

const EMPTY_LIST_HASH = keccak(RLP.encode([]));

export class Header {
  constructor(f) {
    this.parentHash = fixed(f.parentHash, 32, 'parentHash');
    this.miner = fixed(f.miner, 20, 'miner');
    this.stateRoot = fixed(f.stateRoot, 32, 'stateRoot');
    this.txRoot = fixed(f.txRoot, 32, 'txRoot');
    this.receiptsRoot = fixed(f.receiptsRoot, 32, 'receiptsRoot');
    this.logsBloom = fixed(f.logsBloom, 256, 'logsBloom');
    this.difficulty = BigInt(f.difficulty);
    this.number = BigInt(f.number);
    this.gasLimit = BigInt(f.gasLimit);
    this.gasUsed = BigInt(f.gasUsed);
    this.timestamp = BigInt(f.timestamp);
    this.extraData = f.extraData;
    this.baseFee = BigInt(f.baseFee);
    this.mixHash = fixed(f.mixHash, 32, 'mixHash');
    this.nonce = fixed(f.nonce, 8, 'nonce');
    this._hash = null;
    this._sealHash = null;
  }

  sealFields() {
    return [
      this.parentHash, this.miner, this.stateRoot, this.txRoot, this.receiptsRoot, this.logsBloom,
      intToBytes(this.difficulty), intToBytes(this.number), intToBytes(this.gasLimit), intToBytes(this.gasUsed),
      intToBytes(this.timestamp), this.extraData, intToBytes(this.baseFee),
    ];
  }

  fields() { return [...this.sealFields(), this.mixHash, this.nonce]; }
  encode() { return RLP.encode(this.fields()); }

  /** Hash hlavičky bez mixHash a nonce: tohle dostává miner jako práci. */
  sealHash() { return (this._sealHash ??= keccak(RLP.encode(this.sealFields()))); }
  hash() { return (this._hash ??= keccak(this.encode())); }

  static fromFields(v) {
    if (!Array.isArray(v) || v.length !== 15) throw new Error('hlavička má špatný počet polí');
    const [parentHash, miner, stateRoot, txRoot, receiptsRoot, logsBloom, difficulty, number, gasLimit, gasUsed,
      timestamp, extraData, baseFee, mixHash, nonce] = v;
    for (const x of v) if (!(x instanceof Uint8Array)) throw new Error('hlavička obsahuje vnořený seznam');
    return new Header({
      parentHash, miner, stateRoot, txRoot, receiptsRoot, logsBloom, extraData, mixHash, nonce,
      difficulty: bytesToInt(difficulty), number: bytesToInt(number), gasLimit: bytesToInt(gasLimit),
      gasUsed: bytesToInt(gasUsed), timestamp: bytesToInt(timestamp), baseFee: bytesToInt(baseFee),
    });
  }

  static decode(bytes) { return Header.fromFields(RLP.decode(bytes)); }

  toRpc(extra = {}) {
    return {
      number: quantity(this.number), hash: toHex(this.hash()), parentHash: toHex(this.parentHash),
      nonce: toHex(this.nonce), mixHash: toHex(this.mixHash), sha3Uncles: toHex(EMPTY_LIST_HASH),
      logsBloom: toHex(this.logsBloom), transactionsRoot: toHex(this.txRoot), stateRoot: toHex(this.stateRoot),
      receiptsRoot: toHex(this.receiptsRoot), miner: toHex(this.miner), difficulty: quantity(this.difficulty),
      extraData: toHex(this.extraData), gasLimit: quantity(this.gasLimit), gasUsed: quantity(this.gasUsed),
      timestamp: quantity(this.timestamp), baseFeePerGas: quantity(this.baseFee), uncles: [], ...extra,
    };
  }
}

export class Block {
  constructor(header, txs) {
    this.header = header;
    this.txs = txs;
  }

  hash() { return this.header.hash(); }
  bodyFields() { return this.txs.map((t) => t.serialize()); }
  encodeBody() { return RLP.encode(this.bodyFields()); }
  encode() { return RLP.encode([this.header.fields(), this.bodyFields()]); }

  /** @param {object|((number: bigint) => object)} common konfigurace, nebo funkce vracející ji podle výšky */
  static fromParts(header, rawTxs, common) {
    if (!Array.isArray(rawTxs)) throw new Error('tělo bloku není seznam');
    const c = typeof common === 'function' ? common(header.number) : common;
    return new Block(header, rawTxs.map((r) => decodeTx(r, c)));
  }

  static decodeBody(header, bytes, common) { return Block.fromParts(header, RLP.decode(bytes), common); }

  static decode(bytes, common) {
    const v = RLP.decode(bytes);
    if (!Array.isArray(v) || v.length !== 2) throw new Error('blok má špatný formát');
    return Block.fromParts(Header.fromFields(v[0]), v[1], common);
  }
}

export function decodeTx(raw, common) {
  if (!(raw instanceof Uint8Array)) throw new Error('transakce není bajtový řetězec');
  const tx = createTxFromRLP(raw, { common });
  if (tx.type > 2) throw new Error(`typ transakce ${tx.type} není podporován`);
  return tx;
}
