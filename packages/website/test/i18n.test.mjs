// Every text of the English site has a translation in every language, with the same links and markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { units, translateHtml } from '../src/translate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const LANGS = ['cs', 'de', 'es', 'fr', 'ja', 'zh', 'ar'];
const dicts = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(here, '..', 'src', 'i18n', `${l}.json`), 'utf8'))]));
const english = [];
for (const name of readdirSync(pub)) {
  const p = join(pub, name);
  if (name.endsWith('.html') && name !== '404.html') english.push(p);
  else if (statSync(p).isDirectory() && !LANGS.includes(name) && existsSync(join(p, 'index.html'))) english.push(join(p, 'index.html'));
}
const all = [...new Set(english.flatMap((f) => units(readFileSync(f, 'utf8'))))];
const tags = (html) => [...html.matchAll(/<(\w+)([^>]*)>/g)].map((m) => `${m[1]}${(m[2].match(/\s(href|class|data-[\w-]+)="[^"]*"/g) ?? []).sort().join('')}`).sort();

test('the English site has texts to translate', () => {
  assert.ok(english.length >= 13, `pages: ${english.length}`);
  assert.ok(all.length > 300, `texts: ${all.length}`);
});

for (const l of LANGS) {
  test(`${l}: every text is translated and keeps its links and markup`, () => {
    const missing = all.filter((u) => !dicts[l][u]);
    assert.deepEqual(missing, []);
    for (const u of all) assert.deepEqual(tags(dicts[l][u]), tags(u), `${l}: ${u.slice(0, 80)}`);
  });
}

test('built pages: language, direction, alternates and links stay in the language', () => {
  for (const l of LANGS) {
    const html = readFileSync(join(pub, l, 'mining', 'index.html'), 'utf8');
    assert.match(html, new RegExp(`<html lang="${l}"${l === 'ar' ? ' dir="rtl"' : ''}>`));
    assert.match(html, /hreflang="x-default"/);
    assert.match(html, new RegExp(`href="/${l}/download/"`), 'internal links point to the same language');
    assert.match(html, /href="\/quinvium-whitepaper.pdf"|href="\/Quinvium-Symbol.ttf"|href="\/site.css"/, 'files are not prefixed');
  }
  const sitemap = readFileSync(join(pub, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /hreflang="ar" href="https:\/\/quinvium.com\/ar\/"/);
});

test('a translation never touches code', () => {
  const html = '<p>Run <code>quinvium --help</code> now</p><pre>Run it</pre><script>var Run = 1</script>';
  const out = translateHtml(html, { 'Run <code>quinvium --help</code> now': 'Spusťte <code>quinvium --help</code> hned', 'Run it': 'X' });
  assert.equal(out, '<p>Spusťte <code>quinvium --help</code> hned</p><pre>Run it</pre><script>var Run = 1</script>');
});
