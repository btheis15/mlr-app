#!/usr/bin/env python3
"""
MLR Media Server — control panel.

A small Tkinter desktop app to run the media server on/off and watch its status
without touching the terminal. The server runs as a launchd LaunchAgent
(com.mlr.media-server); this panel bootstraps / boots-out that agent and polls
its health, tunnel, and storage.

Launch:  /usr/bin/python3 control_panel.py
(usually via the "MLR Media Server.app" wrapper, so there's no Terminal window).
"""

import os
import re
import subprocess
import threading
import tkinter as tk
import urllib.request
from datetime import datetime
from tkinter import font as tkfont

# ---- config (paths resolved relative to this file = the media-server dir) ----
BASE = os.path.dirname(os.path.abspath(__file__))
LABEL = "com.mlr.media-server"
UID = os.getuid()
DOMAIN = f"gui/{UID}"
SERVICE = f"{DOMAIN}/{LABEL}"
PLIST = os.path.expanduser(f"~/Library/LaunchAgents/{LABEL}.plist")
LOG = os.path.join(BASE, "logs", "server.log")


def _env(key, default=""):
    try:
        with open(os.path.join(BASE, ".env")) as f:
            for line in f:
                line = line.strip()
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return default


PORT = _env("PORT", "8787")
PUBLIC_URL = _env("PUBLIC_URL", f"http://localhost:{PORT}")
MEDIA_DIR = _env("MEDIA_DIR", os.path.join(BASE, "media"))
TAILSCALE = "/opt/homebrew/bin/tailscale" if os.path.exists(
    "/opt/homebrew/bin/tailscale") else "tailscale"
# The mobile app's green-house emblem (shown in the header).
LOGO = os.path.join(BASE, "..", "public", "icon-512.png")

# ---- theme (MLR pine green on warm near-white) ----
PINE = "#15503a"
BG = "#f2f2ec"
CARD = "#ffffff"
INK = "#14241c"
MUTE = "#737d76"
BORDER = "#e0dfd4"
GREEN = "#1a7a4f"
RED = "#c0392b"
AMBER = "#b45309"
LOGBG = "#10231b"
LOGFG = "#c6e7d4"
DISABLED = "#9aa39c"


def run(args, timeout=12):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except Exception as e:  # noqa: BLE001 - never let a probe crash the UI
        class R:
            returncode = 1
            stdout = ""
            stderr = str(e)
        return R()


def tail(path, n):
    try:
        with open(path, "r", errors="replace") as f:
            lines = f.readlines()
        return "".join(lines[-n:]).rstrip() or "(log is empty)"
    except OSError:
        return "(no log yet)"


def fmt_size(b):
    if b >= 1024 ** 3:
        return f"{b / 1024 ** 3:.1f} GB"
    if b >= 1024 ** 2:
        return f"{b / 1024 ** 2:.1f} MB"
    if b >= 1024:
        return f"{b / 1024:.0f} KB"
    return f"{b} B"


def shade(hexc, f=0.85):
    hexc = hexc.lstrip("#")
    r, g, b = int(hexc[0:2], 16), int(hexc[2:4], 16), int(hexc[4:6], 16)
    return f"#{int(r * f):02x}{int(g * f):02x}{int(b * f):02x}"


class Btn(tk.Label):
    """A flat, colored button (tk.Button ignores bg on macOS, so we style a Label)."""

    def __init__(self, parent, text, command, bg, fg="white", font=None, **kw):
        super().__init__(parent, text=text, bg=bg, fg=fg, font=font,
                         cursor="pointinghand", **kw)
        self._cmd = command
        self._bg = bg
        self._on = True
        self.bind("<Button-1>", self._click)
        self.bind("<Enter>", self._enter)
        self.bind("<Leave>", self._leave)

    def _click(self, _e):
        if self._on and self._cmd:
            self._cmd()

    def _enter(self, _e):
        if self._on:
            self.config(bg=shade(self._bg))

    def _leave(self, _e):
        self.config(bg=self._bg if self._on else self._bg)

    def style(self, text=None, bg=None, fg=None):
        if text is not None:
            self.config(text=text)
        if bg is not None:
            self._bg = bg
            self.config(bg=bg)
        if fg is not None:
            self.config(fg=fg)

    def enabled(self, on, off_bg=DISABLED):
        self._on = on
        self.config(bg=self._bg if on else off_bg, fg="white" if on else "#e9e9e4")


