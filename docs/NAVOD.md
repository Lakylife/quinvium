# Návod pro uživatele, těžaře a vývojáře

## Běžný uživatel na Windows

1. Spusťte `Quinvium-2.0.0-Windows-x64.exe` a nainstalujte aplikaci.
2. Windows může zobrazit varování SmartScreen, protože program zatím není podepsaný certifikátem. Zvolte Další informace a Přesto spustit.
3. V aplikaci vytvořte peněženku a obnovovací frázi si **opište na papír**. Bez ní peníze nikdo neobnoví.
4. Záložka Těžba spustí těžbu na vaší kartě. Záložka Uzel ukazuje stav sítě.

Když se instalátor nespustí nebo stále ukazuje stejnou chybu, zavřete všechna jeho okna, případně restartujte počítač. Instalátor smí běžet jen jednou. Starší verzi nová sama ukončí a přepíše, peněženka zůstane.

Karta potřebuje podporu DirectX 12 nebo Vulkan a alespoň 2 GB paměti pro začátek sítě. Paměťová náročnost roste asi o 8 MB každých 5 dní, takže za 4 roky bude potřeba okolo 3,3 GB.

## Spojení více počítačů

Počítače ve stejné místní síti se najdou samy. Stačí na nich otevřít aplikaci Quinvium a záložka Síť do chvíle ukáže připojený uzel. Řetězec se stáhne a všechny těží stejnou síť. Kratší řetězec se nahradí těžším, takže bloky vytěžené dřív na počítači bez spojení zaniknou.

Když se počítače nenajdou, například v síti s oddělenými klienty, zadejte adresu ručně v záložce Síť pod Spojit s jiným počítačem.

Aby šel Explorer otevřít i z počítače bez aplikace, zapněte na stejném místě Zpřístupnit Explorer a těžbu ostatním počítačům v síti. Aplikace ukáže adresu, například `http://192.168.1.20:8546`. Otevře se tím i Stratum pro běžné minery. Ve výchozím stavu je obojí jen pro daný počítač.

Počítače mimo místní síť se najdou až přes veřejný seed uzel, viz `SPUSTENI-SITE.md`.

## Připojení peněženky k Exploreru

Tlačítko Připojit peněženku funguje třemi způsoby:

- **V aplikaci Quinvium.** Otevřete Explorer tlačítkem v aplikaci. Žádost potvrdíte v hlavním okně, nic dalšího se neinstaluje.
- **S rozšířením Quinvium Wallet.** Pokud peněženku ještě nemáte, založíte ji přímo při připojení.
- **S MetaMaskem.** Po připojení stránka sama nabídne přidání a přepnutí sítě Quinvium.

Připojení stránce jen ukáže vaši adresu. Zůstatek v Quinviu peněženka ukáže až na správné síti, proto je u MetaMasku potřeba i druhý krok. Pokud se okno MetaMasku neobjeví, klikněte vpravo nahoře v Chrome na jeho ikonu, žádost čeká tam.

Explorer i peněženka potřebují běžící uzel. Zavřením aplikace Quinvium se uzel zastaví. Explorer se po jeho návratu obnoví sám.

**MetaMask na síti Quinvium.** Dvě věci MetaMask na vlastních sítích neumí a z naší strany je zapnout nejde:

- **Rychlost poplatku.** Volby Low, Market a Aggressive i Network status bere MetaMask ze své služby. Ta podporuje
  jen vybrané sítě a pro Quinvium odpoví, že síť nezná. MetaMask pak nabídne jen Network suggested, tedy cenu z uzlu,
  a Advanced, kde jde poplatek a dýško zadat ručně. Volbu pomalu, běžně a rychle má peněženka Quinvium.
- **Swap.** Tlačítko Swap v MetaMasku směňuje jen přes službu MetaMasku na podporovaných sítích, tokeny Quinvia v něm
  nejsou. Na Quinviu se směňuje na stránce Swap v Exploreru nebo na záložce Swap v aplikaci. MetaMask tam jen potvrdí transakci.

## Historie v Exploreru a v peněžence

Explorer má obyčejné adresy jako Etherscan: úvod je `/`, transakce `/tx/0x…`, adresa `/address/0x…`, blok `/block/123`.
Starší odkazy s `#/` dál fungují, Explorer je převede sám.

**Úvod** ukazuje celkový počet transakcí a tx/s, poplatek teď (základ a dýško pro pomalu, běžně a rychle), poslední
bezpečný a nevratný blok, graf transakcí za 14 dní, poslední bloky se skutečnou odměnou těžaře (odměna za blok
a všechny poplatky, nic se nepálí) a poslední transakce s metodou.

