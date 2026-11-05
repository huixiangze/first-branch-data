@echo off
cd /d "%~dp0"
if not exist logs mkdir logs

set "NODE_BIN=C:\BtSoft\nodejs\v26.13.0\node.exe"
if not exist "%NODE_BIN%" (
  for /d %%D in ("C:\BtSoft\nodejs\*") do (
    if exist "%%D\node.exe" set "NODE_BIN=%%D\node.exe"
  )
)
if not exist "%NODE_BIN%" (
  echo [ERROR] node.exe not found at %NODE_BIN%
  echo Edit NODE_BIN in this script to your node.exe path.
  pause
  exit /b 1
)

echo Using node: %NODE_BIN%
:loop
echo [%date% %time%] Starting server.js >> logs\app.out
"%NODE_BIN%" server.js >> logs\app.out 2>&1
echo [%date% %time%] node exited, restart in 3s >> logs\app.out
timeout /t 3 >nul
goto loop
