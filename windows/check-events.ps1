$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Show-Endpoint([string]$name, [string]$url, [int[]]$expected = @(200, 503)) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $url
    Write-Host "[$name] HTTP $($response.StatusCode)" -ForegroundColor $(if ($response.StatusCode -eq 200) { "Green" } else { "Yellow" })
    try { $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 8 } catch { $response.Content }
  } catch {
    Write-Host "[$name] недоступен: $($_.Exception.Message)" -ForegroundColor Red
  }
}

if (-not (Test-Path ".env.windows")) { Write-Host ".env.windows не найден" -ForegroundColor Red; exit 1 }
$values = @{}
Get-Content ".env.windows" | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $parts = $line.Split("=", 2)
    $values[$parts[0].Trim()] = $parts[1].Trim()
  }
}
Write-Host "=== Конфигурация outbound ===" -ForegroundColor Cyan
Write-Host "Telegram token: $(if ($values.TELEGRAM_BOT_TOKEN) { 'заполнен' } else { 'ПУСТО' })"
Write-Host "Telegram chat id: $(if ($values.TELEGRAM_CHAT_ID) { 'заполнен' } else { 'ПУСТО' })"
Write-Host "Internal notify token: $(if ($values.INTERNAL_NOTIFY_TOKEN -and -not $values.INTERNAL_NOTIFY_TOKEN.StartsWith('replace-')) { 'заполнен' } else { 'ПУСТО/Шаблон' })"
Write-Host "TeraBox ndus: $(if ($values.TERABOX_NDUS) { 'заполнен' } else { 'ПУСТО' })"
if ($values.TELEGRAM_BOT_TOKEN) {
  try {
    $bot = Invoke-RestMethod -TimeoutSec 10 -Uri ("https://api.telegram.org/bot" + $values.TELEGRAM_BOT_TOKEN + "/getMe")
    Write-Host "Telegram bot API: $($bot.result.username) (токен действителен)" -ForegroundColor Green
  } catch {
    Write-Host "Telegram bot API: токен недействителен или Telegram недоступен: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host "`n=== Сервисы ===" -ForegroundColor Cyan
Show-Endpoint "gateway" "http://127.0.0.1:8787/health"
Show-Endpoint "motion" "http://127.0.0.1:8091/health"
Show-Endpoint "notifier" "http://127.0.0.1:8090/health"
Show-Endpoint "archive" "http://127.0.0.1:8092/health"

Write-Host "`n=== Gateway event status ===" -ForegroundColor Cyan
$token = $values.GATEWAY_TOKEN
if ($token) {
  try {
    $headers = @{ Authorization = "Bearer $token" }
    $response = Invoke-WebRequest -UseBasicParsing -Headers $headers -TimeoutSec 5 -Uri "http://127.0.0.1:8787/api/events"
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 12
  } catch { Write-Host "Не удалось получить /api/events: $($_.Exception.Message)" -ForegroundColor Red }
} else { Write-Host "GATEWAY_TOKEN пустой" -ForegroundColor Red }

Write-Host "`n=== Локальные event-файлы ===" -ForegroundColor Cyan
$eventsDir = if ($values.EVENTS_DIR) { $values.EVENTS_DIR } else { "local-data/events" }
if (Test-Path $eventsDir) {
  Get-ChildItem $eventsDir -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
} else { Write-Host "Папка $eventsDir ещё не создана" -ForegroundColor Yellow }
