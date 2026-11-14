// Wallet user interface and approval windows. The source language of texts is English; translations are in i18n.js.
const app = document.getElementById('app');
const _ = window.AetherI18n.t;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const call = (cmd, args = {}) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ cmd, ...args }, (r) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (r?.error) reject(new Error(_(r.error)));
    else resolve(r?.result);
  });
});
const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '');
const decimal = (text) => window.AetherI18n.decimal(text);
const aet = (hex) => {
  const v = ethers.formatEther(hex ?? 0);
  const [w, f = ''] = v.split('.');
  return f === '0' ? w : decimal(`${w}.${f.slice(0, 6)}`);
};
const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="0" y="0" width="64" height="64" rx="14.4" fill="#0B1622"/><path transform="translate(7.13 7.13) scale(0.78)" d="M32 2.75L59.58 22.79L49.05 55.21L14.95 55.21L4.42 22.79ZM18.21 27.27L23.48 43.48L40.52 43.48L45.79 27.27L32 17.25ZM39.37 33.81L55.24 55.66L47.56 61.24L31.69 39.4Z" fill="#F2B544"/></svg>';
const COIN = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#F2B544"/><path fill="#0B1622" d="M32 12.4L50.55 25.87L43.46 47.68L20.54 47.68L13.45 25.87ZM22.73 28.89L26.27 39.79L37.73 39.79L41.27 28.89L32 22.15ZM36.96 33.28L47.63 47.97L42.45 51.73L31.78 37.05Z"/></svg>';
const brand = `<div class="brand"><div class="logo">${LOGO}</div><div><strong>Quinvium Wallet</strong></div></div>`;
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.500"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2.500"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.1a2 2 0 1 1-2.900 2.900l-.1-.1a1.700 1.700 0 0 0-2.900 1.200V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-2.900-1.200l-.1.1a2 2 0 1 1-2.900-2.900l.1-.1a1.700 1.700 0 0 0-1.200-2.900H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.200-2.900l-.1-.1a2 2 0 1 1 2.900-2.900l.1.1a1.700 1.700 0 0 0 1.800.3h.1a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 2.900 1.200l.1-.1a2 2 0 1 1 2.900 2.900l-.1.1a1.700 1.700 0 0 0-.3 1.800v.1a1.700 1.700 0 0 0 1.500 1h.1a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z"/>'),
  send: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  deposit: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  chev: svg('<path d="m7 10 5 5 5-5"/>'),
  check: svg('<path d="m5 12.500 4.500 4.500L19 7.500"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.500 6.500l4 4"/>'),
  coin: svg('<circle cx="12" cy="12" r="8.500"/><path d="M12 7v10M9 10h6"/>'),
  swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  bridge: svg('<path d="M3 17h18M5 17V9M19 17V9M5 11c3 0 5-3 7-3s4 3 7 3M12 8v9"/>'),
};

/** A coloured square derived from the address, so accounts can be told apart at first glance. */
const avatar = (a, cls = '') => {
  const h1 = parseInt(String(a).slice(2, 8), 16) % 360;
  const h2 = parseInt(String(a).slice(-6), 16) % 360;
  return `<i class="avatar ${cls}" style="background:linear-gradient(135deg, hsl(${h1} 55% 52%) 50%, hsl(${h2} 55% 40%) 50%)"></i>`;
};
const accountName = (a) => a?.name ?? _('Account {n}', { n: a?.number ?? 1 });
/** Subpage header: the back arrow is always in the same place. */
const screenHead = (title) => `<header class="screen-head"><button class="icon" id="back" aria-label="${_('Back')}" title="${_('Back')}">${ICONS.back}</button><h1>${title}</h1></header>`;
// Slow loading must not overwrite a screen the user has opened in the meantime.
let screenVersion = 0;
const render = (html) => { screenVersion += 1; app.innerHTML = html; };
const $ = (s) => app.querySelector(s);
const on = (s, fn) => $(s)?.addEventListener('click', fn);
function bindForm(sel, fn) {
  $(sel).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.err');
    if (err) err.textContent = '';
    const button = e.target.querySelector('button[type=submit]');
    if (button) button.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(e.target)));
    } catch (x) {
      const box = $('.err');
      if (box) box.textContent = x.message;
    } finally {
      if (button) button.disabled = false;
    }
  });
}

/** A secret must not stay in the clipboard. The clipboard is cleared after a minute. */
const CLIPBOARD_MS = 60_000;
async function copySecret(button, text) {
  await navigator.clipboard.writeText(text);
  button.textContent = _('Copied, the clipboard clears in 60 s');
  setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), CLIPBOARD_MS);
}

// ---- poplatky --------------------------------------------------------------------
const gweiText = (wei) => decimal(ethers.formatUnits(wei, 'gwei').replace(/\.0$/, ''));
const coinText = (wei) => decimal(ethers.formatEther(wei).slice(0, 10));
const waitText = (s) => (s < 90 ? _('about {n} s', { n: s }) : _('about {n} min', { n: Math.round(s / 60) }));
const FEE_TIERS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];

/**
 * Fee choice as in Ethereum: three speeds by network state, or custom values in gwei.
 * @returns {{value: () => object|undefined}} the chosen fee, undefined for the page's proposal
 */
function feePicker(box, fees, gas, symbol, suggested, onChange = () => {}) {
  const base = BigInt(fees.baseFee);
  const typical = (tip) => BigInt(gas) * (base + BigInt(tip));
  let selected = suggested ? 'site' : 'normal';
  box.innerHTML = `<div class="fee-picker">
    <div class="row"><b>${_('Fee')}</b><span class="dim">${_('base {n} gwei', { n: gweiText(base) })}${fees.congested ? `, ${_('the network is busy')}` : ''}</span></div>
    <div class="fee-options">
      ${suggested ? `<button type="button" class="fee-option" data-tier="site"><strong>${_('From the site')}</strong><small>${_('suggested by the app')}</small></button>` : ''}
      ${FEE_TIERS.map(([id, label]) => `<button type="button" class="fee-option" data-tier="${id}"><strong>${_(label)}</strong><span>${coinText(typical(fees.tiers[id].tip))} ${esc(symbol)}</span><small>${waitText(fees.tiers[id].seconds)}</small></button>`).join('')}
      <button type="button" class="fee-option" data-tier="custom"><strong>${_('Custom')}</strong><small>${_('in gwei')}</small></button>
    </div>
    <div class="fee-custom hidden">
      <label>${_('Maximum fee (gwei)')}<input name="feeMax" inputmode="decimal" autocomplete="off" value="${gweiText(fees.tiers.normal.maxFee)}"></label>
      <label>${_('Miner tip (gwei)')}<input name="feeTip" inputmode="decimal" autocomplete="off" value="${gweiText(fees.tiers.normal.tip)}"></label>
    </div>
    <div class="warn fee-note"></div>
  </div>`;
  const q = (s) => box.querySelector(s);
  const parse = (name) => {
    const text = q(`[name=${name}]`).value.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,9})?$/.test(text)) throw new Error(_('Enter the fee in gwei, for example 1.5'));
    return ethers.parseUnits(text, 'gwei');
  };
  const read = () => {
    if (selected === 'site') return undefined;
    if (selected !== 'custom') return { maxFeePerGas: fees.tiers[selected].maxFee, maxPriorityFeePerGas: fees.tiers[selected].tip };
    const maxFee = parse('feeMax');
    const tip = parse('feeTip');
    if (tip > maxFee) throw new Error(_('The tip cannot be higher than the maximum fee'));
    return { maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: tip.toString() };
  };
  const refresh = () => {
    box.querySelectorAll('.fee-option').forEach((b) => b.classList.toggle('selected', b.dataset.tier === selected));
    q('.fee-custom').classList.toggle('hidden', selected !== 'custom');
    let note = '';
    try {
      const fee = read();
      if (fee) {
        const maxFee = BigInt(fee.maxFeePerGas);
        if (maxFee < base) note = _('The maximum fee is below the base fee. The transaction waits until the fee drops.');
        else if (maxFee > base * 100n && maxFee > 100_000_000_000n) note = _('This fee is unusually high, please check it.');
        onChange(fee);
      } else onChange(null);
    } catch (e) { note = e.message; }
    q('.fee-note').textContent = note;
  };
  box.querySelectorAll('.fee-option').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.tier; refresh(); }));
  box.querySelectorAll('input').forEach((i) => i.addEventListener('input', refresh));
  refresh();
  return { value: read };
}

