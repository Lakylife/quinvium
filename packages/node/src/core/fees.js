// Doporučené poplatky z posledních bloků a čekající fronty. Nic se nenastavuje ručně: stejný výpočet platí
// pro malou síť s jedním těžařem i pro velkou síť s pooly, protože vychází z toho, co se v síti opravdu děje.
import { CONSENSUS as C, GWEI } from '../params.js';

export const FEE_WINDOW = 20;     // bloků, asi 5 minut, podle nich se měří doba bloku
const RECENT_BLOCKS = 5;          // zaplnění a ceny: náhlý nápor se v průměru celého okna ztratí
const BUSY_RATIO = 0.5;           // od poloviny bloku začíná růst základní poplatek, EIP-1559
const MAX_TIP = 500n * GWEI;      // jeden extrémní poplatek nesmí vyhnat doporučení do nesmyslu

// headroom: o kolik % smí vyrůst základní poplatek, než transakce začne čekat.
// blocks: odhad čekání ve vytížené síti.
const TIERS = {
  slow: { percentile: 25, floor: GWEI / 10n, headroom: 125n, blocks: 5 },
  normal: { percentile: 50, floor: GWEI, headroom: 150n, blocks: 2 },
  fast: { percentile: 90, floor: 2n * GWEI, headroom: 200n, blocks: 1 },
};

/** Dýško, které v bloku zaplatila dané procento gasu. Levné transakce s velkým gasem tak mají správnou váhu. */
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

/** Dýško, kterým se transakce dostane před všechno, co se nevejde do daného počtu bloků. */
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
 * @param {{ratio: number, time: number, txs: {tip: bigint, gas: bigint}[]}[]} o.blocks poslední bloky, nejnovější na konci
 * @param {bigint} o.baseFee základní poplatek příštího bloku
 * @param {{tip: bigint, gas: bigint}[]} [o.pending] čekající transakce, které by se do bloku vešly
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
    // Dokud se všechno vejde do bloku, není za co soutěžit a stačí minimum.
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
