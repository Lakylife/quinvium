# Bezpečnost

## Stav

Kód prošel automatickými testy, útoky na vlastní kód a oficiální sadou testů EVM z Etherea, **ale ne nezávislým bezpečnostním auditem**. Před spuštěním mainnetu s reálnou hodnotou je audit nutný, hlavně u konsensu, síťové vrstvy, kontraktů a peněženky. Pravidla popisuje [SPECIFIKACE.md](SPECIFIKACE.md).

Přezkum novějšího kódu je v [AUDIT.md](AUDIT.md), měření zátěže v [KAPACITA.md](KAPACITA.md). Co musí být hotové před spuštěním a co nejde vyřešit kódem, je v [NASAZENI.md](NASAZENI.md).

## Co pokrývají testy

| Oblast | Ověřeno |
| --- | --- |
| EVM | Oficiální `ethereum/tests` GeneralStateTests přes skutečný kód uzlu, spustí `packages/node/test/statetests.mjs` |
| Ethash | Bajtová shoda s osmi skutečnými bloky Etherea v epochách 1 až 517, v JavaScriptu i v Rustu. Skutečná karta přešla přes hranici epochy. |
| Kryptografie | Křížový test WebAssembly proti referenční implementaci, včetně zlomyslných vstupů |
| Validace bloku | Stav, účtenky, transakce, poplatky, gas, obtížnost, čas, PoW, velikost, změna každého pole hlavičky |
| Forky | Výběr nejtěžší větve, náhodné větve v náhodném pořadí, vrácení stavu, restart po reorganizaci, hranice finality |
| Aktualizace | Pravidla se mění přesně na výšce forku, starý software se odpojí čistě |
| Mempool | Podpis, nonce, součet závazků odesílatele, poplatek, náhrada, strop paměti, uložení fronty přes restart, plná fronta bez mezer v nonce, předání fronty novému uzlu |
| Síť | Sync po dávkách, rozdělení a spojení sítě, smetí v každém typu zprávy, limity provozu |
| Pády | Opakované tvrdé ukončení uprostřed práce, kontrola integrity databáze |
| Celistvost dat | Padělaná odměna, změna transakce, hlavičky i zůstatku v databázi, podstrčený blok a falešný rejstřík, viz `integrity.test.js` a `quinvium audit` |
| Kontrolní body | Cizí větev s větší prací, nový uzel na cizím řetězci, stará databáze |
| Obtížnost | Simulace pravého LWMA proti těžaři s 30 a 49 % výkonu a vymyšlenými časy |
| Příkazová řádka | Skutečné procesy proti skutečným uzlům: peněženka, převody, swap, likvidita, pooly a most včetně doručení validátory |
| RPC | ethers.js a Solidity, chybné požadavky, nekonečné smyčky v `eth_call` |
| Kontrakty | Běžné scénáře, neoprávněný přístup, předbíhání, opětovný vstup, zmizelý rozhodce |
| Pooly | Skutečný Ethash a skutečná karta: podíly, bloky pro kontrakt, automatická výplata, ETHPROXY a EthereumStratum, podvržené podíly, opětovný vstup, odchod provozovatele |
| Explorer | Všechny aplikace proklikané ve skutečném Chromiu proti skutečnému uzlu |
| Peněženka | Skutečný Chromium: šifrování, schvalování, odmítnutí, zamčení, oddělení stránek |
| Připojení peněženky | Průvodce v exploreru: chování MetaMasku včetně uvízlé žádosti, přidání sítě, výpadek a návrat uzlu |
| Aplikace | Skutečný Electron: těžba na GPU, spojení uzlu aplikace s běžným uzlem, peněženka v okně Exploreru |

## Nalezené a opravené zranitelnosti

Útočná kontrola před vydáním našla tyto chyby. Každá má test v `packages/node/test/attacks.test.js`, který nesmí znovu selhat.

