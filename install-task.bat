@echo off
REM Install as Windows startup task so the platform survives reboot (runs without a logged-in user)
cd /d "%~dp0"
schtasks /Create /TN "FirstBranchData" /TR "\"%~dp0start.bat\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if %errorlevel%==0 ( echo [OK] Task "FirstBranchData" installed, will auto-start on boot. ) else ( echo [FAIL] Could not install task. )
