// Pool page: a withdrawal that waits to be mined locks its button, also after a reload, so nobody sends a second one that
// can only fail on chain. The operator's fee button is locked while there is nothing to withdraw.
// Real Chromium against a real dev node; a pending transaction is made by sending it with a nonce gap.
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
const PORT = 8727;
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

const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-poolpending-')), '--dev-mine', '--miner-address', wallet.address,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
let browser;
try {
  await until(async () => (await provider.getBalance(wallet.address)) >= 8n * 10n ** 18n, 120000);
  const signer = wallet.connect(provider);
  const factory = new ethers.Contract(artifacts.PoolFactory.address, artifacts.PoolFactory.abi, signer);
  const r = await (await factory.createPool('Test pool', 'http://127.0.0.1:1', 100, 32, 16)).wait();
  const pool = r.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'PoolCreated').args.pool;
  const poolIface = new ethers.Interface(artifacts.AetherPool.abi);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('__wallet', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return { result: [wallet.address] };
      case 'eth_chainId': return { result: '0xccb3' };
      case 'eth_sendTransaction': { const t = params[0]; const tx = await signer.sendTransaction({ to: t.to, data: t.data, value: t.value ?? 0n, gasLimit: t.gas }); return { result: tx.hash }; }
      default: { const res = await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) }); return res.json(); }
    }
  });
  await page.addInitScript(() => {
    const request = async ({ method, params }) => { const r = await window.__wallet(method, params); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.result; };
    window.ethereum = { request, on() {}, removeListener() {} };
    try { localStorage.setItem('aether.lang', 'en'); localStorage.setItem('aether.wallet', 'injected'); } catch { /* test only */ }
  });
  const open = async () => {
    await page.goto(`${RPC}/pool/${pool}`);
    await page.waitForSelector('#miner-claim', { timeout: 30000 });
    await page.waitForTimeout(1500);
  };

  await step('with nothing to withdraw the operator fee button is locked', async () => {
    await open();
    assert.equal(await page.isDisabled('#op-fee'), true);
  });
  await step('a withdrawal waiting in the queue locks the button, also after a reload', async () => {
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    // nonce + 1: waits for the missing nonce, so it stays pending
    await signer.sendTransaction({ to: pool, data: poolIface.encodeFunctionData('claim', [wallet.address]), nonce: nonce + 1, gasLimit: 300000 });
    await until(async () => (await (await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'aether_mempool', params: [{ address: wallet.address }] }) })).json()).result.total > 0, 20000);
    await open();
    await page.waitForFunction(() => document.getElementById('miner-claim').disabled && /previous transaction/.test(document.getElementById('miner-claim').textContent), null, { timeout: 15000 });
    assert.match(await page.textContent('#miner-out'), /already waiting to be mined/);
    await page.click('#miner-claim', { force: true });
    await page.waitForTimeout(1000);
    assert.equal((await (await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'aether_mempool', params: [{ address: wallet.address }] }) })).json()).result.total, 1, 'no second withdrawal was sent');
    // The missing nonce arrives, both are mined and the button unlocks.
    await signer.sendTransaction({ to: wallet.address, value: 1n, nonce });
    await page.waitForFunction(() => !document.getElementById('miner-claim')?.disabled, null, { timeout: 60000 });
  });
  await step('the page reports no JavaScript error', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser?.close();
  node.kill('SIGKILL');
}
console.log(failed ? `FAILED ${failed}` : 'All passed.');
process.exit(failed ? 1 : 0);
