// Plný uzel: spojuje řetězec, frontu transakcí, síť, RPC a práci pro minery.
import { EventEmitter } from 'node:events';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { NETWORKS } from './params.js';
import { Chain } from './core/chain.js';
import { Mempool } from './core/mempool.js';
import { Network } from './p2p/network.js';
import { NodeIdentity } from './p2p/identity.js';
import { PublicAccess, isPublicIPv4 } from './p2p/upnp.js';
import { WorkManager } from './mining/work.js';
import { PoolServer } from './mining/pool.js';
import { StratumServer } from './mining/stratum.js';
import { RpcServer } from './rpc/server.js';
import { VmPool } from './rpc/vm-pool.js';
import { estimateGas, ethCall } from './rpc/call.js';
import { fromHex, toHex } from './util/bytes.js';
import predeploys from './genesis/predeploys.json' with { type: 'json' };
import { L } from './lang.js';

export const VERSION = 'quintium-node/2.14.1';
const POOL_RETRY_MS = 60_000;
const JOURNAL_MS = 30_000;       // fronta na disku, po pádu chybí nejvýš poslední půlminuta
const REBROADCAST_MS = 60_000;   // vlastní čekající transakce znovu sousedům

/** Systémové kontrakty v genesis jsou stejné ve všech sítích. */
const DEEP_REORG = 6;     // běžné větve mají jeden nebo dva bloky
export const loadAlloc = () => predeploys;

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
    if (!network) throw new Error(`Neznámá síť ${o.network}`);
    const dataDir = o.dataDir ?? join(homedir(), '.aether', network.name);
    this.dataDir = dataDir;
    this.chain = await Chain.open({ network, dataDir, alloc: o.alloc ?? loadAlloc(), now: o.now, powDir: o.powDir });
    this.mempool = new Mempool(this.chain);
    // Čekající transakce přežijí restart i aktualizaci programu, peněženky by jinak čekaly na transakci, kterou uzel zapomněl.
    if (dataDir !== ':memory:') {
      this.journal = join(dataDir, 'mempool.bin');
      const restored = await this.mempool.restore(this.journal);
      if (restored) this.log(L(`Fronta: načteno ${restored} čekajících transakcí z doby před restartem`, `Queue: loaded ${restored} pending transactions from before the restart`));
    }
    this.chain.backfillIndex().catch((e) => this.log(`${L('Rejstřík Exploreru', 'Explorer index')}: ${e.message}`));
    // AETHER_NO_SEEDS=1: bez vestavěných seedů, aby se testovací uzly nespojily se skutečnou sítí.
    const seeds = [...(process.env.AETHER_NO_SEEDS === '1' ? [] : network.seeds), ...(o.seeds ?? [])];
    this.network = new Network({
      chain: this.chain, mempool: this.mempool, port: o.p2pPort ?? network.ports.p2p, host: o.p2pHost ?? '0.0.0.0', seeds,
      allowPrivate: o.allowPrivate ?? false, lan: o.lan ?? false, agent: VERSION, log: o.verbose ? this.log : () => {},
      // Trvalý klíč uzlu ve složce dat. Mainnet přijímá jen uzly s podepsanou identitou, testnet i starší verze.
      identity: NodeIdentity.load(dataDir === ':memory:' ? null : join(dataDir, 'node.key')),
      requireIdentity: o.requireIdentity ?? network.name === 'mainnet',
    });
    if (dataDir !== ':memory:') this.vm = new VmPool({ network, dbPath: join(dataDir, 'chain.db'), powDir: this.chain.pow.dir, log: this.log });
    this.work = new WorkManager({ chain: this.chain, mempool: this.mempool, network: this.network, extra: o.extra ?? 'Quinvium', log: this.log });
    this.miningRpc = o.miningRpc ?? true;
    this.rpc = new RpcServer(this, {
      host: o.rpcHost ?? '127.0.0.1', port: o.rpcPort ?? network.ports.rpc, staticDir: o.staticDir ?? null, rateLimit: o.rateLimit ?? 0, trustProxy: o.trustProxy ?? false, publicMode: !!o.publicAccess, publicRateLimit: o.publicRateLimit, log: this.log,
    });
    this.stratum = new StratumServer({ chain: this.chain, work: this.work, host: o.stratumHost ?? '127.0.0.1', port: o.stratumPort ?? network.ports.stratum, maxSessions: o.stratumSessions, maxSessionsPerIp: o.stratumSessionsPerIp, localOnlyWithoutPool: !!o.publicAccess, log: this.log });
    // Starý software si uživatel jinak nevšimne: uzel jen ztrácí spojení se sítí.
    let warned = 0;
    this.network.on('incompatible', (peer) => {
      if (Date.now() - warned < 3_600_000) return;
      warned = Date.now();
      this.log(L(`VAROVÁNÍ: uzel ${peer.address} používá jiná pravidla sítě. Pokud se to opakuje, zkontrolujte aktualizaci programu.`, `WARNING: node ${peer.address} uses different network rules. If this repeats, check for a program update.`));
    });
    await this.network.start();
    await this.rpc.start();
    await this.stratum.start();
    if (o.pool) await this._configuredPool();
    // Přístup z internetu: router otevře porty RPC a sítě (u poolu i Stratum). Hledání routeru nesmí zdržet start uzlu.
    if (o.publicAccess) {
      const ports = [{ port: this.rpc.port, name: 'RPC' }, { port: this.network.port, name: 'P2P' }];
      if (o.pool) ports.push({ port: this.stratum.port, name: 'Stratum' });
      this.publicAccess = new PublicAccess({ ports, host: o.publicHost ?? null, lookup: o.publicLookup ?? true, log: this.log, ...o.publicAccessOptions });
      this.publicAccess.start().catch((e) => this.log(`UPnP: ${e.message}`));
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
    this.chain.on('finality-violation', ({ depth }) => this.log(L(`VAROVÁNÍ: odmítnut přepis ${depth} bloků`, `WARNING: refused a reorganisation of ${depth} blocks`)));
    this.chain.on('reorg', ({ depth }) => { if (depth >= DEEP_REORG) this.log(L(`VAROVÁNÍ: přepis ${depth} bloků, ověřte, že nejde o útok`, `WARNING: reorganisation of ${depth} blocks, check that it is not an attack`)); });
    return this;
  }

  /** Špatná adresa poolu nebo síť před forkem nesmí vypnout celý uzel. Zkusí se to znovu, až se situace změní. */
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

  /** Přijetí transakce od uzlu samotného, stejná cesta jako z RPC. */
  async sendTx(tx) {
    await this.mempool.add(tx, { local: true });
    this.network?.broadcastTxs([tx]);
    this.emit('pending-tx', tx);
    return tx;
  }

  /** Vlastní transakce, které čekají přes půl minuty, jdou sousedům znovu. Kdo je už má, jen je přeskočí. */
  rebroadcast() {
    const txs = this.mempool.local(REBROADCAST_MS / 2);
    if (txs.length) this.network?.broadcastTxs(txs);
    return txs.length;
  }

  /** Spustí server poolu. Stratum i RPC pak rozdávají práci pro kontrakt poolu. */
  async startPool(address, key, options = {}) {
    const head = () => this.chain.head;
    const call = async (params) => (this.vm ? this.vm.run('call', head(), params) : toHex(await ethCall(this.chain, head(), params)));
    const estimate = async (params) => (this.vm ? this.vm.run('estimate', head(), params) : estimateGas(this.chain, head(), params));
    const pool = new PoolServer({
      chain: this.chain, work: this.work, mempool: this.mempool, address, key, call, estimate, send: (tx) => this.sendTx(tx), log: this.log,
      stateFile: this.dataDir === ':memory:' ? undefined : join(this.dataDir, `pool-${toHex(address)}.json`), ...options,
    });
    await pool.start();
    this.pool = pool;
    this.stratum.pool = pool;
    return pool;
  }

  /** Adresy RPC pro peněženky: tento počítač, místní síť a internet. Vidí je i Explorer na stránce Síť. */
  endpoints() {
    const port = this.rpc.port;
    const open = ['0.0.0.0', '::'].includes(this.rpc.host);
    // 169.254 je automatická adresa bez sítě, peněženka ji nepoužije.
    const lan = open ? Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal && !isPublicIPv4(a.address) && !a.address.startsWith('169.254.')).map((a) => a.address) : [];
    const access = this.publicAccess?.info() ?? null;
    const host = access?.host ?? null;
    return {
      chainId: Number(this.chain.network.chainId), rpcPort: port, p2pPort: this.network.port,
      local: `http://127.0.0.1:${port}`,
      lan: [...new Set(lan)].map((ip) => `http://${ip}:${port}`),
      public: host ? `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}` : null,
      access: access && { method: access.method, upnp: access.upnp, behindNat: access.behindNat, nat: access.nat, error: access.error, ports: access.ports, internal: access.internal, checked: access.checked },
    };
  }

  async stop() {
    clearTimeout(this.poolRetry);
    await this.publicAccess?.stop();
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
