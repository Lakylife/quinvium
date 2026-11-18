// Main process of the Quinvium app: manages the node, the miner and the window.
const { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerSaveBlocker, shell, Tray } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updater = require('./updater.cjs');
const versions = require('./versions.cjs');
const { WalletLink } = require('./wallet-link.cjs');
const { followHost } = require('./home-network.cjs');
const cliLauncher = require('./cli-launcher.cjs');
const { poolOfferDue } = require('./pool-offer.cjs');
const releases = require('./release-check.cjs');
const shareNode = require('./share-node.cjs');
const vm = require('node:vm');

const NETWORKS = { mainnet: 8545, testnet: 8546 };
const P2P_PORTS = { mainnet: 30524, testnet: 30525 };
// Tests only: the test app runs next to the real one, so its node has its own ports and does not touch the real node.
const TEST_RPC_PORT = Number(process.env.AETHER_RPC_PORT) || null;
const TEST_STRATUM_PORT = Number(process.env.AETHER_STRATUM_PORT) || null;
const CHAIN_FOLDERS = { testnet: 'testnet-5' };   // testnet restart: a new genesis needs an empty database; the old one stays next to it
const LOG_LINES = 200;
// Mainnet is the default since 2.15.0; the test app stays on testnet. The user's choice is remembered in the settings.
const defaultNetwork = () => loadSettings().network ?? (TEST_RPC_PORT ? 'testnet' : 'mainnet');
const isWin = process.platform === 'win32';
const packaged = app.isPackaged;
// The updated version has its own folder, passed in by the launcher.
const resources = packaged ? process.env.AETHER_RESOURCES ?? process.resourcesPath : path.join(__dirname, '..');
const binDir = packaged ? path.join(resources, 'bin') : path.join(__dirname, '..', 'build');
const explorerDir = packaged ? path.join(resources, 'explorer') : path.join(__dirname, '..', '..', 'explorer', 'public');
const minerPath = path.join(binDir, isWin ? 'quintium-miner.exe' : 'quintium-miner');
const nodeBundle = path.join(binDir, 'quintium-node.cjs');

// Separate data for automated tests.
// Name and icon even when running without a build. The built app has them from its package.
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

const send = (e) => { if (win && !win.isDestroyed()) win.webContents.send('event', e); if (e.type === 'state') refreshTray(); };
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
const tunnelPort = (network) => Number(process.env.AETHER_TUNNEL_PORT) || shareNode.TUNNEL_PORTS[network] || 8565;

/**
 * Share node publicly (off by default): a Cloudflare quick tunnel to the node's tunnel port. The node announces the tunnel's
 * address to its peers; other nodes list it after their own check. The operator's IP address stays behind Cloudflare.
 */
