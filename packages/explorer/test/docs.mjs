// Dokumentace nesmí lhát: metody a volby se porovnají s kódem uzlu, příklady se opravdu spustí
// proti skutečnému uzlu a stránka se projde ve skutečném prohlížeči.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const nodePkg = join(here, '..', '..', 'node');
const publicDir = join(here, '..', 'public');
const require = createRequire(join(nodePkg, 'package.json'));
const { ethers } = require('ethers');

const PORT = 8767;
const RPC = `http://127.0.0.1:${PORT}`;
const contracts = JSON.parse(readFileSync(join(publicDir, 'contracts.json'), 'utf8'));

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(publicDir, 'docs.js'), 'utf8'), sandbox);
const { EXAMPLES, RPC_GROUPS, CLI_OPTIONS, SECTIONS, networkValues } = sandbox.window.AetherDocs;

const results = [];
const step = async (name, fn) => {
  try {
    const note = await fn();
    results.push([name, true]);
    console.log(`[OK  ] ${name}${note ? `: ${note}` : ''}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`[FAIL] ${name}: ${e.message.split('\n').slice(0, 4).join(' ')}`);
  }
};

const documented = new Set(RPC_GROUPS.flatMap((g) => g.rows.map((r) => r[0])));

await step('každá metoda RPC je zdokumentovaná a žádná není vymyšlená', async () => {
  const { createMethods } = await import(join(nodePkg, 'src', 'rpc', 'methods.js'));
  const fake = { on() {} };
  const { methods } = createMethods({ chain: fake, mempool: fake, network: null, work: null, version: 'x' });
  // Dokumentace ukazuje názvy quinvium_*. Dřívější aether_* a quintium_* jsou jen jejich dvojčata, každé musí mít svůj nový název.
  const names = Object.keys(methods);
  assert.deepEqual(names.filter((m) => m.startsWith('aether_') && methods[`quinvium_${m.slice(7)}`] !== methods[m]), [], 'starý název bez nového');
  assert.deepEqual(names.filter((m) => m.startsWith('quintium_') && methods[`quinvium_${m.slice(9)}`] !== methods[m]), [], 'quintium_ bez quinvium_');
  const real = new Set([...names.filter((m) => !m.startsWith('aether_') && !m.startsWith('quintium_')), 'eth_subscribe', 'eth_unsubscribe']);
  assert.deepEqual([...real].filter((m) => !documented.has(m)), [], 'chybí v dokumentaci');
  assert.deepEqual([...documented].filter((m) => !real.has(m)), [], 'navíc v dokumentaci');
  return `${real.size} metod`;
});

await step('každá volba uzlu je zdokumentovaná a žádná není vymyšlená', () => {
  const cli = readFileSync(join(nodePkg, 'src', 'cli.js'), 'utf8');
  const help = cli.slice(cli.indexOf('const HELP'), cli.indexOf('`;'));
  const real = new Set(help.match(/^ {2}--[a-z0-9-]+/gm).map((x) => x.trim()));
  const docs = new Set(CLI_OPTIONS.map((o) => o[0]));
  assert.deepEqual([...real].filter((m) => !docs.has(m)), [], 'chybí v dokumentaci');
  assert.deepEqual([...docs].filter((m) => !real.has(m)), [], 'navíc v dokumentaci');
  return `${real.size} voleb`;
});

await step('každý příklad je použitý v textu a každý odkaz na příklad existuje', () => {
  const used = SECTIONS.flatMap((s) => s.blocks.filter((b) => b.code).map((b) => b.code));
  assert.equal(Object.keys(EXAMPLES).filter((k) => !used.includes(k)).join(' '), '', 'nepoužité příklady');
  assert.equal(used.filter((k) => !EXAMPLES[k]).join(' '), '', 'neexistující příklady');
});

// ---- skutečný uzel ------------------------------------------------------------------
const owner = ethers.Wallet.createRandom();
const data = mkdtempSync(join(tmpdir(), 'aether-docs-'));
const node = spawn(process.execPath, ['--no-warnings', join(nodePkg, 'src', 'cli.js'), '--network', 'dev', '--data-dir', data, '--dev-mine', '--miner-address', owner.address,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const until = async (fn, ms = 120000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vypršel čas');
};

const scratch = join(nodePkg, 'test', '.doc-examples');
let browser;
try {
  await until(async () => (await provider.getBalance(owner.address)) >= 24n * 10n ** 18n);
  const stats = await (await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'aether_stats', params: [] }) })).json();
  const values = networkValues({ rpcBase: RPC, stats: stats.result, contracts });
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  const fillIn = (code, id) => code
    .replaceAll('0xVASE_ADRESA', owner.address)
    .replaceAll('0xPRIJEMCE', ethers.Wallet.createRandom().address)
    .replaceAll('moje-firma', `firma-${id}-${Date.now()}`.toLowerCase());

  const runJs = (id, code) => new Promise((resolve, reject) => {
    const file = join(scratch, `${id}.mjs`);
    writeFileSync(file, fillIn(code, id));
    const p = spawn(process.execPath, ['--no-warnings', file], { env: { ...process.env, QUINVIUM_KEY: owner.privateKey }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const stream = EXAMPLES[id].stream;
    p.stdout.on('data', (d) => { out += d; if (stream && out.trim()) p.kill(); });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { p.kill(); reject(new Error(`vypršel čas. ${err.slice(0, 300)}`)); }, 180000);
    p.on('exit', (code2, signal) => {
      clearTimeout(timer);
      if (code2 === 0 || (stream && signal)) resolve(out.trim());
      else reject(new Error(err.slice(0, 400)));
    });
  });

  // Paralelně by si příklady z jedné adresy braly stejné nonce, proto jeden po druhém.
  for (const [id, ex] of Object.entries(EXAMPLES)) {
    if (!ex.run) continue;
    await step(`příklad ${id}`, async () => {
      const code = ex.code(values);
      if (ex.lang === 'bash') {
        const r = spawnSync('bash', ['-c', fillIn(code, id)], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const json = JSON.parse(r.stdout);
        assert.ok(json.result !== undefined, r.stdout.slice(0, 200));
        return String(JSON.stringify(json.result)).slice(0, 60);
      }
      const out = await runJs(id, code);
      if (ex.stream) assert.ok(out.length > 0, 'žádný výstup');
      return out.split('\n')[0].slice(0, 70);
    });
  }

  await step('Hardhat: nasazení a volání kontraktu podle konfigurace z dokumentace', async () => {
    const project = process.env.AETHER_HARDHAT_DIR;
    if (!project) return 'přeskočeno, chybí AETHER_HARDHAT_DIR';
    writeFileSync(join(project, 'hardhat.config.cjs'), EXAMPLES.hardhat.code(values));
    const r = spawnSync('npx', ['hardhat', '--config', 'hardhat.config.cjs', 'run', 'deploy.cjs', '--network', 'quinvium'], { cwd: project, encoding: 'utf8', env: { ...process.env, QUINVIUM_KEY: owner.privateKey }, timeout: 170000 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`.slice(-400));
    return r.stdout.trim().split('\n').at(-1).slice(0, 70);
  });

  // ---- prohlížeč ---------------------------------------------------------------------
  browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'cs-CZ', viewport: { width: 1400, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('aether.lang', 'cs'); } catch { /* jen pro test */ } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await step('dokumentace se zobrazí se všemi kapitolami', async () => {
    await page.goto(`${RPC}/#/api`);
    await page.waitForSelector('.doc-section');
    assert.equal(await page.locator('.doc-section').count(), SECTIONS.length);
    assert.equal(await page.locator('.docs-toc a').count(), SECTIONS.length);
    const text = await page.locator('#doc-start').innerText();
    assert.match(text, /Začínáme/);
    return `${SECTIONS.length} kapitol`;
  });

  await step('příklady jsou doplněné pro připojenou síť', async () => {
    const text = await page.locator('#doc-wallets').innerText();
    assert.match(text, new RegExp(RPC.replace(/[/.:]/g, '\\$&')));
    assert.match(text, /0xccb3/);
    assert.match(text, /dQU/);
  });

  await step('obsah vede na správnou kapitolu i přes přímý odkaz', async () => {
    await page.locator('.docs-toc a[data-doc="rpc"]').click();
    await page.waitForFunction(() => location.pathname === '/api/rpc' && document.querySelector('.docs-toc a.active')?.dataset.doc === 'rpc');
    await page.waitForFunction(() => { const r = document.querySelector('#doc-rpc').getBoundingClientRect(); return r.top >= 0 && r.top < 300; }, null, { timeout: 5000 });
    await page.goto(`${RPC}/#/api/limits`);
    await page.reload();
    await page.waitForSelector('#doc-limits');
    await page.waitForFunction(() => { const r = document.querySelector('#doc-limits').getBoundingClientRect(); return r.top >= 0 && r.top < 300; });
  });

  await step('konzole volá skutečný uzel a ukáže chybu', async () => {
    await page.goto(`${RPC}/#/api/rpc`);
    await page.waitForSelector('#doc-console');
    await page.locator('#doc-console button').click();
    await page.waitForFunction(() => /"chainId": 52403/.test(document.querySelector('#doc-output').textContent));
    await page.fill('#doc-console input[name=method]', 'eth_getBalance');
    await page.fill('#doc-console input[name=params]', `["${owner.address}", "latest"]`);
    await page.locator('#doc-console button').click();
    await page.waitForFunction(() => /"0x[0-9a-f]+"/.test(document.querySelector('#doc-output').textContent));
    await page.fill('#doc-console input[name=params]', 'nesmysl');
    await page.locator('#doc-console button').click();
    await page.waitForFunction(() => document.querySelector('#doc-output').classList.contains('bad'));
  });

  await step('reference obsahuje všechny kontrakty s funkcemi z ABI', async () => {
    assert.equal(await page.locator('.doc-contract').count(), Object.keys(contracts).length);
    const notary = page.locator('.doc-contract', { hasText: 'Notary' }).first();
    await notary.locator('summary').click();
    const text = await notary.innerText();
    assert.match(text, /notarize\(bytes32 hash, string note\)/);
    assert.match(text, /verify\(bytes32 hash, address author\) view/);
    assert.match(text, /0xae00000000000000000000000000000000000001/);
  });

  await step('kopírování kódu dostane přesně ukázaný text', async () => {
    const block = page.locator('.doc-code', { hasText: 'createRandom' }).first();
    const shown = await block.locator('pre').innerText();
    const copied = await block.locator('.copy-btn').getAttribute('data-copy');
    assert.equal(copied.trim(), shown.trim());
  });

  await step('anglická verze', async () => {
    await page.click('#lang-btn');
    await page.click('[data-lang=en]');
    await page.waitForFunction(() => /Quick start/.test(document.querySelector('#doc-start')?.textContent ?? ''));
    const text = await page.locator('.docs-main').innerText();
    assert.doesNotMatch(text, /Začínáme|Rozdíly oproti|Potvrzení/);
    await page.click('#lang-btn');
    await page.click('[data-lang=cs]');
  });

  await step('úzká obrazovka: stránka se nerozjede do šířky', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${RPC}/#/api/rpc`);
    await page.reload();
    await page.waitForSelector('.doc-section');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `přetéká o ${overflow} px`);
  });

  await step('stránka nehlásí žádnou chybu JavaScriptu', async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  node.kill('SIGKILL');
  provider.destroy();
  rmSync(scratch, { recursive: true, force: true });
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nVýsledek: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
