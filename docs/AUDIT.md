# Bezpečnostní přezkum, listopad 2026

Tohle je vnitřní přezkum provedený autorem kódu. **Není to nezávislý audit** a nenahrazuje ho. Před nasazením mostu
nebo poolů se skutečnou hodnotou je nezávislý audit kontraktů nutný.

## Rozsah

Nový kód od verze 2.0: pooly (`AetherPool`, `PoolFactory`, vestavěná funkce `0x…0100`, server poolu), most
(`BridgeGateway`, `WrappedAsset`, validátoři, Bitcoin), Swap (`SwapPair`, `SwapFactory`, `SwapRouter`), stablecoiny
(`StableToken`, `TokenRegistry`), nové metody RPC, aktualizace na dálku, přihlašování peněženek a zámek aplikace. Konsensus a síť mají vlastní útočné testy z dřívějška,
viz [BEZPECNOST.md](BEZPECNOST.md).

## Metody

| Metoda | Rozsah | Výsledek |
| --- | --- | --- |
| Náhodné posloupnosti akcí proti neměnným pravidlům | Pool: 3 běhy po 300 krocích. Most: 3 běhy po 300 krocích. Swap: běh se 120 kroky | Bez porušení |
| Pokusy o podvod | Falešné podíly, cizí příjemce, nepoctivý navrhovatel, podvržené podpisy, opakované doručení | Všechny odmítnuté |
| Křížová kontrola s nezávislým kódem | Adresy, transakce a podpisy Bitcoinu proti bitcoinjs-lib a tiny-secp256k1 | Shoda |
| Zátěž | RPC, Stratum, plné bloky, 5 milionů transakcí, viz [KAPACITA.md](KAPACITA.md) | Nalezené problémy opravené |
| Závislosti | `npm audit --omit=dev` | 0 známých zranitelností v kódu, který běží u uživatele |
| Statická kontrola Rustu | `cargo clippy` | Jen styl, žádná chyba bezpečnosti |
| Čtení kódu | Všechny nové kontrakty a služby | Viz nálezy |

Pravidla ověřovaná po každém kroku náhodného běhu:

- Pool: zůstatek kontraktu pokryje všechny závazky. Přijaté mince se rovnají zůstatku plus výplatám, žádná nezmizí ani nepřibude.
  Provozovatel nedostane víc než svůj poplatek. Výplata těžaře nikdy neklesne. Těžaři dohromady nedostanou víc, než pool přijal.
- Swap: zásoby se po každém kroku rovnají zůstatkům, součin zásob při směně nikdy neklesne a hodnota podílu neklesne při změně likvidity.
- Most: zůstatek brány se přesně rovná uzamčené částce. Uzamčeno je přesně tolik, kolik je vydáno plus na cestě.
  Opakované doručení, změněná částka ani jeden podpis nikdy neprojdou.

Běhy ukázaly přesný poplatek: 2,5 % ze 776 je 19,4 a zbytek jsou těžaři bez ztráty mimo prach ze zaokrouhlení.

## Nalezené a opravené problémy

