import cv2
import numpy as np
import time
import os
import threading
from collections import deque

class MotionDetector:
    def __init__(self, config, update_ui_callback=None):
        self.config = config
        self.update_ui_callback = update_ui_callback

        self.min_ratio = config.get("MIN_CHANGED_RATIO", 0.035)
        self.consecutive_frames = config.get("CONSECUTIVE_FRAMES", 3)
        self.prebuffer_sec = config.get("PREBUFFER_SECONDS", 5)
        self.postbuffer_sec = config.get("POSTBUFFER_SECONDS", 20)
        self.cooldown_sec = config.get("COOLDOWN_SECONDS", 30)
        self.fps = config.get("EVENT_RECORD_FPS", 10)
        self.events_dir = config.get("EVENTS_DIR", "local-data/events")

        os.makedirs(self.events_dir, exist_ok=True)

        self.enabled = config.get("MOTION_ENABLED", True)
        self.telegram_notifier = None # Will be set via setter
        self.archive_worker = None

        # Detector state
        self.prev_gray = None
        self.changed_count = 0
        self.is_recording = False
        self.last_event_time = 0
        self.record_end_time = 0
        self.video_writer = None
        self.current_filename = None

        # We estimate buffer size based on target recording FPS
        self.prebuffer = deque(maxlen=self.prebuffer_sec * self.fps)
        self.last_process_time = 0

        # To avoid processing every single frame, we throttle the detection to roughly self.fps
        self.frame_interval = 1.0 / self.fps

        self.lock = threading.Lock()

    def set_enabled(self, enabled):
        with self.lock:
            self.enabled = enabled
            if not enabled and self.is_recording:
                self._stop_recording()

    def set_notifier(self, notifier):
        self.telegram_notifier = notifier

    def set_archiver(self, archiver):
        self.archive_worker = archiver

    def process_frame(self, frame):
        now = time.time()

        # Throttle processing to the target event FPS to maintain a consistent recording rate
        if now - self.last_process_time < self.frame_interval:
            return

        self.last_process_time = now

        with self.lock:
            # Always maintain ring buffer if enabled or not (or clear it if disabled, but safer to maintain)
            self.prebuffer.append(frame.copy())

            if not self.enabled:
                return

            # 2. Check if currently recording
            if self.is_recording:
                if self.video_writer and hasattr(self, 'ffmpeg_proc') and self.ffmpeg_proc:
                    try:
                        self.ffmpeg_proc.stdin.write(frame.tobytes())
                    except Exception:
                        pass

                if now >= self.record_end_time:
                    self._stop_recording()
                return

            # 3. Check for cooldown
            if now - self.last_event_time < self.cooldown_sec:
                return

            # 4. Motion Detection Logic
            # Downscale and convert to grayscale for fast differencing (640x360 as per old config)
            small_frame = cv2.resize(frame, (640, 360), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (21, 21), 0)

            if self.prev_gray is None:
                self.prev_gray = gray
                return

            # Compute absolute difference
            frame_delta = cv2.absdiff(self.prev_gray, gray)
            self.prev_gray = gray

            # Threshold the difference (pixels that changed by more than 25 out of 255)
            _, thresh = cv2.threshold(frame_delta, 25, 255, cv2.THRESH_BINARY)

            # Calculate ratio of changed pixels
            total_pixels = thresh.shape[0] * thresh.shape[1]
            changed_pixels = cv2.countNonZero(thresh)
            ratio = changed_pixels / total_pixels

            if ratio > self.min_ratio:
                self.changed_count += 1
            else:
                self.changed_count = 0

            # Trigger event
            if self.changed_count >= self.consecutive_frames:
                self._start_recording(now, frame.shape)
                self.changed_count = 0

    def _start_recording(self, current_time, frame_shape):
        self.is_recording = True
        self.last_event_time = current_time
        self.record_end_time = current_time + self.postbuffer_sec

        event_id = int(current_time)
        self.current_filename = os.path.join(self.events_dir, f"event-full-{event_id}.mp4")

        height, width = frame_shape[:2]

        # Use a background thread to queue frames and let ffmpeg encode them
        # This prevents blocking the camera read thread and produces H.264
        import subprocess
        import sys

        ffmpeg_bin = self.config.get("FFMPEG_BIN", "ffmpeg")

        try:
            self.ffmpeg_proc = subprocess.Popen([
                ffmpeg_bin,
                "-y",
                "-f", "rawvideo",
                "-vcodec", "rawvideo",
                "-s", f"{width}x{height}",
                "-pix_fmt", "bgr24",
                "-r", str(self.fps),
                "-i", "-",
                "-c:v", "libx264",
                "-preset", "fast",
                "-pix_fmt", "yuv420p",
                self.current_filename
            ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
               creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)

            self.video_writer = True # Use as a flag indicating active recording

            # Write prebuffer first
            for buf_frame in self.prebuffer:
                self.ffmpeg_proc.stdin.write(buf_frame.tobytes())

        except Exception as e:
            print(f"Failed to start ffmpeg for motion event: {e}")
            self.is_recording = False
            return

        print(f"Motion Detected! Started recording event: {self.current_filename}")
        if self.update_ui_callback:
            self.update_ui_callback("Status: Motion Detected! Recording...")

    def _stop_recording(self):
        if self.video_writer and hasattr(self, 'ffmpeg_proc') and self.ffmpeg_proc:
            try:
                self.ffmpeg_proc.stdin.close()
                self.ffmpeg_proc.wait(timeout=5)
            except Exception:
                self.ffmpeg_proc.kill()
            self.ffmpeg_proc = None
            self.video_writer = None

        self.is_recording = False
        print("Finished recording event.")

        # Queue the finished video to Telegram
        if self.telegram_notifier and self.current_filename:
            self.telegram_notifier.enqueue_video(self.current_filename)

        # Queue to TeraBox
        if self.archive_worker and self.current_filename:
            self.archive_worker.enqueue_event(self.current_filename)

        if self.update_ui_callback:
            self.update_ui_callback("Status: Playing (Cooldown)")

    def stop(self):
        """Cleanup resources on exit."""
        with self.lock:
            if self.is_recording:
                self._stop_recording()
