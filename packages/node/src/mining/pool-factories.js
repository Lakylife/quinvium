// Pool factories. The first one is part of the network rules (the fork "pools"). Version 2 factories, whose pools pay the
// gas of their server out of the mined rewards, are ordinary contracts deployed by users: the node uses one only when its
// code matches the build, so an address in this list cannot bring in different code.
import { createHash } from 'node:crypto';
import { fromHex, toHex } from '../util/bytes.js';

export const POOL_FACTORY = '0xae0000000000000000000000000000000000000c';
/** SHA-256 of the runtime code of PoolFactory2 (packages/contracts/dist/artifacts.json, checked by a test). */
export const POOL_FACTORY2_SHA256 = '59caab4a02b84b91b525820de93b8ea940bb2417b59f32717506b80c4dcff8ed';
/** Deployed version 2 factories by chain ID. An address is added after it is deployed. */
export const POOL_FACTORIES_V2 = Object.freeze({ 52401: Object.freeze([]), 52402: Object.freeze([]), 52403: Object.freeze([]) });

const verified = new Map();

/**
 * The factories this node trusts: the built-in one and every version 2 factory whose code matches.
 * @param {(address: Uint8Array) => Promise<Uint8Array>} getCode code at the head of the chain
 * @param {bigint|number} chainId
 * @param {string[]} [extra] more version 2 factories (tests, a node operator)
 * @returns {Promise<{ address: Uint8Array, version: number }[]>}
 */
export async function trustedFactories(getCode, chainId, extra = []) {
  const out = [{ address: fromHex(POOL_FACTORY), version: 1 }];
  const listed = [...(POOL_FACTORIES_V2[Number(chainId)] ?? []), ...extra].map((a) => a.toLowerCase());
  for (const hex of [...new Set(listed)]) {
    const key = `${chainId}:${hex}`;
    if (!verified.get(key)) {
      const code = await getCode(fromHex(hex)).catch(() => new Uint8Array(0));
      // An address without code yet is asked again later; a different code never becomes trusted.
      if (!code.length) continue;
      verified.set(key, createHash('sha256').update(code).digest('hex') === POOL_FACTORY2_SHA256);
    }
    if (verified.get(key)) out.push({ address: fromHex(hex), version: 2 });
  }
  return out;
}

export const factoryHex = (f) => toHex(f.address);
