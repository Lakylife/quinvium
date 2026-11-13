import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@ethereumjs/util';
import { blockReward, nextBaseFee, nextGasLimit, gasLimitValid } from '../src/core/economics.js';
import { nextDifficulty } from '../src/core/difficulty.js';
import { CONSENSUS as C, GWEI, WEI, NETWORKS } from '../src/params.js';
import { newChain, wallet, mine, mineMany, transfer, legacy, seal, tmpData } from './helpers/chain.js';
import { Chain } from '../src/core/chain.js';
import { Block, Header } from '../src/core/types.js';

const balance = async (c, addr) => {
  const s = await c.stateAt(c.head.stateRoot);
  return (await s.stateManager.getAccount(new Address(addr)))?.balance ?? 0n;
};
const fund = (w, amount = 100n * WEI) => ({ [`0x${Buffer.from(w.address).toString('hex')}`]: { balance: amount } });

test('emise: 4 QU, půlení po 8 milionech bloků, strop 64 milionů', () => {
  assert.equal(blockReward(0), 0n);
  assert.equal(blockReward(1), 4n * WEI);
  assert.equal(blockReward(8_000_000), 4n * WEI);
  assert.equal(blockReward(8_000_001), 2n * WEI);
  assert.equal(blockReward(16_000_001), WEI);
  assert.equal(blockReward(8_000_000n * 64n + 1n), 0n);
  let total = 0n;
  for (let i = 0n; i < 64n; i++) total += (C.initialReward >> i) * C.halvingInterval;
  assert.ok(total <= C.maxSupply && C.maxSupply - total < 10n ** 12n, `celkem ${total}`);
});

test('base fee: růst, pokles a spodní mez', () => {
  const p = (gasUsed, baseFee = 100n * GWEI) => ({ gasLimit: 15_000_000n, gasUsed, baseFee });
  assert.equal(nextBaseFee(p(7_500_000n)), 100n * GWEI);
  assert.equal(nextBaseFee(p(15_000_000n)), 112_500_000_000n);
  assert.equal(nextBaseFee(p(0n)), 87_500_000_000n);
  assert.equal(nextBaseFee(p(0n, GWEI)), GWEI);
});

test('limit gasu se mění jen po malých krocích', () => {
  const cap = 15_000_000n;
  assert.ok(gasLimitValid(10_000_000n, 10_000_000n, cap));
  assert.ok(!gasLimitValid(11_000_000n, 10_000_000n, cap));
  const next = nextGasLimit(10_000_000n, 30_000_000n);
  assert.ok(next > 10_000_000n && gasLimitValid(next, 10_000_000n, cap));
  assert.ok(!gasLimitValid(cap + 1n, cap, cap), 'strop hlasování minerů');
});

test('LWMA: rychlé bloky zvyšují obtížnost, pomalé ji snižují', () => {
  const net = { genesisDifficulty: 1000n, minDifficulty: 1n };
  const series = (solve, n = 70) => {
    const list = [];
    for (let i = 0; i <= n; i++) list.push({ number: BigInt(i), timestamp: BigInt(i * solve), difficulty: 1000n, parentHash: i ? `h${i - 1}` : null, id: `h${i}` });
    const by = Object.fromEntries(list.map((h) => [h.id, h]));
    return nextDifficulty(list[n], (id) => by[id], net);
  };
  assert.equal(series(15), 1000n);
  assert.ok(series(5) > 2500n, `rychlé: ${series(5)}`);
  assert.ok(series(45) < 400n, `pomalé: ${series(45)}`);
  assert.equal(series(1000), 25n, 'doba bloku se počítá nejvýš jako 40násobek cíle');
});

test('těžba vyplatí odměnu a řetězec se uloží', async () => {
  const c = await newChain();
  const m = wallet();
  const { res } = await mine(c, { miner: m.address });
  assert.equal(res.status, 'added');
  assert.equal(c.head.number, 1n);
  assert.equal(await balance(c, m.address), 4n * WEI);
});

