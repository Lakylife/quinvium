// Stránky Tokeny a Most ve skutečném Chromiu: dva skutečné uzly, běžící validátoři a peněženka se skutečnými podpisy.
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { Relayer, messageId, refundMessage } from '../../bridge/src/relayer.js';
import { BITCOIN, BitcoinBridge } from '../../bridge/src/btc-bridge.js';
import { encodeSegwit, publicKey } from '../../bridge/src/bitcoin.js';
import { MockBitcoin } from '../../bridge/test/helpers/mock-bitcoin.js';
import { DAY, WEI, artifacts, makeChain } from '../../bridge/test/helpers/chains.js';

const here = dirname(fileURLToPath(import.meta.url));
const explorer = join(here, '..', 'public');
const user = ethers.Wallet.createRandom();
const admin = ethers.Wallet.createRandom();
const validators = Array.from({ length: 3 }, () => ({ wallet: ethers.Wallet.createRandom(), btcKey: `0x${crypto.randomBytes(32).toString('hex')}` }));
const everyone = [user, admin, ...validators.map((v) => v.wallet)];
const A = makeChain(52403n, 'aether', everyone, { staticDir: explorer });
const B = makeChain(1115511n, 'ethereum', everyone);
const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
const btc = new MockBitcoin();
const pad = (a) => ethers.zeroPadValue(a, 32);

let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
    if (globalThis.lastPage) console.log('Výstup:', await globalThis.lastPage.evaluate(() => document.getElementById('bridge-out')?.textContent ?? document.getElementById('app').innerText.slice(0, 300)).catch(() => ''));
    throw e;
  }
};
const wrapped = (r) => iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token;

