// Most k Bitcoinu od vkladu po výběr: tři validátoři, skutečný uzel Quinvium a simulovaný uzel Bitcoinu, který přijme
// jen transakce s platnými podpisy podle nezávislého kódu. Hlavní otázka: může někdo odnést mince z úschovy?
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as bitcoinjs from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { Relayer } from '../src/relayer.js';
import { BITCOIN, BitcoinBridge } from '../src/btc-bridge.js';
import { addressScript, dataOutput, publicKey, serializeTx } from '../src/bitcoin.js';
import { MockBitcoin } from './helpers/mock-bitcoin.js';
import { artifacts, makeChain } from './helpers/chains.js';

const people = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
const [admin, guardian, alice, mallory] = people;
const validators = Array.from({ length: 3 }, () => ({ wallet: ethers.Wallet.createRandom(), btcKey: `0x${crypto.randomBytes(32).toString('hex')}` }))
  .sort((a, b) => (BigInt(a.wallet.address) < BigInt(b.wallet.address) ? -1 : 1));
const A = makeChain(52403n, 'aether', [...people, ...validators.map((v) => v.wallet)]);
const btc = new MockBitcoin();
const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
const folder = mkdtempSync(join(tmpdir(), 'aether-btc-'));
const CONFIRMATIONS = 3;
const payee = () => bitcoinjs.address.toBech32(crypto.randomBytes(20), 0, 'bcrt');
const clock = { shift: 0 };
let gate;
let aBtc;
let team;

function member(v, options = {}) {
  const chains = [{ id: A.id, name: 'Quinvium', provider: A.provider, gateway: gate.target, confirmations: 1, startBlock: 0 }];
  const relayer = new Relayer({ chains, privateKey: v.wallet.privateKey });
  const bridge = new BitcoinBridge({
    rpc: btc.rpc, network: 'regtest', relayer, chainId: A.id, token: aBtc.target, btcKey: v.btcKey, threshold: 2, confirmations: CONFIRMATIONS,
    validators: validators.map((x) => ({ address: x.wallet.address, btcKey: publicKey(x.btcKey).toString('hex') })), now: () => Date.now() + clock.shift, ...options,
  });
  return { relayer, bridge };
}

async function run(list = team, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    for (const m of list) {
      await m.bridge.tick();
      await m.relayer.tick();
    }
    await A.mine();
  }
}

const received = (address) => {
  const script = addressScript(address, 'regtest').toString('hex');
  return [...btc.coins.values()].filter((c) => c.script === script).reduce((s, c) => s + c.value, 0n);
};
const custody = () => team[0].bridge.state.data.utxos;
const custodyTotal = () => Object.values(custody()).reduce((s, u) => s + u.value, 0n);
const withdraw = (amount, address, who = alice) => A.ok(gate.connect(A.connect(who)).send(aBtc.target, amount, BITCOIN, ethers.toUtf8Bytes(address)));
const openId = (receipt) => iface.parseLog(receipt.logs.find((l) => l.topics[0] === iface.getEvent('Sent').topicHash)).args.id;
const proposalsFor = async (id) => gate.queryFilter(gate.filters.Posted(id), 0);

test.before(async () => {
  await A.start();
  gate = await A.deploy('BridgeGateway', admin, admin.address, guardian.address, validators.map((v) => v.wallet.address), 2);
  const r = await A.ok(gate.createWrapped('Bridged Bitcoin', 'aBTC', 8, Number(BITCOIN), ethers.ZeroHash, 100_000_000_000n, 50_000_000_000n));
  aBtc = A.at('WrappedAsset', iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token);
  await A.ok(gate.setOutbound(aBtc.target, Number(BITCOIN), true, true, 50_000n));
  btc.mine(10);
  team = validators.map((v) => member(v));
  await run(team, 1);
});

test.after(async () => { await A.stop(); });

