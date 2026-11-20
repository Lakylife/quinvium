import assert from 'node:assert/strict';
const G = '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39';
let originUp = true; const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  calls.push(url);
  const body = init.body ? JSON.parse(init.body) : null;
  const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
  if (new URL(url).hostname === 'rpc.quinvium.com') { if (!originUp) throw new Error('down'); return body?.method === 'quinvium_publicNodes' ? ok([{ url: 'https://good.example.org' }]) : ok('0x100'); }
  if (url === 'https://quinvium.com/nodes.json') return new Response(JSON.stringify({ 52401: ['https://wrong.example.org', 'https://good.example.org'] }));
  if (new URL(url).hostname === 'wrong.example.org') return body.method === 'eth_chainId' ? ok('0x1') : ok({ hash: '0x11' });
  if (new URL(url).hostname === 'good.example.org') return body.method === 'eth_chainId' ? ok('0xccb1') : body.method === 'eth_getBlockByNumber' ? ok({ hash: G }) : ok('0x200');
  throw new Error('unexpected ' + url);
};
// The failover Worker: the server while it answers, verified community nodes (mainnet chain ID and genesis) when it does not.
const { default: w } = await import('./rpc-failover-worker.js');
const req = () => new Request('https://rpc-backup.quinvium.com/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
let r = await w.fetch(req()); assert.equal((await r.json()).result, '0x100');
originUp = false;
r = await w.fetch(req()); const j = await r.json(); assert.equal(j.result, '0x200'); assert.equal(r.headers.get('x-quinvium-node'), 'good.example.org');
// The Worker never calls itself: requests go to the primary server and the verified community node only.
assert.ok(!calls.some((u) => new URL(u).hostname === 'rpc-backup.quinvium.com'));
const nodesUsed = calls.filter((u) => new URL(u).hostname === 'good.example.org').length; assert.ok(nodesUsed >= 1);
r = await w.fetch(new Request('https://rpc-backup.quinvium.com/health')); assert.equal(r.status, 503);
originUp = true; r = await w.fetch(new Request('https://rpc-backup.quinvium.com/health')); assert.equal(r.status, 200);
// A custom PRIMARY from the Worker's variables is used.
r = await w.fetch(req(), { PRIMARY: 'https://rpc.quinvium.com/' }); assert.equal((await r.json()).result, '0x100'); assert.equal(r.headers.get('x-quinvium-node'), 'rpc.quinvium.com');
console.log('worker ok');
