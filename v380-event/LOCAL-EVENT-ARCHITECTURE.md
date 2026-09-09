# Локальная архитектура V380 Event MVP

```text
V380 Cloud
   │ outbound cloud relay
   ▼
[ V380Decoder.exe ] -- RTSP 127.0.0.1:8554/live --> [ MediaMTX ] -- WHEP --> [ gateway ] --> local web UI
        │                                      │                      │
        └──────────────────────────────► [ motion ] ─────────────────┘
                                                │
                                                ├── event-telegram.mp4 ─► [ notifier ] ─► Telegram
                                                │
                                                └── event-full.mp4 ─────► [ archive ] ──► TeraBox /V380/events
```

The implementation is intentionally **event-only** and supports one camera. The Windows computer is the local service host; it must remain online and awake while live view, motion detection and delivery are required.

| Component | Local endpoint or source | Result |
|---|---|---|
| V380Decoder | Cloud relay; API `127.0.0.1:8080` | Private RTSP `127.0.0.1:8554/live` |
| MediaMTX | Private RTSP | WHEP/WebRTC `127.0.0.1:8889` |
| Gateway | `127.0.0.1:8787` | Authenticated status, snapshot, PTZ, WHEP proxy and aggregated event status |
| Motion | `127.0.0.1:8091` | Downscaled motion analysis, 5-second JPEG prebuffer and event clips |
| Notifier | `127.0.0.1:8090` | Telegram clip containing exactly the configured post-event duration |
| Archive | `127.0.0.1:8092` | TeraBox queue, retry and verified cleanup |
| Web UI | `localhost:3000` | Live camera, pipeline health, archive queue and delivery history |

## Event lifecycle

1. The motion service keeps a low-resolution frame stream for detection and an independent higher-rate JPEG stream for event recording.
2. When the consecutive-frame threshold is crossed, it copies the available prebuffer and records frames until `POSTBUFFER_SECONDS` expires.
3. It encodes two local MP4 files: `event-full.mp4` with prebuffer plus postbuffer, and `event-telegram.mp4` with only the postbuffer.
4. The notifier sends the Telegram file to the one configured chat. A missing Telegram configuration is recorded as disabled rather than blocking archival.
5. The archive worker stages a copy for `terabox-node`; the original event files are never modified by uploader temporary metadata.
6. Only a confirmed TeraBox result (`Uploaded` or a same-name remote file with matching expected behavior) permits deletion of the local full clip, Telegram copy and event metadata. Failures remain queued and are retried.
7. The motion history records Telegram and TeraBox status so the browser can display delivery information after local cleanup.

## Reliability rules

The launcher waits for the decoder API before starting MediaMTX and verifies the gateway health endpoint. The motion worker does not terminate when RTSP is unavailable: it records the error in its local health endpoint and retries the source every five seconds. The web UI retrieves all pipeline status through the authenticated gateway; the three internal service ports remain loopback-only.

`TERABOX_NDUS` is a session secret, not a password. The archive worker writes it only to the ignored configuration inside the installed `terabox-node` package, and it must never be committed or copied into a chat.

## Out of scope

This MVP deliberately excludes continuous 24/7 recording, 30-minute archive segments, multi-camera operation, AI object classification and direct public remote access. It is not a replacement for a certified security or life-safety system.


## Дополнительный continuous pipeline

Continuous recording добавляется отдельной веткой и не изменяет event pipeline:

```text
[ V380Decoder ] -- RTSP --> [ continuous recorder ] -- 30-min MP4 --> [ continuous archive ] --> TeraBox /V380/archive
                                      │                                      │
                                      └── 127.0.0.1:8093                    └── 127.0.0.1:8094
```

Recorder запускает отдельный FFmpeg-процесс на каждый сегмент с `-t 1800` и `-c copy`. Сначала создаётся файл с суффиксом `.part.mp4`; после штатного завершения FFmpeg он атомарно переименовывается в `.mp4` и становится доступным архивному worker. При разрыве RTSP worker ждёт пять секунд и начинает новый сегмент, не вмешиваясь в motion worker.

Continuous archive worker сканирует только `local-data/continuous`, загружает каждый завершённый сегмент в `TERABOX_CONTINUOUS_DIR` и удаляет локальный файл только после подтверждения результата uploader. Временные копии находятся в отдельном `.continuous-staging` и не смешиваются с event staging. Ошибка загрузки оставляет сегмент в очереди для следующего цикла.

В gateway добавлены `continuous` и `continuousArchive` в агрегированный `/api/events`. Они отображаются в UI отдельной карточкой. Event archive worker, event metadata, Telegram notifier и motion state остаются независимыми.
