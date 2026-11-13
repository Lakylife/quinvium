// Doporučené poplatky: musí sedět v klidné i přetížené síti, při málo i hodně těžařích.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, bytesToHex } from '@ethereumjs/util';
import { estimateFees } from '../src/core/fees.js';
import { createMethods } from '../src/rpc/methods.js';
import { GWEI, WEI } from '../src/params.js';
import { mine, newChain, transfer, wallet } from './helpers/chain.js';

const block = (ratio, tips, time) => ({ ratio, time, txs: tips.map((t) => ({ tip: BigInt(t) * GWEI, gas: 21000n })) });
const series = (ratio, tips, n = 20, spacing = 15) => Array.from({ length: n }, (_, i) => block(ratio, tips, i * spacing));

test('klidná síť: stačí minimum a vše projde v dalším bloku', () => {
  const e = estimateFees({ blocks: series(0.1, [50, 60]), baseFee: GWEI });
  assert.equal(e.congested, false);
  assert.equal(e.tiers.slow.tip, GWEI / 10n);
  assert.equal(e.tiers.normal.tip, GWEI, 'cizí vysoké dýško v klidné síti nezdraží doporučení');
  assert.equal(e.tiers.fast.tip, 2n * GWEI);
  assert.equal(e.tiers.slow.blocks, 1);
});

test('vytížená síť: úrovně vycházejí ze skutečně placených dýšek', () => {
  const tips = [];
  for (let i = 1; i <= 100; i++) tips.push(i);
  const e = estimateFees({ blocks: series(0.9, tips), baseFee: 10n * GWEI });
  assert.equal(e.congested, true);
  assert.equal(e.tiers.slow.tip, 25n * GWEI);
  assert.equal(e.tiers.normal.tip, 50n * GWEI);
  assert.equal(e.tiers.fast.tip, 90n * GWEI);
  assert.ok(e.tiers.slow.blocks > e.tiers.normal.blocks && e.tiers.normal.blocks > e.tiers.fast.blocks);
  assert.ok(e.tiers.slow.maxFee < e.tiers.normal.maxFee && e.tiers.normal.maxFee < e.tiers.fast.maxFee);
});

test('úrovně jdou vždy vzestupně a extrémní dýško má strop', () => {
  const e = estimateFees({ blocks: series(0.9, [1, 100000]), baseFee: GWEI });
  assert.ok(e.tiers.slow.tip <= e.tiers.normal.tip && e.tiers.normal.tip <= e.tiers.fast.tip);
  assert.ok(e.tiers.fast.tip <= 500n * GWEI);
});

test('jedna transakce s velkým gasem má větší váhu než mnoho malých', () => {
  const big = { ratio: 0.9, time: 0, txs: [{ tip: 40n * GWEI, gas: 9_000_000n }, { tip: GWEI * 2n, gas: 21000n }, { tip: GWEI * 3n, gas: 21000n }] };
  const e = estimateFees({ blocks: [big, { ...big, time: 15 }], baseFee: GWEI });
  assert.equal(e.tiers.normal.tip, 40n * GWEI);
});

test('odhad čekání se řídí skutečnou dobou bloku, tedy počtem těžařů', () => {
  const few = estimateFees({ blocks: series(0.9, [5], 20, 120), baseFee: GWEI });
  const many = estimateFees({ blocks: series(0.9, [5], 20, 10), baseFee: GWEI });
  assert.equal(few.blockTime, 120);
  assert.equal(many.blockTime, 10);
  assert.equal(few.tiers.fast.seconds, 120);
  assert.equal(many.tiers.fast.seconds, 10);
});

test('náhlý nápor se pozná hned, ne až po průměru celého okna', () => {
  const blocks = [...series(0.02, [1], 16), ...series(1, [3], 4).map((b, i) => ({ ...b, time: (16 + i) * 15 }))];
  const e = estimateFees({ blocks, baseFee: GWEI });
  assert.equal(e.congested, true);
  assert.equal(e.tiers.normal.tip, 3n * GWEI);
});

test('fronta delší než blok: doporučení ji předběhne dřív, než se bloky zaplní', () => {
  const pending = Array.from({ length: 1800 }, () => ({ tip: GWEI, gas: 21000n }));
  const e = estimateFees({ blocks: series(0.01, [1]), baseFee: GWEI, pending, capacity: 10_000_000n });
  assert.equal(e.congested, true);
  assert.ok(e.tiers.fast.tip > GWEI, 'rychlá platba předběhne čekající');
  assert.ok(e.tiers.normal.tip > GWEI, 'do dvou bloků se také musí předběhnout');
  assert.equal(e.tiers.fast.blocks, 1);
  assert.equal(e.tiers.slow.blocks, 5);
});