/** After creating a wallet from the approval window, approval continues instead of the main screen. */
let afterSetup = null;

function welcome() {
  render(`${brand}<h1>${_('Your keys, your coins')}</h1><p>${_('The wallet lives only on this device. Nobody else can access it, and nobody can restore it without your phrase.')}</p>
    <button class="primary" id="new">${_('Create a new wallet')}</button><button id="imp">${_('Restore from phrase')}</button><button id="imp-key">${_('Use a private key')}</button>
    ${window.desktop ? `<p class="or-line">${_('Or use a wallet you already have')}</p><button id="ext-browser">MetaMask</button><button id="ext-wc">WalletConnect</button>` : ''}`);
  on('#new', async () => showSeed(await call('newMnemonic')));
  on('#imp', importSeed);
  on('#imp-key', importKeyFirst);
  if (window.desktop) {
    on('#ext-browser', () => window.signInBrowserWallet());
    on('#ext-wc', () => window.signInWalletConnect());
  }
}

/** A wallet from a key only: an account from another app, without a phrase. */
function importKeyFirst() {
  render(`${screenHead(_('Use a private key'))}<p>${_('Paste the private key of the account. It stays encrypted on this device.')}</p>
    <form id="f"><label>${_('Private key')}<input type="password" name="key" required autocomplete="off" spellcheck="false"></label>
    <label>${_('Password (at least 10 characters)')}<input type="password" name="p1" minlength="10" required autocomplete="new-password"></label>
    <label>${_('Repeat password')}<input type="password" name="p2" required autocomplete="new-password"></label>
    <div class="err"></div><button class="primary" type="submit">${_('Finish')}</button></form>`);
  bindForm('#f', async (v) => {
    if (v.p1 !== v.p2) throw new Error(_('The passwords do not match'));
    await call('createFromKey', { key: v.key, password: v.p1 });
    await window.onWalletChanged?.();
    (afterSetup ?? main)();
  });
  on('#back', welcome);
}

const seedGrid = (words) => `<div class="seed">${words.map((w, i) => `<span><i>${i + 1}</i>${esc(w)}</span>`).join('')}</div>`;

function showSeed(phrase) {
  render(`${screenHead(_('Recovery phrase'))}<p class="warn">${_('Write it down on paper and keep it safe. Anyone who knows it owns your coins. Never type it into a website or send it to anyone.')}</p>
    ${seedGrid(phrase.split(' '))}
    <button id="copy-seed">${_('Copy phrase')}</button>
    <button class="primary" id="next">${_('I have written it down')}</button>`);
  on('#copy-seed', () => copySecret($('#copy-seed'), phrase));
  on('#next', () => confirmSeed(phrase));
  on('#back', welcome);
}

