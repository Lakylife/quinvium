// Hlavní proces aplikace Quinvium: spravuje uzel, miner a okno.
const { app, BrowserWindow, ipcMain, nativeTheme, powerSaveBlocker, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updater = require('./updater.cjs');
const versions = require('./versions.cjs');
const { WalletLink } = require('./wallet-link.cjs');
const { followHost } = require('./home-network.cjs');
const cliLauncher = require('./cli-launcher.cjs');

const NETWORKS = { mainnet: 8545, testnet: 8546 };
const P2P_PORTS = { mainnet: 30524, testnet: 30525 };
// Jen testy: zkušební aplikace běží vedle skutečné, proto má uzel vlastní porty a skutečného uzlu se nedotkne.
const TEST_RPC_PORT = Number(process.env.AETHER_RPC_PORT) || null;
const TEST_STRATUM_PORT = Number(process.env.AETHER_STRATUM_PORT) || null;
const CHAIN_FOLDERS = { testnet: 'testnet-5' };   // restart testnetu: nový genesis potřebuje prázdnou databázi, stará zůstává vedle
const LOG_LINES = 200;
const isWin = process.platform === 'win32';
const packaged = app.isPackaged;
// Aktualizovaná verze má vlastní složku, kterou předal spouštěč.
const resources = packaged ? process.env.AETHER_RESOURCES ?? process.resourcesPath : path.join(__dirname, '..');
const binDir = packaged ? path.join(resources, 'bin') : path.join(__dirname, '..', 'build');
const explorerDir = packaged ? path.join(resources, 'explorer') : path.join(__dirname, '..', '..', 'explorer', 'public');
const minerPath = path.join(binDir, isWin ? 'quintium-miner.exe' : 'quintium-miner');
const nodeBundle = path.join(binDir, 'quintium-node.cjs');

// Oddělená data pro automatické testy.
// Název a ikona i při spuštění bez sestavení. Sestavená aplikace je má ze svého balíčku.
app.setName('Quinvium');
if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
if (process.env.AETHER_USER_DATA) app.setPath('userData', process.env.AETHER_USER_DATA);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let explorerView = null;
const node = { proc: null, network: null, log: [], stats: null };
const miner = { proc: null, log: [], rate: null, blocks: 0, address: null, counters: null, history: [] };
const HISTORY_POINTS = 360;
const update = { checked: null, available: null, error: null, downloading: false };

const send = (e) => { if (win && !win.isDestroyed()) win.webContents.send('event', e); };
const push = (list, line) => { list.push(line); if (list.length > LOG_LINES) list.shift(); };

function follow(proc, onLine) {
  let rest = '';
  const feed = (d) => {
    rest += d.toString('utf8');
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    lines.filter(Boolean).forEach(onLine);
  };
  proc.stdout?.on('data', feed);
  proc.stderr?.on('data', feed);
}

const rpcPort = () => TEST_RPC_PORT ?? NETWORKS[node.network] ?? 8546;
async function rpc(method, params = []) {
  const r = await fetch(`http://127.0.0.1:${rpcPort()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const saveSettings = (change) => fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...change }), { mode: 0o600 });

/** Komu je uzel vidět: jen tomuto počítači, domácí síti, nebo i z internetu. Starší nastavení mělo jen zaškrtávátko. */
const ACCESS_MODES = ['off', 'lan', 'internet'];
const accessMode = (s = loadSettings()) => (ACCESS_MODES.includes(s.access) ? s.access : s.share ? 'lan' : 'off');

/** Uzly v místní síti se najdou samy, adresa je záloha pro sítě, kde všesměrové zprávy neprojdou. */
function networkArgs(network) {
  const settings = loadSettings();
  const { seed, tag, runPool, publicHost } = settings;
  const access = accessMode(settings);
  const args = ['--lan'];
  if (process.env.AETHER_LAN_PORT) args.push('--lan-port', process.env.AETHER_LAN_PORT);
  if (process.env.AETHER_P2P_PORT) args.push('--p2p-port', process.env.AETHER_P2P_PORT);   // jen testy, ať se k nim nepřipojí skutečné počítače
  if (TEST_RPC_PORT) args.push('--rpc-port', String(TEST_RPC_PORT));
  if (TEST_STRATUM_PORT) args.push('--stratum-port', String(TEST_STRATUM_PORT));
  // Značka v bloku ukazuje, který počítač ho vytěžil, když je adresa výplaty společná.
  if (tag) args.push('--extra', `aether/${tag}`);
  if (seed) {
    const address = seed.includes(':') ? seed : `${seed}:${P2P_PORTS[network]}`;
    args.push('--seeds', address);
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) args.push('--allow-private');
  }
  // Explorer a Stratum patří jen tomuto počítači, dokud je uživatel neotevře. Uzel nemá klíče ani správcovské metody.
  if (access !== 'off') args.push('--rpc-host', '0.0.0.0', '--stratum-host', '0.0.0.0', '--rate-limit', '6000');
  // Z internetu: router otevře porty sám (UPnP) a uzel zjistí veřejnou adresu, kterou pak ukáže peněženkám.
  if (access === 'internet') args.push('--public', ...(publicHost ? ['--public-host', publicHost] : []));
  // Server poolu: klíč jen platí gas za podíly, mince těžařů drží kontrakt.
  if (runPool?.network === network) args.push('--pool', runPool.address, '--pool-key-file', path.join(app.getPath('userData'), `pool-${network}.key`));
  return args;
}

/** Adresa tohoto počítače v místní síti, tu zadá ten druhý. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
  }
  return null;
}

function startNode(network) {
  if (node.proc) return { ok: true };
  if (!NETWORKS[network]) throw new Error('Unknown network');
  node.network = network;
  node.log = [];
  const dataDir = path.join(app.getPath('userData'), 'chain', CHAIN_FOLDERS[network] ?? network);
  fs.mkdirSync(dataDir, { recursive: true });
  node.proc = spawn(process.execPath, [nodeBundle, '--network', network, '--data-dir', dataDir, '--explorer', explorerDir, ...networkArgs(network)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  follow(node.proc, (l) => { push(node.log, l); send({ type: 'node-log', line: l }); });
  node.proc.on('exit', (code) => {
    push(node.log, `Uzel skončil s kódem ${code}`);
    node.proc = null;
    node.stats = null;
    node.endpoints = null;
    send({ type: 'state' });
  });
  send({ type: 'state' });
  return { ok: true };
}

const stop = (proc) => new Promise((resolve) => {
  if (!proc) { resolve(); return; }
  const t = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 6000);
  proc.once('exit', () => { clearTimeout(t); resolve(); });
  proc.kill(isWin ? undefined : 'SIGINT');
});

/** Průběh přípravy z výpisu těžaře: otevření karty, výpočet DAG a jeho kontrola. */
function readProgress(line) {
  if (miner.progress === null) return;
  const dag = /DAG (\d+) %/.exec(line);
  if (/\] backend /.test(line)) miner.progress = Math.max(miner.progress, 3);
  else if (/počítám DAG/.test(line)) { miner.stage = 'dag'; miner.progress = Math.max(miner.progress, 5); }
  else if (dag) { miner.stage = 'dag'; miner.progress = Math.max(miner.progress, Math.min(94, 5 + Math.round(Number(dag[1]) * 0.89))); }
  else if (/DAG hotový/.test(line)) { miner.stage = 'check'; miner.progress = 96; }
  else if (/Výkon [1-9]/.test(line) || /Výkon 0\.[0-9]*[1-9]/.test(line)) { miner.progress = null; miner.stage = null; }
}

/** Pool patří jedné síti. Po přepnutí sítě se těží sólo, dokud si uživatel nevybere jiný. */
function activePool() {
  const { pool } = loadSettings();
  return pool?.network === node.network ? pool : null;
}

/** Spící počítač netěží. Blokuje se jen uspání systému, obrazovka se klidně vypne. */
function keepAwake(on) {
  if (on && miner.awake === undefined) miner.awake = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && miner.awake !== undefined) {
    powerSaveBlocker.stop(miner.awake);
    miner.awake = undefined;
  }
}

/**
 * Výkon karty NVIDIA ve Windows. Ovladač ji jinak může nechat ve stavu P5 s pamětí na čtvrtině taktu.
 * Běží v samostatném procesu: když neveřejná funkce ovladače selže, těžby se to nedotkne.
 */
function setGpuState(state) {
  if (!isWin) return;
  execFile(minerPath, ['--gpu-state', String(state)], { timeout: 15000, windowsHide: true }, (e, out, err) => {
    miner.gpuState = `${state}: ${`${out ?? ''} ${err ?? ''} ${e?.message ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 600)}`;
    push(miner.log, `Výkon karty ${miner.gpuState}`);
  });
}

function startMiner({ address, device }) {
  if (miner.proc) return { ok: true };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) throw new Error('Invalid payout address');
  if (!node.proc) throw new Error('Start the node first');
  miner.log = [];
  miner.rate = null;
  miner.blocks = 0;
  miner.address = address;
  miner.device = device;
  miner.counters = null;
  miner.stage = 'start';
  miner.progress = 0;
  const { power, tag } = loadSettings();
  const pool = activePool();
  miner.pool = pool?.address ?? null;
  const args = ['--address', address, '--node', pool?.url ?? `http://127.0.0.1:${rpcPort()}`];
  if (pool) args.push('--pool', pool.address, '--worker', tag || 'rig');
  if (device !== undefined && device !== 'all') args.push('--device', String(device));
  args.push('--intensity', String(power ?? 100));
  if ((power ?? 100) >= 100) setGpuState(GPU_FULL_POWER);
  miner.proc = spawn(minerPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  keepAwake(true);
  follow(miner.proc, (l) => {
    push(miner.log, l);
    readProgress(l);
    const used = /\] backend (.+)$/.exec(l);
    if (used) miner.backend = used[1];
    const m = /Výkon ([\d.]+) ([^\s,]+)/.exec(l);
    if (m) miner.rate = `${m[1]} ${m[2]}`;
    if (/NALEZEN BLOK/.test(l)) miner.blocks += 1;
    const counters = updater.parseMinerLine(l);
    if (counters) {
      miner.counters = counters;
      miner.shares = counters.shares ?? 0;
      miner.history.push(counters.rate);
      if (miner.history.length > HISTORY_POINTS) miner.history.shift();
    }
    send({ type: 'miner-log', line: l, rate: miner.rate, blocks: miner.blocks, shares: miner.shares, progress: miner.progress, stage: miner.stage });
  });
  miner.proc.on('error', (e) => push(miner.log, `Miner nelze spustit: ${e.message}`));
  miner.proc.on('exit', (code, signal) => {
    push(miner.log, `Těžař skončil: kód ${code}, signál ${signal}`);
    miner.proc = null;
    keepAwake(false);
    setGpuState(GPU_DRIVER_DEFAULT);
    send({ type: 'state' });
  });
  send({ type: 'state' });
  return { ok: true };
}

