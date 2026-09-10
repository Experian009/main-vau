import tkinter as tk
from config import config
from decoder import DecoderManager
from gui import AppGUI
import os
import sys

def main():
    print("Starting V380 Python Edition...")

    decoder = DecoderManager(config)
    decoder.start()

    rtsp_port = config.get("RTSP_PORT", "8554")
    rtsp_url = f"rtsp://127.0.0.1:{rtsp_port}/live"

    root = tk.Tk()
    app = AppGUI(root, rtsp_url)

    try:
        root.mainloop()
    except KeyboardInterrupt:
        print("Interrupted by user.")
    finally:
        app.running = False
        decoder.stop()
        print("Application closed.")

if __name__ == "__main__":
    main()