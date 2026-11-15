#!/usr/bin/env node
// Builds the static quinvium.com website into packages/website/public.
// Run: node packages/website/src/build.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPLORER, SITE, icon, pages } from './pages.mjs';
import { existsSync } from 'node:fs';
import { markdown } from './markdown.mjs';
import { translateHtml } from './translate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public');
const LANGS = { en: '' };   // the site is written in English; the other languages are translated from the finished pages below
// Languages of the site, as in the Explorer. Each one lives under /<code>/ and is made from i18n/<code>.json.
const SITE_LANGS = { en: 'English', cs: 'Čeština', de: 'Deutsch', es: 'Español', fr: 'Français', ja: '日本語', zh: '中文', ar: 'العربية' };
const OG_LOCALE = { en: 'en_US', cs: 'cs_CZ', de: 'de_DE', es: 'es_ES', fr: 'fr_FR', ja: 'ja_JP', zh: 'zh_CN', ar: 'ar_AR' };
const RTL = new Set(['ar']);
const langPath = (l, path) => (l === 'en' ? path : `/${l}${path}`);
const built = [];
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

/**
 * Structured data for search engines. Quinvium is a network, not a company: a WebSite on every page,
 * the download page also describes the app as SoftwareApplication. "<" is escaped so no text can close the script tag.
 */
