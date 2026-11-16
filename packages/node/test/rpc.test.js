// Compatibility check: the real ethers library, the real Solidity compiler and a contract deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import { AetherNode } from '../src/node.js';
import { NETWORKS, WEI } from '../src/params.js';
import { POW_DIR, seal, tmpData } from './helpers/chain.js';
import { bytesToBigInt, hashimotoLight } from '../src/crypto/ethash.js';

const require = createRequire(import.meta.url);
const solc = require('solc');

const net0 = { ...NETWORKS.dev };
const alice = ethers.Wallet.createRandom();
const bob = ethers.Wallet.createRandom();
let clock = Number(net0.genesisTimestamp);

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract Pokladna {
  mapping(address => uint256) public zustatky;
  event Vklad(address indexed kdo, uint256 kolik);
  error Nedostatek(uint256 mas, uint256 chces);
  function vlozit() external payable { zustatky[msg.sender] += msg.value; emit Vklad(msg.sender, msg.value); }
  function vybrat(uint256 c) external {
    if (zustatky[msg.sender] < c) revert Nedostatek(zustatky[msg.sender], c);
    zustatky[msg.sender] -= c;
    (bool ok,) = msg.sender.call{value: c}("");
    require(ok, "platba selhala");
  }
  function odmitni() external pure { revert("zakazano"); }
  function kopiruj(bytes memory d) external pure returns (bytes memory) { return d; }
  function hash(uint256 n) external view returns (bytes32) { return blockhash(n); }
}`;

function compile() {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { 'P.sol': { content: SOURCE } },
    settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  assert.deepEqual(errors, []);
  const c = out.contracts['P.sol'].Pokladna;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

const node = new AetherNode({
  network: net0, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
  alloc: { [alice.address]: { balance: 1000n * WEI } }, now: () => clock, log: () => {},
});

const miner = '0x' + 'bb'.repeat(20);

async function mineBlock() {
  clock += 15;
  const w = await node.work.getWork(ethers.getBytes(miner));
  const tpl = node.work.templates.get('0x' + Buffer.from(w.sealHash).toString('hex'));
  const sealed = await seal(node.chain, tpl);
  const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
  assert.ok(r.accepted, r.reason);
  await node.mempool.settled();
}

const untilMined = async (promise) => {
  await sleep(30);
  await mineBlock();
  return promise;
};

let provider;
test.before(async () => {
  await node.start();
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
});
test.after(async () => { provider.destroy(); await node.stop(); });

test('basic queries like MetaMask', async () => {
  assert.equal((await provider.getNetwork()).chainId, 52403n);
  assert.equal(await provider.getBlockNumber(), 0);
  assert.equal(await provider.getBalance(alice.address), 1000n * WEI);
  const fee = await provider.getFeeData();
  assert.ok(fee.maxFeePerGas > 0n);
  const block = await provider.getBlock('latest');
  assert.equal(block.number, 0);
});

test('a signed transfer through ethers passes and has a receipt', async () => {
  const signer = alice.connect(provider);
  const tx = await signer.sendTransaction({ to: bob.address, value: 5n * WEI });
  await sleep(20);
  await mineBlock();
  const r = await provider.getTransactionReceipt(tx.hash);
  assert.equal(r.status, 1);
  assert.equal(r.gasUsed, 21000n);
  assert.equal(await provider.getBalance(bob.address), 5n * WEI);
  assert.equal(await provider.getBalance(miner), 4n * WEI + r.gasUsed * 2_000_000_000n, 'odměna a celý poplatek');
  const full = await provider.getTransaction(tx.hash);
  assert.equal(full.from, alice.address);
  assert.equal(full.blockNumber, r.blockNumber);
});

test('Solidity contract: deployment, calls, events, errors, gas', async () => {
  const { abi, bytecode } = compile();
  const signer = alice.connect(provider);
  const deploy = await new ethers.ContractFactory(abi, bytecode, signer).deploy();
  await sleep(20);
  await mineBlock();
  const addr = await deploy.getAddress();
  assert.notEqual(await provider.getCode(addr), '0x');
  const c = new ethers.Contract(addr, abi, signer);

  const vklad = await c.vlozit({ value: 3n * WEI });
  await sleep(20);
  await mineBlock();
  const r = await provider.getTransactionReceipt(vklad.hash);
  assert.equal(r.logs.length, 1);
  assert.equal(c.interface.parseLog(r.logs[0]).args.kolik, 3n * WEI);
  assert.equal(await c.zustatky(alice.address), 3n * WEI);

  const events = await c.queryFilter(c.filters.Vklad(alice.address));
  assert.equal(events.length, 1);
  assert.equal((await c.queryFilter(c.filters.Vklad(bob.address))).length, 0);

  await assert.rejects(c.odmitni(), /zakazano/);
  await assert.rejects(c.vybrat(100n * WEI), (e) => e.revert?.name === 'Nedostatek' || /Nedostatek|custom error|revert/i.test(e.message));
  const data = '0x' + 'ab'.repeat(500);
  assert.equal(await c.kopiruj(data), data);

  const gas = await c.vybrat.estimateGas(WEI);
  const before = await provider.getBalance(addr);
  const v = await c.vybrat(WEI, { gasLimit: gas });
  await sleep(20);
  await mineBlock();
  assert.equal((await provider.getTransactionReceipt(v.hash)).status, 1, 'odhad gasu stačil');
  assert.equal(await provider.getBalance(addr), before - WEI);

  const prev = await provider.getBlock((await provider.getBlockNumber()) - 1);
  assert.equal(await c.hash(prev.number), prev.hash, 'BLOCKHASH vrací hash bloku Quinvium');
});

test('nonce including pending, replacement and rejection', async () => {
  const signer = alice.connect(provider);
  const start = await provider.getTransactionCount(alice.address, 'pending');
  await signer.sendTransaction({ to: bob.address, value: 1n, nonce: start });
  assert.equal(await provider.getTransactionCount(alice.address, 'pending'), start + 1);
  await assert.rejects(signer.sendTransaction({ to: bob.address, value: 2n, nonce: start }), /10 %|replacement|underpriced/i);
  await mineBlock();
  const raw = await bob.connect(provider).signTransaction({
    to: alice.address, value: 10n ** 30n, nonce: 0, gasLimit: 21000, maxFeePerGas: 5e9, maxPriorityFeePerGas: 1e9, chainId: 52403, type: 2,
  });
  await assert.rejects(provider.send('eth_sendRawTransaction', [raw]), /insufficient funds/);
});

test('filters and subscriptions over WebSocket', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${node.rpc.port}`);
  await new Promise((r) => ws.once('open', r));
  const msgs = [];
  ws.on('message', (m) => msgs.push(JSON.parse(m)));
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
  await sleep(50);
  const filter = await provider.send('eth_newBlockFilter', []);
  await mineBlock();
  await sleep(50);
  assert.ok(msgs.some((m) => m.method === 'eth_subscription'), 'přišla nová hlavička');
  const changes = await provider.send('eth_getFilterChanges', [filter]);
  assert.equal(changes.length, 1);
  ws.close();
});

