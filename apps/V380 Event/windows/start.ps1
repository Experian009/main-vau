$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot ".runtime\windows"
$LogsRoot = Join-Path $RuntimeRoot "logs"
$PidFile = Join-Path $RuntimeRoot "processes.json"
Set-Location $ProjectRoot

$decoder = Join-Path $RuntimeRoot "decoder\V380Decoder.exe"
$mediamtx = Join-Path $RuntimeRoot "mediamtx\mediamtx.exe"
$bun = Join-Path $RuntimeRoot "bun\bun.exe"

if (-not (Test-Path $decoder) -or -not (Test-Path $mediamtx) -or -not (Test-Path $bun)) {
  Write-Host "Нативные компоненты ещё не установлены. Запускаем setup…" -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot "setup.ps1")
}

if (-not (Test-Path ".env.windows")) {
  Copy-Item ".env.windows.example" ".env.windows"
  Write-Host "Создан .env.windows. Заполните ID, пароль камеры и GATEWAY_TOKEN, затем снова запустите start.cmd." -ForegroundColor Yellow
  Start-Process notepad.exe ".env.windows"
  exit 0
}

Get-Content ".env.windows" | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $parts = $line.Split("=", 2)
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

$bundledFfmpeg = Join-Path $RuntimeRoot "ffmpeg\ffmpeg.exe"
$ffmpeg = if (Test-Path $bundledFfmpeg) { $bundledFfmpeg } elseif ($env:FFMPEG_BIN) { $env:FFMPEG_BIN } else { "ffmpeg" }
if (-not $env:V380_CAMERA_ID -or $env:V380_CAMERA_ID -eq "12345678") { throw "Заполните V380_CAMERA_ID в .env.windows" }
if (-not $env:V380_PASSWORD -or $env:V380_PASSWORD.StartsWith("replace-")) { throw "Заполните V380_PASSWORD в .env.windows" }
if (-not $env:GATEWAY_TOKEN -or $env:GATEWAY_TOKEN.StartsWith("replace-")) { throw "Заполните GATEWAY_TOKEN в .env.windows" }
if (-not (Test-Path $ffmpeg) -and -not (Get-Command $ffmpeg -ErrorAction SilentlyContinue)) { throw "FFmpeg не найден. Повторите windows\setup.ps1 или укажите FFMPEG_BIN в .env.windows" }
$env:FFMPEG_BIN = $ffmpeg

# Node/Bun does not automatically use the Windows WinINET proxy. If the user
# has a local HTTP proxy configured (common with VPN clients), pass it to the
# notifier explicitly. TELEGRAM_HTTPS_PROXY in .env.windows takes precedence.
if (-not $env:TELEGRAM_HTTPS_PROXY) {
  try {
    $internet = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    if ($internet.ProxyEnable -eq 1 -and $internet.ProxyServer) {
      $proxy = [string]$internet.ProxyServer
      if ($proxy -notmatch "^[a-zA-Z]+://") { $proxy = "http://$proxy" }
      $env:TELEGRAM_HTTPS_PROXY = $proxy
      Write-Host "Используем системный proxy для Telegram: $proxy" -ForegroundColor Cyan
    }
  } catch { Write-Host "Не удалось определить системный proxy: $($_.Exception.Message)" -ForegroundColor Yellow }
}

$telegramPartiallyConfigured = [bool]$env:TELEGRAM_BOT_TOKEN -xor [bool]$env:TELEGRAM_CHAT_ID
if ($telegramPartiallyConfigured) { throw "Для Telegram заполните одновременно TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID либо оставьте оба значения пустыми." }
if ($env:TELEGRAM_BOT_TOKEN -and (-not $env:INTERNAL_NOTIFY_TOKEN -or $env:INTERNAL_NOTIFY_TOKEN.StartsWith("replace-"))) {
  throw "Для Telegram заполните INTERNAL_NOTIFY_TOKEN отдельным непустым токеном в .env.windows."
}

$env:PORT = "8787"
$env:ALLOWED_ORIGIN = "http://localhost:3000"
$env:DECODER_ORIGIN = "http://127.0.0.1:8080"
$env:MEDIA_ORIGIN = "http://127.0.0.1:8889"
$env:MOTION_ORIGIN = "http://127.0.0.1:8091"
$env:NOTIFIER_ORIGIN = "http://127.0.0.1:8090"
$env:ARCHIVE_ORIGIN = "http://127.0.0.1:8092"
$env:CONTINUOUS_ORIGIN = "http://127.0.0.1:8093"
$env:CONTINUOUS_ARCHIVE_ORIGIN = "http://127.0.0.1:8094"
$env:MOTION_PORT = "8091"
$env:ARCHIVE_PORT = "8092"
$env:CONTINUOUS_PORT = "8093"
$env:CONTINUOUS_ARCHIVE_PORT = "8094"
$env:MTX_WEBRTCADDITIONALHOSTS = if ($env:WEBRTC_HOST) { $env:WEBRTC_HOST } else { "127.0.0.1" }
$env:EVENTS_DIR = if ($env:EVENTS_DIR) { $env:EVENTS_DIR } else { "local-data/events" }
$env:ARCHIVE_ROOT = Join-Path $ProjectRoot "local-services\archive"
$env:TERABOX_APP = Join-Path $env:ARCHIVE_ROOT "node_modules\terabox-node\app"
$env:CONTINUOUS_DIR = if ($env:CONTINUOUS_DIR) { $env:CONTINUOUS_DIR } else { "local-data/continuous" }
$env:TERABOX_CONTINUOUS_DIR = if ($env:TERABOX_CONTINUOUS_DIR) { $env:TERABOX_CONTINUOUS_DIR } else { "/V380/archive" }
New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot $env:EVENTS_DIR) | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot $env:CONTINUOUS_DIR) | Out-Null

