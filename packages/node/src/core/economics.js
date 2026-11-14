// Emise a poplatky.
import { CONSENSUS as C } from '../params.js';

/** Block reward: 4 QU, halving every 8,000,000 blocks. Block 0 has no reward. */
export function blockReward(number) {
  const n = BigInt(number);
  if (n === 0n) return 0n;
  const halvings = (n - 1n) / C.halvingInterval;
  return halvings >= 64n ? 0n : C.initialReward >> halvings;
}

/** How many coins could have been created up to the given height. There is no other source of coins in the network; fees only change owner. */
export function emitted(height) {
  let total = 0n;
  let remaining = BigInt(height);
  let reward = C.initialReward;
  while (remaining > 0n && reward > 0n) {
    const span = remaining < C.halvingInterval ? remaining : C.halvingInterval;
    total += span * reward;
    remaining -= span;
    reward >>= 1n;
  }
  return total;
}

/** EIP-1559: the base fee responds to traffic and has a floor. It is not burned; the miner receives it. */
export function nextBaseFee(parent) {
  const target = parent.gasLimit / C.elasticity;
  const base = parent.baseFee;
  let next;
  if (parent.gasUsed === target) {
    next = base;
  } else if (parent.gasUsed > target) {
    const delta = (base * (parent.gasUsed - target)) / target / C.baseFeeDenominator;
    next = base + (delta > 1n ? delta : 1n);
  } else {
    next = base - (base * (target - parent.gasUsed)) / target / C.baseFeeDenominator;
  }
  return next < C.minBaseFee ? C.minBaseFee : next;
}

export function gasLimitValid(gasLimit, parentGasLimit, maxGasLimit) {
  const limit = parentGasLimit / C.gasLimitBoundDivisor;
  const diff = gasLimit > parentGasLimit ? gasLimit - parentGasLimit : parentGasLimit - gasLimit;
  return diff < limit && gasLimit >= C.minGasLimit && gasLimit <= maxGasLimit;
}

/** The miner approaches the target in the largest allowed steps. */
export function nextGasLimit(parentGasLimit, target) {
  const step = parentGasLimit / C.gasLimitBoundDivisor - 1n;
  if (parentGasLimit < target) return parentGasLimit + step > target ? target : parentGasLimit + step;
  if (parentGasLimit > target) return parentGasLimit - step < target ? target : parentGasLimit - step;
  return parentGasLimit;
}
