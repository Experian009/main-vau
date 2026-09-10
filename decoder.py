import subprocess
import os
import sys
import time

class DecoderManager:
    def __init__(self, config):
        self.config = config
        self.process = None

    def start(self):
        decoder_path = os.path.join(".runtime", "windows", "decoder", "V380Decoder.exe")
        if not os.path.exists(decoder_path):
            print(f"Warning: V380Decoder.exe not found at {decoder_path}. Decoder will not start.", file=sys.stderr)
            return

        env = os.environ.copy()
        env["V380_CAMERA_ID"] = self.config.get("V380_CAMERA_ID", "")
        env["V380_USERNAME"] = self.config.get("V380_USERNAME", "")
        env["V380_PASSWORD"] = self.config.get("V380_PASSWORD", "")

        camera_id = self.config.get("V380_CAMERA_ID", "")
        username = self.config.get("V380_USERNAME", "admin")
        password = self.config.get("V380_PASSWORD", "")
        rtsp_port = self.config.get("RTSP_PORT", "8554")

        args = [
            decoder_path,
            "--id", camera_id,
            "--username", username,
            "--password", password,
            "--output", "rtsp",
            "--port", rtsp_port
        ]

        try:
            self.process = subprocess.Popen(
                args,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )
            print("V380Decoder started.")
            # Give it a moment to initialize the RTSP stream
            time.sleep(2)
        except Exception as e:
            print(f"Failed to start V380Decoder: {e}", file=sys.stderr)

    def stop(self):
        if self.process:
            self.process.terminate()
            self.process.wait()
            print("V380Decoder stopped.")
            self.process = None