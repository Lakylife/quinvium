// Pools that pay their server gas from mined rewards (version 2): without the factory the page offers to deploy it; with
// it a new pool gets a server account, and the pool page shows that account and the gas the pool paid.
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
const PORT = 8737;
const RPC = `http://127.0.0.1:${PORT}`;
const wallet = ethers.Wallet.fromPhrase('test test test test test test test test test test test junk');
const server = ethers.Wallet.createRandom();
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

const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-poolv2-')), '--dev-mine', '--miner-address', wallet.address,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
let browser;
try {
  await until(async () => (await provider.getBalance(wallet.address)) >= 8n * 10n ** 18n, 120000);
  const signer = wallet.connect(provider);
  let factoryAddress = null;

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/deployments.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(factoryAddress ? { 52403: { poolFactory2: factoryAddress } } : {}) }));
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

  await step('without the version 2 factory the new pool page offers to deploy it', async () => {
    await page.goto(`${RPC}/pools/new`);
    await page.waitForSelector('#pool-v2-deploy', { timeout: 30000 });
    assert.equal(await page.$('input[name=relayer]'), null);
    await page.click('#pool-v2-deploy');
    await page.waitForFunction(() => /Confirmed in block/.test(document.getElementById('pool-v2-out')?.textContent ?? ''), null, { timeout: 60000 });
    factoryAddress = await page.$eval('#pool-v2-out a.hash', (a) => a.textContent.trim());
    const code = await provider.getCode(factoryAddress);
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', ethers.getBytes(code))).toString('hex');
    assert.equal(hash, artifacts.PoolFactory2.runtimeSha256, 'the deployed code is the build');
  });

  let pool;
  await step('with the factory a new pool gets the server account and its page shows it', async () => {
    await page.goto(`${RPC}/pools/new`);
    await page.waitForSelector('input[name=relayer]', { timeout: 30000 });
    assert.equal(await page.$('#pool-v2-deploy'), null);
    await page.fill('input[name=name]', 'Gas pool');
    await page.fill('input[name=relayer]', server.address);
    await page.click('#pool-create');
    await page.waitForURL(/\/pool\/0x/, { timeout: 60000 });
    pool = page.url().match(/0x[0-9a-fA-F]{40}/)[0];
    const c = new ethers.Contract(pool, artifacts.AetherPool2.abi, provider);
    assert.equal(await c.relayer(), server.address);
    await page.waitForSelector('#op-relayer', { timeout: 30000 });
    const text = await page.textContent('#app');
    assert.match(text, /Pool server account/);
    assert.match(text, /Gas paid by the pool/);
  });

  await step('the operator changes the server account', async () => {
    const other = ethers.Wallet.createRandom().address;
    await page.fill('#op-form input[name=relayer]', other);
    await page.click('#op-relayer');
    await page.waitForFunction(() => /Confirmed in block/.test(document.getElementById('op-out')?.textContent ?? ''), null, { timeout: 60000 });
    assert.equal(await new ethers.Contract(pool, artifacts.AetherPool2.abi, provider).relayer(), other);
  });

  await step('the address page of a version 2 pool recognises it as a pool', async () => {
    await page.goto(`${RPC}/address/${pool}`);
    await page.waitForSelector('#app h1', { timeout: 30000 });
    await page.waitForFunction((p) => document.querySelector(`a[href="/pool/${p}"]`), pool, { timeout: 30000 });
  });

  await step('the page reports no JavaScript error', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser?.close();
  node.kill('SIGKILL');
}
console.log(failed ? `FAILED ${failed}` : 'All passed.');
process.exit(failed ? 1 : 0);
