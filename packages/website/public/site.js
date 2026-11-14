// quinvium.com: menu, live mainnet status, adding the network to a wallet, smooth reveal of sections.
(() => {
  const RPC = 'https://rpc.quinvium.com';
  const GENESIS = 1794610800; // 14 Nov 2026 00:00 CET
  const lang = document.body.dataset.lang || 'en';

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
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach((el) => io.observe(el));
  } else reveal.forEach((el) => el.classList.add('in'));

  // Copying addresses
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1500); } catch { /* bez schránky */ }
  }));

  // Adding the network to the wallet
  const NETS = {
    main: { chainId: '0xccb1', chainName: 'Quinvium', rpcUrls: ['https://rpc.quinvium.com'], nativeCurrency: { name: 'Quinvium', symbol: 'QU', decimals: 18 }, blockExplorerUrls: ['https://explorer.quinvium.com'] },
    test: { chainId: '0xccb2', chainName: 'Quinvium Testnet', rpcUrls: ['https://rpc1.quinvium.com'], nativeCurrency: { name: 'Quinvium Testnet', symbol: 'tQU', decimals: 18 }, blockExplorerUrls: ['https://testnet.quinvium.com'] },
  };
  const T = {
    cs: { none: 'Peněženka v prohlížeči nenalezena. Nainstalujte MetaMask nebo použijte aplikaci Quinvium.', ok: 'Síť je přidaná.', no: 'Požadavek byl v peněžence odmítnut.' },
    en: { none: 'No browser wallet found. Install MetaMask or use the Quinvium app.', ok: 'Network added.', no: 'The request was rejected in the wallet.' },
  }[lang];
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
    fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: AbortSignal.timeout(8000) })
      .then((r) => r.json()).then((d) => { const h = Number(BigInt(d.result)); ftext.textContent = `Mainnet · block #${h.toLocaleString('en-US')}`; fdot.className = 'dot on'; })
      .catch(() => { ftext.textContent = 'Mainnet · status unavailable'; fdot.className = 'dot off'; });
  }

  // Live mainnet status
  const live = document.querySelector('[data-live]');
  if (!live) return;
  const note = document.querySelector('[data-live-note]');
  const dot = document.querySelector('[data-live-dot]');
  const blocks = document.querySelector('[data-blocks]');
  const loc = lang === 'cs' ? 'cs-CZ' : 'en-US';
  const fmt = (n, d = 0) => n.toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
  const unit = (v, units) => { let i = 0; while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; } return `${fmt(v, v < 10 ? 2 : 1)} ${units[i]}`; };
  const set = (k, v) => { const el = live.querySelector(`[data-m="${k}"]`); if (el) el.textContent = v; };
  const ago = (s) => (s < 60 ? `${Math.max(0, Math.round(s))} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
  let id = 1;
  const call = async (method, params = []) => {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }), signal: AbortSignal.timeout(8000) });
    const d = await r.json();
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
          s.textContent = `${b.transactions.length} ${blocks.dataset.txs} · ${lang === 'cs' ? `${blocks.dataset.ago} ${age}` : `${age} ${blocks.dataset.ago}`} · ${blocks.dataset.miner} ${b.miner.slice(0, 6)}…${b.miner.slice(-4)}`;
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
