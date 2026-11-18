// The Bitcoin side of the bridge. Bitcoin cannot run a contract, so coins are held by a multisig address of the validators:
// only `threshold` of them can spend them. This code is the part each validator runs separately.
//
// Deposit: each recipient has their own address in which their Quinvium address is encoded. After confirmation the validators
// sign the message for the gateway, which mints the bridged token.
// Withdrawal: the gateway burns the token, the proposer publishes a transaction and the others sign it only when they have verified themselves that the custody
// loses exactly the burned amount and the money goes to the user. A proposer thus cannot steal anything, only delay.
import { ethers } from 'ethers';
import {
  addressScript, custodyScript, dataOutput, multisigWitness, parseTx, publicKey, scriptAddress, scriptOutput, serializeTx, sha256, signInput, txidOf,
  verifyInput, virtualSize,
} from './bitcoin.js';
import { StateFile, queryRange } from './relayer.js';

export const BITCOIN = 0xB17C01n;
const DUST = 546n;
const MAX_INPUTS = 50;
const SCAN_BATCH = 200;
const MAX_POST = 64 * 1024;
const LOG_BATCH = 2000;
const DAY_MS = 86_400_000;
const FAKE_SIGNATURE = 72;
const SATS = 100_000_000;

const sats = (btc) => BigInt(Math.round(btc * SATS));
const nonceOf = (text) => BigInt(`0x${sha256(Buffer.from(text)).subarray(0, 8).toString('hex')}`);

export class BitcoinBridge {
  /**
   * @param {object} o
   * @param {(method: string, params?: any[]) => Promise<any>} o.rpc calls to the validator's own Bitcoin node
   * @param {'mainnet'|'testnet'|'regtest'} o.network
   * @param {import('./relayer.js').Relayer} o.relayer validator for the Quinvium side
   * @param {bigint} o.chainId the Quinvium chain
   * @param {string} o.token bridged token on Quinvium
   * @param {string} o.btcKey private key for custody, different from the validator's key in the gateway
   * @param {{ address: string, btcKey: string }[]} o.validators all validators: address in the gateway and custody public key
   * @param {number} o.threshold
   * @param {number} [o.confirmations] confirmations on Bitcoin before crediting
   * @param {bigint} [o.minDeposit] a smaller deposit is not credited; spending it would cost more than it is worth
   * @param {number} [o.maxFeeRate] highest fee in sat/vB; the validator does not sign above it
   * @param {number} [o.fallbackFeeRate] when the node has no estimate
   * @param {bigint} [o.dailyLimit] how much may leave per day, in satoshi
   * @param {number} [o.proposeTimeoutMs] after this time the proposer role moves to the next validator
   */
  constructor(o) {
    // A setting left out of the configuration file arrives as undefined; it must not overwrite the default.
    const given = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    Object.assign(this, { confirmations: 6, minDeposit: 10_000n, maxFeeRate: 200, fallbackFeeRate: 5, dailyLimit: 1_000_000_000n, proposeTimeoutMs: 600_000, log: () => {}, now: Date.now }, given);
    for (const name of ['confirmations', 'maxFeeRate', 'fallbackFeeRate', 'threshold']) {
      if (!Number.isInteger(this[name]) || this[name] < 1) throw new Error(`Bitcoin: ${name} must be a positive whole number, it is ${this[name]}`);
    }
    this.chain = this.relayer.chains.get(this.chainId);
    this.gateway = this.chain.gateway;
    this.me = this.relayer.address;
    this.validators = [...this.validators].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
    this.pubkeys = this.validators.map((v) => Buffer.from(v.btcKey.replace(/^0x/, ''), 'hex'));
    this.ownKey = publicKey(this.btcKey).toString('hex');
    if (!this.pubkeys.some((k) => k.toString('hex') === this.ownKey)) throw new Error('The custody key is not among the validators');
    this.mainScript = custodyScript(this.pubkeys, this.threshold);
    this.mainOutput = scriptOutput(this.mainScript).toString('hex');
    this.state = new StateFile(this.statePath);
    const d = this.state.data;
    d.watch ??= {};
    d.unscanned ??= [];
    d.utxos ??= {};
    d.credited ??= {};
    d.withdrawals ??= {};
    d.signed ??= {};
    d.spent ??= { day: 0, sats: 0n };
    d.spends ??= {};
    this.sent = new Set();
  }

