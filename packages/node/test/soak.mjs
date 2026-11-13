// Zátěžová zkouška na skutečné síti: uzly jako procesy, GPU miner a nepřetržité transakce.
// Spuštění: node test/soak.mjs <složka> <sekundy>
// S AETHER_SOAK_DEV=1 běží na síti dev s těžbou v procesoru, grafická karta tak zůstane volná pro skutečnou těžbu.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { auditChain } from '../src/audit.js';
import { NETWORKS } from '../src/params.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const seconds = Number(process.argv[3] ?? 300);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const cli = join(here, '..', 'src', 'cli.js');
const minerBin = join(here, '..', '..', 'miner', 'target', 'release', 'quintium-miner');
const PHRASE = 'test test test test test test test test test test test junk';
const wallet = ethers.Wallet.fromPhrase(PHRASE);
const procs = {};
const DEV = !!process.env.AETHER_SOAK_DEV;
const NETWORK = DEV ? 'dev' : 'testnet';
const port = (n) => 8700 + n;
const p2p = (n) => 30700 + n;

function start(n, seeds = []) {
  const log = openSync(join(dir, `n${n}.log`), 'a');
  procs[n] = spawn(process.execPath, ['--no-warnings', cli, '--network', NETWORK, '--data-dir', join(dir, `n${n}`), '--rpc-port', port(n), '--p2p-port', p2p(n),
    '--stratum-port', 3600 + n, '--allow-private', '--verbose', ...(DEV && n === 1 ? ['--dev-mine', '--miner-address', wallet.address] : []), ...(seeds.length ? ['--seeds', seeds.map((s) => `127.0.0.1:${p2p(s)}`).join(',')] : [])], { stdio: ['ignore', log, log] });
}
const rpc = async (n, method, params = []) => {
  const r = await fetch(`http://127.0.0.1:${port(n)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = async (n) => { for (let i = 0; i < 60; i++) { try { await rpc(n, 'eth_blockNumber'); return; } catch { await sleep(500); } } throw new Error(`uzel ${n} nenaběhl`); };
const say = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

start(1); await live(1);
start(2, [1]); await live(2);
start(3, [1, 2]); await live(3);
const miner = DEV ? { kill() {} } : spawn(minerBin, ['--address', wallet.address, '--node', `http://127.0.0.1:${port(1)}`], { stdio: ['ignore', openSync(join(dir, 'miner.log'), 'a'), openSync(join(dir, 'miner.log'), 'a')] });
say('síť běží, čekám na první bloky');
while (BigInt(await rpc(1, 'eth_blockNumber')) < 8n) await sleep(1000);

const chainId = NETWORKS[NETWORK].chainId;
let nonce = 0;
let sent = 0;
let refused = 0;
const stopAt = Date.now() + seconds * 1000;
const receivers = Array.from({ length: 20 }, () => ethers.Wallet.createRandom().address);
let restarted = false;
let joined = false;
const startedAt = Date.now();

while (Date.now() < stopAt) {
  const target = [1, 2, 3][sent % 3];
  const via = procs[target] ? target : 1;
  try {
    const raw = await wallet.signTransaction({ type: 2, chainId, nonce, to: receivers[sent % 20], value: 1000n + BigInt(sent), gasLimit: 21000, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    await rpc(via, 'eth_sendRawTransaction', [raw]);
    nonce += 1;
    sent += 1;
  } catch (e) {
    refused += 1;
    if (/nízké/.test(e.message)) nonce = Number(await rpc(1, 'eth_getTransactionCount', [wallet.address, 'latest']));
  }
  const t = (Date.now() - startedAt) / 1000;
  if (!restarted && t > seconds * 0.35) {
    restarted = true;
    say('výpadek uzlu 2: tvrdé ukončení');
    procs[2].kill('SIGKILL');
    delete procs[2];
    await sleep(20000);
    start(2, [1]);
    await live(2);
    say('uzel 2 znovu běží');
  }
  if (!joined && t > seconds * 0.6) {
    joined = true;
    say('připojuji nový uzel 4');
    start(4, [3]);
    await live(4);
  }
  await sleep(700);
}

say('zastavuji miner a nechávám síť srovnat');
miner.kill();
await sleep(20000);
const heads = {};
for (const n of [1, 2, 3, 4]) heads[n] = await rpc(n, 'eth_getBlockByNumber', ['latest', false]);
const height = Math.min(...Object.values(heads).map((h) => Number(h.number)));
const at = {};
for (const n of [1, 2, 3, 4]) at[n] = await rpc(n, 'eth_getBlockByNumber', [`0x${height.toString(16)}`, false]);
const same = new Set(Object.values(at).map((h) => `${h.hash}${h.stateRoot}`)).size === 1;
const stats = await rpc(1, 'aether_stats');
const series = await rpc(1, 'aether_charts', [1000]);
const later = series.slice(Math.floor(series.length / 3));
const avg = later.reduce((s, p) => s + p.blockTime, 0) / later.length;
let confirmed = 0;
for (const r of receivers) confirmed += Number((await rpc(1, 'aether_addressTxs', [r, 1, 0])).total);
const errors = {};
for (const n of [1, 2, 3, 4]) {
  errors[n] = readFileSync(join(dir, `n${n}.log`), 'utf8').split('\n').filter((l) => /Error|VAROVÁNÍ|neplatný blok|zablokován|Chyba/.test(l)).length;
}
const minerLog = DEV ? '' : readFileSync(join(dir, 'miner.log'), 'utf8');
console.log(JSON.stringify({
  sekund: seconds, vyska: Number(stats.height), vysky: Object.fromEntries(Object.entries(heads).map(([k, v]) => [k, Number(v.number)])), shoda: same,
  odeslano: sent, potvrzeno: confirmed, vMempoolu: stats.mempool, odmitnuto: refused, casBloku: Number(avg.toFixed(1)), obtiznost: stats.difficulty,
  poplatky: stats.fees, nalezeno: (minerLog.match(/NALEZEN/g) ?? []).length, odmitnuteBloky: (minerLog.match(/blok odmítnut/g) ?? []).length, chybyVLogu: errors,
}, null, 1));
for (const p of Object.values(procs)) p.kill('SIGINT');
await sleep(2000);
// Uzel 2 dostal tvrdé ukončení. Po něm musí celý řetězec znovu projít od genesis.
const audit = await auditChain({ network: NETWORKS[NETWORK], dataDir: join(dir, 'n2') });
console.log(JSON.stringify({ kontrola: audit.ok, bloky: audit.blocks, transakce: audit.transactions, mince: audit.supply?.toString(), emise: audit.emitted.toString(), problemy: audit.problems }, null, 1));
process.exit(same && audit.ok ? 0 : 1);
