// Stratum server for common Windows miners (lolMiner, T-Rex, TeamRedMiner and others).
// Supports ETHPROXY and EthereumStratum/1.0.0 modes. The login name is the payout address,
// optionally with a device name: 0xADDRESS.rig1. No account or registration is needed.
import { isLocalCaller } from '../p2p/upnp.js';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { fromHex, quantity, toHex } from '../util/bytes.js';
import { WorkError } from './work.js';

const MAX_LINE = 4096;
const STALE_JOBS = 8;
const MAX_SUBMITS_PER_SECOND = 8;      // results come only at network difficulty; honestly they are rare
const MAX_SESSIONS = 1024;
const MAX_SESSIONS_PER_IP = 128;
// A miner logs in once; asking for work happens on a new block. More than this means someone creates devices or jobs in bulk.
const MAX_LOGINS = 4;
const MAX_WORK_REQUESTS_PER_SECOND = 4;
const unprefixed = (h) => h.replace(/^0x/, '');

class Session {
  constructor(socket, server) {
    this.socket = socket;
    this.server = server;
    this.buffer = '';
    this.mode = null;           // 'proxy' | 'nicehash'
    this.miner = null;
    this.worker = 'rig';
    this.extranonce = randomBytes(2).toString('hex');
    this.jobs = new Map();
    this.lastTarget = null;
    this.rate = { start: 0, n: 0 };
    this.logins = 0;
    this.workRate = { start: 0, n: 0 };
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.setTimeout(600_000, () => socket.destroy());
    socket.on('data', (d) => this._data(d));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => server.sessions.delete(this));
  }

  _data(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE * 8) { this.socket.destroy(); return; }
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.socket.destroy(); return; }
      this._message(msg).catch((e) => this.server.log(`Stratum: ${e.message}`));
    }
  }

  send(o) { if (!this.socket.destroyed) this.socket.write(`${JSON.stringify(o)}\n`); }
  reply(id, result, error = null) { this.send({ id, jsonrpc: '2.0', result, error }); }

  _login(raw) {
    if (++this.logins > MAX_LOGINS) { this.socket.destroy(); return false; }
    const [address, ...rest] = String(raw ?? '').split('.');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
    this.miner = fromHex(address);
    if (rest.length) this.worker = rest.join('.').slice(0, 32);
    return true;
  }

  /** Verifying a result costs CPU, so each connection has a submission limit. */
  _allowSubmit() {
    const now = Date.now();
    if (now - this.rate.start >= 1000) this.rate = { start: now, n: 0 };
    this.rate.n += 1;
    if (this.rate.n <= MAX_SUBMITS_PER_SECOND) return true;
    this.socket.destroy();
    return false;
  }

  /** Each request for work can create a new job, so it has its own limit. */
  _allowWork() {
    const now = Date.now();
    if (now - this.workRate.start >= 1000) this.workRate = { start: now, n: 0 };
    this.workRate.n += 1;
    if (this.workRate.n <= MAX_WORK_REQUESTS_PER_SECOND) return true;
    this.socket.destroy();
    return false;
  }

  async _message(m) {
    const { id, method, params = [] } = m;
    if ((method === 'mining.submit' || method === 'eth_submitWork') && !this._allowSubmit()) return undefined;
    if (!Array.isArray(params)) { this.socket.destroy(); return undefined; }
    switch (method) {
      case 'mining.subscribe': {
        this.mode = 'nicehash';
        return this.send({ id, error: null, result: [['mining.notify', randomBytes(16).toString('hex'), 'EthereumStratum/1.0.0'], this.extranonce] });
      }
      case 'mining.extranonce.subscribe': return this.send({ id, error: null, result: true });
      case 'mining.authorize': {
        const ok = this._login(params[0]);
        this.send({ id, error: ok ? null : [24, 'Neplatná adresa výplaty', null], result: ok });
        if (ok) await this.pushWork();
        return undefined;
      }
      case 'mining.submit': return this._submitNiceHash(id, params);
      case 'eth_submitLogin': {
        this.mode = 'proxy';
        const ok = this._login(params[0]);
        if (m.worker) this.worker = String(m.worker).slice(0, 32);
        this.reply(id, ok, ok ? null : { code: -1, message: 'Neplatná adresa výplaty' });
        return undefined;
      }
      case 'eth_getWork': {
        if (!this._allowWork()) return undefined;
        if (!this.miner) return this.reply(id, null, { code: -1, message: 'Nejprve se přihlaste' });
        const work = await this._work();
        return work ? this.reply(id, this._proxyJob(work)) : this.reply(id, null, { code: -1, message: 'Uzel se synchronizuje' });
      }
      case 'eth_submitWork': {
        const r = await this._submit(fromHex(params[0]), fromHex(params[1]), fromHex(params[2]));
        this._count(r);
        return this.reply(id, r.accepted);
      }
      case 'eth_submitHashrate': {
        this.server.work.reportHashrate(`${toHex(this.miner ?? new Uint8Array(0))}.${this.worker}`, BigInt(params[0]));
        return this.reply(id, true);
      }
      default:
        return this.send({ id, error: [20, 'Neznámá metoda', null], result: null });
    }
  }

  _count(r) {
    if (r.accepted) this.server.stats.accepted += 1;
    else this.server.stats.rejected += 1;
  }

  /** In a pool each device gets its own header and results count as shares. */
  _submit(nonce, sealHash, mixDigest) {
    const { pool, work } = this.server;
    return pool ? pool.submit(nonce, sealHash, mixDigest) : work.submit(nonce, sealHash, mixDigest);
  }

  async _work() {
    const { pool, work } = this.server;
    try {
      return await (pool ? pool.workFor(this.miner, this.worker) : work.getWork(this.miner));
    } catch (e) {
      if (e instanceof WorkError) return null;
      throw e;
    }
  }

  _proxyJob(w) {
    return [toHex(w.sealHash), toHex(w.seedHash), `0x${w.target >= 2n ** 256n ? 'f'.repeat(64) : w.target.toString(16).padStart(64, '0')}`, quantity(w.number)];
  }

  async pushWork() {
    if (!this.miner) return;
    const w = await this._work();
    if (!w) return;
    if (this.mode === 'proxy') {
      this.send({ id: 0, jsonrpc: '2.0', result: this._proxyJob(w) });
      return;
    }
    if (this.mode === 'nicehash') {
      if (this.lastTarget !== w.target) {
        this.lastTarget = w.target;
        // The unit of mining.set_difficulty is 2^32 hashes.
        this.send({ id: null, method: 'mining.set_difficulty', params: [Number(w.difficulty) / 4294967296] });
      }
      const jobId = randomBytes(4).toString('hex');
      this.jobs.set(jobId, w);
      if (this.jobs.size > STALE_JOBS) this.jobs.delete(this.jobs.keys().next().value);
      this.send({ id: null, method: 'mining.notify', params: [jobId, unprefixed(toHex(w.seedHash)), unprefixed(toHex(w.sealHash)), true] });
    }
  }

  async _submitNiceHash(id, params) {
    const [, jobId, nonceSuffix] = params;
    const w = this.jobs.get(jobId);
    if (!w) return this.send({ id, error: [21, 'Stará práce', null], result: false });
    const nonce = fromHex(this.extranonce + unprefixed(String(nonceSuffix)));
    if (nonce.length !== 8) return this.send({ id, error: [20, 'Neplatné nonce', null], result: false });
    const { mixDigest } = await this.server.chain.pow.compute(w.sealHash, nonce, w.number);
    const r = await this._submit(nonce, w.sealHash, mixDigest);
    this._count(r);
    return this.send({ id, error: r.accepted ? null : [20, r.reason ?? 'Odmítnuto', null], result: r.accepted });
  }
}

