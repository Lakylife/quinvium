// Pool server with a real share: the share goes through the server to the contract and the Explorer sees it among miners and devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ethers } from 'ethers';
import { AetherNode, loadAlloc } from '../src/node.js';
import { NETWORKS, WEI } from '../src/params.js';
import { POW_DIR, seal, tmpData } from './helpers/chain.js';
import { bytesToBigInt } from '../src/crypto/ethash.js';

const artifacts = JSON.parse(readFileSync(new URL('../../contracts/dist/artifacts.json', import.meta.url)));
const FACTORY = '0xae0000000000000000000000000000000000000c';

test("a miner's share passes through the pool server into the contract; the pool shows miners, devices and the operator", async () => {
  const owner = ethers.Wallet.createRandom();
  const payer = ethers.Wallet.createRandom();
  const miner = ethers.Wallet.createRandom().address;
  let clock = Number(NETWORKS.dev.genesisTimestamp);
  const node = new AetherNode({
    network: NETWORKS.dev, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true,
    alloc: { ...loadAlloc(), [owner.address]: { balance: 100n * WEI }, [payer.address]: { balance: 100n * WEI } }, now: () => clock, log: () => {},
  });
  await node.start();
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 50 });
  const call = async (method, params = []) => {
    const r = await (await fetch(`http://127.0.0.1:${node.rpc.port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
    if (r.error) throw new Error(r.error.message);
    return r.result;
  };
  const mine = async () => {
    clock += 15;
    const w = await node.work.getWork(ethers.getBytes(`0x${'bb'.repeat(20)}`));
    const tpl = node.work.templates.get(ethers.hexlify(w.sealHash));
    const sealed = await seal(node.chain, tpl);
    const r = await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash);
    assert.ok(r.accepted, r.reason);
    await node.mempool.settled();
  };
  try {
    await mine();   // the pool factory is created by a fork at block 1
    const factory = new ethers.Contract(FACTORY, artifacts.PoolFactory.abi, owner.connect(provider));
    const sent = await factory.createPool('Testovací pool', '', 100, 16, 4);
    await sleep(30);
    await mine();
    const receipt = await provider.getTransactionReceipt(sent.hash);
    assert.equal(receipt.status, 1);
    const pool = (await factory.list(0, 10))[0];

    await node.startPool(ethers.getBytes(pool), ethers.getBytes(payer.privateKey), { minShareDifficulty: 1n });
    const [sealHash, , target, number] = await call('aether_poolWork', [miner, 'rig1']);
    let found = null;
    for (let i = 0; i < 64 && !found; i++) {
      const nonce = new Uint8Array(randomBytes(8));
      const { mixDigest, result } = await node.chain.pow.compute(ethers.getBytes(sealHash), nonce, BigInt(number));
      if (bytesToBigInt(result) <= BigInt(target)) found = { nonce, mixDigest };
    }
    assert.ok(found, 'podíl s nejnižší obtížností');
    const share = await call('aether_poolSubmit', [ethers.hexlify(found.nonce), sealHash, ethers.hexlify(found.mixDigest)]);
    assert.equal(share.accepted, true, share.reason);
    await node.pool.flush();
    await sleep(30);
    await mine();

    const miners = await call('aether_poolMiners', [pool, 0]);
    assert.deepEqual(miners.items.map((m) => [m.miner.toLowerCase(), m.shares]), [[miner.toLowerCase(), 1]], 'podíl je v kontraktu');
    const info = await call('aether_poolInfo');
    assert.equal(info.address.toLowerCase(), pool.toLowerCase());
    assert.deepEqual(info.devices.map((d) => [d.miner.toLowerCase(), d.worker]), [[miner.toLowerCase(), 'rig1']], 'zařízení je mezi připojenými');
    assert.ok(Number.isInteger(info.devices[0].seen) && info.devices[0].hashrate >= 0);
    assert.deepEqual((await call('aether_poolsOf', [owner.address])).map((p) => p.pool.toLowerCase()), [pool.toLowerCase()], 'tvůrce poolu ho má u sebe');
    assert.deepEqual(await call('aether_poolsOf', [payer.address]), [], 'plátce podílů pool neprovozuje');
    assert.equal(info.deviceCount, 1);
    assert.equal((await call('aether_poolInfo', [{ miner }])).deviceCount, 1, 'zařízení jednoho těžaře');
    assert.deepEqual((await call('aether_poolInfo', [{ miner: payer.address }])).devices, [], 'cizí adresa žádná zařízení nemá');

    // A second pool without blocks and a block whose reward went to the first pool: the ranking sorts them by share of blocks.
    const next = await factory.createPool('Druhý pool', 'http://192.168.1.9:8547', 250, 16, 4);
    await sleep(30);
    await mine();
    assert.equal((await provider.getTransactionReceipt(next.hash)).status, 1);
    const second = (await factory.list(0, 10))[1];
    clock += 15;
    const w = await node.work.getWork(ethers.getBytes(pool));
    const sealed = await seal(node.chain, node.work.templates.get(ethers.hexlify(w.sealHash)));
    assert.ok((await node.work.submit(sealed.header.nonce, w.sealHash, sealed.header.mixHash)).accepted);
    const ranked = await call('aether_pools', [{}]);
    assert.equal(ranked.total, 2);
    // The share with the lowest difficulty could also have mined a block on the development network, hence "at least one".
    assert.deepEqual(ranked.items.map((p) => [p.name, p.blocks > 0]), [['Testovací pool', true], ['Druhý pool', false]], 'pool s bloky je první');
    assert.equal(ranked.items[0].miners, 1, 'těžař v okně poolu');
    assert.ok(ranked.items[0].share > 0 && ranked.items[0].share < 1, 'podíl na všech blocích období');
    assert.deepEqual([ranked.items[1].url, ranked.items[1].feeBps, ranked.items[1].operator.toLowerCase()], ['http://192.168.1.9:8547', 250, owner.address.toLowerCase()]);
    const search = await call('aether_pools', [{ query: 'DRUH' }]);
    assert.deepEqual([search.matched, search.items.map((p) => p.address.toLowerCase())], [1, [second.toLowerCase()]], 'hledání podle jména');
    assert.deepEqual((await call('aether_pools', [{ query: pool.slice(2, 12).toLowerCase() }])).items.map((p) => p.name), ['Testovací pool'], 'hledání podle adresy');
    assert.deepEqual((await call('aether_pools', [{ limit: 1, offset: 1 }])).items.map((p) => p.name), ['Druhý pool'], 'druhá stránka');

    // A failed transaction in a block: the contract rejects a 9 % fee. The node replays it in place and returns the contract error.
    const bad = await factory.createPool('Moc drahý', '', 900, 16, 4, { gasLimit: 900_000 });
    await sleep(30);
    await mine();
    assert.equal((await provider.getTransactionReceipt(bad.hash)).status, 0, 'transakce se vytěžila jako neúspěšná');
    const why = await call('aether_txError', [bad.hash]);
    const errors = new ethers.Interface([...artifacts.PoolFactory.abi, ...artifacts.AetherPool.abi].filter((x) => x.type === 'error'));
    assert.equal(why.error, 'revert');
    assert.equal(errors.parseError(why.data)?.name, 'InvalidSettings', `data revertu ${why.data}`);
    assert.equal(BigInt(why.gasLimit), 900_000n);
    assert.deepEqual(await call('quintium_txError', [bad.hash]), why, 'nový název metody vrací totéž');
    assert.equal(await call('aether_txError', [sent.hash]), null, 'úspěšná transakce žádnou chybu nemá');
  } finally {
    provider.destroy();
    await node.stop();
  }
});

test('pool shares give way when blocks fill up', async () => {
  const { PoolServer } = await import('../src/mining/pool.js');
  const chainWith = (ratio) => {
    const headers = [];
    for (let i = 0; i <= 6; i++) headers.push({ number: BigInt(i), gasLimit: 10_000_000n, gasUsed: BigInt(Math.round(ratio * 10_000_000)), hash: () => Uint8Array.of(i, Math.round(ratio * 100)), parentHash: Uint8Array.of(i - 1) });
    return { head: headers[6], getHeader: (h) => headers[h[0]] ?? null };
  };
  const rate = (ratio) => PoolServer.prototype.sharesPerBlock.call({ chain: chainWith(ratio) });
  assert.equal(rate(0), 24, 'prázdné bloky: plný počet podílů');
  assert.equal(rate(0.5), 24);
  assert.equal(rate(0.75), 15);
  assert.equal(rate(1), 6, 'plné bloky: čtvrtina');
});
