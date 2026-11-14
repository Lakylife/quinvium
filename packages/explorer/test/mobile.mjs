// The Explorer on phones, tablets and in landscape: no page may scroll sideways, stick out of the screen
// (tables scroll inside their card) or have fields that make iOS zoom.
// The static files come from public/, chain data from QUINVIUM_RPC (default the public mainnet node).
// Run: node packages/explorer/test/mobile.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPages } from '../../../scripts/mobile-check.mjs';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const RPC = process.env.QUINVIUM_RPC || 'https://rpc.quinvium.com';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  if (req.method === 'POST') {   // the page asks its own origin for JSON-RPC, as with a node
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks) }).catch(() => null);
    res.writeHead(r?.status ?? 502, { 'Content-Type': 'application/json' });
    res.end(r ? Buffer.from(await r.arrayBuffer()) : '{}');
    return;
  }
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(pub, url);
  if (!file.startsWith(pub) || !existsSync(file) || statSync(file).isDirectory()) file = join(pub, 'index.html');   // History API routes
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (method, params = []) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json()).then((j) => j.result);
const head = await call('eth_getBlockByNumber', ['latest', false]);
const miner = head?.miner ?? '0x0000000000000000000000000000000000000000';
const pages = ['/', '/blocks', `/block/${Number(head?.number ?? 1)}`, '/txs', `/address/${miner}`, '/mempool', '/richlist', '/network', '/charts', '/miners', '/pools', '/mining', '/tokens', '/swap', '/bridge', '/apps', '/api'];
// Right-to-left Arabic and the CJK languages on the busiest pages (the page takes the language from ?lang=).
for (const l of ['ar', 'ja', 'zh']) for (const p of ['/', '/blocks', '/pools', '/network', '/apps']) pages.push(`${p}?lang=${l}`);
const problems = await checkPages(base, pages, { settle: 1500, label: 'explorer' });
server.close();
for (const p of problems) console.log(`[FAIL] ${p}`);
console.log(problems.length ? `SOUHRN: ${problems.length} problémů` : `Vše prošlo: ${pages.length} stránek, 7 velikostí obrazovky`);
process.exit(problems.length ? 1 : 0);