const listDevices = () => new Promise((resolve) => {
  execFile(minerPath, ['--list'], { windowsHide: true, timeout: 20000 }, (err, out) => {
    if (err) { resolve([]); return; }
    resolve(out.split(/\r?\n/).map((l) => /^(\d+): (.+?) \(/.exec(l)).filter(Boolean).map((m) => ({ id: Number(m[1]), name: m[2] })));
  });
});

const walletFile = () => path.join(app.getPath('userData'), 'wallet.json');

ipcMain.handle('state', () => ({
  node: { running: !!node.proc, network: node.network, rpc: rpcPort(), runPool: loadSettings().runPool ?? null, stats: node.stats, log: node.log.slice(-60), seed: loadSettings().seed ?? '', share: accessMode() !== 'off', access: accessMode(), publicHost: loadSettings().publicHost ?? '', endpoints: node.proc ? node.endpoints ?? null : null, lan: lanAddress() },
  miner: { running: !!miner.proc, rate: miner.rate, progress: miner.progress ?? null, stage: miner.stage ?? null, blocks: miner.blocks, shares: miner.shares ?? 0, gpu: miner.gpu ?? null, pool: activePool(), address: miner.address, power: loadSettings().power ?? 100, history: miner.history, log: miner.log.slice(-60) },
  update: { ...update, configured: !!loadSettings().updateUrl, packaged: app.isPackaged },
  version: app.getVersion(),
}));
ipcMain.handle('node:start', (_, network) => startNode(network));
ipcMain.handle('node:stop', async () => { await stop(miner.proc); await stop(node.proc); return true; });
ipcMain.handle('node:network', async (_, options) => {
  const seed = String(options?.seed ?? '').trim();
  if (seed && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(seed)) throw new Error('Enter the computer address, for example 192.168.1.20');
  // Starší volání posílá jen share, nové posílá režim přístupu.
  const access = ACCESS_MODES.includes(options?.access) ? options.access : options?.share ? 'lan' : 'off';
  const publicHost = String(options?.publicHost ?? '').trim();
  if (publicHost && !/^[A-Za-z0-9.-]{1,253}$/.test(publicHost)) throw new Error('Enter the public address, for example 203.0.113.7 or node.example.com');
  saveSettings({ seed, share: access !== 'off', access, publicHost });
  // Nastavení se uzlu předává při spuštění. Těžba poběží dál a naváže, až se uzel vrátí.
  if (node.proc) {
    const { network } = node;
    await stop(node.proc);
    startNode(network);
  }
  return true;
});
ipcMain.handle('node:pool', async (_, address) => {
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid pool address');
  // Pool musí být dostupný z jiných počítačů, jinak by neměl kdo těžit.
  saveSettings(address ? { runPool: { network: node.network, address }, share: true, access: accessMode() === 'internet' ? 'internet' : 'lan' } : { runPool: null });
  if (node.proc) {
    const { network } = node;
    await stop(node.proc);
    startNode(network);
  }
  return true;
});
ipcMain.handle('miner:list', listDevices);
// Příkaz quinvium (a dřívější quintium): spouštěč ve stálé složce dat ukazuje na právě běžící verzi, i po aktualizaci přes internet.
const cliDir = () => path.join(app.getPath('userData'), 'bin');
function refreshCli() {
  // Bez sestavení (vývoj a testy) slouží příkazová řádka z build/, pokud ji prepare.mjs vytvořil.
  if (!packaged && !fs.existsSync(nodeBundle)) return null;
  try {
    const fallback = packaged ? path.join(process.resourcesPath, 'bin', 'quintium-node.cjs') : nodeBundle;
    return cliLauncher.writeLauncher({ dir: cliDir(), execPath: process.execPath, bundle: nodeBundle, fallback, platform: process.platform });
  } catch (e) {
    push(node.log, `Příkaz quintium: ${e.message}`);
    return null;
  }
}
ipcMain.handle('cli:path', () => (refreshCli() ? { dir: cliDir(), line: cliLauncher.manualLine(cliDir(), process.platform) } : null));
// Jen na kliknutí uživatele: přidá složku spouštěče do jeho cesty. Testy místo profilu dostanou vlastní soubor.
ipcMain.handle('cli:install', () => (refreshCli()
  ? cliLauncher.installPath({ dir: cliDir(), platform: process.platform, home: os.homedir(), shell: process.env.SHELL, profile: process.env.AETHER_SHELL_PROFILE })
  : { ok: false, error: 'not packaged' }));
ipcMain.handle('wallet:activity', () => { send({ type: 'activity' }); });

// MetaMask a další peněženky v prohlížeči: stránka na 127.0.0.1 předává žádosti o podpis, klíče zůstávají v peněžence.
const walletLink = new WalletLink({ open: (url) => shell.openExternal(url), onHello: (hello) => send({ type: 'wallet-link', ...hello }) });
ipcMain.handle('wallet:link-open', (_, o) => walletLink.show(o));
ipcMain.handle('wallet:link-request', (_, method, params, config) => walletLink.request(method, params, config));
ipcMain.handle('miner:start', (_, o) => startMiner(o));
ipcMain.handle('miner:stop', () => stop(miner.proc));
ipcMain.handle('wallet:load', () => {
  try { return JSON.parse(fs.readFileSync(walletFile(), 'utf8')); } catch { return {}; }
});
ipcMain.handle('wallet:save', (_, data) => {
  const tmp = `${walletFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, walletFile());
  return true;
});

// Peněženka běží v hlavním okně, okno Exploreru s ní mluví přes hlavní proces.
const walletCalls = new Map();
let nextWalletCall = 1;
let explorerOrigin = null;

ipcMain.handle('wallet:request', (e, { method, params }) => new Promise((resolve) => {
  const origin = (() => { try { return new URL(e.senderFrame.url).origin; } catch { return null; } })();
  if (!explorerView || explorerView.isDestroyed() || e.sender !== explorerView || origin !== explorerOrigin || typeof method !== 'string') {
    resolve({ error: { code: 4100, message: 'Tato stránka k peněžence nemá přístup' } });
    return;
  }
  if (!win || win.isDestroyed()) {
    resolve({ error: { code: 4900, message: 'Hlavní okno aplikace je zavřené' } });
    return;
  }
  const id = nextWalletCall++;
  walletCalls.set(id, resolve);
  send({ type: 'wallet-request', id, origin, method, params: params ?? [] });
}));
ipcMain.handle('wallet:answer', (e, { id, event, data, result, error }) => {
  if (e.sender !== win?.webContents) return;
  if (event) {
    if (explorerView && !explorerView.isDestroyed()) explorerView.send('wallet:event', { event, data });
    return;
  }
  walletCalls.get(id)?.(error ? { error } : { result });
  walletCalls.delete(id);
});
ipcMain.handle('wallet:focus', () => { win?.show(); win?.focus(); });

ipcMain.handle('explorer:info', () => {
  explorerOrigin = `http://127.0.0.1:${rpcPort()}`;
  return { url: `${explorerOrigin}/`, origin: explorerOrigin };
});
ipcMain.handle('miner:pool', async (_, pool) => {
  if (pool && (!/^0x[0-9a-fA-F]{40}$/.test(pool.address ?? '') || !/^https?:\/\/[^\s]+$/.test(pool.url ?? ''))) throw new Error('Invalid pool address');
  saveSettings({ pool: pool ? { address: pool.address, url: pool.url.replace(/\/$/, ''), name: String(pool.name ?? '').slice(0, 64), network: node.network } : null });
  if (miner.proc) {
    const { address, device } = miner;
    await stop(miner.proc);
    startMiner({ address, device });
  }
  return true;
});
ipcMain.handle('miner:power', async (_, value) => {
  const power = Math.min(100, Math.max(10, Math.round(Number(value) / 10) * 10)) || 100;
  saveSettings({ power });
  // Nový výkon se projeví hned: těžař se znovu spustí se stejnou adresou a kartou.
  if (miner.proc) {
    const { address, device } = miner;
    await stop(miner.proc);
    startMiner({ address, device });
  }
  return power;
});
ipcMain.handle('update:check', async () => {
  await updateNow().catch((e) => { update.error = e.message; });
  return { ...update };
});

// Explorer je vložený přímo v aplikaci. Stránka smí jen na lokální uzel a dostane jediný most k peněžence.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (event, prefs, params) => {
    prefs.preload = path.join(__dirname, 'explorer-preload.cjs');
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.nodeIntegration = false;
    if (!params.src.startsWith(`${explorerOrigin}/`)) event.preventDefault();
  });
  if (contents.getType() !== 'webview') return;
  explorerView = contents;
  const local = (target) => { try { return new URL(target).origin === explorerOrigin; } catch { return false; } };
  contents.on('will-navigate', (e, target) => {
    if (local(target)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
  });
  contents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
});

