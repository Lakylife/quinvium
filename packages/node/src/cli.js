#!/usr/bin/env node
// Starting a full Quinvium node from the command line.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AetherNode, VERSION } from './node.js';
import { NETWORKS } from './params.js';
import { DevMiner } from './mining/devminer.js';
import { fromHex } from './util/bytes.js';
import { L } from './lang.js';

const HELP = L(`${VERSION}

Použití: quintium-node [volby]

  --network <mainnet|testnet|dev>   síť (výchozí mainnet)
  --data-dir <složka>               data uzlu (výchozí ~/.aether/<síť>)
  --seeds <host:port,...>           další uzly pro první kontakt
  --p2p-port <port>                 port sítě
  --rpc-port <port>                 port JSON-RPC a exploreru
  --rpc-host <adresa>               adresa RPC (výchozí 127.0.0.1)
  --rate-limit <n>                  limit RPC požadavků za minutu na IP (0 = bez limitu)
  --trust-proxy                     IP klienta číst z X-Forwarded-For, jen za vlastní reverzní proxy
  --tunnel-port <port>              port jen pro tento počítač pro tunel (Sdílet uzel veřejně): vše na něm je cizí, limit podle Cf-Connecting-IP
  --no-mining-rpc                   vypnout getWork, submitWork a submitHashrate, pro veřejné uzly
  --no-site-check                   nekontrolovat web a explorer sítě proti GitHubu
  --stratum-port <port>             port pro minery
  --stratum-host <adresa>           adresa Stratum (0.0.0.0 pro minery v síti)
  --stratum-sessions <n>            kolik zařízení obslouží Stratum, výchozí 1024
  --stratum-sessions-per-ip <n>     kolik zařízení smí z jedné adresy, výchozí 128
  --max-inbound <n>                 kolik uzlů se smí připojit sem, výchozí 32
  --miner-address <0x...>           výchozí adresa výplaty pro eth_getWork
  --extra <text>                    značka v bloku, nejvýše 32 bajtů
  --pool <0x...>                    provozovat pool: adresa kontraktu z továrny
  --pool-key-file <soubor>          klíč účtu, který platí gas za podíly (vznikne sám)
  --explorer <složka>               složka se statickým explorerem
  --dev-mine                        vestavěný procesorový miner, jen pro síť dev
  --public                          přístup z internetu: otevře porty v routeru (UPnP) a zjistí veřejnou adresu
  --public-host <adresa>            veřejná adresa nebo doména uzlu, když ji chcete zadat ručně
  --upnp                            otevřít v routeru (UPnP) jen port pro spojení mezi uzly, RPC zůstává zavřené
  --lan                             najít uzly v místní síti automaticky
  --lan-port <port>                 port hledání v místní síti, jen pro oddělené testy
  --allow-private                   povolit uzly v lokální síti
  --verbose                         podrobný výpis sítě
  --exit-with-parent                skončit, když se zavře standardní vstup (aplikace, která uzel spustila, zmizela)
  --help                            tato nápověda
`, `${VERSION}

Usage: quintium-node [options]

  --network <mainnet|testnet|dev>   network (default mainnet)
  --data-dir <folder>               node data (default ~/.aether/<network>)
  --seeds <host:port,...>           more nodes for the first contact
  --p2p-port <port>                 network port
  --rpc-port <port>                 JSON-RPC and explorer port
  --rpc-host <address>              RPC address (default 127.0.0.1)
  --rate-limit <n>                  RPC requests per minute per IP (0 = no limit)
  --trust-proxy                     read the client IP from X-Forwarded-For, only behind your own reverse proxy
  --tunnel-port <port>              local-only port for a tunnel (Share node publicly): everything on it is foreign, limited per Cf-Connecting-IP
  --no-mining-rpc                   disable getWork, submitWork and submitHashrate, for public nodes
  --no-site-check                   do not check the network's website and explorer against GitHub
  --stratum-port <port>             port for miners
  --stratum-host <address>          Stratum address (0.0.0.0 for miners on the network)
  --stratum-sessions <n>            how many devices Stratum serves, default 1024
  --stratum-sessions-per-ip <n>     how many devices one address may use, default 128
  --max-inbound <n>                 how many peers may connect to this node, default 32
  --miner-address <0x...>           default payout address for eth_getWork
  --extra <text>                    block tag, at most 32 bytes
  --pool <0x...>                    run a pool: contract address from the factory
  --pool-key-file <file>            key of the account that pays gas for shares (created automatically)
  --explorer <folder>               folder with the static explorer
  --dev-mine                        built-in CPU miner, dev network only
  --public                          access from the internet: open ports in the router (UPnP) and find the public address
  --public-host <address>           public address or domain of the node, to set it by hand
  --upnp                            open only the port for connections between nodes in the router (UPnP), RPC stays closed
  --lan                             find nodes on the local network automatically
  --lan-port <port>                 local discovery port, only for separate tests
  --allow-private                   allow nodes on the local network
  --verbose                         detailed network log
  --exit-with-parent                stop when standard input closes (the app that started the node is gone)
  --help                            this help
`);

