// Bridge validator between EVM chains. Watches sends on each chain and after enough confirmations signs the message
// and publishes the signature in the target gateway. As soon as there are enough signatures, any validator submits the delivery.
//
// Signs only what it has seen itself in its own node of the source chain. A validator must therefore have its own nodes, otherwise
// transfers trust to a foreign server. Every step can be repeated, so an outage in the middle does no harm.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';

const artifacts = JSON.parse(readFileSync(new URL('../../contracts/dist/artifacts.json', import.meta.url)));
export const GATEWAY_ABI = artifacts.BridgeGateway.abi;
const DOMAIN = ethers.id('AetherBridge.v1');
const LOG_BATCH = 2000;
const ATTEST_WINDOW = 9000;     // a Quinvium node returns logs from at most 10,000 blocks at a time
const RESEND_MS = 60_000;

/**
 * Minimum number of confirmations by chain. On a small proof-of-work network rewriting a few minutes costs little; rented
 * hashrate, and the same coins could be sent through the bridge twice. Quinvium mainnet therefore waits an hour (below the 256-block finality boundary),
 * Ethereum for finality of two epochs. Test networks only have a general minimum.
 */
export const MIN_CONFIRMATIONS = Object.freeze({ 52401: 240, 1: 64 });
const coder = ethers.AbiCoder.defaultAbiCoder();

/** The same computation as `messageId` in the contract, just without querying a foreign node. */
export function messageId(gateway, m) {
  return ethers.keccak256(coder.encode(
    ['bytes32', 'address', 'uint64', 'uint64', 'uint64', 'bytes32', 'address', 'uint256'],
    [DOMAIN, gateway, m.srcChain, m.dstChain, m.nonce, m.srcToken, m.recipient, m.amount],
  ));
}

/** What the validator signs: the message ID with the EIP-191 prefix, exactly as the gateway verifies it. */
export const signedDigest = (id) => ethers.hashMessage(ethers.getBytes(id));

/** Route key as in the contract: from where and which token. */
export const routeKey = (chain, token) => ethers.keccak256(coder.encode(['uint64', 'bytes32'], [chain, token]));

/** A message number derived from text, like refunds on the bridge to Bitcoin. Real message numbers count from one; this one never meets them. */
export const nonceOf = (text) => BigInt(ethers.dataSlice(ethers.sha256(ethers.toUtf8Bytes(text)), 0, 8));

/**
 * Refund of a cancelled transfer: a message in the opposite direction, from the target network back to the source, with the original sender as recipient.
 * The number is derived from the original send, so one send cannot be refunded twice.
 * @param {object} message the original message with `sender` and `sendId` from the Sent event
 * @param {string} local token on the target network that the route converted the original transfer to
 */
export const refundMessage = (message, local) => ({
  srcChain: message.dstChain, dstChain: message.srcChain, nonce: nonceOf(`refund:${message.sendId}`),
  srcToken: ethers.zeroPadValue(local, 32), recipient: message.sender, amount: message.amount, refundOf: message.sendId,
});

/** Only the message fields go to the contract, not the validator's notes. */
const wire = ({ srcChain, dstChain, nonce, srcToken, recipient, amount }) => ({ srcChain, dstChain, nonce, srcToken, recipient, amount });

/** Logs over a longer range in parts; nodes reject a longer query. */
export async function queryRange(contract, filter, from, to) {
  const found = [];
  for (let start = from; start <= to; start += LOG_BATCH) found.push(...await contract.queryFilter(filter, start, Math.min(start + LOG_BATCH - 1, to)));
  return found;
}

