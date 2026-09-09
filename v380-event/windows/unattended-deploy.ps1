# unattended-deploy.ps1
# Полностью автономное развёртывание V380 Event MVP: без диалогов, без notepad,
# без ручного редактирования .env.windows. Все значения берутся из переменных
# окружения процесса (их выставляет workflow из GitHub Secrets перед вызовом
# этого скрипта). Скрипт идемпотентен и безопасен для повторного запуска.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot   # .../v380-event
$EnvFile = Join-Path $ProjectRoot ".env.windows"
Set-Location $ProjectRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# 1. FFmpeg — decoder/motion/continuous-запись не стартуют без него.
# ---------------------------------------------------------------------------
Write-Step "Проверяем FFmpeg"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "FFmpeg не найден, ставим через Chocolatey..." -ForegroundColor Yellow
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  }
  choco install ffmpeg -y --no-progress | Out-Null
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  throw "FFmpeg всё ещё недоступен после установки. Проверьте сеть раннера / права Chocolatey."
}

# ---------------------------------------------------------------------------
# 2. .env.windows — генерируем из переменных окружения, без интерактива.
#    Обязательные: V380_CAMERA_ID, V380_PASSWORD, GATEWAY_TOKEN.
#    Остальное — опционально, с безопасными дефолтами.
# ---------------------------------------------------------------------------
Write-Step "Формируем .env.windows из секретов окружения"

function Req([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($v)) {
    throw "Обязательная переменная/секрет $name не задан. Добавьте его в GitHub Secrets репозитория."
  }
  return $v
}
function Opt([string]$name, [string]$default = "") {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($v)) { return $default }
  return $v
}

$cameraId   = Req  "V380_CAMERA_ID"
$password   = Req  "V380_PASSWORD"
$gatewayTok = Req  "GATEWAY_TOKEN"
$username   = Opt  "V380_USERNAME" "admin"
$webrtcHost = Opt  "WEBRTC_HOST" "127.0.0.1"
$notifyTok  = Opt  "INTERNAL_NOTIFY_TOKEN" ([guid]::NewGuid().ToString("N"))
$tgToken    = Opt  "TELEGRAM_BOT_TOKEN" ""
$tgChat     = Opt  "TELEGRAM_CHAT_ID" ""
$teraboxNdus = Opt "TERABOX_NDUS" ""

# Telegram включается только если заданы ОБА значения — иначе start.ps1 упадёт с ошибкой валидации.
if ([string]::IsNullOrWhiteSpace($tgToken) -xor [string]::IsNullOrWhiteSpace($tgChat)) {
  Write-Host "Задан только один из TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID — отключаем Telegram, чтобы не сорвать автозапуск." -ForegroundColor Yellow
  $tgToken = ""; $tgChat = ""
}

$envContent = @"
# Автосгенерировано unattended-deploy.ps1 — не редактировать руками, значения из GitHub Secrets.
V380_CAMERA_ID=$cameraId
V380_USERNAME=$username
V380_PASSWORD=$password
WEBRTC_HOST=$webrtcHost
GATEWAY_TOKEN=$gatewayTok
INTERNAL_NOTIFY_TOKEN=$notifyTok
TELEGRAM_BOT_TOKEN=$tgToken
TELEGRAM_CHAT_ID=$tgChat
TELEGRAM_HTTPS_PROXY=
TERABOX_NDUS=$teraboxNdus
TERABOX_EVENTS_DIR=/V380/events
FFMPEG_BIN=ffmpeg
MOTION_RTSP_URL=rtsp://127.0.0.1:8554/live
DETECT_FPS=2
DETECT_WIDTH=640
DETECT_HEIGHT=360
EVENT_RECORD_FPS=10
EVENT_RECORD_WIDTH=1280
EVENT_RECORD_HEIGHT=-2
MIN_CHANGED_RATIO=0.035
CONSECUTIVE_FRAMES=3
PREBUFFER_SECONDS=5
POSTBUFFER_SECONDS=20
COOLDOWN_SECONDS=30
EVENTS_DIR=local-data/events
NOTIFIER_PORT=8090
MOTION_PORT=8091
ARCHIVE_PORT=8092
NOTIFIER_URL=http://127.0.0.1:8090/internal/v1/notify
TELEGRAM_MAX_VIDEO_MB=45
ARCHIVE_INTERVAL_SECONDS=30
ARCHIVE_UPLOAD_TIMEOUT_SECONDS=900
CONTINUOUS_DIR=local-data/continuous
CONTINUOUS_SEGMENT_SECONDS=1800
CONTINUOUS_RECORD_AUDIO=true
CONTINUOUS_PORT=8093
CONTINUOUS_ARCHIVE_PORT=8094
CONTINUOUS_ARCHIVE_INTERVAL_SECONDS=30
TERABOX_CONTINUOUS_DIR=/V380/archive
CONTINUOUS_MAX_LOCAL_SEGMENTS=0
MOTION_ENABLED=true
TELEGRAM_ENABLED=true
TERABOX_EVENTS_ENABLED=true
CONTINUOUS_ENABLED=true
CONTINUOUS_ARCHIVE_ENABLED=true
"@

Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
Write-Host ".env.windows создан ($EnvFile)." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Нативные компоненты (V380Decoder, MediaMTX, Bun) + зависимости веб-интерфейса.
# ---------------------------------------------------------------------------
Write-Step "Устанавливаем нативные компоненты (setup.ps1)"
& (Join-Path $PSScriptRoot "setup.ps1")
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "setup.ps1 завершился с ошибкой $LASTEXITCODE" }

# ---------------------------------------------------------------------------
# 4. Запуск всех сервисов (decoder, mediamtx, gateway, notifier, motion, archive,
#    continuous, continuous-archive, web) — start.ps1 уже умеет это делать в
#    фоне через Start-Process и не блокирует выполнение.
# ---------------------------------------------------------------------------
Write-Step "Запускаем сервисы V380 Event (start.ps1)"
& (Join-Path $PSScriptRoot "start.ps1")

Write-Host "`nV380 Event MVP развёрнут и запущен автономно." -ForegroundColor Green
Write-Host "Веб-интерфейс: http://127.0.0.1:3000  |  Gateway: http://127.0.0.1:8787" -ForegroundColor Green
