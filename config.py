import os
from dotenv import load_dotenv

def load_config():
    # Attempt to load from .env.windows, fallback to .env.windows.example if it doesn't exist
    if os.path.exists(".env.windows"):
        load_dotenv(".env.windows")
    else:
        load_dotenv(".env.windows.example")

    return {
        "V380_CAMERA_ID": os.getenv("V380_CAMERA_ID", ""),
        "V380_USERNAME": os.getenv("V380_USERNAME", "admin"),
        "V380_PASSWORD": os.getenv("V380_PASSWORD", ""),
        "RTSP_PORT": os.getenv("V380_LOCAL_PORT", "8554"),

        # Motion detection and event configuration
        "MIN_CHANGED_RATIO": float(os.getenv("MIN_CHANGED_RATIO", "0.035")),
        "CONSECUTIVE_FRAMES": int(os.getenv("CONSECUTIVE_FRAMES", "3")),
        "PREBUFFER_SECONDS": int(os.getenv("PREBUFFER_SECONDS", "5")),
        "POSTBUFFER_SECONDS": int(os.getenv("POSTBUFFER_SECONDS", "20")),
        "COOLDOWN_SECONDS": int(os.getenv("COOLDOWN_SECONDS", "30")),
        "EVENT_RECORD_FPS": int(os.getenv("EVENT_RECORD_FPS", "10")),
        "EVENTS_DIR": os.getenv("EVENTS_DIR", "local-data/events"),

        # Telegram Notifier configuration
        "TELEGRAM_BOT_TOKEN": os.getenv("TELEGRAM_BOT_TOKEN", ""),
        "TELEGRAM_CHAT_ID": os.getenv("TELEGRAM_CHAT_ID", ""),
        "TELEGRAM_HTTPS_PROXY": os.getenv("TELEGRAM_HTTPS_PROXY", ""),
        "TELEGRAM_ENABLED": os.getenv("TELEGRAM_ENABLED", "true").lower() == "true",

        # Continuous Recording configuration
        "FFMPEG_BIN": os.getenv("FFMPEG_BIN", "ffmpeg"),
        "CONTINUOUS_DIR": os.getenv("CONTINUOUS_DIR", "local-data/continuous"),
        "CONTINUOUS_SEGMENT_SECONDS": int(os.getenv("CONTINUOUS_SEGMENT_SECONDS", "1800")),
        "CONTINUOUS_ENABLED": os.getenv("CONTINUOUS_ENABLED", "true").lower() == "true",

        # TeraBox Archive configuration
        "TERABOX_NDUS": os.getenv("TERABOX_NDUS", ""),
        "TERABOX_EVENTS_DIR": os.getenv("TERABOX_EVENTS_DIR", "/V380/events"),
        "TERABOX_CONTINUOUS_DIR": os.getenv("TERABOX_CONTINUOUS_DIR", "/V380/archive"),
        "TERABOX_EVENTS_ENABLED": os.getenv("TERABOX_EVENTS_ENABLED", "true").lower() == "true",
        "TERABOX_CONTINUOUS_ENABLED": os.getenv("TERABOX_CONTINUOUS_ENABLED", "true").lower() == "true",
        "ARCHIVE_INTERVAL_SECONDS": int(os.getenv("ARCHIVE_INTERVAL_SECONDS", "30"))
    }

config = load_config()