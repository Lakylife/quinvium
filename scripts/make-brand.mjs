#!/usr/bin/env node
// Logo a ikony Quinvium. Vše vzniká z jednoho tvaru, aby se logo nikde nerozešlo. Spuštění: node scripts/make-brand.mjs
// Znak je písmeno Q z pětiúhelníku: pět stran pro pátou esenci, aether. Ocásek vede po ose pátého vrcholu a vchází dovnitř, aby to nebyla lupa.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');
const GOLD = '#F2B544';
const NIGHT = '#0B1622';
const f = (n) => +n.toFixed(2);

/** Jedna cesta s výplní nonzero: vnější obrys po směru, vnitřní proti směru, ocásek zase po směru.
 * @param R poloměr pětiúhelníku, r poloměr vnitřního pětiúhelníku, w šířka ocásku */
export function markPath(R = 29, r = 14.5, w = 9.5, cx = 32, cy = 31.75) {
  const at = (radius, deg) => [cx + radius * Math.cos((deg * Math.PI) / 180), cy + radius * Math.sin((deg * Math.PI) / 180)];
  const pentagon = (radius) => [0, 1, 2, 3, 4].map((i) => at(radius, -90 + i * 72));
  const closed = (pts) => `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
  const AXIS = 54;     // osa pátého vrcholu
  const u = [Math.cos((AXIS * Math.PI) / 180), Math.sin((AXIS * Math.PI) / 180)];
  const side = [-u[1] * (w / 2), u[0] * (w / 2)];
  const [from, to] = [R * 0.207, R * 1.138];
  const tail = [[-1, from], [-1, to], [1, to], [1, from]].map(([s, d]) => [cx + u[0] * d + s * side[0], cy + u[1] * d + s * side[1]]);
  return `${closed(pentagon(R))}${closed(pentagon(r).reverse())}${closed(tail)}`;
}

const MARK = markPath();
const COIN_MARK = markPath(19.5, 9.75, 6.4, 32, 31.9);
const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>`;
const placed = (x, y, scale, path, fill) => `<path transform="translate(${x} ${y}) scale(${scale})" d="${path}" fill="${fill}"/>`;

export const SHAPES = { mark: MARK, coin: COIN_MARK };
const brandMark = (fill) => svg(64, `<path d="${MARK}" fill="${fill}"/>`);
const brandCoin = svg(64, `<circle cx="32" cy="32" r="30" fill="${GOLD}"/><path d="${COIN_MARK}" fill="${NIGHT}"/>`);

/** Dlaždice: tmavá noc a zlatý znak. share říká, kolik výšky dlaždice znak zabere, malé ikony potřebují větší znak. */
function tile(size, { margin = 0, radius = 0.225, share = 0.58 } = {}) {
  const inner = size - 2 * margin;
  const scale = (inner * share) / 56;
  const offset = size / 2 - 32 * scale;
  return svg(size, `<rect x="${margin}" y="${margin}" width="${inner}" height="${inner}" rx="${f(inner * radius)}" fill="${NIGHT}"/>${placed(f(offset), f(offset), f(scale), MARK, GOLD)}`);
}

const brand = join(root, 'assets', 'brand');
mkdirSync(brand, { recursive: true });
writeFileSync(join(brand, 'quintium-znak-zlaty.svg'), brandMark(GOLD));
writeFileSync(join(brand, 'quintium-znak-tmavy.svg'), brandMark(NIGHT));
writeFileSync(join(brand, 'quintium-mince.svg'), brandCoin);
writeFileSync(join(brand, 'quintium-ikona-aplikace.svg'), tile(1024, { margin: 100 }));
writeFileSync(join(root, 'packages', 'desktop', 'assets', 'logo.svg'), brandMark(GOLD));
writeFileSync(join(root, 'packages', 'explorer', 'public', 'coin.svg'), brandCoin);
writeFileSync(join(root, 'packages', 'explorer', 'public', 'logo.svg'), tile(64, { share: 0.68 }));

const browser = await chromium.launch();
async function png(markup, size, file) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}

const desktop = join(root, 'packages', 'desktop', 'assets');
const macTile = (s) => tile(s, { margin: s * 0.098 });
await png(macTile(1024), 1024, join(desktop, 'icon.png'));

// macOS: ikona s okrajem podle mřížky systému.
const work = mkdtempSync(join(tmpdir(), 'quintium-ikony-'));
const set = join(work, 'icon.iconset');
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  await png(macTile(s), s, join(set, `icon_${s}x${s}.png`));
  await png(macTile(s * 2), s * 2, join(set, `icon_${s}x${s}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(desktop, 'icon.icns')]);

// Windows: bez okraje a v malých velikostech s větším znakem, jinak by se v liště ztratil.
const win = join(work, 'win');
mkdirSync(win);
for (const s of [16, 24, 32, 48, 64, 128, 256]) await png(tile(s, { radius: 0.2, share: s <= 32 ? 0.8 : 0.66 }), s, join(win, `${s}.png`));
execFileSync(process.execPath, [join(root, 'packages', 'desktop', 'scripts', 'make-ico.mjs'), win], { stdio: 'inherit' });

// Rozšíření do prohlížeče.
for (const s of [16, 48, 128, 256]) await png(tile(s, { radius: 0.2, share: s === 16 ? 0.8 : 0.66 }), s, join(root, 'packages', 'extension', 'icons', `${s}.png`));
copyFileSync(join(desktop, 'icon.png'), join(brand, 'quintium-ikona-aplikace.png'));
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log('Cesta znaku:', MARK);
console.log('Cesta znaku v minci:', COIN_MARK);
console.log('Velikost icon.png:', readFileSync(join(desktop, 'icon.png')).length);
