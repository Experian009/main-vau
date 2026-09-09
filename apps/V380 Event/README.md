# V380 Event MVP for Windows 11

This project runs one V380 camera locally on a Windows 11 computer. It provides live video in the browser, PTZ and snapshots through a protected gateway, motion-triggered clips, Telegram delivery, and uploading of full event clips to TeraBox.

> **Operating model:** this is an event-only system. It does not implement continuous 24/7 recording or 30-minute archive segments. The Windows computer must remain powered on, connected to the camera relay, and prevented from sleeping while notifications are required.

## Motion detection

The detector reads two low-resolution FFmpeg outputs from the private RTSP stream. One grayscale frame is compared with the previous frame; every fourth pixel whose brightness changes by more than the internal noise threshold counts as changed. The changed-pixel ratio is compared with `MIN_CHANGED_RATIO`. An event starts after `CONSECUTIVE_FRAMES` frames exceed the threshold, then the detector keeps a 5-second ring buffer and records the configured postbuffer. `COOLDOWN_SECONDS` prevents repeated events from the same movement. The three live parameters can be changed in **Настройки → Детектор движения** without restarting: lower `minChangedRatio` means higher sensitivity, higher `consecutiveFrames` means fewer false positives, and `cooldownSeconds` controls the pause between events.

The **События/Архив** queue now has **Сканировать очередь**, **Повторить** and **Удалить** actions. Retry re-enables an event for the archive worker; remove deletes its remaining local event files and marks it canceled in history. Use remove only for clips you no longer need.

## What runs locally

| Component | Local address | Purpose |
|---|---:|---|
| V380Decoder | `127.0.0.1:8080`, RTSP `127.0.0.1:8554/live` | Connects to V380 Cloud and exposes a private RTSP stream. |
| MediaMTX | WHEP/WebRTC `127.0.0.1:8889` | Converts private RTSP to browser-compatible WebRTC. |
| Gateway | `http://127.0.0.1:8787` | Protects live video, snapshot, PTZ and event status using `GATEWAY_TOKEN`. |
| Motion | `127.0.0.1:8091` | Detects motion, keeps a 5-second prebuffer and creates event clips. |
| Telegram notifier | `127.0.0.1:8090` | Sends a 20-second post-event MP4 to one configured chat. |
| TeraBox archive | `127.0.0.1:8092` | Retries upload of the full event clip to `/V380/events`. |
| Web UI | `http://localhost:3000` | Live camera, event delivery status, archive queue and local setup. |

All internal services bind to the loopback interface. Do **not** publish RTSP, decoder, notifier, motion or archive ports to the internet.

## Installation and first start

1. Extract the archive into a dedicated folder on the Windows 11 computer.
2. Install 64-bit **FFmpeg** for Windows and confirm `ffmpeg -version` in a new PowerShell window. If FFmpeg is not in `PATH`, set an absolute `FFMPEG_BIN` path in `.env.windows`.
3. Run `windows\setup.cmd`. It downloads V380Decoder, MediaMTX and portable Bun, then installs the web dependencies.
4. Copy `.env.windows.example` to `.env.windows` if it was not created automatically.
5. Fill the required camera and gateway values:

```text
V380_CAMERA_ID=your-camera-id
V380_USERNAME=admin
V380_PASSWORD=your-camera-password
GATEWAY_TOKEN=a-long-random-token
INTERNAL_NOTIFY_TOKEN=a-second-long-random-token
```

6. Fill Telegram delivery values to enable Telegram:

```text
TELEGRAM_BOT_TOKEN=123456:bot-token
TELEGRAM_CHAT_ID=your-private-chat-id
```

7. Fill `TERABOX_NDUS` with the logged-in TeraBox `ndus` cookie to enable TeraBox. Before the first upload, create the folder `/V380/events` in TeraBox. The launcher automatically installs the local `terabox-node` uploader when this value is set. The installer uses the repository tag `app-3.3.1`; if Bun cannot resolve the GitHub dependency, it downloads the official GitHub archive and installs its npm dependencies with a safe workaround for the upstream self-link. You can also run `powershell -ExecutionPolicy Bypass -File windows\setup-events.ps1` manually.
8. Run `windows\start.cmd` and open `http://localhost:3000`.
9. Click **«Подключить»** in the web UI. Enter `http://localhost:8787` and the exact value of `GATEWAY_TOKEN`.

The web interface does not receive the camera password, Telegram bot token or TeraBox cookie. It stores only the gateway URL and gateway token in the browser’s local storage.

## Motion and delivery behavior

The motion worker compares downscaled grayscale frames. When its change threshold is exceeded for the configured consecutive-frame count, it starts one event. The saved full clip contains the prebuffer plus the postbuffer. The Telegram copy contains only the post-event interval.

| Result | Default behavior |
|---|---|
| Prebuffer | 5 seconds before motion. |
| Telegram clip | 20 seconds after motion. |
| Full TeraBox clip | Approximately 25 seconds: prebuffer plus postbuffer. |
| Detection rate | 2 FPS at 640×360. |
| Recording rate | 10 FPS, width up to 1280 pixels with original aspect ratio. |
| Duplicate suppression | 30-second cooldown after an event starts. |
| TeraBox retry | Every 30 seconds until upload is confirmed. |
| Local deletion | Only after a confirmed full-clip upload to TeraBox. |

The **«События»** screen displays the motion worker, Telegram and TeraBox health; the local archive queue; and recent delivery history. The history remains after the local event files have been cleaned up.