test('převod: těžař dostane základní poplatek i dýško, nic se nepálí', async () => {
  const a = wallet(); const b = wallet(); const m = wallet();
  const c = await newChain({ alloc: fund(a) });
  const tx = transfer(c, a, new Address(b.address), 10n * WEI, 0n, { tip: GWEI, fee: 5n * GWEI });
  await mine(c, { miner: m.address, txs: [tx] });
  assert.equal(c.head.gasUsed, 21000n);
  assert.equal(await balance(c, b.address), 10n * WEI);
  assert.equal(await balance(c, m.address), 4n * WEI + 21000n * 2n * GWEI, 'odměna a celý poplatek');
  assert.equal(await balance(c, a.address), 100n * WEI - 10n * WEI - 21000n * 2n * GWEI);
  const r = c.getReceipts(c.head.hash());
  assert.equal(r.receipts.length, 1);
});

test('stav přežije zavření a znovuotevření databáze', async () => {
  const dir = tmpData();
  const a = wallet(); const m = wallet();
  const net = NETWORKS.dev;
  const open = async () => {
    let clock = Number(net.genesisTimestamp) + 3000;
    const chain = await Chain.open({ network: net, dataDir: dir, powDir: undefined, alloc: fund(a), now: () => clock });
    chain.tick = () => { clock += 15; };
    return chain;
  };
  let c = await open();
  await mineMany(c, 3, { miner: m.address });
  const head = c.head.hash();
  await c.close();
  c = await open();
  assert.deepEqual(c.head.hash(), head);
  assert.equal(await balance(c, m.address), 12n * WEI);
  await c.close();
});

test('databáze jiné sítě se odmítne otevřít', async () => {
  const dir = tmpData();
  const c = await Chain.open({ network: NETWORKS.dev, dataDir: dir });
  await c.close();
  await assert.rejects(Chain.open({ network: NETWORKS.testnet, dataDir: dir }), /jiné síti/);
});

// ---- bezpečnostní pravidla bloku -------------------------------------------------

const tamper = async (c, patch) => {
  c.tick();
  const t = await c.buildTemplate({ miner: new Uint8Array(20).fill(1) });
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  return new Block(new Header({ ...f, ...patch }), t.txs);
};

for (const [name, patch, re] of [
  ['špatný kořen stavu', { stateRoot: new Uint8Array(32).fill(7) }, /kořen stavu/],
  ['špatný kořen transakcí', { txRoot: new Uint8Array(32).fill(7) }, /kořen transakcí/],
  ['špatný kořen účtenek', { receiptsRoot: new Uint8Array(32).fill(7) }, /kořen účtenek/],
  ['vymyšlený base fee', { baseFee: 999n * GWEI }, /base fee/],
  ['vymyšlený gas limit', { gasLimit: 100_000_000n }, /gasLimit/],
  ['příliš nízká obtížnost', { difficulty: 2n }, /obtížnost/],
  ['gasUsed nad limitem', { gasUsed: 30_000_000n }, /gasUsed/],
  ['příliš dlouhé extraData', { extraData: new Uint8Array(33) }, /extraData/],
]) {
  test(`blok je odmítnut: ${name}`, async () => {
    const c = await newChain();
    await mine(c);
    await assert.rejects(c.insertBlock(await seal(c, await tamper(c, patch))), re);
    assert.equal(c.head.number, 1n);
  });
}

test('blok bez platného PoW je odmítnut', async () => {
  const c = await newChain();
  await assert.rejects(c.insertBlock(await tamper(c, {})), /Proof of Work|obtížnost/);
});

test('čas bloku musí růst a nesmí být příliš v budoucnosti', async () => {
  const c = await newChain();
  await mine(c);
  await assert.rejects(c.insertBlock(await seal(c, await tamper(c, { timestamp: c.head.timestamp }))), /čas bloku/);
  await assert.rejects(c.insertBlock(await seal(c, await tamper(c, { timestamp: BigInt(c.now() + 1000) }))), /budoucnosti/);
});

test('blok s neplatnou transakcí je neplatný celý', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a, 10n ** 15n) });
  c.tick();
  const t = await c.buildTemplate({ miner: b.address });
  const bad = transfer(c, a, new Address(b.address), 50n * WEI, 0n); // nemá prostředky
  const { orderedRoot } = await import('../src/core/executor.js');
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  const forged = new Block(new Header({ ...f, txRoot: await orderedRoot([bad.serialize()], c.common) }), [bad]);
  await assert.rejects(c.insertBlock(await seal(c, forged)), /neplatná transakce/);
});