| # | Závažnost | Problém | Oprava |
| --- | --- | --- | --- |
| 1 | Vysoká | Převod mostem na řetězec EVM s příjemcem jiné délky než 20 bajtů by mince trvale uzamkl | Brána takový převod odmítne |
| 2 | Vysoká | Značku výběru v síti Bitcoin může napodobit kdokoli a výběr by vypadal jako zaplacený | Rozhoduje transakce utrácející úschovu, ne značka |
| 3 | Vysoká | Skript aktualizace se na Windows nerozběhl a aplikace po ukončení zůstala vypnutá | Nové verze se spouštějí ze složky bez vnějšího skriptu, s návratem při selhání |
| 4 | Střední | Filtry Exploreru běžely v hlavním vlákně, opakovaný náročný dotaz by zdržel bloky | Dotazy běží ve vláknech a mají frontu s limitem |
| 5 | Střední | Levná registrace vkladové adresy spouštěla pomalé prohledání Bitcoinu | Prohledává se v dávkách, jedna na průchod |
| 6 | Střední | `aether_poolPayouts` při každém dotazu sčítal až 2000 výplat | Součet se počítá jen při nové výplatě |
| 7 | Střední | Těžba nebránila uspání počítače, těžař tiše přestal těžit | Při těžbě aplikace blokuje uspání systému |
| 8 | Nízká | Spojení na Stratum procházela seznam všech relací, při tisících zařízení zbytečně pomalé | Počítadlo podle adresy |
| 9 | Nízká | Validátor žádal logy z delšího rozsahu, než uzel dovolí | Čtení po částech |
| 10 | Nízká | Při převodu z jiné sítě se peněženka vracela zpět před potvrzením | Návrat až po potvrzení |
| 11 | Vysoká | Stránky Síť a uzly, Žebříček adres a Čekající transakce se ztratily při přepisu Exploreru a testy je neprošly | Stránky obnovené, test `explorer/test/pages.mjs` prochází každou stránku v 5 jazycích |
| 12 | Střední | Odhad výkonu sítě po zastavení těžby nikdy neklesl na nulu a ukazoval výkon, který neexistoval | Po 180 s bez bloku je odhad nula, přehled to řekne přímo |
| 13 | Střední | Aplikace a grafy ukazovaly poslední známý výkon i u zastaveného mineru | Číslo u grafu platí pro teď, historie zůstává v grafu |
| 14 | Střední | Uzel `aether_tokenInfo` by při plné frontě tiše počítal zůstatky jako nulu | Chyba fronty se vrátí, nulou se počítá jen zamítnuté volání |
| 15 | Nízká | Cizí uzel by přes `deployments.json` mohl příkazové řádce podstrčit falešný router | Adresy z vydání mají přednost před údaji z uzlu |
| 16 | Nízká | Graf ukazoval falešný pokles výkonu na konci a první blok po genesis ho celý zdeformoval | Výkon se počítá za skutečně pokrytý čas, první blok se do časů nepočítá |

## Přezkum 7. a 8. 11. 2026

Druhé čtení celého kódu, opět autorem, ne nezávislý audit. Opravy jsou v kódu s testy, do aplikace se dostanou novou verzí.

