// Public RPC nodes of the community (the app's "Share node publicly"). A node that shares itself announces the https
// address of its public RPC, usually a Cloudflare quick tunnel, so the operator's IP address stays hidden. The announcement
// is signed by the node key and valid only for a short time. Every node that receives it checks the address itself:
// the same chain, the same block at a settled height and a head close to its own. Only checked addresses are listed
// (quinvium_publicNodes) and passed on to peers. There is no registry, owner or fee: a node simply vouches for what it
// has verified a moment ago.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { nodeIdOf, PUB_LEN, SIG_LEN } from '../p2p/identity.js';
import { toHex } from '../util/bytes.js';

export const ANNOUNCE_TTL_MS = 2 * 3_600_000;   // an announcement older than this is ignored
const REANNOUNCE_MS = 30 * 60_000;               // a sharing node signs a fresh announcement this often
const RECHECK_MS = 10 * 60_000;                  // a listed address is checked again this often
const MAX_ENTRIES = 64;
const MAX_URL = 200;
const MAX_LAG = 20n;                             // blocks a listed node may be behind this node's head
const SETTLED = 6n;
const FETCH_TIMEOUT_MS = 8_000;
const DOMAIN = 'quinvium-public-node-v1';
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/** An https address without an IP literal, credentials, port or path tricks: a hostname only. */
export function validUrl(url) {
  if (typeof url !== 'string' || url.length > MAX_URL) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false;
  if (u.port && u.port !== '443') return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return false;   // excludes IPv4 and IPv6 literals
  return u.pathname === '/' && url === `https://${u.hostname.toLowerCase()}`;
}

const message = (chainId, url, expires) => Buffer.from(`${DOMAIN}\n${chainId}\n${url}\n${expires}`);

export function signAnnouncement(identity, chainId, url, expires) {
  return crypto.sign(null, message(chainId, url, expires), identity.privateKey);
}

export function verifyAnnouncement({ url, key, expires, sig }, chainId) {
  if (!(key instanceof Uint8Array) || key.length !== PUB_LEN || !(sig instanceof Uint8Array) || sig.length !== SIG_LEN) return false;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key)]), format: 'der', type: 'spki' });
    return crypto.verify(null, message(chainId, url, expires), pub, sig);
  } catch {
    return false;
  }
}