test('neplatnou transakci v bloku pozná vlastní kontrola, ne text chyby knihovny', async () => {
  const { orderedRoot, txRejection } = await import('../src/core/executor.js');
  const a = wallet(); const b = wallet(); const k = wallet();
  const contractKey = `0x${Buffer.from(k.address).toString('hex')}`;
  const c = await newChain({ alloc: { ...fund(a, 10n * WEI), [contractKey]: { balance: 10n * WEI, code: '0x00' } } });
  const to = new Address(b.address);
  const forge = async (tx) => {
    c.tick();
    const t = await c.buildTemplate({ miner: b.address });
    const f = Object.fromEntries(Object.entries(t.header).filter(([key]) => !key.startsWith('_')));
    return seal(c, new Block(new Header({ ...f, txRoot: await orderedRoot([tx.serialize()], c.common) }), [tx]));
  };
  const cases = [
    [transfer(c, a, to, 1n, 5n), /špatné nonce/],
    [transfer(c, a, to, 50n * WEI, 0n), /nedostatek prostředků/],
    [transfer(c, a, to, 1n, 0n, { fee: GWEI / 2n, tip: 1n }), /základní poplatek bloku/],
    [legacy(c, a, to, 1n, 0n, { gasPrice: GWEI / 2n }), /základní poplatek bloku/],
    [transfer(c, a, to, 1n, 0n, { gas: 20_000n }), /základní cena transakce/],
    [transfer(c, k, to, 1n, 0n), /EIP-3607/],
  ];
  for (const [tx, reason] of cases) {
    const block = await forge(tx);
    await assert.rejects(c.insertBlock(block), reason);
    assert.match(c.store.badReason(block.hash()) ?? '', reason, 'blok je označený jako neplatný');
  }
  // Platná transakce důvod nemá: kdyby ji knihovna odmítla, je to chyba uzlu a blok se neoznačí.
  const state = await c.stateAt(c.head.stateRoot);
  assert.equal(await txRejection(transfer(c, a, to, 1n, 0n), state.stateManager, nextBaseFee(c.head)), null);
  assert.equal((await mine(c, { txs: [transfer(c, a, to, 1n, 0n)] })).res.status, 'added');
});

test('transakce z jiné sítě ani bez chainId neprojde', async () => {
  const a = wallet();
  const c = await newChain({ alloc: fund(a) });
  const other = await newChain({ network: NETWORKS.testnet });
  const foreign = transfer(other, a, new Address(a.address), 1n, 0n);
  assert.throws(() => Block.decode(new Block(c.head, [foreign]).encode(), c.common), /chain ID|chainId|Invalid/i);
});

// ---- forky -----------------------------------------------------------------------

async function twin(alloc) {
  const x = await newChain({ alloc }); const y = await newChain({ alloc });
  return [x, y];
}

test('těžší větev vyhraje, stav se vrátí a transakce jdou zpět do fronty', async () => {
  const a = wallet(); const shop = wallet(); const other = wallet();
  const [x, y] = await twin(fund(a));
  const pay = transfer(x, a, new Address(shop.address), 50n * WEI, 0n);
  await mine(x, { txs: [pay] });
  assert.equal(await balance(x, shop.address), 50n * WEI);

  const spend = transfer(y, a, new Address(other.address), 50n * WEI, 0n);
  const one = await mine(y, { txs: [spend] });
  const two = await mine(y);
  x.setClock(y.now());
  assert.equal((await x.insertBlock(one.block)).status, 'side');
  const r = await x.insertBlock(two.block);
  assert.equal(r.status, 'reorg');
  assert.equal(r.depth, 1);
  assert.deepEqual(x.head.hash(), y.head.hash());
  assert.equal(await balance(x, shop.address), 0n);
  assert.equal(await balance(x, other.address), 50n * WEI);
  assert.deepEqual(x.head.stateRoot, y.head.stateRoot);
  assert.equal(x.store.txLocation(pay.hash()), null, 'index transakcí se vrátil');
  assert.ok(x.store.txLocation(spend.hash()));
});

test('oba uzly skončí stejně při libovolném pořadí bloků', async () => {
  const a = wallet(); const m1 = wallet(); const m2 = wallet();
  const [x, y] = await twin(fund(a));
  const b1 = (await mine(x, { miner: m1.address })).block;
  const c1 = (await mine(y, { miner: m2.address })).block;
  const c2 = (await mine(y, { miner: m2.address })).block;
  const [p, q] = await twin(fund(a));
  p.setClock(y.now()); q.setClock(y.now());
  for (const b of [b1, c1, c2]) await p.insertBlock(b);
  for (const b of [c1, c2, b1]) await q.insertBlock(b);
  assert.deepEqual(p.head.hash(), q.head.hash());
  assert.deepEqual(p.head.stateRoot, q.head.stateRoot);
});

