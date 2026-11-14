// Simulation of a Bitcoin Core node for bridge tests. It answers with the same responses as its JSON-RPC and accepts transactions only when
// the network would accept them: inputs exist and are unspent, the witness matches the script and signatures follow the key order.
// Verifies signatures with independent code (bitcoinjs-lib and tiny-secp256k1), not the bridge code.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as bitcoinjs from 'bitcoinjs-lib';

const require = createRequire(import.meta.url);
const ecc = require('tiny-secp256k1');

const SIGHASH_ALL = 1;
const OP_DROP = 0x75;
const OP_CHECKMULTISIG = 0xae;
const hex = (b) => Buffer.from(b).toString('hex');
const sha = (b) => crypto.createHash('sha256').update(b).digest();

/** Keys and number of signatures from the custody script, with and without the recipient address. */
function parseMultisig(script) {
  let at = 0;
  if (script[0] === 0x14 && script[21] === OP_DROP) at = 22;
  const threshold = script[at] - 0x50;
  at += 1;
  const keys = [];
  while (script[at] === 0x21) {
    keys.push(script.subarray(at + 1, at + 34));
    at += 34;
  }
  if (script[at] - 0x50 !== keys.length || script[at + 1] !== OP_CHECKMULTISIG || at + 2 !== script.length) throw new Error('mandatory-script-verify-flag-failed (špatný skript)');
  return { threshold, keys };
}

export class MockBitcoin {
  constructor(network = bitcoinjs.networks.regtest) {
    this.network = network;
    this.blocks = [{ hash: hex(sha(Buffer.from('genesis'))), tx: [] }];
    this.coins = new Map();     // confirmed coins
    this.mempool = [];
    this.feerate = null;
    this.counter = 0;
    this.rpc = (method, params = []) => this.call(method, params);
  }

  get height() { return this.blocks.length - 1; }

  async call(method, params) {
    const handler = {
      getblockcount: () => this.height,
      getblockhash: ([h]) => this.blocks[h]?.hash ?? this.fail('Block height out of range'),
      getblock: ([hash]) => this.blocks.find((b) => b.hash === hash) ?? this.fail('Block not found'),
      gettxout: ([txid, vout]) => this.txout(txid, vout),
      sendrawtransaction: ([raw]) => this.accept(raw),
      scantxoutset: ([, descriptors]) => this.scan(descriptors),
      estimatesmartfee: () => (this.feerate ? { feerate: this.feerate, blocks: 3 } : { errors: ['Insufficient data or no feerate found'], blocks: 0 }),
    }[method];
    if (!handler) this.fail(`Method not found: ${method}`);
    return handler(params);
  }

  fail(message) { throw new Error(message); }

  txout(txid, vout) {
    const key = `${txid}:${vout}`;
    const coin = this.coins.get(key);
    const spent = this.mempool.some((t) => t.vin.some((i) => `${i.txid}:${i.vout}` === key));
    if (!coin || spent) return null;
    return { value: Number(coin.value) / 1e8, scriptPubKey: { hex: coin.script } };
  }

  scan(descriptors) {
    this.scans = (this.scans ?? 0) + 1;
    const scripts = new Set(descriptors.map((d) => /^raw\((.+)\)$/.exec(d)[1]));
    const unspents = [...this.coins.entries()].filter(([, c]) => scripts.has(c.script)).map(([key, c]) => {
      const [txid, vout] = key.split(':');
      return { txid, vout: Number(vout), scriptPubKey: c.script, amount: Number(c.value) / 1e8, height: c.height, coinbase: false };
    });
    return { success: true, unspents };
  }

  /** A payment from a foreign wallet to an address. */
  pay(address, sats, extra = []) {
    this.counter += 1;
    const txid = hex(sha(Buffer.from(`platba-${this.counter}`)));
    const tx = {
      txid,
      vin: [{ txid: hex(sha(Buffer.from(`zdroj-${this.counter}`))), vout: 0 }],
      vout: [{ value: Number(sats) / 1e8, n: 0, scriptPubKey: { hex: hex(bitcoinjs.address.toOutputScript(address, this.network)) } }, ...extra],
    };
    this.mempool.push(tx);
    return txid;
  }

