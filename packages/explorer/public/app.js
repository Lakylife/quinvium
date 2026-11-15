/* Quinvium Explorer: a single-page app without dependencies except ethers.js. */
(() => {
  'use strict';
  const I18N = {
    cs: {
      'nav.swap': 'Swap', 'swap.sub': 'Okamžitá směna tokenů přes pooly likvidity. Kurz určuje poměr zásob v poolu a mince drží kontrakt, ne provozovatel.', 'swap.notReady': 'Swap na této síti ještě neběží', 'swap.notReadyBody': 'Kontrakty jsou hotové a otestované. Zapnou se po nasazení na tuto síť.', 'swap.tabSwap': 'Směna', 'swap.tabPools': 'Likvidita', 'swap.from': 'Z', 'swap.to': 'Na', 'swap.balance': 'Zůstatek', 'swap.max': 'Max', 'swap.rate': 'Kurz', 'swap.impact': 'Dopad na cenu', 'swap.min': 'Dostanete nejméně', 'swap.fee': 'Poplatek poolu', 'swap.route': 'Cesta', 'swap.slippage': 'Tolerance skluzu', 'swap.go': 'Směnit', 'swap.noPool': 'Pro tuto dvojici zatím není pool.', 'swap.enter': 'Zadejte částku', 'swap.same': 'Vyberte dva různé tokeny.', 'swap.done': 'Směna proběhla.', 'swap.high': 'Velký dopad na cenu: pool je pro tuto částku malý.', 'swap.flip': 'Prohodit', 'swap.pair': 'Dvojice', 'swap.reserves': 'Zásoby', 'swap.share': 'Můj podíl', 'swap.noPools': 'Zatím tu není žádný pool.', 'swap.add': 'Přidat likviditu', 'swap.addHelp': 'Poskytovatelé dostávají poplatek 0,3 % z každé směny podle svého podílu. Když se kurz změní, může být hodnota vkladu nižší, než kdyby mince jen drželi.', 'swap.tokenA': 'První token', 'swap.tokenB': 'Druhý token', 'swap.amountA': 'Částka prvního tokenu', 'swap.amountB': 'Částka druhého tokenu', 'swap.added': 'Likvidita je v poolu.', 'swap.remove': 'Vybrat vše', 'swap.removed': 'Likvidita je vybraná.', 'swap.test': 'Na testnetu mají tokeny nulovou hodnotu a kurzy jsou jen ukázkové.',
      'swap.searchToken': 'Název, zkratka nebo adresa', 'swap.pickToken': 'Vyberte token', 'swap.pay': 'Platíte', 'swap.receive': 'Dostanete', 'swap.noFunds': 'Nedostatek {symbol}', 'swap.noTrades': 'Zatím žádné směny.', 'swap.chartEmpty': 'Graf se naplní první směnou.', 'swap.trades': 'Poslední směny', 'swap.buy': 'Nákup', 'swap.sell': 'Prodej', 'swap.priceUnit': '{quote} za 1 {base}', 'swap.change': 'Změna za 24 h', 'swap.volume': 'Objem za 24 h', 'swap.count': 'Směny za 24 h', 'swap.viaHub': 'Přímý pool pro tuto dvojici není, směna vede přes {coin}. Níže je pool, přes který vede.', 'swap.priceChart': 'Vývoj ceny', 'swap.pools': 'Pooly likvidity', 'swap.poolShare': 'Podíl v poolu', 'swap.newPool': 'Nový pool, kurz určí tento vklad', 'swap.removeShort': 'Vybrat', 'pools.split': 'Rozdělení výkonu sítě', 'pools.soloMore': 'Dalších {n} sólo těžařů', 'pools.soloHint': 'těží sami bez poolu, seznam všech je v Těžařích', 'pools.activeNow': 'Těží (blok za poslední hodinu)', 'pools.idleNow': 'Za poslední hodinu bez bloku', 'pools.solo': 'Sólo těžaři', 'pools.soloCount': 'sólo adres: {n}', 'pools.soloOne': 'sólo těžař', 'pools.topNow': 'Největší podíl za hodinu', 'pools.top': 'Největší podíl', 'pools.count': 'Pooly', 'pools.hash': 'Průměrný výkon', 'pools.warn': '{name} má za poslední hodinu {p} % výkonu. Kdo má většinu, může přepisovat poslední bloky.', 'pools.splitNote': 'Počítá se z vytěžených bloků a jejich obtížnosti. Příjemce odměny je přímo v bloku, takže si podíl nikdo nevymyslí.', 'tokens.cap': 'Tržní hodnota', 'tokens.search': 'Hledat token', 'tokens.count': 'Ověřené tokeny', 'tokens.countSub': 'bez hlavní mince', 'tokens.totalLiq': 'Likvidita celkem', 'tokens.liqSub': 'v poolech s hlavní mincí', 'tokens.totalTransfers': 'Převody tokenů', 'tokens.transfersSub': 'za celou historii', 'tokens.priced': 'Tokeny s cenou', 'tokens.pricedSub': 'mají pool ve Swapu', 'bridge.transfer': 'Převod', 'bridge.rate': 'Kurz', 'bridge.time': 'Doba převodu', 'bridge.timeEvm': 'obvykle pár minut', 'bridge.timeBtc': 'obvykle hodina', 'bridge.closed': 'Zatím nejde použít', 'bridge.routes': 'Trasy', 'bridge.routeCount': 'Trasy', 'bridge.routeWay': 'Směr', 'bridge.minShort': 'Nejméně', 'bridge.validators': 'Validátoři', 'bridge.validatorsSub': 'potřebné podpisy', 'bridge.stateLabel': 'Stav', 'bridge.stateOpen': 'V provozu', 'bridge.stateClosed': 'Připravuje se', 'bridge.delay': 'Velké převody', 'bridge.delayValue': 'čekají 24 h', 'bridge.delaySub': 'strážce je může zastavit', 'bridge.backed': 'krytí originálem', 'bridge.bothWays': 'oběma směry', 'bridge.viaDeposit': 'přes vkladovou adresu', 'bridge.recipientSelf': 'Moje adresa', 'nav.blockchain': 'Blockchain', 'nav.more': 'Více', 'home.title': 'Quinvium Explorer', 'home.stalled': 'Nikdo teď netěží, výkon sítě je nula. Poslední blok: {t}.', 'home.next': 'Další blok', 'home.target': 'cíl {n} s', 'search.go': 'Hledat', 'charts.viewTable': 'Tabulka', 'charts.peak': 'Nejvyšší výkon', 'tokens.native': 'Nativní', 'tokens.price': 'Cena', 'tokens.liquidity': 'Likvidita', 'tokens.holders': 'Držitelé', 'tokens.transfers': 'Převody', 'tokens.contract': 'Kontrakt', 'tokens.decimals': 'Desetinná místa', 'tokens.noPrice': 'Cenu tvoří pool s Quinviem ve Swapu. Dokud nevznikne, cena tokenu není známá.', 'tokens.noPool': 'zatím bez poolu', 'tokens.mint': 'Vydání', 'tokens.burn': 'Spálení', 'tokens.notListed': 'Neověřený', 'tokens.partial': 'Zobrazené údaje vycházejí jen z části adres, token jich má příliš mnoho.', 'nav.tokens': 'Tokeny', 'nav.bridge': 'Most', 'tokens.sub': 'Ověřené tokeny na této síti. Token se stejným názvem si může vytvořit kdokoli, rozhoduje adresa na tomto seznamu.', 'tokens.none': 'Na této síti zatím nejsou žádné ověřené tokeny.', 'tokens.ready': 'Síť je připravená na stablecoiny jako USDT, USDC nebo USD1. Vydavatel může svůj token vydat přímo tady, nebo přijde přes most krytý 1:1 originálem.', 't.kind': 'Druh', 't.token': 'Token', 't.supply': 'V oběhu', 't.issuer': 'Vydavatel', 'tokens.kind0': 'Vydaný', 'tokens.kind1': 'Přemostěný', 'tokens.kind2': 'Komunitní', 'tokens.check': 'Ověřit token', 'tokens.checkHelp': 'Vložte adresu tokenu a uvidíte, jestli je na seznamu.', 'tokens.address': 'Adresa tokenu', 'tokens.verify': 'Ověřit', 'tokens.listed': 'Ověřený token: {issuer}', 'tokens.unlisted': 'Tento token na seznamu není. Jeho název ani zkratka nic nedokazují.', 'tokens.badAddress': 'Neplatná adresa.', 'bridge.sub': 'Převod mincí mezi Quinviem a jinými sítěmi.', 'bridge.notReady': 'Most na této síti ještě neběží', 'bridge.notReadyBody': 'Kontrakty a validátoři jsou připravení a otestovaní. Most se otevře, až poběží nezávislí validátoři a proběhne nezávislý audit.', 'bridge.planned': 'Připravené trasy, oběma směry', 'bridge.onAether': 'Na Quinviu', 'bridge.needsValidators': 'Čeká na validátory', 'bridge.howTitle': 'Jak most funguje', 'bridge.how1': 'Na zdrojové síti se mince uzamknou v kontraktu, u Bitcoinu na vícepodpisové adrese.', 'bridge.how2': 'Validátoři převod potvrdí, až je v řetězci dost hluboko.', 'bridge.how3': 'Na cílové síti dostanete token krytý 1:1. Cestou zpět se token spálí a originál se uvolní.', 'bridge.trust': 'Most je tak bezpečný, jak nezávislí jsou jeho validátoři. Převod potvrzuje {threshold} z {count}. Velké částky čekají 24 hodin a strážce je může zastavit.', 'bridge.out': 'Z Quinvia', 'bridge.in': 'Na Quinvium', 'bridge.asset': 'Co a kam', 'bridge.amount': 'Částka', 'bridge.recipient': 'Příjemce', 'bridge.recipientBtc': 'Adresa Bitcoinu', 'bridge.send': 'Přemostit', 'bridge.min': 'Nejméně {min} {symbol}', 'bridge.sent': 'Převod je odeslaný. Validátoři ho potvrdí a mince dorazí na cílovou síť.', 'bridge.deposit': 'Vaše vkladová adresa', 'bridge.depositHelp': 'Adresa patří jen vám. Pošlete na ni Bitcoin z jakékoli peněženky nebo burzy. Po {n} potvrzeních se vám na Quinviu připíše {symbol}.', 'bridge.getAddress': 'Získat vkladovou adresu', 'bridge.paused': 'Most je dočasně zastavený.', 'bridge.history': 'Moje převody', 'bridge.noHistory': 'Zatím žádné převody.', 'bridge.waiting': 'Čeká na potvrzení', 'bridge.done': 'Doručeno', 'bridge.btcWaiting': 'Výplata v Bitcoinu', 'bridge.to': 'Cíl', 'bridge.badBtc': 'Tato adresa nepatří síti Bitcoin {net}.', 'bridge.noRoutes': 'Na této síti zatím není otevřená žádná trasa.',
      'nav.pools': 'Pooly', 'pools.sub': 'Pool spojí výkon více těžařů. Odměny přijímá kontrakt a rozdělí je podle odvedené práce, provozovatel na ně nedosáhne.', 'pools.pending': 'Pooly se v této síti zapnou v bloku {block}, zbývá {blocks} bloků.', 'pools.none': 'Zatím tu žádný pool není. Založte první.', 'pools.name': 'Název', 'pools.fee': 'Poplatek', 'pools.window': 'Dělí se za posledních', 'pools.paid': 'Vyplaceno těžařům', 'pools.minutes': '{n} min', 'pools.create': 'Založit pool', 'pools.createSub': 'Poplatek a pravidla rozdělení po založení nejde změnit. Těžaři to vidí, a proto vám nemusí věřit.', 'pools.fName': 'Název poolu', 'pools.fUrl': 'Adresa serveru, kam se připojí těžaři (http://…)', 'pools.fFee': 'Poplatek v procentech, nejvýše 5', 'pools.fRound': 'Délka kola v blocích', 'pools.fWindow': 'Kolik posledních kol se dělí o odměnu', 'pools.created': 'Pool je založený', 'pool.waiting': 'Čeká na rozdělení', 'pool.reserved': 'Patří těžařům, čeká na výplatu', 'pool.operator': 'Provozovatel', 'pool.opFee': 'Poplatek k výběru', 'pool.server': 'Server poolu', 'pool.rounds': 'Poslední kola', 'pool.round': 'Kolo', 'pool.work': 'Práce', 'pool.status': 'Stav', 'pool.settled': 'Rozděleno', 'pool.open': 'Běží', 'pool.connect': 'Jak se připojit', 'pool.connectApp': 'V aplikaci Quinvium otevřete Těžba, Nastavení těžby a vyberte tento pool.', 'pool.connectAsic': 'ASIC a další minery: adresa Stratum níže, jméno je vaše adresa s názvem zařízení, heslo může být libovolné.', 'pool.stratum': 'Stratum', 'pool.login': 'Jméno', 'pool.yourAddress': '0xVASE_ADRESA.nazev', 'pool.mine': 'Stav těžaře', 'pool.lookup': 'Adresa těžaře', 'pool.check': 'Zobrazit', 'pool.pendingAmount': 'K výběru', 'pool.share': 'Podíl v okně', 'pool.paidTo': 'Už vyplaceno', 'pool.claim': 'Vybrat', 'pool.feeWithdraw': 'Vybrat poplatek', 'pool.setUrl': 'Uložit adresu serveru', 'pool.notPool': 'Tato adresa není pool z továrny sítě. Netěžte do ní.', 'pool.safe': 'Kód tohoto poolu vznikl v továrně sítě, takže pravidla rozdělení jsou ověřená a provozovatel je nemůže změnit.', 'pool.noServer': 'Provozovatel neuvedl adresu serveru.',
      'time.now': 'právě teď', 'time.ago': '{t}', 'foot.peers': 'uzlů', 'bridge.refunding': 'Zrušeno, vrací se', 'bridge.refunded': 'Vráceno odesílateli', 'x.prev': '← Předchozí', 'x.next': 'Další →', 'f.resultsMore': 'Výsledků: více než {n}', 'miners.sub': 'Všichni, kdo kdy vytěžili blok, za celou historii sítě. Pool je jedna adresa příjemce odměny.', 'miners.total': 'Těžařů celkem', 'miners.active': 'Aktivní za 24 h', 'miners.blocks': 'Vytěžené bloky', 'miners.byBlocks': 'Podle bloků', 'miners.byLast': 'Podle poslední aktivity', 'miners.find': 'Najít těžaře podle adresy', 'miners.rank': 'Pořadí {rank} z {total}. Bloky: {blocks}, podíl {share}.', 'miners.notFound': 'Tato adresa zatím nevytěžila žádný blok.', 'miners.first': 'První blok', 'mp.sub': 'Transakce, které čekají na zápis do bloku. Těžař bere nejdřív ty s nejvyšším dýškem.', 'mp.count': 'Čeká transakcí', 'mp.countSub': 'fronta pojme {max}', 'mp.size': 'Velikost fronty', 'mp.tip': 'Dýško, medián', 'mp.tipRange': 'od {min} do {max} gwei', 'mp.oldest': 'Nejdéle čeká', 'mp.byFee': 'Podle dýška', 'mp.waiting': 'Čeká', 'mp.tipCol': 'Dýško (gwei)', 'mp.state': 'Stav', 'mp.ready': 'Do dalšího bloku', 'mp.gap': 'Chybí nonce {n}', 'mp.low': 'Nízký poplatek', 'tx.title': 'Transakce', 'tx.status': 'Stav', 'tx.confirmations': '{n} potvrzení', 'tx.time': 'Čas', 'tx.tokens': 'Převody tokenů', 'tx.gasPrice': 'Cena gasu', 'tx.gasPriceParts': 'základ {base} + dýško {tip} gwei', 'tx.maxFee': 'Nejvyšší poplatek', 'tx.maxParts': '{max} gwei, dýško nejvýše {tip} gwei', 'tx.gasUse': 'Gas: spotřeba a limit', 'tx.position': 'Nonce a pozice', 'tx.positionValue': 'nonce {nonce}, {index}. transakce v bloku', 'tx.events': 'Události', 'tx.input': 'Vstupní data', 'tx.format': 'Formát', 'tx.created': 'Vytvořený kontrakt', 'tx.unlimited': 'bez omezení', 'tx.failedNote': 'Transakce selhala, takže se nic nepřevedlo. Částka i tokeny zůstaly odesílateli, zaplatil se jen poplatek za spotřebovaný gas.', 'tx.gap': 'Transakce čeká na dřívější transakci z této adresy s pořadovým číslem (nonce) {n}, která v síti chybí. Dokud nepřijde, tahle se nevytěží. Peněženka ji nejspíš považuje za odeslanou: v MetaMasku pomůže Settings → Advanced → Clear activity tab data a nové odeslání.', 'tx.low': 'Nejvyšší poplatek je pod základním poplatkem sítě. Transakce počká, až základní poplatek klesne, nebo ji v peněžence urychlete.', 'tx.noMiner': 'Nikdo teď netěží. Transakce se potvrdí s dalším vytěženým blokem.', 'tx.unknown': 'Neznámá', 'charts.blockCount': 'Počet bloků', 'blk.minerReward': 'Odměna těžaře', 'addr.more': 'Více informací', 'addr.lastSent': 'Poslední odeslaná transakce', 'addr.firstSent': 'První odeslaná transakce', 'addr.fundedBy': 'Financováno z', 'blk.gasUsed': 'Spotřebovaný gas', 'blk.gasLimit': 'Limit gasu', 'blk.baseFee': 'Základní poplatek', 'charts.active': 'Aktivní adresy', 'charts.fees': 'Poplatky celkem', 'charts.avgFee': 'Průměrný poplatek', 'charts.contracts': 'Nasazené kontrakty', 'charts.failed': 'Neúspěšné transakce', 'charts.transfers': 'Převody tokenů', 'charts.util': 'Vytížení sítě', 'home.chart': 'Transakce za 14 dní', 'home.final': 'nevratný', 'home.gas': 'Poplatek teď', 'home.gasParts': 'základ {base} + dýško: pomalu {slow}, běžně {normal}, rychle {fast} gwei', 'home.latestBlocks': 'Poslední bloky', 'home.latestTxs': 'Poslední transakce', 'home.miner': 'Těžař', 'home.rewardTitle': 'odměna za blok a všechny poplatky, nic se nepálí', 'home.safe': 'Poslední bezpečný blok', 'home.tps': '{tps} tx/s, za 24 h {day}', 'home.txs': 'Transakce celkem', 'home.txsIn': '{n} tx za {s} s', 'home.txsOnly': '{n} tx', 'm.avgFee24': 'Průměrný poplatek (24 h)', 'm.blocks24': '{n} bloků za 24 h', 'm.fees24': 'Poplatky celkem (24 h)', 'm.finalNote': 'nevratný {n}', 'm.pending1h': 'Čekající (poslední hodina)', 'm.pendingAll': 've frontě celkem {n}', 'm.poolBlocks24': 'Bloky poolů (24 h)', 'm.poolShare': '{p} všech bloků, zbytek sólo těžaři', 'm.rewards24': 'Odměny těžařům (24 h)', 'm.rewardsNote': 'odměny za bloky i poplatky, nic se nepálí', 'm.safe': 'Poslední bezpečný blok', 'm.tps': '{tps} tx/s', 'm.txs24': 'Transakce (24 h)', 'm.util24': 'Vytížení sítě (24 h)', 't.method': 'Metoda', 'tx.openDetail': 'Detail transakce →', 'tx.preview': 'Rychlý náhled', 'tx.previewTitle': 'Transakce', 'pool.operatorNote': 'tvůrce poolu, dostává poplatek {fee} z každého rozdělení', 'pool.payer': 'Poplatky za podíly platí', 'pool.payerNote': 'účet serveru poolu, zůstatek {value}. Když dojde, podíly se přestanou zapisovat.', 'pool.money': 'Hospodaření poolu', 'pool.rewards': 'Odměny za bloky', 'pool.rewardBlocks': '{n} vytěžených bloků', 'pool.feeTotal': 'Poplatek provozovatele celkem', 'pool.feeParts': 'k výběru {owed}, vybráno {withdrawn}', 'pool.miners': 'Těžaři v okně poolu', 'pool.minersSub': 'podíly za posledních {n} min', 'pool.miner': 'Těžař', 'pool.sharesCol': 'Podíly', 'pool.lastShare': 'Poslední podíl', 'pool.noMiners': 'V okně poolu zatím nikdo neposlal podíl.', 'pool.devices': 'Připojená zařízení', 'pool.devicesSub': 'teď připojeno {n}', 'pool.device': 'Zařízení', 'pool.hashrate': 'Výkon', 'pool.seen': 'Naposledy', 'pool.noDevices': 'Teď není připojené žádné zařízení.', 'pool.minersNow': 'Těžaři v okně', 'addr.poolNote': 'Tohle je kontrakt těžebního poolu {name}. Odměny za bloky dostává přímo od sítě a těžařům je vyplácí uvnitř kontraktu, proto nejsou v seznamu transakcí ani v součtech přijato a odesláno v transakcích.', 'addr.poolNumbers': 'Vytěžil {blocks} bloků za {income}, těžařům vyplatil {paid}.', 'addr.poolOpen': 'Přehled poolu →', 'addr.pools': 'Provozuje pooly', 'addr.poolFeeOwed': 'Poplatek k výběru', 'type.transfer': 'Převod', 'type.tokenTransfer': 'Převod tokenu', 'type.approve': 'Schválení tokenu', 'type.mint': 'Ražba tokenu', 'type.swap': 'Swap', 'type.liqAdd': 'Přidání likvidity', 'type.liqRemove': 'Odebrání likvidity', 'type.bridgeOut': 'Most: odeslání', 'type.bridgeIn': 'Most: doručení', 'type.bridgeCancel': 'Most: zrušení', 'type.bridgeSign': 'Most: podpis validátora', 'type.wrap': 'Zabalení mince', 'type.unwrap': 'Rozbalení mince', 'type.poolShare': 'Pool: podíl těžaře', 'type.poolPayout': 'Pool: výplata', 'type.poolCreate': 'Založení poolu', 'type.name': 'Jméno .qu', 'type.notary': 'Notářský zápis', 'type.escrow': 'Úschova', 'type.tokenCreate': 'Vytvoření tokenu', 'type.create': 'Nasazení kontraktu', 'type.call': 'Volání kontraktu', 'dir.out': 'Odesláno', 'dir.in': 'Přijato', 'dir.self': 'Sám sobě', 'sum.transfer': '{amount} na {to}', 'sum.approve': '{who} smí utratit {amount}', 'sum.mint': '{amount} pro {to}', 'sum.swap': '{from} → {to}', 'sum.swapMin': '{from} → nejméně {to}', 'sum.bridge': '{amount} do sítě {chain}', 'addr.transfersTab': 'Převody tokenů', 'addr.noTransfers': 'Adresa zatím neposlala ani nedostala žádný token.', 'addr.counterparty': 'Protistrana', 'tx.unknownNote': 'Uzel tuto transakci nezná. Buď sem ještě nedorazila, nebo ji fronta zahodila, třeba po šesti hodinách čekání. Dokud není v bloku, nic se nepřevedlo: mince i tokeny zůstávají na účtu odesílatele. Peněženka Quinvium ji pošle znovu sama, v MetaMasku ji stačí zrychlit nebo odeslat znovu.', 'tx.next': 'Čeká na další blok, obvykle do {n} s.', 'blk.final': 'Nevratný', 'blk.confirmed': 'Potvrzený', 'blk.solve': 'vytěžen za {s} s', 'blk.totalDifficulty': 'Celková obtížnost', 'blk.extra': 'Doplňující data', 'blk.none': 'Blok nemá žádné transakce.', 'blk.gasOf': '{used} z {limit} ({pct})', 'swap.impactWarn': 'Pool je pro tuto částku malý. Dostanete o {p} méně, než odpovídá současnému kurzu. Do 5 % ztráty se vejde asi {max} {symbol}.', 'swap.impactAck': 'Rozumím a chci směnit i tak', 'wallet.addToken': 'Přidat {symbol} do peněženky', 'wallet.tokenAdded': '{symbol} je v peněžence.', 'foot.about': 'Prohlížeč sítě Quinvium: bloky, transakce, adresy, tokeny a těžba. Data čte přímo z uzlu.', 'foot.tools': 'Nástroje', 'foot.status': 'Stav sítě', 'foot.top': 'Nahoru', 'foot.node': 'uzel {v}', 'tx.function': 'Funkce',
      'f.all': 'Vše', 'f.filter': 'Filtry', 'f.range': 'Období', 'f.r1h': 'Poslední hodina', 'f.r24h': '24 hodin', 'f.r7d': '7 dní', 'f.r30d': '30 dní', 'f.rCustom': 'Vlastní', 'f.from': 'Od', 'f.to': 'Do', 'f.time': 'Čas', 'f.miner': 'Těžař', 'f.address': 'Adresa', 'f.content': 'Obsah', 'f.withTx': 'S transakcemi', 'f.emptyOnly': 'Prázdné', 'f.order': 'Řazení', 'f.newest': 'Nejnovější', 'f.oldest': 'Nejstarší', 'f.kind': 'Druh', 'f.status': 'Stav', 'f.direction': 'Směr', 'f.in': 'Příchozí', 'f.out': 'Odchozí', 'f.minValue': 'Nejméně ({coin})', 'f.apply': 'Použít', 'f.reset': 'Zrušit filtry', 'f.results': 'Výsledků: {n}', 'f.none': 'Filtrům nic neodpovídá.', 'f.badAddress': 'To není platná adresa.', 'f.fromBlock': 'Od bloku', 'f.toBlock': 'Do bloku', 'x.page': 'Strana {n} z {of}', 'addr.poolTab': 'Výplaty z poolů', 'addr.poolTotal': 'Celkem z poolů', 'addr.first': 'První aktivita', 'addr.last': 'Poslední aktivita', 'addr.received': 'Přijato v transakcích', 'addr.sent': 'Odesláno v transakcích', 'addr.fees': 'Zaplacené poplatky', 'addr.mined': 'Vytěžené bloky', 'addr.income': 'Příjem z těžby', 'addr.code': 'Velikost kódu', 'addr.tokens': 'Tokeny', 'addr.noTokens': 'Tato adresa zatím žádné tokeny neměla.', 'addr.qr': 'QR kód adresy', 'addr.failed': 'Neúspěšné transakce', 'token.symbol': 'Zkratka', 'charts.sub': 'Historie sítě za zvolené období. Najetím na graf uvidíte přesné hodnoty.', 'charts.txs': 'Transakce', 'charts.gas': 'Využitý gas', 'charts.slowest': 'Nejpomalejší blok (s)', 'charts.empty': 'V tomto období nejsou žádné bloky.', 'charts.blocks': '{n} bloků, #{from} až #{to}', 'pools.advanced': 'Pokročilé nastavení', 'pools.nextTitle': 'Co následuje', 'pools.next1': 'Potvrdíte založení v peněžence, kontrakt vznikne během chvíle.', 'pools.next2': 'V aplikaci Quinvium otevřete Pooly a spusťte server poolu s adresou nového kontraktu.', 'pools.next3': 'Pošlete malou částku na účet na gas, platí se z něj odesílání podílů a výplaty.', 'wallet.copy': 'Kopírovat adresu', 'wallet.copied': 'Adresa zkopírována', 'wallet.view': 'Zobrazit moji adresu', 'wallet.disconnect': 'Odpojit', 'connect.title': 'Připojit peněženku', 'connect.sub': 'Vyberte, čím se chcete přihlásit. Klíče zůstávají ve vaší peněžence, stránka je nikdy neuvidí.', 'connect.browser': 'Peněženka v prohlížeči', 'connect.browserNote': 'V tomto prohlížeči', 'connect.found': 'Nalezeno', 'connect.install': 'Nainstalovat do prohlížeče', 'connect.wcNote': 'Peněženka v telefonu přes QR kód', 'connect.appHint': 'Vlastní peněženku vytvoříte nebo obnovíte v aplikaci Quinvium.', 'connect.wcTitle': 'WalletConnect', 'connect.wcBody': 'Naskenujte kód peněženkou v telefonu.', 'connect.wcSetup': 'WalletConnect potřebuje Project ID ze služby cloud.reown.com. Je zdarma a není tajné.', 'connect.wcSave': 'Uložit a pokračovat', 'connect.wcMissing': 'Modul WalletConnect se nepodařilo načíst.',
      'side.network': 'Síť', 'nav.overview': 'Přehled', 'nav.blocks': 'Bloky', 'nav.txs': 'Transakce', 'nav.apps': 'Aplikace',
      'nav.mempool': 'Čekající transakce', 'nav.richlist': 'Žebříček adres', 'nav.network': 'Síť a uzly', 'nav.charts': 'Grafy', 'nav.miners': 'Těžaři',
      'nav.mining': 'Začít těžit', 'nav.api': 'Pro vývojáře', 'search.ph': 'Blok, transakce, adresa…', 'wallet.connect': 'Připojit peněženku',
      'wallet.close': 'Zavřít', 'wallet.retry': 'Zkusit znovu', 'wallet.cancelled': 'Připojení peněženky bylo zavřeno.', 'wallet.switchBtn': 'Přepnout síť', 'wallet.ready': 'Peněženka je připojená k síti',
      'wallet.generic': 'Peněženka', 'wallet.genericOf': 'peněženky', 'wallet.waiting': 'Čekám na potvrzení v peněžence…',
      'wallet.whereExt': 'Okno se neotevřelo? Vpravo nahoře v prohlížeči klikněte na ikonu {of}. Pokud ji tam nevidíte, je pod ikonou dílku skládačky.', 'wallet.whereApp': 'Žádost čeká v hlavním okně aplikace Quinvium.',
      'wallet.approveTitle': 'Potvrďte připojení', 'wallet.approveBody': 'V okně {of} potvrďte, že tato stránka smí vidět vaši adresu. Mince tím nikomu nedáváte, každou transakci schvalujete zvlášť.',
      'wallet.stuckTitle': '{w} čeká na vaše potvrzení', 'wallet.stuck1': 'Vpravo nahoře v prohlížeči klikněte na ikonu {of}. Pokud ji tam nevidíte, je pod ikonou dílku skládačky.', 'wallet.stuck2': 'Potvrďte žádost, která tam čeká.', 'wallet.stuck3': 'Tato stránka to pozná sama a bude pokračovat.',
      'wallet.netTitle': 'Přidejte síť {net}', 'wallet.netBody': 'Adresa je připojená, ale {w} je na jiné síti, a proto neukazuje vaše {coin}. Potvrďte v okně {of} přidání a přepnutí sítě.', 'wallet.netChain': 'Chain ID', 'wallet.netRpc': 'Uzel', 'wallet.netCoin': 'Mince',
      'wallet.rejectedTitle': 'Žádost byla odmítnuta', 'wallet.rejectedBody': 'Nic se nezměnilo. Můžete to zkusit znovu, nebo okno zavřít.', 'wallet.failedTitle': 'Nepovedlo se',
      'wallet.noneBody': 'Nejjednodušší je otevřít Explorer z aplikace Quinvium tlačítkem Explorer, peněženka je tam rovnou připravená. V prohlížeči můžete použít MetaMask nebo rozšíření Quinvium Wallet a pak tuto stránku obnovit.',
      'wallet.downTitle': 'Uzel neběží', 'err.down': 'Uzel na adrese {rpc} neodpovídá. Zkontrolujte, že je otevřená aplikace Quinvium. Stránka se obnoví sama, jakmile se uzel vrátí.', 'net.off': 'Síť {net} na tomto počítači neběží, zůstáváte na stávající síti.',
      'wallet.none': 'V tomto prohlížeči není peněženka', 'wallet.wrong': 'Přepněte peněženku na síť', 'wallet.add': 'Přidat síť do peněženky',
      'home.sub': 'Stav sítě Quinvium v reálném čase.', 'home.tip': 'Poslední blok', 'home.health': 'Stav sítě', 'home.ok': 'V pořádku', 'home.sync': 'Synchronizace',
      'm.height': 'Výška', 'm.supply': 'V oběhu', 'm.fees': 'Poplatky těžařům', 'm.reward': 'Odměna za blok', 'm.hashrate': 'Výkon sítě', 'm.difficulty': 'Obtížnost',
      'm.ofMax': 'z 64 mil.', 'm.feesSub': 'odměna navíc k emisi', 'f.age': 'Stáří', 'f.tx': 'Transakce', 'f.gas': 'Gas', 'f.size': 'Velikost',
      'watch.title': "Hlídání sítě", 'watch.sub': "Tento uzel se ptá ostatních uzlů na jejich blok a porovnává web a Explorer s GitHubem.", 'watch.peers': "Uzly se stejným blokem", 'watch.differ': "Uzly na jiné větvi", 'watch.incidents': "Hluboké přepisy za 24 h", 'watch.sites': "Web a Explorer", 'watch.siteOk': "Shoda s GitHubem", 'watch.siteChanged': "Změněno: {n}", 'watch.siteWait': "Zatím nezkontrolováno", 'watch.siteOff': "Kontrola vypnutá", 'watch.minority': "Většina uzlů má jiný blok než tento uzel. Tento uzel může být odříznutý od sítě.", 'watch.explorerNodes': "Uzly Exploreru se neshodují: {list} ukazuje jinou větev, Explorer ho nepoužívá.", 'nav.apiTop': "API", 'pools.noFee': "bez poplatku", 'pools.noFeeHint': "Sólo těžař si nechává celý blok a žádný poplatek neplatí.", 'sg.block': "Blok", 'sg.tx': "Transakce", 'sg.address': "Adresa", 'sg.token': "Token", 'sg.pool': "Pool", 'sg.name': "Jméno .qu", 'sg.contract': "kontrakt", 'sg.pending': "čeká na blok", 'sg.none': "Nic nenalezeno. Enter zkusí přesnou shodu.", 'sg.filter': "Filtr hledání", 'sg.f.all': "Vše", 'sg.f.addresses': "Adresy", 'sg.f.tokens': "Tokeny", 'sg.f.blocks': "Bloky", 'sg.f.txs': "Transakce", 'sg.f.pools': "Pooly", 'sg.f.names': "Jména .qu", 'sig.title': 'Signalizace forků', 'sig.sub': 'Těžaři mohou do bloku napsat QIP-n a vyjádřit tak podporu návrhu. Je to jen informace, nic se tím nezapíná. Posledních {n} bloků.', 'sig.none': 'Žádný blok v tomto období nesignalizuje žádný návrh.', 'sig.proposal': 'Návrh', 'sig.miners': 'Těžaři', 'sig.how': 'Jak signalizovat a jak se síť mění', 'nh.peers': 'Připojené uzly', 'nh.time': 'Průměrný čas bloku', 'nh.accounts': 'Účty', 'nh.mempool': 'Čekající transakce', 'nh.basefee': 'Základní poplatek', 'nh.tips': 'Dýško pomalu · běžně · rychle', 'nh.halving': 'Další půlení',
      'sec.viewAll': 'Zobrazit vše →', 't.block': 'Blok', 't.hash': 'Hash', 't.miner': 'Těžař', 't.tx': 'Tx', 't.age': 'Stáří', 't.gas': 'Gas', 't.from': 'Od', 't.to': 'Komu', 't.value': 'Částka',
      't.status': 'Stav', 't.balance': 'Zůstatek', 't.share': 'Podíl', 't.address': 'Adresa', 't.blocks': 'Bloky', 't.last': 'Poslední blok', 't.fee': 'Poplatek', 't.type': 'Typ',
      'x.noBlocks': 'Žádné bloky', 'x.noTxs': 'Zatím žádné transakce', 'x.empty': 'Žádné čekající transakce', 'x.newer': '← Novější', 'x.older': 'Starší →',
      'b.ok': 'úspěch', 'b.fail': 'selhala', 'b.pending': 'čeká', 'tx.create': 'Nasazení kontraktu', 'tx.call': 'Volání kontraktu', 'tx.transfer': 'Převod',
      'err.node': 'Uzel není dostupný', 'addr.contract': 'Kontrakt', 'addr.account': 'Účet', 'addr.system': 'Systémový kontrakt', 'addr.name': 'Jméno', 'addr.nonce': 'Počet transakcí',
      'mine.sub': 'Těžař dostane odměnu 4 QU za blok a všechny poplatky z transakcí v bloku.', 'b.reward': 'Odměna za blok', 'b.baseFees': 'Základní poplatky', 'b.tips': 'Dýška', 'b.total': 'Těžař celkem', 'mine.own': 'Vlastní Quinvium Miner (Windows, macOS, Linux)',
      'mine.other': 'Běžné Windows minery přes Stratum', 'mine.note': 'Těžit lze na libovolný uzel. Účet ani registrace nejsou potřeba, stačí adresa peněženky.',
      'mine.yourAddr': 'VAŠE_ADRESA', 'apps.sub': 'Hotové kontrakty sítě Quinvium pro různé obory. Čtení je zdarma, zápis podepisuje vaše peněženka.',
      'tool.read': 'Ověřit', 'tool.write': 'Zapsat do řetězce', 'tool.file': 'Nebo vyberte soubor (zůstává ve vašem počítači)', 'tool.sent': 'Transakce odeslána', 'tool.done': 'Potvrzeno v bloku', 'tool.missing': 'Vyplňte pole', 'tool.failed': 'Transakce v bloku selhala', 'tool.nameStep1': 'Krok 1 ze 2: podepište závazek', 'tool.nameStep2': 'Čekám na ochrannou lhůtu, zbývá', 'tool.nameStep3': 'Krok 2 ze 2: podepište registraci', 'tool.namePrimary': 'Poslední krok: podepište, aby se jméno ukazovalo místo vaší adresy', 'tool.nameResume': 'Pokračuji v rozdělané registraci, závazek už je v řetězci.', 'tool.namePending': 'Registrace jména {name} není dokončená: krok 1 je v řetězci, krok 2 chybí. Klikněte na Dokončit registraci a podepište ho (závazek platí 24 hodin od odeslání).', 'tool.nameFinished': 'Jméno se teď ukazuje místo vaší adresy.', 'prof.currency': 'Měna', 'prof.symbol': 'symbol Quinvia', 'prof.avatar': 'Profilový obrázek (NFT)', 'prof.deploy1': '1. Nasadit Quinvium Avatars', 'prof.deploy2': '2. Nasadit Profily', 'prof.mintHint': 'Vyberte ikonu a barvu, vyrazte z nich vlastní NFT Quinvium Avatar jen za poplatek do sítě a nastavte ho jako profilový obrázek. Ukazuje se jen, dokud NFT patří vaší adrese.', 'prof.mint': 'Vyrazit avatar (krok 1 ze 2)', 'prof.use': 'Nastavit jako profilový obrázek', 'prof.minted': 'Avatar je vyražený. Teď ho nastavte jako profilový obrázek (krok 2 ze 2).', 'prof.removed': 'Profilový obrázek je odebraný.', 'prof.other': 'Použít jiné NFT, které vlastníte', 'prof.nft': 'Adresa kontraktu NFT', 'prof.tokenId': 'Číslo tokenu', 'prof.otherNote': 'Obrázek cizího NFT se ukáže, jen když je uložený přímo v řetězci. Obrázky z cizích serverů Explorer nenačítá, aby nikdo nesledoval, kdo stránku prohlíží.', 'prof.badNft': 'Zadejte adresu kontraktu a číslo tokenu.', 'prof.tag': 'Identita · Peněženky', 'prof.title': 'Profil', 'prof.desc': 'Profilový obrázek u vaší adresy a jména .qu a zobrazení měny.', 'prof.none': 'Kontrakty Quinvium Avatars a Profily na této síti ještě nejsou. Kdokoli je může nasadit dvěma transakcemi: nemají správce ani poplatky.', 'prof.badCode': 'Kód na nastavených adresách neodpovídá zveřejněným kontraktům, profilové obrázky se proto nepoužijí.', 'prof.source': 'Kód je přesně packages/contracts/dist/artifacts.json z repozitáře na GitHubu. Otisky SHA-256 si můžete porovnat před podpisem.', 'prof.address': 'Adresa kontraktu', 'prof.deployed': 'Kontrakt je nasazený. Adresy obou kontraktů se zapíšou do Exploreru při další aktualizaci, potom si profilový obrázek může nastavit každý.', 'prof.icon': 'Ikona', 'prof.color': 'Barva', 'prof.clear': 'Odebrat ikonu', 'prof.saved': 'Profilový obrázek je nastavený.', 'coin.text': 'Měnu ukazovat jako QU', 'coin.symbol': 'Měnu ukazovat symbolem Quinvia', 'tool.nameReady': 'Krok 1 je v řetězci a ochranná lhůta uplynula. Klikněte na Dokončit registraci a potvrďte krok 2 v peněžence.', 'tool.nameFinish': 'Dokončit registraci (krok 2 ze 3)', 'addr.names': 'Jména .qu', 'addr.namesHint': 'Jméno zatím není hlavní, proto se místo adresy neukazuje.', 'addr.setPrimary': 'Nastavit jako hlavní jméno', 'net.title': 'Síť a uzly', 'net.rpcLan': 'RPC v domácí síti', 'net.rpcPublic': 'RPC z internetu', 'net.rpcPublicFwd': 'RPC z internetu (po přesměrování)', 'net.rpcOnlyHere': 'Uzel přijímá jen tento počítač. Sdílení se zapíná v aplikaci Quinvium v části Uzel, Spojit s jiným počítačem.', 'net.rpcHint': 'Do peněženky v telefonu zadejte RPC z domácí sítě, nebo z internetu, když je telefon na mobilních datech.', 'charts.time': 'Čas bloku (s)', 'charts.diff': 'Obtížnost', 'charts.rate': 'Odhad výkonu (H/s)',
      'rich.sub': 'Adresy podle zůstatku', 'mem.sub': 'Transakce čekající na vytěžení', 'miners.sub': 'Podle posledních 1000 bloků', 'search.none': 'Nic nenalezeno pro',
      'swap.allTrades': 'Všechny směny →', 'swap.mine': 'Moje likvidita', 'swap.searchPair': 'Hledat dvojici', 'swap.linked': 'Částky jsou svázané kurzem poolu', 'swap.linkedRate': 'Svázáno kurzem poolu: 1 {a} = {rate} {b}', 'swap.newPoolRate': 'Nový pool: poměr částek určí počáteční kurz', 'swap.addMore': 'Přidat', 'swap.withdrawPart': 'Vybrat část', 'swap.youGet': 'Dostanete zpět asi {a} a {b}.', 'swap.everything': 'vše', 'swap.pickPart': 'Vyberte, kolik chcete vybrat.', 'swap.showMore': 'Zobrazit dalších {n} (celkem {total})', 'swap.noMatch': 'Hledání neodpovídá žádná dvojice.', 'bridge.step1': 'Uzamčení', 'bridge.step2': 'Potvrzení', 'bridge.step3': 'Připsání', 'bridge.how2n': 'Nezávislí validátoři počkají, až je převod v řetězci dost hluboko, a podepíšou ho. Potřeba je {threshold} z {count} podpisů.',
      'pools.online': 'Server zveřejněný', 'pools.noServerShort': 'Bez serveru', 'pool.asic': 'ASIC a jiné', 'pool.viaApp': 'V aplikaci Quinvium otevřete Těžba → Kam těžíte, najděte tento pool v seznamu a vyberte ho. Těžba pak poběží na vaši peněženku.', 'pool.asicUrl': 'Adresa poolu', 'pool.asicWorker': 'Pracovník (worker)', 'pool.password': 'Heslo', 'pool.loginNote': 'adresa peněženky pro výplaty, za tečkou název zařízení', 'pool.passwordNote': 'libovolné, pool ho nepoužívá', 'pool.algo': 'Algoritmus', 'pool.algoNote': 'standardní Ethash přes EthereumStratum/1.0.0 i ETHPROXY', 'pool.payout': 'Výplaty', 'pool.payoutNote': 'automaticky z kontraktu, PPLNS za posledních {n} min, poplatek provozovatele {fee}', 'pool.software': 'Program', 'pool.connectNote': 'Těžit jde přes server, který provozovatel zveřejnil. Odměny drží kontrakt: provozovatel si vezme jen poplatek a výplatu může každý těžař vybrat i sám tlačítkem Vybrat.', 'pool.share24': 'Podíl na blocích za 24 h', 'pool.blocks24': '{n} bloků za 24 h', 'pool.findMiner': 'Najít těžaře podle adresy', 'pool.minersTotal': 'celkem {n} těžařů', 'pool.minerNotFound': 'Tato adresa v okně poolu neposlala žádný podíl.', 'pool.allMiners': '← Všichni těžaři', 'pool.createdTitle': 'Pool je založený. Co dál:', 'pools.otherPools': 'Ostatní pooly', 'pools.otherCount': 'dalších poolů: {n}', 'pools.all': 'Všechny pooly ({n})', 'pools.find': 'Hledat pool podle jména nebo adresy', 'pools.minersCol': 'Těžaři', 'pools.createdCol': 'Založen', 'pools.noMatch': 'Hledání „{q}“ neodpovídá žádný pool.',
      'pool.windowSub': 'dělí se za posledních {n} min',
      'pool.asicNote': 'Stroj potřebuje firmware pro Ethash, ne pro Etchash. Skutečný ASIC na této síti zatím nikdo nezkoušel, před nákupem kvůli Quinviu je to potřeba ověřit.',
      'pool.after1': 'V aplikaci Quinvium otevřete Těžba → Kam těžíte → Provozovat pool, vložte adresu tohoto poolu a uložte. Uzel se spustí znovu i se serverem poolu.', 'pool.after2': 'V části Síť zapněte Zpřístupnit Explorer a těžbu ostatním počítačům v síti, aby se těžaři dostali ke Stratu.', 'pool.after3': 'Na účet na gas, který server u poolu ukáže, pošlete malou částku. Platí se z něj odesílání podílů a výplaty.', 'pool.after4': 'Níže v části Provozovatel uložte adresu serveru, třeba http://192.168.1.50:8546. Podle ní se těžaři připojí.',
      'tx.reason': 'Důvod', 'tx.tipSlippage': 'Nejčastěji ji způsobí jiná směna ve stejném poolu těsně před ní, třeba stejná směna odeslaná dvakrát za sebou. Swap teď další směnu pustí až po potvrzení předchozí.', 'tx.tipAllowance': 'Swap schválení posílá sám a čeká na jeho potvrzení. Tady schválení chybělo, nebo ho spotřebovala dřívější transakce.', 'tx.tipBalance': 'Tokeny mezitím mohla spotřebovat jiná transakce ze stejného účtu.', 'tx.tipExpired': 'Transakce čekala déle, než dovolila lhůta. Stačí ji odeslat znovu.', 'tx.outOfGas': 'Transakci došel gas, spotřebovala celý limit {limit}.', 'tx.tipGas': 'Při odeslání nechte peněženku gas odhadnout, nebo limit zvyšte.', 'tx.panic': 'Kontrakt skončil vnitřní chybou {code}.', 'tx.revertUnknown': 'Kontrakt transakci odmítl chybou, kterou Explorer nezná.', 'tx.revertEmpty': 'Kontrakt transakci odmítl bez udání důvodu.', 'swap.waitPrevious': 'Z tohoto účtu ještě čeká předchozí transakce. Počkejte na její potvrzení: kurz i zůstatek se po ní změní a další transakce by mohla selhat.', 'pool.placeholderNote': 'Místo {ph} vložte adresu peněženky, na kterou mají chodit výplaty.', 'bridge.tTime': 'Doba převodu', 'bridge.vTime': 'Pár minut', 'bridge.nTime': 'S Bitcoinem asi hodinu', 'bridge.tFee': 'Poplatek mostu', 'bridge.vFee': 'Žádný, kurz 1 : 1', 'bridge.nFee': 'Platí se jen poplatek sítě', 'bridge.tBig': 'Velké převody', 'bridge.vBig': 'Čekají 24 hodin', 'bridge.nBig': 'Strážce je může zastavit', 'bridge.tFail': 'Když převod neprojde', 'bridge.vFail': 'Vrátí se odesílateli', 'bridge.nFail': 'V Mých převodech je vidět kdy', 'bridge.fee': 'Poplatek', 'bridge.feeNone': 'žádný, jen poplatek sítě', 'bridge.feeBtc': 'poplatek sítě Bitcoin se odečte z částky',
      'home.gasCalm': 'nejnižší možná, bloky jsou plné z {p} %, cena roste až s plnými bloky', 'home.gasBusy': 'síť je vytížená, cena roste s každým plným blokem',
      'swap.goHigh': 'Směnit · velký dopad na cenu',
      'swap.limitBy': 'Vklad omezuje zůstatek {symbol}. Pool bere oba tokeny v poměru kurzu a na víc {other} by bylo potřeba víc {symbol}, než je k dispozici.', 'swap.coinLeft': 'Po vkladu zůstane {left} {coin} na poplatky sítě.',
      'tool.optional': 'nepovinné',
    },
    en: {
      'nav.swap': 'Swap', 'swap.sub': 'Instant token exchange through liquidity pools. The rate comes from the pool reserves and a contract holds the coins, not an operator.', 'swap.notReady': 'Swap is not running on this network yet', 'swap.notReadyBody': 'The contracts are finished and tested. They switch on once deployed to this network.', 'swap.tabSwap': 'Swap', 'swap.tabPools': 'Liquidity', 'swap.from': 'From', 'swap.to': 'To', 'swap.balance': 'Balance', 'swap.max': 'Max', 'swap.rate': 'Rate', 'swap.impact': 'Price impact', 'swap.min': 'You receive at least', 'swap.fee': 'Pool fee', 'swap.route': 'Route', 'swap.slippage': 'Slippage tolerance', 'swap.go': 'Swap', 'swap.noPool': 'There is no pool for this pair yet.', 'swap.enter': 'Enter an amount', 'swap.same': 'Choose two different tokens.', 'swap.done': 'Swap complete.', 'swap.high': 'High price impact: the pool is small for this amount.', 'swap.flip': 'Flip', 'swap.pair': 'Pair', 'swap.reserves': 'Reserves', 'swap.share': 'My share', 'swap.noPools': 'There are no pools yet.', 'swap.add': 'Add liquidity', 'swap.addHelp': 'Providers earn the 0.3% fee from every swap according to their share. If the rate moves, the deposit can be worth less than simply holding the coins.', 'swap.tokenA': 'First token', 'swap.tokenB': 'Second token', 'swap.amountA': 'First token amount', 'swap.amountB': 'Second token amount', 'swap.added': 'Liquidity is in the pool.', 'swap.remove': 'Withdraw all', 'swap.removed': 'Liquidity withdrawn.', 'swap.test': 'On testnet tokens have no value and rates are only examples.',
      'swap.searchToken': 'Name, symbol or address', 'swap.pickToken': 'Select a token', 'swap.pay': 'You pay', 'swap.receive': 'You receive', 'swap.noFunds': 'Not enough {symbol}', 'swap.noTrades': 'No swaps yet.', 'swap.chartEmpty': 'The chart fills up with the first swap.', 'swap.trades': 'Recent swaps', 'swap.buy': 'Buy', 'swap.sell': 'Sell', 'swap.priceUnit': '{quote} per 1 {base}', 'swap.change': '24h change', 'swap.volume': '24h volume', 'swap.count': '24h swaps', 'swap.viaHub': 'There is no direct pool for this pair, the swap goes through {coin}. Shown below is the pool it uses.', 'swap.priceChart': 'Price history', 'swap.pools': 'Liquidity pools', 'swap.poolShare': 'Pool share', 'swap.newPool': 'New pool, this deposit sets the rate', 'swap.removeShort': 'Withdraw', 'pools.split': 'Network hashrate distribution', 'pools.soloMore': '{n} more solo miners', 'pools.soloHint': 'mining on their own without a pool; all of them are listed under Miners', 'pools.activeNow': 'Mining (block in the last hour)', 'pools.idleNow': 'No block in the last hour', 'pools.solo': 'Solo miners', 'pools.soloCount': 'solo addresses: {n}', 'pools.soloOne': 'solo miner', 'pools.topNow': 'Largest share, last hour', 'pools.top': 'Largest share', 'pools.count': 'Pools', 'pools.hash': 'Average hashrate', 'pools.warn': '{name} has {p} % of the hashrate in the last hour. A majority can rewrite the latest blocks.', 'pools.splitNote': 'Calculated from mined blocks and their difficulty. The reward recipient is written in the block, so nobody can fake a share.', 'tokens.cap': 'Market value', 'tokens.search': 'Search tokens', 'tokens.count': 'Verified tokens', 'tokens.countSub': 'excluding the main coin', 'tokens.totalLiq': 'Total liquidity', 'tokens.liqSub': 'in pools with the main coin', 'tokens.totalTransfers': 'Token transfers', 'tokens.transfersSub': 'all time', 'tokens.priced': 'Tokens with a price', 'tokens.pricedSub': 'have a pool in Swap', 'bridge.transfer': 'Transfer', 'bridge.rate': 'Rate', 'bridge.time': 'Transfer time', 'bridge.timeEvm': 'usually a few minutes', 'bridge.timeBtc': 'usually an hour', 'bridge.closed': 'Not available yet', 'bridge.routes': 'Routes', 'bridge.routeCount': 'Routes', 'bridge.routeWay': 'Direction', 'bridge.minShort': 'Minimum', 'bridge.validators': 'Validators', 'bridge.validatorsSub': 'signatures required', 'bridge.stateLabel': 'Status', 'bridge.stateOpen': 'Running', 'bridge.stateClosed': 'In preparation', 'bridge.delay': 'Large transfers', 'bridge.delayValue': 'wait 24 h', 'bridge.delaySub': 'a guardian can stop them', 'bridge.backed': 'backed by the original', 'bridge.bothWays': 'both directions', 'bridge.viaDeposit': 'through a deposit address', 'bridge.recipientSelf': 'My address', 'nav.blockchain': 'Blockchain', 'nav.more': 'More', 'home.title': 'Quinvium Explorer', 'home.stalled': 'Nobody is mining right now, so the hashrate is zero. Latest block: {t}.', 'home.next': 'Next block', 'home.target': 'target {n} s', 'search.go': 'Search', 'charts.viewTable': 'Table', 'charts.peak': 'Peak hashrate', 'tokens.native': 'Native', 'tokens.price': 'Price', 'tokens.liquidity': 'Liquidity', 'tokens.holders': 'Holders', 'tokens.transfers': 'Transfers', 'tokens.contract': 'Contract', 'tokens.decimals': 'Decimals', 'tokens.noPrice': 'The price comes from a pool with Quinvium in Swap. Until one exists, the token has no known price.', 'tokens.noPool': 'no pool yet', 'tokens.mint': 'Mint', 'tokens.burn': 'Burn', 'tokens.notListed': 'Not verified', 'tokens.partial': 'These figures cover only part of the addresses, this token has too many.', 'nav.tokens': 'Tokens', 'nav.bridge': 'Bridge', 'tokens.sub': 'Verified tokens on this network. Anyone can create a token with the same name, the address on this list is what counts.', 'tokens.none': 'There are no verified tokens on this network yet.', 'tokens.ready': 'The network is ready for stablecoins such as USDT, USDC and USD1. An issuer can launch its token directly here, or it can arrive through the bridge backed 1:1 by the original.', 't.kind': 'Kind', 't.token': 'Token', 't.supply': 'Supply', 't.issuer': 'Issuer', 'tokens.kind0': 'Issued', 'tokens.kind1': 'Bridged', 'tokens.kind2': 'Community', 'tokens.check': 'Check a token', 'tokens.checkHelp': 'Paste a token address to see whether it is on the list.', 'tokens.address': 'Token address', 'tokens.verify': 'Check', 'tokens.listed': 'Verified token: {issuer}', 'tokens.unlisted': 'This token is not on the list. Its name and symbol prove nothing.', 'tokens.badAddress': 'Invalid address.', 'bridge.sub': 'Move coins between Quinvium and other networks.', 'bridge.notReady': 'The bridge is not running on this network yet', 'bridge.notReadyBody': 'The contracts and validator software are ready and tested. The bridge opens once independent validators are running and an independent audit is done.', 'bridge.planned': 'Prepared routes, both directions', 'bridge.onAether': 'On Quinvium', 'bridge.needsValidators': 'Waiting for validators', 'bridge.howTitle': 'How the bridge works', 'bridge.how1': 'On the source network your coins are locked in a contract, for Bitcoin at a multisig address.', 'bridge.how2': 'Validators confirm the transfer once it is deep enough in the chain.', 'bridge.how3': 'On the destination network you receive a token backed 1:1. On the way back the token is burned and the original is released.', 'bridge.trust': 'The bridge is only as safe as its validators are independent. A transfer needs {threshold} of {count}. Large amounts wait 24 hours and a guardian can stop them.', 'bridge.out': 'From Quinvium', 'bridge.in': 'To Quinvium', 'bridge.asset': 'What and where', 'bridge.amount': 'Amount', 'bridge.recipient': 'Recipient', 'bridge.recipientBtc': 'Bitcoin address', 'bridge.send': 'Bridge', 'bridge.min': 'At least {min} {symbol}', 'bridge.sent': 'Transfer sent. Validators will confirm it and the coins will arrive on the destination network.', 'bridge.deposit': 'Your deposit address', 'bridge.depositHelp': 'This address belongs only to you. Send Bitcoin to it from any wallet or exchange. After {n} confirmations {symbol} is credited on Quinvium.', 'bridge.getAddress': 'Get deposit address', 'bridge.paused': 'The bridge is temporarily stopped.', 'bridge.history': 'My transfers', 'bridge.noHistory': 'No transfers yet.', 'bridge.waiting': 'Waiting for confirmation', 'bridge.done': 'Delivered', 'bridge.btcWaiting': 'Bitcoin payout', 'bridge.to': 'To', 'bridge.badBtc': 'This address does not belong to the Bitcoin {net} network.', 'bridge.noRoutes': 'No route is open on this network yet.',
      'nav.pools': 'Pools', 'pools.sub': 'A pool combines the power of many miners. Rewards go to a contract that splits them by proven work, so the operator cannot touch them.', 'pools.pending': 'Pools start on this network at block {block}, {blocks} blocks to go.', 'pools.none': 'There are no pools yet. Create the first one.', 'pools.name': 'Name', 'pools.fee': 'Fee', 'pools.window': 'Rewards split over', 'pools.paid': 'Paid to miners', 'pools.minutes': '{n} min', 'pools.create': 'Create a pool', 'pools.createSub': 'The fee and the split rules cannot be changed after creation. Miners can see that, so they do not have to trust you.', 'pools.fName': 'Pool name', 'pools.fUrl': 'Server address miners connect to (http://…)', 'pools.fFee': 'Fee in percent, at most 5', 'pools.fRound': 'Round length in blocks', 'pools.fWindow': 'How many recent rounds share a reward', 'pools.created': 'The pool is ready', 'pool.waiting': 'Waiting to be split', 'pool.reserved': 'Owed to miners, awaiting payout', 'pool.operator': 'Operator', 'pool.opFee': 'Fee to withdraw', 'pool.server': 'Pool server', 'pool.rounds': 'Recent rounds', 'pool.round': 'Round', 'pool.work': 'Work', 'pool.status': 'Status', 'pool.settled': 'Split', 'pool.open': 'Running', 'pool.connect': 'How to connect', 'pool.connectApp': 'In the Quinvium app open Mining, Mining settings and choose this pool.', 'pool.connectAsic': 'ASICs and other miners: use the Stratum address below, the user name is your address with a device name, any password works.', 'pool.stratum': 'Stratum', 'pool.login': 'User name', 'pool.yourAddress': '0xYOUR_ADDRESS.device', 'pool.mine': 'Miner status', 'pool.lookup': 'Miner address', 'pool.check': 'Show', 'pool.pendingAmount': 'Ready to withdraw', 'pool.share': 'Share of the window', 'pool.paidTo': 'Paid so far', 'pool.claim': 'Withdraw', 'pool.feeWithdraw': 'Withdraw fee', 'pool.setUrl': 'Save server address', 'pool.notPool': 'This address is not a pool from the network factory. Do not mine to it.', 'pool.safe': 'This pool was created by the network factory, so its split rules are verified and the operator cannot change them.', 'pool.noServer': 'The operator has not published a server address.',
      'time.now': 'just now', 'time.ago': '{t} ago', 'foot.peers': 'peers', 'bridge.refunding': 'Cancelled, returning', 'bridge.refunded': 'Returned to sender', 'x.prev': '← Previous', 'x.next': 'Next →', 'f.resultsMore': 'Results: more than {n}', 'miners.sub': 'Everyone who has ever mined a block, over the whole history of the network. A pool is one reward address.', 'miners.total': 'Miners in total', 'miners.active': 'Active in 24 h', 'miners.blocks': 'Mined blocks', 'miners.byBlocks': 'By blocks', 'miners.byLast': 'By latest activity', 'miners.find': 'Find a miner by address', 'miners.rank': 'Rank {rank} of {total}. Blocks: {blocks}, share {share}.', 'miners.notFound': 'This address has not mined a block yet.', 'miners.first': 'First block', 'mp.sub': 'Transactions waiting to be written into a block. Miners take the highest tips first.', 'mp.count': 'Waiting', 'mp.countSub': 'the queue holds {max}', 'mp.size': 'Queue size', 'mp.tip': 'Median tip', 'mp.tipRange': '{min} to {max} gwei', 'mp.oldest': 'Waiting longest', 'mp.byFee': 'By tip', 'mp.waiting': 'Waiting', 'mp.tipCol': 'Tip (gwei)', 'mp.state': 'Status', 'mp.ready': 'Next block', 'mp.gap': 'Missing nonce {n}', 'mp.low': 'Fee too low', 'tx.title': 'Transaction', 'tx.status': 'Status', 'tx.confirmations': '{n} confirmations', 'tx.time': 'Time', 'tx.tokens': 'Token transfers', 'tx.gasPrice': 'Gas price', 'tx.gasPriceParts': 'base {base} + tip {tip} gwei', 'tx.maxFee': 'Max fee', 'tx.maxParts': '{max} gwei, tip at most {tip} gwei', 'tx.gasUse': 'Gas used and limit', 'tx.position': 'Nonce and position', 'tx.positionValue': 'nonce {nonce}, transaction {index} in the block', 'tx.events': 'Events', 'tx.input': 'Input data', 'tx.format': 'Format', 'tx.created': 'Created contract', 'tx.unlimited': 'unlimited', 'tx.failedNote': 'The transaction failed, so nothing was transferred. The amount and any tokens stayed with the sender; only the fee for the gas used was paid.', 'tx.gap': 'This transaction waits for an earlier one from the same address with nonce {n}, which the network does not have. Until it arrives, this one cannot be mined. The wallet probably believes it was sent: in MetaMask, Settings → Advanced → Clear activity tab data and sending again fixes it.', 'tx.low': 'The max fee is below the network base fee. The transaction waits until the base fee drops, or speed it up in your wallet.', 'tx.noMiner': 'Nobody is mining right now. The transaction confirms with the next mined block.', 'tx.unknown': 'Unknown', 'charts.blockCount': 'Blocks', 'blk.minerReward': 'Miner reward', 'addr.more': 'More info', 'addr.lastSent': 'Latest transaction sent', 'addr.firstSent': 'First transaction sent', 'addr.fundedBy': 'Funded by', 'blk.gasUsed': 'Gas used', 'blk.gasLimit': 'Gas limit', 'blk.baseFee': 'Base fee', 'charts.active': 'Active addresses', 'charts.fees': 'Transaction fees', 'charts.avgFee': 'Average fee', 'charts.contracts': 'Contracts deployed', 'charts.failed': 'Failed transactions', 'charts.transfers': 'Token transfers', 'charts.util': 'Network utilization', 'home.chart': 'Transaction history in 14 days', 'home.final': 'finalized', 'home.gas': 'Gas price now', 'home.gasParts': 'base {base} + tip: slow {slow}, normal {normal}, fast {fast} gwei', 'home.latestBlocks': 'Latest blocks', 'home.latestTxs': 'Latest transactions', 'home.miner': 'Miner', 'home.rewardTitle': 'block reward plus all fees, nothing is burned', 'home.safe': 'Last safe block', 'home.tps': '{tps} TPS, {day} in 24 h', 'home.txs': 'Transactions', 'home.txsIn': '{n} txns in {s} secs', 'home.txsOnly': '{n} txns', 'm.avgFee24': 'Avg. transaction fee (24h)', 'm.blocks24': '{n} blocks in 24 h', 'm.fees24': 'Network transaction fees (24h)', 'm.finalNote': 'finalized {n}', 'm.pending1h': 'Pending transactions (last 1h)', 'm.pendingAll': '{n} in the queue', 'm.poolBlocks24': 'Blocks by pools (24h)', 'm.poolShare': '{p} of all blocks, the rest solo miners', 'm.rewards24': 'Miner rewards (24h)', 'm.rewardsNote': 'block rewards and fees, nothing is burned', 'm.safe': 'Last safe block', 'm.tps': '{tps} TPS', 'm.txs24': 'Transactions (24h)', 'm.util24': 'Network utilization (24h)', 't.method': 'Method', 'tx.openDetail': 'Transaction details →', 'tx.preview': 'Quick preview', 'tx.previewTitle': 'Transaction', 'pool.operatorNote': 'created the pool and receives a {fee} fee from every split', 'pool.payer': 'Share fees paid by', 'pool.payerNote': 'the pool server account, balance {value}. When it runs out, shares stop being recorded.', 'pool.money': 'Pool accounts', 'pool.rewards': 'Block rewards', 'pool.rewardBlocks': '{n} blocks mined', 'pool.feeTotal': 'Operator fee in total', 'pool.feeParts': '{owed} to withdraw, {withdrawn} withdrawn', 'pool.miners': 'Miners in the pool window', 'pool.minersSub': 'shares from the last {n} min', 'pool.miner': 'Miner', 'pool.sharesCol': 'Shares', 'pool.lastShare': 'Last share', 'pool.noMiners': 'Nobody has sent a share in the pool window yet.', 'pool.devices': 'Connected devices', 'pool.devicesSub': '{n} connected now', 'pool.device': 'Device', 'pool.hashrate': 'Hashrate', 'pool.seen': 'Last seen', 'pool.noDevices': 'No device is connected right now.', 'pool.minersNow': 'Miners in the window', 'addr.poolNote': 'This is the contract of the mining pool {name}. It receives block rewards straight from the network and pays miners inside the contract, so they are not in the transaction list or in the totals received and sent in transactions.', 'addr.poolNumbers': 'It mined {blocks} blocks for {income} and paid {paid} to miners.', 'addr.poolOpen': 'Pool overview →', 'addr.pools': 'Operates pools', 'addr.poolFeeOwed': 'Fee to withdraw', 'type.transfer': 'Transfer', 'type.tokenTransfer': 'Token transfer', 'type.approve': 'Token approval', 'type.mint': 'Token mint', 'type.swap': 'Swap', 'type.liqAdd': 'Add liquidity', 'type.liqRemove': 'Remove liquidity', 'type.bridgeOut': 'Bridge: send', 'type.bridgeIn': 'Bridge: delivery', 'type.bridgeCancel': 'Bridge: cancellation', 'type.bridgeSign': 'Bridge: validator signature', 'type.wrap': 'Wrap coin', 'type.unwrap': 'Unwrap coin', 'type.poolShare': 'Pool: miner share', 'type.poolPayout': 'Pool: payout', 'type.poolCreate': 'Pool created', 'type.name': '.qu name', 'type.notary': 'Notary record', 'type.escrow': 'Escrow', 'type.tokenCreate': 'Token created', 'type.create': 'Contract deployment', 'type.call': 'Contract call', 'dir.out': 'Sent', 'dir.in': 'Received', 'dir.self': 'To self', 'sum.transfer': '{amount} to {to}', 'sum.approve': '{who} may spend {amount}', 'sum.mint': '{amount} for {to}', 'sum.swap': '{from} → {to}', 'sum.swapMin': '{from} → at least {to}', 'sum.bridge': '{amount} to the {chain} network', 'addr.transfersTab': 'Token transfers', 'addr.noTransfers': 'This address has not sent or received any token yet.', 'addr.counterparty': 'Counterparty', 'tx.unknownNote': 'The node does not know this transaction. Either it has not arrived yet, or the queue dropped it, for example after six hours of waiting. Until it is in a block, nothing has been transferred: the coins and tokens stay in the sender’s account. The Quinvium wallet sends it again by itself; in MetaMask, speed it up or send it again.', 'tx.next': 'Waiting for the next block, usually within {n} s.', 'blk.final': 'Final', 'blk.confirmed': 'Confirmed', 'blk.solve': 'mined in {s} s', 'blk.totalDifficulty': 'Total difficulty', 'blk.extra': 'Extra data', 'blk.none': 'This block has no transactions.', 'blk.gasOf': '{used} of {limit} ({pct})', 'swap.impactWarn': 'The pool is small for this amount. You would receive {p} less than the current rate. About {max} {symbol} stays within a 5% loss.', 'swap.impactAck': 'I understand and want to swap anyway', 'wallet.addToken': 'Add {symbol} to wallet', 'wallet.tokenAdded': '{symbol} is in your wallet.', 'foot.about': 'Explorer for the Quinvium network: blocks, transactions, addresses, tokens and mining. Data comes straight from the node.', 'foot.tools': 'Tools', 'foot.status': 'Network status', 'foot.top': 'Back to top', 'foot.node': 'node {v}', 'tx.function': 'Function',
      'f.all': 'All', 'f.filter': 'Filters', 'f.range': 'Period', 'f.r1h': 'Last hour', 'f.r24h': '24 hours', 'f.r7d': '7 days', 'f.r30d': '30 days', 'f.rCustom': 'Custom', 'f.from': 'From', 'f.to': 'To', 'f.time': 'Time', 'f.miner': 'Miner', 'f.address': 'Address', 'f.content': 'Content', 'f.withTx': 'With transactions', 'f.emptyOnly': 'Empty', 'f.order': 'Sort', 'f.newest': 'Newest first', 'f.oldest': 'Oldest first', 'f.kind': 'Type', 'f.status': 'Status', 'f.direction': 'Direction', 'f.in': 'Incoming', 'f.out': 'Outgoing', 'f.minValue': 'At least ({coin})', 'f.apply': 'Apply', 'f.reset': 'Clear filters', 'f.results': 'Results: {n}', 'f.none': 'Nothing matches these filters.', 'f.badAddress': 'That is not a valid address.', 'f.fromBlock': 'From block', 'f.toBlock': 'To block', 'x.page': 'Page {n} of {of}', 'addr.poolTab': 'Pool payouts', 'addr.poolTotal': 'Total from pools', 'addr.first': 'First seen', 'addr.last': 'Last active', 'addr.received': 'Received in transactions', 'addr.sent': 'Sent in transactions', 'addr.fees': 'Fees paid', 'addr.mined': 'Blocks mined', 'addr.income': 'Mining income', 'addr.code': 'Code size', 'addr.tokens': 'Tokens', 'addr.noTokens': 'This address has not held any tokens yet.', 'addr.qr': 'Address QR code', 'addr.failed': 'Failed transactions', 'token.symbol': 'Symbol', 'charts.sub': 'Network history for the selected period. Hover over a chart to see exact values.', 'charts.txs': 'Transactions', 'charts.gas': 'Gas used', 'charts.slowest': 'Slowest block (s)', 'charts.empty': 'There are no blocks in this period.', 'charts.blocks': '{n} blocks, #{from} to #{to}', 'pools.advanced': 'Advanced settings', 'pools.nextTitle': 'What happens next', 'pools.next1': 'You confirm the creation in your wallet and the contract appears in a moment.', 'pools.next2': 'In the Quinvium app open Pools and start the pool server with the new contract address.', 'pools.next3': 'Send a small amount to the gas account, it pays for submitting shares and payouts.', 'wallet.copy': 'Copy address', 'wallet.copied': 'Address copied', 'wallet.view': 'View my address', 'wallet.disconnect': 'Disconnect', 'connect.title': 'Connect a wallet', 'connect.sub': 'Choose how you want to sign in. Your keys stay in your wallet, this page never sees them.', 'connect.browser': 'Browser wallet', 'connect.browserNote': 'In this browser', 'connect.found': 'Detected', 'connect.install': 'Install in your browser', 'connect.wcNote': 'Phone wallet with a QR code', 'connect.appHint': 'You can create or restore your own wallet in the Quinvium app.', 'connect.wcTitle': 'WalletConnect', 'connect.wcBody': 'Scan the code with your phone wallet.', 'connect.wcSetup': 'WalletConnect needs a Project ID from cloud.reown.com. It is free and not secret.', 'connect.wcSave': 'Save and continue', 'connect.wcMissing': 'The WalletConnect module could not be loaded.',
      'side.network': 'Network', 'nav.overview': 'Overview', 'nav.blocks': 'Blocks', 'nav.txs': 'Transactions', 'nav.apps': 'Apps',
      'nav.mempool': 'Pending', 'nav.richlist': 'Rich list', 'nav.network': 'Network', 'nav.charts': 'Charts', 'nav.miners': 'Miners',
      'nav.mining': 'Start mining', 'nav.api': 'Developers', 'search.ph': 'Block, transaction, address…', 'wallet.connect': 'Connect wallet',
      'wallet.close': 'Close', 'wallet.retry': 'Try again', 'wallet.cancelled': 'Wallet connection was closed.', 'wallet.switchBtn': 'Switch network', 'wallet.ready': 'Wallet connected to',
      'wallet.generic': 'Your wallet', 'wallet.genericOf': 'your wallet', 'wallet.waiting': 'Waiting for confirmation in your wallet…',
      'wallet.whereExt': 'No window? Click the {of} icon at the top right of your browser. If it is not there, look under the puzzle piece icon.', 'wallet.whereApp': 'The request is waiting in the main Quinvium app window.',
      'wallet.approveTitle': 'Confirm the connection', 'wallet.approveBody': 'In the {of} window, confirm that this page may see your address. This gives nobody your coins, every transaction is approved separately.',
      'wallet.stuckTitle': '{w} is waiting for you', 'wallet.stuck1': 'Click the {of} icon at the top right of your browser. If it is not there, look under the puzzle piece icon.', 'wallet.stuck2': 'Confirm the request waiting there.', 'wallet.stuck3': 'This page notices and continues on its own.',
      'wallet.netTitle': 'Add the {net} network', 'wallet.netBody': 'Your address is connected, but {w} is on another network, so it does not show your {coin}. Confirm adding and switching the network in the {of} window.', 'wallet.netChain': 'Chain ID', 'wallet.netRpc': 'Node', 'wallet.netCoin': 'Coin',
      'wallet.rejectedTitle': 'The request was rejected', 'wallet.rejectedBody': 'Nothing changed. You can try again or close this window.', 'wallet.failedTitle': 'That did not work',
      'wallet.noneBody': 'The easiest way is to open the Explorer from the Quinvium app with its Explorer button, the wallet is ready there. In a browser you can use MetaMask or the Quinvium Wallet extension, then reload this page.',
      'wallet.downTitle': 'The node is not running', 'err.down': 'The node at {rpc} does not respond. Check that the Quinvium app is open. This page recovers on its own once the node is back.', 'net.off': 'The {net} network is not running on this computer, you stay on the current one.',
      'wallet.none': 'No wallet in this browser', 'wallet.wrong': 'Switch your wallet to', 'wallet.add': 'Add network to wallet',
      'home.sub': 'Real-time state of the Quinvium network.', 'home.tip': 'Latest block', 'home.health': 'Network status', 'home.ok': 'Healthy', 'home.sync': 'Syncing',
      'm.height': 'Height', 'm.supply': 'Supply', 'm.fees': 'Fees to miners', 'm.reward': 'Block reward', 'm.hashrate': 'Hashrate', 'm.difficulty': 'Difficulty',
      'm.ofMax': 'of 64M', 'm.feesSub': 'on top of block rewards', 'f.age': 'Age', 'f.tx': 'Transactions', 'f.gas': 'Gas', 'f.size': 'Size',
      'watch.title': "Network watch", 'watch.sub': "This node asks its peers for their block and compares the website and the Explorer with GitHub.", 'watch.peers': "Peers with the same block", 'watch.differ': "Peers on another branch", 'watch.incidents': "Deep reorganisations in 24 h", 'watch.sites': "Website and Explorer", 'watch.siteOk': "Match GitHub", 'watch.siteChanged': "Changed: {n}", 'watch.siteWait': "Not checked yet", 'watch.siteOff': "Check off", 'watch.minority': "Most peers have a different block than this node. This node may be cut off from the network.", 'watch.explorerNodes': "The Explorer’s nodes disagree: {list} shows another branch; the Explorer does not use it.", 'nav.apiTop': "API", 'pools.noFee': "no fee", 'pools.noFeeHint': "A solo miner keeps the whole block and pays no fee.", 'sg.block': "Block", 'sg.tx': "Transaction", 'sg.address': "Address", 'sg.token': "Token", 'sg.pool': "Pool", 'sg.name': ".qu name", 'sg.contract': "contract", 'sg.pending': "pending", 'sg.none': "No matches. Press Enter for an exact search.", 'sg.filter': "Search filter", 'sg.f.all': "All filters", 'sg.f.addresses': "Addresses", 'sg.f.tokens': "Tokens", 'sg.f.blocks': "Blocks", 'sg.f.txs': "Txns", 'sg.f.pools': "Pools", 'sg.f.names': ".qu names", 'sig.title': 'Fork signalling', 'sig.sub': 'Miners can write QIP-n into a block to show support for a proposal. It is informative only and activates nothing. Last {n} blocks.', 'sig.none': 'No block in this period signals a proposal.', 'sig.proposal': 'Proposal', 'sig.miners': 'Miners', 'sig.how': 'How to signal and how the network changes', 'nh.peers': 'Connected peers', 'nh.time': 'Average block time', 'nh.accounts': 'Accounts', 'nh.mempool': 'Pending', 'nh.basefee': 'Base fee', 'nh.tips': 'Tip slow · normal · fast', 'nh.halving': 'Next halving',
      'sec.viewAll': 'View all →', 't.block': 'Block', 't.hash': 'Hash', 't.miner': 'Miner', 't.tx': 'Tx', 't.age': 'Age', 't.gas': 'Gas', 't.from': 'From', 't.to': 'To', 't.value': 'Value',
      't.status': 'Status', 't.balance': 'Balance', 't.share': 'Share', 't.address': 'Address', 't.blocks': 'Blocks', 't.last': 'Last block', 't.fee': 'Fee', 't.type': 'Type',
      'x.noBlocks': 'No blocks', 'x.noTxs': 'No transactions yet', 'x.empty': 'No pending transactions', 'x.newer': '← Newer', 'x.older': 'Older →',
      'b.ok': 'success', 'b.fail': 'failed', 'b.pending': 'pending', 'tx.create': 'Contract creation', 'tx.call': 'Contract call', 'tx.transfer': 'Transfer',
      'err.node': 'Node unreachable', 'addr.contract': 'Contract', 'addr.account': 'Account', 'addr.system': 'System contract', 'addr.name': 'Name', 'addr.nonce': 'Transaction count',
      'mine.sub': 'The miner gets a 4 QU block reward plus all transaction fees in the block.', 'b.reward': 'Block reward', 'b.baseFees': 'Base fees', 'b.tips': 'Tips', 'b.total': 'Miner total', 'mine.own': 'Quinvium Miner (Windows, macOS, Linux)',
      'mine.other': 'Common Windows miners via Stratum', 'mine.note': 'Mine on any node. No account needed, just your wallet address.',
      'mine.yourAddr': 'YOUR_ADDRESS', 'apps.sub': 'Ready-made Quinvium contracts for many industries. Reading is free, writing is signed by your wallet.',
      'tool.read': 'Verify', 'tool.write': 'Write to chain', 'tool.file': 'Or choose a file (stays on your computer)', 'tool.sent': 'Transaction sent', 'tool.done': 'Confirmed in block', 'tool.missing': 'Fill in', 'tool.failed': 'The transaction failed in the block', 'tool.nameStep1': 'Step 1 of 2: sign the commitment', 'tool.nameStep2': 'Waiting for the protection period, left', 'tool.nameStep3': 'Step 2 of 2: sign the registration', 'tool.namePrimary': 'Last step: sign so the name is shown instead of your address', 'tool.nameResume': 'Continuing an unfinished registration; the commitment is already on chain.', 'tool.namePending': 'The registration of {name} is not finished: step 1 is on chain, step 2 is missing. Click Finish registration and sign it (the commitment is valid for 24 hours after it was sent).', 'tool.nameFinished': 'The name is now shown instead of your address.', 'prof.currency': 'Currency', 'prof.symbol': 'Quinvium symbol', 'prof.avatar': 'Profile picture (NFT)', 'prof.deploy1': '1. Deploy Quinvium Avatars', 'prof.deploy2': '2. Deploy Profiles', 'prof.mintHint': 'Choose an icon and a colour, mint your own Quinvium Avatar NFT for the network fee only and set it as your profile picture. It shows only while the NFT belongs to your address.', 'prof.mint': 'Mint avatar (step 1 of 2)', 'prof.use': 'Set as profile picture', 'prof.minted': 'The avatar is minted. Now set it as your profile picture (step 2 of 2).', 'prof.removed': 'The profile picture is removed.', 'prof.other': 'Use another NFT you own', 'prof.nft': 'NFT contract address', 'prof.tokenId': 'Token number', 'prof.otherNote': 'A foreign NFT picture shows only when it is stored on chain. The Explorer loads no images from foreign servers, so nobody can track who views the page.', 'prof.badNft': 'Enter the contract address and the token number.', 'prof.tag': 'Identity · Wallets', 'prof.title': 'Profile', 'prof.desc': 'The profile picture next to your address and .qu name, and how the currency is shown.', 'prof.none': 'The Quinvium Avatars and Profiles contracts are not on this network yet. Anyone can deploy them with two transactions: they have no owner and no fees.', 'prof.badCode': 'The code at the configured addresses does not match the published contracts, so profile pictures are not used.', 'prof.source': 'The code is exactly packages/contracts/dist/artifacts.json from the GitHub repository. You can compare the SHA-256 hashes before signing.', 'prof.address': 'Contract address', 'prof.deployed': 'The contract is deployed. The addresses of both contracts go into the Explorer with the next update; then everyone can set a profile picture.', 'prof.icon': 'Icon', 'prof.color': 'Colour', 'prof.clear': 'Remove icon', 'prof.saved': 'The profile picture is set.', 'coin.text': 'Show the currency as QU', 'coin.symbol': 'Show the currency as the Quinvium symbol', 'tool.nameReady': 'Step 1 is on chain and the protection period is over. Click Finish registration and confirm step 2 in your wallet.', 'tool.nameFinish': 'Finish registration (step 2 of 3)', 'addr.names': '.qu names', 'addr.namesHint': 'The name is not primary yet, so it is not shown instead of the address.', 'addr.setPrimary': 'Set as primary name', 'net.title': 'Network', 'net.rpcLan': 'RPC on the home network', 'net.rpcPublic': 'RPC from the internet', 'net.rpcPublicFwd': 'RPC from the internet (after forwarding)', 'net.rpcOnlyHere': 'The node accepts only this computer. Turn on sharing in the Quinvium app under Node, Connect to another computer.', 'net.rpcHint': 'In a phone wallet, enter the home network RPC, or the internet RPC when the phone is on mobile data.', 'charts.time': 'Block time (s)', 'charts.diff': 'Difficulty', 'charts.rate': 'Estimated hashrate (H/s)',
      'rich.sub': 'Addresses by balance', 'mem.sub': 'Transactions waiting to be mined', 'miners.sub': 'From the last 1000 blocks', 'search.none': 'Nothing found for',
      'swap.allTrades': 'All swaps →', 'swap.mine': 'My liquidity', 'swap.searchPair': 'Search pair', 'swap.linked': 'The amounts are linked by the pool rate', 'swap.linkedRate': 'Linked by the pool rate: 1 {a} = {rate} {b}', 'swap.newPoolRate': 'New pool: the ratio of the amounts sets the starting rate', 'swap.addMore': 'Add more', 'swap.withdrawPart': 'Withdraw', 'swap.youGet': 'You get back about {a} and {b}.', 'swap.everything': 'all', 'swap.pickPart': 'Choose how much to withdraw.', 'swap.showMore': 'Show {n} more ({total} in total)', 'swap.noMatch': 'No pair matches the search.', 'bridge.step1': 'Lock', 'bridge.step2': 'Confirm', 'bridge.step3': 'Receive', 'bridge.how2n': 'Independent validators wait until the transfer is deep enough in the chain and sign it. {threshold} of {count} signatures are needed.',
      'pools.online': 'Server published', 'pools.noServerShort': 'No server', 'pool.asic': 'ASIC and others', 'pool.viaApp': 'In the Quinvium app open Mining → Where you mine, find this pool in the list and choose it. Mining then runs for your wallet.', 'pool.asicUrl': 'Pool URL', 'pool.asicWorker': 'Worker', 'pool.password': 'Password', 'pool.loginNote': 'your payout wallet address, then a dot and a device name', 'pool.passwordNote': 'anything, the pool ignores it', 'pool.algo': 'Algorithm', 'pool.algoNote': 'standard Ethash over EthereumStratum/1.0.0 or ETHPROXY', 'pool.payout': 'Payouts', 'pool.payoutNote': 'automatic from the contract, PPLNS over the last {n} min, operator fee {fee}', 'pool.software': 'Software', 'pool.connectNote': 'Mining goes through the server the operator published. The contract holds the rewards: the operator only takes the fee, and every miner can also withdraw on their own with the Withdraw button.', 'pool.share24': 'Block share in 24 h', 'pool.blocks24': '{n} blocks in 24 h', 'pool.findMiner': 'Find a miner by address', 'pool.minersTotal': '{n} miners in total', 'pool.minerNotFound': 'This address sent no share in the pool window.', 'pool.allMiners': '← All miners', 'pool.createdTitle': 'Your pool is created. What next:', 'pools.otherPools': 'Other pools', 'pools.otherCount': '{n} more pools', 'pools.all': 'All pools ({n})', 'pools.find': 'Search pools by name or address', 'pools.minersCol': 'Miners', 'pools.createdCol': 'Created', 'pools.noMatch': 'No pool matches “{q}”.',
      'pool.windowSub': 'split over the last {n} min',
      'pool.asicNote': 'The machine needs Ethash firmware, not Etchash. Nobody has tried a real ASIC on this network yet, so check it before buying one for Quinvium.',
      'pool.after1': 'In the Quinvium app open Mining → Where you mine → Run a pool, paste this pool’s address and save. The node restarts with the pool server.', 'pool.after2': 'Under Network turn on Share the Explorer and mining with other computers on this network, so miners can reach Stratum.', 'pool.after3': 'Send a small amount to the gas account the server shows for the pool. It pays for submitting shares and payouts.', 'pool.after4': 'Below under Operator, save the server address, for example http://192.168.1.50:8546. Miners connect with it.',
      'tx.reason': 'Reason', 'tx.tipSlippage': 'This usually happens when another swap in the same pool comes just before it, for example the same swap sent twice in a row. Swap now lets the next swap go only after the previous one is confirmed.', 'tx.tipAllowance': 'Swap sends the approval itself and waits for it to be confirmed. Here the approval was missing, or an earlier transaction used it up.', 'tx.tipBalance': 'Another transaction from the same account may have used up the tokens in the meantime.', 'tx.tipExpired': 'The transaction waited longer than its deadline allowed. Just send it again.', 'tx.outOfGas': 'The transaction ran out of gas and used its whole limit of {limit}.', 'tx.tipGas': 'Let the wallet estimate the gas when sending, or raise the limit.', 'tx.panic': 'The contract stopped with internal error {code}.', 'tx.revertUnknown': 'The contract rejected the transaction with an error the Explorer does not know.', 'tx.revertEmpty': 'The contract rejected the transaction without giving a reason.', 'swap.waitPrevious': 'A previous transaction from this account is still waiting. Wait until it is confirmed: the rate and the balance change after it, and the next one could fail.', 'pool.placeholderNote': 'Replace {ph} with the wallet address that should receive the payouts.', 'bridge.tTime': 'Transfer time', 'bridge.vTime': 'A few minutes', 'bridge.nTime': 'About an hour with Bitcoin', 'bridge.tFee': 'Bridge fee', 'bridge.vFee': 'None, rate 1 : 1', 'bridge.nFee': 'You only pay the network fee', 'bridge.tBig': 'Large transfers', 'bridge.vBig': 'Wait 24 hours', 'bridge.nBig': 'A guardian can stop them', 'bridge.tFail': 'If a transfer fails', 'bridge.vFail': 'It goes back to the sender', 'bridge.nFail': 'My transfers shows when', 'bridge.fee': 'Fee', 'bridge.feeNone': 'none, only the network fee', 'bridge.feeBtc': 'the Bitcoin network fee is taken from the amount',
      'home.gasCalm': 'the lowest possible, blocks are {p} % full, the price rises only with full blocks', 'home.gasBusy': 'the network is busy, the price rises with every full block',
      'swap.goHigh': 'Swap · high price impact',
      'swap.limitBy': 'Your {symbol} balance limits the deposit. The pool takes both tokens at its rate, and more {other} would need more {symbol} than is available.', 'swap.coinLeft': 'After the deposit, {left} {coin} stays for network fees.',
      'tool.optional': 'optional',
    },
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private window */ } },
  };
  // German, Spanish and French are in i18n.js, Japanese, Chinese and Arabic in i18n-more.js. The Quinvium app also sets the language code.
  const LANGUAGES = { en: 'English', cs: 'Čeština', de: 'Deutsch', es: 'Español', fr: 'Français', ja: '日本語', zh: '中文', ar: 'العربية' };
  const LOCALES = { en: 'en-US', cs: 'cs-CZ', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP', zh: 'zh-CN', ar: 'ar-u-nu-latn' };
  const RTL = new Set(['ar']);
  const EXTRA_SETS = [
    [['de', 'es', 'fr'], window.AetherExplorerText],
    [['ja', 'zh', 'ar'], window.AetherExplorerText2],
  ];
  /** Language code -> [set, index in its rows]. */
  const FOREIGN = {};
  for (const [codes, set] of EXTRA_SETS) {
    const data = set ?? { keys: {}, texts: {} };
    codes.forEach((code, i) => {
      FOREIGN[code] = [data, i];
      I18N[code] = Object.fromEntries(Object.entries(data.keys).map(([k, v]) => [k, v[i]]));
    });
  }
  // The Quinvium app controls the language and theme itself and passes them in the page address.
  const params = new URLSearchParams(location.search);
  const embedded = !!window.aether?.isDesktop || params.has('embedded');
  if (params.get('lang')) store.set('aether.lang', params.get('lang'));
  if (params.get('theme')) store.set('aether.theme', params.get('theme'));
  const saved = store.get('aether.lang');
  let lang = LANGUAGES[saved] ? saved : 'en';
  const locale = () => LOCALES[lang];
  const t = (k) => I18N[lang]?.[k] ?? I18N.en[k] ?? I18N.cs[k] ?? k;
  /** Tool and error texts are Czech and English pairs; other languages fall back to English. */
  const pick = (o) => {
    const f = FOREIGN[lang];
    return (f ? f[0].texts[o.en]?.[f[1]] : o[lang]) ?? o.en ?? o.cs;
  };
  const fill = (k, vars) => t(k).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  let fitNav = () => {};
  const applyLang = () => {
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
    document.querySelectorAll('[data-t-title]').forEach((el) => { el.title = t(el.dataset.tTitle); el.setAttribute('aria-label', el.title); });
    $('lang-label').textContent = lang.toUpperCase();
    document.querySelectorAll('#lang-pop button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === lang)));
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    fitNav();
    renderWallet();
  };

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (h, n = 8) => { h = String(h ?? ''); return h.length > n + 6 ? `${h.slice(0, n)}…${h.slice(-4)}` : h; };
  const num = (n) => Number(n ?? 0).toLocaleString(locale());
  const big = (v) => BigInt(v ?? 0);
  function aet(wei, digits = 6) {
    const v = big(wei);
    const whole = v / 10n ** 18n;
    const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
    const point = (1.5).toLocaleString(locale())[1];
    return `${whole.toLocaleString(locale())}${frac ? `${point}${frac}` : ''}`;
  }
  function gwei(wei) { return (Number(big(wei)) / 1e9).toLocaleString(locale(), { maximumFractionDigits: 3 }); }
  function rate(h) {
    let v = Number(big(h));
    for (const u of ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s']) { if (v < 1000) return `${v.toFixed(v < 10 ? 2 : 1)} ${u}`; v /= 1000; }
    return `${v.toFixed(1)} PH/s`;
  }
  function compact(h) {
    const v = Number(big(h));
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)} T`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} G`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
    return num(v);
  }
  function ago(sec) {
    const s = Math.floor(Date.now() / 1000 - Number(sec));
    if (s < 5) return t('time.now');
    const span = s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`;
    return fill('time.ago', { t: span });
  }
  const when = (sec) => new Date(Number(sec) * 1000).toLocaleString(locale());
  /** A coloured square derived from the address: the same address always looks the same. */
  /**
   * The picture an address chose in the Profiles contract (an NFT it owns now) replaces the generated square; fillNames fills it in.
   * Quinvium Avatars are drawn from their two numbers; another NFT only when its picture is stored on chain (a data: image),
   * because loading a picture from a foreign server would tell that server who looks at the page.
   */
  const profileCache = new Map();   // address -> { html } or null
  const profileSvg = (a) => profileCache.get(String(a).toLowerCase())?.html ?? null;
  const avatar = (a, cls = '') => {
    const icon = profileSvg(a);
    if (icon) return `<i class="avatar profile ${cls}" data-addr="${esc(String(a).toLowerCase())}">${icon}</i>`;
    const h1 = parseInt(String(a).slice(2, 8), 16) % 360;
    const h2 = parseInt(String(a).slice(-6), 16) % 360;
    return `<i class="avatar ${cls}" data-addr="${esc(String(a).toLowerCase())}" style="background:linear-gradient(135deg, hsl(${h1} 55% 52%) 50%, hsl(${h2} 55% 40%) 50%)"></i>`;
  };
  const BLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 8 4.500v9L12 21l-8-4.500v-9L12 3Zm0 9 8-4.500M12 12v9m0-9L4 7.500"/></svg>';
  const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const TX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>';
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.800-3.800"/></svg>';
  const CHEVRON = '<svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m2 3.500 3 3 3-3"/></svg>';
  const copyBtn = (v) => `<button class="copy-btn" data-copy="${esc(v)}" title="Copy">⧉</button>`;
  const addrLink = (a) => (a ? `<a class="hash" href="/address/${esc(a)}">${esc(labelOf(a) ?? short(a, 8))}</a>` : '—');
  const txLink = (h) => `<a class="hash" href="/tx/${esc(h)}">${esc(short(h, 10))}</a>`;
  const blockLink = (n) => `<a href="/block/${esc(n)}">#${num(n)}</a>`;
  const head = (title, sub = '', right = '') => `<div class="page-head"><div style="min-width:0"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right ? `<div class="page-head-right">${right}</div>` : ''}</div>`;
  const metric = (label, value, sub = '') => `<div class="metric-card"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  let pageFailed = false;
  /** The error page recovers by itself when the node is back, see refreshStats. */
  const errorBox = (m) => {
    pageFailed = true;
    const down = /failed to fetch|networkerror|load failed/i.test(m);
    return `<div class="error-box">${down ? fill('err.down', { rpc: esc(rpcBase) }) : `${t('err.node')}: ${esc(m)}`}</div>`;
  };
  const skeleton = () => `<div class="card">${'<div class="skel skel-row"></div>'.repeat(8)}</div>`;

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.copy-btn');
    if (b) {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓'; setTimeout(() => { b.textContent = '⧉'; }, 1200); } catch { /* blokováno */ }
    }
    const row = e.target.closest('[data-href]');
    if (row && !e.target.closest('a,button')) navigate(row.dataset.href);
  });

  // ------------------------------------------------------------- connection to the node
  const PORTS = { mainnet: 8545, testnet: 8546 };
  // An Explorer on a domain can have several nodes in config.js (rpc: [...]). It picks the one that answers and is not behind,
  // and switches to the next one on failure. The page keeps working as long as at least one of them runs.
  const NODES = [...new Set((window.AETHER_CONFIG?.rpc ?? []).map((u) => String(u).trim().replace(/\/+$/, '')).filter(Boolean))];
  const MAX_BEHIND = 3;
  const NODE_PROBE_MS = 4000;
  const savedRpc = store.get('aether.rpc');
  let rpcBase = NODES.length ? (NODES.includes(savedRpc) ? savedRpc : NODES[0]) : savedRpc || location.origin;
  let stats = null;
  let contracts = {};
  let reqId = 1;
  let picking = null;

  const SETTLED = 6;
  /** What the Explorer saw when it compared its nodes: which of them show another branch than the majority. */
  let nodeCheck = { checked: 0, height: null, outliers: [] };
  const post = (url, method, params = []) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(NODE_PROBE_MS) })
    .then((r) => r.json()).then((d) => d.result);

  /**
   * Takes the node with the highest block from the list. The current one stays while it answers and is not behind.
   * Nodes are also compared with each other: each one is asked for its block a few blocks below the lowest head.
   * A node whose block differs from the majority follows another branch (or lies); the Explorer does not use it and says so.
   */
  function pickNode() {
    if (NODES.length < 2) return Promise.resolve(false);
    picking ??= (async () => {
      const heights = await Promise.all(NODES.map((url) => post(url, 'eth_blockNumber').then((h) => Number(BigInt(h))).catch(() => -1)));
      const alive = heights.filter((h) => h >= 0);
      const settled = alive.length ? Math.min(...alive) - SETTLED : -1;
      let outliers = [];
      if (alive.length >= 2 && settled >= 1) {
        const hashes = await Promise.all(NODES.map((url, i) => (heights[i] < 0 ? null : post(url, 'eth_getBlockByNumber', [`0x${settled.toString(16)}`, false]).then((b) => b?.hash ?? null).catch(() => null))));
        const votes = new Map();
        for (const h of hashes) if (h) votes.set(h, (votes.get(h) ?? 0) + 1);
        const [top, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
        // Only a real majority decides. Two nodes against each other: both stay, the page warns.
        const majority = count * 2 > [...votes.values()].reduce((x, y) => x + y, 0) ? top : null;
        outliers = NODES.filter((_, i) => hashes[i] && (majority ? hashes[i] !== majority : votes.size > 1));
        nodeCheck = { checked: votes.size ? [...votes.values()].reduce((x, y) => x + y, 0) : 0, height: settled, outliers, majority: !!majority };
        if (outliers.length && !nodeCheck.warned) { nodeCheck.warned = true; toast(esc(fill('watch.explorerNodes', { list: outliers.map((u) => new URL(u).host).join(', ') }))); }
      }
      const usable = (i) => heights[i] >= 0 && !(nodeCheck.majority && outliers.includes(NODES[i]));
      const best = Math.max(-1, ...heights.filter((_, i) => usable(i)));
      const index = NODES.indexOf(rpcBase);
      const here = index >= 0 && usable(index) ? heights[index] : -1;
      if (best < 0 || (here >= 0 && best - here <= MAX_BEHIND)) return false;
      rpcBase = NODES[heights.findIndex((h, i) => h === best && usable(i))];
      store.set('aether.rpc', rpcBase);
      live();
      return true;
    })().finally(() => { picking = null; });
    return picking;
  }

  async function rpc(method, params = []) {
    const call = () => fetch(rpcBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }) });
    let res;
    try {
      res = await call();
      // An overloaded or broken node: another one from the list is tried, if there is one.
      if ((res.status >= 500 || res.status === 429) && await pickNode()) res = await call();
    } catch (e) {
      if (!(await pickNode())) throw e;
      res = await call();
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }
  const provider = () => new ethers.JsonRpcProvider(rpcBase, undefined, { staticNetwork: true });
  // Ticker by network: QU on mainnet, tQU on testnet, so a test coin is not confused with a real one.
  /** The currency for display: QU (tQU, dQU), or with the Quinvium symbol (U+E000 from quinvium-symbol.ttf) when chosen in the footer. */
  const nameCache = new Map();   // address -> primary .qu name ('' none), for lists and the header
  let coinStyle = store.get('quinvium.coin') === 'symbol' ? 'symbol' : 'text';
  const coin = () => { const c = stats?.currency ?? 'QU'; return coinStyle === 'symbol' ? c.replace(/QU$/, '\uE000') : c; };
  // Contract names are stored in genesis. The user sees the network's name, not the internal name.
  const CONTRACT_LABELS = { WAET: 'Wrapped QU', AetherNames: 'Quinvium Names' };
  // Contracts deployed after the network started (Swap, bridge, token list) have their address in deployments.json, not in genesis.
  const extraLabels = new Map();
  /**
   * The network's wrapped coin still has the old name and symbol in genesis. It is shown under the network's name: Wrapped QU (WQU),
   * on testnet Wrapped tQU (WtQU). Other tokens have a name and symbol exactly as in their contract.
   */
  const tokenFace = (address, name, symbol) => (contracts.WAET && String(address).toLowerCase() === contracts.WAET.address.toLowerCase()
    ? { name: `Wrapped ${coin()}`, symbol: `W${coin()}` } : { name, symbol });
  const labelOf = (a) => {
    const lower = String(a).toLowerCase();
    for (const [name, c] of Object.entries(contracts)) if (c.address?.toLowerCase() === lower) return CONTRACT_LABELS[name] ?? name;
    return extraLabels.get(lower) ?? null;
  };

  let nodeDown = false;
  let pageTick = null;      // a page puts here what should refresh on a new block
  async function refreshStats() {
    try {
      stats = await rpc('aether_stats');
      nodeDown = false;
      $('brand-net').textContent = stats.network;
      $('footer-net').textContent = stats.network;
      $('footer-status').innerHTML = `<b>#${num(stats.height)}</b> · ${num(stats.peers)} ${t('foot.peers')} · ${num(stats.mempool)} tx`;
      $('footer-chain').textContent = `Chain ID ${stats.chainId}`;
      $('footer-ver').textContent = fill('foot.node', { v: String(stats.version ?? '').split('/').pop() });
      $('node-dot').style.background = '';
      pageMeta();
      for (const id of ['net-label', 'hnet-label']) $(id).textContent = stats.network === 'mainnet' ? 'Mainnet' : stats.network === 'testnet' ? 'Testnet' : stats.network;
      for (const id of ['net-dot', 'hnet-dot']) $(id).classList.toggle('testnet', stats.network !== 'mainnet');
      $('hnet-btn').title = $('hnet-label').textContent;
      document.querySelectorAll('.net-pop [data-net]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.net === stats.network)));
      renderWallet();
      if (pageFailed) { pageFailed = false; render(); }
    } catch (e) {
      nodeDown = true;
      $('footer-status').textContent = t('err.node');
      $('node-dot').style.background = 'var(--danger)';
    }
    return stats;
  }

  let ws = null;
  function live() {
    try { ws?.close(); } catch { /* closed */ }
    ws = new WebSocket(rpcBase.replace(/^http/, 'ws'));
    const mine = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
      if (pageFailed) refreshStats();
    };
    ws.onclose = () => { if (mine === ws) setTimeout(live, 4000); };
    ws.onerror = () => ws.close();
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method !== 'eth_subscription') return;
      await refreshStats();
      if (route().name === 'home') pageHome(true);
      // The refresh belongs to a page that may already be gone. Its error has nothing to show.
      try { await pageTick?.(); fillNames().catch(() => {}); } catch { /* the page has left in the meantime */ }
    };
  }

  function toast(html, href) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    el.addEventListener('click', () => { if (href) navigate(href); el.remove(); });
    box.appendChild(el);
    setTimeout(() => el.remove(), 4500);
    while (box.children.length > 3) box.firstChild.remove();
  }

  // ------------------------------------------------------------- wallet
  let account = null;
  let walletChain = null;
  // Browser wallets announce themselves (EIP-6963), older ones only through window.ethereum. Mobile ones connect through WalletConnect.
  let chosen = null;
  const announced = new Map();
  window.addEventListener('eip6963:announceProvider', (e) => { announced.set(e.detail.info.uuid, e.detail); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  function detectedWallets() {
    const list = [...announced.values()].map((d) => ({ id: d.info.rdns || d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider }));
    if (window.aether && !list.some((x) => x.provider === window.aether)) list.unshift({ id: 'aether', name: 'Quinvium Wallet', provider: window.aether });
    if (window.ethereum && !list.some((x) => x.provider === window.ethereum)) list.push({ id: 'injected', name: window.ethereum.isMetaMask ? 'MetaMask' : t('connect.browser'), provider: window.ethereum });
    return list;
  }

  function useWallet(entry) {
    chosen = entry;
    store.set('aether.wallet', entry.id);
    entry.provider.on?.('accountsChanged', (a) => { account = a[0] ?? null; renderWallet(); });
    entry.provider.on?.('chainChanged', (c) => { walletChain = c; renderWallet(); });
  }

  /** A previously chosen wallet connects without asking after the page loads. */
  function restoreWallet() {
    if (chosen) return;
    if (embedded && window.aether) { useWallet({ id: 'aether', name: 'Quinvium Wallet', provider: window.aether }); return; }
    const entry = detectedWallets().find((x) => x.id === store.get('aether.wallet'));
    if (entry) useWallet(entry);
  }

  const wallet = () => chosen?.provider ?? null;
  const walletNames = () => {
    const name = chosen?.name ?? null;
    return { w: name ?? t('wallet.generic'), of: name ?? t('wallet.genericOf') };
  };
  const chainHex = () => `0x${stats.chainId.toString(16)}`;
  const networkLabel = () => (stats.network === 'mainnet' ? 'Quinvium' : `Quinvium ${stats.network[0].toUpperCase()}${stats.network.slice(1)}`);
  const wrongNetwork = () => !!(account && walletChain && stats && BigInt(walletChain) !== BigInt(stats.chainId));

  function renderWallet() {
    const b = $('login-btn');
    const wrong = wrongNetwork();
    const shown = !!account && !wrong;
    const own = account ? nameCache.get(account.toLowerCase()) : '';
    if (account && !wrong && own === undefined) lookupOwnName(account);
    if (!account) b.textContent = t('wallet.connect');
    else if (wrong) b.textContent = t('wallet.switchBtn');
    else b.innerHTML = `${avatar(account)}<span>${esc(own ? `${own}.qu` : short(account, 6))}</span>${CHEVRON}`;
    b.classList.toggle('connected', shown);
    b.classList.toggle('wrong-network', wrong);
    const pop = $('account-pop');
    pop.classList.remove('open');
    pop.innerHTML = shown ? `<div class="pop-head">${avatar(account, 'large')}<div>${own ? `<strong class="pop-name">${esc(own)}.qu</strong>` : ''}<strong>${esc(short(account, 8))}</strong><small>${esc(walletNames().w)}</small></div></div>
      <button id="account-copy">${t('wallet.copy')}</button><a href="/address/${esc(account)}">${t('wallet.view')}</a>${embedded ? '' : `<button id="account-off">${t('wallet.disconnect')}</button>`}` : '';
    if (!shown) return;
    $('account-copy').onclick = async () => { await navigator.clipboard.writeText(account); toast(t('wallet.copied')); };
    if ($('account-off')) $('account-off').onclick = disconnect;
  }

  /** The primary .qu name of the connected account for the header; the button is redrawn once it is known. */
  async function lookupOwnName(a) {
    const key = a.toLowerCase();
    nameCache.set(key, '');
    try {
      const n = await new ethers.Contract(contracts.AetherNames.address, contracts.AetherNames.abi, provider()).nameOf(a);
      nameCache.set(key, n);
      if (n && account?.toLowerCase() === key) renderWallet();
      fillNames(document.querySelector('header')).catch(() => {});
    } catch { nameCache.delete(key); }
  }

  /** The page forgets the connection. A wallet that supports it also revokes its permission. */
  async function disconnect() {
    await wallet()?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
    await wallet()?.disconnect?.().catch(() => {});
    store.set('aether.wallet', 'off');
    chosen = null;
    account = null;
    renderWallet();
    if (route().name === 'address') render();
  }

  // The wallet's first detection after load. Pages that show their own address (pool connection guide) briefly wait for it.
  let walletReady = Promise.resolve();
  const walletKnown = () => Promise.race([walletReady, new Promise((r) => { setTimeout(r, 1500); })]);
  /** Finds out the wallet state without any window. */
  async function syncWallet() {
    restoreWallet();
    const w = wallet();
    if (!w) return;
    try {
      const [list, chain] = await Promise.all([w.request({ method: 'eth_accounts' }), w.request({ method: 'eth_chainId' })]);
      account = list?.[0] ?? null;
      walletChain = chain;
      renderWallet();
    } catch { /* the wallet is not answering now; the state stays */ }
  }

  async function addNetwork() {
    const w = wallet();
    if (!w) { toast(t('wallet.none')); return; }
    const chain = {
      chainId: chainHex(), chainName: networkLabel(), rpcUrls: [rpcBase.replace(/\/$/, '')],
      nativeCurrency: { name: 'Quinvium', symbol: stats.currency, decimals: 18 },
    };
    try {
      await w.request({ method: 'wallet_addEthereumChain', params: [{ ...chain, blockExplorerUrls: [location.origin] }] });
    } catch (e) {
      // The wallet may refuse a link to the local Explorer; it must not be left without a network because of that.
      if (e.code !== -32602) throw e;
      await w.request({ method: 'wallet_addEthereumChain', params: [chain] });
    }
  }

  async function switchNetwork() {
    try {
      await wallet().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex() }] });
    } catch (e) {
      // A rejection or an already pending request does not mean the wallet does not know the network.
      if (e.code === 4001 || e.code === -32002) throw e;
      await addNetwork();
    }
  }

  // Connecting is a guide. The window stays open and says what to do until it succeeds or the user closes it.
  const WALLET_POLL_MS = 1500;
  let walletFlow = null;

  function walletClose() {
    clearInterval(walletFlow?.timer);
    walletFlow = null;
    $('wallet-dialog')?.remove();
  }

  function walletCancel() {
    const flow = walletFlow;
    if (!flow) return;
    walletClose();
    flow.reject(Object.assign(new Error(t('wallet.cancelled')), { code: 4001 }));
  }

  function walletShow(kind, detail = '') {
    const v = { ...walletNames(), net: stats ? esc(networkLabel()) : '', coin: esc(coin()) };
    const where = `<p class="wallet-hint">${window.aether?.isDesktop ? t('wallet.whereApp') : fill('wallet.whereExt', v)}</p>`;
    const waiting = `<div class="wallet-wait"><span></span>${t('wallet.waiting')}</div>`;
    const list = (keys) => `<ol class="wallet-steps">${keys.map((k) => `<li>${fill(k, v)}</li>`).join('')}</ol>`;
    const [title, body, retry] = {
      approve: () => [t('wallet.approveTitle'), `<p>${fill('wallet.approveBody', v)}</p>${waiting}${where}`],
      stuck: () => [fill('wallet.stuckTitle', v), `${list(['wallet.stuck1', 'wallet.stuck2', 'wallet.stuck3'])}${waiting}`, true],
      network: () => [fill('wallet.netTitle', v), `<p>${fill('wallet.netBody', v)}</p>${kv([[t('wallet.netChain'), num(stats.chainId)], [t('wallet.netRpc'), `<span class="hash">${esc(rpcBase)}</span>`], [t('wallet.netCoin'), esc(coin())]])}${waiting}${where}`],
      rejected: () => [t('wallet.rejectedTitle'), `<p>${t('wallet.rejectedBody')}</p>`, true],
      failed: () => [t('wallet.failedTitle'), `<p>${esc(detail)}</p>`, true],
      pick: () => [t('connect.title'), `<p>${t('connect.sub')}</p>${walletPicker()}`],
      wc: () => [t('connect.wcTitle'), `<p>${t('connect.wcBody')}</p><div class="wc-qr">${qrTag(detail)}<span class="wallet-wait"><span></span>${t('wallet.waiting')}</span></div>`],
      wcSetup: () => [t('connect.wcTitle'), `<p>${t('connect.wcSetup')}</p><form class="tool-form" id="wc-form"><label>Project ID<input name="project" autocomplete="off" spellcheck="false" required></label><button class="primary-btn" type="submit">${t('connect.wcSave')}</button></form>`],
      none: () => [t('wallet.none'), `<p>${t('wallet.noneBody')}</p>`],
      down: () => [t('wallet.downTitle'), `<p>${fill('err.down', { rpc: esc(rpcBase) })}</p>`, true],
    }[kind]();
    let box = $('wallet-dialog');
    if (!box) {
      box = document.createElement('div');
      box.id = 'wallet-dialog';
      box.className = 'modal-backdrop';
      box.addEventListener('click', (e) => {
        if (e.target === box || e.target.closest('[data-wallet-close]')) walletCancel();
        else if (e.target.closest('[data-wallet-retry]')) walletAdvance();
        const option = e.target.closest('[data-wallet]');
        if (option) pickWallet(option.dataset.wallet);
      });
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        store.set('aether.wcProject', new FormData(e.target).get('project').trim());
        pickWallet('walletconnect');
      });
      document.body.appendChild(box);
    }
    box.dataset.step = kind;
    box.innerHTML = `<div class="modal wallet-card" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
      <button class="wallet-x" data-wallet-close aria-label="${t('wallet.close')}">×</button>
      <h2 id="wallet-title">${title}</h2>${body}
      <div class="wallet-actions">${retry ? `<button class="primary-btn" data-wallet-retry>${t('wallet.retry')}</button>` : ''}<button class="ghost-btn" data-wallet-close>${t('wallet.close')}</button></div>
    </div>`;
  }

  const WALLET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h15a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0 2-3h12v3M16 14h.01"/></svg>';
  const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.500" width="10" height="19" rx="2.500"/><path d="M11 18.500h2"/></svg>';
  const qrTag = (text) => {
    const code = window.qrcode(0, 'M');
    code.addData(text);
    code.make();
    return code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  };

  function walletPicker() {
    const found = detectedWallets();
    const row = (id, icon, name, note, tag = '') => `<button class="wallet-option" data-wallet="${esc(id)}"><span class="wallet-icon">${icon}</span><span><strong>${esc(name)}</strong><small>${esc(note)}</small></span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</button>`;
    const picture = (x) => (/^data:image\//.test(x.icon ?? '') ? `<img src="${esc(x.icon)}" alt="">` : WALLET_ICON);
    return `<div class="wallet-options">${found.map((x) => row(x.id, picture(x), x.name, t('connect.browserNote'), t('connect.found'))).join('')}
      ${found.length ? '' : `<a class="wallet-option" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer"><span class="wallet-icon">${WALLET_ICON}</span><span><strong>MetaMask</strong><small>${t('connect.install')}</small></span></a>`}
      ${row('walletconnect', PHONE_ICON, 'WalletConnect', t('connect.wcNote'))}</div><p class="wallet-hint">${t('connect.appHint')}</p>`;
  }

  async function pickWallet(id) {
    const flow = walletFlow;
    if (id !== 'walletconnect') {
      const entry = detectedWallets().find((x) => x.id === id);
      if (entry) { useWallet(entry); walletAdvance(); }
      return;
    }
    const project = window.AETHER_CONFIG?.walletConnectProjectId || store.get('aether.wcProject');
    if (!project) { walletShow('wcSetup'); return; }
    try {
      if (!window.AetherWalletConnect) {
        await new Promise((resolve, reject) => {
          const tag = document.createElement('script');
          tag.src = '/walletconnect.js';
          tag.onload = resolve;
          tag.onerror = () => reject(new Error(t('connect.wcMissing')));
          document.head.appendChild(tag);
        });
      }
      await refreshStats();
      const provider = await window.AetherWalletConnect.init({
        projectId: project, chainId: stats.chainId, rpcUrl: rpcBase,
        metadata: { name: 'Quinvium Explorer', description: 'Quinvium network explorer', url: location.origin, icons: [] },
      });
      provider.on('display_uri', (uri) => { if (walletFlow === flow) walletShow('wc', uri); });
      await provider.connect();
      useWallet({ id: 'walletconnect', name: 'WalletConnect', provider });
      walletAdvance();
    } catch (e) {
      if (walletFlow === flow) walletShow('failed', e.message);
    }
  }

  /** The next step according to the actual state of the wallet, so an approval of an earlier request is also recognised. */
  async function walletAdvance() {
    const flow = walletFlow;
    if (!flow) return;
    clearInterval(flow.timer);
    flow.step = null;
    restoreWallet();
    const w = wallet();
    if (!w) { walletShow('pick'); return; }
    await refreshStats();
    if (walletFlow !== flow) return;
    if (nodeDown) { walletShow('down'); return; }
    await syncWallet();
    if (walletFlow !== flow) return;
    account ??= flow.granted ?? null;
    const step = !account ? 'approve' : wrongNetwork() ? 'network' : null;
    if (!step) {
      walletClose();
      renderWallet();
      toast(`${t('wallet.ready')} <b>${esc(networkLabel())}</b>`);
      flow.resolve(account);
      return;
    }
    flow.step = step;
    const cleared = () => (step === 'approve' ? !!account : !wrongNetwork());
    flow.timer = setInterval(async () => {
      await syncWallet();
      if (walletFlow === flow && flow.step === step && cleared()) walletAdvance();
    }, WALLET_POLL_MS);
    walletShow(step);
    try {
      if (step === 'approve') flow.granted = (await w.request({ method: 'eth_requestAccounts' }))?.[0];
      else await switchNetwork();
    } catch (e) {
      if (walletFlow !== flow || flow.step !== step) return;
      // The wallet already has a request from earlier and will not open a new window. We wait until the user handles it.
      if (e.code === -32002) { walletShow('stuck'); return; }
      clearInterval(flow.timer);
      walletShow(e.code === 4001 ? 'rejected' : 'failed', e.message);
      return;
    }
    if (walletFlow === flow && flow.step === step) walletAdvance();
  }

  async function connect() {
    if (store.get('aether.wallet') === 'off') store.set('aether.wallet', '');
    await syncWallet();
    if (account && !wrongNetwork()) return account;
    if (!walletFlow) {
      walletFlow = {};
      walletFlow.promise = new Promise((resolve, reject) => Object.assign(walletFlow, { resolve, reject }));
      walletAdvance();
    }
    return walletFlow.promise;
  }

  async function signer() {
    await connect();
    return new ethers.BrowserProvider(wallet()).getSigner();
  }

  // ------------------------------------------------------------- overview
  const blockRows = (list) => (list.length ? `<div class="activity-list">${list.map((b) => `
    <div class="activity-row rowlink" data-href="/block/${b.number}">
      <span class="row-icon">${BLOCK_ICON}</span>
      <strong>#${num(b.number)}</strong>
      <span class="row-who hash">${esc(labelOf(b.miner) ?? short(b.miner, 6))}</span>
      <span class="row-value">${aet(b.reward, 2)} ${esc(coin())}</span>
      <span class="row-age">${ago(b.timestamp)}</span>
    </div>`).join('')}</div>` : `<div class="empty">${t('x.noBlocks')}</div>`);


  // ------------------------------------------------------------- typ transakce
  // What a transaction did, in plain words: by the target contract and the called function. The transaction is enough; deployed contracts
  // and the pool list, both from the cache. For a transfer the direction relative to the viewed address is shown.
  const CALL_TYPES = {
    SwapRouter: { swapExactTokensForTokens: 'swap', swapExactNativeForTokens: 'swap', swapExactTokensForNative: 'swap', addLiquidity: 'liqAdd', addLiquidityNative: 'liqAdd', removeLiquidity: 'liqRemove', removeLiquidityNative: 'liqRemove' },
    BridgeGateway: { send: 'bridgeOut', requestBitcoinDeposit: 'bridgeOut', deliver: 'bridgeIn', executeQueued: 'bridgeIn', cancelDelivery: 'bridgeCancel', cancelQueued: 'bridgeCancel', attest: 'bridgeSign', post: 'bridgeSign' },
    WAET: { deposit: 'wrap', withdraw: 'unwrap' },
    AetherPool: { submitShare: 'poolShare', submitShares: 'poolShare', claim: 'poolPayout', payout: 'poolPayout', settle: 'poolPayout', withdrawFee: 'poolPayout' },
    PoolFactory: { createPool: 'poolCreate' },
    AetherNames: { '*': 'name' },
    Notary: { '*': 'notary' },
    Escrow: { '*': 'escrow' },
    TokenFactory: { create: 'tokenCreate' },
  };
  const TOKEN_TYPES = { transfer: 'tokenTransfer', transferFrom: 'tokenTransfer', approve: 'approve', mint: 'mint' };
  const callInterfaces = new Map();
  const callInterface = (name) => {
    if (!callInterfaces.has(name)) {
      let i = null;
      try { i = contracts[name]?.abi ? new ethers.Interface(contracts[name].abi) : null; } catch { i = null; }
      callInterfaces.set(name, i);
    }
    return callInterfaces.get(name);
  };
  let tokenCalls = null;
  let typeCtx = {};
  /** Deployed network contracts and pools for determining the type. The page lists can then determine the type without another query. */
  async function typeContext() {
    const [d, pools] = await Promise.all([deployment().catch(() => null), poolNames().catch(() => new Map())]);
    typeCtx = { d, pools };
    return typeCtx;
  }
  /** @returns {{ kind: string, call?: object, contract?: string }} */
  function txType(x, ctx = typeCtx) {
    if (!x.to) return { kind: 'create' };
    const input = x.input ?? '0x';
    if (input === '0x') return { kind: 'transfer' };
    const to = x.to.toLowerCase();
    const d = ctx?.d;
    const contract = Object.entries(contracts).find(([, v]) => v.address && v.address.toLowerCase() === to)?.[0]
      ?? (d?.swap?.router?.toLowerCase() === to ? 'SwapRouter' : d?.gateway?.toLowerCase() === to ? 'BridgeGateway' : ctx?.pools?.has(to) ? 'AetherPool' : null);
    if (contract && CALL_TYPES[contract]) {
      try {
        const call = callInterface(contract)?.parseTransaction({ data: input, value: x.value });
        const kind = call && (CALL_TYPES[contract][call.name] ?? CALL_TYPES[contract]['*']);
        if (kind) return { kind, call, contract };
      } catch { /* another function */ }
    }
    tokenCalls ??= new ethers.Interface(['function transfer(address to, uint256 amount)', 'function approve(address spender, uint256 amount)', 'function transferFrom(address from, address to, uint256 amount)', 'function mint(address to, uint256 amount)']);
    try {
      const call = tokenCalls.parseTransaction({ data: input });
      if (call && TOKEN_TYPES[call.name]) return { kind: TOKEN_TYPES[call.name], call };
    } catch { /* not a token */ }
    return { kind: 'call' };
  }
  /** Direction relative to the viewed address. For a token transfer the token's sender and recipient decide, not the contract address. */
  function txDirection(x, type, viewer) {
    if (!viewer) return null;
    const v = viewer.toLowerCase();
    let from = x.from?.toLowerCase() === v;
    let to = x.to?.toLowerCase() === v;
    if (type.kind === 'tokenTransfer' && type.call) {
      const transferFrom = type.call.name === 'transferFrom';
      if (transferFrom) from = type.call.args.from.toLowerCase() === v;
      to = (transferFrom ? type.call.args.to : type.call.args[0]).toLowerCase() === v;
    }
    if (from && to) return 'self';
    return from ? 'out' : to ? 'in' : null;
  }
  /** Method: the called function name, Transfer for a transfer, Contract deployment for a deployment. */
  const humanize = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  let methodInterfaces = null;
  function methodName(x) {
    if (!x.to) return t('type.create');
    const input = x.input ?? '0x';
    if (input === '0x') return t('type.transfer');
    const type = txType(x);
    if (type.call) return humanize(type.call.name);
    methodInterfaces ??= [ERC20_CALLS, ...Object.values(contracts).map((c) => { try { return c.abi ? new ethers.Interface(c.abi) : null; } catch { return null; } }).filter(Boolean)];
    for (const i of methodInterfaces) {
      try {
        const f = i.getFunction(input.slice(0, 10));
        if (f) return humanize(f.name);
      } catch { /* another contract */ }
    }
    return input.slice(0, 10);
  }
  /** Fee paid: gas used times the actual price. A pending transaction does not have it yet. */
  const txFee = (x) => (x.gasUsed !== undefined && x.gasUsed !== null && x.gasPrice ? BigInt(x.gasUsed) * BigInt(x.gasPrice) : null);
  const previews = new Map();
  const eyeButton = (hash) => `<button type="button" class="eye-btn" data-preview="${esc(hash)}" title="${t('tx.preview')}" aria-label="${t('tx.preview')}">${EYE_ICON}</button>`;
  /** Quick transaction preview from a list row, without another node query. */
  function previewHtml(x) {
    const fee = txFee(x);
    const status = x.status === undefined || x.status === null ? (x.blockNumber ? '' : `<span class="badge pending">${t('b.pending')}</span>`) : txStatus(x);
    return `<div class="preview-head"><strong>${t('tx.previewTitle')}</strong>${status}</div>${kv([
      [t('t.method'), `<span class="method">${esc(methodName(x))}</span>`],
      [t('t.block'), x.blockNumber ? blockLink(Number(x.blockNumber)) : t('b.pending')],
      x.timestamp && [t('tx.time'), esc(when(x.timestamp))],
      [t('t.from'), addrLink(x.from)], [t('t.to'), x.to ? addrLink(x.to) : '—'],
      [t('t.value'), `${aet(x.value, 6)} ${esc(coin())}`],
      [t('t.fee'), fee === null ? '—' : `${aet(fee, 8)} ${esc(coin())}`],
      x.gasPrice && [t('tx.gasPrice'), `${gwei(x.gasPrice)} gwei`],
      [t('tx.gasUse'), `${x.gasUsed ? num(BigInt(x.gasUsed)) : '—'} / ${num(BigInt(x.gas ?? 0))}`],
      [t('tx.position'), `nonce ${num(BigInt(x.nonce ?? 0))}`],
    ])}<a class="text-link" href="/tx/${esc(x.hash)}">${t('tx.openDetail')}</a>`;
  }
  let previewBox = null;
  let previewTimer = null;
  function showPreview(button) {
    const x = previews.get(button.dataset.preview.toLowerCase());
    if (!x) return;
    clearTimeout(previewTimer);
    if (previewBox?.dataset.hash === x.hash) return;
    previewBox?.remove();
    previewBox = document.createElement('div');
    previewBox.className = 'tx-preview card';
    previewBox.dataset.hash = x.hash;
    previewBox.setAttribute('role', 'dialog');
    previewBox.innerHTML = previewHtml(x);
    document.body.appendChild(previewBox);
    const r = button.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    previewBox.style.width = `${width}px`;
    previewBox.style.left = `${Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 16))}px`;
    previewBox.style.top = `${r.bottom + window.scrollY + 6}px`;
    previewBox.addEventListener('mouseenter', () => clearTimeout(previewTimer));
    previewBox.addEventListener('mouseleave', hidePreviewSoon);
  }
  const hidePreview = () => { clearTimeout(previewTimer); previewBox?.remove(); previewBox = null; };
  const hidePreviewSoon = () => { clearTimeout(previewTimer); previewTimer = setTimeout(hidePreview, 250); };
  document.addEventListener('mouseover', (e) => { const b = e.target.closest?.('[data-preview]'); if (b && window.matchMedia('(hover: hover)').matches) showPreview(b); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-preview]')) hidePreviewSoon(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preview]');
    if (b) { e.preventDefault(); e.stopPropagation(); showPreview(b); return; }
    if (previewBox && !e.target.closest('.tx-preview')) hidePreview();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePreview(); });

  const dirBadge = (dir) => (dir ? `<span class="dir dir-${dir}">${t(`dir.${dir}`)}</span>` : '');
  const typeCell = (x, viewer) => {
    const type = txType(x);
    return `<span class="tx-type">${dirBadge(txDirection(x, type, viewer))}<span>${t(`type.${type.kind}`)}</span></span>`;
  };
  const txRows = (list) => (list.length ? `<div class="activity-list">${list.map((x) => `
    <div class="activity-row rowlink" data-href="/tx/${esc(x.hash)}">
      <span class="row-icon">${TX_ICON}</span>
      <strong class="hash">${esc(short(x.hash, 8))}</strong>
      <span class="row-who">${t(`type.${txType(x).kind}`)}</span>
      <span class="row-value">${aet(x.value, 4)} ${esc(coin())}</span>
      <span class="row-age">${x.timestamp ? ago(x.timestamp) : t('b.pending')}</span>
    </div>`).join('')}</div>` : `<div class="empty">${t('x.noTxs')}</div>`);

  // Without a miner no blocks are created. The overview says so directly; the same limit applies to the node's hashrate estimate.
  const STALLED_S = 180;
  const RIBBON_BLOCKS = 6;
  const HOME_ROWS = 6;

  const ribbon = (blocks) => `<div class="ribbon" aria-label="${t('nav.blocks')}">${blocks.map((b) => `<a class="ribbon-item" href="/block/${b.number}"><strong>#${num(b.number)}</strong><span>${ago(b.timestamp)} · ${num(b.txCount)} tx</span></a>`).join('')}</div>`;

  /** The band below the search: what changes with every block. The search stays outside so a query being typed does not disappear. */
  function homeRibbon(blocks) {
    const tip = blocks[0];
    const stalled = tip && Date.now() / 1000 - tip.timestamp > STALLED_S;
    return `${stalled ? `<p class="notice">${esc(fill('home.stalled', { t: ago(tip.timestamp) }))}</p>` : ''}${ribbon(blocks)}`;
  }

  /** Summary: transactions, fee now, safe block and a 14-day transaction chart. */
  /** The gas price changes with block utilisation (EIP-1559). In a quiet network it is at the minimum; the home page says so, so it does not look fixed. */
  const gasState = (s) => (s.fullness === undefined ? '' : `<small>${esc(s.congested ? t('home.gasBusy')
    : fill('home.gasCalm', { p: (s.fullness * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) }))}</small>`);
  function homeStats(s, a) {
    const base = BigInt(s.baseFee ?? 0);
    const tip = (k) => BigInt(s.tips?.[k] ?? 0);
    return `<div class="card home-stats">
      <div class="home-stat"><span>${t('home.txs')}</span><strong>${num(s.txCount ?? a?.txCount ?? 0)}</strong><small>${esc(fill('home.tps', { tps: (a?.tps ?? 0).toLocaleString(locale(), { maximumFractionDigits: 3 }), day: num(a?.txs ?? 0) }))}</small></div>
      <div class="home-stat"><span>${t('home.gas')}</span><strong>${gwei(base + tip('normal'))} gwei</strong><small>${esc(fill('home.gasParts', { base: gwei(base), slow: gwei(tip('slow')), normal: gwei(tip('normal')), fast: gwei(tip('fast')) }))}</small>${gasState(s)}</div>
      <div class="home-stat"><span>${t('home.safe')}</span><strong>${a ? blockLink(a.safe) : '—'}</strong><small>${a ? `${esc(t('home.final'))} ${blockLink(a.finalized)}` : ''}</small></div>
      <div class="home-stat home-chart"><span>${t('home.chart')}</span><div class="plot plot-small" id="home-plot"></div></div>
    </div>`;
  }

  /** Latest blocks: who mined it, how many transactions, in how many seconds and the actual reward including fees. */
  const latestBlocks = (list) => (list.length ? `<div class="latest-list">${list.slice(0, HOME_ROWS).map((b, i) => {
    const prev = list[i + 1];
    const solve = prev ? b.timestamp - prev.timestamp : null;
    return `<div class="latest-row rowlink" data-href="/block/${b.number}">
      <span class="row-icon">${BLOCK_ICON}</span>
      <div class="latest-main">${blockLink(b.number)}<small>${ago(b.timestamp)}</small></div>
      <div class="latest-mid"><span>${t('home.miner')} ${whoLink(b.miner, typeCtx.pools ?? new Map())}</span><small>${esc(fill(solve === null ? 'home.txsOnly' : 'home.txsIn', { n: num(b.txCount), s: num(solve ?? 0) }))}</small></div>
      <span class="latest-value" title="${esc(t('home.rewardTitle'))}">${aet(b.income ?? b.reward, 4)} ${esc(coin())}</span>
    </div>`;
  }).join('')}</div>` : `<div class="empty">${t('x.noBlocks')}</div>`);

  /** Latest transactions: from, to, amount and method. */
  const latestTxs = (list) => {
    for (const x of list) previews.set(x.hash.toLowerCase(), x);
    return list.length ? `<div class="latest-list">${list.map((x) => `<div class="latest-row rowlink" data-href="/tx/${esc(x.hash)}">
      <span class="row-icon">${TX_ICON}</span>
      <div class="latest-main">${txLink(x.hash)}<small>${ago(x.timestamp)}</small></div>
      <div class="latest-mid"><span>${t('t.from')} ${addrLink(x.from)}</span><span>${t('t.to')} ${x.to ? addrLink(x.to) : '—'}</span></div>
      <div class="latest-end"><span class="latest-value">${aet(x.value, 4)} ${esc(coin())}</span><span class="method">${esc(methodName(x))}</span></div>
    </div>`).join('')}</div>` : `<div class="empty">${t('x.noTxs')}</div>`;
  };

  function homeLive(s, blocks, txs, a) {
    return `${homeStats(s, a)}
      <div class="metric-grid">
        ${metric(t('m.height'), num(s.height))}
        ${metric(t('m.hashrate'), rate(s.hashrate))}
        ${metric(t('m.supply'), `${aet(s.supply, 2)} <em>${esc(s.currency)}</em>`)}
        ${metric(t('nh.time'), `${s.avgBlockTime.toLocaleString(locale(), { maximumFractionDigits: 1 })} s`)}
      </div>
      <div class="two-col home-lists">
        <div class="card"><div class="card-header"><h2>${t('home.latestBlocks')}</h2><a class="text-link" href="/blocks">${t('sec.viewAll')}</a></div>${latestBlocks(blocks)}</div>
        <div class="card"><div class="card-header"><h2>${t('home.latestTxs')}</h2><a class="text-link" href="/txs">${t('sec.viewAll')}</a></div>${latestTxs(txs)}</div>
      </div>`;
  }

  async function pageHome(silent) {
    if (!silent) app.innerHTML = skeleton();
    try {
      const now = Math.floor(Date.now() / 1000);
      const [s, blocks, txs, a, history] = await Promise.all([rpc('aether_stats'), rpc('aether_recentBlocks', [HOME_ROWS + 1, 0]), rpc('aether_recentTxs', [HOME_ROWS]),
        rpc('aether_activity').catch(() => null), rpc('aether_chartSeries', [{ from: now - 14 * 86400, to: now, bucket: 86400 }]).catch(() => null), typeContext()]);
      stats = s;
      if (route().name !== 'home') return;
      if (!$('home-live')) {
        app.innerHTML = `<section class="hero"><div class="hero-inner"><h1>${t('home.title')}</h1>
          <form class="hero-search js-search has-filter" role="search">${filterSelect()}<input type="text" autocomplete="off" spellcheck="false" placeholder="${t('search.ph')}" aria-label="${t('search.ph')}"><button type="submit" title="${t('search.go')}" aria-label="${t('search.go')}">${SEARCH_ICON}</button></form>
          <div id="home-ribbon"></div></div></section><div id="home-live"></div>`;
      }
      $('home-ribbon').innerHTML = homeRibbon(blocks.slice(0, RIBBON_BLOCKS));
      $('home-live').innerHTML = homeLive(s, blocks, txs, a);
      if (history?.items?.length && $('home-plot')) lineChart($('home-plot'), history.items, history.bucket, (p) => p.txs, (v) => num(Math.round(v)), { small: true });
    } catch (e) { if (!silent) app.innerHTML = errorBox(e.message); }
  }

  // ------------------------------------------------------------- filtry
  const PAGE = 25;
  const RANGES = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 };
  const rangeOptions = () => [['', t('f.all')], ['1h', t('f.r1h')], ['24h', t('f.r24h')], ['7d', t('f.r7d')], ['30d', t('f.r30d')], ['custom', t('f.rCustom')]];
  const pageOf = (q) => Math.max(1, Number(q.get('page')) || 1);

  function timeFilter(q) {
    const range = q.get('range');
    if (RANGES[range]) return { fromTime: Math.floor(Date.now() / 1000) - RANGES[range] };
    if (range !== 'custom') return {};
    const day = (v) => { const ms = Date.parse(`${v}T00:00:00`); return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000); };
    const to = day(q.get('to'));
    return { fromTime: day(q.get('from')), toTime: to === undefined ? undefined : to + 86399 };
  }

  const select = (name, label, options, q) => `<label>${label}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === (q.get(name) ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const rangeFields = (q) => `${select('range', t('f.range'), rangeOptions(), q)}${q.get('range') === 'custom' ? `<label>${t('f.from')}<input type="date" name="from" value="${esc(q.get('from') ?? '')}"></label><label>${t('f.to')}<input type="date" name="to" value="${esc(q.get('to') ?? '')}"></label>` : ''}`;
  const orderField = (q) => select('order', t('f.order'), [['', t('f.newest')], ['asc', t('f.oldest')]], q);
  /** Filters stay hidden until someone needs them. They stay open only when one of them is active. */
  const filterForm = (fields, q) => {
    const active = [...q.keys()].some((k) => k !== 'tab' && k !== 'page');
    return `<details class="filter-box"${active ? ' open' : ''}><summary>${t('f.filter')}${CHEVRON}</summary><form class="filters" id="filters">${fields}<button type="submit" class="primary-btn">${t('f.apply')}</button>${active ? `<button type="button" class="ghost-btn" id="filters-reset">${t('f.reset')}</button>` : ''}</form></details>`;
  };

  /** Filters live in the page address, so they can be bookmarked, shared and the back button works. */
  function bindFilters(base, keep = {}) {
    const form = $('filters');
    if (!form) return;
    const apply = () => {
      const p = new URLSearchParams(keep);
      for (const [k, v] of new FormData(form)) if (String(v).trim()) p.set(k, String(v).trim());
      const text = p.toString();
      navigate(`${base}${text ? `?${text}` : ''}`);
    };
    form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') apply(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
    if ($('filters-reset')) $('filters-reset').onclick = () => { const p = new URLSearchParams(keep).toString(); navigate(`${base}${p ? `?${p}` : ''}`); };
  }

  /** Pagination. Rankings and the queue have no "newer and older", so they have neutral labels. */
  function pagerLinks(base, q, total, neutral = false) {
    const page = pageOf(q);
    const link = (n) => { const p = new URLSearchParams(q); if (n > 1) p.set('page', n); else p.delete('page'); const text = p.toString(); return `${base}${text ? `?${text}` : ''}`; };
    const last = Math.max(1, Math.ceil(total / PAGE));
    if (last === 1) return '';
    const [prev, next] = neutral ? [t('x.prev'), t('x.next')] : [t('x.newer'), t('x.older')];
    return `<div class="pager">${page > 1 ? `<a class="ghost-btn" href="${esc(link(page - 1))}">${prev}</a>` : ''}<span class="hint">${fill('x.page', { n: num(page), of: num(last) })}</span>${page < last ? `<a class="ghost-btn" href="${esc(link(page + 1))}">${next}</a>` : ''}</div>`;
  }

  /** The node counts results only up to 100,000; pagination needs no more. Above this limit the page says so. */
  const countLine = (n, capped = false) => `<p class="result-count">${fill(capped ? 'f.resultsMore' : 'f.results', { n: num(n) })}</p>`;
  /** Blocks: miner with the pool name, gas used with utilisation, base fee and the actual reward including fees. */
  const blockTable = (list) => `<div class="table-wrap"><table><thead><tr><th>${t('t.block')}</th><th>${t('t.age')}</th><th class="num">${t('t.tx')}</th><th>${t('t.miner')}</th><th>${t('blk.gasUsed')}</th><th class="num">${t('blk.gasLimit')}</th><th class="num">${t('blk.baseFee')}</th><th class="num" title="${esc(t('home.rewardTitle'))}">${t('blk.minerReward')}</th></tr></thead><tbody>
    ${list.map((b) => {
      const used = Number(b.gasUsed ?? 0);
      const limit = Number(b.gasLimit ?? 0);
      const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
      return `<tr class="rowlink" data-href="/block/${b.number}"><td>${blockLink(b.number)}</td><td title="${esc(when(b.timestamp))}">${ago(b.timestamp)}</td><td class="num">${num(b.txCount)}</td>
        <td>${whoLink(b.miner, typeCtx.pools ?? new Map())}</td>
        <td><span class="gas-cell">${num(used)}<span class="muted">${pctOf(used, limit)}</span><span class="gas-mini" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></span></span></td>
        <td class="num">${num(limit)}</td><td class="num">${b.baseFee !== undefined ? `${gwei(b.baseFee)} gwei` : '—'}</td><td class="num">${aet(b.income ?? b.reward, 4)} ${esc(coin())}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  const txStatus = (x) => (x.status === 0 ? `<span class="badge bad">${t('b.fail')}</span>` : `<span class="badge ok">${t('b.ok')}</span>`);
  /**
   * Transactions: an eye with a quick preview, method, block, age, from, to, amount and fee.
   * @param {string} [viewer] address whose page shows the list: each transaction then shows whether it was sent or received
   */
  const txTable = (list, viewer) => {
    for (const x of list) previews.set(x.hash.toLowerCase(), x);
    return `<div class="table-wrap"><table class="tx-table"><thead><tr><th class="eye-col"><span class="sr-only">${t('tx.preview')}</span></th><th>${t('t.hash')}</th><th>${t('t.method')}</th><th>${t('t.block')}</th><th>${t('t.age')}</th><th>${t('t.from')}</th>${viewer ? '<th></th>' : ''}<th>${t('t.to')}</th><th class="num">${t('t.value')}</th><th class="num">${t('t.fee')}</th></tr></thead><tbody>
    ${list.map((x) => {
      const fee = txFee(x);
      const method = methodName(x);
      return `<tr class="rowlink" data-href="/tx/${esc(x.hash)}"><td class="eye-col">${eyeButton(x.hash)}</td><td>${txLink(x.hash)}${x.status === 0 ? ` ${txStatus(x)}` : ''}</td>
        <td><span class="method" title="${esc(method)}">${esc(method)}</span></td><td>${x.blockNumber ? blockLink(Number(x.blockNumber)) : `<span class="badge pending">${t('b.pending')}</span>`}</td>
        <td title="${esc(when(x.timestamp))}">${x.timestamp ? ago(x.timestamp) : '—'}</td><td>${addrLink(x.from)}</td>${viewer ? `<td>${dirBadge(txDirection(x, txType(x), viewer))}</td>` : ''}
        <td>${x.to ? addrLink(x.to) : '—'}</td><td class="num">${aet(x.value, 4)} ${esc(coin())}</td><td class="num muted">${fee === null ? '—' : aet(fee, 6)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  };
  const noResults = () => `<div class="empty">${t('f.none')}</div>`;

  async function pageBlocks(q) {
    app.innerHTML = skeleton();
    const miner = q.get('miner')?.trim();
    const bad = miner && !ethers.isAddress(miner);
    const content = q.get('txs') ?? '';
    const res = bad ? { total: 0, items: [] } : await rpc('aether_blocks', [{
      limit: PAGE, offset: (pageOf(q) - 1) * PAGE, miner: miner || undefined, minTxs: content === 'with' ? 1 : undefined, onlyEmpty: content === 'empty' || undefined,
      fromBlock: q.get('fromBlock') || undefined, toBlock: q.get('toBlock') || undefined, order: q.get('order') || undefined, ...timeFilter(q),
    }]);
    const a = await rpc('aether_activity').catch(() => null);
    await typeContext();
    app.innerHTML = `${head(t('nav.blocks'))}${blockSummary(a)}
      ${filterForm(`<label>${t('f.miner')}<input class="wide" name="miner" value="${esc(miner ?? '')}" placeholder="0x…" spellcheck="false" autocomplete="off"></label>
        <label>${t('f.fromBlock')}<input class="narrow" name="fromBlock" inputmode="numeric" value="${esc(q.get('fromBlock') ?? '')}" autocomplete="off"></label>
        <label>${t('f.toBlock')}<input class="narrow" name="toBlock" inputmode="numeric" value="${esc(q.get('toBlock') ?? '')}" autocomplete="off"></label>
        ${select('txs', t('f.content'), [['', t('f.all')], ['with', t('f.withTx')], ['empty', t('f.emptyOnly')]], q)}${rangeFields(q)}${orderField(q)}${bad ? `<span class="filter-error">${t('f.badAddress')}</span>` : ''}`, q)}
      ${countLine(res.total, res.capped)}<div class="card">${res.items.length ? blockTable(res.items) : noResults()}${pagerLinks('/blocks', q, res.total)}</div>`;
    bindFilters('/blocks');
  }

  const kv = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<div class="kv-row"><span>${k}</span><div>${v}</div></div>`).join('')}</div>`;

  /** Text in the block's extra data, if it is readable. */
  const extraText = (hex) => {
    try {
      const text = ethers.toUtf8String(hex);
      return text.trim() && !/[\u0000-\u001f\u007f�]/.test(text) ? text : null;
    } catch { return null; }
  };
  const pctOf = (part, whole) => `${(whole ? (Number(part) / Number(whole)) * 100 : 0).toLocaleString(locale(), { maximumFractionDigits: 2 })} %`;
  const hashRow = (label, h) => h && [label, `<span class="hash">${esc(h)}</span>${copyBtn(h)}`];

  // Pool names from the factory. To miners a pool is just the reward recipient address; the name helps recognise it.
  let poolCache = null;
  async function poolNames() {
    if (poolCache && Date.now() - poolCache.at < 60_000) return poolCache.names;
    let names = new Map();
    try {
      const list = await contract('PoolFactory').list(0, 200);
      const rows = await Promise.all([...list].map((a) => poolContract(a).name().then((n) => [a.toLowerCase(), n], () => null)));
      names = new Map(rows.filter(Boolean));
    } catch { /* there are no pools on this network */ }
    poolCache = { at: Date.now(), names };
    return names;
  }
  /** An address with the name of a pool or system contract, otherwise shortened. */
  const whoLink = (a, names, suffix = '') => {
    const name = names?.get(a.toLowerCase()) ?? labelOf(a);
    return name ? `<a href="/address/${esc(a)}${suffix}">${esc(name)}</a> <span class="hash muted">${esc(short(a, 8))}</span>` : `<a class="hash" href="/address/${esc(a)}${suffix}">${esc(short(a, 10))}</a>`;
  };

  async function pageBlock(id, q = new URLSearchParams()) {
    app.innerHTML = skeleton();
    const isHash = id.startsWith('0x');
    const b = await rpc(isHash ? 'eth_getBlockByHash' : 'eth_getBlockByNumber', [isHash ? id : `0x${Number(id).toString(16)}`, false]);
    if (!b) { app.innerHTML = `<div class="empty">${t('search.none')} ${esc(id)}</div>`; return; }
    const n = Number(b.number);
    const page = pageOf(q);
    // The block's transaction list comes by page from the index: a block can have over a thousand.
    const [income, parent, final, list, pools] = await Promise.all([
      rpc('aether_blockIncome', [`0x${n.toString(16)}`]),
      n > 0 ? rpc('eth_getBlockByHash', [b.parentHash, false]) : null,
      rpc('eth_getBlockByNumber', ['finalized', false]).catch(() => null),
      n > 0 && b.transactions.length ? rpc('aether_txs', [{ fromBlock: n, toBlock: n, order: 'asc', limit: PAGE, offset: (page - 1) * PAGE }]) : { total: 0, items: [] },
      poolNames(),
      typeContext(),
    ]);
    const unit = esc(coin());
    const height = Math.max(stats?.height ?? n, n);
    const time = Number(b.timestamp);
    const solve = parent ? time - Number(parent.timestamp) : null;
    const isFinal = !!final && n <= Number(final.number);
    const extra = extraText(b.extraData);
    const nav = `${n > 0 ? `<a class="ghost-btn" href="/block/${n - 1}" aria-label="${esc(`${t('t.block')} ${n - 1}`)}">←</a>` : ''}${n < height ? `<a class="ghost-btn" href="/block/${n + 1}" aria-label="${esc(`${t('t.block')} ${n + 1}`)}">→</a>` : ''}`;
    app.innerHTML = `${head(`${t('t.block')} #${num(n)}`, '', nav)}
      <div class="card">${kv([
        [t('tx.status'), `${isFinal ? `<span class="badge ok">${t('blk.final')}</span>` : `<span class="badge">${t('blk.confirmed')}</span>`}<span class="muted">${esc(fill('tx.confirmations', { n: num(height - n + 1) }))}</span>`],
        [t('tx.time'), `${ago(time)}<span class="muted">${esc(when(time))}${solve !== null && n > 1 ? ` · ${esc(fill('blk.solve', { s: num(solve) }))}` : ''}</span>`],
        [t('nav.txs'), b.transactions.length ? `<a href="/block/${n}" data-jump="block-txs">${num(b.transactions.length)}</a>` : '0'],
        [t('t.miner'), `${whoLink(b.miner, pools)}${copyBtn(b.miner)}`],
        [t('b.total'), `<strong>${aet(income.total, 8)} ${unit}</strong>`],
        [t('b.reward'), `${aet(income.reward, 8)} ${unit}`],
        [t('b.baseFees'), `${aet(income.baseFees, 8)} ${unit}`],
        [t('b.tips'), `${aet(income.tips, 8)} ${unit}`],
        [t('f.gas'), `${esc(fill('blk.gasOf', { used: num(BigInt(b.gasUsed)), limit: num(BigInt(b.gasLimit)), pct: pctOf(BigInt(b.gasUsed), BigInt(b.gasLimit)) }))}<span class="gas-bar" aria-hidden="true"><i style="width:${Math.min(100, (Number(b.gasUsed) / Math.max(1, Number(b.gasLimit))) * 100).toFixed(2)}%"></i></span>`],
        [t('nh.basefee'), `${gwei(b.baseFeePerGas ?? 0)} gwei`],
        [t('m.difficulty'), num(BigInt(b.difficulty))],
        b.totalDifficulty && [t('blk.totalDifficulty'), num(BigInt(b.totalDifficulty))],
        [t('f.size'), `${(Number(b.size) / 1024).toLocaleString(locale(), { maximumFractionDigits: 2 })} KB`],
        hashRow(t('t.hash'), b.hash),
        n > 0 && ['Parent', `<a class="hash" href="/block/${esc(b.parentHash)}">${esc(b.parentHash)}</a>`],
        hashRow('State root', b.stateRoot), hashRow('Transactions root', b.transactionsRoot), hashRow('Receipts root', b.receiptsRoot),
        hashRow('Mix hash', b.mixHash), ['Nonce', `<span class="hash">${esc(b.nonce)}</span>`],
        b.extraData && b.extraData !== '0x' && [t('blk.extra'), `${extra ? `${esc(extra)} ` : ''}<span class="hash muted">${esc(short(b.extraData, 40))}</span>`],
      ])}</div>
      <div class="card" id="block-txs"><div class="card-header"><h2>${t('nav.txs')}</h2><span class="muted">${num(list.total)}</span></div>
        ${list.items.length ? txTable(list.items) : `<div class="empty">${t('blk.none')}</div>`}${pagerLinks(`/block/${n}`, q, list.total, true)}</div>`;
    const jump = app.querySelector('[data-jump]');
    if (jump) jump.onclick = (e) => { e.preventDefault(); $('block-txs').scrollIntoView({ behavior: 'smooth' }); };
  }

  const txFilterFields = (q, withAddress) => `${withAddress ? `<label>${t('f.address')}<input class="wide" name="address" value="${esc(q.get('address') ?? '')}" placeholder="0x…" spellcheck="false" autocomplete="off"></label>` : ''}
    ${select('direction', t('f.direction'), [['', t('f.all')], ['in', t('f.in')], ['out', t('f.out')]], q)}
    ${select('kind', t('f.kind'), [['', t('f.all')], ['transfer', t('tx.transfer')], ['call', t('tx.call')], ['create', t('tx.create')]], q)}
    ${select('status', t('f.status'), [['', t('f.all')], ['ok', t('b.ok')], ['failed', t('b.fail')]], q)}
    <label>${fill('f.minValue', { coin: esc(coin()) })}<input class="narrow" name="min" inputmode="decimal" value="${esc(q.get('min') ?? '')}" autocomplete="off"></label>
    ${rangeFields(q)}${orderField(q)}`;

  function txQuery(q, address) {
    let minValue;
    try { minValue = q.get('min') ? ethers.parseEther(q.get('min').replace(',', '.')).toString() : undefined; } catch { minValue = undefined; }
    return {
      limit: PAGE, offset: (pageOf(q) - 1) * PAGE, address: address || undefined, direction: q.get('direction') || undefined, kind: q.get('kind') || undefined,
      status: q.get('status') || undefined, minValue, order: q.get('order') || undefined, ...timeFilter(q),
    };
  }

  /** 24-hour traffic summary above the transaction list. */
  const txSummary = (a) => (a ? `<div class="metric-grid">
      ${metric(t('m.txs24'), num(a.txs), esc(fill('m.tps', { tps: a.tps.toLocaleString(locale(), { maximumFractionDigits: 3 }) })))}
      ${metric(t('m.pending1h'), num(a.pendingHour), esc(fill('m.pendingAll', { n: num(a.pending) })))}
      ${metric(t('m.fees24'), `${aet(a.fees, 6)} <em>${esc(coin())}</em>`)}
      ${metric(t('m.avgFee24'), `${aet(a.avgFee, 8)} <em>${esc(coin())}</em>`)}
    </div>` : '');
  /** 24-hour block summary: utilisation, safe block, rewards and pool blocks instead of MEV, which does not exist here. */
  const blockSummary = (a) => (a ? `<div class="metric-grid">
      ${metric(t('m.util24'), pctOf(a.utilization, 1), esc(fill('m.blocks24', { n: num(a.blocks) })))}
      ${metric(t('m.safe'), blockLink(a.safe), esc(fill('m.finalNote', { n: `#${num(a.finalized)}` })))}
      ${metric(t('m.rewards24'), `${aet(a.rewards, 2)} <em>${esc(coin())}</em>`, esc(t('m.rewardsNote')))}
      ${metric(t('m.poolBlocks24'), num(a.poolBlocks), esc(fill('m.poolShare', { p: pctOf(a.poolBlocks, a.blocks) })))}
    </div>` : '');

  async function pageTxs(q) {
    app.innerHTML = skeleton();
    const address = q.get('address')?.trim();
    const bad = address && !ethers.isAddress(address);
    const [res, a] = await Promise.all([bad ? { total: 0, items: [] } : rpc('aether_txs', [txQuery(q, address)]), rpc('aether_activity').catch(() => null), typeContext()]);
    app.innerHTML = `${head(t('nav.txs'))}${txSummary(a)}
      ${filterForm(`${txFilterFields(q, true)}${bad ? `<span class="filter-error">${t('f.badAddress')}</span>` : ''}`, q)}
      ${countLine(res.total, res.capped)}<div class="card">${res.items.length ? txTable(res.items) : noResults()}${pagerLinks('/txs', q, res.total)}</div>`;
    bindFilters('/txs');
  }

  function decodeCall(x) {
    const c = Object.entries(contracts).find(([, v]) => v.address?.toLowerCase() === x.to?.toLowerCase());
    if (!c) return null;
    try {
      const d = new ethers.Interface(c[1].abi).parseTransaction({ data: x.input, value: x.value });
      return `${c[0]}.${d.name}(${d.args.map((a) => esc(short(String(a), 24))).join(', ')})`;
    } catch { return null; }
  }

  // ------------------------------------------------------------- detail transakce
  const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
  const UNLIMITED = 2n ** 255n;
  const ERC20_EVENTS = ['event Transfer(address indexed from, address indexed to, uint256 value)', 'event Approval(address indexed owner, address indexed spender, uint256 value)'];
  const ERC20_CALLS = new ethers.Interface(['function transfer(address to, uint256 amount)', 'function approve(address spender, uint256 amount)', 'function transferFrom(address from, address to, uint256 amount)']);
  const tokenMeta = new Map();
  /** Token symbol and decimals, once per page load. A contract that is not a token returns null. */
  function tokenInfo(address) {
    const key = address.toLowerCase();
    if (!tokenMeta.has(key)) {
      const c = new ethers.Contract(address, ERC20, provider());
      tokenMeta.set(key, Promise.all([c.symbol(), c.decimals()]).then(([symbol, decimals]) => ({ symbol: tokenFace(address, '', symbol).symbol, decimals: Number(decimals) }), () => null));
    }
    return tokenMeta.get(key);
  }
  const tokenAmount = (value, info) => (value >= UNLIMITED ? t('tx.unlimited') : info ? units(value, info.decimals, 6) : value.toString());

  /** Token transfers from Transfer events. ERC-721 has four topics and does not belong here. */
  async function tokenTransfers(logs) {
    const list = logs.filter((l) => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3);
    return Promise.all(list.map(async (l) => ({
      token: l.address, info: await tokenInfo(l.address), value: BigInt(l.data === '0x' ? 0 : l.data),
      from: ethers.getAddress(`0x${l.topics[1].slice(26)}`), to: ethers.getAddress(`0x${l.topics[2].slice(26)}`),
    })));
  }
  const transferList = (rows) => `<ul class="transfer-list">${rows.map((x) => `<li><span class="transfer-who">${x.from === ethers.ZeroAddress ? `<span class="badge">${t('tokens.mint')}</span>` : addrLink(x.from)}<span class="muted">→</span>${x.to === ethers.ZeroAddress ? `<span class="badge">${t('tokens.burn')}</span>` : addrLink(x.to)}</span>
    <span class="transfer-amount"><b>${tokenAmount(x.value, x.info)}</b> <a href="/token/${esc(x.token)}">${esc(x.info?.symbol ?? short(x.token, 6))}</a></span></li>`).join('')}</ul>`;

  let eventInterfaces = null;
  /** An event by known contracts. Several contracts can have the same signature; whoever can decode it decides. */
  function parseEvent(log) {
    eventInterfaces ??= [ERC20_EVENTS, ...Object.values(contracts).map((c) => c.abi).filter(Boolean)].map((abi) => { try { return new ethers.Interface(abi); } catch { return null; } }).filter(Boolean);
    for (const i of eventInterfaces) {
      try {
        const p = i.parseLog({ topics: log.topics, data: log.data });
        if (p) return p;
      } catch { /* another contract */ }
    }
    return null;
  }
  const argText = (v) => (typeof v === 'string' && ethers.isAddress(v) ? addrLink(v) : Array.isArray(v) ? v.map(argText).join(', ') : esc(short(String(v), 34)));
  const logList = (logs) => `<ol class="log-list">${logs.map((l) => {
    const ev = parseEvent(l);
    const body = ev
      ? ev.fragment.inputs.map((input, k) => `<div class="log-arg"><span>${esc(input.name || String(k))}</span><div>${argText(ev.args[k])}</div></div>`).join('')
      : `<div class="log-arg"><span>topics</span><div class="hash">${l.topics.map(esc).join('<br>')}</div></div>${l.data && l.data !== '0x' ? `<div class="log-arg"><span>data</span><div class="hash">${esc(short(l.data, 66))}</div></div>` : ''}`;
    return `<li><div class="log-head"><span class="log-index">${num(Number(l.logIndex))}</span>${addrLink(l.address)}${ev ? `<b>${esc(ev.name)}</b>` : ''}</div>${body}</li>`;
  }).join('')}</ol>`;

  /** What a transaction calls, in plain words: known contracts, the Swap router and token transfers. Otherwise at least the function selector. */
  async function describeCall(x) {
    if (!x.input || x.input === '0x' || !x.to) return null;
    const known = decodeCall(x);
    if (known) return `<span class="hash">${known}</span>`;
    const d = await deployment().catch(() => null);
    if (d?.swap?.router && d.swap.router.toLowerCase() === x.to.toLowerCase() && contracts.SwapRouter) {
      try {
        const call = new ethers.Interface(contracts.SwapRouter.abi).parseTransaction({ data: x.input, value: x.value });
        const path = call.fragment.inputs.findIndex((i) => i.name === 'path');
        const names = path >= 0 ? await Promise.all([...call.args[path]].map(async (a) => (a.toLowerCase() === contracts.WAET?.address?.toLowerCase() ? coin() : (await tokenInfo(a))?.symbol ?? short(a, 6)))) : [];
        return `<span class="hash">SwapRouter.${esc(call.name)}</span>${names.length ? `<span class="muted">${names.map(esc).join(' → ')}</span>` : ''}`;
      } catch { /* another function */ }
    }
    let call = null;
    try { call = ERC20_CALLS.parseTransaction({ data: x.input }); } catch { call = null; }
    if (call) {
      const info = await tokenInfo(x.to);
      const amount = `${tokenAmount(call.args.amount, info)} ${esc(info?.symbol ?? '')}`;
      const who = call.name === 'transferFrom' ? `${addrLink(call.args.from)}<span class="muted">→</span>${addrLink(call.args.to)}` : addrLink(call.args[0]);
      return `<span class="hash">${esc(call.name)}</span>${who}<span>${amount}</span>`;
    }
    return `<span class="hash">${esc(x.input.slice(0, 10))}</span>`;
  }

  const fillHtml = (k, vars) => esc(t(k)).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  const CHAIN_NAMES = { 1: 'Ethereum', 11155111: 'Sepolia', 52401: 'Quinvium', 52402: 'Quinvium Testnet', 52403: 'Quinvium Dev' };
  const isNativeToken = (token) => !token || BigInt(token) === 0n || token.toLowerCase() === contracts.WAET?.address?.toLowerCase();
  /** Token amount with its symbol. The wrapped coin and the zero address are the network coin. */
  async function amountOf(token, value) {
    if (isNativeToken(token)) return `${aet(value, 6)} ${esc(coin())}`;
    const info = await tokenInfo(token);
    return `${tokenAmount(BigInt(value), info)} ${esc(info?.symbol ?? short(token, 6))}`;
  }
  /** One sentence about what a transaction did. Amounts come from transfers in the receipt, or from the call for a pending one. */
  async function typeSummary(x, type, transfers) {
    const args = type.call?.args;
    switch (type.kind) {
      case 'transfer': return fillHtml('sum.transfer', { amount: `${aet(x.value, 6)} ${esc(coin())}`, to: addrLink(x.to) });
      case 'tokenTransfer': {
        const from = type.call.name === 'transferFrom';
        return fillHtml('sum.transfer', { amount: await amountOf(x.to, from ? args.amount : args[1]), to: addrLink(from ? args.to : args[0]) });
      }
      case 'approve': return fillHtml('sum.approve', { who: addrLink(args[0]), amount: await amountOf(x.to, args[1]) });
      case 'mint': return fillHtml('sum.mint', { amount: await amountOf(x.to, args[1]), to: addrLink(args[0]) });
      case 'swap': {
        const path = args?.path ? [...args.path] : [];
        const input = BigInt(x.value) > 0n ? `${aet(x.value, 6)} ${esc(coin())}` : args?.amountIn !== undefined && path.length ? await amountOf(path[0], args.amountIn) : '';
        if (transfers.length) return fillHtml('sum.swap', { from: input || await amountOf(transfers[0].token, transfers[0].value), to: await amountOf(transfers.at(-1).token, transfers.at(-1).value) });
        return path.length ? fillHtml('sum.swapMin', { from: input, to: await amountOf(path.at(-1), args.amountOutMin) }) : '';
      }
      case 'bridgeOut':
        if (type.call.name !== 'send') return '';
        return fillHtml('sum.bridge', { amount: await amountOf(args.token, args.amount), chain: esc(CHAIN_NAMES[Number(args.dstChain)] ?? `chainId ${args.dstChain}`) });
      case 'wrap': return `${aet(x.value, 6)} ${esc(coin())}`;
      case 'unwrap': return `${aet(args[0], 6)} ${esc(coin())}`;
      default: return '';
    }
  }

  /** Why a transaction is still pending. Only a real problem is highlighted, not ordinary waiting for a block. */
  function pendingReason(entry) {
    if (entry && entry.waitingFor !== null && entry.waitingFor !== undefined) return { warn: true, text: fill('tx.gap', { n: num(entry.waitingFor) }) };
    if (entry?.underpriced) return { warn: true, text: t('tx.low') };
    if (stats && BigInt(stats.hashrate ?? 0) === 0n) return { warn: true, text: t('tx.noMiner') };
    return { warn: false, text: fill('tx.next', { n: num(stats?.blockTimeTarget ?? 15) }) };
  }

  // Advice for the most common errors: what happened and how to avoid it next time.
  const FAIL_TIPS = { SlippageExceeded: 'tx.tipSlippage', ERC20InsufficientAllowance: 'tx.tipAllowance', ERC20InsufficientBalance: 'tx.tipBalance', Expired: 'tx.tipExpired' };
  /** Reason for failure from the replayed transaction: contract error, revert message, internal error or out of gas. */
  function failureText(res, x) {
    if (!res) return null;
    if (res.error && res.error !== 'revert') {
      if (/out of gas/i.test(res.error)) return { text: fill('tx.outOfGas', { limit: num(BigInt(res.gasLimit ?? x.gas ?? 0)) }), tip: t('tx.tipGas'), code: res.error };
      return { text: res.error, code: null };
    }
    const data = res.data ?? '0x';
    const coder = ethers.AbiCoder.defaultAbiCoder();
    try {
      if (data.startsWith('0x08c379a0')) return { text: coder.decode(['string'], `0x${data.slice(10)}`)[0], code: 'Error(string)' };
      if (data.startsWith('0x4e487b71')) return { text: fill('tx.panic', { code: `0x${coder.decode(['uint256'], `0x${data.slice(10)}`)[0].toString(16)}` }), code: 'Panic' };
    } catch { /* corrupted data, generic message below */ }
    let name = null;
    for (const i of errorInterfaces()) {
      try { name = i.parseError(data)?.name ?? null; } catch { /* we try the next contract */ }
      if (name) break;
    }
    if (!name) return { text: t(data.length > 2 ? 'tx.revertUnknown' : 'tx.revertEmpty'), code: data.length > 2 ? data.slice(0, 10) : null };
    return { text: ERRORS[name] ? pick(ERRORS[name]) : humanize(name), tip: FAIL_TIPS[name] ? t(FAIL_TIPS[name]) : '', code: name };
  }

  async function pageTx(hash) {
    app.innerHTML = skeleton();
    const [x, r] = await Promise.all([rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
    // An unknown transaction is not a page error: either it has not arrived yet or the queue dropped it. The coins stayed with the sender.
    if (!x) {
      app.innerHTML = `${head(t('tx.title'), `<span class="hash">${esc(hash)}</span>${copyBtn(hash)}`, `<span class="badge pending">${t('tx.unknown')}</span>`)}
        <div class="notice">${t('tx.unknownNote')}</div>`;
      pageTick = () => { if (route().name === 'tx') pageTx(hash); };
      return;
    }
    const [block, queue, next, transfers, call, failure] = await Promise.all([
      x.blockNumber ? rpc('eth_getBlockByNumber', [x.blockNumber, false]) : null,
      r ? null : rpc('aether_mempool', [{ address: x.from, limit: 100 }]).catch(() => null),
      r ? null : rpc('eth_getTransactionCount', [x.from, 'pending']).catch(() => null),
      r ? tokenTransfers(r.logs) : [],
      describeCall(x),
      // For a failed transaction the node replays the block up to it and says how it ended.
      r && Number(r.status) !== 1 ? rpc('aether_txError', [hash]).catch(() => null) : null,
      typeContext(),
    ]);
    const reason = failureText(failure, x);
    const type = txType(x);
    const summary = await typeSummary(x, type, transfers).catch(() => '');
    const unit = esc(coin());
    const ok = r && Number(r.status) === 1;
    const status = !r ? `<span class="badge pending">${t('b.pending')}</span>` : ok ? `<span class="badge ok">${t('b.ok')}</span>` : `<span class="badge bad">${t('b.fail')}</span>`;
    // Without the extended queue (older node) a gap is recognised from the order: the node counts only a contiguous run of pending transactions.
    let entry = queue?.items.find((i) => i.hash.toLowerCase() === hash.toLowerCase());
    if (!entry && next !== null && BigInt(x.nonce) > BigInt(next)) entry = { waitingFor: Number(BigInt(next)) };
    const why = r ? null : pendingReason(entry);
    const n = x.blockNumber ? Number(x.blockNumber) : null;
    const base = block?.baseFeePerGas ? big(block.baseFeePerGas) : null;
    const price = r ? big(r.effectiveGasPrice) : null;
    const typ = Number(x.type ?? 0);
    const format = typ === 2 ? 'EIP-1559' : typ === 1 ? 'EIP-2930' : 'Legacy';
    app.innerHTML = `${head(t('tx.title'), `<span class="hash">${esc(hash)}</span>${copyBtn(hash)}`, status)}
      ${why?.warn ? `<div class="notice">${esc(why.text)}</div>` : ''}
      ${r && !ok ? `<div class="notice fail-note"><p>${t('tx.failedNote')}</p>${reason ? `<p><b>${t('tx.reason')}:</b> ${esc(reason.text)}</p>${reason.tip ? `<p>${esc(reason.tip)}</p>` : ''}` : ''}</div>` : ''}
      <div class="card">${kv([
        [t('t.type'), `<span class="tx-type"><strong>${t(`type.${type.kind}`)}</strong></span>${summary ? `<span class="tx-summary">${summary}</span>` : ''}`],
        [t('tx.status'), `${status}${why && !why.warn ? `<span class="muted">${esc(why.text)}</span>` : ''}`],
        reason && [t('tx.reason'), `${esc(reason.text)}${reason.code ? `<span class="muted"><code>${esc(reason.code)}</code></span>` : ''}`],
        [t('t.block'), n !== null ? `${blockLink(n)}<span class="muted">${esc(fill('tx.confirmations', { n: num(Math.max(1, (stats?.height ?? n) - n + 1)) }))}</span>` : t('b.pending')],
        block && [t('tx.time'), `${ago(Number(block.timestamp))}<span class="muted">${esc(when(Number(block.timestamp)))}</span>`],
        [t('t.from'), `${addrLink(x.from)}${copyBtn(x.from)}`],
        [t('t.to'), x.to ? `${addrLink(x.to)}${copyBtn(x.to)}` : r?.contractAddress ? `<span class="muted">${t('tx.created')}</span>${addrLink(r.contractAddress)}${copyBtn(r.contractAddress)}` : '—'],
        call && [t('tx.function'), call],
        transfers.length && [t('tx.tokens'), transferList(transfers)],
        [t('t.value'), `${aet(x.value, 18)} ${unit}`],
        r && [t('t.fee'), `${aet(big(r.gasUsed) * price, 8)} ${unit}`],
        price !== null && [t('tx.gasPrice'), `${gwei(price)} gwei${base !== null ? `<span class="muted">${esc(fill('tx.gasPriceParts', { base: gwei(base), tip: gwei(price > base ? price - base : 0n) }))}</span>` : ''}`],
        typ === 2 && [t('tx.maxFee'), esc(fill('tx.maxParts', { max: gwei(x.maxFeePerGas), tip: gwei(x.maxPriorityFeePerGas) }))],
        [t('tx.gasUse'), r ? `${num(BigInt(r.gasUsed))} / ${num(BigInt(x.gas))}<span class="muted">${pctOf(BigInt(r.gasUsed), BigInt(x.gas))}</span>` : num(BigInt(x.gas))],
        [t('tx.position'), x.transactionIndex !== null && x.transactionIndex !== undefined ? esc(fill('tx.positionValue', { nonce: num(BigInt(x.nonce)), index: num(Number(x.transactionIndex) + 1) })) : `nonce ${num(BigInt(x.nonce))}`],
        [t('tx.format'), `${format}<span class="muted">${typ}</span>`],
      ])}</div>
      ${r?.logs.length ? `<details class="card fold"><summary><h2>${t('tx.events')}</h2><span class="muted">${num(r.logs.length)}</span>${CHEVRON}</summary>${logList(r.logs)}</details>` : ''}
      ${x.input && x.input !== '0x' ? `<details class="card fold"><summary><h2>${t('tx.input')}</h2><span class="muted">${num((x.input.length - 2) / 2)} B</span>${CHEVRON}</summary><div class="cmd-block">${esc(x.input)}${copyBtn(x.input)}</div></details>` : ''}`;
    // A pending transaction switches to confirmed by itself after it is mined.
    if (!r) pageTick = () => { if (route().name === 'tx') pageTx(hash); };
  }

  const wei = (v, digits = 6) => (Number(v) / 1e18).toLocaleString(locale(), { maximumFractionDigits: digits });
  const stamp = (x) => (x ? `${blockLink(x.number)} · ${esc(when(x.timestamp))}` : '—');

  function showQr(address) {
    const box = document.createElement('div');
    box.className = 'modal-backdrop';
    box.innerHTML = `<div class="modal wallet-card" role="dialog" aria-modal="true"><button class="wallet-x" data-close aria-label="${t('wallet.close')}">×</button><h2>${t('addr.qr')}</h2>
      <div class="qr-box">${qrTag(address)}<span class="hash">${esc(address)}</span></div></div>`;
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) box.remove(); });
    document.body.appendChild(box);
  }

  const ERC20 = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
  async function tokenRows(a, list) {
    const read = provider();
    const rows = await Promise.all(list.map(async (address) => {
      try {
        const c = new ethers.Contract(address, ERC20, read);
        const [name, symbol, decimals, balance] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.balanceOf(a)]);
        return { address, ...tokenFace(address, name, symbol), value: ethers.formatUnits(balance, decimals) };
      } catch { return null; }
    }));
    return rows.filter(Boolean);
  }

  /**
   * .qu names of addresses for lists. The primary name of each address is read in one batched call (Multicall), remembered for
   * the visit, and a shortened address in a link is replaced by its name.
   */
  async function fillNames(root = app) {
    if (!contracts.AetherNames?.address || !contracts.Multicall?.address || !root) return;
    const links = [...root.querySelectorAll('a[href^="/address/0x"]')].filter((el) => /^0x[0-9a-f]+…?[0-9a-f]*$/i.test(el.textContent.trim()) && !el.closest('.page-head'));
    const addrOf = (el) => el.getAttribute('href').slice(9, 51).toLowerCase();
    const avatars = [...document.querySelectorAll('.avatar[data-addr]')];
    const profiles = await profileContracts().catch(() => null);
    const wantNames = [...new Set(links.map(addrOf))].filter((x) => ethers.isAddress(x) && !nameCache.has(x)).slice(0, 150);
    const wantIcons = profiles ? [...new Set([...links.map(addrOf), ...avatars.map((el) => el.dataset.addr)])].filter((x) => ethers.isAddress(x) && !profileCache.has(x)).slice(0, 150) : [];
    if (wantNames.length || wantIcons.length) {
      const names = new ethers.Interface(contracts.AetherNames.abi);
      const prof = new ethers.Interface(contracts.Profiles.abi);
      const multi = new ethers.Contract(contracts.Multicall.address, contracts.Multicall.abi, provider());
      const calls = wantNames.map((x) => ({ target: contracts.AetherNames.address, data: names.encodeFunctionData('nameOf', [x]) }));
      if (wantIcons.length) calls.push({ target: profiles.profiles, data: prof.encodeFunctionData('avatarsOf', [wantIcons]) });
      try {
        const [, results] = await multi.aggregate(calls);
        wantNames.forEach((x, i) => nameCache.set(x, results[i].success ? names.decodeFunctionResult('nameOf', results[i].data)[0] : ''));
        if (wantIcons.length) {
          const r = results[wantNames.length];
          const [nfts, ids, valid] = r.success ? prof.decodeFunctionResult('avatarsOf', r.data) : [[], [], []];
          const pictures = await avatarPictures(profiles, wantIcons.map((x, i) => (valid[i] ? { nft: nfts[i], id: ids[i] } : null)));
          wantIcons.forEach((x, i) => profileCache.set(x, pictures[i] ? { html: pictures[i] } : null));
        }
      } catch { return; }
    }
    for (const el of links) {
      const a = addrOf(el);
      const n = nameCache.get(a);
      const icon = profileSvg(a);
      if (icon && !el.previousElementSibling?.classList.contains('mini-profile')) el.insertAdjacentHTML('beforebegin', `<i class="avatar profile mini-profile" aria-hidden="true">${icon}</i>`);
      if (!n) continue;
      el.title = a;
      el.textContent = `${n}.qu`;
      el.classList.remove('hash');
    }
    for (const el of avatars) {
      const icon = profileSvg(el.dataset.addr);
      if (icon && !el.classList.contains('profile')) { el.classList.add('profile'); el.removeAttribute('style'); el.innerHTML = icon; }
    }
  }

  /** SHA-256 of bytes as hex. */
  const sha256Hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

  /**
   * The Profiles and Quinvium Avatars contracts of this network, only when the code at both addresses is exactly the published
   * build (deployments.json says where; anyone could deploy something else there).
   */
  let profilesChecked = null;
  async function profileContracts() {
    const d = await deployment();
    if (!d?.profiles || !d?.avatars || !contracts.Profiles?.runtimeSha256 || !contracts.QuinviumAvatars?.runtimeSha256) return null;
    const key = `${d.profiles}/${d.avatars}`;
    if (profilesChecked?.key !== key) {
      profilesChecked = { key, ok: (async () => {
        const [a, b] = await Promise.all([provider().getCode(d.profiles), provider().getCode(d.avatars)]);
        return (await sha256Hex(ethers.getBytes(a))) === contracts.Profiles.runtimeSha256 && (await sha256Hex(ethers.getBytes(b))) === contracts.QuinviumAvatars.runtimeSha256;
      })() };
    }
    return (await profilesChecked.ok) ? { profiles: d.profiles, avatars: d.avatars } : null;
  }

  const ONCHAIN_IMAGE = /^data:image\/(png|gif|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
  /** HTML of each NFT picture (or null): Quinvium Avatars from their numbers, others only from an on-chain data: image. */
  async function avatarPictures(found, list) {
    const own = new ethers.Contract(found.avatars, contracts.QuinviumAvatars.abi, provider());
    const nft = (at) => new ethers.Contract(at, ['function tokenURI(uint256) view returns (string)'], provider());
    return Promise.all(list.map(async (x, i) => {
      if (!x) return null;
      try {
        if (x.nft.toLowerCase() === found.avatars.toLowerCase()) {
          const [icon, color] = await own.traitsOf(x.id);
          return window.QuinviumProfiles?.svg(Number(icon), Number(color)) ?? null;
        }
        if (i >= 20) return null;
        const uri = await nft(x.nft).tokenURI(x.id);
        const m = /^data:application\/json(;base64)?,(.*)$/s.exec(uri);
        const image = m ? JSON.parse(m[1] ? atob(m[2]) : decodeURIComponent(m[2])).image : null;
        if (typeof image === 'string' && image.length < 200000 && ONCHAIN_IMAGE.test(image)) return `<img src="${esc(image)}" alt="">`;
        return '<span class="nft-mark">NFT</span>';
      } catch { return null; }
    }));
  }

  /**
   * Names that point to the address but are not its primary name: names it registered, and names whose target was changed to it.
   * Each candidate is checked against the current record.
   */
  async function namesPointingTo(a) {
    const c = contract('AetherNames');
    const at = contracts.AetherNames.address;
    const topic = ethers.zeroPadValue(a, 32);
    const ev = (n) => c.interface.getEvent(n).topicHash;
    const [own, moved] = await Promise.all([
      provider().getLogs({ address: at, fromBlock: 0, toBlock: 'latest', topics: [ev('Registered'), null, topic] }),
      provider().getLogs({ address: at, fromBlock: 0, toBlock: 'latest', topics: [ev('TargetChanged'), null, topic] }),
    ]);
    const nodes = [...new Set(moved.map((l) => l.topics[1]))].slice(0, 20);
    const named = nodes.length ? await provider().getLogs({ address: at, fromBlock: 0, toBlock: 'latest', topics: [ev('Registered'), nodes] }) : [];
    const candidates = [...new Set([...own, ...named].map((l) => c.interface.parseLog(l).args.name))].slice(0, 20);
    const now = Math.floor(Date.now() / 1000);
    const rows = await Promise.all(candidates.map(async (n) => { const [, target, expires] = await c.info(n); return target.toLowerCase() === a.toLowerCase() && Number(expires) > now ? n : null; }));
    return rows.filter(Boolean);
  }

  async function pageAddress(a, q) {
    app.innerHTML = skeleton();
    const tab = q.get('tab') ?? 'txs';
    const [info] = await Promise.all([rpc('aether_addressInfo', [a]), typeContext()]);
    // A pool receives block rewards from the network and pays out inside the contract: this is not visible in transactions; the page says so.
    const [isPool, operated] = await Promise.all([
      info.isContract ? contract('PoolFactory').isPool(a).catch(() => false) : false,
      info.isContract ? [] : rpc('aether_poolsOf', [a]).catch(() => []),
    ]);
    const poolInfo = isPool ? await poolSummary(a).catch(() => null) : null;
    const owned = await Promise.all(operated.map(async (x) => ({ ...x, ...(await poolSummary(x.pool).catch(() => ({}))), owed: await poolContract(x.pool).operatorOwed().catch(() => 0n) })));
    let name = '';
    try { name = await new ethers.Contract(contracts.AetherNames.address, contracts.AetherNames.abi, provider()).nameOf(a); } catch { /* no name */ }
    if (name) nameCache.set(a.toLowerCase(), name);
    const others = name || info.isContract ? [] : await namesPointingTo(a).catch(() => []);
    const symbol = info.isContract ? await new ethers.Contract(a, TOKEN_ABI, provider()).symbol().catch(() => null) : null;
    const label = labelOf(a);
    const kind = label ? t('addr.system') : info.isContract ? t('addr.contract') : t('addr.account');
    const txCount = info.sent.count + info.received.count - (info.selfCount ?? 0);
    const unit = esc(coin());
    const base = `/address/${a}`;
    const tabLink = (id, text, n) => `<a href="${base}?tab=${id}" class="${tab === id ? 'active' : ''}">${text}<small>${num(n)}</small></a>`;
    let body = '';
    if (tab === 'mined') {
      const res = await rpc('aether_blocks', [{ limit: PAGE, offset: (pageOf(q) - 1) * PAGE, miner: a, order: q.get('order') || undefined, ...timeFilter(q) }]);
      body = `${filterForm(`${rangeFields(q)}${orderField(q)}`, q)}<div class="card">${res.items.length ? blockTable(res.items) : noResults()}${pagerLinks(base, q, res.total)}</div>`;
    } else if (tab === 'pool') {
      const res = await rpc('aether_poolPayouts', [a, PAGE, (pageOf(q) - 1) * PAGE]);
      body = `<p class="result-count">${t('addr.poolTotal')}: <strong>${aet(res.sum, 4)} ${unit}</strong></p><div class="card">${res.items.length ? `<div class="table-wrap"><table><thead><tr><th>${t('t.hash')}</th><th>${t('t.age')}</th><th>${t('t.block')}</th><th>${t('nav.pools')}</th><th>${t('t.value')}</th></tr></thead><tbody>
        ${res.items.map((r) => `<tr class="rowlink" data-href="/tx/${esc(r.hash)}"><td>${txLink(r.hash)}</td><td title="${esc(when(r.timestamp))}">${ago(r.timestamp)}</td><td>${blockLink(r.number)}</td><td><a class="hash" href="/pool/${esc(r.pool)}">${esc(short(r.pool, 10))}</a></td><td>${aet(r.amount, 4)} ${unit}</td></tr>`).join('')}</tbody></table></div>` : noResults()}${pagerLinks(base, q, res.total)}</div>`;
    } else if (tab === 'transfers') {
      // What the address sent and received in tokens, including from foreign transactions: swap output, payout, a transfer from someone else.
      const res = await rpc('aether_addressTransfers', [a, PAGE, (pageOf(q) - 1) * PAGE]);
      const me = a.toLowerCase();
      const rows = await Promise.all(res.items.map(async (r) => ({ ...r, info: r.tokenId === undefined ? await tokenInfo(r.token) : null })));
      body = `${countLine(res.total, res.capped)}<div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('t.hash')}</th><th>${t('t.age')}</th><th>${t('t.type')}</th><th>${t('addr.counterparty')}</th><th class="num">${t('t.value')}</th></tr></thead><tbody>
        ${rows.map((r) => {
          const out = r.from.toLowerCase() === me;
          const dir = out && r.to.toLowerCase() === me ? 'self' : out ? 'out' : 'in';
          const other = dir === 'out' ? r.to : r.from;
          const who = BigInt(other) === 0n ? `<span class="badge">${t(dir === 'out' ? 'tokens.burn' : 'tokens.mint')}</span>` : addrLink(other);
          const amount = r.tokenId !== undefined ? `#${esc(r.tokenId)}` : tokenAmount(BigInt(r.value), r.info);
          return `<tr class="rowlink" data-href="/tx/${esc(r.hash)}"><td>${txLink(r.hash)}</td><td title="${esc(when(r.timestamp))}">${ago(r.timestamp)}</td><td><span class="tx-type">${dirBadge(dir)}</span></td><td>${who}</td><td class="num">${amount} <a href="/token/${esc(r.token)}">${esc(r.info?.symbol ?? short(r.token, 6))}</a></td></tr>`;
        }).join('')}</tbody></table></div>` : `<div class="empty">${t('addr.noTransfers')}</div>`}${pagerLinks(base, q, res.total)}</div>`;
    } else if (tab === 'tokens') {
      const rows = await tokenRows(a, info.tokens);
      body = `<div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('pools.name')}</th><th>${t('token.symbol')}</th><th>${t('t.balance')}</th><th>${t('t.address')}</th></tr></thead><tbody>${rows.map((r) => `<tr class="rowlink" data-href="/token/${esc(r.address)}"><td><a href="/token/${esc(r.address)}">${esc(r.name)}</a></td><td>${esc(r.symbol)}</td><td>${esc(r.value)}</td><td>${addrLink(r.address)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('addr.noTokens')}</div>`}</div>`;
    } else {
      const res = await rpc('aether_txs', [txQuery(q, a)]);
      body = `${filterForm(txFilterFields(q, false), q)}${countLine(res.total)}<div class="card">${res.items.length ? txTable(res.items, a) : noResults()}${pagerLinks(base, q, res.total)}</div>`;
    }
    app.innerHTML = `<div class="page-head"><div class="address-head">${avatar(a, 'large')}<div style="min-width:0"><span class="address-kind">${kind}</span><h1>${esc(label ?? (name ? `${name}.qu` : short(a, 12)))}</h1>
        <div class="address-line"><span class="hash">${esc(a)}</span>${copyBtn(a)}<button class="copy-btn" id="show-qr" title="${t('addr.qr')}">▦</button></div></div></div></div>
      <div class="metric-grid">
        ${metric(t('t.balance'), `${aet(info.balance, 4)} <em>${unit}</em>`)}
        ${metric(t('nav.txs'), num(txCount), `${num(info.received.count)} ${t('f.in').toLowerCase()} · ${num(info.sent.count)} ${t('f.out').toLowerCase()}`)}
        ${metric(t('addr.mined'), num(info.mined.blocks), info.mined.last ? `${t('t.last')} #${num(info.mined.last)}` : '')}
        ${metric(t('addr.income'), `${wei(info.mined.income, 4)} <em>${unit}</em>`)}
      </div>
      ${poolInfo ? `<div class="card pool-note"><p>${esc(fill('addr.poolNote', { name: poolInfo.name }))}</p>
        <p class="muted">${esc(fill('addr.poolNumbers', { blocks: num(info.mined.blocks), income: `${wei(info.mined.income, 4)} ${coin()}`, paid: `${aet(poolInfo.totalPaid, 4)} ${coin()}` }))}</p>
        <a class="text-link" href="/pool/${esc(a)}">${t('addr.poolOpen')}</a></div>` : ''}
      ${owned.length ? `<div class="card"><div class="card-header"><h2>${t('addr.pools')}</h2></div><div class="table-wrap"><table><thead><tr><th>${t('pools.name')}</th><th class="num">${t('pools.fee')}</th><th class="num">${t('pools.paid')}</th><th class="num">${t('addr.poolFeeOwed')}</th></tr></thead><tbody>
        ${owned.map((x) => `<tr class="rowlink" data-href="/pool/${esc(x.pool)}"><td><a href="/pool/${esc(x.pool)}">${esc(x.name ?? short(x.pool, 10))}</a></td><td class="num">${x.feeBps !== undefined ? percent(x.feeBps) : '—'}</td><td class="num">${x.totalPaid !== undefined ? `${aet(x.totalPaid, 4)} ${unit}` : '—'}</td><td class="num">${aet(x.owed, 4)} ${unit}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${info.lastSent || info.fundedBy ? `<div class="card"><div class="card-header"><h2>${t('addr.more')}</h2></div>${kv([
        info.lastSent && [t('addr.lastSent'), `${txLink(info.lastSent.hash)}<span class="muted">${ago(info.lastSent.timestamp)}</span>`],
        info.firstSent && [t('addr.firstSent'), `${txLink(info.firstSent.hash)}<span class="muted">${ago(info.firstSent.timestamp)}</span>`],
        info.fundedBy && [t('addr.fundedBy'), `${addrLink(info.fundedBy.from)}<span class="muted">${aet(info.fundedBy.value, 4)} ${unit} · ${ago(info.fundedBy.timestamp)}</span>${txLink(info.fundedBy.hash)}`],
      ])}</div>` : ''}
      <div class="card">${kv([
        [t('addr.first'), stamp(info.first)], [t('addr.last'), stamp(info.last)],
        [t('addr.received'), `${wei(info.received.value)} ${unit}`], [t('addr.sent'), `${wei(info.sent.value)} ${unit}`], [t('addr.fees'), `${wei(info.sent.fees, 8)} ${unit}`],
        info.sent.failed && [t('addr.failed'), num(info.sent.failed)], [t('addr.nonce'), num(info.nonce)], name && [t('addr.name'), `<span class="badge ok">${esc(name)}.qu</span>`],
        others.length && [t('addr.names'), `${others.map((n) => `<span class="badge">${esc(n)}.qu</span>`).join(' ')} <span class="muted">${esc(t('addr.namesHint'))}</span>${account?.toLowerCase() === a.toLowerCase() ? ` <button type="button" class="text-btn" id="set-primary">${esc(t('addr.setPrimary'))}</button><span class="tool-output hidden" id="set-primary-out"></span>` : ''}`],
        info.isContract && [t('addr.code'), `${num(info.codeSize)} B`], symbol && [t('t.token'), `<a href="/token/${esc(a)}">${esc(symbol)}</a>`],
      ])}</div>
      <div class="tabs">${tabLink('txs', t('nav.txs'), txCount)}${tabLink('transfers', t('addr.transfersTab'), info.tokenTransfers ?? 0)}${tabLink('mined', t('addr.mined'), info.mined.blocks)}${tabLink('pool', t('addr.poolTab'), info.poolPayouts)}${tabLink('tokens', t('addr.tokens'), info.tokens.length)}</div>${body}`;
    $('show-qr').onclick = () => showQr(a);
    if ($('set-primary')) {
      txButton($('set-primary'), $('set-primary-out'), (s) => contract('AetherNames', s).setPrimary(others[0]), () => { nameCache.delete(a.toLowerCase()); setTimeout(() => { render(); renderWallet(); }, 1500); return t('tool.nameFinished'); });
    }
    bindFilters(base, tab === 'txs' ? {} : { tab });
  }

  // ------------------------------------------------------------- grafy
  const CHART_RANGES = [['1h', 3600], ['24h', 86400], ['7d', 604800], ['30d', 2592000], ['all', 0]];
  const CHART_POINTS = 160;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (name, attrs, parent) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent?.appendChild(el);
    return el;
  };
  const shortNum = (v) => {
    const a = Math.abs(v);
    if (a >= 1e12) return `${(v / 1e12).toFixed(1)} T`;
    if (a >= 1e9) return `${(v / 1e9).toFixed(1)} G`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(1)} k`;
    return v.toLocaleString(locale(), { maximumFractionDigits: a < 10 ? 1 : 0 });
  };
  /** Upper bound of the axis rounded to a round number so labels are readable. */
  const niceTop = (v) => {
    if (v <= 0) return 1;
    const unit = 10 ** Math.floor(Math.log10(v));
    for (const k of [1, 1.5, 2, 3, 4, 5, 7.5, 10]) if (v <= k * unit) return k * unit;
    return 10 * unit;
  };
  const timeLabel = (sec, span) => new Date(sec * 1000).toLocaleString(locale(), span > 172800 ? { day: 'numeric', month: 'numeric' } : span > 7200 ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });

  /** A line with crosses and a label. Values go through textContent, labels never through innerHTML. */
  function lineChart(box, all, bucket, read, format, o = {}) {
    box.textContent = '';
    const items = all.filter((p) => read(p) !== null);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = t('charts.empty');
      box.appendChild(empty);
      return;
    }
    const w = box.clientWidth || 520;
    const h = box.clientHeight || 200;
    const pad = { l: 54, r: 2, t: 10, b: 22 };
    const times = items.map((p) => p.time);
    const values = items.map(read);
    const t0 = times[0];
    const t1 = times.at(-1);
    // The price moves in a narrow band; from zero it would be a flat line. Hashrate and difficulty should be read from zero.
    const spread = Math.max(...values) - Math.min(...values);
    const low = o.fit ? Math.min(...values) - (spread || Math.abs(values[0]) * 0.1 || 1) * 0.15 : 0;
    const top = o.fit ? Math.max(...values) + (spread || Math.abs(values[0]) * 0.1 || 1) * 0.15 : niceTop(Math.max(...values));
    const x = (v) => pad.l + ((v - t0) / (t1 - t0 || 1)) * (w - pad.l - pad.r);
    const y = (v) => h - pad.b - ((v - low) / (top - low)) * (h - pad.t - pad.b);
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img' }, box);
    // A chart zoomed into a narrow range (price) needs enough decimals for the axis labels to differ.
    const step = (top - low) / 3;
    const digits = Math.min(8, Math.max(0, Math.ceil(-Math.log10(step || 1)) + 1));
    const fitTick = (v) => v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const tick = o.tick ?? (o.fit && Math.abs(top) < 1e3 ? fitTick : shortNum);
    for (let i = 0; i <= 3; i++) {
      const value = low + step * i;
      svgEl('line', { class: 'grid', x1: pad.l, x2: w - pad.r, y1: y(value), y2: y(value) }, svg);
      svgEl('text', { class: 'tick', x: pad.l - 7, y: y(value) + 3, 'text-anchor': 'end' }, svg).textContent = tick(value);
    }
    const labels = t1 > t0 ? Math.min(5, Math.floor((w - pad.l) / 90)) : 0;
    for (let i = 0; i <= labels && labels; i++) {
      const at = t0 + ((t1 - t0) * i) / labels;
      svgEl('text', { class: 'tick', x: x(at), y: h - 6, 'text-anchor': i === 0 ? 'start' : i === labels ? 'end' : 'middle' }, svg).textContent = timeLabel(at, t1 - t0);
    }
    // A gap in time stays a gap: the line must not pretend data that does not exist.
    const paths = [];
    items.forEach((p, i) => {
      const gap = i && p.time - items[i - 1].time > bucket * 2.5;
      if (!i || gap) paths.push([]);
      paths.at(-1).push(`${x(p.time).toFixed(1)},${y(values[i]).toFixed(1)}`);
    });
    for (const part of paths) {
      if (part.length < 2) {
        const [cx, cy] = part[0].split(',');
        svgEl('circle', { class: 'dot', cx, cy, r: 3 }, svg);
        continue;
      }
      svgEl('path', { class: 'series', d: `M${part.join('L')}` }, svg);
    }
    const cross = svgEl('line', { class: 'cross', y1: pad.t, y2: h - pad.b, visibility: 'hidden' }, svg);
    const dot = svgEl('circle', { class: 'dot', r: 4, visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'plot-tip';
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    const blocks = document.createElement('small');
    tip.append(strong, small, blocks);
    box.appendChild(tip);
    const show = (i) => {
      const p = items[i];
      const px = x(p.time);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', y(values[i]));
      dot.setAttribute('visibility', 'visible');
      strong.textContent = format(values[i]);
      small.textContent = new Date(p.time * 1000).toLocaleString(locale());
      blocks.textContent = o.detail ? o.detail(p) : fill('charts.blocks', { n: num(p.blocks), from: num(p.first), to: num(p.last) });
      tip.style.display = 'block';
      tip.style.left = `${px > w / 2 ? Math.max(0, px - tip.offsetWidth - 12) : px + 12}px`;
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; };
    const nearest = (px) => {
      const at = t0 + ((px - pad.l) / (w - pad.l - pad.r)) * (t1 - t0);
      let best = 0;
      times.forEach((v, i) => { if (Math.abs(v - at) < Math.abs(times[best] - at)) best = i; });
      return best;
    };
    let focus = items.length - 1;
    box.tabIndex = 0;
    box.onpointermove = (e) => { focus = nearest(e.clientX - box.getBoundingClientRect().left); show(focus); };
    box.onpointerleave = hide;
    box.onblur = hide;
    box.onfocus = () => show(focus);
    box.onkeydown = (e) => {
      if (e.key === 'ArrowLeft') focus = Math.max(0, focus - 1);
      else if (e.key === 'ArrowRight') focus = Math.min(items.length - 1, focus + 1);
      else return;
      e.preventDefault();
      show(focus);
    };
  }

  /** Charts and the table are two views of the same data. Both live in the address, so they survive a page reload and a change of period. */
  async function pageCharts(q) {
    const range = CHART_RANGES.some(([id]) => id === q.get('range')) ? q.get('range') : '24h';
    const table = q.get('view') === 'table';
    // Small numbers, for example fees in tenths of a coin: axis labels are rounded to significant digits, not to zero.
    const small = (v) => (v === 0 ? '0' : v.toLocaleString(locale(), { maximumSignificantDigits: 2 }));
    const metrics = [
      ['time', t('charts.time'), (p) => p.blockTime, (v) => `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} s`],
      ['rate', t('charts.rate'), (p) => p.hashrate, (v) => rate(BigInt(Math.round(v)))],
      ['diff', t('charts.diff'), (p) => p.difficulty, (v) => compact(BigInt(Math.round(v)))],
      ['txs', t('charts.txs'), (p) => p.txs, (v) => num(v)],
      ['gas', t('charts.gas'), (p) => p.gas, (v) => shortNum(v)],
      ['slow', t('charts.slowest'), (p) => p.slowest, (v) => `${num(v)} s`],
      ['blocks', t('charts.blockCount'), (p) => p.blocks, (v) => num(Math.round(v))],
      ['util', t('charts.util'), (p) => (p.blocks && stats?.gasLimit ? (p.gas / p.blocks / stats.gasLimit) * 100 : null), (v) => `${v.toLocaleString(locale(), { maximumFractionDigits: 2 })} %`, small],
      ['active', t('charts.active'), (p) => p.activeAddresses ?? 0, (v) => num(Math.round(v))],
      ['fees', t('charts.fees'), (p) => Number(BigInt(p.fees ?? 0)) / 1e18, (v) => `${v.toLocaleString(locale(), { maximumFractionDigits: 6 })} ${coin()}`, small],
      ['avgfee', t('charts.avgFee'), (p) => (p.txs ? Number(BigInt(p.fees ?? 0)) / 1e18 / p.txs : null), (v) => `${v.toLocaleString(locale(), { maximumFractionDigits: 8 })} ${coin()}`, small],
      ['transfers', t('charts.transfers'), (p) => p.transfers ?? 0, (v) => num(Math.round(v))],
      ['contracts', t('charts.contracts'), (p) => p.contracts ?? 0, (v) => num(Math.round(v))],
      ['failed', t('charts.failed'), (p) => p.failed ?? 0, (v) => num(Math.round(v))],
    ];
    const seconds = CHART_RANGES.find(([id]) => id === range)[1];
    const now = Math.floor(Date.now() / 1000);
    const s = await rpc('aether_chartSeries', [{ from: seconds ? now - seconds : undefined, to: now, points: CHART_POINTS }]);
    const names = { '1h': t('f.r1h'), '24h': t('f.r24h'), '7d': t('f.r7d'), '30d': t('f.r30d'), all: t('f.all') };
    const link = (id, inTable) => `/charts?range=${id}${inTable ? '&view=table' : ''}`;
    const sum = (read) => s.items.reduce((total, p) => total + read(p), 0);
    const blocks = sum((p) => p.blocks);
    const seg = (href, text, on) => `<a href="${href}" class="${on ? 'active' : ''}">${esc(text)}</a>`;
    const toolbar = `<div class="chart-toolbar"><div class="seg" role="group" aria-label="${t('f.range')}">${CHART_RANGES.map(([id]) => seg(link(id, table), names[id], id === range)).join('')}</div>
      <div class="seg" role="group">${seg(link(range, false), t('nav.charts'), !table)}${seg(link(range, true), t('charts.viewTable'), table)}</div></div>`;
    const totals = `<div class="metric-grid">
      ${metric(t('t.blocks'), num(blocks))}${metric(t('charts.txs'), num(sum((p) => p.txs)))}
      ${metric(t('nh.time'), blocks ? metrics[0][3](sum((p) => p.blockTime * p.blocks) / blocks) : '—')}
      ${metric(t('charts.peak'), s.items.length ? metrics[1][3](Math.max(...s.items.map((p) => p.hashrate))) : '—')}</div>`;
    const body = !s.items.length ? `<div class="card"><div class="chart-empty">${t('charts.empty')}</div></div>`
      : table ? `<div class="card chart-table" id="chart-table"><div class="table-wrap"><table><thead><tr><th>${t('f.time')}</th><th>${t('t.blocks')}</th>${metrics.map(([, title]) => `<th class="num">${title}</th>`).join('')}</tr></thead><tbody>
        ${[...s.items].reverse().map((p) => `<tr><td>${esc(new Date(p.time * 1000).toLocaleString(locale()))}</td><td>${num(p.blocks)}</td>${metrics.map(([,, read, format]) => `<td class="num">${read(p) === null ? '—' : esc(format(read(p)))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`
        : `<div class="chart-grid">${metrics.map(([id, title]) => `<div class="card chart-card"><div class="card-header"><h2>${title}</h2><span class="chart-value" id="now-${id}"></span></div><div class="card-body"><div class="plot" id="plot-${id}"></div></div></div>`).join('')}</div>`;
    app.innerHTML = `${head(t('nav.charts'))}${toolbar}${totals}${body}`;
    if (table || !s.items.length) return;
    const draw = () => {
      for (const [id,, read, format, tick] of metrics) {
        const box = $(`plot-${id}`);
        if (!box) return;
        lineChart(box, s.items, s.bucket, read, format, tick ? { tick } : {});
        const last = read(s.items.at(-1));
        // The chart is history, the number on top is for now: after mining stops it must not show the last known hashrate.
        $(`now-${id}`).textContent = id === 'rate' ? rate(stats?.hashrate ?? 0) : last === null ? '' : format(last);
      }
    };
    draw();
    const resize = new ResizeObserver(() => { if (route().name === 'charts' && $('plot-time')) draw(); else resize.disconnect(); });
    resize.observe($('app'));
  }

  /** A link to the same page with a different value of one parameter; pagination returns to the start. */
  const withParam = (base, q, key, value, fallback) => {
    const p = new URLSearchParams(q);
    p.delete('page');
    if (value === fallback) p.delete(key); else p.set(key, value);
    const text = p.toString();
    return `${base}${text ? `?${text}` : ''}`;
  };
  const sharePct = (v) => `${(v * 100).toLocaleString(locale(), { maximumFractionDigits: v < 0.01 ? 3 : v < 0.1 ? 2 : 1 })} %`;

  /** Ranking of all miners over the whole history. The node maintains it continuously, so the page is equally fast with ten or a million miners. */
  async function pageMiners(q = new URLSearchParams()) {
    app.innerHTML = skeleton();
    const order = q.get('order') === 'last' ? 'last' : 'blocks';
    const page = pageOf(q);
    const find = q.get('address')?.trim() ?? '';
    const bad = !!find && !ethers.isAddress(find);
    const [res, top, pools] = await Promise.all([
      rpc('aether_minerList', [{ limit: PAGE, offset: (page - 1) * PAGE, order, address: find && !bad ? find : undefined }]),
      order === 'blocks' && page === 1 ? null : rpc('aether_minerList', [{ limit: 1 }]),
      poolNames(),
    ]);
    const leader = (top ?? res).items[0];
    const share = (m) => (res.blocks ? m.blocks / res.blocks : 0);
    const name = (a) => pools.get(a.toLowerCase()) ?? labelOf(a);
    const first = (page - 1) * PAGE;
    const seg = (id, label) => `<a href="${esc(withParam('/miners', q, 'order', id, 'blocks'))}" class="${order === id ? 'active' : ''}">${label}</a>`;
    let found = '';
    if (bad) found = `<p class="filter-error">${t('f.badAddress')}</p>`;
    else if (find && res.match) found = `<div class="card miner-found">${whoLink(res.match.address, pools, '?tab=mined')}<span>${esc(fill('miners.rank', { rank: num(res.match.rank), total: num(res.total), blocks: num(res.match.blocks), share: sharePct(share(res.match)) }))}</span></div>`;
    else if (find) found = `<div class="card miner-found"><span>${t('miners.notFound')}</span></div>`;
    app.innerHTML = `${head(t('nav.miners'), t('miners.sub'), `<a class="ghost-btn" href="/mining">${t('nav.mining')}</a>`)}
      <div class="metric-grid">
        ${metric(t('miners.total'), num(res.total))}
        ${metric(t('miners.active'), num(res.active))}
        ${metric(t('miners.blocks'), num(res.blocks))}
        ${metric(t('pools.top'), leader ? sharePct(share(leader)) : '—', leader ? esc(name(leader.address) ?? short(leader.address, 8)) : '')}
      </div>
      <form class="inline-search" id="miner-find" role="search"><input name="address" value="${esc(find)}" placeholder="${t('miners.find')}" aria-label="${t('miners.find')}" spellcheck="false" autocomplete="off"><button class="ghost-btn" type="submit">${t('search.go')}</button></form>
      ${found}
      <div class="card"><div class="card-header"><div class="seg">${seg('blocks', t('miners.byBlocks'))}${seg('last', t('miners.byLast'))}</div></div>
        ${res.items.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>${t('t.address')}</th><th class="num">${t('t.blocks')}</th><th class="num">${t('t.share')}</th><th>${t('t.last')}</th><th>${t('miners.first')}</th></tr></thead><tbody>
          ${res.items.map((m, i) => `<tr class="rowlink" data-href="/address/${esc(m.address)}?tab=mined"><td>${num(first + i + 1)}</td><td>${whoLink(m.address, pools, '?tab=mined')}</td><td class="num">${num(m.blocks)}</td><td class="num">${sharePct(share(m))}</td><td>${blockLink(m.last)} <span class="muted">${ago(m.lastTime)}</span></td><td>${blockLink(m.first)}</td></tr>`).join('')}
        </tbody></table></div>` : noResults()}
        ${pagerLinks('/miners', q, res.total, true)}</div>`;
    $('miner-find').onsubmit = (e) => {
      e.preventDefault();
      navigate(withParam('/miners', q, 'address', String(new FormData(e.target).get('address') ?? '').trim(), ''));
    };
  }

  // Commands show placeholder text, not the connected wallet's address: the guide is the same for everyone and reveals nothing personal.
  function pageMining() {
    const addr = t('mine.yourAddr');
    const host = location.hostname;
    const port = STRATUM_PORTS[stats?.network] ?? 3333;
    const stratum = `stratum+tcp://${host}:${port}`;
    const cmd = (c) => `<div class="cmd-block">${esc(c)}${copyBtn(c)}</div>`;
    app.innerHTML = `${head(t('nav.mining'), t('mine.sub').replace(/\bQU\b/g, esc(coin())))}
      <div class="card prose"><p>${t('mine.note')} <a class="text-link" href="/pools">${t('nav.pools')} →</a></p>
        <h3>${t('mine.own')}</h3>${cmd(`quinvium mine --address ${addr} --rpc ${rpcBase}`)}${cmd(`quintium-miner --address ${addr} --node ${rpcBase}`)}
        <h3>${t('mine.other')}</h3>
        <p>lolMiner</p>${cmd(`lolMiner --algo ETHASH --pool ${host}:${port} --user ${addr}.rig1`)}
        <p>T-Rex</p>${cmd(`t-rex -a ethash -o ${stratum} -u ${addr} -w rig1 -p x`)}
        <p>TeamRedMiner</p>${cmd(`teamredminer -a ethash -o ${stratum} -u ${addr}.rig1 -p x`)}
        <p class="muted">${esc(fill('pool.placeholderNote', { ph: addr }))}</p>
      </div>`;
  }

  // ------------------------------------------------------------- aplikace pro obory
  const toHash = (v) => (/^0x[0-9a-fA-F]{64}$/.test(v) ? v : ethers.id(v));
  const contract = (name, runner) => new ethers.Contract(contracts[name].address, contracts[name].abi, runner ?? provider());
  const at = (name, address, runner) => new ethers.Contract(address, contracts[name].abi, runner ?? provider());
  const days = (d) => Math.floor(Date.now() / 1000 + Number(String(d).replace(',', '.')) * 86400);
  const decimal = (v) => String(v).replace(/\s/g, '').replace(',', '.');
  const need = (v, ...names) => { for (const n of names) if (!v[n]) throw Object.assign(new Error(`${t('tool.missing')}: ${n}`), { missing: n }); };
  const L = (cs, en) => ({ cs, en });

  // Custom contract errors. Without translation the user would see only a code.
  const ERRORS = {
    InvalidSettings: L('Neplatné nastavení. Poplatek smí být nejvýše 5 %, kolo 16 až 5760 bloků a okno 1 až 256 kol.', 'Invalid settings. The fee can be at most 5%, a round 16 to 5760 blocks and the window 1 to 256 rounds.'),
    NothingToPay: L('Není co vybrat.', 'Nothing to withdraw.'),
    BelowMinimum: L('Částka je pod minimem této trasy.', 'The amount is below the minimum of this route.'),
    RouteClosed: L('Tato trasa je zavřená.', 'This route is closed.'),
    IsPaused: L('Most je dočasně zastavený.', 'The bridge is temporarily stopped.'),
    NotOperator: L('To smí jen provozovatel poolu.', 'Only the pool operator can do this.'),
    AlreadyNotarized: L('Tento otisk už máte zapsaný.', 'You have already recorded this fingerprint.'),
    AlreadyRevoked: L('Záznam už je odvolaný.', 'Already revoked.'),
    NotFound: L('Záznam nenalezen.', 'Record not found.'),
    NotIssuer: L('Nejdřív se zaregistrujte jako vydavatel.', 'Register as an issuer first.'),
    AlreadyIssued: L('Doklad s tímto číslem už jste vydali.', 'You have already issued this credential.'),
    InvalidExpiry: L('Platnost musí končit v budoucnu.', 'The expiry must be in the future.'),
    InvalidDeal: L('Neplatné údaje obchodu. Prodávající, kupující a rozhodce musí být různé adresy.', 'Invalid deal. Buyer, seller and arbiter must differ.'),
    NotAllowed: L('Tuto akci může provést jen jiná strana obchodu.', 'Only another party of the deal can do this.'),
    WrongState: L('V tomto stavu obchodu akce není možná.', 'Not possible in this deal state.'),
    TooEarly: L('Na tuto akci je ještě brzy.', 'Too early for this action.'),
    NothingToWithdraw: L('Nemáte co vybrat.', 'Nothing to withdraw.'),
    InvalidName: L('Neplatné jméno. Povolena jsou malá písmena, číslice a pomlčka, 3 až 32 znaků.', 'Invalid name: 3 to 32 lowercase letters, digits or hyphens.'),
    Unavailable: L('Jméno je obsazené.', 'Name is taken.'),
    NotOwner: L('Nejste vlastník.', 'You are not the owner.'),
    Expired: L('Platnost vypršela.', 'Expired.'),
    CommitmentActive: L('Závazek pro toto jméno už čeká. Zkuste to za pár minut znovu.', 'A commitment for this name is already waiting. Try again in a few minutes.'),
    CommitmentMissing: L('Závazek chybí nebo je moc starý. Začněte registraci znovu.', 'The commitment is missing or too old. Start the registration again.'),
    CommitmentTooNew: L('Ochranná lhůta ještě neuplynula. Počkejte minutu a podepište znovu.', 'The protection period has not passed yet. Wait a minute and sign again.'),
    InvalidYears: L('Neplatný počet let.', 'Invalid number of years.'),
    WrongPayment: L('Zaplacená částka neodpovídá ceně jména.', 'The payment does not match the name price.'),
    ZeroAddress: L('Adresa nesmí být nulová.', 'The address must not be zero.'),
    SlippageExceeded: L('Kurz se mezi odhadem a vytěžením změnil víc, než dovolovala nastavená tolerance, proto směna neproběhla.', 'The rate moved more than the slippage tolerance allows between the estimate and the block, so the swap did not happen.'),
    InsufficientLiquidity: L('V poolu není dost likvidity.', 'The pool does not have enough liquidity.'),
    InsufficientAmount: L('Částka je příliš malá.', 'The amount is too small.'),
    NoPair: L('Pro tuto dvojici neexistuje pool.', 'There is no pool for this pair.'),
    InvalidPath: L('Neplatná cesta směny.', 'Invalid swap route.'),
    NativeFailed: L('Převod hlavní mince se nepodařil.', 'The coin transfer failed.'),
    ERC20InsufficientBalance: L('Na účtu nebylo dost tokenu.', 'The account did not have enough of the token.'),
    ERC20InsufficientAllowance: L('Token nebyl pro kontrakt schválený v potřebné výši.', 'The token was not approved for the contract in the needed amount.'),
    ERC20InvalidReceiver: L('Neplatný příjemce.', 'Invalid recipient.'),
    ERC721NonexistentToken: L('Položka s tímto číslem neexistuje.', 'There is no item with this number.'),
    OwnableUnauthorizedAccount: L('To smí jen tvůrce.', 'Only the creator can do this.'),
    NotCustodian: L('Zboží teď nedržíte.', 'You do not hold this item.'),
    NotPending: L('Předání není určené vám.', 'This transfer is not for you.'),
    Closed: L('Položka je uzavřená.', 'Item is closed.'),
    UnknownItem: L('Položka neexistuje.', 'Unknown item.'),
    InvalidPoll: L('Neplatné hlasování. Potřebuje alespoň dvě možnosti a konec v budoucnu.', 'Invalid poll: at least two options and a future end.'),
    PollEnded: L('Hlasování skončilo.', 'Poll has ended.'),
    PollNotEnded: L('Hlasování ještě neskončilo.', 'The poll has not ended yet.'),
    AlreadyVoted: L('Už jste hlasovali.', 'You have already voted.'),
    NotEligible: L('Nejste na seznamu oprávněných.', 'You are not on the voter list.'),
    InvalidOption: L('Tato možnost neexistuje.', 'No such option.'),
    NotEnoughConfirmations: L('Chybí schválení dalších majitelů.', 'More owner approvals are needed.'),
    AlreadyConfirmed: L('Už jste schválili.', 'You have already approved.'),
    NotConfirmed: L('Tento návrh jste neschválili.', 'You have not approved this proposal.'),
    AlreadyExecuted: L('Návrh už je provedený.', 'Proposal already executed.'),
    UnknownProposal: L('Návrh neexistuje.', 'Unknown proposal.'),
    InvalidConfig: L('Neplatné nastavení majitelů.', 'Invalid owner settings.'),
    OnlyThroughProposal: L('Tuto změnu musí majitelé schválit návrhem.', 'The owners must approve this change through a proposal.'),
    CallFailed: L('Platba z peněženky se nepodařila. Má peněženka dost mincí?', 'The payment from the wallet failed. Does the wallet hold enough coins?'),
    MintingDisabled: L('Tento token další ražbu neumožňuje.', 'This token cannot be minted further.'),
  };

  const errorInterfaces = () => Object.values(contracts).map((c) => new ethers.Interface(c.abi));
  function errorText(e) {
    const data = e.data ?? e.info?.error?.data ?? e.error?.data;
    let name = e.revert?.name;
    if (!name && typeof data === 'string' && data.length >= 10) {
      for (const i of errorInterfaces()) {
        try { name = i.parseError(data)?.name; } catch { /* we try the next one */ }
        if (name) break;
      }
    }
    if (name) return ERRORS[name] ? pick(ERRORS[name]) : name;
    return e.shortMessage ?? e.message;
  }

  /**
   * Name registration has two steps so it cannot be front-run: a commitment, and a minute later the registration itself.
   * The random salt of the commitment is kept in this browser until the registration is confirmed (it is not sensitive: the commitment
   * also binds the sender, so nobody else can use it), so a closed page or a rejected second
   * signature can be finished later (the commitment is valid for a day). A name that points to the account and is its first one is
   * also set as primary, so it is shown instead of the address.
   */
  const pendingNameKey = (me) => `quinvium.pendingName.${stats?.chainId}.${String(me).toLowerCase()}`;
  function pendingName(me) {
    try { const p = JSON.parse(store.get(pendingNameKey(me)) ?? 'null'); return p?.name && p?.salt && p?.target ? p : null; } catch { return null; }
  }
  async function registerName(v, s, progress) {
    need(v, 'name');
    const c = contract('AetherNames', s);
    const me = await s.getAddress();
    const target = v.target || me;
    const [age, maxAge] = (await Promise.all([c.MIN_COMMIT_AGE(), c.MAX_COMMIT_AGE()])).map(Number);
    let committed = 0;
    let salt = null;
    const saved = pendingName(me);
    if (saved && saved.name === v.name && saved.target.toLowerCase() === target.toLowerCase()) {
      const at = Number(await c.commitments(await c.commitment(v.name, me, target, saved.salt)));
      const now = (await provider().getBlock('latest')).timestamp;
      if (at && now <= at + maxAge) { committed = at; salt = saved.salt; progress(t('tool.nameResume')); }
    }
    if (!committed) {
      if (!(await c.available(v.name))) throw Object.assign(new Error('Unavailable'), { revert: { name: 'Unavailable' } });
      salt = ethers.hexlify(ethers.randomBytes(32));
      store.set(pendingNameKey(me), JSON.stringify({ name: v.name, target, salt }));
      progress(t('tool.nameStep1'));
      const sent = await c.commit(await c.commitment(v.name, me, target, salt));
      // Blocks are read from the Explorer's node, not through the wallet: a wallet may report new blocks late.
      const receipt = await provider().waitForTransaction(sent.hash);
      if (!receipt?.status) throw new Error(t('tool.failed'));
      committed = (await provider().getBlock(receipt.blockNumber)).timestamp;
    }
    for (;;) {
      const latest = await provider().getBlock('latest');
      const left = committed + age - latest.timestamp;
      if (left <= 0) break;
      progress(`${t('tool.nameStep2')} ${left} s`);
      await new Promise((r) => setTimeout(r, Math.min(left * 1000, 3000)));
    }
    // Step 2 is a click of its own: the wallet's window then opens in front of the user and is not missed.
    if (!v.finish) throw Object.assign(new Error(t('tool.nameReady')), { nextStep: true });
    progress(t('tool.nameStep3'));
    const tx = await c.register(v.name, 1, target, salt, { value: await c.pricePerYear(v.name) });
    const r = await tx.wait();
    if (r?.status) {
      store.del(pendingNameKey(me));
      if (target.toLowerCase() === me.toLowerCase() && !(await c.nameOf(me).catch(() => ''))) {
        progress(t('tool.namePrimary'));
        // A rejected signature leaves the name registered; "Set as primary" does it later.
        try { if ((await (await c.setPrimary(v.name)).wait())?.status) tx.primarySet = true; } catch { /* not set */ }
      }
    }
    return tx;
  }

  // Result rows: label and value. An address is a link, status a coloured label, a list rows below each other.
  const line = (label, value) => ({ label, value });
  const addrLine = (label, address) => ({ label, address });
  const stateLine = (label, value, tone = '') => ({ label, value, tone });
  const listLine = (label, items) => ({ label, items });
  const STATUS = L('Stav', 'Status');
  const NOT_FOUND = L('Nenalezeno', 'Not found');
  const coinAmount = (wei) => `${units(wei, 18, 6)} ${coin()}`;
  const noZero = (a) => a && a !== ethers.ZeroAddress;
  /** A new record from an event: shows the number or address and fills it into the form; the next steps use it directly. */
  const created = (events, name, field, label, key = 0) => {
    const e = events.find((x) => x.name === name);
    if (!e) return {};
    const value = String(e.args[key]);
    return { fill: { [field]: value }, lines: [ethers.isAddress(value) ? addrLine(label, value) : line(label, value)], note: L('Je doplněné ve formuláři, další kroky ho použijí.', 'It is filled in the form for the next steps.') };
  };

  /**
   * Apps for various fields. Each has tasks (record, verify, revoke…) and each task shows only its own fields. Field values
   * stay when switching tasks, so the number of a new item or the address of a new collection serves the next steps directly.
   */
  const TOOLS = [
    { key: 'notary', tag: L('Právo · Zdravotnictví · Archivace', 'Legal · Health · Archives'), title: L('Notář', 'Notary'),
      desc: L('Doložte, že dokument existoval v daném čase, a to beze změny. Do sítě jde jen otisk, ne obsah. Záznam nedokazuje autorství, jen existenci a kdo ji zapsal.', 'Prove a document existed at a given time. Only its fingerprint goes on chain. It proves existence and who recorded it, not authorship.'),
      file: 'hash',
      fields: { hash: L('Dokument: text nebo otisk', 'Document: text or fingerprint'), note: L('Poznámka', 'Note'), author: L('Adresa, která dokument zapsala', 'Address that recorded it'), reason: L('Důvod odvolání', 'Reason for revoking') },
      tasks: [
        { id: 'write', label: L('Zapsat', 'Record'), fields: ['hash', 'note'], optional: ['note'],
          hint: L('Do řetězce jde jen otisk dokumentu. Obsah z něj zpětně zjistit nejde.', 'Only the document fingerprint goes on chain. The content cannot be recovered from it.'),
          run: (v, s) => contract('Notary', s).notarize(toHash(v.hash), v.note ?? ''),
          done: (e, v, me) => ({ fill: { author: me }, lines: [line(L('Otisk', 'Fingerprint'), toHash(v.hash))] }) },
        { id: 'read', label: L('Ověřit', 'Verify'), fields: ['hash', 'author'], optional: ['author'],
          hint: L('Stačí stejný text nebo soubor jako při zápisu. Dokument se nikam neposílá, porovná se jen otisk.', 'Use the same text or file as when it was recorded. The document is not sent anywhere, only the fingerprint is compared.'),
          read: async (v) => {
            const c = contract('Notary');
            const hash = toHash(v.hash);
            const author = v.author || await c.firstAuthor(hash);
            const [ok, ts, revoked, note] = await c.verify(hash, author);
            if (!ok) return [stateLine(STATUS, NOT_FOUND, 'bad'), line(L('Otisk', 'Fingerprint'), hash)];
            return [
              stateLine(STATUS, Number(revoked) ? L('Odvoláno', 'Revoked') : L('Platné', 'Valid'), Number(revoked) ? 'bad' : 'ok'),
              addrLine(L('Zapsal', 'Recorded by'), author),
              line(L('Zapsáno', 'Recorded'), when(ts)),
              Number(revoked) && line(L('Odvoláno', 'Revoked'), when(revoked)),
              note && line(L('Poznámka', 'Note'), note),
              line(L('Otisk', 'Fingerprint'), hash),
            ];
          } },
        { id: 'revoke', label: L('Odvolat', 'Revoke'), fields: ['hash', 'reason'], optional: ['reason'],
          hint: L('Odvolat jde jen vlastní zápis. Dál bude vidět, že existoval a kdy byl odvolán.', 'You can only revoke your own record. It stays visible that it existed and when it was revoked.'),
          run: (v, s) => contract('Notary', s).revoke(toHash(v.hash), v.reason ?? '') },
      ] },

    { key: 'credentials', tag: L('Školství · Profese · Úřady', 'Education · Professions'), title: L('Certifikáty', 'Credentials'),
      desc: L('Ověřitelné diplomy a licence. Jméno vydavatele si každý uvádí sám, proto ověřujte adresu vydavatele z jeho oficiálního webu.', 'Verifiable diplomas and licences. Anyone can claim a name, so check the issuer address from its official website.'),
      fields: { name: L('Název vydavatele', 'Issuer name'), website: L('Web vydavatele', 'Issuer website'), id: L('Číslo nebo kód dokladu', 'Credential number or code'), subject: L('Adresa držitele', 'Holder address'), schema: L('Typ dokladu, třeba Bakalář', 'Credential type, e.g. Bachelor'), issuer: L('Adresa vydavatele', 'Issuer address'), reason: L('Důvod odvolání', 'Reason for revoking') },
      tasks: [
        { id: 'register', label: L('Registrovat vydavatele', 'Register issuer'), fields: ['name', 'website'], optional: ['website'],
          hint: L('Jednou za adresu. Teprve potom jde vydávat doklady.', 'Once per address. Only then can you issue credentials.'),
          run: (v, s) => contract('Credentials', s).registerIssuer(v.name, v.website ?? ''),
          done: (e, v, me) => ({ fill: { issuer: me } }) },
        { id: 'write', label: L('Vydat doklad', 'Issue credential'), fields: ['id', 'subject', 'schema'], optional: ['schema'],
          hint: L('Číslo dokladu volíte sami, třeba číslo diplomu. Jedno číslo jde vydat jen jednou.', 'You choose the number, for example the diploma number. Each number can be issued only once.'),
          run: (v, s) => contract('Credentials', s).issue(toHash(v.id), v.subject, toHash(v.schema ?? 'obecny'), 0),
          done: (e, v, me) => ({ fill: { issuer: me } }) },
        { id: 'read', label: L('Ověřit doklad', 'Verify credential'), fields: ['id', 'issuer'],
          hint: L('Adresu vydavatele berte z jeho oficiálního webu. Název vydavatele si může uvést kdokoli.', 'Take the issuer address from its official website. Anyone can claim an issuer name.'),
          read: async (v) => {
            const c = contract('Credentials');
            const id = toHash(v.id);
            const r = await c.get(v.issuer, id);
            if (!Number(r.issuedAt)) return [stateLine(STATUS, L('Tento vydavatel doklad nevydal', 'This issuer has not issued it'), 'bad')];
            const [valid, info] = await Promise.all([c.isValid(v.issuer, id), c.issuers(v.issuer)]);
            return [
              stateLine(STATUS, valid ? L('Platný', 'Valid') : Number(r.revokedAt) ? L('Odvolaný', 'Revoked') : L('Platnost vypršela', 'Expired'), valid ? 'ok' : 'bad'),
              line(L('Vydavatel o sobě uvádí', 'Issuer says it is'), info.name || '—'),
              info.website && line(L('Web vydavatele', 'Issuer website'), info.website),
              addrLine(L('Držitel', 'Holder'), r.subject),
              line(L('Vydáno', 'Issued'), when(r.issuedAt)),
              line(L('Platí do', 'Valid until'), Number(r.expiresAt) ? when(r.expiresAt) : L('bez omezení', 'no limit')),
              Number(r.revokedAt) && line(L('Odvoláno', 'Revoked'), when(r.revokedAt)),
            ];
          } },
        { id: 'revoke', label: L('Odvolat doklad', 'Revoke credential'), fields: ['id', 'reason'], optional: ['reason'],
          hint: L('Odvolat jde jen doklad, který jste sami vydali.', 'You can only revoke a credential you issued.'),
          run: (v, s) => contract('Credentials', s).revoke(toHash(v.id), v.reason ?? '') },
      ] },

    { key: 'supply', tag: L('Logistika · Potraviny · Farmacie', 'Logistics · Food · Pharma'), title: L('Dodavatelský řetězec', 'Supply chain'),
      desc: L('Celá cesta zboží od výrobce k zákazníkovi. Předání musí potvrdit obě strany.', 'The journey of goods from maker to customer, confirmed by both sides.'),
      fields: { sku: L('Označení zboží, třeba KAVA-001', 'Product code, e.g. COFFEE-001'), id: L('Číslo položky', 'Item number'), location: L('Místo', 'Location'), status: L('Stav, třeba expedováno', 'Status, e.g. shipped'), to: L('Adresa příjemce', 'Recipient address') },
      tasks: [
        { id: 'write', label: L('Nová položka', 'New item'), fields: ['sku'],
          hint: L('Položku zakládá výrobce. Dostane číslo, pod kterým ji pak najde každý.', 'The maker creates the item. It gets a number anyone can then look it up by.'),
          run: (v, s) => contract('SupplyChain', s).create(v.sku),
          done: (e) => created(e, 'ItemCreated', 'id', L('Číslo položky', 'Item number')) },
        { id: 'read', label: L('Zobrazit', 'Show'), fields: ['id'],
          read: async (v) => {
            const c = contract('SupplyChain');
            const it = await c.getItem(v.id);
            const steps = [];
            for (let i = 0; i < Number(it.stepCount); i++) { const s = await c.getStep(v.id, i); steps.push(`${when(s.time)}: ${s.location} (${s.status})`); }
            const handing = noZero(it.pendingCustodian);
            return [
              line(L('Zboží', 'Product'), it.sku),
              stateLine(STATUS, it.closed ? L('Uzavřená', 'Closed') : handing ? L('Čeká na převzetí', 'Awaiting acceptance') : L('Na cestě', 'In transit'), it.closed ? '' : 'pending'),
              addrLine(L('Vytvořil', 'Created by'), it.creator),
              addrLine(L('Teď drží', 'Now held by'), it.custodian),
              handing && addrLine(L('Předává se adrese', 'Being handed to'), it.pendingCustodian),
              listLine(L('Cesta', 'Journey'), steps),
            ];
          } },
        { id: 'step', label: L('Přidat krok', 'Add step'), fields: ['id', 'location', 'status'],
          hint: L('Krok přidává ten, kdo zboží právě drží.', 'The current holder adds steps.'),
          run: (v, s) => contract('SupplyChain', s).addStep(v.id, v.location, v.status, ethers.ZeroHash) },
        { id: 'offer', label: L('Nabídnout předání', 'Offer transfer'), fields: ['id', 'to'],
          hint: L('Předání platí, až ho příjemce potvrdí.', 'The handover counts once the recipient accepts it.'),
          run: (v, s) => contract('SupplyChain', s).offerTransfer(v.id, v.to) },
        { id: 'accept', label: L('Převzít zboží', 'Accept item'), fields: ['id'],
          hint: L('Potvrzuje příjemce, kterému bylo zboží nabídnuto.', 'Done by the recipient the item was offered to.'),
          run: (v, s) => contract('SupplyChain', s).acceptTransfer(v.id) },
        { id: 'close', label: L('Uzavřít položku', 'Close item'), fields: ['id'],
          hint: L('Uzavřená položka už další kroky nepřijme.', 'A closed item accepts no further steps.'),
          run: (v, s) => contract('SupplyChain', s).close(v.id) },
      ] },

    { key: 'escrow', tag: L('Obchod · Služby · Reality', 'Commerce · Services · Real estate'), title: L('Úschova plateb', 'Escrow'),
      desc: L('Peníze drží kontrakt do splnění dohody. Ve sporu rozhodne předem zvolený rozhodce. Když do 90 dnů nerozhodne, strany se rozdělí napůl.', 'Funds are held until the deal is done. An agreed arbiter settles disputes. Without a ruling in 90 days the parties split the funds.'),
      fields: { seller: L('Adresa prodávajícího', 'Seller address'), arbiter: L('Adresa rozhodce', 'Arbiter address'), amount: L('Částka v QU', 'Amount in QU'), days: L('Lhůta ve dnech', 'Deadline in days'), id: L('Číslo obchodu', 'Deal number'), pct: L('Podíl prodávajícího v %', 'Seller share in %') },
      tasks: [
        { id: 'write', label: L('Zaplatit do úschovy', 'Pay into escrow'), fields: ['seller', 'arbiter', 'amount', 'days'], optional: ['days'],
          hint: L('Platí kupující. Kupující, prodávající a rozhodce musí být tři různé adresy. Bez zadané lhůty platí 14 dní.', 'The buyer pays. Buyer, seller and arbiter must be three different addresses. Without a deadline it is 14 days.'),
          run: (v, s) => contract('Escrow', s).create(v.seller, v.arbiter, days(v.days ?? 14), 100, 'Quinvium Explorer', { value: ethers.parseEther(decimal(v.amount)) }),
          done: (e) => created(e, 'Created', 'id', L('Číslo obchodu', 'Deal number')) },
        { id: 'read', label: L('Zobrazit', 'Show'), fields: ['id'],
          read: async (v) => {
            const d = await contract('Escrow').get(v.id);
            if (!Number(d.state)) return [stateLine(STATUS, NOT_FOUND, 'bad')];
            const [state, tone] = [null, [L('Zaplaceno, čeká na plnění', 'Paid, awaiting delivery'), 'pending'], [L('Spor', 'Disputed'), 'bad'], [L('Uzavřeno', 'Closed'), 'ok']][Number(d.state)];
            return [
              stateLine(STATUS, state, tone),
              line(L('Částka', 'Amount'), coinAmount(d.amount)),
              addrLine(L('Kupující', 'Buyer'), d.buyer),
              addrLine(L('Prodávající', 'Seller'), d.seller),
              addrLine(L('Rozhodce', 'Arbiter'), d.arbiter),
              line(L('Lhůta', 'Deadline'), when(d.deadline)),
              Number(d.disputedAt) && line(L('Spor otevřen', 'Dispute opened'), when(d.disputedAt)),
            ];
          } },
        { id: 'release', label: L('Uvolnit platbu prodávajícímu', 'Release to seller'), fields: ['id'],
          hint: L('Kupující potvrdí, že dostal, co chtěl. Peníze pak čekají na prodávajícího.', 'The buyer confirms delivery. The money then waits for the seller.'),
          run: (v, s) => contract('Escrow', s).release(v.id) },
        { id: 'refund', label: L('Vrátit kupujícímu', 'Refund buyer'), fields: ['id'],
          hint: L('Prodávající může vrátit kdykoli, kupující až po lhůtě.', 'The seller can refund at any time, the buyer only after the deadline.'),
          run: (v, s) => contract('Escrow', s).refund(v.id) },
        { id: 'dispute', label: L('Otevřít spor', 'Open dispute'), fields: ['id'],
          hint: L('Spor otevře kupující nebo prodávající. Rozhodne rozhodce.', 'The buyer or the seller opens a dispute. The arbiter decides.'),
          run: (v, s) => contract('Escrow', s).dispute(v.id) },
        { id: 'resolve', label: L('Rozhodnout spor', 'Rule on dispute'), fields: ['id', 'pct'],
          hint: L('Jen rozhodce. Zadejte, kolik procent dostane prodávající, zbytek se vrátí kupujícímu. Rozhodce dostane 1 %.', 'Arbiter only. Enter the seller share in percent, the rest goes back to the buyer. The arbiter receives 1%.'),
          run: (v, s) => contract('Escrow', s).resolve(v.id, Math.round(Number(decimal(v.pct)) * 100)) },
        { id: 'abandon', label: L('Ukončit bez rozhodce', 'Settle without arbiter'), fields: ['id'],
          hint: L('Když rozhodce do 90 dnů od sporu nerozhodne, každá strana dostane polovinu.', 'If the arbiter does not decide within 90 days of the dispute, each side gets half.'),
          run: (v, s) => contract('Escrow', s).settleAbandoned(v.id) },
        { id: 'withdraw', label: L('Vybrat své peníze', 'Withdraw my funds'), fields: [],
          hint: L('Peníze z uzavřených obchodů čekají v kontraktu, dokud si je adresa nevybere.', 'Funds from closed deals wait in the contract until the address withdraws them.'),
          run: (v, s) => contract('Escrow', s).withdraw() },
      ] },

    { key: 'polls', tag: L('Obce · Spolky · Družstva', 'Towns · Associations · Co-ops'), title: L('Hlasování', 'Voting'),
      desc: L('Transparentní hlasování, které nejde přepsat. Každá adresa má jeden hlas. Hlasování je veřejné, tajné volby se pro něj nehodí.', 'Transparent voting that cannot be rewritten. One vote per address. Votes are public, so it does not suit secret ballots.'),
      fields: { title: L('Otázka', 'Question'), choices: L('Možnosti oddělené čárkou', 'Options separated by commas'), days: L('Délka ve dnech', 'Length in days'), id: L('Číslo hlasování', 'Poll number'), option: L('Číslo možnosti, první je 1', 'Option number, the first is 1') },
      tasks: [
        { id: 'write', label: L('Nové hlasování', 'New poll'), fields: ['title', 'choices', 'days'], optional: ['days'],
          hint: L('Aspoň dvě možnosti. Bez zadané délky trvá 7 dní.', 'At least two options. Without a length it runs for 7 days.'),
          run: (v, s) => contract('Polls', s).create(v.title, v.choices.split(',').map((x) => x.trim()).filter(Boolean), ethers.ZeroHash, days(v.days ?? 7)),
          done: (e) => created(e, 'PollCreated', 'id', L('Číslo hlasování', 'Poll number')) },
        { id: 'read', label: L('Výsledky', 'Results'), fields: ['id'],
          read: async (v) => {
            const [p, choices, votes] = await contract('Polls').get(v.id);
            if (!Number(p.endsAt)) return [stateLine(STATUS, NOT_FOUND, 'bad')];
            const open = Number(p.endsAt) > Date.now() / 1000;
            return [
              line(L('Otázka', 'Question'), p.title),
              stateLine(STATUS, open ? L('Probíhá', 'Open') : L('Skončilo', 'Ended'), open ? 'ok' : ''),
              line(L('Konec', 'Ends'), when(p.endsAt)),
              addrLine(L('Založil', 'Created by'), p.creator),
              listLine(L('Hlasy', 'Votes'), [...choices].map((x, i) => `${i + 1}. ${x}: ${votes[i]}`)),
            ];
          } },
        { id: 'vote', label: L('Hlasovat', 'Vote'), fields: ['id', 'option'],
          hint: L('Hlas je veřejný a změnit ho nejde.', 'The vote is public and cannot be changed.'),
          run: (v, s) => {
            const n = Number(v.option);
            if (!Number.isInteger(n) || n < 1) throw new Error(pick(L('Zadejte číslo možnosti od 1.', 'Enter an option number from 1.')));
            return contract('Polls', s).vote(v.id, n - 1, []);
          } },
      ] },

    { key: 'names', tag: L('Platby · Identita', 'Payments · Identity'), title: L('Jména adres', 'Names'),
      desc: L('Místo dlouhé adresy krátké jméno. Poplatek se pálí, jméno se platí na roky. Registrace trvá asi minutu a podepisujete ji dvakrát, aby jméno nikdo nepředběhl.', 'A short name instead of a long address. The fee is burned. Registration takes about a minute and two signatures, so nobody can front-run it.'),
      fields: { name: L('Jméno: malá písmena, číslice a pomlčka', 'Name: lowercase letters, digits and hyphens'), target: L('Cílová adresa', 'Target address'), to: L('Nový vlastník', 'New owner') },
      tasks: [
        { id: 'read', label: L('Vyhledat', 'Look up'), fields: ['name'],
          read: async (v) => {
            const c = contract('AetherNames');
            if (await c.available(v.name)) return [stateLine(STATUS, L('Volné', 'Available'), 'ok'), line(L('Cena za rok', 'Price per year'), coinAmount(await c.pricePerYear(v.name)))];
            const [owner, target, expires] = await c.info(v.name);
            return [stateLine(STATUS, L('Obsazené', 'Taken')), addrLine(L('Vlastník', 'Owner'), owner), addrLine(L('Ukazuje na', 'Points to'), target), line(L('Platí do', 'Valid until'), when(expires))];
          } },
        { id: 'write', label: L('Registrovat', 'Register'), fields: ['name', 'target'], optional: ['target'],
          hint: L('Bez cílové adresy jméno ukazuje na vaši adresu.', 'Without a target the name points to your address.'),
          run: registerName,
          done: (e) => {
            const r = e.find((x) => x.name === 'Registered');
            return r ? { lines: [line(L('Jméno', 'Name'), `${r.args.name}.qu`), line(L('Platí do', 'Valid until'), when(r.args.expires))] } : {};
          } },
        { id: 'renew', label: L('Prodloužit o rok', 'Renew one year'), fields: ['name'],
          run: async (v, s) => { const c = contract('AetherNames', s); return c.renew(v.name, 1, { value: await c.pricePerYear(v.name) }); } },
        { id: 'primary', label: L('Nastavit jako hlavní', 'Set as primary'), fields: ['name'],
          hint: L('Hlavní jméno se ukazuje místo vaší adresy.', 'The primary name is shown instead of your address.'),
          run: (v, s) => contract('AetherNames', s).setPrimary(v.name) },
        { id: 'target', label: L('Změnit cílovou adresu', 'Change target'), fields: ['name', 'target'],
          run: (v, s) => contract('AetherNames', s).setTarget(v.name, v.target) },
        { id: 'transfer', label: L('Převést jméno', 'Transfer name'), fields: ['name', 'to'],
          hint: L('Nový vlastník přebírá jméno i jeho správu.', 'The new owner takes over the name and its management.'),
          run: (v, s) => contract('AetherNames', s).transfer(v.name, v.to) },
      ] },

    { key: 'token', tag: L('Firmy · Věrnostní programy · Komunity', 'Business · Loyalty · Communities'), title: L('Vlastní token', 'Your own token'),
      desc: L('Vytvořte věrnostní body nebo komunitní token bez psaní kódu. Počet tokenů je pevný.', 'Create loyalty points or a community token without code. The supply is fixed.'),
      abi: 'AetherToken',
      fields: { name: L('Název', 'Name'), symbol: L('Zkratka', 'Symbol'), supply: L('Počet tokenů', 'Supply'), token: L('Adresa tokenu', 'Token address'), to: L('Příjemce', 'Recipient'), amount: L('Množství', 'Amount') },
      tasks: [
        { id: 'write', label: L('Vytvořit token', 'Create token'), fields: ['name', 'symbol', 'supply'],
          hint: L('Všechny tokeny dostane adresa, která token vytvoří. Další už vyrazit nejde.', 'The creating address receives all tokens. No more can be minted.'),
          run: (v, s) => contract('TokenFactory', s).create(v.name, v.symbol, 18, ethers.parseEther(decimal(v.supply)), false),
          done: (e) => created(e, 'TokenCreated', 'token', L('Adresa tokenu', 'Token address')) },
        { id: 'read', label: L('Zobrazit', 'Show'), fields: ['token'],
          read: async (v) => {
            const c = at('AetherToken', v.token);
            const [name, symbol, decimals, supply] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply()]);
            const me = await connectedAddress();
            return [
              line(L('Název', 'Name'), name),
              line(L('Zkratka', 'Symbol'), symbol),
              line(L('Celkem tokenů', 'Total supply'), units(supply, decimals, 6)),
              me && line(L('Váš zůstatek', 'Your balance'), units(await c.balanceOf(me), decimals, 6)),
              addrLine(L('Adresa tokenu', 'Token address'), v.token),
            ];
          } },
        { id: 'transfer', label: L('Poslat tokeny', 'Send tokens'), fields: ['token', 'to', 'amount'],
          run: async (v, s) => { const c = at('AetherToken', v.token, s); return c.transfer(v.to, ethers.parseUnits(decimal(v.amount), await c.decimals())); } },
      ] },

    { key: 'nft', tag: L('Vstupenky · Umění · Vlastnictví', 'Tickets · Art · Ownership'), title: L('Sbírka NFT', 'NFT collection'),
      desc: L('Jedinečné položky: vstupenky, záruční listy, díla.', 'Unique items: tickets, warranties, artworks.'),
      abi: 'AetherCollection',
      fields: { name: L('Název sbírky', 'Collection name'), symbol: L('Zkratka', 'Symbol'), collection: L('Adresa sbírky', 'Collection address'), to: L('Příjemce', 'Recipient'), uri: L('Odkaz na popis položky', 'Item metadata link'), id: L('Číslo položky', 'Item number') },
      tasks: [
        { id: 'write', label: L('Vytvořit sbírku', 'Create collection'), fields: ['name', 'symbol'],
          hint: L('Položky do sbírky pak razí jen její tvůrce.', 'Only the creator of the collection can then mint items into it.'),
          run: (v, s) => contract('CollectionFactory', s).create(v.name, v.symbol),
          done: (e) => created(e, 'CollectionCreated', 'collection', L('Adresa sbírky', 'Collection address')) },
        { id: 'read', label: L('Zobrazit', 'Show'), fields: ['collection', 'id'], optional: ['id'],
          read: async (v) => {
            const c = at('AetherCollection', v.collection);
            const [name, symbol, minted] = await Promise.all([c.name(), c.symbol(), c.totalMinted()]);
            const base = [line(L('Název sbírky', 'Collection name'), name), line(L('Zkratka', 'Symbol'), symbol), line(L('Vyraženo položek', 'Items minted'), String(minted))];
            if (!v.id) return base;
            const [owner, uri] = await Promise.all([c.ownerOf(v.id), c.tokenURI(v.id)]);
            return [...base, line(L('Číslo položky', 'Item number'), v.id), addrLine(L('Vlastník', 'Owner'), owner), line(L('Odkaz na popis položky', 'Item metadata link'), uri)];
          } },
        { id: 'mint', label: L('Vyrazit položku', 'Mint item'), fields: ['collection', 'to', 'uri'],
          hint: L('Razit smí jen tvůrce sbírky. Odkaz vede na popis položky, třeba ipfs://…', 'Only the creator of the collection can mint. The link points to the item description, e.g. ipfs://…'),
          run: (v, s) => at('AetherCollection', v.collection, s).mint(v.to, v.uri),
          done: (e) => created(e, 'Transfer', 'id', L('Číslo položky', 'Item number'), 2) },
      ] },

    { key: 'multisig', tag: L('Firmy · Společné účty', 'Companies · Shared accounts'), title: L('Peněženka s více podpisy', 'Multisig wallet'),
      desc: L('Platba odejde až po schválení více lidmi. Peněženku dobijete běžnou platbou na její adresu.', 'A payment leaves only after several people approve it. Fund it with a normal payment to its address.'),
      abi: 'Multisig',
      fields: { owners: L('Adresy majitelů oddělené čárkou', 'Owner addresses separated by commas'), threshold: L('Počet potřebných podpisů', 'Required signatures'), wallet: L('Adresa peněženky', 'Wallet address'), to: L('Příjemce platby', 'Payee'), amount: L('Částka v QU', 'Amount in QU'), id: L('Číslo návrhu', 'Proposal number') },
      tasks: [
        { id: 'write', label: L('Vytvořit peněženku', 'Create wallet'), fields: ['owners', 'threshold'],
          hint: L('Peněženku pak dobijete běžnou platbou na její adresu.', 'Fund it afterwards with a normal payment to its address.'),
          run: (v, s) => contract('MultisigFactory', s).create(v.owners.split(',').map((x) => x.trim()).filter(Boolean), v.threshold),
          done: (e) => created(e, 'WalletCreated', 'wallet', L('Adresa peněženky', 'Wallet address')) },
        { id: 'read', label: L('Zobrazit', 'Show'), fields: ['wallet', 'id'], optional: ['id'],
          read: async (v) => {
            const c = at('Multisig', v.wallet);
            const [owners, threshold, total, balance] = await Promise.all([c.getOwners(), c.threshold(), c.proposalCount(), provider().getBalance(v.wallet)]);
            const out = [listLine(L('Majitelé', 'Owners'), [...owners]), line(L('Potřebné podpisy', 'Required signatures'), `${threshold} / ${owners.length}`), line(L('Zůstatek', 'Balance'), coinAmount(balance)), line(L('Návrhů', 'Proposals'), String(total))];
            if (v.id === undefined) return out;
            if (BigInt(v.id) >= total) return [...out, stateLine(L('Návrh', 'Proposal'), L('Neexistuje', 'Does not exist'), 'bad')];
            const [p, count] = await Promise.all([c.getProposal(v.id), c.confirmationCount(v.id)]);
            return [...out,
              line(L('Číslo návrhu', 'Proposal number'), v.id),
              stateLine(L('Stav návrhu', 'Proposal status'), p.executed ? L('Provedeno', 'Executed') : L('Čeká na schválení', 'Awaiting approval'), p.executed ? 'ok' : 'pending'),
              addrLine(L('Příjemce platby', 'Payee'), p.to),
              line(L('Částka', 'Amount'), coinAmount(p.value)),
              line(L('Schválení', 'Approvals'), `${count} / ${threshold}`),
            ];
          } },
        { id: 'submit', label: L('Navrhnout platbu', 'Propose payment'), fields: ['wallet', 'to', 'amount'],
          hint: L('Váš podpis se k návrhu připíše hned.', 'Your approval is added to the proposal right away.'),
          run: (v, s) => at('Multisig', v.wallet, s).submit(v.to, ethers.parseEther(decimal(v.amount)), '0x'),
          done: (e) => created(e, 'Submitted', 'id', L('Číslo návrhu', 'Proposal number')) },
        { id: 'confirm', label: L('Schválit návrh', 'Approve proposal'), fields: ['wallet', 'id'],
          run: (v, s) => at('Multisig', v.wallet, s).confirm(v.id) },
        { id: 'execute', label: L('Provést návrh', 'Execute proposal'), fields: ['wallet', 'id'],
          hint: L('Platba odejde, až má návrh dost schválení.', 'The payment leaves once the proposal has enough approvals.'),
          run: (v, s) => at('Multisig', v.wallet, s).execute(v.id) },
      ] },
  ];

  /** Events from a receipt. A genesis contract is recognised by its address, a factory contract (token, collection, wallet) by the app's ABI. */
  function receiptEvents(receipt, abi) {
    const known = new Map(Object.entries(contracts).filter(([, c]) => c.address).map(([name, c]) => [c.address.toLowerCase(), name]));
    return receipt.logs.map((log) => {
      for (const name of [known.get(log.address.toLowerCase()), abi]) {
        if (!name || !contracts[name]) continue;
        try {
          const event = new ethers.Interface(contracts[name].abi).parseLog(log);
          if (event) return event;
        } catch { /* another ABI */ }
      }
      return null;
    }).filter(Boolean);
  }

  function resultHtml(lines) {
    const text = (x) => (x && typeof x === 'object' && 'en' in x ? pick(x) : String(x ?? '—'));
    const addr = (a) => (noZero(a) ? `<a class="hash" href="/address/${esc(a)}">${esc(a)}</a>` : '—');
    const value = (l) => {
      if (l.address !== undefined) return addr(l.address);
      if (l.items) return l.items.length ? `<ul class="tool-list">${l.items.map((x) => `<li>${ethers.isAddress(x) ? addr(x) : esc(x)}</li>`).join('')}</ul>` : '—';
      if (l.tone !== undefined) return `<span class="badge ${l.tone}">${esc(text(l.value))}</span>`;
      return /^0x[0-9a-f]{64}$/i.test(String(l.value)) ? `<span class="hash">${esc(l.value)}</span>` : esc(text(l.value));
    };
    return `<dl class="tool-result">${lines.filter(Boolean).map((l) => `<dt>${esc(pick(l.label))}</dt><dd>${value(l)}</dd>`).join('')}</dl>`;
  }

  function pageApps() {
    const withCoin = (text) => text.replace(/\bQU\b/g, coin());
    app.innerHTML = `${head(t('nav.apps'))}<div class="tool-grid">${TOOLS.map((x) => `
      <details class="card tool-card" data-tool="${x.key}">
        <summary><span class="tool-tag">${esc(pick(x.tag))}</span><h2>${esc(pick(x.title))}</h2><p>${esc(pick(x.desc))}</p></summary>
        <div class="seg tool-tasks" role="group">${x.tasks.map((k) => `<button type="button" data-task="${k.id}">${esc(pick(k.label))}</button>`).join('')}</div>
        <p class="tool-hint"></p>
        <form class="tool-form" novalidate>
          ${Object.keys(x.fields).map((name) => `<label data-field="${name}"><span></span><input name="${name}" autocomplete="off" spellcheck="false"></label>`).join('')}
          ${x.file ? `<label data-field="${x.file}" data-file-label><span>${t('tool.file')}</span><input type="file" data-file="${x.file}"></label>` : ''}
          <div class="tool-actions"><button type="submit" class="primary-btn" data-run></button></div>
        </form><div class="tool-output hidden" aria-live="polite"></div>
      </details>`).join('')}
      <details class="card tool-card" data-tool="profile" id="profile-card">
        <summary><span class="tool-tag">${esc(t('prof.tag'))}</span><h2>${esc(t('prof.title'))}</h2><p>${esc(t('prof.desc'))}</p></summary>
        <div class="profile-body"></div><div class="tool-output hidden" aria-live="polite"></div>
      </details></div>`;
    const profileCard = $('profile-card');
    profileCard.addEventListener('toggle', () => { if (profileCard.open) profileTool(profileCard); });
    app.querySelectorAll('[data-file]').forEach((input) => {
      input.addEventListener('change', async () => {
        const f = input.files[0];
        if (!f) return;
        const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
        input.form.elements[input.dataset.file].value = `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      });
    });
    app.querySelectorAll('.tool-card:not(#profile-card)').forEach((card) => {
      const tool = TOOLS.find((x) => x.key === card.dataset.tool);
      const form = card.querySelector('form');
      const out = card.querySelector('.tool-output');
      const go = card.querySelector('[data-run]');
      const hint = card.querySelector('.tool-hint');
      let task = tool.tasks[0];
      const show = (html, cls = '') => { out.innerHTML = html; out.className = `tool-output rich ${cls}`; };
      const select = (next) => {
        task = next;
        card.querySelectorAll('[data-task]').forEach((b) => {
          b.classList.toggle('active', b.dataset.task === task.id);
          b.setAttribute('aria-pressed', String(b.dataset.task === task.id));
        });
        card.querySelectorAll('label[data-field]').forEach((l) => {
          const name = l.dataset.field;
          l.classList.toggle('hidden', !task.fields.includes(name));
          if (!l.hasAttribute('data-file-label')) l.querySelector('span').textContent = `${withCoin(pick(tool.fields[name]))}${task.optional?.includes(name) ? ` (${t('tool.optional')})` : ''}`;
        });
        hint.textContent = task.hint ? withCoin(pick(task.hint)) : '';
        hint.classList.toggle('hidden', !task.hint);
        go.textContent = pick(task.label);
        delete go.dataset.finish;
        out.className = 'tool-output hidden';
      };
      card.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', () => select(tool.tasks.find((k) => k.id === b.dataset.task))));
      select(task);
      // An unfinished name registration of the connected account: the card opens with it, Register finishes it.
      if (tool.key === 'names') {
        walletKnown().then(() => {
          const unfinished = account && card.isConnected ? pendingName(account) : null;
          if (!unfinished) return;
          select(tool.tasks.find((k) => k.id === 'write'));
          form.elements.name.value = unfinished.name;
          if (unfinished.target.toLowerCase() !== account.toLowerCase()) form.elements.target.value = unfinished.target;
          show(esc(t('tool.namePending').replace('{name}', `${unfinished.name}.qu`)));
          go.dataset.finish = '1';
          go.textContent = t('tool.nameFinish');
          card.open = true;
        });
      }
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const v = Object.fromEntries(task.fields.map((n) => [n, form.elements[n].value.trim()]).filter(([, x]) => x));
        const missing = task.fields.find((n) => !task.optional?.includes(n) && !v[n]);
        if (missing) {
          show(esc(`${t('tool.missing')}: ${withCoin(pick(tool.fields[missing]))}`), 'bad');
          form.elements[missing].focus();
          return;
        }
        go.disabled = true;
        try {
          if (task.read) {
            show(resultHtml(await task.read(v)));
            return;
          }
          const s = await signer();
          if (go.dataset.finish) v.finish = true;
          const tx = await task.run(v, s, (text) => show(esc(text)));
          delete go.dataset.finish;
          show(esc(`${t('tool.sent')}: ${tx.hash}`));
          const r = await tx.wait();
          if (!r.status) throw new Error(t('tool.failed'));
          const result = task.done?.(receiptEvents(r, tool.abi), v, await s.getAddress()) ?? {};
          if (tx.primarySet) result.note = { cs: t('tool.nameFinished'), en: t('tool.nameFinished') };
          for (const [name, value] of Object.entries(result.fill ?? {})) if (form.elements[name]) form.elements[name].value = value;
          if (tool.key === 'names' && account) { nameCache.delete(account.toLowerCase()); renderWallet(); }
          show(`<p class="tool-done"><strong>${t('tool.done')} #${r.blockNumber}</strong> · <a class="hash" href="/tx/${esc(tx.hash)}">${esc(short(tx.hash, 10))}</a></p>${result.lines ? resultHtml(result.lines) : ''}${result.note ? `<p class="tool-note">${esc(pick(result.note))}</p>` : ''}`, 'good');
        } catch (e) {
          if (e.nextStep) {
            go.dataset.finish = '1';
            go.textContent = t('tool.nameFinish');
            show(esc(e.message));
            return;
          }
          show(esc(e.missing ? `${t('tool.missing')}: ${withCoin(pick(tool.fields[e.missing] ?? L(e.missing, e.missing)))}` : errorText(e)), 'bad');
        } finally { go.disabled = false; }
      });
    });
  }

  /**
   * Profile settings: how the currency is shown (kept in this browser) and the profile picture. The picture is an NFT the
   * account owns, set in the Profiles contract; a Quinvium Avatar is minted here for the network fee. On a network without the
   * two contracts the card offers to deploy them: the bytecode is the published build and its SHA-256 is shown before signing.
   */
  async function profileTool(card) {
    const body = card.querySelector('.profile-body');
    const out = card.querySelector('.tool-output');
    const show = (html, cls = '') => { out.innerHTML = html; out.className = `tool-output rich ${cls}`; };
    const P = window.QuinviumProfiles;
    const coinHtml = () => `<div class="profile-section"><h3>${esc(t('prof.currency'))}</h3>
      <div class="seg" role="radiogroup"><button type="button" role="radio" data-coin="text" aria-checked="${coinStyle === 'text'}" class="${coinStyle === 'text' ? 'active' : ''}">QU</button><button type="button" role="radio" data-coin="symbol" aria-checked="${coinStyle === 'symbol'}" class="${coinStyle === 'symbol' ? 'active' : ''}">\uE000 ${esc(t('prof.symbol'))}</button></div></div>`;
    const bindCoin = () => body.querySelectorAll('[data-coin]').forEach((b) => {
      b.onclick = () => { coinStyle = b.dataset.coin; store.set('quinvium.coin', coinStyle); refreshStats(); profileTool(card); };
    });
    const found = await profileContracts().catch(() => null);
    if (!found) {
      const d = await deployment();
      const hashes = await Promise.all(['QuinviumAvatars', 'Profiles'].map(async (n) => [n, ethers.getBytes(contracts[n].bytecode).length, await sha256Hex(ethers.getBytes(contracts[n].bytecode))]));
      body.innerHTML = `${coinHtml()}<div class="profile-section"><h3>${esc(t('prof.avatar'))}</h3>
        <p class="tool-hint">${esc(d?.profiles || d?.avatars ? t('prof.badCode') : t('prof.none'))}</p>
        <dl class="tool-result">${hashes.map(([n, size, h]) => `<dt>${esc(n)}</dt><dd>${num(size)} B · SHA-256 <span class="hash">${esc(h)}</span></dd>`).join('')}</dl>
        <p class="tool-note">${esc(t('prof.source'))}</p>
        <div class="tool-actions"><button type="button" class="primary-btn" data-deploy="QuinviumAvatars">${esc(t('prof.deploy1'))}</button><button type="button" class="primary-btn" data-deploy="Profiles">${esc(t('prof.deploy2'))}</button></div></div>`;
      bindCoin();
      body.querySelectorAll('[data-deploy]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            const s = await signer();
            const name = b.dataset.deploy;
            const c = await new ethers.ContractFactory(contracts[name].abi, contracts[name].bytecode, s).deploy();
            const tx = c.deploymentTransaction();
            show(esc(`${t('tool.sent')}: ${tx.hash}`));
            const r = await provider().waitForTransaction(tx.hash);
            if (!r?.status || !r.contractAddress) throw new Error(t('tool.failed'));
            show(`<p class="tool-done"><strong>${t('tool.done')} #${r.blockNumber}</strong> · ${esc(name)} · <a class="hash" href="/tx/${esc(tx.hash)}">${esc(short(tx.hash, 10))}</a></p>
              <dl class="tool-result"><dt>${esc(t('prof.address'))}</dt><dd><a class="hash" href="/address/${esc(r.contractAddress)}">${esc(r.contractAddress)}</a></dd></dl><p class="tool-note">${esc(t('prof.deployed'))}</p>`, 'good');
          } catch (err) { show(esc(errorText(err)), 'bad'); } finally { b.disabled = false; }
        };
      });
      return;
    }
    const prof = (runner) => new ethers.Contract(found.profiles, contracts.Profiles.abi, runner ?? provider());
    const avat = (runner) => new ethers.Contract(found.avatars, contracts.QuinviumAvatars.abi, runner ?? provider());
    let current = '';
    if (account) {
      try {
        const [nft, id, valid] = await prof().avatarOf(account);
        if (valid) current = (await avatarPictures(found, [{ nft, id }]))[0] ?? '';
      } catch { /* none */ }
    }
    let icon = 1;
    let color = 0;
    let minted = null;   // a freshly minted avatar waiting to be set
    const draw = () => {
      body.innerHTML = `${coinHtml()}<div class="profile-section"><h3>${esc(t('prof.avatar'))}</h3>
        ${current ? `<div class="profile-current"><span class="avatar profile large">${current}</span><button type="button" class="ghost-btn" id="profile-clear">${esc(t('prof.clear'))}</button></div>` : ''}
        <p class="tool-hint">${esc(t('prof.mintHint'))}</p>
        <div class="profile-pick">
          <div class="profile-preview">${P.svg(icon, color)}</div>
          <div class="profile-grid" role="radiogroup" aria-label="${esc(t('prof.icon'))}">${Array.from({ length: P.count }, (_, i) => `<button type="button" role="radio" aria-checked="${i + 1 === icon}" data-icon="${i + 1}">${P.svg(i + 1, color)}</button>`).join('')}</div>
          <div class="profile-colors" role="radiogroup" aria-label="${esc(t('prof.color'))}">${P.palette.map((c, i) => `<button type="button" role="radio" aria-checked="${i === color}" data-color="${i}" style="background:${c}" aria-label="${i + 1}"></button>`).join('')}</div>
        </div>
        <div class="tool-actions">${minted ? `<button type="button" class="primary-btn" id="profile-use">${esc(t('prof.use'))}</button>` : `<button type="button" class="primary-btn" id="profile-mint">${esc(t('prof.mint'))}</button>`}</div>
        <details class="profile-other"><summary>${esc(t('prof.other'))}</summary>
          <form class="tool-form" id="profile-nft"><label><span>${esc(t('prof.nft'))}</span><input name="nft" autocomplete="off" spellcheck="false"></label><label><span>${esc(t('prof.tokenId'))}</span><input name="id" inputmode="numeric" autocomplete="off"></label>
          <p class="tool-note">${esc(t('prof.otherNote'))}</p><div class="tool-actions"><button type="submit" class="primary-btn">${esc(t('prof.use'))}</button></div></form></details></div>`;
      bindCoin();
      body.querySelectorAll('[data-icon]').forEach((b) => { b.onclick = () => { icon = Number(b.dataset.icon); minted = null; draw(); }; });
      body.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => { color = Number(b.dataset.color); minted = null; draw(); }; });
      const refresh = () => { if (account) profileCache.delete(account.toLowerCase()); renderWallet(); fillNames(document.body).catch(() => {}); };
      if ($('profile-mint')) {
        txButton($('profile-mint'), out, (s) => avat(s).mint(icon, color), (r) => {
          const ev = r.logs.map((l) => { try { return avat().interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Transfer');
          minted = ev ? ev.args.tokenId : null;
          draw();
          return t('prof.minted');
        });
      }
      if ($('profile-use')) {
        txButton($('profile-use'), out, (s) => prof(s).setAvatar(found.avatars, minted), () => { minted = null; refresh(); setTimeout(() => profileTool(card), 300); return t('prof.saved'); });
      }
      if ($('profile-clear')) txButton($('profile-clear'), out, (s) => prof(s).clear(), () => { refresh(); setTimeout(() => profileTool(card), 300); return t('prof.removed'); });
      $('profile-nft').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        try {
          if (!ethers.isAddress(f.nft.value.trim()) || !/^\d+$/.test(f.id.value.trim())) throw new Error(t('prof.badNft'));
          const s = await signer();
          const tx = await prof(s).setAvatar(f.nft.value.trim(), BigInt(f.id.value.trim()));
          show(esc(`${t('tool.sent')}: ${tx.hash}`));
          const r = await tx.wait();
          if (!r.status) throw new Error(t('tool.failed'));
          refresh();
          show(esc(t('prof.saved')), 'good');
          setTimeout(() => profileTool(card), 300);
        } catch (err) { show(esc(errorText(err)), 'bad'); }
      });
    };
    draw();
  }

  // ------------------------------------------------------------- pooly
  const STRATUM_PORTS = { mainnet: 3333, testnet: 3334, dev: 3335 };
  const BLOCK_MINUTES = 0.25;
  const poolContract = (address, runner) => new ethers.Contract(address, contracts.AetherPool.abi, runner ?? provider());
  const percent = (bps) => `${(Number(bps) / 100).toLocaleString(locale())} %`;
  const windowMinutes = (round, windowRounds) => Math.round(Number(round) * Number(windowRounds) * BLOCK_MINUTES);

  /** The height from which the network supports pools. Before it the factory is not on chain yet. */
  const poolsFrom = () => stats?.forks?.find((f) => f.name === 'pools')?.block ?? 0;

  async function poolSummary(address) {
    const c = poolContract(address);
    const [name, feeBps, roundBlocks, windowRounds, totalPaid] = await Promise.all([c.name(), c.feeBps(), c.roundBlocks(), c.windowRounds(), c.totalPaid()]);
    return { address, name, feeBps, roundBlocks, windowRounds, totalPaid };
  }

  /**
   * No further swap, deposit or transfer is allowed while a previous transaction from the account is pending. The rate estimate and the balance
   * would compute with the state before it and a second identical swap would fail, as when sent twice in quick succession.
   */
  async function nothingPending(s) {
    const me = await s.getAddress();
    const [done, all] = await Promise.all([rpc('eth_getTransactionCount', [me, 'latest']), rpc('eth_getTransactionCount', [me, 'pending'])]);
    if (BigInt(all) > BigInt(done)) throw new Error(t('swap.waitPrevious'));
  }

  /** Transaction from a form with its progress below it. */
  function txButton(button, out, send, done) {
    const show = (text, cls = '') => { out.textContent = text; out.className = `tool-output ${cls}`; };
    button.addEventListener('click', async () => {
      button.disabled = true;
      out.className = 'tool-output hidden';
      try {
        const s = await signer();
        const tx = await send(s);
        show(`${t('tool.sent')}: ${tx.hash}`);
        const r = await tx.wait();
        if (!r.status) throw new Error(t('tool.failed'));
        // The result is text, or text and a button for the next step, for example adding a token to the wallet.
        const result = await done(r);
        show(typeof result === 'string' ? result : result.text, 'good');
        if (result?.node) out.append(' ', result.node);
      } catch (e) { show(errorText(e), 'bad'); } finally { button.disabled = false; }
    });
  }

  /** Adds the token to the wallet (EIP-747); otherwise MetaMask will not find it on a foreign network. The Quinvium app shows verified tokens itself. */
  async function watchToken({ address, symbol, decimals }) {
    await connect();
    if (wrongNetwork()) await switchNetwork();
    const added = await wallet().request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address, symbol: String(symbol).slice(0, 11), decimals: Number(decimals) } } });
    if (added !== false) toast(esc(fill('wallet.tokenAdded', { symbol })));
  }
  function watchButton(token) {
    if (embedded || !token?.address) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'text-btn';
    b.textContent = fill('wallet.addToken', { symbol: token.symbol });
    b.onclick = () => watchToken(token).catch((e) => toast(esc(errorText(e))));
    return b;
  }

  const poolsNotice = () => {
    const start = poolsFrom();
    return stats.height + 1 < start ? `<div class="card notice">${esc(fill('pools.pending', { block: num(start), blocks: num(start - stats.height) }))}</div>` : '';
  };

  const SHARE_RANGES = [['24h', 86400], ['7d', 604800], ['30d', 2592000], ['all', 0]];
  const SHARE_SLOTS = 8;              // more colours could not be told apart; further pools are folded into Other
  const MAJORITY = 0.5;
  const MAJORITY_WINDOW_S = 3600;   // the largest share and the majority warning use the last hour
  const SOLO_ROWS = 5;

  const TOP_POOLS = 10;
  const POOL_PAGE = PAGE;

  /**
   * Shares come from mined blocks: the reward recipient is right in the block, so nobody can invent it. The chart shows
   * the ten strongest pools and folds the rest; the whole pool list is further down by page and with search.
   */
  async function pagePools(q) {
    await refreshStats();
    const notice = poolsNotice();
    if (notice) { app.innerHTML = `${head(t('nav.pools'), t('pools.sub'))}${notice}`; return; }
    const range = SHARE_RANGES.some(([id]) => id === q.get('range')) ? q.get('range') : '24h';
    const seconds = SHARE_RANGES.find(([id]) => id === range)[1];
    const now = Math.floor(Date.now() / 1000);
    const query = String(q.get('q') ?? '').trim().slice(0, 64);
    const page = pageOf(q);
    const [top, shares, listing, recent] = await Promise.all([
      rpc('aether_pools', [{ limit: TOP_POOLS, seconds }]),
      rpc('aether_minerShares', [{ from: seconds ? now - seconds : undefined, to: now }]),
      rpc('aether_pools', [{ limit: POOL_PAGE, offset: (page - 1) * POOL_PAGE, seconds, query }]),
      // The risk of a majority is about who mines now, not who mined most of the selected period.
      rpc('aether_minerShares', [{ from: now - MAJORITY_WINDOW_S, to: now }]),
    ]);
    const total = shares.work || 1;
    const part = (x) => ({ blocks: x?.blocks ?? 0, work: x?.work ?? 0, hashrate: x?.hashrate ?? 0, share: (x?.work ?? 0) / total });
    const sumOf = (list, key) => list.reduce((sum, x) => sum + x[key], 0);
    // A pool's colour follows the order of creation, not its place in the ranking: changing the period does not recolour it.
    const slotOf = (order) => (order < SHARE_SLOTS - 1 ? order + 1 : 0);
    const shownPools = top.items.filter((p) => p.work > 0);
    const rows = shownPools.map((p) => ({ ...p, slot: slotOf(p.order), ...part(p) }));
    const shownSet = new Set(shownPools.map((p) => p.address.toLowerCase()));
    const otherPools = shares.items.filter((x) => x.pool && !shownSet.has(x.address.toLowerCase()));
    const solo = shares.items.filter((x) => !x.pool);
    const shownSolo = solo.slice(0, SOLO_ROWS).map((x) => ({ miner: x.address, slot: 0, ...part(x) }));
    const restSolo = solo.slice(SOLO_ROWS);
    const folded = [
      ...(otherPools.length ? [{ otherPools: otherPools.length, slot: 0, ...part({ blocks: sumOf(otherPools, 'blocks'), work: sumOf(otherPools, 'work'), hashrate: sumOf(otherPools, 'hashrate') }) }] : []),
      // A single remaining solo miner is shown as itself, with a link to its address, not folded into a group.
      ...(restSolo.length === 1 ? [{ miner: restSolo[0].address, slot: 0, ...part(restSolo[0]) }] : []),
      ...(restSolo.length > 1 ? [{ others: restSolo.length, slot: 0, ...part({ blocks: sumOf(restSolo, 'blocks'), work: sumOf(restSolo, 'work'), hashrate: sumOf(restSolo, 'hashrate') }) }] : []),
    ];
    const ranked = [...rows, ...shownSolo, ...folded].sort((a, b) => b.work - a.work);
    // The largest share is computed per address: solo miners and other pools are not one player.
    const recentTotal = recent.work || 1;
    // Green dot: the address (miner or pool) found a block in the last hour, the same window as the majority warning.
    const recentSet = new Set(recent.items.filter((x) => x.blocks > 0).map((x) => x.address.toLowerCase()));
    const activeNow = (r) => (r.miner || r.address ? recentSet.has(String(r.miner ?? r.address).toLowerCase()) : r.others ? solo.slice(SOLO_ROWS).some((x) => recentSet.has(x.address.toLowerCase())) : otherPools.some((x) => recentSet.has(x.address.toLowerCase())));
    const entities = recent.items.map((x) => ({ name: top.items.find((p) => p.address.toLowerCase() === x.address.toLowerCase())?.name ?? labelOf(x.address) ?? short(x.address, 8), share: x.work / recentTotal })).sort((a, b) => b.share - a.share);
    const leader = entities[0]?.share ? entities[0] : null;
    const pct = (v) => (v * 100).toLocaleString(locale(), { minimumFractionDigits: v > 0 && v < 0.1 ? 2 : 1, maximumFractionDigits: v > 0 && v < 0.1 ? 2 : 1 });
    const names = { '24h': t('f.r24h'), '7d': t('f.r7d'), '30d': t('f.r30d'), all: t('f.all') };
    const label = (r) => (r.otherPools ? t('pools.otherPools') : r.others ? t('pools.solo') : r.miner ? esc(short(r.miner, 8)) : esc(r.name));
    const nameCell = (r) => {
      if (r.otherPools) return `<a href="#all-pools">${t('pools.otherPools')}</a><small>${esc(fill('pools.otherCount', { n: num(r.otherPools) }))}</small>`;
      if (r.others) return `<a href="/miners" title="${esc(t('pools.soloHint'))}">${esc(fill('pools.soloMore', { n: num(r.others) }))}</a><small>${esc(t('pools.soloHint'))}</small>`;
      if (r.miner) return `<a class="hash" href="/address/${esc(r.miner)}">${esc(labelOf(r.miner) ?? short(r.miner, 8))}</a><small>${t('pools.soloOne')}</small>`;
      return `<a href="/pool/${esc(r.address)}">${esc(r.name)}</a><small class="hash">${esc(short(r.address, 8))}</small>`;
    };
    const linkOf = (r) => (r.otherPools || r.others ? '' : `data-href="${r.miner ? `/address/${esc(r.miner)}` : `/pool/${esc(r.address)}`}"`);
    const segments = ranked.filter((r) => r.share > 0).map((r) => `<i class="series-${r.slot}" style="flex:${r.share.toFixed(5)} 1 0" title="${label(r)}: ${pct(r.share)} %"></i>`).join('');
    const body = ranked.map((r) => `<tr class="${linkOf(r) ? 'rowlink' : ''}" ${linkOf(r)}>
      <td><div class="share-name"><i class="series-dot series-${r.slot}${activeNow(r) ? ' live' : ''}" title="${activeNow(r) ? esc(t('pools.activeNow')) : esc(t('pools.idleNow'))}"></i><div>${nameCell(r)}</div></div></td>
      <td class="share-cell"><div class="share-track"><i style="width:${(r.share * 100).toFixed(2)}%"></i></div><b>${pct(r.share)} %</b></td>
      <td class="num">${num(r.blocks)}</td><td class="num">${rate(BigInt(Math.round(r.hashrate)))}</td>
      <td class="num">${r.address ? percent(r.feeBps) : r.otherPools ? '—' : `<span class="muted" title="${esc(t('pools.noFeeHint'))}">${t('pools.noFee')}</span>`}</td></tr>`).join('');
    const listRows = listing.items.map((p, i) => `<tr class="rowlink" data-href="/pool/${esc(p.address)}">
      <td class="num muted">${num((page - 1) * POOL_PAGE + i + 1)}</td>
      <td><div class="share-name"><i class="series-dot series-${slotOf(p.order)}${recentSet.has(p.address.toLowerCase()) ? ' live' : ''}" title="${recentSet.has(p.address.toLowerCase()) ? esc(t('pools.activeNow')) : esc(t('pools.idleNow'))}"></i><div><a href="/pool/${esc(p.address)}">${esc(p.name)}</a><small class="hash">${esc(short(p.address, 8))}</small></div></div></td>
      <td class="num">${percent(p.feeBps)}</td><td class="num">${p.work ? `${pct(p.share)} %` : '—'}</td><td class="num">${num(p.blocks)}</td>
      <td class="num">${num(p.miners)}</td><td>${p.url ? `<span class="badge ok">${t('pools.online')}</span>` : `<span class="badge pending">${t('pools.noServerShort')}</span>`}</td>
      <td>${blockLink(p.created)}</td></tr>`).join('');
    app.innerHTML = `${head(t('nav.pools'), t('pools.sub'), `<a class="primary-btn" href="/pools/new">${t('pools.create')}</a>`)}
      <div class="metric-grid">
        ${metric(t('m.hashrate'), rate(stats.hashrate))}
        ${metric(t('pools.topNow'), leader ? `<span class="${leader.share > MAJORITY ? 'bad-text' : ''}">${pct(leader.share)} %</span>` : '—', leader ? esc(leader.name) : '')}
        ${metric(t('t.blocks'), num(shares.blocks))}
        ${metric(t('pools.count'), num(top.total))}
      </div>
      ${leader && leader.share > MAJORITY && stats.network === 'mainnet' ? `<div class="notice">${esc(fill('pools.warn', { name: leader.name, p: pct(leader.share) }))}</div>` : ''}
      <div class="card">
        <div class="card-header"><h2>${t('pools.split')}</h2><div class="seg" role="group" aria-label="${t('f.range')}">${SHARE_RANGES.map(([id]) => `<a href="/pools?range=${id}" class="${id === range ? 'active' : ''}">${esc(names[id])}</a>`).join('')}</div></div>
        ${shares.blocks ? `<div class="share-bar" role="img" aria-label="${t('pools.split')}">${segments}</div>` : ''}
        ${ranked.length ? `<div class="table-wrap"><table><thead><tr><th>${t('pools.name')}</th><th>${t('t.share')}</th><th class="num">${t('t.blocks')}</th><th class="num">${t('pools.hash')}</th><th class="num">${t('pools.fee')}</th></tr></thead><tbody>${body}</tbody></table></div>` : ''}
        ${shares.blocks ? '' : `<div class="empty">${t('charts.empty')}</div>`}
      </div>
      <div class="card" id="all-pools">
        <div class="card-header"><h2>${esc(fill('pools.all', { n: num(top.total) }))}</h2>
          <form class="table-tools" id="pool-find" role="search"><input class="table-search" name="q" type="search" value="${esc(query)}" placeholder="${t('pools.find')}" aria-label="${t('pools.find')}" spellcheck="false" autocomplete="off"></form></div>
        ${listing.items.length ? `<div class="table-wrap"><table><thead><tr><th class="num">#</th><th>${t('pools.name')}</th><th class="num">${t('pools.fee')}</th><th class="num">${t('t.share')}</th><th class="num">${t('t.blocks')}</th><th class="num">${t('pools.minersCol')}</th><th>${t('pool.server')}</th><th>${t('pools.createdCol')}</th></tr></thead><tbody>${listRows}</tbody></table></div>
          ${pagerLinks('/pools', q, listing.matched, true)}`
    : `<div class="empty">${query ? esc(fill('pools.noMatch', { q: query })) : t('pools.none')}</div>`}
      </div>
      <p class="result-count">${t('pools.splitNote')}</p>`;
    $('pool-find').addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams(q);
      const text = e.target.elements.q.value.trim();
      if (text) p.set('q', text); else p.delete('q');
      p.delete('page');
      navigate(`/pools${p.toString() ? `?${p}` : ''}`);
    });
  }

  async function pageNewPool() {
    await refreshStats();
    const notice = poolsNotice();
    app.innerHTML = `${head(t('pools.create'), t('pools.createSub'), `<a class="ghost-btn" href="/pools">← ${t('nav.pools')}</a>`)}${notice}
      <div class="card tool-card form-page"><form class="tool-form" id="pool-form">
          <label>${t('pools.fName')}<input name="name" maxlength="64" autocomplete="off" spellcheck="false"></label>
          <label>${t('pools.fUrl')}<input name="url" maxlength="128" autocomplete="off" spellcheck="false" inputmode="url"></label>
          <label>${t('pools.fFee')}<input name="fee" value="1" inputmode="decimal" autocomplete="off"></label>
          <details><summary>${t('pools.advanced')}</summary>
            <label>${t('pools.fRound')}<input name="round" value="32" inputmode="numeric" autocomplete="off"></label>
            <label>${t('pools.fWindow')}<input name="window" value="16" inputmode="numeric" autocomplete="off"></label>
          </details>
          <div class="tool-actions"><button type="button" class="primary-btn" id="pool-create">${t('pools.create')}</button></div>
        </form><div class="tool-output hidden" id="pool-out"></div></div>
      <div class="card tool-card form-page"><h2>${t('pools.nextTitle')}</h2><ol class="steps-note"><li>${t('pools.next1')}</li><li>${t('pools.next2')}</li><li>${t('pools.next3')}</li></ol></div>`;
    if (notice) return;
    const form = $('pool-form');
    const factory = contract('PoolFactory');
    txButton($('pool-create'), $('pool-out'), (s) => {
      const v = Object.fromEntries(new FormData(form));
      if (!String(v.name ?? '').trim()) throw new Error(`${t('tool.missing')}: ${t('pools.fName')}`);
      const fee = Math.round(Number(String(v.fee).replace(',', '.')) * 100);
      return contract('PoolFactory', s).createPool(v.name.trim(), v.url.trim(), fee, Number(v.round), Number(v.window));
    }, async (r) => {
      const log = r.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'PoolCreated');
      if (log) setTimeout(() => navigate(`/pool/${log.args.pool}?created=1`), 1500);
      return `${t('pools.created')}: ${log?.args.pool ?? ''}`;
    });
  }

  const FEE_PAID_TOPIC = ethers.id('FeePaid(uint256)');
  const MINER_PAGE = PAGE;
  const DEVICE_PAGE = PAGE;

  /**
   * Connection instructions like large pools: server address, login name, password and ready-made commands for
   * common programs. The node's Stratum supports EthereumStratum/1.0.0 and ETHPROXY and the algorithm is standard Ethash.
   */
  function connectCard(address, url, p) {
    let host = null;
    try { host = new URL(url).hostname; } catch { /* the server address is optional */ }
    if (!host) return `<div class="card connect-card" id="connect"><div class="card-header"><h2>${t('pool.connect')}</h2><span class="badge pending">${t('pools.noServerShort')}</span></div><p class="muted">${t('pool.noServer')}</p></div>`;
    const port = STRATUM_PORTS[stats?.network] ?? 3333;
    const stratum = `stratum+tcp://${host}:${port}`;
    const who = t('mine.yourAddr');
    const user = `${who}.rig1`;
    const tools = [
      ['app', 'Quinvium', null],
      ['cli', 'quintium-miner', `quintium-miner --address ${who} --pool ${address} --node ${url} --worker rig1`],
      ['lol', 'lolMiner', `lolMiner --algo ETHASH --pool ${stratum} --user ${user}`],
      ['trex', 'T-Rex', `t-rex -a ethash -o ${stratum} -u ${who} -w rig1 -p x`],
      ['trm', 'TeamRedMiner', `teamredminer -a ethash -o ${stratum} -u ${user} -p x`],
      ['asic', t('pool.asic'), null],
    ];
    const body = (id, command) => {
      if (id === 'app') return `<p>${t('pool.viaApp')}</p>`;
      if (id === 'asic') return `${kv([[t('pool.asicUrl'), `<span class="hash">${esc(stratum)}</span>`], [t('pool.asicWorker'), `<span class="hash">${esc(user)}</span>`], [t('pool.password'), '<span class="hash">x</span>']])}<p class="muted connect-note">${t('pool.asicNote')}</p>`;
      return `<div class="doc-code"><pre>${esc(command)}</pre>${copyBtn(command)}</div>`;
    };
    return `<div class="card connect-card" id="connect"><div class="card-header"><h2>${t('pool.connect')}</h2><span class="badge ok">${t('pools.online')}</span></div>
      ${kv([
        [t('pool.stratum'), `<span class="hash">${esc(stratum)}</span>${copyBtn(stratum)}`],
        [t('pool.login'), `<span class="hash">${esc(user)}</span><span class="muted">${t('pool.loginNote')}</span>`],
        [t('pool.password'), `<span class="hash">x</span><span class="muted">${t('pool.passwordNote')}</span>`],
        [t('pool.algo'), `Ethash<span class="muted">${t('pool.algoNote')}</span>`],
        [t('pool.payout'), esc(fill('pool.payoutNote', { fee: percent(p.feeBps), n: num(windowMinutes(p.roundBlocks, p.windowRounds)) }))],
      ])}
      <div class="seg connect-tabs" role="tablist" aria-label="${t('pool.software')}">${tools.map(([id, name], i) => `<button type="button" role="tab" data-tool="${id}" class="${i ? '' : 'active'}" aria-selected="${i ? 'false' : 'true'}">${esc(name)}</button>`).join('')}</div>
      ${tools.map(([id, , command], i) => `<div class="connect-body${i ? ' hidden' : ''}" data-tool-body="${id}">${body(id, command)}</div>`).join('')}
      <p class="muted connect-note">${esc(fill('pool.placeholderNote', { ph: t('mine.yourAddr') }))} ${t('pool.connectNote')}</p></div>`;
  }

  async function pagePool(address, q = new URLSearchParams()) {
    if (!ethers.isAddress(address) || !(await contract('PoolFactory').isPool(address))) {
      app.innerHTML = `${head(t('nav.pools'))}<div class="error-box">${t('pool.notPool')}</div>`;
      return;
    }
    const c = poolContract(address);
    await walletKnown();
    const page = pageOf(q);
    const devicePage = Math.max(1, Number(q.get('dpage')) || 1);
    const search = String(q.get('miner') ?? '').trim();
    const sought = ethers.isAddress(search) ? search : null;
    const [p, operator, url, unsettled, reserved, opFee, count, settled, info, live, fees, ranking] = await Promise.all([
      poolSummary(address), c.operator(), c.url(), c.unsettled(), c.reserved(), c.operatorOwed(), c.stepCount(), c.settledSteps(),
      rpc('aether_addressInfo', [address]).catch(() => null),
      rpc('aether_poolInfo', [{ limit: DEVICE_PAGE, offset: (devicePage - 1) * DEVICE_PAGE, miner: sought ?? undefined }]).catch(() => null),
      rpc('aether_contractLogs', [address, FEE_PAID_TOPIC, 200, 0]).catch(() => ({ items: [] })),
      rpc('aether_pools', [{ query: address.toLowerCase(), limit: 1 }]).catch(() => null),
    ]);
    // Miners in the pool window by page: share counts from the chain, work and payouts directly from the contract only for the displayed ones.
    const height = stats?.height ?? Number(await rpc('eth_blockNumber'));
    const windowBlocks = Number(p.roundBlocks) * Number(p.windowRounds);
    const minerList = await rpc('aether_poolMiners', [address, Math.max(0, height - windowBlocks), { limit: MINER_PAGE, offset: (page - 1) * MINER_PAGE, miner: sought ?? undefined }])
      .catch(() => ({ items: [], total: 0, match: null }));
    const listed = sought ? (minerList.match ? [minerList.match] : []) : minerList.items;
    const miners = await Promise.all(listed.map(async (m, i) => {
      const [[total, own], pending, paid] = await Promise.all([c.windowWork(m.miner), c.pendingOf(m.miner), c.paidTo(m.miner)]);
      return { ...m, rank: m.rank ?? (page - 1) * MINER_PAGE + i + 1, share: total > 0n ? Number((own * 10000n) / total) : 0, pending, paid };
    }));
    const withdrawn = fees.items.reduce((sum, l) => sum + BigInt(l.data), 0n);
    const minersOwed = reserved > opFee ? reserved - opFee : 0n;
    // Only the node running this pool's server knows the connected devices.
    const local = live && live.address?.toLowerCase() === address.toLowerCase() ? live : null;
    const day = ranking?.items?.[0]?.address?.toLowerCase() === address.toLowerCase() ? ranking.items[0] : null;
    const unit = esc(coin());
    const steps = [];
    for (let i = Number(count) - 1; i >= 0 && i >= Number(count) - 8; i--) steps.push(c.steps(i).then((s) => ({ i, ...s.toObject() })));
    const rounds = await Promise.all(steps);
    const isOperator = account && account.toLowerCase() === operator.toLowerCase();
    const created = q.get('created') === '1' && isOperator;
    const minerPager = sought ? '' : pagerLinks(`/pool/${address}`, q, minerList.total, true);
    const devices = local?.devices ?? [];
    const devicePages = Math.max(1, Math.ceil((local?.deviceCount ?? 0) / DEVICE_PAGE));
    const deviceLink = (n) => { const x = new URLSearchParams(q); if (n > 1) x.set('dpage', n); else x.delete('dpage'); return `/pool/${address}${x.toString() ? `?${x}` : ''}`; };
    const devicePager = devicePages > 1 ? `<div class="pager">${devicePage > 1 ? `<a class="ghost-btn" href="${esc(deviceLink(devicePage - 1))}">${t('x.prev')}</a>` : ''}<span class="hint">${fill('x.page', { n: num(devicePage), of: num(devicePages) })}</span>${devicePage < devicePages ? `<a class="ghost-btn" href="${esc(deviceLink(devicePage + 1))}">${t('x.next')}</a>` : ''}</div>` : '';
    app.innerHTML = `${head(esc(p.name), t('pool.safe'))}
      ${created ? `<div class="card created-card"><h2>${t('pool.createdTitle')}</h2><ol class="steps-note"><li>${t('pool.after1')}</li><li>${t('pool.after2')}</li><li>${t('pool.after3')}</li>${url ? '' : `<li>${t('pool.after4')}</li>`}</ol></div>` : ''}
      <div class="metric-grid">
        ${metric(t('pools.fee'), percent(p.feeBps))}
        ${metric(t('pool.share24'), day && day.work ? `${(day.share * 100).toLocaleString(locale(), { maximumFractionDigits: 2 })} %` : '—', day ? esc(fill('pool.blocks24', { n: num(day.blocks) })) : '')}
        ${metric(t('pool.minersNow'), num(minerList.total ?? miners.length), local ? esc(fill('pool.devicesSub', { n: num(local.workers ?? 0) })) : '')}
        ${metric(t('pools.paid'), `${aet(p.totalPaid, 4)} ${unit}`, esc(fill('pool.windowSub', { n: num(windowMinutes(p.roundBlocks, p.windowRounds)) })))}
      </div>
      <div class="pool-columns">
        <div class="pool-main">
          ${connectCard(address, url, p)}
          <div class="card" id="pool-miners"><div class="card-header"><h2>${t('pool.miners')}</h2>
              <form class="table-tools" id="miner-find" role="search"><input class="table-search" name="miner" value="${esc(search)}" placeholder="${t('pool.findMiner')}" aria-label="${t('pool.findMiner')}" spellcheck="false" autocomplete="off"></form></div>
            <p class="muted card-note">${esc(fill('pool.minersSub', { n: num(windowMinutes(p.roundBlocks, p.windowRounds)) }))}${minerList.total ? ` · ${esc(fill('pool.minersTotal', { n: num(minerList.total) }))}` : ''}</p>
            ${miners.length ? `<div class="table-wrap"><table><thead><tr><th class="num">#</th><th>${t('pool.miner')}</th><th class="num">${t('pool.share')}</th><th class="num">${t('pool.sharesCol')}</th><th class="num">${t('pool.pendingAmount')}</th><th class="num">${t('pool.paidTo')}</th><th>${t('pool.lastShare')}</th></tr></thead><tbody>
              ${miners.map((m) => `<tr><td class="num muted">${num(m.rank)}</td><td>${addrLink(m.miner)}</td><td class="num">${percent(m.share)}</td><td class="num">${num(m.shares)}</td><td class="num">${aet(m.pending, 4)} ${unit}</td><td class="num">${aet(m.paid, 4)} ${unit}</td><td>${blockLink(m.last)}</td></tr>`).join('')}</tbody></table></div>${minerPager}`
    : `<div class="empty">${sought ? t('pool.minerNotFound') : t('pool.noMiners')}</div>`}
            ${sought ? `<div class="pager"><a class="ghost-btn" href="/pool/${esc(address)}">${t('pool.allMiners')}</a></div>` : ''}</div>
          ${local ? `<div class="card"><div class="card-header"><h2>${t('pool.devices')}</h2><span class="muted">${esc(fill('pool.devicesSub', { n: num(local.deviceCount ?? devices.length) }))}</span></div>
            ${devices.length ? `<div class="table-wrap"><table><thead><tr><th>${t('pool.miner')}</th><th>${t('pool.device')}</th><th class="num">${t('pool.hashrate')}</th><th>${t('pool.seen')}</th></tr></thead><tbody>
              ${devices.map((x) => `<tr><td>${addrLink(x.miner)}</td><td>${esc(x.worker || '—')}</td><td class="num">${rate(x.hashrate)}</td><td>${ago(x.seen)}</td></tr>`).join('')}</tbody></table></div>${devicePager}`
    : `<div class="empty">${t('pool.noDevices')}</div>`}</div>` : ''}
          ${rounds.length ? `<div class="card"><div class="card-header"><h2>${t('pool.rounds')}</h2></div><div class="table-wrap"><table><thead><tr><th>${t('pool.round')}</th><th>${t('pool.work')}</th><th>${t('pool.status')}</th></tr></thead><tbody>
            ${rounds.map((s) => `<tr><td>${num(s.round)}</td><td>${compact(s.work)}</td><td>${s.i < Number(settled) ? t('pool.settled') : t('pool.open')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        </div>
        <div class="pool-side">
          <div class="card tool-card"><h2>${t('pool.mine')}</h2>
            <form class="tool-form" id="miner-form"><label>${t('pool.lookup')}<input name="miner" value="${esc(account ?? '')}" autocomplete="off" spellcheck="false"></label>
              <div class="tool-actions"><button type="button" class="ghost-btn" id="miner-check">${t('pool.check')}</button><button type="button" class="primary-btn" id="miner-claim">${t('pool.claim')}</button></div>
            </form><div class="tool-output hidden" id="miner-out"></div></div>
          <div class="card">${kv([
            [t('t.address'), addrLink(address) + copyBtn(address)],
            [t('pool.operator'), `${addrLink(operator)}<span class="muted">${esc(fill('pool.operatorNote', { fee: percent(p.feeBps) }))}</span>`],
            [t('pool.server'), url ? `<span class="hash">${esc(url)}</span>` : t('pool.noServer')],
            local && [t('pool.payer'), `${addrLink(local.payer)}<span class="muted">${esc(fill('pool.payerNote', { value: `${aet(local.payerBalance, 4)} ${coin()}` }))}</span>`],
          ])}</div>
          <div class="card"><div class="card-header"><h2>${t('pool.money')}</h2></div>${kv([
            [t('pool.rewards'), `${aet(info?.mined?.income ?? 0, 4)} ${unit}<span class="muted">${esc(fill('pool.rewardBlocks', { n: num(info?.mined?.blocks ?? 0) }))}</span>`],
            [t('pools.paid'), `${aet(p.totalPaid, 4)} ${unit}`],
            [t('pool.reserved'), `${aet(minersOwed, 4)} ${unit}`],
            [t('pool.waiting'), `${aet(unsettled, 4)} ${unit}`],
            [t('pool.feeTotal'), `${aet(withdrawn + opFee, 4)} ${unit}<span class="muted">${esc(fill('pool.feeParts', { owed: `${aet(opFee, 4)} ${coin()}`, withdrawn: `${aet(withdrawn, 4)} ${coin()}` }))}</span>`],
          ])}</div>
          ${isOperator ? `<div class="card tool-card"><h2>${t('pool.operator')}</h2><form class="tool-form" id="op-form">
            <label>${t('pool.server')}<input name="url" value="${esc(url)}" maxlength="128" autocomplete="off" spellcheck="false"></label>
            <div class="tool-actions"><button type="button" class="ghost-btn" id="op-url">${t('pool.setUrl')}</button><button type="button" class="primary-btn" id="op-fee">${t('pool.feeWithdraw')} (${aet(opFee, 4)} ${esc(coin())})</button></div>
          </form><div class="tool-output hidden" id="op-out"></div></div>` : ''}
        </div>
      </div>`;
    app.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      app.querySelectorAll('[data-tool]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); });
      app.querySelectorAll('[data-tool-body]').forEach((x) => x.classList.toggle('hidden', x.dataset.toolBody !== b.dataset.tool));
    }));
    $('miner-find').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = e.target.elements.miner.value.trim();
      if (text && !ethers.isAddress(text)) { toast(esc(t('pool.lookup'))); return; }
      navigate(`/pool/${address}${text ? `?miner=${encodeURIComponent(text)}` : ''}`);
    });
    const out = $('miner-out');
    const minerAddress = () => {
      const a = $('miner-form').elements.miner.value.trim();
      if (!ethers.isAddress(a)) throw new Error(t('pool.lookup'));
      return a;
    };
    $('miner-check').onclick = async () => {
      try {
        const a = minerAddress();
        const [pending, [total, own], paid] = await Promise.all([c.pendingOf(a), c.windowWork(a), c.paidTo(a)]);
        const share = total > 0n ? Number((own * 10000n) / total) : 0;
        out.textContent = `${t('pool.pendingAmount')}: ${aet(pending, 6)} ${coin()}\n${t('pool.share')}: ${percent(share)}\n${t('pool.paidTo')}: ${aet(paid, 6)} ${coin()}`;
        out.className = 'tool-output';
      } catch (e) { out.textContent = errorText(e); out.className = 'tool-output bad'; }
    };
    txButton($('miner-claim'), out, (s) => poolContract(address, s).claim(minerAddress()), async (r) => `${t('tool.done')} #${r.blockNumber}`);
    if (search) $('pool-miners')?.scrollIntoView({ block: 'start' });
    if (isOperator) {
      txButton($('op-url'), $('op-out'), (s) => poolContract(address, s).setUrl($('op-form').elements.url.value.trim()), async (r) => `${t('tool.done')} #${r.blockNumber}`);
      txButton($('op-fee'), $('op-out'), (s) => poolContract(address, s).withdrawFee(), async (r) => `${t('tool.done')} #${r.blockNumber}`);
    }
  }

  function pageApi(section) {
    window.AetherDocs.render({ app, lang, rpcBase, stats, contracts, rpc, esc, head, copyBtn, section });
  }

  /** The pending transaction queue by page. Each shows whether it will enter the next block and, if not, why. */
  async function pageMempool(q = new URLSearchParams()) {
    app.innerHTML = skeleton();
    const order = q.get('order') === 'time' ? 'time' : 'fee';
    const res = await rpc('aether_mempool', [{ limit: PAGE, offset: (pageOf(q) - 1) * PAGE, order }]);
    const size = res.bytes >= 1048576 ? `${(res.bytes / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 })} <em>MB</em>` : `${(res.bytes / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} <em>KB</em>`;
    const seg = (id, label) => `<a href="${esc(withParam('/mempool', q, 'order', id, 'fee'))}" class="${order === id ? 'active' : ''}">${label}</a>`;
    const state = (x) => {
      if (x.waitingFor !== null) return `<span class="badge pending">${esc(fill('mp.gap', { n: num(x.waitingFor) }))}</span>`;
      if (x.underpriced) return `<span class="badge pending">${t('mp.low')}</span>`;
      return `<span class="badge ok">${t('mp.ready')}</span>`;
    };
    const stalled = res.total > 0 && stats && BigInt(stats.hashrate ?? 0) === 0n;
    app.innerHTML = `${head(t('nav.mempool'), t('mp.sub'))}
      ${stalled ? `<div class="notice">${t('tx.noMiner')}</div>` : ''}
      <div class="metric-grid">
        ${metric(t('mp.count'), num(res.total), esc(fill('mp.countSub', { max: num(res.max) })))}
        ${metric(t('mp.size'), size)}
        ${metric(t('mp.tip'), res.tips ? `${gwei(res.tips.median)} <em>gwei</em>` : '—', res.tips ? esc(fill('mp.tipRange', { min: gwei(res.tips.min), max: gwei(res.tips.max) })) : '')}
        ${metric(t('mp.oldest'), res.oldest ? ago(res.oldest) : '—')}
      </div>
      <div class="card"><div class="card-header"><div class="seg">${seg('fee', t('mp.byFee'))}${seg('time', t('f.newest'))}</div></div>
        ${res.items.length ? `<div class="table-wrap"><table><thead><tr><th>${t('t.hash')}</th><th>${t('mp.waiting')}</th><th>${t('t.from')}</th><th>${t('t.to')}</th><th class="num">${t('t.value')}</th><th class="num">${t('mp.tipCol')}</th><th>${t('mp.state')}</th></tr></thead><tbody>
          ${res.items.map((x) => `<tr class="rowlink" data-href="/tx/${esc(x.hash)}"><td>${txLink(x.hash)}</td><td>${ago(x.addedAt)}</td><td>${addrLink(x.from)}</td><td>${x.to ? addrLink(x.to) : '—'}</td><td class="num">${aet(x.value, 4)} ${esc(coin())}</td><td class="num">${gwei(x.tip)}</td><td>${state(x)}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${t('x.empty')}</div>`}
        ${pagerLinks('/mempool', q, res.total, true)}</div>`;
  }

  async function pageRich() {
    app.innerHTML = skeleton();
    const r = await rpc('aether_richList', [100]);
    const supply = big(stats?.supply ?? 1) || 1n;
    app.innerHTML = `${head(t('nav.richlist'))}<div class="card"><div class="table-wrap"><table><thead><tr><th>#</th><th>${t('t.address')}</th><th>${t('t.balance')}</th><th>${t('t.share')}</th></tr></thead><tbody>
      ${r.items.map((x, i) => `<tr><td>${i + 1}</td><td>${addrLink(x.address)}</td><td>${aet(x.balance, 4)}</td><td>${(Number((big(x.balance) * 10000n) / supply) / 100).toFixed(2)} %</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  async function pageNetwork() {
    app.innerHTML = skeleton();
    // An older node does not know aether_endpoints; the page then shows only the address it was opened from.
    const [s, peers, ends] = await Promise.all([rpc('aether_stats'), rpc('aether_peers'), rpc('aether_endpoints').catch(() => null)]);
    const url = (u) => `<span class="hash">${esc(u)}</span>${copyBtn(u)}`;
    const rpcRows = [['RPC', url(rpcBase)]];
    for (const u of ends?.lan ?? []) if (u !== rpcBase) rpcRows.push([t('net.rpcLan'), url(u)]);
    if (ends?.public && ends.public !== rpcBase) rpcRows.push([t(ends.access?.nat === 'double' ? 'net.rpcPublicFwd' : 'net.rpcPublic'), url(ends.public)]);
    if (ends && !ends.restricted && !ends.lan.length) rpcRows.push([t('net.rpcLan'), `<span class="muted">${t('net.rpcOnlyHere')}</span>`]);
    app.innerHTML = `${head(t('net.title'), '', `<button class="ghost-btn" id="add-net">${t('wallet.add')}</button>`)}
      <div class="card">${kv([['Network', esc(s.network)], ['Chain ID', num(s.chainId)], ...rpcRows, ['Genesis', `<span class="hash">${esc(short(s.genesisHash, 22))}</span>`], ['Node', esc(s.version)], [t('nh.peers'), num(s.peers)]])}
      <p class="muted">${t('net.rpcHint')}</p></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>${peers.some((p) => p.address) ? t('t.address') : 'ID'}</th><th>Agent</th><th>${t('m.height')}</th></tr></thead><tbody>
      ${peers.map((p) => `<tr><td class="hash">${esc(p.address ?? short(p.id ?? '', 16))}</td><td>${esc(p.agent)}</td><td>${num(p.height)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">—</td></tr>'}</tbody></table></div></div>`;
    $('add-net').onclick = () => addNetwork().catch((e) => toast(esc(e.message)));
    // Fork signalling (docs/GOVERNANCE.md). An older node does not know the method; the card then stays hidden.
    const sig = await rpc('aether_signals').catch(() => null);
    if (sig && route().name === 'network') {
      const rows = sig.signals.map((x) => `<tr><td><b>QIP-${num(x.qip)}</b></td><td class="num">${num(x.blocks)}</td><td class="num">${(x.share * 100).toFixed(1)} %</td><td class="num">${num(x.miners)}</td></tr>`).join('');
      app.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-header"><h2>${t('sig.title')}</h2></div><p class="muted">${fill('sig.sub', { n: num(sig.blocks) })} <a href="https://github.com/Lakylife/quinvium/blob/main/docs/GOVERNANCE.md" rel="noopener">${t('sig.how')}</a></p>
        ${rows ? `<div class="table-wrap"><table><thead><tr><th>${t('sig.proposal')}</th><th class="num">${t('t.blocks')}</th><th class="num">${t('t.share')}</th><th class="num">${t('sig.miners')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${t('sig.none')}</p>`}</div>`);
    }
    // Watch (packages/node/src/watch): do peers have the same blocks, do the website and Explorer match GitHub. An older node does not know it.
    const w = await rpc('aether_watch').catch(() => null);
    if (w && route().name === 'network') app.insertAdjacentHTML('beforeend', watchCard(w));
  }

  function watchCard(w) {
    const c = w.chain;
    const site = w.sites;
    const siteText = !site ? t('watch.siteOff') : site.checkedAt === null ? t('watch.siteWait') : site.ok ? t('watch.siteOk') : fill('watch.siteChanged', { n: num(site.changed.length) });
    const warn = [];
    if (c?.minority) warn.push(t('watch.minority'));
    if (nodeCheck.outliers.length) warn.push(fill('watch.explorerNodes', { list: nodeCheck.outliers.map((u) => new URL(u).host).join(', ') }));
    const changed = site?.changed?.length ? `<ul class="watch-list">${site.changed.map((x) => `<li><span class="hash">${esc(x.url)}</span></li>`).join('')}</ul>` : '';
    return `<div class="card"><div class="card-header"><h2>${t('watch.title')}</h2></div><p class="muted">${t('watch.sub')}</p>
      ${warn.map((x) => `<p class="notice">${esc(x)}</p>`).join('')}${changed}</div>
      <div class="metric-grid">
        ${metric(t('watch.peers'), c ? `${num(c.agree)} / ${num(c.checked)}` : '—')}
        ${metric(t('watch.differ'), c ? num(c.differ) : '—')}
        ${metric(t('watch.incidents'), c ? num(c.incidents.length) : '—')}
        ${metric(t('watch.sites'), esc(siteText))}
      </div>`;
  }

  // ------------------------------------------------------------- tokeny a most
  const TOKEN_ABI = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
  const HISTORY_BLOCKS = 9000;     // the node returns logs from at most 10,000 blocks at a time
  const BRIDGE_DOMAIN = ethers.id('AetherBridge.v1');
  const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const BTC_PREFIX = { mainnet: 'bc', testnet: 'tb', regtest: 'bcrt' };
  let deployments = null;

  /** Bridge and token contract addresses for the network the page is connected to. */
  async function deployment() {
    await refreshStats();
    deployments ??= await fetch('/deployments.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const d = deployments[stats.chainId] ?? null;
    for (const [address, label] of [[d?.swap?.router, 'Swap Router'], [d?.swap?.factory, 'Swap Factory'], [d?.registry, 'Token Registry'], [d?.gateway, 'Bridge Gateway']]) {
      if (address) extraLabels.set(address.toLowerCase(), label);
    }
    return d;
  }

  function units(value, decimals, digits = 8) {
    const [whole, frac = ''] = ethers.formatUnits(value, decimals).split('.');
    const shown = frac.slice(0, digits).replace(/0+$/, '');
    return `${BigInt(whole).toLocaleString(locale())}${shown ? `${(1.5).toLocaleString(locale())[1]}${shown}` : ''}`;
  }

  const tokenBadge = (kind) => `<span class="badge ${['ok', 'pending', ''][kind] ?? ''}">${t(`tokens.kind${kind}`)}</span>`;
  const COIN_ICON = '<svg class="coin-icon" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#FFCD02"/><path fill="#0B1622" d="M28.19 35.31L29.82 37.13L35.52 43.07L41.75 49.92L49.85 49.92L41.99 41.06L37.63 36.22L37.01 35.69L36.62 35.45L36.05 35.31L31.02 35.31L30.97 35.26L30.87 35.31L29.92 35.31L29.87 35.26L29.77 35.31ZM32.26 12.35L31.16 12.35L30.68 12.45L30.01 12.64L29.34 12.97L22.97 17.14L16.3 21.65L15.68 22.08L15.35 22.46L14.91 23.04L14.39 24.04L14.29 24.43L14.15 25.15L14.15 39L14.34 40.05L14.77 41.11L15.2 41.68L16.06 42.54L20.81 45.71L28.91 51.07L29.68 51.46L30.59 51.65L32.02 51.6L32.6 51.46L33.41 51.07L38.25 47.58L34.56 43.45L34.42 43.5L32.41 44.94L31.88 45.23L31.64 45.32L30.97 45.32L30.39 45.08L24.79 41.25L21.24 38.9L20.76 38.37L20.47 37.8L20.28 37.08L20.28 27.4L20.38 26.97L20.62 26.39L20.81 26.15L21.38 25.58L28.19 21.07L30.92 19.25L31.59 19.06L31.88 19.06L32.41 19.2L33.94 20.16L36.43 21.89L41.47 25.24L42.33 26.01L42.57 26.49L42.71 27.21L42.71 37.51L42.57 38.33L42.33 38.81L41.75 39.33L45.4 43.41L45.49 43.55L45.59 43.55L47.12 42.5L47.7 42.06L48.08 41.68L48.7 40.72L48.89 40.2L49.09 39.19L49.09 25.15L48.94 24.33L48.75 23.71L48.37 22.99L47.98 22.46L47.41 21.89L46.26 21.07L36.62 14.6L33.8 12.83L33.22 12.54Z"/></svg>';
  const tintOf = (symbol) => [...String(symbol)].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6;
  /** A token icon is generated from its symbol. Foreign logos are not taken over; trademarks belong to their owners. */
  const tokenIcon = (x) => (x.native ? COIN_ICON : `<i class="token-icon tint-${tintOf(x.symbol)}" aria-hidden="true">${esc(String(x.symbol).replace(/^t(?=[A-Z])/, '').slice(0, 4))}</i>`);

  /** A token's price is what the pool with Quinvium gives for it today. Without a pool there is no price and the page does not invent one. */
  async function tokenPool(d, token) {
    if (!d?.swap?.factory) return null;
    const hub = contracts.WAET.address;
    const address = await at('SwapFactory', d.swap.factory).getPair(token.address, hub).catch(() => ethers.ZeroAddress);
    if (address === ethers.ZeroAddress) return null;
    const pair = at('SwapPair', address);
    const [first, reserves] = await Promise.all([pair.token0(), pair.getReserves()]);
    const [own, other] = first.toLowerCase() === token.address.toLowerCase() ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
    if (own === 0n) return null;
    return { address, reserveToken: own, reserveCoin: other, price: (other * 10n ** BigInt(token.decimals)) / own };
  }

  /** The verified list and everything the chain knows about tokens. An error in one token must not bring down the whole table. */
  async function tokenList(d) {
    const registry = d?.registry ? at('TokenRegistry', d.registry) : null;
    const entries = registry ? await registry.all() : [];
    const rows = await Promise.all(entries.map(async (e) => {
      try {
        const c = new ethers.Contract(e.token, TOKEN_ABI, provider());
        const [name, symbol, decimals, supply, info] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply(), rpc('aether_tokenInfo', [e.token])]);
        const base = { address: e.token, kind: Number(e.kind), issuer: e.issuer, ...tokenFace(e.token, name, symbol), decimals: Number(decimals), supply, info };
        return { ...base, pool: await tokenPool(d, base) };
      } catch { return null; }
    }));
    return { registry, tokens: rows.filter(Boolean) };
  }

  const TOKEN_KINDS = [['all', 'f.all'], [0, 'tokens.kind0'], [1, 'tokens.kind1'], [2, 'tokens.kind2']];
  const byValue = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

  async function pageTokens() {
    app.innerHTML = skeleton();
    const d = await deployment();
    const [{ registry, tokens }, transfers] = await Promise.all([tokenList(d), rpc('aether_txs', [{ limit: 1, kind: 'transfer' }]).then((r) => r.total)]);
    const unit = esc(coin());
    const none = '<span class="dim">—</span>';
    const rows = tokens.map((x) => ({
      ...x, price: x.pool?.price ?? null, liquidity: x.pool ? x.pool.reserveCoin * 2n : null,
      cap: x.pool ? (x.supply * x.pool.price) / 10n ** BigInt(x.decimals) : null, holders: x.info.holders, transfers: x.info.transfers,
    }));
    const liquidity = rows.reduce((sum, x) => sum + (x.liquidity ?? 0n), 0n);
    let sortKey = 'cap';
    let sortDir = -1;
    let kind = 'all';
    let query = '';
    const money = (v, digits) => (v === null ? none : `${units(v, 18, digits)} ${unit}`);
    const nativeRow = `<tr class="rowlink" data-href="/richlist"><td><div class="token-cell">${tokenIcon({ native: true })}<div><strong>${unit}</strong><span class="dim-text">Quinvium</span></div></div></td>
      <td class="num">${none}</td><td class="num">${none}</td><td class="num">${none}</td><td class="num">${aet(stats.supply, 2)}</td><td class="num">${num(stats.holders)}</td><td class="num">${num(transfers)}</td></tr>`;
    const row = (x) => `<tr class="rowlink" data-href="/token/${esc(x.address)}"><td><div class="token-cell">${tokenIcon(x)}<div><strong><a href="/token/${esc(x.address)}">${esc(x.symbol)}</a></strong><span class="dim-text">${esc(x.name)}</span></div></div></td>
      <td class="num">${money(x.price, 6)}</td><td class="num">${money(x.liquidity, 2)}</td><td class="num">${money(x.cap, 2)}</td><td class="num">${units(x.supply, x.decimals, 2)}</td><td class="num">${num(x.holders)}${x.info.complete ? '' : '+'}</td><td class="num">${num(x.transfers)}</td></tr>`;
    const column = (key, label) => `<th class="num sortable" data-sort="${key}" aria-sort="${sortKey === key ? (sortDir < 0 ? 'descending' : 'ascending') : 'none'}">${label}${sortKey === key ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    const present = TOKEN_KINDS.filter(([id]) => id === 'all' || rows.some((x) => x.kind === id));
    function draw() {
      const words = query.toLowerCase();
      const shown = rows.filter((x) => (kind === 'all' || x.kind === kind) && (!words || `${x.symbol} ${x.name} ${x.address}`.toLowerCase().includes(words)))
        .sort((a, b) => sortDir * byValue(a[sortKey] ?? -1n, b[sortKey] ?? -1n));
      const nativeVisible = kind === 'all' && (!words || `${coin()} quinvium`.toLowerCase().includes(words));
      $('token-table').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${t('t.token')}</th>${column('price', t('tokens.price'))}${column('liquidity', t('tokens.liquidity'))}${column('cap', t('tokens.cap'))}${column('supply', t('t.supply'))}${column('holders', t('tokens.holders'))}${column('transfers', t('tokens.transfers'))}</tr></thead><tbody>${nativeVisible ? nativeRow : ''}${shown.map(row).join('')}</tbody></table></div>
        ${tokens.length && !shown.length && !nativeVisible ? `<div class="empty">${t('f.none')}</div>` : ''}`;
    }
    const kinds = present.length > 2 ? `<div class="seg" role="group" aria-label="${t('t.kind')}">${present.map(([id, key]) => `<button type="button" data-kind="${id}" class="${id === 'all' ? 'active' : ''}">${t(key)}</button>`).join('')}</div>` : '';
    app.innerHTML = `${head(t('nav.tokens'), t('tokens.sub'), `<input class="token-search" id="token-search" type="search" placeholder="${t('tokens.search')}" aria-label="${t('tokens.search')}" autocomplete="off" spellcheck="false">`)}
      ${kinds ? `<div class="token-tools">${kinds}</div>` : ''}
      <div class="card" id="token-table"></div>
      ${tokens.length ? (rows.some((x) => x.pool) ? '' : `<p class="result-count">${t('tokens.noPrice')}</p>`) : `<div class="empty"><strong>${t('tokens.none')}</strong><br>${t('tokens.ready')}</div>`}
      <div class="card verify-card"><div class="verify-text"><h2>${t('tokens.check')}</h2><p>${t('tokens.checkHelp')}</p></div>
        <form class="verify-form" id="token-form"><input name="address" spellcheck="false" autocomplete="off" placeholder="0x…" aria-label="${t('tokens.address')}"><button class="primary-btn" type="submit">${t('tokens.verify')}</button></form>
        <div class="tool-output hidden" id="token-out"></div></div>`;
    draw();
    app.querySelector('.token-tools .seg')?.addEventListener('click', (e) => {
      const button = e.target.closest('[data-kind]');
      if (!button) return;
      kind = button.dataset.kind === 'all' ? 'all' : Number(button.dataset.kind);
      app.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('active', x === button));
      draw();
    });
    $('token-search').addEventListener('input', (e) => { query = e.target.value.trim(); draw(); });
    $('token-table').addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (!th) return;
      if (sortKey === th.dataset.sort) sortDir = -sortDir;
      else { sortKey = th.dataset.sort; sortDir = -1; }
      draw();
    });
    $('token-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('token-out');
      const address = new FormData(e.target).get('address').trim();
      const show = (text, cls) => { out.textContent = text; out.className = `tool-output ${cls}`; };
      if (!ethers.isAddress(address)) { show(t('tokens.badAddress'), 'bad'); return; }
      const entry = registry && await registry.listed(address) ? await registry.entries(address) : null;
      if (entry) show(fill('tokens.listed', { issuer: entry.issuer }), 'good');
      else show(t('tokens.unlisted'), 'bad');
    });
  }

  /** Details of one token. The name and symbol are text from a foreign contract, so they always go through esc. */
  async function pageToken(address, q) {
    app.innerHTML = skeleton();
    const missing = () => { app.innerHTML = `<div class="empty">${t('search.none')} ${esc(address)}</div>`; };
    if (!ethers.isAddress(address)) { missing(); return; }
    const c = new ethers.Contract(address, TOKEN_ABI, provider());
    const read = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply()]).catch(() => null);
    if (!read) { missing(); return; }
    const { name, symbol } = tokenFace(address, read[0], read[1]);
    const [, , decimalsRaw, supply] = read;
    const decimals = Number(decimalsRaw);
    const d = await deployment();
    const registry = d?.registry ? at('TokenRegistry', d.registry) : null;
    const entry = registry && await registry.listed(address).catch(() => false) ? await registry.entries(address) : null;
    const [info, pool] = await Promise.all([rpc('aether_tokenInfo', [address]), tokenPool(d, { address, decimals })]);
    const unit = esc(coin());
    const label = esc(symbol);
    const base = `/token/${address}`;
    const tab = q.get('tab') === 'holders' ? 'holders' : 'transfers';
    const tabLink = (id, text, n) => `<a href="${base}${id === 'transfers' ? '' : `?tab=${id}`}" class="${tab === id ? 'active' : ''}">${text}<small>${num(n)}</small></a>`;
    let body;
    if (tab === 'holders') {
      const share = (v) => (supply ? (Number((BigInt(v) * 10000n) / supply) / 100).toLocaleString(locale(), { minimumFractionDigits: 2 }) : '0');
      body = `<div class="card">${info.top.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>${t('t.address')}</th><th class="num">${t('t.balance')}</th><th class="num">${t('t.share')}</th></tr></thead><tbody>
        ${info.top.map((h, i) => `<tr class="rowlink" data-href="/address/${esc(h.address)}"><td>${i + 1}</td><td>${addrLink(h.address)}</td><td class="num">${units(h.balance, decimals, 4)} ${label}</td><td class="num">${share(h.balance)} %</td></tr>`).join('')}</tbody></table></div>` : noResults()}</div>
        ${info.complete ? '' : `<p class="result-count">${t('tokens.partial')}</p>`}`;
    } else {
      const res = await rpc('aether_tokenTransfers', [address, PAGE, (pageOf(q) - 1) * PAGE]);
      body = `<div class="card">${res.items.length ? `<div class="table-wrap"><table><thead><tr><th>${t('t.hash')}</th><th>${t('t.age')}</th><th>${t('t.block')}</th><th>${t('t.from')}</th><th>${t('t.to')}</th><th class="num">${t('t.value')}</th></tr></thead><tbody>
        ${res.items.map((x) => `<tr class="rowlink" data-href="/tx/${esc(x.hash)}"><td>${txLink(x.hash)}</td><td title="${esc(when(x.timestamp))}">${ago(x.timestamp)}</td><td>${blockLink(x.number)}</td><td>${x.from === ethers.ZeroAddress ? `<span class="badge">${t('tokens.mint')}</span>` : addrLink(x.from)}</td><td>${x.to === ethers.ZeroAddress ? `<span class="badge">${t('tokens.burn')}</span>` : addrLink(x.to)}</td><td class="num">${units(x.value, decimals, 6)} ${label}</td></tr>`).join('')}</tbody></table></div>` : noResults()}${pagerLinks(base, q, res.total)}</div>`;
    }
    app.innerHTML = `<div class="page-head"><div class="address-head"><div class="token-cell">${tokenIcon({ symbol })}</div><div style="min-width:0"><h1>${esc(name)} (${label})</h1>
        <div class="address-line"><span class="hash">${esc(address)}</span>${copyBtn(address)}</div></div></div>
        <div class="page-head-right">${entry ? tokenBadge(Number(entry.kind)) : `<span class="badge bad">${t('tokens.notListed')}</span>`}${embedded ? '' : `<button type="button" class="ghost-btn" id="watch-token">${esc(fill('wallet.addToken', { symbol }))}</button>`}</div></div>
      ${entry ? '' : `<div class="notice">${t('tokens.unlisted')}</div>`}
      <div class="metric-grid">
        ${metric(t('t.supply'), `${units(supply, decimals, 4)} <em>${label}</em>`)}
        ${metric(t('tokens.holders'), `${num(info.holders)}${info.complete ? '' : '+'}`)}
        ${metric(t('tokens.transfers'), num(info.transfers))}
        ${metric(t('tokens.price'), pool ? `${units(pool.price, 18, 6)} <em>${unit}</em>` : '—', pool ? `${t('tokens.liquidity')} ${units(pool.reserveCoin * 2n, 18, 2)} ${unit}` : t('tokens.noPool'))}
      </div>
      <div class="card">${kv([[t('tokens.contract'), addrLink(address)], [t('tokens.decimals'), num(decimals)], entry && [t('t.issuer'), esc(entry.issuer)], pool && [t('nav.swap'), `<a href="/swap">${esc(coin())} / ${label}</a>`]])}</div>
      <div class="tabs">${tabLink('transfers', t('tokens.transfers'), info.transfers)}${tabLink('holders', t('tokens.holders'), info.holders)}</div>${body}`;
    if ($('watch-token')) $('watch-token').onclick = () => watchToken({ address, symbol, decimals }).catch((e) => toast(esc(errorText(e))));
  }

  /** The same address the validators compute: the script with the recipient address and the custody keys, P2WSH in bech32. */
  function depositAddress(net, recipient) {
    const keys = [...net.keys].sort().map((k) => [...ethers.getBytes(`0x${k}`)]);
    const script = new Uint8Array([0x14, ...ethers.getBytes(recipient), 0x75, 0x50 + net.threshold, ...keys.flatMap((k) => [k.length, ...k]), 0x50 + keys.length, 0xae]);
    const program = ethers.getBytes(ethers.sha256(script));
    const words = [0];
    let acc = 0;
    let bits = 0;
    for (const byte of program) {
      acc = (acc << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        words.push((acc >> bits) & 31);
      }
      acc &= (1 << bits) - 1;
    }
    if (bits) words.push((acc << (5 - bits)) & 31);
    const prefix = BTC_PREFIX[net.bitcoin];
    const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    const polymod = (values) => values.reduce((chk, v) => {
      const top = chk >>> 25;
      let next = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
      generator.forEach((g, i) => { if ((top >>> i) & 1) next = (next ^ g) >>> 0; });
      return next;
    }, 1);
    const hrp = [...[...prefix].map((c) => c.charCodeAt(0) >> 5), 0, ...[...prefix].map((c) => c.charCodeAt(0) & 31)];
    const mod = polymod([...hrp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
    const check = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
    return `${prefix}1${[...words, ...check].map((w) => BECH32[w]).join('')}`;
  }

  const bridgeRouteKey = (chain, token) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint64', 'bytes32'], [chain, token]));
  /** The same refund number as the validators use: the first 8 bytes of the SHA-256 of the text. */
  const bridgeNonce = (text) => BigInt(ethers.dataSlice(ethers.sha256(ethers.toUtf8Bytes(text)), 0, 8));
  const bridgeId = (gateway, m) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'address', 'uint64', 'uint64', 'uint64', 'bytes32', 'address', 'uint256'], [BRIDGE_DOMAIN, gateway, m.srcChain, m.dstChain, m.nonce, m.srcToken, m.recipient, m.amount],
  ));

  /** Wallet switched to the other network. After the transfer it returns to Quinvium. */
  async function switchChain(id, net) {
    const w = wallet();
    const chainId = ethers.toQuantity(id);
    try {
      await w.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    } catch (e) {
      if (e.code !== 4902 || !net) throw e;
      await w.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: net.name, rpcUrls: [net.rpc], nativeCurrency: net.currency }] });
    }
  }

  async function bridgeHistory(d) {
    const box = $('bridge-history');
    const w = wallet();
    const [me] = w ? await w.request({ method: 'eth_accounts' }) : [];
    if (!me) { box.innerHTML = `<div class="empty">${t('bridge.noHistory')}</div>`; return; }
    const gate = at('BridgeGateway', d.gateway);
    const tip = await provider().getBlockNumber();
    const logs = await gate.queryFilter('Sent', Math.max(0, tip - HISTORY_BLOCKS), tip);
    const mine = logs.filter((l) => l.args.sender.toLowerCase() === me.toLowerCase()).reverse();
    const rows = await Promise.all(mine.map(async (l) => {
      const net = d.networks.find((n) => BigInt(n.id) === l.args.dstChain);
      const asset = d.assets.find((a) => a.token.toLowerCase() === l.args.token.toLowerCase());
      let status = `<span class="badge pending">${t('bridge.waiting')}</span>`;
      if (net?.bitcoin) {
        status = `<span class="badge pending">${t('bridge.btcWaiting')}</span>`;
      } else if (net?.gateway) {
        const m = { srcChain: stats.chainId, dstChain: l.args.dstChain, nonce: l.args.nonce, srcToken: ethers.zeroPadValue(l.args.token, 32), recipient: ethers.getAddress(l.args.recipient), amount: l.args.amount };
        const other = at('BridgeGateway', net.gateway, new ethers.JsonRpcProvider(net.rpc, undefined, { staticNetwork: true }));
        const id = bridgeId(net.gateway, m);
        const [done, cancelled] = await Promise.all([other.delivered(id).catch(() => false), other.cancelled(id).catch(() => false)]);
        if (done) status = `<span class="badge ok">${t('bridge.done')}</span>`;
        else if (cancelled) {
          // Validators refund a cancelled transfer with a message in the opposite direction, as the relayer does (refundMessage).
          const route = await other.routes(bridgeRouteKey(stats.chainId, m.srcToken)).catch(() => null);
          const back = route && { srcChain: l.args.dstChain, dstChain: stats.chainId, nonce: bridgeNonce(`refund:${l.args.id}`), srcToken: ethers.zeroPadValue(route.local, 32), recipient: ethers.getAddress(l.args.sender), amount: l.args.amount };
          const refunded = back ? await gate.delivered(bridgeId(d.gateway, back)).catch(() => false) : false;
          status = refunded ? `<span class="badge ok">${t('bridge.refunded')}</span>` : `<span class="badge pending">${t('bridge.refunding')}</span>`;
        }
      }
      return `<tr><td>${txLink(l.transactionHash)}</td><td>${asset ? `${units(l.args.amount, asset.decimals)} ${esc(asset.symbol)}` : esc(l.args.amount)}</td><td>${esc(net?.name ?? l.args.dstChain)}</td><td>${status}</td></tr>`;
    }));
    box.innerHTML = rows.length
      ? `<div class="table-wrap"><table><thead><tr><th>${t('t.tx')}</th><th>${t('t.value')}</th><th>${t('bridge.to')}</th><th>${t('t.status')}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : `<div class="empty">${t('bridge.noHistory')}</div>`;
  }

  const BRIDGE_PLANNED = [['Bitcoin', 'BTC', 'qBTC'], ['Ethereum', 'ETH', 'qETH'], ['Ethereum', 'USDT', 'qUSDT'], ['Ethereum', 'USDC', 'qUSDC'], ['Ethereum', 'USD1', 'qUSD1']];
  const FLIP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>';
  const HOW_ICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5"/><path d="M5 20h14"/></svg>',
  ];
  const FACT_ICONS = {
    time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/></svg>',
    fee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.600 13.400 13.400 20.600a2 2 0 0 1-2.800 0L3 13V3h10l7.600 7.600a2 2 0 0 1 0 2.800Z"/><circle cx="7.500" cy="7.500" r="1.200"/></svg>',
    big: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12M6 21h12"/><path d="M7 3v3.200a2 2 0 0 0 .600 1.400L12 12l4.400-4.400a2 2 0 0 0 .600-1.400V3M7 21v-3.200a2 2 0 0 1 .600-1.400L12 12l4.400 4.400a2 2 0 0 1 .600 1.400V21"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  };
  /**
   * How the bridge works: three steps with icons and below them answers to what people ask first.
   * The number of validators comes from the contract; for a bridge that is not running yet it is not shown.
   */
  const bridgeHow = (threshold, count) => {
    const steps = [[t('bridge.step1'), t('bridge.how1')], [t('bridge.step2'), threshold ? fill('bridge.how2n', { threshold: num(threshold), count: num(count) }) : t('bridge.how2')], [t('bridge.step3'), t('bridge.how3')]];
    const facts = [['time', t('bridge.tTime'), t('bridge.vTime'), t('bridge.nTime')], ['fee', t('bridge.tFee'), t('bridge.vFee'), t('bridge.nFee')],
      ['big', t('bridge.tBig'), t('bridge.vBig'), t('bridge.nBig')], ['back', t('bridge.tFail'), t('bridge.vFail'), t('bridge.nFail')]];
    return `<div class="card how-card"><div class="card-header"><h2>${t('bridge.howTitle')}</h2></div>
      <ol class="how-flow">${steps.map(([title, body], i) => `<li><span class="how-icon">${HOW_ICONS[i]}</span><div><b>${i + 1}. ${esc(title)}</b><p>${esc(body)}</p></div></li>`).join('')}</ol>
      <div class="how-facts">${facts.map(([id, label, value, note]) => `<div class="how-fact"><span class="how-icon">${FACT_ICONS[id]}</span><div class="how-fact-text"><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(note)}</span></div></div>`).join('')}</div></div>`;
  };
  const netBox = (id, label, name) => `<div class="bridge-net"><small>${label}</small><strong id="${id}">${esc(name)}</strong></div>`;

  /** The bridge is not running yet: the page shows how it will look and what is missing, and nothing can be sent. */
  function bridgePlanned(title) {
    const rows = BRIDGE_PLANNED.map(([net, symbol, wrapped]) => `<tr><td><div class="token-cell">${tokenIcon({ symbol })}<div><strong>${esc(symbol)}</strong><span class="dim-text">${esc(net)}</span></div></div></td><td>${esc(wrapped)}</td><td><span class="badge pending">${t('bridge.needsValidators')}</span></td></tr>`).join('');
    app.innerHTML = `<div class="trade-page">${title}
      <div class="trade-layout">
        <aside class="trade-side"><div class="card trade-card">
          <div class="trade-head"><h2>${t('bridge.transfer')}</h2></div>
          <div class="bridge-path">${netBox('bridge-from', t('swap.from'), 'Ethereum')}<span class="bridge-arrow">${FLIP_ICON}</span>${netBox('bridge-to', t('swap.to'), 'Quinvium')}</div>
          <div class="trade-field"><div class="trade-label"><span>${t('bridge.amount')}</span></div><div class="trade-row"><input disabled placeholder="0,0" aria-label="${t('bridge.amount')}"><span class="token-btn is-static">${tokenIcon({ symbol: 'USDT' })}<span>USDT</span></span></div></div>
          <button class="primary-btn swap-go" disabled>${t('bridge.closed')}</button>
          <p class="trade-help"><strong>${t('bridge.notReady')}.</strong> ${t('bridge.notReadyBody')}</p>
        </div></aside>
        <div class="trade-main">
          <div class="card"><div class="card-header"><h2>${t('bridge.planned')}</h2></div><div class="table-wrap"><table><thead><tr><th>${t('t.token')}</th><th>${t('bridge.onAether')}</th><th>${t('t.status')}</th></tr></thead><tbody>${rows}</tbody></table></div></div>
          ${bridgeHow()}
        </div>
      </div></div>`;
  }

  async function pageBridge(q) {
    const d = await deployment();
    const title = head(t('nav.bridge'));
    if (!d?.gateway) { bridgePlanned(title); return; }
    const gate = at('BridgeGateway', d.gateway);
    const [paused, threshold, validators] = await Promise.all([gate.paused(), gate.threshold(), gate.validators()]);
    const incoming = q.get('dir') === 'in';
    const network = (a) => d.networks.find((n) => n.id === a.network);
    const routes = d.assets.filter((a) => network(a) && (incoming ? a.remoteToken !== undefined || network(a).bitcoin : a.token !== undefined));
    const here = 'Quinvium';
    const routeNote = (a) => (network(a).bitcoin && incoming ? t('bridge.viaDeposit') : t('bridge.bothWays'));
    const table = d.assets.filter(network).map((a) => `<tr><td><div class="token-cell">${tokenIcon(a)}<div><strong>${esc(a.symbol)}</strong><span class="dim-text">${esc(network(a).name)}</span></div></div></td><td class="num">${units(a.min, a.decimals)} ${esc(a.symbol)}</td><td>${esc(routeNote(a))}</td><td><span class="badge ${paused ? 'pending' : 'ok'}">${paused ? t('bridge.stateClosed') : t('bridge.stateOpen')}</span></td></tr>`).join('');
    app.innerHTML = `<div class="trade-page">${title}
      <div class="trade-layout">
        <aside class="trade-side">${paused ? `<div class="notice">${t('bridge.paused')}</div>` : ''}<div class="card trade-card">
          <div class="trade-head"><h2>${t('bridge.transfer')}</h2></div>
          ${routes.length ? `<div class="bridge-path">${netBox('bridge-from', t('swap.from'), incoming ? '' : here)}<a class="bridge-arrow" id="bridge-flip" href="/bridge?dir=${incoming ? 'out' : 'in'}" title="${t('swap.flip')}" aria-label="${t('swap.flip')}">${FLIP_ICON}</a>${netBox('bridge-to', t('swap.to'), incoming ? here : '')}</div>
            <form class="bridge-form" id="bridge-form"><div class="trade-field"><div class="trade-label"><span>${t('bridge.asset')}</span></div><button type="button" class="route-btn" id="bridge-asset"></button></div><div id="bridge-fields"></div></form><div class="tool-output hidden" id="bridge-out"></div>` : `<p class="trade-empty">${t('bridge.noRoutes')}</p>`}
        </div></aside>
        <div class="trade-main">
          <p class="market-note">${fill('bridge.trust', { threshold: num(threshold), count: num(validators.length) })}</p>
          <div class="card"><div class="card-header"><h2>${t('bridge.history')}</h2></div><div id="bridge-history"><div class="empty">…</div></div></div>
          <div class="card"><div class="card-header"><h2>${t('bridge.routes')}</h2></div><div class="table-wrap"><table><thead><tr><th>${t('t.token')}</th><th class="num">${t('bridge.minShort')}</th><th>${t('bridge.routeWay')}</th><th>${t('t.status')}</th></tr></thead><tbody>${table}</tbody></table></div></div>
          ${bridgeHow(threshold, validators.length)}
        </div>
      </div></div>`;
    bridgeHistory(d).catch(() => {});
    if (!routes.length) return;
    const form = $('bridge-form');
    const fields = $('bridge-fields');
    const out = $('bridge-out');
    const show = (text, cls = '') => { out.textContent = text; out.className = `tool-output ${cls}`; };
    let selected = 0;
    const routeLabel = (a) => `${a.symbol} · ${network(a).name}`;

    function draw() {
      const asset = routes[selected];
      const net = network(asset);
      out.className = 'tool-output hidden';
      $('bridge-asset').innerHTML = `${tokenIcon(asset)}<span><b>${esc(asset.symbol)}</b><small>${esc(net.name)}</small></span>${CHEVRON}`;
      $(incoming ? 'bridge-from' : 'bridge-to').textContent = net.name;
      if (incoming && net.bitcoin) {
        fields.innerHTML = `<p class="market-note">${esc(fill('bridge.depositHelp', { n: net.confirmations, symbol: asset.symbol }))}</p><button type="button" class="primary-btn swap-go" id="bridge-go">${t('bridge.getAddress')}</button><div id="bridge-deposit"></div>`;
        $('bridge-go').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const s = await signer();
            const me = await s.getAddress();
            const tx = await at('BridgeGateway', d.gateway, s).requestBitcoinDeposit(me);
            show(`${t('tool.sent')}: ${tx.hash}`);
            await tx.wait();
            out.className = 'tool-output hidden';
            const address = depositAddress(net, me);
            $('bridge-deposit').innerHTML = `<h2>${t('bridge.deposit')}</h2><div class="qr-box">${qrTag(`bitcoin:${address}`)}</div><p class="hash" id="bridge-address">${esc(address)}</p>`;
          } catch (err) { show(errorText(err), 'bad'); e.target.disabled = false; }
        });
        return;
      }
      const toBitcoin = !incoming && net.bitcoin;
      fields.innerHTML = `<div class="trade-field"><div class="trade-label"><span>${t('bridge.amount')}</span></div><div class="trade-row"><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,0" aria-label="${t('bridge.amount')}"><span class="token-btn is-static">${tokenIcon(asset)}<span>${esc(asset.symbol)}</span></span></div></div>
        <label class="trade-input">${toBitcoin ? t('bridge.recipientBtc') : t('bridge.recipient')}<input name="recipient" spellcheck="false" autocomplete="off" placeholder="${toBitcoin ? `${BTC_PREFIX[net.bitcoin]}1…` : t('bridge.recipientSelf')}"></label>
        <dl class="swap-info"><dt>${t('bridge.rate')}</dt><dd>1 : 1</dd><dt>${t('bridge.fee')}</dt><dd>${toBitcoin ? t('bridge.feeBtc') : t('bridge.feeNone')}</dd><dt>${t('bridge.minShort')}</dt><dd>${units(asset.min, asset.decimals)} ${esc(asset.symbol)}</dd><dt>${t('bridge.time')}</dt><dd>${toBitcoin || net.bitcoin ? t('bridge.timeBtc') : t('bridge.timeEvm')}</dd></dl>
        <button type="button" class="primary-btn swap-go" id="bridge-go">${t('bridge.send')}</button>`;
      txButton($('bridge-go'), out, async (s) => {
        const amount = ethers.parseUnits(String(form.amount.value).trim().replace(',', '.') || '0', asset.decimals);
        if (amount < BigInt(asset.min)) throw new Error(fill('bridge.min', { min: units(asset.min, asset.decimals), symbol: asset.symbol }));
        const me = await s.getAddress();
        const recipient = form.recipient.value.trim() || me;
        if (toBitcoin && !recipient.toLowerCase().startsWith(`${BTC_PREFIX[net.bitcoin]}1`)) throw new Error(fill('bridge.badBtc', { net: net.bitcoin }));
        if (!toBitcoin && !ethers.isAddress(recipient)) throw new Error(t('tokens.badAddress'));
        const target = toBitcoin ? ethers.toUtf8Bytes(recipient) : ethers.getAddress(recipient);
        if (!incoming) {
          await nothingPending(s);
          const gateway = at('BridgeGateway', d.gateway, s);
          if (asset.token === ethers.ZeroAddress) return gateway.send(ethers.ZeroAddress, amount, net.id, target, { value: amount });
          if (!asset.burn) {
            const token = new ethers.Contract(asset.token, TOKEN_ABI, s);
            if (await token.allowance(me, d.gateway) < amount) await (await token.approve(d.gateway, amount)).wait();
          }
          return gateway.send(asset.token, amount, net.id, target);
        }
        await switchChain(net.id, net);
        try {
          const remote = await new ethers.BrowserProvider(wallet()).getSigner();
          const gateway = at('BridgeGateway', net.gateway, remote);
          if (asset.remoteToken !== ethers.ZeroAddress && !asset.remoteBurn) {
            const token = new ethers.Contract(asset.remoteToken, TOKEN_ABI, remote);
            if (await token.allowance(me, net.gateway) < amount) await (await token.approve(net.gateway, amount)).wait();
          }
          const native = asset.remoteToken === ethers.ZeroAddress;
          const tx = await gateway.send(asset.remoteToken, amount, stats.chainId, target, native ? { value: amount } : {});
          // The wallet returns to the main network only after confirmation, otherwise waiting for the block would be interrupted by a network change.
          const receipt = await tx.wait();
          return { hash: tx.hash, wait: async () => receipt };
        } finally {
          await switchChain(stats.chainId).catch(() => {});
        }
      }, async () => { bridgeHistory(d).catch(() => {}); return t('bridge.sent'); });
    }
    $('bridge-asset').addEventListener('click', () => {
      pickerDialog(t('bridge.asset'), routes.map((a) => ({ label: routeLabel(a), note: routeNote(a), icon: tokenIcon(a) })), (i) => { selected = i; draw(); });
    });
    draw();
  }

  // ------------------------------------------------------------- swap
  const SWAP_DEADLINE_S = 1200;
  const SLIPPAGES = [10, 50, 100];   // in hundredths of a percent: 0.1 %, 0.5 % and 1 %
  const HIGH_IMPACT = 0.05;
  // Above this threshold a swap does not go out with one click: whoever swapped their whole balance into a small pool would lose almost everything.
  const CONFIRM_IMPACT = 0.15;
  let slippageBps = 50;
  const parseAmount = (text, decimals) => {
    try { return ethers.parseUnits(String(text).trim().replace(',', '.') || '0', decimals); } catch { return 0n; }
  };
  const SWAP_PAIR_SCAN = 200;       // how many of the newest pools are scanned when the page loads
  let swapTokenCache = null;
  /** Token data directly from the contract. The name and symbol are foreign text, so they are shortened. */
  async function swapTokenMeta(address) {
    const c = new ethers.Contract(address, TOKEN_ABI, provider());
    const [name, symbol, decimals] = await Promise.all([c.name(), c.symbol(), c.decimals()]);
    if (Number(decimals) > 36) throw new Error('decimals');
    return { address: ethers.getAddress(address), name: String(name).slice(0, 40), symbol: String(symbol).slice(0, 12), decimals: Number(decimals) };
  }
  /**
   * Swap tokens: the default list from deployments.json plus every token that has a pool with QU in the Swap factory.
   * Token authors create pools themselves, so a fixed list is not enough. Tokens outside the verified list carry a badge.
   */
  async function discoverSwapTokens(d) {
    const hub = contracts.WAET.address.toLowerCase();
    const registry = d.registry ? at('TokenRegistry', d.registry) : null;
    const verified = new Set((registry ? await registry.all().catch(() => []) : []).map((e) => e.token.toLowerCase()));
    const out = (d.swap.tokens ?? []).map((x) => ({ ...x, listed: !registry || verified.has(x.address.toLowerCase()) }));
    const seen = new Set([hub, ...out.map((x) => x.address.toLowerCase())]);
    const factory = at('SwapFactory', d.swap.factory);
    const total = Number(await factory.allPairsLength().catch(() => 0n));
    const start = Math.max(0, total - SWAP_PAIR_SCAN);
    const pairs = total > start ? [...await factory.list(start, total - start)] : [];
    const sides = await Promise.all(pairs.map(async (address) => {
      const pair = at('SwapPair', address);
      const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]).catch(() => [null, null]);
      if (t0?.toLowerCase() === hub) return t1;
      return t1?.toLowerCase() === hub ? t0 : null;
    }));
    const fresh = [];
    for (const address of sides.reverse()) {     // newest pool first
      if (!address || seen.has(address.toLowerCase())) continue;
      seen.add(address.toLowerCase());
      fresh.push(address);
    }
    const found = await Promise.all(fresh.map((address) => swapTokenMeta(address).then((x) => ({ ...x, listed: verified.has(address.toLowerCase()) })).catch(() => null)));
    return [...out, ...found.filter(Boolean).sort((x, y) => Number(y.listed) - Number(x.listed))];
  }
  /** The list is loaded once per page load. Each call gets its own array; the form adds tokens to it by address. */
  async function swapTokens(d) {
    const key = `${stats.chainId}:${d.swap.factory}`;
    if (swapTokenCache?.key !== key) {
      const list = discoverSwapTokens(d).catch(() => (d.swap.tokens ?? []).map((x) => ({ ...x, listed: true })));
      swapTokenCache = { key, list };
    }
    return [{ native: true, listed: true, address: contracts.WAET.address, symbol: coin(), name: 'Quinvium', decimals: 18 }, ...await swapTokenCache.list];
  }
  const tokenNote = (x) => (x.listed === false ? `${x.name} · ${t('tokens.notListed')} · ${short(x.address, 6)}` : x.name);
  async function connectedAddress() {
    const w = wallet();
    const [me] = w ? await w.request({ method: 'eth_accounts' }).catch(() => []) : [];
    return me ?? null;
  }
  async function balanceOf(token, me) {
    if (!me) return null;
    return token.native ? provider().getBalance(me) : new ethers.Contract(token.address, TOKEN_ABI, provider()).balanceOf(me);
  }
  /** A direct pool, otherwise the path through QU, where liquidity tends to be deepest. */
  async function swapRoute(router, a, b, amount) {
    const hub = contracts.WAET.address;
    const paths = [[a.address, b.address]];
    if (a.address !== hub && b.address !== hub) paths.push([a.address, hub, b.address]);
    const quotes = await Promise.all(paths.map((path) => router.getAmountsOut(amount, path).then((out) => ({ path, out: out[out.length - 1] })).catch(() => null)));
    return quotes.filter(Boolean).sort((x, y) => (x.out < y.out ? 1 : -1))[0] ?? null;
  }
  async function approveToken(token, spender, amount, s) {
    const c = new ethers.Contract(token.address, TOKEN_ABI, s);
    if (await c.allowance(await s.getAddress(), spender) < amount) await (await c.approve(spender, amount)).wait();
  }

  const SWAP_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');
  const SYNC_TOPIC = ethers.id('Sync(uint256,uint256)');
  const MARKET_LOGS = 300;
  const MARKET_ROWS = 10;
  const DAY_S = 86400;
  const SPANS = [['24h', DAY_S], ['7d', 7 * DAY_S], ['all', 0]];
  const PARTS = [25, 50, 100];
  const FEE_RESERVE = '0.01';       // for the main coin a reserve for the network fee remains
  const GEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></svg>';
  const DOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  const tokenButton = (id, x) => `<button type="button" class="token-btn" id="${id}">${tokenIcon(x)}<span>${esc(x.symbol)}</span>${CHEVRON}</button>`;
  const priceText = (v) => v.toLocaleString(locale(), { maximumSignificantDigits: 6 });

  /** Choosing a token or route in a window: with search and balances instead of a bare dropdown. */
  function pickerDialog(title, items, onPick, byAddress = null) {
    const box = document.createElement('div');
    box.className = 'modal-backdrop';
    box.innerHTML = `<div class="modal picker" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="picker-head"><h2>${esc(title)}</h2><button type="button" class="wallet-x" data-close aria-label="${t('wallet.close')}">×</button></div>
      <input class="picker-search" type="search" placeholder="${t('swap.searchToken')}" aria-label="${t('swap.searchToken')}" spellcheck="false" autocomplete="off">
      <div class="picker-list">${items.map((x, i) => `<button type="button" class="picker-row" data-i="${i}" data-words="${esc(`${x.label} ${x.note}`.toLowerCase())}">${x.icon}<span><b>${esc(x.label)}</b><small>${esc(x.note)}</small></span><em data-balance="${i}"></em></button>`).join('')}</div></div>`;
    const close = () => { box.remove(); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('[data-close]')) { close(); return; }
      const row = e.target.closest('.picker-row');
      if (row) { close(); onPick(Number(row.dataset.i)); }
    });
    const search = box.querySelector('.picker-search');
    const list = box.querySelector('.picker-list');
    let extra = null;
    search.addEventListener('input', () => {
      const words = search.value.trim().toLowerCase();
      box.querySelectorAll('.picker-row:not(.picker-extra)').forEach((r) => { r.hidden = !r.dataset.words.includes(words); });
      list.querySelector('.picker-extra')?.remove();
      extra = null;
      if (!byAddress || !ethers.isAddress(words)) return;
      byAddress(words).then((item) => {
        if (!item || search.value.trim().toLowerCase() !== words) return;
        extra = item;
        list.insertAdjacentHTML('afterbegin', `<button type="button" class="picker-row picker-extra">${item.icon}<span><b>${esc(item.label)}</b><small>${esc(item.note)}</small></span><em></em></button>`);
      }).catch(() => {});
    });
    list.addEventListener('click', (e) => {
      if (!extra || !e.target.closest('.picker-extra')) return;
      e.stopPropagation();
      close();
      extra.pick();
    });
    document.body.appendChild(box);
    search.focus();
    return { balance: (i, text) => { const el = box.querySelector(`[data-balance="${i}"]`); if (el) el.textContent = text; } };
  }

  /** Window with Swap tokens and balances, if a wallet is connected. */
  function pickToken(tokens, onPick) {
    // A token that has no pool yet can be selected by pasting its address into the search. That is how a token author creates the first pool.
    const byAddress = async (address) => {
      const known = tokens.findIndex((x) => x.address.toLowerCase() === address.toLowerCase());
      if (known >= 0) return null;
      const x = { ...await swapTokenMeta(address), listed: false };
      return { label: x.symbol, note: tokenNote(x), icon: tokenIcon(x), pick: () => { tokens.push(x); onPick(tokens.length - 1); } };
    };
    const dialog = pickerDialog(t('swap.pickToken'), tokens.map((x) => ({ label: x.symbol, note: tokenNote(x), icon: tokenIcon(x) })), onPick, byAddress);
    connectedAddress().then((me) => {
      if (!me) return;
      tokens.forEach((x, i) => balanceOf(x, me).then((v) => { if (v !== null) dialog.balance(i, units(v, x.decimals, 4)); }).catch(() => {}));
    });
  }

  /** Pool state and its history directly from contract events. A pool without a direct pair goes through the network coin. */
  async function marketData(d, a, b, coinToken) {
    const factory = at('SwapFactory', d.swap.factory);
    let [base, quote] = [a, b];
    let address = await factory.getPair(base.address, quote.address);
    const direct = address !== ethers.ZeroAddress;
    if (!direct) {
      base = b.native ? a : b;
      quote = coinToken;
      address = await factory.getPair(base.address, quote.address);
      if (address === ethers.ZeroAddress) return null;
    }
    const pair = at('SwapPair', address);
    const [first, reserves, syncs, swaps] = await Promise.all([pair.token0(), pair.getReserves(), rpc('aether_contractLogs', [address, SYNC_TOPIC, MARKET_LOGS, 0]), rpc('aether_contractLogs', [address, SWAP_TOPIC, MARKET_LOGS, 0])]);
    const baseFirst = first.toLowerCase() === base.address.toLowerCase();
    const side = (zero, one) => (baseFirst ? [zero, one] : [one, zero]);
    const amount = (v, x) => Number(ethers.formatUnits(v, x.decimals));
    const [reserveBase, reserveQuote] = side(reserves[0], reserves[1]);
    const points = syncs.items.map((l) => {
      const e = pair.interface.parseLog(l);
      const [rb, rq] = side(e.args.reserve0, e.args.reserve1);
      return { time: l.timestamp, number: l.number, price: amount(rq, quote) / amount(rb, base) };
    }).filter((p) => Number.isFinite(p.price)).reverse();
    const trades = swaps.items.map((l) => {
      const e = pair.interface.parseLog(l);
      const [inBase, inQuote] = side(e.args.amount0In, e.args.amount1In);
      const [outBase, outQuote] = side(e.args.amount0Out, e.args.amount1Out);
      const buy = outBase > 0n;
      const [baseAmount, quoteAmount] = buy ? [outBase, inQuote] : [inBase, outQuote];
      return { time: l.timestamp, hash: l.hash, buy, base: baseAmount, quote: quoteAmount, price: amount(quoteAmount, quote) / (amount(baseAmount, base) || 1) };
    });
    const now = Date.now() / 1000;
    const price = reserveBase ? amount(reserveQuote, quote) / amount(reserveBase, base) : 0;
    const dayAgo = [...points].reverse().find((p) => p.time <= now - DAY_S);
    const recent = trades.filter((x) => x.time > now - DAY_S);
    return {
      address, direct, base, quote, price, reserveBase, reserveQuote, points, trades, key: `${address}:${syncs.total}:${swaps.total}`,
      change: dayAgo ? price / dayAgo.price - 1 : null, volume: recent.reduce((sum, x) => sum + x.quote, 0n), count: recent.length, partial: swaps.total > MARKET_LOGS,
    };
  }

  function drawMarket(box, m, span, setSpan) {
    const change = m.change === null ? '—' : `${m.change >= 0 ? '+' : ''}${(m.change * 100).toLocaleString(locale(), { maximumFractionDigits: 2 })} %`;
    const names = { '24h': t('f.r24h'), '7d': t('f.r7d'), all: t('f.all') };
    const [base, quote] = [esc(m.base.symbol), esc(m.quote.symbol)];
    box.innerHTML = `<div class="card market">
        <div class="market-head"><div class="pair-icons">${tokenIcon(m.base)}${tokenIcon(m.quote)}</div>
          <div class="market-name"><h2>${base} / ${quote}</h2><a class="hash" href="/address/${esc(m.address)}">${esc(short(m.address, 10))}</a></div>
          <div class="market-price"><strong>${priceText(m.price)}</strong><small>${esc(fill('swap.priceUnit', { quote: m.quote.symbol, base: m.base.symbol }))}</small></div></div>
        ${m.direct ? '' : `<p class="market-note">${esc(fill('swap.viaHub', { coin: coin() }))}</p>`}
        <div class="market-stats">
          ${metric(t('swap.change'), change)}
          ${metric(t('tokens.liquidity'), `${units(m.reserveQuote, m.quote.decimals, 2)} <em>${quote}</em>`, `${units(m.reserveBase, m.base.decimals, 2)} ${base}`)}
          ${metric(t('swap.volume'), `${units(m.volume, m.quote.decimals, 2)}${m.partial ? '+' : ''} <em>${quote}</em>`)}
          ${metric(t('swap.count'), `${num(m.count)}${m.partial ? '+' : ''}`)}
        </div>
        ${m.points.length > 1 ? `<div class="market-chart"><div class="chart-toolbar"><h3>${t('swap.priceChart')}</h3><div class="seg" role="group" aria-label="${t('f.range')}">${SPANS.map(([id]) => `<button type="button" data-span="${id}" class="${id === span ? 'active' : ''}">${esc(names[id])}</button>`).join('')}</div></div>
          <div class="plot" id="market-plot"></div></div>` : ''}
      </div>
      <div class="card trades-card"><div class="card-header"><h2>${t('swap.trades')}</h2>${m.trades.length ? `<a class="text-link" href="/address/${esc(m.address)}">${t('swap.allTrades')}</a>` : ''}</div>
        ${m.trades.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>${t('t.age')}</th><th>${t('t.type')}</th><th class="num">${base}</th><th class="num">${quote}</th><th class="num">${t('tokens.price')}</th></tr></thead><tbody>
        ${m.trades.slice(0, MARKET_ROWS).map((x) => `<tr class="rowlink" data-href="/tx/${esc(x.hash)}" title="${esc(when(x.time))}"><td>${ago(x.time)}</td><td><span class="badge ${x.buy ? 'ok' : 'bad'}">${x.buy ? t('swap.buy') : t('swap.sell')}</span></td><td class="num">${units(x.base, m.base.decimals, 6)}</td><td class="num">${units(x.quote, m.quote.decimals, 6)}</td><td class="num">${priceText(x.price)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${t('swap.noTrades')}</div>`}</div>`;
    const seconds = SPANS.find(([id]) => id === span)[1];
    const items = seconds ? m.points.filter((p) => p.time > Date.now() / 1000 - seconds) : m.points;
    const plot = $('market-plot');
    if (plot && items.length < 2) {
      plot.innerHTML = `<div class="chart-empty">${t('swap.chartEmpty')}</div>`;
    } else if (plot) {
      lineChart(plot, items, items.at(-1).time - items[0].time, (p) => p.price, priceText, { fit: true, detail: (p) => `#${num(p.number)}` });
    }
    box.querySelectorAll('[data-span]').forEach((b) => b.addEventListener('click', () => setSpan(b.dataset.span)));
  }

  function swapForm(d, tokens) {
    let from = 0;
    let to = Math.min(1, tokens.length - 1);
    let route = null;
    let me = null;
    let drawn = 0;
    let span = 'all';
    let market = null;
    let marketTicket = 0;
    const router = at('SwapRouter', d.swap.router);
    const box = $('swap-body');
    // The form is on the right and stays in place; the market with chart and latest swaps is next to it, not below it.
    box.innerHTML = `<div class="trade-layout">
      <div class="trade-main" id="market"><div class="card">${'<div class="skel skel-row"></div>'.repeat(6)}</div></div>
      <aside class="trade-side"><div class="card trade-card">
        <div class="trade-head"><h2>${t('swap.tabSwap')}</h2><button type="button" class="slip-btn" id="swap-settings" aria-expanded="false" aria-controls="swap-slip" title="${t('swap.slippage')}">${GEAR_ICON}<span id="swap-slip-now">${(slippageBps / 100).toLocaleString(locale())} %</span></button></div>
        <div class="trade-slip hidden" id="swap-slip"><span>${t('swap.slippage')}</span><div class="swap-slip-options">${SLIPPAGES.map((bps) => `<button type="button" data-slip="${bps}" class="${bps === slippageBps ? 'active' : ''}">${(bps / 100).toLocaleString(locale())} %</button>`).join('')}</div></div>
        <form id="swap-form" class="trade-form">
          <div class="trade-field"><div class="trade-label"><span>${t('swap.pay')}</span><span>${t('swap.balance')}: <b id="swap-from-balance">—</b></span></div>
            <div class="trade-row"><input id="swap-in" inputmode="decimal" autocomplete="off" placeholder="0,0" aria-label="${t('swap.pay')}"><span id="swap-from-slot"></span></div>
            <div class="trade-parts">${PARTS.map((p) => `<button type="button" data-part="${p}">${p === 100 ? t('swap.max') : `${p} %`}</button>`).join('')}</div></div>
          <button type="button" class="swap-flip" id="swap-flip" title="${t('swap.flip')}" aria-label="${t('swap.flip')}">${DOWN_ICON}</button>
          <div class="trade-field"><div class="trade-label"><span>${t('swap.receive')}</span><span>${t('swap.balance')}: <b id="swap-to-balance">—</b></span></div>
            <div class="trade-row"><output id="swap-out">0</output><span id="swap-to-slot"></span></div></div>
        </form>
        <dl class="swap-info" id="swap-info"></dl>
        <div id="swap-warn"></div>
        <button class="primary-btn swap-go" id="swap-go" disabled>${t('swap.enter')}</button>
        <div class="tool-output hidden" id="swap-msg"></div></div>
        ${stats.chainId === 52401 ? '' : `<p class="result-count swap-note">${t('swap.test')}</p>`}</aside></div>`;
    const fillButtons = () => {
      $('swap-from-slot').innerHTML = tokenButton('swap-from', tokens[from]);
      $('swap-to-slot').innerHTML = tokenButton('swap-to', tokens[to]);
      $('swap-from').onclick = () => pickToken(tokens, (i) => { from = i; redraw(); });
      $('swap-to').onclick = () => pickToken(tokens, (i) => { to = i; redraw(); });
    };
    const showBalances = async () => {
      me = await connectedAddress();
      const [a, b] = await Promise.all([balanceOf(tokens[from], me), balanceOf(tokens[to], me)]).catch(() => [null, null]);
      if (!$('swap-from-balance')) return;
      $('swap-from-balance').textContent = a === null ? '—' : units(a, tokens[from].decimals, 6);
      $('swap-to-balance').textContent = b === null ? '—' : units(b, tokens[to].decimals, 6);
    };
    async function showMarket() {
      const ticket = ++marketTicket;
      if (from === to) return;
      const m = await marketData(d, tokens[from], tokens[to], tokens[0]).catch(() => null);
      const place = $('market');
      if (ticket !== marketTicket || !place) return;
      if (!m) {
        market = null;
        place.innerHTML = `<div class="card"><div class="empty">${t('swap.noPool')}</div></div>`;
        return;
      }
      if (market?.key === m.key && place.querySelector('.market')) return;
      market = m;
      const paint = () => drawMarket(place, market, span, (next) => { span = next; paint(); });
      paint();
    }
    const info = (rows) => { $('swap-info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join(''); };
    async function quote() {
      const ticket = ++drawn;
      const go = $('swap-go');
      if (!go) return;        // the user has gone to another page in the meantime
      $('swap-msg').className = 'tool-output hidden';
      $('swap-warn').innerHTML = '';
      const [a, b] = [tokens[from], tokens[to]];
      const amount = parseAmount($('swap-in').value, a.decimals);
      route = null;
      go.disabled = true;
      $('swap-out').textContent = '0';
      if (from === to) { go.textContent = t('swap.same'); info([]); return; }
      if (amount === 0n) { go.textContent = t('swap.enter'); info([]); return; }
      const found = await swapRoute(router, a, b, amount);
      if (ticket !== drawn) return;
      if (!found) { go.textContent = t('swap.noPool'); info([]); return; }
      const probe = amount / 1000n || 1n;
      const [small, have] = await Promise.all([swapRoute(router, a, b, probe), me ? balanceOf(a, me).catch(() => null) : null]);
      if (ticket !== drawn) return;
      route = found;
      const spot = small ? Number(small.out) / Number(probe) : 0;
      const price = Number(found.out) / Number(amount);
      const impact = spot > 0 ? Math.max(0, 1 - price / spot) : 0;
      const rate = (Number(found.out) / 10 ** b.decimals) / (Number(amount) / 10 ** a.decimals);
      const minimum = found.out - (found.out * BigInt(slippageBps)) / 10000n;
      const names = found.path.map((address) => tokens.find((x) => x.address === address)?.symbol ?? (address === contracts.WAET.address ? coin() : short(address, 6)));
      $('swap-out').textContent = units(found.out, b.decimals, 8);
      info([
        [t('swap.rate'), `1 ${esc(a.symbol)} = ${esc(rate.toLocaleString(locale(), { maximumSignificantDigits: 6 }))} ${esc(b.symbol)}`],
        [t('swap.impact'), `<span class="${impact > HIGH_IMPACT ? 'bad-text' : ''}">${(impact * 100).toLocaleString(locale(), { maximumFractionDigits: 2 })} %</span>`],
        [t('swap.min'), `${units(minimum, b.decimals, 8)} ${esc(b.symbol)}`],
        [t('swap.fee'), `${(0.3 * (found.path.length - 1)).toLocaleString(locale())} %`],
        [t('swap.route'), names.map(esc).join(' → ')],
      ]);
      if (have !== null && have < amount) { go.textContent = fill('swap.noFunds', { symbol: a.symbol }); return; }
      // Only a short label fits into the button. The explanation of why the impact is large is in the warning above it.
      go.textContent = impact > HIGH_IMPACT ? t('swap.goHigh') : t('swap.go');
      go.disabled = false;
      if (impact > HIGH_IMPACT && impact <= CONFIRM_IMPACT) $('swap-warn').innerHTML = `<div class="impact-warn"><p>${t('swap.high')}</p></div>`;
      if (impact > CONFIRM_IMPACT) {
        // Estimate of how much fits into 5 %: for a constant-product pool the impact grows with the amount's share of the reserve.
        const fit = Number(amount) * (HIGH_IMPACT / (1 - HIGH_IMPACT)) * ((1 - impact) / impact);
        const max = (fit / 10 ** a.decimals).toLocaleString(locale(), { maximumSignificantDigits: 3 });
        const share = `${(impact * 100).toLocaleString(locale(), { maximumFractionDigits: impact > 0.99 ? 2 : 1 })} %`;
        $('swap-warn').innerHTML = `<div class="impact-warn"><p>${esc(fill('swap.impactWarn', { p: share, max, symbol: a.symbol }))}</p><label class="check"><input type="checkbox" id="swap-ack"><span>${t('swap.impactAck')}</span></label></div>`;
        go.disabled = true;
        $('swap-ack').onchange = (e) => { go.disabled = !e.target.checked; };
      }
    }
    const redraw = () => { fillButtons(); showBalances().then(quote); showMarket(); };
    pageTick = () => { showBalances(); showMarket(); };
    $('swap-in').addEventListener('input', quote);
    $('swap-flip').addEventListener('click', () => { [from, to] = [to, from]; redraw(); });
    $('swap-settings').addEventListener('click', (e) => {
      const open = $('swap-slip').classList.toggle('hidden');
      e.currentTarget.setAttribute('aria-expanded', String(!open));
    });
    box.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', async () => {
      const have = await balanceOf(tokens[from], me);
      if (have === null) return;
      const reserve = tokens[from].native && b.dataset.part === '100' ? ethers.parseEther(FEE_RESERVE) : 0n;
      const left = (have * BigInt(b.dataset.part)) / 100n - reserve;
      $('swap-in').value = left > 0n ? ethers.formatUnits(left, tokens[from].decimals) : '0';
      quote();
    }));
    box.querySelectorAll('[data-slip]').forEach((b) => b.addEventListener('click', () => {
      slippageBps = Number(b.dataset.slip);
      box.querySelectorAll('[data-slip]').forEach((x) => x.classList.toggle('active', x === b));
      $('swap-slip-now').textContent = `${(slippageBps / 100).toLocaleString(locale())} %`;
      quote();
    }));
    txButton($('swap-go'), $('swap-msg'), async (s) => {
      await nothingPending(s);
      const [a, b] = [tokens[from], tokens[to]];
      const amount = parseAmount($('swap-in').value, a.decimals);
      const current = await swapRoute(router, a, b, amount);
      if (!current) throw new Error(t('swap.noPool'));
      const minimum = current.out - (current.out * BigInt(slippageBps)) / 10000n;
      const address = await s.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_S;
      const signed = at('SwapRouter', d.swap.router, s);
      if (a.native) return signed.swapExactNativeForTokens(minimum, current.path, address, deadline, { value: amount });
      await approveToken(a, d.swap.router, amount, s);
      if (b.native) return signed.swapExactTokensForNative(amount, minimum, current.path, address, deadline);
      return signed.swapExactTokensForTokens(amount, minimum, current.path, address, deadline);
    }, async () => {
      const got = tokens[to];
      $('swap-in').value = ''; showBalances(); quote(); showMarket();
      return { text: t('swap.done'), node: got.native ? null : watchButton(got) };
    });
    redraw();
  }

  const LIQ_PARTS = [20, 50, 100];
  const POOL_ROWS = 10;
  const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54 0.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-0.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  /**
   * Liquidity: my deposits and all pools on the left, the deposit form on the right. The amounts of both tokens are linked
   * by the pool rate, so between them there is not a "+" but a line with the rate. Quick amounts 20 %, 50 % and Max are computed
   * with both balances: Max is the largest deposit that really passes in an existing pool.
   */
  async function poolsForm(d, tokens) {
    const box = $('swap-body');
    const known = (address) => tokens.find((x) => x.address.toLowerCase() === address.toLowerCase());
    let a = 0;
    let b = Math.min(1, tokens.length - 1);
    let shown = POOL_ROWS;
    let filter = '';
    const bal = { a: null, b: null };
    const parts = (side) => `<div class="trade-parts">${LIQ_PARTS.map((p) => `<button type="button" data-side="${side}" data-part="${p}">${p === 100 ? t('swap.max') : `${p} %`}</button>`).join('')}</div>`;
    box.innerHTML = `<div class="trade-layout">
      <div class="trade-main">
        <div class="card hidden" id="my-pools"><div class="card-header"><h2>${t('swap.mine')}</h2></div><div class="positions" id="my-list"></div></div>
        <div class="tool-output hidden" id="pool-msg"></div>
        <div class="card"><div class="card-header"><h2>${t('swap.pools')}</h2><input class="table-search" id="pool-search" type="search" placeholder="${t('swap.searchPair')}" aria-label="${t('swap.searchPair')}" spellcheck="false" autocomplete="off"></div><div id="pool-list"><div class="empty">…</div></div></div>
      </div>
      <aside class="trade-side"><div class="card trade-card">
        <div class="trade-head"><h2>${t('swap.add')}</h2></div>
        <form class="trade-form" id="add-form">
          <div class="trade-field"><div class="trade-label"><span>${t('swap.tokenA')}</span><span>${t('swap.balance')}: <b id="add-a-balance">—</b></span></div><div class="trade-row"><input name="amountA" inputmode="decimal" autocomplete="off" placeholder="0,0" aria-label="${t('swap.amountA')}"><span id="add-a-slot"></span></div>${parts('a')}</div>
          <div class="trade-link" id="add-link">${LINK_ICON}<span id="add-rate">${t('swap.linked')}</span></div>
          <div class="trade-field"><div class="trade-label"><span>${t('swap.tokenB')}</span><span>${t('swap.balance')}: <b id="add-b-balance">—</b></span></div><div class="trade-row"><input name="amountB" inputmode="decimal" autocomplete="off" placeholder="0,0" aria-label="${t('swap.amountB')}"><span id="add-b-slot"></span></div>${parts('b')}</div>
        </form>
        <dl class="swap-info" id="add-info"></dl>
        <p class="trade-note hidden" id="add-note"></p>
        <button type="button" class="primary-btn swap-go" id="add-go">${t('swap.add')}</button>
        <div class="tool-output hidden" id="add-msg"></div>
        <p class="trade-help">${t('swap.addHelp')}</p></div></aside></div>`;
    let listed = [];
    const pairName = (r) => `${esc(r.a.symbol)} / ${esc(r.b.symbol)}`;
    const coinSide = (r) => (r.a.native ? r.reserves[0] : r.b.native ? r.reserves[1] : null);
    const value = (r) => (coinSide(r) === null ? '—' : `${units(coinSide(r) * 2n, 18, 2)} ${esc(coin())}`);
    const shareOf = (r) => (r.supply ? `${(Number((r.mine * 10000n) / r.supply) / 100).toLocaleString(locale())} %` : '—');
    const pairIcons = (r) => `<div class="pair-icons small">${tokenIcon(r.a)}${tokenIcon(r.b)}</div>`;
    // What withdrawing the given part would return: the share of both pool reserves.
    const back = (r, part) => [(r.reserves[0] * r.mine * BigInt(part)) / (100n * (r.supply || 1n)), (r.reserves[1] * r.mine * BigInt(part)) / (100n * (r.supply || 1n))];
    const positionHtml = (r) => {
      const [x, y] = back(r, 100);
      return `<div class="position" data-pos="${esc(r.address)}">
        <div class="position-head">${pairIcons(r)}<div class="position-name"><strong>${pairName(r)}</strong><span class="dim-text">${t('swap.poolShare')}: ${shareOf(r)}</span></div>
          <button type="button" class="ghost-btn small" data-more="${esc(r.address)}">${t('swap.addMore')}</button></div>
        <div class="position-amounts"><span><b>${units(x, r.a.decimals, 6)}</b> ${esc(r.a.symbol)}</span><span><b>${units(y, r.b.decimals, 6)}</b> ${esc(r.b.symbol)}</span></div>
        <div class="position-remove"><span class="dim-text">${t('swap.withdrawPart')}</span>
          <div class="seg" role="group" aria-label="${t('swap.withdrawPart')}">${LIQ_PARTS.map((p) => `<button type="button" data-cut="${p}">${p === 100 ? t('swap.max') : `${p} %`}</button>`).join('')}</div>
          <button type="button" class="ghost-btn" data-remove="${esc(r.address)}" disabled>${t('swap.removeShort')}</button></div>
        <p class="position-back dim-text" data-back></p></div>`;
    };
    const rowHtml = (r) => `<tr class="rowlink" data-pick="${esc(r.address)}"><td><div class="token-cell">${pairIcons(r)}<div><strong>${pairName(r)}</strong><a class="hash dim-text" href="/address/${esc(r.address)}">${esc(short(r.address, 8))}</a></div></div></td>
      <td class="num">${units(r.reserves[0], r.a.decimals, 4)} ${esc(r.a.symbol)}<br><span class="dim-text">${units(r.reserves[1], r.b.decimals, 4)} ${esc(r.b.symbol)}</span></td>
      <td class="num">${value(r)}</td><td class="num">${r.mine > 0n ? shareOf(r) : '—'}</td></tr>`;
    const pickPair = (r) => {
      a = tokens.indexOf(r.a);
      b = tokens.indexOf(r.b);
      limit = null;
      form.amountA.value = '';
      form.amountB.value = '';
      fillButtons();
      showBalances().then(() => follow('a'));
      form.amountA.focus();
    };
    function drawTable() {
      const list = $('pool-list');
      if (!list) return;
      const words = filter.trim().toLowerCase();
      const match = listed.filter((r) => !words || `${r.a.symbol} ${r.b.symbol} ${r.address}`.toLowerCase().includes(words));
      list.innerHTML = match.length
        ? `<div class="table-wrap"><table><thead><tr><th>${t('swap.pair')}</th><th class="num">${t('swap.reserves')}</th><th class="num">${t('tokens.liquidity')}</th><th class="num">${t('swap.share')}</th></tr></thead><tbody>${match.slice(0, shown).map(rowHtml).join('')}</tbody></table></div>
          ${match.length > shown ? `<div class="more-row"><button type="button" class="ghost-btn" id="pool-more">${esc(fill('swap.showMore', { n: num(Math.min(POOL_ROWS, match.length - shown)), total: num(match.length) }))}</button></div>` : ''}`
        : `<div class="empty">${words ? t('swap.noMatch') : t('swap.noPools')}</div>`;
      list.querySelectorAll('[data-pick]').forEach((tr) => tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        e.stopPropagation();
        pickPair(listed.find((r) => r.address === tr.dataset.pick));
      }));
      $('pool-more')?.addEventListener('click', () => { shown += POOL_ROWS; drawTable(); });
    }
    /** Refreshes only the lists: a deposit being typed and the result message stay. */
    async function drawList() {
      const me = await connectedAddress();
      const pairs = await at('SwapFactory', d.swap.factory).list(0, 200);
      const rows = await Promise.all([...pairs].map(async (address) => {
        const pair = at('SwapPair', address);
        const [t0, t1, reserves, supply, mine] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves(), pair.totalSupply(), me ? pair.balanceOf(me) : 0n]);
        return { address, a: known(t0), b: known(t1), reserves: [reserves[0], reserves[1]], supply, mine };
      }));
      if (!$('pool-list')) return;
      listed = rows.filter((r) => r.a && r.b).sort((x, y) => byValue(coinSide(y) ?? 0n, coinSide(x) ?? 0n) || byValue(y.supply, x.supply));
      drawTable();
      const mineRows = listed.filter((r) => r.mine > 0n);
      $('my-pools').classList.toggle('hidden', !mineRows.length);
      const own = $('my-list');
      own.innerHTML = mineRows.map(positionHtml).join('');
      own.querySelectorAll('.position').forEach((el) => {
        const row = listed.find((r) => r.address === el.dataset.pos);
        const button = el.querySelector('[data-remove]');
        let cut = 0;
        el.querySelector('[data-more]').addEventListener('click', () => pickPair(row));
        el.querySelectorAll('[data-cut]').forEach((c) => c.addEventListener('click', () => {
          cut = Number(c.dataset.cut);
          el.querySelectorAll('[data-cut]').forEach((x) => x.classList.toggle('active', x === c));
          const [x, y] = back(row, cut);
          el.querySelector('[data-back]').textContent = fill('swap.youGet', { a: `${units(x, row.a.decimals, 6)} ${row.a.symbol}`, b: `${units(y, row.b.decimals, 6)} ${row.b.symbol}` });
          button.disabled = false;
          button.textContent = `${t('swap.removeShort')} ${cut === 100 ? t('swap.everything') : `${cut} %`}`;
        }));
        txButton(button, $('pool-msg'), async (s) => {
          if (!cut) throw new Error(t('swap.pickPart'));
          await nothingPending(s);
          const signed = at('SwapRouter', d.swap.router, s);
          const address = await s.getAddress();
          const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_S;
          const part = (row.mine * BigInt(cut)) / 100n;
          // Minimum returned amounts by rate tolerance: if the pool moves in the meantime, the transaction rather fails.
          const floor = (v) => v - (v * BigInt(slippageBps)) / 10000n;
          const [x, y] = back(row, cut).map(floor);
          await approveToken({ address: row.address }, d.swap.router, part, s);
          if (row.a.native || row.b.native) {
            const [token, minToken, minNative] = row.a.native ? [row.b, y, x] : [row.a, x, y];
            return signed.removeLiquidityNative(token.address, part, minToken, minNative, address, deadline);
          }
          return signed.removeLiquidity(row.a.address, row.b.address, part, x, y, address, deadline);
        }, async () => { await drawList(); await showBalances(); follow('a'); return t('swap.removed'); });
      });
    }
    const form = $('add-form');
    const go = $('add-go');
    const currentRow = () => listed.find((r) => (r.a === tokens[a] && r.b === tokens[b]) || (r.a === tokens[b] && r.b === tokens[a]));
    const reserve = ethers.parseEther(FEE_RESERVE);
    const spendable = (x, have) => (have === null ? null : x.native ? (have > reserve ? have - reserve : 0n) : have);
    const showBalances = async () => {
      const me = await connectedAddress();
      const [x, y] = await Promise.all([balanceOf(tokens[a], me), balanceOf(tokens[b], me)]).catch(() => [null, null]);
      if (!$('add-a-balance')) return;
      [bal.a, bal.b] = [x, y];
      $('add-a-balance').textContent = x === null ? '—' : units(x, tokens[a].decimals, 6);
      $('add-b-balance').textContent = y === null ? '—' : units(y, tokens[b].decimals, 6);
    };
    /** Pool reserves in the same order as the form: [first token, second token]. */
    const ratio = () => {
      const row = currentRow();
      if (!row || row.reserves[0] === 0n || row.reserves[1] === 0n) return null;
      return row.a === tokens[a] ? [row.reserves[0], row.reserves[1]] : [row.reserves[1], row.reserves[0]];
    };
    /**
     * Amount for a field: at most six decimals, for amounts below 1 six significant digits. Rounded down,
     * so the computed amount never exceeds the balance. The pool settles a difference in the last digit itself.
     */
    const trimmed = (v, decimals) => {
      let keep = Math.min(decimals, 6);
      if (decimals > 6 && v > 0n && v < 10n ** BigInt(decimals)) keep = Math.min(decimals, decimals - v.toString().length + 6);
      const step = 10n ** BigInt(decimals - keep);
      const text = ethers.formatUnits((v / step) * step, decimals);
      return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
    };
    // Which balance limited the quick amount. The note below the form says so; otherwise Max looks mysterious.
    let limit = null;
    /** For an existing pool computes the second amount from the rate, otherwise the surplus would stay with the user. */
    const follow = (from) => {
      const [x, y] = [tokens[a], tokens[b]];
      const r = ratio();
      const rows = [];
      if (r) {
        const [ra, rb] = r;
        if (from === 'a') {
          const amount = parseAmount(form.amountA.value, x.decimals);
          form.amountB.value = amount > 0n ? trimmed((amount * rb) / ra, y.decimals) : '';
        } else if (from === 'b') {
          const amount = parseAmount(form.amountB.value, y.decimals);
          form.amountA.value = amount > 0n ? trimmed((amount * ra) / rb, x.decimals) : '';
        }
        const price = Number(ethers.formatUnits(rb, y.decimals)) / Number(ethers.formatUnits(ra, x.decimals));
        $('add-rate').textContent = fill('swap.linkedRate', { a: x.symbol, rate: priceText(price), b: y.symbol });
        // The reverse direction of the rate: in an unbalanced pool one number is large and the other almost zero; both help.
        rows.push([t('swap.rate'), `1 ${esc(y.symbol)} = ${priceText(1 / price)} ${esc(x.symbol)}`]);
        const amountA = parseAmount(form.amountA.value, x.decimals);
        if (amountA > 0n) rows.push([t('swap.poolShare'), `${((Number(amountA) / Number(ra + amountA)) * 100).toLocaleString(locale(), { maximumFractionDigits: 2 })} %`]);
      } else {
        $('add-rate').textContent = x === y ? t('swap.same') : t('swap.newPoolRate');
        if (x !== y) rows.push([t('swap.pair'), t('swap.newPool')]);
      }
      $('add-info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
      const [amountA, amountB] = [parseAmount(form.amountA.value, x.decimals), parseAmount(form.amountB.value, y.decimals)];
      const notes = [];
      if (limit && r) notes.push(fill('swap.limitBy', { symbol: limit.by.symbol, other: limit.other.symbol }));
      // Almost all of the main coin goes into the pool: says how much is left for fees.
      const [coinAmount, coinHave] = x.native ? [amountA, bal.a] : y.native ? [amountB, bal.b] : [0n, null];
      if (coinHave && coinAmount > 0n && coinAmount <= coinHave && coinAmount * 10n >= coinHave * 9n) notes.push(fill('swap.coinLeft', { left: units(coinHave - coinAmount, 18, 6), coin: coin() }));
      $('add-note').textContent = notes.join(' ');
      $('add-note').classList.toggle('hidden', !notes.length);
      const over = (have, amount) => have !== null && amount > have;
      go.disabled = x === y || amountA === 0n || amountB === 0n || over(bal.a, amountA) || over(bal.b, amountB);
      go.textContent = x === y ? t('swap.same') : over(bal.a, amountA) ? fill('swap.noFunds', { symbol: x.symbol })
        : over(bal.b, amountB) ? fill('swap.noFunds', { symbol: y.symbol }) : amountA === 0n || amountB === 0n ? t('swap.enter') : t('swap.add');
    };
    const fillButtons = () => {
      $('add-a-slot').innerHTML = tokenButton('add-a', tokens[a]);
      $('add-b-slot').innerHTML = tokenButton('add-b', tokens[b]);
      $('add-a').onclick = () => pickToken(tokens, (i) => { a = i; limit = null; fillButtons(); showBalances().then(() => follow('a')); });
      $('add-b').onclick = () => pickToken(tokens, (i) => { b = i; limit = null; fillButtons(); showBalances().then(() => follow('a')); });
    };
    box.querySelectorAll('[data-part]').forEach((button) => button.addEventListener('click', () => {
      const side = button.dataset.side;
      const [x, other] = side === 'a' ? [tokens[a], tokens[b]] : [tokens[b], tokens[a]];
      const have = spendable(x, bal[side]);
      if (have === null) return;
      let base = have;
      limit = null;
      const r = ratio();
      const otherHave = spendable(other, bal[side === 'a' ? 'b' : 'a']);
      if (r && otherHave !== null) {
        // An existing pool takes only as much as the balance of the other token allows.
        const [mine, theirs] = side === 'a' ? r : [r[1], r[0]];
        const cap = (otherHave * mine) / theirs;
        if (cap < base) {
          base = cap;
          limit = { by: other, other: x };
        }
      }
      const amount = (base * BigInt(button.dataset.part)) / 100n;
      // The whole token balance goes into the field exactly, so no tiny remainder is left after a deposit. Other amounts are rounded.
      const exact = button.dataset.part === '100' && !limit && !x.native;
      (side === 'a' ? form.amountA : form.amountB).value = amount > 0n ? (exact ? ethers.formatUnits(amount, x.decimals).replace(/\.0$/, '') : trimmed(amount, x.decimals)) : '';
      follow(side);
    }));
    $('pool-search').addEventListener('input', (e) => { filter = e.target.value; shown = POOL_ROWS; drawTable(); });
    fillButtons();
    await Promise.all([showBalances(), drawList()]);
    follow('a');
    form.amountA.addEventListener('input', () => { limit = null; follow('a'); });
    form.amountB.addEventListener('input', () => { limit = null; follow('b'); });
    txButton(go, $('add-msg'), async (s) => {
      await nothingPending(s);
      const [x, y] = [tokens[a], tokens[b]];
      if (x === y) throw new Error(t('swap.same'));
      const [amountA, amountB] = [parseAmount(form.amountA.value, x.decimals), parseAmount(form.amountB.value, y.decimals)];
      if (amountA === 0n || amountB === 0n) throw new Error(t('swap.enter'));
      const signed = at('SwapRouter', d.swap.router, s);
      const address = await s.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_S;
      const floor = (v) => v - (v * BigInt(slippageBps)) / 10000n;
      if (x.native || y.native) {
        const [token, amountToken, amountNative] = x.native ? [y, amountB, amountA] : [x, amountA, amountB];
        await approveToken(token, d.swap.router, amountToken, s);
        return signed.addLiquidityNative(token.address, amountToken, floor(amountToken), floor(amountNative), address, deadline, { value: amountNative });
      }
      await approveToken(x, d.swap.router, amountA, s);
      await approveToken(y, d.swap.router, amountB, s);
      return signed.addLiquidity({ tokenA: x.address, tokenB: y.address, desiredA: amountA, desiredB: amountB, minA: floor(amountA), minB: floor(amountB) }, address, deadline);
    }, async () => {
      form.amountA.value = '';
      form.amountB.value = '';
      limit = null;
      await drawList();
      await showBalances();
      follow('a');
      return t('swap.added');
    });
    pageTick = () => { showBalances().then(() => follow()); };
  }

  async function pageSwap(q) {
    const d = await deployment();
    const title = head(t('nav.swap'));
    if (!d?.swap?.router) {
      app.innerHTML = `${title}<div class="notice"><strong>${t('swap.notReady')}</strong><br>${t('swap.notReadyBody')}</div>`;
      return;
    }
    const pools = q.get('view') === 'pools';
    const tab = (view, label, on) => `<a class="tab${on ? ' active' : ''}" href="/swap?view=${view}">${label}</a>`;
    app.innerHTML = `<div class="trade-page">${title}<div class="tabs">${tab('swap', t('swap.tabSwap'), !pools)}${tab('pools', t('swap.tabPools'), pools)}</div><div id="swap-body"></div></div>`;
    const tokens = await swapTokens(d);
    if (pools) await poolsForm(d, tokens);
    else swapForm(d, tokens);
  }

  // ------------------------------------------------------------- navigace
  // Pages have plain addresses like /tx/0x…, the home page is just /. Older links with #/ from the app, the wallet
  // and saved bookmarks convert themselves on opening, so they keep working.
  function legacyHash() {
    if (!location.hash.startsWith('#/')) return false;
    history.replaceState(null, '', location.hash.slice(1) || '/');
    return true;
  }
  function route() {
    const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : undefined, query: new URLSearchParams(location.search) };
  }
  /** Navigating to another page without a reload. The back button returns to the previous one. */
  function navigate(path, { replace = false } = {}) {
    const target = path.startsWith('#/') ? path.slice(1) : path;
    if (target === `${location.pathname}${location.search}`) { render(); return; }
    if (replace) history.replaceState(null, '', target); else history.pushState(null, '', target);
    window.scrollTo(0, 0);
    render();
  }
  const NAV_PARENT = { pool: 'pools', block: 'blocks', tx: 'txs', token: 'tokens' };
  const NAV_WIDTH = 1120;           // below this width the menu does not fit into the header
  const NAV_WIDTH_EMBEDDED = 860;   // in the app the brand and its name are missing, so it fits even into a narrower window
  function closeNav() {
    $('main-nav').classList.remove('open');
    $('menu-btn').setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.nav-group.open').forEach((g) => { g.classList.remove('open'); g.querySelector('button').setAttribute('aria-expanded', 'false'); });
  }
  // Each render has its own sequence number. A page the user has left in the meantime no longer shows an error
  // (for example "Cannot set properties of null" from an element that disappeared) and if it still finishes later, the new one is drawn again.
  let renderSeq = 0;
  let renderDone = 0;
  /** Title, description and canonical address of the page for search engines and shared links. */
  function pageMeta() {
    const h1 = app.querySelector('h1')?.textContent?.trim();
    const name = stats?.network && stats.network !== 'mainnet' ? `Quinvium Explorer · ${stats.network}` : 'Quinvium Explorer';
    document.title = h1 && h1 !== 'Quinvium Explorer' ? `${h1} · ${name}` : name;
    const canonical = document.querySelector('link[rel=canonical]');
    if (canonical) canonical.href = `${location.origin}${location.pathname}`;
  }
  async function render() {
    const seq = ++renderSeq;
    try {
      const out = await renderPage();
      if (seq === renderSeq) { pageMeta(); fillNames().catch(() => {}); }
      document.querySelectorAll('.js-search').forEach(attachSuggest);
      return out;
    } catch (e) {
      if (seq === renderSeq) app.innerHTML = errorBox(e.message);
      return undefined;
    } finally {
      if (seq === renderSeq) renderDone = seq;
      else if (renderDone === renderSeq) render();
    }
  }
  async function renderPage() {
    const r = route();
    pageTick = null;
    hidePreview();
    previews.clear();
    const active = NAV_PARENT[r.name] ?? r.name;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
    document.querySelectorAll('.nav-group').forEach((g) => g.classList.toggle('active', g.dataset.group.split(',').includes(active)));
    document.body.classList.toggle('home', r.name === 'home');
    closeNav();
    {
      switch (r.name) {
        case 'home': return await pageHome();
        case 'blocks': return await pageBlocks(r.query);
        case 'block': return await pageBlock(r.arg, r.query);
        case 'txs': return await pageTxs(r.query);
        case 'tx': return await pageTx(r.arg);
        case 'address': return await pageAddress(r.arg, r.query);
        case 'mempool': return await pageMempool(r.query);
        case 'richlist': return await pageRich();
        case 'network': return await pageNetwork();
        case 'charts': return await pageCharts(r.query);
        case 'miners': return await pageMiners(r.query);
        case 'mining': return pageMining();
        case 'apps': return pageApps();
        case 'pools': return r.arg === 'new' ? await pageNewPool() : await pagePools(r.query);
        case 'pool': return await pagePool(r.arg, r.query);
        case 'swap': return await pageSwap(r.query);
        case 'tokens': return await pageTokens();
        case 'token': return await pageToken(r.arg, r.query);
        case 'bridge': return await pageBridge(r.query);
        case 'api': return pageApi(r.arg);
        default: navigate('/', { replace: true }); return undefined;
      }
    }
  }

  function theme(v) {
    document.documentElement.setAttribute('data-theme', v);
    store.set('aether.theme', v);
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === v)));
  }

  /** Header menus: only one is open at a time; a click outside or Escape closes it. */
  function menus() {
    const pairs = [['net-btn', 'net-pop'], ['hnet-btn', 'hnet-pop'], ['lang-btn', 'lang-pop']];
    const closeAll = () => {
      for (const [b, p] of pairs) { $(p).classList.remove('open'); $(b).setAttribute('aria-expanded', 'false'); }
      $('account-pop').classList.remove('open');
    };
    for (const [b, p] of pairs) {
      $(b).onclick = (e) => {
        e.stopPropagation();
        const open = $(p).classList.contains('open');
        closeAll();
        if (!open) { $(p).classList.add('open'); $(b).setAttribute('aria-expanded', 'true'); }
      };
    }
    document.addEventListener('click', (e) => { if (!e.target.closest('.pop') && !e.target.closest('#login-btn')) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
    $('lang-pop').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (!b) return;
      lang = b.dataset.lang;
      store.set('aether.lang', lang);
      closeAll();
      applyLang();
      render();
    });
    $('net-pop').addEventListener('click', () => closeAll());
    $('hnet-pop').addEventListener('click', () => closeAll());
  }

  // ------------------------------------------------------------- search suggestions
  // While typing, the search offers matches: blocks, transactions and known addresses from the node,
  // tokens from the Swap factory, pools from the pool factory and .qu names from their contract. The filter narrows the kinds.
  const SUGGEST_FILTERS = ['all', 'addresses', 'tokens', 'blocks', 'txs', 'pools', 'names'];
  let suggestTokens = null;
  async function tokenSuggestions(q) {
    suggestTokens ??= (async () => {
      const d = await deployment().catch(() => null);
      return d?.swap?.factory ? swapTokens(d).catch(() => []) : [];
    })();
    const list = await suggestTokens;
    return list.filter((x) => !x.native && (String(x.symbol).toLowerCase().startsWith(q) || String(x.name).toLowerCase().includes(q) || x.address.toLowerCase().startsWith(q)))
      .slice(0, 4).map((x) => ({ type: 'token', id: x.address, symbol: x.symbol, name: x.name }));
  }
  async function nameSuggestion(q) {
    const name = q.replace(/\.qu$/, '');
    if (!contracts.AetherNames || !/^[a-z0-9-]{1,63}$/.test(name)) return [];
    const target = await new ethers.Contract(contracts.AetherNames.address, contracts.AetherNames.abi, provider()).resolve(name).catch(() => ethers.ZeroAddress);
    return target && target !== ethers.ZeroAddress ? [{ type: 'name', id: target, name: `${name}.qu` }] : [];
  }
  async function suggestions(q, filter) {
    const s = q.trim();
    const lower = s.toLowerCase();
    if (!s) return [];
    const want = (k) => filter === 'all' || filter === k;
    const jobs = [];
    if (want('blocks') || want('txs') || want('addresses')) {
      jobs.push(rpc('aether_suggest', [s, { type: ['blocks', 'txs', 'addresses'].includes(filter) ? filter : 'all', limit: 6 }])
        .catch(async () => { const hit = await rpc('aether_search', [s]).catch(() => null); return hit ? [{ type: hit.type, id: hit.id }] : []; }));
    }
    if (want('pools') && s.length >= 2) jobs.push(rpc('aether_pools', [{ query: lower, limit: 4 }]).then((r) => r.items.map((p) => ({ type: 'pool', id: p.address, name: p.name, fee: p.feeBps }))).catch(() => []));
    if (want('tokens') && s.length >= 2) jobs.push(tokenSuggestions(lower).catch(() => []));
    if (want('names') && !lower.startsWith('0x')) jobs.push(nameSuggestion(lower).catch(() => []));
    const seen = new Set();
    const out = [];
    for (const x of (await Promise.all(jobs)).flat()) {
      const key = `${x.type}:${String(x.id).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x);
    }
    return out.slice(0, 10);
  }
  const suggestHref = (x) => ({ block: `/block/${x.id}`, tx: `/tx/${x.id}`, address: `/address/${x.id}`, name: `/address/${x.id}`, token: `/token/${x.id}`, pool: `/pool/${x.id}` }[x.type]);
  function suggestRow(x) {
    const main = {
      block: () => `#${num(x.id)}`, tx: () => `<span class="hash">${esc(short(x.id, 12))}</span>`,
      address: () => `<span class="hash">${esc(short(x.id, 12))}</span>${labelOf(x.id) ? ` <b>${esc(labelOf(x.id))}</b>` : ''}`,
      token: () => `<b>${esc(x.symbol)}</b> ${esc(x.name)}`, pool: () => `<b>${esc(x.name)}</b>`, name: () => `<b>${esc(x.name)}</b>`,
    }[x.type]();
    const sub = {
      block: () => (x.hash ? short(x.hash, 10) : ''), tx: () => (x.pending ? t('sg.pending') : ''),
      address: () => (x.contract ? t('sg.contract') : x.balance !== undefined ? `${aet(BigInt(x.balance), 4)} ${coin()}` : ''),
      token: () => short(x.id, 8), pool: () => `${short(x.id, 8)} · ${percent(x.fee)}`, name: () => short(x.id, 8),
    }[x.type]();
    return `<span class="sg-type">${t(`sg.${x.type}`)}</span><span class="sg-main">${main}</span><span class="sg-sub">${esc(sub)}</span>`;
  }
  /** Attaches the suggestion list to a search form. Arrows move, Enter opens, Escape closes. */
  function attachSuggest(form) {
    if (form.suggest) return;
    const input = form.querySelector('input');
    const box = document.createElement('div');
    box.className = 'suggest';
    box.setAttribute('role', 'listbox');
    box.hidden = true;
    form.append(box);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    let items = [];
    let active = -1;
    let ticket = 0;
    let timer = 0;
    const filter = () => form.querySelector('.search-filter')?.value ?? 'all';
    const close = () => { box.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
    const paint = () => {
      box.innerHTML = items.length
        ? items.map((x, i) => `<a class="sg-item${i === active ? ' active' : ''}" role="option" aria-selected="${i === active}" href="${suggestHref(x)}">${suggestRow(x)}</a>`).join('')
        : `<p class="sg-empty">${t('sg.none')}</p>`;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const run = async () => {
      const q = input.value.trim();
      const mine = ++ticket;
      if (q.length < 1) { close(); return; }
      const found = await suggestions(q, filter());
      if (mine !== ticket || input.value.trim() !== q) return;
      items = found;
      active = items.length && filter() !== 'all' ? 0 : -1;
      paint();
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    input.addEventListener('focus', () => { if (input.value.trim()) run(); });
    input.addEventListener('keydown', (e) => {
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1) + (active < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length;
        paint();
      } else if (e.key === 'Escape') close();
    });
    form.querySelector('.search-filter')?.addEventListener('change', () => { if (input.value.trim()) run(); input.focus(); });
    box.addEventListener('mousedown', (e) => e.preventDefault());   // a click keeps the focus, the link opens normally
    box.addEventListener('click', (e) => { if (e.target.closest('.sg-item')) { close(); input.value = ''; } });
    input.addEventListener('blur', () => setTimeout(close, 120));
    form.suggest = { close, chosen: () => (!box.hidden && active >= 0 && items[active] ? suggestHref(items[active]) : null) };
  }
  const filterSelect = () => `<select class="search-filter" aria-label="${esc(t('sg.filter'))}">${SUGGEST_FILTERS.map((f) => `<option value="${f}">${esc(t(`sg.f.${f}`))}</option>`).join('')}</select>`;

  /** The Quinvium domains: the network switch moves between explorer. and testnet. instead of local ports. */
  const NET_DOMAINS = { mainnet: 'explorer.quinvium.com', testnet: 'testnet.quinvium.com' };

  async function init() {
    // The Quinvium app switches Explorer pages directly through this path, without the old # address. Applies right from load.
    window.explorerGo = (path) => navigate(String(path).replace(/^#/, '') || '/');
    document.body.classList.toggle('embedded', embedded);
    $('lang-pop').innerHTML = Object.entries(LANGUAGES).map(([code, name]) => `<button role="menuitemradio" data-lang="${code}">${name}</button>`).join('');
    theme(store.get('aether.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    applyLang();
    menus();
    try { contracts = await (await fetch('/contracts.json')).json(); } catch { contracts = {}; }
    document.querySelectorAll('[data-theme-set]').forEach((b) => { b.onclick = () => theme(b.dataset.themeSet); });

    $('footer-year').textContent = String(new Date().getFullYear());
    $('to-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    $('login-btn').onclick = () => (account && !wrongNetwork() ? $('account-pop').classList.toggle('open') : connect().catch(() => { /* průvodce už vše řekl */ }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') walletCancel(); });
    // On a narrow screen the whole menu is behind one button. Groups open on click, and with a mouse also on hover.
    const narrow = matchMedia(`(max-width: ${embedded ? NAV_WIDTH_EMBEDDED : NAV_WIDTH}px)`);
    // Labels differ in length between languages, so the menu also folds whenever it does not fit next to the search.
    const navOverflows = () => {
      const nav = $('main-nav');
      const search = document.querySelector('.header-search');
      if (nav.scrollWidth > nav.clientWidth + 1) return true;
      if (!search) return false;
      const n = nav.getBoundingClientRect();
      const r = search.getBoundingClientRect();
      return document.documentElement.dir === 'rtl' ? n.left < r.right - 1 : n.right > r.left + 1;
    };
    const compactNav = () => {
      document.body.classList.remove('compact-nav');
      document.body.classList.toggle('compact-nav', narrow.matches || navOverflows());
      closeNav();
    };
    narrow.addEventListener('change', compactNav);
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(compactNav, 100); });
    fitNav = compactNav;
    compactNav();
    $('menu-btn').onclick = () => $('menu-btn').setAttribute('aria-expanded', String($('main-nav').classList.toggle('open')));
    document.querySelectorAll('.nav-group').forEach((g) => {
      const button = g.querySelector('button');
      button.onclick = (e) => {
        e.stopPropagation();
        const open = !g.classList.contains('open');
        closeNav();
        $('main-nav').classList.toggle('open', narrow.matches);
        g.classList.toggle('open', open);
        button.setAttribute('aria-expanded', String(open));
      };
      g.querySelector('.nav-menu').addEventListener('click', () => g.classList.add('dismissed'));
      g.addEventListener('mouseleave', () => g.classList.remove('dismissed'));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.nav-group') && !e.target.closest('#menu-btn')) closeNav(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
    document.querySelectorAll('.net-pop [data-net]').forEach((b) => {
      b.onclick = async () => {
        const domain = NET_DOMAINS[b.dataset.net];
        if (Object.values(NET_DOMAINS).includes(location.hostname)) {
          if (domain === location.hostname) return;
          // Blocks, transactions and addresses differ between networks; other pages exist on both.
          const { name } = route();
          const same = !['block', 'tx', 'address', 'token', 'pool'].includes(name);
          location.href = `https://${domain}${same ? location.pathname : '/'}`;
          return;
        }
        const port = PORTS[b.dataset.net];
        const target = location.port === String(port) ? location.origin : `${location.protocol}//${location.hostname}:${port}`;
        // A network without a running node would show only an error; we stay on the one that works.
        const alive = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
        if (!alive) { toast(fill('net.off', { net: esc(b.textContent) })); return; }
        rpcBase = target;
        store.set('aether.rpc', rpcBase);
        await refreshStats();
        live();
        render();
      };
    });
    // Search is in the header and on the overview; both fields go the same way.
    document.addEventListener('submit', async (e) => {
      const form = e.target.closest('.js-search');
      if (!form) return;
      e.preventDefault();
      const input = form.querySelector('input');
      const q = input.value.trim();
      if (!q) return;
      const picked = form.suggest?.chosen();
      if (picked) { form.suggest.close(); input.value = ''; navigate(picked); return; }
      const hit = await rpc('aether_search', [q]).catch(() => null);
      if (!hit) { toast(`${t('search.none')} ${esc(q)}`); return; }
      input.value = '';
      navigate(`/${hit.type}/${hit.id}`);
    });
    // A link inside the Explorer opens without a reload. Files, new tabs and external links are left to the browser.
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href.startsWith('/') || href.startsWith('//') || /\.[a-z0-9]+(\?|$)/i.test(href.split('#')[0])) return;
      e.preventDefault();
      navigate(href);
    });
    window.addEventListener('popstate', render);
    window.addEventListener('hashchange', () => { if (legacyHash()) render(); });
    legacyHash();
    await refreshStats();
    deployment().catch(() => { /* without a deployment the contract labels are not shown */ });
    walletReady = syncWallet();
    if (!stats && NODES.length && await pickNode()) await refreshStats();
    if (!stats && !NODES.length && rpcBase !== location.origin) { rpcBase = location.origin; store.set('aether.rpc', rpcBase); await refreshStats(); }
    live();
    render();
    setInterval(refreshStats, 15000);
    // A node that answers but lags would not raise an error by itself. Once a minute it is compared with the others.
    if (NODES.length > 1) {
      // Right away too: a node on another branch than the majority must not stay selected for the first minute.
      if (stats) pickNode().then((moved) => { if (moved) refreshStats(); });
      setInterval(() => { pickNode().then((moved) => { if (moved) refreshStats(); }); }, 60000);
    }
  }
  init();
})();
