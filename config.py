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
        "RTSP_PORT": os.getenv("V380_LOCAL_PORT", "8554")
    }

config = load_config()