/** Three random distinct positions from the phrase, different each time, sorted by order. */
function randomPositions(count, total) {
  const order = Array.from(crypto.getRandomValues(new Uint32Array(total)), (v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  return order.slice(0, count).map(([, i]) => i).sort((a, b) => a - b);
}

function confirmSeed(phrase) {
  const words = phrase.split(' ');
  const picks = randomPositions(3, words.length);
  render(`${screenHead(_('Check your phrase'))}<p>${_('Fill in these words to confirm you wrote the phrase down correctly.')}</p>
    <form id="f">${picks.map((i) => `<label>${_('Word no. {n}', { n: i + 1 })}<input name="w${i}" required autocomplete="off" spellcheck="false"></label>`).join('')}
    <div class="err"></div><button class="primary" type="submit">${_('Continue')}</button></form>`);
  bindForm('#f', async (v) => {
    for (const i of picks) if (v[`w${i}`].trim().toLowerCase() !== words[i]) throw new Error(_('Word no. {n} does not match', { n: i + 1 }));
    setPassword(phrase);
  });
  on('#back', () => showSeed(phrase));
}

function setPassword(phrase) {
  render(`<h1>${_('Password')}</h1><p>${_('The password encrypts the wallet on this device. Without the phrase nobody can recover it.')}</p>
    <form id="f"><label>${_('Password (at least 10 characters)')}<input type="password" name="p1" minlength="10" required autocomplete="new-password"></label>
    <label>${_('Repeat password')}<input type="password" name="p2" required autocomplete="new-password"></label>
    <div class="err"></div><button class="primary" type="submit">${_('Finish')}</button></form>`);
  bindForm('#f', async (v) => {
    if (v.p1 !== v.p2) throw new Error(_('The passwords do not match'));
    await call('create', { phrase, password: v.p1 });
    await window.onWalletChanged?.();
    (afterSetup ?? main)();
  });
}

function importSeed() {
  render(`${screenHead(_('Restore wallet'))}<form id="f"><label>${_('Recovery phrase')}<textarea name="phrase" required autocomplete="off" spellcheck="false"></textarea></label>
    <div class="err"></div><button class="primary" type="submit">${_('Continue')}</button></form>`);
  bindForm('#f', async (v) => {
    const clean = v.phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!ethers.Mnemonic.isValidMnemonic(clean)) throw new Error(_('Invalid recovery phrase'));
    setPassword(clean);
  });
  on('#back', welcome);
}

/**
 * Signing out deletes the encrypted wallet from the device. The coins stay at the address and only the phrase restores them,
 * hence the explicit confirmation. No password is asked, otherwise a forgotten password would block the wallet forever.
 */
async function logoutExternal(back) {
  render(`${screenHead(_('Log out of this wallet?'))}<p>${_('Your coins and keys stay in your wallet. The app only forgets the connection.')}</p><div class="err"></div><button class="danger" id="confirm-out">${_('Log out')}</button>`);
  on('#back', back);
  on('#confirm-out', async () => {
    await call('wipe');
    await window.onWalletRemoved?.();
    welcome();
  });
}

function logoutScreen(back) {
  const word = _('DELETE');
  render(`${screenHead(_('Log out of this wallet?'))}
    <p class="warn">${_('The wallet will be deleted from this device. Your coins stay on your address, but only the recovery phrase can reach them. Without it they are lost forever.')}</p>
    <p>${_('You can then create a new wallet or restore another one from its phrase.')}</p>
    <form id="f"><label>${_('To confirm, type {word}', { word })}<input name="confirm" required autocomplete="off" spellcheck="false"></label>
    <div class="err"></div><button class="danger" type="submit">${_('Log out')}</button></form>`);
  bindForm('#f', async (v) => {
    if (v.confirm.trim() !== word) throw new Error(_('Type {word} in capital letters', { word }));
    await call('wipe');
    await window.onWalletRemoved?.();
    welcome();
  });
  on('#back', back);
}

function unlockScreen(after, offerOther = true) {
  render(`${brand}<h1>${_('Unlock')}</h1><form id="f"><label>${_('Password')}<input type="password" name="password" required autofocus autocomplete="current-password"></label>
    <div class="err"></div><button class="primary" type="submit">${_('Unlock')}</button></form>
    ${offerOther ? `<div class="row quiet-links"><button class="link" id="other">${_('Use a different wallet')}</button></div>` : ''}`);
  bindForm('#f', async (v) => { await call('unlock', { password: v.password }); await window.onWalletChanged?.(); after(); });
  on('#other', () => logoutScreen(() => unlockScreen(after)));
}

const coinAmount = (hex) => aet(hex ?? 0);
const unitsText = (value, decimals) => decimal(ethers.formatUnits(value, decimals).replace(/(\.\d{1,6})\d*$/, '$1').replace(/\.0$/, ''));

// Kind of transaction by the called function. Selectors match the network's contracts; a test checks them against their ABI.
const CALL_KINDS = [
  ['transfer(address,uint256)', 'tokenPayment'], ['transferFrom(address,address,uint256)', 'tokenPayment'], ['approve(address,uint256)', 'approval'],
  ['swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', 'swap'], ['swapExactNativeForTokens(uint256,address[],address,uint256)', 'swap'],
  ['swapExactTokensForNative(uint256,uint256,address[],address,uint256)', 'swap'],
  ['addLiquidity((address,address,uint256,uint256,uint256,uint256),address,uint256)', 'liqAdd'], ['addLiquidityNative(address,uint256,uint256,uint256,address,uint256)', 'liqAdd'],
  ['removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)', 'liqRemove'], ['removeLiquidityNative(address,uint256,uint256,uint256,address,uint256)', 'liqRemove'],
  ['send(address,uint256,uint64,bytes)', 'bridge'], ['requestBitcoinDeposit(address)', 'bridge'], ['deposit()', 'wrap'], ['withdraw(uint256)', 'unwrap'],
];
let callKinds = null;
function txKind(a) {
  if (!a.to) return 'deploy';
  if (!a.data || a.data === '0x') return a.to.toLowerCase() === a.from?.toLowerCase() && BigInt(a.value ?? 0) === 0n ? 'cancel' : 'payment';
  callKinds ??= new Map(CALL_KINDS.map(([sig, kind]) => [ethers.id(sig).slice(0, 10), kind]));
  return callKinds.get(a.data.slice(0, 10)) ?? 'call';
}
function txLabel(a) {
  switch (txKind(a)) {
    case 'deploy': return _('Contract deployment');
    case 'payment': return _('Payment');
    case 'cancel': return _('Cancellation');
    case 'tokenPayment': return _('Token payment');
    case 'approval': return _('Token approval');
    case 'swap': return _('Swap');
    case 'liqAdd': return _('Add liquidity');
    case 'liqRemove': return _('Remove liquidity');
    case 'bridge': return _('Bridge transfer');
    case 'wrap': return _('Wrap coin');
    case 'unwrap': return _('Unwrap coin');
    default: return _('Contract call');
  }
}
/** What was sent: for a token its amount and symbol, nothing for a contract call without coins. */
const sentAmount = (a, symbol) => (a.token ? `−${unitsText(a.token.amount, a.token.decimals)} ${esc(a.token.symbol)}` : BigInt(a.value ?? 0) > 0n ? `−${coinAmount(a.value)} ${esc(symbol)}` : '');
/** The app opens the Explorer in its own tab, the extension in a new browser tab. Paths are like on Etherscan: /tx/…, /address/…, /token/…. */
const canOpenExplorer = (o) => !!window.openExplorer || !!o.network.explorer;
function openInExplorer(o, path) {
  if (window.openExplorer) return window.openExplorer(path);
  if (o.network.explorer) chrome.tabs.create({ url: `${o.network.explorer.replace(/\/$/, '')}${path}` });
  return undefined;
}
const tokenAmount = (a) => decimal(ethers.formatUnits(a.balance, a.decimals).replace(/(\.\d{1,6})\d*$/, '$1').replace(/\.0$/, ''));
let walletView = 'assets';

async function main() {
  const version = screenVersion;
  const o = await call('overview');
  if (window.approvalActive?.()) return;   // the app has shown the approval in the meantime; that takes precedence
  const symbol = o.network.symbol;
  const accounts = await call('accounts').catch(() => []);
  if (version !== screenVersion) return;
  const me = accounts[o.selected];
  render(`<header class="wallet-top">
      <button class="account-chip" id="accounts" title="${_('Accounts')}">${avatar(o.address)}<span><strong>${esc(accountName(me))}</strong><small id="addr" title="${esc(o.address)}">${esc(short(o.address))}</small></span>${ICONS.chev}</button>
      <div class="icon-row">
        <button class="icon" id="copy" title="${_('Copy address')}" aria-label="${_('Copy address')}">${ICONS.copy}</button>
        ${o.external ? '' : `<button class="icon" id="lock" title="${_('Lock wallet')}" aria-label="${_('Lock wallet')}">${ICONS.lock}</button>`}
        <button class="icon" id="settings" title="${_('Wallet settings')}" aria-label="${_('Wallet settings')}">${ICONS.gear}</button>
      </div>
    </header>
    <select id="net" aria-label="${_('Network')}">${o.networks.map((n) => `<option value="${n.chainId}" ${n.chainId === o.network.chainId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
    ${o.online ? '' : `<p class="err">${_('Node {rpc} is not reachable.', { rpc: esc(o.network.rpc) })}</p>`}
    <section class="card hero">
      <span class="dim">${_('Balance')}</span>
      <div class="balance" id="balance">${o.balance === null ? '—' : `${coinAmount(o.balance)} <small>${esc(symbol)}</small>`}</div>
      <div class="quick">
        <button class="quick-btn primary" id="send">${ICONS.send}<span>${_('Send')}</span></button>
        <button class="quick-btn" id="deposit">${ICONS.deposit}<span>${_('Deposit')}</span></button>
        ${window.desktop ? `<button class="quick-btn" id="go-swap">${ICONS.swap}<span>${_('Swap')}</span></button><button class="quick-btn" id="go-bridge">${ICONS.bridge}<span>${_('Bridge')}</span></button>` : ''}
      </div>
    </section>
    <div class="tabs" role="tablist"><button data-view="assets" class="${walletView === 'assets' ? 'active' : ''}">${_('Assets')}</button><button data-view="activity" class="${walletView === 'activity' ? 'active' : ''}">${_('Activity')}</button></div>
    <div id="view"></div><div class="err" id="tx-err"></div>`);
  $('#net').onchange = async (e) => { await call('setNetwork', { chainId: Number(e.target.value) }); main(); };
  on('#accounts', () => accountsScreen(o));
  if ($('#lock')) on('#lock', async () => { await call('lock'); start(); });
  on('#copy', async () => { await navigator.clipboard.writeText(o.address); $('#copy').innerHTML = ICONS.check; setTimeout(() => { if ($('#copy')) $('#copy').innerHTML = ICONS.copy; }, 1500); });
  on('#send', () => send(o).catch((e) => { $('#tx-err').textContent = e.message; }));
  on('#deposit', () => deposit(o));
  on('#go-swap', () => window.openAppTab?.('swap'));
  on('#go-bridge', () => window.openAppTab?.('bridge'));
  on('#settings', () => settings(o));
  app.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { walletView = b.dataset.view; app.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b)); showView(o); }));
  showView(o);
}

async function showView(o) {
  const box = $('#view');
  const symbol = o.network.symbol;
  if (walletView === 'activity') {
    // The last loaded activity shows immediately; the new one then quietly replaces it. A new block thus does not make the list flicker.
    const key = `${o.network.chainId}:${o.address}`;
    if (feedCache?.key === key) drawActivity(o, box, feedCache.items);
    else box.innerHTML = `<div class="card list"><p class="dim">${_('Loading…')}</p></div>`;
    const feed = await call('activityFeed').catch(() => null);
    if (!$('#view') || walletView !== 'activity' || box !== $('#view')) return;
    const items = feed?.items ?? o.activity.map(localRow);
    feedCache = { key, items };
    drawActivity(o, box, items);
    return;
  }
  const row = (index, icon, title, sub, value) => `<div class="asset asset-open" role="button" tabindex="0" data-asset="${index}" title="${_('Asset detail')}"><span class="asset-icon">${icon}</span><span class="asset-name"><b>${esc(title)}</b><small>${esc(sub)}</small></span><b class="asset-value">${value}</b></div>`;
  box.innerHTML = `<div class="card list">${row(0, COIN, 'Quinvium', symbol, o.balance === null ? '—' : coinAmount(o.balance))}</div>`;
  const bind = (tokens) => box.querySelectorAll('[data-asset]').forEach((el) => {
    const show = () => assetDetail(o, Number(el.dataset.asset), tokens);
    el.addEventListener('click', show);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  });
  bind([]);
  const tokens = await call('assets').catch(() => []);
  if (!tokens.length || !$('#view') || walletView !== 'assets') return;
  $('#view .list').insertAdjacentHTML('beforeend', tokens.map((a, i) => row(i + 1, ICONS.coin, a.symbol, `${a.verified ? _('Verified') : _('Not verified')} · ${short(a.token)}`, tokenAmount(a))).join(''));
  box.querySelectorAll('[data-asset]:not([data-asset="0"])').forEach((el) => {
    const show = () => assetDetail(o, Number(el.dataset.asset), tokens);
    el.addEventListener('click', show);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  });
}

/** Detail rows with values already prepared as HTML. */
const detailRows = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<b>${esc(k)}</b><span>${v}</span>`).join('')}</div>`;
const copyLink = (value, label) => `<button class="link copy-value" data-copy-value="${esc(value)}">${esc(label)}</button>`;
function bindCopies() {
  app.querySelectorAll('[data-copy-value]').forEach((b) => b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(b.dataset.copyValue);
    const before = b.textContent;
    b.textContent = _('Copied');
    setTimeout(() => { b.textContent = before; }, 1500);
  }));
}
const when = (ms) => new Date(ms).toLocaleString(window.AetherI18n.locale?.() ?? undefined);

// ---- aktivita ---------------------------------------------------------------------
const ACT_ICONS = {
  out: ICONS.send, in: ICONS.deposit, swap: ICONS.swap, bridge: ICONS.bridge, approval: ICONS.check, payout: ICONS.coin,
  mining: svg('<path d="M4 20 14 10m-3-5 8 8M7 3c6 0 11 4 14 10-6-3-9-6-14-10Z"/>'),
  liquidity: svg('<path d="M12 3.500c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11Z"/>'),
  contract: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>'),
  cancel: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};
const KIND_ICON = {
  payment: 'out', tokenPayment: 'out', received: 'in', swap: 'swap', wrap: 'swap', unwrap: 'swap', liqAdd: 'liquidity', liqRemove: 'liquidity',
  bridge: 'bridge', approval: 'approval', cancel: 'cancel', deploy: 'contract', call: 'contract', payout: 'payout', mining: 'mining',
};
let feedCache = null;
/** An item stored by the wallet in the same shape activityFeed returns. Only for a network without a node index. */
function localRow(a) {
  const value = BigInt(a.value ?? 0);
  return {
    id: a.hash, hash: a.hash, time: a.at, status: a.dropped ? 'dropped' : a.pending ? (a.replacedBy ? 'replaced' : 'pending') : 'ok', from: a.from, to: a.to ?? null,
    value: value.toString(), data: (a.data ?? '0x').slice(0, 10), out: true, nonce: a.nonce, tokenTo: a.token?.to ?? null, local: a,
    legs: a.token ? [{ value: a.token.amount, decimals: a.token.decimals, symbol: a.token.symbol, sign: -1, token: a.token.address }] : value > 0n ? [{ value: value.toString(), decimals: 18, symbol: null, sign: -1 }] : [],
  };
}
/** Kind of item: rewards and payouts by source, sent ones by the called function, the rest are incoming payments. */
const feedKind = (r) => {
  if (r.kind) return r.kind;
  if (r.out) return txKind({ to: r.to, from: r.from, data: r.data, value: r.value });
  // A token transfer without a transaction in the index (older, or sent by someone else): the direction of the transfer decides.
  return r.out === undefined && r.legs.length && r.legs.every((l) => l.sign < 0) ? 'tokenPayment' : 'received';
};
function feedTitle(r) {
  const kind = feedKind(r);
  if (kind === 'payout') return _('Pool payout');
  if (kind === 'mining') return _('Block rewards');
  if (kind === 'received') return _('Received');
  if (kind === 'swap') {
    const [paid, got] = [r.legs.find((l) => l.sign < 0), r.legs.find((l) => l.sign > 0)];
    if (paid && got) return _('Swap {a} → {b}', { a: paid.symbol, b: got.symbol });
  }
  return txLabel({ to: r.to, from: r.from, data: r.data, value: r.value });
}
const locale = () => window.AetherI18n.locale?.() ?? undefined;
const clock = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
/** Who is on the other side and when. For block rewards the number of blocks, for a payout the pool name. */
function feedSub(r) {
  const kind = feedKind(r);
  let who = '';
  if (kind === 'mining') who = _('{n} blocks', { n: decimal(String(r.blocks)) });
  else if (kind === 'payout') who = r.poolName ?? short(r.pool);
  else if (kind === 'received') who = `${_('From')} ${short(r.out ? r.tokenFrom : r.from ?? r.tokenFrom)}`;
  else if (kind === 'payment' || kind === 'tokenPayment') who = `${_('To')} ${short(r.tokenTo ?? r.to)}`;
  else if (r.to) who = short(r.to);
  return [who, kind === 'mining' ? '' : clock(r.time)].filter(Boolean).join(' · ');
}
const legText = (l, symbol) => `${l.sign > 0 ? '+' : '−'}${l.nft !== undefined ? `#${esc(l.nft)}` : unitsText(l.value, l.decimals)} ${esc(l.symbol ?? symbol)}`;
function dayLabel(ms) {
  const d = new Date(ms);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days === 0) return _('Today');
  if (days === 1) return _('Yesterday');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
}

/** Activity list by day. A pending sent transaction has speed-up and cancel right there. */
function drawActivity(o, box, items) {
  const symbol = o.network.symbol;
  const chip = (r) => (r.status === 'failed' ? `<span class="chip bad">${_('Failed')}</span>` : r.status === 'pending' ? `<span class="chip warn">${_('Waiting for confirmation')}</span>` : '');
  // A replaced transaction only offers the newer one; a failed one is struck through and says the coins stayed on the account.
  const state = (r) => {
    const a = r.local;
    if (r.status === 'dropped') return `<div class="tx-pending"><span class="dim">${_('Did not go through: another transaction with the same number replaced it. Nothing left your account because of it.')}</span></div>`;
    if (r.status !== 'pending' || !a) return r.status === 'replaced' ? `<div class="tx-pending"><span class="dim">${_('Replaced by a newer transaction')}</span></div>` : '';
    // A foreign wallet chooses the nonce itself; a replacement from it would be a second payment. Only it can speed up and cancel.
    if (a.external || o.external) return `<div class="tx-pending"><span class="dim">${_('Speed up or cancel this transaction in the wallet that signed it.')}</span></div>`;
    return `<div class="tx-pending"><span class="dim">${_('Waiting for confirmation')}</span><button class="link" data-speed="${esc(a.hash)}">${_('Speed up')}</button><button class="link" data-cancel="${esc(a.hash)}">${_('Cancel')}</button></div>`;
  };
  const rowHtml = (r) => {
    const icon = KIND_ICON[feedKind(r)] ?? 'contract';
    return `<div class="tx tx-open act${r.status === 'dropped' ? ' dropped' : ''}" role="button" tabindex="0" data-open="${esc(r.id)}" title="${_('Transaction detail')}">
      <span class="act-icon act-${icon}">${ACT_ICONS[icon]}</span>
      <div class="tx-main"><b>${esc(feedTitle(r))}</b><span>${esc(feedSub(r))}</span></div>
      <div class="act-legs">${r.legs.map((l) => `<b class="tx-amount${l.sign > 0 ? ' in' : ''}">${legText(l, symbol)}</b>`).join('')}${chip(r)}</div></div>${state(r)}`;
  };
  const groups = [];
  for (const r of items) {
    const label = dayLabel(r.day ?? r.time);
    if (groups.at(-1)?.[0] !== label) groups.push([label, []]);
    groups.at(-1)[1].push(r);
  }
  box.innerHTML = items.length ? groups.map(([label, list]) => `<h2 class="section-title act-day">${esc(label)}</h2><div class="card list">${list.map(rowHtml).join('')}</div>`).join('')
    : `<div class="card list"><p>${_('Nothing yet.')}</p></div>`;
  box.querySelectorAll('[data-open]').forEach((el) => {
    const show = () => activityDetail(o, items.find((r) => r.id === el.dataset.open));
    el.addEventListener('click', show);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  });
  const replace = (hash, cancel) => call('replaceTx', { hash, cancel }).then(main, (e) => { $('#tx-err').textContent = e.message; });
  box.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => replace(b.dataset.speed, false)));
  box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => replace(b.dataset.cancel, true)));
}

/**
 * Activity item details: status, both sides of a swap, to and from, fee, transaction number and block.
 * For block rewards the day and the block range, for a payout the pool. The link goes to the Explorer: transaction, pool or address.
 */
async function activityDetail(o, item) {
  if (!item) return;
  const r = item.legs ? item : localRow(item);
  const symbol = o.network.symbol;
  const kind = feedKind(r);
  render(`${screenHead(esc(feedTitle(r)))}<div class="wallet-detail" id="detail"><p class="dim">${_('Loading…')}</p></div>`);
  on('#back', main);
  const d = r.hash && kind !== 'mining' ? await call('txDetail', { hash: r.hash }).catch(() => null) : null;
  if (!$('#detail')) return;
  const a = r.local ?? null;
  const status = ['pending', 'dropped', 'replaced'].includes(r.status) && d?.status !== 'ok' && d?.status !== 'failed' ? r.status : (d?.status ?? r.status ?? 'ok');
  const block = d?.blockNumber ?? r.block ?? null;
  const statusText = {
    ok: kind === 'mining' ? _('Confirmed') : block !== null ? _('Confirmed in block {n}', { n: decimal(String(block)) }) : _('Confirmed'),
    failed: _('Failed'),
    dropped: _('Did not go through'),
    pending: _('Waiting for confirmation'),
    replaced: _('Replaced by a newer transaction'),
  }[status];
  const legs = r.legs.length ? r.legs : (d?.token ? [{ value: d.token.amount, decimals: d.token.decimals, symbol: d.token.symbol, sign: -1 }] : []);
  const big = legs.length ? legs.map((l) => `<div class="balance${l.sign > 0 ? ' in' : ''}">${legText(l, symbol).replace(/ (\S+)$/, ' <small>$1</small>')}</div>`).join('') : `<div class="balance">0 <small>${esc(symbol)}</small></div>`;
  const maxFee = a ? BigInt(a.gasLimit ?? 0) * BigInt(a.maxFeePerGas ?? 0) : 0n;
  const paidFee = d?.fee ?? r.fee ?? null;
  const fee = paidFee ? `${aet(BigInt(paidFee))} ${esc(symbol)}` : maxFee > 0n ? _('at most {value}', { value: `${aet(maxFee)} ${esc(symbol)}` }) : null;
  const note = status === 'failed' ? _('The transaction failed in the block, so nothing was transferred. Only the fee for the gas used was paid.')
    : status === 'dropped' ? _('Did not go through: another transaction with the same number replaced it. Nothing left your account because of it.') : '';
  const pending = status === 'pending' && a && !a.replacedBy && !a.external && !o.external;
  const address = (x) => (x ? copyLink(x, short(x)) : null);
  const rows = kind === 'mining' ? [
    [_('Day'), esc(new Date(r.day).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }))],
    [_('Blocks found'), esc(decimal(String(r.blocks)))],
    [_('Blocks'), `#${esc(decimal(String(r.first)))} – #${esc(decimal(String(r.last)))}`],
    [_('Last block'), esc(when(r.time))],
  ] : [
    [_('Type'), esc(feedTitle(r))],
    kind === 'payout' && [_('Pool'), `${esc(r.poolName ?? '')} ${address(r.pool)}`],
    kind !== 'payout' && (r.tokenTo ?? r.to) && [_('To'), address(r.tokenTo ?? r.to)],
    kind !== 'payout' && r.from && [_('From'), address(r.from)],
    fee && [status === 'ok' || status === 'failed' ? _('Fee paid') : _('Maximum fee'), fee],
    (a?.nonce ?? r.nonce) !== undefined && (a?.nonce ?? r.nonce) !== null && r.out && [_('Transaction number'), esc(String(a?.nonce ?? r.nonce))],
    a?.at && [_('Sent'), esc(when(a.at))],
    (d?.timestamp || (status === 'ok' && r.time)) && [_('Confirmed'), esc(when(d?.timestamp ? d.timestamp * 1000 : r.time))],
    r.hash && [_('Transaction'), copyLink(r.hash, short(r.hash))],
  ];
  const explorerPath = kind === 'mining' ? `/address/${o.address}?tab=mined` : r.hash ? `/tx/${r.hash}` : null;
  $('#detail').innerHTML = `<div class="card hero"><span class="dim ${status === 'ok' ? 'ok' : status === 'pending' ? 'warn' : ''}">${esc(statusText)}</span>${big}</div>
    ${note ? `<p class="dim">${esc(note)}</p>` : ''}
    <div class="card">${detailRows(rows)}</div>
    <div class="err" id="tx-err"></div>
    <div class="stack">
      ${pending ? `<button id="d-speed">${_('Speed up')}</button><button id="d-cancel">${_('Cancel')}</button>` : ''}
      ${kind === 'payout' && canOpenExplorer(o) ? `<button id="d-pool">${_('Open pool in Explorer')}</button>` : ''}
      ${explorerPath && canOpenExplorer(o) ? `<button id="d-explorer">${_('View in Explorer')}</button>` : ''}
    </div>`;
  bindCopies();
  on('#d-explorer', () => openInExplorer(o, explorerPath));
  on('#d-pool', () => openInExplorer(o, `/pool/${r.pool}`));
  const replace = (cancel) => call('replaceTx', { hash: r.hash, cancel }).then(main, (e) => { $('#tx-err').textContent = e.message; });
  on('#d-speed', () => replace(false));
  on('#d-cancel', () => replace(true));
}

