# Příkazová řádka

Vše, co umí aplikace a Explorer, jde dělat i bez okna, stejně jako u Bitcoinu a Etherea: peněženka, převody, swap, most, těžba, pooly i aplikace sítě (notář, certifikáty, dodavatelský řetězec, úschova, hlasování, jména, vlastní token, NFT a peněženka s více podpisy). Aplikace a Explorer jsou nadstavba, síť na nich nezávisí.

## Jazyk

Hlavní jazyk je angličtina, čeština se zapne podle jazyka systému (`LANG=cs_CZ.UTF-8`, na Windows podle nastavení systému). Volbu jde uložit natrvalo, nebo zadat jen pro jeden příkaz:

```
quinvium lang cs                          čeština pro všechna další spuštění
quinvium lang en                          angličtina
quinvium status --lang en                 jen pro tento příkaz
```

Pořadí: `--lang`, proměnná `QUINTIUM_LANG`, uložená volba v `~/.aether/cli.json`, jazyk systému. Výstup `--json` je v obou jazycích stejný. Výpis `quinvium node` a `quinvium audit` jde ve stejném jazyce. Uzel v aplikaci píše dál česky.

## Instalace

| Kde | Co udělat |
| --- | --- |
| Aplikace Quinvium | V Nastavení u Příkazové řádky stiskněte Zpřístupnit příkaz quinvium a otevřete nový terminál. Kdo chce vědět, co se děje, může místo tlačítka spustit řádek, který je pod ním. |
| Windows bez aplikace | Rozbalte balíček Uzel a Miner, `quintium.cmd` je vedle `quintium-node.exe`. |
| Ze zdrojového kódu | `node packages/cli/bin/quintium.js`, nebo si přidejte odkaz do `PATH`. |

Nástroj se připojuje k místnímu uzlu zvolené sítě. Jiný uzel se nastaví přes `--rpc`. Než se cokoli podepíše, ověří se, že uzel opravdu patří zvolené síti.

Tlačítko přidá do cesty složku `bin` v datech aplikace (macOS `~/Library/Application Support/Aether/bin`, Windows `%APPDATA%\Aether\bin`), na Macu řádkem v `~/.zshrc`, na Windows do uživatelské proměnné Path. Spouštěč v té složce aplikace při každém startu přepíše na právě používanou verzi. Proto příkaz zůstane aktuální i po aktualizaci přes internet, která má vlastní složku verze. Starší odkaz přímo do instalace by po ní spouštěl verzi z doby instalace.

Když běží aplikace, běží v ní i uzel a příkazy ho použijí samy. `quinvium node` je pro počítač bez aplikace. Vedle běžícího uzlu poradí, jak spustit druhý s vlastními porty a složkou, místo aby skončil chybou obsazeného portu.

Řádek pro Windows v Nastavení přidá složku jen k uživatelské cestě přes PowerShell a funguje v cmd i v PowerShellu. Starší řádek `setx PATH "%PATH%;…"` nepoužívejte: zkrátí cestu na 1024 znaků, přepíše uživatelskou cestu i systémovou a v PowerShellu `%PATH%` nerozbalí.

## Hledání a čtení řetězce

Peněženku k tomu nepotřebujete.

```
quinvium search 7100                      blok podle čísla
quinvium search 0xHASH                    transakce nebo blok podle hashe
quinvium search 0xADRESA                  přehled adresy
quinvium search alice.qu                  jméno a kam ukazuje
quinvium search TOKEN                     token podle zkratky
```

`search` pozná totéž co vyhledávání v Exploreru a navíc jména `.qu` a zkratky tokenů. Podrobnosti dávají `status`, `block`, `tx`, `address`, `tokens`, `rich`, `miners` a další příkazy v části Uzel a síť.

## Peněženka a přihlášení

V terminálu se nepřihlašuje na dobu sezení jako v aplikaci. `quinvium login` ukáže, se kterou peněženkou pracujete, a `quinvium login <název>` vybere jinou. Heslo se zadává při každém podpisu a mezi příkazy nic nezůstane odemčené.

```
quinvium login                            se kterou peněženkou pracujete, bez peněženky nabídne cesty
quinvium wallet import-app                stejná peněženka jako v aplikaci Quinvium, jen heslem aplikace
quinvium wallet create                    nová peněženka, fráze se ukáže jednou
quinvium wallet import uspory             obnova z fráze, stejné adresy jako v aplikaci a MetaMasku
quinvium wallet import-key klic           peněženka ze soukromého klíče
quinvium wallet list                      seznam, hvězdička značí výchozí
quinvium wallet default uspory            výběr výchozí
quinvium wallet phrase                    zobrazí frázi, jen v terminálu
quinvium wallet password                  změna hesla
quinvium wallet remove klic               smazání z tohoto počítače
quinvium balance                          zůstatky
quinvium send 0xADRESA 1.5                převod mince
quinvium send 0xADRESA 10 --token TOKEN   převod tokenu
quinvium send alice.qu 2                 převod na jméno
```

Peněženky jsou šifrované soubory ve složce `~/.aether/wallets`, stejný formát jako geth. Heslo, frázi ani klíč se nezadávají jako argument, protože by zůstaly v historii příkazů. Čtou se skrytě z klávesnice. Skript může použít `--password-file`, `--phrase-file` nebo `--key-file`.

## Swap a likvidita

