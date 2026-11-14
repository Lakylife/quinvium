// Wallet core. The phrase is encrypted with the password and after unlocking lives only in the browser's session memory.
importScripts('ethers.umd.min.js');
const { ethers } = self;

const KDF_ITERATIONS = 600000;
const AUTO_LOCK_MINUTES = 15;
const HD_PATH = "m/44'/60'/0'/0/";
const DEFAULT_NETWORKS = {
  52401: { chainId: 52401, name: 'Quinvium', rpc: 'https://rpc.quinvium.com', symbol: 'QU', explorer: 'https://explorer.quinvium.com' },
  52402: { chainId: 52402, name: 'Quinvium Testnet', rpc: 'https://rpc1.quinvium.com', symbol: 'tQU', explorer: 'https://testnet.quinvium.com', registry: '0x1F29eD151d57E51706494aB3E9579B2212102C10' },
  52403: { chainId: 52403, name: 'Quinvium Dev', rpc: 'http://127.0.0.1:8547', symbol: 'dQU', explorer: 'http://127.0.0.1:8547' },
};
// The test app next to the real one has its testnet node on its own port. The extension never gets this variable.
if (self.AETHER_TEST_RPC) Object.assign(DEFAULT_NETWORKS[52402], { rpc: self.AETHER_TEST_RPC, explorer: self.AETHER_TEST_RPC });
const RPC_PASSTHROUGH = /^(eth_(blockNumber|call|estimateGas|feeHistory|gasPrice|getBalance|getBlockBy|getBlockTransactionCountBy|getCode|getFilter|getLogs|getProof|getStorageAt|getTransactionBy|getTransactionCount|getTransactionReceipt|maxPriorityFeePerGas|newBlockFilter|newFilter|newPendingTransactionFilter|protocolVersion|syncing|uninstallFilter)|net_|web3_clientVersion|aether_)/;

const local = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};
const session = chrome.storage.session;
session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });

// ---- trezor ----------------------------------------------------------------------
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptVault(mnemonic, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

async function decryptVault(vault, password) {
  const key = await deriveKey(password, unb64(vault.salt), vault.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Wrong password');
  }
}

/** Unlocked secrets: the phrase and the keys of imported accounts. A wallet from a key has no phrase. */
async function secrets() {
  const s = await session.get(['open', 'mnemonic', 'keys']);
  return s.open ? { phrase: s.mnemonic ?? '', keys: s.keys ?? [] } : null;
}
const openSession = (phrase, keys) => session.set({ open: true, mnemonic: phrase, keys });

/** Every user action extends the lock. The time is chosen in the settings. */
async function touch() {
  chrome.alarms.create('autolock', { delayInMinutes: await local.get('autoLockMinutes', AUTO_LOCK_MINUTES) });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'autolock') lock(); });

async function lock() {
  await session.remove(['open', 'mnemonic', 'keys']);
  broadcast('accountsChanged', []);
  globalThis.onWalletLocked?.();
}

/** All accounts: first from the phrase, then imported keys. */
async function wallets() {
  const s = await secrets();
  if (!s) return [];
  const count = s.phrase ? await local.get('accountCount', 1) : 0;
  const hd = Array.from({ length: count }, (_, i) => ethers.HDNodeWallet.fromPhrase(s.phrase, undefined, HD_PATH + i));
  return [...hd, ...s.keys.map((k) => new ethers.Wallet(k))];
}

/** Imported keys are encrypted separately with the same password. */
async function loadKeys(password) {
  const stored = await local.get('keyVault');
  return stored ? JSON.parse(await decryptVault(stored, password)) : [];
}
const saveKeys = async (keys, password) => local.set('keyVault', await encryptVault(JSON.stringify(keys), password));

function cleanKey(key) {
  const text = String(key ?? '').trim();
  const hex = text.startsWith('0x') ? text : `0x${text}`;
  if (!ethers.isHexString(hex, 32)) throw new Error('Invalid private key');
  try {
    return new ethers.Wallet(hex).privateKey;
  } catch {
    throw new Error('Invalid private key');
  }
}

async function requireSigner(address) {
  if (!(await secrets())) throw rpcError(4100, 'The wallet is locked');
  await touch();
  const list = await wallets();
  const w = address ? list.find((x) => x.address.toLowerCase() === address.toLowerCase()) : list[await local.get('selected', 0)];
  if (!w) throw rpcError(4100, 'Unknown account');
  return w;
}

/**
 * A wallet outside the app, MetaMask or WalletConnect: it holds the keys, the app knows only the address and relays requests to it.
 * The Chrome extension does not have this path; only the app provides `externalRequest`.
 */
const externalWallet = () => local.get('external', null);
function externalSign(ext, method, params) {
  if (!globalThis.externalRequest) throw new Error('External wallets are not available here');
  return globalThis.externalRequest(ext, method, params);
}

async function accountList() {
  const ext = await externalWallet();
  return ext ? [ext.address] : (await wallets()).map((w) => w.address);
}

async function selectedAddress() {
  const list = await accountList();
  return list[await local.get('selected', 0)] ?? list[0] ?? null;
}

// ---- networks and RPC ------------------------------------------------------------------
const rpcError = (code, message) => Object.assign(new Error(message), { code });

async function networks() {
  const all = { ...DEFAULT_NETWORKS, ...(await local.get('networks', {})) };
  // The coin's ticker is determined by the network. A stored copy from an earlier app version must not show an old one.
  for (const id of Object.keys(DEFAULT_NETWORKS)) all[id] = { ...all[id], symbol: DEFAULT_NETWORKS[id].symbol, registry: DEFAULT_NETWORKS[id].registry };
  return all;
}
async function currentNetwork() {
  const all = await networks();
  return all[await local.get('chainId', 52401)] ?? DEFAULT_NETWORKS[52401];
}