/** Asset detail: balance, send, deposit, latest movements and a link to the Explorer. Index 0 is the network coin. */
async function assetDetail(o, index, tokens) {
  const symbol = o.network.symbol;
  const asset = index === 0 ? null : tokens[index - 1];
  if (index !== 0 && !asset) return;
  const title = asset ? asset.symbol : 'Quinvium';
  const balance = asset ? `${tokenAmount(asset)} <small>${esc(asset.symbol)}</small>` : `${o.balance === null ? '—' : coinAmount(o.balance)} <small>${esc(symbol)}</small>`;
  render(`${screenHead(esc(title))}<div class="wallet-detail"><section class="card hero"><span class="dim">${_('Balance')}</span><div class="balance">${balance}</div>
      <div class="quick"><button class="quick-btn primary" id="a-send">${ICONS.send}<span>${_('Send')}</span></button><button class="quick-btn" id="a-deposit">${ICONS.deposit}<span>${_('Deposit')}</span></button>
      ${window.desktop ? `<button class="quick-btn" id="a-swap">${ICONS.swap}<span>${_('Swap')}</span></button>` : ''}</div></section>
    <div class="card">${detailRows([
      [_('Network'), esc(o.network.name)],
      asset ? [_('Token'), esc(asset.verified ? _('Verified') : _('Not verified'))] : [_('Type'), esc(_('Main coin of the network'))],
      asset && [_('Contract address'), copyLink(asset.token, short(asset.token))],
    ])}</div>
    <h2 class="section-title">${_('Recent movements')}</h2><div class="card list" id="a-history"><p class="dim">${_('Loading…')}</p></div>
    ${canOpenExplorer(o) ? `<button id="a-explorer">${_('View in Explorer')}</button>` : ''}</div>`);
  on('#back', main);
  bindCopies();
  on('#a-send', () => send(o, { asset: index }).catch((e) => { $('.err')?.replaceChildren(e.message); }));
  on('#a-deposit', () => deposit(o));
  on('#a-swap', () => window.openAppTab?.('swap'));
  on('#a-explorer', () => openInExplorer(o, asset ? `/token/${asset.token}` : `/address/${o.address}`));
  const history = await call('assetHistory', { token: asset?.token ?? null }).catch(() => null);
  const box = $('#a-history');
  if (!box) return;
  if (!history) { box.innerHTML = `<p class="dim">${_('The history is in the Explorer.')}</p>`; return; }
  const decimals = asset ? asset.decimals : 18;
  const unit = asset ? asset.symbol : symbol;
  box.innerHTML = history.length ? history.map((h) => `<div class="tx tx-open" role="button" tabindex="0" data-hash="${esc(h.hash)}"><div class="tx-main"><b>${h.out ? _('Sent') : _('Received')}</b><span class="mono">${short(h.other)}</span></div><b class="tx-amount ${h.out ? '' : 'in'}">${h.out ? '−' : '+'}${unitsText(h.value, decimals)} ${esc(unit)}</b></div>`).join('') : `<p>${_('Nothing yet.')}</p>`;
  box.querySelectorAll('[data-hash]').forEach((el) => el.addEventListener('click', () => {
    const known = feedCache?.items?.find((r) => r.hash === el.dataset.hash) ?? (o.activity ?? []).find((a) => a.hash === el.dataset.hash);
    if (known) activityDetail(o, known);
    else if (canOpenExplorer(o)) openInExplorer(o, `/tx/${el.dataset.hash}`);
  }));
}

