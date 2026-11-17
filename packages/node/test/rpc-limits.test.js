// Limits of the public RPC: one request must not stop the node, and one caller must not take every EVM thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMethods } from '../src/rpc/methods.js';
import { RpcServer, limitKey } from '../src/rpc/server.js';

const header = (n) => ({ number: BigInt(n), baseFee: 10n ** 9n, gasUsed: 0n, gasLimit: 30_000_000n, timestamp: BigInt(n * 15), hash: () => new Uint8Array(32).fill(n % 256) });
const chain = {
  head: header(5000), network: { chainId: 52401n, name: 'mainnet' }, genesis: header(0), getHeaderByNumber: (n) => header(Number(n)),
  getBlockByNumber: (n) => ({ header: header(Number(n)), txs: [], hash: () => new Uint8Array(32).fill(Number(n) % 256) }),
  getReceipts: () => ({ receipts: [] }), now: () => 0,
};
const node = { chain, mempool: { bySender: new Map(), competing: () => [] }, network: null, work: null, version: 'test', vm: null };

test('eth_feeHistory: a long list of percentiles is refused instead of filling the memory', () => {
  const { methods } = createMethods(node);
  const t = Date.now();
  assert.throws(() => methods.eth_feeHistory(['0x400', 'latest', Array(50_000).fill(50)]), /at most 100 percentiles/);
  assert.ok(Date.now() - t < 1000, 'refused before any work');
  for (const bad of [[50, 10], [-1], [101], ['50'], [Number.NaN], 'x']) assert.throws(() => methods.eth_feeHistory(['0x2', 'latest', bad]), /percentile/, JSON.stringify(bad));
  const r = methods.eth_feeHistory(['0x400', 'latest', [10, 50, 90]]);
  assert.equal(r.reward.length, 1024);
  assert.equal(methods.eth_feeHistory(['0x100000', 'latest', []]).gasUsedRatio.length, 1024, 'at most 1024 blocks');
  assert.deepEqual(methods.eth_feeHistory(['0x0', 'latest', []]).reward, []);
});

test('heavy methods of one foreign caller run one at a time; other callers are not blocked by them', async () => {
  const server = new RpcServer(node, {});
  let running = 0;
  let peak = 0;
  const order = [];
  server.methods.eth_call = async ([tag]) => {
    running += 1; peak = Math.max(peak, running); order.push(tag);
    await new Promise((r) => setTimeout(r, 20));
    running -= 1;
    return tag;
  };
  const call = (ip, tag) => server.call({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [tag] }, { ip, local: false });
  const results = await Promise.all([call('198.51.100.1', 'a'), call('198.51.100.1', 'b'), call('198.51.100.1', 'c')]);
  assert.deepEqual(results.map((r) => r.result), ['a', 'b', 'c']);
  assert.equal(peak, 1, 'one caller never runs two at once');
  peak = 0;
  await Promise.all([call('198.51.100.1', 'd'), call('198.51.100.2', 'e')]);
  assert.equal(peak, 2, 'two callers run side by side');
  // A caller with a full queue gets an error, not an unbounded wait.
  const flood = await Promise.all(Array.from({ length: 40 }, (_, i) => call('2001:db8:1:2::7', String(i)).then((r) => r.error?.code ?? 0)));
  assert.ok(flood.filter((c) => c === -32005).length >= 7);
  assert.equal(server.heavy.size, 0, 'nothing is left behind');
  // Local callers (this computer, the app) are not queued.
  peak = 0;
  await Promise.all(['x', 'y'].map((t) => server.call({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [t] })));
  assert.equal(peak, 2);
});

test('the rate limit counts IPv6 callers by /64 and never resets everyone at once', () => {
  assert.equal(limitKey('2001:db8:1:2:aaaa::1'), limitKey('2001:db8:1:2:bbbb::2'));
  assert.notEqual(limitKey('2001:db8:1:2::1'), limitKey('2001:db8:1:3::1'));
  assert.equal(limitKey('::ffff:198.51.100.1'), '198.51.100.1');
  const server = new RpcServer(node, { rateLimit: 10 });
  const victim = { ip: '198.51.100.9', local: false };
  for (let i = 0; i < 10; i++) assert.ok(server._allow(victim));
  assert.equal(server._allow(victim), false);
  for (let i = 0; i < 50_010; i++) server._allow({ ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, local: false });
  assert.equal(server._allow(victim), false, 'many new addresses do not clear an exhausted limit');
});

test('the preflight of a page on the internet may read this node (Private Network Access), only when the browser asks', () => {
  const server = new RpcServer(node, {});
  const answer = (headers) => {
    const out = {};
    const res = { setHeader: (k, v) => { out[k.toLowerCase()] = v; }, writeHead: (code) => { out.status = code; }, end: () => {} };
    server._http({ method: 'OPTIONS', url: '/', headers }, res);
    return out;
  };
  const asked = answer({ 'access-control-request-private-network': 'true' });
  assert.equal(asked.status, 204);
  assert.equal(asked['access-control-allow-private-network'], 'true');
  assert.equal(answer({})['access-control-allow-private-network'], undefined);
test('coin supply as a plain number for trackers: total, circulating and maximum', async () => {
  const server = new RpcServer(node, {});
  server.methods.aether_stats = () => ({ supply: '90704500000000000000000', maxSupply: '64000000000000000000000000' });
  const get = (url) => new Promise((resolve) => {
    const out = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, writeHead: (code, h = {}) => { out.status = code; Object.assign(out.headers, h); }, end: (body) => { out.body = body; resolve(out); } };
    server._http({ method: 'GET', url, headers: {}, socket: { remoteAddress: '198.51.100.9' } }, res);
  });
  assert.equal((await get('/api/supply/total')).body, '90704.5');
  assert.equal((await get('/api/supply/circulating')).body, '90704.5');
  const max = await get('/api/supply/max');
  assert.equal(max.body, '64000000');
  assert.match(max.headers['Content-Type'], /text\/plain/);
});