  /** Custody address that can be topped up outside deposits. */
  get mainAddress() { return scriptAddress(this.mainScript, this.network); }

  depositAddress(recipient) { return scriptAddress(custodyScript(this.pubkeys, this.threshold, ethers.getAddress(recipient)), this.network); }

  async tick() {
    await this.syncAether();
    await this.scanBlocks();
    await this.scanRegistered();
    for (const [id, w] of Object.entries(this.state.data.withdrawals)) {
      if (w.status !== 'open') continue;
      try { await this.withdrawal(id, w); } catch (e) { this.log(`withdrawal ${id.slice(0, 10)}: ${e.shortMessage ?? e.message}`); }
    }
    this.state.save();
  }

  // ---- what happens on Quinvium ---------------------------------------------------------------------

  async syncAether() {
    const d = this.state.data;
    const safe = await this.chain.provider.getBlockNumber() - this.chain.confirmations;
    let from = d.cursor ?? this.chain.startBlock ?? 0;
    while (from <= safe) {
      const to = Math.min(from + LOG_BATCH - 1, safe);
      for (const log of await this.gateway.queryFilter('BitcoinDepositRequested', from, to)) this.watch(log.args.recipient);
      for (const log of await this.gateway.queryFilter(this.gateway.filters.Sent(null, BITCOIN), from, to)) this.acceptWithdrawal(log);
      from = to + 1;
      d.cursor = from;
      this.state.save();
    }
  }

  /** The address is watched from registration. Registration costs only gas, so it must not trigger an expensive scan by itself. */
  watch(recipient) {
    const d = this.state.data;
    const script = custodyScript(this.pubkeys, this.threshold, recipient);
    const output = scriptOutput(script).toString('hex');
    if (d.watch[output]) return;
    d.watch[output] = recipient;
    d.unscanned.push(output);
  }

  /** A payment sent before registration is found by scanning the current coins, one batch per pass. */
  async scanRegistered() {
    const d = this.state.data;
    const batch = d.unscanned.slice(0, SCAN_BATCH);
    if (!batch.length) return;
    const { unspents = [] } = await this.rpc('scantxoutset', ['start', batch.map((output) => `raw(${output})`)]);
    d.unscanned = d.unscanned.slice(batch.length);
    for (const u of unspents) {
      const recipient = d.watch[u.scriptPubKey];
      if (recipient && u.height < (d.height ?? 0) && !u.coinbase) this.deposit(u.txid, u.vout, sats(u.amount), recipient);
    }
  }

  acceptWithdrawal(log) {
    const d = this.state.data;
    const { id, token, sender, recipient, amount, nonce } = log.args;
    if (d.withdrawals[id] || token.toLowerCase() !== this.token.toLowerCase()) return;
    let address = null;
    try {
      address = ethers.toUtf8String(recipient);
      addressScript(address, this.network);
    } catch {
      // The token is burned and the address cannot be paid. The user gets the token back the same way as a deposit.
      this.relayer.enqueue({ srcChain: BITCOIN, dstChain: this.chainId, nonce: nonceOf(`refund:${id}`), srcToken: ethers.ZeroHash, recipient: sender, amount });
      d.withdrawals[id] = { nonce, sender, amount, status: 'refunded' };
      this.log(`withdrawal ${id.slice(0, 10)}: invalid address, returning the token`);
      return;
    }
    d.withdrawals[id] = { nonce, sender, address, amount, status: 'open', seenAt: this.now(), block: log.blockNumber };
  }

  // ---- what happens on Bitcoin --------------------------------------------------------------------