function accountsScreen(o) {
  const draw = async () => {
    const list = await call('accounts');
    render(`${screenHead(_('Accounts'))}<div class="card list">${list.map((a) => `<div class="account-row ${a.index === o.selected ? 'selected' : ''}">
        <button class="account-pick" data-index="${a.index}">${avatar(a.address)}<span><b>${esc(accountName(a))}${a.imported ? ` <em>${_('Imported')}</em>` : ''}</b><small class="mono">${esc(short(a.address))}</small></span><b class="asset-value">${a.balance === null ? '—' : coinAmount(a.balance)}</b>${a.index === o.selected ? ICONS.check : ''}</button>
        <button class="icon" data-rename="${esc(a.address)}" data-name="${esc(a.name ?? '')}" title="${_('Rename')}" aria-label="${_('Rename')}">${ICONS.edit}</button></div>`).join('')}</div>
      <div class="err"></div>
      <div class="stack" ${o.external ? 'hidden' : ''}><button id="more">${ICONS.plus}<span>${_('Add account')}</span></button><button id="add-key">${ICONS.key}<span>${_('Import private key')}</span></button></div>`);
    on('#back', main);
    app.querySelectorAll('[data-index]').forEach((b) => b.addEventListener('click', async () => { await call('selectAccount', { index: Number(b.dataset.index) }); main(); }));
    app.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', () => renameScreen(b.dataset.rename, b.dataset.name, draw)));
    on('#more', async () => {
      try {
        await call('addAccount');
        main();
      } catch (e) { $('.err').textContent = e.message; }
    });
    on('#add-key', () => importKeyScreen(draw));
  };
  draw();
}

