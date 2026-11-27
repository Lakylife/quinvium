// A small CPU miner for the testnet. It connects to a node's Stratum port (ETHPROXY mode), holds the full DAG
// in memory and keeps the testnet producing blocks when no one mines it with a graphics card.
// It is far too slow for mainnet. How much CPU it may take is set by the service manager (CPUQuota, Nice).
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToBigInt, cacheSize, datasetSize, epochOf, generateCache, generateDataset, hashimotoFull, hashimotoLight, seedHash } from '../crypto/ethash.js';
import { fromHex, toHex } from '../util/bytes.js';

const BATCH = 4096;                 // hashes between looks at the socket
const HASHRATE_EVERY_MS = 60_000;
const RECONNECT_MS = 5_000;

export class CpuMiner {
  /**
   * @param {object} o
   * @param {string} o.host Stratum host
   * @param {number} o.port Stratum port
   * @param {string} o.address payout address 0x...
   * @param {string} [o.worker] device name
   * @param {string|null} [o.dagDir] folder where the DAG of the current epoch is kept between restarts
   * @param {(line: string) => void} [o.log]
   */
  constructor({ host, port, address, worker = 'cpu', dagDir = null, log = console.log }) {
    Object.assign(this, { host, port, address, worker, dagDir, log });
    this.job = null;
    this.epoch = null;
    this.dataset = null;
    this.running = false;
    this.socket = null;
    this.nextId = 1;
    this.stats = { hashes: 0, found: 0, accepted: 0, since: Date.now() };
  }

  start() {
    this.running = true;
    this._connect();
    this._loop().catch((e) => { this.log(`Miner stopped: ${e.stack ?? e.message}`); process.exitCode = 1; this.stop(); });
  }

  stop() {
    this.running = false;
    this.socket?.destroy();
  }

  _connect() {
    if (!this.running) return;
    const socket = net.connect(this.port, this.host);
    this.socket = socket;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      this.log(`Connected to Stratum ${this.host}:${this.port}`);
      this._send('eth_submitLogin', [this.address], { worker: this.worker });
      this._send('eth_getWork', []);
    });
    socket.on('data', (d) => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) this._message(line);
      }
    });
    socket.on('error', (e) => this.log(`Stratum: ${e.message}`));
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.job = null;
      if (this.running) setTimeout(() => this._connect(), RECONNECT_MS);
    });
  }

  _send(method, params, extra = {}) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(`${JSON.stringify({ id: this.nextId++, jsonrpc: '2.0', method, params, ...extra })}\n`);
    }
  }

  _message(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.error) { this.log(`Stratum error: ${JSON.stringify(m.error)}`); return; }
    const r = m.result;
    if (Array.isArray(r) && r.length >= 4) {
      const [sealHash, , target, number] = r;
      this.job = { sealHash: fromHex(sealHash), target: BigInt(target), number: Number(BigInt(number)) };
    } else if (this.pending?.has(m.id)) {
      this.pending.delete(m.id);
      if (r === true) this.stats.accepted += 1;
      this.log(`Block #${this.pendingNumber?.get(m.id) ?? '?'} ${r === true ? 'accepted' : 'rejected'}`);
    }
  }

  async _dataset(epoch) {
    if (this.epoch === epoch) return this.dataset;
    this.dataset = null;
    const fullSize = datasetSize(epoch);
    const file = this.dagDir ? join(this.dagDir, `dag-${epoch}.bin`) : null;
    const cache = await generateCache(cacheSize(epoch), seedHash(epoch));
    let dataset = null;
    if (file && existsSync(file)) {
      const b = readFileSync(file);
      if (b.length === Math.floor(fullSize / 64) * 64) {
        dataset = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
        // A damaged file would only waste work; a few hashes against the cache detect it.
        for (let i = 0; i < 4 && dataset; i++) {
          const h = new Uint8Array(randomBytes(32));
          const n = new Uint8Array(randomBytes(8));
          if (toHex(hashimotoFull(dataset, h, n).result) !== toHex(hashimotoLight(cache, fullSize, h, n).result)) dataset = null;
        }
        if (!dataset) this.log('The stored DAG is damaged, generating it again');
      }
    }
    if (!dataset) {
      this.log(`Generating the DAG of epoch ${epoch} (${Math.round(fullSize / 2 ** 20)} MB), this takes a while...`);
      const started = Date.now();
      let lastPercent = -10;
      dataset = await generateDataset(cache, fullSize, (done, total) => {
        const percent = Math.floor((done / total) * 100);
        if (percent >= lastPercent + 10) { lastPercent = percent; this.log(`DAG ${percent} %`); }
      });
      this.log(`DAG ready in ${Math.round((Date.now() - started) / 1000)} s`);
      if (file) {
        try {
          mkdirSync(this.dagDir, { recursive: true });
          for (const f of readdirSync(this.dagDir)) if (/^dag-\d+\.bin(\.tmp)?$/.test(f)) rmSync(join(this.dagDir, f), { force: true });
          writeFileSync(`${file}.tmp`, new Uint8Array(dataset.buffer, dataset.byteOffset, dataset.byteLength));
          renameSync(`${file}.tmp`, file);
        } catch (e) { this.log(`The DAG was not saved: ${e.message}`); }
      }
    }
    this.epoch = epoch;
    this.dataset = dataset;
    return dataset;
  }

  async _loop() {
    const pause = () => new Promise((resolve) => setImmediate(resolve));
    const idle = () => new Promise((resolve) => setTimeout(resolve, 500));
    let nonce = BigInt(`0x${randomBytes(8).toString('hex')}`);
    const nonceBytes = new Uint8Array(8);
    const view = new DataView(nonceBytes.buffer);
    let lastReport = Date.now();
    this.pending = new Map();
    this.pendingNumber = new Map();
    while (this.running) {
      const job = this.job;
      if (!job) { await idle(); continue; }
      const dataset = await this._dataset(epochOf(job.number));
      if (this.job !== job) continue;
      for (let i = 0; i < BATCH; i++) {
        nonce = (nonce + 1n) & 0xffffffffffffffffn;
        view.setBigUint64(0, nonce);
        const { mixDigest, result } = hashimotoFull(dataset, job.sealHash, nonceBytes);
        if (bytesToBigInt(result) <= job.target) {
          this.stats.found += 1;
          const id = this.nextId;
          this.pending.set(id, true);
          if (this.pending.size > 64) this.pending.delete(this.pending.keys().next().value);
          this.pendingNumber.set(id, job.number);
          if (this.pendingNumber.size > 64) this.pendingNumber.delete(this.pendingNumber.keys().next().value);
          this._send('eth_submitWork', [toHex(nonceBytes), toHex(job.sealHash), toHex(mixDigest)]);
          this.job = null;   // the node pushes the next job with the new block; ask too in case it was rejected
          this._send('eth_getWork', []);
          break;
        }
      }
      this.stats.hashes += BATCH;
      const now = Date.now();
      if (now - lastReport >= HASHRATE_EVERY_MS) {
        const rate = Math.round(this.stats.hashes / ((now - this.stats.since) / 1000));
        this.log(`${rate} H/s, blocks found ${this.stats.found}, accepted ${this.stats.accepted}`);
        this._send('eth_getWork', []);   // a safety net if a pushed job was lost
        this._send('eth_submitHashrate', [`0x${rate.toString(16)}`, `0x${'00'.repeat(31)}01`]);
        this.stats.hashes = 0;
        this.stats.since = now;
        lastReport = now;
      }
      await pause();
    }
  }
}
