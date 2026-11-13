// Skutečná aplikace Electron: uzel, peněženka a těžba na grafické kartě.
import { _electron as electron } from 'playwright';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
process.env.AETHER_NO_SEEDS = '1'; // testovací uzly se nespojí se skutečným testnetem (seed v params.js)

const here = dirname(fileURLToPath(import.meta.url));
const electronPath = createRequire(import.meta.url)('electron');
const PHRASE = 'test test test test test test test test test test test junk';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// Vlastní porty hledání a sítě, jinak by se k testu připojily skutečné počítače a přinesly skutečný řetězec.
const LAN_PORT = '30590';
const P2P_PORT = '30591';
// Vlastní porty uzlu: test běží i vedle otevřené aplikace a jejího uzlu se nedotkne.
const RPC_PORT = 18756;
const STRATUM_PORT = '13756';
const OTHER_PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_ADDRESS = '0x58A57ed9d8d624cBD12e2C467D34787555bB1b25';
const results = [];
let mainWindow = null;
// Volání do okna nemají vlastní limit. Zaseknutý krok se musí ohlásit, ne držet test donekonečna.
const STEP_MS = 180_000;
const limited = (name, fn) => {
  let timer;
  return Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`krok se zasekl: ${name}`)), STEP_MS); })]).finally(() => clearTimeout(timer));
};
const step = async (name, fn) => {
  try {
    const d = await limited(name, fn);
    results.push([name, true]);
    console.log(`[OK  ] ${name}${d ? `: ${d}` : ''}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
    if (mainWindow) {
      console.log('Stav okna:', JSON.stringify(await mainWindow.evaluate(() => ({ tab: document.querySelector('nav button.active')?.dataset.tab, join: document.getElementById('n-join')?.open, node: document.getElementById('tab-node')?.hidden, url: location.href.slice(-30) })).catch((x) => x.message)));
      if (process.env.AETHER_SHOT) await mainWindow.screenshot({ path: process.env.AETHER_SHOT.replace('.png', '-chyba.png') }).catch(() => {});
    }
    throw e;
  }
};
// Jen procesy tohoto testu: jeho složky dat a jeho port. Uzel otevřené aplikace uživatele běží dál a do výsledku nepatří.
const procs = () => execSync("pgrep -fl 'quintium-node.cjs|quintium-miner --address' || true").toString().split('\n')
  .filter((l) => l && !/\b(zsh|bash|sh)\b/.test(l) && /aether-desktop-|aether-peer-|127\.0\.0\.1:18756\b/.test(l)).join('\n');
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const rpc = async (port, method, params = []) => {
  const r = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};
const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vypršel čas');
};

const userData = mkdtempSync(join(tmpdir(), 'aether-desktop-'));
const shellProfile = join(userData, 'zkusebni-zshrc');   // tlačítko příkazové řádky nesmí sáhnout na skutečný profil
const app = await electron.launch({
  executablePath: electronPath, args: [join(here, '..')],
  env: { ...process.env, AETHER_NO_SEEDS: '1', AETHER_USER_DATA: userData, AETHER_SHELL_PROFILE: shellProfile, AETHER_LAN_PORT: LAN_PORT, AETHER_P2P_PORT: P2P_PORT, AETHER_RPC_PORT: String(RPC_PORT), AETHER_STRATUM_PORT: STRATUM_PORT },
});
const errors = [];
let nodeRestarting = false;
let explorer;
try {
  const win = await app.firstWindow();
  mainWindow = win;
  win.on('pageerror', (e) => errors.push(e.message));
  // Při záměrném restartu uzlu může požadavek chvíli narazit na zavřený port, to chyba aplikace není.
  win.on('console', (m) => { if (m.type() === 'error' && !(nodeRestarting && /net::ERR_CONNECTION_(RESET|REFUSED)/.test(m.text()))) errors.push(m.text()); });
  await win.waitForLoadState('domcontentloaded');

  await step('aplikace se otevře a nabídne vytvoření peněženky', async () => {
    await win.waitForSelector('#imp');
    assert.equal(await win.title(), 'Quinvium');
  });
  await step('uzel se sám spustí', async () => {
    await win.waitForFunction(() => /testnet · block/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    return win.textContent('#status');
  });
  await step('bez peněženky aplikace těžbu nenabídne', async () => {
    await win.click('nav button[data-tab=mining]');
    await win.waitForSelector('#m-need', { state: 'visible' });
    assert.equal(await win.isVisible('#m-start'), false);
    await win.click('#m-wallet');
    await win.waitForSelector('#imp');
  });
  await step('obnova peněženky', async () => {
    await win.click('#imp');
    await win.fill('textarea[name=phrase]', PHRASE);
    await win.click('#app button[type=submit]');
    await win.fill('input[name=p1]', 'heslo-pro-test-123');
    await win.fill('input[name=p2]', 'heslo-pro-test-123');
    await win.click('#app button[type=submit]');
    await win.waitForSelector('#addr');
    assert.equal(await win.getAttribute('#addr', 'title'), ADDRESS);
  });
  await step('aplikace najde grafickou kartu', async () => {
    await win.click('nav button[data-tab=mining]');
    await win.waitForFunction(() => document.querySelectorAll('#m-device option').length > 1, null, { timeout: 20000 });
    return win.$$eval('#m-device option', (o) => o.map((x) => x.textContent).join(', '));
  });
  await step('výplata jde vždy na přihlášenou peněženku a adresa se nedá změnit', async () => {
    await win.waitForFunction((a) => document.getElementById('m-address').textContent === a, ADDRESS);
    await win.click('#m-settings summary');
    assert.equal(await win.locator('input#m-address').count(), 0, 'žádné pole pro jinou adresu');
  });
  await step('těžba na grafické kartě najde blok', async () => {
    await win.click('#m-start');
    await win.waitForFunction(() => Number(document.getElementById('m-blocks').textContent) >= 2, null, { timeout: 120000 });
    await win.waitForFunction(() => /[KMG]?H\/s/i.test(document.getElementById('m-rate').textContent), null, { timeout: 30000 });
    assert.match(await win.textContent('#m-state'), /Mining is running/);
    assert.ok(await win.isVisible('#m-stop') && !(await win.isVisible('#m-start')), 'tlačítko se přepne');
    if (process.env.AETHER_SHOT) await win.screenshot({ path: process.env.AETHER_SHOT });
    return `bloky ${await win.textContent('#m-blocks')}, výkon ${await win.textContent('#m-rate')}`;
  });
  await step('změna výkonu těžaře znovu spustí s novým nastavením', async () => {
    await win.$eval('#m-power', (r) => { r.value = '50'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await until(async () => /--intensity 50/.test(execSync("pgrep -fl quintium-miner || true").toString()), 15000);
    assert.equal(await win.textContent('#m-power-value'), '50 %');
    assert.equal((await win.evaluate(() => window.desktop.state())).miner.power, 50);
    await win.$eval('#m-power', (r) => { r.value = '100'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await until(async () => /--intensity 100/.test(execSync("pgrep -fl quintium-miner || true").toString()), 15000);
  });
  await step('bez poolů je na výběr jen sólo a cizí adresa se jako pool nepřijme', async () => {
    await win.click('nav button[data-tab=mining]');
    await win.click('#m-mode-open');
    await win.waitForFunction(() => document.querySelectorAll('#p-list .choice').length === 1, null, { timeout: 15000 });
    assert.equal(await win.isVisible('#p-open'), false);
    assert.equal(await win.getAttribute('#p-search', 'placeholder'), 'Search pools by name or address');
    await win.fill('#p-search', 'žádný takový pool');
    await win.locator('.choice-empty', { hasText: 'No pool matches the search.' }).waitFor({ timeout: 10000 });
    await win.fill('#p-search', '');
    await win.waitForFunction(() => document.querySelectorAll('#p-list .choice').length === 1, null, { timeout: 10000 });
    assert.ok(await win.isVisible('#p-all'), 'odkaz na všechny pooly v Exploreru');
    await win.evaluate(() => { document.getElementById('p-run').open = true; });
    await win.fill('#s-pool', ADDRESS);
    await win.click('#s-pool-save');
    await win.waitForSelector('#pw-box', { state: 'visible' });
    await win.fill('#pw-input', 'heslo-pro-test-123');
    await win.click('#pw-form button[type=submit]');
    await win.waitForFunction(() => /not a pool/.test(document.getElementById('s-pool-error').textContent), null, { timeout: 15000 });
    assert.equal((await win.evaluate(() => window.desktop.state())).node.runPool, null);
    await win.fill('#s-pool', '');
    await win.click('nav button[data-tab=mining]');
  });
  await step('server poolu: uzel se s nastavením spustí a špatná adresa ho neshodí', async () => {
    const state = () => win.evaluate(() => window.desktop.state());
    await win.evaluate((a) => window.desktop.runPool(a), ADDRESS);
    await until(async () => (await state()).node.log.some((l) => /Pool zatím neběží/.test(l)), 30000);
    assert.equal((await state()).node.running, true);
    assert.deepEqual((await state()).node.runPool, { network: 'testnet', address: ADDRESS });
    await win.evaluate(() => window.desktop.runPool(''));
    await until(async () => { const s = await state(); return s.node.running && s.node.runPool === null && s.node.log.some((l) => /Blok|Uzel|RPC/.test(l)); }, 30000);
    await win.waitForFunction(() => /block \d/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    // Uzel se tu restartuje záměrně, žádosti okna během té chvíle selžou a po návratu pokračují.
    errors.splice(0, errors.length, ...errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e)));
  });
  await step('odměna dorazí do peněženky', async () => {
    await win.click('#m-stop');
    await win.click('nav button[data-tab=wallet]');
    await win.waitForFunction(() => /^[1-9].*tQU/.test(document.getElementById('balance')?.textContent ?? ''), null, { timeout: 20000 });
    return win.textContent('#balance');
  });
  await step('výběr poplatku funguje i v aplikaci', async () => {
    await win.click('#send');
    await win.fill('input[name=to]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await win.fill('input[name=value]', '0.5');
    await win.click('#app button[type=submit]');
    await win.waitForSelector('.fee-option');
    const options = await win.locator('.fee-option').count();
    await win.click('#back');
    await win.waitForSelector('#app button[type=submit]');
    await win.click('#back');
    await win.waitForSelector('#send');
    return `${options} možnosti`;
  });
  await step('aktivita v přehledu: odměny po dnech a detail ve stejném rozvržení', async () => {
    await win.click('nav button[data-tab=wallet]');
    await win.click('[data-view=activity]');
    const rewards = win.locator('.tx-open', { hasText: 'Block rewards' }).first();
    await rewards.waitFor({ timeout: 30000 });
    assert.equal(await win.locator('.act-day').first().textContent(), 'Today');
    assert.match(await rewards.textContent(), /\d+ blocks[\s\S]*\+[\d.,]+ tQU/, 'počet bloků a odměna se znaménkem');
    await rewards.click();
    await win.waitForSelector('#detail .kv');
    assert.ok(await win.isVisible('#h-mining'), 'panel těžby zůstane vedle detailu, stránka neposkočí');
    const [hero, info] = await Promise.all(['#detail .hero', '#detail .hero ~ .card'].map((x) => win.locator(x).first().boundingBox()));
    assert.ok(info.y - (hero.y + hero.height) >= 8, 'karty detailu jsou od sebe, nelepí se');
    assert.match(await win.textContent('#detail'), /Blocks found/);
    await win.click('#back');
    await win.waitForSelector('#balance');
  });
  await step('nový uzel v místní síti aplikaci najde sám a stáhne celý řetězec', async () => {
    // Uzel aplikace běží v Node z Electronu s jinou kryptografickou knihovnou než samostatný uzel.
    const data = mkdtempSync(join(tmpdir(), 'aether-peer-'));
    const peer = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'testnet', '--data-dir', data, '--rpc-port', '8890', '--p2p-port', '30890',
      '--stratum-port', '3890', '--lan', '--lan-port', LAN_PORT], { stdio: 'ignore' });
    try {
      const height = Number(await rpc(RPC_PORT, 'eth_blockNumber'));
      assert.ok(height >= 2, 'aplikace má co předat');
      await until(async () => Number(await rpc(8890, 'eth_blockNumber')) >= height, 30000);
      const tag = `0x${height.toString(16)}`;
      const [mine, theirs] = await Promise.all([rpc(RPC_PORT, 'eth_getBlockByNumber', [tag, false]), rpc(8890, 'eth_getBlockByNumber', [tag, false])]);
      assert.equal(theirs.hash, mine.hash, 'stejný blok');
      assert.equal(theirs.stateRoot, mine.stateRoot, 'stejný stav');
      assert.equal((await rpc(RPC_PORT, 'aether_stats')).peers, 1);
      return `oba uzly na bloku ${height}`;
    } finally {
      peer.kill('SIGKILL');
    }
  });
  const inExplorer = (code) => win.evaluate((c) => document.getElementById('explorer-view').executeJavaScript(c), code);
  await step('Explorer je přímo v aplikaci a rovnou přihlášený peněženkou', async () => {
    const osWindows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await win.click('nav button[data-tab=explorer]');
    await until(async () => /Quinvium Explorer/.test(await inExplorer('document.title')), 20000);
    await until(() => inExplorer("document.getElementById('login-btn').classList.contains('connected')"), 15000);
    assert.equal(await osWindows(), 1, 'nové okno nevzniklo');
    assert.deepEqual(await inExplorer("window.aether.request({ method: 'eth_accounts' })"), [ADDRESS]);
    // Stránka musí mít šířku panelu v okně a tlačítko peněženky musí být vidět.
    const shown = await win.evaluate(() => Math.round(document.getElementById('explorer-view').getBoundingClientRect().width));
    await until(async () => Math.abs((await inExplorer('innerWidth')) - shown) <= 2, 10000);
    assert.ok(await inExplorer('document.documentElement.scrollWidth <= innerWidth'), 'Explorer přesahuje do šířky');
    assert.ok(await inExplorer("document.getElementById('login-btn').getBoundingClientRect().right <= innerWidth"), 'tlačítko peněženky je mimo okno');
    if (process.env.AETHER_SHOT) await win.screenshot({ path: process.env.AETHER_SHOT.replace('.png', '-explorer.png') });
  });
  await step('odmítnutí v peněžence stránka pozná', async () => {
    await inExplorer("window.__sign = window.aether.request({ method: 'personal_sign', params: ['0x48656c6c6f', '" + ADDRESS + "'] }).then(() => 'prošlo', (e) => `${e.code}`); 1");
    await win.waitForSelector('#no');
    assert.ok(await win.isVisible('#tab-wallet'), 'žádost přepne na kartu peněženky');
    assert.ok((await win.textContent('.origin')).includes(`127.0.0.1:${RPC_PORT}`), 'okno ukazuje původ stránky');
    await win.click('#no');
    assert.equal(await inExplorer('window.__sign'), '4001');
    await win.waitForSelector('#tab-explorer', { state: 'visible' });     // po vyřízení zpátky tam, odkud žádost přišla
  });
  await step('podpis a platba z Exploreru', async () => {
    await inExplorer("window.__sign = window.aether.request({ method: 'personal_sign', params: ['0x48656c6c6f', '" + ADDRESS + "'] }); 1");
    await win.waitForSelector('#yes');
    await win.click('#yes');
    assert.match(await inExplorer('window.__sign'), /^0x[0-9a-f]{130}$/);
    await win.waitForSelector('#tab-explorer', { state: 'visible' });     // po vyřízení zpátky tam, odkud žádost přišla

    await inExplorer("window.__pay = window.aether.request({ method: 'eth_sendTransaction', params: [{ to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', value: '0x1' }] }); 1");
    await win.waitForSelector('.fee-option');
    await win.click('#yes');
    assert.match(await inExplorer('window.__pay'), /^0x[0-9a-f]{64}$/);
    await win.waitForSelector('#tab-explorer', { state: 'visible' });     // po vyřízení zpátky tam, odkud žádost přišla
  });
  await step('zamčení peněženky Explorer pozná', async () => {
    await win.click('nav button[data-tab=wallet]');
    await win.click('#lock');
    await until(async () => !(await inExplorer("document.getElementById('login-btn').classList.contains('connected')")), 10000);
    await win.waitForSelector('#app-lock', { state: 'visible' });
    await win.fill('#lock-password', 'spatne-heslo');
    await win.click('#lock-form button[type=submit]');
    await win.waitForFunction(() => /Wrong password/.test(document.getElementById('lock-error').textContent));
    await win.fill('#lock-password', 'heslo-pro-test-123');
    await win.click('#lock-form button[type=submit]');
    await win.waitForSelector('#app-lock', { state: 'hidden' });
    await win.waitForSelector('#addr');
  });
  await step('po nečinnosti se zamkne celá aplikace, těžba běží dál a heslo se dá zadat kdekoli', async () => {
    await win.click('nav button[data-tab=mining]');
    if (await win.isVisible('#m-start')) await win.click('#m-start');
    await win.waitForSelector('#m-stop', { state: 'visible' });
    await win.evaluate(() => call('setAutoLock', { minutes: 0.04 }));
    await win.waitForSelector('#app-lock', { state: 'visible', timeout: 15000 });
    assert.match(procs(), /quintium-miner/, 'těžba se nezastavila');
    await win.fill('#lock-password', 'heslo-pro-test-123');
    await win.click('#lock-form button[type=submit]');
    await win.waitForSelector('#app-lock', { state: 'hidden' });
    await win.evaluate(() => call('setAutoLock', { minutes: 15 }));
    await win.click('#m-stop');
    await win.waitForSelector('#m-start', { state: 'visible' });
    await win.click('nav button[data-tab=wallet]');
    await win.waitForSelector('#addr');
  });
  await step('práce v aplikaci drží peněženku odemčenou a odchod ze záložky ji neschová', async () => {
    await win.evaluate(() => call('setAutoLock', { minutes: 0.08 }));
    const end = Date.now() + 9000;
    while (Date.now() < end) {
      await win.click('nav button[data-tab=node]');
      await new Promise((r) => { setTimeout(r, 400); });
      await win.evaluate(() => call('touch'));
    }
    assert.equal(await win.isVisible('#app-lock'), false, 'činnost uživatele posouvá zámek');
    await win.click('nav button[data-tab=wallet]');
    await win.waitForSelector('#addr');
    await win.evaluate(() => call('setAutoLock', { minutes: 15 }));
  });
  await step('tlačítko v menu zamkne aplikaci hned', async () => {
    await win.click('#side-lock');
    await win.waitForSelector('#app-lock', { state: 'visible' });
    await win.fill('#lock-password', 'heslo-pro-test-123');
    await win.click('#lock-form button[type=submit]');
    await win.waitForSelector('#app-lock', { state: 'hidden' });
  });
  await step('Swap a Bridge jsou v menu aplikace bez postranního panelu Exploreru', async () => {
    await win.click('nav button[data-tab=swap]');
    await until(() => inExplorer("location.pathname.startsWith('/swap') && document.body.classList.contains('solo') && !!document.querySelector('h1')"), 15000);
    assert.equal(await inExplorer("getComputedStyle(document.querySelector('.app-header')).display"), 'none');
    await until(async () => (await inExplorer("getComputedStyle(document.querySelector('.app-main')).marginLeft")) === '0px', 3000);     // po skrytém panelu nezůstane prázdné místo
    assert.equal(await win.evaluate(() => document.querySelector('nav button.active').dataset.tab), 'swap');
    await win.click('nav button[data-tab=bridge]');
    await until(() => inExplorer("location.pathname.startsWith('/bridge') && !!document.querySelector('h1')"), 15000);
    // Záložka Explorer otevře vždy jeho úvod, ne naposledy otevřený most nebo swap.
    await win.click('nav button[data-tab=explorer]');
    await until(() => inExplorer("!document.body.classList.contains('solo') && location.pathname === '/' && !!document.getElementById('home-live')"), 15000);
    assert.equal(await inExplorer("getComputedStyle(document.querySelector('.app-header')).display !== 'none'"), true);
    // Most otevřený během načítání předchozí stránky nesmí ukázat chybu z ní.
    await win.click('nav button[data-tab=swap]');
    await win.click('nav button[data-tab=bridge]');
    await until(() => inExplorer("location.pathname.startsWith('/bridge') && !!document.querySelector('h1')"), 15000);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await inExplorer("document.querySelectorAll('.error-box').length"), 0, 'most bez chybového hlášení');
    await win.click('nav button[data-tab=wallet]');
    await win.click('nav button[data-tab=explorer]');
    await until(() => inExplorer("location.pathname === '/' && !document.body.classList.contains('solo')"), 15000);
  });
  await step('boční panel se sbalí řádkem dole i zkratkou a stav si pamatuje', async () => {
    const width = () => win.evaluate(() => document.querySelector('.side').getBoundingClientRect().width);
    const open = await width();
    await win.click('#side-toggle');
    assert.ok(await width() < open / 2, 'panel je úzký');
    assert.equal(await win.getAttribute('#side-toggle', 'aria-expanded'), 'false');
    assert.equal(await win.isVisible('#side-key'), false);
    assert.ok(await win.isVisible('#side-toggle svg'), 'zůstane ikona pro rozbalení');
    assert.equal(await win.evaluate(() => localStorage.getItem('aether.side')), 'closed');
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
    assert.equal(await width(), open);
    assert.equal(await win.isVisible('#side-toggle-text'), true);
  });
  await step('přehled peněženky vede rovnou na Swap a most', async () => {
    await win.click('nav button[data-tab=wallet]');
    await win.click('#go-swap');
    await until(() => inExplorer("location.pathname.startsWith('/swap') && document.body.classList.contains('solo')"), 15000);
    await win.click('nav button[data-tab=wallet]');
    await win.click('#go-bridge');
    await until(() => inExplorer("location.pathname.startsWith('/bridge')"), 15000);
    await win.click('nav button[data-tab=wallet]');
  });
  await step('nastavení: jazyk, verze a aktualizace', async () => {
    await win.click('nav button[data-tab=settings]');
    await win.selectOption('#s-lang', 'cs');
    await win.waitForFunction(() => /Přehled/.test(document.querySelector('nav button[data-tab=wallet]').textContent));
    assert.match(await win.textContent('#version'), /Verze \d+\.\d+\.\d+/);
    await win.selectOption('#s-lang', 'en');
    await win.waitForFunction(() => /Overview/.test(document.querySelector('nav button[data-tab=wallet]').textContent));
    await win.click('#s-check');
    await win.waitForFunction(() => /managed by the publisher/.test(document.getElementById('s-update').textContent));
    // Příkaz quintium: spouštěč ve stálé složce dat spustí příkazovou řádku této verze, tlačítko přidá cestu jednou.
    await win.waitForSelector('#s-cli:not([hidden])');
    assert.ok((await win.textContent('#s-cli-line')).includes(join(userData, 'bin')), 'ruční řádek ukazuje na spouštěč v datech aplikace');
    if (process.platform !== 'win32') {
      const version = execFileSync(join(userData, 'bin', 'quintium'), ['--version'], { encoding: 'utf8', env: { ...process.env, QUINTIUM_LANG: 'en' } }).trim();
      assert.equal(version, JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version);
      await win.click('#s-cli-install');
      await win.waitForFunction(() => /Done/.test(document.getElementById('s-cli-state').textContent));
      assert.ok(readFileSync(shellProfile, 'utf8').includes(join(userData, 'bin')));
      await win.click('#s-cli-install');
      await win.waitForFunction(() => /already set up/.test(document.getElementById('s-cli-state').textContent));
      assert.equal(readFileSync(shellProfile, 'utf8').split('export PATH=').length, 2, 'cesta v profilu jen jednou');
    }
    await win.click('nav button[data-tab=settings]');
    await win.click('#s-about');
    await win.waitForFunction(() => /52402/.test(document.getElementById('a-facts').textContent));
    await win.click('nav button[data-tab=wallet]');
    await win.waitForSelector('#addr');
  });
  await step('odhlášení, import jiné peněženky a nová adresa výplaty', async () => {
    await win.click('#settings');
    await win.waitForSelector('#logout');
    await win.click('#logout');
    await win.fill('input[name=confirm]', 'DELETE');
    await win.click('#app button[type=submit]');
    await win.waitForSelector('#imp');
    await win.click('#imp');
    await win.fill('textarea[name=phrase]', OTHER_PHRASE);
    await win.click('#app button[type=submit]');
    await win.fill('input[name=p1]', 'heslo-pro-test-123');
    await win.fill('input[name=p2]', 'heslo-pro-test-123');
    await win.click('#app button[type=submit]');
    await win.waitForSelector('#addr');
    assert.equal(await win.getAttribute('#addr', 'title'), OTHER_ADDRESS);
    assert.match(await win.$eval('#net', (s) => s.options[s.selectedIndex].text), /Testnet/, 'síť zůstává');
    await win.click('nav button[data-tab=mining]');
    await win.waitForFunction((a) => document.getElementById('m-address').textContent === a, OTHER_ADDRESS);
    await win.click('nav button[data-tab=wallet]');
  });
  await step('přepnutí účtu převede běžící těžbu na nový účet', async () => {
    await win.click('nav button[data-tab=mining]');
    await win.click('#m-start');
    await win.waitForSelector('#m-stop', { state: 'visible' });
    await until(async () => procs().includes(OTHER_ADDRESS), 15000);
    await win.evaluate(async () => { await call('addAccount'); await call('selectAccount', { index: 1 }); });
    const second = await win.evaluate(() => call('address'));
    await until(async () => procs().includes(second), 30000);
    await win.waitForFunction((a) => document.getElementById('m-address').textContent === a, second);
    await win.evaluate(() => call('selectAccount', { index: 0 }));
    await until(async () => procs().includes(OTHER_ADDRESS), 30000);
    await win.click('#m-stop');
    await win.waitForSelector('#m-start', { state: 'visible' });
    await win.click('nav button[data-tab=wallet]');
  });
  await step('nový blok nezavře rozepsaný převod', async () => {
    await win.click('nav button[data-tab=mining]');
    await win.click('#m-start');
    await win.waitForSelector('#m-stop', { state: 'visible' });
    await win.click('nav button[data-tab=wallet]');
    await win.click('#send');
    await win.fill('input[name=value]', '0.5');
    const seen = await win.evaluate(() => Number(document.getElementById('h-height').textContent.replace(/\D/g, '')));
    await win.waitForFunction((n) => Number(document.getElementById('h-height').textContent.replace(/\D/g, '')) > n, seen, { timeout: 150000 });
    await win.waitForTimeout(500);
    assert.equal(await win.inputValue('input[name=value]'), '0.5', 'rozepsaná částka zůstala');
    await win.click('#back');
    await win.waitForSelector('#send');
    await win.click('#h-stop');
    await win.waitForSelector('#h-start', { state: 'visible' });
  });
  await step('spojení s jiným počítačem podle zadané adresy', async () => {
    const data = mkdtempSync(join(tmpdir(), 'aether-peer-'));
    const peer = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'testnet', '--data-dir', data, '--rpc-port', '8890', '--p2p-port', '30890',
      '--stratum-port', '3890'], { stdio: 'ignore' });
    try {
      await until(() => rpc(8890, 'eth_blockNumber'), 15000);
      await win.click('nav button[data-tab=node]');
      await win.click('#n-join summary');
      await win.waitForSelector('#n-seed', { state: 'visible' });
      await win.fill('#n-seed', 'nesmysl; rm');
      await win.click('#n-seed-save');
      await win.waitForFunction(() => /Enter the computer address/.test(document.getElementById('n-seed-error').textContent));
      await win.fill('#n-seed', '127.0.0.1:30890');
      nodeRestarting = true;
      await win.click('#n-seed-save');
      await until(async () => (await rpc(RPC_PORT, 'aether_stats')).peers === 1, 30000);
      nodeRestarting = false;
      const height = Number(await rpc(RPC_PORT, 'eth_blockNumber'));
      await until(async () => Number(await rpc(8890, 'eth_blockNumber')) >= height, 30000);
      assert.equal((await rpc(8890, 'aether_stats')).peers, 1, 'odchozí spojení z aplikace');
      peer.kill('SIGKILL');
      await win.fill('#n-seed', '');
      nodeRestarting = true;   // uložení adresy uzel záměrně restartuje
      await win.click('#n-seed-save');
      await until(() => rpc(RPC_PORT, 'eth_blockNumber'), 15000);
      nodeRestarting = false;
      assert.equal((await win.evaluate(() => window.desktop.state())).node.seed, '', 'adresa je smazaná');
      await win.click('nav button[data-tab=wallet]');
      return `oba uzly na bloku ${height}`;
    } finally {
      peer.kill('SIGKILL');
    }
  });
  await step('Explorer jde otevřít z jiného počítače, jen když to uživatel zapne', async () => {
    const lan = Object.values(networkInterfaces()).flat().find((a) => a.family === 'IPv4' && !a.internal)?.address;
    assert.ok(lan, 'počítač je v síti');
    const page = () => fetch(`http://${lan}:${RPC_PORT}/`, { signal: AbortSignal.timeout(2000) }).then((r) => r.status, () => 'nedostupné');
    assert.equal(await page(), 'nedostupné', 've výchozím stavu jen pro tento počítač');
    await win.click('nav button[data-tab=node]');
    await win.selectOption('#n-access', 'lan');
    nodeRestarting = true;   // sdílení mění adresu RPC, uzel se proto restartuje
    await win.click('#n-seed-save');
    await until(async () => (await page()) === 200, 30000);
    await win.waitForFunction(([a, port]) => document.getElementById('n-share-url').textContent.includes(`http://${a}:${port}`), [lan, RPC_PORT]);
    // Peněženka v telefonu potřebuje adresu RPC v místní síti, ne 127.0.0.1.
    await win.waitForFunction(([a, port]) => document.getElementById('n-endpoints').textContent.includes(`http://${a}:${port}`), [lan, RPC_PORT], { timeout: 15000 });
    assert.ok(Number(await rpc(RPC_PORT, 'eth_blockNumber')) >= 0, 'Aplikace dál vidí svůj uzel');
    await win.selectOption('#n-access', 'off');
    await win.click('#n-seed-save');
    await until(async () => (await page()) === 'nedostupné' && Number(await rpc(RPC_PORT, 'eth_blockNumber')) >= 0, 30000);
    nodeRestarting = false;
  });
  await step('uzel, stránka Uzel a logy', async () => {
    await win.click('nav button[data-tab=node]');
    assert.notEqual(await win.textContent('#n-height'), '—');
    assert.match(await win.textContent('#n-log'), /quintium-node/);
  });
  await step('bez chyb v aplikaci', async () => assert.deepEqual(errors, []));
} finally {
  await app.close().catch(() => {});
}
await new Promise((r) => setTimeout(r, 2500));
await step('po zavření nezůstaly běžet žádné procesy', async () => assert.equal(procs(), ''));
const ok = results.filter((r) => r[1]).length;
console.log(`\nSOUHRN: ${ok}/${results.length} prošlo`);
process.exit(ok === results.length ? 0 : 1);
