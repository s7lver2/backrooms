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


class Dashboard:
    def __init__(self, title: str, subtitle: str, procs: list[Proc], urls: list[tuple[str, str]], branch: str = "", tunnels: list[tuple[str, str]] | None = None):
        self.tunnels = tunnels or []  # (name, command) of the installed tunnel tools; key t starts/stops the `tunnel` process
        self.title, self.subtitle, self.procs, self.urls, self.branch = title, subtitle, procs, urls, branch
        self.logs: collections.deque = collections.deque(maxlen=6000)  # (proc, text, level)
        self.lock = threading.Lock()
        self.tab = 0  # 0 = all, 1.. = a process
        self.scroll = 0  # lines above the bottom; 0 = following
        self.wrap = False
        self.tunnel_url, self.vercel_url = "", ""
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
            self.logs.append((p, text, level))
        if p.tag == "tunnel" and (m := URL.search(text)):
            self.tunnel_url = m.group(0)
            self.say(f"tunnel ready · {self.tunnel_url}")
        if p.tag == "vercel" and (m := VURL.search(text)) and not self.vercel_url:
            self.vercel_url = m.group(0)

    def say(self, msg: str) -> None:
        self.flash, self.flash_at = msg, time.time()

    def visible(self, w: int, tagw: int) -> list[tuple]:
        sel = self.procs[self.tab - 1] if self.tab else None
        with self.lock:
            rows = [x for x in self.logs if sel is None or x[0] is sel]
        out = []
        for p, text, level in rows:
            width = max(w - tagw - 3, 10)
            chunks = [text[i: i + width] for i in range(0, max(len(text), 1), width)] if self.wrap else [fit(text, width)]
            for i, c in enumerate(chunks):
                out.append((p, c, level, i == 0))
        return out

    # ---------------------------------------------------------------- render ----
    def nav(self) -> list[tuple[str, str, int]]:
        items = [("1", "all", 0)]
        for i, p in enumerate(self.procs, 1):
            items.append((p.tag[0] if p.tag == "vercel" else str(i + 1), p.tag, i))
        return items

    def sea(self, cv: Cv, y0: int, rows: int, t: float) -> None:
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
                    cv.put(c, y0 + r, "~", mix(cv.c[y0 + r][c][2], FG["wake"], 0.12 + 0.2 * fade * (v - 1.5)))
        layers = [(".", 0.35, 0.10, 0.20), (".", 0.8, 0.22, 0.36), ("•", 1.6, 0.45, 0.55)]
        for i in range(w * rows // 26):
            g, drift, sink, ink = layers[i % 3]
            x = (hash01(i, 1, 41) * w - t * drift) % w
            y = (hash01(i, 2, 43) * rows + t * sink + 0.4 * math.sin(t * 0.7 + i)) % rows
            cv.put(int(x), y0 + int(y), g, mix(cv.c[y0 + int(y)][int(x)][2], FG["wake"], ink))

    def frame(self, w: int, h: int, f: int) -> str:
        cv = Cv(w, h)
        t = f * 0.1
        up = int(time.time() - self.t0)
        # header: the name with a glow sweeping over it, the nav on the right
        x = 2
        sweep = (t * 9) % (len(self.title) + 40) - 3
        for i, ch in enumerate(self.title):
            d = abs(i - sweep)
            col = mix(FG["ink"], FG["accent"], 1 - d / 1.5) if d < 1.5 else FG["ink"]
            cv.put(x, 0, ch, col, None, True)
            x += 1
        cv.text(x + 1, 0, self.subtitle, FG["mute"])
        items = self.nav()
        tab_of = {"vercel": len(self.procs)}
        nx = w - 2
        spans = []
        for key, name, idx in reversed(items):
            label = f"{key} {name}"
            nx -= len(label)
            spans.append((nx, key, name, idx))
            nx -= 2
        for sx, key, name, idx in spans:
            active = idx == self.tab
            cv.put(sx, 0, key, FG["accent"] if active else FG["dim"])
            cv.text(sx + 2, 0, name, FG["ink"] if active else FG["mute"], None, active)
        cv.hline(1)
        # sea (only when the terminal is tall enough)
        y = 2
        dock_h = len(self.procs)
        sea_h = 4 if h >= 26 else 0
        if sea_h:
            self.sea(cv, y, sea_h, t)
            y += sea_h
            cv.hline(y)
            y += 1
        # log pane
        tagw = max(len(p.tag) for p in self.procs)
        room = max(h - y - dock_h - 2, 1)
        rows = self.visible(w, tagw)
        self.scroll = max(0, min(self.scroll, max(len(rows) - room, 0)))
        end = len(rows) - self.scroll
        for i, (p, text, level, first) in enumerate(rows[max(end - room, 0): end]):
            if first:
                cv.text(1, y + i, p.tag.ljust(tagw), FG[p.color], None, True)
            cv.text(tagw + 2, y + i, text, FG[{"err": "err", "warn": "warn", "sys": "mute"}.get(level, "dim")])
        y += room
        # dock: one row per process behind a coloured rail
        cv.hline(y)
        y += 1
        for p in self.procs:
            if p.p is None:
                dot, dc, state = "○", "mute", "off"
            elif p.alive:
                dot, dc, state = "●", "ok", f"running {int(time.time() - p.started)}s" if not p.oneshot else "working"
            elif p.code is None:
                dot, dc, state = SPINNER[f % len(SPINNER)], "run", "starting"
            elif p.oneshot:
                dot, dc, state = ("✓", "ok", "done") if p.code == 0 else ("✗", "err", f"failed {p.code}")
            else:
                dot, dc, state = "✗", "err", f"exited {p.code}"
            if p.alive and p.oneshot:
                dot = SPINNER[f % len(SPINNER)]
            url = dict(self.urls).get(p.tag, "") or (self.tunnel_url if p.tag == "tunnel" else self.vercel_url if p.tag == "vercel" else "")
            cv.put(1, y, "▌", FG[p.color])
            cv.put(3, y, dot, FG[dc])
            cv.text(5, y, p.tag, FG["ink"])
            cv.text(5 + tagw + 2, y, state, FG["mute"])
            cv.text(5 + tagw + 20, y, url, FG["accent"])
            y += 1
        # status bar: section chip, key hints, notice on the right
        name = "logs" if self.tab == 0 else self.procs[self.tab - 1].tag
        sy = h - 1
        for c in range(w):
            cv.put(c, sy, " ", None, FAINT if c < len(name) + 2 else BG)
        cv.text(0, sy, f" {name} ", FG["ink"], FAINT)
        right = f"{self.branch}  up {up // 60}m{up % 60:02d}s".strip()
        if self.flash and time.time() - self.flash_at < 5:
            right = self.flash
        dead = [p for p in self.procs if p.p is not None and p.code not in (None, 0) and not p.alive and not p.oneshot]
        if dead:
            right = f"{dead[0].tag} exited ({dead[0].code})"
        rc = "err" if dead else "mute"
        hints = self.hints()
        lim = w - len(right) - 4
        hx = len(name) + 4
        for k, label in hints:
            n = len(k) + 1 + len(label)
            if hx + n > lim:
                break
            hx = cv.text(hx, sy, k, FG["dim"])
            hx = cv.text(hx + 1, sy, label, FG["mute"]) + 2
        cv.right(w - 1, sy, right, FG[rc])
        scr = f"↑ {self.scroll}" if self.scroll else ""
        if scr:
            cv.right(w - 3 - len(right), sy, scr, FG["warn"])
        return cv.render()

    def hints(self) -> list[tuple[str, str]]:
        if self.tab and self.procs[self.tab - 1].tag == "vercel":
            return [("l", "list"), ("d", "deploy"), ("P", "prod"), ("i", "inspect"), ("b", "rollback"), ("tab", "next"), ("q", "quit")]
        return [("↑↓", "scroll"), ("f", "follow"), ("t", "tunnel"), ("v", "vercel"), ("r", "restart"), ("o", "open"), ("c", "clear"), ("q", "quit")]

    # ----------------------------------------------------------------- input ----
    def key_thread(self) -> None:
        if os.name == "nt":
            import msvcrt
            while not self.quit:
                ch = msvcrt.getwch()
                if ch in ("\x00", "\xe0"):
                    ch = {"H": "up", "P": "down", "I": "pgup", "Q": "pgdn", "G": "home", "O": "end"}.get(msvcrt.getwch(), "")
                elif ch == "\x03":
                    ch = "q"
                self.keys.put(ch)
        else:
            while not self.quit:
                ch = sys.stdin.read(1)
                if ch == "\x1b":
                    seq = sys.stdin.read(2)
                    ch = {"[A": "up", "[B": "down", "[5": "pgup", "[6": "pgdn"}.get(seq, "")
                    if seq in ("[5", "[6"):
                        sys.stdin.read(1)
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

    def handle(self, k: str, h: int) -> None:
        page = max(h - 8, 3)
        n = len(self.procs)
        vtab = self.tab and self.procs[self.tab - 1].tag == "vercel"
        if vtab and k in ("l", "d", "P", "i", "b"):
            if k == "l":
                self.vercel_url = ""
                self.vercel("ls", "list")
            elif k == "d":
                self.vercel("deploy --yes", "deploy a preview")
            elif k == "P":
                self.vercel("deploy --prod --yes", "deploy to PRODUCTION", "P")
            elif k == "i":
                self.vercel(f"inspect {self.vercel_url}" if self.vercel_url else "ls", "inspect")
            else:
                self.vercel("rollback", "roll production back", "b")
            return
        if k in ("q", "Q"):
            self.quit = True
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