| # | Závažnost | Problém | Oprava |
| --- | --- | --- | --- |
| 17 | Vysoká | Přepis hlubší než 256 bloků se odmítal vždy. Rozdělená síť se sama nespojila a nový uzel, kterému útočník podstrčil levnou větev, na ní zůstal navždy | Hluboký přepis projde s dvojnásobkem práce od místa rozdělení. Uzel nejdřív ověří práci všech hlaviček větve, poctivý uzel z druhé strany se neblokuje |
| 18 | Vysoká | Synchronizace postranní větve se po první dávce 256 hlaviček zasekla | Lokátor pokračuje od poslední stažené hlavičky |
| 19 | Vysoká | Most čekal na Quintiu jen 12 potvrzení, malou síť jde na pár minut přepsat pronajatým výkonem | Validátor se nespustí s méně než 240 potvrzeními na mainnetu Quintia a 64 na Ethereu |
| 20 | Vysoká | Podpis aktualizace nekryl platformu, stahování nemělo strop a rozbalení na Windows nehlídalo `\` | Pole `platform` v podepsaném manifestu, přerušení nad podepsanou velikostí, přísnější kontrola cest |
| 21 | Střední | Identita uzlu se neověřovala, útočník uprostřed mohl spojení přeposílat | Trvalý klíč Ed25519, podepsaný otisk spojení, seedy s připnutým klíčem |
| 22 | Střední | Transakce a bloky se posílaly celé všem sousedům | Celé jen odmocnině sousedů, ostatním hash |
| 23 | Střední | Chyba knihovny při ověření bloku se zařazovala podle textu hlášky | Vlastní kontrola důvodu. O přijetí bloku dál rozhoduje EthereumJS |
| 24 | Střední | Na veřejném uzlu šlo přes `eth_submitHashrate` zfalšovat výkon sítě | Volba `--no-mining-rpc` |
| 25 | Střední | `/health` věřil výšce jediného souseda | Druhá nejvyšší výška |
| 26 | Střední | Pooly mohly při plných blocích vytlačovat platby | Méně podílů za blok podle zaplnění bloků |
| 27 | Nízká | Cache nové epochy Ethash se počítala až s jejím prvním blokem | Počítá se 1 000 bloků předem |
| 28 | Nízká | `backfillIndex` četl blok před kontrolou, že existuje | Opraveno |
| 29 | Nízká | Akce v CI nebyly připnuté, CI běželo jen na Windows | Připnuté na otisk commitu, přibyla úloha pro Linux |

Ověřeno a bez změny: hlášení `npm audit` u WalletConnectu se týkají knihoven, které v `walletconnect.js` nejsou.
Souhrny v rejstříku Exploreru jsou čísla s plovoucí čárkou záměrně, přesné částky se berou z bloků.

## Zbývající rizika

- **Most je tak bezpečný, jak nezávislí jsou validátoři.** Shoda většiny může kontrakt přimět vydat tokeny. Limity,
  čekání a strážce škodu omezí, ale nevyloučí. Nikdo jeden by neměl držet víc než jeden klíč.
- **Bitcoin bez kontraktu.** Úschova je vícepodpisová adresa. Validátor musí držet klíč bezpečně, nejlépe v hardwarovém modulu.
- **Bitcoinová strana neprošla proti skutečnému uzlu Bitcoin Core.** Transakce ověřila nezávislá knihovna a simulace
  uzlu, ne síť. Před použitím je nutný test v regtestu a na testnetu.
- **Přeskupení Bitcoinu hlubší než počet potvrzení** by znamenalo nekrytý token. Výchozích 6 potvrzení je kompromis, velké vklady čekají ve frontě.
- **Správce mostu a seznamu tokenů má být vícepodpisový kontrakt**, ne jeden klíč. Testnet má jeden klíč.
- **Swap vychází z ověřeného návrhu Uniswap V2, ale je to nová implementace.** Neprošla nezávislým auditem. Kurz v malém poolu lze snadno pohnout, proto stránka varuje před dopadem na cenu.
- **Zámek aplikace chrání před člověkem u počítače, ne před škodlivým programem.** Heslo ověřuje okno aplikace, kdo ovládá účet uživatele, může ho obejít. Trezor peněženky zůstává šifrovaný.
- **Spojení s MetaMaskem běží přes místní stránku na 127.0.0.1.** Chrání ho náhodný token, kontrola hlaviček Host a Origin a podpis dokazující vlastnictví adresy. Kdo ovládá účet uživatele, může žádost podstrčit, potvrdit ji ale musí uživatel v MetaMasku.
- **Most nemá poplatek.** Validátoři platí plyn sami, spam malými převody omezuje jen `minAmount`.
- **Spoléhání na veřejný uzel.** Validátor musí mít vlastní uzly obou řetězců. Cizí uzel by mu mohl lhát.
- **Vestavěná funkce `0x…0100` je konsensus.** Chyba v ní by znamenala fork, má proto vlastní testy včetně podvržených hlaviček.
- **`NvAPI` pro výkon karty je neveřejné rozhraní.** Běží v samostatném procesu a jeho selhání těžbu neohrozí.
- **Slither a další statické analyzátory Solidity neběžely.** Jejich instalaci by měl udělat audit, spolu s `cargo audit`.
- **Závislosti vývojových nástrojů** mají hlášení v `npm audit` (electron-builder, knihovny WalletConnect). Do balíčku pro uživatele
  se nedostanou, `ws`, `zod` ani AppKit v něm nejsou.
- **Název Quintium a zkratka QU** neprošly právní kontrolou ochranných známek. V seznamech CoinMarketCap, CoinGecko, CoinPaprika a ChainList ani na decentralizovaných burzách je 2. 11. 2026 nikdo nepoužíval, nové malé tokeny ale vznikají každý den. Před mainnetem a listingem na burzách je potřeba to právně prověřit.

## Audit 10. 11. 2026

Čtení kódu uzlu, kontraktů, validátoru mostu a peněženky s pomocí Claude. Není to nezávislý audit třetí stranou.

| # | Závažnost | Problém | Oprava |
| --- | --- | --- | --- |
| 30 | Kritická | Při synchronizaci hluboké větve se u první dávky hlaviček nekontrolovala výška. Jedna hlavička s obtížností 1 a výškou 10^30 spustila výpočet cache Ethash pro svou epochu a natrvalo zablokovala uzel | Výšky musí navazovat od společného předka, `Pow.verify` odmítne hlavičku víc než 100 000 bloků nad špičkou |
| 31 | Vysoká | Hlubokou větev s vymyšlenou obtížností 1 šlo vyrobit zadarmo a každý uzel ji minuty ověřoval. Pauza po odmítnutí platila jen pro spojení | Před výpočtem Ethash se kontroluje obtížnost podle LWMA a časy, pauza platí pro adresu |
| 32 | Střední | Nová brána mostu na stejném řetězci by vydávala stejná čísla zpráv jako stará a jejich ID by se v cílové bráně srazila | Horní polovina čísla zprávy je odvozená z adresy brány, adresa je i v ID odeslání |
| 33 | Střední | Peněženka na žádost stránky podepsala i za jiný účet z trezoru, než který je vybraný | `personal_sign` a `eth_signTypedData_v4` podepíší jen za vybraný účet |
| 34 | Nízká | Validátoři mostu podepisovali holý hash | Podpis s předponou EIP-191, holý podpis brána odmítne |
| 35 | Nízká | Náhrada transakce, která se nevešla do plné fronty, odstranila i původní transakci | Původní se odstraní, až když je místo jisté |
| 36 | Nízká | `personal_sign` s pořadím (adresa, zpráva) podepsal adresu jako zprávu | Pořadí se pozná podle adresy |
| 37 | Nízká | Kontrola neveřejných adres nepokrývala CGNAT, `0.0.0.0/8` a vyhrazené rozsahy | `net.BlockList` se všemi neveřejnými rozsahy |

Opravy 32 a 34 mění kontrakt `BridgeGateway` a podpis validátorů. Bránu je potřeba nasadit znovu na obou stranách
a validátory spustit v nové verzi, stará a nová verze si nerozumí.

Zbývající rizika z tohoto auditu:

- **Podíl v poolu nemusí být platný blok.** `AetherPool` ověřuje práci, příjemce odměny, stáří a rodiče, ne zbytek hlavičky.
  Těžař může posílat podíly, které by ani při zásahu obtížnosti sítě nebyly platným blokem: dostává výplatu, ale poolu nikdy
  nepřinese odměnu, a nejde to poznat z jednoho podílu. Zadržování bloků je obecná slabina poolů a úplná oprava neexistuje.
  Částečná oprava (vestavěná funkce vrací i obtížnost a kontrakt ji porovná se sítí) je změna konsensu a čeká na příští fork.
  Do té doby má provozovatel sledovat poměr podílů a nalezených bloků u jednotlivých těžařů.
- **Základní poplatek dostává těžař.** Těžař proto může plnit vlastní bloky vlastními transakcemi zadarmo a zvedat tím základní
  poplatek ostatním. Je to vědomá volba návrhu, strop škody dává mez změny 1/8 za blok.
- **Peněženka: testy v prohlížeči po opravě 33 a 36 neběžely.** Před vydáním spustit `extension/test/e2e.mjs` a `desktop/test/e2e.mjs`.