  async scanBlocks() {
    const d = this.state.data;
    const safe = await this.rpc('getblockcount') - this.confirmations + 1;
    d.height ??= Math.max(0, safe + 1);
    while (d.height <= safe) {
      const hash = await this.rpc('getblockhash', [d.height]);
      const block = await this.rpc('getblock', [hash, 2]);
      block.tx.forEach((tx, i) => this.scanTx(tx, i === 0));
      d.height += 1;
      this.state.save();
    }
  }

  scanTx(tx, coinbase) {
    const d = this.state.data;
    for (const input of tx.vin) {
      const key = `${input.txid}:${input.vout}`;
      if (!d.utxos[key]) continue;
      delete d.utxos[key];
      d.spends[tx.txid] = true;
    }
    for (const out of tx.vout) {
      const script = out.scriptPubKey.hex;
      const recipient = d.watch[script];
      if (recipient && !coinbase) this.deposit(tx.txid, out.n, sats(out.value), recipient);
      else if (script === this.mainOutput) d.utxos[`${tx.txid}:${out.n}`] = { value: sats(out.value), recipient: null };
    }
  }

  deposit(txid, vout, value, recipient) {
    const d = this.state.data;
    const key = `${txid}:${vout}`;
    if (d.credited[key]) return;
    d.credited[key] = true;
    d.utxos[key] = { value, recipient };
    if (value < this.minDeposit) {
      this.log(`deposit ${key} is below the minimum, not credited`);
      return;
    }
    this.relayer.enqueue({ srcChain: BITCOIN, dstChain: this.chainId, nonce: nonceOf(key), srcToken: ethers.ZeroHash, recipient, amount: value });
    this.log(`deposit ${value} sat for ${recipient}`);
  }

  // ---- withdrawal ----------------------------------------------------------------------------------------

  proposer(w) {
    const turns = BigInt(Math.floor((this.now() - w.seenAt) / this.proposeTimeoutMs));
    return this.validators[Number((w.nonce + turns) % BigInt(this.validators.length))].address;
  }

  /**
   * A withdrawal is paid when a transaction spending the custody and carrying its marker is confirmed. The marker alone can
   * anyone can imitate, but not spend the custody. Even a validator that did not sign the transaction notices it.
   */
  settled(id, w, posts) {
    for (const post of posts) {
      if (!post.tx) continue;
      try {
        const tx = parseTx(Buffer.from(post.tx, 'hex'));
        const txid = txidOf(tx);
        if (this.state.data.spends[txid] && tx.outputs[1]?.script.equals(dataOutput(Buffer.from(id.slice(2), 'hex')))) {
          w.status = 'paid';
          w.txid = txid;
          this.log(`withdrawal ${id.slice(0, 10)}: paid in ${txid.slice(0, 12)}`);
          return true;
        }
      } catch { /* an invalid proposal is simply skipped here */ }
    }
    return false;
  }

  async withdrawal(id, w) {
    const posts = await this.posts(id, w);
    if (this.settled(id, w, posts)) return;
    const proposal = posts.map((p) => this.parseProposal(id, w, p)).find(Boolean);
    if (!proposal) {
      if (this.proposer(w).toLowerCase() === this.me.toLowerCase()) await this.propose(id, w);
      return;
    }
    const { tx, txid } = proposal;
    const d = this.state.data;
    const signatures = this.collect(posts, tx, txid);
    if (!signatures.has(this.ownKey) && !d.signed[id]) {
      await this.rejectUnspent(tx);
      this.spend(w.amount);
      // Record before publishing: after a crash the validator will not sign another transaction for the same withdrawal.
      d.signed[id] = { txid, inputs: tx.inputs.map((i) => `${i.txid}:${i.vout}`) };
      this.state.save();
      const list = tx.inputs.map((input, i) => signInput(tx, i, this.scriptOf(input), d.utxos[`${input.txid}:${input.vout}`].value, this.btcKey).toString('hex'));
      await this.post(id, { txid, sigs: list });
      signatures.set(this.ownKey, list.map((s) => Buffer.from(s, 'hex')));
    }
    if (signatures.size >= this.threshold && !this.sent.has(txid)) await this.broadcast(tx, txid, signatures);
  }

