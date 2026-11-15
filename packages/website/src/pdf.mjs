// Creates src/quinvium-whitepaper.pdf from docs/WHITEPAPER.md: a cover with the mark, key facts and contents,
// then the paper with a running header (mark, title, version) and page numbers. Needs Playwright (Chromium 131+ for
// CSS page-margin boxes). The text is the same as on quinvium.com/whitepaper/; only the print layout differs.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdown } from './markdown.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', '..', '..', 'docs', 'WHITEPAPER.md'), 'utf8');
const { html: rendered, toc } = markdown(source);

// The heading and the lines above "Abstract" become the cover and the facts box; the paper starts with Abstract.
const start = rendered.indexOf('<h2');
const body = rendered.slice(start);
const version = /version ([\d.]+)/i.exec(source)?.[1] ?? '1.0';
const date = /version [\d.]+ · ([^*\n]+)/i.exec(source)?.[1]?.trim() ?? '';
const genesis = /Genesis hash: `([^`]+)`/.exec(source)?.[1] ?? '';
const launch = /Mainnet genesis: ([^\n]+)/.exec(source)?.[1]?.trim() ?? '';

const MARK_PATH = 'M26.33 36.92L28.75 39.63L37.24 48.48L46.52 58.68L58.57 58.68L46.87 45.48L40.38 38.28L39.46 37.49L38.88 37.14L38.03 36.92L30.54 36.92L30.47 36.85L30.32 36.92L28.9 36.92L28.83 36.85L28.68 36.92ZM32.39 2.75L30.75 2.75L30.04 2.89L29.04 3.18L28.04 3.68L18.55 9.88L8.64 16.59L7.71 17.23L7.21 17.8L6.57 18.66L5.78 20.16L5.64 20.73L5.43 21.8L5.43 42.42L5.71 43.99L6.35 45.55L6.99 46.41L8.28 47.7L15.34 52.4L27.4 60.39L28.54 60.96L29.9 61.25L32.04 61.18L32.89 60.96L34.1 60.39L41.31 55.19L35.82 49.05L35.6 49.12L32.61 51.26L31.82 51.69L31.46 51.83L30.47 51.83L29.61 51.48L21.26 45.77L15.98 42.27L15.27 41.49L14.84 40.63L14.56 39.56L14.56 25.15L14.7 24.51L15.06 23.65L15.34 23.3L16.2 22.44L26.33 15.73L30.39 13.02L31.39 12.74L31.82 12.74L32.61 12.95L34.89 14.38L38.6 16.95L46.09 21.94L47.37 23.08L47.73 23.8L47.94 24.87L47.94 40.2L47.73 41.42L47.37 42.13L46.52 42.92L51.94 48.98L52.08 49.19L52.23 49.19L54.51 47.62L55.36 46.98L55.94 46.41L56.86 44.98L57.15 44.2L57.43 42.7L57.43 21.8L57.22 20.59L56.93 19.66L56.36 18.59L55.79 17.8L54.94 16.95L53.22 15.73L38.88 6.1L34.68 3.46L33.82 3.04Z';
const mark = (size, bg = '#0B1622') => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14.4" fill="${bg}"/><path transform="translate(7.13 7.13) scale(0.78)" d="${MARK_PATH}" fill="#FFCD02"/></svg>`;
const markUri = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 64 64"><rect width="64" height="64" rx="14.4" fill="#0B1622"/><path transform="translate(7.13 7.13) scale(0.78)" d="${MARK_PATH}" fill="#FFCD02"/></svg>`).toString('base64')}`;
const hex = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = ((-90 + i * 60) * Math.PI) / 180; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const FACTS = [
  ['Ticker', 'QU'], ['Consensus', 'Proof-of-Work, Ethash'], ['Execution', 'Ethereum Virtual Machine'],
  ['Block time', '15 s target, LWMA difficulty'], ['Block reward', '4 QU, halving every 8,000,000 blocks'], ['Supply cap', '64,000,000 QU, no premine'],
  ['Fees', 'Not burned, all to the miner'], ['Mainnet chain ID', '52401'], ['Launch', launch],
];

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quinvium whitepaper ${esc(version)}</title><style>
@page { size: A4; margin: 24mm 20mm 22mm 20mm;
  @top-left { content: url("${markUri}") "  Quinvium Whitepaper"; font: 600 8.5pt/1 "Helvetica Neue", Arial, sans-serif; color: #0b1622; vertical-align: bottom; padding-bottom: 6mm; }
  @top-right { content: "Version ${esc(version)} · ${esc(date)}"; font: 8pt/1 "Helvetica Neue", Arial, sans-serif; color: #6b7a8d; vertical-align: bottom; padding-bottom: 6mm; }
  @bottom-left { content: "quinvium.com"; font: 8pt/1 "Helvetica Neue", Arial, sans-serif; color: #6b7a8d; vertical-align: top; padding-top: 6mm; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 600 8pt/1 "Helvetica Neue", Arial, sans-serif; color: #0b1622; vertical-align: top; padding-top: 6mm; }
}
@page :first { margin: 0; @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1d2a3a; font: 10.4pt/1.62 "Helvetica Neue", Arial, sans-serif; }
.cover { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #0b1622; color: #fff; break-after: page; }
.cover svg.art { position: absolute; inset: 0; width: 100%; height: 100%; }
.cover .art polygon { fill: none; stroke: rgba(255, 255, 255, .07); stroke-width: 1.2; }
.cover .art .solid { fill: rgba(255, 255, 255, .025); }
.cover .inner { position: absolute; inset: 0; padding: 30mm 22mm; display: flex; flex-direction: column; }
.cover .brand { display: flex; align-items: center; gap: 5mm; }
.cover .brand b { font-size: 15pt; letter-spacing: .02em; }
.cover .hero { margin-top: auto; }
.cover .kicker { color: #ffcd02; font-size: 10pt; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; }
.cover h1 { margin: 5mm 0 6mm; font-size: 46pt; line-height: 1.02; letter-spacing: -.02em; font-weight: 800; }
.cover .sub { max-width: 130mm; color: #c9d4e2; font-size: 14pt; line-height: 1.45; }
.cover .meta { display: flex; gap: 10mm; margin-top: 16mm; padding-top: 6mm; border-top: 1px solid rgba(255, 255, 255, .14); color: #9fb0c4; font-size: 9pt; }
.cover .meta b { display: block; color: #fff; font-size: 10.5pt; margin-top: 1mm; }
.cover .big-mark { position: absolute; top: 46mm; right: 22mm; }
.front { break-after: page; }
.front h2 { margin: 0 0 6mm; font-size: 20pt; letter-spacing: -.01em; }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10mm; margin: 0 0 9mm; padding: 4mm 6mm; border-radius: 4mm; background: #f2f5f9; }
.facts div { padding: 2.6mm 0; border-bottom: 1px solid #e1e7ef; }
.facts div:nth-last-child(-n+1) { border-bottom: 0; }
.facts span { display: block; color: #6b7a8d; font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; }
.facts b { font-size: 10pt; }
.genesis { margin: -4mm 0 10mm; padding: 3mm 6mm; border-radius: 3mm; background: #0b1622; color: #c9d4e2; font: 8.4pt/1.5 Menlo, Consolas, monospace; word-break: break-all; }
.genesis span { display: block; color: #ffcd02; font: 700 7.5pt/1.4 "Helvetica Neue", Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.contents ol { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 10mm; }
.contents li { break-inside: avoid; padding: 1.8mm 0; border-bottom: 1px solid #e8edf3; font-size: 10pt; }
.contents li span { display: inline-block; min-width: 9mm; color: #0b63c4; font-weight: 700; }
.paper h2 { margin: 12mm 0 4mm; padding-top: 3mm; border-top: 2px solid #0b1622; font-size: 17pt; line-height: 1.2; letter-spacing: -.01em; break-after: avoid; }
.paper h2:first-child { margin-top: 0; }
.paper h3 { margin: 7mm 0 2mm; font-size: 12pt; color: #0b1622; break-after: avoid; }
.paper p { margin: 0 0 3.2mm; orphans: 3; widows: 3; }
.paper ul, .paper ol { margin: 0 0 4mm; padding-left: 6mm; }
.paper li { margin: 0 0 1.4mm; }
.paper li::marker { color: #0b63c4; }
.paper strong { color: #0b1622; }
.paper a { color: #0b63c4; text-decoration: none; }
.paper code { padding: .2mm 1.2mm; border-radius: 1mm; background: #eef2f7; color: #0b1622; font: 8.8pt Menlo, Consolas, monospace; word-break: break-word; }
.paper pre { margin: 3mm 0 5mm; padding: 4mm 5mm; border-radius: 3mm; background: #0b1622; color: #dbe5f1; font: 8.6pt/1.55 Menlo, Consolas, monospace; white-space: pre-wrap; break-inside: avoid; }
.paper pre code { padding: 0; background: none; color: inherit; font: inherit; }
.wp-table { margin: 3mm 0 6mm; break-inside: avoid; }
.wp-table table { width: 100%; border-collapse: collapse; font-size: 9pt; }
.wp-table th { padding: 2.2mm 3mm; background: #0b1622; color: #fff; font-weight: 600; text-align: left; }
.wp-table th:first-child { border-radius: 2mm 0 0 0; } .wp-table th:last-child { border-radius: 0 2mm 0 0; }
.wp-table td { padding: 2mm 3mm; border-bottom: 1px solid #e3e9f0; vertical-align: top; }
.wp-table tr:nth-child(even) td { background: #f6f8fb; }
.end { margin-top: 12mm; padding: 6mm; border-radius: 4mm; background: #f2f5f9; display: flex; gap: 5mm; align-items: center; break-inside: avoid; color: #3b4a5e; font-size: 9.5pt; }
</style></head><body>
<section class="cover">
  <svg class="art" viewBox="0 0 210 297" preserveAspectRatio="xMidYMid slice"><polygon class="solid" points="${hex(150, 95, 70)}"/><polygon points="${hex(150, 95, 92)}"/><polygon points="${hex(150, 95, 115)}"/><polygon points="${hex(30, 250, 40)}"/><polygon points="${hex(30, 250, 58)}"/></svg>
  <div class="big-mark">${mark(170)}</div>
  <div class="inner">
    <div class="brand">${mark(40)}<b>Quinvium</b></div>
    <div class="hero">
      <div class="kicker">Whitepaper</div>
      <h1>Quinvium</h1>
      <div class="sub">A programmable proof-of-work network for GPU miners</div>
      <div class="meta"><div>Version<b>${esc(version)}</b></div><div>Published<b>${esc(date)}</b></div><div>Network<b>Mainnet · chain ID 52401</b></div><div>Web<b>quinvium.com</b></div></div>
    </div>
  </div>
</section>
<section class="front">
  <h2>Key facts</h2>
  <div class="facts">${FACTS.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
  ${genesis ? `<div class="genesis"><span>Mainnet genesis hash</span>${esc(genesis)}</div>` : ''}
  <div class="contents"><h2>Contents</h2><ol>${toc.map(([, t]) => { const m = /^(\d+)\.\s+(.*)$/.exec(t); return `<li><span>${m ? esc(m[1]) : '·'}</span>${esc(m ? m[2] : t)}</li>`; }).join('')}</ol></div>
</section>
<main class="paper">${body}
<div class="end">${mark(34)}<div><b>Quinvium</b> is open-source software under the MIT license. Source code, releases and the reference node: github.com/Lakylife/quinvium. Where this paper and the code differ, the code defines the network.</div></div>
</main>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(page, { waitUntil: 'load' });
await p.emulateMedia({ media: 'print' });
await p.pdf({ path: join(here, 'quinvium-whitepaper.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true, outline: true, tagged: true });
await b.close();
console.log('quinvium-whitepaper.pdf hotové');