**Seznam transakcí** má nahoře provoz za 24 hodin: počet, čekající za poslední hodinu, poplatky celkem a průměrný
poplatek. U každé transakce je metoda (název volané funkce jako v Etherscanu), blok, stáří, od, komu, částka a poplatek.
Ikona oka ukáže rychlý náhled bez otevření detailu. **Seznam bloků** má nahoře vytížení sítě za 24 hodin, poslední
bezpečný blok, odměny těžařům a podíl bloků od poolů. MEV ani pálení poplatků tu nejsou, bloky těží přímo těžaři a pooly.
U bloku je spotřebovaný gas s vytížením, limit, základní poplatek a odměna těžaře. **Grafy** ukazují i aktivní adresy,
poplatky, převody tokenů, nové kontrakty, neúspěšné transakce a vytížení sítě.

U každé transakce Explorer píše, co udělala: převod, převod tokenu, swap, schválení tokenu, most, likvidita, pool,
jméno .qu nebo nasazení kontraktu. Detail transakce k tomu přidá větu s částkami, třeba „0,1 TOKEN → 4 213 tQU“.
Na stránce adresy je u každé transakce Odesláno, Přijato nebo Sám sobě, v části Více informací první a poslední odeslaná
transakce a odkud přišly první mince. Záložka Převody tokenů ukazuje i tokeny, které přišly z cizí transakce, třeba
výstup swapu nebo platbu od někoho jiného.

**Pooly.** Stránka poolu ukazuje hospodaření: odměny za bloky, vyplaceno těžařům, co jim patří a čeká na výplatu,
co čeká na rozdělení a poplatek provozovatele (k výběru a vybráno). Dál těžaře v okně poolu s podílem na práci,
počtem podílů a částkou k výběru a na uzlu, kde server poolu běží, i připojená zařízení. Kontrakt poolu dostává odměny
za bloky přímo od sítě a těžařům je vyplácí uvnitř kontraktu, proto u něj nejsou vidět v řádcích Přijato a Odesláno
v transakcích. Stránka adresy to u poolu vysvětlí a odkáže na přehled. Tvůrce poolu má na své adrese seznam poolů,
které provozuje, s poplatkem k výběru.

**Aktivita v peněžence** je po dnech (Dnes, Včera, datum) a ukazuje všechno, co se na účtu dělo, ne jen odeslané:
přijaté platby, převody tokenů tam i zpět (u swapu obě strany, třeba −10 tQU a +19,8 TOKEN), výplaty z poolů s názvem
poolu a odměny za vytěžené bloky sečtené za den. Každá položka má ikonu druhu, protistranu, čas a částky se znaménkem,
čekající a neúspěšné mají štítek. Rozkliknutá položka ukáže stav, obě strany, komu a od koho, zaplacený poplatek,
pořadové číslo, čas, transakci a odkaz do Exploreru, u odměn za bloky den, počet a rozsah bloků. V aplikaci zůstává
detail ve stejném rozvržení jako přehled. Rozkliknuté aktivum ukáže zůstatek, poslední pohyby a tlačítka Odeslat a Vklad.

V aplikaci otevře záložka Explorer vždy jeho úvod. Na konkrétní stránku vedou odkazy, třeba Zobrazit v Exploreru.

Přihlásit se dá několika způsoby: vytvořit novou peněženku, obnovit ji frází, importovat soukromý klíč, připojit MetaMask,
Quinvium Wallet nebo jinou peněženku v prohlížeči a přes WalletConnect i peněženku v telefonu. Totéž platí v aplikaci: MetaMask je
rozšíření prohlížeče, proto aplikace otevře místní stránku v prohlížeči a podpisy přes ni předává. Kartu nechte otevřenou, klíče zůstávají
v MetaMasku. Výplaty z těžby jdou vždy na přihlášenou peněženku, jiná adresa se nastavit nedá. Pro WalletConnect potřebuje
provozovatel Exploreru bezplatné Project ID z dashboard.reown.com, které se zapíše do `packages/explorer/public/config.js`.
Bez něj o ně stránka požádá návštěvníka.

## Když transakce čeká

Dokud transakce není v bloku, nic nepřevedla. Mince i tokeny zůstávají na účtu a čekající transakce o ně nemůže připravit.
Každá transakce má pořadové číslo (nonce) a projde nejvýš jednou, nebo vůbec. Pokud selže až v bloku, nepřevede se nic
a zaplatí se jen poplatek za spotřebovaný gas.

