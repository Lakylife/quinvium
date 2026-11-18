// The bridge between two real nodes with different chain IDs, an issuer's stablecoin and the verified token list, including theft attempts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { AetherNode, loadAlloc } from '../../node/src/node.js';
import { NETWORKS, WEI } from '../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../node/test/helpers/chain.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const DAY = 86400;
const accounts = Array.from({ length: 8 }, () => ethers.Wallet.createRandom());
const [admin, guardian, alice, bob, mallory] = accounts;
const validators = Array.from({ length: 3 }, () => ethers.Wallet.createRandom()).sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));

function chain(chainId, name) {
  const net = { ...NETWORKS.dev, name, chainId };
  const alloc = { ...loadAlloc() };
  for (const w of accounts) alloc[w.address] = { balance: 10000n * WEI };
  const state = { clock: Number(net.genesisTimestamp) };
  const node = new AetherNode({ network: net, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true, alloc, now: () => state.clock, log: () => {} });
  const side = {
    node, state, id: chainId, provider: null,
    async mine(step = 15) {
      state.clock += step;
      const w = await node.work.getWork(ethers.getBytes('0x' + 'cc'.repeat(20)));
      const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
      const sealed = await seal(node.chain, tpl);
      const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
      assert.ok(r.accepted, r.reason);
      await node.mempool.settled();
    },
    async ok(pending) {
      const tx = await pending;
      await side.mine();
      const r = await side.provider.getTransactionReceipt(tx.hash);
      assert.equal(r.status, 1);
      return r;
    },
    connect: (w) => w.connect(side.provider),
    async deploy(name, ...args) {
      const f = new ethers.ContractFactory(artifacts[name].abi, artifacts[name].bytecode, side.connect(admin));
      const c = await f.deploy(...args);
      await side.mine();
      return c;
    },
  };
  return side;
}

const A = chain(52403n, 'aether');
const B = chain(1115511n, 'ethereum');
let gateA;
let gateB;
let usdc;        // original on B
let usdcA;       // bridged on A
let aetB;       // bridged on B
const ZERO32 = ethers.ZeroHash;
const pad = (a) => ethers.zeroPadValue(a, 32);
const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
const errorName = (e) => {
  const data = e.data ?? e.info?.error?.data;
  try { return iface.parseError(data)?.name ?? new ethers.Interface(artifacts.StableToken.abi).parseError(data)?.name; } catch { return e.message; }
};
const fails = (pending, name) => assert.rejects(pending, (e) => { assert.equal(errorName(e), name); return true; });
const sign = (id, keys = validators) => keys.map((v) => ethers.Signature.from(new ethers.SigningKey(v.privateKey).sign(ethers.hashMessage(ethers.getBytes(id)))).serialized);
const msg = (o) => ({ srcChain: Number(B.id), dstChain: Number(A.id), nonce: 1, srcToken: ZERO32, recipient: bob.address, amount: 1n, ...o });

/** Carries a Sent event to the other side like the relayer: builds the message and has the validators sign it. */
async function relay(src, dst, gateSrc, gateDst, receipt, signers = validators.slice(0, 2)) {
  const log = receipt.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'Sent');
  const m = { srcChain: Number(src.id), dstChain: Number(log.args.dstChain), nonce: log.args.nonce, srcToken: pad(log.args.token), recipient: ethers.getAddress(log.args.recipient), amount: log.args.amount };
  const id = await gateDst.messageId(m);
  return { m, id, signatures: sign(id, signers) };
}

