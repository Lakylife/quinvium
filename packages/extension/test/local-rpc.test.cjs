// Inside the desktop app the wallet must use the app's own node: the app's CSP allows only 127.0.0.1,
// so a public RPC would always look unreachable ("Node https://rpc.quinvium.com is not reachable").
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');

/** Loads background.js with a stub of the chrome API and returns the DEFAULT_NETWORKS it ends up with. */
function load(globals, stored = {}) {
  const any = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any), apply: () => any, construct: () => any });
  const storage = { get: async (k) => (typeof k === 'string' ? { [k]: stored[k] } : { ...stored }), set: async () => {}, remove: async () => {}, clear: async () => {} };
  const self = { ...globals };
  // The real bundled ethers, as the wallet gets it from importScripts.
  const bundle = vm.createContext({ globalThis: {}, self: {}, window: {} });
  vm.runInContext(readFileSync(join(__dirname, '..', 'ethers.umd.min.js'), 'utf8'), bundle);
  self.ethers = bundle.ethers ?? bundle.self.ethers ?? bundle.globalThis.ethers ?? bundle.window.ethers;
  const ctx = vm.createContext({
    self, globalThis: self, console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, setInterval, clearInterval, fetch: async () => { throw new Error('offline'); },
    chrome: new Proxy({ storage: { local: storage, session: storage } }, { get: (t, k) => (k in t ? t[k] : any) }),
    importScripts: () => {}, AetherText: any,
  });
  vm.runInContext(`${source}\n;globalThis.__nets = DEFAULT_NETWORKS; globalThis.__networks = networks;`, ctx);
  return { defaults: self.__nets ?? ctx.__nets, networks: self.__networks ?? ctx.__networks };
}

test('the Chrome extension keeps the public nodes', () => {
  const { defaults } = load({});
  assert.equal(defaults[52401].rpc, 'https://rpc.quinvium.com');
  assert.equal(defaults[52402].rpc, 'https://rpc1.quinvium.com');
});

test('inside the app the wallet uses the local node, also over an older stored copy', async () => {
  const local = { 52401: 'http://127.0.0.1:8545', 52402: 'http://127.0.0.1:8546' };
  const { defaults, networks } = load({ AETHER_LOCAL_RPC: local }, { networks: { 52401: { chainId: 52401, name: 'Quinvium', rpc: 'https://rpc.quinvium.com' } } });
  assert.equal(defaults[52401].rpc, local[52401]);
  assert.equal(defaults[52402].rpc, local[52402]);
  const all = await networks();
  assert.equal(all[52401].rpc, local[52401], 'a stored public RPC does not win inside the app');
});

test('the test app keeps its own testnet port', () => {
  const { defaults } = load({ AETHER_LOCAL_RPC: { 52401: 'http://127.0.0.1:8545', 52402: 'http://127.0.0.1:8546' }, AETHER_TEST_RPC: 'http://127.0.0.1:9999' });
  assert.equal(defaults[52402].rpc, 'http://127.0.0.1:9999');
});
