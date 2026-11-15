// System contracts on a real node, including abuse attempts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { AetherNode, loadAlloc } from '../../node/src/node.js';
import { NETWORKS, WEI } from '../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../node/test/helpers/chain.js';

const artifacts = JSON.parse(readFileSync(new URL('../dist/artifacts.json', import.meta.url)));
const net = { ...NETWORKS.dev };
const [alice, bob, carol, dave] = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
let clock = Number(net.genesisTimestamp);

const alloc = { ...loadAlloc() };
for (const w of [alice, bob, carol, dave]) alloc[w.address] = { balance: 10000n * WEI };
const node = new AetherNode({
  network: net, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
  alloc, now: () => clock, log: () => {},
});

let provider;
const contract = (name, signer = alice) => new ethers.Contract(artifacts[name].address, artifacts[name].abi, signer.connect(provider));

async function mineBlock() {
  clock += 15;
  const w = await node.work.getWork(ethers.getBytes('0x' + 'bb'.repeat(20)));
  const tpl = node.work.templates.get('0x' + Buffer.from(w.sealHash).toString('hex'));
  const sealed = await seal(node.chain, tpl);
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  assert.ok(r.accepted, r.reason);
  await node.mempool.settled();
}

async function ok(pending) {
  const tx = await pending;
  await mineBlock();
  const r = await provider.getTransactionReceipt(tx.hash);
  assert.equal(r.status, 1);
  return r;
}

// Selectors of all custom errors by name; ethers does not name them during gas estimation.
const errorSelectors = new Map();
for (const a of Object.values(artifacts)) {
  for (const f of new ethers.Interface(a.abi).fragments) {
    if (f.type === 'error') errorSelectors.set(f.selector, f.name);
  }
}

const fails = (pending, name) => assert.rejects(pending, (e) => {
  const got = e.revert?.name ?? errorSelectors.get(e.data?.slice(0, 10)) ?? e.message;
  assert.equal(got, name);
  return true;
});

test.before(async () => {
  await node.start();
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
});
test.after(async () => { provider.destroy(); await node.stop(); });

test('all contracts are in genesis; the pool factory is added by a fork at block 1', async () => {
  await mineBlock();
  for (const [name, a] of Object.entries(artifacts)) {
    if (a.address) assert.notEqual(await provider.getCode(a.address), '0x', name);
  }
});

test('notary: document fingerprint, duplicate, revocation only by the author', async () => {
  const n = contract('Notary');
  const hash = ethers.id('smlouva.pdf');
  await ok(n.notarize(hash, 'Kupní smlouva'));
  const [exists, ts, revoked, note] = await n.verify(hash, alice.address);
  assert.ok(exists); assert.ok(ts > 0n); assert.equal(revoked, 0n); assert.equal(note, 'Kupní smlouva');
  assert.equal(await n.firstAuthor(hash), alice.address);
  await fails(n.notarize(hash, 'znovu'), 'AlreadyNotarized');
  await fails(contract('Notary', bob).revoke(hash, 'cizí'), 'NotFound');
  await ok(n.revoke(hash, 'nahrazeno'));
  assert.ok((await n.verify(hash, alice.address))[2] > 0n);
  await fails(n.revoke(hash, 'znovu'), 'AlreadyRevoked');
  assert.equal((await n.verify(ethers.id('jiný'), alice.address))[0], false);
});

test("notary: whoever copies a fingerprint from pending transactions cannot block or revoke someone else's record", async () => {
  const hash = ethers.id('tajny-dokument.pdf');
  const thief = contract('Notary', dave);
  await ok(thief.notarize(hash, 'předběhnuto'));
  await ok(thief.revoke(hash, 'schválně'));
  await ok(contract('Notary').notarize(hash, 'pravý zápis'));
  const [exists, , revoked, note] = await contract('Notary').verify(hash, alice.address);
  assert.ok(exists); assert.equal(revoked, 0n, 'zápis oběti není odvolaný'); assert.equal(note, 'pravý zápis');
});

