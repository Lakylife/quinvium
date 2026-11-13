// Všechny aplikace v exploreru: skutečný Chromium proti skutečnému uzlu.
// Peněženka je tu nahrazená testovací, sama peněženka má vlastní test v packages/extension/test/e2e.mjs.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'node', 'package.json'));
const { ethers } = require('ethers');
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PORT = 8747;
const RPC = `http://127.0.0.1:${PORT}`;

const [miner, buyer, seller, arbiter] = [
  'test test test test test test test test test test test junk',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
].map((m) => ethers.Wallet.fromPhrase(m));

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, pollingInterval: 200 });
let current = miner;
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
const until = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('vypršel čas');
};

const data = mkdtempSync(join(tmpdir(), 'aether-explorer-'));
const node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', data, '--dev-mine', '--miner-address', miner.address,
  '--rpc-port', String(PORT), '--p2p-port', String(PORT + 1), '--stratum-port', String(PORT + 2)], { stdio: 'ignore' });
let browser;

try {
  await until(async () => (await provider.getBalance(miner.address)) >= 32n * 10n ** 18n, 120000);

  // Peníze pro ostatní účastníky od minera.
  let nonce = await provider.getTransactionCount(miner.address);
  const funding = [];
  for (const w of [buyer, seller, arbiter]) {
    funding.push(await miner.connect(provider).sendTransaction({ to: w.address, value: ethers.parseEther('8'), nonce: nonce++ }));
  }
  await Promise.all(funding.map((t) => t.wait()));

  browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'cs-CZ' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Testovací peněženka: chyby předává stránce se stejnými poli jako skutečná, včetně kódu chyby kontraktu.
  const forward = async (method, params) => {
    const r = await fetch(RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
    return r.json();
  };
  await page.exposeFunction('__wallet', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return { result: [current.address] };
      case 'eth_chainId': return { result: '0xccb3' };
      case 'wallet_addEthereumChain': case 'wallet_switchEthereumChain': return { result: null };
      case 'eth_sendTransaction': {
        const t = params[0];
        try {
          const r = await current.connect(provider).sendTransaction({ to: t.to, data: t.data, value: t.value ?? 0n, gasLimit: t.gas });
          return { result: r.hash };
        } catch (e) {
          return { error: { code: 3, message: e.shortMessage ?? e.message, data: e.data } };
        }
      }
      default: return forward(method, params);
    }
  });
  await page.addInitScript(() => {
    const request = async ({ method, params }) => {
      const r = await window.__wallet(method, params);
      if (r.error) throw Object.assign(new Error(r.error.message), r.error);
      return r.result;
    };
    window.ethereum = { request, on() {}, removeListener() {} };
  });

  await page.addInitScript(() => { try { localStorage.setItem('aether.lang', 'cs'); localStorage.setItem('aether.wallet', 'injected'); } catch { /* jen pro test */ } });
  await page.goto(`${RPC}/#/apps`);
  await page.waitForSelector('.tool-card');
  await page.$$eval('.tool-card', (cards) => cards.forEach((c) => { c.open = true; }));

  const card = (title) => page.locator('.tool-card', { has: page.locator(`h2:text-is("${title}")`) });
  const output = (c) => c.locator('.tool-output');
  const clear = (c) => output(c).evaluate((n) => { n.className = 'tool-output'; n.textContent = ''; });
  const value = (c, name) => c.locator(`input[name="${name}"]`).inputValue();
  /** Zvolí úkol aplikace, vyplní jeho pole, spustí ho a počká na konečný výsledek. */
  const act = async (c, task, values = {}, expected = 'good') => {
    await clear(c);
    await c.locator(`[data-task="${task}"]`).click();
    for (const [k, v] of Object.entries(values)) await c.locator(`input[name="${k}"]`).fill(String(v));
    await c.locator('[data-run]').click();
    await until(async () => (await output(c).getAttribute('class')).includes(expected), 120000).catch(async () => {
      throw new Error(`${task}: místo výsledku „${expected}“ stránka ukazuje: ${await output(c).textContent()}`);
    });
    return output(c).textContent();
  };
  const fails = async (c, task, values, text) => assert.match(await act(c, task, values, 'bad'), text);
  const read = async (c, values = {}) => {
    await clear(c);
    await c.locator('[data-task="read"]').click();
    for (const [k, v] of Object.entries(values)) await c.locator(`input[name="${k}"]`).fill(String(v));
    await c.locator('[data-run]').click();
    await until(async () => (await output(c).textContent()).length > 0);
    return output(c).textContent();
  };

  await step('Notář: zápis, ověření, ochrana proti opakování, odvolání', async () => {
    current = buyer;
    const c = card('Notář');
    assert.equal(await c.locator('[data-task].active').textContent(), 'Zapsat', 'první úkol je zápis');
    assert.equal(await c.locator('input[name=author]').isVisible(), false, 'úkol ukáže jen svá pole');
    await fails(c, 'write', {}, /Vyplňte pole: Dokument/);
    assert.match(await act(c, 'write', { hash: 'Kupní smlouva 2026', note: 'Originál' }), /Potvrzeno v bloku/);
    assert.equal(await value(c, 'author'), buyer.address, 'adresa zápisu je doplněná pro ověření');
    const shown = await read(c);
    assert.match(shown, /Platné/);
    assert.match(shown, /Originál/);
    assert.doesNotMatch(shown, /[{}"]/, 'výsledek je čitelný, ne surová data');
    await fails(c, 'write', {}, /už máte zapsaný/);
    await act(c, 'revoke', { reason: 'nahrazeno' });
    assert.match(await read(c), /Odvoláno/);
  });

  await step('Certifikáty: registrace, vydání, ověření podle vydavatele, odvolání', async () => {
    current = arbiter;
    const c = card('Certifikáty');
    await fails(c, 'write', { id: 'DIPLOM-2026-1', subject: buyer.address, schema: 'Bakalář' }, /zaregistrujte jako vydavatel/);
    await act(c, 'register', { name: 'Vysoká škola', website: 'skola.example' });
    assert.equal(await value(c, 'issuer'), arbiter.address, 'adresa vydavatele je doplněná pro ověření');
    await act(c, 'write');
    const ok = await read(c);
    assert.match(ok, /Platný/);
    assert.match(ok, /Vysoká škola/);
    assert.match(ok, new RegExp(buyer.address));
    assert.match(await read(c, { issuer: seller.address }), /nevydal/);
    await act(c, 'revoke', { reason: 'chyba' });
    assert.match(await read(c, { issuer: arbiter.address }), /Odvolaný/);
  });

  await step('Dodavatelský řetězec: nová položka, krok, předání dvěma stranami, uzavření', async () => {
    current = seller;
    const c = card('Dodavatelský řetězec');
    const done = await act(c, 'write', { sku: 'KAVA-001' });
    const id = await value(c, 'id');
    assert.ok(Number(id) > 0 && done.includes(id), `číslo nové položky je vidět a doplněné (${id})`);
    await act(c, 'step', { location: 'Sklad Brno', status: 'expedováno' });
    await act(c, 'offer', { to: buyer.address });
    current = buyer;
    await fails(c, 'step', {}, /nedržíte/);
    await act(c, 'accept');
    await act(c, 'close');
    const shown = await read(c);
    assert.match(shown, /Sklad Brno/);
    assert.match(shown, new RegExp(buyer.address));
    assert.match(shown, /Uzavřená/);
  });

  await step('Úschova: založení, uvolnění a výběr prodávajícím', async () => {
    current = buyer;
    const c = card('Úschova plateb');
    await act(c, 'write', { seller: seller.address, arbiter: arbiter.address, amount: '0,5', days: 14 });
    assert.ok(Number(await value(c, 'id')) > 0, 'číslo obchodu je doplněné');
    assert.match(await read(c), /Zaplaceno, čeká na plnění/);
    current = seller;
    await fails(c, 'release', {}, /jiná strana/);
    current = buyer;
    await act(c, 'release');
    current = seller;
    const before = await provider.getBalance(seller.address);
    await act(c, 'withdraw');
    assert.ok((await provider.getBalance(seller.address)) > before);
    await fails(c, 'withdraw', {}, /Nemáte co vybrat/);
  });

  await step('Úschova: spor, rozhodnutí rozhodce, ochrana lhůty bez rozhodce', async () => {
    current = buyer;
    const c = card('Úschova plateb');
    const first = Number(await value(c, 'id'));
    await act(c, 'write');
    assert.equal(Number(await value(c, 'id')), first + 1, 'nový obchod má další číslo');
    await act(c, 'dispute');
    assert.match(await read(c), /Spor/);
    await fails(c, 'abandon', {}, /brzy/);
    current = arbiter;
    await act(c, 'resolve', { pct: 70 });
    assert.match(await read(c), /Uzavřeno/);
    await act(c, 'withdraw');
    current = buyer;
    await act(c, 'withdraw');
  });

  await step('Hlasování: založení, hlas, výsledek, dvojí hlas je odmítnut', async () => {
    current = buyer;
    const c = card('Hlasování');
    await act(c, 'write', { title: 'Nový park?', choices: 'Ano, Ne', days: 7 });
    assert.ok(Number(await value(c, 'id')) > 0, 'číslo hlasování je doplněné');
    await fails(c, 'vote', { option: 0 }, /od 1/);
    await act(c, 'vote', { option: 1 });
    await fails(c, 'vote', {}, /Už jste hlasovali/);
    const shown = await read(c);
    assert.match(shown, /1\. Ano: 1/);
    assert.match(shown, /2\. Ne: 0/);
    assert.match(shown, /Probíhá/);
  });

  await step('Jména: registrace ve dvou krocích, obsazené jméno, změna cíle a prodloužení', async () => {
    current = buyer;
    const c = card('Jména adres');
    assert.match(await read(c, { name: 'novak-brno' }), /Volné/);
    assert.match(await act(c, 'write'), /novak-brno/);
    assert.match(await read(c), new RegExp(buyer.address));
    await fails(c, 'write', {}, /obsazené/);
    await act(c, 'primary');
    await act(c, 'renew');
    await act(c, 'target', { target: seller.address });
    await act(c, 'transfer', { to: arbiter.address });
    assert.match(await read(c), new RegExp(arbiter.address));
  });

  await step('Vlastní token: vytvoření a převod', async () => {
    current = buyer;
    const c = card('Vlastní token');
    const done = await act(c, 'write', { name: 'Body Brno', symbol: 'BDY', supply: '1 000' });
    const token = await value(c, 'token');
    assert.ok(ethers.isAddress(token) && done.includes(token), 'adresa nového tokenu je vidět a doplněná');
    const shown = await read(c);
    assert.match(shown, /Body Brno/);
    assert.match(shown, /1\s000/);
    await act(c, 'transfer', { to: seller.address, amount: '25' });
    const t = new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], provider);
    assert.equal(await t.balanceOf(seller.address), ethers.parseEther('25'));
  });

  await step('Sbírka NFT: vytvoření a ražba', async () => {
    current = buyer;
    const c = card('Sbírka NFT');
    await act(c, 'write', { name: 'Vstupenky', symbol: 'VST' });
    assert.ok(ethers.isAddress(await value(c, 'collection')), 'adresa sbírky je doplněná');
    await act(c, 'mint', { to: seller.address, uri: 'ipfs://vstupenka/1' });
    assert.equal(await value(c, 'id'), '1', 'číslo vyražené položky je doplněné');
    const shown = await read(c);
    assert.match(shown, new RegExp(seller.address));
    assert.match(shown, /ipfs:\/\/vstupenka\/1/);
    current = seller;
    await fails(c, 'mint', {}, /jen tvůrce/);
  });

  await step('Více podpisů: založení, návrh, schválení dvěma, provedení platby', async () => {
    current = buyer;
    const c = card('Peněženka s více podpisy');
    await act(c, 'write', { owners: `${buyer.address}, ${seller.address}`, threshold: 2 });
    const wallet = await value(c, 'wallet');
    assert.ok(ethers.isAddress(wallet), 'adresa peněženky je doplněná');
    await (await buyer.connect(provider).sendTransaction({ to: wallet, value: ethers.parseEther('0.2') })).wait();
    const payee = ethers.Wallet.createRandom().address;
    await act(c, 'submit', { to: payee, amount: '0,1' });
    assert.equal(await value(c, 'id'), '0', 'číslo návrhu je doplněné');
    await fails(c, 'execute', {}, /Chybí schválení/);
    current = seller;
    await act(c, 'confirm');
    assert.match(await read(c), /Schválení\s*2 \/ 2/);
    await act(c, 'execute');
    assert.equal(await provider.getBalance(payee), ethers.parseEther('0.1'));
    assert.match(await read(c), /Provedeno/);
  });

  await step('Aplikace v angličtině: popisky, úkoly i výsledek bez českých slov', async () => {
    // Přepnutí jazyka v menu stránku překreslí na místě. Načtení stránky by vrátilo češtinu z přípravy testu.
    await page.click('#lang-btn');
    await page.click('[data-lang=en]');
    const c = card('Notary');
    await c.waitFor();
    await c.evaluate((d) => { d.open = true; });
    assert.deepEqual(await c.locator('[data-task]').allTextContents(), ['Record', 'Verify', 'Revoke']);
    const shown = await read(c, { hash: 'Kupní smlouva 2026', author: buyer.address });
    assert.match(shown, /Status\s*Revoked/);
    assert.match(shown, /Recorded by/);
    // Výsledek ukazuje i zapsanou poznámku uživatele, proto se kontrolují jen popisky, úkoly a nápověda.
    const labels = (await c.locator('summary, .tool-tasks, .tool-hint, form').allInnerTexts()).join(' ');
    assert.doesNotMatch(labels, /[ěščřžýáíéůú]/i, `v anglické kartě nejsou česká slova: ${labels}`);
  });

  await step('Stránka nehlásí žádnou chybu JavaScriptu', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser?.close();
  node.kill('SIGKILL');
  provider.destroy();
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nVýsledek: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
