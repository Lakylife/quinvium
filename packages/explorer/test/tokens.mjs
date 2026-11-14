// Tokens, charts and the new navigation in real Chromium over a real node and contracts.
// Numbers are checked against the contracts: the page must not show anything that is not on chain.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { WEI, artifacts, makeChain } from '../../bridge/test/helpers/chains.js';

const here = dirname(fileURLToPath(import.meta.url));
const admin = ethers.Wallet.createRandom();
const A = makeChain(52403n, 'aether', [admin], { staticDir: join(here, '..', 'public') });
const WAET = artifacts.WAET.address;
const FAR = 2_000_000_000_000;
const HOSTILE = '<img src=x onerror="window.__xss=1">';
const HOLDERS = 3;
const TRANSFERS = 30;

let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`[FAIL] ${name}: ${e.message.split('\n').slice(0, 3).join(' ')}`);
  }
};

let browser;
try {
  await A.start();
  const factory = await A.deploy('SwapFactory', admin);
  const router = await A.deploy('SwapRouter', admin, factory.target, WAET);
  const registry = await A.deploy('TokenRegistry', admin, admin.address);
  const usd = await A.deploy('StableToken', admin, 'Test USD', 'tUSD', 6, admin.address);
  await A.ok(usd.configureMinter(admin.address, 10n ** 30n));
  await A.ok(usd.mint(admin.address, 10n ** 15n));
  await A.ok(usd.connect(A.connect(admin)).approve(router.target, ethers.MaxUint256));
  await A.ok(router.connect(A.connect(admin)).addLiquidityNative(usd.target, 2000n * 10n ** 6n, 0n, 0n, admin.address, FAR, { value: 1000n * WEI }));
  await A.ok(registry.add(usd.target, 0, 'Vydavatel & spol', ''));
  const lonely = await A.deploy('StableToken', admin, 'Bez poolu', 'tNIC', 18, admin.address);
  await A.ok(lonely.configureMinter(admin.address, 10n ** 30n));
  await A.ok(lonely.mint(admin.address, 10n ** 21n));
  await A.ok(registry.add(lonely.target, 1, 'Někdo', ''));
  const hostile = await A.deploy('StableToken', admin, HOSTILE, '<b>x', 18, admin.address);

  const people = Array.from({ length: HOLDERS }, () => ethers.Wallet.createRandom());
  for (let i = 0; i < TRANSFERS; i++) await usd.transfer(people[i % HOLDERS].address, BigInt(i + 1) * 10n ** 6n);
  await A.mine();
  await A.node.mempool.settled();
  await A.mine();

  const deployments = { [A.id]: { registry: registry.target, swap: { factory: factory.target, router: router.target, tokens: [] } } };
  const url = `http://127.0.0.1:${A.node.rpc.port}`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/deployments.json', (r) => r.fulfill({ json: deployments }));
  await page.addInitScript(() => { localStorage.setItem('aether.lang', 'cs'); });
  const settled = () => page.waitForFunction(() => !document.querySelector('#app .skel') && document.querySelector('#app *'));
  const go = async (hash) => { await page.goto(`${url}/${hash}`); await page.reload(); await settled(); };
  const rowOf = (text) => page.locator('tbody tr', { hasText: text }).first().innerText();

  await step('the token list shows the price from the pool, circulation, holders and transfers', async () => {
    await go('#/tokens');
    await page.locator('tbody tr').nth(2).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 3, 'nativní mince a dva ověřené tokeny');
    const row = (await rowOf('tUSD')).replace(/\s+/g, ' ');
    // 1000 QU against 2000 tUSD: one token costs 0.5 and liquidity counts both sides of the pool.
    assert.match(row, /0,5 \w*QU/, row);
    assert.match(row, /2 000 \w*QU/, row);
    assert.match(row, /1 000 000 000/, row);
    const holders = HOLDERS + 2;      // people, administrator and pool
    const info = await A.provider.send('aether_tokenInfo', [usd.target]);
    assert.equal(info.holders, holders);
    assert.equal(info.transfers, TRANSFERS + 2);
    assert.equal(info.complete, true);
    assert.ok(row.endsWith(` ${holders} ${TRANSFERS + 2}`), row);
    assert.match((await rowOf('tNIC')).replace(/\s+/g, ' '), /— —/, 'bez poolu se cena nevymýšlí');
    assert.match((await rowOf('Quinvium')).replace(/\s+/g, ' '), /QU/);
  });

  await step('tokens can be searched, sorted and filtered by kind', async () => {
    await page.fill('#token-search', 'nic');
    await page.waitForFunction(() => document.querySelectorAll('#token-table tbody tr').length === 1);
    assert.match(await page.locator('#token-table tbody').innerText(), /tNIC/);
    await page.fill('#token-search', '');
    await page.waitForFunction(() => document.querySelectorAll('#token-table tbody tr').length === 3);
    await page.click('th[data-sort="holders"]');
    await page.locator('th[data-sort="holders"][aria-sort="descending"]').waitFor();
    assert.match(await page.locator('#token-table tbody tr').nth(1).innerText(), /tUSD/, 'nejvíc držitelů je první');
    await page.click('th[data-sort="holders"]');
    await page.locator('th[data-sort="holders"][aria-sort="ascending"]').waitFor();
    assert.match(await page.locator('#token-table tbody tr').nth(1).innerText(), /tNIC/);
    await page.click('[data-kind="1"]');
    await page.waitForFunction(() => document.querySelectorAll('#token-table tbody tr').length === 1);
    assert.match(await page.locator('#token-table tbody').innerText(), /tNIC/, 'jen přemostěné');
  });

  await step('the largest holders match the balances in the contract', async () => {
    const { top } = await A.provider.send('aether_tokenInfo', [usd.target]);
    for (const h of top) assert.equal(BigInt(h.balance), await usd.balanceOf(h.address), h.address);
    const list = top.map((h) => BigInt(h.balance));
    assert.deepEqual(list, [...list].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    const sum = list.reduce((a, b) => a + b, 0n);
    assert.equal(sum, await usd.totalSupply(), 'součet všech držitelů je celý oběh');
  });

  await step('token page: transfers by page and holders', async () => {
    await go(`#/token/${usd.target}`);
    await page.getByRole('heading', { name: 'Test USD (tUSD)' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 25, 'první strana převodů');
    assert.ok(await page.locator('a[data-nav="tokens"].active').count(), 'v nabídce svítí Tokeny');
    const pager = await page.locator('.pager').innerText();
    assert.match(pager, /Strana 1 z 2/, pager);
    const res = await A.provider.send('aether_tokenTransfers', [usd.target, 5, 0]);
    assert.equal(res.total, TRANSFERS + 2);
    const last = res.items[0];
    const receipt = await A.provider.getTransactionReceipt(last.hash);
    assert.equal(receipt.logs.length, 1);
    assert.equal(BigInt(receipt.logs[0].data), BigInt(last.value), 'částka z logu');
    await page.locator('.tabs a', { hasText: 'Držitelé' }).click();
    await page.getByRole('columnheader', { name: 'Podíl' }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), HOLDERS + 2);
  });

  await step('pools: the hashrate share in percent matches mined blocks', async () => {
    const factory = A.at('PoolFactory', artifacts.PoolFactory.address, admin);
    await A.ok(factory.createPool('Rudný pool', 'http://127.0.0.1:1', 100, 32, 16));
    const [pool] = await factory.list(0, 1);
    for (let i = 0; i < 10; i++) await A.mine(15, pool);
    const shares = await A.provider.send('aether_minerShares', [{}]);
    assert.equal(shares.blocks, Number(A.node.chain.head.number), 'každý blok je započítaný');
    const part = shares.items.find((x) => x.address.toLowerCase() === pool.toLowerCase());
    assert.equal(part.blocks, 10);
    assert.ok(Math.abs(shares.items.reduce((sum, x) => sum + x.work, 0) - shares.work) < 1e-6);
    await go('#/pools?range=all');
    // The first table is the hashrate split, the second the whole pool list by page.
    const row = page.locator('.card:not(#all-pools) tbody tr', { hasText: 'Rudný pool' });
    await row.waitFor();
    const expected = ((part.work / shares.work) * 100).toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    assert.ok((await row.locator('.share-cell b').innerText()).replace(/\s/g, '').startsWith(expected.slice(0, 3)), await row.innerText());
    assert.equal(await page.locator('.share-bar i').count(), 2, 'pool a sólo těžař');
    await page.locator('tbody tr', { hasText: 'sólo těžař' }).waitFor();
    const listed = page.locator('#all-pools tbody tr', { hasText: 'Rudný pool' });
    assert.match(await listed.innerText(), /1\s*%[\s\S]*10/, 'celý seznam ukazuje poplatek a bloky');
    await row.locator('td').nth(2).click();
    await page.getByRole('heading', { name: 'Rudný pool' }).waitFor();
  });

  await step('a mint is marked in transfers and does not look like the zero address', async () => {
    await go(`#/token/${lonely.target}`);
    await page.locator('tbody .badge', { hasText: 'Vydání' }).waitFor();
  });

  await step('a token name from a foreign contract is never executed', async () => {
    await go(`#/token/${hostile.target}`);
    await page.locator('.notice').waitFor();
    assert.equal(await page.locator('#app img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.ok((await page.locator('h1').innerText()).includes(HOSTILE), 'text je vidět jako text');
    assert.ok(await page.locator('.badge.bad', { hasText: 'Neověřený' }).count(), 'cizí token je označený');
  });

  await step('the contract address leads to the token page; an invalid address does not crash the page', async () => {
    await go(`#/address/${usd.target}`);
    await page.locator('.kv a', { hasText: 'tUSD' }).click();
    await page.getByRole('heading', { name: 'Test USD (tUSD)' }).waitFor();
    await go('#/token/nesmysl');
    await page.getByText('Nic nenalezeno').waitFor();
    await go(`#/token/${admin.address}`);
    await page.getByText('Nic nenalezeno').waitFor();
  });

  await step('charts: the switch shows a table instead of charts and back; the period stays', async () => {
    await go('#/charts?range=all');
    await page.locator('#plot-time svg').waitFor();
    assert.equal(await page.locator('.plot').count(), 14, 'všechny grafy, které rejstřík umí');
    assert.equal(await page.locator('#chart-table').count(), 0);
    await page.locator('.seg a', { hasText: 'Tabulka' }).click();
    await page.locator('#chart-table tbody tr').first().waitFor();
    assert.equal(await page.locator('.plot').count(), 0, 'tabulka nahradí grafy');
    assert.ok((await page.evaluate(() => location.search)).includes('range=all'));
    assert.ok((await page.locator('#chart-table').boundingBox()).y < 900, 'tabulka je vidět bez posouvání');
    await page.locator('.seg a', { hasText: 'Grafy' }).click();
    await page.locator('#plot-time svg').waitFor();
    assert.equal(await page.locator('#chart-table').count(), 0);
  });

  await step('a single interval in the chart is visible and does not claim there are no blocks', async () => {
    const one = await page.evaluate(async (rpc) => {
      const r = await fetch(rpc, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'aether_chartSeries', params: [{ points: 10 }] }) });
      return (await r.json()).result;
    }, url);
    assert.ok(one.bucket >= 60, 'úsek má aspoň minutu, jinak by výkon byl jen šum');
    assert.ok(one.items.length >= 1);
    assert.equal(one.items[0].first, 1);
    assert.equal(one.items.reduce((sum, p) => sum + p.blocks, 0), Number(A.node.chain.head.number));
  });

  await step('overview: the block ribbon and a prompt when nobody is mining', async () => {
    await go('#/');
    await page.locator('.ribbon-item').nth(3).waitFor();
    assert.ok(await page.locator('.metric-grid').count());
    assert.match(await page.locator('.notice').innerText(), /netěží/, 'bloky testu jsou staré');
    assert.match(await page.locator('.ribbon-item').first().innerText(), new RegExp(`#${A.node.chain.head.number}`));
  });

  await step('a running network does not show the prompt', async () => {
    const clock = (A.state.clock + 30) * 1000;
    const live = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await live.addInitScript((now) => { Date.now = () => now; localStorage.setItem('aether.lang', 'cs'); }, clock);
    await live.goto(`${url}/#/`);
    await live.locator('.ribbon-item').nth(3).waitFor();
    assert.equal(await live.locator('.notice').count(), 0);
    await live.close();
  });

  await step('a search being typed survives a new block and search on the overview works', async () => {
    await go('#/');
    const input = page.locator('.hero-search input');
    await input.fill('1');
    await A.mine();
    await page.waitForFunction((n) => document.querySelector('.ribbon-item:nth-child(1) strong')?.textContent === `#${n}`, Number(A.node.chain.head.number));
    assert.equal(await input.inputValue(), '1');
    await input.press('Enter');
    await page.waitForFunction(() => location.pathname === '/block/1');
    await page.getByRole('heading', { name: '#1' }).waitFor();
    assert.ok(await page.locator('.nav-group.active', { hasText: 'Blockchain' }).count());
  });

  await step('main menu: a group opens, closes after a choice and Escape dismisses it', async () => {
    await go('#/blocks');
    const group = page.locator('.nav-group', { hasText: 'Síť' });
    const menu = group.locator('.nav-menu');
    await page.mouse.move(0, 500);
    assert.equal(await menu.isVisible(), false);
    await group.locator('button').focus();
    await page.keyboard.press('Enter');
    await menu.waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await group.locator('button').hover();
    await menu.waitFor();
    await menu.locator('a', { hasText: 'Grafy' }).click();
    await page.waitForFunction(() => location.pathname === '/charts');
    await menu.waitFor({ state: 'hidden' });
  });

  await step('narrow screen: the whole menu is behind one button and the page does not overflow', async () => {
    const small = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await small.route('**/deployments.json', (r) => r.fulfill({ json: deployments }));
    await small.goto(`${url}/#/tokens`);
    await small.locator('tbody tr').first().waitFor();
    assert.equal(await small.locator('#main-nav').isVisible(), false);
    await small.locator('#menu-btn').click();
    await small.locator('#main-nav a', { hasText: 'Charts' }).click();
    await small.waitForFunction(() => location.pathname === '/charts');
    await small.locator('#main-nav').waitFor({ state: 'hidden' });
    for (const hash of ['#/', '#/tokens', '#/charts', '#/blocks', `#/token/${usd.target}`, '#/swap', '#/bridge']) {
      await small.goto(`${url}/${hash}`);
      await small.waitForTimeout(500);
      const over = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${hash} přetéká o ${over} px`);
    }
    await small.close();
  });

  await step('the page runs without JavaScript errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close().catch(() => {});
  await A.stop().catch(() => {});
}
console.log(failed ? `Selhalo: ${failed}` : 'Vše prošlo');
process.exit(failed ? 1 : 0);