export class StratumServer {
  /**
   * @param {number} [o.maxSessions] how many devices the node serves; a large pool raises the limit
   * @param {number} [o.maxSessionsPerIp] a farm behind one public address needs more than a home miner
   */
  constructor({ chain, work, host = '127.0.0.1', port = 3333, maxSessions = MAX_SESSIONS, maxSessionsPerIp = MAX_SESSIONS_PER_IP, localOnlyWithoutPool = false, log = () => {} }) {
    Object.assign(this, { chain, work, host, port, maxSessions, maxSessionsPerIp, localOnlyWithoutPool, log });
    this.sessions = new Set();
    this.perIp = new Map();
    this.stats = { accepted: 0, rejected: 0 };
    this._push = () => { for (const s of this.sessions) s.pushWork().catch(() => {}); };
  }

  async start() {
    this.server = net.createServer((socket) => {
      const ip = socket.remoteAddress;
      // A node open to the internet without a pool serves only miners from the local network. Foreign miners are served only by a pool.
      if (this.localOnlyWithoutPool && !this.pool && !isLocalCaller(ip)) { socket.destroy(); return; }
      const fromIp = this.perIp.get(ip) ?? 0;
      if (this.sessions.size >= this.maxSessions || fromIp >= this.maxSessionsPerIp) {
        socket.destroy();
        return;
      }
      this.perIp.set(ip, fromIp + 1);
      socket.once('close', () => {
        const left = this.perIp.get(ip) - 1;
        if (left > 0) this.perIp.set(ip, left);
        else this.perIp.delete(ip);
      });
      this.sessions.add(new Session(socket, this));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.port = this.server.address().port;
    this.work.on('new-head', this._push);
  }

  async stop() {
    this.work.off('new-head', this._push);
    for (const s of this.sessions) s.socket.destroy();
    await new Promise((r) => this.server.close(() => r()));
  }
}
