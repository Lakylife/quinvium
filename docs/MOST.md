# Most a stablecoiny

## Jak most funguje

Brána `BridgeGateway` běží na obou řetězcích. Odeslání na zdrojové síti uzamkne originál nebo spálí přemostěný token.
Validátoři zprávu podepíší, až je v řetězci dost hluboko, a kdokoli pak s jejich podpisy doručí mince na cílové síti.

| Ochrana | Hodnota |
| --- | --- |
| Shoda validátorů | Většina a nejméně dva, adresa cílové brány je v podpisu, jinde neplatí. Podepisuje se s předponou EIP-191. Čísla zpráv jsou odvozená z adresy zdrojové brány, takže nová brána nenaváže na čísla staré |
| Velká částka nebo překročený denní limit | Čeká 24 hodin, strážce ji může zrušit |
| Strážce | Umí jen zastavit a zrušit převod, nikdy nic neuvolní. Zrušený převod validátoři vrátí odesílateli |
| Změna validátorů | Platí až za 2 dny, aby si jí uživatelé stihli všimnout |
| Token s poplatkem z převodu | Odmítne se, jinak by krytí nesedělo |
| Zrušený převod | Na cílové síti už nikdy neprojde a odesílatel dostane zpět celou částku, nejvýš jednou |

## Vrácení

Převod, který nemá nebo nemůže dorazit, se zruší a vrátí odesílateli. Zrušit ho na cílové síti smí strážce nebo správce,
u velkého převodu ve frontě funkcí `cancelQueued`, u každého jiného `cancelDelivery`. Odmítnout ho smí i sám příjemce,
například kontrakt, který mince nepřijme. Zrušený převod brána už nikdy nedoručí, `cancelled(id)` to ukáže.

Validátoři počkají, až je zrušení v cílovém řetězci dost hluboko, aby ho přeskupení nemohlo vzít zpět. Pak pošlou
odesílateli na zdrojové síti celou částku stejnou cestou, jako by šla opačným směrem. Vrácení má číslo odvozené
z původního odeslání, takže jedno odeslání se vrátí nejvýš jednou. Doručený převod zrušit nejde, a proto se nikdy nevrací.
Vrácení platí stejná pravidla jako běžný převod: velká částka čeká 24 hodin. Explorer u převodu ukáže „Zrušeno, vrací se“
a potom „Vráceno odesílateli“.

Mimo most platí totéž, co v Ethereu: transakce, která selže, nic nepřevede a částka zůstane odesílateli, zaplatí se jen
spotřebovaný gas. Swap s horším kurzem, než povolí skluz, nebo po termínu selže celý. Vklad likvidity vrátí mince, které
poměr poolu nepotřeboval. Výplata z poolu těžaři, která neprojde, zůstane v poolu k vyzvednutí a úschova vrací podle
svých pravidel.

## Bitcoin

Na Bitcoinu nejde spustit kontrakt, mince proto drží vícepodpisová adresa validátorů.

**Vklad.** Každý příjemce má vlastní adresu, ve které je zapsaná jeho adresa na Quinviu. Platit na ni jde z libovolné
peněženky i burzy. Adresu si kdokoli může spočítat sám a ověřit, že ji Explorer nepodvrhl. Registrace `requestBitcoinDeposit`
řekne validátorům, ať ji sledují. Po potvrzeních dostane příjemce `qBTC` krytý 1:1.

**Výběr.** Brána token spálí. Navrhovatel zveřejní transakci a ostatní ji podepíší, jen když sami ověří, že:

- vstupy jsou mince z úschovy, které validátor sám viděl,
- platba jde na adresu, kterou chtěl uživatel,
- úschova přijde přesně o spálenou částku a poplatek sítě platí vybírající,
- zbytek se vrací do úschovy,
- poplatek nepřesahuje limit a nepřekročí se denní limit výběrů.

Navrhovatel tak může nanejvýš zdržet. Po deseti minutách jeho roli převezme další. Neplatná adresa vrátí token zpět.

## Ekonomika

Validátoři platí plyn za potvrzení a doručení. Most zatím nemá vlastní poplatek, proto musí `minAmount` na každé trase pokrýt
náklady, jinak by mohl útočník posílat mnoho malých převodů na jejich účet. Před ostrým provozem je potřeba poplatek mostu
doplnit. U výběru do Bitcoinu platí poplatek sítě vybírající, odečte se z částky.

## Stablecoiny

USDT, USDC a USD1 vydávají Tether, Circle a World Liberty Financial. Bez nich žádný skutečný stablecoin nevznikne,
existují ale dvě cesty:

1. **Vydání přímo na Quinviu.** `StableToken` má role, které vydavatelé používají: omezení razby, blokování adres, nouzové zastavení a `permit`.
2. **Přes most.** Token je krytý 1:1 originálem uzamčeným v bráně na Ethereu. Není to závazek vydavatele, ale závazek mostu.

`TokenRegistry` rozliší pravý token od napodobeniny se stejným názvem, Explorer i peněženka podle něj ukazují ověřené tokeny.
Vlastníkem seznamu má být vícepodpisový kontrakt.

