// LWMA: a weighted moving average after every block. The network reacts within minutes to the arrival
// and the departure of large hashrate, which protects a small network against difficulty swings.
import { CONSENSUS as C } from '../params.js';

/**
 * @param {Header} parent parent of the block being computed
 * @param {(hash: Uint8Array) => Header} headerOf loads a header by hash
 * @param {{genesisDifficulty: bigint, minDifficulty: bigint}} network
 */
export function nextDifficulty(parent, headerOf, network) {
  const available = Number(parent.number);
  if (available < C.lwmaMinSamples) return network.genesisDifficulty;
  const n = Math.min(available, C.lwmaWindow);

  // From the parent back to the last weight n. The header at position i has weight i.
  const chain = new Array(n + 1);
  chain[n] = parent;
  for (let i = n; i > 0; i--) chain[i - 1] = headerOf(chain[i].parentHash);

  const T = BigInt(C.targetBlockTime);
  const maxSolve = T * BigInt(C.maxSolveTimeFactor);
  let weighted = 0n;
  let sumDifficulty = 0n;
  for (let i = 1; i <= n; i++) {
    let solve = chain[i].timestamp - chain[i - 1].timestamp;
    if (solve > maxSolve) solve = maxSolve;
    if (solve < 1n) solve = 1n;
    weighted += solve * BigInt(i);
    sumDifficulty += chain[i].difficulty;
  }
  const N = BigInt(n);
  const floor = (N * N * T) / 20n;
  if (weighted < floor) weighted = floor;
  const next = (sumDifficulty * (N + 1n) * T) / (2n * weighted);
  return next < network.minDifficulty ? network.minDifficulty : next;
}
