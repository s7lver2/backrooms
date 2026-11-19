"""Full-screen control panel for the Backrooms launcher, laid out like the phycode TUI:
header band, tabbed log pane (scrollable), dock with the process states, status bar with spinner and key hints.
Stdlib only. Used by build.py when stdout is a terminal.
"""
import collections
import os
import queue
import re
import subprocess
import sys
import threading
import time
import webbrowser

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
URL = re.compile(r"https://[\w.-]*(?:trycloudflare\.com|ngrok[\w.-]*|loca\.lt)\S*")
ERR = re.compile(r"\b(error|err!|failed|fatal|exception|eaddrinuse)\b", re.I)
WARN = re.compile(r"\b(warn|warning|deprecated)\b", re.I)

BG, RAISED, SELECT = (14, 18, 24), (24, 30, 40), (34, 42, 56)  # phycode surfaces
FG = {"accent": (88, 214, 184), "text": (217, 222, 231), "dim": (107, 117, 136), "ok": (123, 216, 143),
      "warn": (242, 195, 107), "err": (255, 107, 129), "run": (108, 182, 255)}
TAGCOL = ["run", "accent", "warn", "ok"]


def sgr(fg: str, bg: tuple | None = None, bold: bool = False) -> str:
    r, g, b = FG[fg]
    s = f"\x1b[{'1;' if bold else ''}38;2;{r};{g};{b}m"
    if bg:
        s += f"\x1b[48;2;{bg[0]};{bg[1]};{bg[2]}m"
    return s


def bgc(c: tuple) -> str:
    return f"\x1b[48;2;{c[0]};{c[1]};{c[2]}m"


RESET = "\x1b[0m"


def fit(s: str, w: int) -> str:
    return s if len(s) <= w else s[: max(w - 1, 0)] + "…"


