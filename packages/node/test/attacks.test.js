// Útoky na uzel: každý test předvádí konkrétní zneužití a ověřuje, že selže.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import { Address, bytesToHex } from '@ethereumjs/util';
import { Block, Header } from '../src/core/types.js';
import { InvalidBlock } from '../src/core/executor.js';
import { Network } from '../src/p2p/network.js';
import { MSG, SecureChannel } from '../src/p2p/wire.js';
import { Peer, PROTOCOL_VERSION } from '../src/p2p/peer.js';
import { forkId } from '../src/core/forks.js';
import { WorkManager } from '../src/mining/work.js';
import { CONSENSUS as C, GWEI, WEI } from '../src/params.js';
import { intToBytes } from '../src/util/bytes.js';
import { mine, mineMany, newChain, seal, tmpData, transfer, wallet } from './helpers/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const fund = (...ws) => Object.fromEntries(ws.map((w) => [bytesToHex(w.address), { balance: 1000n * WEI }]));

const until = async (cond, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
};

/** Zlomyslný uzel: projde handshakem a dál si posílá, co chce. */
async function evilPeer(target, { td = 0n, head = null, number = 0n, onMessage = () => {}, listenPort = 0 } = {}) {
  const { chain } = target;
  const socket = net.connect({ host: '127.0.0.1', port: target.port });
  await new Promise((r) => socket.once('connect', r));
  const channel = new SecureChannel(socket, true);
  const peer = new Peer(channel, '127.0.0.1', false);
  peer.on('message', (type, body) => onMessage(type, body, peer));
  await new Promise((r) => channel.once('ready', r));
  channel.unlock();
  const fork = forkId(chain.network, chain.genesis.hash(), 0n);
  peer.send(MSG.HELLO, [
    intToBytes(BigInt(PROTOCOL_VERSION)), intToBytes(chain.network.chainId), chain.genesis.hash(), head ?? chain.genesis.hash(),
    intToBytes(number), intToBytes(td), intToBytes(BigInt(listenPort)), crypto.getRandomValues(new Uint8Array(16)), new TextEncoder().encode('evil'),
    fork.hash, intToBytes(fork.next),
  ]);
  await until(() => peer.pending !== undefined && [...target.peers].some((p) => p.ready), 3000);
  return peer;
}

