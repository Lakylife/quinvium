# Spuštění mainnetu

| Co | Hodnota |
| --- | --- |
| Start | 14. 11. 2026 00:00 SEČ (13. 11. 23:00 UTC), `genesisTimestamp: 1794610800n` |
| Genesis | `0x49c889ad9d4f44869cf7f97a6e079a50dbf13974263b1afedec3b774ebeeac39` |
| Chain ID | 52401, mince QU |
| Počáteční obtížnost | 2^27 (asi 9 MH/s pro blok za 15 s), minimum 2^24, LWMA s oknem 60 bloků |
| Odměna | 4 QU za blok, půlení po 8 mil. bloků, strop 64 mil. QU, bez premine |
| Genesis | předinstalované kontrakty bez vlastníka a bez zůstatků, `predeploys.json` stejný jako na testnetu |
| Seed | `2df5ea8b9b4e18c552a001434e6b7ed0fc99348a03478fd809de1f92fde2f78d@seed.quinvium.com:30524` |
| Veřejné RPC | `https://rpc.quinvium.com` (server u Hostingeru, služba `quinvium-mainnet`) |
| Explorer | `https://explorer.quinvium.com`, domovská stránka `https://quinvium.com` |
| Verze | 2.14.0 |

Rozhodnutí uživatele 13. 11. 2026: mainnet hned, bez aktualizací na dálku, bez registru tokenů, obtížnost 2^27, zkratka QU, výplaty první těžby na adresu uživatele.

## Co běží při startu

| Kde | Co |
| --- | --- |
| server 72.61.21.209 | `quinvium-mainnet` (RPC 127.0.0.1:8545, P2P 30524, `--no-mining-rpc`, `--trust-proxy`), data `/var/lib/quinvium/mainnet` |
| iMac | dočasný uzel `~/.aether/mainnet-start` (RPC 8598, P2P 30527, Stratum 3337) a těžař `quintium-miner` na grafické kartě |

## Otevřené body

- **Klíč aktualizací** leží jako soubor na iMacu. Aplikace proto na mainnetu aktualizace na dálku nestahuje. Před zapnutím aktualizací vytvořit klíč mimo iMac (hardwarové zařízení nebo offline počítač) a do aplikace dát jen jeho veřejnou část.
- **Multisig:** registr tokenů na mainnetu není nasazený, potřebuje vlastníka v multisigu s klíči na hardwarových peněženkách.
- **Nezávislý audit** a program odměn za chyby.
- **Právní posouzení (MiCA)** a prověření jména Quinvium a zkratky QU.
- **Podpis programů pro Windows** a Chrome Web Store.
- **Druhý nezávislý server** (jiný poskytovatel) jako seed a `rpc2`. Teď nese síť jeden server a iMac.
- **Most** na mainnetu jen s nezávislými validátory.
- **Kontrolní body** (`checkpoints`) přidávat s dalšími verzemi.
