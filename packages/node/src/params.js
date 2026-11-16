// Consensus parameters of the Quinvium network. Changing any value is a hard fork.
export const WEI = 10n ** 18n;
export const GWEI = 10n ** 9n;

export const CONSENSUS = Object.freeze({
  targetBlockTime: 15,             // sekundy
  lwmaWindow: 60,                  // blocks, 15 minutes of history
  lwmaMinSamples: 6,               // below this height the initial difficulty stays
  maxSolveTimeFactor: 40,          // cap on block time for the computation: after 99.9 % of hashrate leaves, the network recovers in half a day
  futureTimeLimit: 60,             // seconds, how far in the future a block may be
  initialReward: 4n * WEI,         // QU za blok
  halvingInterval: 8_000_000n,     // blocks, about 3.8 years
  maxSupply: 64_000_000n * WEI,    // cap; the real value is slightly lower because of rounding
  maxReorgDepth: 256,              // blocks, about an hour: the network rejects a deeper rewrite
  minBaseFee: 1n * GWEI,           // floor of the base fee
  baseFeeDenominator: 8n,          // EIP-1559: maximum change 1/8
  elasticity: 2n,                  // EIP-1559: the target is half the limit
  gasLimitBoundDivisor: 1024n,     // gas limit change per block
  minGasLimit: 5_000_000n,
  genesisGasLimit: 10_000_000n,    // the worst known block validates in about 6 s on an ordinary computer, see docs/SPECIFICATION.md
  maxExtraData: 32,
  maxBlockBytes: 2 * 1024 * 1024,
  maxTxBytes: 128 * 1024,
});

/**
 * Network checkpoints: `checkpoints: [{ number: 100000n, hash: '0x…' }]` in the network parameters. At that height the node then accepts
 * only this block, and history below it can no longer be rewritten, not even with more work. They are added when a new node version is released.
 */

/**
 * Rules that can change by a hard fork. A fork in `network.forks` overrides them from its height:
 * { name: 'nazev', block: 1000000n, rules: { maxGasLimit: 20_000_000n } }
 * Nodes also recognise each other by the fork list when connecting, see core/forks.js.
 */
export const GENESIS_RULES = Object.freeze({
  // Shanghai + transient storage, MCOPY and SELFDESTRUCT from Cancun (without blobs) + the MODEXP bound and price from Fusaka.
  eips: Object.freeze([1153, 5656, 6780, 7823, 7883]),
  // BLAKE2F costs 1 gas per round in Ethereum. Here it would be the slowest relative to its price, hence 3 gas.
  blake2RoundGas: 3,
  // Cap for miner voting on the gas limit. Going higher requires a fork, once nodes can handle it.
  maxGasLimit: 15_000_000n,
});

const GENESIS_EXTRA = 'Quintium: vlastni sit pro kazdy obor';

/** Proof-of-work check from a contract and a pool factory with automatic distribution. */
const POOLS = Object.freeze({ name: 'pools', rules: Object.freeze({ powPrecompile: true }), upgrades: Object.freeze(['PoolFactory']) });

export const NETWORKS = Object.freeze({
  mainnet: {
    name: 'mainnet', chainId: 52401n, currency: 'QU',
    genesisTimestamp: 1794610800n,      // 14 Nov 2026 00:00 CET (13 Nov 23:00 UTC), mainnet launch
    genesisDifficulty: 2n ** 27n,       // about 9 MH/s for a 15 s block (start with a few cards), LWMA adapts
    minDifficulty: 2n ** 24n,
    genesisExtra: GENESIS_EXTRA,
    ports: { p2p: 30524, rpc: 8545, stratum: 3333 },
    seeds: [
      '2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d@seed.quinvium.com:30524',   // public server, identity key pinned
      '90ddc6a87538e33f494e0d0b9f7c481c8fb9fe94479827b4c0ce9ed1dce9c6cb@45.13.234.150:30524',   // community relay node (issue #37), identity key pinned
    ],
    forks: [{ ...POOLS, block: 1n }],
  },
  testnet: {
    name: 'testnet', chainId: 52402n, currency: 'tQU', folder: 'testnet-5',   // network restart: a new genesis needs an empty database; the old one stays next to it
    genesisTimestamp: 1794600000n,      // 13 Nov 2026 21:00 CET, fourth restart from zero (testnet-5, name Quinvium): old nodes reject the new chain
    genesisDifficulty: 2n ** 22n,
    minDifficulty: 2n ** 16n,
    genesisExtra: 'Quinvium: vlastni sit pro kazdy obor / testnet',   // new name since testnet-5 (13 Nov 2026), mainnet and dev unchanged
    ports: { p2p: 30525, rpc: 8546, stratum: 3334 },
    seeds: ['2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d@seed.quinvium.com:30525'],   // public server (docs/RUNNING-A-PUBLIC-NODE.md), identity key pinned
    forks: [{ ...POOLS, block: 1n }],
  },
  dev: {
    name: 'dev', chainId: 52403n, currency: 'dQU',
    genesisTimestamp: 1793404800n,
    genesisDifficulty: 1n,
    minDifficulty: 1n,
    genesisExtra: GENESIS_EXTRA + ' / dev',
    ports: { p2p: 30526, rpc: 8547, stratum: 3335 },
    seeds: [],
    forks: [{ ...POOLS, block: 1n }],
  },
});
