import tkinter as tk
from config import config
from decoder import DecoderManager
from gui import AppGUI
from camera import Camera
from motion import MotionDetector
from notifier import TelegramNotifier
from continuous import ContinuousRecorder
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

    # Initialize components
    telegram_notifier = TelegramNotifier(config)
    continuous_recorder = ContinuousRecorder(config)
    motion_detector = MotionDetector(config, update_ui_callback=app.update_status)

    # Link modules
    motion_detector.set_notifier(telegram_notifier)
    camera.subscribe(motion_detector.process_frame)

    # Link GUI controls to module states
    app.set_settings_callbacks(
        motion_cb=motion_detector.set_enabled,
        telegram_cb=telegram_notifier.set_enabled,
        continuous_cb=continuous_recorder.set_enabled
    )

    # Start background threads for new modules
    telegram_notifier.start()

    try:
        root.mainloop()
    except KeyboardInterrupt:
        print("Interrupted by user.")
    finally:
        app.running = False
        camera.stop()
        motion_detector.stop()
        continuous_recorder.stop()
        telegram_notifier.stop()
        decoder.stop()
        print("Application closed.")

if __name__ == "__main__":
    main()