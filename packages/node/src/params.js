// Konsensuální parametry sítě Quintium. Změna kterékoli hodnoty je tvrdý fork.
export const WEI = 10n ** 18n;
export const GWEI = 10n ** 9n;

export const CONSENSUS = Object.freeze({
  targetBlockTime: 15,             // sekundy
  lwmaWindow: 60,                  // bloků, 15 minut historie
  lwmaMinSamples: 6,               // pod touto výškou zůstává počáteční obtížnost
  maxSolveTimeFactor: 40,          // strop doby bloku pro výpočet: po odchodu 99,9 % výkonu se síť srovná za půl dne
  futureTimeLimit: 60,             // sekundy, jak daleko v budoucnu smí být blok
  initialReward: 4n * WEI,         // QU za blok
  halvingInterval: 8_000_000n,     // bloků, asi 3,8 roku
  maxSupply: 64_000_000n * WEI,    // strop, skutečná hodnota je o zaokrouhlení nižší
  maxReorgDepth: 256,              // bloků, asi hodina: hlubší přepis síť odmítne
  minBaseFee: 1n * GWEI,           // spodní mez base fee
  baseFeeDenominator: 8n,          // EIP-1559: maximální změna 1/8
  elasticity: 2n,                  // EIP-1559: cíl je polovina limitu
  gasLimitBoundDivisor: 1024n,     // změna limitu gasu za blok
  minGasLimit: 5_000_000n,
  genesisGasLimit: 10_000_000n,    // nejhorší známý blok se na běžném počítači ověří asi za 6 s, viz docs/SPECIFICATION.md
  maxExtraData: 32,
  maxBlockBytes: 2 * 1024 * 1024,
  maxTxBytes: 128 * 1024,
});

/**
 * Kontrolní body sítě: `checkpoints: [{ number: 100000n, hash: '0x…' }]` v parametrech sítě. Na dané výšce pak uzel přijme
 * jen tento blok a historii pod ním už nikdo nepřepíše, ani s větší prací. Přidávají se při vydání nové verze uzlu.
 */

/**
 * Pravidla, která se mohou měnit tvrdým forkem. Fork v `network.forks` je přepisuje od své výšky:
 * { name: 'nazev', block: 1000000n, rules: { maxGasLimit: 20_000_000n } }
 * Podle seznamu forků se uzly také poznají při spojení, viz core/forks.js.
 */
export const GENESIS_RULES = Object.freeze({
  // Shanghai + přechodné úložiště, MCOPY a SELFDESTRUCT z Cancunu (bez blobů) + mez a cena MODEXP z Fusaky.
  eips: Object.freeze([1153, 5656, 6780, 7823, 7883]),
  // BLAKE2F je v Ethereu za 1 gas na kolo. Tady by byl nejpomalejší vůči ceně, proto 3 gas.
  blake2RoundGas: 3,
  // Strop hlasování minerů o limitu gasu. Výš se dá jít jen forkem, až to uzly zvládnou.
  maxGasLimit: 15_000_000n,
});

const GENESIS_EXTRA = 'Quintium: vlastni sit pro kazdy obor';

/** Ověření práce z kontraktu a továrna na pooly s automatickým rozdělováním. */
const POOLS = Object.freeze({ name: 'pools', rules: Object.freeze({ powPrecompile: true }), upgrades: Object.freeze(['PoolFactory']) });

export const NETWORKS = Object.freeze({
  mainnet: {
    name: 'mainnet', chainId: 52401n, currency: 'QU',
    genesisTimestamp: 1794610800n,      // 14. 11. 2026 00:00 SEČ (13. 11. 23:00 UTC), spuštění mainnetu
    genesisDifficulty: 2n ** 27n,       // asi 9 MH/s pro blok za 15 s (start s několika kartami), LWMA se přizpůsobí
    minDifficulty: 2n ** 24n,
    genesisExtra: GENESIS_EXTRA,
    ports: { p2p: 30524, rpc: 8545, stratum: 3333 },
    seeds: ['2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d@seed.quinvium.com:30524'],   // server u Hostingeru, klíč identity připnutý
    forks: [{ ...POOLS, block: 1n }],
  },
  testnet: {
    name: 'testnet', chainId: 52402n, currency: 'tQU', folder: 'testnet-5',   // restart sítě: nový genesis potřebuje prázdnou databázi, stará zůstává vedle
    genesisTimestamp: 1794600000n,      // 13. 11. 2026 21:00 SEČ, čtvrtý restart od nuly (testnet-5, jméno Quinvium): staré uzly nový řetězec odmítnou
    genesisDifficulty: 2n ** 22n,
    minDifficulty: 2n ** 16n,
    genesisExtra: 'Quinvium: vlastni sit pro kazdy obor / testnet',   // od testnetu-5 (13. 11. 2026) nové jméno, mainnet a dev beze změny
    ports: { p2p: 30525, rpc: 8546, stratum: 3334 },
    seeds: ['2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d@seed.quinvium.com:30525'],   // server u Hostingeru (docs/RUNNING-A-PUBLIC-NODE.md), klíč identity připnutý
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