let browser;
let beat = null;
let stopping = false;
try {
  await A.start();
  await B.start();
  const list = validators.map((v) => v.wallet.address);
  const gateA = await A.deploy('BridgeGateway', admin, admin.address, admin.address, list, 2);
  const gateB = await B.deploy('BridgeGateway', admin, admin.address, admin.address, list, 2);
  const registry = await A.deploy('TokenRegistry', admin, admin.address);
  const usdt = await A.deploy('StableToken', admin, 'Test USD', 'tUSD', 6, admin.address);
  await A.ok(usdt.configureMinter(admin.address, 10n ** 15n));
  await A.ok(usdt.mint(user.address, 5_000_000_000n));
  await A.ok(registry.add(usdt.target, 0, 'Testovací vydavatel', ''));

  const aetB = wrapped(await B.ok(gateB.createWrapped('Quinvium', 'QU.e', 18, Number(A.id), ethers.ZeroHash, 100n * WEI, 50n * WEI)));
  const aBtc = wrapped(await A.ok(gateA.createWrapped('Bridged Bitcoin', 'aBTC', 8, Number(BITCOIN), ethers.ZeroHash, 10n ** 12n, 10n ** 11n)));
  await A.ok(registry.add(aBtc, 1, 'Most Quinvium', ''));
  await A.ok(gateA.setOutbound(ethers.ZeroAddress, Number(B.id), true, false, 1n));
  await A.ok(gateA.setOutbound(aBtc, Number(BITCOIN), true, true, 50_000n));
  await A.ok(gateA.setRoute(Number(B.id), pad(aetB), ethers.ZeroAddress, false, true, 100n * WEI, 50n * WEI));
  await B.ok(gateB.setOutbound(aetB, Number(A.id), true, true, 1n));

  const chains = () => [
    { id: A.id, name: 'Quinvium', provider: A.provider, gateway: gateA.target, confirmations: 1, startBlock: 0 },
    { id: B.id, name: 'Ethereum', provider: B.provider, gateway: gateB.target, confirmations: 1, startBlock: 0 },
  ];
  const team = validators.map((v) => {
    const relayer = new Relayer({ chains: chains(), privateKey: v.wallet.privateKey });
    const bridge = new BitcoinBridge({
      rpc: btc.rpc, network: 'regtest', relayer, chainId: A.id, token: aBtc, btcKey: v.btcKey, threshold: 2, confirmations: 3,
      validators: validators.map((x) => ({ address: x.wallet.address, btcKey: publicKey(x.btcKey).toString('hex') })),
    });
    return { relayer, bridge };
  });
  const keys = validators.map((v) => publicKey(v.btcKey).toString('hex'));
  const deployments = {
    [A.id]: {
      registry: registry.target,
      gateway: gateA.target,
      networks: [
        { id: Number(B.id), name: 'Ethereum', rpc: `http://127.0.0.1:${B.node.rpc.port}`, gateway: gateB.target, currency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
        { id: Number(BITCOIN), name: 'Bitcoin', bitcoin: 'regtest', keys, threshold: 2, confirmations: 3 },
      ],
      assets: [
        { symbol: 'QU', token: ethers.ZeroAddress, decimals: 18, network: Number(B.id), min: '1', remoteToken: aetB, remoteBurn: true },
        { symbol: 'aBTC', token: aBtc, decimals: 8, network: Number(BITCOIN), min: '50000', burn: true },
      ],
    },
  };

  // Síť žije sama: bloky přibývají a validátoři pracují, jako by běželi jinde.
  const life = async () => {
    while (!stopping) {
      await A.mine().catch(() => {});
      await B.mine().catch(() => {});
      for (const m of team) {
        await m.bridge.tick().catch(() => {});
        await m.relayer.tick().catch(() => {});
      }
      await new Promise((r) => { setTimeout(r, 150); });
    }
  };
  beat = life();

  const providers = { [A.id]: A, [B.id]: B };
  let active = A.id;
  const rpc = async (side, method, params) => (await fetch(`http://127.0.0.1:${side.node.rpc.port}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  async function bridgeWallet(method, params = []) {
    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts': return { result: [user.address] };
      case 'eth_chainId': return { result: ethers.toQuantity(active) };
      case 'wallet_switchEthereumChain': active = BigInt(params[0].chainId); return { result: null };
      case 'eth_sendTransaction': {
        const { from: _from, gas, ...tx } = params[0];
        const sent = await user.connect(providers[active].provider).sendTransaction({ ...tx, gasLimit: gas });
        return { result: sent.hash };
      }
      default: return rpc(providers[active], method, params);
    }
  }

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  globalThis.lastPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('walletBridge', bridgeWallet);
  await page.addInitScript(() => {
    if (!localStorage.getItem('aether.lang')) localStorage.setItem('aether.lang', 'cs');
    localStorage.setItem('aether.wallet', 'injected');
    window.ethereum = {
      async request({ method, params }) {
        const r = await window.walletBridge(method, params);
        if (r.error) throw Object.assign(new Error(r.error.message), r.error);
        return r.result;
      },
      on() {}, removeListener() {},
    };
  });
  const url = `http://127.0.0.1:${A.node.rpc.port}`;

  await step('bez nasazení stránky poctivě řeknou, že most ještě neběží', async () => {
    await page.goto(`${url}/#/bridge`);
    await page.getByText('Most na této síti ještě neběží').waitFor();
    await page.goto(`${url}/#/tokens`);
    await page.getByText('USDT, USDC nebo USD1').waitFor();
  });

  await page.route('**/deployments.json', (r) => r.fulfill({ json: deployments }));
  await page.reload();

  await step('seznam tokenů ukáže vydaný i přemostěný token', async () => {
    await page.locator('#token-table tbody tr').nth(2).waitFor();
    const text = await page.locator('#app').innerText();
    assert.match(text, /tUSD/);
    assert.match(text, /Vydaný/i);
    assert.match(text, /aBTC/);
    assert.match(text, /Přemostěný/i);
    assert.match(text, /5\s000/, 'v oběhu');
    assert.ok(await page.locator('a[data-nav=\"tokens\"].active').count());
  });

  await step('kontrola tokenu pozná ověřený i neznámý', async () => {
    await page.fill('#token-form input[name=address]', usdt.target);
    await page.click('#token-form button');
    await page.getByText('Ověřený token: Testovací vydavatel').waitFor();
    await page.fill('#token-form input[name=address]', admin.address);
    await page.click('#token-form button');
    await page.getByText('Jeho název ani zkratka nic nedokazují').waitFor();
    await page.fill('#token-form input[name=address]', 'nesmysl');
    await page.click('#token-form button');
    await page.getByText('Neplatná adresa').waitFor();
  });

  await step('stránka mostu říká, na kom bezpečnost stojí', async () => {
    await page.goto(`${url}/#/bridge`);
    await page.getByText('Převod potvrzuje 2 z 3').waitFor();
    // Jak most funguje: tři kroky a čtyři krátké dlaždice místo odstavců, u formuláře poplatek.
    assert.equal(await page.locator('.how-flow li').count(), 3);
    assert.equal(await page.locator('.how-fact').count(), 4);
    assert.match(await page.locator('.how-facts').innerText(), /Žádný, kurz 1 : 1/);
    assert.match(await page.locator('.how-flow').innerText(), /Potřeba je 2 z 3 podpisů/);
    assert.match(await page.locator('#bridge-fields .swap-info').innerText(), /Poplatek\s*(žádný, jen poplatek sítě|poplatek sítě Bitcoin se odečte z částky)/);
  });

  await step('převod hlavní mince doručí validátoři a historie to ukáže', async () => {
    await page.fill('#bridge-form input[name=amount]', '3,5');
    await page.click('#bridge-go');
    await page.getByText('Validátoři ho potvrdí').waitFor({ timeout: 30000 });
    const token = B.at('WrappedAsset', aetB);
    for (let i = 0; i < 200 && await token.balanceOf(user.address) === 0n; i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.equal(await token.balanceOf(user.address), ethers.parseEther('3.5'));
    await page.reload();
    await page.locator('#bridge-history .badge.ok').waitFor({ timeout: 15000 });
    assert.match(await page.locator('#bridge-history').innerText(), /3,5 QU/);
  });

  await step('cesta zpět na Quinvium přepne peněženku a pak ji vrátí', async () => {
    await page.goto(`${url}/#/bridge?dir=in`);
    await page.locator('#bridge-to', { hasText: 'Quinvium' }).waitFor();
    await page.fill('#bridge-form input[name=amount]', '1');
    await page.click('#bridge-go');
    await page.getByText('Validátoři ho potvrdí').waitFor({ timeout: 30000 });
    assert.equal(await B.at('WrappedAsset', aetB).balanceOf(user.address), ethers.parseEther('2.5'));
    for (let i = 0; i < 100 && active !== A.id; i++) await new Promise((r) => { setTimeout(r, 50); });
    assert.equal(active, A.id, 'peněženka je zpět na Quinviu');
    for (let i = 0; i < 200 && await gateA.locked(ethers.ZeroAddress) !== ethers.parseEther('2.5'); i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.equal(await gateA.locked(ethers.ZeroAddress), ethers.parseEther('2.5'));
  });

  await step('zrušený převod se vrátí odesílateli a historie to ukáže', async () => {
    const lockedBefore = await gateA.locked(ethers.ZeroAddress);
    const before = await A.provider.getBalance(user.address);
    await page.goto(`${url}/#/bridge`);
    await page.getByText('Převod potvrzuje 2 z 3').waitFor();
    await page.locator('#bridge-to', { hasText: 'Ethereum' }).waitFor();
    await page.fill('#bridge-form input[name=amount]', '60');
    await page.click('#bridge-go');
    await page.getByText('Validátoři ho potvrdí').waitFor({ timeout: 30000 });
    // Nad 50 QU jde převod na cílové síti do fronty. Správce ho tam zruší.
    const sent = (await gateA.queryFilter('Sent')).filter((l) => l.args.sender === user.address).at(-1);
    const m = { srcChain: A.id, dstChain: sent.args.dstChain, nonce: sent.args.nonce, srcToken: pad(sent.args.token), recipient: ethers.getAddress(sent.args.recipient), amount: sent.args.amount };
    const id = await gateB.messageId(m);
    for (let i = 0; i < 200 && (await gateB.queued(id)).readyAt === 0n; i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.notEqual((await gateB.queued(id)).readyAt, 0n, 'převod čeká ve frontě');
    await (await gateB.connect(B.connect(admin)).cancelQueued(id)).wait();
    // Vrácení jde stejnou cestou jako převod opačným směrem. Nad 50 QU proto i ono čeká den ve frontě.
    const back = refundMessage({ ...m, sender: user.address, sendId: sent.args.id }, aetB);
    const backId = messageId(gateA.target, back);
    for (let i = 0; i < 300 && (await gateA.queued(backId)).readyAt === 0n; i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.notEqual((await gateA.queued(backId)).readyAt, 0n, 'vrácení čeká ve frontě');
    await page.reload();
    await page.locator('#bridge-history .badge.pending', { hasText: 'Zrušeno, vrací se' }).waitFor({ timeout: 15000 });
    await A.mine(DAY + 60).catch(() => {});
    for (let i = 0; i < 300 && await gateA.locked(ethers.ZeroAddress) !== lockedBefore; i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.equal(await gateA.locked(ethers.ZeroAddress), lockedBefore, 'zamčené mince se uvolnily');
    const after = await A.provider.getBalance(user.address);
    assert.ok(after <= before && before - after < ethers.parseEther('0.01'), `zpět je celá částka, chybí jen poplatek: ${ethers.formatEther(before - after)}`);
    assert.equal(await B.at('WrappedAsset', aetB).balanceOf(user.address), ethers.parseEther('2.5'), 'na cílové síti nic nepřibylo');
    await page.reload();
    await page.locator('#bridge-history .badge.ok', { hasText: 'Vráceno odesílateli' }).waitFor({ timeout: 15000 });
  });

  await step('vkladová adresa Bitcoinu je stejná jako u validátorů a vklad dorazí', async () => {
    await page.goto(`${url}/#/bridge?dir=in`);
    await page.locator('#bridge-to', { hasText: 'Quinvium' }).waitFor();
    await page.click('#bridge-asset');
    await page.locator('.picker-row', { hasText: 'aBTC · Bitcoin' }).click();
    await page.click('#bridge-go');
    await page.locator('#bridge-address').waitFor({ timeout: 30000 });
    assert.equal(await page.textContent('#bridge-address'), team[0].bridge.depositAddress(user.address));
    assert.ok(await page.locator('#bridge-deposit .qr-box svg, #bridge-deposit .qr-box img').count(), 'QR kód');
    for (let i = 0; i < 60 && !Object.keys(team[0].bridge.state.data.watch).length; i++) await new Promise((r) => { setTimeout(r, 150); });
    btc.pay(team[0].bridge.depositAddress(user.address), 3_000_000n);
    btc.mine(3);
    const token = A.at('WrappedAsset', aBtc);
    for (let i = 0; i < 200 && await token.balanceOf(user.address) === 0n; i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.equal(await token.balanceOf(user.address), 3_000_000n);
  });

  await step('výběr do Bitcoinu: špatná adresa neprojde, dobrá se vyplatí', async () => {
    await page.goto(`${url}/#/bridge?dir=out`);
    await page.locator('#bridge-from', { hasText: 'Quinvium' }).waitFor();
    await page.click('#bridge-asset');
    await page.locator('.picker-row', { hasText: 'aBTC · Bitcoin' }).click();
    await page.fill('#bridge-form input[name=amount]', '0,0001');
    const address = encodeSegwit('bcrt', 0, crypto.randomBytes(20));
    await page.fill('#bridge-form input[name=recipient]', address);
    await page.click('#bridge-go');
    await page.locator('#bridge-out', { hasText: 'Nejméně' }).waitFor();
    await page.fill('#bridge-form input[name=amount]', '0,01');
    await page.fill('#bridge-form input[name=recipient]', '0x2546BcD3c84621e976D8185a91A922aE77ECEc30');
    await page.click('#bridge-go');
    await page.getByText('nepatří síti Bitcoin').waitFor({ timeout: 15000 });
    await page.fill('#bridge-form input[name=recipient]', address);
    await page.click('#bridge-go');
    await page.getByText('Validátoři ho potvrdí').waitFor({ timeout: 30000 });
    const left = await A.at('WrappedAsset', aBtc).balanceOf(user.address);
    assert.equal(left, 2_000_000n, `zůstatek ${left}`);
    for (let i = 0; i < 200 && !btc.mempool.some((t) => t.vout.some((o) => o.value > 0.0099)); i++) await new Promise((r) => { setTimeout(r, 200); });
    assert.ok(btc.mempool.some((t) => t.vout.some((o) => o.value > 0.0099 && o.value < 0.01)), 'platba je v síti');
  });

  if (process.env.AETHER_SHOT) {
    const shot = async (path, name, theme, width) => {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((v) => localStorage.setItem('aether.theme', v), theme);
      await page.goto(`${url}/${path}`);
      await page.reload();
      await page.locator('h1').waitFor();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${process.env.AETHER_SHOT}-${name}.png`, fullPage: true });
    };
    await shot('#/bridge?dir=out', 'most-svetle', 'light', 1280);
    await shot('#/bridge?dir=in', 'most-tmave', 'dark', 1280);
    await shot('#/tokens', 'tokeny-tmave', 'dark', 1280);
    await shot('#/bridge?dir=out', 'most-mobil', 'light', 390);
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await step('všechny jazyky a úzká obrazovka', async () => {
    for (const [lang, word] of [['en', 'Bridge'], ['de', 'Brücke'], ['es', 'Puente'], ['fr', 'Pont']]) {
      await page.evaluate((l) => localStorage.setItem('aether.lang', l), lang);
      await page.reload();
      await page.locator('h1', { hasText: word }).waitFor();
    }
    await page.evaluate(() => localStorage.setItem('aether.lang', 'cs'));
    await page.setViewportSize({ width: 390, height: 800 });
    for (const path of ['#/bridge', '#/bridge?dir=in', '#/tokens']) {
      await page.goto(`${url}/${path}`);
      await page.locator('h1').waitFor();
      await page.waitForTimeout(400);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `přetéká ${path}`);
    }
  });

  await step('stránka nehlásí žádnou chybu', async () => assert.deepEqual(errors, []));
} finally {
  stopping = true;
  await beat?.catch(() => {});
  await browser?.close().catch(() => {});
  await A.stop().catch(() => {});
  await B.stop().catch(() => {});
}
console.log(failed ? 'Selhalo.' : 'Vše prošlo.');
process.exit(failed ? 1 : 0);
