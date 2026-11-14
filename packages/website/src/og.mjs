// Creates src/og.png (social preview 1200×630) and src/apple-touch-icon.png (180×180). Needs Playwright.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const logo = readFileSync(join(here, 'logo.svg'), 'utf8');
const mark = 'M26.33 36.92L28.75 39.63L37.24 48.48L46.52 58.68L58.57 58.68L46.87 45.48L40.38 38.28L39.46 37.49L38.88 37.14L38.03 36.92L30.54 36.92L30.47 36.85L30.32 36.92L28.9 36.92L28.83 36.85L28.68 36.92ZM32.39 2.75L30.75 2.75L30.04 2.89L29.04 3.18L28.04 3.68L18.55 9.88L8.64 16.59L7.71 17.23L7.21 17.8L6.57 18.66L5.78 20.16L5.64 20.73L5.43 21.8L5.43 42.42L5.71 43.99L6.35 45.55L6.99 46.41L8.28 47.7L15.34 52.4L27.4 60.39L28.54 60.96L29.9 61.25L32.04 61.18L32.89 60.96L34.1 60.39L41.31 55.19L35.82 49.05L35.6 49.12L32.61 51.26L31.82 51.69L31.46 51.83L30.47 51.83L29.61 51.48L21.26 45.77L15.98 42.27L15.27 41.49L14.84 40.63L14.56 39.56L14.56 25.15L14.7 24.51L15.06 23.65L15.34 23.3L16.2 22.44L26.33 15.73L30.39 13.02L31.39 12.74L31.82 12.74L32.61 12.95L34.89 14.38L38.6 16.95L46.09 21.94L47.37 23.08L47.73 23.8L47.94 24.87L47.94 40.2L47.73 41.42L47.37 42.13L46.52 42.92L51.94 48.98L52.08 49.19L52.23 49.19L54.51 47.62L55.36 46.98L55.94 46.41L56.86 44.98L57.15 44.2L57.43 42.7L57.43 21.8L57.22 20.59L56.93 19.66L56.36 18.59L55.79 17.8L54.94 16.95L53.22 15.73L38.88 6.1L34.68 3.46L33.82 3.04Z';
const og = `<html><body style="margin:0;width:1200px;height:630px;background:#fafaf7;color:#0f172a;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;display:flex;align-items:center;overflow:hidden">
<div style="padding:0 0 0 90px;flex:1">
<div style="font:600 24px ui-monospace,Menlo,monospace;letter-spacing:2px;color:#5b6a7d;margin-bottom:28px">QUINVIUM · QU</div>
<div style="font-size:76px;font-weight:750;letter-spacing:-2.5px;line-height:1.02;margin-bottom:28px">The blockchain mined<br>on graphics cards</div>
<div style="font-size:28px;color:#3b4a5e">Proof-of-Work · EVM · GPU mining · No premine</div>
</div>
<svg width="460" height="460" viewBox="0 0 400 400" style="margin-right:40px">
<polygon points="200.0,20.0 355.9,110.0 355.9,290.0 200.0,380.0 44.1,290.0 44.1,110.0" fill="#e9f1fb"/>
<polygon points="200.0,90.0 295.3,145.0 295.3,255.0 200.0,310.0 104.7,255.0 104.7,145.0" fill="#0b1622"/>
<g transform="translate(150 150) scale(1.5625)"><path d="${mark}" fill="#ffcd02"/></g></svg>
</body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(og); await p.screenshot({ path: join(here, 'og.png') });
await p.setViewportSize({ width: 180, height: 180 });
await p.setContent(`<html><body style="margin:0;background:#0b1622">${logo.replace('width="64" height="64"', 'width="180" height="180"')}</body></html>`);
await p.screenshot({ path: join(here, 'apple-touch-icon.png') });
await b.close();
console.log('og.png a apple-touch-icon.png hotové');
