// DRAFT, not deployed. A Cloudflare Worker for a proxied host name such as rpcpool.quinvium.com: one stable https address
// for wallets that forwards JSON-RPC to the network's node and, when it does not answer, to community nodes that the
// network's nodes verified (quinvium_publicNodes). No keys, no state except a short in-memory cache.
// Deploy only after review: Workers (free plan: 100,000 requests a day), route rpcpool.quinvium.com/*, environment
// variable PRIMARY=https://rpc.quinvium.com. rpc, rpc1, seed and pool stay "DNS only".

const LIST_TTL_MS = 5 * 60_000;
const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 8_000;
const NODE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
let cache = { at: 0, nodes: [] };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/** Verified community nodes, refreshed from the primary node; the last good list is kept while the primary is down. */
async function communityNodes(primary) {
  if (Date.now() - cache.at < LIST_TTL_MS) return cache.nodes;
  try {
    const reply = JSON.parse(await post(primary, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'quinvium_publicNodes', params: [] })));
    const nodes = (Array.isArray(reply.result) ? reply.result : []).map((n) => String(n?.url ?? '')).filter((u) => NODE_URL.test(u)).slice(0, 8);
    cache = { at: Date.now(), nodes };
  } catch {
    cache.at = Date.now() - LIST_TTL_MS + 30_000;   // try again in 30 s, keep the old list
  }
  return cache.nodes;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'JSON-RPC over POST only' }, 405);
    const body = await request.text();
    if (body.length > MAX_BODY) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }, 413);
    const primary = env.PRIMARY ?? 'https://rpc.quinvium.com';
    const targets = [primary, ...(await communityNodes(primary))];
    for (const url of targets.slice(0, 4)) {
      try {
        return new Response(await post(url, body), { headers: { 'Content-Type': 'application/json', 'X-Quinvium-Node': new URL(url).host, ...cors } });
      } catch { /* the next node */ }
    }
    return json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'no node answered' } }, 502);
  },
};
