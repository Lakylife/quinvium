// HTTP and WebSocket server for JSON-RPC, event subscriptions and the static Explorer.
import http from 'node:http';
import os from 'node:os';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { toHex } from '../util/bytes.js';
import { blockReceipts, logToRpc } from './format.js';
import { MINING_METHODS, RpcError, createMethods } from './methods.js';
import { isLocalCaller } from '../p2p/upnp.js';

const PROXY_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'];
const isLoopback = (ip) => { const a = String(ip ?? '').replace(/^::ffff:/i, ''); return a === '::1' || /^127\./.test(a); };
import { COST, restApi } from './rest-api.js';

const MAX_BODY = 5 * 1024 * 1024;
const MAX_BATCH = 100;
const MAX_SUBS = 32;
const MAX_WS_CLIENTS = 256;
const MAX_WS_BUFFER = 8 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };

const MAX_TRACKED = 50_000;

class Limiter {
  constructor(perMinute) { this.limit = perMinute; this.hits = new Map(); }
  /** @param {number} n cost of the request: a batch counts per item */
  allow(ip, n = 1, limit = this.limit) {
    if (!limit) return true;
    const now = Date.now();
    const key = limitKey(ip);
    const b = this.hits.get(key);
    if (!b || now - b.start > 60_000) {
      // Clearing the whole table would reset everyone's count, so a flood of new addresses could free an exhausted one.
      // Only finished windows are dropped; while the table is still full, a new address is let through without being counted.
      if (!b && this.hits.size >= MAX_TRACKED) {
        if (now - (this.sweptAt ?? 0) > 1000) {
          this.sweptAt = now;
          for (const [k, v] of this.hits) if (now - v.start > 60_000) this.hits.delete(k);
        }
        if (this.hits.size >= MAX_TRACKED) return n <= limit;
      }
      this.hits.set(key, { start: now, n });
      return n <= limit;
    }
    b.n += n;
    return b.n <= limit;
  }
}

/** Requests per minute for callers from the internet when the node is open to the internet. */
export const PUBLIC_RATE_LIMIT = 1200;
const LOCAL_CALLER = Object.freeze({ ip: null, local: true });
/** Methods that control this node: only this computer and the local network, whatever the mode. */
const ALWAYS_LOCAL = new Set(['aether_setPublicUrl', 'quintium_setPublicUrl', 'quinvium_setPublicUrl']);

const TOO_MANY = { jsonrpc: '2.0', id: null, error: { code: -32005, message: 'too many requests' } };
/**
 * Methods that run the EVM or a database query in the node's small thread pool (rpc/vm-pool.js). A foreign caller runs them
 * one at a time, so a single address cannot occupy every thread with 5-second calls and stop eth_call for everyone else.
 */