$uploaderScript = Join-Path $env:TERABOX_APP "app-uploader.js"
if ($env:TERABOX_NDUS -and -not (Test-Path $uploaderScript)) {
  Write-Host "Устанавливаем локальную зависимость TeraBox…" -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "setup-events.ps1")
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $uploaderScript)) { throw "Не удалось установить terabox-node для TeraBox archive worker. Проверьте доступ к GitHub/npm и повторите windows\setup-events.ps1." }
}

if (Test-Path $PidFile) {
  Write-Host "Обнаружен предыдущий запуск. Сначала выполняем stop.ps1…" -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot "stop.ps1")
}

New-Item -ItemType Directory -Force -Path $LogsRoot | Out-Null
Get-ChildItem $LogsRoot -File -ErrorAction SilentlyContinue | Remove-Item -Force

function Start-LoggedProcess([string]$name, [string]$filePath, [string[]]$arguments, [string]$workingDirectory) {
  $stdout = Join-Path $LogsRoot "$name.out.log"
  $stderr = Join-Path $LogsRoot "$name.err.log"
  return Start-Process -FilePath $filePath -ArgumentList $arguments -WorkingDirectory $workingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
}

function Wait-HttpEndpoint([string]$uri, [int]$timeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $uri
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

Write-Host "Запускаем V380Decoder…" -ForegroundColor Cyan
$decoderProcess = Start-LoggedProcess "decoder" $decoder @(
  "--id", $env:V380_CAMERA_ID,
  "--username", $(if ($env:V380_USERNAME) { $env:V380_USERNAME } else { "admin" }),
  "--password", $env:V380_PASSWORD,
  "--source", "cloud",
  "--output", "rtsp",
  "--enable-api",
  "--rtsp-port", "8554",
  "--http-port", "8080"
) $ProjectRoot

Write-Host "Ожидаем локальный API decoder…" -ForegroundColor Cyan
if (-not (Wait-HttpEndpoint "http://127.0.0.1:8080/api/status" 45)) {
  Write-Host "Decoder ещё не ответил. Продолжаем: motion worker будет автоматически переподключаться к RTSP." -ForegroundColor Yellow
}

Write-Host "Запускаем MediaMTX…" -ForegroundColor Cyan
$mediaConfig = Join-Path $PSScriptRoot "native-mediamtx.yml"
$mediaProcess = Start-LoggedProcess "mediamtx" $mediamtx @($mediaConfig) $ProjectRoot

Write-Host "Запускаем защищённый gateway…" -ForegroundColor Cyan
$gatewayProcess = Start-LoggedProcess "gateway" $bun @("gateway/server.mjs") $ProjectRoot
if (-not (Wait-HttpEndpoint "http://127.0.0.1:8787/health" 20)) { throw "Gateway не запустился. Проверьте .runtime\windows\logs\gateway.err.log" }

Write-Host "Запускаем Telegram notifier…" -ForegroundColor Cyan
$notifierProcess = Start-LoggedProcess "notifier" $bun @("run", "local-services/notifier/server.mjs") $ProjectRoot

Write-Host "Запускаем motion detector…" -ForegroundColor Cyan
$motionProcess = Start-LoggedProcess "motion" $bun @("run", "local-services/motion/server.mjs") $ProjectRoot

Write-Host "Запускаем TeraBox archive worker…" -ForegroundColor Cyan
$archiveProcess = Start-LoggedProcess "archive" $bun @("run", "local-services/archive/server.mjs") $ProjectRoot

Write-Host "Запускаем постоянную запись 30-минутных сегментов…" -ForegroundColor Cyan
$continuousProcess = Start-LoggedProcess "continuous" $bun @("run", "local-services/continuous/server.mjs") $ProjectRoot
$continuousArchiveProcess = Start-LoggedProcess "continuous-archive" $bun @("run", "local-services/continuous-archive/server.mjs") $ProjectRoot

Write-Host "Запускаем веб-интерфейс…" -ForegroundColor Cyan
$webProcess = Start-LoggedProcess "web" $bun @("run", "dev", "--host", "127.0.0.1") $ProjectRoot

@{
  decoder = $decoderProcess.Id
  mediamtx = $mediaProcess.Id
  gateway = $gatewayProcess.Id
  notifier = $notifierProcess.Id
  motion = $motionProcess.Id
  archive = $archiveProcess.Id
  continuous = $continuousProcess.Id
  continuousArchive = $continuousArchiveProcess.Id
  web = $webProcess.Id
} | ConvertTo-Json | Set-Content -Encoding UTF8 $PidFile

Start-Sleep -Seconds 3
if ($env:V380_NO_BROWSER -ne "1") { Start-Process "http://localhost:3000" }

Write-Host ""
Write-Host "V380 Remote + event pipeline + continuous archive запущены без Docker." -ForegroundColor Green
Write-Host "Приложение: http://localhost:3000"
Write-Host "Gateway:     http://localhost:8787"
Write-Host "В интерфейсе откройте «Подключить» и укажите http://localhost:8787 и GATEWAY_TOKEN из .env.windows."
Write-Host "Диагностика: вкладка «События» или windows\logs.cmd"
