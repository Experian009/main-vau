import threading
import queue
import time
import os
import glob
from terabox import TeraBoxClient

class TeraBoxArchiver:
    def __init__(self, config):
        self.config = config
        self.interval = config.get("ARCHIVE_INTERVAL_SECONDS", 30)
        self.events_dir = config.get("TERABOX_EVENTS_DIR", "/V380/events")
        self.continuous_dir = config.get("TERABOX_CONTINUOUS_DIR", "/V380/archive")
        self.local_continuous_dir = config.get("CONTINUOUS_DIR", "local-data/continuous")

        self.events_enabled = config.get("TERABOX_EVENTS_ENABLED", True)
        self.continuous_enabled = config.get("TERABOX_CONTINUOUS_ENABLED", True)

        ndus = config.get("TERABOX_NDUS", "")
        self.client = TeraBoxClient(ndus)

        self.event_queue = queue.Queue()
        self.running = False
        self.thread = threading.Thread(target=self._worker, daemon=True)

    def start(self):
        if not self.client.is_configured():
            print("TeraBox Archiver: TERABOX_NDUS is missing. Archiver disabled.")
            self.events_enabled = False
            self.continuous_enabled = False
            return

        self.running = True
        self.thread.start()

    def set_events_enabled(self, enabled):
        self.events_enabled = enabled

    def set_continuous_enabled(self, enabled):
        self.continuous_enabled = enabled

    def enqueue_event(self, filepath):
        if not self.events_enabled or not self.client.is_configured():
            return
        self.event_queue.put(filepath)
        print(f"TeraBox Archiver: Queued event {filepath}")

    def _worker(self):
        last_scan_time = 0

        while self.running:
            # 1. Process Event Queue
            try:
                event_filepath = self.event_queue.get(timeout=2)

                if self.events_enabled and os.path.exists(event_filepath):
                    success = self.client.upload_file(event_filepath, self.events_dir)
                    if success:
                        try:
                            os.remove(event_filepath)
                            print(f"TeraBox Archiver: Cleaned up local event {event_filepath}")
                        except OSError as e:
                            print(f"TeraBox Archiver: Failed to delete local event: {e}")

                self.event_queue.task_done()
            except queue.Empty:
                pass

            # 2. Process Continuous Segments periodically
            now = time.time()
            if self.continuous_enabled and (now - last_scan_time) >= self.interval:
                last_scan_time = now
                self._scan_continuous()

    def _scan_continuous(self):
        if not os.path.exists(self.local_continuous_dir):
            return

        segments = glob.glob(os.path.join(self.local_continuous_dir, "*.mp4"))
        now = time.time()

        for segment in segments:
            if not self.running or not self.continuous_enabled:
                break

            if now - os.path.getmtime(segment) > 60:
                print(f"TeraBox Archiver: Found completed segment {segment}")
                success = self.client.upload_file(segment, self.continuous_dir)
                if success:
                    try:
                        os.remove(segment)
                        print(f"TeraBox Archiver: Cleaned up local segment {segment}")
                    except OSError as e:
                        print(f"TeraBox Archiver: Failed to delete local segment: {e}")

    def stop(self):
        self.running = False
        if self.thread.is_alive():
            self.thread.join(timeout=3)
