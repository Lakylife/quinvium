# Specifikace konsensu Quinvium

Tento dokument popisuje pravidla, podle kterých uzel rozhoduje, co je platný blok. Je podkladem pro audit a pro případnou druhou implementaci. Kde se dokument a kód `packages/node/src` rozcházejí, je to chyba, kterou je potřeba opravit. Parametry jsou v `params.js`.

Čísla jsou celá, velká bez omezení. `//` je celočíselné dělení. RLP a Keccak-256 jsou stejné jako v Ethereu.

## 1. Sítě

| Síť | Chain ID | P2P | RPC | Stratum | Počáteční obtížnost | Minimální obtížnost |
| --- | --- | --- | --- | --- | --- | --- |
| mainnet | 52401 | 30524 | 8545 | 3333 | 2^27 | 2^24 |
| testnet | 52402 | 30525 | 8546 | 3334 | 2^22 | 2^16 |
| dev | 52403 | 30526 | 8547 | 3335 | 1 | 1 |

Genesis mainnetu: 14. 11. 2026 00:00 SEČ (`genesisTimestamp` 1794610800), otisk `0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39`. Popis pro veřejnost je v [WHITEPAPER.md](WHITEPAPER.md).

## 2. Formát bloku

Hlavička je RLP seznam přesně 15 položek. Čísla jsou v nejkratším tvaru, úvodní nula se odmítne.

| # | Pole | Typ |
| --- | --- | --- |
| 0 | parentHash | 32 B |
| 1 | miner | 20 B |
| 2 | stateRoot | 32 B |
| 3 | txRoot | 32 B |
| 4 | receiptsRoot | 32 B |
| 5 | logsBloom | 256 B |
| 6 | difficulty | číslo |
| 7 | number | číslo |
| 8 | gasLimit | číslo |
| 9 | gasUsed | číslo |
| 10 | timestamp | číslo, sekundy |
| 11 | extraData | nejvýše 32 B |
| 12 | baseFee | číslo |
| 13 | mixHash | 32 B |
| 14 | nonce | 8 B |

- `sealHash = keccak(rlp(pole 0 až 12))`
- `hash = keccak(rlp(pole 0 až 14))`
- Blok je `rlp([hlavička, [transakce...]])`, transakce jsou bajtové řetězce jako ve stromu transakcí Etherea.
- Hash bloku kryje tělo jen přes `txRoot`. Uzel proto nikdy nesmí označit hash za neplatný kvůli chybě těla, které txRoot neodpovídá: útočník by mohl poslat cizí blok se zfalšovaným tělem a trvale oběť odříznout. Neplatnost se trvale zapisuje jen po selhání provedení u bloku se správným tělem a platnou prací.

Quinvium nemá strýčkovské bloky ani výběry. Pole pro ně v hlavičce nejsou.

## 3. Pravidla hlavičky

Blok `h` s rodičem `p` je platný, když platí vše:

1. `h.number = p.number + 1`
2. `h.timestamp > p.timestamp`
3. `h.timestamp <= now + 60`. Porušení je dočasné: blok se odmítne bez trestu a bez záznamu, později může platit.
4. `len(h.extraData) <= 32`
5. `h.gasUsed <= h.gasLimit`
6. `|h.gasLimit - p.gasLimit| < p.gasLimit // 1024`, `h.gasLimit >= 5 000 000`, `h.gasLimit <= maxGasLimit` z pravidel výšky
7. `h.baseFee = nextBaseFee(p)`, viz 6
8. `h.difficulty = nextDifficulty(p)`, viz 7
9. Ethash je platný, viz 8

Blok o `number + 256 <= head.number` se odmítne.

## 4. Pravidla těla

1. `len(blok) <= 2 097 152` bajtů
2. Každá transakce má nejvýše 131 072 bajtů
3. Typy transakcí 0, 1 a 2. Typ 0 musí mít ochranu chain ID podle EIP-155.
4. `txRoot` je kořen uspořádaného stromu s klíčem `rlp(index)`
5. Součet `tx.gasLimit` postupně nesmí překročit zbytek limitu bloku
6. Výsledek provedení musí přesně odpovídat polím `stateRoot`, `receiptsRoot`, `gasUsed` a `logsBloom`