async function node(alloc) {
  const chain = await newChain({ alloc });
  const netw = new Network({ chain, mempool: chain.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  await netw.start();
  return { chain, net: netw };
}

// ---- konsensus a těžba -----------------------------------------------------------------

test('zfalšované tělo bloku neotráví poctivý blok se stejným hashem', async () => {
  const a = wallet(); const b = wallet();
  const miner = await newChain({ alloc: fund(a) });
  const victim = await newChain({ alloc: fund(a) });
  const tx = transfer(miner, a, new Address(b.address), 1n, 0n);
  const { block } = await mine(miner, { txs: [tx] });
  victim.setClock(miner.now());

  const forged = new Block(block.header, []);
  assert.deepEqual(forged.hash(), block.hash(), 'hash kryje jen hlavičku');
  await assert.rejects(victim.insertBlock(forged), /kořen transakcí/);

  const r = await victim.insertBlock(block);
  assert.equal(r.status, 'added', 'pravý blok musí projít');
  assert.deepEqual(victim.head.hash(), miner.head.hash());
});

test('blok plný levných nul nevytvoří nevytěžitelnou šablonu, síť se nezastaví', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  // Nulový bajt stojí 4 gas, takže limit gasu pustí víc dat, než je limit velikosti bloku.
  const zeros = new Uint8Array(127 * 1024);
  const gas = 21000n + 4n * BigInt(zeros.length);
  const txs = [];
  for (let i = 0; i < 24; i++) {
    const t = transfer(c, a, new Address(b.address), 0n, BigInt(i), { gas, data: zeros, fee: 9n * GWEI, tip: 2n * GWEI });
    if (gas * BigInt(i + 1) <= c.head.gasLimit) txs.push(t);
  }
  assert.ok(txs.reduce((n, t) => n + t.serialize().length, 0) > C.maxBlockBytes, 'test musí překročit limit velikosti');
  const { res, block } = await mine(c, { txs });
  assert.equal(res.status, 'added');
  assert.ok(block.txs.length < txs.length, 'šablona musí zbytek přeskočit');
  assert.ok(block.encode().length <= C.maxBlockBytes);
});

test('blok s neplatnou prací nezaplní databázi zamítnutých bloků', async () => {
  const c = await newChain();
  const honest = await newChain();
  const { block } = await mine(honest);
  c.setClock(honest.now());
  const f = Object.fromEntries(Object.entries(block.header).filter(([k]) => !k.startsWith('_')));
  const { Header } = await import('../src/core/types.js');
  for (let i = 0; i < 20; i++) {
    const junk = new Block(new Header({ ...f, gasUsed: BigInt(i + 1), nonce: new Uint8Array(8).fill(i) }), []);
    await assert.rejects(c.insertBlock(junk));
  }
  assert.equal(c.store.db.prepare('SELECT COUNT(*) AS n FROM bad_blocks').get().n, 0);
});

test('žádosti o práci pro tisíce adres nepřinutí uzel opakovaně provádět transakce', async () => {
  const a = wallet();
  const c = await newChain({ alloc: fund(a) });
  await c.mempool.add(transfer(c, a, new Address(wallet().address), 1n, 0n));
  const work = new WorkManager({ chain: c, mempool: c.mempool });
  let executed = 0;
  const build = c.buildTemplate.bind(c);
  c.buildTemplate = (o) => { if (!Array.isArray(o.txs)) executed += 1; return build(o); };
  await Promise.all(Array.from({ length: 200 }, (_, i) => work.getWork(new Uint8Array(20).fill(i + 1))));
  assert.ok(executed <= 38, `transakce se provedly ${executed}krát`);
  work.stop();
});

test('dlouhý blok při malém výkonu sítě neodřízne transakce ze šablony', async () => {
  const a = wallet();
  const c = await newChain({ alloc: fund(a) });
  const work = new WorkManager({ chain: c, mempool: c.mempool });
  const miner = new Uint8Array(20).fill(9);
  for (let i = 0; i < 80; i++) {
    work.buildBudget.tokens = Math.max(work.buildBudget.tokens, 1);    // simulace minut čekání na blok, doplňuje se časem
    work.current.clear();
    await work.getWork(miner);
  }
  await c.mempool.add(transfer(c, a, new Address(wallet().address), 1n, 0n));
  work.current.clear();
  work.buildBudget.tokens = 1;
  const w = await work.getWork(miner);
  const template = work.templates.get(`0x${Buffer.from(w.sealHash).toString('hex')}`);
  assert.equal(template.txs.length, 1, 'transakce patří do šablony i po mnoha obnovách');
  work.stop();
});

// ---- mempool -----------------------------------------------------------------------------

test('fronta nepřijme víc, než si odesílatel může dovolit dohromady', async () => {
  const a = wallet();
  const c = await newChain({ alloc: { [bytesToHex(a.address)]: { balance: 21000n * 3n * GWEI * 2n } } });
  const to = new Address(wallet().address);
  for (let i = 0n; i < 2n; i++) await c.mempool.add(transfer(c, a, to, 0n, i, { fee: 3n * GWEI }));
  await assert.rejects(c.mempool.add(transfer(c, a, to, 0n, 2n, { fee: 3n * GWEI })), /nedostatek prostředků/);
});

test('fronta má strop paměti i pro velké transakce', async () => {
  const senders = Array.from({ length: 40 }, () => wallet());
  const c = await newChain({ alloc: fund(...senders) });
  const data = new Uint8Array(120 * 1024).fill(1);
  const to = new Address(wallet().address);
  let accepted = 0;
  for (const s of senders) {
    for (let n = 0n; n < 8n; n++) {
      const tx = transfer(c, s, to, 0n, n, { gas: 3_000_000n, data, fee: 5n * GWEI });
      try { await c.mempool.add(tx); accepted += 1; } catch { /* plná fronta */ }
    }
  }
  assert.ok(c.mempool.bytes <= 64 * 1024 * 1024, `fronta drží ${c.mempool.bytes} bajtů po ${accepted} transakcích`);
});

// ---- síť -----------------------------------------------------------------------------------

test('uzel, který nečte odpovědi, nenaplní paměť oběti', async () => {
  const a = wallet();
  const v = await node(fund(a));
  // Velké bloky, ať má každá odpověď stovky kilobajtů.
  const data = new Uint8Array(100 * 1024).fill(7);
  for (let i = 0; i < 12; i++) {
    const txs = [];
    for (let j = 0; j < 8; j++) txs.push(transfer(v.chain, a, new Address(wallet().address), 1n, BigInt(i * 8 + j), { data, gas: 2_000_000n }));
    await mine(v.chain, { txs: txs.slice(0, 4) });
    await mine(v.chain, { txs: txs.slice(4) });
  }
  const hashes = [];
  for (let n = 1; n <= 24; n++) hashes.push(v.chain.store.canonicalHash(n));
  const evil = await evilPeer(v.net);
  await until(() => v.net.peerCount >= 1, 3000);
  const victim = [...v.net.peers][0];
  evil.channel.socket.pause();
  let peak = 0;
  for (let i = 0; i < 120 && !victim.channel.closed; i++) {
    evil.send(MSG.GET_BLOCKS, [intToBytes(BigInt(i + 1)), hashes]);
    await sleep(30);
    peak = Math.max(peak, victim.channel.queued);
  }
  assert.ok(peak <= 40 * 1024 * 1024, `fronta odesílání dosáhla ${peak} bajtů`);
  assert.ok(victim.channel.closed || peak <= 16 * 1024 * 1024, 'nečtoucí uzel musel být odpojen');
  await v.net.stop();
});

test('uzel, který lže o své práci a mlčí, nezastaví těžbu ani šíření bloků', async () => {
  const v = await node();
  const work = new WorkManager({ chain: v.chain, mempool: v.chain.mempool, network: v.net });
  // Zlomyslný uzel slíbí obrovskou práci a na žádost o hlavičky neodpoví.
  await evilPeer(v.net, { td: 2n ** 200n, number: 1_000_000n });
  await until(() => v.net.syncing, 1000);
  const w = await work.getWork(new Uint8Array(20).fill(7)).then(() => 'ok', (e) => e.message);
  assert.equal(w, 'ok', 'těžba nesmí stát kvůli neověřenému tvrzení o práci');
  work.stop();
  await v.net.stop();
});

test('lhář o práci dostane body a nezablokuje synchronizaci od poctivého uzlu', async () => {
  const honest = await node();
  for (let i = 0; i < 5; i++) await mine(honest.chain);
  const v = await node();
  v.chain.setClock(honest.chain.now());
  await evilPeer(v.net, { td: 2n ** 200n, number: 1_000_000n });
  await until(() => v.net.syncing, 1000);
  v.net.connect('127.0.0.1', honest.net.port);
  assert.ok(await until(() => v.chain.head.number === 5n, 12000), `výška oběti ${v.chain.head.number}`);
  await v.net.stop(); await honest.net.stop();
});

test('adresy z výměny mezi uzly nevytlačí ověřené uzly z výběru pro odchozí spojení', async () => {
  const v = await node();
  const { store } = v.chain;
  const good = ['8.8.4.4:30524', '1.1.1.1:30524', '9.9.9.9:30524'];
  for (const g of good) store.peerConnected(g);
  const evil = await evilPeer(v.net);
  const spam = Array.from({ length: 64 }, (_, i) => new TextEncoder().encode(`45.33.${i}.1:30524`));
  await until(() => v.net.peerCount >= 1, 3000);
  for (const p of v.net.peers) v.net._onPeers(p, spam);
  const picked = v.net._pickOutbound(8);
  assert.ok(good.every((g) => picked.includes(g)), `vybrány: ${picked.join(' ')}`);
  evil.disconnect('konec');
  await v.net.stop();
});

test('odchozí spojení míří do různých sítí, ne do jediného rozsahu útočníka', async () => {
  const v = await node();
  const { store } = v.chain;
  for (let i = 0; i < 100; i++) store.peerConnected(`45.33.7.${i + 1}:30524`);
  for (let i = 0; i < 6; i++) store.peerConnected(`${60 + i}.20.1.1:30524`);
  const picked = v.net._pickOutbound(8);
  const prefixes = picked.map((a) => a.split('.').slice(0, 2).join('.'));
  assert.ok(new Set(prefixes).size >= 6, `rozsahy: ${prefixes.join(' ')}`);
  await v.net.stop();
});

test('záplava platně podepsaných transakcí bez krytí je omezená na jeden uzel', async () => {
  const v = await node();
  const poor = wallet();
  const txs = [];
  for (let i = 0; i < 600; i++) txs.push(transfer(v.chain, poor, new Address(poor.address), 0n, 0n, { tip: BigInt(i + 1) }).serialize());
  const evil = await evilPeer(v.net);
  await until(() => v.net.peerCount >= 1, 3000);
  let verified = 0;
  const add = v.chain.mempool.add.bind(v.chain.mempool);
  v.chain.mempool.add = (tx) => { verified += 1; return add(tx); };
  for (let i = 0; i < 12 && !evil.channel.closed; i++) evil.send(MSG.NEW_TXS, [txs.slice(i * 50, i * 50 + 50)]);
  await sleep(1500);
  assert.ok(verified <= 300, `uzel ověřil ${verified} podpisů`);
  await v.net.stop();
});

test('žádost o tisíce bloků za sekundu vede k odpojení dřív, než uzel přestane stíhat', async () => {
  const v = await node();
  for (let i = 0; i < 5; i++) await mine(v.chain);
  const evil = await evilPeer(v.net);
  await until(() => v.net.peerCount >= 1, 3000);
  for (let i = 0; i < 500 && !evil.channel.closed; i++) evil.send(MSG.GET_HEADERS, [intToBytes(BigInt(i + 1)), [v.chain.genesis.hash()], intToBytes(256n)]);
  assert.ok(await until(() => v.net.peerCount === 0, 3000), 'uzel měl být odpojen');
  await v.net.stop();
});

// ---- RPC -------------------------------------------------------------------------------------

async function startNode(env = {}) {
  const dir = tmpData();
  const port = 21000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--no-warnings', join(here, '..', 'src', 'cli.js'), '--network', 'dev', '--data-dir', dir,
    '--rpc-port', String(port), '--p2p-port', String(port + 1), '--stratum-port', String(port + 2)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '';
  let exit = null;
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (c, s) => { exit = { c, s }; });
  await until(() => out.includes('RPC http'), 20000);
  return { port, child, alive: () => exit === null, output: () => out, stop: () => child.kill('SIGKILL') };
}