test.before(async () => {
  for (const side of [A, B]) {
    await side.node.start();
    side.provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${side.node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
    await side.mine();
  }
  const list = validators.map((v) => v.address);
  gateA = await A.deploy('BridgeGateway', admin.address, guardian.address, list, 2);
  gateB = await B.deploy('BridgeGateway', admin.address, guardian.address, list, 2);
  usdc = await B.deploy('StableToken', 'USD Coin', 'USDC', 6, admin.address);
  await B.ok(usdc.configureMinter(admin.address, 10n ** 15n));
  await B.ok(usdc.mint(alice.address, 5_000_000_000n));

  // Routes: USDC from B is minted on A and released on the way back. QU from A is minted on B and released on the way back.
  const r = await A.ok(gateA.createWrapped('USD Coin (bridged)', 'USDC.a', 6, Number(B.id), pad(await usdc.getAddress()), 1_000_000_000n, 500_000_000n));
  usdcA = new ethers.Contract(iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token, artifacts.WrappedAsset.abi, A.provider);
  const r2 = await B.ok(gateB.createWrapped('Aether (bridged)', 'AET.e', 18, Number(A.id), ZERO32, 100n * WEI, 50n * WEI));
  aetB = new ethers.Contract(iface.parseLog(r2.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token, artifacts.WrappedAsset.abi, B.provider);
  await B.ok(gateB.setOutbound(await usdc.getAddress(), Number(A.id), true, false, 1n));
  await B.ok(gateB.setOutbound(await aetB.getAddress(), Number(A.id), true, true, 1n));
  await A.ok(gateA.setOutbound(await usdcA.getAddress(), Number(B.id), true, true, 1n));
  await A.ok(gateA.setOutbound(ethers.ZeroAddress, Number(B.id), true, false, 1n));
  await B.ok(gateB.setRoute(Number(A.id), pad(await usdcA.getAddress()), await usdc.getAddress(), false, true, 10n ** 12n, 10n ** 11n));
  await A.ok(gateA.setRoute(Number(B.id), pad(await aetB.getAddress()), ethers.ZeroAddress, false, true, 100n * WEI, 50n * WEI));
});

test.after(async () => {
  for (const side of [A, B]) { side.provider.destroy(); await side.node.stop(); }
});

test('USDC goes there and back and the backing matches', async () => {
  const b = gateB.connect(B.connect(alice));
  const token = usdc.connect(B.connect(alice));
  const gateAddress = await gateB.getAddress();
  await B.ok(token.approve(gateAddress, 200_000_000n));
  const sent = await B.ok(b.send(await usdc.getAddress(), 200_000_000n, Number(A.id), alice.address));
  assert.equal(await usdc.balanceOf(gateAddress), 200_000_000n);
  const { m, signatures } = await relay(B, A, gateB, gateA, sent);
  await A.ok(gateA.connect(A.connect(mallory)).deliver(m, signatures));
  assert.equal(await usdcA.balanceOf(alice.address), 200_000_000n, 'doručit může kdokoli, mince jdou příjemci');
  await fails(gateA.deliver.staticCall(m, signatures), 'AlreadyDelivered');

  const back = await A.ok(gateA.connect(A.connect(alice)).send(await usdcA.getAddress(), 150_000_000n, Number(B.id), alice.address));
  assert.equal(await usdcA.totalSupply(), 50_000_000n);
  const r = await relay(A, B, gateA, gateB, back);
  await B.ok(gateB.deliver(r.m, r.signatures));
  assert.equal(await usdc.balanceOf(alice.address), 4_950_000_000n);
  assert.equal(await gateB.locked(await usdc.getAddress()), 50_000_000n);
  assert.equal(await usdc.balanceOf(gateAddress), await usdcA.totalSupply(), 'uzamčeno je přesně tolik, kolik je přemostěno');
});

test('the main coin QU goes to the other chain and back', async () => {
  const before = await A.provider.getBalance(bob.address);
  const sent = await A.ok(gateA.connect(A.connect(bob)).send(ethers.ZeroAddress, 10n * WEI, Number(B.id), bob.address, { value: 10n * WEI }));
  assert.equal(await gateA.locked(ethers.ZeroAddress), 10n * WEI);
  const { m, signatures } = await relay(A, B, gateA, gateB, sent);
  await B.ok(gateB.deliver(m, signatures));
  assert.equal(await aetB.balanceOf(bob.address), 10n * WEI);
  const back = await B.ok(gateB.connect(B.connect(bob)).send(await aetB.getAddress(), 4n * WEI, Number(A.id), bob.address));
  const r = await relay(B, A, gateB, gateA, back);
  await A.ok(gateA.deliver(r.m, r.signatures));
  assert.equal(await gateA.locked(ethers.ZeroAddress), 6n * WEI);
  assert.ok((await A.provider.getBalance(bob.address)) > before - 7n * WEI);
  await fails(gateA.connect(A.connect(bob)).send.staticCall(ethers.ZeroAddress, 2n, Number(B.id), bob.address, { value: 1n }), 'BadValue');
  await fails(gateA.connect(A.connect(bob)).send.staticCall(ethers.ZeroAddress, 1n, 999, bob.address, { value: 1n }), 'RouteClosed');
});

test('a forged delivery does not pass', async () => {
  const srcToken = pad(await usdc.getAddress());
  const m = msg({ nonce: 77, srcToken, recipient: mallory.address, amount: 1000n });
  const id = await gateA.messageId(m);
  await fails(gateA.deliver.staticCall(m, []), 'NotEnoughSignatures');
  await fails(gateA.deliver.staticCall(m, sign(id, validators.slice(0, 1))), 'NotEnoughSignatures');
  await fails(gateA.deliver.staticCall(m, sign(id, [validators[0], validators[0]])), 'BadSignature');
  await fails(gateA.deliver.staticCall(m, sign(id, [validators[1], validators[0]])), 'BadSignature');
  await fails(gateA.deliver.staticCall(m, sign(id, [validators[0], mallory].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1)))), 'BadSignature');
  // A message signature for a small amount must not be valid for a large one or for another recipient.
  const small = sign(id, validators.slice(0, 2));
  await fails(gateA.deliver.staticCall({ ...m, amount: 999_999n }, small), 'BadSignature');
  await fails(gateA.deliver.staticCall({ ...m, recipient: alice.address }, small), 'BadSignature');
  // Signature for a foreign gateway.
  const other = await gateB.messageId({ ...m, dstChain: Number(B.id), srcChain: Number(A.id) });
  await fails(gateA.deliver.staticCall({ ...m, dstChain: Number(B.id), srcChain: Number(A.id) }, sign(other, validators.slice(0, 2))), 'WrongChain');
  const unknown = msg({ nonce: 78, srcToken: pad(alice.address) });
  await fails(gateA.deliver.staticCall(unknown, sign(await gateA.messageId(unknown), validators.slice(0, 2))), 'RouteClosed');
  await assert.rejects(usdcA.connect(A.connect(admin)).bridgeMint.staticCall(mallory.address, 1n), (e) => /0x|OnlyGateway/.test(String(e.data ?? e.message)));
  await fails(gateA.connect(A.connect(mallory)).attest.staticCall(id, sign(id, [mallory])[0]), 'BadSignature');
  await A.ok(gateA.attest(id, small[0]));
});

