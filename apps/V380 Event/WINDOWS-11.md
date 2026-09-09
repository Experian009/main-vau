# Запуск V380 Event MVP на Windows 11

Проект работает непосредственно на компьютере Windows 11. Docker, WSL 2, Hyper-V и отдельный VPS не требуются. Компьютер является локальным узлом: он подключается к V380 Cloud, принимает private RTSP, показывает WebRTC-видео в браузере, создаёт event-клипы и доставляет их в Telegram и TeraBox.

## Требования

Нужны Windows 11 x64, доступ к GitHub при первой установке и установленный **FFmpeg**. В новом PowerShell должна успешно выполняться команда:

```powershell
ffmpeg -version
```

Если FFmpeg не добавлен в `PATH`, укажите полный путь к `ffmpeg.exe` в `FFMPEG_BIN` файла `.env.windows`.

## Первый запуск

1. Распакуйте проект в отдельную папку.
2. Выполните `windows\setup.cmd`.
3. Скопируйте `.env.windows.example` в `.env.windows`, если этот файл не был создан автоматически.
4. Заполните как минимум следующие значения:

```text
V380_CAMERA_ID=ID_камеры
V380_USERNAME=admin
V380_PASSWORD=пароль_камеры
GATEWAY_TOKEN=длинный_отдельный_токен
INTERNAL_NOTIFY_TOKEN=второй_длинный_токен
```

5. Для Telegram заполните **оба** `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`. Чтобы не отправлять в Telegram, оставьте оба поля пустыми.
6. Для TeraBox заполните `TERABOX_NDUS` значением cookie `ndus` активной сессии. Создайте папку `/V380/events` в TeraBox заранее.
7. Выполните `windows\start.cmd`.
8. Откройте `http://localhost:3000`, нажмите **«Подключить»** и введите:

```text
URL gateway: http://localhost:8787
Gateway token: значение GATEWAY_TOKEN из .env.windows
```

При первом старте с заполненным `TERABOX_NDUS` launcher самостоятельно установит локальный `terabox-node`. При необходимости его можно подготовить отдельно:

```powershell
powershell -ExecutionPolicy Bypass -File windows\setup-events.ps1
```

Установщик использует фактический tag `app-3.3.1` репозитория `seiya-dev/terabox-node`. Если встроенный загрузчик Bun получает `ConnectionRefused` или не может разрешить GitHub dependency, установщик автоматически скачивает официальный archive через `codeload.github.com` и устанавливает npm-зависимости. Поэтому повторно запускать обычный `bun install` вручную не нужно.

## Управление и диагностика

| Действие | Команда |
|---|---|
| Установить runtime | `windows\setup.cmd` |
| Запустить всё | `windows\start.cmd` |
| Остановить всё | `windows\stop.cmd` |
| Открыть логи | `windows\logs.cmd` |
| Проверить Telegram/TeraBox и event pipeline | `windows\check-events.cmd` |

Логи находятся в `.runtime\windows\logs`. Для event pipeline используйте `motion.err.log`, `notifier.err.log` и `archive.err.log`. Локальные клипы и JSON-метаданные находятся в `local-data\events`.

Вкладка **«События»** веб-интерфейса показывает статус motion detector, Telegram и TeraBox; очередь файлов, ожидающих TeraBox; и историю доставок. Пустая очередь означает, что локальные файлы предыдущих событий были подтверждённо загружены в TeraBox и очищены.

## Поведение event pipeline

Motion detector держит prebuffer около 5 секунд, создаёт полный клип примерно на 25 секунд и отдельный Telegram-клип длиной ровно 20 секунд после срабатывания. Если RTSP временно недоступен при запуске или теряется во время работы, motion service остаётся запущенным и делает повторные подключения каждые 5 секунд.

Archive worker удаляет локальный полный клип, JSON-метаданные и Telegram-копию **только после** подтверждённой загрузки полного файла. При проблеме с TeraBox файлы остаются локально, а worker повторяет отправку через `ARCHIVE_INTERVAL_SECONDS`. При истёкшей cookie `ndus` обновите только `TERABOX_NDUS` в `.env.windows` и перезапустите проект.

Постоянная запись 24/7 и 30-минутные архивные сегменты намеренно не входят в этот event-only MVP.

В веб-интерфейсе раздел **Настройки** позволяет изменить три параметра детектора без перезапуска: порог изменения кадра, число последовательных кадров для срабатывания и паузу между событиями. В разделе **События/Архив** доступны ручное сканирование, повторная обработка и удаление зависших заданий. Удаление очищает оставшиеся локальные файлы задания и оставляет отметку `canceled` в истории.

Если Telegram открывается в браузере, но notifier сообщает `Unable to connect`, проверьте системный proxy. При `ProxyEnable=1` и `ProxyServer=127.0.0.1:10808` `windows\start.ps1` автоматически передаст его Telegram notifier. При необходимости задайте вручную в `.env.windows`:

```env
TELEGRAM_HTTPS_PROXY=http://127.0.0.1:10808
```

После изменения обязательно выполните `windows\stop.cmd`, затем `windows\start.cmd`.

## Безопасность

Не публикуйте в интернет порты 8554, 8080, 8090, 8091 или 8092. Не используйте один и тот же токен для камеры, gateway и внутреннего notifier endpoint. Не отправляйте `.env.windows`, Telegram token, TeraBox cookie `ndus`, пароль камеры или папку `local-data` в GitHub и чаты.