## 5. Provádění

EVM odpovídá pravidlům Shanghai a navíc EIP-1153, EIP-5656, EIP-6780, EIP-7823 a EIP-7883. Bloby ani EIP-4788 síť nemá, takže adresa `0x0a` není předkompilovaný kontrakt a instrukce `0x49` a `0x4a` jsou neplatné.

Quinvium nepřebírá EIP-7623, velikost bloku hlídá limit z části 4.

Odchylky od Etherea:

| Věc | Quinvium | Důvod |
| --- | --- | --- |
| Základní poplatek | Dostává ho těžař, nepálí se | Příjem těžařů |
| BLAKE2F | 3 gas za kolo místo 1 | Jinak nejpomalejší operace vůči ceně |
| PREVRANDAO (`0x44`) | `p.mixHash` | Není beacon chain. Těžař hodnotu ovlivní, nepoužívat pro loterie. |
| MODEXP | EIP-7823 a EIP-7883 | Stejná změna jako Fusaka v Ethereu |

Pořadí v bloku:

1. Transakce se provádějí v pořadí bloku nad stavem rodiče.
2. Dýško dostává těžař při provedení každé transakce, stejně jako v Ethereu.
3. Po poslední transakci se účtu `miner` přičte `blockReward(number) + gasUsed × baseFee`.

`BLOCKHASH` vrací hash předka na větvi prováděného bloku.

## 6. Ekonomika

```
blockReward(n):
    n == 0: 0
    h = (n - 1) // 8 000 000
    h >= 64: 0
    jinak: 4 × 10^18 >> h

nextBaseFee(p):
    target = p.gasLimit // 2
    p.gasUsed == target: base = p.baseFee
    p.gasUsed >  target: base = p.baseFee + max(p.baseFee × (p.gasUsed - target) // target // 8, 1)
    p.gasUsed <  target: base = p.baseFee - p.baseFee × (target - p.gasUsed) // target // 8
    výsledek = max(base, 1 gwei)
```

Těžař dostane odměnu za blok a celý poplatek každé transakce. Nic se nepálí, mince vznikají jen odměnou za blok. Součet odměn je nejvýše 64 000 000 QU, skutečnost je o zaokrouhlení nižší. Mince se nepředtěžují. Genesis obsahuje jen 11 systémových kontraktů bez zůstatku.

Genesis má `gasLimit` 10 000 000, strop hlasování minerů je 15 000 000. Limit vychází z měření: nejhorší známý blok se na iMacu s Intel Core i5 ověří asi za 6 s při čase bloku 15 s.

## 7. Obtížnost

LWMA počítaná z posledních 60 bloků, `T = 15`:

```
nextDifficulty(p):
    p.number < 6: počáteční obtížnost sítě
    n = min(p.number, 60)
    c[n] = p, c[i-1] = rodič c[i]
    weighted = 0, sum = 0
    pro i od 1 do n:
        st = c[i].timestamp - c[i-1].timestamp
        st = min(st, 40 × T)
        st = max(st, 1)
        weighted += st × i
        sum += c[i].difficulty
    weighted = max(weighted, n² × T // 20)
    d = sum × (n + 1) × T // (2 × weighted)
    výsledek = max(d, minimální obtížnost)
```

Strop 40T zkracuje zotavení po odchodu většiny výkonu. Simulace: odchod 99,9 % výkonu trvá asi půl dne proti třem dnům se stropem 6T. Prohledání 352 kombinací falešných časů ani se 100 % výkonu nezrychlilo emisi pod 15,1 s na blok.

## 8. Proof of Work

Ethash shodný s Ethereem včetně velikostí cache a DAG, délka epochy 30 000 bloků, `epocha = number // 30000`.

```
(mix, result) = hashimoto(sealHash, nonce, epocha)
platné, když mix == h.mixHash a result <= 2^256 // h.difficulty
```

Implementace je ověřená proti osmi skutečným blokům Etherea v epochách 1 až 517 a v JavaScriptu i v Rustu.

## 9. Výběr řetězce

