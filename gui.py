import tkinter as tk
from tkinter import ttk
import cv2
from PIL import Image, ImageTk
import threading

class AppGUI:
    def __init__(self, root, rtsp_url):
        self.root = root
        self.root.title("V380 Event MVP (Python Edition)")
        self.root.geometry("800x600")
        self.rtsp_url = rtsp_url

        self.video_label = ttk.Label(self.root)
        self.video_label.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        self.status_label = ttk.Label(self.root, text="Status: Connecting...", anchor=tk.W)
        self.status_label.pack(fill=tk.X, side=tk.BOTTOM, padx=10, pady=5)

        self.capture = None
        self.running = True
        self.thread = threading.Thread(target=self.video_loop)
        self.thread.start()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def video_loop(self):
        self.capture = cv2.VideoCapture(self.rtsp_url)

        while self.running:
            ret, frame = self.capture.read()
            if ret:
                # Convert BGR to RGB
                cv2image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                # Resize if necessary to fit the window (basic resize for prototype)
                img = Image.fromarray(cv2image)
                # Scale down for standard view
                img = img.resize((640, 360), Image.Resampling.LANCZOS)

                # Update the label image from the main thread (pass Image object, not PhotoImage)
                self.video_label.after(0, self.update_image, img)
                self.status_label.after(0, self.update_status, "Status: Playing")
            else:
                self.status_label.after(0, self.update_status, "Status: Reconnecting...")
                import time
                time.sleep(1) # Prevent CPU pegging
                self.capture.release()
                self.capture = cv2.VideoCapture(self.rtsp_url)

        if self.capture:
            self.capture.release()

    def update_image(self, img):
        # Create PhotoImage on the main thread
        imgtk = ImageTk.PhotoImage(image=img)
        self.video_label.imgtk = imgtk
        self.video_label.configure(image=imgtk)

    def update_status(self, text):
        self.status_label.configure(text=text)

    def on_close(self):
        self.running = False
        self.root.destroy()
