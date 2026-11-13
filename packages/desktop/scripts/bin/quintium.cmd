@echo off
rem Prikazova radka Quinvium. Pouzije Node zabudovany v aplikaci.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Aether.exe" "%~dp0quintium-node.cjs" cli %*
