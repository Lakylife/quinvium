// No interface text may remain untranslated or lose a variable.
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

test('English is the default language', () => assert.equal(lang(), 'en'));

test('every text used has a translation into all languages', () => {
  const missing = usedKeys().filter((k) => !TEXT[k]);
  assert.deepEqual(missing, []);
  assert.ok(usedKeys().length > 150, 'hledání textů v kódu funguje');
});

test('every translation has all languages and the same variables as the original', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, row] of Object.entries(TEXT)) {
    assert.equal(row.length, ORDER.length, key);
    for (const text of row) {
      assert.ok(text, key);
      assert.deepEqual(vars(text), vars(key), key);
    }
  }
});

test('no Czech user-facing texts remained in the code', () => {
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  for (const file of [popup, desktop]) assert.doesNotMatch(strip(file), /[ěščřžůňťď]/i);
});

test('switching the language and the decimal comma', () => {
  setLang('cs');
  assert.equal(t('Send'), 'Odeslat');
  assert.equal(t('Word no. {n}', { n: 3 }), 'Slovo č. 3');
  assert.equal(decimal('1.5'), '1,5');
  setLang('neexistuje');
  assert.equal(lang(), 'en');
  assert.equal(decimal('1.5'), '1.5');
});
