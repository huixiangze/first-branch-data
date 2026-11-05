@echo off
rem ---------------------------------------------------------------
rem DP Data Sync Agent - resident runner (hidden window)
rem Started by sync-hidden.vbs. Restarts the agent if it exits.
rem Keep this file pure ASCII: it is launched with an unknown codepage.
rem ---------------------------------------------------------------
setlocal
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

set "HERE=%~dp0"
cd /d "%HERE%.."
set "LOG=%USERPROFILE%\.dp-sync\sync.log"
set "NODEFILE=%HERE%node-path.txt"

:resolve_node
set "NODE_EXE="
if exist "%NODEFILE%" set /p NODE_EXE=<"%NODEFILE%"
if defined NODE_EXE if not exist "%NODE_EXE%" set "NODE_EXE="
if not defined NODE_EXE (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%i"
  )
)
if not defined NODE_EXE (
  for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%~fd\node.exe" set "NODE_EXE=%%~fd\node.exe"
  )
)
if not defined NODE_EXE (
  >>"%LOG%" echo [%DATE% %TIME%] [runner] ERROR node.exe not found, giving up
  exit /b 1
)

set /a RESTARTS=0
:loop
>>"%LOG%" echo [%DATE% %TIME%] [runner] launch %NODE_EXE%
"%NODE_EXE%" "scripts\sync-agent.js" >>"%LOG%" 2>&1
set /a RESTARTS+=1
if %RESTARTS% GEQ 30 (
  >>"%LOG%" echo [%DATE% %TIME%] [runner] restarted %RESTARTS% times, giving up
  exit /b 1
)
>>"%LOG%" echo [%DATE% %TIME%] [runner] agent exited, retry in 60s (attempt %RESTARTS%)
timeout /t 60 /nobreak >nul
goto loop
