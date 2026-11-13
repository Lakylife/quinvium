// Skutečné uzly Quinvium v jednom procesu pro testy mostu: každý má vlastní chain ID a bloky se těží na povel.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { AetherNode, loadAlloc } from '../../../node/src/node.js';
import { NETWORKS, WEI } from '../../../node/src/params.js';
import { POW_DIR, seal, tmpData } from '../../../node/test/helpers/chain.js';

export const artifacts = JSON.parse(readFileSync(new URL('../../../contracts/dist/artifacts.json', import.meta.url)));
export const DAY = 86400;
export { WEI };

export function makeChain(chainId, name, accounts, options = {}) {
  const net = { ...NETWORKS.dev, name, chainId };
  const alloc = { ...loadAlloc() };
  for (const w of accounts) alloc[w.address] = { balance: 10000n * WEI };
  const state = { clock: Number(net.genesisTimestamp) };
  const node = new AetherNode({ network: net, dataDir: tmpData(), powDir: POW_DIR, p2pPort: 0, rpcPort: 0, stratumPort: 0, p2pHost: '127.0.0.1', allowPrivate: true, alloc, now: () => state.clock, log: () => {}, ...options });
  const side = {
    node, state, id: chainId, name, provider: null,
    async start() {
      await node.start();
      side.provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${node.rpc.port}`, undefined, { pollingInterval: 50, staticNetwork: true, cacheTimeout: -1 });
      await side.mine();
    },
    async stop() { side.provider.destroy(); await node.stop(); },
    async mine(step = 15, miner = `0x${'cc'.repeat(20)}`) {
      state.clock += step;
      const w = await node.work.getWork(ethers.getBytes(miner));
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
    async deploy(contract, signer, ...args) {
      const f = new ethers.ContractFactory(artifacts[contract].abi, artifacts[contract].bytecode, side.connect(signer));
      const c = await f.deploy(...args);
      await side.mine();
      return c;
    },
    at: (contract, address, signer) => new ethers.Contract(address, artifacts[contract].abi, signer ? side.connect(signer) : side.provider),
  };
  return side;
}
