# DNS pro quinvium.com v Cloudflare (návrh, zatím nenasazeno)

Platí stav k 15. 11. 2026: nameservery `marjory.ns.cloudflare.com` a `nolan.ns.cloudflare.com`.

## Co zůstává „DNS only“ (šedý mráček)

| Název | Proč |
| --- | --- |
| `@`, `www`, `explorer`, `testnet` | GitHub Pages vydává certifikát jen bez proxy |
| `rpc`, `rpc1` | uzel na VPS má vlastní certifikát (Caddy) a limit podle IP návštěvníka |
| `seed` | P2P na portu 30524, Cloudflare proxy pouští jen web |
| `pool` | Stratum na portu 4444, totéž |

## Volitelný krok: rpcpool.quinvium.com (Worker)

Jedna stálá adresa pro peněženky, která při výpadku VPS přepne na ověřené uzly komunity.

1. Workers & Pages → Create → Worker, název `rpcpool`, vložit obsah `ops/cloudflare/rpcpool-worker.js`.
2. Settings → Variables: `PRIMARY` = `https://rpc.quinvium.com`.
3. Settings → Domains & Routes → Add → Custom domain `rpcpool.quinvium.com`. Cloudflare sám založí záznam s oranžovým mráčkem, jen pro tento název.
4. Ověření: `curl -s -X POST https://rpcpool.quinvium.com -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'`.

Bezplatný plán má 100 000 požadavků denně. Ostatní záznamy se nemění.
