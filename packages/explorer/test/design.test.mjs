// Sekce jsou plochy, ne rámečky: hranici dělá tón plochy. Jediná povolená čára je tenká linka pod řádkem seznamu.
// Výchozí styly prohlížeče hlídá pages.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['explorer/public/styles.css', 'extension/popup.css', 'desktop/src/renderer/desktop.css', 'desktop/src/wallet-link.cjs'];
const BORDER = /(?:^|[;{\s])border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:width|style|color))?\s*:\s*([^;}]+)/gm;

for (const file of FILES) {
  test(`${file} nemá žádný rámeček`, () => {
    const css = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const hairline = (m) => /border-bottom\s*:\s*1px solid var\(--line\)/.test(m[0]);
    const drawn = [...css.matchAll(BORDER)].filter((m) => !/^(0|none|transparent)\b/.test(m[1].trim()) && !hairline(m)).map((m) => m[0].trim());
    assert.deepEqual(drawn, []);
  });
}