function createWindow() {
  nativeTheme.themeSource = 'system';
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 620, title: 'Quinvium', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0f15' : '#f7f6f2', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: true },
  });
  // Aplikace je jen lokální: nikam nenaviguje a odkazy otevírá v prohlížeči.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

setInterval(async () => {
  if (!node.proc) return;
  try {
    node.stats = await rpc('aether_stats');
    const endpoints = await rpc('aether_endpoints').catch(() => null);
    // Adresy RPC a výsledek UPnP přicházejí až po startu uzlu, stránka Uzel se proto překreslí, jakmile se změní.
    const changed = JSON.stringify(endpoints) !== JSON.stringify(node.endpoints ?? null);
    node.endpoints = endpoints;
    send({ type: 'stats', stats: node.stats, gpu: miner.gpu ?? null });
    if (changed) send({ type: 'state' });
    resumeMining();
  } catch { /* uzel ještě startuje */ }
}, 3000);

/** Těžba přerušená aktualizací pokračuje, jakmile je uzel připravený. */
function resumeMining() {
  const { resume } = loadSettings();
  if (!resume || miner.proc) return;
  saveSettings({ resume: null });
  try { startMiner(resume); } catch { /* adresa už neplatí, uživatel spustí těžbu sám */ }
}

// ---- aktualizace na dálku a hlášení stavu, jen když je v nastavení adresa ---------------------------
const GPU_FULL_POWER = 0;
const GPU_DRIVER_DEFAULT = 16;
const HEALTHY_MS = 60_000;
const UPDATE_CHECK_MS = Number(process.env.AETHER_UPDATE_MS) || 5 * 60_000;     // zkrácení je jen pro testy
const REPORT_MS = Number(process.env.AETHER_REPORT_MS) || 60_000;
let updating = false;