const nameSecret = ethers.id('tajemstvi');
async function commitName(c, name, owner, target) {
  await ok(c.commit(await c.commitment(name, owner, target, nameSecret)));
  clock += 61;
  await mineBlock();
}

test('names: registration, fee burning, price, expiry, owner protection', async () => {
  const ans = contract('AetherNames');
  const bobs = contract('AetherNames', bob);
  assert.equal(await ans.pricePerYear('abc'), 50n * WEI);
  assert.equal(await ans.pricePerYear('abcd'), 10n * WEI);
  assert.equal(await ans.pricePerYear('alice'), WEI);
  const zero = await provider.getBalance(ethers.ZeroAddress);
  await commitName(ans, 'alice', alice.address, alice.address);
  await ok(ans.register('alice', 2, alice.address, nameSecret, { value: 2n * WEI }));
  assert.equal(await provider.getBalance(ethers.ZeroAddress), zero + 2n * WEI, 'poplatek je spálen');
  assert.equal(await provider.getBalance(artifacts.AetherNames.address), 0n, 'kontrakt nic nedrží');
  assert.equal(await ans.resolve('alice'), alice.address);
  await ok(ans.setPrimary('alice'));
  assert.equal(await ans.nameOf(alice.address), 'alice');
  await fails(bobs.register('alice', 1, bob.address, nameSecret, { value: WEI }), 'Unavailable');
  await fails(bobs.setTarget('alice', bob.address), 'NotOwner');
  await fails(bobs.transfer('alice', bob.address), 'NotOwner');
  await fails(ans.register('Spatne', 1, alice.address, nameSecret, { value: WEI }), 'InvalidName');
  await fails(ans.register('-spatne', 1, alice.address, nameSecret, { value: WEI }), 'InvalidName');
  await commitName(ans, 'platne', alice.address, alice.address);
  await fails(ans.register('platne', 1, alice.address, nameSecret, { value: 1n }), 'WrongPayment');
  await ok(ans.renew('alice', 1, { value: WEI }));
  await ok(ans.transfer('alice', bob.address));
  await fails(ans.setTarget('alice', alice.address), 'NotOwner');
  clock += 3 * 365 * 86400 + 86400;
  await mineBlock();
  assert.equal(await ans.resolve('alice'), ethers.ZeroAddress, 'jméno vypršelo');
  assert.equal(await ans.nameOf(alice.address), '');
  clock += 31 * 86400;
  await mineBlock();
  const carols = contract('AetherNames', carol);
  await commitName(carols, 'alice', carol.address, carol.address);
  await ok(carols.register('alice', 1, carol.address, nameSecret, { value: WEI }));
  assert.equal(await ans.resolve('alice'), carol.address);
});

test('names: registration cannot be front-run or done without the waiting period', async () => {
  const ans = contract('AetherNames');
  const thief = contract('AetherNames', dave);
  await fails(ans.register('bezzavazku', 1, alice.address, nameSecret, { value: WEI }), 'CommitmentMissing');
  await ok(ans.commit(await ans.commitment('vzacne', alice.address, alice.address, nameSecret)));
  await fails(ans.register('vzacne', 1, alice.address, nameSecret, { value: WEI }), 'CommitmentTooNew');
  clock += 61;
  await mineBlock();
  // The attacker sees the name and the secret in the pending transaction, but the commitment belongs to another address.
  await fails(thief.register('vzacne', 1, dave.address, nameSecret, { value: WEI }), 'CommitmentMissing');
  await ok(ans.register('vzacne', 1, alice.address, nameSecret, { value: WEI }));
  assert.equal(await ans.resolve('vzacne'), alice.address);
  await ok(ans.commit(await ans.commitment('staryzavazek', alice.address, alice.address, nameSecret)));
  clock += 2 * 86400;
  await mineBlock();
  await fails(ans.register('staryzavazek', 1, alice.address, nameSecret, { value: WEI }), 'CommitmentMissing');
});

