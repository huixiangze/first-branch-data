@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
  for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%~fd\node.exe" set "NODE_EXE=%%~fd\node.exe"
  )
)

"%NODE_EXE%" "%~dp0scripts\pull-kdocs.js" %*
endlocal
