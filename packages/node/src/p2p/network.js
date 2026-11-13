// Síť uzlů bez centrální registry: seed uzly slouží jen pro první kontakt,
// dál si uzly vyměňují adresy samy a pamatují si je v databázi.
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
const SEED_RESOLVE_INTERVAL = 1_800_000;   // seed jako doménové jméno: adresy se mohou změnit bez nové verze
const SEED_RESOLVE_WAIT = 3000;
const BAN_MS = 3_600_000;
const MAX_HEADERS = 256;
const MAX_BLOCKS = 64;
const MAX_BLOCKS_BYTES = 8 * 1024 * 1024;
const MAX_TXS = 256;
const MAX_PEX = 64;
const MAX_PER_IP = 3;
const MAX_PER_GROUP = 6;            // příchozích spojení z jednoho rozsahu /16
const MAX_KNOWN_PEERS = 10000;
const MAX_LAN_PEERS = 64;
const LAN_DIAL_JITTER = 2_000;
const MAX_BANS = 4096;
const HEADERS_TIMEOUT = 8_000;      // lhář o práci se pozná rychle, hlavičky jsou levné
const MAX_SEND_QUEUE = 8 * 1024 * 1024;
const FORGIVE_POINTS = 3;           // za každý interval PING
const BEHIND_AFTER = 32;            // od tolika stažených bloků se uzel považuje za opožděný
const RELAY_MAX_AGE = 120;          // sekund, starší bloky se při synchronizaci nešíří
const OUTBOUND_NEW_SHARE = 0.25;    // část odchozích spojení zkouší neověřené adresy
const GLOBAL_TX_RATE = [512, 1024];
// Předání fronty novému sousedovi: příjemce bere od jednoho uzlu 64 transakcí za sekundu.
const TX_SYNC_BATCH = 48;
const TX_SYNC_INTERVAL = 1_000;
// Schopnosti v HELLO. Ohlášení hashů dostane jen uzel, který je umí, starší dál dostává celé transakce a bloky.
export const FEATURE_ANNOUNCE = 1;
const FEATURES = FEATURE_ANNOUNCE;
const MAX_ANNOUNCE = 1024;          // hashů v jednom ohlášení
const MAX_TXS_BYTES = 8 * 1024 * 1024;
const REQUEST_TTL_MS = 5_000;       // jak dlouho se na vyžádanou transakci čeká, než ji smí nabídnout jiný uzel
const MAX_REQUESTED = 65_536;

/**
 * Komu poslat celou zprávu: všem starším uzlům a odmocnině z počtu nových. Ostatní nové dostanou jen hash
 * a o obsah si řeknou, pokud ho ještě nemají. Provoz tak roste s odmocninou počtu sousedů, ne s jejich počtem,
 * a zpráva se přesto dostane ke všem stejně rychle jako dřív, protože celou ji dostane hned několik uzlů.
 */
function splitRecipients(peers) {
  const legacy = [];
  const capable = [];
  for (const p of peers) (p.features & FEATURE_ANNOUNCE ? capable : legacy).push(p);
  const mixed = shuffled(capable);
  const full = Math.ceil(Math.sqrt(mixed.length));
  return { full: [...legacy, ...mixed.slice(0, full)], announce: mixed.slice(full) };
}
// Větev odpojená hlouběji než hranice finality: kolik hlaviček se nejvýš ověří a jak dlouho se od uzlu nestahuje,
// když jeho větev neunese dvojnásobek práce. Ověření jedné hlavičky stojí jeden výpočet Ethash.
const MAX_DEEP_HEADERS = 50_000;
const DEEP_FORK_PAUSE_MS = 10 * 60_000;

// Rozsahy, které nejsou veřejný internet: místní sítě, smyčka, sdílený rozsah operátorů (CGNAT), dokumentační,
// vícesměrové a vyhrazené adresy. Uzel se na ně z výměny adres nepřipojuje, jinak by ho šlo poslat do cizí vnitřní sítě.
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

