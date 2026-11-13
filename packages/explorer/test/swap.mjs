// Stránka Swap ve skutečném Chromiu: skutečný uzel, skutečné kontrakty a peněženka se skutečnými podpisy.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { WEI, artifacts, makeChain } from '../../bridge/test/helpers/chains.js';

const here = dirname(fileURLToPath(import.meta.url));
const user = ethers.Wallet.createRandom();
const admin = ethers.Wallet.createRandom();
const A = makeChain(52403n, 'aether', [user, admin], { staticDir: join(here, '..', 'public') });
const WAET = artifacts.WAET.address;
const FAR = 2_000_000_000_000;

let failed = 0;
let page;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
    if (page) console.log('Stránka:', await page.evaluate(() => (document.getElementById('swap-msg') ?? document.getElementById('add-msg'))?.textContent ?? document.getElementById('app').innerText.slice(0, 300)).catch(() => ''));
    throw e;
  }
};

let browser;
let stopping = false;
let beat = null;
try {
  await A.start();
  const factory = await A.deploy('SwapFactory', admin);
  const router = await A.deploy('SwapRouter', admin, factory.target, WAET);
  const make = async (name, symbol, decimals) => {
    const t = await A.deploy('StableToken', admin, name, symbol, decimals, admin.address);
    await A.ok(t.configureMinter(admin.address, 10n ** 30n));
    await A.ok(t.mint(admin.address, 10n ** 27n));
    await A.ok(t.mint(user.address, 10n ** 25n));
    await A.ok(t.connect(A.connect(admin)).approve(router.target, ethers.MaxUint256));
    return t;
  };
  const usd = await make('Test USD', 'tUSD', 6);
  const btc = await make('Test BTC', 'tBTC', 8);
  const lonely = await make('Bez poolu', 'tNIC', 18);
  const fresh = await make('Novy token', 'tNEW', 18);    // není v seznamu ani v poolu, vybírá se adresou
  const asAdmin = router.connect(A.connect(admin));
  await A.ok(asAdmin.addLiquidityNative(usd.target, 2000n * 10n ** 6n, 0n, 0n, admin.address, FAR, { value: 1000n * WEI }));
  await A.ok(asAdmin.addLiquidityNative(btc.target, 10n ** 8n, 0n, 0n, admin.address, FAR, { value: 1000n * WEI }));
  const tokens = [usd, btc, lonely];
  const meta = await Promise.all(tokens.map(async (t) => ({ address: t.target, symbol: await t.symbol(), name: await t.name(), decimals: Number(await t.decimals()) })));
  // tBTC v pevném seznamu chybí: Swap ho najde ve factory podle poolu s QU, jako token, který si autor založí sám.
  const deployments = { [A.id]: { swap: { factory: factory.target, router: router.target, tokens: [meta[0], meta[2]] } } };

  let paused = false;     // krok s čekající transakcí na chvíli zastaví těžbu
  const life = async () => {
    while (!stopping) {
      if (!paused) await A.mine().catch(() => {});
      await new Promise((r) => { setTimeout(r, 120); });
    }
  };
  beat = life();
  const rpc = async (method, params) => (await fetch(`http://127.0.0.1:${A.node.rpc.port}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  const watched = [];
  async function bridgeWallet(method, params = []) {
    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts': return { result: [user.address] };
      case 'eth_chainId': return { result: ethers.toQuantity(A.id) };
      case 'wallet_watchAsset': watched.push(params); return { result: true };
      case 'eth_sendTransaction': {
        const { from: _from, gas, ...tx } = params[0];
        const sent = await user.connect(A.provider).sendTransaction({ ...tx, gasLimit: gas });
        return { result: sent.hash };
      }
      default: return rpc(method, params);
    }
  }

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  const pick = async (id, label) => {
    await page.click(id);
    await page.locator('.picker-row', { has: page.locator('b', { hasText: new RegExp(`^${label}$`) }) }).click();
  };
  const go = async (path) => {
    await page.goto(`${url}/${path}`);
    await page.locator('#swap-body > *').first().waitFor();
    await page.waitForTimeout(300);
  };

  await step('bez nasazení stránka řekne, že swap ještě neběží', async () => {
    await page.goto(`${url}/#/swap`);
    await page.getByText('Swap na této síti ještě neběží').waitFor();
    assert.ok(await page.locator('a[data-nav=\"swap\"].active').count());
  });

  await page.route('**/deployments.json', (r) => r.fulfill({ json: deployments }));
  await page.reload();

  await step('odhad ukáže kurz, dopad na cenu a minimum po skluzu', async () => {
    await page.locator('#swap-in').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.isDisabled('#swap-go'), true);
    await page.fill('#swap-in', '10');
    await page.locator('#swap-info dt').first().waitFor();
    const [, quoted] = await router.getAmountsOut(10n * WEI, [WAET, usd.target]);
    assert.equal((await page.textContent('#swap-out')).replace(/\s/g, ''), ethers.formatUnits(quoted, 6).replace('.', ','));
    const text = await page.locator('#swap-info').innerText();
    assert.match(text, /Kurz/);
    assert.match(text, /Dopad na cenu/);
    assert.match(text, /dQU → tUSD/);
    await page.click('#swap-settings');
    await page.click('[data-slip="100"]');
    await page.waitForTimeout(300);
    const minimum = quoted - quoted / 100n;
    assert.match((await page.locator('#swap-info').innerText()).replace(/\s/g, ''), new RegExp(ethers.formatUnits(minimum, 6).replace('.', ',').slice(0, 8)));
    await page.click('[data-slip="50"]');
  });

  await step('směna hlavní mince za token', async () => {
    const before = await usd.balanceOf(user.address);
    await page.click('#swap-go');
    await page.getByText('Směna proběhla').waitFor({ timeout: 30000 });
    assert.ok(await usd.balanceOf(user.address) > before + 19_000_000n);
  });

  await step('po směně jde získaný token jedním kliknutím přidat do peněženky', async () => {
    await page.locator('#swap-msg .text-btn', { hasText: 'Přidat tUSD do peněženky' }).click();
    await page.getByText('tUSD je v peněžence.').waitFor();
    assert.deepEqual(watched.at(-1), { type: 'ERC20', options: { address: usd.target, symbol: 'tUSD', decimals: 6 } });
  });

  await step('zpětná směna tokenu schválí útratu a vrátí hlavní minci', async () => {
    await page.click('#swap-flip');
    await page.waitForTimeout(300);
    await page.fill('#swap-in', '5');
    await page.locator('#swap-info dt').first().waitFor();
    const before = await A.provider.getBalance(user.address);
    await page.click('#swap-go');
    await page.getByText('Směna proběhla').waitFor({ timeout: 30000 });
    assert.ok(await A.provider.getBalance(user.address) > before, 'mince se vrátily');
    assert.equal(await usd.allowance(user.address, router.target) < 10n ** 7n, true, 'schváleno jen tolik, kolik bylo potřeba');
  });

  await step('trh ukáže cenu z poolu, graf a poslední směny', async () => {
    await page.reload();
    await page.locator('.market-name h2', { hasText: 'dQU / tUSD' }).waitFor();
    const pair = new ethers.Contract(await factory.getPair(WAET, usd.target), artifacts.SwapPair.abi, A.provider);
    const [first, reserves] = await Promise.all([pair.token0(), pair.getReserves()]);
    const [coinSide, tokenSide] = first.toLowerCase() === WAET.toLowerCase() ? reserves : [reserves[1], reserves[0]];
    const expected = Number(ethers.formatUnits(tokenSide, 6)) / Number(ethers.formatEther(coinSide));
    const shown = Number((await page.locator('.market-price strong').innerText()).replace(/\s/g, '').replace(',', '.'));
    assert.ok(Math.abs(shown - expected) / expected < 0.001, `cena ${shown}, v poolu ${expected}`);
    await page.locator('#market-plot svg').waitFor();
    const trades = await page.locator('.market ~ .card tbody').innerText();
    assert.match(trades, /Nákup/);
    assert.match(trades, /Prodej/);
    assert.equal(await page.locator('.market ~ .card tbody tr').count(), 2, 'obě směny jsou v seznamu');
    await page.click('[data-span="24h"]');
    await page.locator('[data-span="24h"].active').waitFor();
    // Trh a poslední směny jsou vedle formuláře, ne pod ním. Formulář je vpravo nahoře.
    const [market, form] = await Promise.all([page.locator('#market').boundingBox(), page.locator('.trade-side').boundingBox()]);
    assert.ok(form.x >= market.x + market.width - 1 && Math.abs(form.y - market.y) < 40, `formulář ${JSON.stringify(form)}, trh ${JSON.stringify(market)}`);
    assert.ok(await page.locator('.trades-card a.text-link', { hasText: 'Všechny směny' }).count(), 'odkaz na všechny směny');
  });

  await step('výběr tokenu má hledání a zůstatky a Escape ho zavře', async () => {
    await page.click('#swap-to');
    await page.fill('.picker-search', 'btc');
    assert.equal(await page.locator('.picker-row:visible').count(), 1);
    await page.fill('.picker-search', '');
    await page.waitForFunction(() => [...document.querySelectorAll('.picker-row em')].some((x) => x.textContent));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.picker').count(), 0);
  });

  await step('část zůstatku jedním kliknutím a varování před nedostatkem mincí', async () => {
    await page.click('[data-part="50"]');
    await page.waitForFunction(() => Number(document.getElementById('swap-in').value) > 1000);
    // Polovina zůstatku do poolu s tisícovkou mincí má dopad nad 15 %: tlačítko čeká na potvrzení.
    await page.locator('#swap-ack').waitFor();
    assert.equal(await page.isDisabled('#swap-go'), true);
    await page.check('#swap-ack');
    await page.waitForFunction(() => !document.getElementById('swap-go').disabled);
    await page.fill('#swap-in', '99999999');
    await page.locator('#swap-go', { hasText: 'Nedostatek dQU' }).waitFor();
    assert.equal(await page.isDisabled('#swap-go'), true);
  });

  await step('token s poolem najde factory, token bez poolu jde vybrat adresou', async () => {
    await go('#/swap');
    await page.click('#swap-to');
    const found = page.locator('.picker-row', { has: page.locator('b', { hasText: /^tBTC$/ }) });
    await found.waitFor();
    assert.match(await found.innerText(), /Neověřený/);
    assert.equal(await page.locator('.picker-row', { has: page.locator('b', { hasText: /^tNEW$/ }) }).count(), 0);
    await page.fill('.picker-search', fresh.target);
    const extra = page.locator('.picker-extra');
    await extra.waitFor();
    assert.match(await extra.innerText(), /tNEW/);
    await extra.click();
    await page.locator('#swap-to', { hasText: 'tNEW' }).waitFor();
    assert.equal(await page.locator('.modal-backdrop').count(), 0);
  });

  await step('dvojice bez přímého poolu jde přes QU', async () => {
    await go('#/swap');
    await pick('#swap-from', 'tUSD');
    await pick('#swap-to', 'tBTC');
    await page.fill('#swap-in', '2');
    await page.getByText('tUSD → dQU → tBTC').waitFor();
    const before = await btc.balanceOf(user.address);
    await page.click('#swap-go');
    await page.getByText('Směna proběhla').waitFor({ timeout: 30000 });
    assert.ok(await btc.balanceOf(user.address) > before);
  });

  await step('bez poolu a se stejným tokenem nejde nic odeslat', async () => {
    await pick('#swap-to', 'tNIC');
    await page.fill('#swap-in', '1');
    await page.locator('#swap-go', { hasText: 'zatím není pool' }).waitFor();
    assert.equal(await page.isDisabled('#swap-go'), true);
    await pick('#swap-to', 'tUSD');
    await page.locator('#swap-go', { hasText: 'dva různé tokeny' }).waitFor();
  });

  await step('velká částka varuje před dopadem na cenu a bez potvrzení neodejde', async () => {
    await pick('#swap-to', 'dQU');
    await pick('#swap-from', 'tBTC');
    // Pool má 1 tBTC: 0,1 tBTC dá dopad asi 9 %, tedy varování bez potvrzení.
    await page.fill('#swap-in', '0,1');
    await page.locator('#swap-go', { hasText: 'Velký dopad' }).waitFor();
    assert.equal(await page.isDisabled('#swap-go'), false, 'do 15 % stačí varování');
    // Na tlačítku je jen krátký nápis, vysvětlení je ve varování nad ním.
    assert.match(await page.locator('.impact-warn').innerText(), /pool je pro tuto částku malý/);
    const fits = await page.$eval('#swap-go', (b) => ({ text: b.textContent, wide: b.scrollWidth <= b.clientWidth, tall: b.getBoundingClientRect().height }));
    assert.ok(fits.wide && fits.tall <= 54 && !fits.text.includes('pool'), `nápis se vejde na jeden řádek: ${JSON.stringify(fits)}`);
    assert.equal(await page.locator('#swap-ack').count(), 0);
    await page.fill('#swap-in', '0,5');
    await page.locator('#swap-ack').waitFor();
    assert.ok(await page.locator('#swap-info .bad-text').count());
    assert.equal(await page.isDisabled('#swap-go'), true, 'nad 15 % chce potvrzení');
    assert.match(await page.locator('.impact-warn').innerText(), /Do 5 % ztráty se vejde asi 0,0\d+ tBTC/);
    await page.check('#swap-ack');
    assert.equal(await page.isDisabled('#swap-go'), false);
    await page.fill('#swap-in', '0,6');
    await page.locator('#swap-ack').waitFor();
    assert.equal(await page.isDisabled('#swap-go'), true, 'nová částka chce nové potvrzení');
  });

  await step('swap s velkým dopadem po potvrzení projde a vezme přesně zadanou částku', async () => {
    const before = await btc.balanceOf(user.address);
    await page.fill('#swap-in', '0,5');
    await page.locator('#swap-ack').waitFor();
    await page.check('#swap-ack');
    await page.click('#swap-go');
    await page.getByText('Směna proběhla').waitFor({ timeout: 30000 });
    assert.equal(before - await btc.balanceOf(user.address), 5n * 10n ** 7n, 'odešlo přesně 0,5 tBTC');
  });

  await step('likvidita: pooly vedle formuláře, kurz místo plusu a rychlé částky', async () => {
    await go('#/swap?view=pools');
    await page.getByText('dQU / tUSD').or(page.getByText('tUSD / dQU')).first().waitFor();
    assert.equal(await page.locator('[data-remove]').count(), 0, 'uživatel zatím nemá podíl');
    const [main, side] = await Promise.all(['.trade-main', '.trade-side'].map((s) => page.locator(s).first().boundingBox()));
    assert.ok(side.x >= main.x + main.width - 1 && Math.abs(side.y - main.y) < 40, 'seznam poolů je vedle formuláře, ne pod ním');
    assert.equal(await page.locator('.trade-plus').count(), 0, 'mezi poli není plus');
    await pick('#add-a', 'dQU');
    await pick('#add-b', 'tUSD');
    await page.locator('#add-rate', { hasText: /Svázáno kurzem poolu: 1 dQU = [\d\s,]+ tUSD/ }).waitFor();
    assert.deepEqual(await page.locator('#add-form .trade-field').first().locator('[data-part]').allInnerTexts(), ['20 %', '50 %', 'Max']);
    // Max: největší vklad, na který stačí oba zůstatky. Druhá částka se dopočítá kurzem a tlačítko jde stisknout.
    await page.click('[data-side="a"][data-part="100"]');
    await page.waitForFunction(() => Number(document.querySelector('#add-form input[name=amountB]').value) > 0);
    const max = Number(await page.inputValue('#add-form input[name=amountA]'));
    assert.ok(max > 0 && !(await page.locator('#add-go').isDisabled()), `Max ${max} jde vložit`);
    // Max hlavní mince nechá rezervu na poplatky a řekne to.
    await page.locator('#add-note', { hasText: 'Po vkladu zůstane 0,01 dQU' }).waitFor();
    // Max u tokenu, kterého je dost: vklad omezí zůstatek mince, poznámka to vysvětlí a dopočtená částka má nejvýš 6 desetinných míst.
    await page.click('[data-side="b"][data-part="100"]');
    await page.locator('#add-note', { hasText: 'Vklad omezuje zůstatek dQU' }).waitFor();
    const capped = await page.inputValue('#add-form input[name=amountA]');
    assert.match(capped, /^\d+(\.\d{1,6})?$/, `dopočtená částka je zaokrouhlená: ${capped}`);
    assert.ok(Math.abs(Number(capped) - max) < max * 0.001 && !(await page.locator('#add-go').isDisabled()), `omezený vklad odpovídá zůstatku mince (${capped} / ${max})`);
    assert.match(await page.locator('#add-info').innerText(), /Kurz\s+1 tUSD = [\d\s,]+ dQU/, 'opačný kurz');
    await page.fill('#add-form input[name=amountA]', '1');
    await page.waitForFunction(() => document.getElementById('add-note').classList.contains('hidden'));
    await page.click('[data-side="a"][data-part="20"]');
    const fifth = Number(await page.inputValue('#add-form input[name=amountA]'));
    assert.ok(Math.abs(fifth - max / 5) < max * 0.001, `20 % je pětina z Max (${fifth} / ${max})`);
    // Částka druhého tokenu dopočítá první.
    await page.fill('#add-form input[name=amountB]', '4');
    await page.waitForFunction(() => Number(document.querySelector('#add-form input[name=amountA]').value) > 0);
    await page.fill('#add-form input[name=amountA]', '2');
    await page.waitForFunction(() => Number(document.querySelector('#add-form input[name=amountB]').value) > 3);
    await page.click('#add-go');
    await page.getByText('Likvidita je v poolu').waitFor({ timeout: 30000 });
    await page.locator('#my-pools .position').first().waitFor({ timeout: 15000 });
    const pair = A.at('SwapPair', await factory.getPair(WAET, usd.target));
    const share = await pair.balanceOf(user.address);
    assert.ok(share > 0n);
    assert.ok(await page.locator('[data-remove]').first().isDisabled(), 'bez zvolené části nejde nic vybrat');
    await page.click('#my-pools [data-cut="50"]');
    await page.locator('[data-back]', { hasText: /Dostanete zpět asi/ }).waitFor();
    await page.locator('[data-remove]').first().click();
    await page.getByText('Likvidita je vybraná').waitFor({ timeout: 30000 });
    assert.equal(await pair.balanceOf(user.address), share - share / 2n, 'polovina zůstala v poolu');
    await page.locator('#my-pools .position').first().waitFor();
    await page.click('#my-pools [data-cut="100"]');
    await page.locator('[data-remove]').first().click();
    await page.getByText('Likvidita je vybraná').waitFor({ timeout: 30000 });
    assert.equal(await pair.balanceOf(user.address), 0n);
    await page.locator('#my-pools.hidden').waitFor({ state: 'attached' });
  });

  await step('nový pool založí první vklad', async () => {
    await go('#/swap?view=pools');
    await pick('#add-a', 'tNIC');
    await pick('#add-b', 'tUSD');
    await page.fill('#add-form input[name=amountA]', '10');
    await page.fill('#add-form input[name=amountB]', '20');
    await page.click('#add-go');
    await page.getByText('Likvidita je v poolu').waitFor({ timeout: 30000 });
    assert.notEqual(await factory.getPair(lonely.target, usd.target), ethers.ZeroAddress);
  });

  if (process.env.AETHER_SHOT) {
    const shot = async (path, name, theme, width) => {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((v) => localStorage.setItem('aether.theme', v), theme);
      await page.goto(`${url}/${path}`);
      await page.reload();
      await page.locator('#swap-body > *').first().waitFor();
      if (path === '#/swap') {
        await page.waitForTimeout(300);
        await page.fill('#swap-in', '25');
      }
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${process.env.AETHER_SHOT}-${name}.png`, fullPage: true });
    };
    await shot('#/swap', 'swap-tmave', 'dark', 1280);
    await shot('#/swap', 'swap-svetle', 'light', 1280);
    await shot('#/swap?view=pools', 'likvidita-svetle', 'light', 1280);
    await shot('#/swap', 'swap-mobil', 'dark', 390);
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await step('detail swapu ukáže převody tokenů, funkci směrovače a události', async () => {
    const last = (await rpc('aether_txs', [{ address: user.address, limit: 25 }])).result.items;
    const routerAbi = new ethers.Interface(artifacts.SwapRouter.abi);
    const swap = last.find((x) => x.to?.toLowerCase() === router.target.toLowerCase() && routerAbi.parseTransaction({ data: x.input })?.name.startsWith('swap'));
    await page.goto(`${url}/#/tx/${swap.hash}`);
    await page.locator('.transfer-list li').first().waitFor();
    const text = await page.locator('#app').innerText();
    assert.match(text, /Převody tokenů/);
    assert.match(text, /SwapRouter\.swap/);
    assert.match(text, /potvrzení/);
    assert.match(text, /Cena gasu/);
    assert.match(text, /Typ\s+Swap/, 'typ transakce je Swap');
    assert.match(await page.locator('.tx-summary').innerText(), /→/, 'věta říká, co se za co směnilo');
    await page.click('details.fold summary');
    await page.locator('.log-list b', { hasText: 'Swap' }).first().waitFor();
    const block = Number(swap.blockNumber);
    await page.goto(`${url}/#/block/${block}`);
    await page.locator('#block-txs tbody tr').first().waitFor();
    const blockText = await page.locator('#app').innerText();
    assert.match(blockText, /Těžař celkem/);
    assert.match(blockText, /vytěžen za \d+ s/);
    assert.match(blockText, /Transactions root/);
    assert.ok(await page.locator(`#block-txs a[href="/tx/${swap.hash}"]`).count(), 'transakce je v seznamu bloku');
    // Peněženka v Exploreru: u každé transakce typ a směr, převody tokenů i z cizích transakcí.
    await page.goto(`${url}/#/address/${user.address}`);
    await page.locator('td .dir').first().waitFor();
    const own = await page.locator('#app').innerText();
    assert.match(own, /Swap Exact/, 'metoda swapu jako v Etherscanu');
    assert.match(own, /Approve/, 'metoda schválení');
    assert.match(own, /Odesláno/);
    // Rychlý náhled pod okem: z řádku seznamu, s odkazem na detail.
    await page.locator('.eye-btn').first().click();
    await page.locator('.tx-preview').waitFor();
    assert.match(await page.locator('.tx-preview').innerText(), /Poplatek[\s\S]*Detail transakce/);
    await page.keyboard.press('Escape');
    await page.goto(`${url}/#/address/${user.address}?tab=transfers`);
    await page.locator('td .dir').first().waitFor();
    const moves = await page.locator('#app').innerText();
    assert.match(moves, /Přijato/, 'výstup swapu je mezi přijatými');
    assert.match(moves, /Odesláno/, 'vstup zpětné směny je mezi odeslanými');
  });

  await step('čekající transakce s chybějícím nonce řekne, na co čeká, a fronta ji označí', async () => {
    const nonce = await A.provider.getTransactionCount(admin.address, 'latest');
    const fees = await A.provider.getFeeData();
    const signed = await admin.signTransaction({ to: admin.address, value: 0n, nonce: nonce + 1, gasLimit: 21000n, maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, chainId: A.id, type: 2 });
    const hash = (await rpc('eth_sendRawTransaction', [signed])).result;
    assert.ok(hash, 'uzel transakci s mezerou přijal do fronty');
    await page.goto(`${url}/#/tx/${hash}`);
    await page.locator('.notice', { hasText: `pořadovým číslem (nonce) ${nonce}` }).waitFor();
    await page.goto(`${url}/#/mempool`);
    await page.locator('.badge', { hasText: `Chybí nonce ${nonce}` }).waitFor();
    const metrics = await page.locator('.metric-grid').innerText();
    assert.match(metrics, /Čeká transakcí/);
    assert.match(metrics, /fronta pojme 5\s?000/);
  });

  await step('žebříček těžařů jde po stránkách, řadit a hledat', async () => {
    await page.goto(`${url}/#/miners`);
    await page.locator('.metric-grid').waitFor();
    assert.match(await page.locator('.metric-grid').innerText(), /Těžařů celkem/);
    assert.ok(await page.locator('tbody tr').count() >= 1);
    const first = await page.locator('tbody tr').first().getAttribute('data-href');
    const address = first.split('/')[2].split('?')[0];
    await page.fill('#miner-find input', address);
    await page.press('#miner-find input', 'Enter');
    await page.locator('.miner-found', { hasText: 'Pořadí 1 z' }).waitFor();
    await page.click('.seg a:has-text("Podle poslední aktivity")');
    await page.locator('.seg a.active', { hasText: 'Podle poslední aktivity' }).waitFor();
    await page.fill('#miner-find input', '0x0000000000000000000000000000000000000001');
    await page.press('#miner-find input', 'Enter');
    await page.getByText('Tato adresa zatím nevytěžila žádný blok.').waitFor();
  });

  await step('neúspěšná směna na detailu řekne proč a jak se tomu vyhnout', async () => {
    // Minimum nad odhadem: kontrakt směnu odmítne stejně jako druhou stejnou směnu za sebou na testnetu.
    const path = [WAET, usd.target];
    const [, out] = await router.getAmountsOut(WEI, path);
    const tx = await router.connect(A.connect(user)).swapExactNativeForTokens(out * 2n, path, user.address, FAR, { value: WEI, gasLimit: 300_000 });
    await tx.wait().catch(() => {});
    assert.equal((await A.provider.getTransactionReceipt(tx.hash)).status, 0, 'směna se vytěžila jako neúspěšná');
    await page.goto(`${url}/#/tx/${tx.hash}`);
    await page.locator('.fail-note', { hasText: 'Důvod:' }).waitFor({ timeout: 20000 });
    const note = await page.locator('.fail-note').innerText();
    assert.match(note, /Kurz se mezi odhadem a vytěžením změnil víc, než dovolovala nastavená tolerance/);
    assert.match(note, /stejná směna odeslaná dvakrát za sebou/);
    assert.match(await page.locator('#app').innerText(), /SlippageExceeded/, 'název chyby kontraktu');
  });

  await step('další směna počká, dokud z účtu čeká předchozí transakce', async () => {
    paused = true;
    try {
      const waiting = await A.connect(user).sendTransaction({ to: admin.address, value: 1n });
      await go('#/swap');
      await page.fill('#swap-in', '0,5');
      await page.locator('#swap-go:not([disabled])').waitFor();
      await page.click('#swap-go');
      await page.locator('#swap-msg', { hasText: 'Z tohoto účtu ještě čeká předchozí transakce' }).waitFor({ timeout: 20000 });
      paused = false;
      await waiting.wait();
    } finally { paused = false; }
  });

  await step('všechny jazyky a úzká obrazovka', async () => {
    await go('#/swap');
    for (const [lang, word] of [['en', 'Swap'], ['de', 'Tausch'], ['es', 'Intercambio'], ['fr', 'Échange']]) {
      await page.evaluate((l) => localStorage.setItem('aether.lang', l), lang);
      await page.reload();
      await page.locator('h1', { hasText: word }).waitFor();
    }
    await page.evaluate(() => localStorage.setItem('aether.lang', 'cs'));
    await page.setViewportSize({ width: 390, height: 800 });
    for (const path of ['#/swap', '#/swap?view=pools']) {
      await go(path);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `přetéká ${path}`);
    }
  });

  await step('stránka nehlásí žádnou chybu', async () => assert.deepEqual(errors, []));
} finally {
  stopping = true;
  await beat?.catch(() => {});
  await browser?.close().catch(() => {});
  await A.stop().catch(() => {});
}
console.log(failed ? 'Selhalo.' : 'Vše prošlo.');
process.exit(failed ? 1 : 0);
