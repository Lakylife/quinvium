// Bitcoin for the bridge: addresses, scripts, transactions and signatures. The code is small and without third-party libraries, because every dependency
// is more code entrusted with custody of coins. Tests compare it with the independent bitcoinjs-lib library.
import crypto from 'node:crypto';
import { SigningKey } from 'ethers';

export const NETWORKS = {
  mainnet: { hrp: 'bc', p2pkh: 0x00, p2sh: 0x05 },
  testnet: { hrp: 'tb', p2pkh: 0x6f, p2sh: 0xc4 },
  regtest: { hrp: 'bcrt', p2pkh: 0x6f, p2sh: 0xc4 },
};

const OP_0 = 0x00;
const OP_1 = 0x51;
const OP_RETURN = 0x6a;
const OP_DUP = 0x76;
const OP_DROP = 0x75;
const OP_EQUAL = 0x87;
const OP_EQUALVERIFY = 0x88;
const OP_HASH160 = 0xa9;
const OP_CHECKSIG = 0xac;
const OP_CHECKMULTISIG = 0xae;
const SIGHASH_ALL = 1;
const SEQUENCE_FINAL = 0xffffffff;
const MAX_KEYS = 15;    // OP_1 to OP_16; the number of keys and signatures must fit into one operation byte
const ADDRESS_PUSH = 20;

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const hash256 = (data) => sha256(sha256(data));
const smallInt = (n) => OP_1 + n - 1;

// ---- bech32 a bech32m (BIP173, BIP350) ---------------------------------------------------------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32 = 1;
const BECH32M = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    GENERATOR.forEach((g, i) => { if ((top >>> i) & 1) chk = (chk ^ g) >>> 0; });
  }
  return chk;
}

const expandHrp = (hrp) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    if (value >> from) throw new Error('Neplatná hodnota adresy');
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || (acc << (to - bits)) & max) {
    throw new Error('Neplatné doplnění adresy');
  }
  return out;
}

