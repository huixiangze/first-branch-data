@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell);" ^
  "$p = Join-Path ([Environment]::GetFolderPath('Startup')) 'DP Data Sync Agent.lnk';" ^
  "$l = $s.CreateShortcut($p);" ^
  "$l.TargetPath = '%~dp0启动同步助手.bat';" ^
  "$l.WorkingDirectory = '%~dp0';" ^
  "$l.WindowStyle = 7;" ^
  "$l.Description = 'Auto sync kdocs exports into cloud database';" ^
  "$l.Save();" ^
  "Write-Host ('Created: ' + $p)"

if errorlevel 1 (
  echo [ERROR] Failed to create startup shortcut.
) else (
  echo.
  echo Done. The sync agent will start automatically on next login.
  echo To cancel: delete that shortcut in shell:startup
)
echo.
pause
endlocal