test('getwork: the miner chooses a payout address without an account; a wrong result is rejected', async () => {
  const addr = '0x' + 'cd'.repeat(20);
  const [seal0, seedHash, target, number] = await provider.send('aether_getWork', [addr]);
  assert.equal(seedHash, '0x' + '00'.repeat(32));
  assert.equal(BigInt(number), BigInt(await provider.getBlockNumber()) + 1n);
  assert.ok(BigInt(target) > 0n);
  assert.equal(await provider.send('eth_submitWork', ['0x' + '11'.repeat(8), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32)]), false);
  assert.equal(await provider.send('eth_submitWork', ['0x' + '11'.repeat(8), seal0, '0x' + '33'.repeat(32)]), false);
  await assert.rejects(provider.send('aether_getWork', ['neplatna']));
  await assert.rejects(provider.send('eth_getWork', []), /payout address/);
});

test('statistics and data for the Explorer', async () => {
  const s = await provider.send('aether_stats', []);
  assert.equal(s.currency, 'dQU');
  assert.deepEqual(s.forks, [{ name: 'pools', block: 1 }]);
  assert.equal(BigInt(s.supply), BigInt(s.minted), 'nic se nepálí');
  assert.ok(BigInt(s.fees) > 0n, 'poplatky těžařům se počítají');
  assert.equal(BigInt(s.maxSupply), 64_000_000n * WEI);
  const rich = await provider.send('aether_richList', [10]);
  assert.equal(rich.items[0].address.toLowerCase(), alice.address.toLowerCase());
  const hist = await provider.send('aether_addressTxs', [bob.address, 10, 0]);
  assert.ok(hist.total >= 1);
  assert.ok((await provider.send('aether_recentBlocks', [5, 0])).length === 5);
  assert.ok((await provider.send('aether_charts', [5])).length === 5);
  assert.equal((await provider.send('aether_search', [alice.address])).type, 'address');
  assert.equal(await provider.send('aether_search', ['nesmysl']), null);
  const miners = await provider.send('aether_miners', [100]);
  assert.equal(miners[0].address, miner);
});