```
quinvium swap quote 10 tQU TOKEN         kurz bez odeslání
quinvium swap 10 tQU TOKEN               směna, --slippage nastaví toleranci
quinvium swap pools                       pooly a jejich zásoby
quinvium liquidity add 1 tQU 20 TOKEN    vklad, přebytek zůstane v peněžence
quinvium liquidity list                   moje podíly
quinvium liquidity remove tQU TOKEN --percent 50
```

## Aplikace sítě

Stejné aplikace jako na stránce Aplikace v Exploreru. Příkaz bez podpříkazu ukáže svou nápovědu, třeba `quinvium escrow`.

```
quinvium notary stamp smlouva.pdf --note "podepsáno"     otisk souboru do sítě, obsah zůstane u vás
quinvium notary verify smlouva.pdf                       kdo a kdy otisk zapsal
quinvium notary revoke smlouva.pdf --reason "nahrazeno"
quinvium credential register "Univerzita" --website https://…   vydavatel, jednou za adresu
quinvium credential issue DIPLOM-1 0xDRZITEL --type Bakalář [--days 365]
quinvium credential verify DIPLOM-1 0xVYDAVATEL
quinvium supply create KAVA-001                          položka, vrátí její číslo
quinvium supply step 1 Praha expedováno --evidence dodaci-list.pdf
quinvium supply offer 1 0xPRIJEMCE                       předání, příjemce potvrdí: supply accept 1
quinvium escrow create 0xPRODAVAJICI 0xROZHODCE 2 --days 14   platba do úschovy
quinvium escrow release 1                                kupující uvolní platbu, prodávající: escrow withdraw
quinvium poll create "Kam na výlet?" Hory Moře Doma --days 7
quinvium poll vote 1 2                                   hlas pro druhou možnost
quinvium name info alice                                 volné jméno a jeho cena
quinvium name register alice                             dva podpisy a asi minuta čekání
quinvium name target alice 0xADRESA | primary | renew | transfer
quinvium token create "Body věrnosti" BODY 1000          vlastní token s pevným počtem
quinvium nft create Vstupenky VST                        sbírka, pak: nft mint <sbírka> <příjemce> ipfs://…
quinvium multisig create 0xA,0xB,0xC 2                   peněženka se 2 podpisy ze 3
quinvium multisig propose 0xPENEZENKA 0xPRIJEMCE 1.5     další majitel: multisig approve, pak execute
```

Otisk souboru je SHA-256 jeho obsahu a otisk textu z `--text` je keccak256, stejně jako v Exploreru. Ověření v Exploreru i v terminálu tak dá stejný výsledek. Čísla dokladů a označení zboží se ukládají jako otisk, takže `DIPLOM-1` v terminálu je stejný doklad jako `DIPLOM-1` v Exploreru.

## Most

```
quinvium bridge routes                    trasy a stav mostu
quinvium bridge out 5 QU                 z Quinvia na jinou síť
quinvium bridge in 0.1 ETH                z jiné sítě na Quinvium, podepisuje stejný klíč
quinvium bridge deposit-btc               vkladová adresa pro Bitcoin
quinvium bridge status                    moje převody
```

## Těžba a pooly

```
quinvium mine                             těží na výchozí peněženku
quinvium mine --intensity 60 --device 0   nižší výkon, jedna karta
quinvium mine --list                      seznam karet
quinvium mine --pool 0xPOOL               těžba do poolu z továrny sítě
quinvium pool list                        pooly
quinvium pool info 0xPOOL                 detail a moje výdělky
quinvium pool claim 0xPOOL                výběr výdělku
quinvium pool create --name Muj --url http://server:8546 --fee-percent 1
```

Do adresy, která není pool z továrny sítě, nástroj těžit odmítne.

## Uzel a síť

```
quinvium node --network testnet           plný uzel
quinvium status                           stav sítě
quinvium block 100                        blok
quinvium tx 0xHASH                        transakce s metodou, u neúspěšné i důvod
quinvium address 0xADRESA                 přehled adresy
quinvium peers | mempool | miners | rich  uzly, čekající transakce, těžaři, žebříček
quinvium tokens                           ověřené tokeny s cenou, držiteli a převody
quinvium token TOKEN                      detail tokenu
quinvium gas                              aktuální poplatky
quinvium rpc eth_blockNumber              přímý dotaz na uzel
quinvium audit                            kontrola celého řetězce, viz NASAZENI.md
```

## Kdo se připojí

Příkazy čtou z uzlu: z aplikace na stejném počítači, nebo z jiného přes `--rpc`. Počítače v jedné domácí síti se najdou samy, ostatní příkazy pak fungují i bez vlastního uzlu, třeba `quinvium status --rpc http://192.168.1.20:8546`. Podpis vždy proběhne v počítači, kde peněženka je, uzel dostane jen hotovou transakci.

Testnet zatím nemá veřejný uzel s adresou na internetu. Kdo si program nainstaluje mimo domácí síť, k řetězci se proto nepřipojí. K tomu je potřeba aspoň jeden uzel s veřejnou adresou (server, nebo přesměrovaný port 30525 na routeru) zapsaný v `seeds` v `packages/node/src/params.js` a vydaný v nové verzi.

## Skripty

`--json` dá strojově čitelný výstup, `--yes` přeskočí potvrzení a `--no-wait` nečeká na blok. Bez `--yes` a bez terminálu se nic neodešle.

```
quinvium balance --json
quinvium send 0xADRESA 1 --yes --password-file ~/.heslo --json
```