test('credentials: issuing, verification, expiry, revocation', async () => {
  const c = contract('Credentials');
  const id = ethers.id('diplom-123');
  const schema = ethers.id('vysokoskolsky-diplom');
  const issuer = alice.address;
  await fails(c.issue(id, bob.address, schema, 0), 'NotIssuer');
  await ok(c.registerIssuer('Masarykova univerzita', 'muni.cz'));
  await ok(c.issue(id, bob.address, schema, 0));
  assert.ok(await c.isValid(issuer, id));
  assert.equal((await c.get(issuer, id)).subject, bob.address);
  await fails(c.issue(id, bob.address, schema, 0), 'AlreadyIssued');
  await fails(contract('Credentials', bob).revoke(id, 'x'), 'NotFound');
  const expiring = ethers.id('licence');
  const until = BigInt(clock + 1000);
  await ok(c.issue(expiring, bob.address, schema, until));
  assert.ok(await c.isValid(issuer, expiring));
  clock += 2000;
  await mineBlock();
  assert.equal(await c.isValid(issuer, expiring), false, 'licence vypršela');
  await ok(c.revoke(id, 'chyba v údajích'));
  assert.equal(await c.isValid(issuer, id), false);
  assert.equal(await c.isValid(issuer, ethers.id('neexistuje')), false);
});

test('credentials: a foreign issuer cannot claim a document number first and a forgery does not verify', async () => {
  const id = ethers.id('diplom-456');
  const schema = ethers.id('vysokoskolsky-diplom');
  const fake = contract('Credentials', dave);
  await ok(fake.registerIssuer('Masarykova univerzita', 'muni.cz'));
  await ok(fake.issue(id, dave.address, schema, 0));
  assert.equal(await contract('Credentials').isValid(alice.address, id), false, 'pravý vydavatel padělek neuzná');
  await ok(contract('Credentials').issue(id, bob.address, schema, 0));
  assert.ok(await contract('Credentials').isValid(alice.address, id));
  assert.equal((await contract('Credentials').get(alice.address, id)).subject, bob.address);
});

test('supply chain: steps, two-sided hand-over, closing', async () => {
  const s = contract('SupplyChain');
  const r = await ok(s.create('KAVA-2026-001'));
  const id = s.interface.parseLog(r.logs[0]).args.id;
  await ok(s.addStep(id, 'Etiopie, Sidama', 'sklizeno', ethers.id('foto')));
  const bobs = contract('SupplyChain', bob);
  await fails(bobs.addStep(id, 'x', 'y', ethers.ZeroHash), 'NotCustodian');
  await fails(bobs.offerTransfer(id, bob.address), 'NotCustodian');
  await fails(bobs.acceptTransfer(id), 'NotPending');
  await ok(s.offerTransfer(id, bob.address));
  await fails(contract('SupplyChain', carol).acceptTransfer(id), 'NotPending');
  await ok(bobs.acceptTransfer(id));
  await ok(bobs.addStep(id, 'Hamburk, přístav', 'vyloženo', ethers.ZeroHash));
  const item = await s.getItem(id);
  assert.equal(item.custodian, bob.address);
  assert.equal(item.stepCount, 2n);
  assert.equal((await s.getStep(id, 1)).location, 'Hamburk, přístav');
  await ok(bobs.close(id));
  await fails(bobs.addStep(id, 'x', 'y', ethers.ZeroHash), 'Closed');
  await fails(s.getItem(999), 'UnknownItem');
});

