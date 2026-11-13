// Swap na skutečném uzlu: kurz, poplatek, skluz, likvidita, hlavní mince a pokusy pool obelstít.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { WEI, artifacts, makeChain } from '../../bridge/test/helpers/chains.js';

const people = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
const [admin, alice, bob, mallory] = people;
const A = makeChain(52403n, 'aether', people);
const WAET = artifacts.WAET.address;
const FAR = 2_000_000_000_000;
const SEED = Number(process.env.AETHER_FUZZ_SEED ?? Date.now() % 1_000_000);
const STEPS = Number(process.env.AETHER_FUZZ_STEPS ?? 60);
const iface = new ethers.Interface([...artifacts.SwapRouter.abi, ...artifacts.SwapPair.abi.filter((x) => x.type === 'error'), ...artifacts.SwapFactory.abi.filter((x) => x.type === 'error')]);
const reverts = (pending, name) => assert.rejects(pending, (e) => { assert.equal(iface.parseError(e.data ?? e.info?.error?.data)?.name, name); return true; });
let factory;
let router;
let usd;
let btc;
let as;

const order = (tokenA, tokenB, desiredA, desiredB, minA = 0n, minB = 0n) => ({ tokenA, tokenB, desiredA, desiredB, minA, minB });
const pairOf = async (a, b) => A.at('SwapPair', await factory.getPair(a, b));

test.before(async () => {
  await A.start();
  factory = await A.deploy('SwapFactory', admin);
  router = await A.deploy('SwapRouter', admin, factory.target, WAET);
  usd = await A.deploy('StableToken', admin, 'Test USD', 'tUSD', 6, admin.address);
  btc = await A.deploy('StableToken', admin, 'Test BTC', 'tBTC', 8, admin.address);
  for (const t of [usd, btc]) {
    await A.ok(t.configureMinter(admin.address, 10n ** 24n));
    for (const w of [alice, bob, mallory]) await A.ok(t.mint(w.address, 10n ** 18n));
  }
  as = (w) => router.connect(A.connect(w));
  for (const w of [alice, bob, mallory]) for (const t of [usd, btc]) await A.ok(t.connect(A.connect(w)).approve(router.target, ethers.MaxUint256));
});

test.after(async () => { await A.stop(); });

test('první vklad založí pool, část likvidity zůstane navždy uzamčená', async () => {
  await A.ok(as(alice).addLiquidity(order(usd.target, btc.target, 100_000_000_000n, 200_000_000n), alice.address, FAR));
  const pair = await pairOf(usd.target, btc.target);
  assert.equal(await pair.balanceOf('0x000000000000000000000000000000000000dEaD'), 1000n);
  const [r0, r1] = await pair.getReserves();
  assert.deepEqual([r0, r1].sort(), [100_000_000_000n, 200_000_000n].sort());
  assert.equal(await factory.allPairsLength(), 1n);
  assert.equal((await factory.list(0, 10)).length, 1);
  await reverts(factory.createPair.staticCall(btc.target, usd.target), 'PairExists');
});

test('směna dá přesně částku podle vzorce s poplatkem 0,3 %', async () => {
  const pair = await pairOf(usd.target, btc.target);
  const [r0, r1] = await pair.getReserves();
  const usdFirst = (await pair.token0()) === usd.target;
  const [rIn, rOut] = usdFirst ? [r0, r1] : [r1, r0];
  const amountIn = 1_000_000_000n;
  const expected = (amountIn * 997n * rOut) / (rIn * 1000n + amountIn * 997n);
  const [, quoted] = await router.getAmountsOut(amountIn, [usd.target, btc.target]);
  assert.equal(quoted, expected);
  const before = await btc.balanceOf(bob.address);
  await A.ok(as(bob).swapExactTokensForTokens(amountIn, expected, [usd.target, btc.target], bob.address, FAR));
  assert.equal(await btc.balanceOf(bob.address) - before, expected);
  const [n0, n1] = await pair.getReserves();
  assert.ok(n0 * n1 > r0 * r1, 'poplatek zůstal v poolu');
});

test('skluz a prošlá platnost transakci vrátí', async () => {
  const [, quoted] = await router.getAmountsOut(1_000_000n, [usd.target, btc.target]);
  await reverts(as(bob).swapExactTokensForTokens.staticCall(1_000_000n, quoted + 1n, [usd.target, btc.target], bob.address, FAR), 'SlippageExceeded');
  await reverts(as(bob).swapExactTokensForTokens.staticCall(1_000_000n, 0n, [usd.target, btc.target], bob.address, 1), 'Expired');
  await reverts(router.getAmountsOut.staticCall(1n, [usd.target]), 'InvalidPath');
  await reverts(router.getAmountsOut.staticCall(1n, [usd.target, WAET]), 'NoPair');
});

test('hlavní mince AET: vklad, směna oběma směry a přes dva pooly', async () => {
  await A.ok(as(alice).addLiquidityNative(usd.target, 50_000_000_000n, 0n, 0n, alice.address, FAR, { value: 100n * WEI }));
  const before = await usd.balanceOf(bob.address);
  await A.ok(as(bob).swapExactNativeForTokens(1n, [WAET, usd.target], bob.address, FAR, { value: WEI }));
  const got = await usd.balanceOf(bob.address) - before;
  assert.ok(got > 480_000_000n && got < 500_000_000n, `dostal ${got}`);
  const balance = await A.provider.getBalance(bob.address);
  await A.ok(as(bob).swapExactTokensForNative(got / 2n, 1n, [usd.target, WAET], bob.address, FAR));
  assert.ok(await A.provider.getBalance(bob.address) > balance, 'hlavní mince se vrátila');
  const hop = await router.getAmountsOut(WEI / 100n, [WAET, usd.target, btc.target]);
  const btcBefore = await btc.balanceOf(mallory.address);
  await A.ok(as(mallory).swapExactNativeForTokens(hop[2], [WAET, usd.target, btc.target], mallory.address, FAR, { value: WEI / 100n }));
  assert.equal(await btc.balanceOf(mallory.address) - btcBefore, hop[2]);
  assert.equal(await A.provider.getBalance(router.target), 0n, 'směrovač nic nedrží');
  await reverts(as(bob).swapExactNativeForTokens.staticCall(1n, [usd.target, WAET], bob.address, FAR, { value: 1n }), 'InvalidPath');
  await assert.rejects(A.connect(bob).sendTransaction({ to: router.target, value: 1n }));
});

