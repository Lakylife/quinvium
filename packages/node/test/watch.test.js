import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { ChainWatch, SETTLED_DEPTH } from '../src/watch/peers.js';
import { SiteWatch, gitBlobHash, hashFolder } from '../src/watch/site.js';
import { Network } from '../src/p2p/network.js';
import { createMethods } from '../src/rpc/methods.js';
import { newChain, mineMany, tmpData } from './helpers/chain.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const until = async (cond, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
};

const fakePeer = (n, head) => ({ ready: true, nodeId: Buffer.alloc(32, n), headNumber: head });

async function branches() {
  const a = await newChain();
  const b = await newChain();
  await mineMany(a, 20);
  await mineMany(b, 20, { miner: new Uint8Array(20).fill(0xbb) });   // a different branch from block 1
  return { a, b };
}

test('chain watch: a peer with the same block agrees, a peer on another branch is reported', async () => {
  const { a, b } = await branches();
  const answers = new Map();
  const network = Object.assign(new EventEmitter(), { probeHeader: async (peer, parent) => answers.get(peer.nodeId[0])(parent) });
  const logs = [];
  let clock = 1_000_000;
  const watch = new ChainWatch({ chain: a, network, log: (m) => logs.push(m), now: () => clock });
  answers.set(1, () => a.getHeaderByNumber(14n));            // the same chain
  answers.set(2, () => b.getHeaderByNumber(14n));            // another branch, same height
  answers.set(3, () => b.getHeaderByNumber(0n));   // does not know our block at all
  for (const n of [1, 2, 3]) await watch.check(fakePeer(n, 20n));
  const first = watch.summary();
  assert.equal(first.differ, 0, 'one answer is not yet another branch');
  assert.equal(first.suspect, 2);
  assert.equal(first.ok, true);
  assert.equal(logs.length, 0, 'nothing logged on the first answer');
  clock += 121_000;
  const same = await watch.check(fakePeer(1, 20n));
  const other = await watch.check(fakePeer(2, 20n));
  const unknown = await watch.check(fakePeer(3, 20n));
  assert.equal(same.height, Number(20n - SETTLED_DEPTH));
  assert.equal(same.agree, true);
  assert.equal(other.agree, false);
  assert.equal(unknown.agree, false);
  assert.equal(unknown.theirs, null);
  assert.ok(logs.some((m) => /different block at height 14|jiný blok na výšce 14|výšce 14 jiný blok/.test(m)), logs.join('\n'));
  const s = watch.summary();
  assert.equal(s.checked, 3);
  assert.equal(s.agree, 1);
  assert.equal(s.differ, 2);
  assert.equal(s.suspect, 0);
  assert.equal(s.minority, true, 'two of three peers disagree: this node may be the one cut off');
  assert.equal(s.ok, false);
  assert.ok(!JSON.stringify(s).includes('127.0.0.1'), 'no addresses in the summary');
  watch.stop();
});

test('chain watch: a lagging peer is judged below its own head, a fresh head is not judged, questions are rate limited', async () => {
  const { a } = await branches();
  const asked = [];
  const network = Object.assign(new EventEmitter(), { probeHeader: async (peer, parent) => { asked.push(parent); return a.getHeaderByNumber(a.getHeader(parent).number + 1n); } });
  const watch = new ChainWatch({ chain: a, network });
  assert.equal(await watch.check(fakePeer(9, 5n)), null, 'a peer with only 5 blocks has nothing settled yet');
  const lag = await watch.check(fakePeer(1, 12n));
  assert.equal(lag.height, 6, 'SETTLED_DEPTH below the peer head, not the peer head itself');
  assert.equal(lag.agree, true);
  assert.equal(await watch.check(fakePeer(1, 13n)), null, 'the same peer is not asked again right away');
  assert.equal(asked.length, 1);
  const tooEarly = new ChainWatch({ chain: await newChain(), network });
  assert.equal(await tooEarly.check(fakePeer(2, 3n)), null, 'nothing settled yet on an empty chain');
  watch.stop(); tooEarly.stop();
});