test('všichni validátoři spočítají stejnou vkladovou adresu', () => {
  const addresses = team.map((m) => m.bridge.depositAddress(alice.address));
  assert.equal(new Set(addresses).size, 1);
  assert.match(addresses[0], /^bcrt1q/);
  assert.notEqual(addresses[0], team[0].bridge.depositAddress(mallory.address));
});

test('vklad se připíše až po potvrzení a jen jednou', async () => {
  await A.ok(gate.requestBitcoinDeposit(alice.address));
  await run(team, 2);
  btc.pay(team[0].bridge.depositAddress(alice.address), 50_000_000n);
  btc.mine(CONFIRMATIONS - 1);
  await run(team, 3);
  assert.equal(await aBtc.balanceOf(alice.address), 0n, 'dvě potvrzení ze tří nestačí');
  btc.mine(1);
  await run();
  assert.equal(await aBtc.balanceOf(alice.address), 50_000_000n);
  await run();
  assert.equal(await aBtc.totalSupply(), 50_000_000n, 'druhý průchod nic nepřidal');
  assert.equal(custodyTotal(), 50_000_000n);
});

test('platba odeslaná před registrací se najde', async () => {
  const before = await aBtc.balanceOf(mallory.address);
  btc.pay(team[0].bridge.depositAddress(mallory.address), 2_000_000n);
  btc.mine(CONFIRMATIONS + 2);
  await run(team, 2);
  await A.ok(gate.requestBitcoinDeposit(mallory.address));
  await run();
  assert.equal(await aBtc.balanceOf(mallory.address), before + 2_000_000n);
});

test('záplava registrací nespustí prohledávání pro každou zvlášť', async () => {
  const before = btc.scans ?? 0;
  const sender = gate.connect(A.connect(mallory));
  for (let i = 0; i < 40; i++) await sender.requestBitcoinDeposit(ethers.Wallet.createRandom().address);
  await A.mine();
  await A.mine();
  await team[0].bridge.tick();
  assert.equal((btc.scans ?? 0) - before, 1, 'jedna dávka na průchod');
  assert.equal(team[0].bridge.state.data.unscanned.length, 0);
});

test('vklad zmizelý při přeskupení řetězce se nepřipíše', async () => {
  const before = await aBtc.totalSupply();
  btc.pay(team[0].bridge.depositAddress(alice.address), 7_000_000n);
  btc.mine(CONFIRMATIONS - 1);
  await run(team, 2);
  btc.reorg(CONFIRMATIONS - 1);
  btc.mine(CONFIRMATIONS + 1);
  await run();
  assert.equal(await aBtc.totalSupply(), before);
});

test('vklad pod minimem se nepřipíše, ale mince zůstanou v úschově', async () => {
  const before = await aBtc.totalSupply();
  btc.pay(team[0].bridge.depositAddress(alice.address), 5_000n);
  btc.mine(CONFIRMATIONS);
  await run();
  assert.equal(await aBtc.totalSupply(), before);
  assert.ok(Object.values(custody()).some((u) => u.value === 5_000n));
});

test('výběr: úschova přijde přesně o spálenou částku', async () => {
  const address = payee();
  const before = custodyTotal();
  const supply = await aBtc.totalSupply();
  await withdraw(20_000_000n, address);
  await run();
  assert.equal(await aBtc.totalSupply(), supply - 20_000_000n);
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  const paid = received(address);
  assert.ok(paid > 19_990_000n && paid < 20_000_000n, `vyplaceno ${paid}`);
  assert.equal(custodyTotal(), before - 20_000_000n);
  assert.ok(custodyTotal() >= await aBtc.totalSupply(), 'krytí drží');
  for (const m of team) assert.ok(Object.values(m.bridge.state.data.withdrawals).every((w) => w.status === 'paid'));
});

