// Public RPC nodes of the community: signed announcements, checks of each address, and the tunnel port of the RPC server.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NodeIdentity } from '../src/p2p/identity.js';
import { ANNOUNCE_TTL_MS, PublicNodes, signAnnouncement, validUrl, verifyAnnouncement } from '../src/watch/public-nodes.js';
import { RpcServer } from '../src/rpc/server.js';
import { MINING_METHODS } from '../src/rpc/methods.js';

const identity = () => new NodeIdentity(crypto.generateKeyPairSync('ed25519').privateKey);
const hashAt = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const chain = (head = 100n) => ({ head: { number: head }, store: { canonicalHash: (n) => Buffer.from(hashAt(n).slice(2), 'hex') } });
/** Node keys of the fake nodes: the key that announced each address, unless a node sets another. */
const keyOf = new Map();
/** A fake public node answering JSON-RPC: chain ID, block hashes, head and node key can be set per address. */
const fakeFetch = (nodes) => async (url, init) => {
  const n = nodes[url];
  if (!n) throw new Error('unreachable');
  const { method, params } = JSON.parse(init.body);
  const result = method === 'eth_chainId' ? `0x${n.chainId.toString(16)}`
    : method === 'eth_blockNumber' ? `0x${n.head.toString(16)}`
      : method === 'quinvium_nodeInfo' ? { publicKey: n.publicKey ?? keyOf.get(url) ?? null }
        : { hash: n.hash ? n.hash(BigInt(params[0])) : hashAt(BigInt(params[0])) };
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};

test('only plain https host names are accepted, never IP addresses, ports or paths', () => {
  assert.ok(validUrl('https://quiet-river-1234.trycloudflare.com'));
  assert.ok(validUrl('https://rpc.example.org'));
  for (const bad of ['http://rpc.example.org', 'https://203.0.113.7', 'https://[2001:db8::1]', 'https://rpc.example.org:8545',
    'https://rpc.example.org/x', 'https://user:pw@rpc.example.org', 'https://rpc.example.org?a=1', 'https://localhost', 'https://RPC.example.org', 'x'.repeat(300)]) {
    assert.equal(validUrl(bad), false, bad);
  }
});

test('an announcement is valid only with its own key, network and expiry', () => {
  const id = identity();
  const expires = Date.now() + 60_000;
  const a = { url: 'https://a.trycloudflare.com', key: new Uint8Array(id.publicKey), expires, sig: new Uint8Array(signAnnouncement(id, '52401', 'https://a.trycloudflare.com', expires)) };
  assert.ok(verifyAnnouncement(a, '52401'));
  assert.equal(verifyAnnouncement(a, '52402'), false, 'another network');
  assert.equal(verifyAnnouncement({ ...a, url: 'https://b.trycloudflare.com' }, '52401'), false, 'another address');
  assert.equal(verifyAnnouncement({ ...a, expires: expires + 1 }, '52401'), false, 'a longer validity');
  assert.equal(verifyAnnouncement({ ...a, key: new Uint8Array(identity().publicKey) }, '52401'), false, 'someone else\'s key');
});