/** BigInt in JSON: values are stored as text with a prefix. */
const encode = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `#${v}` : v));
const decode = (text) => JSON.parse(text, (_, v) => (typeof v === 'string' && /^#\d+$/.test(v) ? BigInt(v.slice(1)) : v));

/** State saved atomically, so no half-written file remains after a crash. A signature is not sent without writing the state. */
export class StateFile {
  constructor(path) {
    this.path = path;
    this.data = {};
    if (!path) return;
    try { this.data = decode(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  save() {
    if (!this.path) return;
    writeFileSync(`${this.path}.tmp`, encode(this.data), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}

export class Relayer {
  /**
   * @param {object} o
   * @param {{ id: bigint, name: string, provider: object, gateway: string, confirmations: number, startBlock?: number }[]} o.chains
   * @param {string} o.privateKey validator key
   * @param {string} [o.statePath] soubor se stavem
   * @param {(line: string) => void} [o.log]
   */
  constructor({ chains, privateKey, statePath, log = () => {} }) {
    this.key = new ethers.SigningKey(privateKey);
    this.address = ethers.computeAddress(this.key);
    this.log = log;
    for (const c of chains) {
      const need = MIN_CONFIRMATIONS[Number(c.id)] ?? 1;
      if (!Number.isInteger(c.confirmations) || c.confirmations < need) {
        throw new Error(`${c.name}: at least ${need} confirmations are needed, set to ${c.confirmations}`);
      }
    }
    this.chains = new Map(chains.map((c) => {
      const signer = new ethers.Wallet(privateKey, c.provider);
      return [c.id, { ...c, signer, gateway: new ethers.Contract(c.gateway, GATEWAY_ABI, signer) }];
    }));
    this.state = new StateFile(statePath);
    this.state.data.cursor ??= {};
    this.state.data.pending ??= {};
    this.sent = new Map();     // what has been sent and waits for a block
    this.running = false;
  }

  /** A message from a source other than the EVM gateway, for example a Bitcoin deposit. */
  enqueue(message) {
    const dst = this.chains.get(message.dstChain);
    if (!dst) throw new Error(`Unknown destination chain ${message.dstChain}`);
    const id = messageId(dst.gateway.target, message);
    if (!this.state.data.pending[id]) {
      this.state.data.pending[id] = message;
      this.state.save();
    }
    return id;
  }

  /** One pass. An error on one chain does not stop the others; it is retried next time. */
  async tick() {
    for (const chain of this.chains.values()) {
      try { await this.scan(chain); } catch (e) { this.log(`${chain.name}: reading failed: ${e.shortMessage ?? e.message}`); }
    }
    for (const [id, message] of Object.entries(this.state.data.pending)) {
      try { await this.handle(id, message); } catch (e) { this.log(`${id.slice(0, 10)}: ${e.shortMessage ?? e.message}`); }
    }
  }

  /** Messages are taken only from sufficiently confirmed blocks, so a chain reorganisation cannot slip them in. */
  async scan(chain) {
    const safe = await chain.provider.getBlockNumber() - chain.confirmations;
    const key = chain.id.toString();
    let from = this.state.data.cursor[key] ?? chain.startBlock ?? 0;
    while (from <= safe) {
      const to = Math.min(from + LOG_BATCH - 1, safe);
      for (const log of await chain.gateway.queryFilter('Sent', from, to)) this.accept(chain, log);
      from = to + 1;
      this.state.data.cursor[key] = from;
      this.state.save();
    }
  }

  accept(chain, log) {
    const { id: sendId, dstChain, token, sender, recipient, amount, nonce } = log.args;
    const dst = this.chains.get(dstChain);
    if (!dst) return;       // Bitcoin and chains this validator does not watch
    if (ethers.dataLength(recipient) !== 20) {
      this.log(`${chain.name}: message ${nonce} has no recipient address, skipping`);
      return;
    }
    // The sender and the send number belong to the message for refunds: a cancelled transfer goes back to exactly that sender.
    const message = { srcChain: chain.id, dstChain, nonce, srcToken: ethers.zeroPadValue(token, 32), recipient: ethers.getAddress(recipient), amount, sender: ethers.getAddress(sender), sendId };
    const id = messageId(dst.gateway.target, message);
    if (!this.state.data.pending[id]) this.state.data.pending[id] = message;
  }

  once(key) {
    const at = this.sent.get(key);
    if (at && Date.now() - at < RESEND_MS) return false;
    this.sent.set(key, Date.now());
    return true;
  }

  async handle(id, message) {
    const dst = this.chains.get(message.dstChain);
    if (await dst.gateway.delivered(id)) {
      // Closed only once the delivery is deep enough in the target chain. A short reorganisation could otherwise remove it
      // after every validator had forgotten the transfer, and nobody would deliver it again.
      const safe = await dst.provider.getBlockNumber() - dst.confirmations;
      if (safe >= 0 && await dst.gateway.delivered(id, { blockTag: safe })) this.finish(id);
      return;
    }
    const queue = await dst.gateway.queued(id);
    if (queue.readyAt !== 0n) {
      if (queue.done) { await this.refund(id, message, dst); return; }
      const { timestamp } = await dst.provider.getBlock('latest');
      if (BigInt(timestamp) >= queue.readyAt && this.once(`queue-${id}`)) await dst.gateway.executeQueued(wire(message));
      return;
    }
    const signatures = await this.signatures(dst, id);
    if (!signatures.has(this.address) && this.once(`attest-${id}`)) {
      const signature = this.key.sign(signedDigest(id)).serialized;
      await dst.gateway.attest(id, signature);
      signatures.set(this.address, signature);
    }
    const threshold = Number(await dst.gateway.threshold());
    if (signatures.size >= threshold && this.once(`deliver-${id}`)) {
      const ordered = [...signatures.entries()].sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1)).slice(0, threshold).map(([, s]) => s);
      await dst.gateway.deliver.staticCall(wire(message), ordered);
      await dst.gateway.deliver(wire(message), ordered);
      this.log(`${id.slice(0, 10)}: delivering ${message.amount} to ${message.recipient}`);
    }
  }

  /**
   * A cancelled transfer is refunded to the sender on the source network, the same way as a transfer in the opposite direction.
   * A refund comes up when the cancellation is deep enough in the target chain: a reorganisation could otherwise undo it
   * and the coins would arrive twice. A cancelled delivery never goes through, the gateway enforces that, and the refund has a number
   * derived from the send, so it passes at most once.
   */
  async refund(id, message, dst) {
    const safe = await dst.provider.getBlockNumber() - dst.confirmations;
    if (safe < 0) return;
    const [queue, done] = await Promise.all([dst.gateway.queued(id, { blockTag: safe }), dst.gateway.delivered(id, { blockTag: safe })]);
    if (!queue.done || done) return;
    const src = this.chains.get(message.srcChain);
    if (!src || !message.sender || message.sendId === undefined) {
      // A Bitcoin deposit or a refund itself: there is no sender on this side; refunds must take their own path.
      this.log(`${id.slice(0, 10)}: cancelled, this validator does not handle the refund`);
      this.finish(id);
      return;
    }
    const route = await dst.gateway.routes(routeKey(message.srcChain, message.srcToken));
    const back = refundMessage(message, route.local);
    const reverse = await src.gateway.routes(routeKey(back.srcChain, back.srcToken));
    if (!reverse.enabled) {
      this.log(`${id.slice(0, 10)}: cancelled, but the return route is closed, will try again`);
      return;
    }
    this.enqueue(back);
    this.log(`${id.slice(0, 10)}: cancelled, returning ${message.amount} to the sender ${message.sender}`);
    this.finish(id);
  }

  async signatures(dst, id) {
    const head = await dst.provider.getBlockNumber();
    const from = Math.max(dst.startBlock ?? 0, head - ATTEST_WINDOW);
    const logs = await dst.gateway.queryFilter(dst.gateway.filters.Attested(id), from, head);
    const found = new Map();
    // The contract verified the signature when it was published, but the node is foreign input. Whatever does not match, delivery would reject.
    for (const log of logs) {
      if (ethers.recoverAddress(signedDigest(id), log.args.signature) === log.args.validator && await dst.gateway.isValidator(log.args.validator)) found.set(log.args.validator, log.args.signature);
    }
    return found;
  }

  finish(id) {
    delete this.state.data.pending[id];
    this.state.save();
  }

  start(pollMs = 5000) {
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      await this.tick();
      this.timer = setTimeout(loop, pollMs);
    };
    loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}
