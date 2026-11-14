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
  throw new Error('vypršel čas');
};

const a = startNode(8791);
const b = startNode(8794);
let browser;
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`[OK]   ${name}`); } catch (e) { failed++; console.log(`[FAIL] ${name}: ${e.message}`); }
};
try {
  await waitFor(async () => (await height(a.url)) >= 2 && (await height(b.url)) >= 2);
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
  await step('after the selected node fails the Explorer switches to the second and keeps showing blocks', async () => {
    const [down, other] = chosen === a.url ? [a, b] : [b, a];
    down.proc.kill('SIGKILL');
    await waitFor(async () => !(await height(down.url).then(() => true, () => false)), 10000);
    // The second node now serves the page. The stored selected node does not answer, so the first query switches to a live one.
    await page.goto(`${other.url}/blocks`);
    await page.waitForFunction((url) => localStorage.getItem('aether.rpc') === url, other.url, { timeout: 20000 });
    await page.waitForFunction(() => /#\d/.test(document.getElementById('footer-status')?.textContent ?? ''), null, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('app').innerText.trim().length > 0 && !document.querySelector('#app .skel'), null, { timeout: 20000 });
    assert.match(await page.innerText('#app'), /\d/, 'stránka bloků ukazuje bloky');
    assert.deepEqual(errors, []);
  });
} finally {
  await browser?.close();
  a.proc.kill('SIGKILL');
  b.proc.kill('SIGKILL');
}
console.log(failed ? `NEPROŠLO ${failed}` : 'Vše prošlo.');
process.exit(failed ? 1 : 0);
