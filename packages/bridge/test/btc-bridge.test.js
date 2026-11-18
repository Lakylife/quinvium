// The bridge to Bitcoin from deposit to withdrawal: three validators, a real Quinvium node and a simulated Bitcoin node that accepts
// only transactions with valid signatures according to independent code. The main question: can anyone take coins out of custody?
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

test('settings left out of the configuration keep their defaults; nonsense stops the validator at start', () => {
  // The CLI passes every setting from the JSON file, a missing one as undefined.
  const plain = member(validators[0], { confirmations: undefined, maxFeeRate: undefined, fallbackFeeRate: undefined }).bridge;
  assert.equal(plain.confirmations, 6);
  assert.equal(plain.maxFeeRate, 200);
  assert.equal(plain.fallbackFeeRate, 5);
  for (const bad of [{ confirmations: 0 }, { confirmations: 2.5 }, { maxFeeRate: '50' }, { maxFeeRate: -1 }]) {
    assert.throws(() => member(validators[0], bad), /must be a positive whole number/, JSON.stringify(bad));
  }
});

test('all validators compute the same deposit address', () => {
  const addresses = team.map((m) => m.bridge.depositAddress(alice.address));
  assert.equal(new Set(addresses).size, 1);
  assert.match(addresses[0], /^bcrt1q/);
  assert.notEqual(addresses[0], team[0].bridge.depositAddress(mallory.address));
});

test('a deposit is credited only after confirmation and only once', async () => {
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

test('a payment sent before registration is found', async () => {
  const before = await aBtc.balanceOf(mallory.address);
  btc.pay(team[0].bridge.depositAddress(mallory.address), 2_000_000n);
  btc.mine(CONFIRMATIONS + 2);
  await run(team, 2);
  await A.ok(gate.requestBitcoinDeposit(mallory.address));
  await run();
  assert.equal(await aBtc.balanceOf(mallory.address), before + 2_000_000n);
});

test('a flood of registrations does not start a scan for each one', async () => {
  const before = btc.scans ?? 0;
  const sender = gate.connect(A.connect(mallory));
  for (let i = 0; i < 40; i++) await sender.requestBitcoinDeposit(ethers.Wallet.createRandom().address);
  await A.mine();
  await A.mine();
  await team[0].bridge.tick();
  assert.equal((btc.scans ?? 0) - before, 1, 'jedna dávka na průchod');
  assert.equal(team[0].bridge.state.data.unscanned.length, 0);
});

test('a deposit that disappeared in a chain reorganisation is not credited', async () => {
  const before = await aBtc.totalSupply();
  btc.pay(team[0].bridge.depositAddress(alice.address), 7_000_000n);
  btc.mine(CONFIRMATIONS - 1);
  await run(team, 2);
  btc.reorg(CONFIRMATIONS - 1);
  btc.mine(CONFIRMATIONS + 1);
  await run();
  assert.equal(await aBtc.totalSupply(), before);
});

test('a deposit below the minimum is not credited, but the coins stay in custody', async () => {
  const before = await aBtc.totalSupply();
  btc.pay(team[0].bridge.depositAddress(alice.address), 5_000n);
  btc.mine(CONFIRMATIONS);
  await run();
  assert.equal(await aBtc.totalSupply(), before);
  assert.ok(Object.values(custody()).some((u) => u.value === 5_000n));
});

test('withdrawal: the custody loses exactly the burned amount', async () => {
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

test("one validator's outage does not stop a withdrawal, even with the proposer role", async () => {
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

test('a dishonest proposer takes nothing', async () => {
  const address = payee();
  const thief = payee();
  const r = await withdraw(1_000_000n, address);
  const id = openId(r);
  await run(team.map((m) => ({ ...m, bridge: { tick: () => m.bridge.syncAether() } })), 2);   // validators see the withdrawal but do not act yet
  const [key, utxo] = Object.entries(custody()).find(([, u]) => u.value > 1_000_000n);
  const [txid, vout] = key.split(':');
  const evil = (outputs) => serializeTx({ version: 2, locktime: 0, inputs: [{ txid, vout: Number(vout) }], outputs }).toString('hex');
  const note = { value: 0n, script: dataOutput(Buffer.from(id.slice(2), 'hex')) };
  const compromised = gate.connect(A.connect(validators[0].wallet));
  const attempts = [
    evil([{ value: 990_000n, script: addressScript(thief, 'regtest') }, note, { value: utxo.value - 1_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),   // money to the thief
    evil([{ value: 990_000n, script: addressScript(address, 'regtest') }, note, { value: utxo.value - 2_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),   // the custody loses more
    evil([{ value: 990_000n, script: addressScript(address, 'regtest') }, note, { value: utxo.value - 1_000_000n, script: addressScript(thief, 'regtest') }]),                 // the rest to the thief
    evil([{ value: 10_000n, script: addressScript(address, 'regtest') }, note, { value: utxo.value - 1_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),    // fee instead of payment
    evil([{ value: 990_000n, script: addressScript(address, 'regtest') }, { value: 0n, script: dataOutput(Buffer.alloc(32)) }, { value: utxo.value - 1_000_000n, script: Buffer.from(team[0].bridge.mainOutput, 'hex') }]),   // another tag
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

test('a forged signature does not block the payment', async () => {
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

test('a foreign transaction with the withdrawal marker does not mark it as paid', async () => {
  const address = payee();
  const id = openId(await withdraw(1_000_000n, address));
  btc.fakeMarker(dataOutput(Buffer.from(id.slice(2), 'hex')).toString('hex'));
  btc.mine(CONFIRMATIONS);
  await run();
  btc.mine(CONFIRMATIONS);
  await run(team, 2);
  assert.ok(received(address) > 0n);
});

test('invalid address: the user gets the token back', async () => {
  const before = await aBtc.balanceOf(alice.address);
  await withdraw(1_000_000n, 'tohle-neni-adresa');
  assert.equal(await aBtc.balanceOf(alice.address), before - 1_000_000n);
  await run();
  assert.equal(await aBtc.balanceOf(alice.address), before);
});

test('an address from another Bitcoin network is also returned', async () => {
  const before = await aBtc.balanceOf(alice.address);
  await withdraw(1_000_000n, bitcoinjs.address.toBech32(crypto.randomBytes(20), 0, 'bc'));
  await run();
  assert.equal(await aBtc.balanceOf(alice.address), before);
});

test('two simultaneous withdrawals do not touch the same coin', async () => {
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

test('the validator does not exceed the daily limit', async () => {
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

test('the validator does not sign an exorbitant fee', async () => {
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

test('after a restart the validator does not sign another transaction for the same withdrawal', async () => {
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

test('finally: the custody backs all issued tokens', async () => {
  await run(team, 3);
  assert.ok(custodyTotal() >= await aBtc.totalSupply());
  for (const m of team) assert.equal(Object.values(m.bridge.state.data.withdrawals).filter((w) => w.status === 'open').length, 0);
});
