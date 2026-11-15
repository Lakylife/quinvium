// HTTP and WebSocket server for JSON-RPC, event subscriptions and the static Explorer.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { toHex } from '../util/bytes.js';
import { blockReceipts, logToRpc } from './format.js';
import { MINING_METHODS, RpcError, createMethods } from './methods.js';
import { isLocalCaller } from '../p2p/upnp.js';
import { COST, etherscan } from './etherscan.js';

const MAX_BODY = 5 * 1024 * 1024;
const MAX_BATCH = 100;
const MAX_SUBS = 32;
const MAX_WS_CLIENTS = 256;
const MAX_WS_BUFFER = 8 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };

class Limiter {
  constructor(perMinute) { this.limit = perMinute; this.hits = new Map(); }
  /** @param {number} n cost of the request: a batch counts per item */
  allow(ip, n = 1, limit = this.limit) {
    if (!limit) return true;
    const now = Date.now();
    const b = this.hits.get(ip);
    if (!b || now - b.start > 60_000) { this.hits.set(ip, { start: now, n }); return n <= limit; }
    b.n += n;
    if (this.hits.size > 50_000) this.hits.clear();
    return b.n <= limit;
  }
}

/** Requests per minute for callers from the internet when the node is open to the internet. */
export const PUBLIC_RATE_LIMIT = 1200;
const LOCAL_CALLER = Object.freeze({ ip: null, local: true });

const TOO_MANY = { jsonrpc: '2.0', id: null, error: { code: -32005, message: 'příliš mnoho požadavků' } };

export class RpcServer {
  constructor(node, { host = '127.0.0.1', port = 8545, staticDir = null, rateLimit = 0, trustProxy = false, publicMode = false, publicRateLimit = PUBLIC_RATE_LIMIT, log = () => {} }) {
    Object.assign(this, { node, host, port, staticDir, trustProxy, publicMode, log });
    // A node open to the internet hands out work only to miners from this computer and the local network and gives foreign callers a lower limit.
    this.localOnly = new Set(publicMode ? MINING_METHODS : []);
    this.publicLimit = publicMode ? (rateLimit ? Math.min(rateLimit, publicRateLimit) : publicRateLimit) : 0;
    this.limiter = new Limiter(rateLimit);
    const { methods, collectLogs } = createMethods(node);
    this.methods = methods;
    this.collectLogs = collectLogs;
    this.subs = new Map();
    this.nextSub = 1n;
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
  }

  /** @param {{ip: string|null, local: boolean}} [caller] who is asking; without it, the node itself */
  async call(req, caller = LOCAL_CALLER) {
    const id = req?.id ?? null;
    if (req?.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'neplatný požadavek' } };
    }
    const fn = Object.prototype.hasOwnProperty.call(this.methods, req.method) ? this.methods[req.method] : null;
    if (!fn) return { jsonrpc: '2.0', id, error: { code: -32601, message: `metoda ${req.method} neexistuje` } };
    if (!caller.local && this.localOnly.has(req.method)) return { jsonrpc: '2.0', id, error: { code: -32601, message: `metoda ${req.method} je dostupná jen z místní sítě` } };
    try {
      const result = await fn(Array.isArray(req.params) ? req.params : [], caller);
      return { jsonrpc: '2.0', id, result: result === undefined ? null : result };
    } catch (e) {
      if (e instanceof RpcError) return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message, data: e.data } };
      this.log(`RPC ${req.method}: ${e.stack ?? e.message}`);
      return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
    }
  }

  /** Behind a reverse proxy everyone has the same address; the proxy passes the real one in a header. */
  _clientIp(req) {
    if (this.trustProxy) {
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
    const proxied = !this.trustProxy && ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'].some((h) => req.headers[h]);
    return { ip, local: !proxied && isLocalCaller(ip) };
  }

  _allow(caller, n = 1) {
    return this.limiter.allow(caller.ip, n, !caller.local && this.publicLimit ? this.publicLimit : undefined);
  }

  async _dispatch(text, caller) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'neplatný JSON' } };
    }
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'neplatná velikost dávky' } };
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
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST') { this._post(req, res); return; }
    if (req.method === 'GET') {
      // Anyone sends the path, even an ordinary link on someone else's page. An error in it must not crash the node.
      try {
        if (req.url.split('?')[0] === '/health') { this._health(req, res); return; }
        if (req.url.split('?')[0] === '/api' && /[?&]module=/.test(req.url)) { this._etherscan(req, res); return; }
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
   * Etherscan-style REST (rpc/etherscan.js). It goes through the same methods, rate limit and caller rules as JSON-RPC.
   * Without `module` the path /api stays the Explorer's developer page.
   */
  _etherscan(req, res) {
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
    etherscan(q, call).then((body) => reply(200, body), (e) => {
      this.log(`API: ${e.stack ?? e.message}`);
      reply(200, { status: '0', message: 'NOTOK', result: 'Error! Internal error' });
    });
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
        text = '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"vnitřní chyba"}}';
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
      'Content-Security-Policy': "default-src 'self'; connect-src * ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src https://verify.walletconnect.org https://verify.walletconnect.com; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    createReadStream(file).pipe(res);
  }

  _ws(ws, req) {
    if (this.wss.clients.size > MAX_WS_CLIENTS) { ws.close(1013, 'příliš mnoho spojení'); return; }
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
    const invalid = (id = null) => this._wsSend(ws, JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message: 'neplatný požadavek' } }));
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this._wsSend(ws, '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"neplatný JSON"}}');
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
      return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32602, message: 'neznámý typ odběru' } };
    }
    if (ws.subs.size >= MAX_SUBS) return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32005, message: 'příliš mnoho odběrů' } };
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