export class PublicNodes extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('../core/chain.js').Chain} o.chain
   * @param {{privateKey: crypto.KeyObject, publicKey: Uint8Array}} o.identity
   * @param {bigint|number} o.chainId
   * @param {typeof fetch} [o.fetchImpl]
   * @param {() => number} [o.now]
   * @param {(m: string) => void} [o.log]
   */
  constructor({ chain, identity, chainId, fetchImpl, now = Date.now, log = () => {} }) {
    super();
    Object.assign(this, { chain, identity, chainId: String(chainId), fetchImpl: fetchImpl ?? ((...a) => fetch(...a)), now, log });
    this.entries = new Map();   // url -> { url, key, expires, sig, node, height, latencyMs, checkedAt, ok }
    this.own = null;            // this node's announcement while it shares itself
    this.checking = new Map();  // url -> the check running for it
  }

  /** This node shares its public RPC at `url` (null stops sharing). Returns the signed announcement. */
  share(url) {
    if (url === null || url === undefined || url === '') {
      if (this.own) this.entries.delete(this.own.url);
      this.own = null;
      return null;
    }
    if (!validUrl(url)) throw new Error('invalid public address');
    const expires = this.now() + ANNOUNCE_TTL_MS;
    const key = new Uint8Array(this.identity.publicKey);
    this.own = { url, key, expires, sig: new Uint8Array(signAnnouncement(this.identity, this.chainId, url, expires)), at: this.now() };
    this.receive([this.own]);
    return this.own;
  }

  /** Announcements to send to peers: our own (fresh) and the ones we checked successfully. */
  outgoing() {
    if (this.own && this.now() - this.own.at > REANNOUNCE_MS) this.share(this.own.url);
    const list = [...this.entries.values()].filter((e) => e.ok && e.expires > this.now());
    if (this.own && !list.some((e) => e.url === this.own.url)) list.unshift(this.own);
    return list.slice(0, 32).map(({ url, key, expires, sig }) => ({ url, key, expires, sig }));
  }

  /** Announcements from a peer or from this node. Valid ones are checked in the background. */
  receive(list) {
    if (!Array.isArray(list)) return 0;
    let accepted = 0;
    for (const a of list.slice(0, 32)) {
      if (!a || !validUrl(a.url) || !(a.expires > this.now()) || a.expires > this.now() + ANNOUNCE_TTL_MS + 60_000) continue;
      if (!verifyAnnouncement(a, this.chainId)) continue;
      const known = this.entries.get(a.url);
      if (known && known.expires >= a.expires) continue;
      if (!known && this.entries.size >= MAX_ENTRIES) this._prune(true);
      if (!known && this.entries.size >= MAX_ENTRIES) continue;
      // One address per node key: a newer announcement of the same key replaces the older address.
      const keyHex = Buffer.from(a.key).toString('hex');
      let superseded = false;
      for (const [url, e] of this.entries) {
        if (url !== a.url && Buffer.from(e.key).toString('hex') === keyHex) {
          if (e.expires >= a.expires) { superseded = true; break; }
          this.entries.delete(url);
        }
      }
      if (superseded) continue;
      const entry = { ...(known ?? { ok: false, checkedAt: 0 }), url: a.url, key: a.key, expires: a.expires, sig: a.sig, node: toHex(nodeIdOf(a.key)).slice(2, 18) };
      this.entries.set(a.url, entry);
      accepted++;
      if (!known || this.now() - entry.checkedAt > RECHECK_MS) this.check(entry).catch(() => {});
    }
    return accepted;
  }

  async _rpc(url, method, params = []) {
    const r = await this.fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }

  /** Checks one address: chain ID, the block at a settled height, and how far its head is behind ours. */
  check(entry) {
    if (!this.checking.has(entry.url)) this.checking.set(entry.url, this._check(entry).finally(() => this.checking.delete(entry.url)));
    return this.checking.get(entry.url);
  }

  async _check(entry) {
    const started = this.now();
    try {
      const head = this.chain.head.number;
      const height = head > SETTLED ? head - SETTLED : 0n;
      const ours = toHex(this.chain.store.canonicalHash(height));
      const [chainId, block, number, info] = await Promise.all([
        this._rpc(entry.url, 'eth_chainId'),
        this._rpc(entry.url, 'eth_getBlockByNumber', [`0x${height.toString(16)}`, false]),
        this._rpc(entry.url, 'eth_blockNumber'),
        this._rpc(entry.url, 'quinvium_nodeInfo'),
      ]);
      const theirs = BigInt(number);
      // The address must lead to the node that signed it. Otherwise anyone could sign other people's nodes
      // (or one proxy under many names) and fill the list with entries that only pass the check.
      const sameNode = typeof info?.publicKey === 'string' && info.publicKey.toLowerCase() === Buffer.from(entry.key).toString('hex');
      entry.ok = sameNode && BigInt(chainId) === BigInt(this.chainId) && block?.hash === ours && theirs + MAX_LAG >= head;
      entry.height = Number(theirs);
      entry.latencyMs = this.now() - started;
    } catch {
      entry.ok = false;
    } finally {
      entry.checkedAt = this.now();
    }
    if (entry.ok) this.emit('verified', entry);
    return entry.ok;
  }

  /** Re-checks entries whose last check is old; drops expired ones. */
  async refresh() {
    this._prune();
    await Promise.all([...this.entries.values()].filter((e) => this.now() - e.checkedAt > RECHECK_MS).map((e) => this.check(e).catch(() => false)));
  }

  _prune(force = false) {
    for (const [url, e] of this.entries) if (e.expires <= this.now()) this.entries.delete(url);
    if (force) {
      const bad = [...this.entries.values()].filter((e) => !e.ok && e.url !== this.own?.url);
      if (bad.length) this.entries.delete(bad[0].url);
    }
  }

  /** The verified list for RPC: addresses only, never IP addresses; fastest first. */
  list() {
    this._prune();
    return [...this.entries.values()]
      .filter((e) => e.ok)
      .sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9))
      .map((e) => ({ url: e.url, node: e.node, height: e.height, latencyMs: e.latencyMs, checkedAt: e.checkedAt, expires: e.expires, own: e.url === this.own?.url }));
  }
}