test('a large transfer waits and the guardian can stop it', async () => {
  const srcToken = pad(await usdc.getAddress());
  const big = msg({ nonce: 100, srcToken, recipient: alice.address, amount: 600_000_000n });
  const signatures = sign(await gateA.messageId(big), validators.slice(0, 2));
  const before = await usdcA.balanceOf(alice.address);
  await A.ok(gateA.deliver(big, signatures));
  assert.equal(await usdcA.balanceOf(alice.address), before, 'nad hranicí nic neprošlo hned');
  await fails(gateA.executeQueued.staticCall(big), 'NotReady');
  await fails(gateA.deliver.staticCall(big, signatures), 'AlreadyDelivered');
  await A.mine(DAY + 60);
  await A.ok(gateA.connect(A.connect(mallory)).executeQueued(big));
  assert.equal(await usdcA.balanceOf(alice.address), before + 600_000_000n);
  await fails(gateA.executeQueued.staticCall(big), 'NotQueued');

  const stolen = msg({ nonce: 101, srcToken, recipient: mallory.address, amount: 700_000_000n });
  const id = await gateA.messageId(stolen);
  await A.ok(gateA.deliver(stolen, sign(id, validators.slice(0, 2))));
  await fails(gateA.connect(A.connect(mallory)).cancelQueued.staticCall(id), 'NotGuardian');
  await A.ok(gateA.connect(A.connect(guardian)).cancelQueued(id));
  await A.mine(DAY + 60);
  await fails(gateA.executeQueued.staticCall(stolen), 'NotQueued');
  assert.equal(await usdcA.balanceOf(mallory.address), 0n);
});

test('a queued transfer is not paid in another token when the route is remapped while it waits', async () => {
  const srcToken = pad(await usdc.getAddress());
  const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint64', 'bytes32'], [Number(B.id), srcToken]));
  const route = await gateA.routes(key);
  const big = msg({ nonce: 110, srcToken, recipient: alice.address, amount: 600_000_000n });
  await A.ok(gateA.deliver(big, sign(await gateA.messageId(big), validators.slice(0, 2))));
  await A.mine(DAY + 60);
  // The admin points the route at a different token in the meantime.
  await A.ok(gateA.connect(A.connect(admin)).setRoute(Number(B.id), srcToken, bob.address, false, true, route.dailyLimit, route.largeAmount));
  await fails(gateA.executeQueued.staticCall(big), 'RouteChangedWhileQueued');
  // Back to the original token, the transfer goes through as queued.
  await A.ok(gateA.connect(A.connect(admin)).setRoute(Number(B.id), srcToken, route.local, route.wrapped, true, route.dailyLimit, route.largeAmount));
  const before = await usdcA.balanceOf(alice.address);
  await A.ok(gateA.executeQueued(big));
  assert.equal(await usdcA.balanceOf(alice.address), before + 600_000_000n);
});