function renameScreen(address, name, back) {
  render(`${screenHead(_('Rename'))}<form id="f"><label>${_('Account name')}<input name="name" maxlength="24" value="${esc(name)}" autocomplete="off"></label><div class="err"></div><button class="primary" type="submit">${_('Save')}</button></form>`);
  bindForm('#f', async (v) => { await call('renameAccount', { address, name: v.name }); back(); });
  on('#back', back);
}

function importKeyScreen(back) {
  render(`${screenHead(_('Import private key'))}<p>${_('Paste the private key of the account. It stays encrypted on this device.')}</p>
    <form id="f"><label>${_('Private key')}<input type="password" name="key" required autocomplete="off" spellcheck="false"></label>
    <label>${_('Wallet password')}<input type="password" name="password" required autocomplete="current-password"></label>
    <div class="err"></div><button class="primary" type="submit">${_('Import')}</button></form>`);
  bindForm('#f', async (v) => { await call('importKey', { key: v.key, password: v.password }); await window.onWalletChanged?.(); main(); });
  on('#back', back);
}

function deposit(o) {
  const code = window.qrcode(0, 'M');
  code.addData(o.address);
  code.make();
  render(`${screenHead(_('Deposit'))}<div class="card qr-card"><div class="qr">${code.createSvgTag({ cellSize: 5, margin: 2, scalable: true })}</div>
      <span class="mono" id="deposit-address">${esc(o.address)}</span><button class="primary" id="deposit-copy">${ICONS.copy}<span>${_('Copy address')}</span></button></div>
    <p class="warn">${_('Send only {coin} on {network} to this address. Coins sent from another network can be lost.', { coin: esc(o.network.symbol), network: esc(o.network.name) })}</p>`);
  on('#back', main);
  on('#deposit-copy', async () => { await navigator.clipboard.writeText(o.address); $('#deposit-copy span').textContent = _('Copied'); });
}