test('výpadek jednoho validátora nezastaví výběr ani s rolí navrhovatele', async () => {
  const address = payee();
  const r = await withdraw(1_000_000n, address);
  const id = openId(r);
  const log = iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('Sent').topicHash));
  const planned = validators[Number(log.args.nonce % 3n)].wallet.address;
  const online = team.filter((m) => m.relayer.address !== planned);
  await run(online, 2);
  assert.equal((await proposalsFor(id)).length, 0, 'navrhovatel je mimo provoz');
  clock.shift += 11 * 60_000;
  await run(online, 4);
  btc.mine(CONFIRMATIONS);
  await run(online, 2);
  assert.ok(received(address) > 0n);
  await run(team, 2);
});

test('nepoctivý navrhovatel neodnese nic', async () => {
  const address = payee();
  const thief = payee();
  const r = await withdraw(1_000_000n, address);
  const id = openId(r);
  await run(team.map((m) => ({ ...m, bridge: { tick: () => m.bridge.syncAether() } })), 2);   // validátoři výběr vidí, ale ještě nejednají
  const [key, utxo] = Object.entries(custody()).find(([, u]) => u.value > 1_000_000n);
  const [txid, vout] = key.split(':');
  const evil = (outputs) => serializeTx({ version: 2, locktime: 0, inputs: [{ txid, vout: Number(vout) }], outputs }).toString('hex');
  const note = { value: 0n, script: dataOutput(Buffer.from(id.slice(2), 'hex')) };
  const compromised = gate.connect(A.connect(validators[0].wallet));
  const attempts = [
    evil([{ value: 990_000n, script: addressScript(thief, 'regtest') }, note, { value: utxo.value - 1_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),   // peníze zloději
    evil([{ value: 990_000n, script: addressScript(address, 'regtest') }, note, { value: utxo.value - 2_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),   // úschova přijde o víc
    evil([{ value: 990_000n, script: addressScript(address, 'regtest') }, note, { value: utxo.value - 1_000_000n, script: addressScript(thief, 'regtest') }]),                 // zbytek zloději
    evil([{ value: 10_000n, script: addressScript(address, 'regtest') }, note, { value: utxo.value - 1_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),    // poplatek místo platby
    evil([{ value: 990_000n, script: addressScript(address, 'regtest') }, { value: 0n, script: dataOutput(Buffer.alloc(32)) }, { value: utxo.value - 1_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),   // jiná značka
  ];
  for (const tx of attempts) await A.ok(compromised.post(id, ethers.toUtf8Bytes(JSON.stringify({ tx }))));
  await run(team.slice(1), 1);
  const signed = (await proposalsFor(id)).filter((l) => /sigs/.test(ethers.toUtf8String(l.args.data)));
  assert.equal(signed.length, 0, 'poctiví validátoři nic nepodepsali');
  clock.shift += 11 * 60_000;
  await run(team, 6);
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.equal(received(thief), 0n);
  assert.ok(received(address) > 900_000n, 'uživatel dostal své');
});

test('podvržený podpis platbu nezablokuje', async () => {
  const address = payee();
  const r = await withdraw(1_000_000n, address);
  const id = openId(r);
  const fake = validators[0].wallet;
  await A.ok(gate.connect(A.connect(fake)).post(id, ethers.toUtf8Bytes(JSON.stringify({ txid: '00'.repeat(32), sigs: ['3006020101020101'] }))));
  await run();
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.ok(received(address) > 0n);
});

test('cizí transakce se značkou výběru ho neoznačí za vyplacený', async () => {
  const address = payee();
  const id = openId(await withdraw(1_000_000n, address));
  btc.fakeMarker(dataOutput(Buffer.from(id.slice(2), 'hex')).toString('hex'));
  btc.mine(CONFIRMATIONS);
  await run();
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.ok(received(address) > 0n);
});

test('neplatná adresa: uživatel dostane token zpět', async () => {
  const before = await aBtc.balanceOf(alice.address);
  await withdraw(1_000_000n, 'tohle-neni-adresa');
  assert.equal(await aBtc.balanceOf(alice.address), before - 1_000_000n);
  await run();
  assert.equal(await aBtc.balanceOf(alice.address), before);
});

test('adresa z jiné sítě Bitcoinu se taky vrátí', async () => {
  const before = await aBtc.balanceOf(alice.address);
  await withdraw(1_000_000n, bitcoinjs.address.toBech32(crypto.randomBytes(20), 0, 'bc'));
  await run();
  assert.equal(await aBtc.balanceOf(alice.address), before);
});

test('dva výběry naráz nesáhnou na stejnou minci', async () => {
  await A.ok(gate.requestBitcoinDeposit(alice.address));
  btc.pay(team[0].bridge.depositAddress(alice.address), 3_000_000n);
  btc.pay(team[0].bridge.depositAddress(alice.address), 3_000_000n);
  btc.mine(CONFIRMATIONS);
  await run();
  const [a, b] = [payee(), payee()];
  await withdraw(1_500_000n, a);
  await withdraw(1_500_000n, b);
  await run();
  btc.mine(CONFIRMATIONS);
  await run();
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.ok(received(a) > 0n && received(b) > 0n);
  assert.ok(custodyTotal() >= await aBtc.totalSupply());
});

test('denní limit validátor nepřekročí', async () => {
  const strict = team.map((m, i) => member(validators[i], { dailyLimit: 1n }));
  for (const [i, m] of strict.entries()) m.bridge.state.data = team[i].bridge.state.data;
  const address = payee();
  await withdraw(1_000_000n, address);
  await run(strict, 5);
  btc.mine(CONFIRMATIONS);
  await run(strict, 2);
  assert.equal(received(address), 0n);
  await run(team, 5);
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.ok(received(address) > 0n, 'po uvolnění limitu výběr doběhne');
});

test('přemrštěný poplatek validátor nepodepíše', async () => {
  const stingy = team.map((m, i) => member(validators[i], { maxFeeRate: 1 }));
  for (const [i, m] of stingy.entries()) m.bridge.state.data = team[i].bridge.state.data;
  btc.feerate = 0.001;     // 100 sat/vB
  const address = payee();
  const r = await withdraw(1_000_000n, address);
  const id = openId(r);
  const { nonce } = iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('Sent').topicHash)).args;
  const proposer = team.find((m) => m.relayer.address === team[0].bridge.proposer({ nonce, seenAt: Date.now() + clock.shift }));
  await run([proposer], 3);
  assert.equal((await proposalsFor(id)).filter((l) => /"tx"/.test(ethers.toUtf8String(l.args.data))).length, 1);
  await run(stingy.filter((m) => m.relayer.address !== proposer.relayer.address), 3);
  btc.mine(CONFIRMATIONS);
  await run(stingy.filter((m) => m.relayer.address !== proposer.relayer.address), 1);
  assert.equal(received(address), 0n, 'jeden podpis navrhovatele nestačí');
  btc.feerate = null;
  await run(team, 5);
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.ok(received(address) > 0n, 'validátoři s běžným limitem platbu dokončí');
});

test('po restartu validátor nepodepíše jinou transakci pro stejný výběr', async () => {
  const statePath = join(folder, 'bitcoin.json');
  const first = member(validators[1], { statePath });
  first.bridge.state.data = { ...team[1].bridge.state.data };
  first.bridge.state.save();
  const id = ethers.id('vyber');
  first.bridge.state.data.signed[id] = { txid: 'ab'.repeat(32), inputs: ['aa:0'] };
  first.bridge.state.save();
  const again = member(validators[1], { statePath });
  assert.deepEqual(again.bridge.state.data.signed[id], { txid: 'ab'.repeat(32), inputs: ['aa:0'] });
  assert.equal(again.bridge.state.data.height, first.bridge.state.data.height);
  assert.deepEqual(Object.keys(again.bridge.state.data.utxos).sort(), Object.keys(team[1].bridge.state.data.utxos).sort());
});

test('nakonec: úschova kryje všechny vydané tokeny', async () => {
  await run(team, 3);
  assert.ok(custodyTotal() >= await aBtc.totalSupply());
  for (const m of team) assert.equal(Object.values(m.bridge.state.data.withdrawals).filter((w) => w.status === 'open').length, 0);
});