| Závažnost | Chyba | Oprava |
| --- | --- | --- |
| Kritická | Podvržené tělo cizího bloku natrvalo odřízlo uzel od sítě | Neplatnost se zapisuje jen po selhání provedení |
| Kritická | Levné transakce plné nul vytvořily blok nad limitem velikosti, těžba by přišla o práci a síť se zastavila | Šablona hlídá velikost |
| Kritická | Nejhorší blok se ověřoval 40 s při čase bloku 15 s | Cache stavu, nativní Keccak, WebAssembly, cena MODEXP a BLAKE2F, limit 10 M gasu |
| Kritická | Adresa `/%ff` v HTTP nebo zpráva `null` přes WebSocket shodily uzel | Kontrola vstupu, chyba požadavku neukončí proces |
| Vysoká | Lživé tvrzení o práci zastavilo těžbu a šíření bloků | Ověřené stahování, výměna uzlu, trest za nesplnění |
| Vysoká | Zaplavení adresami dovolilo obklíčit uzel | Oddělené ověřené adresy, náhodný výběr po rozsazích |
| Vysoká | Nekonečná smyčka v `eth_call` blokovala uzel | Oddělená vlákna s limitem 5 s |
| Vysoká | PREVRANDAO vracel vždy nulu | Správné pole, odhalil oficiální test |
| Vysoká | Uzel nečtoucí odpovědi plnil paměť oběti | Strop fronty, odpojení |
| Vysoká | Výpadek disku mohl označit platný blok za neplatný | Odmítnutí EVM je oddělené od chyby uzlu |
| Střední | Limit RPC za proxy sdílel jeden účet pro všechny, dávky se počítaly jako jeden požadavek | `--trust-proxy`, počítání po položkách |
| Střední | Fronta transakcí bez stropu paměti a bez kontroly součtu závazků | Strop 64 MiB, součet na odesílatele |

Kontrakty: otisk v Notáři a číslo certifikátu šlo předběhnout a zablokovat, jméno šlo ukrást z čekajících transakcí, zmizelý rozhodce zamkl úschovu navždy a z více podpisů nešlo vyměnit majitele. Vše je opravené. Jména mají dvoukrokovou registraci.

Dvě chyby jsou v knihovně EthereumJS 10.1.3 a uzel je obchází v `core/executor.js`: `createEVM` ignoruje volbu `bn254` a `putStorage` zapisuje do stromu i při zapnuté cache. Před aktualizací knihovny je potřeba to ověřit znovu.

## Rizika, která kód sám neodstraní

### Útok 51 %

Bezpečnost Proof of Work závisí na výkonu sítě. Malou síť lze přetížit pronajatým výkonem, protože Ethash používá mnoho strojů po celém světě. Útočník s většinou výkonu může krátce přepisovat poslední bloky a utratit mince dvakrát.

Quinvium proto odmítá reorganizace hlubší než 256 bloků, asi hodinu. To brání hlubokému přepisu historie, ale nezabrání přepisu několika posledních bloků. Burzy a obchodníci by u větších částek měli čekat na **alespoň 256 potvrzení**. Hlubší přepis projde jen s dvojnásobkem práce celé sítě od místa rozdělení. Útočník by tedy potřeboval dvakrát větší výkon než všichni ostatní dohromady. Díky tomu se po spojení srovná rozdělená síť a nový uzel, kterému útočník při první synchronizaci podstrčil levnou falešnou větev, z ní přejde na skutečný řetězec.

### ASIC stroje

Pro Ethash existují specializované stroje výkonnější než grafické karty. Dokud je síť malá, nemají důvod ji těžit. Pokud Quinvium získá hodnotu, přijdou a vytlačí domácí těžaře. Obranou je tvrdý fork na upravený algoritmus. Běžné minery by pak přestaly fungovat, dokud by změnu nepřevzaly, a zůstal by jen Quinvium Miner.

### Pooly

Kontrakt `AetherPool` drží odměny a dělí je podle práce ověřené sítí. Testy zkouší skutečný Ethash a pokusy o podvod: přepsání adresy těžaře, nafouknutí podílu, dvojí započtení i přes jinak zapsané RLP, cizí pool, cizí řetězec, starý podíl, opětovný vstup při výplatě a těžaře, který výplatu odmítá.

Co provozovatel nemůže: vzít mince těžařů, změnit poplatek ani pravidla, přepsat podíl na jinou adresu.

Co provozovatel může a kontrakt tomu nezabrání:

- Nepřijímat nebo neodesílat podíly. Těžař o ně přijde, dokud nepřejde jinam, a v Exploreru vidí, kolik práce mu kontrakt opravdu připsal. Podíl může odeslat i sám, ale Quinvium Miner to zatím neumí.
- Dát ASICu práci s cizí adresou. Quinvium Miner to pozná, Stratum klient ne. Takový stroj musí sledovat připsanou práci v Exploreru.
- Vypnout server. Mince zůstanou v kontraktu a výběr může spustit kdokoli.

