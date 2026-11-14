@echo off
chcp 65001 >nul
rem Joins the mainnet through seed.quinvium.com. JSON-RPC and the Explorer: http://127.0.0.1:8545
quintium-node.exe --network mainnet --lan
pause
