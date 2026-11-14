import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, LIMITS, allowed, count, detect, initialState, milestonesUpTo } from '../src/events.js';
import { format, telegramMessage, xMessage } from '../src/format.js';
import { oauthHeader, telegram, x } from '../src/channels.js';

const T0 = Date.UTC(2026, 10, 14, 13, 0, 0) / 1000;   // 14 Nov 2026 13:00 UTC
const snap = (o = {}) => ({
  height: 2_400, headTime: T0 - 10, hashrate: 2_500_000, reward: '4000000000000000000', halvingInterval: 8_000_000, blockTime: 15,
  supply: '9600000000000000000000', day: { blocks: 5_000, txs: 12, miners: 3 }, release: { tag: 'v2.14.1', name: 'Quinvium 2.14.1', url: 'https://github.com/Lakylife/quinvium/releases/tag/v2.14.1' }, pools: [], ...o,
});
const kinds = (r) => r.events.map((e) => e.kind).sort();

test('the first run announces nothing from history', () => {
  const s = initialState(snap({ height: 120_000 }), T0);
  const r = detect(s, snap({ height: 120_001 }), T0 + 60);
  assert.deepEqual(r.events, []);
  assert.deepEqual(milestonesUpTo(3_500_000).slice(-3), [1_000_000, 2_000_000, 3_000_000]);
});

test('a milestone is announced once on both channels', () => {
  let s = initialState(snap({ height: 9_999 }), T0);
  const r = detect(s, snap({ height: 10_002 }), T0 + 60);
  assert.deepEqual(kinds(r), ['milestone']);
  assert.deepEqual(r.events[0].channels, ['telegram', 'x']);
  s = { ...r.state, sent: { ...r.state.sent, [r.events[0].key]: T0 } };
  assert.deepEqual(detect(s, snap({ height: 10_050 }), T0 + 120).events, []);
});

test('a stalled network: one warning, one recovery note, Telegram only', () => {
  let s = initialState(snap(), T0);
  const a = detect(s, snap({ headTime: T0 - 700 }), T0);
  assert.deepEqual(kinds(a), ['stall']);
  assert.deepEqual(a.events[0].channels, ['telegram']);
  s = a.state;
  assert.deepEqual(detect(s, snap({ headTime: T0 - 700 }), T0 + 60).events, [], 'no repeated warning');
  const b = detect(s, snap({ height: 2_401, headTime: T0 + 100 }), T0 + 110);
  assert.deepEqual(kinds(b), ['resume']);
});

test('halving: 30, 7 and 1 day notices, then the halving itself', () => {
  const at = (blocksLeft) => snap({ height: 8_000_000 - blocksLeft });
  const s = initialState(at(400_000), T0);
  const d30 = detect(s, at(170_000), T0 + 60);              // ~29.5 days
  assert.deepEqual(d30.events.map((e) => e.key), ['halving:1:30d']);
  const eta = d30.events[0].data.eta;   // now + blocks left × 15 s, so the date matches "in 30 days"
  assert.equal(eta, T0 + 60 + 170_000 * 15);
  assert.ok(Math.abs((eta - (T0 + 60)) / DAY - 29.5) < 0.1);
  assert.match(xMessage(d30.events[0]).text, /expected around 14 Dec 2026/);
  assert.deepEqual(detect(s, at(40_000), T0 + 60).events.map((e) => e.key), ['halving:1:7d']);   // ~6.9 days
  assert.deepEqual(detect(s, at(5_000), T0 + 60).events.map((e) => e.key), ['halving:1:1d']);
  const done = detect(s, snap({ height: 8_000_001, reward: '2000000000000000000' }), T0 + 60);
  assert.ok(done.events.some((e) => e.key === 'halving:1:done'));
  assert.match(format(done.events.find((e) => e.kind === 'halving')), /dropped to 2 QU/);
});

test('daily summary once per UTC day after noon', () => {
  const s = initialState(snap(), T0 - DAY);
  const r = detect(s, snap(), T0);
  assert.deepEqual(kinds(r), ['summary']);
  assert.equal(r.events[0].data.minted, 20_000);
  assert.deepEqual(detect(r.state, snap({ headTime: T0 + 3590 }), T0 + 3600).events, []);
  const early = initialState(snap(), T0 - DAY);
  assert.deepEqual(detect(early, snap(), T0 - 2 * 3600).events, [], 'before 12:00 UTC nothing');
});

test('a new release and a new pool are announced; the first known release is not', () => {
  const s = initialState(snap(), T0);
  const r = detect(s, snap({ release: { tag: 'v2.15.0', name: 'Quinvium 2.15.0', url: 'https://example.org/r' }, pools: [{ address: '0xAB', name: 'Pool A' }] }), T0 + 60);
  assert.deepEqual(kinds(r), ['pool', 'release']);
  assert.deepEqual(r.events.find((e) => e.kind === 'pool').channels, ['telegram', 'x']);
});

