@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title DP Data Pull - TEST
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
echo  TEST: pull the FIRST link only, force download.
echo  A browser window will open. Do NOT close it.
echo  If a download starts, the pipeline works.
echo ============================================================
echo.

"%NODE_EXE%" "%~dp0scripts\pull-kdocs.js" --test --force

echo.
echo ------------------------------------------------------------
echo  Check the messages above:
echo   [OK] file downloaded      -> direct pull works
echo   [FAIL] nothing downloaded -> see 3 hints in the output
echo ------------------------------------------------------------
pause
endlocal