const share = { tunnel: null, url: null, status: 'off', error: null, retry: null };
async function startSharing() {
  if (share.tunnel || share.status === 'starting' || !node.proc || !loadSettings().sharePublic) return;
  share.status = 'starting';
  share.error = null;
  send({ type: 'state' });
  try {
    const bin = await shareNode.ensureCloudflared(path.join(app.getPath('userData'), 'bin'));
    if (!node.proc || !loadSettings().sharePublic) { share.status = 'off'; return; }
    share.tunnel = shareNode.startTunnel(bin, tunnelPort(node.network), {
      onUrl: async (url) => {
        share.url = url;
        try {
          await rpc('aether_setPublicUrl', [url]);
          share.status = 'on';
        } catch (e) { share.status = 'error'; share.error = e.message; }
        send({ type: 'state' });
      },
      onExit: () => {
        share.tunnel = null;
        share.url = null;
        if (share.status !== 'off') {
          share.status = 'error';
          share.error = 'The tunnel stopped; trying again in a minute.';
          clearTimeout(share.retry);
          share.retry = setTimeout(() => { share.status = 'off'; startSharing(); }, 60_000);
        }
        send({ type: 'state' });
      },
    });
  } catch (e) {
    share.status = 'error';
    share.error = e.message;
    send({ type: 'state' });
  }
}
async function stopSharing() {
  clearTimeout(share.retry);
  share.status = 'off';
  share.url = null;
  share.tunnel?.stop();
  share.tunnel = null;
  if (node.proc) await rpc('aether_setPublicUrl', [null]).catch(() => {});
}
async function rpc(method, params = []) {
  const r = await fetch(`http://127.0.0.1:${rpcPort()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const saveSettings = (change) => fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...change }), { mode: 0o600 });

/** Who can see the node: only this computer, the home network, or also the internet. Older settings had only a checkbox. */
const ACCESS_MODES = ['off', 'lan', 'internet'];
const accessMode = (s = loadSettings()) => (ACCESS_MODES.includes(s.access) ? s.access : s.share ? 'lan' : 'off');

/** Nodes on the local network find each other; the address is a fallback for networks where broadcasts do not pass. */
function networkArgs(network) {
  const settings = loadSettings();
  const { seed, tag, runPool, publicHost } = settings;
  const access = accessMode(settings);
  const args = ['--lan'];
  if (process.env.AETHER_LAN_PORT) args.push('--lan-port', process.env.AETHER_LAN_PORT);
  if (process.env.AETHER_P2P_PORT) args.push('--p2p-port', process.env.AETHER_P2P_PORT);   // tests only, so real computers do not connect to them
  if (TEST_RPC_PORT) args.push('--rpc-port', String(TEST_RPC_PORT));
  if (TEST_STRATUM_PORT) args.push('--stratum-port', String(TEST_STRATUM_PORT));
  // The tag in a block shows which computer mined it when the payout address is shared.
  if (tag) args.push('--extra', `aether/${tag}`);
  if (seed) {
    const address = seed.includes(':') ? seed : `${seed}:${P2P_PORTS[network]}`;
    args.push('--seeds', address);
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) args.push('--allow-private');
  }
  // The Explorer and Stratum belong to this computer only until the user opens them. The node has no keys and no admin methods.
  if (access !== 'off') args.push('--rpc-host', '0.0.0.0', '--stratum-host', '0.0.0.0', '--rate-limit', '6000');
  // From the internet: the router opens ports itself (UPnP) and the node finds out its public address, which it then shows to wallets.
  if (access === 'internet') args.push('--public', ...(publicHost ? ['--public-host', publicHost] : []));
  // Otherwise the router opens only the port for connections between nodes, so other nodes can reach this one
  // (as Bitcoin and Ethereum nodes at home do). Tests and users who turn it off keep the router untouched.
  else if (settings.upnp !== false && !process.env.AETHER_P2P_PORT) args.push('--upnp');
  // Pool server: the key only pays gas for shares; the contract holds the miners' coins.
  if (runPool?.network === network) args.push('--pool', runPool.address, '--pool-key-file', path.join(app.getPath('userData'), `pool-${network}.key`));
  // Share node publicly: a port for the tunnel only, on this computer; every request on it counts as foreign.
  if (settings.sharePublic) args.push('--tunnel-port', String(tunnelPort(network)));
  return args;
}

/** This computer's address on the local network, which the other side enters. */
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
  if (!TEST_RPC_PORT) saveSettings({ network });
  const dataDir = path.join(app.getPath('userData'), 'chain', CHAIN_FOLDERS[network] ?? network);
  fs.mkdirSync(dataDir, { recursive: true });
  node.proc = spawn(process.execPath, [nodeBundle, '--network', network, '--data-dir', dataDir, '--explorer', explorerDir, '--exit-with-parent', ...networkArgs(network)], {
    // stdin stays an open pipe: when the app ends without stopping the node (crash, force quit), the node notices and stops.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', QUINTIUM_LANG: nodeLang() }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  lowPriority(node.proc);
  follow(node.proc, (l) => { push(node.log, l); send({ type: 'node-log', line: l }); });
  node.proc.on('exit', (code) => {
    push(node.log, `The node exited with code ${code}`);
    // Without the node the tunnel would lead nowhere; it starts again with the node.
    clearTimeout(share.retry);
    share.status = 'off';
    share.tunnel?.stop();
    share.tunnel = null;
    share.url = null;
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
  proc.stopping = true;   // an ending the user asked for: no "mining stopped" notification
  const t = setTimeout(() => {
    proc.kill('SIGKILL');
    // A miner stuck inside a graphics driver call may not end at once; on Windows the whole process tree is ended by force.
    if (isWin && proc.pid) execFile('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true }, () => {});
    // Stop means stopped for the user even before the process is gone: the app no longer shows it as mining.
    if (miner.proc === proc) { miner.proc = null; keepAwake(false); setGpuState(GPU_DRIVER_DEFAULT); send({ type: 'state' }); }
    resolve();
  }, 6000);
  proc.once('exit', () => { clearTimeout(t); resolve(); });
  proc.kill(isWin ? undefined : 'SIGINT');
});

/** Preparation progress from the miner's output: opening the card, computing the DAG and checking it. */
function readProgress(line) {
  if (miner.progress === null) return;
  const dag = /DAG (\d+) %/.exec(line);
  if (/\] backend /.test(line)) miner.progress = Math.max(miner.progress, 3);
  // The card is open but the node is still downloading the chain: the wait is the node's, not the card's.
  else if (/node is syncing|uzel se synchronizuje/i.test(line) && miner.stage === 'start') miner.stage = 'sync';
  else if (/computing DAG|počítám DAG/.test(line)) { miner.stage = 'dag'; miner.progress = Math.max(miner.progress, 5); }
  else if (dag) { miner.stage = 'dag'; miner.progress = Math.max(miner.progress, Math.min(94, 5 + Math.round(Number(dag[1]) * 0.89))); }
  else if (/DAG ready|DAG hotový/.test(line)) { miner.stage = 'check'; miner.progress = 96; }
  else if (/(?:Hashrate|Výkon) [1-9]/.test(line) || /(?:Hashrate|Výkon) 0\.[0-9]*[1-9]/.test(line)) { miner.progress = null; miner.stage = null; }
}

/** A pool belongs to one network. After switching networks, mining is solo until the user picks another. */
function activePool() {
  const { pool } = loadSettings();
  return pool?.network === node.network ? pool : null;
}

/** A sleeping computer does not mine. Only system sleep is blocked; the screen may turn off. */
function keepAwake(on) {
  if (on && miner.awake === undefined) miner.awake = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && miner.awake !== undefined) {
    powerSaveBlocker.stop(miner.awake);
    miner.awake = undefined;
  }
}

/**
 * Performance of an NVIDIA card on Windows. Otherwise the driver may leave it in the P5 state with memory at a quarter of its clock.
 * Runs in a separate process: if the non-public driver function fails, mining is not affected.
 */
let noNvidia = false;   // learned on the first try: a computer without an NVIDIA driver is not asked again
function setGpuState(state) {
  if (!isWin || noNvidia) return;
  execFile(minerPath, ['--gpu-state', String(state)], { timeout: 15000, windowsHide: true }, (e, out, err) => {
    const text = `${out ?? ''} ${err ?? ''} ${e?.message ?? ''}`.replace(/\s+/g, ' ').trim();
    // Without an NVIDIA card there is nothing to set; that is not an error worth showing in the mining log.
    if (/NVIDIA driver is not available/i.test(text)) { noNvidia = true; return; }
    miner.gpuState = `${state}: ${text.slice(0, 600)}`;
    push(miner.log, `Card performance state ${miner.gpuState}`);
  });
}

/**
 * The node (downloading and checking the chain) and the miner run below normal priority, so a weaker computer stays
 * usable: the windows, the browser and other programs come first, the node takes the rest of the processor.
 */
function lowPriority(proc) {
  try { if (proc?.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here; it runs at normal priority */ }
}

function startMiner({ address, device }) {
  if (miner.proc) return { ok: true };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) throw new Error('Invalid payout address');
  if (!node.proc) throw new Error('Start the node first');
  const unfit = cannotMine(device);
  if (unfit) { miner.blocked = tr(unfit); throw new Error(unfit); }
  miner.log = [];
  miner.rate = null;
  miner.blocks = 0;
  miner.address = address;
  miner.device = device;
  miner.counters = null;
  miner.stage = 'start';
  miner.progress = 0;
  miner.startedAt = Date.now();
  miner.offered = false;
  miner.blocked = null;
  const { power, tag } = loadSettings();
  const pool = activePool();
  miner.pool = pool?.address ?? null;
  const args = ['--address', address, '--node', pool?.url ?? `http://127.0.0.1:${rpcPort()}`];
  // When the pool stops answering, the miner keeps mining solo through this computer's node and returns to the pool later.
  if (pool) args.push('--pool', pool.address, '--worker', tag || 'rig', '--fallback', `http://127.0.0.1:${rpcPort()}`);
  if (device !== undefined && device !== 'all') args.push('--device', String(device));
  args.push('--intensity', String(power ?? 100), '--exit-with-parent');
  if ((power ?? 100) >= 100) setGpuState(GPU_FULL_POWER);
  miner.proc = spawn(minerPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  lowPriority(miner.proc);
  saveSettings({ lastMining: { address, device: device ?? 'all' } });   // the tray can start mining again without the window
  keepAwake(true);
  const started = miner.proc;
  follow(miner.proc, (l) => {
    push(miner.log, l);
    readProgress(l);
    // A card that cannot mine at all: the reason is said in plain words and mining stops instead of waiting forever.
    const blocked = /does not fit into the card memory/i.test(l) ? "This graphics card has too little memory for mining Quinvium. The mining data (DAG) is over 1 GB now and grows; a card with at least 2 GB of its own memory is needed. You can still help the network by sharing your node." : /no graphics card found/i.test(l) ? "No graphics card that can mine was found. Quinvium needs an AMD or NVIDIA card with at least 2 GB of its own memory and a current driver." : null;
    if (blocked && miner.proc === started) {
      miner.blocked = tr(blocked);
      notify('mining', tr('Mining stopped'), miner.blocked);
      stop(started).then(() => send({ type: 'state' }));
    }
    const used = /\] backend (.+)$/.exec(l);
    if (used) miner.backend = used[1];
    const m = /(?:Hashrate|Výkon) ([\d.]+) ([^\s,]+)/.exec(l);
    if (m) miner.rate = `${m[1]} ${m[2]}`;
    if (/BLOCK FOUND|NALEZEN BLOK/.test(l)) {
      miner.blocks += 1;
      minedAt = 0;
      notify('blocks', tr('Block found'), tr('Your card found a block. The reward goes to {address}.', { address: shortAddress(miner.address) }));
    }
    const counters = updater.parseMinerLine(l);
    if (counters) {
      miner.counters = counters;
      miner.shares = counters.shares ?? 0;
      miner.history.push(counters.rate);
      if (miner.history.length > HISTORY_POINTS) miner.history.shift();
      offerPool().catch(() => { /* without the network figures there is simply no offer */ });
    }
    send({ type: 'miner-log', line: l, rate: miner.rate, blocks: miner.blocks, shares: miner.shares, progress: miner.progress, stage: miner.stage });
  });
  miner.proc.on('error', (e) => push(miner.log, `The miner cannot start: ${e.message}`));
  miner.proc.on('exit', (code, signal) => {
    push(miner.log, `The miner exited: code ${code}, signal ${signal}`);
    if (!started.stopping && !quitting) notify('mining', tr('Mining stopped'), tr('The miner ended unexpectedly. Open Quinvium to start it again.'));
    // A miner that ends late (after Stop gave up waiting) must not clear one started since.
    if (miner.proc !== started) return;
    miner.proc = null;
    keepAwake(false);
    setGpuState(GPU_DRIVER_DEFAULT);
    send({ type: 'state' });
  });
  send({ type: 'state' });
  return { ok: true };
}

/** A solo miner below 1 % of the network gets one offer of the official pool per mining session (pool-offer.cjs). */
async function offerPool() {
  const base = { network: node.network, pool: activePool(), off: !!loadSettings().poolOfferOff, offered: miner.offered, startedAt: miner.startedAt, now: Date.now(), rates: miner.history };
  if (!poolOfferDue({ ...base, networkHashrate: 1 })) return;     // cheap checks first, the network is asked only when it may matter
  miner.offered = true;
  const stats = await rpc('aether_stats');
  const due = poolOfferDue({ ...base, offered: false, networkHashrate: Number(stats.hashrate) });
  if (!due) return;
  // Only a pool the network's factory knows is offered; its fee comes from the chain, not from this file.
  const found = (await rpc('aether_pools', [{ query: due.pool.address.toLowerCase(), limit: 1 }]))?.items?.[0];
  if (!found || found.address.toLowerCase() !== due.pool.address.toLowerCase()) return;
  send({ type: 'pool-offer', pool: { ...due.pool, name: found.name || due.pool.name, fee: found.feeBps / 100 }, share: due.share, rate: due.rate });
}

let knownDevices = null;   // the last successful list of cards with their memory, for the check before mining
const listDevices = () => new Promise((resolve) => {
  execFile(minerPath, ['--list'], { windowsHide: true, timeout: 20000 }, (err, out) => {
    if (err) { resolve([]); return; }
    knownDevices = out.split(/\r?\n/).map((l) => /^(\d+): (.+?) \(([^,)]+)(?:, (\d+) MB)?\)/.exec(l)).filter(Boolean)
      .map((m) => ({ id: Number(m[1]), name: m[2], memory: m[4] ? Number(m[4]) * 1024 * 1024 : null }));
    resolve(knownDevices.map(({ id, name }) => ({ id, name })));
  });
});
/**
 * Mining is not started on a computer that cannot mine: no card at all, or every card with less memory than the DAG of
 * the current epoch needs (the miner's own limit: DAG + 1/8). A card that does not report its memory is given a try.
 */
