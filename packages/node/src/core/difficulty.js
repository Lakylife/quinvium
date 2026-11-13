// LWMA: vážený klouzavý průměr po každém bloku. Síť reaguje během minut na příchod
// i odchod velkého hashrate, což u malé sítě chrání proti výkyvům obtížnosti.
import { CONSENSUS as C } from '../params.js';

/**
 * @param {Header} parent rodič počítaného bloku
 * @param {(hash: Uint8Array) => Header} headerOf načtení hlavičky podle hashe
 * @param {{genesisDifficulty: bigint, minDifficulty: bigint}} network
 */
export function nextDifficulty(parent, headerOf, network) {
  const available = Number(parent.number);
  if (available < C.lwmaMinSamples) return network.genesisDifficulty;
  const n = Math.min(available, C.lwmaWindow);

  // Od rodiče zpět po poslední váhu n. Hlavička na pozici i má váhu i.
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
