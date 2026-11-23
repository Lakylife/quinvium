// The network's own node is down and only community nodes (nodes.json) remain: it refuses at once, answers 522 after a delay
// as a proxy does, or never answers at all. A first visit, a reload and an open page must show data soon in each case.
// A node that is only slow must not be given up. Real Chromium against a real dev node.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PORT = 8761;
const RPC = `http://127.0.0.1:${PORT}`;
const OWN = 'https://own.test';
const GOOD = 'https://good.community.test';
const LIMIT = 10_000;   // data must show within this time
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const call = async (method, params = []) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
let failed = 0;
const step = async (name, fn) => {
  try { const note = await fn(); console.log(`[OK  ] ${name}${note ? ` (${note})` : ''}`); } catch (e) { failed += 1; console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`); }
};
const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-silent-')), '--dev-mine',
  '--miner-address', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
let browser;
try {
  const end = Date.now() + 120_000;
  while (!(Number(await call('eth_blockNumber').catch(() => 0)) >= 2)) { if (Date.now() > end) throw new Error('the node did not start'); await sleep(300); }
  const genesis = (await call('eth_getBlockByNumber', ['0x0', false])).hash;
  browser = await chromium.launch();
  const DOWN = {
    'refuses at once': (r) => r.abort('failed'),
    'answers 522 after 19 s': async (r) => { await sleep(19_000); await r.fulfill({ status: 522, body: 'origin down' }); },
    'never answers': () => {},
  };
  /** @param {{down: Function|null, delay?: (method: string) => number}} state what the network's own node does right now */
  async function open(state) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.errors = [];
    page.community = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    const serve = (route) => route.fetch({ url: RPC }).then((response) => route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } }));
    const pass = (route) => serve(route).catch(() => {});
    await page.route('https://explorer.test/**', (route) => route.fetch({ url: RPC + new URL(route.request().url()).pathname }).then((response) => route.fulfill({ response })).catch(() => {}));
    await page.route(`${OWN}/**`, async (route) => {
      if (route.request().method() === 'OPTIONS') return pass(route);
      if (state.down) return Promise.resolve(state.down(route)).catch(() => {});
      const wait = state.delay?.(JSON.parse(route.request().postData() ?? '{}').method) ?? 0;
      if (wait) await sleep(wait);
      return pass(route);
    });
    await page.route(`${GOOD}/**`, (route) => { page.community.push(Date.now()); return pass(route); });
    await page.route('http://127.0.0.1:8547/**', (route) => route.abort());
    // The live connection is down too, as with a server that is off.
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.route('**/nodes.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ 52403: [GOOD] }) }));
    await page.route('**/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `window.AETHER_CONFIG = { walletConnectProjectId: '', rpc: ['${OWN}'], expect: { chainId: 52403, genesis: '${genesis}' } };` }));
    return page;
  }
  const shown = (page) => page.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? '') && document.querySelector('#app a[href^="/block/"]'), null, { timeout: 60_000 });
  const timed = async (fn, limit = LIMIT) => { const t = Date.now(); await fn(); const ms = Date.now() - t; assert.ok(ms <= limit, `took ${(ms / 1000).toFixed(1)} s`); return `${(ms / 1000).toFixed(1)} s`; };

  for (const [name, down] of Object.entries(DOWN)) {
    let page;
    await step(`${name}: a first visit shows data from a community node`, async () => {
      page = await open({ down });
      return timed(async () => { await page.goto('https://explorer.test/blocks', { waitUntil: 'commit' }); await shown(page); });
    });
    await step(`${name}: a reload does not wait for it again`, () => timed(async () => { await page.reload({ waitUntil: 'commit' }); await shown(page); }, 6000));
    await step(`${name}: no JavaScript error`, () => { assert.deepEqual(page.errors, []); });
    await page.context().close();
    await step(`${name}: an open page goes on with new blocks`, async () => {
      const state = { down: null };
      const p = await open(state);
      await p.goto('https://explorer.test/');
      await shown(p);
      assert.equal(p.errors.length, 0);
      state.down = down;
      const top = await p.$eval('#app', (a) => a.innerText.match(/#([\d,]+)/)?.[1]);
      // Found at the next regular refresh (15 s), then switched; the dev node mines all the time.
      const note = await timed(() => p.waitForFunction((was) => (document.querySelector('#app').innerText.match(/#([\d,]+)/)?.[1] ?? was) !== was, top, { timeout: 90_000 }), 30_000);
      await p.context().close();
      return note;
    });
  }
  await step('a slow query on a node that answers otherwise is waited for, not moved elsewhere', async () => {
    const page = await open({ down: null, delay: (m) => (m === 'aether_stats' ? 8000 : 0) });
    await page.goto('https://explorer.test/blocks');
    await shown(page);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('quinvium.deadNodes.explorer.test')), null, 'the slow node is not marked as down');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((x) => /community/.test(x.textContent))), false);
    await page.context().close();
  });
  await step('the page returns to the network\'s own node when it is back', async () => {
    const state = { down: DOWN['refuses at once'] };
    const page = await open(state);
    await page.goto('https://explorer.test/blocks');
    await shown(page);
    state.down = null;
    await page.waitForFunction(() => sessionStorage.getItem('quinvium.deadNodes.explorer.test') === '{}', null, { timeout: 90_000 });
    await page.context().close();
  });
} finally {
  await browser?.close();
  node.kill('SIGKILL');
}
console.log(failed ? `FAILED ${failed}` : 'All passed.');
process.exit(failed ? 1 : 0);
