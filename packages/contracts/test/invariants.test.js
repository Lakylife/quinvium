// Náhodné posloupnosti akcí proti pravidlům, která musí platit vždy. Běh je daný semínkem, chyba se dá zopakovat
// přes AETHER_FUZZ_SEED. Délku určuje AETHER_FUZZ_STEPS, v běžných testech je krátká.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { Header } from '../../node/src/core/types.js';
import { bytesToBigInt } from '../../node/src/crypto/ethash.js';
import { WEI } from '../../node/src/params.js';
import { makeChain } from '../../bridge/test/helpers/chains.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const SEED = Number(process.env.AETHER_FUZZ_SEED ?? Date.now() % 1_000_000);
const STEPS = Number(process.env.AETHER_FUZZ_STEPS ?? 120);
const TWO_256 = 1n << 256n;

/** Mulberry32: krátký generátor se semínkem, stejné semínko dá stejné akce. */
function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
}

test.after(() => { console.log(`semínko ${SEED}, kroků ${STEPS}`); });

test('pool: mince nikdy nezmizí a nikdo nedostane víc, než mu patří', async () => {
  const rng = random(SEED);
  const people = Array.from({ length: 5 }, () => ethers.Wallet.createRandom());
  const [operator, ...miners] = people;
  const side = makeChain(52403n, 'aether', people);
  await side.start();
  try {
    const factory = new ethers.Contract(artifacts.PoolFactory.address, artifacts.PoolFactory.abi, side.connect(operator));
    const FEE = 250n;
    const r = await side.ok(factory.createPool('Fuzz', 'http://x', Number(FEE), 16, 3));
    const created = r.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'PoolCreated');
    const pool = new ethers.Contract(created.args.pool, artifacts.AetherPool.abi, side.connect(operator));
    const node = side.node;
    const coinbase = ethers.getBytes(pool.target);
    let received = 0n;      // kolik mincí pool dostal od sítě
    let accepted = 0;
    let withdrawn = 0n;     // kolik si vybral provozovatel
    const paidBefore = new Map();

    async function poolBlock() {
      const before = await side.provider.getBalance(pool.target);
      side.state.clock += 15;
      const w = await node.work.getWork(coinbase);
      const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
      const { seal } = await import('../../node/test/helpers/chain.js');
      const sealed = await seal(node.chain, tpl);
      const res = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
      assert.ok(res.accepted, res.reason);
      await node.mempool.settled();
      received += await side.provider.getBalance(pool.target) - before;
    }

    async function share(miner) {
      const credit = BigInt(1 + rng.int(6)) ** 2n * 16n;
      const tpl = await node.chain.buildTemplate({ miner: coinbase, txs: [] });
      const fields = Object.fromEntries(Object.entries(tpl.header).filter(([k]) => !k.startsWith('_')));
      const extra = ethers.getBytes(ethers.concat([miner.address, ethers.zeroPadValue(ethers.toBeHex(credit), 12)]));
      const header = new Header({ ...fields, extraData: extra });
      for (let n = BigInt(1 + rng.int(1_000_000_000)); ; n++) {
        const nonce = ethers.getBytes(ethers.zeroPadValue(ethers.toBeHex(n), 8));
        const { mixDigest, result } = await node.chain.pow.compute(header.sealHash(), nonce, header.number);
        if (TWO_256 / (bytesToBigInt(result) + 1n) >= credit) return new Header({ ...fields, extraData: extra, mixHash: mixDigest, nonce }).encode();
      }
    }

    async function check(at) {
      const balance = await side.provider.getBalance(pool.target);
      const [reserved, owedOperator, totalPaid, feeBps] = await Promise.all([pool.reserved(), pool.operatorOwed(), pool.totalPaid(), pool.feeBps()]);
      assert.ok(balance >= reserved, `${at}: pool slíbil víc, než má: ${balance} < ${reserved}`);
      assert.equal(balance + totalPaid + withdrawn, received, `${at}: někde se ztratily nebo přibyly mince`);
      assert.ok(owedOperator + withdrawn <= received * feeBps / 10_000n, `${at}: provozovatel má víc než poplatek`);
      let sum = 0n;
      for (const m of miners) {
        const paid = await pool.paidTo(m.address);
        assert.ok(paid >= (paidBefore.get(m.address) ?? 0n), `${at}: výplata se nesmí snížit`);
        paidBefore.set(m.address, paid);
        sum += paid + await pool.pendingOf(m.address);
      }
      assert.ok(sum <= received - withdrawn - owedOperator, `${at}: těžaři by dostali víc, než pool přijal`);
    }

    await poolBlock();
    for (let i = 0; i < STEPS; i++) {
      const action = rng.int(10);
      if (action < 4) {
        await poolBlock();
      } else if (action < 7) {
        const miner = rng.pick(miners);
        const raw = await share(miner);
        await side.ok(pool.connect(side.connect(miner)).submitShare(raw));
        accepted += 1;
      } else if (action === 7) {
        const miner = rng.pick(miners);
        await side.ok(pool.connect(side.connect(miner)).claim(miner.address)).catch(() => {});
      } else if (action === 8) {
        await side.ok(pool.settle(4)).catch(() => {});
      } else {
        const before = await pool.operatorOwed();
        if (before > 0n) {
          await side.ok(pool.withdrawFee());
          withdrawn += before - await pool.operatorOwed();
        }
      }
      await check(`krok ${i} akce ${action}`);
    }
    // Závěr: všechno se vyrovná a uvízne nejvýš prach ze zaokrouhlení.
    for (let i = 0; i < 80; i++) await poolBlock();
    for (let i = 0; i < 8; i++) await side.ok(pool.settle(32)).catch(() => {});
    for (const m of miners) await side.ok(pool.connect(side.connect(m)).claim(m.address)).catch(() => {});
    await check('závěr');
    const paid = await pool.totalPaid();
    const settled = await pool.settledSteps();
    console.log(`pool: podílů ${accepted}, uzavřených kroků ${settled}, přijato ${ethers.formatEther(received)}, vyplaceno ${ethers.formatEther(paid)}, poplatek ${ethers.formatEther(withdrawn + await pool.operatorOwed())}`);
    assert.ok(settled > 0n && paid > 0n, 'běh nic nezkoušel');
    const dust = await side.provider.getBalance(pool.target) - await pool.operatorOwed();
    assert.ok(dust >= 0n, 'provozovatel má víc, než pool drží');
  } finally {
    await side.stop();
  }
});

