// Contract source verification: the page compiles the source in the browser with the official compiler (solc-worker.js),
// compares it with the code on chain, publishes it in the Source registry and the contract page checks it again.
// Real Chromium against a real dev node; the compiler is the official 0.8.38 build, downloaded once into the temporary folder.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'node', 'package.json'));
const { ethers } = require('ethers');
const solc = require('solc');
const artifacts = JSON.parse(readFileSync(join(here, '..', '..', 'contracts', 'dist', 'artifacts.json'), 'utf8'));
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PORT = 8737;
const RPC = `http://127.0.0.1:${PORT}`;
const BUILD = { path: 'soljson-v0.8.38+commit.1835d247.js', version: '0.8.38', build: 'commit.1835d247', longVersion: '0.8.38+commit.1835d247', sha256: '0x6c74ffba0ea4cf9521e78b16052a98208770bb7677616de08ced239f4312d390' };
const SOLJSON = join(tmpdir(), BUILD.path);

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
  try { await fn(); console.log(`[OK  ] ${name}`); } catch (e) { failed += 1; console.log(`[FAIL] ${name}: ${e.message}`); }
};

// A contract with an immutable (blanked when comparing) and a constructor argument.
const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract Box {
    uint256 public immutable born;
    uint256 public value;
    constructor(uint256 v) { born = block.number; value = v; }
    function set(uint256 v) external { value = v; }
}
`;

if (!existsSync(SOLJSON)) {
  const bytes = Buffer.from(await (await fetch(`https://binaries.soliditylang.org/wasm/${BUILD.path}`)).arrayBuffer());
  writeFileSync(SOLJSON, bytes);
}
assert.equal(`0x${createHash('sha256').update(readFileSync(SOLJSON)).digest('hex')}`, BUILD.sha256, 'the cached compiler is the official build');

const data = mkdtempSync(join(tmpdir(), 'aether-verify-'));
const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', data, '--dev-mine', '--miner-address', wallet.address,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
let browser;
try {
  await until(async () => (await provider.getBalance(wallet.address)) >= 8n * 10n ** 18n, 120000);
  const signer = wallet.connect(provider);
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Contract.sol': { content: SOURCE } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const box = out.contracts['Contract.sol'].Box;
  const boxC = await new ethers.ContractFactory(box.abi, `0x${box.evm.bytecode.object}`, signer).deploy(42);
  await boxC.waitForDeployment();
  const boxAt = await boxC.getAddress();
  const reg = await new ethers.ContractFactory(artifacts.SourceRegistry.abi, artifacts.SourceRegistry.bytecode, signer).deploy();
  await reg.waitForDeployment();
  const regAt = await reg.getAddress();

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://binaries.soliditylang.org/wasm/list.json', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ builds: [BUILD], releases: { [BUILD.version]: BUILD.path }, latestRelease: BUILD.version }) }));
  await page.route(`https://binaries.soliditylang.org/wasm/${BUILD.path}`, (route) => route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(SOLJSON) }));
  let registryOn = false;
  await page.route('**/deployments.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(registryOn ? { 52403: { sources: regAt } } : {}) }));
  await page.exposeFunction('__wallet', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return { result: [wallet.address] };
      case 'eth_chainId': return { result: '0xccb3' };
      case 'wallet_addEthereumChain': case 'wallet_switchEthereumChain': return { result: null };
      case 'eth_sendTransaction': {
        const t = params[0];
        const r = await signer.sendTransaction({ to: t.to, data: t.data, value: t.value ?? 0n, gasLimit: t.gas });
        return { result: r.hash };
      }
      default: {
        const r = await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
        return r.json();
      }
    }
  });
  await page.addInitScript(() => {
    const request = async ({ method, params }) => {
      const r = await window.__wallet(method, params);
      if (r.error) throw Object.assign(new Error(r.error.message), r.error);
      return r.result;
    };
    window.ethereum = { request, on() {}, removeListener() {} };
    try { localStorage.setItem('aether.lang', 'en'); localStorage.setItem('aether.wallet', 'injected'); } catch { /* test only */ }
  });
  const verify = async (source, { optimizer = true, evm = '' } = {}) => {
    await page.goto(`${RPC}/verify?address=${boxAt}`);
    await page.waitForSelector('#verify-form select[name=compiler] option', { state: 'attached', timeout: 60000 });
    await page.fill('#verify-form textarea[name=source]', source);
    await page.setChecked('#verify-form input[name=optimizer]', optimizer);
    await page.selectOption('#verify-form select[name=evm]', evm);
    await page.click('#verify-form button[type=submit]');
    await page.waitForFunction(() => /good|bad/.test(document.getElementById('verify-out').className), null, { timeout: 120000 });
    return page.evaluate(() => ({ cls: document.getElementById('verify-out').className, text: document.getElementById('verify-out').textContent }));
  };

  await step('the same source compiled in the browser matches the code on chain exactly, immutables included', async () => {
    const r = await verify(SOURCE);
    assert.match(r.cls, /good/);
    assert.match(r.text, /exactly: Contract\.sol:Box/);
  });
  await step('another EVM version or another source does not match', async () => {
    assert.match((await verify(SOURCE, { evm: 'paris' })).text, /No contract from this source matches/, 'another EVM version');
    assert.match((await verify(SOURCE.replace('{ value = v; }\n}', '{ value = v + 1; }\n}'))).text, /No contract from this source matches/);
    assert.match((await verify(SOURCE.replace('value = v; }\n    function', 'value = v + 1; }\n    function'))).text, /No contract from this source matches/, 'another constructor');
  });
  await step('a changed comment still matches, only the metadata differs', async () => {
    assert.match((await verify(SOURCE.replace('// SPDX', '// a comment\n// SPDX'))).text, /only the metadata/);
  });
  await step('without the registry the page offers to deploy it; the contract page says it is missing', async () => {
    await verify(SOURCE);
    await page.waitForSelector('#src-deploy');
    await page.goto(`${RPC}/address/${boxAt}?tab=code`);
    await page.waitForFunction(() => /not on this network yet/.test(document.getElementById('code-box')?.textContent ?? ''), null, { timeout: 30000 });
  });
  await step('the source is published on chain and the contract page checks it again in the browser', async () => {
    registryOn = true;
    await page.goto(`${RPC}/address/${boxAt}?tab=code`);
    await page.waitForFunction(() => /has not been published/.test(document.getElementById('code-box')?.textContent ?? ''), null, { timeout: 30000 });
    await verify(SOURCE);
    await page.click('#src-publish');
    await page.waitForFunction(() => /good/.test(document.getElementById('src-publish-out')?.className ?? ''), null, { timeout: 60000 });
    // Someone else publishes a wrong source for the same contract: it is shown as not matching and the right one still wins.
    const fake = new ethers.Contract(regAt, artifacts.SourceRegistry.abi, signer);
    await (await fake.publish(boxAt, ethers.hexlify(ethers.toUtf8Bytes('not gzip')))).wait();
    await page.goto(`${RPC}/address/${boxAt}?tab=code`);
    await page.click('#src-check', { timeout: 30000 });
    await page.waitForFunction(() => /Verified in your browser/.test(document.getElementById('code-box')?.textContent ?? ''), null, { timeout: 120000 });
    const text = await page.textContent('#code-box');
    assert.match(text, /Contract\.sol/);
    assert.match(text, /0\.8\.38\+commit\.1835d247/);
    assert.match(text, /contract Box/);
  });
  await step('the page reports no JavaScript error', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser?.close();
  node.kill('SIGKILL');
}
console.log(failed ? `FAILED ${failed}` : 'All passed.');
process.exit(failed ? 1 : 0);