- **Pomalé potvrzení.** V peněžence Quinvium u čekající platby stiskněte Zrychlit, odešle se znovu s vyšším poplatkem.
  Zrušit pošle místo ní prázdnou platbu sami sobě. Projde vždy jen jedna z nich, druhá skončí jako Neproběhla.
- **Uzel transakci zapomněl.** Uzel si frontu ukládá na disk a po restartu i aktualizaci ji načte zpět. Peněženka Quinvium
  navíc pozná, že uzel transakci nezná, a pošle ji znovu stejnou. Novým uzlům v síti předává uzel celou frontu sám.
- **Mezera v pořadí.** Explorer u čekající transakce napíše, na které dřívější číslo čeká. V MetaMasku pomůže Settings →
  Advanced → Clear activity tab data a nové odeslání.
- **Nikdo netěží.** Explorer to u transakce napíše. Potvrdí se s prvním vytěženým blokem.

Fronta transakci zahodí po šesti hodinách čekání. Ani pak se nic nepřevede, stačí ji odeslat znovu. Na nulovou adresu
ani na adresu samotného kontraktu tokenu peněženka nic neodešle, ze žádné z nich by se mince nevrátily.

**Neúspěšná transakce.** Detail v Exploreru napíše důvod: uzel přehraje blok až po ni a Explorer přeloží chybu kontraktu,
třeba „Kurz se mezi odhadem a vytěžením změnil víc, než dovolovala nastavená tolerance“ (`SlippageExceeded`), a poradí,
jak se tomu vyhnout. Typický případ je stejná směna odeslaná dvakrát rychle za sebou: první změní kurz a vezme tokeny,
druhou ochrana proti skluzu zastaví a zaplatí se jen poplatek za gas. Swap, Likvidita a Most proto další transakci pustí
až po potvrzení předchozí z téhož účtu.

## Zámek aplikace

Odemčená aplikace zůstává odemčená, dokud s ní pracujete. Po nečinnosti se zamkne celá a čeká na heslo peněženky, dobu si zvolíte
v Nastavení (5 až 60 minut, výchozí 15). Těžba a uzel mezitím běží dál. Hned zamknout ji jde tlačítkem Zamknout aplikaci v menu.
Změna poolu vyžaduje heslo vždy, protože rozhoduje o tom, kam půjdou vytěžené mince. S peněženkou mimo aplikaci žádné heslo aplikace není, podpisy potvrzujete přímo v ní.

## Swap

Záložka Swap v aplikaci a stejná stránka v Exploreru směňují tokeny přes pooly likvidity. Formulář je vpravo, vedle něj
trh vybrané dvojice s cenou, grafem a posledními směnami. Na užší obrazovce jsou pod sebou. Kurz určuje poměr zásob v poolu, poplatek 0,3 %
zůstává poskytovatelům likvidity. Před směnou uvidíte kurz, dopad na cenu a nejnižší částku, kterou dostanete. Když by se kurz
do potvrzení pohnul víc než o nastavenou toleranci, transakce se vrátí. Na záložce Likvidita můžete do poolu přidat mince a podíl
si později vybrat. Pool může založit kdokoli prvním vkladem, jeho poměr určí první kurz. U obou částek jsou rychlé volby
20 %, 50 % a Max. V existujícím poolu jsou částky svázané kurzem, který je mezi nimi napsaný, a Max vloží nejvíc, kolik dovolí
oba zůstatky. Když vklad omezí zůstatek druhého tokenu, poznámka pod formulářem to řekne: pool bere oba tokeny v poměru kurzu,
takže k velkému zůstatku jednoho tokenu se vloží jen tolik, na kolik stačí ten druhý. Dopočtená částka má nejvýš šest
desetinných míst a u hlavní mince zůstane rezerva na poplatky. Pod kurzem je i opačný směr, třeba 1 tQU = 0,000265 TOKEN.
Podíl v poolu je část poolu, která po vkladu bude patřit vám. Vlevo jsou moje vklady s výběrem 20 %, 50 % nebo všeho
a seznam všech poolů s hledáním. Při velkém dopadu na cenu je na tlačítku jen krátké varování a vysvětlení je nad ním.

Testnet nemá přednastavené tokeny (od restartu 12. 11. 2026). Token si založí jeho autor v Aplikacích, pool s tQU
v záložce Pooly (token bez poolu se vybere vložením adresy do hledání) a od té chvíle ho Swap najde sám. Tokeny na testnetu nemají hodnotu.

## Aplikace