/** The first step of sending: what, to whom and how much. The fee and summary come in the next step. */
async function send(o, draft = {}) {
  const tokens = await call('assets').catch(() => []);
  const assets = [{ symbol: o.network.symbol, decimals: 18, balance: BigInt(o.balance ?? 0).toString() }, ...tokens];
  render(`${screenHead(_('Send'))}<form id="f">
      <label>${_('Asset')}<select name="asset">${assets.map((a, i) => `<option value="${i}" ${String(i) === String(draft.asset ?? 0) ? 'selected' : ''}>${esc(a.symbol)}</option>`).join('')}</select></label>
      <label>${_('Recipient address')}<input name="to" required autocomplete="off" spellcheck="false" placeholder="0x…" value="${esc(draft.to ?? '')}"></label>
      <label>${_('Amount')}<span class="amount-row"><input name="value" required inputmode="decimal" autocomplete="off" placeholder="${decimal('0.0')}" value="${esc(draft.value ?? '')}"><button type="button" id="max">${_('Max')}</button></span></label>
      <small class="dim" id="available"></small>
      <div class="err"></div><button class="primary" type="submit">${_('Review')}</button></form>`);
  const asset = () => assets[Number($('[name=asset]').value)];
  const showAvailable = () => { $('#available').textContent = _('Available: {value}', { value: `${decimal(ethers.formatUnits(asset().balance, asset().decimals))} ${asset().symbol}` }); };
  $('[name=asset]').addEventListener('change', showAvailable);
  showAvailable();
  on('#max', () => {
    // Enough of the main coin must remain for the fee, so a reserve for an ordinary transfer is subtracted.
    const a = asset();
    const reserve = a.token ? 0n : 21000n * 3n * 10n ** 9n * 3n;
    const left = BigInt(a.balance) - reserve;
    $('[name=value]').value = left > 0n ? ethers.formatUnits(left, a.decimals) : '0';
  });
  bindForm('#f', async (v) => {
    const a = asset();
    const to = v.to.trim();
    const value = v.value.trim().replace(',', '.');
    if (!ethers.isAddress(to)) throw new Error(_('Invalid recipient address'));
    if (BigInt(to) === 0n) throw new Error(_('This is the zero address. Anything sent there is lost for good.'));
    if (a.token && ethers.getAddress(to) === ethers.getAddress(a.token)) throw new Error(_('This is the address of the token contract itself. Tokens sent there are lost for good. Enter the recipient’s address.'));
    let units;
    try { units = ethers.parseUnits(value, a.decimals); } catch { throw new Error(_('Enter an amount')); }
    if (units <= 0n) throw new Error(_('Enter an amount'));
    if (units > BigInt(a.balance)) throw new Error(_('The amount is higher than your balance'));
    await reviewPayment(o, { ...v, to, value }, a);
  });
  on('#back', main);
}

async function reviewPayment(o, draft, asset) {
  const { gas, fees } = await call('quote', { to: draft.to, value: draft.value, token: asset.token, decimals: asset.decimals });
  const symbol = o.network.symbol;
  render(`${screenHead(_('Review payment'))}<div class="card hero"><span class="dim">${_('You are sending')}</span><div class="balance">${esc(decimal(draft.value))} <small>${esc(asset.symbol)}</small></div></div>
    ${kvRows([[_('From'), short(o.address)], [_('To'), short(draft.to)], [_('Network'), o.network.name]])}
    <div id="fee-box"></div><div class="row"><span class="dim">${_('Maximum fee')}</span><span id="fee-max"></span></div>
    <div class="err"></div><button class="primary" id="confirm">${_('Confirm and send')}</button>`);
  const show = (fee) => { $('#fee-max').textContent = `${coinText(BigInt(gas) * BigInt(fee?.maxFeePerGas ?? fees.tiers.normal.maxFee))} ${symbol}`; };
  const picker = feePicker($('#fee-box'), fees, BigInt(gas), symbol, false, show);
  on('#back', () => send(o, draft));
  on('#confirm', async () => {
    const button = $('#confirm');
    button.disabled = true;
    try {
      if (o.external) button.textContent = _('Confirm in your wallet');
      const hash = await call('send', { to: draft.to, value: draft.value, fee: picker.value(), token: asset.token, decimals: asset.decimals, symbol: asset.symbol });
      sentScreen(o, hash);
    } catch (e) {
      $('.err').textContent = e.message;
      button.disabled = false;
    }
  });
}

function sentScreen(o, hash) {
  render(`<div class="done-screen"><span class="done-mark">${ICONS.check}</span><h1>${_('Payment sent')}</h1><p>${_('It will appear on the receiving address once the network confirms it.')}</p>
    <span class="mono" id="done">${esc(short(hash))}</span><button class="primary" id="finish">${_('Done')}</button>${window.openExplorer ? `<button id="view-tx">${_('View in Explorer')}</button>` : ''}</div>`);
  on('#finish', main);
  on('#view-tx', () => window.openExplorer(`/tx/${hash}`));
}

/** A secret is shown only after entering the password and disappears again by itself. */
const REVEAL_MS = 60_000;
function revealForm(selector, command, showValue) {
  bindForm(selector, async (v) => {
    const box = $(`${selector}-out`);
    const value = await call(command, { password: v.password });
    box.innerHTML = showValue(value);
    box.querySelector('[data-copy]')?.addEventListener('click', (e) => copySecret(e.target, value));
    $(selector).reset();
    setTimeout(() => { box.innerHTML = ''; }, REVEAL_MS);
  });
}