export function encodeSegwit(hrp, version, program) {
  const data = [version, ...convertBits(program, 8, 5, true)];
  const constant = version === 0 ? BECH32 : BECH32M;
  const mod = polymod([...expandHrp(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ constant;
  const check = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...check].map((d) => CHARSET[d]).join('')}`;
}

export function decodeSegwit(hrp, address) {
  if (address.length > 90 || (address !== address.toLowerCase() && address !== address.toUpperCase())) throw new Error('Neplatná adresa');
  const text = address.toLowerCase();
  const split = text.lastIndexOf('1');
  if (split < 1 || text.slice(0, split) !== hrp || text.length - split < 7) throw new Error('Adresa patří jiné síti');
  const values = [...text.slice(split + 1)].map((c) => CHARSET.indexOf(c));
  if (values.includes(-1)) throw new Error('Neplatný znak v adrese');
  const constant = polymod([...expandHrp(hrp), ...values]);
  const version = values[0];
  if (version > 16 || constant !== (version === 0 ? BECH32 : BECH32M)) throw new Error('Neplatný kontrolní součet adresy');
  const program = Buffer.from(convertBits(values.slice(1, -6), 5, 8, false));
  if (program.length < 2 || program.length > 40 || (version === 0 && program.length !== 20 && program.length !== 32)) throw new Error('Neplatná délka adresy');
  return { version, program };
}

// ---- base58 for legacy addresses ------------------------------------------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58Check(address) {
  let n = 0n;
  for (const c of address) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) throw new Error('Neplatný znak v adrese');
    n = n * 58n + BigInt(digit);
  }
  const hex = n.toString(16);
  const body = Buffer.from(hex.padStart(hex.length + (hex.length % 2), '0'), 'hex');
  const zeros = /^1*/.exec(address)[0].length;
  const all = Buffer.concat([Buffer.alloc(zeros), body]);
  if (all.length !== 25 || !hash256(all.subarray(0, 21)).subarray(0, 4).equals(all.subarray(21))) throw new Error('Neplatný kontrolní součet adresy');
  return { version: all[0], hash: all.subarray(1, 21) };
}

/** @returns {Buffer} output script for an address of the given network; an invalid address or another network throws */
export function addressScript(address, networkName) {
  const net = NETWORKS[networkName];
  if (!net) throw new Error('Neznámá síť Bitcoinu');
  if (address.toLowerCase().startsWith(`${net.hrp}1`)) {
    const { version, program } = decodeSegwit(net.hrp, address);
    return Buffer.from([version === 0 ? OP_0 : OP_1 + version - 1, program.length, ...program]);
  }
  const { version, hash } = decodeBase58Check(address);
  if (version === net.p2pkh) return Buffer.from([OP_DUP, OP_HASH160, ADDRESS_PUSH, ...hash, OP_EQUALVERIFY, OP_CHECKSIG]);
  if (version === net.p2sh) return Buffer.from([OP_HASH160, ADDRESS_PUSH, ...hash, OP_EQUAL]);
  throw new Error('Adresa patří jiné síti');
}

// ---- escrow --------------------------------------------------------------------------------------

/** The order of keys is given by their value, so all validators compute the same address. */
const sortedKeys = (pubkeys) => pubkeys.map((k) => Buffer.from(k)).sort(Buffer.compare);

/**
 * Custody script: `threshold` of the validators' keys. With a recipient given it is the deposit script: the recipient's address is
 * inside the script, so each recipient has their own deposit address and can be paid from any wallet or exchange.
 * @param {Buffer[]} pubkeys compressed public keys
 * @param {string} [recipient] adresa na Quinviu `0x…`
 */
export function custodyScript(pubkeys, threshold, recipient) {
  const keys = sortedKeys(pubkeys);
  if (keys.length > MAX_KEYS || threshold < 1 || threshold > keys.length) throw new Error('Neplatné nastavení úschovy');
  const prefix = recipient ? [ADDRESS_PUSH, ...Buffer.from(recipient.slice(2), 'hex'), OP_DROP] : [];
  return Buffer.from([...prefix, smallInt(threshold), ...keys.flatMap((k) => [k.length, ...k]), smallInt(keys.length), OP_CHECKMULTISIG]);
}

export const scriptOutput = (witnessScript) => Buffer.from([OP_0, 32, ...sha256(witnessScript)]);
export const scriptAddress = (witnessScript, networkName) => encodeSegwit(NETWORKS[networkName].hrp, 0, sha256(witnessScript));
export const dataOutput = (data) => Buffer.from([OP_RETURN, data.length, ...data]);

/** The validator's public key for custody. */
export const publicKey = (privateKey) => Buffer.from(SigningKey.computePublicKey(privateKey, true).slice(2), 'hex');

// ---- transakce ---------------------------------------------------------------------------------------

function varint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  const out = Buffer.alloc(n <= 0xffff ? 3 : 5);
  out[0] = n <= 0xffff ? 0xfd : 0xfe;
  if (n <= 0xffff) out.writeUInt16LE(n, 1);
  else out.writeUInt32LE(n, 1);
  return out;
}

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const sized = (data) => Buffer.concat([varint(data.length), data]);
const outpoint = (input) => Buffer.concat([Buffer.from(input.txid, 'hex').reverse(), u32(input.vout)]);
const encodeOutput = (o) => Buffer.concat([u64(o.value), sized(o.script)]);

/**
 * @typedef {{ txid: string, vout: number, sequence?: number, witness?: Buffer[] }} Input
 * @typedef {{ value: bigint, script: Buffer }} Output
 * @typedef {{ version: number, locktime: number, inputs: Input[], outputs: Output[] }} Tx
 */

/** Transaction serialisation, with `witness` including witnesses. The transaction ID is computed without them. */
export function serializeTx(tx, witness = false) {
  const parts = [u32(tx.version)];
  if (witness) parts.push(Buffer.from([0, 1]));
  parts.push(varint(tx.inputs.length));
  for (const i of tx.inputs) parts.push(outpoint(i), varint(0), u32(i.sequence ?? SEQUENCE_FINAL));
  parts.push(varint(tx.outputs.length), ...tx.outputs.map(encodeOutput));
  if (witness) {
    for (const i of tx.inputs) {
      const items = i.witness ?? [];
      parts.push(varint(items.length), ...items.map(sized));
    }
  }
  parts.push(u32(tx.locktime));
  return Buffer.concat(parts);
}

/** Reads a transaction without witnesses that carries payment proposals between validators. Surplus data is rejected. */
export function parseTx(raw) {
  let at = 0;
  const take = (n) => {
    if (at + n > raw.length) throw new Error('Transakce je zkrácená');
    at += n;
    return raw.subarray(at - n, at);
  };
  const readVarint = () => {
    const first = take(1)[0];
    if (first < 0xfd) return first;
    if (first === 0xfd) return take(2).readUInt16LE();
    if (first === 0xfe) return take(4).readUInt32LE();
    throw new Error('Transakce je příliš dlouhá');
  };
  const version = take(4).readUInt32LE();
  const inputs = Array.from({ length: readVarint() }, () => {
    const txid = Buffer.from(take(32)).reverse().toString('hex');
    const vout = take(4).readUInt32LE();
    if (readVarint() !== 0) throw new Error('Vstup úschovy nemá mít scriptSig');
    return { txid, vout, sequence: take(4).readUInt32LE() };
  });
  const outputs = Array.from({ length: readVarint() }, () => {
    const value = take(8).readBigUInt64LE();
    return { value, script: Buffer.from(take(readVarint())) };
  });
  const locktime = take(4).readUInt32LE();
  if (at !== raw.length) throw new Error('Za transakcí jsou další data');
  return { version, locktime, inputs, outputs };
}

export const txidOf = (tx) => Buffer.from(hash256(serializeTx(tx))).reverse().toString('hex');

/** Hash for signing an input per BIP143, SIGHASH_ALL: the signature covers all inputs and outputs and the input amount. */
export function sighash(tx, index, witnessScript, value) {
  const input = tx.inputs[index];
  return hash256(Buffer.concat([
    u32(tx.version),
    hash256(Buffer.concat(tx.inputs.map(outpoint))),
    hash256(Buffer.concat(tx.inputs.map((i) => u32(i.sequence ?? SEQUENCE_FINAL)))),
    outpoint(input),
    sized(witnessScript),
    u64(value),
    u32(input.sequence ?? SEQUENCE_FINAL),
    hash256(Buffer.concat(tx.outputs.map(encodeOutput))),
    u32(tx.locktime),
    u32(SIGHASH_ALL),
  ]));
}

function derInteger(hex) {
  let value = Buffer.from(hex.slice(2), 'hex');
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  value = value.subarray(start);
  return value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
}

/** @returns {Buffer} input signature in DER format with the SIGHASH_ALL flag */
export function signInput(tx, index, witnessScript, value, privateKey) {
  // ethers signs deterministically (RFC 6979) and with a low `s`, which Bitcoin requires.
  const { r, s } = new SigningKey(privateKey).sign(sighash(tx, index, witnessScript, value));
  const [R, S] = [derInteger(r), derInteger(s)];
  const body = Buffer.concat([Buffer.from([0x02, R.length]), R, Buffer.from([0x02, S.length]), S]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body, Buffer.from([SIGHASH_ALL])]);
}

/**
 * Witness of a custody input. OP_CHECKMULTISIG reads signatures in the same order as the keys and, because of an old bug, takes one
 * one extra item, hence the empty item at the start.
 * @param {Map<string, Buffer>} signatures signatures by public key in hex
 */
export function multisigWitness(pubkeys, threshold, signatures, witnessScript) {
  const ordered = sortedKeys(pubkeys).map((k) => signatures.get(k.toString('hex'))).filter(Boolean).slice(0, threshold);
  if (ordered.length < threshold) throw new Error('Nedostatek podpisů');
  return [Buffer.alloc(0), ...ordered, witnessScript];
}

/** Virtual size of a signed transaction for computing the fee. */
export function virtualSize(tx) {
  const base = serializeTx(tx).length;
  const total = serializeTx(tx, true).length;
  return Math.ceil((base * 3 + total) / 4);
}

function parseDer(signature) {
  const rLength = signature[3];
  const r = signature.subarray(4, 4 + rLength);
  const s = signature.subarray(6 + rLength, signature.length - 1);
  return { r: `0x${r.toString('hex').padStart(64, '0').slice(-64)}`, s: `0x${s.toString('hex').padStart(64, '0').slice(-64)}` };
}

/** Does the input signature belong to this key? Otherwise a foreign invalid signature would block building the payment. */
export function verifyInput(tx, index, witnessScript, value, pubkey, signature) {
  try {
    const digest = sighash(tx, index, witnessScript, value);
    const expected = `0x${Buffer.from(pubkey).toString('hex')}`;
    return [27, 28].some((v) => SigningKey.computePublicKey(SigningKey.recoverPublicKey(digest, { ...parseDer(signature), v }), true) === expected);
  } catch {
    return false;
  }
}
