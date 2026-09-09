$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot ".runtime\windows"
$Downloads = Join-Path $RuntimeRoot "downloads"
Set-Location $ProjectRoot

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $Downloads | Out-Null

$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($architecture) {
  "X64" {
    $decoderPattern = "(win|windows)[-_]x64.*\.zip$"
    $mediaPattern = "windows_amd64\.zip$"
    # Baseline avoids AVX2 requirements on older x64 processors.
    $bunPattern = "bun-windows-x64-baseline\.zip$"
  }
  "Arm64" {
    throw "Текущий V380Decoder не публикует нативный Windows ARM64-релиз. Требуется Windows x64."
  }
  default {
    throw "Архитектура $architecture не поддерживается. Требуется 64-bit Windows x64."
  }
}

function Get-LatestAsset([string]$repository, [string]$pattern) {
  Write-Host "Проверяем релиз $repository…" -ForegroundColor Cyan
  $release = Invoke-RestMethod -Headers @{ "User-Agent" = "V380-Remote-Windows-Setup" } -Uri "https://api.github.com/repos/$repository/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if (-not $asset) {
    $names = ($release.assets | ForEach-Object { $_.name }) -join ", "
    throw "Не найден Windows-пакет $pattern в $repository. Доступны: $names"
  }
  return $asset
}

function Install-ZipAsset([object]$asset, [string]$destination, [string]$executableName) {
  $zipPath = Join-Path $Downloads $asset.name
  Write-Host "Скачиваем $($asset.name)…" -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zipPath

  if (Test-Path $destination) { Remove-Item -Recurse -Force $destination }
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $destination -Force

  $executable = Get-ChildItem -Path $destination -Filter $executableName -Recurse | Select-Object -First 1
  if (-not $executable) { throw "$executableName не найден после распаковки $($asset.name)" }
  if ($executable.DirectoryName -ne $destination) {
    Copy-Item -Force $executable.FullName (Join-Path $destination $executableName)
  }
}

$decoderAsset = Get-LatestAsset "PyanSofyan/V380Decoder" $decoderPattern
$mediaAsset = Get-LatestAsset "bluenviron/mediamtx" $mediaPattern
$bunAsset = Get-LatestAsset "oven-sh/bun" $bunPattern

Install-ZipAsset $decoderAsset (Join-Path $RuntimeRoot "decoder") "V380Decoder.exe"
Install-ZipAsset $mediaAsset (Join-Path $RuntimeRoot "mediamtx") "mediamtx.exe"
Install-ZipAsset $bunAsset (Join-Path $RuntimeRoot "bun") "bun.exe"

$bun = Join-Path $RuntimeRoot "bun\bun.exe"
Write-Host "Устанавливаем зависимости веб-интерфейса…" -ForegroundColor Cyan
& $bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Bun install завершился с ошибкой $LASTEXITCODE" }

Write-Host ""
Write-Host "Нативные компоненты Windows установлены в .runtime\windows." -ForegroundColor Green
Write-Host "Теперь запустите windows\start.cmd." -ForegroundColor Green
