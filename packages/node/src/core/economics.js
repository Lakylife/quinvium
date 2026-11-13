// Emise a poplatky.
import { CONSENSUS as C } from '../params.js';

/** Odměna za blok: 4 QU, půlení po 8 000 000 blocích. Blok 0 odměnu nemá. */
export function blockReward(number) {
  const n = BigInt(number);
  if (n === 0n) return 0n;
  const halvings = (n - 1n) / C.halvingInterval;
  return halvings >= 64n ? 0n : C.initialReward >> halvings;
}

/** Kolik mincí mohlo do dané výšky vzniknout. Jiný zdroj mincí v síti není, poplatky jen mění majitele. */
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

/** EIP-1559: základní poplatek reaguje na provoz a má spodní mez. Nepálí se, dostává ho těžař. */
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

/** Miner se blíží k cíli po co největších povolených krocích. */
export function nextGasLimit(parentGasLimit, target) {
  const step = parentGasLimit / C.gasLimitBoundDivisor - 1n;
  if (parentGasLimit < target) return parentGasLimit + step > target ? target : parentGasLimit + step;
  if (parentGasLimit > target) return parentGasLimit - step < target ? target : parentGasLimit - step;
  return parentGasLimit;
}
