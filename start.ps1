# ============================================================
#  Market Thermometer / 市场温度计 - Windows launcher (PowerShell)
#  Run:  right-click this file -> "Run with PowerShell"
#    or: powershell -ExecutionPolicy Bypass -File .\start.ps1
#  The widget starts in the background (no lingering window).
# ============================================================
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[X] Node.js / npm not found. Install Node.js 18+ from https://nodejs.org/' -ForegroundColor Yellow
  Read-Host 'Press Enter to exit'
  exit 1
}

if (-not (Test-Path '.\node_modules\electron')) {
  Write-Host 'Installing dependencies (first run only, may take a minute)...'
  npm install
}

Write-Host 'Starting Market Thermometer...'
Start-Process -FilePath '.\node_modules\.bin\electron.cmd' -ArgumentList '.' -WindowStyle Hidden
