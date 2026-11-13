@echo off
chcp 65001 >nul
rem Uzly ve stejne siti se najdou samy. Kdyz ne, doplnte --seeds ADRESA:30525 --allow-private.
quintium-node.exe --network testnet --lan
pause
