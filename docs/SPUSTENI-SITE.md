# Plán spuštění sítě

Software je připravený na veřejný testnet. Zbytek je provoz, peníze a právo, a to nejde vyřešit kódem. Pořadí kroků:

## 1. Veřejný testnet

Potřebujete tři servery s veřejnou IP v různých lokalitách, každý alespoň 2 vCPU, 4 GB RAM a 100 GB SSD. Pro doménu nastavte `rpc.vasedomena.cz` a `explorer.vasedomena.cz`.

Spuštění uzlu na Linuxu jako služby:

```ini
# /etc/systemd/system/aether.service
[Unit]
Description=Quinvium node
After=network-online.target

[Service]
User=aether
ExecStart=/usr/bin/node /opt/aether/packages/node/src/cli.js --network testnet --data-dir /var/lib/aether --rpc-host 127.0.0.1 --rate-limit 600 --trust-proxy --no-mining-rpc
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- Otevřete port 30525 TCP. Port RPC zůstává jen pro lokální proxy.
- Před RPC postavte Nginx nebo Caddy s HTTPS, proxy musí nastavovat `X-Forwarded-For`. Volbu `--trust-proxy` zapínejte jen za vlastní proxy, jinak si klient adresu vymyslí a obejde limit.
- Adresy serverů doplňte do `seeds` v `packages/node/src/params.js` s připnutým klíčem, `klíč@seed.domena.cz:30525`, a vydejte novou verzi. Klíč vrátí na serveru `curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"aether_nodeInfo","params":[]}' http://127.0.0.1:8546`. Soubor `node.key` ve složce dat se při přesunu serveru musí přenést, jinak se seed ohlásí jiným klíčem a nové uzly ho odmítnou.
- Testnet nechte běžet alespoň 2 až 3 měsíce a pozvěte skutečné těžaře. Teprve tak se ověří běžné Windows minery, rozdílné karty a reálné forky.

### Když jeden uzel spadne

Řetězec nedrží žádný jeden počítač. Každý plný uzel má celou kopii, každý blok si sám ověří a nový nebo obnovený uzel si chybějící bloky stáhne od ostatních. Adresy dalších uzlů se šíří mezi uzly samy, seed slouží jen k prvnímu kontaktu. Řetězec tedy žije, dokud běží aspoň jeden uzel. Nové bloky přibývají, dokud aspoň jeden těžař těží.

Aby výpadek jednoho stroje nikdo nepoznal, musí být splněné čtyři věci:

| Co | Jak | Stav v kódu |
| --- | --- | --- |
| Aspoň dva uzly na různých místech (jiný proud a jiné připojení) | servery u dvou poskytovatelů, iMac doma jako třetí | hotové, chybí servery |
| Nový uzel najde síť, i když jeden server neběží | `seed.domena.cz` s adresou každého serveru v DNS, v `seeds` v `params.js` | uzel si zapíše všechny adresy jména (`_resolveSeeds`) |
| Explorer na doméně běží dál | statický Explorer (Cloudflare Pages nebo jiný hosting) a v `config.js` seznam uzlů `rpc: ['https://rpc1.domena.cz', 'https://rpc2.domena.cz']` | Explorer vybere uzel s nejvyšším blokem a při výpadku přejde na další, test `packages/explorer/test/failover.mjs` |
| Výpadek se pozná | hlídač (například UptimeRobot zdarma) na `https://rpcN.domena.cz/health` | `/health` vrací 200, nebo 503 při synchronizaci či zaostávání o víc než 3 bloky; `?maxAge=600` navíc hlídá, že přišel blok |

Každý server pak běží stejně: uzel jako služba podle návodu výše, Caddy pro vlastní jméno `rpcN.domena.cz` s HTTPS a otevřený port 30525.

```
# /etc/caddy/Caddyfile na serveru N
rpcN.domena.cz {
  reverse_proxy 127.0.0.1:8546
}
```

Explorer jako statické stránky je složka `packages/explorer/public` s vyplněným `config.js`. Hosting stránek bez serveru (CDN) nespadne s žádným uzlem a každý návštěvník si uzel vybere sám. MetaMask potřebuje jednu adresu RPC. Uživatel může zadat `rpc1` a při výpadku přepnout na `rpc2`. Plné přepnutí na jedné adrese umí placený vyvažovač zátěže, třeba Cloudflare Load Balancing s kontrolou `/health`.

