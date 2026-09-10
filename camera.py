import cv2
import threading
import time

class Camera:
    def __init__(self, rtsp_url):
        self.rtsp_url = rtsp_url
        self.capture = None
        self.running = False
        self.latest_frame = None
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.frame_subscribers = []

    def start(self):
        self.running = True
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread.is_alive():
            self.thread.join(timeout=2)
        if self.capture:
            self.capture.release()

    def get_latest_frame(self):
        with self.lock:
            if self.latest_frame is not None:
                return self.latest_frame.copy()
            return None

    def subscribe(self, callback):
        """Register a callback to receive frames as they arrive."""
        self.frame_subscribers.append(callback)

    def _capture_loop(self):
        self.capture = cv2.VideoCapture(self.rtsp_url)
        # Attempt to reduce buffer latency
        self.capture.set(cv2.CAP_PROP_BUFFERSIZE, 2)

        while self.running:
            ret, frame = self.capture.read()
            if ret:
                with self.lock:
                    self.latest_frame = frame

                # Notify subscribers (like the motion detector)
                for callback in self.frame_subscribers:
                    try:
                        callback(frame)
                    except Exception as e:
                        print(f"Error in frame subscriber: {e}")
            else:
                print("Camera: Reconnecting...")
                time.sleep(1)
                self.capture.release()
                self.capture = cv2.VideoCapture(self.rtsp_url)
                self.capture.set(cv2.CAP_PROP_BUFFERSIZE, 2)
