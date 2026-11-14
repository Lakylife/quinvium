@echo off
chcp 65001 >nul
rem Opens Stratum for miners on the local network (port 3333).
quintium-node.exe --network mainnet --lan --stratum-host 0.0.0.0
pause
