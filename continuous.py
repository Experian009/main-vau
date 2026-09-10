import subprocess
import threading
import os
import sys

class ContinuousRecorder:
    def __init__(self, config):
        self.config = config
        self.ffmpeg_bin = config.get("FFMPEG_BIN", "ffmpeg")
        self.rtsp_port = config.get("RTSP_PORT", "8554")
        self.rtsp_url = f"rtsp://127.0.0.1:{self.rtsp_port}/live"

        self.continuous_dir = config.get("CONTINUOUS_DIR", "local-data/continuous")
        self.segment_seconds = config.get("CONTINUOUS_SEGMENT_SECONDS", "1800")

        os.makedirs(self.continuous_dir, exist_ok=True)

        self.enabled = config.get("CONTINUOUS_ENABLED", True)
        self.process = None
        self.lock = threading.Lock()

    def set_enabled(self, enabled):
        with self.lock:
            self.enabled = enabled
            if enabled and not self.process:
                self.start()
            elif not enabled and self.process:
                self.stop()

    def start(self):
        with self.lock:
            if not self.enabled or self.process:
                return

            output_pattern = os.path.join(self.continuous_dir, "segment-%Y%m%d-%H%M%S.mp4")

            # Simple segment muxer command mimicking the old logic
            args = [
                self.ffmpeg_bin,
                "-y",
                "-i", self.rtsp_url,
                "-c", "copy",
                "-f", "segment",
                "-segment_time", str(self.segment_seconds),
                "-segment_format", "mp4",
                "-reset_timestamps", "1",
                "-strftime", "1",
                output_pattern
            ]

            try:
                self.process = subprocess.Popen(
                    args,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
                )
                print(f"Continuous Recorder started in {self.continuous_dir}")
            except Exception as e:
                print(f"Failed to start Continuous Recorder (ffmpeg): {e}", file=sys.stderr)

    def stop(self):
        with self.lock:
            if self.process:
                self.process.terminate()
                self.process.wait()
                self.process = None
                print("Continuous Recorder stopped.")
