# DNS pro quinvium.com v Cloudflare (návrh, zatím nenasazeno)

Platí stav k 15. 11. 2026: nameservery `marjory.ns.cloudflare.com` a `nolan.ns.cloudflare.com`.

## Co zůstává „DNS only“ (šedý mráček)

| Název | Proč |
| --- | --- |
| `@`, `www`, `explorer`, `testnet` | GitHub Pages vydává certifikát jen bez proxy |
| `rpc`, `rpc1` | uzel na VPS má vlastní certifikát (Caddy) a limit podle IP návštěvníka |
| `seed` | P2P na portu 30524, Cloudflare proxy pouští jen web |
| `pool` | Stratum na portu 4444, totéž |

## Záložní RPC: rpc-backup.quinvium.com (Worker, v limitu zdarma)

`rpc.quinvium.com` je „Proxied“, ale **bez trasy Workeru**. Proxy bez Workeru se do denního limitu 100 000 požadavků nepočítá, takže běžný provoz (Explorer, web, peněženky, roboti) limit nevyčerpá. Worker `rpc-failover` (`ops/cloudflare/rpc-failover-worker.js`) běží jen na vlastní adrese `rpc-backup.quinvium.com`, kterou klienti použijí až jako druhou adresu RPC. Explorer, web a rozšíření do prohlížeče při výpadku přecházejí na uzly komunity samy.

1. Workers & Pages → `rpc-failover` → Settings → Domains & Routes: smazat trasu `rpc.quinvium.com/*`.
2. Tamtéž Add → Custom domain → `rpc-backup.quinvium.com`. Cloudflare sám založí záznam s oranžovým mráčkem jen pro tento název.
3. Edit code: vložit nový obsah `ops/cloudflare/rpc-failover-worker.js` a Deploy.
4. Volitelně Settings → Variables: `PRIMARY` = `https://rpc.quinvium.com/` (bez ní platí totéž).
5. DNS: záznamy `rpc` (A i AAAA) nechat „Proxied“, nic dalšího neměnit.
6. Ověření: `curl -s -X POST https://rpc-backup.quinvium.com -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'` vrátí číslo bloku a hlavičku `x-quinvium-node: rpc.quinvium.com`.
