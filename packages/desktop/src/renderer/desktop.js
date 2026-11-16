// App pages: mining, Explorer, network, settings and About. The wallet has its own code in wallet/popup.js.
(() => {
  const el = (id) => document.getElementById(id);
  const d = window.desktop;
  const i18n = window.AetherI18n;
  const tr = i18n.t;
  const TABS = ['wallet', 'mining', 'pools', 'explorer', 'node', 'settings', 'about'];
  const CHART_MS = 10_000;
  const number = (n) => Number(n).toLocaleString(i18n.locale());
  const coin = (wei) => (Number(BigInt(wei) / 10n ** 14n) / 10000).toLocaleString(i18n.locale());
  const hashRate = (h) => {
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
    if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
    if (h >= 1e3) return `${(h / 1e3).toFixed(1)} kH/s`;
    return `${Math.round(h)} H/s`;
  };
  const wallet = (cmd) => new Promise((r) => chrome.runtime.sendMessage({ cmd }, r));
  let height = null;
  let seedShown = false;
  let seedSet = false;
  let last = null;
  let lastStats = null;
  let explorer = null;

  // Returning to the tab shows what matches the wallet state, not an old screen.
  const refreshWallet = () => { if (!el('tab-wallet').hidden && !window.approvalActive()) start(); };
  window.currentTab = () => document.querySelector('nav button[data-tab].active')?.dataset.tab ?? null;
  window.openAppTab = (name) => document.querySelector(`nav button[data-tab="${name}"]`)?.click();

  // Swap and bridge are Explorer pages. In the app they look like its tabs, hence without the Explorer header.
  // The Explorer tab always opens its home page. Only a link leads to a specific page, for example "View in Explorer".
  const EXPLORER_PAGES = { swap: '/swap', bridge: '/bridge', explorer: '/' };

  // Pools belong under mining and About under settings: the sidebar has only what is used every day.
  const NAV_PARENT = { pools: 'mining', about: 'settings' };

  window.showTab = (name, { path } = {}) => {
    const section = EXPLORER_PAGES[name] ? 'explorer' : name;
    document.querySelectorAll('nav button[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === (NAV_PARENT[name] ?? name)));
    for (const s of TABS) el(`tab-${s}`).hidden = s !== section;
    if (name === 'mining') { fillAddress(); drawCharts(); showPoolEarnings(); }
    if (name === 'pools') { drawPools(); showRunPool(); }
    if (section === 'explorer') showExplorerPage(path ?? EXPLORER_PAGES[name], name !== 'explorer');
    if (name === 'about') showAbout();
    if (name === 'settings') { showUpdate(); showNotify(); }
  };
  document.querySelectorAll('nav button[data-tab]').forEach((b) => {
    b.onclick = () => {
      window.showTab(b.dataset.tab);
      if (b.dataset.tab === 'wallet') refreshWallet();
    };
  });

  // ---- app lock: after inactivity a password for the whole app; mining and the node keep running ------------------
  const ACTIVITY_MS = 30_000;
  const LOCK_TIMES = [5, 15, 30, 60];
  const walletStatus = async () => (await wallet('status').catch(() => null))?.result ?? {};

  function showLock() {
    el('lock-password').value = '';
    el('lock-password').type = 'password';
    el('lock-eye').setAttribute('aria-pressed', 'false');
    el('lock-error').textContent = '';
    el('lock-caps').hidden = true;
    showLockStatus();
    el('app-lock').hidden = false;
    el('lock-password').focus();
  }
  /** What keeps running while the app is locked: the node and mining are in the main process. */
  function showLockStatus() {
    const parts = [];
    if (last?.miner.running) parts.push(tr('Mining continues in the background'));
    if (lastStats?.height !== undefined) parts.push(tr('Block {n}', { n: number(lastStats.height) }));
    el('lock-status').textContent = parts.join(' · ');
  }
  const eyeLabel = () => tr(el('lock-password').type === 'password' ? 'Show password' : 'Hide password');
  el('lock-eye').setAttribute('aria-label', eyeLabel());
  el('lock-eye').title = eyeLabel();
  el('lock-eye').onclick = () => {
    const show = el('lock-password').type === 'password';
    el('lock-password').type = show ? 'text' : 'password';
    el('lock-eye').setAttribute('aria-pressed', String(show));
    el('lock-eye').setAttribute('aria-label', eyeLabel());
    el('lock-eye').title = eyeLabel();
    el('lock-password').focus();
  };
  const capsCheck = (e) => { if (e.getModifierState) el('lock-caps').hidden = !e.getModifierState('CapsLock'); };
  el('lock-password').addEventListener('keydown', capsCheck);
  el('lock-password').addEventListener('keyup', capsCheck);
  window.onWalletLocked = showLock;
  window.appLocked = () => !el('app-lock').hidden;

  el('lock-form').onsubmit = async (e) => {
    e.preventDefault();
    el('lock-submit').disabled = true;
    try {
      await call('unlock', { password: el('lock-password').value });
    } catch {
      el('lock-error').textContent = tr('Wrong password');
      el('lock-form').classList.remove('shake');
      void el('lock-form').offsetWidth;
      el('lock-form').classList.add('shake');
      el('lock-password').select();
      return;
    } finally {
      el('lock-submit').disabled = false;
    }
    el('app-lock').hidden = true;
    await window.onWalletChanged?.();
    if (window.approvalActive()) window.resumeApproval();
    else start();
    fillAddress();
    followWallet();
  };
  el('lock-forgot').onclick = () => {
    el('app-lock').hidden = true;
    window.showTab('wallet');
    logoutScreen(showLock);
  };

  let touched = 0;
  const activity = () => {
    if (Date.now() - touched < ACTIVITY_MS || !el('app-lock').hidden) return;
    touched = Date.now();
    wallet('touch');
  };
  for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, activity, { capture: true, passive: true });

  /** Password before a change that decides where coins go. Without a wallet there is nothing to protect. */
  async function askPassword(title) {
    const status = await walletStatus();
    if (!status.initialized || status.external) return true;     // the keys are held by a wallet outside the app; there is no password here
    return new Promise((resolve) => {
      const done = (ok) => { el('pw-box').hidden = true; resolve(ok); };
      el('pw-title').textContent = title;
      el('pw-error').textContent = '';
      el('pw-input').value = '';
      el('pw-box').hidden = false;
      el('pw-input').focus();
      el('pw-cancel').onclick = () => done(false);
      el('pw-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await call('checkPassword', { password: el('pw-input').value });
          done(true);
        } catch { el('pw-error').textContent = tr('Wrong password'); }
      };
    });
  }

  /** The app found that this card is a small part of the network (pool-offer.cjs). One click switches to the pool; nothing happens without it. */
  function offerPool({ pool, share, rate }) {
    if (!el('offer-box').hidden) return;
    const blockTime = lastStats?.blockTimeTarget ?? 15;
    const hours = blockTime / share / 3600;
    const time = hours < 48 ? tr('about {n} hours', { n: number(Math.max(1, Math.round(hours))) }) : tr('about {n} days', { n: number(Math.round(hours / 24)) });
    const percent = share * 100;
    el('offer-text').textContent = tr('Your card does {rate}, about {share} % of the whole network. Mining solo, you would find a block about once every {time}.', {
      rate: hashRate(rate), share: percent.toLocaleString(i18n.locale(), { maximumSignificantDigits: 2 }), time,
    });
    el('offer-detail').textContent = tr('In the pool {name} you get a small payout from every block the pool finds, by your share of the work. On average it pays the same over time, just regularly. Fee {fee} %, the rewards are held by a contract on the chain.', {
      name: pool.name, fee: number(pool.fee),
    });
    const close = () => { el('offer-box').hidden = true; };
    el('offer-solo').onclick = close;
    el('offer-never').onclick = async () => { close(); await d.poolOfferOff(); };
    el('offer-pool').onclick = async () => {
      close();
      if (!(await askPassword(tr('Change mining pool')))) return;
      try {
        await d.setPool({ address: pool.address, url: pool.url, name: pool.name });
        await refresh();
      } catch (err) {
        window.showTab('pools');
        el('p-error').textContent = errorText(err);
      }
    };
    el('offer-box').hidden = false;
  }

  // ---- signing in with a wallet outside the app ------------------------------------------------------------
  const nodePort = () => last?.node.rpc ?? d.testRpcPort ?? (last?.node.network === 'mainnet' ? 8545 : 8546);
  const chainInfo = () => ({
    chainId: lastStats?.chainId ?? (last?.node.network === 'mainnet' ? 52401 : 52402),
    name: last?.node.network === 'mainnet' ? 'Quinvium' : 'Quinvium Testnet',
    rpc: `http://127.0.0.1:${nodePort()}`,
    symbol: lastStats?.currency ?? 'tQU',
  });
  const signedIn = async () => {
    await window.onWalletChanged?.();
    fillAddress();
    start();
  };

  /** MetaMask lives in the browser: a page there handles sign-in and later signatures. */
  window.signInBrowserWallet = async () => {
    const ask = async () => { await d.walletLinkOpen({ lang: i18n.lang(), chain: chainInfo() }); };
    render(`${screenHead('MetaMask')}<p>${tr('We opened your browser. Confirm the connection in MetaMask there and keep that tab open.')}</p>
      <div class="err" id="ext-error"></div><button id="ext-again">${tr('Open the browser again')}</button>`);
    on('#back', welcome);
    on('#ext-again', ask);
    await ask();
  };
  async function browserWalletHello({ address, signature, message, name, rdns }) {
    const box = el('ext-error');
    try {
      // The signature proves the address really belongs to this wallet. Without it one could mine to a typo.
      if (ethers.verifyMessage(message, signature).toLowerCase() !== address.toLowerCase()) throw new Error('Invalid signature');
      await call('setExternal', { kind: 'browser', name, address, rdns });
      await signedIn();
    } catch (e) { if (box) box.textContent = errorText(e); }
  }

  let wc = null;
  async function walletConnect() {
    if (wc) return wc;
    if (!window.AetherWalletConnect) {
      await new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'wallet/walletconnect.js';
        tag.onload = resolve;
        tag.onerror = () => reject(new Error('WalletConnect could not be loaded'));
        document.head.appendChild(tag);
      });
    }
    const projectId = window.AETHER_CONFIG?.walletConnectProjectId || store.get('aether.wcProject');
    const chain = chainInfo();
    wc = await window.AetherWalletConnect.init({
      projectId, chainId: chain.chainId, rpcUrl: chain.rpc, metadata: { name: 'Quinvium', description: 'Quinvium app', url: 'https://aether.invalid', icons: [] },
    });
    wc.on('disconnect', () => { wc = null; });
    return wc;
  }
  /** A phone connects through a QR code. dashboard.reown.com issues a Project ID for free; without it the relay does not connect. */
  window.signInWalletConnect = async () => {
    if (!window.AETHER_CONFIG?.walletConnectProjectId && !store.get('aether.wcProject')) {
      render(`${screenHead('WalletConnect')}<p>${tr('WalletConnect needs a free Project ID from dashboard.reown.com.')}</p>
        <form id="f"><label>Project ID<input name="project" required autocomplete="off" spellcheck="false"></label><div class="err"></div><button class="primary" type="submit">${tr('Continue')}</button></form>`);
      on('#back', welcome);
      bindForm('#f', async (v) => { store.set('aether.wcProject', v.project.trim()); window.signInWalletConnect(); });
      return;
    }
    render(`${screenHead('WalletConnect')}<p>${tr('Waiting for the wallet…')}</p><div class="err" id="ext-error"></div>`);
    on('#back', welcome);
    try {
      const provider = await walletConnect();
      provider.on('display_uri', (uri) => {
        const code = window.qrcode(0, 'M');
        code.addData(uri);
        code.make();
        render(`${screenHead('WalletConnect')}<p>${tr('Scan this code with your phone wallet.')}</p><div class="card qr-card"><div class="qr" id="wc-qr">${code.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div></div><div class="err" id="ext-error"></div>`);
        on('#back', welcome);
      });
      await provider.connect();
      await call('setExternal', { kind: 'walletconnect', name: provider.session?.peer?.metadata?.name ?? 'WalletConnect', address: provider.accounts[0] });
      await signedIn();
    } catch (e) {
      wc = null;
      if (el('ext-error')) el('ext-error').textContent = errorText(e);
    }
  };

  /** Signatures from the app go to the wallet the user signed in with. The app never sees the keys. */
  globalThis.externalRequest = async (external, method, params) => {
    if (external.kind === 'walletconnect') return (await walletConnect()).request({ method, params });
    return d.walletLinkRequest(method, params, { chain: chainInfo(), signedIn: true, rdns: external.rdns });
  };

  const errorText = (e) => tr(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  /** Until the miner has the DAG, progress is shown in percent, then the real hashrate. */
  const LOAD_TEXT = { start: 'Starting the graphics card', dag: 'Loading mining data', check: 'Checking the card' };
  function showLoading(m) {
    const running = m.running ?? true;
    const loading = running && m.progress !== null && m.progress !== undefined && m.progress < 100;
    el('m-load').hidden = !loading;
    el('m-rate').hidden = !running || loading;
    if (loading) {
      el('m-load-text').textContent = tr(LOAD_TEXT[m.stage] ?? LOAD_TEXT.start);
      el('m-load-pct').textContent = `${m.progress} %`;
      el('m-load-bar').style.width = `${m.progress}%`;
    } else if (running) el('m-rate').textContent = i18n.decimal(m.rate ?? '0 H/s');
    el('h-rate').hidden = !running;
    el('h-rate').textContent = loading ? `${m.progress} %` : el('m-rate').textContent;
  }
  const showTemperature = (gpu) => {
    const known = Number.isFinite(gpu?.temp);
    el('m-temp-box').hidden = !known;
    if (known) el('m-temp').textContent = `${gpu.temp} °C`;
  };
  const setState = (id, on, text) => {
    el(id).classList.toggle('on', on);
    el(id).querySelector('span').textContent = text;
  };
  const tail = (id, lines) => { const p = el(id); p.textContent = lines.join('\n'); p.scrollTop = p.scrollHeight; };
  const append = (id, line) => { const p = el(id); p.textContent += `${line}\n`; p.scrollTop = p.scrollHeight; };


  /** The payout always goes to the signed-in wallet; no other address can be set. */
  const payoutAddress = async () => (await wallet('address').catch(() => null))?.result ?? null;
  async function fillAddress() {
    const wallet = await payoutAddress();
    const address = wallet ?? (await d.state()).miner.address;
    el('m-address').textContent = address ?? '—';
    // The main process uses it for notifications of incoming payments and for its texts.
    d.setContext({ lang: i18n.lang(), ...(wallet ? { address: wallet } : {}) });
  }

  /** A different account means a different payout: running mining switches to the new account immediately, not after a restart. */
  let followingWallet = false;
  async function followWallet() {
    if (followingWallet || !last?.miner.running) return;
    const address = await payoutAddress();
    if (!address || address.toLowerCase() === last.miner.address?.toLowerCase()) return;
    followingWallet = true;
    try {
      await d.stopMiner();
      await d.startMiner({ address, device: el('m-device').value });
    } finally {
      followingWallet = false;
    }
    fillAddress();
  }

  /** Mining is not possible without a wallet: rewards would have nowhere to go. */
  async function requireWallet() {
    const status = (await wallet('status').catch(() => null))?.result;
    const ready = !!status?.initialized;
    el('m-need').hidden = ready;
    el('m-hero').hidden = !ready;
    return ready;
  }

  /** A chart without a library: just a line, scaled to the displayed values. */
  function chart(box, values) {
    box.closest('.panel').hidden = values.length < 2;     // an empty chart is not shown; it comes with the first data
    if (values.length < 2) return;
    const [w, h] = [480, 92];
    const max = Math.max(...values) || 1;
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const x = (i) => (i / (values.length - 1)) * w;
    const y = (v) => h - 4 - ((v - min) / span) * (h - 10);
    const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img"><path class="line" d="${path}"/></svg>`;
  }

  async function rpc(method, params = []) {
    const r = await fetch(`http://127.0.0.1:${nodePort()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return (await r.json()).result;
  }

  // ---- pools: the list is read directly from the factory contract, so it cannot contain foreign code ---------------------
  const nodeUrl = () => `http://127.0.0.1:${nodePort()}`;
  let abi = null;
  async function chain() {
    abi ??= await (await fetch(`${nodeUrl()}/contracts.json`)).json();
    return new ethers.JsonRpcProvider(nodeUrl(), undefined, { staticNetwork: true });
  }
  const factory = (provider) => new ethers.Contract(abi.PoolFactory.address, abi.PoolFactory.abi, provider);
  const poolAt = (address, provider) => new ethers.Contract(address, abi.AetherPool.abi, provider);

  const TOP_POOLS = 10;
  let poolQuery = '';
  let poolDraw = 0;
  const poolRow = (p) => ({ address: ethers.getAddress(p.address), name: p.name, url: p.url, fee: p.feeBps / 100, share: p.share, blocks: p.blocks, miners: p.miners });
  /** Pools by the node: the strongest by blocks in 24 hours, or a search result. The node sorts and paginates them itself. */
  async function loadPools(query) {
    const r = await rpc('aether_pools', [{ limit: TOP_POOLS, query }]).catch(() => null);
    return r ? { total: r.total, matched: r.matched, items: r.items.map(poolRow) } : { total: 0, matched: 0, items: [] };
  }

  /** Where to mine: solo, the ten strongest pools and the selected pool even if it is not among them. Search finds others. */
  async function drawPools() {
    const ticket = ++poolDraw;
    const box = el('p-list');
    const chosen = last?.miner.pool?.address ?? '';
    const query = poolQuery.trim();
    const found = await loadPools(query);
    if (ticket !== poolDraw) return;     // a newer search arrived in the meantime
    const pools = found.items;
    if (chosen && !query && !pools.some((p) => p.address.toLowerCase() === chosen.toLowerCase())) {
      const mine = (await rpc('aether_pools', [{ query: chosen.toLowerCase(), limit: 1 }]).catch(() => null))?.items?.map(poolRow)?.[0];
      pools.unshift(mine ?? { address: chosen, name: last.miner.pool.name || chosen.slice(0, 10), url: last.miner.pool.url, fee: 0, share: 0, blocks: 0, miners: 0 });
    }
    const span = (cls, text) => { const x = document.createElement('span'); x.className = cls; x.textContent = text; return x; };
    const card = ({ id, title, note, meta, on, off }) => {
      const b = document.createElement('button');
      b.className = `choice${on ? ' selected' : ''}`;
      b.dataset.pool = id;
      b.disabled = !!off;
      const main = document.createElement('span');
      main.className = 'main';
      const name = document.createElement('b');
      name.textContent = title;
      main.append(name, span('small', off ?? note));
      if (meta) main.append(span('choice-meta', meta));
      b.append(main, span('mark', on ? tr('Selected') : ''));
      return b;
    };
    const locale = i18n.locale();
    const share = (p) => (p.blocks ? tr('{share} % of blocks in 24 h', { share: (p.share * 100).toLocaleString(locale, { maximumFractionDigits: 1 }) }) : tr('No blocks in 24 h'));
    const items = pools.map((p) => card({
      id: p.address, title: p.name, on: p.address.toLowerCase() === chosen.toLowerCase(),
      note: `${tr('Fee {fee} %', { fee: p.fee.toLocaleString(locale) })} · ${share(p)} · ${tr('{n} miners', { n: number(p.miners ?? 0) })}`,
      meta: `${p.address.slice(0, 8)}…${p.address.slice(-4)}`,
      off: p.url ? null : tr('The operator has not published a server address.'),
    }));
    box.replaceChildren(...(query ? [] : [card({ id: '', title: tr('Solo'), note: tr('You keep every block you find'), on: !chosen })]), ...items);
    if (query && !items.length) box.append(span('dim choice-empty', tr('No pool matches the search.')));
    el('p-count').textContent = !query && found.total > TOP_POOLS ? tr('The {n} strongest pools by blocks in the last 24 hours. All {total} pools are in the Explorer.', { n: number(TOP_POOLS), total: number(found.total) }) : '';
    box.querySelectorAll('[data-pool]').forEach((b) => {
      b.onclick = async () => {
        el('p-error').textContent = '';
        const pool = pools.find((p) => p.address === b.dataset.pool);
        if (!(await askPassword(tr('Change mining pool')))) return;
        try {
          await d.setPool(pool ? { address: pool.address, url: pool.url, name: pool.name } : null);
          await refresh();
          drawPools();
        } catch (e) { el('p-error').textContent = errorText(e); }
      };
    });
    el('p-open').hidden = !chosen;
  }
  let poolTimer = null;
  el('p-search').addEventListener('input', () => {
    poolQuery = el('p-search').value;
    clearTimeout(poolTimer);
    poolTimer = setTimeout(drawPools, 250);
  });
  el('p-all').onclick = () => window.openExplorer('/pools');

  el('p-open').onclick = () => window.openExplorer(`/pool/${last.miner.pool.address}`);
  el('p-create').onclick = () => window.openExplorer('/pools/new');
  el('m-mode-open').onclick = () => window.showTab('pools');

  async function showPoolEarnings() {
    const pool = last?.miner.pool;
    const address = await payoutAddress();
    if (!pool || !address) return;
    const pending = await poolAt(pool.address, await chain()).pendingOf(address).catch(() => null);
    if (pending !== null) el('m-pending').textContent = `${coin(pending)} ${lastStats?.currency ?? ''}`;
  }

  /** Status of one's own pool: the gas account must have coins, otherwise shares are not submitted. */
  async function showRunPool() {
    if (!last?.node.running) return;
    const running = last.node.runPool?.address ?? '';
    if (document.activeElement !== el('s-pool')) el('s-pool').value = running;
    const info = running ? await rpc('aether_poolInfo').catch(() => null) : null;
    el('s-pool-state').textContent = !info ? '' : `${tr('Pool server is running, devices connected: {n}.', { n: info.workers })} ${tr('The gas account {address} holds {amount} {coin}. It pays for submitting shares, so keep a small balance on it.', {
      address: info.payer, amount: coin(info.payerBalance), coin: lastStats?.currency ?? '',
    })}${info.lastError ? ` ${info.lastError}` : ''}`;
  }

  el('s-pool-save').onclick = async () => {
    if (!(await askPassword(tr('Change pool server')))) return;
    el('s-pool-error').textContent = '';
    const address = el('s-pool').value.trim();
    try {
      if (address && !(await factory(await chain()).isPool(address).catch(() => false))) throw new Error('This address is not a pool from the network factory.');
      await d.runPool(address);
      await refresh();
      showRunPool();
    } catch (e) {
      el('s-pool-error').textContent = errorText(e);
    }
  };

  async function drawCharts() {
    if (el('tab-mining').hidden) return;
    const s = await d.state();
    chart(el('c-rate'), s.miner.history);
    // The chart is history, the number next to it is for now: a stopped miner has no hashrate.
    el('c-rate-now').textContent = s.miner.running && s.miner.history.length ? hashRate(s.miner.history.at(-1)) : '';
    if (!s.node.running) return;
    const series = await rpc('aether_charts', [120]).catch(() => null);
    if (series) {
      chart(el('c-diff'), series.map((p) => Number(p.difficulty)));
      el('c-diff-now').textContent = series.length ? `${(Number(series.at(-1).difficulty) / 1e6).toFixed(1)} M` : '';
    }
  }

  /** RPC addresses entered into a wallet on a phone or in a browser. */
  function showEndpoints(s) {
    const e = s.node.running ? s.node.endpoints : null;
    const rows = [];
    if (e) {
      rows.push([tr('RPC on this computer'), e.local]);
      for (const url of e.lan) rows.push([tr('RPC on the home network'), url]);
      if (e.public) rows.push([tr(e.access?.nat === 'double' ? 'RPC from the internet (after forwarding)' : 'RPC from the internet'), e.public]);
    }
    el('n-endpoints').replaceChildren(...rows.map(([label, url]) => {
      const row = document.createElement('div');
      row.className = 'endpoint';
      const name = document.createElement('span');
      name.textContent = label;
      const code = document.createElement('code');
      code.textContent = url;
      const copy = document.createElement('button');
      copy.className = 'small';
      copy.textContent = tr('Copy');
      copy.onclick = () => { navigator.clipboard.writeText(url); copy.textContent = tr('Copied'); };
      row.append(name, code, copy);
      return row;
    }));
    const a = e?.access;
    let hint = '';
    if (s.node.access === 'internet' && s.node.running) {
      if (!a?.checked) hint = tr('Looking for the router and the public address…');
      else if (a.nat === 'double') hint = tr("The router is behind another router or the provider's modem. On that modem, forward TCP ports {ports} to the home router, or switch the modem to bridge mode.", { ports: a.ports.join(', ') });
      else if (a.behindNat) hint = tr('The internet provider shares one public address between customers, so this computer cannot be reached from the internet. Ask the provider for a public IP address.');
      else if (a.upnp) hint = tr('The router opened ports {ports} automatically. Wallets on mobile data can connect.', { ports: a.ports.join(', ') });
      else hint = tr('The router did not open the ports automatically. In the router settings, forward TCP ports {ports} to {ip}.', { ports: a.ports.join(', '), ip: a.internal ?? s.node.lan ?? '' });
    } else if (s.node.access === 'lan') {
      hint = tr('Phones on mobile data cannot connect. Choose the internet option for that.');
    }
    el('n-access-hint').textContent = hint;
    const open = e?.p2pOpen;
    el('n-upnp-state').textContent = !s.node.running || s.node.access === 'internet' || !s.node.upnp ? ''
      : open === true ? tr('Port {port} is open in the router, other nodes can connect.', { port: e?.p2pPort ?? '' })
      : open === false ? tr('The router did not open port {port} (UPnP is off or not supported). The node still connects out; to accept connections, forward TCP port {port} in the router.', { port: e?.p2pPort ?? '' }) : '';
    // Share node publicly: switch state and what the tunnel is doing.
    const sh = s.share ?? {};
    if (document.activeElement !== el('n-share-public')) el('n-share-public').checked = !!sh.on;
    el('n-share-public-state').textContent = !sh.on ? '' : sh.status === 'on' ? tr('Shared at {url}. Other nodes check it and list it.', { url: sh.url ?? '' })
      : sh.status === 'error' ? tr('Sharing does not work: {reason}', { reason: sh.error ?? '' }) : tr('Starting the tunnel…');
    el('n-public-row').hidden = el('n-access').value !== 'internet';
    el('n-public-note').hidden = el('n-access').value !== 'internet';
  }

  /** The Explorer and the wallet follow the node that runs now: after switching networks the node has another port. */
  let networkShown = false;
  async function followNode(s) {
    if (!s.node.running) return;
    const chainId = s.node.network === 'mainnet' ? 52401 : 52402;
    const { chainId: walletChain } = await chrome.storage.local.get('chainId');
    if (walletChain !== chainId) await chrome.storage.local.set({ chainId });
    if (explorer && explorer.origin !== `http://127.0.0.1:${s.node.rpc}`) {
      explorer = await d.explorerInfo();
      await trustExplorer();
      reloadExplorer();
    }
  }

  async function refresh() {
    const s = await d.state();
    last = s;
    seedSet = !!s.node.seed;
    if (!seedShown) { el('n-seed').value = s.node.seed; el('n-access').value = s.node.access ?? (s.node.share ? 'lan' : 'off'); el('n-public-host').value = s.node.publicHost ?? ''; el('n-upnp').checked = s.node.upnp !== false; el('m-power').value = s.miner.power; seedShown = true; }
    el('m-power-value').textContent = `${el('m-power').value} %`;
    el('version').textContent = tr('Version {v}', { v: s.version });
    el('n-lan').textContent = s.node.lan ? tr('This computer has the address {ip} on the local network.', { ip: s.node.lan }) : '';
    el('n-share-url').textContent = s.node.share && s.node.lan ? tr('Explorer from another computer: {url}', { url: `http://${s.node.lan}:${nodePort()}` }) : '';
    showEndpoints(s);
    el('n-start').disabled = s.node.running;
    el('n-stop').disabled = !s.node.running;
    el('n-network').disabled = s.node.running;
    if (s.node.network) { el('n-network').value = s.node.network; el('net-name').textContent = s.node.network; }
    else if (s.node.preferred && !networkShown) el('n-network').value = s.node.preferred;
    networkShown = true;
    followNode(s);
    el('m-start').hidden = s.miner.running;
    el('m-warning').hidden = !s.miner.warning;
    el('m-warning').textContent = s.miner.warning ?? '';
    el('m-stop').hidden = !s.miner.running;
    setState('m-state', s.miner.running, tr(s.miner.running ? 'Mining is running' : 'Mining is off'));
    setState('n-state', s.node.running, tr(s.node.running ? 'Node is running' : 'Node is not running'));
    el('dot').classList.toggle('on', s.node.running);
    if (!s.node.running) el('status').textContent = tr('Node is not running');
    showLoading(s.miner);
    showMined();
    el('m-shares').textContent = number(s.miner.shares);
    showTemperature(s.miner.gpu);
    document.querySelectorAll('.pool-only').forEach((x) => { x.hidden = !s.miner.pool; });
    const place = s.miner.pool ? tr('Mining in the pool {name}', { name: s.miner.pool.name || s.miner.pool.address.slice(0, 10) }) : tr('Solo: you keep every block you find');
    el('m-mode-name').textContent = place;
    el('h-where').textContent = place;
    el('h-start').hidden = s.miner.running;
    el('h-stop').hidden = !s.miner.running;
    setState('h-state', s.miner.running, tr(s.miner.running ? 'Mining is running' : 'Mining is off'));
    setState('h-node', s.node.running, tr(s.node.running ? 'Node is running' : 'Node is not running'));
    showMined();
    el('s-about-version').textContent = tr('Version {v}', { v: s.version });
    tail('n-log', s.node.log);
    tail('m-log', s.miner.log);
    requireWallet();
  }

  d.onEvent((e) => {
    if (e.type === 'activity') activity();
    if (e.type === 'wallet-link') browserWalletHello(e);
    if (e.type === 'state') refresh();
    if (e.type === 'node-log') append('n-log', e.line);
    if (e.type === 'miner-log') {
      append('m-log', e.line);
      showLoading(e);
      if (last) last.miner.blocks = e.blocks;
      showMined();
      if (e.shares !== undefined) el('m-shares').textContent = number(e.shares);
    }
    if (e.type === 'pool-offer') offerPool(e);
    if (e.type === 'stats') {
      showTemperature(e.gpu);
      if (e.mined) showMined(e.mined);
      const s = e.stats;
      lastStats = s;
      el('n-height').textContent = number(s.height);
      el('n-peers').textContent = s.peers;
      el('n-diff').textContent = number(s.difficulty);
      el('n-pool').textContent = s.mempool;
      el('m-reward').textContent = `${coin(s.reward)} ${s.currency}`;
      el('m-network').textContent = hashRate(Number(s.hashrate));
      el('h-reward').textContent = el('m-reward').textContent;
      el('h-hash').textContent = el('m-network').textContent;
      el('h-height').textContent = `#${number(s.height)}`;
      el('h-peers').textContent = s.peers;
      el('n-hint').textContent = tr(s.peers ? 'Your computer verifies the whole chain itself. Your data stays with you.'
        : seedSet ? 'Connecting to the other computer. It needs the Quinvium app open on the same network.'
          : 'Looking for other computers on the local network. For now the chain is only on this one.');
      el('status').textContent = `${s.network} · ${tr('block {n}', { n: number(s.height) })}${s.syncing ? ` · ${tr('syncing')}` : ''}`;
      // A new block refreshes only the overview. A transfer, deposit or wallet settings being edited must not close under the user's hands.
      if (s.height !== height) { height = s.height; if (el('balance')) refreshWallet(); }
    }
  });

  el('n-start').onclick = async () => {
    const network = el('n-network').value;
    await d.startNode(network);
    await chrome.storage.local.set({ chainId: network === 'mainnet' ? 52401 : 52402 });
    refresh();
  };
  el('n-stop').onclick = async () => { await d.stopNode(); refresh(); };
  el('n-share-public').onchange = async (e) => {
    e.target.disabled = true;
    try { await window.desktop.setSharePublic(e.target.checked); } finally { e.target.disabled = false; }
  };
  el('n-access').onchange = () => { el('n-public-row').hidden = el('n-access').value !== 'internet'; el('n-public-note').hidden = el('n-access').value !== 'internet'; };
  el('n-seed-save').onclick = async () => {
    el('n-seed-error').textContent = '';
    try {
      await d.setNetworkOptions({ seed: el('n-seed').value, access: el('n-access').value, publicHost: el('n-public-host').value, upnp: el('n-upnp').checked });
    } catch (e) {
      el('n-seed-error').textContent = errorText(e);
    }
    refresh();
  };
  async function startMining() {
    el('m-error').textContent = '';
    try {
      await d.startMiner({ address: await payoutAddress(), device: el('m-device').value });
    } catch (e) {
      el('m-error').textContent = errorText(e);
    }
    refresh();
  }
  const stopMining = async () => { await d.stopMiner(); refresh(); };
  el('m-start').onclick = startMining;
  el('m-stop').onclick = stopMining;
  // The overview controls mining directly. An error is shown on the Mining page, which also explains it.
  el('h-start').onclick = async () => { await startMining(); if (el('m-error').textContent) window.showTab('mining'); };
  el('h-stop').onclick = stopMining;
  el('h-mining-open').onclick = () => window.showTab('mining');
  el('h-node-open').onclick = () => window.showTab('node');
  el('p-back').onclick = () => window.showTab('mining');
  el('a-back').onclick = () => window.showTab('settings');
  el('s-about').onclick = () => window.showTab('about');
  el('m-power').oninput = () => { el('m-power-value').textContent = `${el('m-power').value} %`; };
  el('m-power').onchange = async () => { await d.setPower(el('m-power').value); refresh(); };
  el('m-wallet').onclick = () => window.showTab('wallet');
  el('s-wallet').onclick = () => window.showTab('wallet');

  // ---- Explorer inside the app, signed in with the app's wallet ---------------------------------
  async function trustExplorer() {
    if (!explorer || !(await requireWallet())) return;
    const { sites = {} } = await chrome.storage.local.get('sites');
    if (!sites[explorer.origin]) await chrome.storage.local.set({ sites: { ...sites, [explorer.origin]: { at: Date.now() } } });
  }
  const explorerUrl = (hash = '') => `${explorer.url}?embedded=1&lang=${i18n.lang()}&theme=${shownTheme()}${hash}`;
  async function openExplorer() {
    if (explorer) return;
    explorer = await d.explorerInfo();
    await trustExplorer();
    el('explorer-view').src = explorerUrl();
  }
  /** Shows an Explorer page. Swap and bridge have no Explorer header, as if they were app tabs. */
  async function showExplorerPage(path, solo) {
    await openExplorer();
    const view = el('explorer-view');
    const target = JSON.stringify(String(path).replace(/^#/, '') || '/');
    const go = () => view.executeJavaScript(`document.body.classList.toggle('solo', ${!!solo}); window.explorerGo ? window.explorerGo(${target}) : (location.hash = '#' + ${target});`).catch(() => {});
    if (!viewReady || view.isLoading()) view.addEventListener('did-finish-load', go, { once: true });
    else go();
  }
  /** A specific Explorer page directly in the app, with the wallet signed in. Older links with #/ keep working. */
  window.openExplorer = (path) => window.showTab('explorer', { path: String(path).replace(/^#/, '') });
  // Assigning `src` while loading ends with ERR_ABORTED. The last address wins; the previous load may be aborted.
  let viewReady = false;
  el('explorer-view').addEventListener('dom-ready', () => { viewReady = true; }, { once: true });
  const reloadExplorer = () => {
    if (!explorer) return;
    const view = el('explorer-view');
    if (!viewReady) {
      view.addEventListener('dom-ready', reloadExplorer, { once: true });
      return;
    }
    view.loadURL(explorerUrl()).catch(() => {});
    const tab = window.currentTab();
    if (tab === 'swap' || tab === 'bridge') view.addEventListener('did-finish-load', () => showExplorerPage(EXPLORER_PAGES[tab], true), { once: true });
  };
  el('a-docs').onclick = () => window.openExplorer('/api');
  el('a-explorer').onclick = () => window.showTab('explorer');
  el('side-lock').onclick = async () => {
    const status = await walletStatus();
    if (status.initialized && !status.external) await call('lock');
  };
  el('a-update').onclick = () => window.showTab('settings');

  // After signing out, rewards must not keep going to the old address: mining stops and the payout is filled from the new wallet.
  window.onWalletRemoved = async () => {
    el('m-address').textContent = '—';
    await d.stopMiner();
    refresh();
    reloadExplorer();
  };
  window.onWalletChanged = async () => {
    await requireWallet();
    await trustExplorer();
    reloadExplorer();
  };

  /** Blocks found: all of them by the payout address on this chain, and how many in this mining session. */
  let minedTotal = null;
  function showMined(m) {
    if (m) minedTotal = m;
    const session = last?.miner.blocks ?? 0;
    const text = minedTotal ? number(minedTotal.blocks) : String(session);
    for (const id of ['m-blocks', 'h-blocks']) {
      el(id).textContent = text;
      el(id).title = minedTotal ? tr('All blocks of this address; {n} in this session', { n: number(session) }) : '';
    }
  }

  // ---- settings and About ----------------------------------------------------------------------
  /**
   * Updates: a new version is looked up on GitHub; the app downloads it on request and opens it only when its checksum
   * matches both GitHub and quinvium.com. Installing is the user's step. (Signed remote updates exist only on testnet.)
   */
  function showUpdate() {
    if (!last) return;
    const u = last.update;
    const r = last.release ?? {};
    el('s-version').textContent = tr('Version {v}', { v: last.version });
    const latest = r.latest;
    el('s-release').hidden = !latest;
    if (latest) {
      el('s-release-title').textContent = tr('Version {v} is available', { v: latest.version });
      el('s-release-notes').textContent = latest.notes || '';
      el('s-release-notes').hidden = !latest.notes;
      el('s-release-get').disabled = !!r.downloading;
      el('s-release-state').textContent = r.downloading ? tr('Downloading… {p} %', { p: Math.floor((r.downloading.got / Math.max(1, r.downloading.total)) * 100) })
        : r.file ? tr('Downloaded and verified: {file}. Close Quinvium and run the installer.', { file: r.file.split(/[\\/]/).pop() })
          : r.error ? tr('Update failed: {reason}', { reason: r.error }) : '';
    }
    el('s-update').textContent = latest ? ''
      : r.error ? tr('Update failed: {reason}', { reason: r.error })
        : u.downloading ? tr('Downloading version {v}…', { v: u.available })
          : r.checked ? tr('You have the latest version.') : tr('Updates are checked on GitHub every six hours.');
  }
  el('s-check').onclick = async () => {
    el('s-update').textContent = tr('Checking…');
    const r = await d.checkRelease();
    if (last.update.configured) await d.checkUpdate().catch(() => null);
    last = { ...last, release: r };
    showUpdate();
  };
  el('s-release-get').onclick = async () => {
    el('s-release-get').disabled = true;
    el('s-release-state').textContent = tr('Downloading… {p} %', { p: 0 });
    const poll = setInterval(async () => { last = { ...last, ...(await d.state()) }; showUpdate(); }, 1000);
    try { last = { ...last, release: await d.downloadRelease() }; } finally { clearInterval(poll); }
    showUpdate();
  };
  el('s-release-page').onclick = () => { if (last?.release?.latest?.page) window.open(last.release.latest.page); };
  document.querySelectorAll('[data-notify]').forEach((box) => {
    box.onchange = () => d.setNotify(box.dataset.notify, box.checked);
  });
  const showNotify = () => document.querySelectorAll('[data-notify]').forEach((box) => { box.checked = last?.notify?.[box.dataset.notify] !== false; });
  function showAbout() {
    if (!last) return;
    el('a-version').textContent = tr('Version {v}', { v: last.version });
    const s = lastStats;
    if (!s) return;
    const rows = [
      [tr('Network'), s.network], ['Chain ID', s.chainId], [tr('Coin'), s.currency], [tr('Target block time'), `${s.blockTimeTarget} s`],
      [tr('Block reward'), `${coin(s.reward)} ${s.currency}`], [tr('Halving every'), tr('{n} blocks', { n: number(s.halvingInterval) })],
    ];
    el('a-facts').replaceChildren(...rows.map(([k, v]) => {
      const box = document.createElement('div');
      const name = document.createElement('span');
      name.textContent = k;
      const value = document.createElement('b');
      value.textContent = v;
      box.append(name, value);
      return box;
    }));
  }
  el('s-lang').innerHTML = Object.entries(i18n.languages).map(([code, name]) => `<option value="${code}" ${code === i18n.lang() ? 'selected' : ''}>${name}</option>`).join('');
  el('s-lang').onchange = async () => {
    i18n.setLang(el('s-lang').value);
    i18n.apply(document);
    d.setContext({ lang: i18n.lang() });
    lockOptions();
    await refresh();
    showUpdate();
    start();
    reloadExplorer();
    drawPools();
  };

  // Theme: follows the system, or fixed. The Explorer in the app gets the same.
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* no storage */ } } };
  const themeChoice = () => store.get('aether.theme') ?? 'system';
  function shownTheme() {
    const c = themeChoice();
    return c === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : c;
  }
  function applyTheme() {
    document.documentElement.dataset.theme = shownTheme();
    el('s-theme').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.themeSet === themeChoice()));
  }
  el('s-theme').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { store.set('aether.theme', b.dataset.themeSet); applyTheme(); reloadExplorer(); };
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); if (themeChoice() === 'system') reloadExplorer(); });
  applyTheme();

  const shell = document.querySelector('.shell');
  /** Collapsing the panel is the panel's last row; the shortcut is the same as in VS Code or Slack. */
  const sideKey = /Mac/.test(navigator.platform) ? '⌘B' : 'Ctrl B';
  function setSide(closed) {
    shell.classList.toggle('collapsed', closed);
    store.set('aether.side', closed ? 'closed' : 'open');
    const label = tr(closed ? 'Expand sidebar' : 'Collapse sidebar');
    el('side-toggle-text').textContent = label;
    el('side-toggle').title = `${label} (${sideKey})`;
    el('side-toggle').setAttribute('aria-expanded', String(!closed));
  }
  el('side-key').textContent = sideKey;
  el('side-toggle').onclick = () => setSide(!shell.classList.contains('collapsed'));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setSide(!shell.classList.contains('collapsed')); }
  });

  /**
   * The quinvium command in the terminal. The app adds the path only on a click; it never touches system settings by itself.
   * On Windows never `setx PATH "%PATH%;…"`: it truncates the path to 1024 characters and PowerShell does not expand %PATH%.
   */
  d.cliPath().then((cli) => {
    if (!cli) return;
    el('s-cli').hidden = false;
    el('s-cli-line').textContent = cli.line;
    el('s-cli-copy').onclick = () => navigator.clipboard.writeText(cli.line);
    el('s-cli-install').onclick = async () => {
      el('s-cli-install').disabled = true;
      const r = await d.cliInstall().catch((e) => ({ ok: false, error: e.message }));
      el('s-cli-state').textContent = !r.ok ? tr('It did not work: {error}', { error: r.error })
        : r.added ? tr('Done. Open a new terminal and type quinvium --help.') : tr('The quinvium command is already set up. Open a new terminal and type quinvium --help.');
      el('s-cli-install').disabled = false;
    };
  });

  i18n.apply(document);
  setSide(store.get('aether.side') === 'closed');
  document.querySelectorAll('nav button[data-tab]').forEach((b) => { b.title = b.textContent.trim(); });
  setInterval(drawCharts, CHART_MS);
  setInterval(showPoolEarnings, CHART_MS * 3);

  function lockOptions(minutes = Number(el('s-lock').value) || 15) {
    el('s-lock').innerHTML = LOCK_TIMES.map((m) => `<option value="${m}" ${m === minutes ? 'selected' : ''}>${tr('{n} minutes', { n: m })}</option>`).join('');
  }
  (async () => {
    const minutes = (await wallet('autoLock'))?.result ?? 15;
    lockOptions(minutes);
    el('s-lock').onchange = () => call('setAutoLock', { minutes: Number(el('s-lock').value) });
    const lockState = await walletStatus();
    if (lockState.initialized && !lockState.unlocked) showLock();
    setInterval(followWallet, CHART_MS);
    const devices = await d.listDevices();
    el('m-device').innerHTML = `<option value="all">${tr('All cards')}</option>${devices.map((x) => `<option value="${x.id}">${x.name.replace(/[<>&]/g, '')}</option>`).join('')}`;
    el('m-card').textContent = devices.length === 1 ? devices[0].name : devices.length ? tr('{n} graphics cards', { n: devices.length }) : tr('No graphics card found');
    fillAddress();
    const s = await d.state();
    // The remembered network (mainnet by default) before the node starts, not the first option of the list.
    if (!s.node.running && s.node.preferred) el('n-network').value = s.node.preferred;
    if (!s.node.running) el('n-start').click();
    refresh();
  })();
})();
