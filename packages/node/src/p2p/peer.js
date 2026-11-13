// Jeden připojený uzel: požadavky s odpovědí, limity provozu a počítání prohřešků.
import { EventEmitter } from 'node:events';
import { RLP } from '@ethereumjs/rlp';
import { bytesToInt, intToBytes } from '../util/bytes.js';
import { MSG } from './wire.js';

export const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT = 20_000;
const BAN_THRESHOLD = 100;
const OVER_LIMIT_POINTS = 10;
const MAX_MSGS_PER_SECOND = 512;
const MAX_BYTES_PER_SECOND = 64 * 1024 * 1024;
const MAX_KNOWN = 32_768;

/** Omezení rychlosti: za sekundu přibude `rate` žetonů až do stropu `burst`. */
export class Bucket {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = Date.now();
  }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

// Zpráva za sekundu a povolený nárazový objem. Čte se podle ceny obsluhy,
// poctivý uzel při synchronizaci posílá vždy jen jeden požadavek najednou.
const BUDGET = {
  [MSG.GET_HEADERS]: [8, 32],
  [MSG.GET_BLOCKS]: [16, 64],
  [MSG.NEW_BLOCK]: [4, 16],
  [MSG.NEW_TXS]: [16, 64],
  [MSG.GET_PEERS]: [0.05, 4],
  [MSG.STATUS]: [1, 8],
  [MSG.PING]: [1, 8],
  [MSG.PONG]: [1, 8],
  [MSG.HELLO]: [1, 2],
  [MSG.NEW_TX_HASHES]: [16, 64],
  [MSG.GET_TXS]: [16, 64],
  [MSG.NEW_BLOCK_HASH]: [4, 16],
};

export class Peer extends EventEmitter {
  constructor(channel, address, inbound) {
    super();
    this.channel = channel;
    this.address = address;      // IP uzlu
    this.inbound = inbound;
    this.ready = false;
    this.score = 0;
    this.lastSeen = Date.now();
    this.nextId = 1n;
    this.pending = new Map();
    this.window = { start: Date.now(), msgs: 0, bytes: 0 };
    this.budget = Object.fromEntries(Object.entries(BUDGET).map(([t, [r, b]]) => [t, new Bucket(r, b)]));
    this.txBudget = new Bucket(64, 256);
    this.headHash = null;
    this.headNumber = 0n;
    this.headTd = 0n;
    this.listenPort = 0;
    this.nodeId = null;
    this.agent = '';
    this.features = 0;
    this.known = new Set();       // hashe transakcí, které uzel má nebo mu byly poslány
    channel.on('frame', (type, payload) => this._onFrame(type, payload));
    channel.on('close', (reason) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('uzel se odpojil')); }
      this.pending.clear();
      this.emit('close', reason);
    });
  }

  /** Zapamatuje si, že uzel transakci zná, aby se mu znovu neposílala. Paměť je omezená. */
  markKnown(hash) {
    if (this.known.size >= MAX_KNOWN) this.known = new Set();
    this.known.add(hash);
  }

  /** Celkové omezení provozu, platí pro všechny zprávy včetně odpovědí. */
  _withinLimits(size) {
    const now = Date.now();
    const w = this.window;
    if (now - w.start >= 1000) {
      w.start = now;
      w.msgs = 0;
      w.bytes = 0;
    }
    w.msgs += 1;
    w.bytes += size;
    return w.msgs <= MAX_MSGS_PER_SECOND && w.bytes <= MAX_BYTES_PER_SECOND;
  }

  _onFrame(type, payload) {
    this.lastSeen = Date.now();
    if (!this._withinLimits(payload.length)) {
      this.misbehave(20, 'příliš mnoho zpráv');
      return;
    }
    // Limit podle typu se hlídá před dekódováním, přebytečná zpráva nestojí téměř nic.
    const bucket = this.budget[type];
    if (bucket && !bucket.take()) {
      this.misbehave(OVER_LIMIT_POINTS, `příliš mnoho zpráv typu ${type}`);
      return;
    }
    let body;
    try {
      body = payload.length ? RLP.decode(payload) : [];
    } catch {
      this.misbehave(50, 'poškozená zpráva');
      return;
    }
    if (type === MSG.HEADERS || type === MSG.BLOCKS || type === MSG.PEERS || type === MSG.TXS) {
      const id = body[0] ? bytesToInt(body[0]) : 0n;
      const req = this.pending.get(id);
      if (req) {
        this.pending.delete(id);
        clearTimeout(req.timer);
        req.resolve(body[1]);
        return;
      }
      this.misbehave(10, 'nevyžádaná odpověď');
      return;
    }
    this.emit('message', type, body);
  }

  send(type, body) { return this.channel.send(type, Buffer.from(RLP.encode(body))); }

  /** Požadavek s odpovědí: první pole těla je vždy identifikátor. */
  request(type, body, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('uzel neodpověděl včas'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send(type, [intToBytes(id), ...body]);
    });
  }

  respond(type, idBytes, data) { this.send(type, [idBytes, data]); }

  updateHead(hash, number, td) {
    this.headHash = hash;
    this.headNumber = number;
    this.headTd = td;
  }

  misbehave(points, reason) {
    this.score += points;
    this.emit('misbehave', points, reason);
    if (this.score >= BAN_THRESHOLD) this.emit('ban', reason);
  }

  /** Staré prohřešky časem odeznívají, občasný výpadek poctivého uzlu nevede k blokaci. */
  forgive(points) { this.score = Math.max(0, this.score - points); }

  disconnect(reason) { this.channel.close(reason); }
}
