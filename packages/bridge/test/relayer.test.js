// Validátoři mezi dvěma skutečnými uzly: nikdo nedoručuje ručně, všechno obstarají běžící relayery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { Relayer, messageId } from '../src/relayer.js';
import { DAY, WEI, artifacts, makeChain } from './helpers/chains.js';

const people = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
const [admin, guardian, alice, bob] = people;
const validators = Array.from({ length: 3 }, () => ethers.Wallet.createRandom());
const everyone = [...people, ...validators];
const A = makeChain(52403n, 'aether', everyone);
const B = makeChain(1115511n, 'ethereum', everyone);
const pad = (a) => ethers.zeroPadValue(a, 32);
const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
const folder = mkdtempSync(join(tmpdir(), 'aether-most-'));
let gateA;
let gateB;
let usdc;
let usdcA;
let relayers;

const config = (confirmations = 2) => [
  { id: A.id, name: 'Quinvium', provider: A.provider, gateway: gateA.target, confirmations, startBlock: 0 },
  { id: B.id, name: 'Ethereum', provider: B.provider, gateway: gateB.target, confirmations, startBlock: 0 },
];
const relayerFor = (wallet, confirmations = 2, statePath = undefined) => new Relayer({ chains: config(confirmations), privateKey: wallet.privateKey, statePath });

/** Běh sítě: bloky přibývají a validátoři dělají svou práci. */
async function run(list = relayers, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    for (const r of list) await r.tick();
    await A.mine();
    await B.mine();
  }
}

test.before(async () => {
  await A.start();
  await B.start();
  const list = validators.map((v) => v.address);
  gateA = await A.deploy('BridgeGateway', admin, admin.address, guardian.address, list, 2);
  gateB = await B.deploy('BridgeGateway', admin, admin.address, guardian.address, list, 2);
  usdc = await B.deploy('StableToken', admin, 'USD Coin', 'USDC', 6, admin.address);
  await B.ok(usdc.configureMinter(admin.address, 10n ** 15n));
  await B.ok(usdc.mint(alice.address, 5_000_000_000n));
  const r = await A.ok(gateA.createWrapped('USD Coin (bridged)', 'aUSDC', 6, Number(B.id), pad(usdc.target), 1_000_000_000n, 500_000_000n));
  const created = iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash));
  usdcA = A.at('WrappedAsset', created.args.token);
  await B.ok(gateB.setOutbound(usdc.target, Number(A.id), true, false, 1n));
  await A.ok(gateA.setOutbound(usdcA.target, Number(B.id), true, true, 1n));
  await B.ok(gateB.setRoute(Number(A.id), pad(usdcA.target), usdc.target, false, true, 10n ** 12n, 10n ** 11n));
  relayers = validators.map((v) => relayerFor(v));
});

test.after(async () => { await A.stop(); await B.stop(); });

const sendUsdc = async (amount) => {
  await B.ok(usdc.connect(B.connect(alice)).approve(gateB.target, amount));
  return B.ok(gateB.connect(B.connect(alice)).send(usdc.target, amount, Number(A.id), alice.address));
};

test('výpočet identifikátoru je stejný jako v kontraktu', async () => {
  const m = { srcChain: 7n, dstChain: A.id, nonce: 9n, srcToken: ethers.ZeroHash, recipient: bob.address, amount: 123n };
  assert.equal(messageId(gateA.target, m), await gateA.messageId(m));
});

test('tam i zpět bez ruční práce a krytí sedí', async () => {
  await sendUsdc(200_000_000n);
  await run();
  assert.equal(await usdcA.balanceOf(alice.address), 200_000_000n);
  await A.ok(gateA.connect(A.connect(alice)).send(usdcA.target, 150_000_000n, Number(B.id), alice.address));
  await run();
  assert.equal(await usdcA.totalSupply(), 50_000_000n);
  assert.equal(await usdc.balanceOf(gateB.target), 50_000_000n);
  assert.equal(await usdc.balanceOf(alice.address), 4_950_000_000n);
  assert.deepEqual(relayers.map((r) => Object.keys(r.state.data.pending).length), [0, 0, 0], 'nic nezůstalo viset');
});

test('před dostatečným potvrzením validátor nic nepodepíše', async () => {
  const careful = relayerFor(validators[0], 5);
  const head = await B.provider.getBlockNumber();
  careful.state.data.cursor[B.id.toString()] = head;
  const sent = await sendUsdc(1_000_000n);
  await careful.tick();
  assert.equal(Object.keys(careful.state.data.pending).length, 0, 'jedno potvrzení nestačí');
  for (let i = 0; i < 5; i++) await B.mine();
  await careful.tick();
  assert.equal(Object.keys(careful.state.data.pending).length, 1);
  assert.ok(sent.status);
  await run();
});