test('a cancelled transfer never goes through and only the guardian, the administrator or the recipient may cancel it', async () => {
  const srcToken = pad(await usdc.getAddress());
  const m = msg({ nonce: 120, srcToken, recipient: alice.address, amount: 5_000_000n });
  const id = await gateA.messageId(m);
  const signatures = sign(id, validators.slice(0, 2));
  assert.equal(await gateA.cancelled(id), false);
  await fails(gateA.connect(A.connect(mallory)).cancelDelivery.staticCall(m), 'NotGuardian');
  // A message for another network cannot be cancelled in this gateway, not even by the recipient.
  await fails(gateA.connect(A.connect(alice)).cancelDelivery.staticCall({ ...m, dstChain: Number(B.id) }), 'WrongChain');
  // The recipient rejects the transfer: on the source network the validators then refund it to the sender.
  await A.ok(gateA.connect(A.connect(alice)).cancelDelivery(m));
  assert.equal(await gateA.cancelled(id), true);
  await fails(gateA.deliver.staticCall(m, signatures), 'AlreadyDelivered');
  await fails(gateA.executeQueued.staticCall(m), 'NotQueued');
  await fails(gateA.connect(A.connect(guardian)).cancelDelivery.staticCall(m), 'AlreadyDelivered');
  await A.mine(DAY + 60);
  await fails(gateA.deliver.staticCall(m, signatures), 'AlreadyDelivered');

  // A delivered transfer cannot be cancelled: a refund would then pay twice.
  const paid = msg({ nonce: 121, srcToken, recipient: alice.address, amount: 1_000_000n });
  const paidId = await gateA.messageId(paid);
  await A.ok(gateA.deliver(paid, sign(paidId, validators.slice(0, 2))));
  await fails(gateA.connect(A.connect(guardian)).cancelDelivery.staticCall(paid), 'AlreadyDelivered');
  assert.equal(await gateA.cancelled(paidId), false);

  // The guardian cancels a queued transfer this way too, and it never leaves the queue.
  const big = msg({ nonce: 122, srcToken, recipient: alice.address, amount: 600_000_000n });
  const bigId = await gateA.messageId(big);
  await A.ok(gateA.deliver(big, sign(bigId, validators.slice(0, 2))));
  await A.ok(gateA.connect(A.connect(guardian)).cancelDelivery(big));
  await A.mine(DAY + 60);
  await fails(gateA.executeQueued.staticCall(big), 'NotQueued');
  assert.equal(await gateA.cancelled(bigId), true);
  // After completion from the queue, cancelling is no longer possible.
  const late = msg({ nonce: 123, srcToken, recipient: alice.address, amount: 600_000_000n });
  const lateId = await gateA.messageId(late);
  await A.ok(gateA.deliver(late, sign(lateId, validators.slice(0, 2))));
  await A.mine(DAY + 60);
  await A.ok(gateA.executeQueued(late));
  await fails(gateA.connect(A.connect(admin)).cancelDelivery.staticCall(late), 'AlreadyDelivered');
  assert.equal(await gateA.cancelled(lateId), false);
});

test('the daily limit sends further transfers to the queue and a new day resets it', async () => {
  await A.mine(DAY);
  const srcToken = pad(await usdc.getAddress());
  const go = async (nonce, amount) => {
    const m = msg({ nonce, srcToken, recipient: bob.address, amount });
    return A.ok(gateA.deliver(m, sign(await gateA.messageId(m), validators.slice(0, 2))));
  };
  const start = await usdcA.balanceOf(bob.address);
  await go(200, 450_000_000n);
  await go(201, 450_000_000n);
  await go(202, 450_000_000n);
  assert.equal(await usdcA.balanceOf(bob.address), start + 900_000_000n, 'třetí překročil limit');
  await A.mine(DAY);
  await go(203, 450_000_000n);
  assert.equal(await usdcA.balanceOf(bob.address), start + 1_350_000_000n);
});

