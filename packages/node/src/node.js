// Full node: ties together the chain, the transaction queue, the network, RPC and work for miners.
import { EventEmitter } from 'node:events';
import { Address } from '@ethereumjs/util';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { NETWORKS } from './params.js';
import { Chain } from './core/chain.js';
import { Mempool } from './core/mempool.js';
import { Network } from './p2p/network.js';
import { NodeIdentity } from './p2p/identity.js';
import { PublicAccess, isPublicIPv4 } from './p2p/upnp.js';
import { WorkManager } from './mining/work.js';
import { PoolServer } from './mining/pool.js';
import { trustedFactories } from './mining/pool-factories.js';
import { StratumServer } from './mining/stratum.js';
import { RpcServer } from './rpc/server.js';
import { VmPool } from './rpc/vm-pool.js';
import { estimateGas, ethCall } from './rpc/call.js';
import { fromHex, toHex } from './util/bytes.js';
import predeploys from './genesis/predeploys.json' with { type: 'json' };
import { L } from './lang.js';
import { ChainWatch } from './watch/peers.js';
import { PublicNodes } from './watch/public-nodes.js';
import { SITES, SiteWatch, hashFolder } from './watch/site.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VERSION = 'quintium-node/2.16.2';
const POOL_RETRY_MS = 60_000;
const JOURNAL_MS = 30_000;       // queue on disk; after a crash at most the last half minute is missing
const REBROADCAST_MS = 60_000;   // own pending transactions to peers again

/** The system contracts in genesis are the same on all networks. */
const DEEP_REORG = 6;     // ordinary branches have one or two blocks
export const loadAlloc = () => predeploys;

/**
 * Hashes of the website and Explorer files this release carries: the Explorer the node serves itself, and
 * site-manifest.json written by the release script (scripts/site-manifest.mjs) for the website.
 */
export function releaseHashes(staticDir) {
  const out = hashFolder(staticDir, 'packages/explorer/public');
  // Next to the one-file node in the app (build/<platform>), or in the node package when run from source.
  const dirs = [];
  if (typeof __dirname === 'string') dirs.push(__dirname);
  try { dirs.push(join(dirname(fileURLToPath(import.meta.url)), '..')); } catch { /* bundled: no import.meta */ }
  const manifest = dirs.map((d) => join(d, 'site-manifest.json')).find((f) => existsSync(f));
  if (manifest) {
    try {
      const files = JSON.parse(readFileSync(manifest, 'utf8')).files ?? {};
      for (const [path, hash] of Object.entries(files)) if (typeof hash === 'string' && /^[0-9a-f]{40}$/.test(hash)) out[path] ??= hash;
    } catch { /* a damaged manifest only means fewer accepted hashes */ }
  }
  return out;
}

