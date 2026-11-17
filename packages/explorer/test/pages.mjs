// Walks every single Explorer page in all languages. A page can break even in a way no other test ever opens.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

const here = dirname(fileURLToPath(import.meta.url));
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PORT = 8777;
const RPC = `http://127.0.0.1:${PORT}`;
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-stranky-')),
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2), '--dev-mine', '--miner-address', ADDRESS], { stdio: 'ignore' });
const rpc = async (method, params = []) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;

let browser;
let failed = 0;
try {
  for (let i = 0; i < 300; i++) {
    if (BigInt(await rpc('eth_blockNumber').catch(() => '0x0') ?? 0) >= 2n) break;
    await new Promise((r) => { setTimeout(r, 100); });
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${RPC}/`);
  await page.waitForSelector('.metric-grid');
  // Latest blocks and latest transactions are two equally tall boxes, even when there are fewer transactions.
  await page.waitForSelector('.home-lists .latest-row');
  const boxes = await page.$$eval('.home-lists > .card', (cards) => cards.map((c) => Math.round(c.getBoundingClientRect().height)));
  if (boxes.length !== 2 || boxes[0] !== boxes[1]) { failed += 1; console.log(`[FAIL] boxy na úvodu mají různou výšku: ${boxes.join(' a ')}`); }
  // Rows of both lists are equally tall in pairs, so the lists end at the same level.
  const rows = await page.$$eval('.home-lists > .card', (cards) => cards.map((c) => [...c.querySelectorAll('.latest-row')].map((r) => Math.round(r.getBoundingClientRect().bottom))));
  if (rows[0].length && rows[1].length && rows[0].at(-1) !== rows[1].at(-1)) { failed += 1; console.log(`[FAIL] seznamy na úvodu končí jinde: ${rows.map((r) => r.at(-1)).join(' a ')}`); }
  // The gas price says whether it is at the minimum because of empty blocks, so it does not look fixed.
  const gas = await page.$$eval('.home-stats .home-stat:nth-child(2) small', (x) => x.length);
  if (gas !== 2) { failed += 1; console.log(`[FAIL] u ceny gasu chybí stav sítě (${gas} řádků)`); }
  // Swap and Bridge do not run on the dev network: they sit under More, marked soon, not in the main menu.
  await page.waitForSelector('.nav-group .nav-soon', { timeout: 15000 }).catch(() => {});
  const soon = await page.evaluate(() => [...document.querySelectorAll('.nav-group[data-group*="apps"] a[data-nav]')].filter((a) => a.querySelector('.nav-soon')).map((a) => a.dataset.nav).sort().join(','));
  const top = await page.$$eval('.main-nav > a[data-nav="swap"], .main-nav > a[data-nav="bridge"]', (x) => x.length);
  if (soon !== 'bridge,swap' || top) { failed += 1; console.log(`[FAIL] Swap a Most mimo hlavní menu: ${soon}, v hlavním menu ${top}`); }
  // An unknown address shows Page not found instead of the home page.
  await page.goto(`${RPC}/no-such-page`);
  await page.waitForFunction(() => document.querySelector('#app h1')?.textContent === 'Page not found', null, { timeout: 15000 }).catch(() => { failed += 1; console.log('[FAIL] neznámá adresa neukazuje Page not found'); });
  // Router: every branch and every menu item.
  const links = await page.$$eval('a[data-nav]', (list) => list.map((a) => a.getAttribute('href')));
  assert.ok(links.length >= 14, `položek menu ${links.length}`);
  const extra = ['/', '/block/1', `/address/${ADDRESS}`, '/pools/new', '/swap?view=pools', '/bridge?dir=in', '/api', '/blocks?txs=empty', `/txs?address=${ADDRESS}`, '/charts?view=table&range=all', `/token/${ADDRESS}`, '/miners?order=last', `/miners?address=${ADDRESS}`, '/mempool?order=time', '/block/1?page=2', `/tx/0x${'ab'.repeat(32)}`, `/address/${ADDRESS}?tab=transfers`];
  const routes = [...new Set([...links, ...extra])];
  await page.goto(`${RPC}/#/block/1?page=2`);
  await page.waitForFunction(() => location.pathname === '/block/1' && location.search === '?page=2' && !location.hash, null, { timeout: 15000 });
  await page.goto(`${RPC}/#/`);
  await page.waitForFunction(() => location.pathname === '/' && !location.hash, null, { timeout: 15000 });
  await page.goto(`${RPC}/blocks`);
  await page.locator('a[href^="/block/"]').first().click();
  await page.waitForFunction(() => /^\/block\/\d+$/.test(location.pathname), null, { timeout: 15000 });
  await page.goBack();
  await page.waitForFunction(() => location.pathname === '/blocks', null, { timeout: 15000 });
  const LANGS = ['en', 'cs', 'de', 'es', 'fr', 'ja', 'zh', 'ar'];
  for (const lang of LANGS) {
    await page.evaluate((l) => localStorage.setItem('aether.lang', l), lang);
    await page.reload();
    await page.waitForSelector('#app *');
    for (const route of routes) {
      await page.goto(`${RPC}${route}`);
      // A page is done when it has content and no skeleton. Under heavy load the first render may take a while.
      await page.waitForFunction(() => document.getElementById('app').innerText.trim().length > 0 && !document.querySelector('#app .skel'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(120);
      const problem = await page.evaluate(() => document.querySelector('#app .error-box')?.textContent ?? null);
      const empty = await page.evaluate(() => document.getElementById('app').innerText.trim().length === 0);
      if (problem || empty) {
        failed += 1;
        console.log(`[FAIL] ${lang} ${route}: ${problem ?? 'prázdná stránka'}`);
      }
      // A frame must not come even from the browser's default styles. A thin line under a row is fine, so the bottom side is not counted.
      if (lang === 'en') {
        const framed = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && ['Top', 'Right', 'Left'].some((side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && s[`border${side}Color`] !== 'rgba(0, 0, 0, 0)');
        }).map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
        if (framed.length) {
          failed += 1;
          console.log(`[FAIL] ${route} má rámeček: ${[...new Set(framed)].slice(0, 5).join(', ')}`);
        }
      }
    }
  }
  if (errors.length) { failed += 1; console.log(`[FAIL] chyby JavaScriptu: ${[...new Set(errors)].join(' | ')}`); }
  console.log(failed ? `Selhalo: ${failed}` : `Vše prošlo: ${routes.length} stránek v ${LANGS.length} jazycích`);
} finally {
  await browser?.close().catch(() => {});
  node.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