function cannotMine(device) {
  if (!knownDevices) return null;
  if (!knownDevices.length) return "No graphics card that can mine was found. Quinvium needs an AMD or NVIDIA card with at least 2 GB of its own memory and a current driver.";
  const list = device !== undefined && device !== 'all' ? knownDevices.filter((d) => String(d.id) === String(device)) : knownDevices;
  const epoch = Math.floor(Number(node.stats?.height ?? 0) / 30000);
  const need = (2 ** 30 + 2 ** 23 * epoch) * 1.125;
  return list.length && list.every((d) => d.memory !== null && d.memory < need) ? "This graphics card has too little memory for mining Quinvium. The mining data (DAG) is over 1 GB now and grows; a card with at least 2 GB of its own memory is needed. You can still help the network by sharing your node." : null;
}

const walletFile = () => path.join(app.getPath('userData'), 'wallet.json');

ipcMain.handle('state', () => ({
  node: { running: !!node.proc, network: node.network, preferred: defaultNetwork(), rpc: rpcPort(), runPool: loadSettings().runPool ?? null, stats: node.stats, log: node.log.slice(-60), seed: loadSettings().seed ?? '', share: accessMode() !== 'off', access: accessMode(), publicHost: loadSettings().publicHost ?? '', upnp: loadSettings().upnp !== false, endpoints: node.proc ? node.endpoints ?? null : null, lan: lanAddress() },
  miner: { running: !!miner.proc, rate: miner.rate, progress: miner.progress ?? null, stage: miner.stage ?? null, blocks: miner.blocks, shares: miner.shares ?? 0, gpu: miner.gpu ?? null, pool: activePool(), address: miner.address, power: loadSettings().power ?? 100, history: miner.history, log: miner.log.slice(-60), warning: miner.warning ?? null, blocked: miner.blocked ?? null },
  update: { ...update, configured: !!loadSettings().updateUrl, packaged: app.isPackaged },
  release: { latest: release.latest, checked: release.checked, error: release.error, downloading: release.downloading, file: release.file },
  notify: Object.fromEntries(NOTIFY_KINDS.map((k) => [k, notifyOn(k)])),
  version: app.getVersion(),
  share: { on: !!loadSettings().sharePublic, asked: !!loadSettings().shareAsked, status: share.status, url: share.url, error: share.error },
}));
// Share node publicly on or off. The node restarts, because the tunnel port is opened only when sharing is on.
ipcMain.handle('share:asked', () => { saveSettings({ shareAsked: true }); return true; });
ipcMain.handle('share:set', async (_, on) => {
  saveSettings({ sharePublic: !!on, shareAsked: true });
  await stopSharing();
  // Mining keeps running and resumes when the node is back, as after other node settings.
  if (node.proc) {
    const network = node.network;
    await stop(node.proc);
    startNode(network);
  }
  send({ type: 'state' });
  return true;
});
ipcMain.handle('node:start', (_, network) => startNode(network));
ipcMain.handle('node:stop', async () => { await stop(miner.proc); await stop(node.proc); return true; });
ipcMain.handle('node:network', async (_, options) => {
  const seed = String(options?.seed ?? '').trim();
  if (seed && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(seed)) throw new Error('Enter the computer address, for example 192.168.1.20');
  // The older call sends only share, the new one sends the access mode.
  const access = ACCESS_MODES.includes(options?.access) ? options.access : options?.share ? 'lan' : 'off';
  const publicHost = String(options?.publicHost ?? '').trim();
  if (publicHost && !/^[A-Za-z0-9.-]{1,253}$/.test(publicHost)) throw new Error('Enter the public address, for example 203.0.113.7 or node.example.com');
  saveSettings({ seed, share: access !== 'off', access, publicHost, ...(typeof options?.upnp === 'boolean' ? { upnp: options.upnp } : {}) });
  // Settings are passed to the node at start. Mining keeps running and resumes when the node is back.
  if (node.proc) {
    const { network } = node;
    await stop(node.proc);
    startNode(network);
  }
  return true;
});
ipcMain.handle('node:pool', async (_, address) => {
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid pool address');
  // The pool must be reachable from other computers, otherwise nobody could mine.
  saveSettings(address ? { runPool: { network: node.network, address }, share: true, access: accessMode() === 'internet' ? 'internet' : 'lan' } : { runPool: null });
  if (node.proc) {
    const { network } = node;
    await stop(node.proc);
    startNode(network);
  }
  return true;
});
ipcMain.handle('miner:list', listDevices);
// The quinvium command (and the earlier quintium): the launcher in the permanent data folder points to the running version, even after an update over the internet.
const cliDir = () => path.join(app.getPath('userData'), 'bin');
function refreshCli() {
  // Without a build (development and tests) the command line from build/ is used, if prepare.mjs created it.
  if (!packaged && !fs.existsSync(nodeBundle)) return null;
  try {
    const fallback = packaged ? path.join(process.resourcesPath, 'bin', 'quintium-node.cjs') : nodeBundle;
    return cliLauncher.writeLauncher({ dir: cliDir(), execPath: process.execPath, bundle: nodeBundle, fallback, platform: process.platform });
  } catch (e) {
    push(node.log, `The quinvium command: ${e.message}`);
    return null;
  }
}
ipcMain.handle('cli:path', () => (refreshCli() ? { dir: cliDir(), line: cliLauncher.manualLine(cliDir(), process.platform) } : null));
// Only on the user's click: adds the launcher folder to their path. Tests get their own file instead of the profile.
ipcMain.handle('cli:install', () => (refreshCli()
  ? cliLauncher.installPath({ dir: cliDir(), platform: process.platform, home: os.homedir(), shell: process.env.SHELL, profile: process.env.AETHER_SHELL_PROFILE })
  : { ok: false, error: 'not packaged' }));