test('addresses are listed only after this node checked them: same chain, same settled block, head close', async () => {
  const good = 'https://good.trycloudflare.com';
  const fork = 'https://fork.trycloudflare.com';
  const behind = 'https://behind.trycloudflare.com';
  const other = 'https://other.trycloudflare.com';
  const pn = new PublicNodes({
    chain: chain(100n), identity: identity(), chainId: 52401,
    fetchImpl: fakeFetch({
      [good]: { chainId: 52401, head: 101n },
      [fork]: { chainId: 52401, head: 100n, hash: () => hashAt(999n) },
      [behind]: { chainId: 52401, head: 50n },
      [other]: { chainId: 52402, head: 100n },
    }),
  });
  const announce = (url) => { const id = identity(); keyOf.set(url, Buffer.from(id.publicKey).toString('hex')); const expires = Date.now() + 60_000; return { url, key: new Uint8Array(id.publicKey), expires, sig: new Uint8Array(signAnnouncement(id, '52401', url, expires)) }; };
  assert.equal(pn.receive([good, fork, behind, other].map(announce)), 4);
  await Promise.all([...pn.entries.values()].map((e) => pn.check(e)));
  assert.deepEqual(pn.list().map((e) => e.url), [good]);
  assert.match(pn.list()[0].node, /^[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(pn.list()).match(/\d+\.\d+\.\d+\.\d+/), null, 'no IP addresses');
  // Expired, too long or forged announcements are dropped.
  const late = announce('https://late.trycloudflare.com');
  assert.equal(pn.receive([{ ...late, expires: Date.now() - 1 }]), 0);
  assert.equal(pn.receive([{ ...late, expires: Date.now() + ANNOUNCE_TTL_MS * 2 }]), 0);
  assert.equal(pn.receive([{ ...late, sig: new Uint8Array(64) }]), 0);
});

test('a sharing node signs its own address and passes on only verified ones', async () => {
  const url = 'https://mine.trycloudflare.com';
  const id = identity();
  keyOf.set(url, Buffer.from(id.publicKey).toString('hex'));
  const pn = new PublicNodes({ chain: chain(), identity: id, chainId: 52401, fetchImpl: fakeFetch({ [url]: { chainId: 52401, head: 100n } }) });
  const own = pn.share(url);
  assert.ok(verifyAnnouncement(own, '52401'));
  assert.deepEqual(pn.outgoing().map((e) => e.url), [url]);
  await pn.check(pn.entries.get(url));
  assert.equal(pn.list()[0].own, true);
  assert.throws(() => pn.share('https://203.0.113.7'));
  pn.share(null);
  assert.deepEqual(pn.outgoing(), []);
});

test('the tunnel port: every request is foreign, limited per Cf-Connecting-IP, without mining or node control', async () => {
  const node = { chain: { network: { name: 'mainnet', chainId: 52401n }, head: { number: 1n } }, network: { peers: new Set(), sendPublicNodes() {} }, mempool: {}, work: null, version: 'test', publicNodes: { share: () => ({ url: 'x', expires: 1 }), outgoing: () => [], list: () => [] } };
  const server = new RpcServer(node, { tunnelPort: 0, rateLimit: 6000 });
  const req = (ip) => ({ viaTunnel: true, headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } });
  const a = server._caller(req('198.51.100.7'));
  assert.deepEqual(a, { ip: '198.51.100.7', local: false, tunnel: true });
  assert.equal(server._caller(req('not an ip')).ip, 'tunnel');
  for (const m of [...MINING_METHODS, 'aether_setPublicUrl', 'quinvium_setPublicUrl']) {
    const r = await server.call({ jsonrpc: '2.0', id: 1, method: m, params: [] }, a);
    assert.equal(r.error?.code, -32601, m);
  }
  const listed = await server.call({ jsonrpc: '2.0', id: 1, method: 'quinvium_publicNodes', params: [] }, a);
  assert.deepEqual(listed.result, []);
  // One visitor's limit does not use up another's.
  let n = 0;
  while (server._allow(a)) n++;
  assert.equal(n, 1200);
  assert.ok(server._allow(server._caller(req('198.51.100.8'))));
  // This computer may set the address; a caller from the internet on the normal port may not.
  assert.ok((await server.call({ jsonrpc: '2.0', id: 1, method: 'aether_setPublicUrl', params: ['https://x.trycloudflare.com'] })).result);
  assert.equal((await server.call({ jsonrpc: '2.0', id: 1, method: 'aether_setPublicUrl', params: [null] }, { ip: '198.51.100.9', local: false })).error?.code, -32601);
});

test('peers exchange signed addresses: the list sent is the list received, older nodes get nothing', async () => {
  const { Network, FEATURE_PUBLIC_NODES } = await import('../src/p2p/network.js');
  const { EventEmitter } = await import('node:events');
  const id = identity();
  const expires = Date.now() + 60_000;
  const url = 'https://share.trycloudflare.com';
  const entry = { url, key: new Uint8Array(id.publicKey), expires, sig: new Uint8Array(signAnnouncement(id, '52401', url, expires)) };
  const sent = [];
  const peer = (features) => ({ ready: true, features, send: (type, body) => sent.push({ features, type, body }) });
  const net = Object.assign(new EventEmitter(), { peers: new Set([peer(1), peer(1 | FEATURE_PUBLIC_NODES)]) });
  Network.prototype.sendPublicNodes.call(net, [entry]);
  assert.equal(sent.length, 1, 'only the peer that understands it');
  const received = [];
  net.on('public-nodes', (list) => received.push(...list));
  const from = { misbehave: () => assert.fail('a valid list is not misbehaviour') };
  Network.prototype._onPublicNodes.call(net, from, sent[0].body);
  assert.deepEqual(received.map((e) => e.url), [url]);
  assert.ok(verifyAnnouncement(received[0], '52401'), 'the signature survives the wire');
  Network.prototype._onPublicNodes.call(net, from, sent[0].body);
  assert.equal(received.length, 1, 'at most one list a minute from one peer');
});

test('an address is listed only when it leads to the node that signed it, and each node key has one address', async () => {
  const theirs = 'https://rpc.example.org';
  const proxy = 'https://proxy.example.org';
  const attacker = identity();
  const owner = identity();
  const pn = new PublicNodes({
    chain: chain(100n), identity: identity(), chainId: 52401,
    // Someone else's working node (and a proxy to it) answers with its own key, not the attacker's.
    fetchImpl: fakeFetch({ [theirs]: { chainId: 52401, head: 100n, publicKey: Buffer.from(owner.publicKey).toString('hex') }, [proxy]: { chainId: 52401, head: 100n, publicKey: Buffer.from(owner.publicKey).toString('hex') } }),
  });
  const sign = (id, url, expires) => ({ url, key: new Uint8Array(id.publicKey), expires, sig: new Uint8Array(signAnnouncement(id, '52401', url, expires)) });
  const now = Date.now();
  assert.equal(pn.receive([sign(attacker, theirs, now + 60_000)]), 1);
  await Promise.all([...pn.entries.values()].map((e) => pn.check(e)));
  assert.deepEqual(pn.list(), [], 'signed by a key that does not run the node');
  // A newer announcement of the same key moves the entry; it does not add a second one.
  assert.equal(pn.receive([sign(attacker, proxy, now + 120_000)]), 1);
  assert.deepEqual([...pn.entries.keys()], [proxy]);
  assert.equal(pn.receive([sign(attacker, theirs, now + 90_000)]), 0, 'an older announcement of the same key is ignored');
});