async function settings(o) {
  const sites = await call('sites');
  const copyButton = `<button type="button" data-copy>${_('Copy')}</button>`;
  const language = window.desktop ? '' : `<div class="card"><label>${_('Language')}<select id="lang">${Object.entries(window.AetherI18n.languages).map(([code, name]) => `<option value="${code}" ${code === window.AetherI18n.lang() ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>`;
  if (o.external) {
    render(`${screenHead(_('Wallet settings'))}<div class="card"><p>${_('Connected through {name}. Keys stay in that wallet.', { name: esc(o.external.name) })}</p><p class="mono">${esc(o.external.address)}</p></div><div class="err"></div><button class="danger" id="logout">${_('Log out')}</button>`);
    on('#back', main);
    on('#logout', () => logoutExternal(() => settings(o)));
    return;
  }
  const minutes = await call('autoLock');
  const lockCard = window.desktop ? '' : `<div class="card"><label>${_('Lock after inactivity')}<select id="auto-lock">${[5, 15, 30, 60].map((m) => `<option value="${m}" ${m === minutes ? 'selected' : ''}>${_('{n} minutes', { n: m })}</option>`).join('')}</select></label></div>`;
  render(`${screenHead(_('Wallet settings'))}${language}${lockCard}
    <div class="card"><h2>${_('Node for {name}', { name: esc(o.network.name) })}</h2><form id="r"><label>${_('RPC address')}<input name="rpc" value="${esc(o.network.rpc)}" required spellcheck="false"></label><button type="submit">${_('Save')}</button></form></div>
    <div class="card"><h2>${_('Connected sites')}</h2>${sites.length ? sites.map((s) => `<div class="row"><span class="mono">${esc(s)}</span><button class="link" data-site="${esc(s)}">${_('Disconnect')}</button></div>`).join('') : `<p>${_('None.')}</p>`}</div>
    <div class="card"><h2>${_('Recovery phrase')}</h2><p class="warn">${_('Anyone who sees the phrase owns all your accounts. Show it only when you are alone.')}</p>
      <form id="s"><label>${_('Password')}<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">${_('Show phrase')}</button></form><div id="s-out"></div></div>
    <div class="card"><h2>${_('Private key')}</h2><p class="warn">${_('The private key controls the selected account. Nobody from Quinvium will ever ask you for it.')}</p>
      <form id="k"><label>${_('Password')}<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">${_('Show private key')}</button></form><div id="k-out"></div></div>
    <div class="err"></div><button class="danger" id="logout">${_('Log out')}</button>`);
  if ($('#lang')) $('#lang').onchange = (e) => { window.AetherI18n.setLang(e.target.value); settings(o); };
  if ($('#auto-lock')) $('#auto-lock').onchange = (e) => call('setAutoLock', { minutes: Number(e.target.value) });
  bindForm('#r', async (v) => { await call('setRpc', { chainId: o.network.chainId, rpc: v.rpc.trim() }); main(); });
  revealForm('#s', 'revealSeed', (phrase) => (phrase ? `${seedGrid(phrase.split(' '))}${copyButton}` : `<p>${_('This wallet was created from a private key, so it has no recovery phrase.')}</p>`));
  revealForm('#k', 'revealKey', (key) => `<div class="card mono" style="word-break:break-all">${esc(key)}</div>${copyButton}`);
  app.querySelectorAll('[data-site]').forEach((b) => b.addEventListener('click', async () => { await call('disconnectSite', { origin: b.dataset.site }); settings(o); }));
  on('#back', main);
  on('#logout', () => logoutScreen(() => settings(o)));
}

// ---- approval windows ------------------------------------------------------------
function kvRows(rows) { return `<div class="kv">${rows.map(([k, v]) => `<b>${esc(k)}</b><span>${esc(v)}</span>`).join('')}</div>`; }

/** The extension window closes after handling; the app continues in the same window instead. */
const approvalDone = () => (window.onApprovalDone ? window.onApprovalDone() : window.close());

async function approval(id) {
  const a = await call('approvalGet', { id });
  if (!a) { approvalDone(); return; }
  const keepAlive = setInterval(() => call('approvalGet', { id }).catch(() => {}), 5000); // keeps the extension core awake
  const answer = async (ok, fee) => { clearInterval(keepAlive); await call('approvalAnswer', { id, ok, fee }); approvalDone(); };
  const status = await call('status');
  // A page wants to connect a wallet that does not exist yet: first creation, then the usual approval.
  if (!status.initialized) {
    afterSetup = () => renderApproval(a, answer);
    welcome();
    return;
  }
  if (!status.unlocked) {
    unlockScreen(async () => { if (a.kind === 'unlock') answer(true); else renderApproval(a, answer); }, false);
    return;
  }
  if (a.kind === 'unlock') { answer(true); return; }
  renderApproval(a, answer);
}

function renderApproval(a, answer) {
  const n = a.data.network;
  const body = {
    connect: () => `<h1>${_('Connect this site?')}</h1><p>${_('The site will see your address and may ask for signatures. You approve every signature separately.')}</p>`,
    switch: () => `<h1>${_('Switch network?')}</h1>${kvRows([[_('Network'), n.name], ['Chain ID', n.chainId]])}`,
    addNetwork: () => `<h1>${_('Add network?')}</h1><p class="warn">${_('Only add networks you trust.')}</p>${kvRows([[_('Name'), n.name], ['Chain ID', n.chainId], [_('Node'), n.rpc], [_('Coin'), n.symbol]])}`,
    sign: () => `<h1>${_('Sign message?')}</h1>${a.data.typed ? `<p>${_('Type: {name}', { name: esc(a.data.typed) })}</p>` : ''}<div class="card mono" style="white-space:pre-wrap">${esc(a.data.message)}</div>`,
    transaction: () => {
      const t = a.data.tx;
      const fee = BigInt(t.gasLimit) * BigInt(t.maxFeePerGas);
      const isCall = t.data && t.data !== '0x';
      return `<h1>${t.to ? (isCall ? _('Contract call') : _('Send payment')) : _('Contract deployment')}</h1>
        ${kvRows([[_('Network'), n.name], [_('From'), short(a.data.from)], [_('To'), t.to ? short(t.to) : _('new contract')], [_('Amount'), `${aet(t.value)} ${n.symbol}`]])}
        <div id="fee-box"></div><div class="row"><span class="dim">${_('Maximum fee')}</span><span id="fee-max">${coinText(fee)} ${esc(n.symbol)}</span></div><div class="err"></div>
        ${isCall ? `<p class="warn">${_('This transaction calls a contract. Approve only what you understand.')}</p><div class="card mono">${esc(t.data.slice(0, 74))}${t.data.length > 74 ? '…' : ''}</div>` : ''}`;
    },
  }[a.kind]();
  render(`${brand}<p>${_('Request from')}</p><div class="origin">${esc(a.origin)}</div>${body}<div class="actions"><button id="no">${_('Reject')}</button><button class="primary" id="yes">${_('Approve')}</button></div>`);
  let picker = null;
  if (a.kind === 'transaction') {
    const t = a.data.tx;
    const show = (fee) => { $('#fee-max').textContent = `${coinText(BigInt(t.gasLimit) * BigInt(fee?.maxFeePerGas ?? t.maxFeePerGas))} ${n.symbol}`; };
    picker = feePicker($('#fee-box'), a.data.fees, BigInt(t.gasLimit), n.symbol, a.data.suggested, show);
  }
  on('#no', () => answer(false));
  on('#yes', () => {
    try {
      answer(true, picker?.value());
    } catch (e) {
      $('.err').textContent = e.message;
    }
  });
}

async function start() {
  const m = /approval=(\d+)/.exec(location.hash);
  if (m) { await approval(Number(m[1])); return; }
  const s = await call('status');
  if (!s.initialized) welcome();
  else if (!s.unlocked) unlockScreen(main);
  else main();
}

start().catch((e) => render(`<p class="err">${esc(e.message)}</p>`));
