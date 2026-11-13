@echo off
chcp 65001 >nul
set /p ADDRESS=Zadejte adresu pro vyplatu odmen (0x...): 
quintium-miner.exe --address %ADDRESS% --node http://127.0.0.1:8546
pause
