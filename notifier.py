import threading
import queue
import time
import requests
import os

class TelegramNotifier:
    def __init__(self, config):
        self.config = config
        self.token = config.get("TELEGRAM_BOT_TOKEN", "")
        self.chat_id = config.get("TELEGRAM_CHAT_ID", "")
        self.enabled = config.get("TELEGRAM_ENABLED", True)

        self.queue = queue.Queue()
        self.running = False
        self.thread = threading.Thread(target=self._worker, daemon=True)

    def start(self):
        if not self.token or not self.chat_id:
            print("Telegram Notifier: Missing token or chat_id. Delivery disabled.")
            self.enabled = False
            return

        self.running = True
        self.thread.start()

    def set_enabled(self, enabled):
        self.enabled = enabled

    def enqueue_video(self, filepath):
        if not self.enabled:
            return
        self.queue.put(filepath)
        print(f"Telegram Notifier: Queued {filepath}")

    def _worker(self):
        while self.running:
            try:
                # Block until a video is available or timeout
                filepath = self.queue.get(timeout=2)
            except queue.Empty:
                continue

            if not self.enabled:
                self.queue.task_done()
                continue

            if not os.path.exists(filepath):
                print(f"Telegram Notifier: File not found {filepath}")
                self.queue.task_done()
                continue

            print(f"Telegram Notifier: Sending {filepath} to Telegram...")
            success = self._send_video(filepath)

            if success:
                print(f"Telegram Notifier: Successfully sent {filepath}")
            else:
                print(f"Telegram Notifier: Failed to send {filepath}")

            self.queue.task_done()

    def _send_video(self, filepath):
        url = f"https://api.telegram.org/bot{self.token}/sendVideo"
        try:
            with open(filepath, 'rb') as video:
                files = {'video': video}
                data = {'chat_id': self.chat_id}

                # Check for proxy
                proxies = None
                proxy_url = self.config.get("TELEGRAM_HTTPS_PROXY")
                if proxy_url:
                    proxies = {"https": proxy_url}

                response = requests.post(url, data=data, files=files, proxies=proxies, timeout=60)
                if response.status_code == 200:
                    return True
                else:
                    print(f"Telegram API Error: {response.status_code} - {response.text}")
                    return False
        except Exception as e:
            print(f"Telegram Request Exception: {e}")
            return False

    def stop(self):
        self.running = False
        if self.thread.is_alive():
            self.thread.join(timeout=3)
