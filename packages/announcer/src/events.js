// Decides what is worth announcing. Pure functions: the input is a snapshot of the chain and the saved state,
// the output is a list of events and the new state. Nothing here talks to the network, so it can be tested exactly.

export const DAY = 86400;
export const WEEK = 7 * DAY;
const NODE_MEMORY = 2000;   // remembered node IDs
/** Week number, weeks start on Monday (1 January 1970 was a Thursday). */
const weekOf = (t) => Math.floor((t - 4 * DAY) / WEEK);

/** Heights worth a post. After 1 million every further million. */
export function milestonesUpTo(height) {
  const fixed = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 750_000, 1_000_000];
  const out = fixed.filter((m) => m <= height);
  for (let m = 2_000_000; m <= height; m += 1_000_000) out.push(m);
  return out;
}

const QU = (wei) => Number(BigInt(wei) / 10n ** 14n) / 1e4;   // 4 decimal places are enough for a post

/** The first run only remembers the current situation; it must not announce the whole history at once. */
export function initialState(snap, now) {
  return {
    version: 1,
    sent: Object.fromEntries([
      ...milestonesUpTo(snap.height).map((m) => `milestone:${m}`),
      ...Array.from({ length: Math.floor(snap.height / snap.halvingInterval) }, (_, i) => `halving:${i + 1}:done`),
    ].map((k) => [k, now])),
    hashrateRecord: snap.hashrate,
    hashrateAnnounced: 0,
    halvingNotices: {},
    lastSummaryDay: Math.floor(now / DAY),
    release: snap.release ?? null,
    pools: snap.pools ?? [],
    stalledSince: null,
    counts: {},
    minerHeight: snap.height,           // miners whose first block is above this height are new
    nodes: (snap.nodes ?? []).map((n) => n.id).filter(Boolean).slice(0, NODE_MEMORY),
    hashrateBase: snap.hashrate,
    jumpAnnounced: 0,
    weekMiners: 0,
    lastWeek: weekOf(now),
  };
}

/**
 * @param {object} state saved state (see initialState)
 * @param {object} snap {height, headTime, hashrate, reward, halvingInterval, blockTime, supply, day:{blocks,txs,miners}, release, pools:[{address,name}]}
 * @param {number} now unix seconds
 */