  /** A foreign transaction with the same OP_RETURN marker as a withdrawal, but without a single coin from the custody. */
  fakeMarker(script) {
    this.counter += 1;
    this.mempool.push({ txid: hex(sha(Buffer.from(`falesna-${this.counter}`))), vin: [{ txid: hex(sha(Buffer.from(`f-${this.counter}`))), vout: 0 }], vout: [{ value: 0, n: 0, scriptPubKey: { hex: script } }] });
  }

  /** The same check as when accepting into a block, for custody inputs. */
  accept(raw) {
    const tx = bitcoinjs.Transaction.fromHex(raw);
    const txid = tx.getId();
    if (this.mempool.some((t) => t.txid === txid)) this.fail('txn-already-in-mempool');
    let total = 0n;
    tx.ins.forEach((input, index) => {
      const key = `${hex(Buffer.from(input.hash).reverse())}:${input.index}`;
      const coin = this.coins.get(key) ?? this.fail('bad-txns-inputs-missingorspent');
      if (this.mempool.some((t) => t.vin.some((i) => `${i.txid}:${i.vout}` === key))) this.fail('txn-mempool-conflict');
      total += coin.value;
      this.verifyWitness(tx, index, input.witness, coin);
    });
    const out = tx.outs.reduce((sum, o) => sum + BigInt(o.value), 0n);
    if (out > total) this.fail('bad-txns-in-belowout');
    this.mempool.push({
      txid,
      fee: total - out,
      vsize: tx.virtualSize(),
      vin: tx.ins.map((i) => ({ txid: hex(Buffer.from(i.hash).reverse()), vout: i.index })),
      vout: tx.outs.map((o, n) => ({ value: Number(o.value) / 1e8, n, scriptPubKey: { hex: hex(o.script) } })),
    });
    return txid;
  }

  verifyWitness(tx, index, witness, coin) {
    const script = witness[witness.length - 1];
    if (coin.script !== `0020${hex(sha(script))}`) this.fail('mandatory-script-verify-flag-failed (Witness program hash mismatch)');
    const { threshold, keys } = parseMultisig(script);
    const signatures = witness.slice(1, -1);
    if (witness[0].length !== 0) this.fail('mandatory-script-verify-flag-failed (Dummy CHECKMULTISIG argument must be zero)');
    if (signatures.length !== threshold) this.fail('mandatory-script-verify-flag-failed (Invalid number of signatures)');
    const digest = tx.hashForWitnessV0(index, script, Number(coin.value), SIGHASH_ALL);
    let key = 0;
    for (const signature of signatures) {
      // Strict DER parsing per BIP66, otherwise nodes reject the signature.
      const { signature: compact, hashType } = bitcoinjs.script.signature.decode(signature);
      if (hashType !== SIGHASH_ALL) this.fail('mandatory-script-verify-flag-failed (Invalid sighash type)');
      let found = false;
      while (key < keys.length && !found) {
        found = ecc.verify(digest, keys[key], compact, true);   // true: low s is mandatory
        key += 1;
      }
      if (!found) this.fail('mandatory-script-verify-flag-failed (Script evaluated without error but finished with a false/empty top stack element)');
    }
  }

  mine(n = 1) {
    for (let i = 0; i < n; i++) {
      const height = this.height + 1;
      const coinbase = { txid: hex(sha(Buffer.from(`coinbase-${height}-${this.blocks.length}-${this.counter}`))), vin: [{ coinbase: '00' }], vout: [] };
      const txs = this.mempool;
      this.mempool = [];
      for (const t of txs) {
        for (const input of t.vin) this.coins.delete(`${input.txid}:${input.vout}`);
        for (const o of t.vout) this.coins.set(`${t.txid}:${o.n}`, { value: BigInt(Math.round(o.value * 1e8)), script: o.scriptPubKey.hex, height });
      }
      this.blocks.push({ hash: hex(sha(Buffer.from(`block-${height}-${coinbase.txid}`))), height, tx: [coinbase, ...txs] });
    }
  }

  /** Chain reorganisation: the latest blocks disappear along with their transactions, as if nobody had ever included them. */
  reorg(n) {
    for (const block of this.blocks.splice(-n)) {
      for (const t of block.tx) for (const o of t.vout) this.coins.delete(`${t.txid}:${o.n}`);
    }
  }
}
