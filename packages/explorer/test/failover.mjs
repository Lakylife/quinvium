// An Explorer on a domain with several nodes: skips an unavailable node, takes the one with the highest block and after a failure
// of the selected node switches to the second one. Two separate dev network nodes; the page loads from the first.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DEAD = 'http://127.0.0.1:9';

function startNode(port) {
  const proc = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-prepnuti-')),
    '--rpc-port', String(port), '--p2p-port', String(port + 1), '--stratum-port', String(port + 2), '--dev-mine', '--miner-address', ADDRESS], { stdio: 'ignore' });
  return { proc, url: `http://127.0.0.1:${port}` };
}
const height = async (url) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  return Number(BigInt((await r.json()).result));
};
const waitFor = async (fn, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => { setTimeout(r, 200); });
  }
  throw new Error('timed out');
};

const a = startNode(8791);
const b = startNode(8794);
let browser;
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`[OK]   ${name}`); } catch (e) { failed++; console.log(`[FAIL] ${name}: ${e.message}`); }
};
try {
  await waitFor(async () => (await height(a.url)) >= 2 && (await height(b.url)) >= 2, 120000);   // the first block needs the Ethash cache (about 20 s)
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Operator settings: an unavailable node and two running ones. The page itself loads from node A.
  await page.route('**/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.AETHER_CONFIG = { walletConnectProjectId: '', rpc: ['${DEAD}', '${b.url}', '${a.url}'] };` }));
  let chosen;
  await step('an unavailable node is skipped and the node with the highest block is chosen', async () => {
    const [ha, hb] = [await height(a.url), await height(b.url)];
    await page.goto(`${a.url}/blocks`);
    await page.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? ''), null, { timeout: 20000 });
    chosen = await page.evaluate(() => localStorage.getItem('aether.rpc'));
    assert.notEqual(chosen, DEAD);
    const higher = ha > hb + 3 ? a.url : hb > ha + 3 ? b.url : null;
    if (higher) assert.equal(chosen, higher, `výšky ${ha} a ${hb}`);
    else assert.ok([a.url, b.url].includes(chosen));
  });
  await step('a node on another branch than the majority is not used and the page says so', async () => {
    // Two addresses lead to node A (the same chain), node B mines its own branch. B must not be chosen, even when it is higher.
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    for (const mirror of ['http://mirror-one.test', 'http://mirror-two.test']) {
      await p2.route(`${mirror}/**`, (route) => route.fetch({ url: a.url }).then((response) => route.fulfill({ response })).catch(() => {}));
    }
    await p2.route('**/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.AETHER_CONFIG = { walletConnectProjectId: '', rpc: ['${b.url}', 'http://mirror-one.test', 'http://mirror-two.test'] };` }));
    await waitFor(async () => (await height(a.url)) >= 8 && (await height(b.url)) >= 8, 60000);
    await p2.goto(`${a.url}/blocks`);
    await p2.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? ''), null, { timeout: 20000 });
    await p2.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('127.0.0.1:8794')), null, { timeout: 20000 });
    const used = await p2.evaluate(() => localStorage.getItem('aether.rpc'));
    assert.notEqual(used, b.url, 'the node on the other branch is not used');
    await p2.close();
  });
  await step('with the configured node down, the saved community nodes (nodes.json) serve the page, only those on the same chain', async () => {
    const genesis = await fetch(a.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x0', false] }) }).then((r) => r.json()).then((d) => d.result.hash);
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const asked = [];
    // A node of another chain: answers everything, but with chain ID 1.
    await p3.route('https://other-chain.community.test/**', async (route) => {
      const { method } = JSON.parse(route.request().postData() ?? '{}');
      asked.push(method);
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: method === 'eth_chainId' ? '0x1' : method === 'eth_getBlockByNumber' ? { hash: '0x' + '11'.repeat(32), number: '0x0' } : '0x99' }) });
    });
    // A community node of this chain (node A behind an https name).
    await p3.route('https://good.community.test/**', (route) => route.fetch({ url: a.url }).then((response) => route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })).catch(() => {}));
    await p3.route('**/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.AETHER_CONFIG = { walletConnectProjectId: '', rpc: ['${DEAD}'], expect: { chainId: 52403, genesis: '${genesis}' } };` }));
    await p3.route('**/nodes.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ 52403: ['https://other-chain.community.test', 'https://good.community.test'] }) }));
    await p3.goto(`${a.url}/blocks`);
    await p3.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? ''), null, { timeout: 30000 });
    await p3.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('good.community.test')), null, { timeout: 30000 });
    assert.ok(asked.every((m) => m === 'eth_chainId' || m === 'eth_getBlockByNumber'), `the node of another chain was only checked: ${asked.join(', ')}`);
    await p3.close();
  });
  await step('the Network page sets the visitor\'s own node only after checking its chain', async () => {
    const genesis = await fetch(a.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x0', false] }) }).then((r) => r.json()).then((d) => d.result.hash);
    const p4 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await p4.route('**/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.AETHER_CONFIG = { walletConnectProjectId: '', rpc: ['${a.url}'], expect: { chainId: 52403, genesis: '${genesis}' } };` }));
    await p4.goto(`${a.url}/network`);
    await p4.waitForSelector('#own-node', { timeout: 30000 });
    await p4.fill('#own-node input[name=url]', DEAD);
    await p4.click('#own-node button[type=submit]');
    await p4.waitForSelector('.toast', { timeout: 15000 });
    assert.equal(await p4.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('quinvium.userNode.')) ?? null), null, 'a node that does not answer is not saved');
    await p4.fill('#own-node input[name=url]', b.url);
    await Promise.all([p4.waitForEvent('load'), p4.click('#own-node button[type=submit]')]);
    assert.equal(await p4.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('quinvium.userNode.')))), b.url);
    await p4.waitForSelector('#own-reset', { timeout: 30000 });
    await p4.close();
  });
  await step('the node on the visitor\'s computer is asked only when the network\'s nodes are down, then serves the page', async () => {
    const genesis = await fetch(a.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x0', false] }) }).then((r) => r.json()).then((d) => d.result.hash);
    // The Explorer on a domain; the visitor's own node on the default dev port is node A.
    const open = async (rpc) => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const asked = [];
      await p.route('https://explorer.test/**', (route) => route.fetch({ url: a.url + new URL(route.request().url()).pathname }).then((response) => route.fulfill({ response })).catch(() => {}));
      // The network's nodes behind https names: a page on the internet reaches 127.0.0.1 only through the local network permission.
      await p.route('https://own.test/**', (route) => route.fetch({ url: b.url }).then((response) => route.fulfill({ response })).catch(() => {}));
      await p.route('https://down.test/**', (route) => route.abort());
      await p.route('http://127.0.0.1:8547/**', (route) => { asked.push(route.request().url()); return route.fetch({ url: a.url }).then((response) => route.fulfill({ response })); });
      await p.route('**/nodes.json', (route) => route.fulfill({ status: 404, body: '' }));
      await p.route('**/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.AETHER_CONFIG = { walletConnectProjectId: '', rpc: ['${rpc}'], expect: { chainId: 52403, genesis: '${genesis}' } };` }));
      await p.goto('https://explorer.test/blocks');
      await p.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? ''), null, { timeout: 30000 });
      return { p, asked };
    };
    const up = await open('https://own.test');
    await new Promise((r) => { setTimeout(r, 3000); });
    assert.deepEqual(up.asked, [], 'with the network\'s node up, the visitor\'s computer is not asked');
    await up.p.close();
    const down = await open('https://down.test');
    await down.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /your computer/.test(t.textContent)), null, { timeout: 30000 });
    assert.ok(down.asked.length > 0);
    await down.p.close();
  });
  await step('after the selected node fails the Explorer switches to the second and keeps showing blocks', async () => {
    const [down, other] = chosen === a.url ? [a, b] : [b, a];
    down.proc.kill('SIGKILL');
    await waitFor(async () => !(await height(down.url).then(() => true, () => false)), 10000);
    // The second node now serves the page. The stored selected node does not answer, so the first query switches to a live one.
    await page.goto(`${other.url}/blocks`);
    await page.waitForFunction((url) => localStorage.getItem('aether.rpc') === url, other.url, { timeout: 20000 });
    await page.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? ''), null, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('app').innerText.trim().length > 0 && !document.querySelector('#app .skel'), null, { timeout: 20000 });
    assert.match(await page.innerText('#app'), /\d/, 'the blocks page shows blocks');
    assert.deepEqual(errors, []);
  });
} finally {
  await browser?.close();
  a.proc.kill('SIGKILL');
  b.proc.kill('SIGKILL');
}
console.log(failed ? `FAILED ${failed}` : 'All passed.');
process.exit(failed ? 1 : 0);
