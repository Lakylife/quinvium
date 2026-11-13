// Stránky poolů ve skutečném Chromiu proti skutečnému uzlu. Peněženka podepisuje skutečné transakce klíčem z testu.
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
const PORT = 8767;
const RPC = `http://127.0.0.1:${PORT}`;
const wallet = ethers.Wallet.createRandom();

let failed = false;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    failed = true;
    console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
    throw e;
  }
};

const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', mkdtempSync(join(tmpdir(), 'aether-pools-')),
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2), '--dev-mine', '--miner-address', wallet.address], { stdio: 'ignore' });
const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 100 });
const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return r.json();
};

async function bridge(method, params = []) {
  switch (method) {
    case 'eth_accounts':
    case 'eth_requestAccounts': return { result: [wallet.address] };
    case 'eth_chainId': return { result: '0xccb3' };
    case 'eth_sendTransaction': {
      const { from: _from, gas, ...tx } = params[0];
      const sent = await wallet.connect(provider).sendTransaction({ ...tx, gasLimit: gas });
      return { result: sent.hash };
    }
    default: return rpc(method, params);
  }
}

let browser;
try {
  for (let i = 0; i < 300; i++) {
    const ok = await rpc('eth_blockNumber').then((r) => BigInt(r.result) >= 3n).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('walletBridge', bridge);
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
  let pool;

  await step('prázdný seznam vybízí k založení', async () => {
    await page.goto(`${RPC}/#/pools`);
    await page.getByText('Zatím tu žádný pool není').waitFor();
    assert.ok(await page.locator('a[data-nav=\"pools\"].active').count());
    assert.equal(await page.locator('#pool-form').count(), 0, 'seznam a založení jsou zvlášť');
    await page.click('a[href="/pools/new"]');
    await page.locator('#pool-form').waitFor();
  });

  await step('příliš vysoký poplatek odmítne kontrakt a uživatel to pochopí', async () => {
    await page.locator('input[name="name"]').fill('Vysoký poplatek');
    await page.locator('input[name="fee"]').fill('9');
    await page.locator('#pool-create').click();
    await page.getByText('Poplatek smí být nejvýše 5').waitFor({ timeout: 20000 });
  });

  await step('založení poolu přejde na jeho stránku', async () => {
    await page.locator('input[name="name"]').fill('Domácí pool');
    await page.locator('input[name="url"]').fill('http://192.168.1.50:8547');
    await page.locator('input[name="fee"]').fill('1,5');
    await page.locator('#pool-create').click();
    await page.waitForURL(/\/pool\/0x[0-9a-fA-F]{40}\?created=1$/, { timeout: 30000 });
    pool = new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('heading', { name: 'Domácí pool' }).waitFor();
    // Tvůrce hned vidí, co dál: spustit server poolu, sdílet těžbu a zveřejnit adresu.
    await page.locator('.created-card', { hasText: 'Pool je založený. Co dál' }).waitFor();
    const text = await page.locator('#app').innerText();
    assert.match(text, /1,5 %/);
    assert.match(text, /stratum\+tcp:\/\/192\.168\.1\.50:3335/);
    assert.match(text, /dělí se za posledních/i);
    assert.match(text, /128 min/i, 'okno 16 kol po 32 blocích');
  });

  await step('stav těžaře a provozovatele', async () => {
    await page.locator('#miner-check').click();
    await page.getByText('K výběru: 0').waitFor();
    assert.ok(await page.locator('#op-form').count(), 'provozovatel vidí svou část');
    await page.locator('#op-form input[name="url"]').fill('http://192.168.1.51:8547');
    await page.locator('#op-url').click();
    await page.getByText('Potvrzeno v bloku').waitFor({ timeout: 20000 });
    const c = new ethers.Contract(pool, ['function url() view returns (string)'], provider);
    assert.equal(await c.url(), 'http://192.168.1.51:8547');
  });

  await step('připojení jako u velkých poolů: server, jméno, heslo a příkazy pro programy', async () => {
    await page.goto(`${RPC}/#/pool/${pool}`);
    await page.locator('#connect .badge', { hasText: 'Server zveřejněný' }).waitFor();
    const card = await page.locator('#connect').innerText();
    assert.match(card, /stratum\+tcp:\/\/192\.168\.1\.51:3335/);
    assert.ok(card.includes('VAŠE_ADRESA.rig1'), 'jméno je adresa peněženky a název zařízení, místo adresy zástupný text');
    assert.ok(!card.includes(wallet.address), 'návod neukazuje adresu připojené peněženky');
    assert.match(card, /Místo VAŠE_ADRESA vložte adresu peněženky/);
    assert.match(card, /Ethash/);
    assert.match(card, /Kam těžíte/, 'aplikace: kde pool vybrat');
    await page.click('[data-tool="trex"]');
    const trex = await page.locator('[data-tool-body="trex"] pre').innerText();
    assert.equal(trex, 't-rex -a ethash -o stratum+tcp://192.168.1.51:3335 -u VAŠE_ADRESA -w rig1 -p x');
    assert.ok(await page.locator('[data-tool-body="app"]').isHidden(), 'vidět je jen vybraný program');
    await page.click('[data-tool="cli"]');
    assert.match(await page.locator('[data-tool-body="cli"] pre').innerText(), new RegExp(`--pool ${pool} --node http://192\\.168\\.1\\.51:8547`, 'i'));
  });

  await step('mezi tisíci těžaři jde najít vlastní adresu a seznam poolů má hledání', async () => {
    await page.goto(`${RPC}/#/pool/${pool}`);
    await page.fill('#miner-find input[name=miner]', wallet.address);
    await page.press('#miner-find input[name=miner]', 'Enter');
    await page.waitForURL(/\?miner=0x/);
    await page.getByText('Tato adresa v okně poolu neposlala žádný podíl.').waitFor();
    await page.click('text=← Všichni těžaři');
    await page.getByText('V okně poolu zatím nikdo neposlal podíl.').waitFor();
    await page.goto(`${RPC}/#/pools`);
    await page.locator('#all-pools h2', { hasText: 'Všechny pooly (1)' }).waitFor();
    assert.ok(await page.locator('#all-pools tr[data-href]', { hasText: 'Domácí pool' }).count(), 'pool je v celém seznamu');
    await page.fill('#pool-find input[name=q]', 'nic takového');
    await page.press('#pool-find input[name=q]', 'Enter');
    await page.getByText('Hledání „nic takového“ neodpovídá žádný pool.').waitFor();
    await page.fill('#pool-find input[name=q]', 'domácí');
    await page.press('#pool-find input[name=q]', 'Enter');
    await page.locator('#all-pools tr[data-href]', { hasText: 'Domácí pool' }).waitFor();
  });

  await step('hospodaření poolu, těžaři a pool na stránce provozovatele i kontraktu', async () => {
    await page.goto(`${RPC}/#/pool/${pool}`);
    await page.getByText('Hospodaření poolu').waitFor();
    const text = await page.locator('#app').innerText();
    for (const part of ['Odměny za bloky', 'Vyplaceno těžařům', 'Poplatek provozovatele celkem', 'k výběru', 'Těžaři v okně poolu', 'V okně poolu zatím nikdo neposlal podíl.', 'tvůrce poolu, dostává poplatek 1,5 %']) {
      assert.ok(text.includes(part), `stránka poolu ukazuje ${part}`);
    }
    await page.goto(`${RPC}/#/address/${wallet.address}`);
    await page.getByText('Provozuje pooly').waitFor();
    assert.ok(await page.locator('tr[data-href]', { hasText: 'Domácí pool' }).count(), 'tvůrce má pool u sebe');
    await page.goto(`${RPC}/#/address/${pool}`);
    await page.getByText('Tohle je kontrakt těžebního poolu Domácí pool').waitFor();
    assert.match(await page.locator('#app').innerText(), /Přijato v transakcích/);
    await page.getByText('Přehled poolu →').click();
    await page.getByRole('heading', { name: 'Domácí pool' }).waitFor();
  });

  await step('pool je v seznamu a řádek vede na detail', async () => {
    await page.goto(`${RPC}/#/pools`);
    await page.locator('tr[data-href]', { hasText: 'Domácí pool' }).locator('td').nth(1).click();
    await page.getByRole('heading', { name: 'Domácí pool' }).waitFor();
  });

  await step('cizí adresa se za pool nevydává', async () => {
    await page.goto(`${RPC}/#/pool/${wallet.address}`);
    await page.getByText('není pool z továrny').waitFor();
  });

  await step('všechny jazyky fungují a výběr si stránka pamatuje', async () => {
    for (const [code, text] of [['de', 'Gebühr'], ['es', 'Comisión'], ['fr', 'Frais'], ['en', 'Fee']]) {
      await page.goto(`${RPC}/#/pools`);
      await page.click('#lang-btn');
      await page.click(`[data-lang=${code}]`);
      await page.locator('th', { hasText: text }).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.lang), code);
    }
    await page.reload();
    await page.locator('th', { hasText: 'Fee' }).first().waitFor();
    assert.equal(await page.textContent('#lang-label'), 'EN');
    assert.equal(await page.getAttribute('[data-lang=en]', 'aria-checked'), 'true');
    await page.click('#lang-btn');
    await page.click('[data-lang=de]');
    await page.goto(`${RPC}/#/apps`);
    await page.getByRole('heading', { name: 'Notar' }).waitFor();
  });

  await step('úzká obrazovka: stránka poolu se nerozjede do šířky', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${RPC}/#/pool/${pool}`);
    await page.locator('#miner-check').waitFor();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `přesah ${wide} px`);
  });

  await step('stránka nehlásí žádnou chybu', async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  provider.destroy();
  node.kill('SIGTERM');
}
console.log(failed ? 'NEPROŠLO' : 'Vše prošlo.');
process.exit(failed ? 1 : 0);
