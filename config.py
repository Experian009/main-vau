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
        "EVENTS_DIR": os.getenv("EVENTS_DIR", "local-data/events")
    }

config = load_config()