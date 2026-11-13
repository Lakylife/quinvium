// Přihlášení do aplikace peněženkou mimo ni: MetaMask přes stránku v prohlížeči a WalletConnect přes QR kód.
// Skutečná aplikace i uzel. MetaMask nahrazuje skutečný klíč v druhém prohlížeči, relay WalletConnectu náhrada v testu.
import { _electron as electron, chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

const here = dirname(fileURLToPath(import.meta.url));
const electronPath = createRequire(import.meta.url)('electron');
const results = [];
let win = null;
const step = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    results.push(false);
    console.log(`[FAIL] ${name}: ${e.message.split('\n').slice(0, 3).join(' ')}`);
    console.log('Okno:', (await win?.evaluate(() => document.getElementById('app').innerText.slice(0, 200)).catch(() => ''))?.replace(/\s+/g, ' '));
    throw e;
  }
};
const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => { setTimeout(r, 200); });
  }
  throw new Error('vypršel čas');
};
const app = await electron.launch({
  executablePath: electronPath, args: [join(here, '..')],
  // Vlastní porty uzlu: test běží i vedle otevřené aplikace a jejího uzlu se nedotkne.
  env: { ...process.env, AETHER_NO_SEEDS: '1', AETHER_USER_DATA: mkdtempSync(join(tmpdir(), 'aether-externi-')), AETHER_LAN_PORT: '30594', AETHER_P2P_PORT: '30595', AETHER_RPC_PORT: '18766', AETHER_STRATUM_PORT: '13766' },
});
const errors = [];
let outsider;
try {
  win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForFunction(() => /testnet · block/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await win.waitForSelector('#ext-browser');
  const inExplorer = (code) => win.evaluate((c) => document.getElementById('explorer-view').executeJavaScript(c), code);

  await step('přihlášení přes MetaMask: podpis dokáže adresu, výplata jde na ni a podpisy přes prohlížeč fungují', async () => {
    const outside = ethers.Wallet.createRandom();
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:18766', undefined, { staticNetwork: true, cacheTimeout: -1 });
    await app.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.openedUrl = url; }; });
    await win.click('#ext-browser');
    await until(() => app.evaluate(() => globalThis.openedUrl), 10000);
    const url = await app.evaluate(() => globalThis.openedUrl);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}\/$/, 'stránka je jen místní a s tokenem');
    assert.equal((await fetch(url.replace(/[0-9a-f]{48}\/$/, 'spatny-token/'))).status, 404, 'bez tokenu nic');
    outsider = await chromium.launch();
    try {
      const tab = await outsider.newPage();
      await tab.exposeFunction('fakeWallet', async (method, params) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [outside.address];
        if (method === 'personal_sign') return outside.signMessage(ethers.getBytes(params[0]));
        if (method === 'eth_sendTransaction') {
          const { from: _from, gas, ...tx } = params[0];
          return (await outside.connect(provider).sendTransaction({ ...tx, gasLimit: gas })).hash;
        }
        return null;
      });
      await tab.addInitScript(() => {
        const provider = { request: ({ method, params }) => window.fakeWallet(method, params ?? []) };
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: '1', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider } }));
        window.addEventListener('eip6963:requestProvider', announce);
      });
      await tab.goto(url);
      await tab.click('button');
      await tab.getByText('Keep this tab open').waitFor();
      await win.waitForSelector('#addr');
      assert.equal(await win.evaluate(() => call('address')), outside.address);
      assert.equal((await win.evaluate(() => call('status'))).unlocked, true);
      assert.equal(await win.locator('#lock').count(), 0, 'heslo v aplikaci není, klíče drží peněženka');

      await win.click('nav button[data-tab=mining]');
      await win.waitForFunction((a) => document.getElementById('m-address').textContent === a, outside.address);
      await win.click('#m-start');
      await until(async () => (await provider.getBalance(outside.address)) > 0n, 120000);
      await win.click('#m-stop');
      await win.waitForSelector('#m-start', { state: 'visible' });

      await win.click('nav button[data-tab=wallet]');
      await win.click('#send');
      await win.fill('input[name=to]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
      await win.fill('input[name=value]', '0.5');
      await win.click('#app button[type=submit]');
      await win.waitForSelector('.fee-option');
      await win.click('#confirm');
      await win.waitForSelector('#finish', { timeout: 30000 });
      await win.click('#finish');
      await win.click('nav button[data-tab=explorer]');
      await until(async () => inExplorer("document.getElementById('login-btn')?.classList.contains('connected') === true").catch(() => false), 20000);
      const message = ethers.hexlify(ethers.toUtf8Bytes('podpis z Exploreru'));
      const signature = await inExplorer(`window.aether.request({ method: 'personal_sign', params: ['${message}', '${outside.address}'] })`);
      assert.equal(ethers.verifyMessage('podpis z Exploreru', signature), outside.address, 'Explorer podepisuje přes stejnou peněženku');
    } finally {
      await outsider.close();
      provider.destroy();
    }
    await win.click('nav button[data-tab=wallet]');
    await win.click('#settings');
    await win.click('#logout');
    await win.click('#confirm-out');
    await win.waitForSelector('#ext-browser');
  });
  await step('přihlášení přes WalletConnect ukáže QR kód', async () => {
    await win.routeWebSocket(/walletconnect|reown/, (ws) => ws.onMessage((text) => {
      const m = JSON.parse(text);
      const batch = /batchSubscribe/i.test(m.method ?? '');
      ws.send(JSON.stringify({ id: m.id, jsonrpc: '2.0', result: batch ? m.params.topics.map((x) => `sub-${x}`) : `sub-${m.id}` }));
    }));
    await win.route(/^https:\/\/[^/]*(walletconnect|reown)/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    await win.click('#ext-wc');
    await win.fill('#f input[name=project]', 'testovaci-projekt');
    await win.click('#f button[type=submit]');
    await win.waitForSelector('#wc-qr svg', { timeout: 20000 });
    await win.click('#back');
    await win.waitForSelector('#ext-wc');
  });
  await step('bez chyb v aplikaci', async () => assert.deepEqual(errors, []));
} finally {
  await outsider?.close().catch(() => {});
  await app.close().catch(() => {});
}
const ok = results.filter(Boolean).length;
console.log(`SOUHRN: ${ok}/${results.length} prošlo`);
process.exit(ok === results.length ? 0 : 1);
