$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "Запуск V380 Python Edition..." -ForegroundColor Cyan
python main.py