test('proxy headers count only from the proxy on this computer, and a foreign web page never controls the node', () => {
  const node = { chain: { network: { name: 'mainnet', chainId: 52401n }, head: { number: 1n } }, network: { peers: new Set(), sendPublicNodes() {} }, mempool: {}, work: null, version: 'test', publicNodes: { share: () => ({ url: 'x', expires: 1 }), outgoing: () => [], list: () => [] } };
  const req = (remoteAddress, headers = {}) => ({ headers: { host: '127.0.0.1:8545', ...headers }, socket: { remoteAddress } });
  const proxied = new RpcServer(node, { trustProxy: true });
  // Through the proxy on this computer: the real client address, foreign.
  assert.deepEqual(proxied._caller(req('127.0.0.1', { 'x-forwarded-for': '198.51.100.7' })), { ip: '198.51.100.7', local: false });
  // A client that reaches the backend port directly cannot claim to be this computer.
  for (const spoof of ['127.0.0.1', '::1', '10.0.0.5']) {
    const c = proxied._caller(req('198.51.100.7', { 'x-forwarded-for': spoof }));
    assert.deepEqual(c, { ip: '198.51.100.7', local: false }, spoof);
  }
  const plain = new RpcServer(node, {});
  // A program on this computer (the app, the miner) sends no Origin: local.
  assert.equal(plain._caller(req('127.0.0.1')).local, true);
  // The node's own Explorer: same origin, local.
  assert.equal(plain._caller(req('127.0.0.1', { origin: 'http://127.0.0.1:8545' })).local, true);
  // Any other web page or extension in the browser on this computer: foreign.
  for (const origin of ['https://evil.example', 'http://localhost:8545', 'null', 'chrome-extension://abc', 'file://']) {
    assert.equal(plain._caller(req('127.0.0.1', { origin })).local, false, origin);
  }
});

test('DNS rebinding: a page whose name points to 127.0.0.1 is a foreign caller, the names of this computer stay local', async () => {
  const shared = [];
  const node = { chain: { network: { name: 'mainnet', chainId: 52401n }, head: { number: 1n } }, network: { peers: new Set(), sendPublicNodes() {} }, mempool: {}, work: null, version: 'test', publicNodes: { share: (url) => { shared.push(url); return { url, expires: 1 }; }, outgoing: () => [], list: () => [] } };
  const plain = new RpcServer(node, { port: 8545 });
  const req = (host, headers = {}) => ({ headers: { ...(host === undefined ? {} : { host }), ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  // The attacker's page: its origin matches its own Host, but that Host is not this computer.
  for (const [host, origin] of [['evil.example', 'http://evil.example'], ['evil.example:8545', 'http://evil.example:8545'], ['evil.example:8545', undefined], ['127.0.0.1.evil.example:8545', 'http://127.0.0.1.evil.example:8545']]) {
    const caller = plain._caller(req(host, origin ? { origin } : {}));
    assert.equal(caller.local, false, `${host} ${origin}`);
    const r = await plain.call({ jsonrpc: '2.0', id: 1, method: 'quinvium_setPublicUrl', params: ['https://rpc.evil.example'] }, caller);
    assert.equal(r.error?.code, -32601, `${host}: setPublicUrl refused`);
  }
  assert.deepEqual(shared, []);
  // This computer by name, with and without the Explorer's own origin.
  for (const host of ['127.0.0.1:8545', 'localhost:8545', '[::1]:8545', '127.0.0.1']) {
    assert.equal(plain._caller(req(host)).local, true, host);
    assert.equal(plain._caller(req(host, { origin: `http://${host}` })).local, true, `${host} with its origin`);
  }
  assert.equal(plain._caller(req('LOCALHOST:8545')).local, true, 'the name is not case-sensitive');
  // HTTP/1.0 tools send no Host: as before.
  assert.equal(plain._caller(req(undefined)).local, true);
  // One of this computer's own interface addresses (for example a miner on the LAN at http://192.168.1.10:8545).
  plain.ownAddresses = new Set(['192.168.1.10']);
  plain.ownAddressesAt = Date.now();
  assert.equal(plain._caller(req('192.168.1.10:8545')).local, true);
  assert.equal(plain._caller(req('192.168.1.11:8545')).local, false);
  // The address the server was bound to.
  const bound = new RpcServer(node, { host: '10.1.2.3' });
  bound.ownAddresses = new Set();
  bound.ownAddressesAt = Date.now();
  assert.equal(bound._caller(req('10.1.2.3:8545')).local, true);
  // The real interface list is read when nothing is cached.
  assert.ok(new RpcServer(node, {})._ownAddresses() instanceof Set);
});
