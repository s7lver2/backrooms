"""Full-screen control panel for the Backrooms launcher, styled after phycode.site (its SSH site):
black canvas, header with a glow sweeping over the name, key-letter navigation, faint rules, a small sea with waves and snow,
a dock with the process states and a status bar with key hints. Includes a Vercel tab driven by the `vercel` CLI.
Stdlib only. Used by build.py when stdout is a terminal.
"""
import collections
import math
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import webbrowser

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
URL = re.compile(r"https://[\w.-]*(?:trycloudflare\.com|ngrok[\w.-]*|loca\.lt)\S*")
VURL = re.compile(r"https://[\w.-]+\.vercel\.app\S*")
ERR = re.compile(r"\b(error|err!|failed|fatal|exception|eaddrinuse)\b", re.I)
WARN = re.compile(r"\b(warn|warning|deprecated)\b", re.I)

# phycode.site palette (dark)
BG, FAINT = (0, 0, 0), (44, 44, 49)
FG = {"ink": (237, 237, 237), "dim": (161, 161, 166), "mute": (126, 126, 134), "faint": (44, 44, 49), "accent": (88, 214, 184),
      "ok": (123, 216, 143), "warn": (242, 195, 107), "err": (255, 107, 129), "run": (108, 182, 255), "wake": (110, 232, 255)}
TAGCOL = ["run", "accent", "warn", "ok"]
RESET = "\x1b[0m"


def sgr(fg: str | tuple, bg: tuple | None = None, bold: bool = False) -> str:
    r, g, b = FG[fg] if isinstance(fg, str) else fg
    s = f"\x1b[{'1;' if bold else ''}38;2;{r};{g};{b}m"
    if bg:
        s += f"\x1b[48;2;{bg[0]};{bg[1]};{bg[2]}m"
    return s


def bgc(c: tuple) -> str:
    return f"\x1b[48;2;{c[0]};{c[1]};{c[2]}m"


def mix(a: tuple, b: tuple, t: float) -> tuple:
    t = round(max(0.0, min(1.0, t)) * 8) / 8
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def fit(s: str, w: int) -> str:
    return s if len(s) <= w else s[: max(w - 1, 0)] + "…"


def hash01(x: int, y: int, z: int) -> float:
    h = (x * 0x27D4EB2D ^ y * 0x165667B1 ^ z * 0x9E3779B1) & 0xFFFFFFFF
    h = ((h ^ h >> 15) * 0x2C1B3C6D) & 0xFFFFFFFF
    return (h ^ h >> 12) / 0xFFFFFFFF


class Cv:
    """A row-major canvas of (char, fg, bg, bold) cells, flushed as ANSI."""

    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.c = [[(" ", None, BG, False)] * w for _ in range(h)]

    def put(self, x: int, y: int, ch: str, fg=None, bg=None, bold=False) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y][x] = (ch, fg, bg if bg is not None else self.c[y][x][2], bold)

    def text(self, x: int, y: int, s: str, fg, bg=None, bold=False) -> int:
        for ch in s:
            self.put(x, y, ch, fg, bg, bold)
            x += 1
        return x

    def right(self, x: int, y: int, s: str, fg, bold=False) -> int:
        return self.text(x - len(s), y, s, fg, None, bold)

    def hline(self, y: int, fg=FG["faint"]) -> None:
        for x in range(self.w):
            self.put(x, y, "─", fg)

    def render(self) -> str:
        out = []
        for row in self.c:
            parts, last = [], None
            for ch, fg, bg, bold in row:
                key = (fg, bg, bold)
                if key != last:
                    parts.append(f"{RESET}{bgc(bg)}" + (sgr(fg, None, bold) if fg else ""))
                    last = key
                parts.append(ch)
            out.append("".join(parts) + RESET)
        return "\x1b[H" + "\r\n".join(out)


