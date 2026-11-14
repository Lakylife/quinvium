@echo off
chcp 65001 >nul
rem Nodes on the same local network find each other. Otherwise add --seeds ADDRESS:30525 --allow-private.
quintium-node.exe --network testnet --lan
pause