test('hashrate record: +20 % and at most once a week', () => {
  const s = initialState(snap(), T0);
  assert.deepEqual(detect(s, snap({ hashrate: 2_900_000 }), T0 + 60).events, [], 'below +20 %');
  const r = detect(s, snap({ hashrate: 3_100_000 }), T0 + 60);
  assert.deepEqual(kinds(r), ['hashrate']);
  assert.deepEqual(detect(r.state, snap({ hashrate: 9_000_000, headTime: T0 + 3 * DAY - 10 }), T0 + 3 * DAY).events.filter((e) => e.kind === 'hashrate'), [], 'not twice in a week');
});

test('X: at most 2 posts a day and 50 a month', () => {
  const s = {};
  count(s, 'x', T0); count(s, 'x', T0 + 60);
  assert.equal(allowed(s, 'x', T0 + 120), false);
  assert.equal(allowed(s, 'x', T0 + DAY), true, 'next day again');
  const m = { counts: { x: { day: 'x', dayN: 0, month: '2026-11', monthN: LIMITS.x.month } } };
  assert.equal(allowed(m, 'x', T0), false);
  assert.equal(allowed(m, 'telegram', T0), true);
});

test('every X post fits into 280 characters (a link counts 23) and has the hashtags', () => {
  const e = (kind, data) => ({ kind, data });
  const all = [
    e('milestone', { height: 1_000_000, supply: 4_000_000, hashrate: 1.234e12 }), e('hashrate', { hashrate: 1.234e12, previous: 9.9e11 }),
    e('halving-soon', { number: 3, block: 24_000_000, days: 30, blocksLeft: 172_800, reward: 1, eta: 1_900_000_000 }), e('halving', { number: 3, block: 24_000_000, reward: 0.5 }),
    e('summary', { time: 1_794_614_400, height: 12_345_678, blocks: 5_760, avgBlockTime: 15.02, minted: 23_040, hashrate: 1.2e12, miners: 12_345, txs: 1_234_567, supply: 63_999_999.99 }),
    e('release', { tag: 'v12.34.56', name: 'Quinvium 12.34.56', url: 'https://github.com/Lakylife/quinvium/releases/tag/v12.34.56' }),
    e('stall', { height: 12_345_678, minutes: 120 }), e('resume', { height: 12_345_678, minutes: 120 }),
    e('pool', { address: '0x' + 'ab'.repeat(20), name: 'A pool with a rather long name', feeBps: 150 }),
    e('miner', { address: '0x' + 'ab'.repeat(20), block: 12_345_678 }), e('node', { id: 'ab'.repeat(16), agent: 'quintium-node/12.34.56' }),
    e('hashrate-jump', { hashrate: 1.2e12, base: 4e11 }), e('week', { miners: 12_345 }), e('digest', { items: [{ kind: 'miner' }, { kind: 'node' }, { kind: 'hashrate-jump' }] }),
  ];
  for (const ev of all) {
    const t = xMessage(ev).text;
    assert.ok(t.replace(/https:\/\/\S+/g, 'x'.repeat(23)).length <= 280, `${ev.kind}: ${t}`);
    assert.match(t, /#Quinvium #PoW$/);
    assert.match(telegramMessage(ev).text, /^\S+ <b>.+<\/b>\n\n/);
  }
  const s = xMessage(all[4]).text;
  assert.match(s, /Blocks: 5,760 \(avg 15\.0 s\)/);
  assert.match(s, /Hashrate: 1\.2 TH\/s/);
  assert.match(xMessage(all[2]).text, /from 1 QU to 0\.5 QU/);
});

test('Telegram text is escaped HTML with a link preview', () => {
  const m = telegramMessage({ kind: 'pool', data: { address: '0xab', name: '<script>&Pool', feeBps: 100 } });
  assert.match(m.text, /<b>New mining pool: &lt;script&gt;&amp;Pool<\/b>/);
  assert.equal(m.link, 'https://explorer.quinvium.com/pool/0xab');
});

test('OAuth 1.0a signature matches the example from the X documentation', () => {
  // developer.x.com, "Creating a signature": the documented result is hCtSmYh+iHYCEqBWrE7C7hYmtUk=
  const h = oauthHeader({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw', // gitleaks:allow (public example keys from the X documentation)
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE', // gitleaks:allow (public example keys from the X documentation)
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
    formParams: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
  });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/); // gitleaks:allow (public example keys from the X documentation)
});

