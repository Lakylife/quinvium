// When the network's own RPC server is down, the Chrome wallet switches to a verified community node it learned
// earlier (quinvium_publicNodes), but only one that confirms the right chain ID.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const GENESIS = '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39';

function load(fetchImpl, stored = {}) {
  const any = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any), apply: () => any, construct: () => any });
  const storage = { get: async (k) => (typeof k === 'string' ? { [k]: stored[k] } : { ...stored }), set: async (o) => Object.assign(stored, o), remove: async () => {}, clear: async () => {} };
  const self = {};
  const bundle = vm.createContext({ globalThis: {}, self: {}, window: {} });
  vm.runInContext(readFileSync(join(__dirname, '..', 'ethers.umd.min.js'), 'utf8'), bundle);
  self.ethers = bundle.ethers ?? bundle.self.ethers ?? bundle.globalThis.ethers ?? bundle.window.ethers;
  const ctx = vm.createContext({
    self, globalThis: self, console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, fetch: fetchImpl,
    chrome: new Proxy({ storage: { local: storage, session: storage } }, { get: (t, k) => (k in t ? t[k] : any) }),
    importScripts: () => {}, AetherText: any,
  });
  vm.runInContext(`${source}\n;globalThis.__rpc = rpc;`, ctx);
  return { rpc: self.__rpc ?? ctx.__rpc, stored };
}

/** A fake network: url -> handler(method) returning a result, or undefined when the server is down. */
const net = (servers, calls = []) => async (url, init) => {
  const { method } = JSON.parse(init.body);
  calls.push(`${url} ${method}`);
  const handler = servers[url];
  const result = handler?.(method);
  if (result === undefined) throw new TypeError('fetch failed');
  return { json: async () => (result instanceof Error ? { error: { code: -32000, message: result.message } } : { result }) };
};

test('with the main server up, the wallet learns the community nodes from it', async () => {
  const { rpc, stored } = load(net({ 'https://rpc.quinvium.com': (m) => (m === 'quinvium_publicNodes' ? [{ url: 'https://node.example.org' }, { url: 'http://plain.example' }] : '0x10') }));
  assert.equal(await rpc('eth_blockNumber'), '0x10');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(JSON.stringify(stored['community.52401']), '["https://node.example.org"]', 'only https nodes are kept');
});

test('with the main server down, the wallet uses a community node with the right chain ID', async () => {
  const calls = [];
  const { rpc } = load(net({
    'https://wrong.example': (m) => (m === 'eth_chainId' ? '0x1' : '0x99'),
    'https://good.example': (m) => (m === 'eth_chainId' ? '0xccb1' : m === 'eth_getBlockByNumber' ? { hash: GENESIS } : '0x20'),
    'https://fork.example': (m) => (m === 'eth_chainId' ? '0xccb1' : m === 'eth_getBlockByNumber' ? { hash: '0x' + '22'.repeat(32) } : '0x77'),
  }, calls), { 'community.52401': ['https://wrong.example', 'https://fork.example', 'https://good.example'] });
  assert.equal(await rpc('eth_blockNumber'), '0x20');
  assert.ok(!calls.includes('https://wrong.example eth_blockNumber'), 'a node of another chain is never used');
  assert.ok(!calls.includes('https://fork.example eth_blockNumber'), 'a node with another genesis is never used');
  calls.length = 0;
  assert.equal(await rpc('eth_blockNumber'), '0x20');
  assert.equal(calls.join(), 'https://good.example eth_blockNumber', 'the found node is used directly for a while');
});

test('an error answer is passed on, not treated as an outage', async () => {
  const { rpc } = load(net({ 'https://rpc.quinvium.com': () => new Error('nonce too low'), 'https://good.example': () => '0xccb1' }), { 'community.52401': ['https://good.example'] });
  await assert.rejects(rpc('eth_sendRawTransaction', ['0x00']), /nonce too low/);
});

test('with no community node, the wallet reports the main server as unreachable', async () => {
  const { rpc } = load(net({}));
  await assert.rejects(rpc('eth_blockNumber'), /Node https:\/\/rpc.quinvium.com is not reachable/);
});
