// Cloudflare Worker on its own host name, rpc-backup.quinvium.com (a Custom Domain of the Worker). rpc.quinvium.com
// itself stays a plain proxied DNS record with no Worker route, so everyday traffic (the Explorer, the website, wallets,
// bots) never counts against the free plan's 100,000 Worker requests a day. Clients reach this Worker only as their second
// RPC address: wallets that support several RPC URLs (networks/mainnet.json lists it after rpc.quinvium.com), and
// anyone who sets it by hand. The Explorer, the website and the browser extension fall back to community nodes themselves.
// Each request goes to PRIMARY (default https://rpc.quinvium.com) first. When it does not answer, a JSON-RPC request goes
// to community nodes: the list the network's nodes verified (quinvium_publicNodes) and the list saved with the website
// (https://quinvium.com/nodes.json); each one must show the mainnet chain ID and genesis before it is used. No keys and no
// state except a short in-memory cache.

const CHAIN_ID = 52401n;
const GENESIS = '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39';
const NODES_JSON = 'https://quinvium.com/nodes.json';
const ORIGIN_TIMEOUT_MS = 6_000;
const NODE_TIMEOUT_MS = 8_000;
const LIST_TTL_MS = 5 * 60_000;
const MAX_BODY = 1_000_000;
const DEFAULT_PRIMARY = 'https://rpc.quinvium.com/';
const NODE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };

let list = { at: 0, nodes: [] };
const verified = new Map();   // url -> time of the last successful chain check

const rpcBody = (method, params = []) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
async function post(url, body, ms) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
const clean = (items) => (Array.isArray(items) ? items : []).map((n) => String(n?.url ?? n ?? '').toLowerCase()).filter((u) => NODE_URL.test(u) && !/^rpc(-backup)?\.quinvium\.com$/.test(new URL(u).hostname));

/** Community nodes from the website's list and, while it answers, from the server; the last good list stays in memory. */
async function communityNodes(origin) {
  if (Date.now() - list.at < LIST_TTL_MS && list.nodes.length) return list.nodes;
  const found = new Set(list.nodes);
  await Promise.all([
    fetch(NODES_JSON, { signal: AbortSignal.timeout(NODE_TIMEOUT_MS), cf: { cacheTtl: 300 } }).then((r) => r.json()).then((d) => clean(d?.[String(CHAIN_ID)]).forEach((u) => found.add(u))).catch(() => {}),
    post(origin, rpcBody('quinvium_publicNodes'), ORIGIN_TIMEOUT_MS).then((t) => clean(JSON.parse(t).result).forEach((u) => found.add(u))).catch(() => {}),
  ]);
  list = { at: Date.now(), nodes: [...found].slice(0, 16) };
  return list.nodes;
}

/** The node must be on mainnet: chain ID and genesis block, checked again every ten minutes. */
async function onMainnet(url) {
  if (Date.now() - (verified.get(url) ?? 0) < 10 * 60_000) return true;
  try {
    const [id, block] = await Promise.all([post(url, rpcBody('eth_chainId'), NODE_TIMEOUT_MS), post(url, rpcBody('eth_getBlockByNumber', ['0x0', false]), NODE_TIMEOUT_MS)]);
    const ok = BigInt(JSON.parse(id).result) === CHAIN_ID && String(JSON.parse(block).result?.hash).toLowerCase() === GENESIS;
    if (ok) verified.set(url, Date.now()); else verified.delete(url);
    return ok;
  } catch { return false; }
}

async function fromCommunity(origin, body) {
  for (const url of (await communityNodes(origin)).slice(0, 6)) {
    if (!(await onMainnet(url))) continue;
    try {
      return new Response(await post(url, body, NODE_TIMEOUT_MS), { headers: { 'Content-Type': 'application/json', 'X-Quinvium-Node': new URL(url).host, ...cors } });
    } catch { verified.delete(url); }
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'the server is down and no community node answered' } }), { status: 502, headers: { 'Content-Type': 'application/json', ...cors } });
}

export default {
  async fetch(request, env = {}) {
    const origin = String(env.PRIMARY || DEFAULT_PRIMARY);
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') {
      // /health and other plain pages: the primary server, and only a plain error when it is down.
      try {
        const r = await fetch(new URL(path, origin).href, { signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) });
        return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') ?? 'text/plain', ...cors } });
      } catch { return new Response('the server is down', { status: 503, headers: cors }); }
    }
    const body = await request.text();
    if (body.length > MAX_BODY) return new Response('request too large', { status: 413, headers: cors });
    try {
      const r = await fetch(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) });
      // The server's own answers, including its rate limit (429), pass on; only a dead or broken server is skipped.
      if (r.status < 500) return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'X-Quinvium-Node': new URL(origin).host, ...cors } });
    } catch { /* the server does not answer */ }
    return fromCommunity(origin, body);
  },
};
