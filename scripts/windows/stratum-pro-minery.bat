@echo off
chcp 65001 >nul
rem Uzly ve stejne siti se najdou samy. Kdyz ne, doplnte --seeds ADRESA:30525 --allow-private. Stratum je otevreny pro minery v mistni siti (port 3334).
quintium-node.exe --network testnet --lan --stratum-host 0.0.0.0
pause
