// quinvium.com: menu, live mainnet status, adding the network to a wallet, smooth reveal of sections.
(() => {
  // The network's own RPC nodes, in order. When none answers, community nodes take over: those listed by the network's
  // nodes (quinvium_publicNodes), those saved in this site's /nodes.json at each deploy and those remembered in this browser.
  // A community node is used only after it shows the mainnet chain ID and genesis, so the live data survives a server outage.
  const RPCS = ['https://rpc.quinvium.com'];
  const RPC = RPCS[0];
  const CHAIN_ID = '0xccb1';
  const GENESIS_HASH = '0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39';
  const COMMUNITY_KEY = 'quinvium.publicNodes.site';
  const NODE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
  const clean = (list) => (Array.isArray(list) ? list : []).map((n) => String(n?.url ?? n ?? '')).filter((u) => NODE_URL.test(u));
  const remembered = () => { try { return clean(JSON.parse(localStorage.getItem(COMMUNITY_KEY) ?? '[]')).slice(0, 16); } catch { return []; } };
  const remember = (urls) => { if (urls.length) try { localStorage.setItem(COMMUNITY_KEY, JSON.stringify([...new Set([...urls, ...remembered()])].slice(0, 16))); } catch { /* private window */ } };
  let rpcId = 1;
  let current = RPC;
  const verified = new Set(RPCS);
  const post = async (url, method, params = []) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }), signal: AbortSignal.timeout(8000) });
    return r.json();
  };
  /** A community node must be on mainnet: the same chain ID and the same genesis block. */
  const ours = async (url) => {
    if (verified.has(url)) return true;
    const [id, genesis] = await Promise.all([post(url, 'eth_chainId'), post(url, 'eth_getBlockByNumber', ['0x0', false])]);
    if (id.result !== CHAIN_ID || genesis.result?.hash !== GENESIS_HASH) return false;
    verified.add(url);
    return true;
  };
  // Saved with the site at each deploy (ops/pages/nodes.mjs), so a first visit during an outage also knows community nodes.
  const saved = fetch('/nodes.json', { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : {})).then((d) => clean(d?.[52401])).catch(() => []);
  /** One JSON-RPC call: the node in use, then the network's other nodes, then verified community nodes. */
  const send = async (method, params = []) => {
    for (const url of [...new Set([current, ...RPCS, ...remembered(), ...await saved])]) {
      try {
        if (!(await ours(url))) continue;
        const d = await post(url, method, params);
        current = url;
        return d;
      } catch { /* the next node */ }
    }
    throw new Error('no node answers');
  };
  // The list of community nodes is refreshed from whichever node answers, so it stays fresh even while the main server is down.
  const community = send('quinvium_publicNodes').then((d) => { const urls = clean(d?.result); remember(urls); return urls; }).catch(() => []);
  const GENESIS = 1794610800; // 14 Nov 2026 00:00 CET
  const lang = document.body.dataset.lang || 'en';
  // Texts the script writes itself, in every language of the site.
  const TEXT = {
    en: { none: 'No browser wallet found. Install MetaMask or use the Quinvium app.', ok: 'Network added.', no: 'The request was rejected in the wallet.', block: 'Mainnet · block #{n}', down: 'Mainnet · status unavailable', ago: '{t} ago', nodes: 'Community nodes online: {n}' },
    cs: { none: 'Peněženka v prohlížeči nenalezena. Nainstalujte MetaMask nebo použijte aplikaci Quinvium.', ok: 'Síť je přidaná.', no: 'Požadavek byl v peněžence odmítnut.', block: 'Mainnet · blok #{n}', down: 'Mainnet · stav nedostupný', ago: 'před {t}', nodes: 'Uzly komunity online: {n}' },
    de: { none: 'Keine Browser-Wallet gefunden. Installieren Sie MetaMask oder nutzen Sie die Quinvium-App.', ok: 'Netzwerk hinzugefügt.', no: 'Die Anfrage wurde in der Wallet abgelehnt.', block: 'Mainnet · Block #{n}', down: 'Mainnet · Status nicht verfügbar', ago: 'vor {t}', nodes: 'Community-Knoten online: {n}' },
    es: { none: 'No se encontró una cartera en el navegador. Instale MetaMask o use la app Quinvium.', ok: 'Red añadida.', no: 'La solicitud fue rechazada en la cartera.', block: 'Mainnet · bloque #{n}', down: 'Mainnet · estado no disponible', ago: 'hace {t}', nodes: 'Nodos de la comunidad en línea: {n}' },
    fr: { none: 'Aucun portefeuille de navigateur trouvé. Installez MetaMask ou utilisez l’app Quinvium.', ok: 'Réseau ajouté.', no: 'La demande a été refusée dans le portefeuille.', block: 'Mainnet · bloc #{n}', down: 'Mainnet · état indisponible', ago: 'il y a {t}', nodes: 'Nœuds de la communauté en ligne : {n}' },
    ja: { none: 'ブラウザーのウォレットが見つかりません。MetaMask をインストールするか、Quinvium アプリを使ってください。', ok: 'ネットワークを追加しました。', no: 'ウォレットでリクエストが拒否されました。', block: 'メインネット · ブロック #{n}', down: 'メインネット · 状態を取得できません', ago: '{t}前', nodes: 'オンラインのコミュニティノード: {n}' },
    zh: { none: '未找到浏览器钱包。请安装 MetaMask 或使用 Quinvium 应用。', ok: '网络已添加。', no: '请求在钱包中被拒绝。', block: '主网 · 区块 #{n}', down: '主网 · 状态不可用', ago: '{t}前', nodes: '在线社区节点：{n}' },
    ar: { none: 'لم يُعثر على محفظة في المتصفح. ثبّت MetaMask أو استخدم تطبيق Quinvium.', ok: 'أُضيفت الشبكة.', no: 'رُفض الطلب في المحفظة.', block: 'الشبكة الرئيسية · الكتلة #{n}', down: 'الشبكة الرئيسية · الحالة غير متاحة', ago: 'منذ {t}', nodes: 'عُقد المجتمع المتصلة: {n}' },
  };
  const LOCALES = { en: 'en-US', cs: 'cs-CZ', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP', zh: 'zh-CN', ar: 'ar-u-nu-latn' };
  const say = (k, n) => (TEXT[lang] ?? TEXT.en)[k].replace('{n}', n ?? '').replace('{t}', n ?? '');
  // How many community nodes serve the network's data right now: an invitation to join them.
  const countEl = document.querySelector('[data-community-count]');
  if (countEl) community.then((urls) => { if (urls.length) { countEl.textContent = say('nodes', urls.length); countEl.hidden = false; } });

  // Light and dark: the choice is remembered; without it the system decides (theme.js)
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* private window */ }
  }));
  // Language menu
  const langMenu = document.querySelector('[data-lang-menu]');
  if (langMenu) {
    const btn = langMenu.querySelector('button');
    const set = (open) => { langMenu.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); set(!langMenu.classList.contains('open')); });
    document.addEventListener('click', (e) => { if (!e.target.closest('[data-lang-menu]')) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && langMenu.classList.contains('open')) { set(false); btn.focus(); } });
  }

  // Menu groups: a click opens the panel; a second click, Escape or a click outside closes it
  const groups = [...document.querySelectorAll('.ng-btn[aria-controls]')];
  const closeAll = (except) => groups.forEach((b) => { if (b !== except) b.setAttribute('aria-expanded', 'false'); });
  groups.forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const open = b.getAttribute('aria-expanded') !== 'true'; closeAll(b); b.setAttribute('aria-expanded', String(open)); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.ng')) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = groups.find((b) => b.getAttribute('aria-expanded') === 'true');
    closeAll();
    if (open) { open.focus(); open.parentElement.classList.add('shut'); }
  });
  document.querySelectorAll('.ng').forEach((g) => g.addEventListener('mouseleave', () => g.classList.remove('shut')));

  // Mobile menu: full-height panel, page scrolling locked, focus stays in the panel
  const menu = document.getElementById('menu');
  const nav = document.getElementById('nav');
  const top = document.querySelector('.top');
  const setMenu = (open) => {
    nav.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('locked', open);
    if (open) nav.querySelector('a, button')?.focus(); else closeAll();
  };
  if (menu && nav) {
    menu.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menu.focus(); }
      if (e.key === 'Tab' && nav.classList.contains('open')) {
        const f = [menu, ...nav.querySelectorAll('a, button')].filter((el) => el.offsetParent !== null);
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    matchMedia('(min-width: 941px)').addEventListener('change', (m) => { if (m.matches) setMenu(false); });
  }
  // Line below the header only after scrolling
  const onScroll = () => top?.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // Arrow keys in an open panel
  document.querySelectorAll('.ng-panel').forEach((panel) => panel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...panel.querySelectorAll('a')];
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }));
  groups.forEach((b) => b.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); b.setAttribute('aria-expanded', 'true'); b.nextElementSibling.querySelector('a')?.focus(); } }));

  // Revealing sections on scroll
  const reveal = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
    reveal.forEach((el) => io.observe(el));
  } else reveal.forEach((el) => el.classList.add('in'));

  // Home page: the hero art drifts slower than the page and the chain of blocks a little faster, a light depth effect.
  const art = document.querySelector('.home-page .hero-art > div:first-child');
  const chainBox = document.querySelector('.home-page .chain');
  if (art && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let ticking = false;
    const drift = () => {
      ticking = false;
      const y = Math.min(scrollY, innerHeight);
      art.style.transform = `translateY(${(y * 0.22).toFixed(1)}px) rotate(${(y * 0.012).toFixed(2)}deg)`;
      if (chainBox) chainBox.style.transform = `translateY(${(y * -0.06).toFixed(1)}px)`;
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true });
  }

  // Copying addresses
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1500); } catch { /* bez schránky */ }
  }));

  // Adding the network to the wallet
  const NETS = {
    main: { chainId: '0xccb1', chainName: 'Quinvium', rpcUrls: ['https://rpc.quinvium.com'], nativeCurrency: { name: 'Quinvium', symbol: 'QU', decimals: 18 }, blockExplorerUrls: ['https://explorer.quinvium.com'] },
    test: { chainId: '0xccb2', chainName: 'Quinvium Testnet', rpcUrls: ['https://rpc1.quinvium.com'], nativeCurrency: { name: 'Quinvium Testnet', symbol: 'tQU', decimals: 18 }, blockExplorerUrls: ['https://testnet.quinvium.com'] },
  };
  const T = TEXT[lang] ?? TEXT.en;
  document.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', async () => {
    const msg = btn.closest('section, footer')?.querySelector('[data-add-msg]');
    const say = (t) => { if (msg) msg.textContent = t; };
    if (!window.ethereum) return say(T.none);
    try { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [NETS[btn.dataset.add]] }); say(T.ok); }
    catch (e) { say(e && e.code === 4001 ? T.no : T.none); }
  }));

  // Mainnet status in the footer (all pages)
  const fdot = document.querySelector('[data-foot-dot]');
  const ftext = document.querySelector('[data-foot-text]');
  if (fdot && ftext) {
    send('eth_blockNumber')
      .then((d) => { const h = Number(BigInt(d.result)); ftext.textContent = say('block', h.toLocaleString(LOCALES[lang] ?? 'en-US')); fdot.className = 'dot on'; })
      .catch(() => { ftext.textContent = say('down'); fdot.className = 'dot off'; });
  }

  // Live mainnet status
  const live = document.querySelector('[data-live]');
  if (!live) return;
  const note = document.querySelector('[data-live-note]');
  const dot = document.querySelector('[data-live-dot]');
  const blocks = document.querySelector('[data-blocks]');
  const loc = LOCALES[lang] ?? 'en-US';
  const fmt = (n, d = 0) => n.toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
  const unit = (v, units) => { let i = 0; while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; } return `${fmt(v, v < 10 ? 2 : 1)} ${units[i]}`; };
  const set = (k, v) => { const el = live.querySelector(`[data-m="${k}"]`); if (el) el.textContent = v; };
  const ago = (s) => (s < 60 ? `${Math.max(0, Math.round(s))} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
  const call = async (method, params = []) => {
    const d = await send(method, params);
    if (d.error) throw new Error(d.error.message);
    return d.result;
  };
  const block = (n) => call('eth_getBlockByNumber', [typeof n === 'number' ? `0x${n.toString(16)}` : n, false]);

  async function refresh() {
    try {
      const head = await block('latest');
      const h = Number(BigInt(head.number));
      const diff = Number(BigInt(head.difficulty));
      const back = Math.min(60, h);
      let bt = 15;
      if (back > 0) { const old = await block(h - back); bt = (Number(BigInt(head.timestamp)) - Number(BigInt(old.timestamp))) / back || 15; }
      set('height', fmt(h));
      set('difficulty', unit(diff, ['', 'k', 'M', 'G', 'T', 'P']));
      set('hashrate', h > 0 ? unit(diff / Math.max(bt, 1), ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s']) : '–');
      set('blocktime', h > 0 ? `${fmt(bt, 1)} s` : '–');
      set('supply', `${fmt(h * 4)} QU`);
      const before = Date.now() / 1000 < GENESIS + 30 && h === 0;
      note.textContent = before ? note.dataset.before : note.dataset.on;
      dot.className = `dot ${before ? '' : 'on'}`;
      const pill = document.querySelector('[data-hero-status]');
      if (pill) pill.textContent = before ? pill.dataset.before : pill.dataset.on;
      const heroHeight = document.querySelector('[data-hero-height]');
      if (heroHeight) heroHeight.textContent = `#${fmt(h)}`;
      const row = document.querySelector('[data-chain-row]');
      if (row && h > 0) {
        // The four newest blocks under the mark; a new block slides in from the start of the row.
        const known = new Set([...row.children].map((a) => a.dataset.n));
        const list = await Promise.all(Array.from({ length: Math.min(4, h) }, (_, i) => (i === 0 ? head : block(h - i))));
        const now = Date.now() / 1000;
        row.replaceChildren(...list.map((b) => {
          const n = String(Number(BigInt(b.number)));
          const a = document.createElement('a');
          a.href = `${row.parentElement.dataset.explorer}/block/${n}`;
          a.dataset.n = n;
          if (known.size && !known.has(n)) a.className = 'new';
          const t = document.createElement('b'); t.textContent = `#${fmt(Number(n))}`;
          const s = document.createElement('small'); s.textContent = say('ago', ago(now - Number(BigInt(b.timestamp))));
          a.append(t, s);
          return a;
        }));
      }
      if (h > 0 && blocks) {
        const list = await Promise.all(Array.from({ length: Math.min(6, h) }, (_, i) => (i === 0 ? head : block(h - i))));
        const now = Date.now() / 1000;
        blocks.innerHTML = '';
        for (const b of list) {
          const n = Number(BigInt(b.number));
          const a = document.createElement('a');
          a.className = 'blk';
          a.href = `${blocks.dataset.explorer}/block/${n}`;
          const c = document.createElement('i'); c.className = 'cube'; c.setAttribute('aria-hidden', 'true');
          c.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7l9-5zM3 7l9 5 9-5M12 12v10"/></svg>';
          const t = document.createElement('b'); t.textContent = `#${fmt(n)}`;
          const age = ago(now - Number(BigInt(b.timestamp)));
          const s = document.createElement('span');
          s.textContent = `${b.transactions.length} ${blocks.dataset.txs} · ${say('ago', age)} · ${blocks.dataset.miner} ${b.miner.slice(0, 6)}…${b.miner.slice(-4)}`;
          a.append(c, t, s);
          blocks.append(a);
        }
      }
    } catch {
      const before = Date.now() / 1000 < GENESIS;
      note.textContent = before ? note.dataset.before : note.dataset.off;
      dot.className = `dot ${before ? '' : 'off'}`;
      live.querySelectorAll('.sk').forEach((el) => { if (el.textContent === '') el.textContent = '–'; });
    }
  }
  refresh();
  setInterval(refresh, 15000);
})();