function rawHttp(port, path) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    s.on('data', () => {});
    s.on('close', resolve);
    s.on('error', resolve);
    setTimeout(() => { s.destroy(); resolve(); }, 1500);
  });
}

test('poškozená adresa v HTTP požadavku uzel neshodí', async () => {
  const n = await startNode();
  for (const path of ['/%ff', '/%E0%A4%A', '//', '/..%2f..%2f', '/%00']) await rawHttp(n.port, path);
  await sleep(300);
  assert.ok(n.alive(), `uzel spadl:\n${n.output().slice(-400)}`);
  n.stop();
});

test('zpráva null přes WebSocket uzel neshodí', async () => {
  const { WebSocket } = await import('ws');
  const n = await startNode();
  const ws = new WebSocket(`ws://127.0.0.1:${n.port}`);
  await new Promise((r, e) => { ws.once('open', r); ws.once('error', e); });
  for (const m of ['null', '5', '"x"', '[]', '{"method":"eth_subscribe","params":5}', '{"method":"eth_unsubscribe","params":7}']) ws.send(m);
  await sleep(400);
  assert.ok(n.alive(), `uzel spadl:\n${n.output().slice(-400)}`);
  ws.terminate();
  n.stop();
});

test('nekonečná smyčka v eth_call nezablokuje uzel', async () => {
  const n = await startNode();
  const rpc = (method, params) => fetch(`http://127.0.0.1:${n.port}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
  // Kód smyčky se spustí jako initcode přímo z eth_call bez nasazení.
  const start = Date.now();
  const heavy = rpc('eth_call', [{ data: '0x5b600056', gas: '0x2faf080' }, 'latest']);
  await sleep(50);
  const t0 = Date.now();
  await rpc('eth_blockNumber', []);
  const blocked = Date.now() - t0;
  await heavy;
  assert.ok(blocked < 400, `uzel byl zablokovaný ${blocked} ms, celé volání trvalo ${Date.now() - start} ms`);
  n.stop();
});

test('přehled posledních transakcí neprochází řetězec blok po bloku', async () => {
  const c = await newChain();
  for (let i = 0; i < 30; i++) await mine(c);
  const { createMethods } = await import('../src/rpc/methods.js');
  let reads = 0;
  const get = c.getBlockByNumber.bind(c);
  c.getBlockByNumber = (n) => { reads += 1; return get(n); };
  const { methods } = createMethods({ chain: c, mempool: c.mempool, network: null, work: null, version: 'x' });
  await methods.aether_recentTxs([20]);
  assert.ok(reads === 0, `přečteno ${reads} bloků`);
});

test('chyba uzlu při provádění bloku ho neoznačí za neplatný', async () => {
  const a = wallet();
  const miner = await newChain({ alloc: fund(a) });
  const victim = await newChain({ alloc: fund(a) });
  const { block } = await mine(miner, { txs: [transfer(miner, a, new Address(wallet().address), 1n, 0n)] });
  victim.setClock(miner.now());
  const read = victim.store.kvGet.bind(victim.store);
  victim.store.kvGet = () => { throw new Error('disk I/O error'); };
  await assert.rejects(victim.insertBlock(block), (e) => !(e instanceof InvalidBlock));
  victim.store.kvGet = read;
  assert.equal((await victim.insertBlock(block)).status, 'added', 'po odeznění poruchy musí blok projít');
});

/** Hlavička s výškou podle přání útočníka. S obtížností 1 projde levnou kontrolou bez jakékoli práce. */
function fakeHeader(parentHash, number) {
  const z = (n) => new Uint8Array(n);
  return new Header({
    parentHash, miner: z(20), stateRoot: z(32), txRoot: z(32), receiptsRoot: z(32), logsBloom: z(256),
    difficulty: 1n, number, gasLimit: 5_000_000n, gasUsed: 0n, timestamp: 1n, extraData: z(0), baseFee: 1n, mixHash: z(32), nonce: z(8),
  });
}

test('ověření hlavičky s výškou daleko nad špičkou nespustí výpočet cache její epochy', async () => {
  const c = await newChain();
  const h = fakeHeader(c.genesis.hash(), 10n ** 30n);
  assert.ok(c.pow.quickCheck(h), 'levná kontrola u obtížnosti 1 projde');
  const t0 = Date.now();
  assert.equal(await c.pow.verify(h), false);
  assert.ok(Date.now() - t0 < 100, `ověření trvalo ${Date.now() - t0} ms`);
});

test('hluboká větev s podvrženou výškou uzel nezablokuje', async () => {
  const v = await node();
  await mineMany(v.chain, C.maxReorgDepth + 4);
  // Výška epochy 2 000 000: bez opravy by se jen seedHash počítal desítky sekund v hlavním vlákně a test by selhal na čase.
  const fake = fakeHeader(v.chain.genesis.hash(), 60_000_000_000n);
  const evil = await evilPeer(v.net, {
    td: 2n ** 200n, number: 1_000_000n,
    onMessage: (type, body, peer) => { if (type === MSG.GET_HEADERS) peer.respond(MSG.HEADERS, body[0], [fake.fields()]); },
  });
  const t0 = Date.now();
  assert.ok(await until(() => evil.channel.closed, 5000), 'uzel útočníka odpojí');
  assert.ok(Date.now() - t0 < 5000, `uzel byl zablokovaný ${Date.now() - t0} ms`);
  assert.equal(v.net.bans.size, 0, 'místní adresa se v testu neblokuje, stačí odpojení');
  await v.net.stop();
});

test('hluboká větev s vymyšlenou obtížností se odmítne dřív, než ji uzel začne ověřovat', async () => {
  const v = await node();
  await mineMany(v.chain, C.maxReorgDepth + 4);
  const genesis = v.chain.genesis;
  // Obtížnost 7 tam, kde LWMA dává jinou: zdarma vyrobená větev, kterou by uzel jinak minuty ověřoval Ethashem.
  const base = Object.fromEntries(Object.entries(fakeHeader(genesis.hash(), 1n)).filter(([k]) => !k.startsWith('_')));
  let fake;
  for (let n = 0; ; n++) {
    // Levná kontrola musí projít, jinak by uzel hlavičku odmítl už kvůli ní a test by nic nedokázal.
    fake = new Header({ ...base, difficulty: genesis.difficulty + 6n, timestamp: genesis.timestamp + 1n, nonce: new Uint8Array(Buffer.from(n.toString(16).padStart(16, '0'), 'hex')) });
    if (v.chain.pow.quickCheck(fake)) break;
  }
  const reasons = [];
  v.net.on('peer-connected', (p) => p.on('misbehave', (_, r) => reasons.push(r)));
  let verified = 0;
  const verify = v.chain.pow.verify.bind(v.chain.pow);
  v.chain.pow.verify = (h) => { verified += 1; return verify(h); };
  const evil = await evilPeer(v.net, {
    td: 2n ** 200n, number: 1_000_000n,
    onMessage: (type, body, peer) => { if (type === MSG.GET_HEADERS) peer.respond(MSG.HEADERS, body[0], [fake.fields()]); },
  });
  assert.ok(await until(() => evil.channel.closed, 5000), 'uzel útočníka odpojí');
  assert.equal(verified, 0, 'žádný výpočet Ethash pro podvrženou větev');
  assert.ok(reasons.some((r) => /špatnou obtížnost/.test(r)), `důvody: ${reasons.join('; ')}`);
  await v.net.stop();
});
