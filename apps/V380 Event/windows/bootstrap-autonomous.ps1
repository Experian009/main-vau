[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Register,
  [switch]$StartOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot ".runtime\windows"
$LogPath = Join-Path $RuntimeRoot "autonomous-bootstrap.log"
$TaskName = "V380 Event MVP - Autonomous Startup"
$ScriptPath = Join-Path $PSScriptRoot "bootstrap-autonomous.ps1"

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
function Log([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line
  Write-Host $line
}
function Ensure-Environment {
  $envFile = Join-Path $ProjectRoot ".env.windows"
  if (Test-Path $envFile) { return }
  $required = @("V380_CAMERA_ID", "V380_PASSWORD", "GATEWAY_TOKEN")
  foreach ($name in $required) { if (-not [Environment]::GetEnvironmentVariable($name, "Process")) { throw "Missing $name and .env.windows does not exist." } }
  $lines = @(
    "V380_CAMERA_ID=$env:V380_CAMERA_ID",
    "V380_USERNAME=$(if ($env:V380_USERNAME) { $env:V380_USERNAME } else { 'admin' })",
    "V380_PASSWORD=$env:V380_PASSWORD",
    "GATEWAY_TOKEN=$env:GATEWAY_TOKEN",
    "INTERNAL_NOTIFY_TOKEN=$(if ($env:INTERNAL_NOTIFY_TOKEN) { $env:INTERNAL_NOTIFY_TOKEN } else { $env:GATEWAY_TOKEN })",
    "TELEGRAM_BOT_TOKEN=$env:TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID=$env:TELEGRAM_CHAT_ID",
    "TERABOX_NDUS=$env:TERABOX_NDUS",
    "WEBRTC_HOST=$(if ($env:WEBRTC_HOST) { $env:WEBRTC_HOST } else { '127.0.0.1' })"
  )
  Set-Content -LiteralPath $envFile -Value $lines -Encoding UTF8
  Log "Created .env.windows from protected process variables."
}

function Wait-Network {
  for ($i = 1; $i -le 60; $i++) {
    try {
      if ((Test-NetConnection -ComputerName github.com -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)) { return }
    } catch { }
    Start-Sleep -Seconds 5
  }
  throw "Network was not available after 5 minutes."
}
function Register-Autostart {
  $argument = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -StartOnly"
  $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument $argument
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser -RandomDelay (New-TimeSpan -Seconds 20)
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType InteractiveToken -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 1) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Log "Registered scheduled task for interactive desktop logon: $TaskName ($currentUser)"
}
function Install-Project {
  Wait-Network
  Log "Installing V380 Event dependencies."
  & (Join-Path $PSScriptRoot "setup.ps1")
  if ($LASTEXITCODE -ne 0) { throw "V380 setup.ps1 failed with exit code $LASTEXITCODE." }
  Log "V380 Event dependencies installed."
}
function Start-Project {
  $env:V380_NO_BROWSER = "1"
  Wait-Network
  Log "Starting V380 Event MVP."
  & (Join-Path $PSScriptRoot "start.ps1")
  if ($LASTEXITCODE -ne 0) { throw "V380 start.ps1 failed with exit code $LASTEXITCODE." }
  Log "V380 Event MVP start command completed."
}

function Ensure-Runtime {
  $ffmpeg = Join-Path $RuntimeRoot "ffmpeg\ffmpeg.exe"
  if (-not (Test-Path $ffmpeg)) {
    Log "FFmpeg is missing; running setup again to repair the runtime."
    Install-Project
  }
}

try {
  Set-Location $ProjectRoot
  Ensure-Environment
  if ($Register) { Register-Autostart }
  if ($Install) { Install-Project }
  if ($StartOnly) { Ensure-Runtime; Start-Project }
  # When installation is invoked by CI with -Register, leave the actual
  # service startup to the interactive AtLogOn task. This prevents GitHub
  # Actions cleanup from killing a pre-desktop background session.
  if ($Install -and -not $Register) { Start-Project }
  if (-not $Register -and -not $Install -and -not $StartOnly) {
    Register-Autostart
    if (-not (Test-Path (Join-Path $RuntimeRoot "bun\bun.exe"))) { Install-Project }
    Start-Project
  }
} catch {
  Log "AUTONOMOUS STARTUP FAILED: $($_.Exception.Message)"
  exit 1
}