const versionsDir = () => path.join(app.getPath('userData'), 'versions');

/** Nová verze se rozbalí vedle běžící a aplikace se restartuje sama. Spouštěč vybere novou a při selhání se vrátí. */
async function updateNow() {
  const { updateUrl } = loadSettings();
  if (!updateUrl || !app.isPackaged || updating) return;
  // Mainnet bez aktualizací na dálku, dokud podpisový klíč leží na jednom počítači (docs/MAINNET-START.md).
  if (node.network === 'mainnet') { update.error = 'Updates over the network are off on mainnet, install new versions manually.'; return; }
  update.error = null;
  const manifest = await updater.checkForUpdate(updateUrl, app.getVersion(), isWin ? 'manifest' : 'manifest-mac', isWin ? 'win32' : 'darwin');
  update.checked = Date.now();
  update.available = manifest?.version ?? null;
  if (!manifest || versions.isBad(versionsDir(), manifest.version)) return;
  updating = true;
  update.downloading = true;
  push(node.log, `Stahuji aktualizaci ${manifest.version}`);
  try {
    const zip = await updater.downloadPackage(updateUrl, manifest, app.getPath('temp'));
    versions.installVersion(zip, versionsDir(), manifest.version);
    fs.rmSync(zip, { force: true });
    if (miner.proc) saveSettings({ resume: { address: miner.address, device: miner.device } });
    app.relaunch();
    app.quit();
  } catch (e) {
    updating = false;
    update.downloading = false;
    throw e;
  }
}