## Important `.env.windows` options

| Variable | Default | Description |
|---|---:|---|
| `PREBUFFER_SECONDS` | `5` | Seconds included before motion in the full clip. |
| `POSTBUFFER_SECONDS` | `20` | Seconds recorded after motion. Also determines Telegram clip length. |
| `MIN_CHANGED_RATIO` | `0.035` | Fraction of sampled pixels that must change. Reduce slowly for more sensitivity; increase to reduce false positives. |
| `CONSECUTIVE_FRAMES` | `3` | Number of consecutive changed detection frames required. |
| `DETECT_FPS` | `2` | Low-rate detector sampling. |
| `EVENT_RECORD_FPS` | `10` | Frame rate of saved event clips. |
| `EVENT_RECORD_WIDTH` | `1280` | Maximum encoded event width. |
| `EVENT_RECORD_HEIGHT` | `-2` | Keep aspect ratio and choose a valid even height. |
| `TELEGRAM_MAX_VIDEO_MB` | `45` | Local safeguard before the bot sends a video. |
| `TERABOX_EVENTS_DIR` | `/V380/events` | Existing destination folder in TeraBox. |
| `ARCHIVE_INTERVAL_SECONDS` | `30` | Delay between archive queue scans. |

## Commands and diagnostics

| Action | Command |
|---|---|
| Install runtime | `windows\setup.cmd` |
| Install TeraBox uploader manually | `powershell -ExecutionPolicy Bypass -File windows\setup-events.ps1` |
| Start all services | `windows\start.cmd` |
| Stop all services | `windows\stop.cmd` |
| Open logs | `windows\logs.cmd` |
| Check Telegram/TeraBox and event services | `windows\check-events.cmd` |

The launcher writes logs to `.runtime\windows\logs`. The main files are `decoder.err.log`, `mediamtx.err.log`, `gateway.err.log`, `motion.err.log`, `notifier.err.log` and `archive.err.log`. Temporary event files and metadata are in `local-data\events`.

If live video is working but no event is created, review `motion.err.log`, then adjust `MIN_CHANGED_RATIO` and `CONSECUTIVE_FRAMES`. The motion process automatically retries RTSP after a temporary decoder or MediaMTX failure. If TeraBox fails, the event files remain in `local-data\events`; the archive worker records the reason and retries later. An expired `ndus` cookie must be replaced in `.env.windows`, followed by a restart.

## Validation for maintainers

The source includes checks that do not require a camera or cloud credentials:

```bash
bun run verify
node scripts/test-local-services.mjs
```

The integration test validates gateway authentication, WHEP path rewriting, event-status aggregation, and health endpoints for the motion, Telegram and TeraBox services.

## Security

Keep `.env.windows`, `.runtime`, `local-data` and the TeraBox configuration out of source control. Use a unique random value for each gateway and internal-notification token. Treat `TERABOX_NDUS`, the Telegram bot token, camera password and gateway token as secrets.


## Continuous recording and `/V380/archive`

The continuous recorder is an **additional pipeline** and does not alter motion detection, Telegram delivery, or the existing event archive worker. It reads the same private RTSP source independently and writes finalized MP4 segments to `local-data/continuous`. The default segment length is 1,800 seconds (30 minutes). A segment is uploaded only after FFmpeg closes it successfully; incomplete `.part.mp4` files are never sent to TeraBox.

The continuous archive worker uploads finalized segments to the separate TeraBox directory `/V380/archive`. It uses the same installed `terabox-node` uploader and the same `TERABOX_NDUS` credential, but has an independent queue, staging directory, retry loop, status endpoint, and process. After TeraBox confirms `Uploaded` or an acceptable same-name duplicate, the local segment is deleted. Failed uploads remain in `local-data/continuous` for retry. Set `CONTINUOUS_MAX_LOCAL_SEGMENTS` above zero if a local safety cache is required; the default `0` removes only segments that have already been confirmed in TeraBox.

The additional local services are `127.0.0.1:8093` for the recorder and `127.0.0.1:8094` for the continuous archive worker. The gateway includes both health states in `/api/events`, and the Events screen displays a separate Continuous recording card. The Windows launcher starts and stops both services together with the existing processes. The new runtime logs are `continuous.out.log`, `continuous.err.log`, `continuous-archive.out.log`, and `continuous-archive.err.log`.

Required configuration is present in `.env.windows.example`:

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

Continuous recording requires the Windows host, V380 decoder, FFmpeg, and the RTSP relay to remain available. It is not a certified surveillance recorder: a host outage, camera relay interruption, disk-full condition, expired TeraBox session, or invalid FFmpeg installation can create gaps. Monitor the continuous health card and keep sufficient local disk space for at least one segment plus the upload staging copy.


## Runtime service switches

The **Настройки** screen now provides ВКЛ/ВЫКЛ controls for MotionDetector, Telegram, event TeraBox archive, continuous recording, and continuous TeraBox archive. Changes apply without restarting the Windows launcher and are stored in ignored JSON files under `local-data`.

Disabling MotionDetector stops creation of new motion events but does not delete existing clips. Disabling Telegram prevents new sends and retries while preserving event files. Disabling either TeraBox worker pauses its queue; completed local files remain available and are processed after the worker is enabled again.

Continuous recording now converts the RTSP audio track from PCM A-law to AAC while copying the video stream. This is required because MP4 does not accept the camera's `pcm_alaw` audio stream directly. The first continuous segment is uploaded only after its 30-minute recording is finalized; the archive worker then scans it within the configured interval.