test('emergency stop and validator change', async () => {
  const srcToken = pad(await usdc.getAddress());
  const m = msg({ nonce: 300, srcToken, recipient: bob.address, amount: 1n });
  const signatures = sign(await gateA.messageId(m), validators.slice(0, 2));
  await fails(gateA.connect(A.connect(mallory)).pause.staticCall(), 'NotGuardian');
  await A.ok(gateA.connect(A.connect(guardian)).pause());
  await fails(gateA.deliver.staticCall(m, signatures), 'IsPaused');
  await fails(gateA.connect(A.connect(alice)).send.staticCall(ethers.ZeroAddress, 1n, Number(B.id), alice.address, { value: 1n }), 'IsPaused');
  await fails(gateA.connect(A.connect(guardian)).unpause.staticCall(), 'NotAdmin');
  await A.ok(gateA.unpause());

  await fails(gateA.connect(A.connect(mallory)).proposeValidators.staticCall([mallory.address, alice.address], 2), 'NotAdmin');
  await fails(gateA.proposeValidators.staticCall([alice.address], 1), 'BadSettings');
  await fails(gateA.proposeValidators.staticCall([alice.address, bob.address, guardian.address, mallory.address], 2), 'BadSettings');
  const list = validators.map((v) => v.address);
  const newcomer = ethers.Wallet.createRandom();
  await A.ok(gateA.proposeValidators([...list.slice(1), newcomer.address], 2));
  await fails(gateA.applyValidators.staticCall(), 'NotReady');
  await A.mine(2 * DAY + 60);
  await A.ok(gateA.applyValidators());
  assert.equal(await gateA.isValidator(validators[0].address), false);
  assert.equal(await gateA.isValidator(newcomer.address), true);
  await fails(gateA.deliver.staticCall(m, signatures), 'BadSignature');
});