test('fronta kratší než blok na nic netlačí a zaplacené dýško v ní nevadí', () => {
  const pending = Array.from({ length: 100 }, () => ({ tip: 50n * GWEI, gas: 21000n }));
  const e = estimateFees({ blocks: series(0.01, [1]), baseFee: GWEI, pending, capacity: 10_000_000n });
  assert.equal(e.congested, false);
  assert.equal(e.tiers.normal.tip, GWEI);
});

test('dvě vrstvy fronty: rychlá úroveň platí horní, běžná spodní', () => {
  const pending = [
    ...Array.from({ length: 500 }, () => ({ tip: 10n * GWEI, gas: 21000n })),
    ...Array.from({ length: 500 }, () => ({ tip: 3n * GWEI, gas: 21000n })),
  ];
  const e = estimateFees({ blocks: series(0.01, [1]), baseFee: GWEI, pending, capacity: 10_000_000n });
  assert.ok(e.tiers.fast.tip > 10n * GWEI);
  assert.ok(e.tiers.normal.tip > 3n * GWEI && e.tiers.normal.tip < 10n * GWEI);
});

test('prázdný řetězec dá rozumné výchozí hodnoty', () => {
  const e = estimateFees({ blocks: [], baseFee: GWEI });
  assert.equal(e.tiers.normal.tip, GWEI);
  assert.equal(e.blockTime, 15);
});

test('skutečný mempool: čekající platby zvednou doporučení ještě před dalším blokem', async () => {
  const senders = Array.from({ length: 30 }, () => wallet());
  const alloc = Object.fromEntries(senders.map((w) => [bytesToHex(w.address), { balance: 10n * WEI }]));
  const c = await newChain({ alloc });
  const { methods } = createMethods({ chain: c, mempool: c.mempool, network: null, work: null, version: 'x' });
  const to = new Address(wallet().address);
  assert.equal(methods.aether_feeEstimates().congested, false);
  for (const s of senders) {
    for (let n = 0n; n < 40n; n++) await c.mempool.add(transfer(c, s, to, 1n, n, { tip: GWEI, fee: 50n * GWEI }));
  }
  const busy = methods.aether_feeEstimates();
  assert.equal(busy.congested, true);
  assert.ok(BigInt(busy.tiers.fast.tip) > GWEI);
  assert.equal(BigInt(methods.eth_maxPriorityFeePerGas()), BigInt(busy.tiers.normal.tip));
});

test('skutečný řetězec: plné bloky zdraží doporučení, prázdné ho vrátí zpět', async () => {
  const senders = Array.from({ length: 300 }, () => wallet());
  const alloc = Object.fromEntries(senders.map((w) => [bytesToHex(w.address), { balance: 10n * WEI }]));
  const c = await newChain({ alloc });
  const { methods } = createMethods({ chain: c, mempool: c.mempool, network: null, work: null, version: 'x' });
  const to = new Address(wallet().address);

  const quiet = methods.aether_feeEstimates();
  assert.equal(quiet.congested, false);
  assert.equal(BigInt(methods.eth_maxPriorityFeePerGas()), GWEI);

  // Bloky plné z 60 % s dýškem 7 gwei. Základní poplatek roste, doporučení ho následuje.
  let used = 0;
  for (let round = 0; round < 6; round++) {
    const txs = [];
    for (let i = 0; i < 286; i++) txs.push(transfer(c, senders[used % senders.length], to, 1n, BigInt(Math.floor(used / senders.length)), { tip: 7n * GWEI, fee: 30n * GWEI })), used += 1;
    await mine(c, { txs });
  }
  const busy = methods.aether_feeEstimates();
  assert.equal(busy.congested, true);
  assert.equal(BigInt(busy.tiers.normal.tip), 7n * GWEI);
  assert.equal(BigInt(methods.eth_maxPriorityFeePerGas()), 7n * GWEI);
  assert.ok(BigInt(busy.baseFee) > GWEI, 'základní poplatek vyrostl');
  assert.equal(BigInt(methods.eth_gasPrice()), BigInt(busy.baseFee) + 7n * GWEI);

  for (let i = 0; i < 20; i++) await mine(c);
  const calm = methods.aether_feeEstimates();
  assert.equal(calm.congested, false);
  assert.equal(BigInt(calm.tiers.normal.tip), GWEI, 'po uklidnění doporučení kleslo');
  assert.ok(BigInt(calm.baseFee) < BigInt(busy.baseFee), 'základní poplatek klesl');
});
