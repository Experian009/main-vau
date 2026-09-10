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
        self.video_label.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        # Settings Panel
        self.settings_frame = ttk.LabelFrame(self.root, text="Настройки (Settings)")
        self.settings_frame.pack(fill=tk.X, padx=10, pady=5)

        self.motion_var = tk.BooleanVar(value=True)
        self.telegram_var = tk.BooleanVar(value=True)
        self.continuous_var = tk.BooleanVar(value=True)
        self.terabox_events_var = tk.BooleanVar(value=True)
        self.terabox_cont_var = tk.BooleanVar(value=True)

        self.motion_check = ttk.Checkbutton(self.settings_frame, text="Motion Detection", variable=self.motion_var, command=self.on_settings_change)
        self.motion_check.pack(side=tk.LEFT, padx=10, pady=5)

        self.telegram_check = ttk.Checkbutton(self.settings_frame, text="Telegram Delivery", variable=self.telegram_var, command=self.on_settings_change)
        self.telegram_check.pack(side=tk.LEFT, padx=10, pady=5)

        self.continuous_check = ttk.Checkbutton(self.settings_frame, text="Continuous Recording", variable=self.continuous_var, command=self.on_settings_change)
        self.continuous_check.pack(side=tk.LEFT, padx=10, pady=5)

        self.tb_events_check = ttk.Checkbutton(self.settings_frame, text="TeraBox Events", variable=self.terabox_events_var, command=self.on_settings_change)
        self.tb_events_check.pack(side=tk.LEFT, padx=5, pady=5)

        self.tb_cont_check = ttk.Checkbutton(self.settings_frame, text="TeraBox Cont.", variable=self.terabox_cont_var, command=self.on_settings_change)
        self.tb_cont_check.pack(side=tk.LEFT, padx=5, pady=5)

        self.status_label = ttk.Label(self.root, text="Status: Connecting...", anchor=tk.W)
        self.status_label.pack(fill=tk.X, side=tk.BOTTOM, padx=10, pady=5)

        self.running = True
        self.callbacks = {}

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

    def set_settings_callbacks(self, motion_cb, telegram_cb, continuous_cb, tb_events_cb, tb_cont_cb):
        self.callbacks['motion'] = motion_cb
        self.callbacks['telegram'] = telegram_cb
        self.callbacks['continuous'] = continuous_cb
        self.callbacks['tb_events'] = tb_events_cb
        self.callbacks['tb_cont'] = tb_cont_cb

        # Initialize initial state from defaults
        self.on_settings_change()

    def on_settings_change(self):
        if 'motion' in self.callbacks:
            self.callbacks['motion'](self.motion_var.get())
        if 'telegram' in self.callbacks:
            self.callbacks['telegram'](self.telegram_var.get())
        if 'continuous' in self.callbacks:
            self.callbacks['continuous'](self.continuous_var.get())
        if 'tb_events' in self.callbacks:
            self.callbacks['tb_events'](self.terabox_events_var.get())
        if 'tb_cont' in self.callbacks:
            self.callbacks['tb_cont'](self.terabox_cont_var.get())

    def update_status(self, text):
        # Safe to call from other threads (via root.after) if needed,
        # or direct if on main thread. We'll ensure it's thread-safe.
        def _set_text():
            self.status_label.configure(text=text)
        self.root.after(0, _set_text)

    def on_close(self):
        self.running = False
        self.root.destroy()