test('chain watch: a node back online with an orphan on top is not reported, nor is one disagreement that heals', async () => {
  const { a, b } = await branches();
  let clock = 1_000_000;
  let answer;
  const network = Object.assign(new EventEmitter(), { probeHeader: async (peer, parent) => answer(parent) });
  const logs = [];
  const watch = new ChainWatch({ chain: a, network, log: (m) => logs.push(m), now: () => clock });
  // The peer comes back with head 16, whose top block lost a race: it is asked about block 10, which it shares with us.
  answer = (parent) => a.getHeaderByNumber(a.getHeader(parent).number + 1n);
  const back = await watch.check(fakePeer(4, 16n));
  assert.equal(back.height, 10);
  assert.equal(back.agree, true);
  // One odd answer, then a good one: never another branch, never logged.
  clock += 121_000;
  answer = () => b.getHeaderByNumber(10n);
  assert.equal((await watch.check(fakePeer(4, 16n))).suspect, true);
  clock += 121_000;
  answer = (parent) => a.getHeaderByNumber(a.getHeader(parent).number + 1n);
  assert.equal((await watch.check(fakePeer(4, 16n))).agree, true);
  const s = watch.summary();
  assert.equal(s.differ, 0);
  assert.equal(s.suspect, 0);
  assert.equal(logs.length, 0);
  watch.stop();
});

test('chain watch: a deep reorganisation and a refused one are recorded as incidents', async () => {
  const chain = await newChain();
  const network = Object.assign(new EventEmitter(), { probeHeader: async () => null });
  const watch = new ChainWatch({ chain, network });
  chain.emit('reorg', { depth: 2 });
  assert.equal(watch.summary().incidents.length, 0, 'a short race between two blocks is normal');
  chain.emit('reorg', { depth: 9 });
  chain.emit('finality-violation', { depth: 300 });
  const s = watch.summary();
  assert.deepEqual(s.incidents.map((i) => i.kind), ['deep-reorg', 'finality-violation']);
  assert.equal(s.ok, false);
  watch.stop();
});