class Proc:
    def __init__(self, tag: str, cmd: str, env: dict, cwd, color: str):
        self.tag, self.cmd, self.env, self.cwd, self.color = tag, cmd, env, cwd, color
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
    def __init__(self, title: str, subtitle: str, procs: list[Proc], urls: list[tuple[str, str]], branch: str = ""):
        self.title, self.subtitle, self.procs, self.urls, self.branch = title, subtitle, procs, urls, branch
        self.logs: collections.deque = collections.deque(maxlen=6000)  # (proc, text, level)
        self.lock = threading.Lock()
        self.tab = 0  # 0 = all, 1.. = a process
        self.scroll = 0  # lines above the bottom; 0 = following
        self.wrap = False
        self.tunnel_url = ""
        self.flash, self.flash_at = "", 0.0
        self.t0 = time.time()
        self.keys: queue.Queue = queue.Queue()
        self.quit = False

    # ------------------------------------------------------------------ data ----
    def sink(self, p: Proc, text: str, system: bool = False) -> None:
        level = "sys" if system else "err" if ERR.search(text) else "warn" if WARN.search(text) else ""
        with self.lock:
            self.logs.append((p, text, level))
        m = URL.search(text) if p.tag == "tunnel" else None
        if m:
            self.tunnel_url = m.group(0)
            self.say(f"tunnel ready · {self.tunnel_url}")

    def say(self, msg: str) -> None:
        self.flash, self.flash_at = msg, time.time()

    def visible(self, w: int) -> list[tuple]:
        sel = self.procs[self.tab - 1] if self.tab else None
        with self.lock:
            rows = [x for x in self.logs if sel is None or x[0] is sel]
        out = []
        for p, text, level in rows:
            width = max(w - len(p.tag) - 4, 10)
            chunks = [text[i: i + width] for i in range(0, max(len(text), 1), width)] if self.wrap else [fit(text, width)]
            for i, c in enumerate(chunks):
                out.append((p, c, level, i == 0))
        return out

    # ---------------------------------------------------------------- render ----
    def band(self, plain: str, w: int, fg: str, bg: tuple, bold: bool = False) -> str:
        return f"{sgr(fg, bg, bold)}{fit(plain, w).ljust(w)}{RESET}"

    def frame(self, w: int, h: int, f: int) -> str:
        up = int(time.time() - self.t0)
        lines: list[str] = []
        # header band: ◆ name · mode, right side: branch + uptime
        right = f"{self.branch}  " if self.branch else ""
        right += f"up {up // 60}m{up % 60:02d}s"
        left = f" ◆ {self.title}  {self.subtitle}"
        gap = max(w - len(left) - len(right) - 1, 1)
        hdr = f"{sgr('accent', RAISED, True)} ◆ {sgr('text', RAISED, True)}{self.title}{sgr('dim', RAISED)}  {self.subtitle}{' ' * gap}{right} {RESET}"
        lines.append(hdr)
        # tabs
        counts = [len(self.logs)] + [sum(1 for x in self.logs if x[0] is p) for p in self.procs]
        names = ["all"] + [p.tag for p in self.procs]
        tabs = ""
        for i, n in enumerate(names):
            label = f" {i + 1} {n} {counts[i]} "
            tabs += (f"{sgr('accent', SELECT, True)}{label}{RESET}" if i == self.tab else f"{sgr('dim', BG)}{label}{RESET}") + f"{bgc(BG)} {RESET}"
        pad = w - sum(len(f" {i + 1} {n} {counts[i]} ") + 1 for i, n in enumerate(names))
        lines.append(tabs + f"{bgc(BG)}{' ' * max(pad, 0)}{RESET}")
        # log pane
        dock_h = len(self.procs) + 1
        room = max(h - 2 - dock_h - 1, 1)
        rows = self.visible(w)
        self.scroll = max(0, min(self.scroll, max(len(rows) - room, 0)))
        end = len(rows) - self.scroll
        shown = rows[max(end - room, 0): end]
        for p, text, level, first in shown:
            tag = (sgr(p.color, BG, True) + p.tag.ljust(max(len(x.tag) for x in self.procs)) + " ") if first else " " * (max(len(x.tag) for x in self.procs) + 1)
            col = {"err": "err", "warn": "warn", "sys": "dim"}.get(level, "text")
            line = f"{bgc(BG)} {tag}{sgr(col, BG)}{text}"
            visible_len = 1 + max(len(x.tag) for x in self.procs) + 1 + len(text)
            lines.append(line + f"{bgc(BG)}{' ' * max(w - visible_len, 0)}{RESET}")
        while len(lines) < 2 + room:
            lines.append(f"{bgc(BG)}{' ' * w}{RESET}")
        # dock: one row per process with the ▌ rail
        lines.append(f"{sgr('dim', BG)}{'─' * w}{RESET}")
        for p in self.procs:
            if p.alive:
                dot, dc, state = "●", "ok", f"running {int(time.time() - p.started)}s"
            elif p.code is None:
                dot, dc, state = SPINNER[f % len(SPINNER)], "run", "starting"
            else:
                dot, dc, state = "✗", "err", f"exited {p.code}"
            url = dict(self.urls).get(p.tag, "") or (self.tunnel_url if p.tag == "tunnel" else "")
            row = f"{sgr(p.color, RAISED, True)} ▌ {sgr(dc, RAISED)}{dot} {sgr('text', RAISED)}{p.tag.ljust(8)}{sgr('dim', RAISED)}{state.ljust(16)}{sgr('accent', RAISED)}{url}"
            vis = 3 + 2 + 8 + 16 + len(url) + 0
            lines.append(row + f"{bgc(RAISED)}{' ' * max(w - vis, 0)}{RESET}")
        # status bar
        working = any(p.alive for p in self.procs)
        dead = [p for p in self.procs if p.code is not None and not p.alive]
        if dead:
            lead, lc, msg = "✗", "err", f"{dead[0].tag} exited ({dead[0].code})"
        elif working:
            lead, lc, msg = "●", "ok", "ready"
        else:
            lead, lc, msg = SPINNER[f % len(SPINNER)], "run", "starting"
        if self.flash and time.time() - self.flash_at < 4:
            msg = self.flash
        hints = "1-%d tabs · ↑↓ scroll · f follow · w wrap · r restart · o open · c clear · q quit" % (len(self.procs) + 1)
        scr = f"  ↑ {self.scroll} lines up" if self.scroll else "  ▼ following"
        left = f" {lead} {msg}{scr}"
        hint = fit(hints, max(w - len(left) - 2, 0))
        gap = max(w - len(left) - len(hint) - 1, 1)
        lines.append(f"{sgr(lc, RAISED, True)} {lead} {sgr('text', RAISED)}{msg}{sgr('dim', RAISED)}{scr}{' ' * gap}{hint} {RESET}")
        return "\x1b[H" + "\r\n".join(lines[:h])

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

    def handle(self, k: str, h: int) -> None:
        page = max(h - 8, 3)
        n = len(self.procs)
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
        elif k in ("o", "O"):
            webbrowser.open(self.tunnel_url or self.urls[0][1])
            self.say("opened " + (self.tunnel_url or self.urls[0][1]))
        elif k in ("r", "R"):
            self.say("restarting…")
            for p in self.procs:
                p.stop()
            time.sleep(0.4)
            for p in self.procs:
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
                time.sleep(0.1)
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