async function rpc(method, params = [], net) {
  const n = net ?? await currentNetwork();
  let res;
  try {
    res = await fetch(n.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  } catch {
    throw rpcError(-32603, `Node ${n.rpc} is not reachable`);
  }
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.error.message), { code: data.error.code, data: data.error.data });
  return data.result;
}

// ---- approvals -----------------------------------------------------------------
const approvals = new Map();
let nextApproval = 1;

const MAX_APPROVALS_PER_SITE = 3;

function askUser(kind, origin, data) {
  return new Promise((resolve, reject) => {
    // A page must not flood the user with windows; in that rush it is easy to approve something unwanted.
    if ([...approvals.values()].filter((a) => a.origin === origin).length >= MAX_APPROVALS_PER_SITE) {
      reject(rpcError(4001, 'Too many pending requests'));
      return;
    }
    const id = nextApproval++;
    approvals.set(id, { id, kind, origin, data, resolve, reject });
    chrome.windows.create({ url: `popup.html#approval=${id}`, type: 'popup', width: 380, height: 640 }, (w) => {
      const a = approvals.get(id);
      if (a) a.windowId = w?.id;
    });
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const a of approvals.values()) {
    if (a.windowId === windowId) {
      approvals.delete(a.id);
      a.reject(rpcError(4001, 'The user rejected the request'));
    }
  }
});

// ---- poplatky --------------------------------------------------------------------
const hexOf = (v) => `0x${BigInt(v).toString(16)}`;

/** The node's recommendation. A foreign network lacks this method; standard methods are used there. */
async function feeEstimates(net) {
  try {
    return await rpc('aether_feeEstimates', [], net);
  } catch {
    const tip = BigInt(await rpc('eth_maxPriorityFeePerGas', [], net));
    const history = await rpc('eth_feeHistory', ['0x1', 'latest', []], net);
    const baseFee = BigInt(history.baseFeePerGas.at(-1));
    const tier = (t, headroom, blocks) => ({ tip: t.toString(), maxFee: ((baseFee * headroom) / 100n + t).toString(), blocks, seconds: blocks * 15 });
    return { baseFee: baseFee.toString(), congested: false, blockTime: 15, tiers: { slow: tier(tip / 2n, 125n, 5), normal: tier(tip, 150n, 2), fast: tier(tip * 2n, 200n, 1) } };
  }
}

/** The fee chosen in the wallet window. */
function applyFee(prepared, fee) {
  if (!fee) return prepared;
  const maxFee = BigInt(fee.maxFeePerGas);
  const tip = BigInt(fee.maxPriorityFeePerGas);
  if (maxFee <= 0n || tip < 0n) throw rpcError(-32602, 'The fee must be positive');
  if (tip > maxFee) throw rpcError(-32602, 'The tip cannot be higher than the maximum fee');
  return { ...prepared, maxFeePerGas: hexOf(maxFee), maxPriorityFeePerGas: hexOf(tip) };
}

// ---- transakce -------------------------------------------------------------------
async function prepareTx(from, tx) {
  const net = await currentNetwork();
  const nonce = Number(await rpc('eth_getTransactionCount', [from, 'pending'], net));
  const call = { from, to: tx.to, value: tx.value ?? '0x0', data: tx.data ?? tx.input ?? '0x' };
  const gas = tx.gas ?? tx.gasLimit ?? `0x${((BigInt(await rpc('eth_estimateGas', [call], net)) * 12n) / 10n).toString(16)}`;
  const fees = await feeEstimates(net);
  const prepared = {
    type: 2, chainId: net.chainId, nonce, to: tx.to ?? null, value: call.value, data: call.data, gasLimit: gas,
    maxFeePerGas: hexOf(tx.maxFeePerGas ?? fees.tiers.normal.maxFee), maxPriorityFeePerGas: hexOf(tx.maxPriorityFeePerGas ?? fees.tiers.normal.tip),
  };
  return { prepared, fees, suggested: tx.maxFeePerGas !== undefined };
}

/** A signed transaction is remembered so it can be resent when the node forgets it. Large contract deployments are not. */
const MAX_KEPT_RAW = 16 * 1024;

/**
 * A replaced transaction stays in history with a link to the newer one. Only the block shows which of them goes through: the speed-up
 * may arrive late and the original gets mined.
 * @param {string} [replaces] hash transakce, kterou tahle nahrazuje
 * @param {object} [extra] what the wallet knows additionally about the transaction, for example the token being transferred, so history can describe it
 */
async function signAndSend(from, prepared, replaces, extra = {}) {
  const ext = await externalWallet();
  let hash;
  let raw = null;
  if (ext) {
    const { to, value, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas } = prepared;
    hash = await externalSign(ext, 'eth_sendTransaction', [{ from, ...(to ? { to } : {}), value: hexOf(value), data, gas: hexOf(gasLimit), maxFeePerGas, maxPriorityFeePerGas }]);
    // The nonce is chosen by a foreign wallet. The one of the transaction in the network applies; without it a failed one cannot be recognised.
    const sent = await rpc('eth_getTransactionByHash', [hash]).catch(() => null);
    prepared = { ...prepared, nonce: sent ? Number(sent.nonce) : undefined, external: true };
  } else {
    const w = await requireSigner(from);
    raw = await w.signTransaction(prepared);
    hash = await rpc('eth_sendRawTransaction', [raw]);
  }
  const activity = (await local.get('activity', [])).map((a) => (a.hash === replaces ? { ...a, replacedBy: hash } : a));
  activity.unshift({
    hash, from, to: prepared.to, value: prepared.value, data: prepared.data, gasLimit: prepared.gasLimit, nonce: prepared.nonce,
    maxFeePerGas: prepared.maxFeePerGas, maxPriorityFeePerGas: prepared.maxPriorityFeePerGas, chainId: prepared.chainId, at: Date.now(),
    ...(raw && raw.length <= MAX_KEPT_RAW * 2 ? { raw } : {}), ...(prepared.external ? { external: true } : {}), ...extra,
  });
  await local.set('activity', activity.slice(0, 50));
  return hash;
}