  scriptOf(input) {
    const { recipient } = this.state.data.utxos[`${input.txid}:${input.vout}`];
    return custodyScript(this.pubkeys, this.threshold, recipient ?? undefined);
  }

  async posts(id, w) {
    const head = await this.chain.provider.getBlockNumber();
    const logs = await queryRange(this.gateway, this.gateway.filters.Posted(id), w.block ?? this.chain.startBlock ?? 0, head);
    return logs.flatMap((log) => {
      if (ethers.dataLength(log.args.data) > MAX_POST) return [];
      try { return [{ validator: log.args.validator, ...JSON.parse(ethers.toUtf8String(log.args.data)) }]; } catch { return []; }
    });
  }

  async post(id, body) {
    await this.gateway.post(id, ethers.toUtf8Bytes(JSON.stringify(body)));
  }

  /** The whole check of the proposal is based on what the validator has seen itself. The proposal proves nothing; it is only compared. */
  parseProposal(id, w, post) {
    if (!post.tx) return null;
    try {
      const tx = parseTx(Buffer.from(post.tx, 'hex'));
      this.check(id, w, tx);
      return { tx, txid: txidOf(tx) };
    } catch (e) {
      this.log(`proposal for ${id.slice(0, 10)} from ${post.validator.slice(0, 10)} refused: ${e.message}`);
      return null;
    }
  }

  check(id, w, tx) {
    const d = this.state.data;
    const refuse = (why) => { throw new Error(why); };
    if (tx.version !== 2 || tx.locktime !== 0) refuse('unusual transaction');
    if (tx.inputs.length === 0 || tx.inputs.length > MAX_INPUTS) refuse('wrong number of inputs');
    const keys = tx.inputs.map((i) => `${i.txid}:${i.vout}`);
    if (new Set(keys).size !== keys.length) refuse('repeated input');
    const reserved = this.reserved(id);
    let total = 0n;
    for (const key of keys) {
      const utxo = d.utxos[key] ?? refuse(`input ${key} is not in custody`);
      if (reserved.has(key)) refuse(`input ${key} belongs to another withdrawal`);
      total += utxo.value;
    }
    const [pay, note, change, ...rest] = tx.outputs;
    if (!pay || !note || rest.length) refuse('wrong outputs');
    if (!pay.script.equals(addressScript(w.address, this.network))) refuse('the payment goes elsewhere than the user asked');
    if (note.value !== 0n || !note.script.equals(dataOutput(Buffer.from(id.slice(2), 'hex')))) refuse('missing withdrawal tag');
    const left = total - w.amount;
    if (left < 0n) refuse('the inputs do not cover the amount');
    if (change) {
      if (change.script.toString('hex') !== this.mainOutput) refuse('the change leaves custody');
      if (change.value !== left) refuse('custody would lose more than the burned amount');
    } else if (left >= DUST) refuse('missing change back to custody');
    if (pay.value < DUST || pay.value >= w.amount) refuse('wrong payment amount');
    if (w.amount - pay.value > BigInt(this.maxFeeRate) * BigInt(this.sizeWithWitness(tx))) refuse('the fee is above the limit');
  }

  /** Coins already promised to other withdrawals, so two payments do not block each other. */
  reserved(except) {
    const out = new Set();
    for (const [id, s] of Object.entries(this.state.data.signed)) if (id !== except) s.inputs.forEach((k) => out.add(k));
    return out;
  }

  sizeWithWitness(tx) {
    const inputs = tx.inputs.map((input) => ({ ...input, witness: [Buffer.alloc(0), ...Array(this.threshold).fill(Buffer.alloc(FAKE_SIGNATURE)), this.scriptOf(input)] }));
    return virtualSize({ ...tx, inputs });
  }

  async rejectUnspent(tx) {
    for (const i of tx.inputs) if (!await this.rpc('gettxout', [i.txid, i.vout, true])) throw new Error(`input ${i.txid}:${i.vout} is spent`);
  }