Platí větev s největší součtem obtížnosti. Při shodě zůstává ta, kterou uzel viděl první. Reorganizace hlubší než 256 bloků projde jen tehdy, když nová větev nese od společného předka aspoň dvojnásobek práce naší větve. Uzel nejdřív stáhne a ověří práci všech hlaviček nové větve a teprve potom přijme její bloky.

Pravidlo finality není součástí platnosti bloku: nový uzel při první synchronizaci žádnou hranici nemá a zvolí nejtěžší větev. Síť rozdělená déle než 256 bloků se po spojení srovná na stranu s aspoň dvojnásobnou prací. Když mají obě strany podobnou práci, uzly zůstanou na svých větvích, ohlásí to v logu a vzájemně se neblokují. Pod kontrolním bodem (`checkpoints`) se historie nepřepíše nikdy.

## 10. Aktualizace sítě

Fork v `network.forks` mění pravidla od pevné výšky:

```js
{ name: 'nazev', block: 1000000n, rules: { maxGasLimit: 20_000_000n, eips: [...] } }
```

Pravidla, která lze měnit: `eips`, `blake2RoundGas`, `maxGasLimit`, `powPrecompile`. Další se přidají podle potřeby spolu s verzí pravidel.

Fork může přidat systémový kontrakt: pole `upgrades` jmenuje kontrakty z `genesis/upgrades.json`. Na výšce forku se před první transakcí bloku zapíše kód a nonce 1, zůstatek adresy se nemění. Genesis běžící sítě se tak měnit nemusí.

### Fork `pools`

Aktivace: mainnet a dev od bloku 1, testnet podle `network.forks`. Přidává dvě věci.

Kontrakt `PoolFactory` na adrese `0xae0000000000000000000000000000000000000c`.

Vestavěnou funkci ověření práce na adrese `0x0000000000000000000000000000000000000100`. Stojí vždy 100 000 gasu, což odpovídá výpočtu asi 6 ms. Při nižším limitu gasu skončí chybou nedostatku gasu.

Vstup je RLP celé hlavičky. Prázdný výstup vrátí, když platí cokoli z tohoto:

- vstup je delší než 2048 bajtů nebo není kanonická hlavička s 15 poli
- `number < 1` nebo `number` je vyšší než výška prováděného bloku
- `difficulty` je 0 nebo aspoň 2^256, nebo je `extraData` delší než 32 bajtů
- epocha hlavičky je starší než předchozí epocha prováděného bloku, jinak by uzly musely počítat cizí cache
- `mixHash` neodpovídá hodnotě z `hashimoto(sealHash, nonce)`

Jinak vrátí sedm 32bajtových slov: `miner`, `number`, `parentHash`, `difficulty`, `work`, `extraData` zarovnané vlevo a hash celé hlavičky, kde `work = 2^256 // (result + 1)`, u nulového výsledku `2^256 - 1`. Funkce obtížnost nekontroluje, rozhoduje o ní volající kontrakt.

Uzly se poznají identifikátorem podle EIP-2124:

```
h[0] = keccak(genesisHash)[0..4]
h[k] = keccak(genesisHash || block[1] || ... || block[k])[0..4]
```

Handshake nese aktuální `h` a výšku dalšího známého forku. Uzel s neslučitelnou historií se odpojí, takže starý software se od sítě oddělí čistě a tiše se nerozejde na jinou větev.

## 11. Protokol uzlů

Nejde o konsensus, chyba tady nerozštěpí síť, ale může ji poškodit.