test('escrow: release, refund after the deadline, dispute and arbitration', async () => {
  const e = contract('Escrow');
  const as = (w) => contract('Escrow', w);
  const newDeal = async (fee = 100) => {
    const r = await ok(e.create(bob.address, carol.address, clock + 1000, fee, 'Záloha', { value: 10n * WEI }));
    return e.interface.parseLog(r.logs[0]).args.id;
  };
  await fails(e.create(alice.address, carol.address, clock + 100, 0, 'x', { value: WEI }), 'InvalidDeal');
  await fails(e.create(bob.address, carol.address, clock + 100, 5000, 'x', { value: WEI }), 'InvalidDeal');

  const a = await newDeal();
  await fails(as(bob).release(a), 'NotAllowed');
  await fails(as(carol).release(a), 'NotAllowed');
  await ok(e.release(a));
  assert.equal(await e.credits(bob.address), 10n * WEI);
  await fails(e.release(a), 'WrongState');
  const before = await provider.getBalance(bob.address);
  await ok(as(bob).withdraw());
  assert.ok((await provider.getBalance(bob.address)) > before + 9n * WEI);
  await fails(as(bob).withdraw(), 'NothingToWithdraw');

  const b = await newDeal();
  await fails(e.refund(b), 'TooEarly');
  clock += 2000;
  await mineBlock();
  await ok(e.refund(b));
  assert.equal(await e.credits(alice.address), 10n * WEI);

  const c = await newDeal(100);
  await fails(as(carol).resolve(c, 5000), 'WrongState');
  await ok(as(bob).dispute(c));
  await fails(e.resolve(c, 5000), 'NotAllowed');
  await fails(as(bob).resolve(c, 10000), 'NotAllowed');
  const sellerBefore = await e.credits(bob.address);
  await ok(as(carol).resolve(c, 7000));
  assert.equal(await e.credits(carol.address), WEI / 10n, 'rozhodce dostal 1 %');
  assert.equal((await e.credits(bob.address)) - sellerBefore, (99n * WEI / 10n) * 7000n / 10000n);
  const total = (await e.credits(alice.address)) + (await e.credits(bob.address)) + (await e.credits(carol.address));
  assert.equal(total, await provider.getBalance(artifacts.Escrow.address), 'kontrakt drží přesně to, co dluží');
});

test('escrow: when the arbiter disappears, the money does not stay locked', async () => {
  const e = contract('Escrow');
  const r = await ok(e.create(bob.address, carol.address, clock + 1000, 100, 'Záloha', { value: 9n * WEI }));
  const id = e.interface.parseLog(r.logs[0]).args.id;
  await fails(e.settleAbandoned(id), 'WrongState');
  await ok(e.dispute(id));
  await fails(e.settleAbandoned(id), 'TooEarly');
  await fails(contract('Escrow', carol).settleAbandoned(id), 'NotAllowed');
  clock += 90 * 86400 + 1;
  await mineBlock();
  await fails(contract('Escrow', dave).settleAbandoned(id), 'NotAllowed');
  const [buyer, seller, arbiter] = await Promise.all([e.credits(alice.address), e.credits(bob.address), e.credits(carol.address)]);
  await ok(contract('Escrow', bob).settleAbandoned(id));
  assert.equal((await e.credits(alice.address)) - buyer, 9n * WEI - 9n * WEI / 2n);
  assert.equal((await e.credits(bob.address)) - seller, 9n * WEI / 2n);
  assert.equal(await e.credits(carol.address), arbiter, 'rozhodce, který zmizel, nedostane nic');
  await fails(contract('Escrow', carol).resolve(id, 5000), 'WrongState');
});

