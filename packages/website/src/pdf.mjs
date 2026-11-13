// Vytvoří src/quinvium-whitepaper.pdf ze sestavené stránky /whitepaper/ (nejdřív spusťte build.mjs). Potřebuje Playwright.
import { chromium } from 'playwright';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let f = join(root, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; if (!existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[extname(f)] || 'text/plain' }); r.end(readFileSync(f)); });
await new Promise((ok) => srv.listen(8620, ok));
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://127.0.0.1:8620/whitepaper/', { waitUntil: 'networkidle' });
await p.emulateMedia({ media: 'print' });
await p.pdf({
  path: join(here, 'quinvium-whitepaper.pdf'), format: 'A4', printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;color:#5b6a7d;width:100%;text-align:center">Quinvium whitepaper 1.0 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await b.close(); srv.close();
console.log('quinvium-whitepaper.pdf hotové');