const DROP_DEPTH = 3;   // nonces used this deep in the chain can no longer be undone by a reorganisation

/**
 * Finds out what is still waiting for confirmation. Confirmed ones are not checked again.
 * A pending transaction ends in one of three ways: it gets mined, or its nonce is used by another
 * transaction and then it never happens, and neither coins nor tokens leave the account because of it. The third option is that the node
 * forgot it, for example after an outage. The signed transaction is still valid, so the wallet sends it again, the same one.
 */
async function withStatus(list, net) {
  let head = null;
  const used = new Map();
  const usedNonce = (from) => {
    if (!used.has(from)) {
      used.set(from, (async () => {
        head ??= Number(await rpc('eth_blockNumber', [], net));
        return Number(await rpc('eth_getTransactionCount', [from, hexOf(Math.max(0, head - DROP_DEPTH))], net));
      })().catch(() => null));
    }
    return used.get(from);
  };
  const checked = await Promise.all(list.map(async (a) => {
    if (a.done) return a;
    const receipt = await rpc('eth_getTransactionReceipt', [a.hash], net).catch(() => undefined);
    if (receipt === undefined) return a;
    if (receipt) return { ...a, done: true, pending: false };
    if (a.nonce === undefined) return { ...a, pending: true };
    const nonce = await usedNonce(a.from);
    if (nonce !== null && nonce > Number(a.nonce)) {
      // The nonce is gone. One more confirmation check: the transaction may have been mined just now.
      const again = await rpc('eth_getTransactionReceipt', [a.hash], net).catch(() => undefined);
      if (again === undefined) return a;
      return again ? { ...a, done: true, pending: false } : { ...a, done: true, pending: false, dropped: true };
    }
    // A replaced one is not sent again: it would bring back a cancelled payment.
    if (a.raw && !a.replacedBy) {
      const known = await rpc('eth_getTransactionByHash', [a.hash], net).catch(() => undefined);
      if (known === null) await rpc('eth_sendRawTransaction', [a.raw], net).catch(() => {});
    }
    return { ...a, pending: true };
  }));
  const update = new Map(checked.filter((a) => a.done).map((a) => [a.hash, a]));
  if (update.size) {
    const stored = await local.get('activity', []);
    await local.set('activity', stored.map((a) => update.get(a.hash) ?? a));
  }
  return checked;
}

/**
 * Addresses nothing comes back from: the zero address and the token contract itself. Both receive coins only by mistake,
 * typically after pasting a token address instead of the recipient's address.
 */
function checkRecipient(to, token) {
  if (!ethers.isAddress(to)) throw new Error('Invalid recipient address');
  if (BigInt(to) === 0n) throw new Error('This is the zero address. Anything sent there is lost for good.');
  if (token && ethers.getAddress(to) === ethers.getAddress(token)) throw new Error('This is the address of the token contract itself. Tokens sent there are lost for good. Enter the recipient’s address.');
}

const TRANSFER_SELECTOR = '0xa9059cbb';   // transfer(address,uint256)
const tokenMetaCache = new Map();
/** Token symbol and decimals. Returns null for anything that is not a token. */
async function tokenMeta(token, net) {
  const key = `${net.chainId}:${token.toLowerCase()}`;
  if (!tokenMetaCache.has(key)) {
    const read = (data) => rpc('eth_call', [{ to: token, data }, 'latest'], net);
    tokenMetaCache.set(key, Promise.all([read('0x95d89b41'), read('0x313ce567')])
      .then(([symbol, decimals]) => ({ symbol: ethers.AbiCoder.defaultAbiCoder().decode(['string'], symbol)[0].slice(0, 12), decimals: Number(decimals) }))
      .catch(() => null));
  }
  return tokenMetaCache.get(key);
}

// ---- account activity ---------------------------------------------------------------
// The network's wrapped coin has the old name in genesis. The wallet shows it as W + the coin symbol, for example WtQU.
const WRAPPED_COIN = '0xae0000000000000000000000000000000000000a';
const WITHDRAWAL_TOPIC = ethers.id('Withdrawal(address,uint256)');
// Calls after which the main coin arrives through an internal transfer: they are neither in the transaction list nor in token transfers.
const NATIVE_BACK = new Set(['swapExactTokensForNative(uint256,uint256,address[],address,uint256)', 'removeLiquidityNative(address,uint256,uint256,uint256,address,uint256)', 'withdraw(uint256)'].map((sig) => ethers.id(sig).slice(0, 10)));
const FEED = { local: 25, txs: 30, transfers: 40, payouts: 20, days: 7, rows: 40, receipts: 15 };
const poolNameCache = new Map();
/** Pool name from the node for the payout. A pool's name does not change after creation, so it only needs to be fetched once. */
function poolName(pool, net) {
  const key = `${net.chainId}:${pool.toLowerCase()}`;
  if (!poolNameCache.has(key)) poolNameCache.set(key, rpc('aether_pools', [{ query: pool.toLowerCase(), limit: 1 }], net).then((r) => r?.items?.[0]?.name ?? null, () => null));
  return poolNameCache.get(key);
}
const coinMeta = async (token, net) => (token.toLowerCase() === WRAPPED_COIN ? { symbol: `W${net.symbol}`, decimals: 18 } : tokenMeta(token, net));

