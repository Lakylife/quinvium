// A slow CPU miner for the development network. It is not used on mainnet or testnet,
// mining is done by the GPU miner or common Stratum miners.
import { randomBytes } from 'node:crypto';
import { bytesToBigInt } from '../crypto/ethash.js';

export class DevMiner {
  constructor(node, { intervalMs = 3000 } = {}) {
    this.node = node;
    this.intervalMs = intervalMs;
    this.running = false;
  }

  start() {
    this.running = true;
    this._loop().catch((e) => this.node.log(`Dev miner: ${e.stack ?? e.message}`));
  }

  stop() { this.running = false; }

  async _loop() {
    const { chain, work, minerAddress } = this.node;
    while (this.running) {
      await new Promise((r) => setTimeout(r, this.intervalMs));
      if (!this.running) return;
      const w = await work.getWork(minerAddress).catch(() => null);
      if (!w) continue;
      for (let i = 0; i < 2000 && this.running; i++) {
        const nonce = new Uint8Array(randomBytes(8));
        const { mixDigest, result } = await chain.pow.compute(w.sealHash, nonce, w.number);
        if (bytesToBigInt(result) <= w.target) {
          await work.submit(nonce, w.sealHash, mixDigest);
          break;
        }
        if (i % 16 === 15) await new Promise((r) => setImmediate(r));
      }
    }
  }
}