test('most: krytí sedí po každém kroku a nic nejde doručit dvakrát', async () => {
  const rng = random(SEED + 1);
  const people = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
  const [admin, guardian, alice, bob] = people;
  const validators = Array.from({ length: 3 }, () => ethers.Wallet.createRandom()).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  const A = makeChain(52403n, 'aether', [...people, ...validators]);
  const B = makeChain(1115511n, 'ethereum', [...people, ...validators]);
  await A.start();
  await B.start();
  try {
    const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
    const gateA = await A.deploy('BridgeGateway', admin, admin.address, guardian.address, validators.map((v) => v.address), 2);
    const gateB = await B.deploy('BridgeGateway', admin, admin.address, guardian.address, validators.map((v) => v.address), 2);
    const usd = await B.deploy('StableToken', admin, 'USD', 'USD', 6, admin.address);
    await B.ok(usd.configureMinter(admin.address, 10n ** 18n));
    for (const w of [alice, bob]) await B.ok(usd.mint(w.address, 10n ** 12n));
    const pad = (a) => ethers.zeroPadValue(a, 32);
    const LIMIT = 500_000_000n;
    const r = await A.ok(gateA.createWrapped('USD', 'aUSD', 6, Number(B.id), pad(usd.target), LIMIT * 4n, LIMIT));
    const wrapped = A.at('WrappedAsset', iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token);
    await B.ok(gateB.setOutbound(usd.target, Number(A.id), true, false, 1n));
    await A.ok(gateA.setOutbound(wrapped.target, Number(B.id), true, true, 1n));
    await B.ok(gateB.setRoute(Number(A.id), pad(wrapped.target), usd.target, false, true, 10n ** 13n, 10n ** 13n));
    for (const w of [alice, bob]) await B.ok(usd.connect(B.connect(w)).approve(gateB.target, ethers.MaxUint256));

    const sign = (id, count = 2) => validators.slice(0, count).map((v) => new ethers.SigningKey(v.privateKey).sign(ethers.hashMessage(ethers.getBytes(id))).serialized);
    const flying = [];        // odeslané a nedoručené
    const finished = [];      // doručené, opakování musí selhat
    const queued = [];        // čekající ve frontě
    const owner = (w) => (w.address === alice.address ? alice : bob);

    async function check(at) {
      const locked = await gateB.locked(usd.target);
      assert.equal(await usd.balanceOf(gateB.target), locked, `${at}: zůstatek brány nesedí`);
      const minted = await wrapped.totalSupply();
      const out = flying.filter((f) => f.to === 'A').reduce((s, f) => s + f.m.amount, 0n) + queued.reduce((s, f) => s + f.m.amount, 0n);
      const back = flying.filter((f) => f.to === 'B').reduce((s, f) => s + f.m.amount, 0n);
      assert.equal(locked, minted + out + back, `${at}: krytí nesedí: uzamčeno ${locked}, vydáno ${minted}, na cestě ${out} a ${back}`);
    }

    const message = (src, dst, log, token) => ({ srcChain: src, dstChain: dst, nonce: log.args.nonce, srcToken: pad(token), recipient: ethers.getAddress(log.args.recipient), amount: log.args.amount });
    const sentLog = (receipt) => iface.parseLog(receipt.logs.find((l) => l.topics[0] === iface.getEvent('Sent').topicHash));

    for (let i = 0; i < STEPS; i++) {
      const action = rng.int(8);
      const who = rng.pick([alice, bob]);
      if (action < 3) {
        const amount = BigInt(1 + rng.int(800)) * 1_000_000n;
        const receipt = await B.ok(gateB.connect(B.connect(who)).send(usd.target, amount, Number(A.id), who.address));
        flying.push({ to: 'A', m: message(B.id, A.id, sentLog(receipt), usd.target) });
      } else if (action === 3) {
        const have = await wrapped.balanceOf(who.address);
        if (have > 0n) {
          const amount = 1n + BigInt(rng.int(Number(have > 1_000_000_000n ? 1_000_000_000n : have)));
          const receipt = await A.ok(gateA.connect(A.connect(who)).send(wrapped.target, amount, Number(B.id), who.address));
          flying.push({ to: 'B', m: message(A.id, B.id, sentLog(receipt), wrapped.target) });
        }
      } else if (action < 6 && flying.length) {
        const [f] = flying.splice(rng.int(flying.length), 1);
        const [side, gate] = f.to === 'A' ? [A, gateA] : [B, gateB];
        const id = await gate.messageId(f.m);
        const receipt = await side.ok(gate.connect(side.connect(admin)).deliver(f.m, sign(id)));
        if (receipt.logs.some((l) => l.topics[0] === iface.getEvent('DeliveryQueued').topicHash)) queued.push({ ...f, id });
        else finished.push({ ...f, id });
      } else if (action === 6 && queued.length) {
        A.state.clock += 86_400;
        await A.mine(60);
        const [f] = queued.splice(rng.int(queued.length), 1);
        await A.ok(gateA.executeQueued(f.m));
        finished.push(f);
      } else if (finished.length) {
        // Každý pokus o opakování a podvod musí selhat.
        const f = rng.pick(finished);
        const [gate] = f.to === 'A' ? [gateA] : [gateB];
        await assert.rejects(gate.deliver.staticCall(f.m, sign(f.id)), undefined, 'opakované doručení');
        const fake = { ...f.m, amount: f.m.amount + 1n };
        await assert.rejects(gate.deliver.staticCall(fake, sign(f.id)), undefined, 'změněná částka');
        const other = { ...f.m, nonce: f.m.nonce + 1000000n };
        await assert.rejects(gate.deliver.staticCall(other, sign(await gate.messageId(other), 1)), undefined, 'jeden podpis');
      }
      assert.equal(owner(who).address, who.address);
      await check(`krok ${i} akce ${action}`);
    }
    console.log(`most: doručeno ${finished.length}, ve frontě ${queued.length}, na cestě ${flying.length}`);
    assert.ok(finished.length > 0, 'běh nic nezkoušel');
  } finally {
    await A.stop();
    await B.stop();
  }
});