ipcMain.handle('wallet:activity', () => { send({ type: 'activity' }); });

// MetaMask and other browser wallets: a page on 127.0.0.1 relays signature requests; keys stay in the wallet.
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

// The wallet runs in the main window; the Explorer window talks to it through the main process.
const walletCalls = new Map();
let nextWalletCall = 1;
let explorerOrigin = null;

ipcMain.handle('wallet:request', (e, { method, params }) => new Promise((resolve) => {
  const origin = (() => { try { return new URL(e.senderFrame.url).origin; } catch { return null; } })();
  if (!explorerView || explorerView.isDestroyed() || e.sender !== explorerView || origin !== explorerOrigin || typeof method !== 'string') {
    resolve({ error: { code: 4100, message: 'This page has no access to the wallet' } });
    return;
  }
  if (!win || win.isDestroyed()) {
    resolve({ error: { code: 4900, message: 'The main window of the app is closed' } });
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
ipcMain.handle('miner:poolOfferOff', () => { saveSettings({ poolOfferOff: true }); return true; });
ipcMain.handle('miner:power', async (_, value) => {
  const power = Math.min(100, Math.max(10, Math.round(Number(value) / 10) * 10)) || 100;
  saveSettings({ power });
  // The new intensity applies immediately: the miner restarts with the same address and card.
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

// The Explorer is embedded directly in the app. The page may talk only to the local node and gets a single bridge to the wallet.
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
  // The app is local only: it navigates nowhere and opens links in the browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The camera is only for reading a QR code in the wallet window; pages inside the app (the Explorer) never get it.
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Pages inside the app (the Explorer) get only copying to the clipboard; the app window itself keeps the rest.
    if (permission !== 'media') { callback(contents === win?.webContents || permission === 'clipboard-sanitized-write'); return; }
    callback(contents === win?.webContents && (details.mediaTypes ?? []).every((t) => t === 'video'));
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Closing the window does not stop the node or mining: the app keeps running in the menu bar / next to the clock.
  win.on('close', (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    win.hide();
    if (process.platform === 'darwin') app.dock?.hide();
    if (!loadSettings().trayNoticeShown) {
      saveSettings({ trayNoticeShown: true });
      if (Notification.isSupported()) {
        new Notification({ title: T('Quinvium běží dál', 'Quinvium keeps running'), body: process.platform === 'darwin' ? T('Uzel i těžba pokračují. Otevřít nebo ukončit Quinvium jde ikonou Q v horní liště.', 'The node and mining continue. Open or quit Quinvium from the Q icon in the menu bar.') : T('Uzel i těžba pokračují. Otevřít nebo ukončit Quinvium jde ikonou Q u hodin.', 'The node and mining continue. Open or quit Quinvium from the Q icon next to the clock.') }).show();
      }
    }
  });
}

/** Shows the window again, also after it was hidden into the tray. */
function showWindow() {
  if (process.platform === 'darwin') app.dock?.show();
  if (!win || win.isDestroyed()) createWindow();
  else { win.show(); win.focus(); }
}

// ---- texts of the main process (tray, notifications) in the language chosen in the window -----------------------
// The window's dictionary (wallet/i18n.js, the same as in the Chrome wallet) is read once; the window reports the language.
const appText = (() => {
  try {
    const sandbox = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, document: undefined };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'renderer', 'wallet', 'i18n.js'), 'utf8'), sandbox);
    return sandbox.window.AetherI18n;
  } catch { return null; }
})();
const uiLang = () => loadSettings().lang ?? ((app.getPreferredSystemLanguages?.()[0] ?? app.getLocale()).slice(0, 2));
// The node writes its log in English, or in Czech when the window is in Czech; other languages get English.
const nodeLang = () => (uiLang() === 'cs' ? 'cs' : 'en');
function tr(text, vars) {
  const l = uiLang();
  const i = appText?.ORDER.indexOf(l) ?? -1;
  const out = (i >= 0 ? appText.TEXT[text]?.[i] : null) ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : out;
}
const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
ipcMain.handle('app:context', (_, c) => {
  const change = {};
  if (typeof c?.lang === 'string' && /^[a-z]{2}$/.test(c.lang)) change.lang = c.lang;
  if (typeof c?.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(c.address)) change.walletAddress = c.address;
  if (Object.keys(change).length) saveSettings(change);
  refreshTray();
  return true;
});

// ---- notifications: found blocks, incoming payments, mining that stopped by itself, new versions ----------------
const NOTIFY_KINDS = ['blocks', 'payments', 'mining', 'updates'];
const notifyOn = (kind) => loadSettings().notify?.[kind] !== false;
function notify(kind, title, body) {
  if (!notifyOn(kind) || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', showWindow);
  n.show();
}
ipcMain.handle('notify:set', (_, kind, on) => {
  if (!NOTIFY_KINDS.includes(kind)) throw new Error('Unknown notification');
  saveSettings({ notify: { ...(loadSettings().notify ?? {}), [kind]: !!on } });
  return true;
});

/** New incoming payments to the wallet: the newest ones are remembered, the first look only takes note of them. */
const PAYMENT_CHECK_MS = 20_000;
const payments = { key: null, seen: new Set() };
async function checkPayments() {
  const address = loadSettings().walletAddress;
  if (!node.proc || !address || !node.stats) return;
  const key = `${node.network}:${address.toLowerCase()}`;
  const r = await rpc('aether_txs', [{ address, direction: 'in', limit: 10 }]).catch(() => null);
  if (!r) return;
  const fresh = payments.key === key ? r.items.filter((tx) => !payments.seen.has(tx.hash)) : [];
  if (payments.key !== key) { payments.key = key; payments.seen.clear(); }
  for (const tx of r.items) payments.seen.add(tx.hash);
  if (payments.seen.size > 500) payments.seen = new Set([...payments.seen].slice(-200));
  for (const tx of fresh.slice(0, 3)) {
    const value = BigInt(tx.value ?? 0);
    if (value === 0n) continue;
    const coin = node.stats?.currency ?? 'QU';
    const amount = (Number(value / 10n ** 12n) / 1e6).toLocaleString(uiLang(), { maximumFractionDigits: 6 });
    notify('payments', tr('Payment received'), tr('{amount} {coin} from {from}', { amount, coin, from: shortAddress(tx.from) }));
  }
}
setInterval(() => { checkPayments().catch(() => {}); }, PAYMENT_CHECK_MS);

/** New versions from GitHub, checked on start and every six hours; one notification per version. */
const RELEASE_CHECK_MS = 6 * 3_600_000;
const release = { latest: null, checked: null, error: null, downloading: null, file: null };
async function checkRelease() {
  try {
    release.latest = await releases.latest(app.getVersion(), process.platform);
    release.checked = Date.now();
    release.error = null;
  } catch (e) { release.error = e.message; }
  if (release.latest && loadSettings().notifiedVersion !== release.latest.version) {
    saveSettings({ notifiedVersion: release.latest.version });
    notify('updates', tr('New version {v}', { v: release.latest.version }), tr('Quinvium {v} is available. Open Settings to download it.', { v: release.latest.version }));
  }
  send({ type: 'state' });
  return release;
}
setTimeout(() => { checkRelease(); }, 20_000);
setInterval(() => { checkRelease(); }, RELEASE_CHECK_MS);
ipcMain.handle('release:check', () => checkRelease());
ipcMain.handle('release:download', async () => {
  if (!release.latest || release.downloading) return release;
  release.downloading = { got: 0, total: release.latest.size };
  release.error = null;
  try {
    release.file = await releases.download(release.latest, app.getPath('downloads'), fetch, (got, total) => { release.downloading = { got, total }; });
    shell.showItemInFolder(release.file);
  } catch (e) {
    release.error = e.message;
  } finally {
    release.downloading = null;
    send({ type: 'state' });
  }
  return release;
});
ipcMain.handle('release:open', () => { if (release.file) shell.showItemInFolder(release.file); return !!release.file; });

// ---- tray: menu bar on macOS, notification area next to the clock on Windows ------------------------------
let tray = null;
// Tray texts follow the language chosen in the window (tr above).
const T = (cs, en) => tr(en);
function trayIcon() {
  const dir = path.join(__dirname, '..', 'assets');
  const image = nativeImage.createFromPath(path.join(dir, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
const trayRate = () => miner.rate ?? (miner.counters?.rate ? `${(miner.counters.rate / 1e6).toFixed(2)} MH/s` : '—');

function trayMenu() {
  const s = node.stats;
  const last = loadSettings().lastMining;
  const login = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    { label: node.proc ? `${T('Síť', 'Network')}: ${node.network === 'mainnet' ? 'Mainnet' : 'Testnet'} · ${T('blok', 'block')} ${s?.height?.toLocaleString('en-US') ?? '…'}` : T('Uzel neběží', 'Node is not running'), enabled: false },
    { label: miner.proc ? `${T('Těžba', 'Mining')}: ${trayRate()}` : T('Těžba je vypnutá', 'Mining is off'), enabled: false },
    ...(minedLabel() ? [{ label: minedLabel(), enabled: false }] : []),
    { type: 'separator' },
    miner.proc
      ? { label: T('Zastavit těžbu', 'Stop mining'), click: () => { stop(miner.proc).then(() => send({ type: 'state' })); } }
      : { label: T('Spustit těžbu', 'Start mining'), enabled: !!node.proc && !!last?.address, click: () => { try { startMiner(last); } catch { showWindow(); } } },
    { label: T('Otevřít Quinvium', 'Open Quinvium'), click: showWindow },
    { type: 'separator' },
    { label: T('Spouštět po přihlášení', 'Start at login'), type: 'checkbox', checked: !!login.openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: T('Ukončit Quinvium', 'Quit Quinvium'), click: () => app.quit() },
  ]);
}

/**
 * Blocks found by the payout address over the whole history of the chain, not only since the app started. The node keeps
 * the count in its index (aether_addressInfo). In a pool the pool contract mines the blocks, so the address has none of its own.
 */
const MINED_CHECK_MS = 30_000;
let minedAt = 0;
async function refreshMined() {
  const address = miner.address ?? loadSettings().lastMining?.address;
  if (!node.proc || !address || Date.now() - minedAt < MINED_CHECK_MS) return;
  minedAt = Date.now();
  const info = await rpc('aether_addressInfo', [address]).catch(() => null);
  if (info) miner.minedTotal = { address: address.toLowerCase(), network: node.network, blocks: info.mined?.blocks ?? 0 };
}
function minedLabel() {
  const address = (miner.address ?? loadSettings().lastMining?.address)?.toLowerCase();
  const total = miner.minedTotal?.address === address && miner.minedTotal?.network === node.network ? miner.minedTotal.blocks : null;
  if (total === null && !miner.proc) return null;
  const all = `${T('Nalezené bloky celkem', 'Blocks found in total')}: ${total === null ? '…' : total.toLocaleString('en-US')}`;
  return miner.proc ? `${all} · ${T('teď', 'this session')} ${miner.blocks}` : all;
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(trayMenu());
  tray.setToolTip(miner.proc ? `Quinvium · ${T('těží', 'mining')} ${trayRate()}${miner.warning ? ` · ⚠ ${miner.warning}` : ''}` : 'Quinvium');
}

function createTray() {
  if (tray || process.env.AETHER_NO_TRAY) return;
  tray = new Tray(trayIcon());
  // On Windows a click opens the window, the menu is on the right button. On macOS a click opens the menu.
  if (isWin) tray.on('click', showWindow);
  refreshTray();
  globalThis.quinviumTray = { labels: () => trayMenu().items.map((i) => i.label).filter(Boolean), iconEmpty: () => trayIcon().isEmpty() };   // read by test/tray.mjs
}

setInterval(async () => {
  if (!node.proc) return;
  try {
    node.stats = await rpc('aether_stats');
    const endpoints = await rpc('aether_endpoints').catch(() => null);
    // RPC addresses and the UPnP result arrive only after the node starts, so the Node page is redrawn as soon as they change.
    const changed = JSON.stringify(endpoints) !== JSON.stringify(node.endpoints ?? null);
    node.endpoints = endpoints;
    await refreshMined();
    send({ type: 'stats', stats: node.stats, gpu: miner.gpu ?? null, mined: miner.minedTotal ?? null });
    refreshTray();
    if (changed) send({ type: 'state' });
    resumeMining();
    checkMining(true);
    if (loadSettings().sharePublic && !share.tunnel && share.status === 'off') startSharing();
  } catch { checkMining(false); /* the node is still starting or not answering */ }
}, 3000);

/**
 * Mining that runs but earns nothing: the node lost every connection, the chain stopped moving, the node does not answer
 * or the card computes nothing. The user is told once per problem (notification, tray, Mining page), not left in the dark.
 */
const HEALTH = { noPeersMs: 180_000, stalledMs: 600_000, noAnswerMs: 60_000, noHashMs: 300_000, noStartMs: 240_000 };
const health = { since: {}, warned: null };
function checkMining(answered) {
  if (!miner.proc) { health.since = {}; health.warned = null; miner.warning = null; return; }
  const now = Date.now();
  const s = node.stats;
  const flag = (key, bad) => { if (!bad) delete health.since[key]; else health.since[key] ??= now; return bad && now - health.since[key]; };
  if (s && s.height !== health.height) { health.height = s.height; health.heightAt = now; }
  const solo = !activePool();
  const preparing = miner.progress !== null && miner.progress !== undefined;
  const problems = [
    ['noAnswer', flag('noAnswer', !answered) >= HEALTH.noAnswerMs, () => tr('The node of this app does not answer, so the card has no work.')],
    ['noPeers', flag('noPeers', solo && answered && s?.peers === 0) >= HEALTH.noPeersMs, () => tr('The node has no connection to other nodes. Blocks found now would not reach the network.')],
    ['stalled', solo && answered && health.heightAt && now - health.heightAt >= HEALTH.stalledMs, () => tr('No new block for {min} minutes. The node may be cut off from the network.', { min: Math.round((now - health.heightAt) / 60_000) })],
    // Stuck before the DAG: no card the miner can use (an old or built-in GPU, too little memory, no OpenCL or Vulkan driver).
    ['noStart', flag('noStart', miner.stage === 'start') >= HEALTH.noStartMs, () => tr("The graphics card did not start mining. Quinvium needs an AMD or NVIDIA card with at least 2 GB of its own memory and a current driver; older or built-in graphics usually cannot mine.")],
    ['noHash', flag('noHash', !preparing && (miner.counters?.rate ?? 0) === 0) >= HEALTH.noHashMs, () => tr('The card has not computed anything for several minutes.')],
  ].find(([, bad]) => bad);
  if (!problems) {
    if (health.warned) notify('mining', tr('Mining works again'), tr('The problem is gone, mining continues.'));
    health.warned = null;
    if (miner.warning) { miner.warning = null; send({ type: 'state' }); refreshTray(); }
    return;
  }
  const [key, , text] = problems;
  miner.warning = text();
  if (health.warned !== key) {
    health.warned = key;
    notify('mining', tr('Mining is not earning'), miner.warning);
    send({ type: 'state' });
    refreshTray();
  }
}

/** Mining interrupted by an update continues as soon as the node is ready. */
function resumeMining() {
  const { resume } = loadSettings();
  if (!resume || miner.proc) return;
  saveSettings({ resume: null });
  try { startMiner(resume); } catch { /* the address is no longer valid; the user starts mining themselves */ }
}

// ---- remote updates and status reports, only when an address is set in the settings ---------------------------
const GPU_FULL_POWER = 0;
const GPU_DRIVER_DEFAULT = 16;
const HEALTHY_MS = 60_000;
const UPDATE_CHECK_MS = Number(process.env.AETHER_UPDATE_MS) || 5 * 60_000;     // shortening is only for tests
const REPORT_MS = Number(process.env.AETHER_REPORT_MS) || 60_000;
let updating = false;

const versionsDir = () => path.join(app.getPath('userData'), 'versions');

/** The new version is unpacked next to the running one and the app restarts itself. The launcher chooses the new one and rolls back on failure. */
async function updateNow() {
  const { updateUrl } = loadSettings();
  if (!updateUrl || !app.isPackaged || updating) return;
  // Mainnet without remote updates while the signing key sits on one computer (docs/MAINNET-LAUNCH.md).
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

// Only the NVIDIA driver can report the card's temperature and state. On other cards the value is simply absent.
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

/** The address of the computer with the pool or updates changed: the app finds it through connected nodes and keeps mining. */
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
  push(node.log, `New address on the home network: ${Object.values(change).map((v) => v.url ?? v).join(', ')}`);
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
 * Full NVIDIA driver output while the card computes: performance state, clock throttle reasons, bus and processes.
 * Sent only to the address from the settings, without the card's serial number or UUID.
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

// An update is confirmed only after the app has run with the node for a while. Until then it rolls back on failure.
const confirmHealthy = () => {
  if (node.proc && win && !win.isDestroyed()) versions.confirmVersion(versionsDir(), app.getVersion());
  else setTimeout(confirmHealthy, HEALTHY_MS);
};
setTimeout(confirmHealthy, HEALTHY_MS);

app.whenReady().then(() => { createWindow(); createTray(); refreshCli(); });
app.on('second-instance', showWindow);
app.on('activate', showWindow);
// Without the tray (tests) closing the last window ends the app as before.
app.on('window-all-closed', () => { if (!tray) app.quit(); });
let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  share.status = 'off';
  share.tunnel?.stop();
  await stop(miner.proc);
  await stop(node.proc);
  app.quit();
});
