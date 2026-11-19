#!/usr/bin/env node
// Quinvium announcer: reads the public RPC and posts important network events to Telegram and X.
// Usage: node packages/announcer/src/main.js [--once] [--dry-run]
// Keys come only from environment variables (see packages/announcer/README.md); without them the channel only prints.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { MERGEABLE, PRIORITY, TELEGRAM_PER_HOUR, allowed, batchSmall, count, detect, initialState } from './events.js';
import { telegramMessage, xMessage } from './format.js';
import { telegram, x } from './channels.js';

const env = process.env;
const args = new Set(process.argv.slice(2));
const RPC = env.QUINVIUM_RPC || 'https://rpc.quinvium.com';
const STATE = env.ANNOUNCER_STATE || 'announcer-state.json';
const INTERVAL = Math.max(30, Number(env.ANNOUNCER_INTERVAL || 60)) * 1000;
const REPO = env.ANNOUNCER_GITHUB_REPO || 'Lakylife/quinvium';
const DRY = args.has('--dry-run');
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** How long an event may wait for a channel that fails. A late outage warning helps nobody. */
// Small events wait for the digest (every 6 hours), so they must not expire before it.
const MAX_WAIT = { stall: 1800, resume: 1800, summary: 6 * 3600, miner: 8 * 3600, node: 8 * 3600, 'hashrate-jump': 8 * 3600 };

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

let releaseCache = { at: 0, value: null };
async function latestRelease() {
  if (Date.now() - releaseCache.at < 30 * 60 * 1000) return releaseCache.value;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'quinvium-announcer' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) { const j = await r.json(); releaseCache.value = { tag: j.tag_name, name: j.name, url: j.html_url }; }
  } catch { /* GitHub unavailable: keep the last known release */ }
  releaseCache.at = Date.now();
  return releaseCache.value;
}

export async function snapshot() {
  const [stats, activity, miners, head, pools, release, recent, peers, hour, watch] = await Promise.all([
    rpc('aether_stats'), rpc('aether_activity'), rpc('aether_minerList', [{ limit: 1 }]),
    rpc('eth_getBlockByNumber', ['latest', false]), rpc('aether_pools', [{ limit: 200, seconds: 0 }]).catch(() => null), latestRelease(),
    rpc('aether_minerList', [{ limit: 50, order: 'last' }]).catch(() => null), rpc('aether_peers').catch(() => null),
    rpc('aether_minerShares', [{ from: Math.floor(Date.now() / 1000) - 3600, to: Math.floor(Date.now() / 1000) }]).catch(() => null),
    rpc('aether_watch').catch(() => null),
  ]);
  if (stats.network !== 'mainnet' && !env.ANNOUNCER_ANY_NETWORK) throw new Error(`RPC is on ${stats.network}, not mainnet`);
  return {
    height: stats.height, headTime: Number(BigInt(head.timestamp)), hashrate: Number(stats.hashrate), reward: stats.reward,
    halvingInterval: stats.halvingInterval, blockTime: stats.blockTimeTarget, supply: stats.supply,
    day: { blocks: activity.blocks, txs: activity.txs, miners: miners.active, avgBlockTime: activity.avgBlockTime },
    release, pools: pools ? pools.items.map((p) => ({ address: p.address, name: p.name, feeBps: p.feeBps })) : null,
    recentMiners: recent ? recent.items.map((m) => ({ address: m.address, first: m.first })) : null,
    // Only the node ID and version; the IP address never leaves this function.
    nodes: peers ? peers.filter((p) => p.id && p.verified).map((p) => ({ id: p.id, agent: p.agent })) : null,
    // The largest share of work in the last hour: over half means that one miner could rewrite recent blocks.
    // The node's watch: peers on another branch (by key, never by IP) and website or Explorer files that differ from GitHub.
    watch: watch ? {
      differ: watch.chain?.differ ?? 0, checked: watch.chain?.checked ?? 0, minority: !!watch.chain?.minority,
      incidents: (watch.chain?.incidents ?? []).map((i) => `${i.kind}:${i.at}`),
      sites: (watch.sites?.changed ?? []).map((c) => c.url),
    } : null,
    majority: hour?.work && hour.blocks >= 20 ? (() => { const top = [...hour.items].sort((a, b) => b.work - a.work)[0]; return top ? { address: top.address, share: top.work / hour.work, blocks: top.blocks, of: hour.blocks } : null; })() : null,
  };
}

function load() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; }
}
function save(state) {
  writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 1));
  renameSync(`${STATE}.tmp`, STATE);   // a crash in the middle never leaves a half-written state
}

const channels = DRY ? [telegram({}), x({})] : [
  telegram({ token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT || '@Quinvium' }),
  x({ apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET }),
];

export async function tick() {
  const now = Math.floor(Date.now() / 1000);
  let snap;
  try { snap = await snapshot(); } catch (e) { log('RPC unavailable, staying silent:', e.message); return; }
  let state = load();
  if (!state) { save(initialState(snap, now)); log(`first run at block ${snap.height}: history is not announced`); return; }
  const found = detect(state, snap, now);
  state = found.state;
  state.queue ??= [];
  for (const e of found.events) if (!state.queue.some((q) => q.key === e.key)) state.queue.push({ ...e, at: now, done: [] });
  // Telegram at most TELEGRAM_PER_HOUR messages an hour, and small events only as a digest every few hours.
  const hour = Math.floor(now / 3600);
  if (state.tgHour?.hour !== hour) state.tgHour = { hour, n: 0 };
  const left = () => TELEGRAM_PER_HOUR - state.tgHour.n;
  batchSmall(state, now);
  state.queue.sort((a, b) => (PRIORITY[a.kind] ?? 9) - (PRIORITY[b.kind] ?? 9));

  for (const q of state.queue) {
    for (const ch of channels) {
      if (!q.channels.includes(ch.name) || q.done.includes(ch.name)) continue;
      if (ch.name === 'telegram' && left() <= 0) continue;   // waits for the next hour
      if (ch.name === 'telegram' && MERGEABLE.has(q.kind) && !q.due) continue;   // waits for the next digest
      if (!allowed(state, ch.name, now)) { log(`${ch.name}: limit reached, ${q.key} skipped`); q.done.push(ch.name); continue; }
      try {
        await ch.send(ch.name === 'telegram' ? telegramMessage(q) : xMessage(q));
        if (!ch.dry) count(state, ch.name, now);
        if (ch.name === 'telegram') state.tgHour.n += 1;
        q.done.push(ch.name);
        log(`${ch.name}${ch.dry ? ' (dry run)' : ''}: ${q.key}`);
      } catch (err) {
        log(`${ch.name}: ${q.key} failed, will retry: ${err.message}`);
      }
      save(state);
    }
  }
  const keep = [];
  for (const q of state.queue) {
    if (q.channels.every((c) => q.done.includes(c))) state.sent[q.key] = now;
    else if (now - q.at > (MAX_WAIT[q.kind] ?? 24 * 3600)) { state.sent[q.key] = now; log(`${q.key} expired`); }
    else keep.push(q);
  }
  state.queue = keep;
  save(state);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  log(`announcer: ${RPC}, state ${STATE}, telegram ${channels[0].dry ? 'dry run' : 'live'}, x ${channels[1].dry ? 'dry run' : 'live'}`);
  await tick();
  let busy = false;   // a slow round must not overlap with the next one
  if (!args.has('--once')) setInterval(() => { if (busy) return; busy = true; tick().catch((e) => log('error:', e.message)).finally(() => { busy = false; }); }, INTERVAL);
}