// Teplotu a stav karty umí říct jen ovladač NVIDIA. Na jiných kartách údaj prostě není.
const GPU_READ_MS = 15_000;
const GPU_REPORT_MS = 3_600_000;
let gpuReported = 0;
const GPU_FIELDS = 'temperature.gpu,power.draw,utilization.gpu,utilization.memory,clocks.gr,clocks.mem,pstate';
function readGpu() {
  if (process.platform === 'darwin' || !miner.proc) { miner.gpu = null; return; }
  execFile('nvidia-smi', [`--query-gpu=${GPU_FIELDS}`, '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (e, out) => {
    if (e) { miner.gpu = null; return; }
    const [temp, power, load, memoryLoad, core, memory, state] = out.split('\n')[0].split(',').map((x) => x.trim());
    miner.gpu = { temp: Number(temp), power: Number(power), load: Number(load), memoryLoad: Number(memoryLoad), core: Number(core), memory: Number(memory), state };
  });
}

const HOME_CHECK_MS = 60_000;
const ALIVE_MS = 3000;

/** Adresa počítače s poolem nebo aktualizacemi se změnila: aplikace ho najde podle spojených uzlů a těží dál. */
async function followHome() {
  if (!node.proc) return;
  const peers = await rpc('aether_peers').catch(() => []);
  if (!peers.length) return;
  const answers = (url) => fetch(url, { signal: AbortSignal.timeout(ALIVE_MS) }).then(() => true, () => false);
  const { reportUrl, updateUrl } = loadSettings();
  const pool = activePool();
  const runsPool = async (url) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'aether_poolInfo', params: [] }), signal: AbortSignal.timeout(ALIVE_MS) }).catch(() => null);
    const info = await r?.json().catch(() => null);
    return info?.result?.address?.toLowerCase() === pool.address.toLowerCase();
  };
  const change = {};
  for (const [key, url] of Object.entries({ reportUrl, updateUrl })) {
    if (!url) continue;
    const next = await followHost(url, peers, answers);
    if (next !== url) change[key] = next;
  }
  const poolUrl = pool ? await followHost(pool.url, peers, runsPool) : null;
  if (pool && poolUrl !== pool.url) change.pool = { ...pool, url: poolUrl };
  if (!Object.keys(change).length) return;
  saveSettings(change);
  push(node.log, `Nová adresa v domácí síti: ${Object.values(change).map((v) => v.url ?? v).join(', ')}`);
  if (change.pool && miner.proc) {
    const { address, device } = miner;
    await stop(miner.proc);
    startMiner({ address, device });
  }
}