test('polls: list of eligible voters, double vote, end', async () => {
  const p = contract('Polls');
  const leaf = (a) => ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address'], [a])));
  const pair = (x, y) => ethers.keccak256(ethers.concat(x < y ? [x, y] : [y, x]));
  const [la, lb, lc, ld] = [alice, bob, carol, dave].map((w) => leaf(w.address));
  const n1 = pair(la, lb); const n2 = pair(lc, ld); const root = pair(n1, n2);
  const r = await ok(p.create('Nový park?', ['Ano', 'Ne'], root, clock + 1000));
  const id = p.interface.parseLog(r.logs[0]).args.id;
  await ok(p.vote(id, 0, [lb, n2]));
  await fails(p.vote(id, 1, [lb, n2]), 'AlreadyVoted');
  await ok(contract('Polls', bob).vote(id, 0, [la, n2]));
  await fails(contract('Polls', carol).vote(id, 2, [ld, n1]), 'InvalidOption');
  const outsider = ethers.Wallet.createRandom().connect(provider);
  await ok(alice.connect(provider).sendTransaction({ to: outsider.address, value: WEI }));
  await fails(contract('Polls', outsider).vote(id, 1, [lb, n2]), 'NotEligible');
  await ok(contract('Polls', carol).vote(id, 1, [ld, n1]));
  const [, choices, results] = await p.get(id);
  assert.deepEqual([...choices], ['Ano', 'Ne']);
  assert.deepEqual([...results], [2n, 1n]);
  clock += 2000;
  await mineBlock();
  await fails(contract('Polls', dave).vote(id, 0, [lc, n1]), 'PollEnded');
  await fails(p.create('x', ['jen jedna'], ethers.ZeroHash, clock + 100), 'InvalidPoll');
});

test('tokens: creation, transfer, minting only by the owner', async () => {
  const f = contract('TokenFactory');
  const r = await ok(f.create('Praha Body', 'PBD', 2, 100000, true));
  const addr = f.interface.parseLog(r.logs.at(-1)).args.token;
  const t = new ethers.Contract(addr, artifacts.AetherToken.abi, alice.connect(provider));
  assert.equal(await t.name(), 'Praha Body'); assert.equal(await t.decimals(), 2n);
  assert.equal(await t.balanceOf(alice.address), 100000n);
  await ok(t.transfer(bob.address, 500));
  assert.equal(await t.balanceOf(bob.address), 500n);
  await ok(t.mint(bob.address, 1));
  await assert.rejects(t.connect(bob.connect(provider)).mint(bob.address, 1));
  const r2 = await ok(f.create('Pevny', 'FIX', 18, 1000, false));
  const fixed = new ethers.Contract(f.interface.parseLog(r2.logs.at(-1)).args.token, artifacts.AetherToken.abi, alice.connect(provider));
  await fails(fixed.mint(alice.address, 1), 'MintingDisabled');
  assert.equal((await f.tokensOf(alice.address)).length, 2);
});

test('NFT: collection, minting and transfer', async () => {
  const f = contract('CollectionFactory');
  const r = await ok(f.create('Vstupenky 2027', 'VST'));
  const addr = f.interface.parseLog(r.logs.at(-1)).args.collection;
  const c = new ethers.Contract(addr, artifacts.AetherCollection.abi, alice.connect(provider));
  await ok(c.mint(bob.address, 'ipfs://vstupenka/1'));
  assert.equal(await c.ownerOf(1), bob.address);
  assert.equal(await c.tokenURI(1), 'ipfs://vstupenka/1');
  await assert.rejects(c.connect(bob.connect(provider)).mint(bob.address, 'x'));
  await ok(c.connect(bob.connect(provider)).transferFrom(bob.address, carol.address, 1));
  assert.equal(await c.ownerOf(1), carol.address);
});

test('multisig wallet: 2 of 3', async () => {
  const f = contract('MultisigFactory');
  const r = await ok(f.create([alice.address, bob.address, carol.address], 2));
  const addr = f.interface.parseLog(r.logs.at(-1)).args.wallet;
  const m = new ethers.Contract(addr, artifacts.Multisig.abi, alice.connect(provider));
  await ok(alice.connect(provider).sendTransaction({ to: addr, value: 5n * WEI }));
  await fails(m.connect(dave.connect(provider)).submit(dave.address, WEI, '0x'), 'NotOwner');
  await ok(m.submit(dave.address, WEI, '0x'));
  await fails(m.execute(0), 'NotEnoughConfirmations');
  await fails(m.confirm(0), 'AlreadyConfirmed');
  await ok(m.connect(bob.connect(provider)).confirm(0));
  const before = await provider.getBalance(dave.address);
  await ok(m.connect(carol.connect(provider)).confirm(0));
  await ok(m.execute(0));
  assert.equal(await provider.getBalance(dave.address), before + WEI);
  await fails(m.execute(0), 'AlreadyExecuted');
  await assert.rejects(f.create([alice.address, alice.address], 1));
  assert.equal((await f.walletsOf(bob.address)).length, 1);
});

