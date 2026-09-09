# Автономный запуск V380 Event MVP в FreeVPS1-main

## Что изменено

Репозиторий теперь содержит V380 Event MVP в `apps/V380 Event`. Windows workflows `workflows/windows.yml` и `.github/workflows/main.yml` выполняют checkout репозитория, устанавливают V380Decoder, MediaMTX, Bun и зависимости, создают защищённую конфигурацию из GitHub Secrets, регистрируют Windows Scheduled Task и запускают полный V380 pipeline.

Задача Windows называется `V380 Event MVP - Autonomous Startup`. Она запускается от `SYSTEM` при старте Windows 11, ждёт появления сети, запускает `windows/start.ps1` без открытия браузера и перезапускается после сбоя. Поэтому после первичного запуска workflow участие пользователя в запуске сервиса не требуется.

## GitHub Secrets

Перед запуском Windows workflow добавьте секреты:

| Secret | Назначение |
|---|---|
| `WIN_PASS` | Пароль RDP-пользователя `runneradmin`. |
| `V380_CAMERA_ID` | Идентификатор камеры V380. |
| `V380_USERNAME` | Имя пользователя камеры, обычно `admin`. |
| `V380_PASSWORD` | Пароль камеры. |
| `GATEWAY_TOKEN` | Токен доступа браузера к gateway. |
| `INTERNAL_NOTIFY_TOKEN` | Внутренний токен motion → notifier. |
| `TELEGRAM_BOT_TOKEN` | Необязательный Telegram bot token. |
| `TELEGRAM_CHAT_ID` | Необязательный Telegram chat ID. |
| `TERABOX_NDUS` | Необязательная cookie `ndus` TeraBox. |
| `TS_AUTHKEY` | Tailscale auth key для workflow `windows.yml`. |

Секреты передаются в PowerShell только как process environment variables. Bootstrap пишет `.env.windows` локально в VM, но не выводит значения в лог и не добавляет файл в Git.

## Жизненный цикл

При выполнении workflow:

1. `actions/checkout` получает FreeVPS1-main вместе с `apps/V380 Event`.
2. `bootstrap-autonomous.ps1 -Install -Register` ждёт сеть и создаёт `.env.windows`.
3. `windows/setup.ps1` скачивает нативные компоненты и устанавливает Bun dependencies.
   В том числе через GitHub API выбирается актуальный versioned ZIP FFmpeg Essentials и он скачивается в `.runtime/windows/ffmpeg/ffmpeg.exe`.
4. Windows Scheduled Task регистрируется с триггером `AtStartup`, задержкой 30 секунд, запуском от `SYSTEM`, автоматическим перезапуском и `StartWhenAvailable`.
5. Тот же bootstrap запускает V380 Event сразу, чтобы не ждать следующей перезагрузки.
6. При следующих стартах ОС задача запускает `windows/start.ps1`; тот поднимает decoder, MediaMTX, gateway, Telegram notifier, motion detector, event archive, continuous recorder, continuous archive и web UI.

Если первая установка завершилась после установки Bun, но до установки FFmpeg, следующий запуск Scheduled Task обнаруживает отсутствующий `.runtime/windows/ffmpeg/ffmpeg.exe`, повторно выполняет setup и продолжает запуск автоматически. Имя FFmpeg-архива определяется через GitHub API, поэтому изменение версии не приводит к 404 из-за устаревшего имени файла.

## Диагностика

Основной bootstrap log:

```text
apps/V380 Event/.runtime/windows/autonomous-bootstrap.log
```

Логи сервисов:

```text
apps/V380 Event/.runtime/windows/logs/
```

Проверка задачи:

```powershell
Get-ScheduledTask -TaskName 'V380 Event MVP - Autonomous Startup'
Get-ScheduledTaskInfo -TaskName 'V380 Event MVP - Autonomous Startup'
```

Ручной повтор запуска:

```powershell
Start-ScheduledTask -TaskName 'V380 Event MVP - Autonomous Startup'
```

## Ограничения

GitHub-hosted Windows runner является временной машиной и ограничен временем выполнения workflow исходного репозитория. Scheduled Task обеспечивает автономный запуск после перезагрузок только пока конкретная VM существует. Для постоянной 24/7 эксплуатации нужен постоянный Windows-хост или Windows VM с сохранённым диском и сетевым доступом к камере V380.

Проверка в текущем Linux sandbox не может фактически запустить Windows PowerShell, V380Decoder.exe и Windows Scheduled Task. Выполнены статические проверки структуры PowerShell-скриптов, проверка отсутствия секретных файлов и полная `bun run verify`/`bun run test:services` для встроенного V380 Event проекта.


## Если отображается `WHEP returned 502`

Это означает, что браузер дошёл до gateway, но gateway не смог получить WHEP-сеанс у MediaMTX. При старте теперь выполняются отдельные проверки MediaMTX на `127.0.0.1:8889` и RTSP decoder на `127.0.0.1:8554`; причина записывается в `.runtime/windows/logs/mediamtx.err.log` или `decoder.err.log`.

Для браузера, запущенного внутри Windows VM через RDP, в форме подключения используется `http://localhost:8787`. Если веб-интерфейс открыт на другом компьютере, `localhost` указывает на другой компьютер, а не на VM; в этом случае нужно указать gateway по доступному адресу VM, например `http://<VM-IP>:8787`, и разрешить входящий TCP-порт 8787. Для WebRTC в `WEBRTC_HOST` должен быть адрес, доступный браузеру; startup динамически подставляет его в конфигурацию MediaMTX.

Проверки на VM:

```powershell
Test-NetConnection 127.0.0.1 -Port 8554
Invoke-WebRequest http://127.0.0.1:8889/live/whep -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8787/health -UseBasicParsing
Get-Content .runtime\windows\logs\mediamtx.err.log -Tail 100
Get-Content .runtime\windows\logs\decoder.err.log -Tail 100
```
