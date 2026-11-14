// Connection guide: real Chromium and a node; the wallet behaves like MetaMask including its error codes.
// The real MetaMask is not run here; codes -32002, 4001, 4902 and -32602 match what it returns.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PORT = 8757;
const RPC = `http://127.0.0.1:${PORT}`;
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DEV_CHAIN = '0xccb3';

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push([name, true]);
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
    throw e;
  }
};

const data = mkdtempSync(join(tmpdir(), 'aether-connect-'));
const startNode = () => spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', data,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
const alive = () => fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }).then((r) => r.ok, () => false);
async function waitNode() {
  for (let i = 0; i < 200; i++) {
    if (await alive()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('uzel nenaběhl');
}

const rpcError = (code, message) => ({ error: { code, message } });
let wallet;
const reset = (over = {}) => {
  wallet = { approved: false, chain: '0x1', knows: false, mode: 'normal', calls: [], refuseExplorer: false, refuseAdd: false, busyNetwork: false, ...over };
};

function respond(method, params) {
  wallet.calls.push({ method, params });
  switch (method) {
    case 'eth_accounts': return { result: wallet.approved ? [ADDRESS] : [] };
    case 'eth_chainId': return { result: wallet.chain };
    case 'eth_requestAccounts':
      if (wallet.mode === 'stuck') return rpcError(-32002, "Request of type 'wallet_requestPermissions' already pending for origin. Please wait.");
      if (wallet.mode === 'reject') return rpcError(4001, 'User rejected the request.');
      wallet.approved = true;
      return { result: [ADDRESS] };
    case 'wallet_switchEthereumChain':
      if (wallet.busyNetwork) return rpcError(-32002, 'Request already pending');
      if (!wallet.knows) return rpcError(4902, 'Unrecognized chain ID');
      wallet.chain = params[0].chainId;
      return { result: null };
    case 'wallet_addEthereumChain':
      if (wallet.refuseAdd) return rpcError(4001, 'User rejected the request.');
      if (wallet.refuseExplorer && params[0].blockExplorerUrls) return rpcError(-32602, 'Expected an array with at least one valid https URL');
      wallet.knows = true;
      wallet.chain = params[0].chainId;
      return { result: null };
    default: return rpcError(4200, `neznámá metoda ${method}`);
  }
}

let node = startNode();
let browser;

try {
  await waitNode();
  browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'cs-CZ', viewport: { width: 1280, height: 800 } });
  const errors = [];
  const open = async (withWallet = true, { known = withWallet, rabby = false } = {}) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    if (withWallet) {
      await page.exposeFunction('__wallet', async (method, params) => respond(method, params));
      await page.addInitScript(() => {
        window.ethereum = {
          isMetaMask: true,
          on() {},
          removeListener() {},
          async request({ method, params }) {
            const r = await window.__wallet(method, params);
            if (r.error) throw Object.assign(new Error(r.error.message), r.error);
            return r.result;
          },
        };
      });
    }
    await page.addInitScript((known) => {
      try {
        localStorage.setItem('aether.lang', 'cs');
        // The wallet chosen on the last visit; choosing has its own step.
        if (known) localStorage.setItem('aether.wallet', 'injected');
        else localStorage.removeItem('aether.wallet');
      } catch { /* test only */ }
    }, known);
    if (rabby) {
      await page.addInitScript(() => {
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'x', name: 'Rabby', icon: '', rdns: 'io.rabby' }, provider: window.ethereum } }));
        window.addEventListener('eip6963:requestProvider', announce);
      });
    }
    await page.goto(`${RPC}/`);
    await page.waitForSelector('.metric-grid');
    return page;
  };
  const stepOf = (page, name) => page.waitForSelector(`#wallet-dialog[data-step="${name}"]`);
  const connected = (page) => page.waitForFunction(() => document.getElementById('login-btn').classList.contains('connected'));
  const closed = (page) => page.waitForFunction(() => !document.getElementById('wallet-dialog'));
  const dialogText = (page) => page.textContent('#wallet-dialog');

  await step('without a wallet the window says what to do and does not disappear by itself', async () => {
    const page = await open(false);
    await page.click('#login-btn');
    await stepOf(page, 'pick');
    const text = await dialogText(page);
    assert.match(text, /aplikaci Quinvium/);
    assert.match(text, /MetaMask/, 'nabídne instalaci');
    assert.match(text, /WalletConnect/);
    await page.click('[data-wallet=walletconnect]');
    await stepOf(page, 'wcSetup');
    await page.waitForTimeout(5000);
    assert.ok(await page.isVisible('#wallet-dialog'), 'okno zůstává otevřené');
    await page.click('#wallet-dialog .ghost-btn');
    await closed(page);
    await page.close();
  });
  await step('WalletConnect: after entering a Project ID it shows a QR code; the foreign server is replaced in the test', async () => {
    reset();
    const page = await open(false, { known: false });
    const relay = [];
    // The relay speaks JSON-RPC over WebSocket. The stand-in confirms subscription and sending; the page needs no more to show the QR code.
    await page.routeWebSocket(/walletconnect|reown/, (ws) => ws.onMessage((text) => {
      const m = JSON.parse(text);
      relay.push(m.method);
      const batch = /batchSubscribe/i.test(m.method ?? '');
      ws.send(JSON.stringify({ id: m.id, jsonrpc: '2.0', result: batch ? m.params.topics.map((x) => `sub-${x}`) : `sub-${m.id}` }));
    }));
    await page.route(/^https:\/\/[^/]*(walletconnect|reown)/, (r) => r.abort());
    await page.click('#login-btn');
    await stepOf(page, 'pick');
    await page.click('[data-wallet=walletconnect]');
    await stepOf(page, 'wcSetup');
    await page.fill('#wc-form input[name=project]', 'testovaci-projekt');
    await page.click('#wc-form button[type=submit]');
    await stepOf(page, 'wc');
    await page.waitForSelector('.wc-qr img, .wc-qr svg, .wc-qr canvas');
    assert.ok(relay.includes('wc_proposeSession'), `relay dostal: ${relay}`);
    await page.evaluate(() => localStorage.removeItem('aether.wcProject'));
    await page.close();
  });

  await step('wallet choice shows what is in the browser', async () => {
    reset();
    const page = await open(true, { known: false, rabby: true });
    await page.click('#login-btn');
    await stepOf(page, 'pick');
    assert.equal(await page.locator('[data-wallet="io.rabby"]').count(), 1, 'peněženka se ohlásila sama');
    assert.equal(await page.locator('[data-wallet="injected"]').count(), 0, 'stejná peněženka není v seznamu dvakrát');
    await page.click('[data-wallet="io.rabby"]');
    await connected(page);
    await page.close();
  });

  await step('a stuck request in MetaMask: the guide stays and the page moves on by itself after confirmation', async () => {
    reset({ mode: 'stuck' });
    const page = await open();
    await page.click('#login-btn');
    await stepOf(page, 'stuck');
    const text = await dialogText(page);
    assert.match(text, /MetaMask čeká na vaše potvrzení/);
    assert.match(text, /dílku skládačky/);
    if (process.env.AETHER_SHOT) await page.screenshot({ path: process.env.AETHER_SHOT.replace('.png', '-uvizla.png') });
    await page.waitForTimeout(3500);
    assert.ok(await page.isVisible('#wallet-dialog[data-step="stuck"]'), 'návod nezmizel');
    wallet.approved = true;   // the user confirmed the request directly in the wallet; the page gets no answer
    await connected(page);
    await closed(page);
    assert.equal(wallet.chain, DEV_CHAIN, 'síť se sama přidala a přepnula');
    await page.close();
  });

  await step('the network is added with the correct data', async () => {
    const add = wallet.calls.find((c) => c.method === 'wallet_addEthereumChain').params[0];
    assert.equal(add.chainId, DEV_CHAIN);
    assert.equal(add.chainName, 'Quinvium Dev');
    assert.deepEqual(add.rpcUrls, [RPC]);
    assert.deepEqual(add.nativeCurrency, { name: 'Quinvium', symbol: 'dQU', decimals: 18 });
  });

  await step('connected on another network: the button offers switching and completes it', async () => {
    reset({ approved: true });
    const page = await open();
    await page.waitForFunction(() => document.getElementById('login-btn').classList.contains('wrong-network'));
    assert.equal((await page.textContent('#login-btn')).trim(), 'Přepnout síť');
    await page.click('#login-btn');
    await connected(page);
    await closed(page);
    assert.equal((await page.textContent('#login-btn')).includes('0xf39F'), true);
    assert.equal(wallet.calls.filter((c) => c.method === 'eth_requestAccounts').length, 0, 'znovu se o připojení nežádá');
    await page.reload();
    await connected(page);
    await page.close();
  });

  await step('connection rejected: a clear message and a new attempt works', async () => {
    reset({ mode: 'reject', knows: true });
    const page = await open();
    await page.click('#login-btn');
    await stepOf(page, 'rejected');
    wallet.mode = 'normal';
    await page.click('[data-wallet-retry]');
    await connected(page);
    await page.close();
  });

  await step('a rejected network addition does not hide the state', async () => {
    reset({ approved: true, refuseAdd: true });
    const page = await open();
    await page.click('#login-btn');
    await stepOf(page, 'rejected');
    await page.keyboard.press('Escape');
    await closed(page);
    await page.waitForFunction(() => document.getElementById('login-btn').classList.contains('wrong-network'));
    await page.close();
  });

  await step('a pending network request has the same guide', async () => {
    reset({ approved: true, busyNetwork: true });
    const page = await open();
    await page.click('#login-btn');
    await stepOf(page, 'stuck');
    wallet.busyNetwork = false;
    wallet.chain = DEV_CHAIN;   // the user switched the network directly in the wallet
    await connected(page);
    await closed(page);
    await page.close();
  });

  await step('the wallet refuses a local Explorer link; the network is still added', async () => {
    reset({ approved: true, refuseExplorer: true });
    const page = await open();
    await page.click('#login-btn');
    await connected(page);
    const adds = wallet.calls.filter((c) => c.method === 'wallet_addEthereumChain');
    assert.equal(adds.length, 2);
    assert.equal(adds[1].params[0].blockExplorerUrls, undefined);
    await page.close();
  });

  await step('a network that is not running does not switch the page to an error', async () => {
    reset({ approved: true, chain: DEV_CHAIN });
    const page = await open();
    await page.click('#net-btn');
    await page.click('#net-pop button[data-net="mainnet"]');
    await page.waitForFunction(() => /na tomto počítači neběží/.test(document.getElementById('toasts').textContent));
    assert.ok(await page.isVisible('.metric-grid'), 'přehled zůstává');
    assert.equal(await page.evaluate(() => localStorage.getItem('aether.rpc')), null, 'nefunkční síť se neuloží');
    await page.close();
  });

  await step('node outage: an understandable message and the page recovers by itself when it returns', async () => {
    reset({ approved: true, chain: DEV_CHAIN });
    const page = await open();
    const stopped = new Promise((r) => node.once('exit', r));
    node.kill('SIGINT');
    await stopped;
    await page.evaluate(() => { location.hash = '#/blocks'; });
    await page.waitForFunction(() => /neodpovídá/.test(document.querySelector('.error-box')?.textContent ?? ''));
    assert.doesNotMatch(await page.textContent('.error-box'), /Failed to fetch/);
    node = startNode();
    await waitNode();
    await page.waitForFunction(() => !document.querySelector('.error-box'), null, { timeout: 25000 });
    await page.close();
  });

  await step('a node that is not running: the guide says so and completes the connection when the node returns', async () => {
    reset({ knows: true });
    const page = await open();
    const stopped = new Promise((r) => node.once('exit', r));
    node.kill('SIGINT');
    await stopped;
    await page.click('#login-btn');
    await stepOf(page, 'down');
    assert.equal(wallet.calls.filter((c) => c.method === 'eth_requestAccounts').length, 0, 'bez uzlu se peněženka neobtěžuje');
    node = startNode();
    await waitNode();
    await page.click('[data-wallet-retry]');
    await connected(page);
    await closed(page);
    assert.equal(wallet.chain, DEV_CHAIN);
    await page.close();
  });

  await step('the page reports no JavaScript error', async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  node.kill('SIGKILL');
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nVýsledek: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
