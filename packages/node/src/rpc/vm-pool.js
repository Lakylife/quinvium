// eth_call a eth_estimateGas běží v oddělených vláknech s časovým limitem.
// Kód volání si volí kdokoli, takže nesmí blokovat zpracování bloků, síť ani další dotazy.
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcCallError } from './call.js';
import { L } from '../lang.js';

const SIZE = 2;
const TIMEOUT_MS = 5000;
const MAX_QUEUE = 128;
const ASSET = 'vm-worker.cjs';

export class VmBusyError extends Error {}

/** Vlákno vznikne z jednoho ze tří zdrojů podle toho, jak je uzel zabalený. */
function createWorker(workerData) {
  const sea = process.getBuiltinModule?.('node:sea');
  if (sea?.isSea()) return new Worker(sea.getAsset(ASSET, 'utf8'), { eval: true, workerData });
  const here = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, ASSET);
  if (existsSync(bundled)) return new Worker(bundled, { workerData });
  return new Worker(new URL('./vm-worker.js', import.meta.url), { workerData });
}

export class VmPool {
  /** @param {{network: object, dbPath: string, powDir?: string, log?: (m: string) => void}} o */
  constructor({ network, dbPath, powDir, log = () => {}, size = SIZE, timeoutMs = TIMEOUT_MS }) {
    Object.assign(this, { log, timeoutMs, stopped: false });
    this.workerData = { network, dbPath, powDir };
    this.idle = [];
    this.queue = [];
    this.nextId = 1;
    for (let i = 0; i < size; i++) this.idle.push(this._spawn());
  }

  _spawn() {
    const worker = createWorker(this.workerData);
    worker.unref();
    worker.on('error', (e) => this.log(`${L('Vlákno EVM', 'EVM thread')}: ${e.message}`));
    return worker;
  }

  /**
   * @param {'call'|'estimate'|'index'} kind
   * @param {Header|null} header stav, nad kterým se počítá, u dotazů do indexu žádný
   * @param {object} params parametry volání z RPC
   * @returns {Promise<any>} hex výsledek, u indexu řádky dotazu
   */
  run(kind, header, params) {
    if (this.queue.length >= MAX_QUEUE) return Promise.reject(new VmBusyError('uzel je přetížený, zkuste to za chvíli'));
    return new Promise((resolve, reject) => {
      this.queue.push({ kind, header: header?.encode(), params, resolve, reject });
      this._next();
    });
  }

  _next() {
    while (this.idle.length && this.queue.length) this._dispatch(this.idle.pop(), this.queue.shift());
  }

  _dispatch(worker, job) {
    const id = this.nextId++;
    let timer;
    const release = (next) => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      if (!this.stopped) this.idle.push(next);
      this._next();
    };
    const onMessage = (m) => {
      if (m.id !== id) return;
      release(worker);
      if (m.error !== undefined) job.reject(new RpcCallError(m.error, m.data));
      else job.resolve(m.result);
    };
    // Běžící EVM nejde přerušit jinak než ukončením vlákna, náhradní vznikne hned.
    timer = setTimeout(() => {
      worker.terminate();
      release(this.stopped ? worker : this._spawn());
      job.reject(new RpcCallError(`výpočet překročil limit ${this.timeoutMs} ms`));
    }, this.timeoutMs);
    worker.on('message', onMessage);
    worker.postMessage({ id, kind: job.kind, header: job.header, params: job.params });
  }

  async stop() {
    this.stopped = true;
    for (const job of this.queue) job.reject(new VmBusyError('uzel se vypíná'));
    this.queue = [];
    await Promise.all(this.idle.map((w) => w.terminate()));
    this.idle = [];
  }
}
