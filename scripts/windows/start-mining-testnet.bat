@echo off
chcp 65001 >nul
set /p ADDRESS=Enter the address for mining rewards (0x...): 
quintium-miner.exe --address %ADDRESS% --node http://127.0.0.1:8546
pause