test('blok bez rodiče stav nemění', async () => {
  const [x, y] = await twin({});
  const m = wallet();
  await mine(y);
  const orphan = (await mine(y, { miner: m.address })).block;
  x.setClock(y.now());
  assert.equal((await x.insertBlock(orphan)).status, 'orphan');
  assert.equal(await balance(x, m.address), 0n);
  assert.equal(x.head.number, 0n);
});

test('neplatná těžší větev se odmítne a řetězec zůstane nedotčený', async () => {
  const a = wallet();
  const [x, y] = await twin(fund(a));
  await mine(x);
  const head = x.head.hash();
  const good = (await mine(y)).block;
  y.tick();
  const t = await y.buildTemplate({ miner: new Uint8Array(20).fill(9) });
  const f = Object.fromEntries(Object.entries(t.header).filter(([k]) => !k.startsWith('_')));
  const bad = await seal(y, new Block(new Header({ ...f, stateRoot: new Uint8Array(32).fill(1) }), []));
  x.setClock(y.now());
  await x.insertBlock(good);
  await assert.rejects(x.insertBlock(bad), /kořen stavu/);
  assert.deepEqual(x.head.hash(), head);
  await assert.rejects(x.insertBlock(bad), /dříve odmítnutý/);
});

test('rolling finality: přepis hlubší než limit síť odmítne i při větší práci', async () => {
  const [x, y] = await twin({});
  const attacker = wallet();
  await mineMany(x, C.maxReorgDepth + 2);
  const blocks = [];
  for (let i = 0; i < C.maxReorgDepth + 10; i++) blocks.push((await mine(y, { miner: attacker.address })).block);
  x.setClock(y.now());
  const head = x.head.hash();
  let refused = 0;
  for (const b of blocks) {
    try {
      const r = await x.insertBlock(b);
      assert.ok(r.status === 'orphan' || r.status === 'side');
    } catch (e) {
      assert.match(e.message, /finality/);
      refused += 1;
    }
  }
  assert.ok(refused >= 1);
  assert.deepEqual(x.head.hash(), head, 'řetězec zůstal na původní větvi');
  assert.equal(await balance(x, attacker.address), 0n);
});

/** Větev s rychlými časy bloků: LWMA zvedne obtížnost, takže nese víc práce na blok. */
async function heavyBranch(chain, minTd, maxBlocks = 400) {
  const blocks = [];
  while (chain.headTd < minTd && blocks.length < maxBlocks) blocks.push((await mine(chain, { step: 1, miner: new Uint8Array(20).fill(7) })).block);
  assert.ok(chain.headTd >= minTd, `větev má jen ${chain.headTd} práce`);
  return blocks;
}

test('hluboká větev: bez ověření sítí se odmítne, s dvojnásobnou prací přepíše řetězec', async () => {
  const [x, y] = await twin({});
  await mineMany(x, C.maxReorgDepth + 4);
  const ours = x.headTd - x.genesis.difficulty;
  const blocks = await heavyBranch(y, x.genesis.difficulty + 2n * ours + 50n);
  x.setClock(Math.max(x.now(), y.now()));
  const head = x.head.hash();

  // Bez povolení: první blok větve leží pod hranicí finality.
  await assert.rejects(x.insertBlock(blocks[0]), /finality/);
  assert.deepEqual(x.head.hash(), head);

  // Síť ověřila hlavičky a povolila větev od genesis. Přepis proběhne až s dvojnásobkem práce.
  x.permitDeepFork(x.genesis);
  let switched = null;
  for (const [i, b] of blocks.entries()) {
    const r = await x.insertBlock(b);
    if (r.status === 'reorg') { switched = i; break; }
  }
  assert.notEqual(switched, null, 'řetězec přešel na těžší větev');
  const base = x.genesis.difficulty;
  assert.ok(x.headTd - base >= 2n * ours, 'přechod až s dvojnásobkem práce');
  for (const b of blocks.slice(switched + 1)) await x.insertBlock(b);
  assert.deepEqual(x.head.hash(), y.head.hash());
});

