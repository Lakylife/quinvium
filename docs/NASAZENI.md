# Nasazení a bezpečnost řetězce

Tento dokument odpovídá na otázku, jestli může někdo Quinvium hacknout, ovládnout nebo upravit data a získat tím mince, a říká, co musí být hotové před spuštěním mainnetu.

Stručně: **upravit data a získat tím mince nejde.** Řetězec to neumožňuje z principu a testy to ověřují. Nezničitelný ale není žádný blockchain. Zbývá útok 51 % a chyby, které zatím nikdo nezávislý nehledal. Obojí je popsané níže.

## Proč nejde změnit zůstatek

Zůstatky nejsou uložené na jednom místě, které by šlo přepsat. Každý uzel drží vlastní kopii a každý blok si sám znovu spočítá.

1. Každá hlavička bloku obsahuje hash celého stavu sítě, tedy všech zůstatků a všech kontraktů. Změna jediného zůstatku změní tento hash.
2. Každý uzel každý přijatý blok provede sám a výsledek porovná s hlavičkou. Nevěří tomu, co mu kdo poslal.
3. Hlavička obsahuje hash předchozího bloku. Změna starého bloku by rozbila všechny další a každý z nich by se musel znovu vytěžit.
4. Mince vznikají jen jako odměna za blok. Jiná cesta v kódu ani v pravidlech není. Převod podepisuje soukromý klíč, který má jen majitel.

Kdo si tedy upraví vlastní databázi, oklame jen sám sebe. Ostatní uzly jeho bloky odmítnou a zůstanou na správném řetězci.

## Co přesně je ověřené

Všechny řádky mají automatický test, který pokus skutečně provede. Testy jsou v `packages/node/test/integrity.test.js` a `attacks.test.js`.

| Pokus | Co ho zastaví |
| --- | --- |
| Těžař si připíše 1000 QU navíc a poctivě na to vytěží blok | Hash stavu nesouhlasí, síť blok odmítne |
| Změna částky v cizí transakci | Podpis pak ukazuje na jiného odesílatele, ten mince nemá |
| Stejná transakce podruhé | Nonce, blok je neplatný |
| Transakce z jiné sítě | Chain ID je součástí podpisu |
| Přepsání zůstatku přímo v databázi | Stavový uzel nesouhlasí se svým hashem, `quinvium audit` to najde |
| Změna transakce nebo hlavičky v databázi | Hash nesouhlasí, `quinvium audit` určí přesný blok |
| Podstrčený blok v řetězci | Blok nenavazuje na předchozí |
| Falešný zůstatek v rejstříku Exploreru | `quinvium audit` porovná rejstřík se stavem |
| Řetězec od nuly s větší prací | Přepis hlubší než 256 bloků projde jen s dvojnásobkem práce od místa rozdělení |
| Přepis pod kontrolním bodem | Blok na dané výšce musí být přesně ten z vydání |
| Vymyšlené časy bloků, aby klesla obtížnost | Těžař se 49 % výkonu nezmění tempo bloků o víc než čtvrtinu |
| Překročení stropu 64 milionů | Emise je daná vzorcem a součet všech mincí se kontroluje |
| Tvrdé vypnutí uzlu | Po restartu řetězec znovu projde celou kontrolou |

## Kontrola celého řetězce

Příkaz `quinvium audit` nevěří ničemu, co uzel spočítal dřív. Vezme bloky z databáze a provede je znovu od genesis v prázdné složce: ověří práci, podpisy, stav a účtenky. Potom sečte zůstatky všech účtů přímo ze stavu a porovná je s emisí.

```
quinvium audit --network testnet
```

Databázi jen čte, uzel i těžba mohou běžet dál. Kontrola na skutečném testnetu z 1. 11. 2026 prošla: 191 bloků, 60 transakcí, 1715 stavových uzlů, v řetězci přesně 764 tQU a smělo jich vzniknout 764 tQU.

Zkouška sítě z 1. 11. 2026 běžela 15 minut na čtyřech uzlech: jeden uzel dostal tvrdé ukončení a nový se přidal za běhu. Všech 1231 odeslaných transakcí se potvrdilo, uzly se shodly na stejném bloku a stavu a uzel po tvrdém ukončení prošel celou kontrolou: 160 bloků a přesně 640 mincí z emise. Běžela na vývojové síti s těžbou v procesoru, ne na skutečné kartě.

Doporučení pro provoz: kontrolu spouštět pravidelně na každém serveru, po každé havárii a před každým vydáním. Rychlá varianta `--quick` ověří jen hashe stavových uzlů a soubor databáze.

## Co kód sám vyřešit nemůže

### Útok 51 %

Kdo má víc výkonu než všichni ostatní dohromady, může přepsat **poslední** bloky a utratit své mince dvakrát. Nemůže vytvořit mince, ukrást cizí ani změnit pravidla, a přepis je omezený na 256 bloků, asi hodinu. Hlubší přepis by potřeboval dvojnásobek výkonu celé sítě. Uzly jeho blok se špatným stavem odmítnou, i když má 99 % výkonu.

