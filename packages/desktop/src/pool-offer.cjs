// A small miner who mines solo may wait weeks for a block. After a few minutes of solo mining the app compares its hashrate
// with the whole network and, below 1 %, offers the official pool: small regular payouts instead of rare whole blocks.
// The offer comes once per mining session and never again after "Do not ask again". Nothing switches without the user's click.

/** Pools the app may offer, per network. The address is checked against the network's pool factory before the offer. */
const OFFICIAL_POOLS = {
  mainnet: { address: '0xd7B63BCE0E77E0e53D7309e7E64cA4346e0dF5c8', url: 'https://pool.quinvium.com', name: 'Quinvium Pool' },
};
const WARMUP_MS = 3 * 60_000;     // the DAG is ready and the hashrate has settled
const MIN_SAMPLES = 3;
const SMALL_SHARE = 0.01;

/**
 * Whether to offer the pool now. Returns { pool, share, rate } or null.
 * @param {object} o
 * @param {string} o.network the running network
 * @param {object|null} o.pool the pool the miner uses now (null = solo)
 * @param {boolean} o.off the user chose "Do not ask again"
 * @param {boolean} o.offered already offered in this mining session
 * @param {number} o.startedAt when mining started (ms)
 * @param {number} o.now
 * @param {number[]} o.rates the miner's recent hashrate samples (H/s)
 * @param {number} o.networkHashrate the whole network (H/s)
 */
function poolOfferDue({ network, pool, off, offered, startedAt, now, rates, networkHashrate }) {
  const official = OFFICIAL_POOLS[network];
  if (!official || pool || off || offered) return null;
  if (!startedAt || now - startedAt < WARMUP_MS) return null;
  const recent = (rates ?? []).filter((r) => Number.isFinite(r) && r > 0).slice(-10);
  if (recent.length < MIN_SAMPLES || !(networkHashrate > 0)) return null;
  const rate = recent.reduce((a, b) => a + b, 0) / recent.length;
  const share = rate / networkHashrate;
  return share < SMALL_SHARE ? { pool: official, share, rate } : null;
}

module.exports = { OFFICIAL_POOLS, WARMUP_MS, SMALL_SHARE, poolOfferDue };