Domácí počítače přes Cloudflare Tunnel zvládnou totéž bez otevřeného portu a bez zveřejnění domácí IP adresy. Doma ale sdílejí jedno připojení a jeden proud, takže výpadek internetu odstaví oba. Aspoň jeden uzel proto má běžet mimo domov.

Těžba: když spadne server poolu, jeho těžaři stojí, dokud nepřepnou jinam. Běžné minery (lolMiner, T-Rex) umějí záložní pool v nastavení. `quintium-miner` zatím bere jednu adresu `--node`.

## 2. Před mainnetem

| Úkol | Proč | Odhad |
| --- | --- | --- |
| Nezávislý audit konsensu, sítě a kontraktů | Chyba v konsensu může zničit celou síť | desítky tisíc USD až výše |
| Program odměn za nalezené chyby | Motivace hlásit chyby místo zneužití | dle hodnoty sítě |
| Podpis programů pro Windows | Odstraní varování SmartScreen | certifikát asi 200 až 500 USD ročně |
| Chrome Web Store | Bez něj peněženku nejde běžně instalovat | jednorázově 5 USD a revize |
| Prověření názvu Quinvium a zkratky QU | Názvy jsou mezi projekty běžné, hrozí záměna a spor | právník |
| Právní posouzení | Viz níže | právník |

## 3. Právní stránka

V EU upravuje vydávání a nabízení kryptoaktiv nařízení MiCA. Čistě těžená měna bez prodeje veřejnosti je v jiné pozici než token prodávaný investorům, hranice ale posuzuje právník. Pokud budete mince předprodávat, slibovat zhodnocení nebo provozovat směnu či úschovu, řešte to **předem** s advokátem. Peněženky i uzel jsou navržené bez úschovy cizích prostředků, což pomáhá, ale neřeší vše.

## 4. Změna pravidel po spuštění

Pravidla se mění forkem v `network.forks` v `params.js`, viz [SPECIFIKACE.md](SPECIFIKACE.md). Postup:

1. Fork vyzkoušet nejdřív na testnetu.
2. Zvolit výšku s dostatečnou rezervou, aby těžaři a burzy stihli aktualizovat, u mainnetu alespoň několik týdnů.
3. Před vydáním spustit celou sadu včetně `statetests.mjs` a upravit `test/golden.test.js`.
4. Uzly bez aktualizace se od sítě po výšce forku odpojí.

Závislosti s konsensem mají přesné verze. Aktualizace EthereumJS nebo kryptografických knihoven se bere jako možný tvrdý fork.

## 5. Spuštění mainnetu

1. Zafixujte `genesisTimestamp` a `genesisDifficulty` v `params.js`. Blok před tímto časem nelze vytěžit.
2. Zvolte počáteční obtížnost podle skutečného výkonu z testnetu.
3. Zveřejněte hash genesis bloku, aby ho každý mohl ověřit.
4. Spusťte seed uzly před časem genesis.
5. Po změně parametrů proveďte `bash scripts/release.sh` a zveřejněte kontrolní součty.

## Co rozhodne o úspěchu

Konkurovat Bitcoinu nebo Ethereu neznamená jen mít software. Rozhodují počet nezávislých těžařů, likvidita na burzách, vývojáři píšící aplikace a důvěra v dlouhodobý provoz. To se buduje roky a žádný kód to nezaručí. Reálný první cíl je funkční veřejný testnet se skutečnými uživateli a jednou konkrétní aplikací v jednom oboru, kde řetězec přináší jasný užitek, například ověřování dokumentů.

## Vydání aplikace

```bash
bash scripts/release.sh                                   # balíčky pro Windows
node scripts/publish-update.mjs 2.3.0 "co je nového"      # podepsaná aktualizace
bash scripts/install-mac.sh                               # Quinvium.app do /Applications
```

Aktualizace je podepsaná klíčem `~/.aether/aktualizace-klic.pem`, ten nikdy neopouští počítač vydavatele. Aplikace hledá `manifest.json`
na Windows a `manifest-mac.json` na macOS na adrese z nastavení `updateUrl`. Balíček se rozbalí do `versions/<verze>` ve složce dat aplikace.