test('two real nodes on different branches of equal work report each other', async () => {
  const { a, b } = await branches();
  const na = new Network({ chain: a, mempool: a.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  const nb = new Network({ chain: b, mempool: b.mempool, port: 0, host: '127.0.0.1', allowPrivate: true, seeds: [] });
  await na.start(); await nb.start();
  let clock = Date.now();
  const wa = new ChainWatch({ chain: a, network: na, now: () => clock });
  nb.connect('127.0.0.1', na.port);
  assert.ok(await until(() => na.peerCount === 1 && nb.peerCount === 1), 'connected');
  assert.ok(await until(() => wa.summary().checked === 1, 10000), 'the peer was asked on connecting');
  assert.equal(wa.summary().suspect, 1, 'the first answer is only a suspicion');
  clock += 121_000;
  await wa.check([...na.peers][0]);
  const s = wa.summary();
  assert.equal(s.differ, 1);
  assert.equal(s.differing[0].height, 14);
  wa.stop();
  await na.stop(); await nb.stop();
});

test('two real nodes on the same chain agree', async () => {
  const a = await newChain();
  await mineMany(a, 20);
  const b = await newChain();
  const na = new Network({ chain: a, mempool: a.mempool, port: 0, host: '127.0.0.1', allowPrivate: true });
  const nb = new Network({ chain: b, mempool: b.mempool, port: 0, host: '127.0.0.1', allowPrivate: true, seeds: [] });
  await na.start(); await nb.start();
  b.setClock(a.now());
  nb.connect('127.0.0.1', na.port);
  assert.ok(await until(() => b.head.number === 20n, 30000), `height ${b.head.number}`);
  const wb = new ChainWatch({ chain: b, network: nb });
  const verdict = await wb.check([...nb.peers][0]);
  assert.equal(verdict.agree, true);
  assert.equal(wb.summary().ok, true);
  wb.stop();
  await na.stop(); await nb.stop();
});

test('aether_watch over RPC: peers by key, never by address', async () => {
  const { a } = await branches();
  const network = Object.assign(new EventEmitter(), { probeHeader: async () => a.getHeaderByNumber(14n) });
  const chainWatch = new ChainWatch({ chain: a, network });
  await chainWatch.check(fakePeer(7, 20n));
  const { methods } = createMethods({ chain: a, mempool: a.mempool, network: null, work: null, version: 'x', chainWatch, siteWatch: null });
  const r = await methods.quinvium_watch([], { ip: '203.0.113.7', local: false });
  assert.equal(r.chain.agree, 1);
  assert.equal(r.sites, null);
  assert.ok(!JSON.stringify(r).match(/\d+\.\d+\.\d+\.\d+/), 'no IP address');
  chainWatch.stop();
});

// ---- the website and the Explorer ----------------------------------------------------------------

function fakeWeb({ main, live, status = {} }) {
  return async (url) => {
    if (url.startsWith('https://api.github.com/')) {
      if (status.github) return new Response('{}', { status: status.github });
      return Response.json({ tree: Object.entries(main).map(([path, content]) => ({ path, type: 'blob', sha: gitBlobHash(Buffer.from(content)) })) });
    }
    const body = live[url];
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body);
  };
}

const SITES = [{ name: 'explorer', base: 'https://explorer.example', dir: 'packages/explorer/public' }];

test('git blob hash is the one Git uses', () => {
  assert.equal(gitBlobHash(Buffer.from('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(gitBlobHash(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('site watch: the live site matching GitHub main is fine', async () => {
  const main = { 'packages/explorer/public/app.js': 'console.log(1)', 'packages/explorer/public/index.html': '<html>', 'packages/node/src/x.js': 'other' };
  const live = { 'https://explorer.example/app.js': 'console.log(1)', 'https://explorer.example/index.html': '<html>' };
  const w = new SiteWatch({ sites: SITES, fetch: fakeWeb({ main, live }) });
  assert.equal(w.summary().ok, null, 'not checked yet');
  await w.check();
  const s = w.summary();
  assert.equal(s.ok, true);
  assert.equal(s.files, 2, 'only the site folder is compared');
});

test('site watch: a file changed outside GitHub is reported after two checks in a row', async () => {
  const main = { 'packages/explorer/public/app.js': 'console.log(1)' };
  const live = { 'https://explorer.example/app.js': 'steal(wallet)' };
  const logs = [];
  const w = new SiteWatch({ sites: SITES, fetch: fakeWeb({ main, live }), log: (m) => logs.push(m) });
  const events = [];
  w.on('changed', (c) => events.push(c));
  await w.check();
  assert.equal(w.summary().ok, true, 'one check may hit a deployment in progress');
  await w.check();
  const s = w.summary();
  assert.equal(s.ok, false);
  assert.equal(s.changed[0].url, 'https://explorer.example/app.js');
  assert.equal(s.changed[0].problem, 'different');
  assert.equal(events.length, 1);
  assert.ok(logs.some((m) => /web se liší od vydání|website differs from the release/.test(m)), logs.join('\n'));
  await w.check();
  assert.equal(events.length, 1, 'the same change is announced once');
  live['https://explorer.example/app.js'] = 'console.log(1)';
  await w.check();
  assert.equal(w.summary().ok, true, 'fixed again');
});

test('site watch: the file from this node\'s release counts as genuine, a missing file does not', async () => {
  const main = { 'packages/explorer/public/app.js': 'v2', 'packages/explorer/public/new.js': 'new' };
  const live = { 'https://explorer.example/app.js': 'v1' };
  const release = { 'packages/explorer/public/app.js': gitBlobHash(Buffer.from('v1')) };
  const w = new SiteWatch({ sites: SITES, fetch: fakeWeb({ main, live }), release });
  await w.check(); await w.check();
  const s = w.summary();
  assert.deepEqual(s.changed.map((c) => [c.path, c.problem]), [['packages/explorer/public/new.js', 'missing (HTTP 404)']]);
});

test('site watch: GitHub unreachable is an error, not a change', async () => {
  const w = new SiteWatch({ sites: SITES, fetch: fakeWeb({ main: {}, live: {}, status: { github: 403 } }) });
  await assert.rejects(() => w.check(), /GitHub 403/);
  w.start({ first: 0, every: 60_000 });
  await until(() => w.summary().error !== null, 2000);
  w.stop();
  assert.equal(w.summary().changed.length, 0);
});

test('release hashes: a folder is hashed under its repository path', () => {
  const dir = tmpData();
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'a.js'), 'x');
  writeFileSync(join(dir, 'sub', 'b.css'), 'y');
  assert.deepEqual(hashFolder(dir, 'packages/explorer/public'), {
    'packages/explorer/public/a.js': gitBlobHash(Buffer.from('x')),
    'packages/explorer/public/sub/b.css': gitBlobHash(Buffer.from('y')),
  });
});
