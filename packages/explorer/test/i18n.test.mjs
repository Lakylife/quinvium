// Every Explorer text must exist in all languages with the same variables as English.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const app = read('app.js');
const I18N = new Function(`${app.slice(app.indexOf('const I18N = {'), app.indexOf('const store = {'))}; return I18N;`)();
const window = {};
new Function('window', read('i18n.js'))(window);
const { keys, texts } = window.AetherExplorerText;
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const pairs = [...app.slice(app.indexOf('const L = (cs, en)')).matchAll(/L\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[2]);

test('Czech and English have the same keys', () => {
  assert.deepEqual(Object.keys(I18N.cs).sort(), Object.keys(I18N.en).sort());
});

test('every key has German, Spanish and French with the same variables', () => {
  const missing = Object.keys(I18N.en).filter((k) => !keys[k]);
  assert.deepEqual(missing, []);
  for (const [k, list] of Object.entries(keys)) {
    assert.ok(I18N.en[k] !== undefined, `navíc: ${k}`);
    assert.equal(list.length, 3, k);
    for (const text of list) {
      assert.ok(text, k);
      assert.deepEqual(vars(text), vars(I18N.en[k]), k);
    }
  }
});

test('tool and error texts have all languages', () => {
  assert.ok(pairs.length > 100, 'hledání textů v kódu funguje');
  const missing = [...new Set(pairs)].filter((en) => !texts[en]);
  assert.deepEqual(missing, []);
  for (const [en, list] of Object.entries(texts)) {
    assert.equal(list.length, 3, en);
    for (const text of list) assert.ok(text, en);
  }
});

test('every key used in the code exists', () => {
  const used = new Set([...app.matchAll(/\b(?:t|fill)\('([a-zA-Z]+\.[\w]+)'/g)].map((m) => m[1]));
  for (const m of read('index.html').matchAll(/data-t(?:-ph)?="([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 100);
  assert.deepEqual([...used].filter((k) => I18N.en[k] === undefined), []);
});