Co může těžař: zadržovat nalezené bloky a posílat jen podíly. Poškodí tím pool a sám vydělá méně, stejně jako u každého jiného poolu. Podíl s vymyšleným obsahem hlavičky nemá větší účinek než zadržení bloku.

Každý podíl stojí asi 150 000 gasu, do bloku se jich vejde kolem 60. Server proto u velkého poolu podíly zdražuje a malý těžař ve velkém poolu dostane podíl připsaný méně často, ne méně zaplaceno.

### Poplatky jdou těžařům

Základní poplatek se nepálí. Zvyšuje to příjem těžařů, ale těžař může naplnit vlastní blok svými transakcemi prakticky zadarmo, protože poplatek se mu vrátí. Tím může zdražit další bloky pro ostatní. Přichází přitom o dýška cizích transakcí a dražší poplatek získají i ostatní těžaři, takže se to běžně nevyplatí, je ale potřeba to na testnetu sledovat.

### Mladý kód

Hlavní řetězec využívá knihovny EthereumJS pro EVM a noble pro kryptografii. Pravidla sítě, síťová vrstva a kontrakty jsou nový kód bez provozní historie.

### Výkon uzlu

Uzel běží v JavaScriptu. Limit 10 milionů gasu za blok odpovídá asi 31 převodům za sekundu a vychází z měření: nejhorší známý blok se na iMacu s Intel Core i5 ověří asi za 6 s, tedy s rezervou 2,5× proti času bloku. Silnější počítač to má jednodušší, slabý server s jedním vláknem méně. Miner může hlasovat nejvýš o 15 milionů, výš vede jen fork. Pro velký provoz bude potřeba nativní implementace.

### Velikost dat

Uzel je archivní a stav starých bloků nemaže. Při velkém provozu data porostou rychle, prořezávání stavu zatím není hotové.

## Zásady pro provoz

- JSON-RPC nikdy nevystavujte přímo do internetu. Použijte reverzní proxy s HTTPS a `--rate-limit`.
- Uzel nedrží žádné klíče, odcizení serveru mince neohrozí.
- Obnovovací fráze patří jen na papír. Žádný správce ji nesmí znát.
- PREVRANDAO je jen slabý zdroj náhody a těžaři ho mohou ovlivnit. Nepoužívejte ho pro loterie.
- Čas bloku může těžař posunout až o 60 sekund, kontrakty s ním nesmí počítat přesněji.

## Známá omezení

- Spojení mezi uzly je šifrované a od 8. 11. 2026 i ověřené: uzel podepisuje otisk spojení trvalým klíčem, takže útočník uprostřed spojení nepřepošle. Seed s připnutým klíčem pozná nový uzel i při podvrženém DNS. Testnet zatím přijímá i starší verze bez identity, mainnet ne.
- Samostatný uzel se starým softwarem se po forku jen odpojí. Aplikace se aktualizuje sama, uzel z příkazové řádky ne.
- Nejsou strýčkovské bloky, takže těžař osiřelého bloku nedostane nic.
- Obalená mince na `0xae…0a` se od restartu testnetu 4. 11. 2026 jmenuje Wrapped QU (WQU). Vnitřní název kontraktu `WAET` zůstal jen v kódu.
- Pool neumí odhalit zadržování bloků. Viz Pooly.
- Blobové transakce EIP-4844 síť nepodporuje záměrně. Instrukce `0x49`, `0x4a` a adresa `0x0a` proto ve srovnání s Cancun chybí. Jiné rozdíly oproti Cancun v EVM nejsou, kromě ceny BLAKE2F a MODEXP.
- Závislost `solc` použitá jen při vývoji má hlášenou zranitelnost v nástroji `tmp`. Do vydaných programů se nedostává.
- Hlasování je veřejné. Pro tajné volby se nehodí.
- Jméno vydavatele v Certifikátech si uvádí každý sám. Důvěřovat lze jen adrese z oficiálního zdroje.
- Přepínač sítí v exploreru předpokládá výchozí porty.
- Skutečný MetaMask se automaticky netestuje. Test napodobuje jeho chybové kódy, přidání sítě je potřeba občas ověřit ručně.
