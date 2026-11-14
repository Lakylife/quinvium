@echo off
chcp 65001 >nul
rem Opens Stratum for miners on the local network (port 3334). Nodes on the same network find each other.
quintium-node.exe --network testnet --lan --stratum-host 0.0.0.0
pause
