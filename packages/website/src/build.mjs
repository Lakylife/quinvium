#!/usr/bin/env node
// Sestaví statický web quinvium.com do packages/website/public: angličtina v kořeni, čeština pod /cs/.
// Spuštění: node packages/website/src/build.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPLORER, SITE, icon, pages } from './pages.mjs';
import { existsSync } from 'node:fs';
import { markdown } from './markdown.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public');
const LANGS = { en: '' };   // web je jen anglicky (přání uživatele 13. 11. 2026), obsah v pages.mjs má i češtinu pro případ návratu
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const urls = [];
// Hlavní nabídka: skupiny s rozbalovacím panelem, každá položka má ikonu a krátký popis.
const NAV = [
  ['Learn', [['about', 'globe', 'What Quinvium is and how it launched'], ['whitepaper', 'file', 'Design, consensus and monetary policy'], ['tokenomics', 'coins', 'Supply, rewards and fees'], ['security', 'shield', 'Status, reviews and risks'], ['roadmap', 'layers', 'What is done and what is next'], ['faq', 'vote', 'Short answers to common questions']]],
  ['Use', [['wallets', 'wallet', 'Wallets and adding the network'], ['ecosystem', 'cube', 'Built-in apps, Swap and tools'], ['download', 'arrowdown', 'Apps for macOS, Windows and Chrome']]],
  ['Mine', [['mining', 'pick', 'Mine QU on a graphics card']]],
  ['Build', [['developers', 'code', 'Guide, RPC and contract addresses'], ['@params', 'chip', 'Chain IDs, RPC and seeds'], ['@testnet', 'bolt', 'Test network with tQU']]],
];
const ARROW = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const EXT = '<svg class="ic ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

for (const [lang, prefix] of Object.entries(LANGS)) {
  const L = (cs, en) => (lang === 'cs' ? cs : en);
  const u = (slug) => `${prefix}/${slug ? `${slug}/` : ''}`;
  const dl = existsSync(join(here, 'downloads.json')) ? JSON.parse(readFileSync(join(here, 'downloads.json'), 'utf8')) : null;
  const list = pages(L, u, dl);
  // Whitepaper z docs/WHITEPAPER.md
  const wp = markdown(readFileSync(join(here, '..', '..', '..', 'docs', 'WHITEPAPER.md'), 'utf8'));
  const wpBody = wp.html.replace(/^<h1[^>]*>.*?<\/h1>\n?/, '');
  list.push({
    slug: 'whitepaper', label: 'Whitepaper',
    title: 'Quinvium whitepaper',
    desc: 'A programmable proof-of-work network for GPU miners: consensus, execution, monetary policy, built-in contracts, networking, security and roadmap.',
    lead: 'A programmable proof-of-work network for GPU miners. Version 1.0, 14 November 2026.',
    body: `<section class="sec"><div class="wrap wp-grid"><aside class="wp-toc"><p class="wp-toc-h">Contents</p>${wp.toc.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}<a class="btn secondary md wp-pdf" href="/quinvium-whitepaper.pdf" download>PDF</a></aside><article class="wp">${wpBody}</article></div></section>`,
  });
  const bySlug = Object.fromEntries(list.map((p) => [p.slug, p]));
  const other = (slug) => `${lang === 'cs' ? '' : '/cs'}/${slug ? `${slug}/` : ''}`;

  for (const p of list) {
    const path = u(p.slug);
    urls.push(path);
    const link = ([s, ic, d]) => {
      const href = s === '@params' ? `${u('developers')}#parameters` : s === '@testnet' ? 'https://testnet.quinvium.com' : u(s);
      const label = s === '@params' ? 'Network parameters' : s === '@testnet' ? 'Testnet' : bySlug[s].label;
      return `<a class="ni" href="${href}"${s === p.slug ? ' aria-current="page"' : ''}>${icon(ic)}<span><strong>${label}</strong><small>${d}</small></span></a>`;
    };
    const nav = NAV.map(([g, items], i) => {
      const here = items.some(([s]) => s === p.slug);
      if (items.length === 1) return `<div class="ng"><a class="ng-btn${here ? ' here' : ''}" href="${u(items[0][0])}"${here ? ' aria-current="page"' : ''}>${g}</a></div>`;
      return `<div class="ng"><button type="button" class="ng-btn${here ? ' here' : ''}" aria-expanded="false" aria-controls="ng${i}">${g}${CHEV}</button><div class="ng-panel" id="ng${i}">${items.map(link).join('')}</div></div>`;
    }).join('') + `<div class="ng"><a class="ng-btn" href="${EXPLORER}">Explorer${EXT}</a></div>`;
    const foot = (slugs) => slugs.map((s) => `<a href="${u(s)}">${bySlug[s].label}</a>`).join('');
    const head = p.hero ? '' : `<section class="page-head"><div class="wrap"><h1>${p.title}</h1>${p.lead ? `<p class="lead">${p.lead}</p>` : ''}</div></section>`;
    const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.hero ? p.title : `${p.title} · Quinvium`)}</title>
