#!/usr/bin/env node
// Builds the static quinvium.com website into packages/website/public.
// Run: node packages/website/src/build.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPLORER, SITE, icon, pages } from './pages.mjs';
import { existsSync } from 'node:fs';
import { markdown } from './markdown.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public');
const LANGS = { en: '' };   // the site is English only (user's request, 13 Nov 2026); the content in pages.mjs also has Czech in case it comes back
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const urls = [];
// Main menu: groups with a dropdown panel; each item has an icon and a short description.
const NAV = [
  ['Learn', [['about', 'globe', 'What Quinvium is and how it launched'], ['whitepaper', 'file', 'Design, consensus and monetary policy'], ['tokenomics', 'coins', 'Supply, rewards and fees'], ['security', 'shield', 'Status, reviews and risks'], ['roadmap', 'layers', 'What is done and what is next'], ['faq', 'vote', 'Short answers to common questions']]],
  ['Use', [['wallets', 'wallet', 'Wallets and adding the network'], ['ecosystem', 'cube', 'Built-in apps, Swap and tools'], ['download', 'arrowdown', 'Apps for macOS, Windows and Chrome']]],
  ['Mine', [['mining', 'pick', 'Mine QU on a graphics card']]],
  ['Build', [['developers', 'code', 'Guide, RPC and contract addresses'], ['@params', 'chip', 'Chain IDs, RPC and seeds'], ['@testnet', 'bolt', 'Test network with tQU']]],
];
const GITHUB = 'https://github.com/Lakylife/quinvium';
const GH = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>';
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
  <div class="wrap">
    <div class="foot-top">
      <div class="foot-brand">
        <a class="brand" href="${u('')}"><img src="/logo.svg" alt="" width="36" height="36"><span>Quinvium</span></a>
        <p>A programmable proof-of-work blockchain. Mined on graphics cards, open to everyone, owned by no one.</p>
        <div class="foot-chips"><span>Chain ID 52401</span><span>QU</span><span>Proof-of-Work + EVM</span></div>
        <div class="foot-actions">
          <button type="button" class="btn secondary md" data-add="main">Add to MetaMask</button>
          <a class="btn secondary md" href="${GITHUB}">${GH}Source code</a>
        </div>
        <p class="msg" data-add-msg></p>
      </div>
      <nav class="foot-cols" aria-label="Footer">
        <div><h4>Learn</h4>${foot(['about', 'whitepaper', 'tokenomics', 'roadmap', 'faq'])}</div>
        <div><h4>Use</h4>${foot(['wallets', 'download', 'ecosystem'])}<a href="${EXPLORER}">Explorer</a></div>
        <div><h4>Mine &amp; build</h4>${foot(['mining', 'developers'])}<a href="${EXPLORER}/docs">Documentation</a><a href="https://testnet.quinvium.com">Testnet</a></div>
        <div><h4>Community</h4><a href="${GITHUB}">GitHub</a><a href="${GITHUB}/releases">Releases</a><a href="${GITHUB}/issues">Report an issue</a>${foot(['security', 'contact'])}</div>
      </nav>
    </div>
    <div class="foot-status" data-foot-status><span class="dot" data-foot-dot></span><span data-foot-text>Mainnet</span><span class="sep">·</span><a href="https://rpc.quinvium.com/health">rpc.quinvium.com</a></div>
    <div class="foot-base">
      <span>Open, decentralised software. No company, no owner. <a href="${GITHUB}/blob/main/LICENSE">MIT License</a>.</span>
      <span><a href="${u('legal')}">Disclaimer</a> · No cookies, no tracking.</span>
    </div>
  </div>
</footer>
</body>
</html>
`;
    const dir = join(out, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
  }

  // 404 in both languages on one page (Caddy returns it for unknown paths)
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
