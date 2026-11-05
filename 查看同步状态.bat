@echo off
chcp 65001 >nul
title 数据同步助手 - 状态
setlocal

set "SYNC=%USERPROFILE%\.dp-sync\sync.log"
set "PULL=%USERPROFILE%\.dp-sync\pull.log"
set "PSTATE=%USERPROFILE%\.dp-sync\pull-state.json"
set "LOCK=%USERPROFILE%\.dp-sync\agent.lock"

echo ============================================================
echo   第一分公司数据云台 —— 同步助手状态
echo ============================================================
echo.

echo ---------------- 进程 ----------------
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*sync-agent*' }; if ($p) { foreach ($x in $p) { Write-Host ('   运行中  PID ' + $x.ProcessId + '   启动于 ' + $x.CreationDate) } } else { Write-Host '   未运行' }"

if exist "%LOCK%" (
  echo.
  echo   锁文件记录： 
  powershell -NoProfile -Command "Write-Host ('   PID ' + ((Get-Content -LiteralPath '%LOCK%' -Raw).Trim()))"
)

echo.
echo ---------------- 最近活动 ----------------
if exist "%SYNC%" for %%f in ("%SYNC%") do echo   数据同步日志： %%~tf
if exist "%PULL%" for %%f in ("%PULL%") do echo   链接拉取日志： %%~tf

echo.
echo ---------------- 链接拉取（最近 8 行） ----------------
if exist "%PULL%" (
  powershell -NoProfile -Command "Get-Content -LiteralPath '%PULL%' -Tail 8 -Encoding UTF8"
) else (
  echo   （还没有拉取日志）
)

echo.
echo ---------------- 暂停的链接 ----------------
if exist "%PSTATE%" (
  powershell -NoProfile -Command "$j = Get-Content -LiteralPath '%PSTATE%' -Raw -Encoding UTF8 | ConvertFrom-Json; $bad = $j.links.PSObject.Properties | Where-Object { $_.Value.fail }; if ($bad) { $bad | ForEach-Object { Write-Host ('   ' + $_.Name + '  连续失败 ' + $_.Value.fail + ' 次  原因 ' + $_.Value.lastError + '  → 修复后双击「测试拉取.bat」') } } else { Write-Host '   无，所有链接正常' }"
) else (
  echo   无记录
)

echo.
echo ============================================================
echo   启动：双击「启动同步助手（静默）.vbs」  无窗口，挂了会自动重启
echo   停止：任务管理器结束 node.exe   （sync-agent.js 那个）
echo ============================================================
pause