export function detect(state, snap, now, { stallAfter = 600, summaryHour = 12 } = {}) {
  const s = structuredClone(state);
  const events = [];
  const add = (key, kind, data, channels) => { if (!s.sent[key]) events.push({ key, kind, data, channels }); };

  // (e) The network stops producing blocks: Telegram only, once per outage, and once when it runs again.
  const age = now - snap.headTime;
  if (age >= stallAfter && s.stalledSince == null) {
    s.stalledSince = snap.headTime;
    add(`stall:${snap.height}`, 'stall', { height: snap.height, minutes: Math.floor(age / 60) }, ['telegram']);
  } else if (age < stallAfter && s.stalledSince != null) {
    const minutes = Math.round((snap.headTime - s.stalledSince) / 60);
    s.stalledSince = null;
    add(`resume:${snap.height}`, 'resume', { height: snap.height, minutes }, ['telegram']);
  }

  // (b) Height milestones.
  for (const m of milestonesUpTo(snap.height)) add(`milestone:${m}`, 'milestone', { height: m, supply: QU(snap.supply), hashrate: snap.hashrate }, ['telegram', 'x']);

  // (b) Hashrate record: at least 20 % above the last record and at most once a week.
  if (snap.hashrate > s.hashrateRecord) {
    const announcedAt = s.hashrateAnnounced || 0;
    if (snap.hashrate >= s.hashrateRecord * 1.2 && now - announcedAt >= 7 * DAY) {
      add(`hashrate:${Math.floor(now / DAY)}`, 'hashrate', { hashrate: snap.hashrate, previous: s.hashrateRecord }, ['telegram', 'x']);
      s.hashrateAnnounced = now;
      s.hashrateRecord = snap.hashrate;
    } else if (now - announcedAt >= 7 * DAY) {
      s.hashrateRecord = Math.max(s.hashrateRecord, snap.hashrate);
    }
  }

  // (c) Halving: 30, 7 and 1 day before, and on the day it happens.
  const era = Math.floor(snap.height / snap.halvingInterval);
  const nextAt = (era + 1) * snap.halvingInterval;
  const daysLeft = ((nextAt - snap.height) * snap.blockTime) / DAY;
  for (const d of [30, 7, 1]) {
    if (daysLeft <= d && daysLeft > (d === 1 ? 0 : d === 7 ? 1 : 7)) add(`halving:${era + 1}:${d}d`, 'halving-soon', { number: era + 1, block: nextAt, days: d, blocksLeft: nextAt - snap.height, reward: QU(snap.reward), eta: Math.round(now + (nextAt - snap.height) * snap.blockTime) }, ['telegram', 'x']);
  }
  if (era >= 1) add(`halving:${era}:done`, 'halving', { number: era, block: era * snap.halvingInterval, reward: QU(snap.reward) }, ['telegram', 'x']);

  // (a) Daily summary once per UTC day, after the given hour.
  const today = Math.floor(now / DAY);
  if (today > s.lastSummaryDay && (now % DAY) >= summaryHour * 3600 && snap.day) {
    add(`summary:${today}`, 'summary', {
      time: now - DAY, height: snap.height, blocks: snap.day.blocks, avgBlockTime: snap.day.avgBlockTime, minted: QU(BigInt(snap.reward) * BigInt(snap.day.blocks)),
      hashrate: snap.hashrate, miners: snap.day.miners, txs: snap.day.txs, supply: QU(snap.supply),
    }, ['telegram', 'x']);
    s.lastSummaryDay = today;
  }

  // (d) New release on GitHub.
  if (snap.release && snap.release.tag !== s.release?.tag) {
    if (s.release) add(`release:${snap.release.tag}`, 'release', snap.release, ['telegram', 'x']);
    s.release = snap.release;
  }

  // (f) New mining pool (Telegram only, it is a small event).
  if (Array.isArray(snap.pools)) {
    const known = new Set(s.pools.map((p) => p.address.toLowerCase()));
    for (const p of snap.pools) if (!known.has(p.address.toLowerCase())) add(`pool:${p.address.toLowerCase()}`, 'pool', p, ['telegram', 'x']);
    s.pools = snap.pools;
  }
  // New miner: the first block of an address that has never mined before. Telegram only; many at once are merged later.
  if (Array.isArray(snap.recentMiners)) {
    s.minerHeight ??= snap.height;
    for (const m of snap.recentMiners) {
      if (m.first > s.minerHeight) { add(`miner:${m.address.toLowerCase()}`, 'miner', { address: m.address, block: m.first }, ['telegram']); s.weekMiners = (s.weekMiners ?? 0) + 1; }
    }
    s.minerHeight = Math.max(s.minerHeight, snap.height);
  }

  // New node: identified by its node ID only, never by IP address. Telegram only.
  if (Array.isArray(snap.nodes)) {
    const known = new Set(s.nodes ?? []);
    for (const n of snap.nodes) if (n.id && !known.has(n.id)) { add(`node:${n.id}`, 'node', { id: n.id, agent: n.agent }, ['telegram']); known.add(n.id); }
    s.nodes = [...known].slice(-NODE_MEMORY);
  }

  // A sharp rise of the hashrate against its slow average (half-life of about a day): Telegram, at most every 6 hours.
  const base = s.hashrateBase ?? snap.hashrate;
  if (base > 0 && snap.hashrate >= base * 1.5 && now - (s.jumpAnnounced ?? 0) >= 6 * 3600) {
    add(`jump:${Math.floor(now / 3600)}`, 'hashrate-jump', { hashrate: snap.hashrate, base }, ['telegram']);
    s.jumpAnnounced = now;
  }
  s.hashrateBase = base + (snap.hashrate - base) * 0.0005;   // one sample a minute

  // One address with more than half of the work in the last hour (Telegram only, at most every 6 hours, and once when it is over).
  if (snap.majority) {
    const m = snap.majority;
    if (m.share > 0.5 && !s.majorityActive && now - (s.majorityAnnounced ?? 0) >= 6 * 3600) {
      add(`majority:${Math.floor(now / 3600)}`, 'majority', m, ['telegram']);
      s.majorityActive = true;
      s.majorityAnnounced = now;
    } else if (m.share < 0.45 && s.majorityActive) {
      add(`majority-end:${Math.floor(now / 3600)}`, 'majority-end', m, ['telegram']);
      s.majorityActive = false;
    }
  }

  // Weekly summary of new miners, Monday after the summary hour: Telegram and X.
  const week = weekOf(now);
  s.lastWeek ??= week;
  if (week > s.lastWeek && (now % DAY) >= summaryHour * 3600) {
    if (s.weekMiners > 0) add(`week:${week}`, 'week', { miners: s.weekMiners }, ['telegram', 'x']);
    s.weekMiners = 0;
    s.lastWeek = week;
  }
  return { events, state: s };
}

/** Free-tier limits plus our own: X at most 2 posts a day and 50 a month, Telegram at most 20 a day. */
export const LIMITS = { x: { day: 2, month: 50 }, telegram: { day: 20, month: 600 } };

export function allowed(state, channel, now, limits = LIMITS) {
  const d = new Date(now * 1000);
  const day = d.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const c = state.counts?.[channel] ?? {};
  return (c.day === day ? c.dayN : 0) < limits[channel].day && (c.month === month ? c.monthN : 0) < limits[channel].month;
}

export function count(state, channel, now) {
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  state.counts ??= {};
  const c = state.counts[channel] ?? {};
  state.counts[channel] = {
    day, dayN: (c.day === day ? c.dayN : 0) + 1,
    month, monthN: (c.month === month ? c.monthN : 0) + 1,
  };
}

/** The more important event wins when the X budget is tight. */
export const PRIORITY = { majority: 0, 'majority-end': 1, halving: 0, 'halving-soon': 1, release: 2, milestone: 3, hashrate: 4, pool: 4, week: 5, summary: 5, stall: 6, resume: 6, 'hashrate-jump': 7, miner: 8, node: 8, digest: 8 };

/** Telegram at most this many messages an hour; small events above it are merged into one digest. */
export const TELEGRAM_PER_HOUR = 5;
export const MERGEABLE = new Set(['miner', 'node', 'hashrate-jump']);