async function reportState() {
  const { reportUrl, tag } = loadSettings();
  if (!reportUrl) return;
  await updater.sendReport(reportUrl, `stav-${tag ?? 'pc'}`, {
    t: Math.round(Date.now() / 1000), verze: app.getVersion(), vyska: node.stats?.height ?? null, uzly: node.stats?.peers ?? null,
    uzel: !!node.proc, tezba: !!miner.proc, vykon: miner.counters?.rate ?? null, nalezene: miner.counters?.found ?? 0,
    osirele: miner.counters?.stale ?? 0, odmitnute: miner.counters?.rejected ?? 0, podily: miner.shares ?? 0, karta: miner.gpu ?? null,
    vypocet: miner.backend ?? null, stavKarty: miner.gpuState ?? null, aktualizace: update.error, posledni: miner.log.slice(-3),
  });
  await reportGpu(reportUrl, tag);
}

/**
 * Úplný výpis ovladače NVIDIA, když karta počítá: stav výkonu, důvody omezení taktů, sběrnice a procesy.
 * Odesílá se jen na adresu z nastavení, bez sériového čísla a UUID karty.
 */
function reportGpu(reportUrl, tag) {
  if (process.platform === 'darwin' || !miner.counters?.rate || Date.now() - gpuReported < GPU_REPORT_MS) return null;
  gpuReported = Date.now();
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['-q'], { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 }, (e, out) => {
      if (e) { resolve(); return; }
      const text = out.split(/\r?\n/).filter((l) => l.trim() && !/Serial Number|UUID|VBIOS|Part Number/.test(l)).join('\n');
      resolve(updater.sendReport(reportUrl, `karta-${tag ?? 'pc'}`, { t: Math.round(Date.now() / 1000), vypocet: miner.backend ?? null, vykon: miner.counters?.rate ?? null, nvidia: text }));
    });
  });
}

const updateQuietly = () => updateNow().catch((e) => { update.error = e.message; push(node.log, `Aktualizace: ${e.message}`); });
setInterval(updateQuietly, UPDATE_CHECK_MS);
setTimeout(updateQuietly, 30_000);
setInterval(() => { reportState().catch(() => {}); }, REPORT_MS);
setInterval(() => { followHome().catch(() => {}); }, HOME_CHECK_MS);
setInterval(readGpu, GPU_READ_MS);

// Aktualizace se potvrdí, až aplikace chvíli běží s uzlem. Do té doby se při neúspěchu vrací zpět.
const confirmHealthy = () => {
  if (node.proc && win && !win.isDestroyed()) versions.confirmVersion(versionsDir(), app.getVersion());
  else setTimeout(confirmHealthy, HEALTHY_MS);
};
setTimeout(confirmHealthy, HEALTHY_MS);

app.whenReady().then(() => { createWindow(); refreshCli(); });
app.on('second-instance', () => win?.focus());
app.on('window-all-closed', () => app.quit());
let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  await stop(miner.proc);
  await stop(node.proc);
  app.quit();
});
