// Prochází úplně každou stránku Exploreru ve všech jazycích. Stránka se může rozbít i tak, že ji jiný test vůbec neotevře.
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
  // Poslední bloky a poslední transakce jsou dva stejně vysoké boxy, i když je transakcí méně.
  await page.waitForSelector('.home-lists .latest-row');
  const boxes = await page.$$eval('.home-lists > .card', (cards) => cards.map((c) => Math.round(c.getBoundingClientRect().height)));
  if (boxes.length !== 2 || boxes[0] !== boxes[1]) { failed += 1; console.log(`[FAIL] boxy na úvodu mají různou výšku: ${boxes.join(' a ')}`); }
  // Řádky obou seznamů jsou po dvojicích stejně vysoké, takže seznamy končí na stejné úrovni.
  const rows = await page.$$eval('.home-lists > .card', (cards) => cards.map((c) => [...c.querySelectorAll('.latest-row')].map((r) => Math.round(r.getBoundingClientRect().bottom))));
  if (rows[0].length && rows[1].length && rows[0].at(-1) !== rows[1].at(-1)) { failed += 1; console.log(`[FAIL] seznamy na úvodu končí jinde: ${rows.map((r) => r.at(-1)).join(' a ')}`); }
  // Cena gasu řekne, jestli je na minimu kvůli prázdným blokům, aby nevypadala pevná.
  const gas = await page.$$eval('.home-stats .home-stat:nth-child(2) small', (x) => x.length);
  if (gas !== 2) { failed += 1; console.log(`[FAIL] u ceny gasu chybí stav sítě (${gas} řádků)`); }
  // Router: každá větev a každá položka menu.
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
  for (const lang of ['en', 'cs', 'de', 'es', 'fr']) {
    await page.evaluate((l) => localStorage.setItem('aether.lang', l), lang);
    await page.reload();
    await page.waitForSelector('#app *');
    for (const route of routes) {
      await page.goto(`${RPC}${route}`);
      // Stránka je hotová, až má obsah a žádnou kostru. Při velké zátěži počítače může první vykreslení chvíli trvat.
      await page.waitForFunction(() => document.getElementById('app').innerText.trim().length > 0 && !document.querySelector('#app .skel'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(120);
      const problem = await page.evaluate(() => document.querySelector('#app .error-box')?.textContent ?? null);
      const empty = await page.evaluate(() => document.getElementById('app').innerText.trim().length === 0);
      if (problem || empty) {
        failed += 1;
        console.log(`[FAIL] ${lang} ${route}: ${problem ?? 'prázdná stránka'}`);
      }
      // Rámeček nesmí přijít ani z výchozích stylů prohlížeče. Tenká linka pod řádkem je v pořádku, proto se spodní strana nepočítá.
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
  console.log(failed ? `Selhalo: ${failed}` : `Vše prošlo: ${routes.length} stránek v 5 jazycích`);
} finally {
  await browser?.close().catch(() => {});
  node.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
