// Writes nodes.json for a site on GitHub Pages: the community RPC nodes (the app's "Share node publicly") that serve the
// network's data. The website and the Explorer read it, so even a first visit during an outage of our own servers knows
// where else to read the chain. Pages keep no state between deploys, so the previous list is read back from the live site
// and every node in it is asked again; the network's own node is only one of the sources.
// Every listed node must answer with the expected chain ID and genesis block. Visitors check the same again before use.
// The script never fails the deploy: without any answer it keeps the previous list.
//
// Usage: node ops/pages/nodes.mjs --chain 52401 --genesis 0x… --rpc https://rpc.quinvium.com --previous https://quinvium.com/nodes.json --out _site/nodes.json
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: { chain: { type: 'string' }, genesis: { type: 'string' }, rpc: { type: 'string', multiple: true }, previous: { type: 'string', multiple: true }, out: { type: 'string' } } });
const chainId = Number(o.chain);
const genesis = String(o.genesis ?? '').toLowerCase();
const NODE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MAX = 16;
const clean = (list) => (Array.isArray(list) ? list : []).map((n) => String(n?.url ?? n ?? '').toLowerCase()).filter((u) => NODE_URL.test(u));

async function post(url, method, params = []) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

async function onChain(url) {
  try {
    const [id, block] = await Promise.all([post(url, 'eth_chainId'), post(url, 'eth_getBlockByNumber', ['0x0', false])]);
    return Number(BigInt(id)) === chainId && String(block?.hash).toLowerCase() === genesis;
  } catch { return false; }
}

const previous = [];
for (const url of o.previous ?? []) {
  try { previous.push(...clean((await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json())?.[chainId])); } catch { /* first deploy or site down */ }
}
// Sources of the list: the network's own nodes and every node already known; each one knows the nodes verified by the network.
const sources = [...new Set([...(o.rpc ?? []), ...previous])];
const found = new Set(previous);
for (const url of sources) {
  try { for (const u of clean(await post(url, 'quinvium_publicNodes'))) found.add(u); } catch { /* not answering */ }
}
const nodes = [];
for (const url of found) {
  if (nodes.length >= MAX) break;
  if (await onChain(url)) nodes.push(url);
}
// A node that does not answer right now may be back soon; while nothing answers, the previous list stays.
const list = nodes.length ? nodes : [...new Set(previous)].slice(0, MAX);
writeFileSync(o.out, `${JSON.stringify({ [chainId]: list, updated: new Date().toISOString() }, null, 1)}\n`);
console.log(`nodes.json: ${list.length} node(s) for chain ${chainId}${nodes.length ? '' : ' (kept from the previous deploy)'}`);