Stránka Aplikace v Exploreru má devět aplikací: notář, certifikáty, dodavatelský řetězec, úschovu plateb, hlasování,
jména adres, vlastní token, sbírku NFT a peněženku s více podpisy. Každá má nahoře úkoly, třeba Zapsat, Ověřit a Odvolat,
a zvolený úkol ukáže jen pole, která potřebuje. Výsledek ověření je přehled se stavem, adresami jako odkazy a časy.
Po vytvoření položky, obchodu, hlasování, tokenu, sbírky nebo peněženky se její číslo nebo adresa ukáže a rovnou doplní
do formuláře, takže další krok (přidat krok cesty, hlasovat, poslat tokeny, navrhnout platbu) ji už má. Čtení je zdarma,
zápis podepisuje připojená peněženka a platí se jen poplatek sítě, u jmen ještě cena jména.

## Tokeny a most

Stránka Tokeny v Exploreru ukazuje ověřené tokeny a umí zkontrolovat adresu tokenu. Název a zkratku si může zvolit kdokoli,
rozhoduje adresa na seznamu. Peněženka u každého tokenu píše, jestli je ověřený.

Záložka Bridge převádí mince mezi Quinviem a jinými sítěmi. Část Jak most funguje ukazuje tři kroky (uzamčení, potvrzení
validátory, připsání), jak dlouho převod trvá, co stojí, jaké má pojistky a co se stane, když neprojde. Na testnetu zatím neběží, potřebuje nezávislé validátory,
viz [MOST.md](MOST.md).

## Aktualizace aplikace

Aplikace si novou verzi stáhne sama, ověří podpis, rozbalí ji do vlastní složky a restartuje se. Těžba po restartu pokračuje.
Když se nová verze nerozběhne, aplikace se vrátí k předchozí a vadnou už nestáhne. Během těžby aplikace brání uspání
počítače, obrazovka se ale vypnout může.

## Těžba

### Quinvium Miner

```
quintium-miner --list
quintium-miner --address 0xVASE_ADRESA --node http://127.0.0.1:8545
```

Miner sám vypočítá DAG na kartě, ověří ho proti procesoru a každé řešení před odesláním přepočítá.

### Běžné minery

Uzel musí mít Stratum otevřený do sítě: `quintium-node --network testnet --stratum-host 0.0.0.0`.
Přihlašovací jméno je adresa, volitelně s názvem stroje. Registrace není potřeba.

```
lolMiner --algo ETHASH --pool ADRESA_UZLU:3334 --user 0xVASE_ADRESA.rig1
t-rex -a ethash -o stratum+tcp://ADRESA_UZLU:3334 -u 0xVASE_ADRESA -w rig1 -p x
teamredminer -a ethash -o stratum+tcp://ADRESA_UZLU:3334 -u 0xVASE_ADRESA.rig1 -p x
```

Port 3333 je mainnet, 3334 testnet. Uzel bez poolu pracuje jako sólo: každý nalezený blok vyplatí celou odměnu nálezci.

### Pool

Pool spojí výkon více těžařů a odměny dělí podle odvedené práce, takže i slabší karta má stálý příjem. V Quinviu je pool chytrý kontrakt:

- Odměny za bloky chodí přímo do kontraktu, provozovatel na ně nedosáhne.
- Práci každého těžaře ověřuje síť. Adresa těžaře je přímo v hashované hlavičce, takže podíl nejde přepsat na někoho jiného.
- Poplatek je nejvýše 5 % a po založení nejde změnit.
- Odměna se dělí mezi poslední kola (PPLNS), takže přeskakování mezi pooly nic nepřinese.
- Výplatu spouští server poolu sám. Když zmizí, výběr v Exploreru může spustit kdokoli a mince jdou vždy těžaři.

Těžba do poolu v aplikaci: Těžba, Kam těžíte a vyberte pool. Seznam ukazuje deset nejsilnějších poolů podle bloků za 24 hodin
s poplatkem, podílem a počtem těžařů, ostatní najde hledání podle jména nebo adresy a všechny jsou v Exploreru. Stránka poolu
v Exploreru má návod k připojení jako velké pooly (server, jméno, heslo a hotové příkazy pro Quinvium Miner, lolMiner, T-Rex,
TeamRedMiner a ASIC), těžaře po stránkách s hledáním vlastní adresy a připojená zařízení. Z příkazové řádky:

```
quintium-miner --address 0xVASE_ADRESA --node http://SERVER_POOLU:8546 --pool 0xADRESA_POOLU --worker pocitac1
```

Quinvium Miner si u každé práce ověří, že platí do zvoleného poolu a nese jeho adresu.

Založení poolu: v Exploreru otevřete Pooly a vyplňte název, adresu serveru a poplatek. Potom server spusťte v aplikaci v Nastavení, část Provozovat pool, nebo příkazem:

```
quintium-node --network testnet --pool 0xADRESA_POOLU --rpc-host 0.0.0.0 --stratum-host 0.0.0.0 --rate-limit 6000
```

Server si při prvním spuštění vytvoří účet na gas (`pool.key` ve složce dat). Na ten pošlete malou částku, platí se z něj odesílání podílů a výplaty. Vaše mince ani mince těžařů na něm nejsou.

### ASIC

Síť používá čistý Ethash se stejnými parametry jako Ethereum před přechodem na Proof of Stake, včetně délky epochy 30 000 bloků. Stratum umí ETHPROXY i EthereumStratum/1.0.0, což jsou protokoly těchto strojů. Přihlášení je stejné jako u běžných minerů, do poolu i sólo:

```
adresa:  stratum+tcp://SERVER:3334
uživatel: 0xVASE_ADRESA.nazev_stroje
heslo:   x
```

Pool nastaví obtížnost podílů každému stroji sám podle jeho výkonu.

Stroj musí mít firmware pro Ethash, ne pro Etchash: Ethereum Classic od roku 2020 používá delší epochy. Firmware některých strojů kontroluje velikost DAG nebo název mince a na malém DAG mladé sítě nemusí fungovat. Skutečný ASIC na této síti zatím nikdo nezkoušel, před nákupem stroje kvůli Quinviu je to potřeba ověřit.

## Příkazová řádka

Peněženka, převody, swap, most, pooly, těžba i uzel jdou ovládat bez okna příkazem `quinvium`, viz [PRIKAZOVA-RADKA.md](PRIKAZOVA-RADKA.md). V aplikaci je řádek pro terminál v Nastavení.

## Spuštění uzlu

```
quintium-node --network testnet
```

| Síť | RPC a explorer | P2P | Stratum |
| --- | --- | --- | --- |
| mainnet | 8545 | 30524 | 3333 |
| testnet | 8546 | 30525 | 3334 |
| dev | 8547 | 30526 | 3335 |

Veřejný uzel potřebuje otevřený port P2P. RPC vystavujte do internetu jen za reverzní proxy s HTTPS a s `--rate-limit`.
Data jsou v `~/.aether/<síť>`, uzel je archivní, takže si pamatuje stav všech bloků.

## Vývojáři

Úplná dokumentace s příklady, referencí RPC a kontraktů je v exploreru na stránce Pro vývojáře.

Síť je kompatibilní s nástroji pro Ethereum. Hardhat:

```js
networks: { aether: { url: 'http://127.0.0.1:8546', chainId: 52402, accounts: [process.env.KEY] } }
```

Solidity kompilujte pro `cancun`. Bloby EIP-4844 síť nemá, takže `blobhash()` a `block.blobbasefee` v kontraktu selžou.
`block.prevrandao` vrací mixHash rodičovského bloku a těžař ho může ovlivnit, pro loterie se nehodí.

Vývojová síť s automatickou těžbou:

```
quintium-node --network dev --dev-mine --miner-address 0xVASE_ADRESA
```

### Systémové kontrakty

Jsou v genesis bloku na pevných adresách. Rozhraní je v `packages/contracts/src`.

| Kontrakt | Adresa | Využití |
| --- | --- | --- |
| Notary | `0xae00…0001` | Důkaz existence dokumentu: právo, zdravotnictví, archivace. Každá adresa má vlastní záznam. |
| AetherNames | `0xae00…0002` | Jména místo adres, registrace ve dvou krocích kvůli předbíhání |
| Credentials | `0xae00…0003` | Diplomy, licence, odborné způsobilosti. Ověřuje se podle adresy vydavatele. |
| SupplyChain | `0xae00…0004` | Původ a cesta zboží: potraviny, léky, logistika |
| Escrow | `0xae00…0005` | Úschova plateb: obchod, služby, reality. Bez rozhodnutí do 90 dnů se strany dělí napůl. |
| Polls | `0xae00…0006` | Hlasování: obce, spolky, družstva |
| TokenFactory | `0xae00…0007` | Vlastní tokeny, věrnostní body |
| CollectionFactory | `0xae00…0008` | NFT: vstupenky, záruční listy, umění |
| MultisigFactory | `0xae00…0009` | Peněženky s více podpisy pro firmy, majitele lze měnit schváleným návrhem |
| WQU (Wrapped QU) | `0xae00…000a` | Zabalený QU pro burzy |
| Multicall | `0xae00…000b` | Hromadné čtení pro aplikace |

Rozšiřující metody RPC `aether_*` popisuje stránka Pro vývojáře v exploreru.