test("multisig wallet: owner changes only through an approved proposal; a former member's approval does not count", async () => {
  const f = contract('MultisigFactory');
  const r = await ok(f.create([alice.address, bob.address, carol.address], 2));
  const addr = f.interface.parseLog(r.logs.at(-1)).args.wallet;
  const m = new ethers.Contract(addr, artifacts.Multisig.abi, alice.connect(provider));
  const asBob = m.connect(bob.connect(provider));
  await fails(m.removeOwner(carol.address), 'OnlyThroughProposal');
  await fails(m.addOwner(dave.address), 'OnlyThroughProposal');

  // Carol agrees to the payment, then leaves the wallet.
  await ok(alice.connect(provider).sendTransaction({ to: addr, value: 2n * WEI }));
  await ok(m.submit(dave.address, WEI, '0x'));                 // proposal 0: Alice
  await ok(m.connect(carol.connect(provider)).confirm(0));     // already 2 approvals
  const remove = m.interface.encodeFunctionData('removeOwner', [carol.address]);
  await ok(m.submit(addr, 0, remove));                         // proposal 1
  await ok(asBob.confirm(1));
  await ok(m.execute(1));
  assert.deepEqual([...(await m.getOwners())].sort(), [alice.address, bob.address].sort());
  assert.equal(await m.isOwner(carol.address), false);
  assert.equal(await m.confirmationCount(0), 1n, 'souhlas bývalého člena se nepočítá');
  await fails(m.execute(0), 'NotEnoughConfirmations');

  // Owners cannot be removed below the threshold.
  const again = m.interface.encodeFunctionData('removeOwner', [bob.address]);
  await ok(m.submit(addr, 0, again));
  await ok(asBob.confirm(2));
  await fails(m.execute(2), 'CallFailed');

  const add = m.interface.encodeFunctionData('addOwner', [dave.address]);
  await ok(m.submit(addr, 0, add));
  await ok(asBob.confirm(3));
  await ok(m.execute(3));
  const raise = m.interface.encodeFunctionData('setThreshold', [3]);
  await ok(m.submit(addr, 0, raise));
  await ok(asBob.confirm(4));
  await ok(m.execute(4));
  assert.equal(await m.threshold(), 3n);
});

test('wrapped QU and batched reads', async () => {
  const w = contract('WAET');
  await ok(w.deposit({ value: 3n * WEI }));
  assert.equal(await w.balanceOf(alice.address), 3n * WEI);
  await ok(w.approve(bob.address, WEI));
  await ok(w.connect(bob.connect(provider)).transferFrom(alice.address, carol.address, WEI));
  await fails(w.connect(bob.connect(provider)).transferFrom(alice.address, carol.address, 1), 'InsufficientAllowance');
  await ok(w.withdraw(2n * WEI));
  assert.equal(await w.totalSupply(), WEI);
  await fails(w.withdraw(WEI), 'InsufficientBalance');
  const m = contract('Multicall');
  const [balA] = await m.balances([alice.address]);
  assert.equal(balA, await provider.getBalance(alice.address));
  const call = w.interface.encodeFunctionData('balanceOf', [carol.address]);
  const [, results] = await m.aggregate([{ target: artifacts.WAET.address, data: call }]);
  assert.equal(BigInt(results[0].data), WEI);
});