<meta name="description" content="${esc(p.desc)}">
<meta name="theme-color" content="#0b1622">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Quinvium">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
</head>
<body data-lang="${lang}">
<a class="skip" href="#main">${L('Přeskočit na obsah', 'Skip to content')}</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${u('')}"><img src="/logo.svg" alt="" width="30" height="30"><span>Quinvium</span></a>
    <nav class="nav" id="nav" aria-label="Main menu"><div class="nav-in">${nav}</div><a class="btn primary lg nav-dl" href="${u('download')}">Download${ARROW}</a></nav>
    <div class="tools">
      <a class="btn primary md head-dl" href="${u('download')}">Download${ARROW}</a>
      <button class="menu" id="menu" aria-label="${L('Nabídka', 'Menu')}" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>
<main id="main">
${head}
${p.body}
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <div class="foot-brand">
      <a class="brand" href="${u('')}"><img src="/logo.svg" alt="" width="28" height="28"><span>Quinvium</span></a>
      <p>${L('Programovatelný blockchain s Proof-of-Work. Experimentální software, používejte na vlastní riziko.', 'A programmable proof-of-work blockchain. Experimental software, use at your own risk.')}</p>
    </div>
    <div><h4>${L('Síť', 'Network')}</h4>${foot(['about', 'whitepaper', 'tokenomics', 'mining', 'roadmap'])}</div>
    <div><h4>${L('Použití', 'Use')}</h4>${foot(['wallets', 'ecosystem', 'download'])}<a href="${EXPLORER}">Explorer</a></div>
    <div><h4>${L('Vývoj', 'Build')}</h4>${foot(['developers'])}<a href="${EXPLORER}/docs">${L('Dokumentace', 'Docs')}</a><a href="https://testnet.quinvium.com">Testnet</a></div>
    <div><h4>Quinvium</h4>${foot(['security', 'faq', 'legal', 'contact'])}</div>
  </div>
  <div class="wrap foot-base"><span>Quinvium is open, decentralised software. No company, no owner.</span><span>${L('Bez cookies a sledování.', 'No cookies, no tracking.')}</span></div>
</footer>
</body>
</html>
`;
    const dir = join(out, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
  }

  // 404 v obou jazycích na jedné stránce (Caddy ji vrací pro neznámé adresy)
  if (lang === 'en') {
    writeFileSync(join(out, '404.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · Quinvium</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"></head>
<body><main class="notfound"><div class="wrap"><img src="/logo.svg" alt="Quinvium" width="64" height="64"><h1>404</h1>
<p>This page does not exist.</p>
<p class="row-btns"><a class="btn primary lg" href="/">Home</a><a class="btn secondary lg" href="${EXPLORER}">Explorer</a></p></div></main></body></html>
`);
  }
}

writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
for (const f of ['site.css', 'site.js', 'logo.svg']) copyFileSync(join(here, f), join(out, f));
copyFileSync(join(here, 'logo.svg'), join(out, 'favicon.svg'));
for (const f of ['og.png', 'apple-touch-icon.png', 'quinvium-whitepaper.pdf']) { try { copyFileSync(join(here, f), join(out, f)); } catch { console.warn(`chybí ${f}, spusťte node src/og.mjs`); } }
console.log(`Hotovo: ${urls.length} stránek v ${out}`);