export class AetherNode extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.version = VERSION;
    this.log = opts.log ?? ((m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`));
    this.minerAddress = opts.minerAddress ? fromHex(opts.minerAddress) : null;
  }

  async start() {
    const o = this.opts;
    const network = typeof o.network === 'string' ? NETWORKS[o.network] : o.network;
    if (!network) throw new Error(`Unknown network ${o.network}`);
    const dataDir = o.dataDir ?? join(homedir(), '.aether', network.name);
    this.dataDir = dataDir;
    this.chain = await Chain.open({ network, dataDir, alloc: o.alloc ?? loadAlloc(), now: o.now, powDir: o.powDir });
    this.mempool = new Mempool(this.chain);
    // Pending transactions survive a restart and a program update; otherwise wallets would wait for a transaction the node forgot.
    if (dataDir !== ':memory:') {
      this.journal = join(dataDir, 'mempool.bin');
      const restored = await this.mempool.restore(this.journal);
      if (restored) this.log(L(`Fronta: načteno ${restored} čekajících transakcí z doby před restartem`, `Queue: loaded ${restored} pending transactions from before the restart`));
    }
    this.chain.backfillIndex().catch((e) => this.log(`${L('Rejstřík Exploreru', 'Explorer index')}: ${e.message}`));
    // AETHER_NO_SEEDS=1: without built-in seeds, so test nodes do not connect to the real network.
    const seeds = [...(process.env.AETHER_NO_SEEDS === '1' ? [] : network.seeds), ...(o.seeds ?? [])];
    this.network = new Network({
      chain: this.chain, mempool: this.mempool, port: o.p2pPort ?? network.ports.p2p, host: o.p2pHost ?? '0.0.0.0', seeds,
      allowPrivate: o.allowPrivate ?? false, lan: o.lan ?? false, agent: VERSION, log: o.verbose ? this.log : () => {},
      // Persistent node key in the data folder. Mainnet accepts only nodes with a signed identity; testnet also older versions.
      identity: NodeIdentity.load(dataDir === ':memory:' ? null : join(dataDir, 'node.key')),
      requireIdentity: o.requireIdentity ?? network.name === 'mainnet',
    });
    if (dataDir !== ':memory:') this.vm = new VmPool({ network, dbPath: join(dataDir, 'chain.db'), powDir: this.chain.pow.dir, log: this.log });
    this.work = new WorkManager({ chain: this.chain, mempool: this.mempool, network: this.network, extra: o.extra ?? 'Quinvium', log: this.log });
    this.miningRpc = o.miningRpc ?? true;
    this.rpc = new RpcServer(this, {
      host: o.rpcHost ?? '127.0.0.1', port: o.rpcPort ?? network.ports.rpc, staticDir: o.staticDir ?? null, rateLimit: o.rateLimit ?? 0, trustProxy: o.trustProxy ?? false, publicMode: !!o.publicAccess, publicRateLimit: o.publicRateLimit, tunnelPort: o.tunnelPort ?? null, log: this.log,
    });
    this.stratum = new StratumServer({ chain: this.chain, work: this.work, host: o.stratumHost ?? '127.0.0.1', port: o.stratumPort ?? network.ports.stratum, maxSessions: o.stratumSessions, maxSessionsPerIp: o.stratumSessionsPerIp, localOnlyWithoutPool: !!o.publicAccess, log: this.log });
    // Otherwise the user would not notice old software: the node just keeps losing its connection to the network.
    let warned = 0;
    this.network.on('incompatible', (peer) => {
      if (Date.now() - warned < 3_600_000) return;
      warned = Date.now();
      this.log(L(`VAROVÁNÍ: uzel ${peer.address} používá jiná pravidla sítě. Pokud se to opakuje, zkontrolujte aktualizaci programu.`, `WARNING: node ${peer.address} uses different network rules. If this repeats, check for a program update.`));
    });
    await this.network.start();
    // Nodes watch each other's blocks, and the public website and Explorer against GitHub and this release.
    this.chainWatch = new ChainWatch({ chain: this.chain, network: this.network, log: this.log });
    this.chainWatch.on('disagree', (d) => this.emit('watch', { kind: 'disagree', ...d }));
    this.chainWatch.on('incident', (d) => this.emit('watch', d));
    // Public RPC nodes of the community: signed addresses from peers, each checked by this node before it is listed.
    this.publicNodes = new PublicNodes({ chain: this.chain, identity: this.network.identity, chainId: network.chainId, fetchImpl: o.publicNodesFetch, log: this.log });
    this.network.on('public-nodes', (list) => this.publicNodes.receive(list));
    this.network.on('peer-connected', (peer) => this.network.sendPublicNodes(this.publicNodes.outgoing(), peer));
    this.publicNodesTimer = setInterval(() => {
      this.publicNodes.refresh().catch(() => {});
      this.network.sendPublicNodes(this.publicNodes.outgoing());
    }, 10 * 60_000);
    this.publicNodesTimer.unref?.();
    const sites = o.siteCheck === false || process.env.AETHER_NO_SITE_CHECK === '1' ? null : (o.sites ?? SITES[network.name] ?? null);
    if (sites) {
      this.siteWatch = new SiteWatch({ sites, release: releaseHashes(o.staticDir), log: this.log, ...o.siteWatchOptions });
      this.siteWatch.on('changed', (c) => this.emit('watch', { kind: 'site-changed', ...c }));
      this.siteWatch.start(o.siteWatchStart);
    }
    await this.rpc.start();
    await this.stratum.start();
    if (o.pool) await this._configuredPool();
    // Access from the internet: the router opens the RPC and network ports (for a pool also Stratum). Finding the router must not delay the node's start.
    if (o.publicAccess) {
      const ports = [{ port: this.rpc.port, name: 'RPC' }, { port: this.network.port, name: 'P2P' }];
      if (o.pool) ports.push({ port: this.stratum.port, name: 'Stratum' });
      this.publicAccess = new PublicAccess({ ports, host: o.publicHost ?? null, lookup: o.publicLookup ?? true, log: this.log, ...o.publicAccessOptions });
      this.publicAccess.start().catch((e) => this.log(`UPnP: ${e.message}`));
    } else if (o.upnp) {
      // Only the network port: other nodes can then connect to this one, as with Bitcoin and Ethereum nodes at home.
      // RPC, the Explorer and Stratum stay closed; the public address is not looked up on the internet.
      this.p2pAccess = new PublicAccess({ ports: [{ port: this.network.port, name: 'P2P' }], lookup: false, log: this.log, ...o.publicAccessOptions });
      this.p2pAccess.start().catch((e) => this.log(`UPnP: ${e.message}`));
    }
    this.timers = [
      this.journal && setInterval(() => this.mempool.save(this.journal), JOURNAL_MS),
      setInterval(() => this.rebroadcast(), REBROADCAST_MS),
    ].filter(Boolean);
    this.timers.forEach((t) => t.unref());
    this.chain.on('head', ({ block, removed }) => {
      const h = block.header;
      this.emit('head', h);
      if (!this.network.behind) {
        this.log(`${L('Blok', 'Block')} #${h.number} ${toHex(h.hash()).slice(0, 12)} tx=${block.txs.length} ${L('obtížnost', 'difficulty')}=${h.difficulty}${removed.length ? ` reorg=${removed.length}` : ''}`);
      }
    });
    this.chain.on('listener-error', ({ event, error }) => this.log(L(`Chyba posluchače události ${event}: ${error?.message ?? error}`, `Error in a listener of the ${event} event: ${error?.message ?? error}`)));
    this.chain.on('finality-violation', ({ depth }) => this.log(L(`VAROVÁNÍ: odmítnut přepis ${depth} bloků`, `WARNING: refused a reorganisation of ${depth} blocks`)));
    this.chain.on('reorg', ({ depth }) => { if (depth >= DEEP_REORG) this.log(L(`VAROVÁNÍ: přepis ${depth} bloků, ověřte, že nejde o útok`, `WARNING: reorganisation of ${depth} blocks, check that it is not an attack`)); });
    return this;
  }

  /** A wrong pool address or a network before the fork must not switch off the whole node. It is retried when the situation changes. */
  async _configuredPool() {
    const o = this.opts;
    try {
      await this.startPool(fromHex(o.pool), o.poolKey);
    } catch (e) {
      this.log(`${L('Pool zatím neběží', 'The pool does not run yet')}: ${e.message}`);
      this.poolRetry = setTimeout(() => this._configuredPool(), POOL_RETRY_MS);
      this.poolRetry.unref();
    }
  }

  /** Accepting a transaction from the node itself, the same path as from RPC. */
  async sendTx(tx) {
    await this.mempool.add(tx, { local: true });
    this.network?.broadcastTxs([tx]);
    this.emit('pending-tx', tx);
    return tx;
  }

  /** Own transactions pending for over half a minute are sent to peers again. Whoever has them already just skips them. */
  rebroadcast() {
    const txs = this.mempool.local(REBROADCAST_MS / 2);
    if (txs.length) this.network?.broadcastTxs(txs);
    return txs.length;
  }

  /** Starts the pool server. Stratum and RPC then hand out work for the pool contract. */
  async startPool(address, key, options = {}) {
    const head = () => this.chain.head;
    const call = async (params) => (this.vm ? this.vm.run('call', head(), params) : toHex(await ethCall(this.chain, head(), params)));
    const estimate = async (params) => (this.vm ? this.vm.run('estimate', head(), params) : estimateGas(this.chain, head(), params));
    const getCode = async (a) => (await this.chain.stateAt(head().stateRoot)).stateManager.getCode(new Address(a));
    const factories = await trustedFactories(getCode, this.chain.network.chainId, this.opts.poolFactories ?? []);
    const pool = new PoolServer({
      chain: this.chain, work: this.work, mempool: this.mempool, address, key, call, estimate, send: (tx) => this.sendTx(tx), log: this.log, factories,
      stateFile: this.dataDir === ':memory:' ? undefined : join(this.dataDir, `pool-${toHex(address)}.json`), ...options,
    });
    await pool.start();
    this.pool = pool;
    this.stratum.pool = pool;
    return pool;
  }

  /** RPC addresses for wallets: this computer, the local network and the internet. The Explorer shows them on the Network page too. */
  endpoints() {
    const port = this.rpc.port;
    const open = ['0.0.0.0', '::'].includes(this.rpc.host);
    // 169.254 is an automatic address without a network; the wallet does not use it.
    const lan = open ? Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal && !isPublicIPv4(a.address) && !a.address.startsWith('169.254.')).map((a) => a.address) : [];
    const access = this.publicAccess?.info() ?? null;
    const host = access?.host ?? null;
    return {
      chainId: Number(this.chain.network.chainId), rpcPort: port, p2pPort: this.network.port,
      local: `http://127.0.0.1:${port}`,
      lan: [...new Set(lan)].map((ip) => `http://${ip}:${port}`),
      public: host ? `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}` : null,
      p2pOpen: this.p2pAccess ? this.p2pAccess.info().upnp : access ? access.upnp : null,
      access: access && { method: access.method, upnp: access.upnp, behindNat: access.behindNat, nat: access.nat, error: access.error, ports: access.ports, internal: access.internal, checked: access.checked },
    };
  }

  async stop() {
    clearTimeout(this.poolRetry);
    await this.publicAccess?.stop();
    await this.p2pAccess?.stop();
    this.siteWatch?.stop();
    this.chainWatch?.stop();
    clearInterval(this.publicNodesTimer);
    this.timers?.forEach(clearInterval);
    this.pool?.stop();
    await this.stratum?.stop();
    this.work?.stop();
    await this.rpc?.stop();
    await this.vm?.stop();
    await this.network?.stop();
    if (this.journal) {
      await this.mempool.settled();
      this.mempool.save(this.journal);
    }
    await this.chain?.close();
  }
}
