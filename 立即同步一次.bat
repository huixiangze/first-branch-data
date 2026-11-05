@echo off
chcp 65001 >nul
title DP Data Pull
cd /d "%~dp0"

rem Force UTF-8 for Python child processes (avoid GBK filename corruption).
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
echo  Pull latest files from KDocs now
echo ============================================================
echo.
"%NODE_EXE%" "%~dp0scripts\pull-kdocs.js" --force
echo.
echo Finished. Press any key to close.
pause >nul
