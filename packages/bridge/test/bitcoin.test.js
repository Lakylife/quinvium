// The bridge's Bitcoin computations against the independent bitcoinjs-lib library: whatever differed, the network would reject or coins would be lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as bitcoinjs from 'bitcoinjs-lib';
import {
  addressScript, custodyScript, dataOutput, decodeSegwit, encodeSegwit, multisigWitness, parseTx, publicKey, scriptAddress, scriptOutput, serializeTx, sighash, signInput,
  txidOf, verifyInput, virtualSize,
} from '../src/bitcoin.js';
import { MockBitcoin } from './helpers/mock-bitcoin.js';

bitcoinjs.initEccLib(createRequire(import.meta.url)('tiny-secp256k1'));

const keys = Array.from({ length: 3 }, () => `0x${crypto.randomBytes(32).toString('hex')}`);
const pubkeys = keys.map(publicKey);
const RECIPIENT = '0x2546BcD3c84621e976D8185a91A922aE77ECEc30';

test('the custody address matches an independent computation on all networks', () => {
  for (const [name, network] of [['mainnet', bitcoinjs.networks.bitcoin], ['testnet', bitcoinjs.networks.testnet], ['regtest', bitcoinjs.networks.regtest]]) {
    for (const recipient of [undefined, RECIPIENT]) {
      const script = custodyScript(pubkeys, 2, recipient);
      const other = bitcoinjs.payments.p2wsh({ redeem: { output: script, network }, network });
      assert.equal(scriptAddress(script, name), other.address);
      assert.equal(scriptOutput(script).toString('hex'), other.output.toString('hex'));
      assert.deepEqual(addressScript(other.address, name), other.output);
    }
  }
});

test('the recipient address changes the deposit address and the key order does not', () => {
  const a = scriptAddress(custodyScript(pubkeys, 2, RECIPIENT), 'regtest');
  assert.equal(a, scriptAddress(custodyScript([...pubkeys].reverse(), 2, RECIPIENT), 'regtest'));
  assert.notEqual(a, scriptAddress(custodyScript(pubkeys, 2, '0x951D3a43D7F6D55Ab52f0e193504217994aA6Ab3'), 'regtest'));
  assert.notEqual(a, scriptAddress(custodyScript(pubkeys, 2), 'regtest'));
  assert.notEqual(a, scriptAddress(custodyScript(pubkeys, 3, RECIPIENT), 'regtest'));
});

test('all kinds of recipient addresses give the same script as bitcoinjs-lib', () => {
  const hash = crypto.randomBytes(20);
  // A taproot address must be a point on the curve, otherwise bitcoinjs-lib rejects it, hence a real key instead of random bytes.
  const program = publicKey(keys[0]).subarray(1);
  const net = bitcoinjs.networks.bitcoin;
  const cases = [
    bitcoinjs.address.toBase58Check(hash, net.pubKeyHash),
    bitcoinjs.address.toBase58Check(hash, net.scriptHash),
    bitcoinjs.address.toBech32(hash, 0, net.bech32),
    bitcoinjs.address.toBech32(program, 0, net.bech32),
    bitcoinjs.address.toBech32(program, 1, net.bech32),
  ];
  for (const address of cases) assert.equal(addressScript(address, 'mainnet').toString('hex'), bitcoinjs.address.toOutputScript(address, net).toString('hex'), address);
});

test('neither an invalid address nor an address from another network passes', () => {
  const good = bitcoinjs.address.toBech32(crypto.randomBytes(20), 0, 'bc');
  // upper-case one letter of the data part (digits have no case, so a fixed slice could stay unchanged)
  const at = [...good].findIndex((ch, i) => i > 3 && /[a-z]/.test(ch));
  const mixed = good.slice(0, at) + good[at].toUpperCase() + good.slice(at + 1);
  const flipped = good.slice(0, -1) + (good.endsWith('q') ? 'p' : 'q');
  for (const bad of [flipped, mixed, 'bc1', '', '1BoatSLRHtKNngkdXEeobR76b53LETtpyX', 'tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', '0x2546BcD3c84621e976D8185a91A922aE77ECEc30']) {
    assert.throws(() => addressScript(bad, 'mainnet'), undefined, bad);
  }
  assert.throws(() => addressScript(bitcoinjs.address.toBech32(crypto.randomBytes(20), 0, 'tb'), 'mainnet'));
  assert.throws(() => decodeSegwit('bc', encodeSegwit('bc', 1, crypto.randomBytes(20)).slice(0, -2)));
  // version 0 must be bech32: the same data in bech32m must not be accepted
  assert.throws(() => decodeSegwit('bc', encodeSegwit('bc', 1, crypto.randomBytes(32)).replace('bc1p', 'bc1q')));
});

