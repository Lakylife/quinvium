// A network of nodes without a central registry: seed nodes serve only for the first contact,
// after that nodes exchange addresses themselves and remember them in the database.
import { EventEmitter } from 'node:events';
import net from 'node:net';
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { InvalidBlock } from '../core/executor.js';
import { DEEP_REORG_WORK_RATIO, FinalityError, TemporaryBlockError } from '../core/chain.js';
import { CONSENSUS as C } from '../params.js';
import { nextDifficulty } from '../core/difficulty.js';
import { MempoolError } from '../core/mempool.js';
import { Block, Header, decodeTx } from '../core/types.js';
import { forkCompatible, forkId } from '../core/forks.js';
import { bytesToInt, equal, intToBytes } from '../util/bytes.js';
import { LanDiscovery } from './discovery.js';
import { NodeIdentity, nodeIdOf, parsePinned, verifyHello } from './identity.js';
import { MSG, SecureChannel } from './wire.js';
import { Bucket, PROTOCOL_VERSION, Peer } from './peer.js';
import { L } from '../lang.js';

const HANDSHAKE_TIMEOUT = 10_000;
const PING_INTERVAL = 30_000;
const PEER_TIMEOUT = 90_000;
const STATUS_INTERVAL = 15_000;
const DIAL_INTERVAL = 5_000;
const PEX_INTERVAL = 300_000;
const SEED_RESOLVE_INTERVAL = 1_800_000;   // seed as a domain name: addresses can change without a new version
const SEED_RESOLVE_WAIT = 3000;
const BAN_MS = 3_600_000;
// A pinned seed that proved its key is only paused: it may be the node's only way into the network,
// and banning it for an hour would leave a mining node alone on its own fork.
const SEED_BAN_MS = 60_000;
const MAX_HEADERS = 256;
const MAX_BLOCKS = 64;
const MAX_BLOCKS_BYTES = 8 * 1024 * 1024;
const MAX_TXS = 256;
const MAX_PEX = 64;
const MAX_PER_IP = 3;
const MAX_PER_GROUP = 6;            // inbound connections from one /16 range
const MAX_KNOWN_PEERS = 10000;
const MAX_LAN_PEERS = 64;
const LAN_DIAL_JITTER = 2_000;
const MAX_BANS = 4096;
const HEADERS_TIMEOUT = 8_000;      // a liar about work is detected quickly; headers are cheap
const MAX_SEND_QUEUE = 8 * 1024 * 1024;
const FORGIVE_POINTS = 3;           // for each PING interval
const BEHIND_AFTER = 32;            // after this many downloaded blocks the node considers itself behind
const RELAY_MAX_AGE = 120;          // seconds; older blocks are not propagated during sync
const OUTBOUND_NEW_SHARE = 0.25;    // part of outbound connections tries unverified addresses
const GLOBAL_TX_RATE = [512, 1024];
// Handing the queue to a new peer: the receiver takes 64 transactions per second from one node.
const TX_SYNC_BATCH = 48;
const TX_SYNC_INTERVAL = 1_000;
// Capabilities in HELLO. Only a node that supports hash announcements gets them; older ones keep getting full transactions and blocks.
export const FEATURE_ANNOUNCE = 1;
export const FEATURE_PUBLIC_NODES = 2;
const FEATURES = FEATURE_ANNOUNCE | FEATURE_PUBLIC_NODES;
const MAX_ANNOUNCE = 1024;          // hashes in one announcement
const MAX_TXS_BYTES = 8 * 1024 * 1024;
const REQUEST_TTL_MS = 5_000;       // how long to wait for a requested transaction before another peer may offer it
const MAX_REQUESTED = 65_536;

/**
 * Who gets the full message: all older peers and the square root of the number of new ones. The other new ones get only the hash
 * and request the content if they do not have it yet. Traffic thus grows with the square root of the number of peers, not with their number,
 * and the message still reaches everyone as fast as before, because several nodes get it in full right away.
 */
function splitRecipients(peers) {
  const legacy = [];
  const capable = [];
  for (const p of peers) (p.features & FEATURE_ANNOUNCE ? capable : legacy).push(p);
  const mixed = shuffled(capable);
  const full = Math.ceil(Math.sqrt(mixed.length));
  return { full: [...legacy, ...mixed.slice(0, full)], announce: mixed.slice(full) };
}
// A branch that diverged deeper than the finality boundary: how many headers are verified at most and how long we stop downloading from the peer,
// when its branch does not carry twice the work. Verifying one header costs one Ethash computation.
const MAX_DEEP_HEADERS = 50_000;
const DEEP_FORK_PAUSE_MS = 10 * 60_000;

// Ranges that are not the public internet: local networks, loopback, the shared operator range (CGNAT), documentation,
// multicast and reserved addresses. The node does not connect to them from address exchange, otherwise it could be sent into a foreign internal network.
const NON_PUBLIC = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) NON_PUBLIC.addSubnet(prefix, bits, 'ipv4');
for (const [prefix, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]) NON_PUBLIC.addSubnet(prefix, bits, 'ipv6');

function isPrivate(ip) {
  const v = ip.replace(/^::ffff:/i, '');
  const family = isIP(v);
  if (family === 4) return NON_PUBLIC.check(v, 'ipv4');
  if (family === 6) return NON_PUBLIC.check(v, 'ipv6');
  return false;
}