class App:
    def __init__(self, root):
        self.root = root
        self.busy = False
        self.refreshing = False
        root.title("MLR Media Server")
        root.configure(bg=BG)
        root.geometry("470x760")
        root.minsize(440, 700)

        self.f_title = tkfont.Font(family="Helvetica Neue", size=17, weight="bold")
        self.f_sub = tkfont.Font(family="Helvetica Neue", size=11)
        self.f_status = tkfont.Font(family="Helvetica Neue", size=28, weight="bold")
        self.f_url = tkfont.Font(family="Menlo", size=11)
        self.f_btn = tkfont.Font(family="Helvetica Neue", size=15, weight="bold")
        self.f_lbl = tkfont.Font(family="Helvetica Neue", size=10, weight="bold")
        self.f_val = tkfont.Font(family="Menlo", size=13)
        self.f_small = tkfont.Font(family="Helvetica Neue", size=10)
        self.f_log = tkfont.Font(family="Menlo", size=10)
        # Brush-script wordmark to echo the resort's Yellowtail logo.
        _fams = set(tkfont.families())
        _logo_fam = next((x for x in ("Brush Script MT", "SignPainter",
                                      "Snell Roundhand", "Noteworthy") if x in _fams), None)
        self.f_logo = (tkfont.Font(family=_logo_fam, size=30) if _logo_fam
                       else tkfont.Font(family="Helvetica Neue", size=18, weight="bold"))

        self.logo_img = self._load_logo()
        self._build()
        self.root.after(150, lambda: self.root.focus_force())
        self._tick()

    def _build(self):
        head = tk.Frame(self.root, bg=PINE)
        head.pack(fill="x")
        inner = tk.Frame(head, bg=PINE)
        inner.pack(fill="x", padx=20, pady=16)
        if self.logo_img is not None:
            tk.Label(inner, image=self.logo_img, bg=PINE).pack(side="left", padx=(0, 12))
        textcol = tk.Frame(inner, bg=PINE)
        textcol.pack(side="left", anchor="w")
        tk.Label(textcol, text="MLR Media Server", bg=PINE, fg="white",
                 font=self.f_logo).pack(anchor="w")
        tk.Label(textcol, text="self-hosted photos & videos  ·  Mac mini",
                 bg=PINE, fg="#bcd8c9", font=self.f_sub).pack(anchor="w")

        body = tk.Frame(self.root, bg=BG)
        body.pack(fill="both", expand=True, padx=20, pady=18)

        hero = tk.Frame(body, bg=BG)
        hero.pack(fill="x")
        self.dot = tk.Canvas(hero, width=20, height=20, bg=BG, highlightthickness=0)
        self.dot.pack(side="left", padx=(0, 11))
        self.dot_id = self.dot.create_oval(3, 3, 18, 18, fill=AMBER, outline="")
        self.status_lbl = tk.Label(hero, text="Checking…", bg=BG, fg=INK, font=self.f_status)
        self.status_lbl.pack(side="left")
        self.url_lbl = tk.Label(body, text=PUBLIC_URL.replace("https://", ""),
                                bg=BG, fg=MUTE, font=self.f_url)
        self.url_lbl.pack(anchor="w", pady=(5, 0))

        self.toggle = Btn(body, "…", self._toggle, MUTE, font=self.f_btn, pady=17)
        self.toggle.pack(fill="x", pady=(16, 9))

        row = tk.Frame(body, bg=BG)
        row.pack(fill="x", pady=(0, 16))
        self.restart_btn = self._mini(row, "↻  Restart", self._restart)
        self.restart_btn.pack(side="left", expand=True, fill="x", padx=(0, 5))
        self._mini(row, "Logs", lambda: run(["open", os.path.dirname(LOG)])).pack(
            side="left", expand=True, fill="x", padx=5)
        self._mini(row, "Media", lambda: run(["open", MEDIA_DIR])).pack(
            side="left", expand=True, fill="x", padx=5)
        self._mini(row, "Copy URL", self._copy_url).pack(
            side="left", expand=True, fill="x", padx=(5, 0))

        card = tk.Frame(body, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        card.pack(fill="x")
        grid = tk.Frame(card, bg=CARD)
        grid.pack(fill="x", padx=16, pady=14)
        self.vals = {}
        cells = [("Health", "health"), ("PID", "pid"), ("Port", "port"),
                 ("Uptime", "uptime"), ("Tunnel", "tunnel"), ("Storage", "storage")]
        for i, (label, key) in enumerate(cells):
            r, c = divmod(i, 2)
            cell = tk.Frame(grid, bg=CARD)
            cell.grid(row=r, column=c, sticky="w", padx=(0, 24), pady=6)
            tk.Label(cell, text=label.upper(), bg=CARD, fg=MUTE,
                     font=self.f_lbl).pack(anchor="w")
            v = tk.Label(cell, text="—", bg=CARD, fg=INK, font=self.f_val)
            v.pack(anchor="w")
            self.vals[key] = v
        grid.columnconfigure(0, weight=1, minsize=190)
        grid.columnconfigure(1, weight=1)
        self.vals["port"].config(text=PORT)

        tk.Label(body, text="RECENT ACTIVITY", bg=BG, fg=MUTE,
                 font=self.f_lbl).pack(anchor="w", pady=(18, 5))
        logwrap = tk.Frame(body, bg=LOGBG)
        logwrap.pack(fill="both", expand=True)
        self.log = tk.Text(logwrap, bg=LOGBG, fg=LOGFG, font=self.f_log, relief="flat",
                           bd=0, height=8, wrap="none", padx=11, pady=9, state="disabled")
        self.log.pack(fill="both", expand=True)

        self.footer = tk.Label(self.root, text="", bg=BG, fg=MUTE, font=self.f_small)
        self.footer.pack(fill="x", padx=20, pady=(0, 12))

    def _mini(self, parent, text, cmd):
        b = Btn(parent, text, cmd, CARD, fg=INK, font=self.f_small, pady=8,
                highlightbackground=BORDER, highlightthickness=1)
        return b

    def _load_logo(self):
        """The green-house emblem from the mobile app, cropped to drop the
        'Muskellunge Lake Resort' wordmark (we show 'MLR Media Server'
        instead). Its green matches the header, so it blends in. Returns None
        if the image can't load — never blocks the UI."""
        try:
            if not os.path.exists(LOGO):
                return None
            src = tk.PhotoImage(file=LOGO)  # PNG decode needs Tk 8.6
            w, h = src.width(), src.height()
            crop_h = int(h * 0.58)  # keep the cabin badge, drop the wordmark
            badge = tk.PhotoImage(width=w, height=crop_h)
            badge.tk.call(badge.name, "copy", src.name,
                          "-from", 0, 0, w, crop_h, "-to", 0, 0)
            return badge.subsample(max(1, round(crop_h / 60)))  # ~60px tall
        except Exception:
            return None

    # ---- status loop ----
    def _tick(self):
        self._refresh_async()
        self.root.after(3000, self._tick)

    def _refresh_async(self):
        if self.refreshing:
            return
        self.refreshing = True
        threading.Thread(target=self._gather, daemon=True).start()

    def _gather(self):
        d = {}
        pr = run(["launchctl", "print", SERVICE])
        d["loaded"] = pr.returncode == 0
        m = re.search(r"state = (\w+)", pr.stdout)
        d["state"] = m.group(1) if m else ""
        m = re.search(r"pid = (\d+)", pr.stdout)
        d["pid"] = m.group(1) if m else None
        ok = False
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2) as r:
                ok = r.status == 200 and b'"ok"' in r.read()
        except Exception:
            ok = False
        d["health"] = ok
        up = ""
        if d["pid"]:
            up = run(["ps", "-o", "etime=", "-p", d["pid"]]).stdout.strip()
        d["uptime"] = up or "—"
        t = run([TAILSCALE, "funnel", "status"])
        d["tunnel"] = "Funnel on" if "Funnel on" in t.stdout else (
            "off" if t.returncode == 0 else "?")
        cnt = size = 0
        try:
            for f in os.listdir(MEDIA_DIR):
                if f.startswith("."):
                    continue
                fp = os.path.join(MEDIA_DIR, f)
                if os.path.isfile(fp):
                    cnt += 1
                    size += os.path.getsize(fp)
        except OSError:
            pass
        d["media_count"] = cnt
        d["media_size"] = size
        d["log"] = tail(LOG, 60)
        self.root.after(0, self._apply, d)

    def _apply(self, d):
        self.refreshing = False
        running = d["loaded"] and d["health"]
        if running:
            color, text = GREEN, "Running"
        elif d["loaded"]:
            color, text = AMBER, "Starting…"
        else:
            color, text = RED, "Stopped"
        self.dot.itemconfig(self.dot_id, fill=color)
        self.status_lbl.config(text=text)
        self.vals["health"].config(text=("ok ✓" if d["health"] else "down"),
                                   fg=(GREEN if d["health"] else RED))
        self.vals["pid"].config(text=d["pid"] or "—")
        self.vals["uptime"].config(text=d["uptime"])
        self.vals["tunnel"].config(text=d["tunnel"],
                                   fg=(GREEN if d["tunnel"] == "Funnel on" else AMBER))
        plural = "" if d["media_count"] == 1 else "s"
        self.vals["storage"].config(
            text=f'{fmt_size(d["media_size"])} · {d["media_count"]} file{plural}')
        if not self.busy:
            if d["loaded"]:
                self.toggle.style(text="■   Stop server", bg=RED)
            else:
                self.toggle.style(text="▶   Start server", bg=GREEN)
            self.toggle.enabled(True)
            self.restart_btn.enabled(d["loaded"])
        self.log.config(state="normal")
        self.log.delete("1.0", "end")
        self.log.insert("1.0", d["log"])
        self.log.see("end")
        self.log.config(state="disabled")
        self.footer.config(text=f"auto-refresh every 3s   ·   last checked "
                                f"{datetime.now().strftime('%-I:%M:%S %p')}")

    # ---- actions ----
    def _toggle(self):
        stopping = "Stop" in self.toggle.cget("text")
        self._busy("Stopping…" if stopping else "Starting…")

        def work():
            if stopping:
                run(["launchctl", "bootout", SERVICE])
            else:
                run(["launchctl", "bootstrap", DOMAIN, PLIST])
            self.root.after(700, self._unbusy)

        threading.Thread(target=work, daemon=True).start()

    def _restart(self):
        if not self.restart_btn._on:
            return
        self._busy("Restarting…")

        def work():
            r = run(["launchctl", "kickstart", "-k", SERVICE])
            if r.returncode != 0:
                run(["launchctl", "bootstrap", DOMAIN, PLIST])
            self.root.after(900, self._unbusy)

        threading.Thread(target=work, daemon=True).start()

    def _busy(self, text):
        self.busy = True
        self.toggle.style(text=text, bg=MUTE)
        self.toggle.enabled(False, off_bg=MUTE)
        self.restart_btn.enabled(False)

    def _unbusy(self):
        self.busy = False
        self._refresh_async()

    def _copy_url(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(PUBLIC_URL)
        self.footer.config(text="copied public URL to clipboard ✓")


def main():
    root = tk.Tk()
    App(root)
    root.lift()
    root.mainloop()


if __name__ == "__main__":
    main()