const sampleTx = () => ({
  version: 2,
  locktime: 0,
  inputs: [{ txid: crypto.randomBytes(32).toString('hex'), vout: 1 }, { txid: crypto.randomBytes(32).toString('hex'), vout: 0 }],
  outputs: [{ value: 1_234_567n, script: addressScript(bitcoinjs.address.toBech32(crypto.randomBytes(20), 0, 'bcrt'), 'regtest') }, { value: 0n, script: dataOutput(crypto.randomBytes(32)) }, { value: 42n, script: scriptOutput(custodyScript(pubkeys, 2)) }],
});

test('transactions: serialisation, ID and signing hash match bitcoinjs-lib', () => {
  const tx = sampleTx();
  const raw = serializeTx(tx);
  const other = bitcoinjs.Transaction.fromBuffer(raw);
  assert.equal(other.getId(), txidOf(tx));
  assert.equal(other.toHex(), raw.toString('hex'));
  const script = custodyScript(pubkeys, 2, RECIPIENT);
  for (const index of [0, 1]) {
    assert.deepEqual(sighash(tx, index, script, 5_000_000n), other.hashForWitnessV0(index, script, 5_000_000, bitcoinjs.Transaction.SIGHASH_ALL));
  }
  const parsed = parseTx(raw);
  assert.equal(txidOf(parsed), txidOf(tx));
  assert.deepEqual(parsed.outputs.map((o) => o.value), tx.outputs.map((o) => o.value));
});

test('a truncated proposal or extra data is rejected', () => {
  const raw = serializeTx(sampleTx());
  assert.throws(() => parseTx(raw.subarray(0, raw.length - 1)));
  assert.throws(() => parseTx(Buffer.concat([raw, Buffer.from([0])])));
});

test('a signed transaction passes the signature checks and its size matches', async () => {
  const node = new MockBitcoin();
  const script = custodyScript(pubkeys, 2, RECIPIENT);
  const txid = node.pay(scriptAddress(script, 'regtest'), 700_000n);
  node.mine();
  const tx = { version: 2, locktime: 0, inputs: [{ txid, vout: 0 }], outputs: [{ value: 690_000n, script: scriptOutput(custodyScript(pubkeys, 2)) }] };
  const signatures = new Map(keys.slice(0, 2).map((k) => [publicKey(k).toString('hex'), signInput(tx, 0, script, 700_000n, k)]));
  for (const [k, s] of signatures) assert.ok(verifyInput(tx, 0, script, 700_000n, Buffer.from(k, 'hex'), s));
  assert.equal(verifyInput(tx, 0, script, 700_001n, publicKey(keys[0]), signatures.get(publicKey(keys[0]).toString('hex'))), false, 'jiná částka');
  assert.equal(verifyInput(tx, 0, script, 700_000n, publicKey(keys[2]), signatures.get(publicKey(keys[0]).toString('hex'))), false, 'cizí klíč');
  tx.inputs[0].witness = multisigWitness(pubkeys, 2, signatures, script);
  const raw = serializeTx(tx, true);
  assert.equal(bitcoinjs.Transaction.fromBuffer(raw).virtualSize(), virtualSize(tx));
  assert.equal(await node.rpc('sendrawtransaction', [raw.toString('hex')]), txidOf(tx));
});

test('one signature is not enough and signatures in reverse order do not pass', async () => {
  const node = new MockBitcoin();
  const script = custodyScript(pubkeys, 2);
  const txid = node.pay(scriptAddress(script, 'regtest'), 700_000n);
  node.mine();
  const tx = { version: 2, locktime: 0, inputs: [{ txid, vout: 0 }], outputs: [{ value: 690_000n, script: dataOutput(Buffer.alloc(32)) }] };
  const sorted = [...pubkeys].sort(Buffer.compare).map((k) => k.toString('hex'));
  const byKey = new Map(keys.map((k) => [publicKey(k).toString('hex'), signInput(tx, 0, script, 700_000n, k)]));
  assert.throws(() => multisigWitness(pubkeys, 2, new Map([...byKey].slice(0, 1)), script), /Not enough/);
  tx.inputs[0].witness = [Buffer.alloc(0), byKey.get(sorted[1]), byKey.get(sorted[0]), script];
  await assert.rejects(node.rpc('sendrawtransaction', [serializeTx(tx, true).toString('hex')]), /mandatory-script-verify/);
  tx.inputs[0].witness = multisigWitness(pubkeys, 2, byKey, script);
  await node.rpc('sendrawtransaction', [serializeTx(tx, true).toString('hex')]);
});