test('a re-entrancy attack on escrow or WQU does not pass', async () => {
  const solc = (await import('node:module')).createRequire(import.meta.url)('solc');
  const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
interface E { function create(address,address,uint64,uint16,string calldata) external payable returns (uint256); function release(uint256) external; function withdraw() external; }
contract Attacker {
  E e; uint256 public hits;
  constructor(E e_) { e = e_; }
  function grab() external { e.withdraw(); }
  receive() external payable { hits++; if (hits < 5) { try e.withdraw() {} catch {} } }
}`;
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'A.sol': { content: source } }, settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const art = out.contracts['A.sol'].Attacker;
  const deployed = await new ethers.ContractFactory(art.abi, `0x${art.evm.bytecode.object}`, alice.connect(provider)).deploy(artifacts.Escrow.address);
  await mineBlock();
  const attacker = await deployed.getAddress();
  const e = contract('Escrow');
  const r = await ok(e.create(attacker, carol.address, clock + 1000, 0, 'x', { value: 2n * WEI }));
  await ok(e.release(e.interface.parseLog(r.logs[0]).args.id));
  const vault = await provider.getBalance(artifacts.Escrow.address);
  const c = new ethers.Contract(attacker, art.abi, alice.connect(provider));
  await ok(c.grab({ gasLimit: 500000 }));
  assert.equal(await provider.getBalance(attacker), 2n * WEI, 'vybral jen své');
  assert.equal(await provider.getBalance(artifacts.Escrow.address), vault - 2n * WEI);
});

test('Quinvium Avatars and profile pictures: on-chain SVG, ownership is checked when set and when shown, foreign and broken NFTs', async () => {
  const deploy = async (name) => {
    const f = new ethers.ContractFactory(artifacts[name].abi, artifacts[name].bytecode, alice.connect(provider));
    const c = await f.deploy();
    const r = await ok(Promise.resolve(c.deploymentTransaction()));
    console.log(`${name}: deploy ${r.gasUsed} gas`);
    return c.getAddress();
  };
  const avatarsAt = await deploy('QuinviumAvatars');
  const profilesAt = await deploy('Profiles');
  const { createHash } = await import('node:crypto');
  for (const [n, at] of [['QuinviumAvatars', avatarsAt], ['Profiles', profilesAt]]) {
    assert.equal(createHash('sha256').update(ethers.getBytes(await provider.getCode(at))).digest('hex'), artifacts[n].runtimeSha256, `${n}: the deployed code matches the hash the Explorer checks`);
  }
  const av = (w) => new ethers.Contract(avatarsAt, artifacts.QuinviumAvatars.abi, w.connect(provider));
  const pr = (w) => new ethers.Contract(profilesAt, artifacts.Profiles.abi, w.connect(provider));

  // Minting: anyone, bounds checked, numbers in order, no coins accepted or held.
  const minted = await ok(av(bob).mint(6, 2));
  console.log(`QuinviumAvatars: mint ${minted.gasUsed} gas`);
  await ok(av(carol).mint(24, 7));
  await fails(av(carol).mint(0, 0), 'UnknownIcon');
  await fails(av(carol).mint(25, 0), 'UnknownIcon');
  await fails(av(carol).mint(1, 8), 'UnknownColor');
  assert.equal(await av(dave).ownerOf(1), bob.address);
  assert.equal(await av(dave).totalSupply(), 2n);
  assert.deepEqual([...(await av(dave).traitsOf(1))].map(Number), [6, 2]);
  assert.equal(await provider.getBalance(avatarsAt), 0n);

  // The picture: valid SVG text with the same drawing as the Explorer's profiles.js, inside tokenURI JSON.
  const uri = await av(dave).tokenURI(1);
  assert.match(uri, /^data:application\/json;base64,/);
  const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
  assert.equal(meta.name, 'Quinvium Avatar #1');
  assert.match(meta.image, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(meta.image.split(',')[1], 'base64').toString();
  assert.equal(svg, await av(dave).svg(1));
  assert.match(svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 24 24'><rect [^<>]*\/><path [^<>]*\/><\/svg>$/);
  assert.doesNotMatch(svg, /script|href|on\w+=/i, 'no scripts or links');
  const paths = [...readFileSync(new URL('../../explorer/public/profiles.js', import.meta.url), 'utf8').matchAll(/^ {4}'([^']+)',$/gm)].map((m) => m[1]);
  assert.equal(paths.length, 24);
  assert.ok(svg.includes(`d='${paths[5]}'`) && svg.includes("fill='#D64545'"), 'icon 6 on colour 2 as in the Explorer');
  await fails(av(dave).tokenURI(99), 'ERC721NonexistentToken');

  // Profiles: only an NFT the sender owns now.
  await fails(pr(carol).setAvatar(avatarsAt, 1), 'NotTokenOwner');
  await fails(pr(bob).setAvatar(avatarsAt, 99), 'NotTokenOwner');
  await fails(pr(bob).setAvatar(dave.address, 1), 'NotTokenOwner');
  await fails(pr(bob).setAvatar(ethers.ZeroAddress, 1), 'NotTokenOwner');
  await fails(pr(bob).setAvatar(artifacts.Notary.address, 1), 'NotTokenOwner');
  await ok(pr(bob).setAvatar(avatarsAt, 1));
  await ok(pr(carol).setAvatar(avatarsAt, 2));
  assert.deepEqual([...(await pr(dave).avatarOf(bob.address))], [avatarsAt, 1n, true]);
  // Sold or moved: the picture stops showing by itself; it shows again when it comes back.
  await ok(av(bob).transferFrom(bob.address, dave.address, 1));
  assert.equal((await pr(dave).avatarOf(bob.address))[2], false);
  const [nfts, ids, valid] = await pr(dave).avatarsOf([bob.address, carol.address, dave.address]);
  assert.deepEqual([...nfts], [avatarsAt, avatarsAt, ethers.ZeroAddress]);
  assert.deepEqual([...ids], [1n, 2n, 0n]);
  assert.deepEqual([...valid], [false, true, false]);
  await ok(av(dave).transferFrom(dave.address, bob.address, 1));
  assert.equal((await pr(dave).avatarOf(bob.address))[2], true);
  await ok(pr(bob).clear());
  assert.deepEqual([...(await pr(dave).avatarOf(bob.address))], [ethers.ZeroAddress, 0n, false]);
  assert.deepEqual([...(await pr(dave).avatarOf(carol.address))], [avatarsAt, 2n, true], 'clearing changed only the sender');

  // A foreign NFT that burns all gas in ownerOf cannot break batch reads.
  const solc = (await import('node:module')).createRequire(import.meta.url)('solc');
  const source = `pragma solidity ^0.8.28; contract Greedy { address public who; bool public burn; function set(address w) external { who = w; } function setBurn(bool b) external { burn = b; } function ownerOf(uint256) external view returns (address) { if (!burn) return who; uint256 x; while (true) { x++; } } }`;
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'G.sol': { content: source } }, settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const g = out.contracts['G.sol'].Greedy;
  const greedy = await new ethers.ContractFactory(g.abi, `0x${g.evm.bytecode.object}`, alice.connect(provider)).deploy();
  await mineBlock();
  const gAt = await greedy.getAddress();
  await ok(new ethers.Contract(gAt, g.abi, alice.connect(provider)).set(dave.address));
  await ok(pr(dave).setAvatar(gAt, 7, { gasLimit: 300000 }));
  await ok(new ethers.Contract(gAt, g.abi, alice.connect(provider)).setBurn(true));
  const [, , v2] = await pr(alice).avatarsOf([dave.address, carol.address]);
  assert.deepEqual([...v2], [false, true], 'the broken contract only loses its own picture');
});
