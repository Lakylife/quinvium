// Nodes watch each other. Every few minutes the node asks each peer for its block at a height that is already settled
// in our chain (a few blocks deep). The answer must carry valid work and must be the block we have there. A different block
// means the peer follows another branch: an attack, a network split or a node with other rules. The node does not trust either side blindly:
// it only reports. Blocks are still fully verified by the chain, this is an extra pair of eyes.
// No IP addresses leave this module: peers are named by the first bytes of their node key.
import { EventEmitter } from 'node:events';
import { toHex } from '../util/bytes.js';
import { L } from '../lang.js';

export const SETTLED_DEPTH = 6n;      // a peer head this deep in our chain must match; shallower ones may still race
const KEEP_MS = 3_600_000;            // a peer that has not reported for an hour drops out of the summary
const MAX_INCIDENTS = 32;
const MAX_TRACKED = 512;
const PROBE_EVERY_MS = 120_000;     // one header question per peer at most every two minutes

const shortId = (peer) => (peer.nodeId ? Buffer.from(peer.nodeId).toString('hex').slice(0, 16) : 'unknown');

export class ChainWatch extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('../core/chain.js').Chain} o.chain
   * @param {import('node:events').EventEmitter} o.network emits peer-connected, peer-head and deep-fork
   * @param {(m: string) => void} [o.log]
   * @param {() => number} [o.now]
   */
  constructor({ chain, network, log = () => {}, now = Date.now }) {
    super();
    Object.assign(this, { chain, network, log, now });
    this.verdicts = new Map();        // short peer id -> { height, agree, ours, theirs, at }
    this.incidents = [];
    this.warned = new Set();
    this.probed = new Map();         // short peer id -> time of the last question
    this._onPeer = (peer) => { this.check(peer).catch(() => {}); };
    this._onDeepFork = ({ ancestor, accepted }) => this.incident(accepted ? 'deep-reorg-accepted' : 'deep-fork-refused', { height: Number(ancestor) });
    this._onFinality = ({ depth }) => this.incident('finality-violation', { depth: Number(depth) });
    this._onReorg = ({ depth }) => { if (depth >= Number(SETTLED_DEPTH)) this.incident('deep-reorg', { depth: Number(depth) }); };
    network.on('peer-connected', this._onPeer);
    network.on('peer-head', this._onPeer);
    network.on('deep-fork', this._onDeepFork);
    chain.on('finality-violation', this._onFinality);
    chain.on('reorg', this._onReorg);
  }

  stop() {
    this.network.off('peer-connected', this._onPeer);
    this.network.off('peer-head', this._onPeer);
    this.network.off('deep-fork', this._onDeepFork);
    this.chain.off('finality-violation', this._onFinality);
    this.chain.off('reorg', this._onReorg);
  }

  /**
   * Asks the peer which block it has at a settled height: its own head when it lags behind, otherwise the block
   * SETTLED_DEPTH below our head. The answer must carry valid work. Returns the verdict, or null when it cannot be judged.
   */
  async check(peer) {
    if (!peer.ready || peer.headNumber === undefined || !this.network.probeHeader) return null;
    const id = shortId(peer);
    const last = this.probed.get(id) ?? 0;
    if (this.now() - last < PROBE_EVERY_MS) return null;
    const height = [BigInt(peer.headNumber), this.chain.head.number - SETTLED_DEPTH].reduce((x, y) => (x < y ? x : y));
    if (height < 1n) return null;
    const parent = this.chain.store.canonicalHash(height - 1n);
    const ours = this.chain.store.canonicalHash(height);
    if (!parent || !ours) return null;
    if (this.probed.size >= MAX_TRACKED) this.probed.clear();
    this.probed.set(id, this.now());
    const h = await this.network.probeHeader(peer, parent).catch(() => null);
    if (!h) return null;
    // An earlier block than asked means the peer does not have our block at height-1 on its main branch.
    const theirs = h.number === height ? Buffer.from(h.hash()) : null;
    const agree = !!theirs && Buffer.compare(Buffer.from(ours), theirs) === 0;
    if (!this.verdicts.has(id) && this.verdicts.size >= MAX_TRACKED) this._prune(true);
    const verdict = { height: Number(height), agree, ours: toHex(ours), theirs: theirs ? toHex(theirs) : null, at: this.now() };
    this.verdicts.set(id, verdict);
    if (!agree) {
      const key = `${id}:${verdict.height}`;
      if (!this.warned.has(key)) {
        if (this.warned.size > MAX_TRACKED) this.warned.clear();
        this.warned.add(key);
        const what = theirs ? `${verdict.theirs.slice(0, 14)}…` : L('nemá náš předchozí blok', 'lacks our previous block');
        this.log(L(
          L(L(`VAROVÁNÍ: uzel ${id} má na výšce ${verdict.height} jiný blok (${what}, u nás ${verdict.ours.slice(0, 14)}…). Sleduje jinou větev.`, `WARNING: node ${id} has a different block at height ${verdict.height} (${what}, ours ${verdict.ours.slice(0, 14)}…). It follows another branch.`), `WARNING: node ${id} has a different block at height ${verdict.height} (${what}, ours ${verdict.ours.slice(0, 14)}…). It follows another branch.`),
          `WARNING: node ${id} has a different block at height ${verdict.height} (${what}, ours ${verdict.ours.slice(0, 14)}…). It follows another branch.`,
        ));
        this.emit('disagree', { peer: id, ...verdict });
      }
    }
    return verdict;
  }

  incident(kind, detail = {}) {
    const entry = { kind, ...detail, at: this.now() };
    this.incidents.push(entry);
    if (this.incidents.length > MAX_INCIDENTS) this.incidents.shift();
    this.emit('incident', entry);
  }

  _prune(force = false) {
    const limit = this.now() - KEEP_MS;
    for (const [id, v] of this.verdicts) if (v.at < limit) this.verdicts.delete(id);
    if (force && this.verdicts.size >= MAX_TRACKED) this.verdicts.delete(this.verdicts.keys().next().value);
  }

  /**
   * What the node sees right now. `minority` means most checked peers are on another branch than this node:
   * then it is more likely this node that is cut off or deceived, and its owner should look closer.
   */
  summary() {
    this._prune();
    const list = [...this.verdicts.entries()];
    const differ = list.filter(([, v]) => !v.agree);
    const agree = list.length - differ.length;
    const recent = this.incidents.filter((i) => i.at > this.now() - 24 * KEEP_MS);
    return {
      checked: list.length,
      agree,
      differ: differ.length,
      minority: differ.length >= 2 && differ.length > agree,
      ok: differ.length === 0 && recent.length === 0,
      differing: differ.map(([peer, v]) => ({ peer, height: v.height, ours: v.ours, theirs: v.theirs, at: v.at })),
      incidents: recent,
    };
  }
}