Quinvium je v tomhle zranitelnější než velké sítě, protože těží čistý Ethash. Stejné karty a ASIC stroje těží i EthereumPoW a Ethereum Classic (Etchash), jejich výkon je mnohonásobně větší a dá se pronajmout. Stačí malý zlomek tohoto výkonu. Dokud je síť malá, je přepsání posledních bloků levné. Obrana:

- **Burzy a obchodníci čekají na potvrzení.** Malé částky 30 bloků, velké 256 bloků.
- **Most čeká hlouběji než běžná platba.** Validátoři berou zprávy až po nastaveném počtu potvrzení. Na začátku má být aspoň 256.
- **Kontrolní body při vydání.** Parametr `checkpoints` v `params.js` zafixuje blok a historie pod ním už přepsat nejde ani se sebevětší prací.
- **Dohled.** Hluboký přepis se zapíše do logu uzlu a `quinvium status` ukáže počet přepisů a nejhlubší z nich.

Zvažované pravidlo MESS, které zdražuje pozdní přepisy a nějakou dobu ho mělo Ethereum Classic, zavedené není. Malá síť se může na půl hodiny rozdělit i bez útoku a po takovém rozdělení by se části už samy nespojily. Výpadek by tak byl horší než útok, který má odvrátit. Až síť vyroste, dá se k němu vrátit.

### Soukromé klíče a správci

Řetězec neochrání klíč, který někdo ukradne. Před mainnetem musí platit:

- Klíč pro aktualizace aplikace je mimo běžný počítač, nejlépe v hardwarovém modulu. Kdo ho získá, může všem uživatelům poslat vlastní program. Dnes leží na vývojovém iMacu, pro testnet to stačí, pro mainnet ne.
- Správce mostu a seznamu tokenů je vícepodpisový kontrakt, ne jeden klíč.
- Validátoři mostu jsou nezávislé osoby na oddělených strojích a každý má vlastní uzly obou řetězců.

### Nezávislý audit

Všechno výše je ověřené vlastními testy a přezkumem. Ty najdou to, co někoho napadne hledat. Nezávislý audit konsensu, sítě a kontraktů je před spuštěním s reálnou hodnotou nutný a nejde ho ničím nahradit.

## Co musí být hotové před mainnetem

| Blokuje spuštění | Stav |
| --- | --- |
| Nezávislý audit konsensu, sítě a kontraktů | Nezačal |
| Aspoň tři uzly se seed adresami v `params.js` (`seeds` je prázdné) | Čeká na servery |
| Veřejný testnet několik měsíců se skutečnými těžaři | Běží jen doma |
| Pevný `genesisTimestamp` a `genesisDifficulty` mainnetu | Čeká na termín |
| Podpis programů pro Windows a macOS | Chybí certifikáty |
| Klíč aktualizací v hardwarovém modulu, vícepodpisový správce | Čeká |
| Nezávislí validátoři mostu, jinak most zůstává vypnutý | Čeká |
| Zkouška mostu proti skutečnému Bitcoin Core v regtestu a testnetu | Čeká na povolení stažení |
| Slither a `cargo audit` | Neběžely |
| Reprodukovatelné sestavení a zveřejněné `SHA256SUMS` s podpisem | `SHA256SUMS` je, podpis chybí |
| Prořezávání stavu nebo rychlá synchronizace, uzel je dnes archivní a roste asi o 8,5 kB na transakci | Nezačalo, nutné až při větším provozu |
| Právní posouzení, ochranná známka a zkratka QU | Čeká |

## Spuštění

1. Zafixovat parametry mainnetu, spustit celou sadu testů včetně `statetests.mjs` a upravit `test/golden.test.js`.
2. Vydat verzi a zveřejnit součty `SHA256SUMS`.
3. Spustit seed uzly a první těžaře ve stejný čas, před `genesisTimestamp` nejde vytěžit nic.
4. Během prvních dnů sledovat `quinvium status` na každém serveru a každý den pustit `quinvium audit`.
5. Po několika dnech přidat první kontrolní bod do nové verze.

## Když se něco stane

| Událost | Postup |
| --- | --- |
| Log hlásí přepis 6 a více bloků | Burzy a most zvýší počet potvrzení, zjistit původ výkonu |
| Log hlásí větev za hranicí finality | Pokus o přepis historie, nebo rozdělená síť s podobnou prací na obou stranách. Porovnat `quinvium status` mezi servery. Při dvojnásobné práci uzel na větev přejde sám a hlásí VAROVÁNÍ |
| `quinvium audit` najde problém | Uzel odpojit, databázi nepoužívat, stáhnout řetězec znovu od ostatních a zjistit, kdo měl přístup k disku |
| Chyba v konsensu | Fork podle [SPUSTENI-SITE.md](SPUSTENI-SITE.md), nejdřív na testnetu |
| Únik klíče aktualizací | Hned vydat novou verzi s novým veřejným klíčem, starý uživatelé ručně nahradí |