/**
 * Account activity like on Etherscan, only easier to understand: sent from the wallet and pending, received payments, transfers
 * tokens in both directions (both sides for a swap), pool payouts and rewards for mined blocks per day.
 * A network without the Quinvium node index (foreign RPC) returns only what this wallet sent.
 */
async function activityFeed() {
  const net = await currentNetwork();
  const address = await selectedAddress();
  if (!address) return { items: [], indexed: false };
  const me = address.toLowerCase();
  const symbol = net.symbol;
  const stored = (await local.get('activity', [])).filter((a) => a.chainId === net.chainId && a.from?.toLowerCase() === me).slice(0, FEED.local);
  const tz = -new Date().getTimezoneOffset() * 60;
  const [own, txs, transfers, payouts, mined] = await Promise.all([
    withStatus(stored, net).catch(() => stored),
    rpc('aether_txs', [{ address, limit: FEED.txs }], net).catch(() => null),
    rpc('aether_addressTransfers', [address, FEED.transfers, 0], net).catch(() => null),
    rpc('aether_poolPayouts', [address, FEED.payouts, 0], net).catch(() => null),
    rpc('aether_minedByDay', [address, { days: FEED.days, tz }], net).catch(() => null),
  ]);
  const rows = new Map();
  const row = (hash) => { if (!rows.has(hash)) rows.set(hash, { id: hash, hash, legs: [] }); return rows.get(hash); };
  // The node's index returns addresses in lower case. The wallet shows them with a checksum, as everywhere else.
  const sum = (a) => (a ? ethers.getAddress(a) : null);
  const coin = (value, sign) => ({ value: BigInt(value).toString(), decimals: 18, symbol, sign });
  for (const tx of txs?.items ?? []) {
    const r = row(tx.hash);
    const out = tx.from?.toLowerCase() === me;
    const inn = tx.to?.toLowerCase() === me;
    const value = BigInt(tx.value ?? 0);
    Object.assign(r, {
      time: Number(tx.timestamp) * 1000, status: Number(tx.status) === 1 ? 'ok' : 'failed', from: sum(tx.from), to: sum(tx.to), value: value.toString(),
      data: (tx.input ?? '0x').slice(0, 10), out, in: inn, block: Number(tx.blockNumber), nonce: Number(tx.nonce),
      fee: out ? (BigInt(tx.gasUsed ?? 0) * BigInt(tx.effectiveGasPrice ?? tx.gasPrice ?? 0)).toString() : null,
    });
    if (value > 0n && !(out && inn)) r.legs.push(coin(value, out ? -1 : 1));
  }
  const tokens = [...new Set((transfers?.items ?? []).map((x) => x.token.toLowerCase()))];
  const metas = new Map(await Promise.all(tokens.map(async (t) => [t, await coinMeta(t, net).catch(() => null)])));
  for (const x of transfers?.items ?? []) {
    const [from, to] = [x.from.toLowerCase(), x.to.toLowerCase()];
    if (from === me && to === me) continue;
    const r = row(x.hash);
    const meta = metas.get(x.token.toLowerCase());
    const sign = to === me ? 1 : -1;
    r.legs.push(x.tokenId !== undefined
      ? { nft: x.tokenId, symbol: meta?.symbol ?? 'NFT', sign, token: x.token }
      : { value: x.value, decimals: meta?.decimals ?? 18, symbol: meta?.symbol ?? `${x.token.slice(0, 6)}…`, sign, token: x.token });
    r.time ??= Number(x.timestamp) * 1000;
    r.block ??= x.number;
    r.status ??= 'ok';
    r.from ??= sum(x.from);
    r.to ??= sum(x.to);
    r.tokenFrom ??= sum(x.from);
    r.tokenTo ??= sum(x.to);
  }
  const pools = [...new Set((payouts?.items ?? []).map((p) => p.pool.toLowerCase()))];
  const names = new Map(await Promise.all(pools.map(async (p) => [p, await poolName(p, net)])));
  for (const p of payouts?.items ?? []) {
    const id = `payout:${p.hash}:${p.pool.toLowerCase()}`;
    rows.set(id, { id, hash: p.hash, kind: 'payout', time: Number(p.timestamp) * 1000, status: 'ok', block: p.number, pool: sum(p.pool), poolName: names.get(p.pool.toLowerCase()) ?? null, legs: [coin(p.amount, 1)] });
  }
  for (const d of mined?.items ?? []) {
    const id = `mined:${d.start}`;
    rows.set(id, { id, kind: 'mining', time: Number(d.time) * 1000, day: Number(d.start) * 1000, status: 'ok', blocks: d.blocks, first: d.first, last: d.last, legs: [coin(d.income, 1)] });
  }
  for (const a of own) {
    const known = rows.get(a.hash);
    if (known) { known.local = a; continue; }
    // Not in the node's index: pending, failed, replaced, or older than the first page of the index.
    const value = BigInt(a.value ?? 0);
    rows.set(a.hash, {
      id: a.hash, hash: a.hash, time: a.at, status: a.dropped ? 'dropped' : a.pending ? (a.replacedBy ? 'replaced' : 'pending') : 'ok',
      from: a.from, to: a.to ?? null, value: value.toString(), data: (a.data ?? '0x').slice(0, 10), out: true, nonce: a.nonce,
      legs: a.token ? [{ value: a.token.amount, decimals: a.token.decimals, symbol: a.token.symbol, sign: -1, token: a.token.address }] : value > 0n ? [coin(value, -1)] : [],
      tokenTo: a.token?.to ?? null, local: a,
    });
  }
  const items = [...rows.values()].filter((r) => r.time).sort((x, y) => y.time - x.time).slice(0, FEED.rows);
  // The main coin arrived through an internal transfer (swap to the coin, liquidity withdrawal, unwrapping): the Withdrawal event gives the amount.
  const back = items.filter((r) => r.out && r.status === 'ok' && NATIVE_BACK.has(r.data) && !r.legs.some((l) => l.sign === 1 && !l.token)).slice(0, FEED.receipts);
  await Promise.all(back.map(async (r) => {
    const rc = await rpc('eth_getTransactionReceipt', [r.hash], net).catch(() => null);
    const got = (rc?.logs ?? []).filter((l) => l.address?.toLowerCase() === WRAPPED_COIN && l.topics?.[0] === WITHDRAWAL_TOPIC).reduce((sum, l) => sum + BigInt(l.data), 0n);
    if (got > 0n) r.legs.push(coin(got, 1));
  }));
  return { items, indexed: !!txs, address };
}

