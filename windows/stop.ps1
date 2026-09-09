$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $ProjectRoot ".runtime\windows\processes.json"

if (-not (Test-Path $PidFile)) {
  Write-Host "Запущенные процессы V380 не найдены." -ForegroundColor Yellow
  exit 0
}

$processes = Get-Content $PidFile -Raw | ConvertFrom-Json
foreach ($property in $processes.PSObject.Properties) {
  $process = Get-Process -Id $property.Value -ErrorAction SilentlyContinue
  if ($process) {
    Write-Host "Останавливаем $($property.Name)…"
    Stop-Process -Id $property.Value -Force -ErrorAction SilentlyContinue
  }
}

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "V380 Remote остановлен." -ForegroundColor Green
