import tkinter as tk
from config import config
from decoder import DecoderManager
from gui import AppGUI
from camera import Camera
from motion import MotionDetector
import os
import sys

def main():
    print("Starting V380 Python Edition...")

    decoder = DecoderManager(config)
    decoder.start()

    rtsp_port = config.get("RTSP_PORT", "8554")
    rtsp_url = f"rtsp://127.0.0.1:{rtsp_port}/live"

    # Start camera capture thread
    camera = Camera(rtsp_url)
    camera.start()

    root = tk.Tk()
    app = AppGUI(root, camera)

    # Initialize Motion Detector and subscribe it to the camera feed
    motion_detector = MotionDetector(config, update_ui_callback=app.update_status)
    camera.subscribe(motion_detector.process_frame)

    try:
        root.mainloop()
    except KeyboardInterrupt:
        print("Interrupted by user.")
    finally:
        app.running = False
        camera.stop()
        motion_detector.stop()
        decoder.stop()
        print("Application closed.")

if __name__ == "__main__":
    main()