test('výběr likvidity vrátí podíl včetně vydělaných poplatků', async () => {
  const pair = await pairOf(usd.target, btc.target);
  const lp = pair.connect(A.connect(alice));
  await A.ok(lp.approve(router.target, ethers.MaxUint256));
  const shares = await pair.balanceOf(alice.address);
  const [usdBefore, btcBefore] = [await usd.balanceOf(alice.address), await btc.balanceOf(alice.address)];
  await A.ok(as(alice).removeLiquidity(usd.target, btc.target, shares, 1n, 1n, alice.address, FAR));
  assert.ok(await usd.balanceOf(alice.address) > usdBefore + 100_000_000_000n, 'poskytovatel vydělal na poplatcích');
  assert.ok(await btc.balanceOf(alice.address) > btcBefore);
  assert.equal(await pair.balanceOf(alice.address), 0n);
  assert.ok(await pair.totalSupply() >= 1000n, 'uzamčená část zůstává');
  await A.ok(as(alice).addLiquidity(order(usd.target, btc.target, 100_000_000_000n, 200_000_000n, 1n, 1n), alice.address, FAR));
});

test('přímé volání poolu nic neodnese', async () => {
  const pair = await pairOf(usd.target, btc.target);
  const direct = pair.connect(A.connect(mallory));
  const [r0, r1] = await pair.getReserves();
  await reverts(direct.swap.staticCall(1000n, 0n, mallory.address), 'InsufficientInput');
  await reverts(direct.swap.staticCall(r0, 0n, mallory.address), 'InsufficientLiquidity');
  await reverts(direct.swap.staticCall(0n, 0n, mallory.address), 'InsufficientOutput');
  await reverts(direct.swap.staticCall(1n, 0n, await pair.token0()), 'InvalidTo');
  await reverts(direct.burn.staticCall(mallory.address), 'InsufficientLiquidity');
  // Vstup bez započítaného poplatku neprojde.
  const token = A.at('StableToken', await pair.token0());
  const amountIn = r0 / 100n;
  const noFee = (amountIn * r1) / (r0 + amountIn);
  await A.ok(token.connect(A.connect(mallory)).transfer(pair.target, amountIn));
  await reverts(direct.swap.staticCall(0n, noFee, mallory.address), 'InvariantBroken');
  await direct.swap.staticCall(0n, (amountIn * 997n * r1) / (r0 * 1000n + amountIn * 997n), mallory.address);
  await A.ok(direct.sync());
});

test('náhodné směny a likvidita: součin nikdy neklesne a zásoby sedí', async () => {
  let a = SEED >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pair = await pairOf(usd.target, btc.target);
  const lp = pair.connect(A.connect(bob));
  await A.ok(lp.approve(router.target, ethers.MaxUint256));
  let done = 0;
  for (let i = 0; i < STEPS; i++) {
    const before = await pair.getReserves();
    const supplyBefore = await pair.totalSupply();
    const action = int(4);
    const who = [alice, bob, mallory][int(3)];
    let liquidityChanged = false;
    if (action < 2) {
      const path = int(2) ? [usd.target, btc.target] : [btc.target, usd.target];
      const amount = BigInt(1 + int(1_000_000)) * 1000n;
      await A.ok(as(who).swapExactTokensForTokens(amount, 0n, path, who.address, FAR));
      done += 1;
    } else if (action === 2) {
      await A.ok(as(bob).addLiquidity(order(usd.target, btc.target, BigInt(1 + int(1000)) * 1_000_000n, 10n ** 12n), bob.address, FAR));
      liquidityChanged = true;
    } else {
      const shares = await pair.balanceOf(bob.address);
      if (shares > 1n) {
        await A.ok(as(bob).removeLiquidity(usd.target, btc.target, shares / 2n, 0n, 0n, bob.address, FAR));
        liquidityChanged = true;
      }
    }
    const [r0, r1] = await pair.getReserves();
    const [token0, token1] = [await pair.token0(), await pair.token1()];
    assert.equal(await A.at('StableToken', token0).balanceOf(pair.target), r0, `krok ${i}: zásoba 0 nesedí`);
    assert.equal(await A.at('StableToken', token1).balanceOf(pair.target), r1, `krok ${i}: zásoba 1 nesedí`);
    if (liquidityChanged) {
      // Hodnota jednoho podílu nesmí klesnout, jinak by jeden poskytovatel bral druhému.
      const supply = await pair.totalSupply();
      assert.ok(r0 * supplyBefore * 1001n >= before[0] * supply * 1000n, `krok ${i}: podíl ztratil hodnotu`);
    } else {
      assert.ok(r0 * r1 >= before[0] * before[1], `krok ${i}: součin klesl`);
    }
  }
  console.log(`swap: semínko ${SEED}, směn ${done} z ${STEPS}`);
  assert.ok(done > 0);
});
