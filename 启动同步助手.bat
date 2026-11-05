@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title DP Data Sync Agent
cd /d "%~dp0"

rem Force UTF-8 for Python child processes, otherwise Chinese filenames
rem come back as GBK and the agent cannot find the downloaded file.
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
  for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%~fd\node.exe" set "NODE_EXE=%%~fd\node.exe"
  )
)
if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Open WorkBuddy once, then retry.
  pause
  exit /b 1
)

echo ============================================================
echo  Data sync agent starting ...
echo  Config : %USERPROFILE%\.dp-sync\config.json
echo  Log    : %USERPROFILE%\.dp-sync\sync.log
echo  Keep this window OPEN. Close it to stop syncing.
echo ============================================================
echo.
"%NODE_EXE%" "%~dp0scripts\sync-agent.js" %*

echo.
echo Agent stopped. Check log: %USERPROFILE%\.dp-sync\sync.log
pause
endlocal
