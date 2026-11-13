# Značka

## Název

**Quinvium**, zkratka **QU**. Na testnetu tQU, na vývojové síti dQU. Zkratka se ještě může změnit.

Jméno vychází z latinského *quinta essentia*, pátá esence. To je aether, pátý živel vedle země, vody, vzduchu a ohně. Od něj je odvozené Ethereum a po něm se tento projekt původně jmenoval. Koncovka -ium je stejná jako u kovů, takže jméno sedí na měnu, která se těží.

Česky se skloňuje jako titanium: Quinvium, z Quinvia, na Quinviu, s Quinviem.

Dřív se projekt jmenoval Aether (AET), Sidereum (SIDR) a Quintium. Quintium se 13. 11. 2026 změnilo na Quinvium, protože doména quintium.com je obsazená. Kontrola 13. 11. 2026: quinvium.com, .net, .org, .io, .cz, .eu a .xyz byly volné (whois), .app obsazená. Na webu nebyl projekt ani kryptoměna stejného jména, podobně znějí blockchain Quantinium a platforma Qinv. Ochranné známky neprověřil právník.

## Proč dvě písmena

Jednopísmenná zkratka nejde: všech 26 písmen už používá nějaký token a dokumentace MetaMasku uvádí, že symbol nativní měny sítě musí mít 2 až 6 znaků. Dvě písmena jsou nejkratší možná délka.

## Ověření jedinečnosti

Kontrola proběhla 2. 11. 2026 pro tehdejší jméno Quintium. Název ani zkratka nebyly v žádném z těchto zdrojů:

| Zdroj | Rozsah |
| --- | --- |
| CoinMarketCap | 37 422 mincí a tokenů |
| CoinGecko | 22 684 mincí a tokenů |
| CoinPaprika | 62 457 položek včetně ukončených |
| ChainList | 2 853 sítí a jejich nativních mincí |
| DexScreener a GeckoTerminal | vyhledání názvu i zkratky na decentralizovaných burzách |
| Běžné vyhledávání | žádná mince, token ani blockchain tohoto jména |

Co kontrola nezaručí: nové tokeny vznikají každý den a kdokoli si může zvolit libovolnou zkratku, proto se token vždy ověřuje podle adresy. Podobně znějí token Quint (QUINT) a firma Quantinium. Ochranné známky neprověřil právník. Doména quintium.com je obsazená a quintium.org také, u .io, .net a .xyz se nepodařilo najít záznam, což ale neznamená, že jsou volné. Balíčky `quintium` v npm a crates.io volné jsou.

## Logo

Znak je písmeno Q z pětiúhelníku: pět stran pro pátou esenci. Ocásek vede po ose pátého vrcholu a vchází dovnitř, aby tvar nebyl lupa. Znak drží i v 16 pixelech a nikde nepoužívá přechody ani stíny.

| Barva | Hodnota | Použití |
| --- | --- | --- |
| Hvězdné zlato | `#F2B544` | znak, mince |
| Noční modrá | `#0B1622` | podklad ikony, znak na světlém pozadí |

Soubory jsou ve složce `assets/brand`. Všechny ikony vznikají z jednoho tvaru příkazem `node scripts/make-brand.mjs`.

## Vzhled

Explorer, aplikace i peněženka mají stejná pravidla:

- Sekce jsou bílé plochy na jemně šedé stránce. Hranici dělá tón plochy, ne rámeček. Každá plocha má malý odstup od sousední, takže je hned vidět, co k čemu patří.
- Mezi řádky seznamů je jen tenká linka, aby šlo sledovat řádek přes celou šířku. Mřížka, rámečky a čáry kolem bloků se nepoužívají.
- Pole mají šedou výplň v bílé sekci a bílou přímo na stránce. Tlačítko je o tón tmavší než pole.
- Vybraná položka nabídky a záložka mají jemnou plochu, aby bylo vidět, kde jste.
- Na každé stránce je jedna hlavní věc. Co není potřeba hned, je o klik dál: filtry pod tlačítkem, formuláře v Aplikacích po rozkliknutí, stav sítě, jazyk a motiv v patičce.
- Prázdné se neukazuje: graf bez dat ani seznam bez položek na stránce nezabírají místo.
- Přehled má čtyři čísla, řádek v seznamu je jeden řádek. V tabulce je to, podle čeho se řádek hledá, zbytek je na detailu.
- Modrý je jen hlavní odkaz v řádku, ostatní se obarví až pod myší.
- Swap a Most jsou jediný formulář uprostřed stránky, trh a trasy jsou až pod ním.
- Aplikace se otevírá Přehledem: zůstatek a čtyři akce vlevo, stav těžby a sítě vpravo. Boční panel má jen to, kam se chodí každý den. Pooly jsou pod Těžbou, O aplikaci pod Nastavením.
- Nabídky a dialogy se od stránky odliší plochou a stínem.
- Patička Exploreru je bílý pás jako sekce: logo s krátkým popisem, mapa stránek ve třech sloupcích a spodní řádek se stavem sítě, verzí uzlu a volbami. V aplikaci má jen mapu stránek a stav, síť, jazyk a vzhled řídí aplikace.

Pravidlo hlídají testy `packages/explorer/test/design.test.mjs` a `packages/explorer/test/pages.mjs`.

## Co nese starý název

Tyto věci zůstávají záměrně, uživatel je běžně nevidí:

| Co | Proč |
| --- | --- |
| Složka dat `Aether` a `~/.aether` | Je v ní peněženka a řetězec, přesun by je mohl ztratit |
| Spouštěč `Aether.exe` | Starší aplikace se aktualizuje přes něj a nové verze ho nemění |
| Vnitřní název kontraktu `WAET` | Jen v kódu. Uživatel vidí Wrapped QU (WQU) |
| `aether_*` v JSON-RPC, `window.aether`, `AETHER_*` | Programové rozhraní, změna by rozbila starší verze |
| Protokol `aether-p2p-v1`, `AetherBridge.v1` | Uzly a validátoři by se přestali domlouvat |

Text v genesis, název a zkratka obalené mince (Wrapped QU, WQU) a podílové tokeny Swapu (Quintium Swap LP, QSLP) jsou přejmenované od restartu testnetu 4. 11. 2026.

Po změně na Quinvium (13. 11. 2026) zůstává jméno Quintium tam, kde je součástí řetězce, dat nebo rozhraní:

| Co | Proč |
| --- | --- |
| Text v genesis „Quintium: …“, pool „Quintium Test Pool“, token „Quintium Swap LP“ | Jsou na řetězci, změnil by je jen restart testnetu |
| Příkaz `quintium`, RPC `quintium_*`, `window.quintium` | Fungují dál vedle nových `quinvium`, `quinvium_*` a `window.quinvium` |
| Soubory `quintium-miner`, `quintium-node`, `quintium.cmd`, balíček `@quintium/cli` | Jména souborů a balíčků, na které odkazují starší verze a návody |
| Proměnné `QUINTIUM_LANG`, `QUINTIUM_KEY` | Uživatelé je mají v nastavení shellu |
| Označení uzlu `quintium-node/…` v P2P a `/health` | Uzly ho jen zobrazují, nikdo ho nečte. Změnit jde později |
| Aktualizace `quintium-<verze>.zip` | Jméno balíčku aktualizace, které starší aplikace hledají |
| Identita uzlů `quintium-hello-v1`, LaunchAgenty `org.quintium.most.*` | Podpis identity a běžící služby |