test('a token with a transfer fee and a hostile recipient do not damage the gateway', async () => {
  const solc = createRequire(import.meta.url)('solc');
  const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract FeeToken {
  mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
  constructor() { balanceOf[msg.sender] = 1e24; }
  function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
  function transferFrom(address f, address t, uint256 v) external returns (bool) { allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[t] += v - v / 100; return true; }
}
contract Thief {
  address g; bytes data; uint256 public hits;
  constructor(address g_) { g = g_; }
  function prepare(bytes calldata d) external { data = d; }
  receive() external payable { hits++; (bool ok,) = g.call(data); require(!ok, "znovu"); }
}`;
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'A.sol': { content: source } }, settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const deploy = async (side, name, ...args) => {
    const art = out.contracts['A.sol'][name];
    const c = await new ethers.ContractFactory(art.abi, `0x${art.evm.bytecode.object}`, side.connect(admin)).deploy(...args);
    await side.mine();
    return c;
  };
  const fee = await deploy(B, 'FeeToken');
  await B.ok(fee.approve(await gateB.getAddress(), 10n ** 20n));
  await B.ok(gateB.setOutbound(await fee.getAddress(), Number(A.id), true, false, 1n));
  await fails(gateB.send.staticCall(await fee.getAddress(), 1000n, Number(A.id), alice.address), 'BadValue');

  // Releasing QU to a hostile contract: an attempt at re-entrancy during the payment fails.
  const thief = await deploy(A, 'Thief', await gateA.getAddress());
  const thiefAddress = await thief.getAddress();
  const source2 = pad(await aetB.getAddress());
  const m = msg({ nonce: 400, srcToken: source2, recipient: thiefAddress, amount: WEI });
  const list = [...validators.slice(1)];
  const id = await gateA.messageId(m);
  await A.ok(thief.prepare(iface.encodeFunctionData('deliver', [{ ...m, nonce: 401 }, []])));
  // The group changed in the previous test; the two remaining original validators sign.
  await A.ok(gateA.deliver(m, sign(id, list), { gasLimit: 2_000_000 }));
  assert.equal(await thief.hits(), 1n);
  assert.equal(await A.provider.getBalance(thiefAddress), WEI);
});

test('issuer stablecoin: minting limits, blocking, pausing and gasless signatures', async () => {
  const token = usdc.connect(B.connect(admin));
  await fails(usdc.connect(B.connect(mallory)).mint.staticCall(mallory.address, 1n), 'MintAllowanceExceeded');
  await B.ok(token.configureMinter(bob.address, 100n));
  await B.ok(usdc.connect(B.connect(bob)).mint(bob.address, 60n));
  await fails(usdc.connect(B.connect(bob)).mint.staticCall(bob.address, 41n), 'MintAllowanceExceeded');
  assert.equal(await usdc.minterAllowance(bob.address), 40n);
  await assert.rejects(usdc.connect(B.connect(mallory)).configureMinter.staticCall(mallory.address, 1n));
  await B.ok(token.setBlocked(mallory.address, true));
  await B.ok(usdc.connect(B.connect(bob)).transfer(alice.address, 10n));
  await fails(usdc.connect(B.connect(bob)).transfer.staticCall(mallory.address, 1n), 'AccountBlocked');
  await B.ok(token.setBlocked(mallory.address, false));
  await B.ok(token.pause());
  await assert.rejects(usdc.connect(B.connect(bob)).transfer.staticCall(alice.address, 1n));
  await B.ok(token.unpause());
  const owner = bob;
  const spender = alice;
  const deadline = 2n ** 48n;
  const domain = { name: 'USD Coin', version: '1', chainId: B.id, verifyingContract: await usdc.getAddress() };
  const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  const nonce = await usdc.nonces(owner.address);
  const sig = ethers.Signature.from(await owner.signTypedData(domain, types, { owner: owner.address, spender: spender.address, value: 5n, nonce, deadline }));
  await B.ok(usdc.connect(B.connect(spender)).permit(owner.address, spender.address, 5n, deadline, sig.v, sig.r, sig.s));
  assert.equal(await usdc.allowance(owner.address, spender.address), 5n);
});

test('only the owner may change the verified token list', async () => {
  const r = await A.deploy('TokenRegistry', admin.address);
  const address = await usdcA.getAddress();
  await assert.rejects(r.connect(A.connect(mallory)).add.staticCall(address, 1, 'Podvod', ''));
  await A.ok(r.add(address, 1, 'Aether Bridge', 'https://example.org/usdc.png'));
  await assert.rejects(r.add.staticCall(address, 1, 'Znovu', ''));
  assert.equal((await r.all()).length, 1);
  assert.equal((await r.all())[0].issuer, 'Aether Bridge');
  await A.ok(r.remove(address));
  assert.equal((await r.all()).length, 0);
  assert.equal(await r.listed(address), false);
});

test('a new gateway on the same chain does not issue a number or ID the old one issued', async () => {
  const list = validators.map((v) => v.address);
  const fresh = await A.deploy('BridgeGateway', admin.address, guardian.address, list, 2);
  await A.ok(fresh.setOutbound(ethers.ZeroAddress, Number(B.id), true, false, 1n));
  const sentLog = (r) => r.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'Sent');
  const a = sentLog(await A.ok(gateA.connect(A.connect(alice)).send(ethers.ZeroAddress, 5n, Number(B.id), bob.address, { value: 5n })));
  const b = sentLog(await A.ok(fresh.connect(A.connect(alice)).send(ethers.ZeroAddress, 5n, Number(B.id), bob.address, { value: 5n })));
  assert.equal(await fresh.nextNonce() & 0xffffffffn, 2n, 'dolní polovina počítá od jedné');
  assert.notEqual(a.args.nonce >> 32n, b.args.nonce >> 32n, 'horní polovina čísla je podle adresy brány');
  assert.notEqual(a.args.id, b.args.id);
  // The same message from both gateways gives different IDs in the target gateway; delivering one does not block the other.
  const at = (log) => gateB.messageId({ srcChain: Number(A.id), dstChain: Number(B.id), nonce: log.args.nonce, srcToken: ZERO32, recipient: bob.address, amount: 5n });
  assert.notEqual(await at(a), await at(b));
});

test('the gateway does not accept a signature of the bare ID without the prefix', async () => {
  const m = msg({ nonce: 500, srcToken: pad(await usdc.getAddress()), recipient: bob.address, amount: 1n });
  const id = await gateA.messageId(m);
  const raw = validators.slice(0, 2).map((v) => new ethers.SigningKey(v.privateKey).sign(id).serialized);
  await fails(gateA.deliver.staticCall(m, raw), 'BadSignature');
  await fails(gateA.attest.staticCall(id, raw[0]), 'BadSignature');
});
