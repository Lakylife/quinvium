// The only interface between the window and the system. The window has no access to files or processes.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  testRpcPort: Number(process.env.AETHER_RPC_PORT) || null,   // tests only, next to a running app
  state: () => invoke('state'),
  startNode: (network) => invoke('node:start', network),
  stopNode: () => invoke('node:stop'),
  setNetworkOptions: (options) => invoke('node:network', options),
  listDevices: () => invoke('miner:list'),
  cliPath: () => invoke('cli:path'),
  cliInstall: () => invoke('cli:install'),
  startMiner: (o) => invoke('miner:start', o),
  stopMiner: () => invoke('miner:stop'),
  explorerInfo: () => invoke('explorer:info'),
  setPower: (value) => invoke('miner:power', value),
  setPool: (pool) => invoke('miner:pool', pool),
  poolOfferOff: () => invoke('miner:poolOfferOff'),
  runPool: (address) => invoke('node:pool', address),
  checkUpdate: () => invoke('update:check'),
  setContext: (c) => invoke('app:context', c),
  setNotify: (kind, on) => invoke('notify:set', kind, on),
  checkRelease: () => invoke('release:check'),
  downloadRelease: () => invoke('release:download'),
  openRelease: () => invoke('release:open'),
  loadWallet: () => invoke('wallet:load'),
  saveWallet: (data) => invoke('wallet:save', data),
  walletAnswer: (message) => invoke('wallet:answer', message),
  focusWallet: () => invoke('wallet:focus'),
  walletLinkOpen: (o) => invoke('wallet:link-open', o),
  walletLinkRequest: (method, params, config) => invoke('wallet:link-request', method, params, config),
  onEvent: (fn) => ipcRenderer.on('event', (_, e) => fn(e)),
});
