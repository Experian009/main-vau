# Расширение V380 Local Event MVP: continuous recording

## Итог

В проект добавлена независимая ветка постоянной записи. Она создаёт MP4-сегменты длительностью 30 минут и загружает их в отдельный каталог TeraBox `/V380/archive`. Существующий event pipeline не изменён по назначению и жизненному циклу: motion detection, Telegram notifier и event archive worker продолжают работать через прежние процессы и каталоги.

## Архитектура

| Компонент | Endpoint | Ответственность |
|---|---:|---|
| Continuous recorder | `127.0.0.1:8093` | Независимый FFmpeg-процесс читает `rtsp://127.0.0.1:8554/live` и пишет 30-минутные MP4-сегменты. |
| Continuous archive worker | `127.0.0.1:8094` | Сканирует завершённые сегменты, загружает их в `/V380/archive`, повторяет сбои и удаляет локальный файл только после подтверждения TeraBox. |
| Gateway | `127.0.0.1:8787` | Добавляет в `/api/events` поля `continuous` и `continuousArchive`. |
| Web UI | `localhost:3000` | Показывает отдельный статус постоянной записи. |

Сегмент сначала создаётся как `.part.mp4`. Он становится элементом очереди только после успешного завершения FFmpeg и атомарного переименования в `.mp4`. При ошибке RTSP незавершённый файл удаляется, после чего recorder повторяет подключение через пять секунд. Continuous archive использует отдельный staging-каталог и не читает `local-data/events`.

## Изменённые файлы

| Файл | Изменение |
|---|---|
| `local-services/continuous/server.mjs` | Новый recorder с повторным подключением, health endpoint и списком сегментов. |
| `local-services/continuous-archive/server.mjs` | Новый TeraBox worker для постоянных сегментов с retry и подтверждением загрузки. |
| `gateway/server.mjs` | Агрегация двух новых health endpoint. |
| `windows/start.ps1` | Создание каталога, запуск двух новых процессов и сохранение PID. |
| `.env.windows.example` | Параметры continuous recording и каталога `/V380/archive`. |
| `src/lib/v380-gateway.ts` | Типы и разбор health-статусов новых процессов. |
| `src/components/pages/home/sections/event-panel.tsx` | Отдельная карточка Continuous recording. |
| `README.md` и `LOCAL-EVENT-ARCHITECTURE.md` | Описание поведения, ограничений и диагностики. |
| `.gitignore` | Исключение сегментов и continuous staging из контроля версий. |

## Конфигурация

```text
CONTINUOUS_DIR=local-data/continuous
CONTINUOUS_SEGMENT_SECONDS=1800
CONTINUOUS_RECORD_AUDIO=true
CONTINUOUS_PORT=8093
CONTINUOUS_ARCHIVE_PORT=8094
CONTINUOUS_ARCHIVE_INTERVAL_SECONDS=30
TERABOX_CONTINUOUS_DIR=/V380/archive
CONTINUOUS_MAX_LOCAL_SEGMENTS=0
```

`CONTINUOUS_MAX_LOCAL_SEGMENTS=0` означает, что после подтверждённой загрузки локальный сегмент удаляется. Значение больше нуля оставляет заданное число последних сегментов как локальный кэш. Сбой TeraBox не удаляет сегмент и оставляет его в очереди.

## Важные эксплуатационные ограничения

Постоянная запись требует работающих Windows-компьютера, V380Decoder, FFmpeg и RTSP-релея. При недоступности источника образуются пробелы, а не искусственные заполненные сегменты. Для диска нужен запас минимум под один текущий сегмент и staging-копию во время загрузки. Истёкшая cookie `TERABOX_NDUS` блокирует выгрузку, но не должна приводить к удалению локальных сегментов.

Новый recorder использует `-c copy`, поэтому он не перекодирует поток и снижает нагрузку на CPU. Для потока с нестабильными параметрами или несовместимым контейнером может потребоваться отдельный режим перекодирования; в текущем MVP это намеренно не включено.

## Проверки

| Проверка | Результат |
|---|---|
| `node --check local-services/continuous/server.mjs` | Пройдена |
| `node --check local-services/continuous-archive/server.mjs` | Пройдена |
| `node --check gateway/server.mjs` | Пройдена |
| `bun run verify` | Пройдена: ESLint, Astro check и production build |
| `bun run test:services` | Пройдена: существующие gateway и local-service integration tests |

Проверки выполнены без реальной камеры и без действующей TeraBox-сессии. Поэтому они подтверждают синтаксис, сборку, локальные HTTP-контракты и интеграцию запуска, но не подтверждают фактическую совместимость конкретного RTSP-потока и текущей cookie TeraBox.

## Рекомендации перед эксплуатацией

Сначала включите функцию на тестовой копии и задайте короткое значение `CONTINUOUS_SEGMENT_SECONDS`, например 60 секунд, чтобы проверить создание, загрузку и удаление сегмента. После успешного smoke-теста верните значение 1800. Затем проверьте, что в TeraBox появляется файл в `/V380/archive`, а event-клипы по-прежнему появляются в `/V380/events` независимо от continuous очереди.

Для production-эксплуатации желательно добавить e2e-тест с mock FFmpeg и mock uploader, мониторинг заполнения диска и отдельный механизм уведомления о длительном отсутствии новых сегментов. Эти части сознательно не включены в текущий MVP, чтобы не вмешиваться в существующий event pipeline.

## References

[1]: README.md "V380 Event MVP for Windows — project documentation"
[2]: LOCAL-EVENT-ARCHITECTURE.md "Local event architecture and continuous pipeline"
[3]: local-services/continuous/server.mjs "Continuous recorder implementation"
[4]: local-services/continuous-archive/server.mjs "Continuous TeraBox archive worker implementation"


## Исправление PCM A-law и переключатели

В исходной версии continuous recorder переносил аудио без перекодирования через `-c copy`. Камера V380 отдавала аудио как `pcm_alaw`, который нельзя записать напрямую в MP4. Recorder теперь копирует видео (`-c:v copy`) и перекодирует аудио в AAC (`-c:a aac -b:a 128k`). Это устраняет ошибку `Could not find tag for codec pcm_alaw`.

Добавлены runtime API `/config` и переключатели в разделе «Настройки». Управляются MotionDetector, Telegram, event TeraBox archive, continuous recording и continuous TeraBox archive. Состояние сохраняется в `local-data/*-settings.json`, поэтому оно сохраняется после перезапуска launcher. Отключение не удаляет существующие локальные клипы и сегменты.


## TeraBox уведомление `same name ... size not match`

Это не подтверждение успешной загрузки. Оно означает, что на TeraBox уже существовал объект с таким именем, но его размер отличался от локального файла. Предыдущая версия архиватора могла увидеть файл с суффиксом `.part.mp4` во время записи и отправить его до атомарного завершения FFmpeg. TeraBox оставлял неполную удалённую копию и сообщал `LOCAL/REMOTE ... size not match`.

Архиватор теперь полностью исключает `*.part.mp4` из очереди. Он обрабатывает только окончательные `.mp4`, появившиеся после rename. Если в TeraBox уже осталась одноимённая неполная копия, worker повторяет загрузку под уникальным именем и удаляет локальный файл только после подтверждённого результата. Старый неполный объект в TeraBox можно удалить вручную после проверки; новый pipeline больше не создаёт такие имена.
