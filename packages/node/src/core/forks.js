// Network upgrade plan. A fork changes the rules from a fixed height and nodes recognise each other by it when connecting,
// so old software disconnects from the network cleanly instead of silently drifting onto another branch.
// The identifier works the same way as EIP-2124.
import { GENESIS_RULES } from '../params.js';
import { equal, intToBytes, keccak } from '../util/bytes.js';
import upgrades from '../genesis/upgrades.json' with { type: 'json' };

const sorted = (network) => [...(network.forks ?? [])].sort((a, b) => (a.block < b.block ? -1 : 1));

/** How many forks are active at the given height. */
export function forkIndex(network, number) {
  let i = 0;
  for (const f of network.forks ?? []) if (f.block <= number) i += 1;
  return i;
}

/** Rules valid for a block at the given height. */
export function rulesAt(network, number) {
  let rules = GENESIS_RULES;
  for (const f of sorted(network)) if (f.block <= number) rules = { ...rules, ...f.rules };
  return rules;
}

/** Contracts a fork adds exactly at its height. The genesis of a running network must not change. */
export function upgradesAt(network, number) {
  return (network.forks ?? []).filter((f) => f.block === number)
    .flatMap((f) => (f.upgrades ?? []).map((name) => upgrades[name]));
}

/** Identifiers of consecutive rule versions: [after genesis, after the 1st fork, ...]. */
function history(network, genesisHash) {
  const out = [keccak(genesisHash).subarray(0, 4)];
  let material = genesisHash;
  for (const f of sorted(network)) {
    material = Buffer.concat([material, intToBytes(f.block)]);
    out.push(keccak(material).subarray(0, 4));
  }
  return out;
}

/** @returns {{hash: Uint8Array, next: bigint}} where we are and which fork is next, 0 if none */
export function forkId(network, genesisHash, head) {
  const i = forkIndex(network, head);
  const f = sorted(network);
  return { hash: history(network, genesisHash)[i], next: f[i]?.block ?? 0n };
}

/**
 * Decides whether it makes sense to talk to the peer.
 * @param {bigint} head our height
 * @param {{hash: Uint8Array, next: bigint}} remote identifier of the other side
 */
export function forkCompatible(network, genesisHash, head, remote) {
  const list = history(network, genesisHash);
  const f = sorted(network);
  const mine = forkIndex(network, head);
  const at = list.findIndex((h) => equal(h, remote.hash));
  if (at === -1) return false;                                 // foreign fork history
  if (at === mine) {
    // The other side expects a fork we have already passed and do not know about.
    return remote.next === 0n || remote.next > head || remote.next === (f[mine]?.block ?? 0n);
  }
  if (at < mine) return remote.next === f[at].block;           // the other side is still syncing
  return true;                                                 // we are syncing; we know the fork
}
