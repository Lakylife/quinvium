# Quinvium

Vlastní programovatelný blockchain s těžbou na grafických kartách.

| Parametr | Hodnota |
| --- | --- |
| Mince | Quinvium (QU), na testnetu tQU |
| Konsensus | Proof of Work, Ethash, obtížnost LWMA po každém bloku |
| Čas bloku | 15 s |
| Odměna | 4 QU, půlení po 8 000 000 blocích (asi 3,8 roku) |
| Maximální nabídka | 64 000 000 QU, bez předtěžených mincí |
| Poplatky | EIP-1559: základní poplatek i dýško dostane těžař, nic se nepálí |
| Chytré kontrakty | EVM Shanghai a Cancun bez blobů, Solidity, nástroje a peněženky pro Ethereum |
| Kapacita | 10 milionů gasu v bloku, asi 31 převodů za sekundu, nejvýš 15 milionů hlasováním |
| Těžební pooly | Odměny drží kontrakt a dělí je podle práce ověřené sítí, provozovatel je nemůže vzít |
| Most | ETH, BTC a tokeny oběma směry, ověřují nezávislí validátoři, zatím neběží, viz [docs/MOST.md](docs/MOST.md) |
| Swap | Pooly likvidity s konstantním součinem, poplatek 0,3 % poskytovatelům, bez správce |
| Stablecoiny | Připravený token pro vydavatele a seznam ověřených tokenů. Testnet nemá přednastavené tokeny, zakládají si je jejich autoři |
| Aktualizace | Forky s výškou aktivace, uzly se poznají identifikátorem podle EIP-2124 |
| Ochrana před přepisem | Reorganizace hlubší než 256 bloků se odmítá |
| Chain ID | mainnet 52401, testnet 52402, dev 52403 |

## Obsah repozitáře

| Složka | Účel |
| --- | --- |
| `packages/node` | Plný uzel: konsensus, síť, JSON-RPC, Stratum |
| `packages/miner` | GPU miner v Rustu (OpenCL, Vulkan, DirectX 12, Metal) |
| `packages/contracts` | Systémové kontrakty pro různé obory |
| `packages/explorer` | Webový explorer a aplikace pro obory |
| `packages/extension` | Quinvium Wallet pro Chrome |
| `packages/desktop` | Aplikace pro Windows a macOS: peněženka, uzel, těžba, pooly, Swap a Bridge |
| `packages/bridge` | Validátor mostu pro řetězce EVM a Bitcoin |
| `packages/cli` | Příkazová řádka `quinvium` anglicky i česky: peněženka, převody, swap, most, pooly, těžba, aplikace sítě (notář, certifikáty, dodavatelský řetězec, úschova, hlasování, jména, token, NFT, multisig) a kontrola řetězce, viz `docs/PRIKAZOVA-RADKA.md` |
| `scripts/zatez` | Zátěžové testy |
| `docs` | Návody, bezpečnost a plán spuštění |

Název, logo a ověření jedinečnosti popisuje [docs/ZNACKA.md](docs/ZNACKA.md).

## Příkazová řádka

Vše, co umí aplikace, jde dělat i z terminálu příkazem `quinvium`: peněženka, převody, swap, most, pooly, těžba, uzel a kontrola celého řetězce. Viz [docs/PRIKAZOVA-RADKA.md](docs/PRIKAZOVA-RADKA.md).

## Rychlé spuštění

Potřebujete Node.js 24 a pro miner Rust.

```
npm install
cd packages/miner && cargo build --release && cd ../..
node packages/node/src/cli.js --network testnet
./packages/miner/target/release/quintium-miner --address 0xVASE_ADRESA --node http://127.0.0.1:8546
```

Explorer pak běží na http://127.0.0.1:8546.

## Testy

```
npm test --workspace packages/node
npm test --workspace packages/contracts
node packages/explorer/test/e2e.mjs
node packages/explorer/test/connect.mjs
node packages/explorer/test/pools.mjs
node packages/explorer/test/bridge.mjs
node packages/explorer/test/swap.mjs
node packages/explorer/test/pages.mjs
node --test --test-concurrency=1 packages/bridge/test/*.test.js
node --no-warnings --test packages/cli/test/cli.test.js
node packages/explorer/test/tokens.mjs
node --test packages/explorer/test/i18n.test.mjs
node packages/explorer/test/docs.mjs
node packages/extension/test/e2e.mjs
node packages/desktop/test/e2e.mjs
node --test packages/desktop/test/updater.test.cjs
node packages/desktop/test/update-e2e.mjs      # skutečná aktualizace sestavené aplikace na macOS
cargo test --release --manifest-path packages/miner/Cargo.toml
```

Oficiální testy EVM z repozitáře `ethereum/tests` (značka v14.1) a Ethash ve vysokých epochách:

```
node packages/node/test/statetests.mjs <cesta>/GeneralStateTests Cancun
AETHER_SLOW=1 node --test packages/node/test/ethash.test.js
```

Delší náhodné běhy nad kontrakty: `AETHER_FUZZ_STEPS=300 node --test --test-concurrency=1 packages/contracts/test/invariants.test.js`.

Sestavení všech balíčků pro Windows: `bash scripts/release.sh`. Sestavení a instalace na macOS: `bash scripts/install-mac.sh`.

Dokumentace pro vývojáře je v exploreru na stránce Pro vývojáře. Její příklady spouští test `packages/explorer/test/docs.mjs`.

Další dokumentace: [docs/NAVOD.md](docs/NAVOD.md), [docs/SPECIFIKACE.md](docs/SPECIFIKACE.md), [docs/BEZPECNOST.md](docs/BEZPECNOST.md), [docs/AUDIT.md](docs/AUDIT.md), [docs/KAPACITA.md](docs/KAPACITA.md), [docs/MOST.md](docs/MOST.md), [docs/SPUSTENI-SITE.md](docs/SPUSTENI-SITE.md).