const { values: v } = parseArgs({
  options: {
    network: { type: 'string', default: 'mainnet' }, 'data-dir': { type: 'string' }, seeds: { type: 'string' },
    'p2p-port': { type: 'string' }, 'rpc-port': { type: 'string' }, 'rpc-host': { type: 'string' }, 'rate-limit': { type: 'string' },
    'stratum-port': { type: 'string' }, 'stratum-host': { type: 'string' }, 'stratum-sessions': { type: 'string' }, 'stratum-sessions-per-ip': { type: 'string' }, 'max-inbound': { type: 'string' }, 'miner-address': { type: 'string' }, extra: { type: 'string' },
    pool: { type: 'string' }, 'pool-key-file': { type: 'string' },
    explorer: { type: 'string' }, 'dev-mine': { type: 'boolean' }, 'allow-private': { type: 'boolean' }, lan: { type: 'boolean' }, public: { type: 'boolean' }, 'public-host': { type: 'string' }, upnp: { type: 'boolean' }, 'lan-port': { type: 'string' }, verbose: { type: 'boolean' }, 'exit-with-parent': { type: 'boolean' },
    'trust-proxy': { type: 'boolean' }, 'tunnel-port': { type: 'string' }, 'no-mining-rpc': { type: 'boolean' }, 'no-site-check': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

if (v.help) {
  console.log(HELP);
  process.exit(0);
}

const num = (s) => (s === undefined ? undefined : Number(s));

/** The pool key is only for gas for shares. It is created on first start and never printed. */
function poolKey() {
  const dir = v['data-dir'] ?? join(homedir(), '.aether', NETWORKS[v.network]?.folder ?? v.network);
  const file = v['pool-key-file'] ?? join(dir, 'pool.key');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `0x${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  }
  return fromHex(readFileSync(file, 'utf8').trim());
}

const here = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
const explorer = v.explorer ?? [join(here, 'explorer'), join(here, '..', '..', 'explorer', 'public')].find((d) => existsSync(d));
const node = new AetherNode({
  network: v.network, dataDir: v['data-dir'], seeds: v.seeds?.split(',').filter(Boolean), p2pPort: num(v['p2p-port']),
  rpcPort: num(v['rpc-port']), rpcHost: v['rpc-host'] ?? (v.public || v['public-host'] ? '0.0.0.0' : undefined), rateLimit: num(v['rate-limit']), stratumPort: num(v['stratum-port']),
  stratumHost: v['stratum-host'], stratumSessions: num(v['stratum-sessions']), stratumSessionsPerIp: num(v['stratum-sessions-per-ip']), maxInbound: num(v['max-inbound']), minerAddress: v['miner-address'], extra: v.extra, pool: v.pool, poolKey: v.pool ? poolKey() : undefined, staticDir: explorer, allowPrivate: v['allow-private'], lan: v.lan && v['lan-port'] ? { listenPort: num(v['lan-port']) } : v.lan, verbose: v.verbose,
  trustProxy: v['trust-proxy'], tunnelPort: v['tunnel-port'] === undefined ? null : num(v['tunnel-port']), miningRpc: !v['no-mining-rpc'], siteCheck: !v['no-site-check'],
  publicAccess: v.public || !!v['public-host'], publicHost: v['public-host'], upnp: v.upnp,
});

// An error while handling one request must not end the whole node. The database is consistent after every block.
// But when errors keep coming, something is wrong and the service manager had better restart the node clean.
const FATAL_PER_MINUTE = 60;
let faults = [];
const fault = (e) => {
  const now = Date.now();
  faults = faults.filter((t) => now - t < 60_000);
  faults.push(now);
  console.error(`${L('Neočekávaná chyba', 'Unexpected error')}: ${e?.stack ?? e}`);
  if (faults.length > FATAL_PER_MINUTE) process.exit(1);
};
process.on('uncaughtException', fault);
process.on('unhandledRejection', fault);

async function main() {
await node.start();
const n = node.chain.network;
node.log(L(`${VERSION}, síť ${n.name}, chainId ${n.chainId}, výška ${node.chain.head.number}`, `${VERSION}, network ${n.name}, chainId ${n.chainId}, height ${node.chain.head.number}`));
node.log(`RPC http://${node.rpc.host}:${node.rpc.port}  P2P ${node.network.port}  Stratum ${node.stratum.host}:${node.stratum.port}`);
// 0.0.0.0 is only the address the node listens on. The wallet needs the real address of this computer.
{
  const ends = node.endpoints();
  node.log(`${L('RPC pro peněženky na tomto počítači', 'RPC for wallets on this computer')}: ${ends.local}`);
  for (const url of ends.lan) node.log(`${L('RPC pro peněženky v místní síti', 'RPC for wallets on the local network')}: ${url}`);
  if (ends.public) node.log(`${L('RPC pro peněženky z internetu', 'RPC for wallets from the internet')}: ${ends.public}`);
}

let dev = null;
if (v['dev-mine']) {
  if (n.name !== 'dev') {
    node.log(L('Volba --dev-mine je povolena jen v síti dev.', 'The --dev-mine option is allowed only on the dev network.'));
    process.exit(1);
  }
  if (!v['miner-address']) {
    node.log(L('Volba --dev-mine vyžaduje --miner-address.', 'The --dev-mine option needs --miner-address.'));
    process.exit(1);
  }
  dev = new DevMiner(node);
  dev.start();
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  node.log(L('Ukončuji uzel...', 'Stopping the node...'));
  dev?.stop();
  await node.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// The app keeps a pipe open to our standard input. If the app crashes or is force-quit, the pipe closes
// and the node stops properly instead of running on and holding the ports for the next start.
if (v['exit-with-parent']) {
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.stdin.on('error', shutdown);
  process.stdin.resume();
}
}

main().catch((e) => {
  if (e.code === 'EADDRINUSE') console.error(L(`Chyba: port ${e.port ?? ''} už používá jiný program, nejspíš běžící uzel nebo aplikace Quinvium. Zvolte jiný přes --p2p-port, --rpc-port nebo --stratum-port.`, `Error: port ${e.port ?? ''} is used by another program, probably a running node or the Quinvium app. Choose another with --p2p-port, --rpc-port or --stratum-port.`));
  else console.error(`${L('Chyba', 'Error')}: ${e.message}`);
  process.exit(1);
});
