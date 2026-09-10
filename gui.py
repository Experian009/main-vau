import tkinter as tk
from tkinter import ttk
import cv2
from PIL import Image, ImageTk
import threading

class AppGUI:
    def __init__(self, root, camera):
        self.root = root
        self.root.title("V380 Event MVP (Python Edition)")
        self.root.geometry("800x600")
        self.camera = camera

        self.video_label = ttk.Label(self.root)
        self.video_label.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        self.status_label = ttk.Label(self.root, text="Status: Connecting...", anchor=tk.W)
        self.status_label.pack(fill=tk.X, side=tk.BOTTOM, padx=10, pady=5)

        self.running = True

        # We will use Tkinter's 'after' loop instead of a tight while loop thread
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.update_video_loop()

    def update_video_loop(self):
        if not self.running:
            return

        frame = self.camera.get_latest_frame()
        if frame is not None:
            # Convert BGR to RGB
            cv2image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(cv2image)
            # Scale down for standard view
            img = img.resize((640, 360), Image.Resampling.LANCZOS)

            imgtk = ImageTk.PhotoImage(image=img)
            self.video_label.imgtk = imgtk
            self.video_label.configure(image=imgtk)

            # Note: We don't overwrite status here if motion detector is modifying it.
            # But we can clear a 'Connecting' state.
            if self.status_label.cget("text") == "Status: Connecting...":
                self.update_status("Status: Playing")

        # Schedule the next check (roughly 30 fps -> ~33 ms)
        self.root.after(33, self.update_video_loop)

    def update_status(self, text):
        # Safe to call from other threads (via root.after) if needed,
        # or direct if on main thread. We'll ensure it's thread-safe.
        def _set_text():
            self.status_label.configure(text=text)
        self.root.after(0, _set_text)

    def on_close(self):
        self.running = False
        self.root.destroy()
