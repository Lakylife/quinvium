# Server testnetu u Hostingeru

| Co | Hodnota |
| --- | --- |
| VPS | Hostinger KVM 2, Frankfurt, Ubuntu 24.04, id 2159076 |
| Adresy | IPv4 72.61.21.209, IPv6 2a02:4780:41:2b4e::1 |
| Doména | quinvium.com (registrace u Hostingeru) |
| Přihlášení | `ssh root@72.61.21.209` klíčem `~/.ssh/id_ed25519` |

## Co tam běží

| Služba | K čemu | Port |
| --- | --- | --- |
| `quinvium-node` (systemd) | uzel testnetu, podává i Explorer; uživatel `quinvium`, data `/var/lib/quinvium/testnet` (včetně `node.key`) | RPC 127.0.0.1:8546, P2P 30525 |
| `quinvium-mainnet` (systemd) | uzel mainnetu od 13. 11. 2026, data `/var/lib/quinvium/mainnet` (stejný `node.key`), viz `docs/MAINNET-START.md` | RPC 127.0.0.1:8545, P2P 30524 |
| `caddy` | HTTPS: `quinvium.com` domovská stránka (`/var/www/quinvium`, zdroj `packages/website/public`), `www` přesměruje; `explorer.quinvium.com` a `rpc.quinvium.com` mainnet (8545); `testnet.quinvium.com` a `rpc1.quinvium.com` testnet (8546) | 80, 443 |
| `ufw`, `fail2ban`, `unattended-upgrades` | firewall (22, 80, 443, 30524, 30525), ochrana SSH, bezpečnostní aktualizace | |

Uzel běží s `--no-mining-rpc` a `--trust-proxy`. Na serveru se netěží, podmínky Hostingeru to zakazují.

## Soubory

Šablony jsou na iMacu v `~/.aether/nastroje/server-hostinger`:

| Soubor | K čemu |
| --- | --- |
| `priprava.sh` | jednorázová příprava serveru (spouští se jako root) |
| `quinvium-node.service`, `quinvium-mainnet.service` | služby uzlů, na serveru `/etc/systemd/system/` |
| `Caddyfile` | na serveru `/etc/caddy/Caddyfile` |
| `nasadit.sh` | nahraje uzel a Explorer ze zdrojů a restartuje službu testnetu (mainnet restartovat ručně `systemctl restart quinvium-mainnet`) |
| `nasadit-downloads.sh` | nahraje složku s programy jedné verze do `/var/www/quinvium-downloads/<verze>` a ověří součty |
| `nasadit-web.sh` | nahraje domovskou stránku, soubory Exploreru a Caddyfile, jen znovu načte Caddy (uzly běží dál) |

## Údržba

- **Aktualizace uzlu:** `bash ~/.aether/nastroje/server-hostinger/nasadit.sh`.
- **Protokol:** `ssh root@72.61.21.209 journalctl -u quinvium-node -f` (mainnet `-u quinvium-mainnet`), pro Caddy `journalctl -u caddy`.
- **Stav:** `curl https://rpc1.quinvium.com/health`.
- **Klíč identity uzlu:** `aether_nodeInfo` na serveru (`curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"aether_nodeInfo","params":[]}' http://127.0.0.1:8546`). Při přesunu serveru přenést `node.key`, jinak seed s připnutým klíčem uzly odmítnou.

## Stav k 13. 11. 2026

- Od 13. 11. 20:52 UTC běží testnet-5 (genesis `0x4845f69c…d121`). Data testnetu-4 jsou v `/var/lib/quinvium/testnet-4-stara`, `node.key` se do nové složky zkopíroval, seed proto platí dál. Bloky přicházejí od dočasného uzlu na iMacu, který se k serveru připojí sám přes seed.
- Při restartu testnetu: zastavit službu, přesunout `/var/lib/quinvium/testnet` stranou, vytvořit novou složku (vlastník `quinvium`), zkopírovat do ní `node.key`, spustit `nasadit.sh`.
- Identita uzlu (veřejný klíč) `2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d`, seed pro `params.js`: `2df5ea8b…f78d@seed.quinvium.com:30525`.
- SSH jen klíčem (heslo vypnuté v `/etc/ssh/sshd_config.d/10-quinvium.conf`).
- DNS quinvium.com se zapisuje ručně v hPanelu (DNS / Nameservers): A a AAAA pro `@`, `rpc1` a `seed` na adresy serveru, `www` je CNAME na `quinvium.com`. Zapsané 13. 11. ve 20:10.
- Certifikáty Let's Encrypt pro quinvium.com, www a rpc1 platí do 11. 2. 2027, Caddy je obnovuje sám. Ověřeno: chainId 0xccb2, výška shodná s dočasným uzlem, `/health` ok, `eth_getWork` a `eth_submitHashrate` odmítnuté, WebSocket (101), IPv6, Explorer s hlavičkami CSP.
- DNS pro mainnet: A a AAAA pro `rpc` na adresy serveru (seed mainnetu je stejné jméno `seed.quinvium.com`, port 30524).
- DNS pro web (13. 11.): A a AAAA pro `explorer` a `testnet` na adresy serveru.
