// Pool display names from the PoolNames registry: without the registry the new pool page offers to deploy it; with it the
// operator sets a display name and a website on the pool page (for the registry's fee, then the 30-day wait shows), the
// pool page uses that name as its title and keeps the contract name below it, and the pools list shows the display name.
// Real Chromium against a real dev node; deployments.json is replaced by the test, as the Explorer would get it after an update.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'node', 'package.json'));
const { ethers } = require('ethers');
const artifacts = JSON.parse(readFileSync(join(here, '..', '..', 'contracts', 'dist', 'artifacts.json'), 'utf8'));
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PORT = 8747;
const RPC = `http://127.0.0.1:${PORT}`;
const wallet = ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');
const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, pollingInterval: 200 });
const until = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out');
};
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`[OK  ] ${name}`); } catch (e) { failed += 1; console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`); }
};

const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-poolnames-')), '--dev-mine', '--miner-address', wallet.address,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
let browser;
try {
  await until(async () => (await provider.getBalance(wallet.address)) >= 40n * 10n ** 18n, 120000);
  const signer = wallet.connect(provider);
  let namesAddress = null;

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/deployments.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(namesAddress ? { 52403: { poolNames: namesAddress } } : {}) }));
  await page.exposeFunction('__wallet', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return { result: [wallet.address] };
      case 'eth_chainId': return { result: '0xccb3' };
      case 'eth_sendTransaction': { const t = params[0]; const tx = await signer.sendTransaction({ to: t.to ?? null, data: t.data, value: t.value ?? 0n, gasLimit: t.gas }); return { result: tx.hash }; }
      default: { const res = await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) }); return res.json(); }
    }
  });
  await page.addInitScript(() => {
    const request = async ({ method, params }) => { const r = await window.__wallet(method, params); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.result; };
    window.ethereum = { request, on() {}, removeListener() {} };
    try { localStorage.setItem('aether.lang', 'en'); localStorage.setItem('aether.wallet', 'injected'); } catch { /* test only */ }
  });

  await step('without the registry the new pool page offers to deploy it', async () => {
    await page.goto(`${RPC}/pools/new`);
    await page.waitForSelector('#pool-names-deploy', { timeout: 30000 });
    await page.click('#pool-names-deploy');
    await page.waitForFunction(() => /Confirmed in block/.test(document.getElementById('pool-names-out')?.textContent ?? ''), null, { timeout: 60000 });
    namesAddress = await page.$eval('#pool-names-out a.hash', (a) => a.textContent.trim());
    const code = await provider.getCode(namesAddress);
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', ethers.getBytes(code))).toString('hex');
    assert.equal(hash, artifacts.PoolNames.runtimeSha256, 'the deployed code is the build');
  });

  let pool;
  await step('with the registry the deploy card is gone and a new pool page offers the display name form', async () => {
    await page.goto(`${RPC}/pools/new`);
    await page.waitForSelector('#pool-create', { timeout: 30000 });
    assert.equal(await page.$('#pool-names-deploy'), null);
    await page.fill('input[name=name]', 'Original Pool');
    await page.click('#pool-create');
    await page.waitForURL(/\/pool\/0x/, { timeout: 60000 });
    pool = page.url().match(/0x[0-9a-fA-F]{40}/)[0];
    await page.waitForSelector('#name-save', { timeout: 30000 });
    assert.match(await page.textContent('#name-save'), /Save display name \(10 /);
    assert.match(await page.textContent('#app'), /The fee stays locked in the registry forever/);
  });

  await step('an invalid name is explained before anything is signed', async () => {
    await page.fill('#name-form input[name=display]', 'ab');
    await page.click('#name-save');
    await page.waitForFunction(() => /3 to 32 characters/.test(document.getElementById('name-out')?.textContent ?? ''), null, { timeout: 10000 });
  });

  await step('the operator sets a display name and a website for the fee', async () => {
    const before = await provider.getBalance(namesAddress);
    await page.fill('#name-form input[name=display]', 'Shiny Pool');
    await page.fill('#name-form input[name=website]', 'https://shiny.example');
    await page.click('#name-save');
    await page.waitForFunction(() => /Confirmed in block/.test(document.getElementById('name-out')?.textContent ?? ''), null, { timeout: 60000 });
    assert.equal(await provider.getBalance(namesAddress), before + 10n * 10n ** 18n, 'the fee is locked in the registry');
  });

  await step('the pool page shows the display name, the contract name, the website as text and the 30-day wait', async () => {
    await page.waitForFunction(() => document.querySelector('#app h1')?.textContent.trim() === 'Shiny Pool', null, { timeout: 30000 });
    const text = await page.textContent('#app');
    assert.match(text, /Name in the contract: Original Pool/);
    assert.match(text, /https:\/\/shiny\.example/);
    assert.equal(await page.$('a[href="https://shiny.example"]'), null, 'the website is not a link');
    assert.match(text, /The next change is possible from/);
    assert.equal(await page.$eval('#name-save', (b) => b.disabled), true);
  });

  await step('the pools list shows the display name', async () => {
    await page.goto(`${RPC}/pools`);
    // The node lists pool addresses in lower case.
    const sel = `a[href="/pool/${pool}" i], a[href="/pool/${pool.toLowerCase()}" i]`;
    await page.waitForSelector(sel, { timeout: 30000 });
    const names = await page.$$eval(sel, (as) => as.map((a) => a.textContent.trim()));
    assert.ok(names.includes('Shiny Pool'), names.join(', '));
    assert.ok(!names.includes('Original Pool'), names.join(', '));
  });

  await step('the page reports no JavaScript error', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser?.close();
  node.kill('SIGKILL');
}
console.log(failed ? `FAILED ${failed}` : 'All passed.');
process.exit(failed ? 1 : 0);
