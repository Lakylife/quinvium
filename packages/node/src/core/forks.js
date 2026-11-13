// Plán aktualizací sítě. Fork mění pravidla od pevné výšky a uzly se podle něj poznají při spojení,
// takže starý software se od sítě odpojí čistě, místo aby se tiše rozešel na jinou větev.
// Princip identifikátoru je stejný jako EIP-2124.
import { GENESIS_RULES } from '../params.js';
import { equal, intToBytes, keccak } from '../util/bytes.js';
import upgrades from '../genesis/upgrades.json' with { type: 'json' };

const sorted = (network) => [...(network.forks ?? [])].sort((a, b) => (a.block < b.block ? -1 : 1));

/** Kolik forků je aktivních na dané výšce. */
export function forkIndex(network, number) {
  let i = 0;
  for (const f of network.forks ?? []) if (f.block <= number) i += 1;
  return i;
}

/** Pravidla platná pro blok dané výšky. */
export function rulesAt(network, number) {
  let rules = GENESIS_RULES;
  for (const f of sorted(network)) if (f.block <= number) rules = { ...rules, ...f.rules };
  return rules;
}

/** Kontrakty, které fork přidá přesně na své výšce. Genesis běžící sítě se měnit nesmí. */
export function upgradesAt(network, number) {
  return (network.forks ?? []).filter((f) => f.block === number)
    .flatMap((f) => (f.upgrades ?? []).map((name) => upgrades[name]));
}

/** Identifikátory po sobě jdoucích verzí pravidel: [po genesis, po 1. forku, ...]. */
function history(network, genesisHash) {
  const out = [keccak(genesisHash).subarray(0, 4)];
  let material = genesisHash;
  for (const f of sorted(network)) {
    material = Buffer.concat([material, intToBytes(f.block)]);
    out.push(keccak(material).subarray(0, 4));
  }
  return out;
}

/** @returns {{hash: Uint8Array, next: bigint}} kde jsme a jaký fork je další, 0 když žádný */
export function forkId(network, genesisHash, head) {
  const i = forkIndex(network, head);
  const f = sorted(network);
  return { hash: history(network, genesisHash)[i], next: f[i]?.block ?? 0n };
}

/**
 * Rozhodne, jestli má smysl s uzlem mluvit.
 * @param {bigint} head naše výška
 * @param {{hash: Uint8Array, next: bigint}} remote identifikátor protistrany
 */
export function forkCompatible(network, genesisHash, head, remote) {
  const list = history(network, genesisHash);
  const f = sorted(network);
  const mine = forkIndex(network, head);
  const at = list.findIndex((h) => equal(h, remote.hash));
  if (at === -1) return false;                                 // cizí historie forků
  if (at === mine) {
    // Protistrana čeká fork, který jsme už prošli, a my o něm nevíme.
    return remote.next === 0n || remote.next > head || remote.next === (f[mine]?.block ?? 0n);
  }
  if (at < mine) return remote.next === f[at].block;           // protistrana se ještě synchronizuje
  return true;                                                 // my se synchronizujeme, fork známe
}
