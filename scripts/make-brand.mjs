#!/usr/bin/env node
// Quinvium logo and icons. Everything comes from one shape so the logo never diverges. Run: node scripts/make-brand.mjs
// The mark is the letter Q drawn as a hexagon with a cut-through tail. Its outline comes from assets/brand/Quinvium-Symbol.ttf
// (glyph "quinvium", mapped to Q and U+E000), so the logo, the icons and the currency symbol QU stay one shape.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');
const GOLD = '#FFCD02';
const NIGHT = '#0B1622';
const f = (n) => +n.toFixed(2);

// Outline of the glyph in font units (1000 per em, y pointing up), copied from Quinvium-Symbol.ttf.
const GLYPH = 'M358 411 392 373 511 249 641 106H810L646 291L555 392L542 403L534 408L522 411H417L416 412L414 411H394L393 412L391 411ZM443 890H420L410 888L396 884L382 877L249 790L110 696L97 687L90 679L81 667L70 646L68 638L65 623V334L69 312L78 290L87 278L105 260L204 194L373 82L389 74L408 70L438 71L450 74L467 82L568 155L491 241L488 240L446 210L435 204L430 202H416L404 207L287 287L213 336L203 347L197 359L193 374V576L195 585L200 597L204 602L216 614L358 708L415 746L429 750H435L446 747L478 727L530 691L635 621L653 605L658 595L661 580V365L658 348L653 338L641 327L717 242L719 239H721L753 261L765 270L773 278L786 298L790 309L794 330V623L791 640L787 653L779 668L771 679L759 691L735 708L534 843L475 880L463 886Z';

/** Contours of the glyph as lists of points; only M, L, H, V and Z occur in it. */
function contours(d) {
  const out = [];
  let cur = null, x = 0, y = 0, cmd = '';
  const t = d.match(/[MLHVZ]|-?[\d.]+/g);
  for (let i = 0; i < t.length;) {
    if (/[MLHVZ]/.test(t[i])) { cmd = t[i++]; if (cmd === 'Z') { out.push(cur); cur = null; } continue; }
    if (cmd === 'M') { x = +t[i++]; y = +t[i++]; cur = [[x, y]]; cmd = 'L'; }
    else if (cmd === 'L') { x = +t[i++]; y = +t[i++]; cur.push([x, y]); }
    else if (cmd === 'H') { x = +t[i++]; cur.push([x, y]); }
    else { y = +t[i++]; cur.push([x, y]); }
  }
  return out;
}

/** The glyph scaled to height h and centred on (cx, cy) in a 64 x 64 box. */
export function markPath(h = 58.5, cx = 32, cy = 32) {
  const c = contours(GLYPH);
  const xs = c.flat().map((p) => p[0]), ys = c.flat().map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = h / (y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return c.map((k) => `M${k.map(([x, y]) => `${f(cx + (x - mx) * s)} ${f(cy - (y - my) * s)}`).join('L')}Z`).join('');
}

const MARK = markPath();
const COIN_MARK = markPath(39.3);
const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>`;
const placed = (x, y, scale, path, fill) => `<path transform="translate(${x} ${y}) scale(${scale})" d="${path}" fill="${fill}"/>`;

export const SHAPES = { mark: MARK, coin: COIN_MARK };
const brandMark = (fill) => svg(64, `<path d="${MARK}" fill="${fill}"/>`);
const brandCoin = svg(64, `<circle cx="32" cy="32" r="30" fill="${GOLD}"/><path d="${COIN_MARK}" fill="${NIGHT}"/>`);

/** Tile: dark night and the gold mark. share says how much of the tile height the mark takes; small icons need a larger mark. */
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
writeFileSync(join(brand, 'quinvium-logo.svg'), brandMark(GOLD));
writeFileSync(join(brand, 'quinvium-coin.svg'), brandCoin);
for (const dir of [join(root, 'packages', 'website', 'src')]) copyFileSync(join(brand, 'Quinvium-Symbol.ttf'), join(dir, 'Quinvium-Symbol.ttf'));
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

// macOS: icon with a margin according to the system grid.
const work = mkdtempSync(join(tmpdir(), 'quintium-ikony-'));
const set = join(work, 'icon.iconset');
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  await png(macTile(s), s, join(set, `icon_${s}x${s}.png`));
  await png(macTile(s * 2), s * 2, join(set, `icon_${s}x${s}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(desktop, 'icon.icns')]);

// Windows: no margin and a larger mark at small sizes, otherwise it would get lost in the taskbar.
const win = join(work, 'win');
mkdirSync(win);
for (const s of [16, 24, 32, 48, 64, 128, 256]) await png(tile(s, { radius: 0.2, share: s <= 32 ? 0.8 : 0.66 }), s, join(win, `${s}.png`));
execFileSync(process.execPath, [join(root, 'packages', 'desktop', 'scripts', 'make-ico.mjs'), win], { stdio: 'inherit' });

// Browser extension.
for (const s of [16, 48, 128, 256]) await png(tile(s, { radius: 0.2, share: s === 16 ? 0.8 : 0.66 }), s, join(root, 'packages', 'extension', 'icons', `${s}.png`));
copyFileSync(join(desktop, 'icon.png'), join(brand, 'quintium-ikona-aplikace.png'));
await png(brandMark(GOLD), 1024, join(brand, 'quinvium-logo.png'));
await png(svg(1024, `<rect width="1024" height="1024" fill="#000"/>${placed(64, 64, 14, MARK, GOLD)}`), 1024, join(brand, 'quinvium-logo-black.png'));
await png(brandCoin, 512, join(brand, 'quinvium-coin.png'));
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log('Cesta znaku:', MARK);
console.log('Cesta znaku v minci:', COIN_MARK);
console.log('Velikost icon.png:', readFileSync(join(desktop, 'icon.png')).length);
