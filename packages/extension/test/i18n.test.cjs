// Žádný text v rozhraní nesmí zůstat bez překladu ani ztratit proměnnou.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.document = { documentElement: {}, };
require('../i18n.js');
const { TEXT, ORDER, t, setLang, lang, decimal } = window.AetherI18n;

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const popup = read('extension/popup.js');
const desktop = read('desktop/src/renderer/desktop.js');
const html = read('desktop/src/renderer/index.html');
const background = read('extension/background.js');
const main = read('desktop/src/main.cjs');

function usedKeys() {
  const keys = new Set();
  for (const m of popup.matchAll(/\b_\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of desktop.matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of desktop.matchAll(/tr\(s\.\w+\.running \? '([^']+)' : '([^']+)'\)/g)) { keys.add(m[1]); keys.add(m[2]); }
  for (const m of desktop.matchAll(/s\.peers \? '([^']+)'\s+: seedSet \? '([^']+)'\s+: '([^']+)'/g)) { keys.add(m[1]); keys.add(m[2]); keys.add(m[3]); }
  for (const m of html.matchAll(/<(?:span|b|strong|summary|h1|p|small)[^>]*\bdata-t[^>]*>([^<]+)</g)) keys.add(m[1]);
  for (const m of background.matchAll(/(?:rpcError\([^,]+, |new Error\()'([A-Z][^']+)'/g)) keys.add(m[1]);
  for (const m of main.matchAll(/new Error\('([^']+)'\)/g)) keys.add(m[1]);
  return [...keys];
}

test('angličtina je výchozí jazyk', () => assert.equal(lang(), 'en'));

test('každý použitý text má překlad do všech jazyků', () => {
  const missing = usedKeys().filter((k) => !TEXT[k]);
  assert.deepEqual(missing, []);
  assert.ok(usedKeys().length > 150, 'hledání textů v kódu funguje');
});

test('každý překlad má všechny jazyky a stejné proměnné jako originál', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, row] of Object.entries(TEXT)) {
    assert.equal(row.length, ORDER.length, key);
    for (const text of row) {
      assert.ok(text, key);
      assert.deepEqual(vars(text), vars(key), key);
    }
  }
});

test('v kódu nezůstaly české texty pro uživatele', () => {
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  for (const file of [popup, desktop]) assert.doesNotMatch(strip(file), /[ěščřžůňťď]/i);
});

test('přepnutí jazyka a desetinná čárka', () => {
  setLang('cs');
  assert.equal(t('Send'), 'Odeslat');
  assert.equal(t('Word no. {n}', { n: 3 }), 'Slovo č. 3');
  assert.equal(decimal('1.5'), '1,5');
  setLang('neexistuje');
  assert.equal(lang(), 'en');
  assert.equal(decimal('1.5'), '1.5');
});
