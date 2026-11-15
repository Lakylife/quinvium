// Screenshots of the app's main screens in several languages, for review (docs/snimky). No mining, its own node ports.
// Run: node packages/desktop/test/screens.mjs <output folder>
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? tmpdir();
const electronPath = createRequire(import.meta.url)('electron');
const PHRASE = 'test test test test test test test test test test test junk';
const app = await electron.launch({
  executablePath: electronPath, args: [join(here, '..')],
  env: { ...process.env, AETHER_NO_SEEDS: '1', AETHER_NO_TRAY: '1', AETHER_USER_DATA: mkdtempSync(join(tmpdir(), 'quinvium-screens-')), AETHER_LAN_PORT: '30690', AETHER_P2P_PORT: '30691', AETHER_RPC_PORT: '18856', AETHER_STRATUM_PORT: '13856' },
});
const errors = [];
try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1180, height: 780 });
  await win.waitForSelector('#imp', { timeout: 60000 });
  await win.click('#imp');
  await win.fill('textarea[name=phrase]', PHRASE);
  await win.click('#app button[type=submit]');
  await win.fill('input[name=p1]', 'heslo-pro-test-123');
  await win.fill('input[name=p2]', 'heslo-pro-test-123');
  await win.click('#app button[type=submit]');
  await win.waitForSelector('#addr', { timeout: 60000 });
  const shot = async (name) => { await win.waitForTimeout(600); await win.screenshot({ path: join(out, `${name}.png`) }); };
  for (const lang of ['cs', 'ja', 'ar']) {
    await win.evaluate((l) => { const s = document.getElementById('s-lang'); s.value = l; s.dispatchEvent(new Event('change')); }, lang);
    await win.waitForTimeout(800);
    await win.click('nav button[data-tab=wallet]');
    await win.waitForSelector('#addr');
    await win.click('#deposit').catch(() => {});
    await shot(`${lang}-vklad`);
    await win.click('#back').catch(() => {});
    await win.click('#send').catch(() => {});
    await win.waitForSelector('#asset-pick', { timeout: 10000 }).catch(() => {});
    await win.click('#asset-pick').catch(() => {});
    await shot(`${lang}-odeslat`);
    await win.click('#back').catch(() => {});
    await win.click('nav button[data-tab=settings]');
    await shot(`${lang}-nastaveni`);
    await win.evaluate(() => window.onWalletLocked?.());
    await win.fill('#lock-password', 'spatne-heslo');
    await win.click('#lock-submit');
    await win.waitForTimeout(500);
    await shot(`${lang}-zamceno`);
    await win.fill('#lock-password', 'heslo-pro-test-123');
    await win.click('#lock-submit');
    await win.waitForTimeout(800);
  }
} finally {
  await app.close();
}
console.log(errors.length ? `JS errors: ${errors.join(' | ')}` : 'ok');