/** Skupina adres: útočník má snazší přístup k adresám jedné sítě než k mnoha různým. */
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
   * @param {boolean} [o.allowPrivate] povolit lokální adresy, jen pro testy a vlastní LAN
   * @param {boolean|object} [o.lan] hledat uzly v místní síti, objekt upravuje nastavení v testech
   * @param {NodeIdentity} [o.identity] trvalý klíč uzlu, bez něj vznikne klíč jen pro tento běh
   * @param {boolean} [o.requireIdentity] odmítnout uzly bez podepsané identity (starší verze)
   */
  constructor({ chain, mempool, port, host = '0.0.0.0', seeds = [], maxOutbound = 8, maxInbound = 32, allowPrivate = false, lan = false, agent = 'quintium-node/2.0.0', identity = null, requireIdentity = false, log = () => {} }) {
    super();
    Object.assign(this, { chain, mempool, port, host, maxOutbound, maxInbound, allowPrivate, lan, agent, requireIdentity, log });
    // Seed může mít připnutý klíč (`klíč@host:port`). Spojení s ním pak projde jen s jeho podpisem,
    // takže ani podvržené DNS nebo útočník na cestě nepodstrčí novému uzlu cizí síť.
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
    this.requested = new Map();      // hash transakce -> čas žádosti
    this.deepPauses = new Map();     // IP -> do kdy se od ní nestahuje větev za hranicí finality, přežije nové spojení
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
    // Pomalé DNS nesmí zdržet start: po krátké chvíli se vytáčí i bez něj a adresy doplní pozdější kolo.
    await Promise.race([this._resolveSeeds().catch(() => {}), new Promise((r) => { setTimeout(r, SEED_RESOLVE_WAIT).unref(); })]);
    this._dialLoop();
    if (this.lan) await this._startDiscovery();
  }

  /**
   * Seed zadaný jménem (seed.domena.cz) může mít víc adres. Všechny se zapíšou mezi známé uzly, takže když
   * jeden server neběží, uzel zkusí další. Samotné jméno se dál vytáčí také, rozhodne systémové DNS.
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

  /** Uzel ohlášený v místní síti. Ověří se jako každý jiný, jen se k němu smí připojit i na lokální adresu. */
  _onLanPeer(ip, port, nodeId) {
    if (this.stopped) return;
    if (!this.lanPeers.has(ip) && this.lanPeers.size >= MAX_LAN_PEERS) return;
    this.lanPeers.add(ip);
    // Počítač se dvěma rozhraními se ozve ze dvou adres, spojení k němu už ale stačí jedno.
    if ([...this.peers].some((p) => p.nodeId && Buffer.from(p.nodeId).toString('hex') === nodeId)) return;
    // Oba uzly se slyší zároveň. Náhodný odstup brání tomu, aby se dvě souběžná spojení navzájem zrušila.
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
   * Skutečné opoždění, ne jen probíhající synchronizace. Tvrzení cizího uzlu o jeho práci nic nedokazuje,
   * proto se těžba a šíření bloků zastaví až podle bloků, které opravdu prošly ověřením.
   */
  get behind() { return this.syncing && this.imported >= BEHIND_AFTER; }

  peersInfo() {
    return [...this.peers].filter((p) => p.ready).map((p) => ({
      address: `${p.address}:${p.listenPort}`, inbound: p.inbound, agent: p.agent, height: Number(p.headNumber), td: p.headTd.toString(),
      id: p.nodeId ? Buffer.from(p.nodeId).toString('hex') : null, verified: !!p.verified,
    }));
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
        this.bans.set(ip, Date.now() + BAN_MS);
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
   * Prvních 11 polí zná každá verze. Za nimi je identita (veřejný klíč a podpis otisku spojení) a seznam schopností.
   * Starší uzly pole navíc přeskočí, takže se s novými domluví dál.
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

  /** Ověří identitu protistrany. @returns {string|null} důvod odmítnutí */
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
    // Ověřená je jen adresa, na kterou jsme se sami připojili. Příchozí uzel může port jen tvrdit.
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
   * Nově připojený uzel dostane čekající transakce. Jinak by k němu nikdy nedošly ty, které síť rozeslala, když
   * ještě nebyl připojený, a pokud těží jen on, zůstaly by viset. Posílá se po dávkách v tempu, které příjemce
   * přijme bez trestu za zahlcení.
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
        return this._maybeSync(peer);
      }
      case MSG.GET_HEADERS: return this._onGetHeaders(peer, b);
      case MSG.GET_BLOCKS: return this._onGetBlocks(peer, b);
      case MSG.NEW_BLOCK: return this._onNewBlock(peer, b);
      case MSG.NEW_TXS: return this._onNewTxs(peer, b);
      case MSG.NEW_TX_HASHES: return this._onTxHashes(peer, b);
      case MSG.GET_TXS: return this._onGetTxs(peer, b);
      case MSG.NEW_BLOCK_HASH: return this._onBlockHash(peer, b);
      case MSG.GET_PEERS: {
        // Ověřené i neověřené: seed uzel se sám nepřipojuje, přesto musí předávat adresy uzlů, které ho našly.
        // Podvrhy tím neškodí, příjemce je drží stranou a věnuje jim jen malou část odchozích spojení.
        const { store } = this.chain;
        const half = MAX_PEX / 2;
        const list = [...shuffled(store.peersTried(MAX_PEX * 4)).slice(0, half), ...shuffled(store.peersNew(MAX_PEX * 4)).slice(0, half)];
        return peer.respond(MSG.PEERS, b[0], list.filter((a) => this._dialable(a)).map((a) => new TextEncoder().encode(a)));
      }
      default: return peer.misbehave(10, `neznámá zpráva ${type}`);
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
        // Poctivý uzel z druhé části sítě, ne útok: od uzlu se chvíli nestahuje, ale neblokuje se.
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

  /** Transakce od uzlu, ať je poslal sám, nebo jsme si o ně řekli. */
  async _acceptTxs(peer, raws) {
    // Podpis ověřuje každá transakce, proto má limit i platně podepsaný spam bez krytí.
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
        // Neplatný podpis nejde vysvětlit zpožděním, ostatní důvody ano.
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

  /** Ohlášené hashe: o transakce, které ještě nemáme a nikdo nám je právě neposílá, si řekneme. */
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

  /** Ohlášený blok: neznámý si vyžádáme od toho, kdo ho ohlásil. */
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
    // Podle stáří bloku, ne podle stavu synchronizace: tu může zapnout i cizí lživé tvrzení.
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

  /** Uzel s největší slíbenou prací, který ji ještě nezklamal. */
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

  /** Lokátor: hashe od špičky zpět s rostoucími rozestupy, poslední je genesis. */
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
   * Stahuje od jednoho uzlu a hlídá, že slibovanou práci opravdu dodá.
   * Kdo mlčí nebo nedodá, dostane body a přijde na řadu další, takže jediný lhář síť nezastaví.
   */
  async _sync(peer) {
    this.syncing = true;
    this.imported = 0;
    this.temporary = false;
    this.deepRefused = false;
    this.emit('sync-start', peer);
    try {
      await this._download(peer);
    } catch (e) {
      if (peer.ready) peer.misbehave(34, `synchronizace: ${e.message}`);
    } finally {
      this.syncing = false;
      this.imported = 0;
      const { chain } = this;
      if (peer.ready && peer.headTd > chain.headTd) {
        if (!this.temporary && !this.deepRefused) peer.misbehave(34, 'nedodal slíbený řetězec');
        peer.updateHead(chain.head.hash(), chain.head.number, chain.headTd);
      }
      this.emit('sync-end', peer);
      this._announceStatus();
      if (!this.stopped) setImmediate(() => this._maybeSync());
    }
  }

  /** Hlavičky a bloky po dávkách, velikost řetězce tak není omezena velikostí zprávy. */
  async _download(peer) {
    // Poslední stažená hlavička jde do lokátoru první. Postranní větev není kanonická, takže by ji samotný lokátor
    // neobsahoval a protistrana by posílala pořád stejné, už známé hlavičky od rozdvojení.
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
      if (from && equal(last, from)) return undefined;     // protistrana posílá pořád totéž
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
   * Větev, která se od naší odpojila hlouběji než hranice finality. Uzel stáhne a ověří všechny její hlavičky
   * včetně práce a větev přijme, jen když nese aspoň dvojnásobek práce naší větve od společného předka.
   * Tak se srovná rozdělená síť a uzel se dostane z levné falešné větve. Hlubší přepis s menší prací zůstává zakázaný.
   * @returns {Promise<boolean>} smí se pokračovat stahováním bloků
   */
  async _deepForkAllowed(peer, first) {
    const { chain } = this;
    const ancestor = chain.getHeader(first[0].parentHash);
    if (!ancestor || !chain.isCanonical(ancestor.hash(), ancestor.number)) return true;
    if (chain.head.number - ancestor.number <= BigInt(C.maxReorgDepth)) return true;
    if (ancestor.number <= chain.passedCheckpoint()) return this._refuseDeep(peer, ancestor, 'větev je pod kontrolním bodem');
    if (chain.deepPermit && equal(chain.deepPermit.hash, ancestor.hash()) && chain.deepPermit.until > Date.now()) return true;
    // Výška a obtížnost se hlídají před výpočtem Ethash. Výšku si jinak volí protistrana a cache její epochy by se
    // počítala navždy: jediná hlavička s výškou 10^30 by zablokovala celý uzel.
    if (first[0].number !== ancestor.number + 1n) {
      peer.misbehave(100, 'hlavička hluboké větve má špatnou výšku');
      return false;
    }
    const minDifficulty = chain.network.minDifficulty ?? 1n;
    // Obtížnost se počítá stejně jako při přijetí bloku (LWMA nad předky na této větvi). Jinak by si útočník zvolil
    // obtížnost 1, vyrobil jednou 50 000 hlaviček zadarmo a každý uzel by je minuty ověřoval.
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

  /** Pauza platí pro adresu, takže ji uzel neobejde novým spojením. */
  _pauseDeep(peer) {
    const until = Date.now() + DEEP_FORK_PAUSE_MS;
    peer.deepForkUntil = until;
    if (this.deepPauses.size >= MAX_BANS) this.deepPauses.delete(this.deepPauses.keys().next().value);
    this.deepPauses.set(this._pauseKey(peer), until);
  }

  /** V místní síti a v testech běží víc uzlů na jedné adrese, tam se pauza váže i na port. */
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

  _askPeers() {
    for (const p of this.peers) {
      if (p.ready) p.request(MSG.GET_PEERS, []).then((l) => this._onPeers(p, l)).catch(() => {});
    }
  }

  /**
   * Výběr adres pro odchozí spojení. Většina míří na ověřené uzly, zbytek zkouší nové,
   * vždy jen jedna adresa z rozsahu a v náhodném pořadí. Útočník tak nemůže obklíčit uzel
   * zaplavením adresami, ani kdyby měl mnoho adres v jedné síti.
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