class Proc:
    def __init__(self, tag: str, cmd: str, env: dict, cwd, color: str, auto: bool = True, oneshot: bool = False):
        self.tag, self.cmd, self.env, self.cwd, self.color, self.auto, self.oneshot = tag, cmd, env, cwd, color, auto, oneshot
        self.p: subprocess.Popen | None = None
        self.started = 0.0
        self.code: int | None = None

    def start(self, sink) -> None:
        self.code = None
        self.started = time.time()
        self.p = subprocess.Popen(self.cmd, shell=True, cwd=self.cwd, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
        threading.Thread(target=self._pump, args=(self.p, sink), daemon=True).start()

    def _pump(self, p: subprocess.Popen, sink) -> None:
        for line in p.stdout:  # type: ignore[union-attr]
            sink(self, ANSI.sub("", line.rstrip()))
        p.wait()
        self.code = p.returncode
        sink(self, f"exited with code {p.returncode}", True)

    @property
    def alive(self) -> bool:
        return self.p is not None and self.p.poll() is None

    def stop(self) -> None:
        if not self.p or self.p.poll() is not None:
            return
        if os.name == "nt":  # shell=True leaves node children behind: kill the whole tree
            subprocess.call(f"taskkill /T /F /PID {self.p.pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            self.p.terminate()




GLYPHS = {  # the same 3-row half-block letters as build.py's splash
    "B": ("█▀▄", "█▀▄", "▀▀ "), "A": ("█▀█", "█▀█", "▀ ▀"), "C": ("█▀▀", "█  ", "▀▀▀"),
    "K": ("█ █", "█▀▄", "▀ ▀"), "R": ("█▀█", "█▀▄", "▀ ▀"), "O": ("█▀█", "█ █", "▀▀▀"),
    "M": ("█▄█▄█", "█ ▀ █", "▀   ▀"), "S": ("█▀▀", "▀▀█", "▀▀▀"),
}
LOGO = ["  ".join(GLYPHS[c][r] for c in "BACKROOMS") for r in range(3)]
AGE = re.compile(r"^\d+[smhdw]$")


class Dashboard:
    def __init__(self, title: str, subtitle: str, procs: list[Proc], urls: list[tuple[str, str]], branch: str = "", tunnels: list[tuple[str, str]] | None = None):
        self.tunnels = tunnels or []  # (name, command) of the installed tunnel tools; key t starts/stops the `tunnel` process
        self.title, self.subtitle, self.procs, self.urls, self.branch = title, subtitle, procs, urls, branch
        self.logs: collections.deque = collections.deque(maxlen=6000)  # (proc, text, level, time)
        self.lock = threading.Lock()
        self.tab = 0  # 0 = all, 1.. = a process
        self.scroll = 0  # lines above the bottom; 0 = following
        self.wrap = False
        self.frozen: list | None = None  # a snapshot of the logs while the view is frozen
        self.filter, self.typing, self.errors_only = "", False, False
        self.tunnel_url = ""
        self.vrows: list[tuple[str, str, str]] = []  # deployments parsed from `vercel ls`: (age, url, state)
        self.vsel = 0
        self.flash, self.flash_at = "", 0.0
        self.pending: tuple[str, float] | None = None  # a destructive vercel action waiting for its second key press
        self.t0 = time.time()
        self.keys: queue.Queue = queue.Queue()
        self.quit = False

    # ------------------------------------------------------------------ data ----
    def find(self, tag: str) -> Proc | None:
        return next((p for p in self.procs if p.tag == tag), None)

    def sink(self, p: Proc, text: str, system: bool = False) -> None:
        level = "sys" if system else "err" if ERR.search(text) else "warn" if WARN.search(text) else ""
        with self.lock:
            self.logs.append((p, text, level, time.time()))
        if p.tag == "tunnel" and (m := URL.search(text)):
            self.tunnel_url = m.group(0)
            self.say(f"tunnel ready · {self.tunnel_url}")
        if p.tag == "vercel" and (m := VURL.search(text)):
            parts = text.split()
            age = parts[0] if parts and AGE.match(parts[0]) else ""
            state = next((x for x in ("Ready", "Error", "Building", "Queued", "Canceled") if x in text), "")
            if age and all(r[1] != m.group(0) for r in self.vrows):
                self.vrows.append((age, m.group(0), state))

    def say(self, msg: str) -> None:
        self.flash, self.flash_at = msg, time.time()

    def errors(self, p: Proc | None) -> int:
        return sum(1 for x in self.logs if (p is None or x[0] is p) and x[2] == "err")

    def visible(self, w: int, tagw: int, stamp: bool) -> list[tuple]:
        sel = self.procs[self.tab - 1] if self.tab else None
        with self.lock:
            rows = list(self.frozen if self.frozen is not None else self.logs)
        rows = [x for x in rows if (sel is None or x[0] is sel) and (not self.errors_only or x[2] == "err") and (not self.filter or self.filter.lower() in x[1].lower())]
        out = []
        width = max(w - tagw - 5 - (9 if stamp else 0), 10)
        for p, text, level, ts in rows:
            chunks = [text[i: i + width] for i in range(0, max(len(text), 1), width)] if self.wrap else [fit(text, width)]
            for i, c in enumerate(chunks):
                out.append((p, c, level, ts if i == 0 else None))
        return out

    # ---------------------------------------------------------------- render ----
    def nav(self) -> list[tuple[str, str, int]]:
        items = [("1", "all", 0)]
        for i, p in enumerate(self.procs, 1):
            items.append(("v" if p.tag == "vercel" else str(i + 1), p.tag, i))
        return items

    def hero(self, cv: Cv, y0: int, rows: int, t: float) -> None:
        """The sea of phycode.site (waves, snow) with the wordmark floating over it and the glow passing through."""
        w = cv.w
        top, deep = (4, 7, 10), (7, 19, 24)
        for r in range(rows):
            bgr = mix(top, deep, math.floor(r / max(rows - 1, 1) * 5) / 5)
            for c in range(w):
                cv.put(c, y0 + r, " ", None, bgr)
        for r in range(min(rows, 3)):
            fade = 1 - r / 3
            for c in range(w):
                v = math.sin(c * 0.21 + t * 0.9) + math.sin(c * 0.13 - t * 0.6 + r * 1.7) + math.sin((c + r * 3) * 0.07 + t * 0.4)
                if v >= 1.8:
                    cv.put(c, y0 + r + rows - 3, "~", mix(cv.c[y0 + r + rows - 3][c][2], FG["wake"], 0.12 + 0.2 * fade * (v - 1.5)))
        layers = [(".", 0.35, 0.10, 0.20), (".", 0.8, 0.22, 0.36), ("•", 1.6, 0.45, 0.55)]
        for i in range(w * rows // 22):
            g, drift, sink, ink = layers[i % 3]
            x = (hash01(i, 1, 41) * w - t * drift) % w
            y = (hash01(i, 2, 43) * rows + t * sink + 0.4 * math.sin(t * 0.7 + i)) % rows
            cv.put(int(x), y0 + int(y), g, mix(cv.c[y0 + int(y)][int(x)][2], FG["wake"], ink))
        lw = len(LOGO[0])
        if w >= lw + 6 and rows >= 5:
            x0, sweep = (w - lw) // 2, (t * 14) % (lw + 30) - 6
            for r, row in enumerate(LOGO):
                for i, ch in enumerate(row):
                    if ch == " ":
                        continue
                    d = abs(i - sweep)
                    col = mix(FG["ink"], FG["accent"], 1 - d / 5) if d < 5 else mix(FG["ink"], FG["dim"], 0.35 + 0.1 * r)
                    cv.put(x0 + i, y0 + 1 + r, ch, col, None, True)

    def chip(self, cv: Cv, x: int, y: int, text: str, fg: str, bg: tuple) -> int:
        return cv.text(x, y, f" {text} ", FG[fg], bg, True)

    def frame(self, w: int, h: int, f: int) -> str:
        cv = Cv(w, h)
        t = f / 15
        up = int(time.time() - self.t0)
        # header: name with the glow, subtitle, nav with error badges
        x = 2
        sweep = (t * 9) % (len(self.title) + 40) - 3
        for i, ch in enumerate(self.title):
            d = abs(i - sweep)
            cv.put(x, 0, ch, mix(FG["ink"], FG["accent"], 1 - d / 1.5) if d < 1.5 else FG["ink"], None, True)
            x += 1
        cv.text(x + 1, 0, self.subtitle, FG["mute"])
        nx, spans = w - 2, []
        for key, name, idx in reversed(self.nav()):
            e = self.errors(self.procs[idx - 1] if idx else None)
            label = f"{key} {name}" + (f" {e}" if e else "")
            nx -= len(label)
            spans.append((nx, key, name, idx, e))
            nx -= 3
        for sx, key, name, idx, e in spans:
            active = idx == self.tab
            cv.put(sx, 0, key, FG["accent"] if active else FG["dim"])
            ex = cv.text(sx + 2, 0, name, FG["ink"] if active else FG["mute"], None, active)
            if e:
                cv.text(ex + 1, 0, str(e), FG["err"], None, True)
        cv.hline(1)
        y = 2
        hero_h = 6 if h >= 30 and w >= 50 else 0
        if hero_h:
            self.hero(cv, y, hero_h, t)
            y += hero_h
            cv.hline(y)
            y += 1
        vtab = bool(self.tab and self.procs[self.tab - 1].tag == "vercel")
        # bottom blocks first so the pane knows its room: 2 service rows + rule + status
        pane_end = h - 5
        if vtab:
            y = self.draw_vercel(cv, y, pane_end, w)
        else:
            self.draw_logs(cv, y, pane_end, w)
        cv.hline(pane_end)
        self.draw_services(cv, pane_end + 1, w, f)
        self.draw_status(cv, h - 1, w, up)
        return cv.render()

    def draw_logs(self, cv: Cv, y: int, end: int, w: int) -> None:
        tagw = max(len(p.tag) for p in self.procs)
        stamp = w >= 80
        room = max(end - y, 1)
        rows = self.visible(w, tagw, stamp)
        self.scroll = max(0, min(self.scroll, max(len(rows) - room, 0)))
        stop = len(rows) - self.scroll
        shown = rows[max(stop - room, 0): stop]
        if not shown:
            msg = "no lines match the filter" if (self.filter or self.errors_only) else "waiting for output…"
            cv.text((w - len(msg)) // 2, y + room // 2, msg, FG["mute"])
        for i, (p, text, level, ts) in enumerate(shown):
            cx = 1
            if stamp and ts:
                cx = cv.text(cx, y + i, time.strftime("%H:%M:%S", time.localtime(ts)), (84, 84, 92)) + 1
            elif stamp:
                cx += 9
            if ts is not None:
                cx = self.chip(cv, cx - 1, y + i, p.tag.ljust(tagw), "ink", mix(BG, FG[p.color], 0.22)) + 1
                cv.put(cx - 1, y + i, " ")
            else:
                cx += tagw + 2
            glyph = {"err": ("✗", "err"), "warn": ("!", "warn")}.get(level)
            if glyph and ts is not None:
                cv.put(cx, y + i, glyph[0], FG[glyph[1]], None, True)
            cx += 2
            col = FG[{"err": "err", "warn": "warn", "sys": "mute"}.get(level, "dim")]
            for m in re.finditer(r"https?://\S+|[^\s]+|\s+", text):  # URLs stand out
                seg = m.group(0)
                cv.text(cx, y + i, seg, FG["accent"] if seg.startswith("http") else col)
                cx += len(seg)
        # scrollbar: a faint track on the right edge with a thumb
        if len(rows) > room:
            th = max(1, room * room // len(rows))
            top = (room - th) * (len(rows) - self.scroll - room) // max(len(rows) - room, 1)
            for i in range(room):
                cv.put(w - 1, y + i, "┃" if top <= i < top + th else "│", FG["accent"] if top <= i < top + th else FG["faint"])

    def draw_vercel(self, cv: Cv, y: int, end: int, w: int) -> int:
        """Deployments as a selectable table on top, the output of the last vercel command below."""
        room = end - y
        table = min(max(len(self.vrows), 1) + 1, max(room // 2, 3))
        cv.text(2, y, "deployments", FG["ink"], None, True)
        cv.text(15, y, f"{len(self.vrows)} · j k select · enter inspect · o open", FG["mute"])
        self.vsel = max(0, min(self.vsel, max(len(self.vrows) - 1, 0)))
        for i, (age, url, state) in enumerate(self.vrows[: table - 1]):
            on = i == self.vsel
            bgr = FAINT if on else BG
            for c in range(w):
                cv.put(c, y + 1 + i, " ", None, bgr)
            cv.text(1, y + 1 + i, "▸" if on else " ", FG["accent"], bgr, True)
            cv.text(3, y + 1 + i, age.ljust(5), FG["mute"], bgr)
            col = {"Ready": "ok", "Error": "err", "Canceled": "mute"}.get(state, "run")
            cv.text(9, y + 1 + i, ("● " + state).ljust(11) if state else "  ", FG[col], bgr)
            cv.text(22, y + 1 + i, url, FG["ink"] if on else FG["dim"], bgr, on)
        if not self.vrows:
            cv.text(2, y + 1, "press l to list the deployments", FG["mute"])
        y += table
        cv.hline(y)
        y += 1
        with self.lock:
            lines = [x for x in self.logs if x[0].tag == "vercel"][-(end - y):]
        for i, (_, text, level, _ts) in enumerate(lines):
            cv.text(2, y + i, fit(text, w - 4), FG[{"err": "err", "warn": "warn", "sys": "mute"}.get(level, "dim")])
        return end

    def draw_services(self, cv: Cv, y: int, w: int, f: int) -> None:
        x = 1
        for p in self.procs:
            if p.p is None:
                dot, dc, state = "○", "mute", "off"
            elif p.alive and p.oneshot:
                dot, dc, state = SPINNER[f % len(SPINNER)], "run", "working"
            elif p.alive:
                dot, dc = "●", "ok"
                s = int(time.time() - p.started)
                state = f"{s}s" if s < 60 else f"{s // 60}m{s % 60:02d}s"
            elif p.code is None:
                dot, dc, state = SPINNER[f % len(SPINNER)], "run", "starting"
            elif p.oneshot:
                dot, dc, state = ("✓", "ok", "done") if p.code == 0 else ("✗", "err", f"failed {p.code}")
            else:
                dot, dc, state = "✗", "err", f"exited {p.code}"
            cv.put(x, y, "▌", FG[p.color])
            cv.put(x + 2, y, dot, FG[dc], None, True)
            nx = cv.text(x + 4, y, p.tag, FG["ink"] if p.p is not None else FG["mute"], None, True)
            x = cv.text(nx + 1, y, state, FG["mute"]) + 3
        links = [(k, v) for k, v in self.urls if self.find(k) and self.find(k).alive]  # type: ignore[union-attr]
        if self.tunnel_url:
            links.append(("tunnel", self.tunnel_url))
        x = 1
        for k, v in links:
            x = cv.text(x, y + 1, f"↗ {k} ", FG["mute"])
            x = cv.text(x, y + 1, v, FG["accent"]) + 3
        if not links:
            cv.text(1, y + 1, "no services running", FG["faint"])

    def draw_status(self, cv: Cv, y: int, w: int, up: int) -> None:
        name = "logs" if self.tab == 0 else self.procs[self.tab - 1].tag
        for c in range(w):
            cv.put(c, y, " ", None, BG)
        if self.typing:
            cv.text(0, y, " / ", FG["ink"], mix(BG, FG["accent"], 0.4), True)
            x = cv.text(4, y, self.filter, FG["ink"])
            cv.put(x, y, "▏", FG["accent"])
            cv.right(w - 1, y, "enter keep · esc clear", FG["mute"])
            return
        cx = cv.text(0, y, f" {name} ", FG["ink"], FAINT, True)
        right = f"{self.branch}  up {up // 60}m{up % 60:02d}s".strip()
        rc = "mute"
        if self.flash and time.time() - self.flash_at < 5:
            right = self.flash
        dead = [p for p in self.procs if p.p is not None and p.code not in (None, 0) and not p.alive and not p.oneshot]
        if dead:
            right, rc = f"{dead[0].tag} exited ({dead[0].code})", "err"
        marks = [m for m, on in (("frozen", self.frozen is not None), ("errors", self.errors_only), (f"/{self.filter}", bool(self.filter))) if on]
        if self.scroll:
            marks.append(f"↑{self.scroll}")
        mx = cx + 1
        for m in marks:
            mx = cv.text(mx, y, f" {m} ", FG["warn"], mix(BG, FG["warn"], 0.2)) + 1
        hx, lim = mx + 1, w - len(right) - 4
        for k, label in self.hints():
            n = len(k) + 1 + len(label)
            if hx + n > lim:
                break
            hx = cv.text(hx, y, k, FG["ink"], None, True)
            hx = cv.text(hx + 1, y, label, FG["mute"]) + 2
        cv.right(w - 1, y, right, FG[rc])

    def hints(self) -> list[tuple[str, str]]:
        if self.tab and self.procs[self.tab - 1].tag == "vercel":
            return [("jk", "select"), ("enter", "inspect"), ("l", "list"), ("d", "deploy"), ("P", "prod"), ("b", "rollback"), ("o", "open"), ("tab", "next"), ("q", "quit")]
        return [("/", "filter"), ("e", "errors"), ("space", "freeze"), ("t", "tunnel"), ("v", "vercel"), ("r", "restart"), ("o", "open"), ("c", "clear"), ("q", "quit")]

    # ----------------------------------------------------------------- input ----
    def key_thread(self) -> None:
        if os.name == "nt":
            import msvcrt
            while not self.quit:
                ch = msvcrt.getwch()
                if ch in ("\x00", "\xe0"):
                    ch = {"H": "up", "P": "down", "I": "pgup", "Q": "pgdn", "G": "home", "O": "end"}.get(msvcrt.getwch(), "")
                elif ch == "\x03":
                    ch = "q" if not self.typing else "esc"
                elif ch == "\r":
                    ch = "enter"
                elif ch == "\x1b":
                    ch = "esc"
                elif ch == "\x08":
                    ch = "backspace"
                self.keys.put(ch)
        else:
            while not self.quit:
                ch = sys.stdin.read(1)
                if ch == "\x1b":
                    seq = sys.stdin.read(2)
                    ch = {"[A": "up", "[B": "down", "[5": "pgup", "[6": "pgdn"}.get(seq, "esc" if not seq.startswith("[") else "")
                    if seq in ("[5", "[6"):
                        sys.stdin.read(1)
                elif ch in ("\n", "\r"):
                    ch = "enter"
                elif ch in ("\x7f", "\x08"):
                    ch = "backspace"
                self.keys.put(ch)

    def vercel(self, args: str, label: str, confirm: str | None = None) -> None:
        vp = self.find("vercel")
        if vp is None:
            return
        if not shutil.which("vercel"):
            self.say("vercel CLI not found (npm i -g vercel, then vercel login)")
            return
        if vp.alive:
            self.say("vercel is busy")
            return
        if confirm:
            if not self.pending or self.pending[0] != confirm or time.time() - self.pending[1] > 5:
                self.pending = (confirm, time.time())
                self.say(f"press {confirm} again to {label}")
                return
            self.pending = None
        vp.cmd = f"vercel {args}"
        vp.start(self.sink)
        self.say(f"vercel {label}…")

    def selected_url(self) -> str:
        return self.vrows[self.vsel][1] if self.vrows else ""

    def handle(self, k: str, h: int) -> None:
        if self.typing:
            if k == "enter":
                self.typing = False
            elif k == "esc":
                self.typing, self.filter = False, ""
            elif k == "backspace":
                self.filter = self.filter[:-1]
            elif len(k) == 1 and k.isprintable():
                self.filter += k
            self.scroll = 0
            return
        page = max(h - 12, 3)
        n = len(self.procs)
        vtab = bool(self.tab and self.procs[self.tab - 1].tag == "vercel")
        if vtab:
            if k in ("j", "down"):
                self.vsel += 1
                return
            if k in ("k", "up"):
                self.vsel = max(self.vsel - 1, 0)
                return
            if k == "l":
                self.vrows, self.vsel = [], 0
                self.vercel("ls", "list")
                return
            if k == "d":
                return self.vercel("deploy --yes", "deploy a preview")
            if k == "P":
                return self.vercel("deploy --prod --yes", "deploy to PRODUCTION", "P")
            if k == "b":
                return self.vercel("rollback", "roll production back", "b")
            if k in ("enter", "i"):
                return self.vercel(f"inspect {self.selected_url()}" if self.vrows else "ls", "inspect")
            if k in ("o", "O") and self.vrows:
                webbrowser.open(self.selected_url())
                return self.say("opened " + self.selected_url())
        if k in ("q", "Q"):
            self.quit = True
        elif k == "/":
            self.typing = True
        elif k in ("e", "E"):
            self.errors_only, self.scroll = not self.errors_only, 0
        elif k == " ":
            with self.lock:
                self.frozen = None if self.frozen is not None else list(self.logs)
        elif k == "up":
            self.scroll += 1
        elif k == "down":
            self.scroll = max(self.scroll - 1, 0)
        elif k == "pgup":
            self.scroll += page
        elif k == "pgdn":
            self.scroll = max(self.scroll - page, 0)
        elif k in ("f", "F", "end"):
            self.scroll = 0
        elif k == "home":
            self.scroll = 10 ** 6
        elif k in ("w", "W"):
            self.wrap = not self.wrap
        elif k in ("c", "C"):
            with self.lock:
                self.logs.clear()
                self.frozen = None if self.frozen is None else []
            self.scroll = 0
        elif k in ("v", "V"):
            self.tab, self.scroll = n, 0  # the vercel tab is always the last process
            vp = self.find("vercel")
            if vp and vp.p is None:
                self.vercel("ls", "list")
        elif k in ("t", "T"):
            tp = self.find("tunnel")
            if tp is None:
                return
            if tp.alive:
                tp.stop()
                self.tunnel_url = ""
                self.say("tunnel stopped")
            elif not self.tunnels:
                self.say("no tunnel tool found (install cloudflared or ngrok)")
            else:
                tp.cmd = self.tunnels[0][1]
                tp.start(self.sink)
                self.say(f"starting {self.tunnels[0][0]} tunnel…")
        elif k in ("o", "O"):
            webbrowser.open(self.tunnel_url or self.urls[0][1])
            self.say("opened " + (self.tunnel_url or self.urls[0][1]))
        elif k in ("r", "R"):
            self.say("restarting…")
            live = [p for p in self.procs if p.alive and not p.oneshot]
            for p in live:
                p.stop()
            time.sleep(0.4)
            for p in live:
                p.start(self.sink)
        elif k.isdigit() and 1 <= int(k) <= n + 1:
            self.tab, self.scroll = int(k) - 1, 0
        elif k == "\t":
            self.tab, self.scroll = (self.tab + 1) % (n + 1), 0

    # ------------------------------------------------------------------- run ----
    def run(self) -> int:
        old = None
        if os.name != "nt":
            import termios
            import tty
            old = termios.tcgetattr(sys.stdin.fileno())
            tty.setcbreak(sys.stdin.fileno())
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J")  # alternate screen, hidden cursor
        for p in self.procs:
            if p.auto:
                p.start(self.sink)
        threading.Thread(target=self.key_thread, daemon=True).start()
        f = 0
        try:
            while not self.quit:
                sz = os.get_terminal_size()
                while not self.keys.empty():
                    self.handle(self.keys.get(), sz.lines)
                sys.stdout.write(self.frame(sz.columns, sz.lines, f))
                sys.stdout.flush()
                f += 1
                time.sleep(1 / 15)  # 15 fps, like the site
        except KeyboardInterrupt:
            pass
        finally:
            self.quit = True
            for p in self.procs:
                p.stop()
            sys.stdout.write("\x1b[?25h\x1b[?1049l")
            sys.stdout.flush()
            if old is not None:
                import termios
                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old)
        return 0
