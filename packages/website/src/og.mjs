// Creates src/og.png (social preview 1200×630) and src/apple-touch-icon.png (180×180). Needs Playwright.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const logo = readFileSync(join(here, 'logo.svg'), 'utf8');
const mark = 'M32 2.75L59.58 22.79L49.05 55.21L14.95 55.21L4.42 22.79ZM18.21 27.27L23.48 43.48L40.52 43.48L45.79 27.27L32 17.25ZM39.37 33.81L55.24 55.66L47.56 61.24L31.69 39.4Z';
const og = `<html><body style="margin:0;width:1200px;height:630px;background:#fafaf7;color:#0f172a;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;display:flex;align-items:center;overflow:hidden">
<div style="padding:0 0 0 90px;flex:1">
<div style="font:600 24px ui-monospace,Menlo,monospace;letter-spacing:2px;color:#5b6a7d;margin-bottom:28px">QUINVIUM · QU</div>
<div style="font-size:76px;font-weight:750;letter-spacing:-2.5px;line-height:1.02;margin-bottom:28px">The blockchain mined<br>on graphics cards</div>
<div style="font-size:28px;color:#3b4a5e">Proof-of-Work · EVM · GPU mining · No premine</div>
</div>
<svg width="460" height="460" viewBox="0 0 400 400" style="margin-right:40px">
<polygon points="200,30 361.7,147.5 299.9,337.5 100.1,337.5 38.3,147.5" fill="#e9f1fb"/>
<polygon points="200,100 295.1,169.1 258.8,280.9 141.2,280.9 104.9,169.1" fill="#ffffff" stroke="#c8dcf3" stroke-width="2"/>
<g transform="translate(150 150) scale(1.5625)"><path d="${mark}" fill="#f2b544"/></g></svg>
</body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(og); await p.screenshot({ path: join(here, 'og.png') });
await p.setViewportSize({ width: 180, height: 180 });
await p.setContent(`<html><body style="margin:0;background:#0b1622">${logo.replace('width="64" height="64"', 'width="180" height="180"')}</body></html>`);
await p.screenshot({ path: join(here, 'apple-touch-icon.png') });
await b.close();
console.log('og.png a apple-touch-icon.png hotové');
