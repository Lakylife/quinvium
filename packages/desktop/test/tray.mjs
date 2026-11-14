// Tray and background running (2.15.0): closing the window keeps the node running, the tray menu controls the app,
// mainnet is the default network outside tests, the remembered network wins and Quit ends the node cleanly.
// Runs next to the user's app on its own ports, without a GPU and without the real network.
import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const electronPath = createRequire(import.meta.url)('electron');
const RPC_PORT = 18766;
let failed = 0;
const step = async (name, fn) => {
  try { const note = await fn(); console.log(`[OK  ] ${name}${note ? `: ${note}` : ''}`); } catch (e) { failed += 1; console.log(`[FAIL] ${name}: ${e.message.split('\n')[0]}`); }
};
const until = async (fn, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('vypršel čas');
};
const rpcAlive = () => fetch(`http://127.0.0.1:${RPC_PORT}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

const userData = mkdtempSync(join(tmpdir(), 'aether-tray-'));
const app = await electron.launch({
  // QUINVIUM_APP=<path to the built app binary> checks the packaged app instead of the sources.
  executablePath: process.env.QUINVIUM_APP ?? electronPath, args: process.env.QUINVIUM_APP ? [] : [join(here, '..')],
  env: { ...process.env, AETHER_NO_SEEDS: '1', AETHER_USER_DATA: userData, AETHER_SHELL_PROFILE: join(userData, 'zshrc'), AETHER_LAN_PORT: '30690', AETHER_P2P_PORT: '30691', AETHER_RPC_PORT: String(RPC_PORT), AETHER_STRATUM_PORT: '13396' },
});
try {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await step('the test app starts its node on testnet and remembers nothing for the user', async () => {
    await win.waitForFunction(() => /testnet · block/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    await until(rpcAlive);
  });

  await step('Mainnet is first in the list; the test app stays on testnet', async () => {
    const order = await win.$$eval('#n-network option', (o) => o.map((x) => x.value));
    assert.deepEqual(order, ['mainnet', 'testnet']);
    assert.equal(await win.evaluate(() => window.desktop.state().then((s) => s.node.preferred)), 'testnet');
  });

  await step('the tray menu shows the state and controls the app', async () => {
    assert.equal(await app.evaluate(() => globalThis.quinviumTray.iconEmpty()), false, 'the tray icon file is packaged');
    const labels = await app.evaluate(() => globalThis.quinviumTray.labels());
    for (const want of [/^(Network|Síť): Testnet · (block|blok) /, /^(Mining is off|Těžba je vypnutá)$/, /^(Start mining|Spustit těžbu)$/, /^(Open Quinvium|Otevřít Quinvium)$/, /^(Start at login|Spouštět po přihlášení)$/, /^(Quit Quinvium|Ukončit Quinvium)$/]) {
      assert.ok(labels.some((l) => want.test(l)), `${want} in ${labels.join(' | ')}`);
    }
    return labels.join(' | ');
  });

  await step('closing the window hides it; the node keeps running', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await until(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()), 10000);
    assert.equal(await rpcAlive(), true);
    const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
    assert.equal(settings.trayNoticeShown, true, 'the notice is shown once');
  });

  await step('a second start of the app shows the hidden window again', async () => {
    await app.evaluate(({ app: a }) => a.emit('second-instance'));
    await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 10000);
  });

  await step('Quit ends the app and its node', async () => {
    await app.evaluate(({ app: a }) => a.quit());
    await until(async () => !(await rpcAlive()), 20000);
  });
} finally {
  await app.close().catch(() => {});
}
writeFileSync(join(userData, 'done'), '');
console.log(failed ? `SOUHRN: ${failed} selhalo` : 'Vše prošlo.');
process.exit(failed ? 1 : 0);