test('jeden validátor nestačí, po návratu druhého se zpráva doručí', async () => {
  const before = await usdcA.balanceOf(alice.address);
  await sendUsdc(2_000_000n);
  await run([relayers[0]]);
  assert.equal(await usdcA.balanceOf(alice.address), before, 'jeden podpis z tří nesmí stačit');
  await run([relayers[1]]);
  assert.equal(await usdcA.balanceOf(alice.address), before + 2_000_000n);
  await run();
});

test('výpadek uzlu jednoho řetězce nezastaví druhý', async () => {
  const broken = { ...config()[1], provider: new ethers.JsonRpcProvider('http://127.0.0.1:9', undefined, { staticNetwork: true }), name: 'nedostupný' };
  const lines = [];
  const r = new Relayer({ chains: [config()[0], broken], privateKey: validators[0].privateKey, log: (l) => lines.push(l) });
  await r.tick();
  r.chains.get(B.id).provider.destroy();
  assert.ok(lines.some((l) => /nedostupný/.test(l)));
});

test('velký převod čeká ve frontě a validátor ho sám dokončí', async () => {
  const before = await usdcA.balanceOf(alice.address);
  await sendUsdc(600_000_000n);
  await run();
  assert.equal(await usdcA.balanceOf(alice.address), before, 'nad limitem jde převod do fronty');
  await A.mine(DAY + 60);
  await run();
  assert.equal(await usdcA.balanceOf(alice.address), before + 600_000_000n);
});

test('převod zrušený strážcem se vrátí odesílateli přesně jednou', async () => {
  const beforeA = await usdcA.balanceOf(alice.address);
  const beforeB = await usdc.balanceOf(alice.address);
  const lockedB = await gateB.locked(usdc.target);
  await sendUsdc(600_000_000n);
  await run();
  assert.equal(await usdc.balanceOf(alice.address), beforeB - 600_000_000n, 'mince jsou zamčené v bráně');
  const id = Object.keys(relayers[0].state.data.pending).at(-1);
  assert.notEqual((await gateA.queued(id)).readyAt, 0n);
  await A.ok(gateA.connect(A.connect(guardian)).cancelQueued(id));
  await A.mine(DAY + 60);
  await run();
  assert.equal(await usdcA.balanceOf(alice.address), beforeA, 'na cílové síti nedorazilo nic');
  assert.equal(await usdc.balanceOf(alice.address), beforeB, 'odesílatel má zpět celou částku');
  assert.equal(await gateB.locked(usdc.target), lockedB, 'krytí sedí');
  assert.equal(await usdc.balanceOf(gateB.target), await usdcA.totalSupply(), 'uzamčeno je přesně tolik, kolik je přemostěno');
  // Další běh validátorů ani opakované zrušení nic nevrátí podruhé.
  await run();
  await assert.rejects(gateA.connect(A.connect(guardian)).cancelQueued.staticCall(id));
  assert.equal(await usdc.balanceOf(alice.address), beforeB, 'vrácení proběhlo jen jednou');
  assert.deepEqual(relayers.map((r) => Object.keys(r.state.data.pending).length), [0, 0, 0], 'nic nezůstalo viset');
});

test('převod, který příjemce odmítne, se vrátí odesílateli', async () => {
  const beforeB = await usdc.balanceOf(alice.address);
  const supply = await usdcA.totalSupply();
  // Validátor, který zrovna nedoručuje: zprávu jen uvidí, doručit ji ještě nestihne.
  const watcher = relayerFor(validators[0]);
  watcher.state.data.cursor = { ...relayers[0].state.data.cursor };
  await sendUsdc(7_000_000n);
  for (let i = 0; i < 3; i++) { await B.mine(); }
  await watcher.scan(watcher.chains.get(B.id));
  const [id, message] = Object.entries(watcher.state.data.pending).at(-1);
  await A.ok(gateA.connect(A.connect(alice)).cancelDelivery({ srcChain: message.srcChain, dstChain: message.dstChain, nonce: message.nonce, srcToken: message.srcToken, recipient: message.recipient, amount: message.amount }));
  assert.equal(await gateA.cancelled(id), true);
  await run();
  assert.equal(await usdcA.totalSupply(), supply, 'odmítnutý převod se na cílové síti nevyrazil');
  assert.equal(await usdc.balanceOf(alice.address), beforeB, 'odesílatel má zpět celou částku');
});

