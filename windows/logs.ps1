$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogsRoot = Join-Path $ProjectRoot ".runtime\windows\logs"

if (-not (Test-Path $LogsRoot)) {
  Write-Host "Логи ещё не созданы. Сначала запустите start.cmd." -ForegroundColor Yellow
  exit 0
}

Write-Host "Папка логов: $LogsRoot" -ForegroundColor Cyan
Get-ChildItem $LogsRoot -File | ForEach-Object {
  Write-Host "`n===== $($_.Name) =====" -ForegroundColor Cyan
  Get-Content $_.FullName -Tail 60
}

Write-Host "`nДля обновления логов повторно запустите logs.cmd."