Na testnetu je seznam `0x1F29eD151d57E51706494aB3E9579B2212102C10`, zatím prázdný. Přednastavené testovací tokeny od restartu 12. 11. 2026 nejsou,
tokeny si zakládají jejich autoři a Swap najde každý token s poolem proti tQU. Skutečné BTC a ETH přijdou přes most jako `qBTC` a `qETH`.

## Spuštění

Co je potřeba rozhodnout a zajistit:

1. Aspoň tři nezávislí validátoři, každý na vlastním serveru a s vlastními uzly obou řetězců. Dva stroje jednoho člověka nejsou nezávislost.
2. Správce a strážce: vícepodpisové kontrakty, ne jeden klíč.
3. Nezávislý audit kontraktů a validátora.
4. Plyn na obou řetězcích pro každého validátora.
5. Limity podle výše prostředků. Začít nízko.
6. Dost potvrzení. Validátor se nespustí s méně než 240 potvrzeními na mainnetu Quinvia (hodina, pod hranicí finality 256 bloků) a 64 na Ethereu. Malou síť s Proof of Work jde na pár minut přepsat pronajatým výkonem a stejné mince by pak šly poslat dvakrát. Denní limity mají odpovídat tomu, kolik by takový přepis stál.

Postup:

```bash
# 1. Nasadit BridgeGateway na obě sítě, vytvořit přemostěné tokeny (createWrapped) a otevřít trasy (setRoute, setOutbound)
# 2. U každého validátora: vlastní klíče s právy 600 a nastavení podle vzoru
cp packages/bridge/config.example.json most.json
node packages/bridge/src/cli.js most.json
# 3. Zapsat adresy do packages/explorer/public/deployments.json
```

Vzor `deployments.json`:

```json
{
  "52402": {
    "registry": "0x…", "gateway": "0x…",
    "networks": [
      { "id": 11155111, "name": "Sepolia", "rpc": "https://…", "gateway": "0x…", "currency": { "name": "Ether", "symbol": "ETH", "decimals": 18 } },
      { "id": 11631617, "name": "Bitcoin", "bitcoin": "testnet", "keys": ["02…", "03…", "02…"], "threshold": 2, "confirmations": 6 }
    ],
    "assets": [
      { "symbol": "ETH", "token": "0x… qETH", "burn": true, "decimals": 18, "network": 11155111, "min": "1000000000000000", "remoteToken": "0x0000000000000000000000000000000000000000" },
      { "symbol": "qBTC", "token": "0x…", "burn": true, "decimals": 8, "network": 11631617, "min": "50000" }
    ]
  }
}
```

Identifikátor Bitcoinu je pevný: `0xB17C01`, desítkově 11631617.

## Testovací most se Sepolií

Na testnetu je připravený most Quinvium testnet ↔ Ethereum Sepolia, jen s trasou ETH ↔ qETH. Slouží k vyzkoušení:
tři validátoři běží na jednom iMacu, takže nejsou nezávislí, a správce i strážce jsou obyčejné klíče, ne vícepodpisové kontrakty.

- Klíče správce, strážce a tří validátorů jsou v `~/.aether/most-testnet` s právy 600. Nikam se nekopírují.
- `node scripts/nasadit-most.mjs` nasadí brány na obě sítě, vytvoří qETH, otevře trasy, pošle validátorům plyn,
  zapíše jejich nastavení a doplní most do `deployments.json`. Postup ukládá do `nasazeni.json`, přerušené nasazení pokračuje.
  Potřebuje na adrese správce aspoň 0,2 tQU a 0,02 Sepolia ETH.
- `scripts/most-validatori.sh spustit` spustí validátory jako služby macOS, které se po restartu spustí samy.
  `stav` ukáže, jestli běží, a poslední řádky jejich záznamu, `zastavit` je vypne.
- Na Sepolii se používá veřejný uzel `https://ethereum-sepolia-rpc.publicnode.com`.
- Limity: nejmenší převod 0,001 ETH, denní strop 5 ETH, převod nad 1 ETH čeká 24 hodin. Potvrzení 12 bloků na každé síti.

## Testy

| Sada | Co ověřuje |
| --- | --- |
| `packages/contracts/test/bridge.test.js` | Kontrakty včetně pokusů o krádež |
| `packages/contracts/test/invariants.test.js` | Krytí po každém kroku náhodných běhů |
| `packages/bridge/test/nasazeni.test.js` | Skript nasazení testovacího mostu na dvou místních řetězcích, opakované spuštění a převod ETH ↔ qETH s nastavením validátorů ze skriptu |
| `packages/bridge/test/relayer.test.js` | Validátoři mezi dvěma skutečnými uzly, vrácení zrušeného a odmítnutého převodu, doručený se nevrací |
| `packages/bridge/test/btc-bridge.test.js` | Bitcoin od vkladu po výběr, nepoctivý navrhovatel, přeskupení |
| `packages/bridge/test/bitcoin.test.js` | Výpočty proti nezávislé knihovně |
| `packages/explorer/test/bridge.mjs` | Stránky ve skutečném prohlížeči s živými validátory, včetně vrácení zrušeného převodu |

Bitcoin v testech simuluje `test/helpers/mock-bitcoin.js`, který přijme jen transakce s platnými podpisy. Test proti skutečnému
uzlu je připravený a ještě neproběhl. Před použitím je nutný:

```bash
BITCOIND=/cesta/k/bitcoind node --test packages/bridge/test/btc-regtest.test.js
```
