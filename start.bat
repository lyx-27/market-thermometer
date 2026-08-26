@echo off
rem ============================================================
rem  Market Thermometer - Windows launcher
rem  Double-click to run. The widget starts in the background
rem  and this window closes on its own right after launch.
rem  (Equivalent of the macOS 启动组件.command)
rem ============================================================
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (echo [X] Node.js / npm not found. Install Node.js 18+ from https://nodejs.org/ then run this again. & echo. & pause & exit /b 1)

if not exist "node_modules\electron\" (echo Installing dependencies - first run only, this may take a minute... & call npm install)

if not exist "node_modules\.bin\electron.cmd" (echo [X] Setup incomplete. Open a terminal here and run: npm install & pause & exit /b 1)

echo Starting Market Thermometer...
powershell -NoProfile -Command "Start-Process -FilePath '%~dp0node_modules\.bin\electron.cmd' -ArgumentList '.' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
exit /b 0
