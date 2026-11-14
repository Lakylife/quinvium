// Recommended fees from recent blocks and the pending queue. Nothing is set by hand: the same computation applies
// for a small network with one miner and for a large network with pools, because it is based on what really happens in the network.
import { CONSENSUS as C, GWEI } from '../params.js';

export const FEE_WINDOW = 20;     // blocks, about 5 minutes; block time is measured over them
const RECENT_BLOCKS = 5;          // utilisation and prices: a sudden surge gets lost in the average of the whole window
const BUSY_RATIO = 0.5;           // above half a block the base fee starts rising, EIP-1559
const MAX_TIP = 500n * GWEI;      // one extreme fee must not drive the recommendation into nonsense

// headroom: by how many % the base fee may grow before a transaction starts waiting.
// blocks: estimated wait in a busy network.
const TIERS = {
  slow: { percentile: 25, floor: GWEI / 10n, headroom: 125n, blocks: 5 },
  normal: { percentile: 50, floor: GWEI, headroom: 150n, blocks: 2 },
  fast: { percentile: 90, floor: 2n * GWEI, headroom: 200n, blocks: 1 },
};

/** The tip that paid the given percentage of gas in a block. Cheap transactions with a lot of gas thus get the right weight. */
function tipAtPercentile(txs, percentile) {
  const sorted = [...txs].sort((a, b) => (a.tip < b.tip ? -1 : a.tip > b.tip ? 1 : 0));
  const total = sorted.reduce((sum, t) => sum + t.gas, 0n);
  const limit = (total * BigInt(percentile)) / 100n;
  let used = 0n;
  for (const t of sorted) {
    used += t.gas;
    if (used >= limit) return t.tip;
  }
  return sorted.at(-1).tip;
}

/** The tip that puts a transaction ahead of everything that does not fit into the given number of blocks. */
function tipToEnter(pending, capacity, blocks) {
  const sorted = [...pending].sort((a, b) => (a.tip > b.tip ? -1 : a.tip < b.tip ? 1 : 0));
  const room = capacity * BigInt(blocks);
  let used = 0n;
  for (const t of sorted) {
    used += t.gas;
    if (used >= room) return t.tip + t.tip / 10n + 1n;
  }
  return 0n;
}

const median = (list) => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[Math.floor(list.length / 2)];

/**
 * @param {object} o
 * @param {{ratio: number, time: number, txs: {tip: bigint, gas: bigint}[]}[]} o.blocks recent blocks, newest last
 * @param {bigint} o.baseFee base fee of the next block
 * @param {{tip: bigint, gas: bigint}[]} [o.pending] pending transactions that would fit into a block
 * @param {bigint} [o.capacity] gas jednoho bloku
 */
export function estimateFees({ blocks, baseFee, pending = [], capacity = C.genesisGasLimit }) {
  const recent = blocks.slice(-RECENT_BLOCKS);
  const fullness = recent.length ? recent.reduce((sum, b) => sum + b.ratio, 0) / recent.length : 0;
  const queued = pending.reduce((sum, t) => sum + t.gas, 0n);
  const congested = fullness >= BUSY_RATIO || queued >= capacity;
  const blockTime = blocks.length >= 2
    ? Math.max(1, (blocks.at(-1).time - blocks[0].time) / (blocks.length - 1))
    : C.targetBlockTime;
  const withTxs = recent.filter((b) => b.txs.length);

  const tiers = {};
  let previous = 0n;
  for (const [name, t] of Object.entries(TIERS)) {
    // While everything fits into a block there is nothing to compete for and the minimum is enough.
    const market = congested && withTxs.length ? median(withTxs.map((b) => tipAtPercentile(b.txs, t.percentile))) : 0n;
    let tip = t.floor;
    for (const need of [market, tipToEnter(pending, capacity, t.blocks), previous]) if (need > tip) tip = need;
    if (tip > MAX_TIP) tip = MAX_TIP;
    previous = tip;
    const waitBlocks = congested ? t.blocks : 1;
    tiers[name] = { tip, maxFee: (baseFee * t.headroom) / 100n + tip, blocks: waitBlocks, seconds: Math.round(waitBlocks * blockTime) };
  }
  return { baseFee, congested, fullness, blockTime, tiers };
}