  spend(amount) {
    const d = this.state.data;
    const day = Math.floor(this.now() / DAY_MS);
    if (d.spent.day !== day) d.spent = { day, sats: 0n };
    if (d.spent.sats + amount > this.dailyLimit) throw new Error('the daily withdrawal limit is used up');
    d.spent.sats += amount;
  }

  async feeRate() {
    const { feerate } = await this.rpc('estimatesmartfee', [3]);
    const rate = feerate ? Math.ceil(feerate * 100_000) : this.fallbackFeeRate;
    return Math.min(rate, this.maxFeeRate);
  }

  async propose(id, w) {
    if (this.sent.has(id)) return;
    const d = this.state.data;
    const reserved = this.reserved(id);
    const free = Object.entries(d.utxos).filter(([k]) => !reserved.has(k)).sort(([, a], [, b]) => (a.value < b.value ? 1 : -1));
    const inputs = [];
    let total = 0n;
    for (const [key, utxo] of free) {
      if (total >= w.amount || inputs.length === MAX_INPUTS) break;
      const [txid, vout] = key.split(':');
      inputs.push({ txid, vout: Number(vout) });
      total += utxo.value;
    }
    if (total < w.amount) throw new Error('custody does not have enough confirmed coins yet');
    const left = total - w.amount;
    const outputs = [{ value: 0n, script: addressScript(w.address, this.network) }, { value: 0n, script: dataOutput(Buffer.from(id.slice(2), 'hex')) }];
    if (left >= DUST) outputs.push({ value: left, script: Buffer.from(this.mainOutput, 'hex') });
    const tx = { version: 2, locktime: 0, inputs, outputs };
    const fee = BigInt(await this.feeRate()) * BigInt(this.sizeWithWitness(tx));
    outputs[0].value = w.amount - fee;
    if (outputs[0].value < DUST) throw new Error('the amount does not cover the network fee');
    await this.post(id, { tx: serializeTx(tx).toString('hex') });
    this.sent.add(id);
    this.log(`withdrawal ${id.slice(0, 10)}: proposing a payment of ${outputs[0].value} sat, fee ${fee}`);
  }

  /** Only signatures that really belong to validators and to this transaction. */
  collect(posts, tx, txid) {
    const d = this.state.data;
    const found = new Map();
    for (const post of posts) {
      if (post.txid !== txid || !Array.isArray(post.sigs) || post.sigs.length !== tx.inputs.length) continue;
      const entry = this.validators.find((v) => v.address.toLowerCase() === post.validator.toLowerCase());
      if (!entry) continue;
      const key = entry.btcKey.replace(/^0x/, '');
      const list = post.sigs.map((s) => Buffer.from(s, 'hex'));
      const good = list.every((sig, i) => {
        const input = tx.inputs[i];
        const utxo = d.utxos[`${input.txid}:${input.vout}`];
        return utxo && verifyInput(tx, i, this.scriptOf(input), utxo.value, Buffer.from(key, 'hex'), sig);
      });
      if (good) found.set(key, list);
    }
    return found;
  }

  async broadcast(tx, txid, signatures) {
    const inputs = tx.inputs.map((input, i) => {
      const script = this.scriptOf(input);
      const forInput = new Map([...signatures].map(([key, list]) => [key, list[i]]));
      return { ...input, witness: multisigWitness(this.pubkeys, this.threshold, forInput, script) };
    });
    try {
      await this.rpc('sendrawtransaction', [serializeTx({ ...tx, inputs }, true).toString('hex')]);
      this.log(`withdrawal: transaction ${txid.slice(0, 12)} sent`);
    } catch (e) {
      if (!/already|known/i.test(e.message)) throw e;
    }
    this.sent.add(txid);
  }
}

/** Calls to a Bitcoin Core node over JSON-RPC. */
export function bitcoinRpc(url, { user, password } = {}) {
  const auth = user ? { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` } : {};
  return async (method, params = []) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };
}