/** An ERC-20 token transfer is a contract call; the amount is in the token's own decimals. */
function tokenTransfer(token, to, value, decimals) {
  const data = `0xa9059cbb${ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [ethers.getAddress(to), ethers.parseUnits(value, decimals)]).slice(2)}`;
  return { to: ethers.getAddress(token), value: '0x0', data };
}

// ---- requests from web pages --------------------------------------------------------
const ports = new Set();

function broadcast(event, data) {
  for (const p of ports) {
    if (event === 'accountsChanged') {
      connectedOrigin(p).then((ok) => ok && p.postMessage({ event, data }));
    } else {
      p.postMessage({ event, data });
    }
  }
}

const originOf = (port) => port.sender?.origin ?? new URL(port.sender?.url ?? 'about:blank').origin;
async function connectedOrigin(port) { return !!(await local.get('sites', {}))[originOf(port)]; }

async function ensureUnlocked(origin) {
  if ((await externalWallet()) || await secrets()) return;
  await askUser('unlock', origin, {});
}

/** A page may request a signature only for the account the wallet showed it, not for another account from the vault. */
async function requireSelected(address) {
  const selected = await selectedAddress();
  if (typeof address !== 'string' || !selected || address.toLowerCase() !== selected.toLowerCase()) throw rpcError(4100, 'This account is not allowed');
}

async function dappRequest(port, method, params) {
  const origin = originOf(port);
  const sites = await local.get('sites', {});
  const connected = !!sites[origin];
  const hexChain = async () => `0x${(await currentNetwork()).chainId.toString(16)}`;

  switch (method) {
    case 'eth_chainId': return hexChain();
    case 'net_version': return String((await currentNetwork()).chainId);
    case 'eth_accounts': {
      if (!connected) return [];
      const a = await selectedAddress();
      return a ? [a] : [];
    }
    case 'eth_requestAccounts': {
      if (!connected) {
        await askUser('connect', origin, {});
        // Reload: another page may have completed the approval while waiting.
        const fresh = await local.get('sites', {});
        fresh[origin] = { at: Date.now() };
        await local.set('sites', fresh);
      } else {
        await ensureUnlocked(origin);
      }
      const a = await selectedAddress();
      return a ? [a] : [];
    }
    case 'wallet_getPermissions': return connected ? [{ parentCapability: 'eth_accounts' }] : [];
    case 'wallet_requestPermissions': await dappRequest(port, 'eth_requestAccounts', []); return [{ parentCapability: 'eth_accounts' }];
    case 'wallet_revokePermissions': delete sites[origin]; await local.set('sites', sites); return null;
    case 'wallet_switchEthereumChain': {
      const id = Number(BigInt(params[0].chainId));
      const all = await networks();
      if (!all[id]) throw rpcError(4902, 'This network has not been added to the wallet');
      if (id !== (await currentNetwork()).chainId) {
        await askUser('switch', origin, { network: all[id] });
        await setChain(id);
      }
      return null;
    }
    case 'wallet_addEthereumChain': {
      const p = params[0];
      const id = Number(BigInt(p.chainId));
      // A known network is only switched to: a page must not slip in another node for an existing network.
      if ((await networks())[id]) return dappRequest(port, 'wallet_switchEthereumChain', [{ chainId: p.chainId }]);
      const net = { chainId: id, name: String(p.chainName).slice(0, 40), rpc: p.rpcUrls?.[0], symbol: String(p.nativeCurrency?.symbol ?? 'QU').slice(0, 8), explorer: p.blockExplorerUrls?.[0] ?? '' };
      if (!/^https?:\/\//.test(net.rpc ?? '')) throw rpcError(-32602, 'Invalid RPC address');
      // The extension connects to an address from the page only after consent, otherwise requests could be sent into the local network.
      await askUser('addNetwork', origin, { network: net });
      const remote = BigInt(await rpc('eth_chainId', [], net));
      if (remote !== BigInt(id)) throw rpcError(-32602, 'The node belongs to a different network than stated');
      const stored = await local.get('networks', {});
      stored[id] = net;
      await local.set('networks', stored);
      await setChain(id);
      return null;
    }
    case 'eth_sendTransaction': {
      if (!connected) throw rpcError(4100, 'The site is not connected');
      await ensureUnlocked(origin);
      const tx = params[0];
      const from = await selectedAddress();
      if (tx.from && tx.from.toLowerCase() !== from.toLowerCase()) throw rpcError(4100, 'This account is not allowed');
      const { prepared, fees, suggested } = await prepareTx(from, tx);
      if (await externalWallet()) return signAndSend(from, prepared);    // the wallet itself shows the confirmation
      const answer = await askUser('transaction', origin, { from, tx: prepared, network: await currentNetwork(), fees, suggested });
      return signAndSend(from, applyFee(prepared, answer?.fee));
    }
    case 'personal_sign': {
      if (!connected) throw rpcError(4100, 'The site is not connected');
      await ensureUnlocked(origin);
      const ext = await externalWallet();
      if (ext) return externalSign(ext, method, params);
      // The address is hex too, so the order is recognised by it: some pages send (address, message).
      const [data, address] = ethers.isAddress(params[0]) && !ethers.isAddress(params[1]) ? [params[1], params[0]] : params;
      await requireSelected(address);
      const text = (() => { try { return ethers.toUtf8String(data); } catch { return data; } })();
      await askUser('sign', origin, { message: text, address });
      return (await requireSigner(address)).signMessage(ethers.getBytes(data));
    }
    case 'eth_signTypedData_v4': {
      if (!connected) throw rpcError(4100, 'The site is not connected');
      await ensureUnlocked(origin);
      const ext = await externalWallet();
      if (ext) return externalSign(ext, method, params);
      await requireSelected(params[0]);
      const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      const chain = BigInt((await currentNetwork()).chainId);
      if (typed.domain?.chainId !== undefined && BigInt(typed.domain.chainId) !== chain) throw rpcError(-32602, 'The signature is for a different network');
      // Whom a signature is valid for matters as much as its content; that is where token allowance scams go through.
      const shown = { kontrakt: typed.domain?.verifyingContract ?? '—', aplikace: typed.domain?.name ?? '—', zprava: typed.message };
      await askUser('sign', origin, { message: JSON.stringify(shown, null, 2), address: params[0], typed: typed.primaryType });
      const { EIP712Domain, ...types } = typed.types;
      return (await requireSigner(params[0])).signTypedData(typed.domain, types, typed.message);
    }
    default:
      if (RPC_PASSTHROUGH.test(method)) return rpc(method, params);
      throw rpcError(4200, `Method ${method} is not supported`);
  }
}

async function setChain(id) {
  await local.set('chainId', id);
  broadcast('chainChanged', `0x${id.toString(16)}`);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dapp') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async ({ id, method, params }) => {
    try {
      const result = await dappRequest(port, method, params ?? []);
      port.postMessage({ id, result });
    } catch (e) {
      port.postMessage({ id, error: { code: e.code ?? -32603, message: e.message, data: e.data } });
    }
  });
});

