// The website on phones, tablets and in landscape: no page may scroll sideways or have fields that make iOS zoom.
// Run: node packages/website/test/mobile.mjs (after node packages/website/src/build.mjs)
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPages } from '../../../scripts/mobile-check.mjs';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(pub, url);
  if (!file.startsWith(pub)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); res.end(readFileSync(join(pub, '404.html'))); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pages = ['/', ...readdirSync(pub).filter((d) => existsSync(join(pub, d, 'index.html'))).map((d) => `/${d}/`), '/missing-page'];
// Translated pages: longer German words, CJK and right-to-left Arabic on the pages with the widest content.
for (const l of ['de', 'ja', 'ar', 'fr']) for (const p of ['download', 'developers', 'tokenomics']) pages.push(`/${l}/${p}/`);
const problems = await checkPages(`http://127.0.0.1:${server.address().port}`, pages, { settle: 300, label: 'web' });
server.close();
for (const p of problems) console.log(`[FAIL] ${p}`);
console.log(problems.length ? `SOUHRN: ${problems.length} problémů na ${pages.length} stránkách` : `Vše prošlo: ${pages.length} stránek, 7 velikostí obrazovky`);
process.exit(problems.length ? 1 : 0);
