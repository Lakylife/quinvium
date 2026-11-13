# Kapacita a zátěž

Změřeno 1. 11. 2026 skripty ve složce `scripts/zatez`. Stroj: iMac, Intel Core i3-8100 (4 jádra, 3,6 GHz), 32 GB RAM,
Node.js 24, uzel běžel vedle těžby na grafické kartě. Čísla ukazují řád, ne strop serveru: běžný server má víc jader
a rychlejší disk. Bloky mezi uzly se měřily na jednom počítači, takže neobsahují zpoždění internetu.

## Co jedna síť unese

| Oblast | Změřeno | Co to znamená |
| --- | --- | --- |
| Propustnost sítě | 476 převodů v bloku, **31,7 tx/s**, tokeny 171 v bloku, 11,4 tx/s | Tvrdý strop konsensu, dokud se nezvedne limit gasu |
| Plný blok na uzlu | sestavení 350 až 500 ms, ověření a zápis 520 až 670 ms | Spotřebuje asi 1,2 s z 15 s, výpočet má rezervu |
| Příjem transakcí | 664 tx/s přes RPC | Vyšší než propustnost sítě, fronta se nezahltí příjmem |
| Čtení přes RPC | 9 500/s výška, 5 400/s blok, 2 900/s zůstatek, 500/s `eth_call` | Jeden uzel obslouží tisíce peněženek |
| Přetížení `eth_call` | nad frontu 128 vrací chybu „uzel je přetížený“ | Záměr: uzel dál zpracovává bloky |
| Stratum | **10 000 zařízení**, nová práce všem za 261 ms, RPC dál do 3 ms, 100 MB navíc | Jeden uzel unese velkou farmu, výchozí limit je 1024 |
| Filtry Exploreru | 5 milionů transakcí, 1 GB rejstříku, nejhorší dotaz 237 ms | Běží ve vláknech, bloky nezdrží |
| Šíření bloku | 4 až 8 ms na uzel při spojení v jednom počítači | Internet přidá své zpoždění |
| Synchronizace | 10 bloků/s u prázdných bloků | Rok řetězce se stáhne za 2,5 dne, plný řetězec několik týdnů |
| Ověření práce | 13 ms | Stovka podílů v bloku stojí 1,3 s |
| Data | **8,5 kB na transakci** | Plná síť přidá 8,5 TB ročně |

## Miliony uživatelů

**Peníze a převody.** Milion aktivních uživatelů se dvěma transakcemi denně je 23 tx/s, tedy skoro celá kapacita.
Deset milionů je 230 tx/s, sedmkrát víc, než síť pojme. Základní vrstva tedy miliony lidí přímo neunese a poplatky by
rostly, až by většinu vytlačily. Tak to mají i Bitcoin a Ethereum. Řešení jsou tři a dají se kombinovat:

1. Zvýšit limit gasu forkem. Výpočet má rezervu asi desetinásobku, ale brzdou je růst dat a šíření bloků přes internet.
   Trojnásobek (95 tx/s) je rozumný první krok po ověření na testnetu s uzly v různých sítích.
2. Druhá vrstva: rollup nebo platební kanály. Běžné platby jdou mimo základní vrstvu, ta drží jen vyrovnání.
3. Hodně nezávislých veřejných uzlů za vyrovnáváním zátěže. Čtení škáluje přidáním uzlů, zápis ne.

**Čtení.** Peněženka dělá v běžném provozu desítky dotazů za minutu. Jeden uzel s 3000 dotazy za sekundu obslouží
desítky tisíc současně aktivních lidí. Milion lidí znamená zhruba 30 až 50 serverů, což je běžná infrastruktura.

**Těžaři.** Solo a klasický pool přes Stratum škálují dobře: 10 000 zařízení na jeden uzel, víc zařízení znamená víc uzlů.
Veřejný uzel počítá s limitem 128 zařízení z jedné adresy, farma si ho zvýší volbou `--stratum-sessions-per-ip`.

**Pooly bez důvěry.** Tady je skutečný limit. Každý podíl stojí asi 220 000 gasu, do bloku se jich vejde nejvýš 45,
tedy 3 za sekundu pro celou síť. Pool s 24 podíly na blok je rozumný strop. Malé pooly to řeší přesně tak, jak mají:
obtížnost podílu roste s velikostí poolu, a těžař s malou kartou tak má méně častou, ale stejně férovou výplatu.
Při stovkách tisíc zařízení v jednom poolu by malý těžař čekal na podíl dny. Pro takové měřítko bude potřeba
další krok: podíly se sečtou do Merkleova stromu a kontrakt ověří jen náhodný vzorek, takže cena přestane růst
s počtem podílů. To je změna kontraktu a návrh se musí ověřit, zatím není hotová.

Od 8. 11. 2026 server poolu posílá podílů méně, když se bloky plní: do poloviny bloku 24 za blok, při plných blocích 6.
Pooly tak nevytlačí platby a nezvedají poplatky ostatním, cenou je jen větší rozptyl výplat (`PoolServer.sharesPerBlock`).
Strop sítě 3 podíly za sekundu to neodstraní, to umí až zmíněný vzorek z Merkleova stromu.

**Šíření.** Od 8. 11. 2026 dostane celou transakci nebo blok jen odmocnina z počtu sousedů, ostatní hash (viz
SPECIFIKACE, oddíl 11). Při 32 sousedech posílá uzel celou zprávu 6krát místo 32krát.

**Data.** Uzel dnes ukládá stav všech bloků, takže se chová jako archivní uzel. Při plné síti je to 8,5 TB ročně, což
domácí počítač dlouhodobě neunese. Před ostrým provozem je potřeba:

1. Prořezávání starého stavu, běžný uzel drží jen posledních několik set bloků.
2. Rychlá synchronizace ze snímku stavu. Dnes nový uzel přepočítává celou historii.

Dokud síť není plná, problém nenastane: dnešní testnet má řádově kilobajty na blok.

## Co je potřeba udělat před miliony uživatelů

| Priorita | Úkol | Proč |
| --- | --- | --- |
| Vysoká | Prořezávání stavu a synchronizace ze snímku | Jinak uzly přestanou provozovat běžní lidé |
| Vysoká | Veřejné startovací uzly v různých sítích | Bez nich se nový uzel nemá kam připojit |
| Vysoká | Měření přes internet, ne na jednom počítači | Šíření bloku je hlavní riziko vyššího limitu gasu |
| Střední | Zvýšení limitu gasu po měření | Trojnásobek kapacity |
| Střední | Dávkové podíly v poolech | Pooly se stovkami tisíc zařízení |
| Střední | Druhá vrstva pro platby | Jediná cesta k desítkám milionů uživatelů |

## Jak měření zopakovat

```bash
node scripts/zatez/rpc.mjs                       # čtení
node scripts/zatez/transakce.mjs                 # zápis a plné bloky
node scripts/zatez/stratum.mjs 1000,5000,10000   # zařízení na Stratum
node scripts/zatez/index.mjs 5000000             # filtry Exploreru
node scripts/zatez/sit.mjs                       # šíření a synchronizace
```