test('Stratum: login with an address, work, solution and a new block', async () => {
  const s = net.connect({ host: '127.0.0.1', port: node.stratum.port });
  await new Promise((r) => s.once('connect', r));
  let buf = '';
  const inbox = [];
  s.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { inbox.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  const next = async (pred) => {
    for (let i = 0; i < 200; i++) {
      const k = inbox.findIndex(pred);
      if (k >= 0) return inbox.splice(k, 1)[0];
      await sleep(10);
    }
    throw new Error('stratum neodpověděl');
  };
  const send = (o) => s.write(`${JSON.stringify(o)}\n`);
  const addr = '0x' + 'ef'.repeat(20);
  send({ id: 1, method: 'eth_submitLogin', params: ['neplatna'] });
  assert.equal((await next((m) => m.id === 1)).result, false);
  send({ id: 2, method: 'eth_submitLogin', params: [`${addr}.rig1`], worker: 'rig1' });
  assert.equal((await next((m) => m.id === 2)).result, true);
  clock += 15;
  send({ id: 3, method: 'eth_getWork', params: [] });
  const job = (await next((m) => m.id === 3)).result;
  const tpl = node.work.templates.get(job[0]);
  const sealed = await seal(node.chain, tpl);
  send({ id: 4, method: 'eth_submitWork', params: [ethers.hexlify(sealed.header.nonce), job[0], ethers.hexlify(sealed.header.mixHash)] });
  assert.equal((await next((m) => m.id === 4)).result, true);
  assert.equal(await provider.getBalance(addr), 4n * WEI);
  const push = await next((m) => m.id === 0 && Array.isArray(m.result));
  assert.notEqual(push.result[0], job[0], 'miner dostal novou práci sám od sebe');

  // EthereumStratum/1.0.0 mode
  const n = net.connect({ host: '127.0.0.1', port: node.stratum.port });
  await new Promise((r) => n.once('connect', r));
  const box = [];
  let b2 = '';
  n.on('data', (d) => { b2 += d; let i; while ((i = b2.indexOf('\n')) >= 0) { box.push(JSON.parse(b2.slice(0, i))); b2 = b2.slice(i + 1); } });
  const next2 = async (pred) => {
    for (let i = 0; i < 200; i++) {
      const k = box.findIndex(pred);
      if (k >= 0) return box.splice(k, 1)[0];
      await sleep(10);
    }
    throw new Error('stratum neodpověděl');
  };
  n.write(`${JSON.stringify({ id: 1, method: 'mining.subscribe', params: ['test/1', 'EthereumStratum/1.0.0'] })}\n`);
  const sub = await next2((m) => m.id === 1);
  assert.equal(sub.result[0][2], 'EthereumStratum/1.0.0');
  const extranonce = sub.result[1];
  n.write(`${JSON.stringify({ id: 2, method: 'mining.authorize', params: [`${addr}.rig2`, 'x'] })}\n`);
  assert.equal((await next2((m) => m.id === 2)).result, true);
  await next2((m) => m.method === 'mining.set_difficulty');
  const notify = await next2((m) => m.method === 'mining.notify');
  const [jobId, seed, header] = notify.params;
  assert.equal(seed.length, 64);
  const sealHash = ethers.getBytes('0x' + header);
  clock += 15;
  const cache = await node.chain.pow.cache(0);
  const { datasetSize, targetForDifficulty } = await import('../src/crypto/ethash.js');
  let solved = null;
  for (let i = 0; i < 100000; i++) {
    const suffix = i.toString(16).padStart(12, '0');
    const nonce = ethers.getBytes('0x' + extranonce + suffix);
    const { result } = hashimotoLight(cache, datasetSize(0), sealHash, nonce);
    const tplBlock = node.work.templates.get('0x' + header);
    if (bytesToBigInt(result) <= targetForDifficulty(tplBlock.header.difficulty)) { solved = suffix; break; }
  }
  n.write(`${JSON.stringify({ id: 3, method: 'mining.submit', params: [`${addr}.rig2`, jobId, solved] })}\n`);
  const res = await next2((m) => m.id === 3);
  assert.equal(res.result, true, JSON.stringify(res.error));
  s.destroy(); n.destroy();
});


test('health check /health: height, block age and 503 for a stale block', async () => {
  const base = `http://127.0.0.1:${node.rpc.port}`;
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const h = await r.json();
  assert.equal(h.ok, true);
  assert.equal(h.height, Number(node.chain.head.number));
  assert.equal(h.behind, 0);
  assert.equal(typeof h.tipAge, 'number');
  clock += 3600;
  const stale = await fetch(`${base}/health?maxAge=600`);
  assert.equal(stale.status, 503, 'hlídač těžby pozná, že hodinu nepřišel blok');
  assert.deepEqual((await stale.json()).problems, ['stale']);
  assert.equal((await fetch(`${base}/health`)).status, 200, 'bez maxAge stačí, že uzel nezaostává za sousedy');
  await mineBlock();
});

test('REST API with module and action: balance, transaction list, mined blocks, rewards, proxy, errors', async () => {
  const api = async (q) => (await fetch(`http://127.0.0.1:${node.rpc.port}/api?${q}`)).json();
  const bal = await api(`module=account&action=balance&address=${bob.address}&tag=latest`);
  assert.deepEqual([bal.status, bal.message], ['1', 'OK']);
  assert.equal(BigInt(bal.result), await provider.getBalance(bob.address));
  const multi = await api(`module=account&action=balancemulti&address=${alice.address},${bob.address}`);
  assert.equal(multi.result.length, 2);
  const list = await api(`module=account&action=txlist&address=${bob.address}&page=1&offset=10&sort=asc`);
  assert.equal(list.status, '1', JSON.stringify(list));
  const first = list.result[0];
  assert.equal(first.to.toLowerCase(), bob.address.toLowerCase());
  assert.equal(first.value, (5n * WEI).toString());
  assert.equal(first.isError, '0');
  assert.equal(first.txreceipt_status, '1');
  assert.ok(Number(first.confirmations) >= 1 && /^\d+$/.test(first.blockNumber) && /^\d+$/.test(first.timeStamp));
  const none = await api(`module=account&action=txlist&address=0x${'12'.repeat(20)}`);
  assert.deepEqual([none.status, none.message, none.result], ['0', 'No transactions found', []]);
  const mined = await api(`module=account&action=getminedblocks&address=${miner}&offset=5`);
  assert.equal(mined.status, '1');
  assert.ok(mined.result.length >= 1 && BigInt(mined.result[0].blockReward) >= 4n * WEI);
  const reward = await api('module=block&action=getblockreward&blockno=1');
  assert.equal(reward.result.blockMiner.toLowerCase(), miner);
  const height = await provider.getBlockNumber();
  const ts = (await provider.getBlock(1)).timestamp;
  assert.equal((await api(`module=block&action=getblocknobytime&timestamp=${ts}&closest=before`)).result, '1');
  const proxy = await api('module=proxy&action=eth_blockNumber');
  assert.equal(Number(BigInt(proxy.result)), height);
  assert.equal((await api('module=proxy&action=eth_sendRawTransaction&hex=0x00')).error.code, -32601, 'read-only');
  const gas = await api('module=gastracker&action=gasoracle');
  assert.ok(Number(gas.result.ProposeGasPrice) > 0);
  assert.ok(BigInt((await api('module=stats&action=ethsupply')).result) > 0n);
  const bad = await api('module=account&action=balance&address=nope');
  assert.deepEqual([bad.status, bad.message], ['0', 'NOTOK']);
  assert.match((await api('module=foo&action=bar')).result, /Unknown module/);
});