- TCP, výměna X25519, klíče HKDF-SHA256 se solí `aether-p2p-v1`, rámce AES-256-GCM s počítadlem. Šifra musí existovat v OpenSSL i BoringSSL, protože uzel v desktopové aplikaci běží v Node z Electronu.
- Volba `--lan`: uzel každých 10 s pošle na UDP port 30529 všesměrově `aether-lan1 <chainId> <genesis> <p2pPort> <nodeId> ask` a na stejnou zprávu odpovídá přímo jejímu odesílateli s `reply`. Přijímají se jen zprávy ze soukromých adres a se stejným řetězcem. Zpráva nic nedokazuje, ověřuje se až spojení a bloky. Lokální adresy se nešíří do veřejné výměny adres.
- Rámec: 4 bajty délky, šifrovaný typ a RLP tělo. Do handshaku nejvýše 16 KiB, potom 12 MiB.
- Identita uzlu: trvalý klíč Ed25519 v `node.key` ve složce dat. Identifikátor uzlu je prvních 16 bajtů SHA-256 veřejného klíče. HELLO nese za původními 11 poli veřejný klíč, podpis a bajt schopností. Podepisuje se `quintium-hello-v1`, role (1 iniciátor, 0 příjemce) a SHA-256 ze soli a obou dočasných klíčů X25519 v pořadí iniciátor, příjemce. Útočník, který by spojení přeposílal, má s každou stranou jiné dočasné klíče, takže podpis neprojde.
- Mainnet přijímá jen uzly s identitou, testnet i starší verze bez ní. Seed může mít připnutý klíč ve tvaru `klíč@host:port` (64 hex znaků). Spojení s ním projde jen s jeho podpisem, ani podvržené DNS tak novému uzlu nepodstrčí cizí síť. Klíč uzlu vrací `aether_nodeInfo`.
- Ohlášení hashem (schopnost 1): celou transakci nebo blok dostanou všichni starší sousedé a odmocnina z počtu nových, ostatní noví jen hash a o obsah si řeknou. Provoz tak roste s odmocninou počtu sousedů.

| Zpráva | Limit | Účel |
| --- | --- | --- |
| HELLO | 1 za s | verze, síť, genesis, špička, forky |
| PING, PONG, STATUS | 1 za s | živost a stav |
| GET_HEADERS | 8 za s | nejvýše 256 hlaviček, 64 položek lokátoru |
| GET_BLOCKS | 16 za s | nejvýše 64 bloků a 8 MiB |
| NEW_BLOCK | 4 za s | šíří se až po úplném ověření |
| NEW_TXS | 16 za s, 64 transakcí za s na uzel | nejvýše 256 v dávce |
| GET_PEERS | 1 za 20 s | nejvýše 64 adres |
| NEW_TX_HASHES | 16 za s | nejvýše 1024 hashů |
| GET_TXS, TXS | 16 za s | nejvýše 256 transakcí a 8 MiB |
| NEW_BLOCK_HASH | 4 za s | hash, výška a práce, blok se stáhne přes GET_BLOCKS |

Uzel, který nečte, se odpojí nejpozději při 32 MiB ve frontě odesílání.

**Synchronizace.** Tvrzení cizího uzlu o práci nic nedokazuje. Uzel stahuje hlavičky a bloky od toho, kdo slibuje nejvíc, a když sliby nesplní, dostane body a přichází další. Za opožděný se uzel považuje až po 32 ověřených stažených blocích, teprve pak přestane rozdávat práci minerům.

**Adresy.** Ověřené adresy, kam se uzel sám připojil, jsou oddělené od adres slyšených od jiných uzlů. Odchozí spojení míří nejvýše na jednu adresu z rozsahu /16, tři čtvrtiny z ověřených adres. Příchozí spojení: 32 celkem, 3 z jedné IP, 6 z rozsahu /16.

## 12. Doložení

| Oblast | Důkaz |
| --- | --- |
| EVM | Oficiální `ethereum/tests` v14.1 GeneralStateTests pro Cancun a `execution-spec-tests` v5.4.0 pro EIP-7823 a EIP-7883, skript `packages/node/test/statetests.mjs` |
| Ethash | Skutečné bloky Etherea, `test/ethash.test.js`, s `AETHER_SLOW=1` i vysoké epochy |
| Kryptografie | Křížový test WebAssembly proti referenční implementaci, `test/crypto-diff.test.js` |
| Útoky | `test/attacks.test.js` |
| Náhodné zkoušky | `test/fuzz.test.js` |
| Forky | `test/forks.test.js` |
| Konsensus se nezměnil | Pevné otisky v `test/golden.test.js` |

Závislosti, které ovlivňují konsensus, mají přesné verze v `packages/node/package.json`. Aktualizace kterékoli z nich je potenciálně tvrdý fork a vyžaduje znovu spustit celou sadu.
