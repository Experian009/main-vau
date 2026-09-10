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

        # Detector state
        self.prev_gray = None
        self.changed_count = 0
        self.is_recording = False
        self.last_event_time = 0
        self.record_end_time = 0
        self.video_writer = None

        # We estimate buffer size based on target recording FPS
        self.prebuffer = deque(maxlen=self.prebuffer_sec * self.fps)
        self.last_process_time = 0

        # To avoid processing every single frame, we throttle the detection to roughly self.fps
        self.frame_interval = 1.0 / self.fps

        self.lock = threading.Lock()

    def process_frame(self, frame):
        now = time.time()

        # Throttle processing to the target event FPS to maintain a consistent recording rate
        if now - self.last_process_time < self.frame_interval:
            return

        self.last_process_time = now

        with self.lock:
            # 1. Maintain ring buffer
            self.prebuffer.append(frame.copy())

            # 2. Check if currently recording
            if self.is_recording:
                if self.video_writer:
                    self.video_writer.write(frame)

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
        filename = os.path.join(self.events_dir, f"event-full-{event_id}.mp4")

        height, width = frame_shape[:2]

        # Create VideoWriter. H264 via 'avc1' or standard 'mp4v'
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self.video_writer = cv2.VideoWriter(filename, fourcc, self.fps, (width, height))

        # Write prebuffer first
        for buf_frame in self.prebuffer:
            self.video_writer.write(buf_frame)

        print(f"Motion Detected! Started recording event: {filename}")
        if self.update_ui_callback:
            self.update_ui_callback("Status: Motion Detected! Recording...")

    def _stop_recording(self):
        if self.video_writer:
            self.video_writer.release()
            self.video_writer = None

        self.is_recording = False
        print("Finished recording event.")
        if self.update_ui_callback:
            self.update_ui_callback("Status: Playing (Cooldown)")

    def stop(self):
        """Cleanup resources on exit."""
        with self.lock:
            if self.is_recording:
                self._stop_recording()