test('doručený převod se nikdy nevrací', async () => {
  const beforeA = await usdcA.balanceOf(alice.address);
  const beforeB = await usdc.balanceOf(alice.address);
  await sendUsdc(4_000_000n);
  await run();
  await run();
  assert.equal(await usdcA.balanceOf(alice.address), beforeA + 4_000_000n, 'převod dorazil');
  assert.equal(await usdc.balanceOf(alice.address), beforeB - 4_000_000n, 'a na zdrojové síti se nic nevrátilo');
  assert.equal(await usdc.balanceOf(gateB.target), await usdcA.totalSupply(), 'krytí sedí');
});

test('po restartu validátor pokračuje a nic nezopakuje', async () => {
  const statePath = join(folder, 'validator.json');
  const first = validators.map((v, i) => relayerFor(v, 2, i === 0 ? statePath : undefined));
  await run(first, 3);
  const before = await usdcA.balanceOf(alice.address);
  await sendUsdc(3_000_000n);
  await run([first[0]], 3);
  const again = relayerFor(validators[0], 2, statePath);
  assert.equal(again.state.data.cursor[B.id.toString()], first[0].state.data.cursor[B.id.toString()]);
  assert.equal(Object.keys(again.state.data.pending).length, 1, 'rozdělaná zpráva přežila restart');
  await run([again, first[1]]);
  assert.equal(await usdcA.balanceOf(alice.address), before + 3_000_000n);
  await run([again, first[1], first[2]]);
  assert.equal(await usdcA.balanceOf(alice.address), before + 3_000_000n, 'doručení se neopakuje');
});

test('cizí klíč podpis do brány nedostane', async () => {
  const stranger = ethers.Wallet.createRandom();
  const id = ethers.id('cokoli');
  await assert.rejects(gateA.attest.staticCall(id, new ethers.SigningKey(stranger.privateKey).sign(ethers.hashMessage(ethers.getBytes(id))).serialized));
});

test('příjemce musí být adresa, jinak by mince uvízly', async () => {
  await assert.rejects(gateB.connect(B.connect(alice)).send.staticCall(usdc.target, 1n, Number(A.id), '0x1234'));
});

test('hlavní mince jde stejnou cestou', async () => {
  const r = await B.ok(gateB.createWrapped('Quinvium (bridged)', 'QU.e', 18, Number(A.id), ethers.ZeroHash, 100n * WEI, 50n * WEI));
  const wrapped = B.at('WrappedAsset', iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token);
  await A.ok(gateA.setOutbound(ethers.ZeroAddress, Number(B.id), true, false, 1n));
  await B.ok(gateB.setOutbound(wrapped.target, Number(A.id), true, true, 1n));
  await A.ok(gateA.setRoute(Number(B.id), pad(wrapped.target), ethers.ZeroAddress, false, true, 100n * WEI, 50n * WEI));
  await A.ok(gateA.connect(A.connect(bob)).send(ethers.ZeroAddress, 10n * WEI, Number(B.id), bob.address, { value: 10n * WEI }));
  await run();
  assert.equal(await wrapped.balanceOf(bob.address), 10n * WEI);
  await B.ok(gateB.connect(B.connect(bob)).send(wrapped.target, 4n * WEI, Number(A.id), bob.address));
  await run();
  assert.equal(await gateA.locked(ethers.ZeroAddress), 6n * WEI);
  assert.equal(await A.provider.getBalance(gateA.target), 6n * WEI);
});

test('mainnet Quinvia a Ethereum vyžadují dost potvrzení, jinak se validátor nespustí', async () => {
  const { MIN_CONFIRMATIONS } = await import('../src/relayer.js');
  const wallet = ethers.Wallet.createRandom();
  const chain = (id, confirmations) => ({ id, name: `síť ${id}`, provider: A.provider, gateway: gateA.target, confirmations });
  assert.throws(() => new Relayer({ chains: [chain(52401n, 12)], privateKey: wallet.privateKey }), /aspoň 240 potvrzení/);
  assert.throws(() => new Relayer({ chains: [chain(1n, 12)], privateKey: wallet.privateKey }), /aspoň 64 potvrzení/);
  assert.throws(() => new Relayer({ chains: [chain(52402n, 0)], privateKey: wallet.privateKey }), /aspoň 1 potvrzení/);
  assert.ok(new Relayer({ chains: [chain(52401n, MIN_CONFIRMATIONS[52401])], privateKey: wallet.privateKey }));
  assert.ok(new Relayer({ chains: [chain(52402n, 12)], privateKey: wallet.privateKey }), 'testnet s 12 potvrzeními projde');
});