test('without keys the channels only print; with keys they call the right API', async () => {
  const printed = [];
  await telegram({ log: (t) => printed.push(t) }).send({ text: 'hi' });
  await x({ log: (t) => printed.push(t) }).send({ text: 'hi' });
  assert.equal(printed.length, 2);
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await telegram({ token: 'T', chat: '@Quinvium', fetch: fake }).send({ text: '<b>hello</b>', link: 'https://quinvium.com' });
  await x({ apiKey: 'a', apiSecret: 'b', accessToken: 'c', accessSecret: 'd', fetch: fake }).send({ text: 'hello' });
  assert.equal(JSON.parse(calls[0].init.body).parse_mode, 'HTML');
  assert.equal(JSON.parse(calls[0].init.body).link_preview_options.url, 'https://quinvium.com');
  assert.equal(calls[0].url, 'https://api.telegram.org/botT/sendMessage');
  assert.equal(JSON.parse(calls[0].init.body).chat_id, '@Quinvium');
  assert.equal(calls[1].url, 'https://api.x.com/2/tweets');
  assert.match(calls[1].init.headers.Authorization, /^OAuth /);
  const failing = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden' }) });
  await assert.rejects(telegram({ token: 'SECRET', chat: '@Quinvium', fetch: failing }).send({ text: 'x' }), (e) => !e.message.includes('SECRET'));
});

test('new miner, new node and a sharp hashrate rise go to Telegram only; nodes are known by ID, never by IP', () => {
  const s = initialState(snap({ nodes: [{ id: 'aa'.repeat(16), agent: 'quintium-node/2.15.0' }] }), T0);
  const r = detect(s, snap({
    height: 2_410, headTime: T0 + 50, hashrate: 4_000_000,
    recentMiners: [{ address: '0x' + '12'.repeat(20), first: 2_405 }, { address: '0x' + '34'.repeat(20), first: 100 }],
    nodes: [{ id: 'aa'.repeat(16), agent: 'x' }, { id: 'bb'.repeat(16), agent: 'quintium-node/2.15.0' }],
  }), T0 + 60);
  assert.deepEqual(kinds(r), ['hashrate', 'hashrate-jump', 'miner', 'node'], 'the record itself is a separate event');
  for (const e of r.events.filter((x) => x.kind !== 'hashrate')) assert.deepEqual(e.channels, ['telegram']);
  assert.ok(!JSON.stringify(r.events).match(/\d+\.\d+\.\d+\.\d+/), 'no IP address');
  assert.equal(r.state.weekMiners, 1);
  const again = detect(r.state, snap({ height: 2_411, headTime: T0 + 110, hashrate: 4_000_000, recentMiners: [{ address: '0x' + '12'.repeat(20), first: 2_405 }], nodes: [{ id: 'bb'.repeat(16) }] }), T0 + 120);
  assert.deepEqual(again.events, [], 'nothing twice, no second jump within 6 hours');
});

test('weekly summary of new miners on Monday goes to Telegram and X', () => {
  const s = { ...initialState(snap(), T0), weekMiners: 3 };
  const monday = Date.UTC(2026, 10, 16, 13, 0, 0) / 1000;
  const r = detect(s, snap({ headTime: monday - 10 }), monday);
  const week = r.events.find((e) => e.kind === 'week');
  assert.deepEqual(week.channels, ['telegram', 'x']);
  assert.match(xMessage(week).text, /3 new miners this week/);
  assert.equal(r.state.weekMiners, 0);
});

test('a digest merges small events into one Telegram message', () => {
  const m = telegramMessage({ kind: 'digest', data: { items: [{ kind: 'miner' }, { kind: 'miner' }, { kind: 'node' }] } });
  assert.match(m.text, /New miners: 2/);
  assert.match(m.text, /New nodes: 1/);
});

test('a majority miner is reported once on Telegram, and again when it is over', () => {
  const s = initialState(snap(), T0);
  const big = { address: '0x' + '2e'.repeat(20), share: 0.62, blocks: 160, of: 259 };
  const a = detect(s, snap({ headTime: T0 + 50, majority: big }), T0 + 60);
  assert.deepEqual(kinds(a), ['majority']);
  assert.deepEqual(a.events[0].channels, ['telegram']);
  assert.match(telegramMessage(a.events[0]).text, /62% of the work/);
  assert.deepEqual(detect(a.state, snap({ headTime: T0 + 110, majority: big }), T0 + 120).events, [], 'not repeated');
  const b = detect(a.state, snap({ headTime: T0 + 3590, majority: { ...big, share: 0.4 } }), T0 + 3600);
  assert.deepEqual(kinds(b), ['majority-end']);
  assert.ok(xMessage(a.events[0]).text.replace(/https:\/\/\S+/g, 'x'.repeat(23)).length <= 280);
});

test('a state from the previous version announces no existing node and no old miner', () => {
  const old = initialState(snap(), T0);
  delete old.nodes; delete old.minerHeight; delete old.weekMiners; delete old.lastWeek; delete old.hashrateBase;
  const r = detect(old, snap({ headTime: T0 + 50, nodes: [{ id: 'cc'.repeat(16) }], recentMiners: [{ address: '0x' + '56'.repeat(20), first: 50 }] }), T0 + 60);
  assert.deepEqual(r.events, []);
});