// ---- commands from the extension's own windows ------------------------------------------
const commands = {
  async status() {
    const vault = await local.get('vault');
    const external = await externalWallet();
    return { initialized: !!vault || !!external, unlocked: !!external || !!(await secrets()), external: external ?? null };
  },
  /** Address of the signed-in wallet. Mining payouts go here; no other address can be set. */
  address: () => selectedAddress(),
  /** Sign-in with a wallet outside the app. A signature in the app window proved ownership of the address. */
  async setExternal({ kind, name, address, rdns }) {
    if (await local.get('vault')) throw new Error('Log out of the current wallet first');
    await chrome.storage.local.set({ external: { kind, name: String(name ?? kind).slice(0, 40), rdns: rdns ?? null, address: ethers.getAddress(address) }, selected: 0 });
    broadcast('accountsChanged', [ethers.getAddress(address)]);
    return true;
  },
  newMnemonic: () => ethers.Mnemonic.fromEntropy(crypto.getRandomValues(new Uint8Array(32))).phrase,
  async create({ phrase, password }) {
    if (typeof password !== 'string' || password.length < 10) throw new Error('The password must have at least 10 characters');
    const clean = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!ethers.Mnemonic.isValidMnemonic(clean)) throw new Error('Invalid recovery phrase');
    await local.set('vault', await encryptVault(clean, password));
    await local.set('accountCount', 1);
    await local.set('selected', 0);
    await openSession(clean, []);
    await touch();
    return true;
  },
  /** A wallet from a private key only, for example from another app. It has no phrase. */
  async createFromKey({ key, password }) {
    if (typeof password !== 'string' || password.length < 10) throw new Error('The password must have at least 10 characters');
    const clean = cleanKey(key);
    await local.set('vault', await encryptVault('', password));
    await saveKeys([clean], password);
    await local.set('accountCount', 0);
    await local.set('selected', 0);
    await openSession('', [clean]);
    await touch();
    return true;
  },
  async unlock({ password }) {
    const phrase = await decryptVault(await local.get('vault'), password);
    await openSession(phrase, await loadKeys(password));
    await touch();
    const a = await selectedAddress();
    broadcast('accountsChanged', a ? [a] : []);
    return true;
  },
  lock,
  /** The user is at the computer: extends the unlock but does not open a locked wallet. */
  async touch() {
    if (await secrets()) await touch();
    return true;
  },
  /** Verifies the password before a sensitive change in the app. Returns no secret. */
  async checkPassword({ password }) {
    await decryptVault(await local.get('vault'), password);
    await touch();
    return true;
  },
  autoLock: () => local.get('autoLockMinutes', AUTO_LOCK_MINUTES),
  async setAutoLock({ minutes }) {
    if (!(minutes > 0 && minutes <= 1440)) throw new Error('Invalid lock time');
    await chrome.storage.local.set({ autoLockMinutes: minutes });
    await touch();
    return true;
  },
  /** Sign-out. Pages learn about it immediately; the chosen network belongs to the device and stays. */
  async wipe() {
    for (const p of ports) p.postMessage({ event: 'accountsChanged', data: [] });
    const keep = await chrome.storage.local.get(['chainId', 'networks']);
    await chrome.storage.local.clear();
    await chrome.storage.local.set(keep);
    await session.clear();
    return true;
  },
  async overview() {
    const net = await currentNetwork();
    const accounts = await accountList();
    const selected = await local.get('selected', 0);
    const address = accounts[selected] ?? null;
    let balance = null;
    let online = true;
    try {
      if (address) balance = await rpc('eth_getBalance', [address, 'latest'], net);
    } catch { online = false; }
    const recent = (await local.get('activity', [])).filter((a) => a.chainId === net.chainId).slice(0, 10);
    const activity = online ? await withStatus(recent, net) : recent;
    return { network: net, networks: Object.values(await networks()), accounts, selected, address, balance, online, activity, external: await externalWallet() };
  },
  /** Accounts for selection: name, balance and where the account comes from. */
  async accounts() {
    const net = await currentNetwork();
    const names = await local.get('accountNames', {});
    const s = await secrets();
    const ext = await externalWallet();
    if (ext) names[ext.address] ??= ext.name;
    const fromPhrase = s?.phrase || ext ? await local.get('accountCount', 1) : 0;
    const list = await accountList();
    const balances = await Promise.all(list.map((a) => rpc('eth_getBalance', [a, 'latest'], net).catch(() => null)));
    return list.map((address, i) => ({ address, name: names[address] ?? null, index: i, number: i + 1, imported: i >= fromPhrase, balance: balances[i] }));
  },
  async renameAccount({ address, name }) {
    const names = await local.get('accountNames', {});
    const clean = String(name ?? '').trim().slice(0, 24);
    if (clean) names[address] = clean;
    else delete names[address];
    await local.set('accountNames', names);
    return true;
  },
  /** Adds an account from a private key. The password confirms the owner and encrypts the key. */
  async importKey({ key, password }) {
    const clean = cleanKey(key);
    const s = await secrets();
    if (!s) throw new Error('The wallet is locked');
    await decryptVault(await local.get('vault'), password);
    const keys = await loadKeys(password);
    const known = (await accountList()).map((a) => a.toLowerCase());
    if (known.includes(new ethers.Wallet(clean).address.toLowerCase())) throw new Error('This account is already in the wallet');
    keys.push(clean);
    await saveKeys(keys, password);
    await session.set({ keys });
    await local.set('selected', known.length);
    const a = await selectedAddress();
    broadcast('accountsChanged', [a]);
    return true;
  },
  /** Tokens the address holds. The node provides the list; a foreign network does not know it and only the main coin is shown. */
  async assets() {
    const net = await currentNetwork();
    const address = await selectedAddress();
    if (!address) return [];
    const info = await rpc('aether_addressInfo', [address], net).catch(() => null);
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const read = (to, data) => rpc('eth_call', [{ to, data }, 'latest'], net);
    const rows = await Promise.all((info?.tokens ?? []).map(async (token) => {
      try {
        const [symbol, decimals, balance] = await Promise.all([read(token, '0x95d89b41'), read(token, '0x313ce567'), read(token, `0x70a08231${coder.encode(['address'], [address]).slice(2)}`)]);
        // Anyone chooses a token name. Only the list of verified addresses decides authenticity.
        const listed = net.registry ? await read(net.registry, `0x${ethers.id('listed(address)').slice(2, 10)}${coder.encode(['address'], [token]).slice(2)}`).catch(() => '0x0') : '0x0';
        return { token, symbol: coder.decode(['string'], symbol)[0].slice(0, 12), decimals: Number(decimals), balance: BigInt(balance).toString(), verified: BigInt(listed) === 1n };
      } catch { return null; }
    }));
    return rows.filter((r) => r && r.balance !== '0');
  },
  /** Gas estimate for the summary before sending. */
  async quote({ to, value, token, decimals }) {
    checkRecipient(to, token);
    const from = await selectedAddress();
    const tx = token ? tokenTransfer(token, to, value, decimals) : { to: ethers.getAddress(to), value: ethers.toBeHex(ethers.parseEther(value)) };
    const { prepared, fees } = await prepareTx(from, tx);
    return { gas: BigInt(prepared.gasLimit).toString(), fees };
  },
  async addAccount() {
    const s = await secrets();
    if (!s?.phrase) throw new Error('This wallet has no recovery phrase, so it cannot create new accounts');
    const count = await local.get('accountCount', 1);
    await local.set('accountCount', count + 1);
    await local.set('selected', count);
    const a = await selectedAddress();
    broadcast('accountsChanged', [a]);
    return true;
  },
  async selectAccount({ index }) {
    await local.set('selected', index);
    const a = await selectedAddress();
    broadcast('accountsChanged', [a]);
    return true;
  },
  setNetwork: ({ chainId }) => setChain(chainId),
  async setRpc({ chainId, rpc: url }) {
    if (!/^https?:\/\//.test(url)) throw new Error('The address must start with http:// or https://');
    const all = await networks();
    const net = { ...all[chainId], rpc: url };
    const remote = BigInt(await rpc('eth_chainId', [], net));
    if (remote !== BigInt(chainId)) throw new Error('This node belongs to a different network');
    const stored = await local.get('networks', {});
    stored[chainId] = net;
    await local.set('networks', stored);
    return true;
  },
  async send({ to, value, fee, token, decimals, symbol }) {
    checkRecipient(to, token);
    const from = await selectedAddress();
    const tx = token ? tokenTransfer(token, to, value, decimals) : { to: ethers.getAddress(to), value: ethers.toBeHex(ethers.parseEther(value)) };
    const { prepared } = await prepareTx(from, tx);
    // A token transfer has a zero amount in the transaction. History therefore needs to know how much of what went to whom.
    const extra = token ? { token: { address: ethers.getAddress(token), symbol: String(symbol ?? '').slice(0, 12), decimals: Number(decimals), to: ethers.getAddress(to), amount: ethers.parseUnits(value, decimals).toString() } } : {};
    return signAndSend(from, applyFee(prepared, fee), undefined, extra);
  },
  activityFeed: () => activityFeed(),
  /** Details of a transaction from history: status, block, time and the fee actually paid. For a token transfer also its symbol. */
  async txDetail({ hash }) {
    const net = await currentNetwork();
    const item = (await local.get('activity', [])).find((a) => a.hash === hash) ?? null;
    const [receipt, tx] = await Promise.all([rpc('eth_getTransactionReceipt', [hash], net).catch(() => null), rpc('eth_getTransactionByHash', [hash], net).catch(() => null)]);
    const block = receipt ? await rpc('eth_getBlockByNumber', [receipt.blockNumber, false], net).catch(() => null) : null;
    const data = item?.data ?? tx?.input ?? '0x';
    const to = item?.to ?? tx?.to ?? null;
    let token = item?.token ?? null;
    if (!token && to && data.startsWith(TRANSFER_SELECTOR)) {
      const meta = await tokenMeta(to, net);
      const [recipient, amount] = ethers.AbiCoder.defaultAbiCoder().decode(['address', 'uint256'], `0x${data.slice(10)}`);
      if (meta) token = { address: ethers.getAddress(to), ...meta, to: recipient, amount: amount.toString() };
    }
    return {
      status: receipt ? (Number(receipt.status) === 1 ? 'ok' : 'failed') : item?.dropped ? 'dropped' : 'pending',
      blockNumber: receipt ? Number(receipt.blockNumber) : null,
      timestamp: block ? Number(block.timestamp) : null,
      fee: receipt ? (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice ?? 0)).toString() : null,
      token,
      explorer: net.explorer || null,
    };
  },
  /** Latest movements of one asset of the account from the node index. A network without the Quinvium index returns null and the list is not shown. */
  async assetHistory({ token }) {
    const net = await currentNetwork();
    const address = (await selectedAddress())?.toLowerCase();
    if (!address) return null;
    const row = (hash, timestamp, from, to, value) => ({ hash, timestamp, out: from.toLowerCase() === address, other: from.toLowerCase() === address ? to : from, value: BigInt(value).toString() });
    try {
      if (token) {
        const res = await rpc('aether_addressTransfers', [address, 50, 0], net);
        return res.items.filter((r) => r.token.toLowerCase() === token.toLowerCase() && r.value !== undefined).slice(0, 10).map((r) => row(r.hash, r.timestamp, r.from, r.to, r.value));
      }
      const res = await rpc('aether_txs', [{ address, limit: 25 }], net);
      return res.items.filter((x) => BigInt(x.value) > 0n && x.to).slice(0, 10).map((x) => row(x.hash, x.timestamp, x.from, x.to, x.value));
    } catch { return null; }
  },
  async feeOptions() { return feeEstimates(await currentNetwork()); },
  /** A stuck transaction: the same nonce with a higher fee. A cancellation is an empty payment to oneself. */
  async replaceTx({ hash, cancel }) {
    const net = await currentNetwork();
    const old = (await local.get('activity', [])).find((a) => a.hash === hash);
    // A foreign wallet chooses the nonce itself. A replacement would get the next number from it and a "speed-up" would pay twice.
    if (old?.external || (await externalWallet())) throw new Error('Speed up or cancel this transaction in the wallet that signed it.');
    if (old?.nonce === undefined) throw new Error('This transaction cannot be replaced');
    const fast = (await feeEstimates(net)).tiers.fast;
    const atLeast = (a, b) => (a > b ? a : b);
    const bump = (v) => (BigInt(v) * 11n + 9n) / 10n;   // the node wants at least 10 % more
    const tip = atLeast(bump(old.maxPriorityFeePerGas), BigInt(fast.tip));
    const maxFee = atLeast(atLeast(bump(old.maxFeePerGas), BigInt(fast.maxFee)), tip);
    const body = cancel ? { to: old.from, value: '0x0', data: '0x', gasLimit: '0x5208' } : { to: old.to, value: old.value, data: old.data, gasLimit: old.gasLimit };
    return signAndSend(old.from, { type: 2, chainId: old.chainId, nonce: old.nonce, ...body, maxFeePerGas: hexOf(maxFee), maxPriorityFeePerGas: hexOf(tip) }, hash);
  },
  async revealSeed({ password }) { return decryptVault(await local.get('vault'), password); },
  /** Private key of the selected account. Always requires the password, even when the wallet is unlocked. */
  async revealKey({ password }) {
    await decryptVault(await local.get('vault'), password);
    return (await wallets())[await local.get('selected', 0)].privateKey;
  },
  async sites() { return Object.keys(await local.get('sites', {})); },
  async disconnectSite({ origin }) {
    const s = await local.get('sites', {});
    delete s[origin];
    await local.set('sites', s);
    return true;
  },
  approvalGet({ id }) {
    const a = approvals.get(id);
    return a ? { id: a.id, kind: a.kind, origin: a.origin, data: a.data } : null;
  },
  approvalAnswer({ id, ok, fee }) {
    const a = approvals.get(id);
    if (!a) return false;
    approvals.delete(a.id);
    if (ok) a.resolve({ fee });
    else a.reject(rpcError(4001, 'The user rejected the request'));
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Sensitive commands may be called only by the extension's own pages, not by website content.
  const ownPage = sender.id === chrome.runtime.id && sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  if (!ownPage || !commands[msg?.cmd]) {
    reply({ error: 'Command not allowed' });
    return false;
  }
  Promise.resolve().then(() => commands[msg.cmd](msg)).then((result) => reply({ result }), (e) => reply({ error: e.message }));
  return true;
});