test('hluboká větev s menší než dvojnásobnou prací zůstane postranní i s povolením', async () => {
  const [x, y] = await twin({});
  await mineMany(x, C.maxReorgDepth + 4);
  const ours = x.headTd - x.genesis.difficulty;
  const blocks = await heavyBranch(y, x.headTd + 20n);
  assert.ok(y.headTd - y.genesis.difficulty < 2n * ours, 'test potřebuje větev s menší než dvojnásobnou prací');
  x.setClock(Math.max(x.now(), y.now()));
  const head = x.head.hash();
  x.permitDeepFork(x.genesis);
  for (const b of blocks) assert.equal((await x.insertBlock(b)).status, 'side');
  assert.deepEqual(x.head.hash(), head, 'větev s víc prací, ale pod dvojnásobkem, řetězec nepřepíše');
});

// ---- mempool ---------------------------------------------------------------------

test('mempool odmítá špatný podpis, nonce, chybějící prostředky a nízký poplatek', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a, WEI) });
  const to = new Address(b.address);
  await assert.rejects(c.mempool.add(transfer(c, b, to, 1n, 0n)), /nedostatek/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 2n * WEI, 0n)), /nedostatek/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 1n, 500n)), /příliš vysoké/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 1n, 0n, { fee: 10n, tip: 1n })), /pod minimem/);
  await assert.rejects(c.mempool.add(transfer(c, a, to, 1n, 0n, { gas: 20000n })), /základní cena|gasLimit is too low/);
  await c.mempool.add(transfer(c, a, to, 1n, 0n));
  assert.equal(c.mempool.size, 1);
});

test('náhrada transakce vyžaduje vyšší poplatek', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  const to = new Address(b.address);
  await c.mempool.add(transfer(c, a, to, 1n, 0n, { fee: 10n * GWEI, tip: GWEI }));
  await assert.rejects(c.mempool.add(transfer(c, a, to, 2n, 0n, { fee: 10n * GWEI, tip: GWEI })), /10 %/);
  await c.mempool.add(transfer(c, a, to, 2n, 0n, { fee: 20n * GWEI, tip: 2n * GWEI }));
  assert.equal(c.mempool.size, 1);
});

test('těžba bere transakce podle poplatku a nonce, potvrzené zmizí z fronty', async () => {
  const a = wallet(); const b = wallet(); const d = wallet();
  const c = await newChain({ alloc: { ...fund(a), ...fund(b) } });
  const to = new Address(d.address);
  await c.mempool.add(transfer(c, a, to, 1n, 1n, { tip: 5n * GWEI, fee: 9n * GWEI }));
  await c.mempool.add(transfer(c, a, to, 1n, 0n, { tip: GWEI, fee: 9n * GWEI }));
  await c.mempool.add(transfer(c, b, to, 1n, 0n, { tip: 3n * GWEI, fee: 9n * GWEI }));
  await mine(c, { txs: c.mempool.pending() });
  const blk = c.getBlock(c.head.hash());
  assert.equal(blk.txs.length, 3);
  assert.equal(blk.txs[0].getSenderAddress().toString(), new Address(b.address).toString());
  assert.equal(blk.txs[1].nonce, 0n);
  assert.equal(blk.txs[2].nonce, 1n);
  await c.mempool.settled();
  assert.equal(c.mempool.size, 0);
});

test('konfliktní transakce po bloku ze sítě těžbu nezastaví', async () => {
  const a = wallet(); const b = wallet();
  const [x, y] = await twin(fund(a));
  const to = new Address(b.address);
  await x.mempool.add(transfer(x, a, to, 1n, 0n));
  const blk = (await mine(y, { txs: [transfer(y, a, to, 2n, 0n, { tip: 2n * GWEI, fee: 5n * GWEI })] })).block;
  x.setClock(y.now());
  await x.insertBlock(blk);
  await x.mempool.settled();
  assert.equal(x.mempool.size, 0, 'konfliktní transakce zmizela');
  const r = await mine(x, { txs: x.mempool.pending() });
  assert.equal(r.res.status, 'added');
});

test('starý formát transakce s EIP-155 funguje, bez něj ne', async () => {
  const a = wallet(); const b = wallet();
  const c = await newChain({ alloc: fund(a) });
  await mine(c, { txs: [legacy(c, a, new Address(b.address), 5n, 0n)] });
  assert.equal(await balance(c, b.address), 5n);
});