function ldJson(p, path, dl) {
  const site = { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'Quinvium', url: `${SITE}/`, description: 'A programmable proof-of-work blockchain mined on graphics cards.', inLanguage: 'en', sameAs: ['https://github.com/Lakylife/quinvium', 'https://x.com/Quinvium', 'https://t.me/Quinvium'] };
  const page = { '@type': 'WebPage', '@id': `${SITE}${path}#page`, url: `${SITE}${path}`, name: p.title, description: p.desc, isPartOf: { '@id': `${SITE}/#website` }, inLanguage: 'en' };
  const graph = [site, page];
  if (p.slug === 'download' && dl) {
    graph.push({
      '@type': 'SoftwareApplication', name: 'Quinvium', applicationCategory: 'FinanceApplication', operatingSystem: 'macOS 13+, Windows 10, Windows 11',
      softwareVersion: dl.version, downloadUrl: `${SITE}${path}`, license: 'https://opensource.org/licenses/MIT', isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: 'Wallet, full node, GPU mining, Explorer and Swap for the Quinvium network.',
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

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
<!--alternates-->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Quinvium">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Quinvium: the blockchain mined on graphics cards">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@Quinvium">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="${SITE}/og.png">
<script type="application/ld+json">${ldJson(p, path, dl)}</script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
<script src="/theme.js"></script>
<script src="/site.js" defer></script>
</head>
<body data-lang="${lang}">
<a class="skip" href="#main">${L('Přeskočit na obsah', 'Skip to content')}</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${u('')}"><img src="/logo.svg" alt="" width="30" height="30"><span>Quinvium</span></a>
    <nav class="nav" id="nav" aria-label="Main menu"><div class="nav-in">${nav}</div><a class="btn primary lg nav-dl" href="${u('download')}">Download${ARROW}</a></nav>
    <div class="tools">
      <div class="lang-menu" data-lang-menu><button type="button" class="tool-btn" aria-expanded="false" aria-controls="langs" aria-label="Language">${icon('globe')}<span class="lang-code" translate="no">EN</span></button><!--langmenu--></div>
      <button type="button" class="tool-btn theme-btn" data-theme-toggle aria-label="Switch between light and dark mode" title="Switch between light and dark mode"><span class="sun">${icon('sun')}</span><span class="moon">${icon('moon')}</span></button>
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
        <div><h4>Mine &amp; build</h4>${foot(['mining', 'developers'])}<a href="${EXPLORER}/api">Documentation and API</a><a href="https://testnet.quinvium.com">Testnet</a></div>
        <div><h4>Community</h4><a href="https://x.com/Quinvium" rel="me">X (Twitter)</a><a href="https://t.me/Quinvium" rel="me">Telegram</a><a href="${GITHUB}">GitHub</a><a href="${GITHUB}/releases">Releases</a><a href="${GITHUB}/issues">Report an issue</a>${foot(['security', 'contact'])}</div>
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
    // Sections slide in as they scroll into view (site.js); the hero and the page heading are there right away.
    built.push({ path, html: html.replace(/<section class="sec"/g, '<section class="sec reveal"') });
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

// Every page in every language. English is the original; the others come from the translation dictionaries.
const dicts = Object.fromEntries(Object.keys(SITE_LANGS).filter((l) => l !== 'en').map((l) => {
  const f = join(here, 'i18n', `${l}.json`);
  return [l, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}];
}));
const missing = Object.fromEntries(Object.keys(dicts).map((l) => [l, new Set()]));
const langMenu = (cur, path) => `<div class="lang-panel" id="langs" role="menu" translate="no">${Object.entries(SITE_LANGS).map(([l, name]) =>
  `<a role="menuitem" href="${langPath(l, path)}" hreflang="${l}" lang="${l}" data-l${l === cur ? ' aria-current="true"' : ''}>${name}<small>${l}</small></a>`).join('')}</div>`;
const alternates = (path) => [...Object.keys(SITE_LANGS).map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}${langPath(l, path)}">`), `<link rel="alternate" hreflang="x-default" href="${SITE}${path}">`].join('\n');
/** Links inside the site point to the same language. Files (.pdf, .png …), downloads and the language menu stay as they are. */
const localize = (html, l) => html.replace(/<a\b[^>]*>/g, (tag) => (/\sdata-l\b/.test(tag) ? tag : tag.replace(/href="\/(?!\/)([^"]*)"/, (m, rest) => {
  if (rest.startsWith('downloads/') || /\.[a-z0-9]+($|[?#])/i.test(rest.split('#')[0])) return m;
  return `href="/${l}/${rest}"`;
})));
for (const { path, html } of built) {
  for (const l of Object.keys(SITE_LANGS)) {
    let page = l === 'en' ? html : translateHtml(html, dicts[l], missing[l]);
    if (l !== 'en') {
      page = localize(page, l)
        .replace('<html lang="en">', `<html lang="${l}"${RTL.has(l) ? ' dir="rtl"' : ''}>`)
        .replace(`<link rel="canonical" href="${SITE}${path}">`, `<link rel="canonical" href="${SITE}${langPath(l, path)}">`)
        .replace(`<meta property="og:url" content="${SITE}${path}">`, `<meta property="og:url" content="${SITE}${langPath(l, path)}">`)
        .replace('<meta property="og:locale" content="en_US">', `<meta property="og:locale" content="${OG_LOCALE[l]}">`)
        .replace('<body data-lang="en">', `<body data-lang="${l}">`)
        .replace('<span class="lang-code" translate="no">EN</span>', `<span class="lang-code" translate="no">${l.toUpperCase()}</span>`)
        .replace(/"inLanguage":"en"/g, `"inLanguage":"${l}"`);
      urls.push(langPath(l, path));
    }
    page = page.replace('<!--alternates-->', alternates(path)).replace('<!--langmenu-->', langMenu(l, path));
    const dir = join(out, langPath(l, path));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), page);
  }
}
for (const [l, set] of Object.entries(missing)) if (set.size) console.warn(`${l}: ${set.size} texts without a translation (they stay in English)`);

writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
const lastmod = new Date().toISOString().slice(0, 10);
const english = built.map((b) => b.path);
const xlinks = (path) => Object.keys(SITE_LANGS).map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${langPath(l, path)}"/>`).join('');
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${english.flatMap((path) => Object.keys(SITE_LANGS).map((l) => `  <url><loc>${SITE}${langPath(l, path)}</loc><lastmod>${lastmod}</lastmod><priority>${path === '/' ? '1.0' : '0.8'}</priority>${xlinks(path)}</url>`)).join('\n')}\n</urlset>\n`);
for (const f of ['site.css', 'site.js', 'theme.js', 'logo.svg', 'Quinvium-Symbol.ttf']) copyFileSync(join(here, f), join(out, f));
copyFileSync(join(here, 'logo.svg'), join(out, 'favicon.svg'));
for (const f of ['og.png', 'apple-touch-icon.png', 'quinvium-whitepaper.pdf']) { try { copyFileSync(join(here, f), join(out, f)); } catch { console.warn(`chybí ${f}, spusťte node src/og.mjs`); } }
console.log(`Hotovo: ${urls.length} stránek v ${out}`);
