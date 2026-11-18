// A real Chromium browser with the real extension against a real node.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..');
const nodeCli = join(here, '..', '..', 'node', 'src', 'cli.js');
const PHRASE = 'test test test test test test test test test test test junk';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTHER_PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OTHER_ADDRESS = '0x58A57ed9d8d624cBD12e2C467D34787555bB1b25';
const PASSWORD = 'heslo-pro-test-123';
const RPC = 'http://127.0.0.1:8547';
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push([name, true]);
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`);
    // What was visible in the wallet window, so a failure can be understood without repeating it.
    const seen = await globalThis.failPage?.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)).catch(() => null);
    if (seen) console.log(`       v okně: ${seen}`);
    throw e;
  }
};
const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
};
const until = async (fn, ms = 40000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vypršel čas');
};

const data = mkdtempSync(join(tmpdir(), 'aether-e2e-'));
let node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', join(data, 'node'), '--dev-mine', '--miner-address', ADDRESS], { stdio: 'ignore' });
let context;

try {
  await until(() => rpc('eth_blockNumber').catch(() => null));
  await until(async () => BigInt((await rpc('eth_getBalance', [ADDRESS, 'latest'])) ?? 0) > 0n, 60000);

  context = await chromium.launchPersistentContext(join(data, 'profile'), {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  // On a busy computer the wait can be extended, for example E2E_TIMEOUT=120000. Otherwise the default of 30 s applies.
  context.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 30000);
  // Waiting for a block to be mined: on a busy computer at least as long as the other steps.
  var slow = (ms) => Math.max(ms, Number(process.env.E2E_TIMEOUT) || 0);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const pageErrors = [];
  const popup = await context.newPage();
  globalThis.failPage = popup;
  popup.on('pageerror', (e) => pageErrors.push(e.message));
  const open = () => popup.goto(`chrome-extension://${id}/popup.html`);
  await open();
  await popup.evaluate(() => localStorage.setItem('aether.lang', 'cs'));
  await open();

  await step('restoring the wallet from the phrase and setting a password', async () => {
    await popup.click('#imp');
    await popup.fill('textarea[name=phrase]', PHRASE);
    await popup.click('button[type=submit]');
    // A generated password: 20 characters, the same in both fields, shown; the eye hides it again.
    await popup.click('#pw-generate');
    const generated = await popup.inputValue('input[name=p1]');
    assert.equal(generated.length, 20);
    assert.equal(await popup.inputValue('input[name=p2]'), generated);
    assert.equal(await popup.getAttribute('input[name=p1]', 'type'), 'text');
    assert.ok(await popup.isVisible('#pw-copy'));
    await popup.click('.pw-eye');
    assert.equal(await popup.getAttribute('input[name=p1]', 'type'), 'password');
    await popup.click('#pw-generate');
    assert.notEqual(await popup.inputValue('input[name=p1]'), generated, 'a new password each time');
    await popup.fill('input[name=p1]', 'kratke');
    await popup.fill('input[name=p2]', 'kratke');
    await popup.click('button[type=submit]');
    assert.ok(await popup.locator('input[name=p1]').count(), 'krátké heslo neprošlo');
    await popup.fill('input[name=p1]', PASSWORD);
    await popup.fill('input[name=p2]', PASSWORD);
    await popup.click('button[type=submit]');
    await popup.waitForSelector('#addr');
    assert.equal((await popup.getAttribute('#addr', 'title')).trim(), ADDRESS);
  });

  await step('the phrase is not readable in storage', async () => {
    const stored = await popup.evaluate(() => chrome.storage.local.get(null));
    assert.ok(stored.vault?.data, 'trezor existuje');
    assert.ok(!JSON.stringify(stored).includes('test test'), 'fráze není čitelně');
    assert.equal(stored.vault.iterations, 600000);
  });

  await step('switching to the dev network and showing the balance', async () => {
    await popup.selectOption('#net', '52403');
    await popup.waitForFunction(() => /dQU/.test(document.querySelector('#balance')?.textContent ?? ''));
    assert.match(await popup.textContent('#balance'), /^[1-9]/);
  });

  const receiver = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  await step('a payment from the wallet reaches the recipient', async () => {
    await popup.click('#send');
    await popup.fill('input[name=to]', 'neplatna-adresa');
    await popup.fill('input[name=value]', '1');
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /Neplatná adresa/.test(document.querySelector('.err')?.textContent ?? ''));
    await popup.fill('input[name=to]', receiver);
    await popup.fill('input[name=value]', '1,5');
    await popup.click('button[type=submit]');
    await popup.waitForSelector('#confirm');
    assert.match(await popup.textContent('.hero .balance'), /1,5/);
    await popup.click('#confirm');
    await popup.waitForSelector('#finish');
    assert.match(await popup.textContent('h1'), /odeslána/);
    await popup.click('#finish');
    await until(async () => BigInt(await rpc('eth_getBalance', [receiver, 'latest'])) === 1500000000000000000n);
  });
  /** Opens the payment review with fee selection. */
  const review = async (to, value) => {
    await popup.waitForSelector('#send');
    await popup.click('#send');
    await popup.fill('input[name=to]', to);
    await popup.fill('input[name=value]', value);
    await popup.click('button[type=submit]');
    await popup.waitForSelector('.fee-option');
  };

  const tipOf = async (i = 0) => {
    const { activity } = await popup.evaluate(() => chrome.storage.local.get('activity'));
    const tx = await rpc('eth_getTransactionByHash', [activity[i].hash]);
    // The node may already have the replacement while the wallet has not recorded it yet. That is a short transition, not an error.
    return tx ? { tip: BigInt(tx.maxPriorityFeePerGas), max: BigInt(tx.maxFeePerGas), hash: activity[i].hash } : { tip: 0n, max: 0n, hash: activity[i].hash };
  };
  const gwei = 1_000_000_000n;
  const payWith = async (choose) => {
    await popup.waitForSelector('#send');
    const before = BigInt(await rpc('eth_getBalance', [receiver, 'latest']));
    await review(receiver, '0,01');
    await choose();
    await popup.click('#confirm');
    await popup.waitForSelector('#finish');
    await popup.click('#finish');
    await until(async () => BigInt(await rpc('eth_getBalance', [receiver, 'latest'])) > before);
  };

  await step('fee choice: fast, slow and custom gwei are really written into the transaction', async () => {
    await review(receiver, '0,01');
    const text = await popup.textContent('.fee-options');
    assert.match(text, /Pomalu/); assert.match(text, /Běžně/); assert.match(text, /Rychle/); assert.match(text, /Vlastní/);
    assert.match(text, /asi \d+/, 'okno ukazuje odhad čekání');
    if (process.env.AETHER_SHOT) {
      await popup.click('[data-tier=custom]');
      await popup.setViewportSize({ width: 360, height: 640 });
      await popup.screenshot({ path: process.env.AETHER_SHOT });
    }
    await popup.click('#back');
    await popup.waitForSelector('button[type=submit]');
    await popup.click('#back');

    await payWith(() => popup.click('[data-tier=fast]'));
    assert.equal((await tipOf()).tip, 2n * gwei);
    await payWith(() => popup.click('[data-tier=slow]'));
    assert.equal((await tipOf()).tip, gwei / 10n);
    await payWith(async () => {
      await popup.click('[data-tier=custom]');
      await popup.fill('input[name=feeMax]', '9');
      await popup.fill('input[name=feeTip]', '3,5');
    });
    const custom = await tipOf();
    assert.equal(custom.tip, 3500000000n);
    assert.equal(custom.max, 9n * gwei);
  });

  await step('a nonsensical custom fee is not sent', async () => {
    await popup.waitForSelector('#send');
    const nonce = await rpc('eth_getTransactionCount', [ADDRESS, 'pending']);
    await review(receiver, '0,01');
    await popup.click('[data-tier=custom]');
    await popup.fill('input[name=feeMax]', '1');
    await popup.fill('input[name=feeTip]', '5');
    assert.match(await popup.textContent('.fee-note'), /vyšší než maximální/);
    await popup.click('#confirm');
    await popup.waitForFunction(() => /vyšší než maximální/.test(document.querySelector('.err')?.textContent ?? ''));
    await popup.fill('input[name=feeTip]', 'abc');
    await popup.click('#confirm');
    await popup.waitForFunction(() => /v gwei/.test(document.querySelector('.err')?.textContent ?? ''));
    assert.equal(await rpc('eth_getTransactionCount', [ADDRESS, 'pending']), nonce);
    await popup.click('#back');
    await popup.waitForSelector('button[type=submit]');
    await popup.click('#back');
  });

  const explorer = await context.newPage();
  explorer.on('pageerror', (e) => pageErrors.push(e.message));
  await explorer.addInitScript((id) => { try { localStorage.setItem('aether.lang', 'cs'); localStorage.setItem('aether.wallet', id); } catch { /* jen pro test */ } }, 'org.aether.wallet');
  await explorer.goto(`${RPC}/#/apps`);
  await explorer.waitForSelector('.tool-card');
  const approve = async (trigger, button) => {
    const [win] = await Promise.all([context.waitForEvent('page', { predicate: (p) => p.url().includes('approval=') }), trigger()]);
    await win.waitForSelector('#yes');
    const text = await win.textContent('body');
    await win.click(button);
    return text;
  };

  await step('a page without permission does not see the account', async () => {
    assert.deepEqual(await explorer.evaluate(() => window.aether.request({ method: 'eth_accounts' })), []);
    await assert.rejects(explorer.evaluate(() => window.aether.request({ method: 'eth_sendTransaction', params: [{ to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', value: '0x1' }] })));
    await assert.rejects(explorer.evaluate(() => window.aether.request({ method: 'eth_sign', params: [] })));
    await assert.rejects(explorer.evaluate(() => window.aether.request({ method: 'personal_sign', params: ['0x1234', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'] })));
  });

  await step('the page does not get a rejected connection', async () => {
    await approve(() => explorer.click('#login-btn'), '#no');
    await explorer.waitForSelector('#wallet-dialog[data-step="rejected"]');
    assert.deepEqual(await explorer.evaluate(() => window.aether.request({ method: 'eth_accounts' })), []);
  });

  await step('Explorer connection after approval', async () => {
    const text = await approve(() => explorer.click('[data-wallet-retry]'), '#yes');
    assert.match(text, /127\.0\.0\.1:8547/, 'okno ukazuje původ stránky');
    await explorer.waitForFunction(() => document.querySelector('#login-btn').classList.contains('connected'));
    assert.deepEqual(await explorer.evaluate(() => window.aether.request({ method: 'eth_accounts' })), [ADDRESS]);
  });

  const card = explorer.locator('.tool-card').first();
  await card.locator('summary').click();
  // Notary: the Record task comes first, Verify shows the result. The button runs the chosen task.
  const write = async () => { await card.locator('[data-task=write]').click(); await card.locator('[data-run]').click(); };
  await step('a notary record through the Explorer with a signature in its own window', async () => {
    await card.locator('input[name=hash]').fill('moje-smlouva-e2e');
    await card.locator('input[name=note]').fill('Test');
    const text = await approve(write, '#yes');
    assert.match(text, /Volání kontraktu/);
    await explorer.waitForFunction(() => /Potvrzeno v bloku/.test(document.querySelector('.tool-output')?.textContent ?? ''), null, { timeout: slow(40000) });
    await card.locator('[data-task=read]').click();
    await card.locator('[data-run]').click();
    await explorer.waitForFunction(() => /Platné/.test(document.querySelector('.tool-output')?.textContent ?? ''));
  });

  await step('a contract error arrives through the wallet as an understandable sentence', async () => {
    await card.locator('input[name=hash]').fill('moje-smlouva-e2e');
    await write();
    await explorer.waitForFunction(() => /už máte zapsaný/.test(document.querySelector('.tool-output')?.textContent ?? ''), null, { timeout: slow(20000) });
  });

  await step('a page cannot flood the user with request windows', async () => {
    const outcome = await explorer.evaluate(async () => {
      const ask = () => window.aether.request({ method: 'personal_sign', params: ['0x48656c6c6f', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'] }).then(() => 'podepsáno', (e) => e.message);
      window.__asks = [ask(), ask(), ask()];
      return ask();
    });
    assert.match(outcome, /Too many/);
    await until(() => context.pages().filter((p) => p.url().includes('approval=')).length === 3);
    for (const win of context.pages().filter((p) => p.url().includes('approval='))) {
      await win.waitForSelector('#no');
      await win.click('#no');
    }
    await explorer.evaluate(() => Promise.all(window.__asks));
  });

  await step('the fee can be changed in the approval window and the transaction uses it', async () => {
    await card.locator('input[name=hash]').fill('smlouva-rychly-poplatek');
    const [win] = await Promise.all([context.waitForEvent('page', { predicate: (p) => p.url().includes('approval=') }), write()]);
    await win.waitForSelector('[data-tier=fast]');
    const before = await win.textContent('#fee-max');
    await win.click('[data-tier=fast]');
    assert.notEqual(await win.textContent('#fee-max'), before, 'maximum se přepočítá');
    await win.click('#yes');
    await explorer.waitForFunction(() => /Potvrzeno v bloku/.test(document.querySelector('.tool-output')?.textContent ?? ''), null, { timeout: slow(40000) });
    assert.equal((await tipOf()).tip, 2n * gwei);
  });

  await step('a rejected transaction is not sent', async () => {
    const before = await rpc('eth_getTransactionCount', [ADDRESS, 'pending']);
    await card.locator('input[name=hash]').fill('jina-smlouva');
    await approve(write, '#no');
    await explorer.waitForFunction(() => document.querySelector('.tool-output')?.classList.contains('bad'));
    assert.equal(await rpc('eth_getTransactionCount', [ADDRESS, 'pending']), before);
  });

  await step('a message signature verifiable against the address', async () => {
    const sign = explorer.evaluate(() => window.aether.request({ method: 'personal_sign', params: ['0x48656c6c6f', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'] }));
    const win = await context.waitForEvent('page', { predicate: (p) => p.url().includes('approval=') });
    await win.waitForSelector('#yes');
    assert.match(await win.textContent('body'), /Hello/);
    await win.click('#yes');
    const sig = await sign;
    const recovered = await explorer.evaluate(([m, s]) => ethers.verifyMessage(ethers.getBytes(m), s), ['0x48656c6c6f', sig]);
    assert.equal(recovered, ADDRESS);
  });

  await step('locking: the account disappears, a wrong password fails, the right one passes', async () => {
    await open();
    await popup.waitForSelector('#lock');
    await popup.click('#lock');
    await popup.waitForSelector('input[name=password]');
    assert.deepEqual(await explorer.evaluate(() => window.aether.request({ method: 'eth_accounts' })), []);
    assert.equal((await popup.evaluate(() => chrome.storage.session.get('mnemonic'))).mnemonic, undefined, 'fráze zmizela z paměti');
    await popup.fill('input[name=password]', 'spatne-heslo-123');
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /Nesprávné heslo/.test(document.querySelector('.err')?.textContent ?? ''));
    await popup.fill('input[name=password]', PASSWORD);
    await popup.click('button[type=submit]');
    await popup.waitForSelector('#addr');
  });

  await step('an ordinary page cannot call wallet commands', async () => {
    const reply = await explorer.evaluate(() => (window.chrome?.runtime?.sendMessage ? 'dostupné' : 'nedostupné'));
    assert.equal(reply, 'nedostupné');
  });

  await step('a stuck payment can be sped up or cancelled', async () => {
    // Without mining the transaction stays pending, same data, same port.
    node.kill('SIGKILL');
    await until(async () => !(await rpc('eth_blockNumber').catch(() => null)));
    node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', join(data, 'node')], { stdio: 'ignore' });
    await until(() => rpc('eth_blockNumber').catch(() => null));

    const stuck = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    await popup.reload();
    await review(stuck, '2');
    await popup.click('[data-tier=slow]');
    await popup.click('#confirm');
    await popup.waitForSelector('#finish');
    await popup.click('#finish');
    await popup.waitForSelector('[data-view=activity]');
    await popup.click('[data-view=activity]');
    await popup.waitForSelector('[data-speed]', { timeout: slow(15000) });
    const first = await tipOf();
    assert.equal(first.tip, gwei / 10n);

    await popup.click('[data-speed]');
    await until(async () => (await tipOf()).hash !== first.hash);
    const faster = await tipOf();
    assert.ok(faster.tip >= 2n * gwei, 'vyšší dýško');
    const pending = await rpc('aether_pendingTxs');
    assert.equal(pending.length, 1, 'původní transakce je nahrazená');
    assert.equal(pending[0].hash, faster.hash);
    assert.equal(BigInt(pending[0].value), 2n * 10n ** 18n, 'částka zůstala');

    // Waiting for the new transaction's row: shortly after a speed-up the old one is still in the list.
    await popup.waitForSelector(`[data-cancel="${faster.hash}"]`);
    await popup.click(`[data-cancel="${faster.hash}"]`);
    await until(async () => (await tipOf()).hash !== faster.hash);
    const cancelled = (await rpc('aether_pendingTxs'))[0];
    assert.equal(cancelled.to.toLowerCase(), ADDRESS.toLowerCase(), 'platba sám sobě');
    assert.equal(BigInt(cancelled.value), 0n);

    node.kill('SIGKILL');
    await until(async () => !(await rpc('eth_blockNumber').catch(() => null)));
    node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', join(data, 'node'), '--dev-mine', '--miner-address', ADDRESS], { stdio: 'ignore' });
    await until(() => rpc('eth_blockNumber').catch(() => null));
    assert.equal(BigInt(await rpc('eth_getBalance', [stuck, 'latest'])), 0n, 'příjemce nic nedostal');
  });

  /** A hard crash, or with graceful a normal shutdown during which the node saves its queue. */
  const stopNode = async (graceful = false) => {
    node.kill(graceful ? 'SIGTERM' : 'SIGKILL');
    await until(async () => !(await rpc('eth_blockNumber').catch(() => null)));
  };
  const startNode = async (mining) => {
    node = spawn(process.execPath, ['--no-warnings', nodeCli, '--network', 'dev', '--data-dir', join(data, 'node'), ...(mining ? ['--dev-mine', '--miner-address', ADDRESS] : [])], { stdio: 'ignore' });
    await until(() => rpc('eth_blockNumber').catch(() => null));
  };
  const stored = async () => (await popup.evaluate(() => chrome.storage.local.get('activity'))).activity;
  /** Opening the wallet checks the state of pending transactions, as when a person opens it. */
  const refreshUntil = (fn, ms = 60000) => until(async () => {
    await open();
    await popup.waitForSelector('[data-view=activity]');
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 800));
    return false;
  }, ms);

  await step('replaced transactions end as not executed and a cancelled payment never goes through', async () => {
    const stuck = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    // After a hard crash the node may not have the cancellation from the previous step. The wallet has it signed and resends it itself.
    await refreshUntil(async () => (await stored()).filter((a) => a.dropped).length >= 2, 90000);
    const list = await stored();
    const cancel = list.find((a) => a.to?.toLowerCase() === ADDRESS.toLowerCase() && BigInt(a.value) === 0n);
    assert.ok(cancel?.done && !cancel.dropped, 'zrušení se vytěžilo');
    assert.equal(list.filter((a) => a.dropped).length, 2, 'původní platba i zrychlení neproběhly');
    assert.ok(list.filter((a) => a.dropped).every((a) => a.replacedBy), 'neproběhlé jsou ty nahrazené');
    assert.equal(BigInt(await rpc('eth_getBalance', [stuck, 'latest'])), 0n, 'zrušená platba nikdy neprošla');
    await popup.click('[data-view=activity]');
    await popup.waitForFunction(() => /Neproběhla/.test(document.querySelector('#view')?.textContent ?? ''));
    assert.equal(await popup.locator('.tx.dropped').count(), 2);
    assert.equal(await popup.locator('.tx.dropped [data-speed], .tx.dropped + .tx-pending [data-speed]').count(), 0, 'u neproběhlé se nic nenabízí');
  });

  await step('the wallet resends a transaction the node forgot and it gets mined', async () => {
    await stopNode();
    await startNode(false);
    const before = BigInt(await rpc('eth_getBalance', [receiver, 'latest']));
    await open();
    await review(receiver, '0,02');
    await popup.click('#confirm');
    await popup.waitForSelector('#finish');
    await popup.click('#finish');
    const { hash } = (await stored())[0];
    assert.ok(await rpc('eth_getTransactionByHash', [hash]), 'uzel transakci má');
    // A node crash with the queue deleted: the node knows nothing about the transaction.
    await stopNode();
    rmSync(join(data, 'node', 'mempool.bin'), { force: true });
    await startNode(true);
    assert.equal(await rpc('eth_getTransactionByHash', [hash]), null, 'uzel transakci zapomněl');
    await refreshUntil(async () => (await rpc('eth_getTransactionReceipt', [hash])) !== null);
    assert.equal(BigInt(await rpc('eth_getBalance', [receiver, 'latest'])) - before, 2n * 10n ** 16n, 'platba dorazila jednou');
    await refreshUntil(async () => (await stored())[0].done === true);
  });

  await step('the wallet sends nothing to the zero address or the token address', async () => {
    await open();
    await popup.waitForSelector('#send');
    await popup.click('#send');
    await popup.fill('input[name=to]', '0x0000000000000000000000000000000000000000');
    await popup.fill('input[name=value]', '1');
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /nulová adresa/.test(document.querySelector('.err')?.textContent ?? ''));
    // We have no balance of the token on the test network, so the protection is tested directly by the wallet command.
    const token = '0x901d0A87a7591c57ee1d94C7d057288B4E98e70C';
    const reply = await popup.evaluate((t) => new Promise((r) => chrome.runtime.sendMessage({ cmd: 'send', to: t, token: t, value: '1', decimals: 6 }, r)), token);
    assert.match(reply.error, /token contract itself/);
    const zero = await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ cmd: 'send', to: '0x0000000000000000000000000000000000000000', value: '1' }, r)));
    assert.match(zero.error, /zero address/);
  });

  await step('with a foreign wallet neither speed-up nor cancel is offered, so no second payment is created', async () => {
    await stopNode();
    await startNode(false);
    // The app relays signatures to a foreign wallet. Here a test key stands in for it and chooses the nonce itself, like MetaMask.
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await sw.evaluate(({ key, url }) => {
      globalThis.externalRequest = async (ext, method, [p]) => {
        const signer = new ethers.Wallet(key, new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true }));
        return (await signer.sendTransaction({ type: 2, to: p.to, value: p.value, data: p.data, gasLimit: p.gas, maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas })).hash;
      };
    }, { key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', url: RPC });
    await popup.evaluate((a) => chrome.storage.local.set({ external: { kind: 'test', name: 'Test', rdns: null, address: a }, selected: 0 }), ADDRESS);
    await open();
    await review(receiver, '0,03');
    await popup.click('#confirm');
    await popup.waitForSelector('#finish');
    await popup.click('#finish');
    const item = (await stored())[0];
    assert.equal(item.external, true);
    const sent = await rpc('eth_getTransactionByHash', [item.hash]);
    assert.equal(item.nonce, Number(sent.nonce), 'peněženka zná pořadové číslo, které zvolila cizí peněženka');
    await open();
    await popup.waitForSelector('[data-view=activity]');
    await popup.click('[data-view=activity]');
    await popup.waitForFunction(() => /v peněžence, která ji podepsala/.test(document.querySelector('#view')?.textContent ?? ''));
    assert.equal(await popup.locator('[data-speed], [data-cancel]').count(), 0, 'žádné tlačítko, které by zaplatilo podruhé');
    const reply = await popup.evaluate((h) => new Promise((r) => chrome.runtime.sendMessage({ cmd: 'replaceTx', hash: h }, r)), item.hash);
    assert.match(reply.error, /wallet that signed it/);
    assert.equal((await rpc('aether_pendingTxs')).length, 1, 'v síti čeká jen jedna platba');

    await popup.evaluate(() => chrome.storage.local.remove('external'));
    await (context.serviceWorkers()[0] ?? sw).evaluate(() => { delete globalThis.externalRequest; }).catch(() => {});
    // Normal shutdown: the node saves the queue and loads it after start; the foreign payment is then mined.
    await stopNode(true);
    await startNode(true);
    await until(async () => (await rpc('eth_getTransactionReceipt', [item.hash])) !== null, 90000);
  });

  await step('aktivitu i aktiva jde rozkliknout do detailu a odtud do Exploreru', async () => {
    await open();
    await popup.waitForSelector('[data-view=activity]');
    await popup.click('[data-view=activity]');
    // Activity is grouped by day and also shows what the wallet did not send itself: here rewards for mined blocks.
    await popup.locator('.tx-open', { hasText: 'Odměny za bloky' }).first().waitFor({ timeout: slow(30000) });
    assert.equal(await popup.locator('.act-day').first().textContent(), 'Dnes');
    const payment = popup.locator('.tx-open', { hasText: 'Platba' }).first();
    assert.match(await payment.textContent(), /Komu 0x[0-9a-fA-F]{6}…[\s\S]*−0,0\d+ dQU/, 'platba ukazuje příjemce a odeslanou částku se znaménkem');
    assert.match(await popup.locator('.tx-open', { hasText: 'Odměny za bloky' }).first().textContent(), /\d+ bloků[\s\S]*\+[\d\s,]+ dQU/, 'odměny ukazují počet bloků a částku');
    await payment.click();
    await popup.waitForFunction(() => /Potvrzeno v bloku \d/.test(document.querySelector('#detail')?.textContent ?? ''));
    const detail = await popup.textContent('#detail');
    for (const text of ['Zaplacený poplatek', 'Pořadové číslo', 'Transakce', 'Komu']) assert.ok(detail.includes(text), `detail ukazuje ${text}`);
    // The extension opens the network's Explorer in a new tab, directly at the transaction.
    const [tab] = await Promise.all([context.waitForEvent('page'), popup.click('#d-explorer')]);
    assert.match(tab.url(), /\/tx\/0x[0-9a-f]{64}$/);
    await tab.close();
    await popup.click('#back');
    await popup.waitForSelector('[data-view=assets]');
    await popup.click('[data-view=assets]');
    await popup.click('[data-asset="0"]');
    await popup.waitForFunction(() => /Hlavní mince sítě/.test(document.body.textContent));
    await popup.waitForFunction(() => /Odesláno/.test(document.querySelector('#a-history')?.textContent ?? ''), null, { timeout: slow(30000) });
    assert.ok(await popup.locator('#a-history .tx-open').count() > 0, 'poslední pohyby mince');
    await popup.click('#a-send');
    await popup.waitForSelector('#asset-pick .asset-ic.coin');
    assert.match(await popup.textContent('#asset-pick b'), /^[td]?QU$/, 'odeslání má předvybranou minci');
    await popup.click('#back');
  });

  await step('deposit shows a QR code with the address and accounts can be renamed and imported', async () => {
    await open();
    await popup.waitForSelector('#deposit');
    await popup.click('#deposit');
    await popup.waitForSelector('.qr svg');
    assert.equal((await popup.textContent('#deposit-address')).trim(), ADDRESS);
    await popup.click('#back');
    await popup.waitForSelector('#accounts');
    await popup.click('#accounts');
    await popup.waitForSelector('#add-key');
    await popup.click('[data-rename]');
    await popup.fill('input[name=name]', 'Těžba');
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /Těžba/.test(document.querySelector('.account-pick')?.textContent ?? ''));
    await popup.click('#add-key');
    const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    await popup.fill('input[name=key]', 'nesmysl');
    await popup.fill('input[name=password]', PASSWORD);
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /Neplatný soukromý klíč/.test(document.querySelector('.err')?.textContent ?? ''));
    await popup.fill('input[name=key]', key);
    await popup.fill('input[name=password]', 'spatne-heslo-123');
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /Nesprávné heslo/.test(document.querySelector('.err')?.textContent ?? ''));
    await popup.fill('input[name=password]', PASSWORD);
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => document.querySelector('#addr')?.title === '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    const stored = await popup.evaluate(() => chrome.storage.local.get(null));
    assert.ok(!JSON.stringify(stored).includes(key.slice(2)), 'klíč není v úložišti čitelně');
    await popup.click('#lock');
    await popup.waitForSelector('input[name=password]');
    await popup.fill('input[name=password]', PASSWORD);
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => document.querySelector('#addr')?.title === '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await popup.click('#accounts');
    await popup.waitForSelector('[data-index="0"]');
    assert.match(await popup.textContent('.account-row:nth-child(2)'), /Importovan/);
    await popup.click('[data-index="0"]');
    await popup.waitForFunction((a) => document.querySelector('#addr')?.title === a, ADDRESS);
  });

  await step('the phrase and the private key are shown only after entering the password', async () => {
    await open();
    await popup.waitForSelector('#settings');
    await popup.click('#settings');
    await popup.waitForSelector('#k input[name=password]');
    await popup.fill('#k input[name=password]', 'spatne-heslo-123');
    await popup.click('#k button[type=submit]');
    await popup.waitForFunction(() => /Nesprávné heslo/.test(document.querySelector('.err')?.textContent ?? ''));
    assert.equal(await popup.textContent('#k-out'), '', 'bez hesla se klíč neukáže');
    await popup.fill('#k input[name=password]', PASSWORD);
    await popup.click('#k button[type=submit]');
    await popup.waitForFunction(() => /^0x[0-9a-f]{64}/.test(document.querySelector('#k-out .mono')?.textContent ?? ''));
    await popup.fill('#s input[name=password]', PASSWORD);
    await popup.click('#s button[type=submit]');
    await popup.waitForSelector('#s-out .seed');
    await popup.click('#back');
    await popup.waitForSelector('#addr');
  });

  await step('the currency can be shown as the Quinvium symbol and back', async () => {
    await open();
    await popup.waitForSelector('#settings');
    await popup.click('#settings');
    await popup.selectOption('#coin-style', 'symbol');
    await popup.click('#back');
    await popup.waitForSelector('#addr');
    await popup.waitForFunction(() => document.querySelector('#app').innerText.includes('\uE000') && !/\b[td]?QU\b/.test(document.querySelector('#app').innerText));
    assert.ok(await popup.evaluate(async () => { await document.fonts.load('14px QuinviumSymbol', '\uE000'); return document.fonts.check('14px QuinviumSymbol', '\uE000'); }), 'the symbol font loads');
    await popup.click('#settings');
    await popup.selectOption('#coin-style', 'text');
    await popup.click('#back');
    await popup.waitForFunction(() => /\b[td]?QU\b/.test(document.querySelector('#app').innerText) && !document.querySelector('#app').innerText.includes('\uE000'));
  });

  await step('sign-out requires confirmation and can be undone', async () => {
    await open();
    await popup.waitForSelector('#settings');
    await popup.click('#settings');
    await popup.waitForSelector('#logout');
    await popup.click('#logout');
    await popup.fill('input[name=confirm]', 'smazat');
    await popup.click('button[type=submit]');
    await popup.waitForFunction(() => /velkými písmeny/.test(document.querySelector('.err')?.textContent ?? ''));
    assert.ok((await popup.evaluate(() => chrome.storage.local.get('vault'))).vault, 'peněženka zůstala');
    await popup.click('#back');
    await popup.waitForSelector('#k input[name=password]');
    await popup.click('#back');
    await popup.waitForSelector('#addr');
  });

  await step('sign-out and import of another wallet', async () => {
    const before = await popup.evaluate(() => chrome.storage.local.get('chainId'));
    assert.deepEqual(await explorer.evaluate(() => window.aether.request({ method: 'eth_accounts' })), [ADDRESS]);
    await popup.click('#settings');
    await popup.waitForSelector('#logout');
    await popup.click('#logout');
    await popup.fill('input[name=confirm]', 'SMAZAT');
    await popup.click('button[type=submit]');
    await popup.waitForSelector('#imp');
    const stored = await popup.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(Object.keys(stored), ['chainId'], 'nezůstal trezor, historie ani připojené stránky');
    assert.equal(stored.chainId, before.chainId, 'nastavená síť zůstává');
    assert.equal((await popup.evaluate(() => chrome.storage.session.get('mnemonic'))).mnemonic, undefined, 'fráze zmizela z paměti');
    await explorer.waitForFunction(() => !document.querySelector('#login-btn').classList.contains('connected'));

    await popup.click('#imp');
    await popup.fill('textarea[name=phrase]', OTHER_PHRASE);
    await popup.click('button[type=submit]');
    await popup.fill('input[name=p1]', PASSWORD);
    await popup.fill('input[name=p2]', PASSWORD);
    await popup.click('button[type=submit]');
    await popup.waitForSelector('#addr');
    assert.equal((await popup.getAttribute('#addr', 'title')).trim(), OTHER_ADDRESS);
    assert.deepEqual(await explorer.evaluate(() => window.aether.request({ method: 'eth_accounts' })), [], 'nová peněženka se stránce neukáže bez souhlasu');
  });

  await step('forgotten password: another wallet can be used from the unlock screen', async () => {
    await popup.click('#lock');
    await popup.waitForSelector('#other');
    await popup.click('#other');
    await popup.waitForSelector('input[name=confirm]');
    await popup.click('#back');
    await popup.waitForSelector('input[name=password]');
    await popup.click('#other');
    await popup.fill('input[name=confirm]', 'SMAZAT');
    await popup.click('button[type=submit]');
    await popup.waitForSelector('#imp');
    assert.equal((await popup.evaluate(() => chrome.storage.local.get('vault'))).vault, undefined);
  });

  await step('the check words differ every time and the phrase can be copied', async () => {
    await popup.click('#new');
    await popup.waitForSelector('#copy-seed');
    assert.equal(await popup.$$eval('.seed span', (l) => l.length), 24);
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      await popup.click('#next');
      await popup.waitForSelector('input[name^=w]');
      const names = await popup.$$eval('input[name^=w]', (l) => l.map((x) => x.name));
      assert.equal(new Set(names).size, 3, 'tři různá slova');
      seen.add(names.join());
      await popup.click('#back');
      await popup.waitForSelector('#copy-seed');
    }
    assert.ok(seen.size > 1, 'pokaždé jiná místa ve frázi');
  });

  await step('connecting without a wallet offers to create one and completes', async () => {
    const fresh = await chromium.launchPersistentContext(join(data, 'profile-nova'), {
      channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const page = await fresh.newPage();
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.addInitScript((id) => localStorage.setItem('aether.wallet', id), 'org.aether.wallet');
      await page.goto(`${RPC}/`);
      await page.waitForSelector('.metric-grid');
      const approvalWindow = () => fresh.waitForEvent('page', { predicate: (p) => p.url().includes('approval=') });
      const [setup] = await Promise.all([approvalWindow(), page.click('#login-btn')]);
      await setup.waitForSelector('#imp');
      await setup.click('#imp');
      await setup.fill('textarea[name=phrase]', PHRASE);
      await setup.click('button[type=submit]');
      await setup.fill('input[name=p1]', PASSWORD);
      await setup.fill('input[name=p2]', PASSWORD);
      await setup.click('button[type=submit]');
      await setup.waitForSelector('#yes');
      assert.match(await setup.textContent('body'), /Connect this site/);
      // A new wallet starts on mainnet; the guide switches it to the page's network right after connecting.
      const [change] = await Promise.all([approvalWindow(), setup.click('#yes')]);
      await change.waitForSelector('#yes');
      assert.match(await change.textContent('body'), /Switch network/);
      await change.click('#yes');
      await page.waitForFunction(() => document.querySelector('#login-btn').classList.contains('connected'));
      assert.deepEqual(await page.evaluate(() => window.aether.request({ method: 'eth_accounts' })), [ADDRESS]);
    } finally {
      await fresh.close();
    }
  });

  await step('bez chyb JavaScriptu', async () => assert.deepEqual(pageErrors, []));
} finally {
  await context?.close();
  node.kill('SIGINT');
}
const ok = results.filter((r) => r[1]).length;
console.log(`\nSOUHRN: ${ok}/${results.length} prošlo`);
process.exit(ok === results.length ? 0 : 1);