/** Address group: an attacker has easier access to addresses of one network than to many different ones. */
function ipGroup(host) {
  const v = host.replace(/^::ffff:/, '');
  if (isIP(v) === 4) return v.split('.').slice(0, 2).join('.');
  if (isIP(v) === 6) return v.split(':').slice(0, 2).join(':');
  return v;
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const splitAddr = (addr) => {
  const i = addr.lastIndexOf(':');
  return [addr.slice(0, i), Number(addr.slice(i + 1))];
};

export class Network extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('../core/chain.js').Chain} o.chain
   * @param {import('../core/mempool.js').Mempool} o.mempool
   * @param {number} o.port
   * @param {string} [o.host]
   * @param {string[]} [o.seeds] adresy host:port
   * @param {number} [o.maxOutbound]
   * @param {number} [o.maxInbound]
   * @param {boolean} [o.allowPrivate] allow local addresses, only for tests and your own LAN
   * @param {boolean|object} [o.lan] look for nodes on the local network; an object adjusts the settings in tests
   * @param {NodeIdentity} [o.identity] persistent node key; without it a key is created for this run only
   * @param {boolean} [o.requireIdentity] reject nodes without a signed identity (older versions)
   */
  constructor({ chain, mempool, port, host = '0.0.0.0', seeds = [], maxOutbound = 8, maxInbound = 32, allowPrivate = false, lan = false, agent = 'quintium-node/2.0.0', identity = null, requireIdentity = false, log = () => {} }) {
    super();
    Object.assign(this, { chain, mempool, port, host, maxOutbound, maxInbound, allowPrivate, lan, agent, requireIdentity, log });
    // A seed can have a pinned key (`key@host:port`). A connection to it then succeeds only with its signature,
    // so not even forged DNS or an attacker on the path can feed a new node a foreign network.
    this.pinned = new Map();
    this.seeds = seeds.map((seed) => {
      const { key, address } = parsePinned(seed);
      if (key) this.pinned.set(address, key);
      return address;
    });
    this.identity = identity ?? NodeIdentity.load(null);
    this.lanPeers = new Set();
    this.nodeId = this.identity.id;
    this.peers = new Set();
    this.dialing = new Set();
    this.bans = new Map();
    this.syncing = false;
    this.imported = 0;
    this.temporary = false;
    this.txBudget = new Bucket(...GLOBAL_TX_RATE);
    this.requested = new Map();      // transaction hash -> time of the request
    this.deepPauses = new Map();     // IP -> until when we do not download a branch beyond the finality boundary from it; survives a new connection
    this.timers = [];
    this.server = null;
    this._onHead = (e) => this._relayHead(e);
  }

  async start() {
    this.server = net.createServer((s) => this._accept(s));
    this.server.on('error', (e) => this.log(`P2P server: ${e.message}`));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    this.chain.on('head', this._onHead);
    this.timers.push(setInterval(() => this._dialLoop(), DIAL_INTERVAL));
    this.timers.push(setInterval(() => this._keepAlive(), PING_INTERVAL));
    this.timers.push(setInterval(() => this._announceStatus(), STATUS_INTERVAL));
    this.timers.push(setInterval(() => this._askPeers(), PEX_INTERVAL));
    this.timers.push(setInterval(() => { this._resolveSeeds().catch(() => {}); }, SEED_RESOLVE_INTERVAL));
    // Slow DNS must not delay start-up: after a short while dialling starts without it and a later round adds the addresses.
    await Promise.race([this._resolveSeeds().catch(() => {}), new Promise((r) => { setTimeout(r, SEED_RESOLVE_WAIT).unref(); })]);
    this._dialLoop();
    if (this.lan) await this._startDiscovery();
  }

  /**
   * A seed given by name (seed.example.org) can have several addresses. All are recorded among known nodes, so when
   * one server is down, the node tries another. The name itself is also dialled; system DNS decides.
   */
  async _resolveSeeds() {
    for (const seed of this.seeds) {
      const [host, port] = splitAddr(seed);
      if (!host || !port || isIP(host)) continue;
      const found = await lookup(host, { all: true }).catch(() => []);
      const key = this.pinned.get(seed);
      for (const { address } of found) {
        if (isPrivate(address) && !this.allowPrivate) continue;
        if (key) this.pinned.set(`${address}:${port}`, key);
        this.chain.store.peerLearned(`${address}:${port}`);
      }
    }
  }

  async _startDiscovery() {
    const discovery = new LanDiscovery({
      chainId: this.chain.network.chainId, genesis: Buffer.from(this.chain.genesis.hash()).toString('hex'), port: this.port, nodeId: this.nodeId.toString('hex'),
      accepts: isPrivate, onPeer: (ip, port, nodeId) => this._onLanPeer(ip, port, nodeId), log: this.log, ...(typeof this.lan === 'object' ? this.lan : {}),
    });
    try {
      await discovery.start();
      this.discovery = discovery;
    } catch (e) {
      this.log(`${L('Hledání v místní síti nejde spustit', 'Local network discovery cannot start')}: ${e.message}`);
    }
  }

  /** A node announced on the local network. It is verified like any other; only connecting to a local address is allowed for it. */
  _onLanPeer(ip, port, nodeId) {
    if (this.stopped) return;
    if (!this.lanPeers.has(ip) && this.lanPeers.size >= MAX_LAN_PEERS) return;
    this.lanPeers.add(ip);
    // A computer with two interfaces answers from two addresses, but one connection to it is enough.
    if ([...this.peers].some((p) => p.nodeId && Buffer.from(p.nodeId).toString('hex') === nodeId)) return;
    // Both nodes hear each other at the same time. A random delay prevents two concurrent connections from cancelling each other.
    setTimeout(() => this.connect(ip, port), crypto.randomInt(LAN_DIAL_JITTER)).unref();
  }

  async stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.chain.off('head', this._onHead);
    this.discovery?.stop();
    for (const p of this.peers) p.disconnect('vypnutí uzlu');
    await new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  get peerCount() { return [...this.peers].filter((p) => p.ready).length; }

  /**
   * Real lag, not just a sync in progress. A foreign node's claim about its work proves nothing,
   * so mining and block propagation stop only based on blocks that actually passed verification.
   */
  get behind() { return this.syncing && this.imported >= BEHIND_AFTER; }

  peersInfo() {
    return [...this.peers].filter((p) => p.ready).map((p) => ({
      address: `${p.address}:${p.listenPort}`, inbound: p.inbound, agent: p.agent, height: Number(p.headNumber), td: p.headTd.toString(),
      id: p.nodeId ? Buffer.from(p.nodeId).toString('hex') : null, verified: !!p.verified,
    }));
  }

  /** An outbound connection to a seed from the list that signed with its pinned key. */
  _isPinnedSeed(peer) {
    return !peer.inbound && peer.verified && !!peer.pinnedSeed;
  }

  _banned(ip) {
    const until = this.bans.get(ip);
    if (!until) return false;
    if (until > Date.now()) return true;
    this.bans.delete(ip);
    return false;
  }

  _accept(socket) {
    const ip = (socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const inbound = [...this.peers].filter((p) => p.inbound);
    const fromIp = [...this.peers].filter((p) => p.address === ip).length;
    const fromGroup = inbound.filter((p) => ipGroup(p.address) === ipGroup(ip)).length;
    const limited = !this.allowPrivate && !this.lanPeers.has(ip) && (fromIp >= MAX_PER_IP || fromGroup >= MAX_PER_GROUP);
    if (this._banned(ip) || inbound.length >= this.maxInbound || limited) {
      socket.destroy();
      return;
    }
    this._setup(socket, ip, true);
  }

  connect(host, port) {
    const key = `${host}:${port}`;
    if (this.dialing.has(key) || this.stopped) return;
    if (this._banned(host)) return;
    if ([...this.peers].some((p) => p.address === host && p.listenPort === port)) return;
    this.dialing.add(key);
    const socket = net.connect({ host, port });
    socket.setTimeout(HANDSHAKE_TIMEOUT, () => socket.destroy());
    const done = (ok) => {
      this.dialing.delete(key);
      if (!ok) this.chain.store.peerFailed(key);
    };
    socket.once('connect', () => {
      socket.setTimeout(0);
      done(true);
      this._setup(socket, host, false, port);
    });
    socket.once('error', () => done(false));
  }

  _setup(socket, ip, inbound, dialPort = 0) {
    const channel = new SecureChannel(socket, !inbound);
    const peer = new Peer(channel, ip, inbound);
    peer.listenPort = dialPort;
    this.peers.add(peer);
    const timeout = setTimeout(() => peer.disconnect('handshake vypršel'), HANDSHAKE_TIMEOUT);
    channel.on('ready', () => this._sendHello(peer));
    peer.on('message', (type, body) => {
      this._handle(peer, type, body).catch((e) => {
        this.log(`${L(`Chyba zpracování zprávy od ${ip}`, `Error handling a message from ${ip}`)}: ${e.message}`);
        peer.misbehave(20, e.message);
      });
    });
    peer.once('hello', () => clearTimeout(timeout));
    peer.on('misbehave', (points, reason) => this.log(`${L('Uzel', 'Peer')} ${ip} +${points}: ${reason}`));
    peer.on('ban', (reason) => {
      if (!(this.allowPrivate && isPrivate(ip))) {
        if (this.bans.size >= MAX_BANS) this.bans.delete(this.bans.keys().next().value);
        this.bans.set(ip, Date.now() + (this._isPinnedSeed(peer) ? SEED_BAN_MS : BAN_MS));
      }
      peer.disconnect(`zablokován: ${reason}`);
    });
    peer.on('close', (reason) => {
      clearTimeout(timeout);
      this.peers.delete(peer);
      this.emit('peer-disconnected', peer, reason);
    });
  }

  /**
   * Every version knows the first 11 fields. After them come the identity (public key and signature of the connection fingerprint) and a list of capabilities.
   * Older nodes skip the extra fields, so they keep agreeing with new ones.
   */
  _helloBody(peer) {
    const { chain } = this;
    const fork = forkId(chain.network, chain.genesis.hash(), chain.head.number);
    return [
      intToBytes(BigInt(PROTOCOL_VERSION)), intToBytes(chain.network.chainId), chain.genesis.hash(),
      chain.head.hash(), intToBytes(chain.head.number), intToBytes(chain.headTd),
      intToBytes(BigInt(this.port)), this.nodeId, new TextEncoder().encode(this.agent),
      fork.hash, intToBytes(fork.next),
      this.identity.publicKey, this.identity.sign(peer.channel.transcript(), peer.channel.initiator), Uint8Array.of(FEATURES),
    ];
  }

  _sendHello(peer) { peer.send(MSG.HELLO, this._helloBody(peer)); }

  /** Verifies the identity of the other side. @returns {string|null} reason for rejection */
  _checkIdentity(peer, nodeId, publicKey, signature, dialed) {
    const pinned = peer.inbound ? null : this.pinned.get(`${peer.address}:${dialed}`);
    peer.verified = false;
    if (!publicKey?.length) {
      if (this.requireIdentity || pinned) return 'uzel neprokázal identitu, je potřeba aktualizace';
      return null;
    }
    if (!verifyHello(publicKey, signature, peer.channel.transcript(), !peer.channel.initiator)) return 'neplatný podpis identity';
    if (!equal(nodeId, nodeIdOf(publicKey))) return 'identifikátor neodpovídá klíči';
    if (pinned && !equal(pinned, publicKey)) return 'seed se ohlásil jiným klíčem';
    peer.verified = true;
    peer.pinnedSeed = !!pinned;
    peer.publicKey = publicKey;
    return null;
  }

  _onHello(peer, b) {
    const { chain } = this;
    const [version, chainId, genesis, headHash, headNumber, headTd, port, nodeId, agent, forkHash, forkNext, idKey, idSig, features] = b;
    if (bytesToInt(version) !== BigInt(PROTOCOL_VERSION)) return peer.disconnect('jiná verze protokolu');
    if (bytesToInt(chainId) !== chain.network.chainId) return peer.disconnect('jiná síť');
    if (!equal(genesis, chain.genesis.hash())) return peer.disconnect('jiný genesis');
    if (!forkCompatible(chain.network, chain.genesis.hash(), chain.head.number, { hash: forkHash, next: bytesToInt(forkNext) })) {
      this.emit('incompatible', peer);
      return peer.disconnect('neslučitelná pravidla sítě, je potřeba aktualizace');
    }
    if (!(nodeId instanceof Uint8Array) || [idKey, idSig, features].some((x) => x !== undefined && !(x instanceof Uint8Array))) {
      peer.misbehave(50, 'poškozený handshake');
      return peer.disconnect('poškozený handshake');
    }
    if (Buffer.compare(nodeId, this.nodeId) === 0) return peer.disconnect('spojení sám se sebou');
    const refused = this._checkIdentity(peer, nodeId, idKey, idSig, peer.listenPort);
    if (refused) {
      if (/podpis|klíč/.test(refused)) peer.misbehave(100, refused);
      return peer.disconnect(refused);
    }
    peer.features = features?.length ? features[0] : 0;
    for (const p of this.peers) {
      if (p !== peer && p.nodeId && Buffer.compare(p.nodeId, nodeId) === 0) return peer.disconnect('duplicitní spojení');
    }
    peer.nodeId = nodeId;
    peer.agent = new TextDecoder().decode(agent).slice(0, 64);
    const dialed = peer.listenPort;
    peer.listenPort = Number(bytesToInt(port));
    peer.updateHead(headHash, bytesToInt(headNumber), bytesToInt(headTd));
    const paused = this.deepPauses.get(this._pauseKey(peer));
    if (paused && paused > Date.now()) peer.deepForkUntil = paused;
    peer.ready = true;
    peer.channel.unlock();
    peer.emit('hello');
    // Only an address we connected to ourselves is verified. An incoming peer can only claim its port.
    if (!peer.inbound) chain.store.peerConnected(`${peer.address}:${dialed}`);
    else if (peer.listenPort && chain.store.peerCount() < MAX_KNOWN_PEERS) chain.store.peerLearned(`${peer.address}:${peer.listenPort}`);
    this.log(L(`Připojen uzel ${peer.address}:${peer.listenPort} (výška ${peer.headNumber})`, `Connected peer ${peer.address}:${peer.listenPort} (height ${peer.headNumber})`));
    this.emit('peer-connected', peer);
    peer.request(MSG.GET_PEERS, []).then((list) => this._onPeers(peer, list)).catch(() => {});
    this._maybeSync(peer);
    this._syncTxs(peer);
    return undefined;
  }

  /**
   * A newly connected peer gets pending transactions. Otherwise it would never receive those the network broadcast while
   * was not connected yet, and if it is the only miner, they would stay stuck. Sent in batches at a pace the receiver
   * accepts without a penalty for flooding.
   */
  _syncTxs(peer) {
    const txs = this.mempool.ordered();
    let at = 0;
    const announce = peer.features & FEATURE_ANNOUNCE;
    const batch = announce ? MAX_ANNOUNCE : TX_SYNC_BATCH;
    const step = () => {
      if (this.stopped || !this.peers.has(peer) || !peer.ready || at >= txs.length) return;
      const part = txs.slice(at, at + batch);
      for (const t of part) peer.markKnown(Buffer.from(t.hash()).toString('hex'));
      if (announce) peer.send(MSG.NEW_TX_HASHES, [part.map((t) => t.hash())]);
      else peer.send(MSG.NEW_TXS, [part.map((t) => t.serialize())]);
      at += batch;
      if (at < txs.length) setTimeout(step, TX_SYNC_INTERVAL).unref?.();
    };
    step();
  }

  async _handle(peer, type, b) {
    if (type === MSG.HELLO) {
      if (peer.ready) return peer.misbehave(20, 'opakovaný handshake');
      return this._onHello(peer, b);
    }
    if (!peer.ready) return peer.misbehave(50, 'zpráva před handshakem');
    switch (type) {
      case MSG.PING: return peer.send(MSG.PONG, []);
      case MSG.PONG: return undefined;
      case MSG.STATUS: {
        peer.updateHead(b[0], bytesToInt(b[1]), bytesToInt(b[2]));
        this.emit('peer-head', peer);
        return this._maybeSync(peer);
      }
      case MSG.GET_HEADERS: return this._onGetHeaders(peer, b);
      case MSG.GET_BLOCKS: return this._onGetBlocks(peer, b);
      case MSG.NEW_BLOCK: return this._onNewBlock(peer, b);
      case MSG.NEW_TXS: return this._onNewTxs(peer, b);
      case MSG.NEW_TX_HASHES: return this._onTxHashes(peer, b);
      case MSG.GET_TXS: return this._onGetTxs(peer, b);
      case MSG.NEW_BLOCK_HASH: return this._onBlockHash(peer, b);
      case MSG.PUBLIC_NODES: return this._onPublicNodes(peer, b);
      case MSG.GET_PEERS: {
        // Verified and unverified: a seed node does not connect by itself, yet it must relay addresses of the nodes that found it.
        // Fakes do no harm this way: the receiver keeps them aside and gives them only a small share of outbound connections.
        const { store } = this.chain;
        const half = MAX_PEX / 2;
        const list = [...shuffled(store.peersTried(MAX_PEX * 4)).slice(0, half), ...shuffled(store.peersNew(MAX_PEX * 4)).slice(0, half)];
        return peer.respond(MSG.PEERS, b[0], list.filter((a) => this._dialable(a)).map((a) => new TextEncoder().encode(a)));
      }
      default: return peer.misbehave(10, `neznámá zpráva ${type}`);
    }
  }

  /** Signed public RPC addresses from a peer: [[url, key, expires, signature], ...]. Checking them is up to watch/public-nodes.js. */
  _onPublicNodes(peer, b) {
    const list = b[0];
    if (!Array.isArray(list) || list.length > 32) return peer.misbehave(10, 'neplatný seznam veřejných uzlů');
    const now = Date.now();
    if (peer.publicNodesAt && now - peer.publicNodesAt < 60_000) return undefined;   // at most one list a minute per peer
    peer.publicNodesAt = now;
    const decoded = [];
    for (const item of list) {
      if (!Array.isArray(item) || item.length !== 4 || item.some((x) => !(x instanceof Uint8Array))) continue;
      decoded.push({ url: new TextDecoder().decode(item[0]), key: item[1], expires: Number(bytesToInt(item[2])), sig: item[3] });
    }
    this.emit('public-nodes', decoded, peer);
    return undefined;
  }

  /** Sends signed public RPC addresses to every peer that understands them (or only to `only`). */
  sendPublicNodes(entries, only = null) {
    if (!entries.length) return;
    const payload = [entries.map((e) => [new TextEncoder().encode(e.url), e.key, intToBytes(BigInt(e.expires)), e.sig])];
    for (const p of only ? [only] : this.peers) {
      if (p.ready && p.features & FEATURE_PUBLIC_NODES) p.send(MSG.PUBLIC_NODES, payload);
    }
  }

  _dialable(addr) {
    const [host, port] = splitAddr(addr);
    if (!isIP(host) || !(port > 0 && port < 65536)) return false;
    return this.allowPrivate || !isPrivate(host);
  }

  _onPeers(peer, list) {
    if (!Array.isArray(list)) return;
    for (const raw of list.slice(0, MAX_PEX)) {
      const addr = new TextDecoder().decode(raw);
      if (this._dialable(addr) && this.chain.store.peerCount() < MAX_KNOWN_PEERS) this.chain.store.peerLearned(addr);
    }
  }

  _onGetHeaders(peer, b) {
    const [id, locator, limitBytes] = b;
    if (!Array.isArray(locator) || locator.length > 64) return peer.misbehave(20, 'neplatný lokátor');
    if (peer.channel.queued > MAX_SEND_QUEUE) return peer.misbehave(25, 'žádá rychleji, než čte');
    const limit = Math.min(MAX_HEADERS, Number(bytesToInt(limitBytes)));
    const { chain } = this;
    let start = 0n;
    for (const hash of locator) {
      const h = chain.getHeader(hash);
      if (h && chain.isCanonical(hash, h.number)) { start = h.number + 1n; break; }
    }
    const out = [];
    for (let n = start; out.length < limit; n++) {
      const h = chain.getHeaderByNumber(n);
      if (!h) break;
      out.push(h.fields());
    }
    return peer.respond(MSG.HEADERS, id, out);
  }

  _onGetBlocks(peer, b) {
    const [id, hashes] = b;
    if (!Array.isArray(hashes) || hashes.length > MAX_BLOCKS) return peer.misbehave(20, 'příliš mnoho bloků v požadavku');
    if (peer.channel.queued > MAX_SEND_QUEUE) return peer.misbehave(25, 'žádá rychleji, než čte');
    const out = [];
    let size = 0;
    for (const hash of hashes) {
      const r = this.chain.store.blockGet(hash);
      if (!r) break;
      size += r.header.length + r.body.length;
      if (out.length && size > MAX_BLOCKS_BYTES) break;
      out.push([r.header, r.body]);
    }
    return peer.respond(MSG.BLOCKS, id, out);
  }

  async _onNewBlock(peer, b) {
    let block;
    try {
      block = Block.decode(b[0], this.chain.common);
    } catch (e) {
      return peer.misbehave(50, `poškozený blok: ${e.message}`);
    }
    if (!this.chain.pow.quickCheck(block.header)) return peer.misbehave(100, 'blok bez platné práce');
    return this._insert(peer, block);
  }

  async _insert(peer, block) {
    try {
      const r = await this.chain.insertBlock(block);
      if (r.status === 'orphan') this._maybeSync(peer, true);
      return r;
    } catch (e) {
      if (e instanceof InvalidBlock) peer.misbehave(100, `neplatný blok: ${e.message}`);
      else if (e instanceof TemporaryBlockError) this.temporary = true;
      else if (e instanceof FinalityError) {
        // An honest node from the other part of the network, not an attack: we stop downloading from it for a while but do not block it.
        this.deepRefused = true;
        this._pauseDeep(peer);
        this.log(`${L('Blok za hranicí finality od', 'Block beyond the finality limit from')} ${peer.address}: ${e.message}`);
      }
      else this.log(`${L('Chyba uzlu při zpracování bloku', 'Node error while processing a block')}: ${e.stack ?? e.message}`);
      return null;
    }
  }

  async _onNewTxs(peer, b) {
    if (!Array.isArray(b[0]) || b[0].length > MAX_TXS) return peer.misbehave(20, 'příliš mnoho transakcí');
    return this._acceptTxs(peer, b[0]);
  }

  /** Transactions from a peer, whether it sent them itself or we asked for them. */
  async _acceptTxs(peer, raws) {
    // Every transaction verifies its signature, so even validly signed spam without funds has a limit.
    if (!peer.txBudget.take(raws.length)) return peer.misbehave(5, 'příliš mnoho transakcí za sekundu');
    if (!this.txBudget.take(raws.length)) return undefined;
    const added = [];
    for (const raw of raws) {
      let tx;
      try {
        tx = decodeTx(raw, this.chain.commonAt(this.chain.head.number + 1n));
      } catch {
        peer.misbehave(10, 'poškozená transakce');
        continue;
      }
      const key = Buffer.from(tx.hash()).toString('hex');
      peer.markKnown(key);
      this.requested.delete(key);
      try {
        await this.mempool.add(tx);
        added.push(tx);
      } catch (e) {
        if (!(e instanceof MempoolError)) throw e;
        // An invalid signature cannot be explained by delay; the other reasons can.
        if (/podpis|neplatná transakce/.test(e.message)) peer.misbehave(10, e.message);
      }
    }
    if (added.length) this.broadcastTxs(added, peer);
    return undefined;
  }

  broadcastTxs(txs, except) {
    const ready = [...this.peers].filter((p) => p.ready && p !== except);
    const { full, announce } = splitRecipients(ready);
    const keys = txs.map((t) => Buffer.from(t.hash()).toString('hex'));
    const send = (p, type, encode) => {
      const fresh = txs.filter((_, i) => !p.known.has(keys[i]));
      if (!fresh.length) return;
      for (const t of fresh) p.markKnown(Buffer.from(t.hash()).toString('hex'));
      p.send(type, [fresh.map(encode)]);
    };
    for (const p of full) send(p, MSG.NEW_TXS, (t) => t.serialize());
    for (const p of announce) send(p, MSG.NEW_TX_HASHES, (t) => t.hash());
  }

  /** Announced hashes: we ask for transactions we do not have yet and that nobody is sending us right now. */
  async _onTxHashes(peer, b) {
    if (!Array.isArray(b[0]) || b[0].length > MAX_ANNOUNCE) return peer.misbehave(20, 'příliš mnoho hashů');
    const now = Date.now();
    const wanted = [];
    for (const hash of b[0]) {
      if (!(hash instanceof Uint8Array) || hash.length !== 32) return peer.misbehave(20, 'neplatný hash');
      const key = Buffer.from(hash).toString('hex');
      peer.markKnown(key);
      if (this.mempool.has(hash)) continue;
      const asked = this.requested.get(key);
      if (asked && now - asked < REQUEST_TTL_MS) continue;
      if (this.requested.size >= MAX_REQUESTED) this.requested.clear();
      this.requested.set(key, now);
      wanted.push(hash);
    }
    for (let i = 0; i < wanted.length; i += MAX_TXS) {
      const rows = await peer.request(MSG.GET_TXS, [wanted.slice(i, i + MAX_TXS)]).catch(() => null);
      if (!Array.isArray(rows) || rows.length > MAX_TXS) return undefined;
      await this._acceptTxs(peer, rows.filter((r) => r instanceof Uint8Array));
    }
    return undefined;
  }

  _onGetTxs(peer, b) {
    const [id, hashes] = b;
    if (!Array.isArray(hashes) || hashes.length > MAX_TXS) return peer.misbehave(20, 'příliš mnoho transakcí v požadavku');
    if (peer.channel.queued > MAX_SEND_QUEUE) return peer.misbehave(25, 'žádá rychleji, než čte');
    const out = [];
    let size = 0;
    for (const hash of hashes) {
      const tx = hash instanceof Uint8Array ? this.mempool.get(hash) : null;
      if (!tx) continue;
      const raw = tx.serialize();
      size += raw.length;
      if (size > MAX_TXS_BYTES) break;
      out.push(raw);
    }
    return peer.respond(MSG.TXS, id, out);
  }

  /** An announced block: if unknown, we request it from whoever announced it. */
  async _onBlockHash(peer, b) {
    const [hash, number, td] = b;
    if (!(hash instanceof Uint8Array) || hash.length !== 32) return peer.misbehave(20, 'neplatný hash bloku');
    if (td instanceof Uint8Array && bytesToInt(td) > peer.headTd) peer.updateHead(hash, bytesToInt(number), bytesToInt(td));
    if (this.chain.store.blockHas(hash) || this.chain.store.badReason(hash)) return undefined;
    const rows = await peer.request(MSG.GET_BLOCKS, [[hash]]).catch(() => null);
    if (!Array.isArray(rows) || !rows[0]) return undefined;
    let block;
    try {
      const header = Header.decode(rows[0][0]);
      if (!equal(header.hash(), hash)) return peer.misbehave(100, 'uzel poslal jiný blok');
      block = Block.decodeBody(header, rows[0][1], this.chain.commonAt);
    } catch (e) {
      return peer.misbehave(50, `poškozený blok: ${e.message}`);
    }
    if (!this.chain.pow.quickCheck(block.header)) return peer.misbehave(100, 'blok bez platné práce');
    return this._insert(peer, block);
  }

  _relayHead({ block }) {
    // By block age, not by sync state: that could be switched on even by a foreign false claim.
    if (this.chain.now() - Number(block.header.timestamp) > RELAY_MAX_AGE) return;
    const ready = [...this.peers].filter((p) => p.ready && !(p.headHash && equal(p.headHash, block.hash())));
    const { full, announce } = splitRecipients(ready);
    const body = [block.encode()];
    for (const p of full) p.send(MSG.NEW_BLOCK, body);
    if (announce.length) {
      const note = [block.hash(), intToBytes(block.header.number), intToBytes(this.chain.headTd)];
      for (const p of announce) p.send(MSG.NEW_BLOCK_HASH, note);
    }
  }

  _announceStatus() {
    const { chain } = this;
    const body = [chain.head.hash(), intToBytes(chain.head.number), intToBytes(chain.headTd)];
    for (const p of this.peers) if (p.ready) p.send(MSG.STATUS, body);
  }

  /** The peer with the most promised work that has not failed yet. */
  _bestPeer() {
    let best = null;
    const now = Date.now();
    for (const p of this.peers) {
      if ((p.deepForkUntil ?? 0) > now) continue;
      if (p.ready && p.headTd > this.chain.headTd && (!best || p.headTd > best.headTd)) best = p;
    }
    return best;
  }

  _maybeSync(peer, force = false) {
    if (this.syncing || this.stopped) return;
    const target = force && peer?.ready && !((peer.deepForkUntil ?? 0) > Date.now()) ? peer : this._bestPeer();
    if (target) this._sync(target).catch((e) => this.log(`${L('Synchronizace', 'Sync')}: ${e.message}`));
  }

  /** Locator: hashes from the tip back with growing gaps; the last one is genesis. */
  _locator() {
    const { chain } = this;
    const list = [];
    let n = chain.head.number;
    let step = 1n;
    while (n > 0n && list.length < 63) {
      list.push(chain.store.canonicalHash(n));
      if (list.length >= 10) step *= 2n;
      n -= step;
    }
    list.push(chain.genesis.hash());
    return list;
  }

  /**
   * Downloads from one peer and checks that it really delivers the promised work.
   * Whoever stays silent or fails to deliver gets penalty points and the next one is tried, so a single liar cannot stop the network.
   */
  async _sync(peer) {
    this.syncing = true;
    this.imported = 0;
    this.temporary = false;
    this.deepRefused = false;
    this.emit('sync-start', peer);
    // One failed sync costs at most one penalty, and a peer that simply dropped the connection costs none:
    // a disconnect is not a lie, and counting it twice banned an honest, busy seed (issue #37).
    let failed = false;
    try {
      await this._download(peer);
    } catch (e) {
      if (peer.ready && !peer.channel.closed) {
        failed = true;
        peer.misbehave(34, `synchronizace: ${e.message}`);
      }
    } finally {
      this.syncing = false;
      this.imported = 0;
      const { chain } = this;
      if (peer.ready && peer.headTd > chain.headTd) {
        if (!failed && !peer.channel.closed && !this.temporary && !this.deepRefused) peer.misbehave(34, 'nedodal slíbený řetězec');
        peer.updateHead(chain.head.hash(), chain.head.number, chain.headTd);
      }
      this.emit('sync-end', peer);
      this._announceStatus();
      if (!this.stopped) setImmediate(() => this._maybeSync());
    }
  }

  /** Headers and blocks in batches, so the chain length is not limited by the message size. */
  async _download(peer) {
    // The last downloaded header goes into the locator first. A side branch is not canonical, so the locator alone would
    // did not contain, and the other side would keep sending the same already known headers from the fork point.
    let from = null;
    for (;;) {
      if (this.stopped || !peer.ready) return undefined;
      const base = this._locator();
      const locator = from ? [from, ...base.slice(0, 62), base[base.length - 1]] : base;
      const raw = await peer.request(MSG.GET_HEADERS, [locator, intToBytes(BigInt(MAX_HEADERS))], HEADERS_TIMEOUT);
      if (!Array.isArray(raw)) return peer.misbehave(50, 'neplatné hlavičky');
      if (raw.length === 0) return undefined;
      if (raw.length > MAX_HEADERS) return peer.misbehave(50, 'příliš mnoho hlaviček');
      let headers;
      try {
        headers = raw.map((f) => Header.fromFields(f));
      } catch (e) {
        return peer.misbehave(50, `poškozená hlavička: ${e.message}`);
      }
      for (const h of headers) {
        if (!this.chain.pow.quickCheck(h)) return peer.misbehave(100, 'hlavička bez platné práce');
      }
      for (let i = 1; i < headers.length; i++) {
        if (!equal(headers[i].parentHash, headers[i - 1].hash()) || headers[i].number !== headers[i - 1].number + 1n) {
          return peer.misbehave(100, 'hlavičky nenavazují');
        }
      }
      if (!(await this._deepForkAllowed(peer, headers))) return undefined;
      const wanted = headers.filter((h) => !this.chain.store.blockHas(h.hash()));
      const last = headers[headers.length - 1].hash();
      if (from && equal(last, from)) return undefined;     // the other side keeps sending the same thing
      from = last;
      if (wanted.length === 0) {
        if (raw.length < MAX_HEADERS) return undefined;
        continue;
      }
      for (let i = 0; i < wanted.length;) {
        const batch = wanted.slice(i, i + MAX_BLOCKS);
        const rows = await peer.request(MSG.GET_BLOCKS, [batch.map((h) => h.hash())]);
        if (!Array.isArray(rows) || rows.length === 0) return peer.misbehave(20, 'uzel neposlal bloky');
        for (let j = 0; j < rows.length; j++) {
          let block;
          try {
            const header = Header.decode(rows[j][0]);
            if (!equal(header.hash(), batch[j]?.hash() ?? new Uint8Array(0))) return peer.misbehave(100, 'uzel poslal jiný blok');
            block = Block.decodeBody(header, rows[j][1], this.chain.commonAt);
          } catch (e) {
            return peer.misbehave(50, `poškozený blok: ${e.message}`);
          }
          const r = await this._insert(peer, block);
          if (!r || !peer.ready) return undefined;
          this.imported += 1;
        }
        i += rows.length;
        this.emit('sync-progress', this.chain.head.number, peer.headNumber);
      }
      if (raw.length < MAX_HEADERS) return undefined;
    }
  }

  /**
   * A branch that diverged from ours deeper than the finality boundary. The node downloads and verifies all its headers
   * including work, and accepts the branch only when it carries at least twice the work of our branch since the common ancestor.
   * This is how a split network converges and a node escapes a cheap fake branch. A deeper rewrite with less work stays forbidden.
   * @returns {Promise<boolean>} whether downloading blocks may continue
   */
  async _deepForkAllowed(peer, first) {
    const { chain } = this;
    const ancestor = chain.getHeader(first[0].parentHash);
    if (!ancestor || !chain.isCanonical(ancestor.hash(), ancestor.number)) return true;
    if (chain.head.number - ancestor.number <= BigInt(C.maxReorgDepth)) return true;
    if (ancestor.number <= chain.passedCheckpoint()) return this._refuseDeep(peer, ancestor, 'větev je pod kontrolním bodem');
    if (chain.deepPermit && equal(chain.deepPermit.hash, ancestor.hash()) && chain.deepPermit.until > Date.now()) return true;
    // Height and difficulty are checked before computing Ethash. Otherwise the other side chooses the height and the cache of its epoch would be
    // computed forever: a single header with height 10^30 would block the whole node.
    if (first[0].number !== ancestor.number + 1n) {
      peer.misbehave(100, 'hlavička hluboké větve má špatnou výšku');
      return false;
    }
    const minDifficulty = chain.network.minDifficulty ?? 1n;
    // Difficulty is computed the same way as when accepting a block (LWMA over the ancestors on this branch). Otherwise an attacker would choose
    // difficulty 1, produced 50,000 headers once for free and every node would spend minutes verifying them.
    const branch = new Map();
    const headerOf = (hash) => {
      const h = branch.get(Buffer.from(hash).toString('hex')) ?? chain.getHeader(hash);
      if (!h) throw new Error('chybí předek pro výpočet obtížnosti');
      return h;
    };
    const latest = BigInt(chain.now() + C.futureTimeLimit);
    let tip = ancestor;

    const ours = chain.headTd - chain.getTd(ancestor.hash());
    let theirs = 0n;
    let headers = first;
    let checked = 0;
    for (;;) {
      for (const h of headers) {
        if (h.difficulty < minDifficulty) {
          peer.misbehave(100, 'hlavička hluboké větve má obtížnost pod minimem sítě');
          return false;
        }
        if (h.timestamp <= tip.timestamp || h.timestamp > latest) {
          peer.misbehave(100, 'hlavička hluboké větve má neplatný čas');
          return false;
        }
        let expected;
        try { expected = nextDifficulty(tip, headerOf, chain.network); } catch { expected = null; }
        if (h.difficulty !== expected) {
          peer.misbehave(100, 'hlavička hluboké větve má špatnou obtížnost');
          return false;
        }
        branch.set(Buffer.from(h.hash()).toString('hex'), h);
        tip = h;
        if (!(await chain.pow.verify(h))) {
          peer.misbehave(100, 'hlavička hluboké větve bez platné práce');
          return false;
        }
        theirs += h.difficulty;
        checked += 1;
      }
      if (theirs >= DEEP_REORG_WORK_RATIO * ours) break;
      if (headers.length < MAX_HEADERS || checked >= MAX_DEEP_HEADERS || this.stopped || !peer.ready) {
        return this._refuseDeep(peer, ancestor, `větev nese ${theirs} práce, potřeba je ${DEEP_REORG_WORK_RATIO * ours}`);
      }
      const last = headers[headers.length - 1];
      const raw = await peer.request(MSG.GET_HEADERS, [[last.hash()], intToBytes(BigInt(MAX_HEADERS))], HEADERS_TIMEOUT);
      if (!Array.isArray(raw) || raw.length > MAX_HEADERS) {
        peer.misbehave(50, 'neplatné hlavičky');
        return false;
      }
      try {
        headers = raw.map((f) => Header.fromFields(f));
      } catch (e) {
        peer.misbehave(50, `poškozená hlavička: ${e.message}`);
        return false;
      }
      if (headers.length === 0) return this._refuseDeep(peer, ancestor, 'větev skončila bez dostatečné práce');
      let prev = last;
      for (const h of headers) {
        if (!equal(h.parentHash, prev.hash()) || h.number !== prev.number + 1n) {
          peer.misbehave(100, 'hlavičky nenavazují');
          return false;
        }
        prev = h;
      }
    }
    chain.permitDeepFork(ancestor);
    this.log(L(
      `VAROVÁNÍ: uzel ${peer.address} nabízí větev odpojenou v bloku ${ancestor.number} s více než dvojnásobnou prací, přecházím na ni`,
      `WARNING: node ${peer.address} offers a branch forked at block ${ancestor.number} with more than twice the work, switching to it`,
    ));
    this.emit('deep-fork', { peer, ancestor: ancestor.number, accepted: true });
    return true;
  }

  /** The pause applies to the address, so the node cannot bypass it with a new connection. */
  _pauseDeep(peer) {
    const until = Date.now() + DEEP_FORK_PAUSE_MS;
    peer.deepForkUntil = until;
    if (this.deepPauses.size >= MAX_BANS) this.deepPauses.delete(this.deepPauses.keys().next().value);
    this.deepPauses.set(this._pauseKey(peer), until);
  }

  /** On a local network and in tests several nodes run on one address; there the pause is also tied to the port. */
  _pauseKey(peer) {
    return this.allowPrivate && isPrivate(peer.address) ? `${peer.address}:${peer.listenPort}` : peer.address;
  }

  _refuseDeep(peer, ancestor, reason) {
    this.deepRefused = true;
    this._pauseDeep(peer);
    this.log(L(
      `Uzel ${peer.address} je na větvi odpojené v bloku ${ancestor.number}, za hranicí finality: ${reason}`,
      `Node ${peer.address} is on a branch forked at block ${ancestor.number}, beyond the finality limit: ${reason}`,
    ));
    this.emit('deep-fork', { peer, ancestor: ancestor.number, accepted: false, reason });
    return false;
  }

  _keepAlive() {
    const now = Date.now();
    for (const p of this.peers) {
      p.forgive(FORGIVE_POINTS);
      if (now - p.lastSeen > PEER_TIMEOUT) p.disconnect('uzel neodpovídá');
      else if (p.ready) p.send(MSG.PING, []);
    }
  }

  /**
   * Asks a peer for the header right after `parent` in its chain. The answer is the peer's block at that height,
   * or an earlier one when it does not have `parent` on its main branch. A header without valid work counts as no answer.
   * Used by the chain watch (watch/peers.js); nothing is downloaded or executed.
   */
  async probeHeader(peer, parent) {
    if (!peer.ready) return null;
    const raw = await peer.request(MSG.GET_HEADERS, [[parent], intToBytes(1n)], HEADERS_TIMEOUT);
    if (!Array.isArray(raw) || raw.length !== 1) return null;
    let h;
    try {
      h = Header.fromFields(raw[0]);
    } catch {
      return null;
    }
    if (h.number > 0n && !this.chain.pow.quickCheck(h)) return null;
    return h;
  }

  _askPeers() {
    for (const p of this.peers) {
      if (p.ready) p.request(MSG.GET_PEERS, []).then((l) => this._onPeers(p, l)).catch(() => {});
    }
  }

  /**
   * Choosing addresses for outbound connections. Most go to verified nodes, the rest try new ones,
   * always only one address per range and in random order. An attacker thus cannot eclipse the node
   * by flooding with addresses, even with many addresses in one network.
   */
  _pickOutbound(count) {
    const { store } = this.chain;
    const groupOf = (addr) => {
      const [host] = splitAddr(addr);
      return isPrivate(host) ? addr : ipGroup(host);
    };
    const used = new Set();
    for (const p of this.peers) if (!p.inbound) used.add(groupOf(`${p.address}:${p.listenPort}`));
    const self = new Set([`127.0.0.1:${this.port}`, `${this.host}:${this.port}`]);
    const out = [];
    const take = (list, limit) => {
      for (const addr of list) {
        if (out.length >= limit) return;
        const group = groupOf(addr);
        if (self.has(addr) || used.has(group) || this.dialing.has(addr)) continue;
        used.add(group);
        out.push(addr);
      }
    };
    const newSlots = Math.floor(count * OUTBOUND_NEW_SHARE);
    take(shuffled(this.seeds), count);
    take(shuffled(store.peersTried(1024)), count - newSlots);
    take(shuffled(store.peersNew(1024)), count);
    return out;
  }

  _dialLoop() {
    if (this.stopped) return;
    const outbound = [...this.peers].filter((p) => !p.inbound).length + this.dialing.size;
    const free = this.maxOutbound - outbound;
    if (free <= 0) return;
    for (const addr of this._pickOutbound(free)) {
      const [host, port] = splitAddr(addr);
      if ([...this.peers].some((p) => p.address === host && p.listenPort === port)) continue;
      this.connect(host, port);
    }
  }
}