export const HEAVY_METHODS = new Set([
  'eth_call', 'eth_estimateGas', 'eth_getLogs', 'eth_getFilterLogs', 'eth_getFilterChanges', 'eth_feeHistory', 'eth_getProof',
  ...['activity', 'blocks', 'txs', 'addressInfo', 'tokenInfo', 'addressTransfers', 'tokenTransfers', 'contractLogs', 'minerShares',
    'poolMiners', 'pools', 'minedByDay', 'txError', 'poolsOf', 'poolPayouts', 'chartSeries', 'minerList', 'poolSeries']
    .flatMap((m) => [`aether_${m}`, `quintium_${m}`, `quinvium_${m}`]),
]);
/** Heavy requests of one foreign address that may wait for their turn; more are refused. */
const MAX_HEAVY_WAITING = 32;
/** IPv6 addresses are counted by their /64 network: one connection usually has the whole network to itself. */
export function limitKey(ip) {
  const v = String(ip ?? '').replace(/^::ffff:/i, '');
  if (!v.includes(':')) return v;
  const [head, tail = ''] = v.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = v.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${full.slice(0, 4).map((x) => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export class RpcServer {
  constructor(node, { host = '127.0.0.1', port = 8545, staticDir = null, rateLimit = 0, trustProxy = false, publicMode = false, publicRateLimit = PUBLIC_RATE_LIMIT, tunnelPort = null, log = () => {} }) {
    Object.assign(this, { node, host, port, staticDir, trustProxy, publicMode, tunnelPort, log });
    // A node open to the internet hands out work only to miners from this computer and the local network and gives foreign callers a lower limit.
    this.localOnly = new Set(publicMode ? MINING_METHODS : []);
    this.publicLimit = publicMode ? (rateLimit ? Math.min(rateLimit, publicRateLimit) : publicRateLimit) : 0;
    this.limiter = new Limiter(rateLimit);
    const { methods, collectLogs } = createMethods(node);
    this.methods = methods;
    this.collectLogs = collectLogs;
    this.subs = new Map();
    this.nextSub = 1n;
    this.heavy = new Map();   // limit key -> { tail: Promise, waiting: number }
  }

  /**
   * Waits for the caller's previous heavy request to finish. Returns null when too many are waiting,
   * otherwise `{ turn, release }`: await `turn`, run the request, then always call `release`.
   */
  _heavySlot(caller) {
    const key = caller.tunnel ? `tunnel:${limitKey(caller.ip)}` : limitKey(caller.ip);
    const q = this.heavy.get(key) ?? { tail: Promise.resolve(), waiting: 0 };
    if (q.waiting >= MAX_HEAVY_WAITING) return null;
    q.waiting += 1;
    this.heavy.set(key, q);
    let release;
    const done = new Promise((resolve) => { release = resolve; });
    const turn = q.tail;
    q.tail = done.finally(() => {
      q.waiting -= 1;
      if (q.waiting === 0 && this.heavy.get(key) === q) this.heavy.delete(key);
    });
    return { turn, release };
  }

  async start() {
    this.http = http.createServer((req, res) => this._http(req, res));
    this.http.requestTimeout = 30_000;
    this.http.headersTimeout = 10_000;
    this.wss = new WebSocketServer({ server: this.http, maxPayload: MAX_BODY });
    this.wss.on('connection', (ws, req) => this._ws(ws, req));
    await new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, this.host, resolve);
    });
    this.port = this.http.address().port;
    // The port for a tunnel (the app's "Share node publicly"): only this computer can reach it, every request on it
    // counts as foreign, its sender is the address the tunnel reports (Cf-Connecting-IP) and it gets the public limit.
    // Mining and node-control methods are not available on it.
    if (this.tunnelPort !== null && this.tunnelPort !== undefined) {
      this.tunnel = http.createServer((req, res) => { req.viaTunnel = true; this._http(req, res); });
      this.tunnel.requestTimeout = 30_000;
      this.tunnel.headersTimeout = 10_000;
      await new Promise((resolve, reject) => {
        this.tunnel.once('error', reject);
        this.tunnel.listen(this.tunnelPort, '127.0.0.1', resolve);
      });
      this.tunnelPort = this.tunnel.address().port;
    }
    this._onHead = (e) => this._pushHead(e);
    this._onPending = (tx) => this._pushPending(tx);
    this.node.chain.on('head', this._onHead);
    this.node.on('pending-tx', this._onPending);
  }

  async stop() {
    this.node.chain.off('head', this._onHead);
    this.node.off('pending-tx', this._onPending);
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
    this.http.closeAllConnections();
    await new Promise((r) => this.http.close(() => r()));
    if (this.tunnel) {
      this.tunnel.closeAllConnections();
      await new Promise((r) => this.tunnel.close(() => r()));
    }
  }

  /** @param {{ip: string|null, local: boolean}} [caller] who is asking; without it, the node itself */
  async call(req, caller = LOCAL_CALLER) {
    const id = req?.id ?? null;
    if (req?.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } };
    }
    const fn = Object.prototype.hasOwnProperty.call(this.methods, req.method) ? this.methods[req.method] : null;
    if (typeof fn !== 'function') return { jsonrpc: '2.0', id, error: { code: -32601, message: `the method ${req.method} does not exist` } };
    if (!caller.local && (this.localOnly.has(req.method) || ALWAYS_LOCAL.has(req.method) || (caller.tunnel && MINING_METHODS.includes(req.method)))) return { jsonrpc: '2.0', id, error: { code: -32601, message: `the method ${req.method} is available only from the local network` } };
    const params = Array.isArray(req.params) ? req.params : [];
    let slot = null;
    if (!caller.local && HEAVY_METHODS.has(req.method)) {
      slot = this._heavySlot(caller);
      if (slot === null) return { jsonrpc: '2.0', id, error: { code: -32005, message: 'too many heavy requests at once, try again shortly' } };
    }
    try {
      if (slot) await slot.turn;
      const result = await fn(params, caller);
      return { jsonrpc: '2.0', id, result: result === undefined ? null : result };
    } catch (e) {
      if (e instanceof RpcError) return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message, data: e.data } };
      this.log(`RPC ${req.method}: ${e.stack ?? e.message}`);
      return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
    } finally {
      slot?.release();
    }
  }

  /** Behind a reverse proxy everyone has the same address; the proxy passes the real one in a header. */
  _clientIp(req) {
    if (req.viaTunnel) {
      const ip = String(req.headers['cf-connecting-ip'] ?? '').trim();
      return /^[0-9a-f.:]{2,45}$/i.test(ip) ? ip : 'tunnel';
    }
    // The header counts only when the request really came from the proxy on this computer. A client that reaches the
    // backend port directly could otherwise write any address into it, 127.0.0.1 included.
    if (this.trustProxy && isLoopback(req.socket.remoteAddress)) {
      const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress;
  }

  /**
   * Who is asking. A request that came through a proxy or tunnel has the proxy's address, often 127.0.0.1.
   * Without --trust-proxy a request with a proxy header is therefore treated as foreign, even if it came from this computer.
   */
  _caller(req) {
    const ip = this._clientIp(req);
    if (req.viaTunnel) return { ip, local: false, tunnel: true };
    // Without --trust-proxy, and with it from anywhere but this computer, a request with a proxy header is foreign.
    const proxied = (!this.trustProxy || !isLoopback(req.socket.remoteAddress)) && PROXY_HEADERS.some((h) => req.headers[h]);
    // A web page in the browser on this computer also connects from 127.0.0.1. The browser sends its origin, so a request
    // from a page other than the node's own Explorer is a foreign caller: it reads the chain but does not control the node.
    // A page whose own name was rebound to 127.0.0.1 (DNS rebinding) has a matching origin, but its Host is that foreign name.
    return { ip, local: !proxied && this._localHost(req) && !this._foreignOrigin(req) && isLocalCaller(ip) };
  }

  /**
   * Whether the Host header names this computer: localhost, 127.0.0.1, [::1], one of its own interface addresses or the
   * address the server was bound to. A request without Host (HTTP/1.0 tools) keeps counting as before.
   */
  _localHost(req) {
    const raw = req.headers.host;
    if (raw === undefined) return true;
    let name;
    try {
      name = new URL(`http://${raw}`).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
    name = name.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
    if (name === 'localhost' || name === '127.0.0.1' || name === '::1') return true;
    const bound = String(this.host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
    if (bound && bound !== '0.0.0.0' && bound !== '::' && name === bound) return true;
    return this._ownAddresses().has(name);
  }

  /** This computer's interface addresses, refreshed once a minute (a laptop changes networks). */
  _ownAddresses() {
    const now = Date.now();
    if (!this.ownAddresses || now - this.ownAddressesAt > 60_000) {
      const set = new Set();
      try {
        for (const list of Object.values(os.networkInterfaces())) {
          for (const a of list ?? []) set.add(String(a.address).toLowerCase().split('%')[0]);
        }
      } catch { /* no interface list: only the loopback names count */ }
      this.ownAddresses = set;
      this.ownAddressesAt = now;
    }
    return this.ownAddresses;
  }

  _foreignOrigin(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return false;
    try {
      const u = new URL(origin);
      return !(['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && u.host === String(req.headers.host ?? ''));
    } catch {
      return true;
    }
  }

  _allow(caller, n = 1) {
    if (caller.tunnel) return this.limiter.allow(`tunnel:${caller.ip}`, n, this.publicLimit || PUBLIC_RATE_LIMIT);
    return this.limiter.allow(caller.ip, n, !caller.local && this.publicLimit ? this.publicLimit : undefined);
  }

  async _dispatch(text, caller) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
    }
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid batch size' } };
      if (!this._allow(caller, body.length)) return TOO_MANY;
      return Promise.all(body.map((r) => this.call(r, caller)));
    }
    if (!this._allow(caller)) return TOO_MANY;
    return this.call(body, caller);
  }

  _http(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      // Chrome asks before a page on the internet reads a server on this computer or network (Private Network Access).
      // The Explorer on a domain falls back to the visitor's own node when the network's nodes are down.
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'POST') { this._post(req, res); return; }
    if (req.method === 'GET') {
      // Anyone sends the path, even an ordinary link on someone else's page. An error in it must not crash the node.
      try {
        if (req.url.split('?')[0] === '/health') { this._health(req, res); return; }
        if (/^\/api\/supply\/(total|circulating|max)$/.test(req.url.split('?')[0])) { this._supply(req, res); return; }
        if (req.url.split('?')[0] === '/api' && /[?&]module=/.test(req.url)) { this._restApi(req, res); return; }
        this._static(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      }
      return;
    }
    res.writeHead(405); res.end();
  }

  /**
   * REST API with module and action queries (rpc/rest-api.js). It goes through the same methods, rate limit and caller rules as JSON-RPC.
   * Without `module` the path /api stays the Explorer's developer page.
   */
  _restApi(req, res) {
    const caller = this._caller(req);
    const q = new URL(req.url, 'http://x').searchParams;
    const reply = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
      res.end(text);
    };
    if (!this._allow(caller, COST[q.get('action')] ?? 1)) { reply(429, { status: '0', message: 'NOTOK', result: 'Max rate limit reached' }); return; }
    const call = async (method, params = []) => {
      const r = await this.call({ jsonrpc: '2.0', id: 1, method, params }, caller);
      if (r.error) throw new Error(r.error.message);
      return r.result;
    };
    restApi(q, call).then((body) => reply(200, body), (e) => {
      this.log(`API: ${e.stack ?? e.message}`);
      reply(200, { status: '0', message: 'NOTOK', result: 'Error! Internal error' });
    });
  }

  /**
   * Coin supply as a plain number of whole coins (`90360`, `64000000`), the format coin trackers and listing sites read.
   * There is no premine and nothing is locked, so the circulating supply equals the mined supply.
   */
  _supply(req, res) {
    const caller = this._caller(req);
    if (!this._allow(caller)) { res.writeHead(429); res.end(); return; }
    const kind = req.url.split('?')[0].split('/').pop();
    this.call({ jsonrpc: '2.0', id: 1, method: 'aether_stats', params: [] }, caller).then((r) => {
      if (r.error) throw new Error(r.error.message);
      const wei = BigInt(kind === 'max' ? r.result.maxSupply : r.result.supply);
      const whole = wei / 10n ** 18n;
      const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
      const text = frac ? `${whole}.${frac}` : String(whole);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'max-age=60' });
      res.end(text);
    }).catch(() => { if (!res.headersSent) res.writeHead(503); res.end(); });
  }

  /**
   * Node health for monitors, proxies and Explorer failover: 200 when the node keeps up with the others, otherwise 503.
   * A node that is syncing or more than `maxBehind` blocks behind its peers should not offer data.
   * `maxAge` (seconds) additionally requires a fresh block; useful only for monitoring mining, not for choosing a node.
   */
  _health(req, res) {
    const params = new URL(req.url, 'http://uzel').searchParams;
    const maxBehind = Number(params.get('maxBehind') ?? 3);
    const maxAge = Number(params.get('maxAge') ?? 0);
    const { chain, network } = this.node;
    const height = Number(chain.head.number);
    const now = chain.now?.() ?? Math.floor(Date.now() / 1000);
    const tipAge = Math.max(0, Math.floor(now - Number(chain.head.timestamp)));
    const peers = network ? [...network.peers].filter((p) => p.ready) : [];
    // The peers' height is only their claim. Otherwise one liar would send the node to 503 and the Explorer would switch elsewhere needlessly,
    // so with two or more peers the second highest is used. Nodes on a branch beyond the finality boundary are not counted.
    const wallClock = Date.now();
    const heights = peers.filter((p) => !((p.deepForkUntil ?? 0) > wallClock)).map((p) => Number(p.headNumber ?? 0)).sort((a, b) => b - a);
    const claimed = heights.length >= 2 ? heights[1] : heights[0] ?? height;
    const best = Math.max(height, claimed);
    const problems = [];
    if (network?.behind) problems.push('syncing');
    if (best - height > maxBehind) problems.push('behind');
    if (maxAge > 0 && tipAge > maxAge) problems.push('stale');
    const body = JSON.stringify({ ok: !problems.length, problems, network: chain.network.name, height, tipAge, peers: peers.length, bestPeerHeight: best, behind: best - height });
    res.writeHead(problems.length ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  _post(req, res) {
    const caller = this._caller(req);
    const chunks = [];
    let size = 0;
    req.on('error', () => req.destroy());
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let text;
      let status = 200;
      try {
        const out = await this._dispatch(Buffer.concat(chunks).toString('utf8'), caller);
        if (out === TOO_MANY) status = 429;
        text = JSON.stringify(out);
      } catch (e) {
        this.log(`RPC: ${e.stack ?? e.message}`);
        text = '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}';
      }
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
      res.end(text);
    });
  }

  _static(req, res) {
    if (!this.staticDir) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'quintium-node', version: this.node.version }));
      return;
    }
    const root = normalize(this.staticDir);
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(this.staticDir, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self'; connect-src * ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src https://verify.walletconnect.org https://verify.walletconnect.com; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    createReadStream(file).pipe(res);
  }

  _ws(ws, req) {
    if (this.wss.clients.size > MAX_WS_CLIENTS) { ws.close(1013, 'too many connections'); return; }
    const caller = this._caller(req);
    ws.subs = new Map();
    ws.on('error', () => ws.terminate());
    ws.on('close', () => { for (const id of ws.subs.keys()) this.subs.delete(id); });
    ws.on('message', (data) => {
      this._wsMessage(ws, caller, data).catch((e) => {
        this.log(`WebSocket: ${e.stack ?? e.message}`);
        ws.terminate();
      });
    });
  }

  /** The message content is entirely in the client's hands, so its shape is checked before use. */
  async _wsMessage(ws, caller, data) {
    const invalid = (id = null) => this._wsSend(ws, JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } }));
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this._wsSend(ws, '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}');
      return;
    }
    if (typeof msg !== 'object' || msg === null) { invalid(); return; }
    const items = Array.isArray(msg) ? msg.slice(0, MAX_BATCH) : [msg];
    if (!this._allow(caller, Math.max(items.length, 1))) { ws.close(1008, 'rate limit'); return; }
    if (!Array.isArray(msg) && msg.method === 'eth_subscribe') {
      if (!Array.isArray(msg.params)) { invalid(msg.id ?? null); return; }
      this._wsSend(ws, JSON.stringify(this._subscribe(ws, msg)));
      return;
    }
    if (!Array.isArray(msg) && msg.method === 'eth_unsubscribe') {
      if (!Array.isArray(msg.params)) { invalid(msg.id ?? null); return; }
      const id = msg.params[0];
      const ok = ws.subs.delete(id);
      if (ok) this.subs.delete(id);
      this._wsSend(ws, JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, result: ok }));
      return;
    }
    const out = Array.isArray(msg) ? await Promise.all(items.map((r) => this.call(r, caller))) : await this.call(msg, caller);
    this._wsSend(ws, JSON.stringify(out));
  }

  /** A client that does not read must not fill the node's memory. */
  _wsSend(ws, text) {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_WS_BUFFER) { ws.terminate(); return; }
    ws.send(text);
  }

  _subscribe(ws, msg) {
    const [kind, opts] = msg.params ?? [];
    if (!['newHeads', 'logs', 'newPendingTransactions'].includes(kind)) {
      return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32602, message: 'unknown subscription type' } };
    }
    if (ws.subs.size >= MAX_SUBS) return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32005, message: 'too many subscriptions' } };
    const id = `0x${(this.nextSub++).toString(16)}`;
    const sub = { ws, kind, opts: opts ?? {} };
    ws.subs.set(id, sub);
    this.subs.set(id, sub);
    return { jsonrpc: '2.0', id: msg.id ?? null, result: id };
  }

  _notify(id, sub, result) {
    this._wsSend(sub.ws, JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: id, result } }));
  }

  _pushHead({ added }) {
    if (this.subs.size === 0) return;
    for (const block of added) {
      const head = block.header.toRpc();
      let logs = null;
      for (const [id, sub] of this.subs) {
        if (sub.kind === 'newHeads') this._notify(id, sub, head);
        if (sub.kind === 'logs') {
          logs ??= blockReceipts(block, this.node.chain.getReceipts(block.hash()).receipts).flatMap((r) => r.logs).map(logToRpc);
          for (const l of logs) if (matches(l, sub.opts)) this._notify(id, sub, l);
        }
      }
    }
  }

  _pushPending(tx) {
    const hash = toHex(tx.hash());
    for (const [id, sub] of this.subs) if (sub.kind === 'newPendingTransactions') this._notify(id, sub, hash);
  }
}

function matches(log, { address, topics }) {
  if (address) {
    const list = [address].flat().map((a) => a.toLowerCase());
    if (!list.includes(log.address.toLowerCase())) return false;
  }
  return (topics ?? []).every((t, i) => t == null || [t].flat().includes(log.topics[i]));
}
