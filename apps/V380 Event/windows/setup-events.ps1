$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot ".runtime\windows"
$bun = Join-Path $RuntimeRoot "bun\bun.exe"
$ArchiveRoot = Join-Path $ProjectRoot "local-services\archive"
$UploaderScript = Join-Path $ArchiveRoot "node_modules\terabox-node\app\app-uploader.js"
$FallbackVersion = "app-3.3.1"
$FallbackUrl = "https://codeload.github.com/seiya-dev/terabox-node/tar.gz/refs/tags/$FallbackVersion"
Set-Location $ProjectRoot

if (-not (Test-Path $bun)) {
  throw "Сначала выполните windows\setup.cmd, чтобы установить Bun вместе с базовым Windows runtime."
}

if (Test-Path ".env.windows") {
  Get-Content ".env.windows" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line.Split("=", 2)
      [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
  }
}
$ffmpeg = if ($env:FFMPEG_BIN) { $env:FFMPEG_BIN } else { "ffmpeg" }
if (-not (Get-Command $ffmpeg -ErrorAction SilentlyContinue)) {
  throw "FFmpeg не найден. Установите FFmpeg для Windows и добавьте папку с ffmpeg.exe в PATH, либо задайте FFMPEG_BIN в .env.windows."
}

Write-Host "Устанавливаем локальную зависимость terabox-node..." -ForegroundColor Cyan
& $bun install --cwd $ArchiveRoot --no-cache
if ($LASTEXITCODE -eq 0 -and (Test-Path $UploaderScript)) {
  Write-Host "terabox-node установлен через Bun." -ForegroundColor Green
} else {
  Write-Host "Bun не смог получить GitHub-зависимость. Используем прямой архив GitHub tag $FallbackVersion..." -ForegroundColor Yellow
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("v380-terabox-" + [guid]::NewGuid().ToString("N"))
  $tarball = Join-Path $tempRoot "terabox-node.tar.gz"
  $extractRoot = Join-Path $tempRoot "extract"
  $targetRoot = Join-Path $ArchiveRoot "node_modules\terabox-node"
  try {
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Invoke-WebRequest -Uri $FallbackUrl -OutFile $tarball -UseBasicParsing
    tar.exe -xzf $tarball -C $extractRoot
    $sourceRoot = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw "Архив GitHub пустой или имеет неправильный формат." }
    Remove-Item $targetRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Split-Path $targetRoot) | Out-Null
    Copy-Item $sourceRoot.FullName $targetRoot -Recurse -Force
    # The upstream app tag contains a self-referencing "terabox-node": "link:"
    # workspace dependency. Remove only that invalid install-time entry; the
    # application itself does not require a second nested terabox-node package.
    $packagePath = Join-Path $targetRoot "package.json"
    $package = Get-Content $packagePath -Raw | ConvertFrom-Json
    $package.dependencies.PSObject.Properties.Remove("terabox-node")
    $package | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $packagePath
    npm install --prefix $targetRoot --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $UploaderScript)) {
      throw "Прямая установка terabox-node завершилась без app-uploader.js."
    }
    Write-Host "terabox-node установлен из GitHub archive." -ForegroundColor Green
  } catch {
    throw "Не удалось установить terabox-node. Проверьте доступ к GitHub и npm registry. URL: $FallbackUrl. Подробность: $($_.Exception.Message)"
  } finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Write-Host "Event pipeline подготовлен. Теперь заполните Telegram/TeraBox параметры в .env.windows." -ForegroundColor Green
