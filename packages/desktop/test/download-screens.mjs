// Screenshots of the app for the website's download page: English, light, a test wallet (no real address or balance).
// Run: AETHER_USER_DATA=<folder with chain/mainnet/chain.db copied from a synced node, without node.key> node packages/desktop/test/download-screens.mjs <output folder>
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const electronPath = createRequire(import.meta.url)('electron');
const PHRASE = 'test test test test test test test test test test test junk';
const app = await electron.launch({
  executablePath: electronPath, args: [join(here, '..')],
  env: { ...process.env, AETHER_NO_TRAY: '1', AETHER_LAN_PORT: '30790', AETHER_P2P_PORT: '30791', AETHER_RPC_PORT: '18956', AETHER_STRATUM_PORT: '13956' },
});
try {
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1240, height: 800 });
  await win.waitForSelector('#imp', { timeout: 60000 });
  await win.click('#imp');
  await win.fill('textarea[name=phrase]', PHRASE);
  await win.click('#app button[type=submit]');
  await win.fill('input[name=p1]', 'heslo-pro-test-123');
  await win.fill('input[name=p2]', 'heslo-pro-test-123');
  await win.click('#app button[type=submit]');
  await win.waitForSelector('#addr', { timeout: 60000 });
  await win.evaluate(() => { const s = document.getElementById('s-lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); });
  await win.waitForTimeout(20000);   // the node catches up with the network
  const shot = async (tab, name, wait = 2500) => { await win.click(`nav button[data-tab=${tab}]`); await win.waitForTimeout(wait); const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    (await import('node:fs')).writeFileSync(join(out, `${name}.png`), Buffer.from(png, 'base64')); };
  await shot('wallet', 'app-wallet');
  await shot('mining', 'app-mining');
  await shot('node', 'app-node');
  await shot('explorer', 'app-explorer', 8000);
} finally {
  await app.close();
}
console.log('ok');
