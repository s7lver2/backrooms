"""Backrooms launcher: dev / release servers, production build, typecheck, optional public tunnel.

Styled after the phycode TUI (braille spinner at 100 ms, half-block wordmark, teal accent, elapsed timers).
Run with no arguments for the interactive menu, or pass flags to skip the questions:

  python tools/build.py                          interactive
  python tools/build.py dev|release              start servers (client :5180, server :5181)
  python tools/build.py --build                  production client build (client/dist)
  python tools/build.py --check                  typecheck client and server
  --renderer three|phoenyx                       graphics engine (default: phoenyx)
  --phoenyx-dir PATH                             Phoenyx repo (default: E:/phoenix)
  --tunnel cloudflared|ngrok|localtunnel         expose the client publicly
  --plain                                        stream raw logs instead of the control panel
  --yes                                          never ask, use defaults for anything not given
"""
import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT_PORT, SERVER_PORT = 5180, 5181  # same as shared/src/index.ts
TUNNELS = {  # name -> (executable, command line for a tunnel to the client port)
    "cloudflared": ("cloudflared", f"cloudflared tunnel --url http://localhost:{CLIENT_PORT}"),
    "ngrok": ("ngrok", f"ngrok http {CLIENT_PORT}"),
    "localtunnel": ("npx", f"npx --yes localtunnel --port {CLIENT_PORT}"),
}

# ---------------------------------------------------------------- look (phycode palette) ----
TTY = sys.stdout.isatty() and "NO_COLOR" not in os.environ
if os.name == "nt":
    os.system("")  # enables ANSI escapes in the Windows console
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


def _rgb(hex_: str) -> str:
    return f"\x1b[38;2;{int(hex_[1:3], 16)};{int(hex_[3:5], 16)};{int(hex_[5:7], 16)}m"


COL = {"faint": "#4a4a52", "accent": "#58d6b8", "text": "#d9dee7", "dim": "#6b7588", "ok": "#7bd88f", "warn": "#f2c36b", "err": "#ff6b81", "run": "#6cb6ff"}


def paint(name: str, s: str, bold: bool = False) -> str:
    return f"{'\x1b[1m' if bold else ''}{_rgb(COL[name])}{s}\x1b[0m" if TTY else s


def rainbow(text: str, bold: bool = False, shift: float = 0.0) -> str:
    """Per-character rainbow (truecolor); plain text without a terminal."""
    if not TTY:
        return text
    import colorsys
    out = []
    for i, ch in enumerate(text):
        r, g, b = (int(c * 255) for c in colorsys.hsv_to_rgb((shift + i / max(len(text), 1)) % 1.0, 0.55, 1.0))
        out.append(f"{'\x1b[1m' if bold else ''}\x1b[38;2;{r};{g};{b}m{ch}")
    return "".join(out) + "\x1b[0m"


SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"  # same frames as phycode's status bar
TICK = 0.1  # seconds per frame

GLYPHS = {  # 3-row half-block letters, like phycode's wordmark
    "B": ("█▀▄", "█▀▄", "▀▀ "), "A": ("█▀█", "█▀█", "▀ ▀"), "C": ("█▀▀", "█  ", "▀▀▀"),
    "K": ("█ █", "█▀▄", "▀ ▀"), "R": ("█▀█", "█▀▄", "▀ ▀"), "O": ("█▀█", "█ █", "▀▀▀"),
    "M": ("█▄█▄█", "█ ▀ █", "▀   ▀"), "S": ("█▀▀", "▀▀█", "▀▀▀"),
}
WORD, SPLIT = "BACKROOMS", 4  # "BACK" in accent, "ROOMS" in text, like "phy" + "code"


def wordmark() -> list[tuple[str, str]]:
    """Rows as (accent part, text part)."""
    rows = []
    for r in range(3):
        parts = [GLYPHS[ch][r] for ch in WORD]
        rows.append((" ".join(parts[:SPLIT]) + " ", " ".join(parts[SPLIT:])))
    return rows


def splash() -> None:
    mark = wordmark()
    width = len(mark[0][0]) + len(mark[0][1])
    cols = os.get_terminal_size().columns if TTY else 80
    pad = " " * max((cols - width) // 2, 0)
    if not TTY:
        print("\n".join(a + b for a, b in mark))
        return
    sys.stdout.write("\n" * 3)
    for i in range(0, width + 1, 3):  # a sweep from left to right
        sys.stdout.write("\x1b[3A")
        for a, b in mark:
            row = (a + b)[:i]
            shown = paint("accent", row[: len(a)]) + paint("text", row[len(a):])
            sys.stdout.write(f"\r\x1b[2K{pad}{shown}\n")
        sys.stdout.flush()
        time.sleep(0.012)
    print(f"\n{pad}{paint('dim', 'launcher for the backrooms game')}\n")


# ------------------------------------------------------------------------------- input ----
def read_key() -> str:
    """One key press: 'up', 'down', 'enter', 'esc' or the character."""
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):
            return {"H": "up", "P": "down"}.get(msvcrt.getwch(), "")
        return {"\r": "enter", "\x1b": "esc", "\x03": "esc"}.get(ch, ch)
    import termios
    import tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        if ch == "\x1b":
            if sys.stdin.read(1) == "[":
                return {"A": "up", "B": "down"}.get(sys.stdin.read(1), "")
            return "esc"
        return {"\r": "enter", "\n": "enter", "\x03": "esc"}.get(ch, ch)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def poll_key(timeout: float) -> str | None:
    """A key press if one arrives within `timeout` seconds, else None (lets the menu animate while it waits)."""
    if os.name == "nt":
        import msvcrt
        end = time.time() + timeout
        while time.time() < end:
            if msvcrt.kbhit():
                ch = msvcrt.getwch()
                if ch in ("\x00", "\xe0"):
                    return {"H": "up", "P": "down"}.get(msvcrt.getwch(), "")
                return {"\r": "enter", "\x1b": "esc", "\x03": "esc"}.get(ch, ch)
            time.sleep(0.02)
        return None
    import select
    import termios
    import tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        if not select.select([sys.stdin], [], [], timeout)[0]:
            return None
        ch = sys.stdin.read(1)
        if ch == "\x1b":
            if select.select([sys.stdin], [], [], 0.02)[0] and sys.stdin.read(1) == "[":
                return {"A": "up", "B": "down"}.get(sys.stdin.read(1), "")
            return "esc"
        return {"\n": "enter", "\r": "enter", "\x03": "esc"}.get(ch, ch)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def option_label(key: str, label: str, selected: bool) -> str:
    if key == "phoenyx":  # the rainbow drifts on its own
        return rainbow(label, bold=selected, shift=time.time() * 0.35)
    if key == "three":  # half off, with its tag
        return paint("faint", label) + paint("faint", " (deprecated)")
    return paint("accent", label, bold=True) if selected else paint("text", label)


def ask(question: str, options: list[tuple[str, str]], default: int = 0) -> str:
    """Single choice. Arrow keys / j k / numbers on a terminal, a numbered prompt otherwise."""
    if not (TTY and sys.stdin.isatty()):
        print(f"\n{question}")
        for i, (_, label) in enumerate(options, 1):
            print(f"  {i}) {label}{'  [default]' if i - 1 == default else ''}")
        raw = input("> ").strip()
        return options[int(raw) - 1][0] if raw.isdigit() and 1 <= int(raw) <= len(options) else options[default][0]
    sel = default
    print(paint("text", question, bold=True))
    while True:
        for i, (_, label) in enumerate(options):
            mark = paint("accent", "▸ ") if i == sel else "  "
            num = paint("dim", f"{i + 1} ")
            print(f"\x1b[2K{mark}{num}{option_label(options[i][0], label, i == sel)}")
        print(f"\x1b[2K{paint('dim', '↑↓ move · enter select · q quit')}")
        key = poll_key(0.066)  # ~15 fps redraw while waiting
        if key is None:
            sys.stdout.write(f"\x1b[{len(options) + 1}A")
            continue
        if key in ("up", "k"):
            sel = (sel - 1) % len(options)
        elif key in ("down", "j"):
            sel = (sel + 1) % len(options)
        elif key.isdigit() and 1 <= int(key) <= len(options):
            sel = int(key) - 1
            key = "enter"
        elif key in ("esc", "q"):
            print()
            raise SystemExit(130)
        if key == "enter":
            sys.stdout.write(f"\x1b[{len(options) + 1}A")
            for _ in range(len(options) + 1):
                sys.stdout.write("\x1b[2K\n")
            sys.stdout.write(f"\x1b[{len(options) + 1}A")
            chosen = options[sel][1]
            print(f"{paint('ok', '✓')} {paint('dim', question)} {option_label(options[sel][0], chosen, True)}\n")
            return options[sel][0]
        sys.stdout.write(f"\x1b[{len(options) + 1}A")


# ------------------------------------------------------------------------------- steps ----
def fmt(sec: float) -> str:
    return f"{sec:.1f}s" if sec < 60 else f"{int(sec // 60)}m{int(sec % 60):02d}s"


def step(label: str, cmd: str, env: dict | None = None) -> int:
    """Runs a command behind a spinner; on failure prints the tail of its output."""
    t0 = time.time()
    if not TTY:
        print(f"> {label}")
        return subprocess.call(cmd, shell=True, cwd=ROOT, env=env)
    p = subprocess.Popen(cmd, shell=True, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    lines: list[str] = []
    threading.Thread(target=lambda: [lines.append(x.rstrip()) for x in p.stdout], daemon=True).start()  # type: ignore[union-attr]
    f = 0
    while p.poll() is None:
        last = lines[-1][: os.get_terminal_size().columns - len(label) - 16] if lines else ""
        sys.stdout.write(f"\r\x1b[2K{paint('run', SPINNER[f % len(SPINNER)])} {paint('text', label)} {paint('dim', '· ' + fmt(time.time() - t0))} {paint('dim', last)}")
        sys.stdout.flush()
        f += 1
        time.sleep(TICK)
    time.sleep(0.05)
    ok = p.returncode == 0
    sys.stdout.write(f"\r\x1b[2K{paint('ok', '✓') if ok else paint('err', '✗')} {paint('text', label)} {paint('dim', fmt(time.time() - t0))}\n")
    if not ok:
        print(paint("dim", "\n".join(lines[-25:])))
    return p.returncode


PHOENYX_REPO = "https://github.com/s7lver2/phoenyx.git"


def find_phoenyx(explicit: str | None) -> str | None:
    """Phoenyx repo: --phoenyx-dir / PHOENYX_DIR, then E:/ (Windows) or ~ (Linux/macOS); None if not found."""
    roots = [Path(explicit)] if explicit else [Path(os.environ["PHOENYX_DIR"])] if os.environ.get("PHOENYX_DIR") else []
    base = [Path("E:/")] if os.name == "nt" else [Path.home()]
    if not explicit:
        roots += [b / n for b in base + [ROOT.parent] for n in ("phoenyx", "phoenix")]
    for r in roots:
        if (r / "packages" / "phoenyx").is_dir():
            return str(r).replace("\\", "/")
    return None


def ensure_phoenyx(explicit: str | None) -> str | None:
    found = find_phoenyx(explicit)
    if found:
        return found
    target = Path(explicit) if explicit else (Path("E:/") if os.name == "nt" and Path("E:/").exists() else Path.home()) / "phoenyx"
    if step("clone phoenyx", f'git clone --depth 1 {PHOENYX_REPO} "{target}"') == 0:
        return str(target).replace("\\", "/")
    return None


def port_busy(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def available_tunnels() -> list[str]:
    return [k for k, (exe, _) in TUNNELS.items() if shutil.which(exe)]


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backrooms launcher")
    p.add_argument("mode", nargs="?", choices=["dev", "release"])
    p.add_argument("--build", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--release", action="store_true")
    p.add_argument("--renderer", choices=["three", "phoenyx"])
    p.add_argument("--phoenyx-dir")
    p.add_argument("--tunnel", choices=list(TUNNELS))
    p.add_argument("--yes", action="store_true")
    p.add_argument("--plain", action="store_true")
    return p.parse_args()


def serve(procs: list[subprocess.Popen], task: str, engine: str, tunnel: str | None) -> int:
    """The running state: a live status line (● ready · uptime) until Ctrl+C."""
    rows = [("client", f"http://localhost:{CLIENT_PORT}"), ("server", f"http://localhost:{SERVER_PORT}")]
    print(f"{paint('ok', '●')} {paint('text', f'{task} · {engine}', bold=True)}")
    for name, url in rows:
        print(f"  {paint('dim', name.ljust(7))}{paint('accent', url)}")
    if tunnel:
        print(f"  {paint('dim', 'tunnel'.ljust(7))}{paint('text', tunnel)} {paint('dim', '(its public URL is printed below)')}")
    print(f"\n{paint('dim', 'ctrl+c stops everything')}\n")
    try:
        procs[1].wait()
        return 0
    except KeyboardInterrupt:
        print(f"\n{paint('warn', '■')} {paint('dim', 'stopping…')}")
        return 0
    finally:
        for p in procs:
            p.terminate()


def main() -> int:
    a = parse()
    if a.release:
        a.mode = "release"
    interactive = not a.yes and sys.stdin.isatty()
    if interactive:
        splash()
    task = "build" if a.build else "check" if a.check else a.mode
    if not task:
        task = ask("Run", [("dev", "dev"), ("release", "release"), ("build", "build"), ("check", "check")]) if interactive else "dev"

    env = dict(os.environ)
    if task in ("dev", "release", "build"):
        renderer = a.renderer or (ask("Engine", [("phoenyx", "phoenyx"), ("three", "three")]) if interactive else "phoenyx")
        if renderer == "phoenyx":
            pdir = ensure_phoenyx(a.phoenyx_dir)
            if not pdir:
                print(f"{paint('err', '✗')} Phoenyx not found and the clone failed.")
                return 1
            env["RENDERER"], env["PHOENYX_DIR"] = "phoenyx", pdir
        else:
            env.pop("RENDERER", None)

    if not (ROOT / "node_modules").exists() and step("npm install", "npm install"):
        return 1
    if task == "build":
        return step("build client", "npm run build -w client", env)
    if task == "check":
        return step("typecheck client + server", "npm run typecheck", env)

    tunnel = a.tunnel  # no question: the tunnel is toggled from the panel (key t); --tunnel starts one at launch
    if tunnel and not shutil.which(TUNNELS[tunnel][0]):
        print(f"{paint('err', '✗')} `{TUNNELS[tunnel][0]}` is not on PATH, so the {tunnel} tunnel cannot start.")
        return 1

    for port in (CLIENT_PORT, SERVER_PORT):  # an old server on the port: say so instead of dying halfway
        if port_busy(port):
            print(f"{paint('err', '✗')} Port {port} is already in use (another dev/preview still running). Free it with:\n"
                  f'  powershell -c "Stop-Process -Id (Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess -Force"')
            return 1
    release = task == "release"
    if release and step("build client", "npm run build -w client", env):  # release: client build + server on `start`
        return 1
    specs = [("server", f"npm run {'start' if release else 'dev'} -w server"), ("client", f"npm run {'preview' if release else 'dev'} -w client")]
    if TTY and sys.stdin.isatty() and not a.plain:  # the control panel (logs, tabs, restart); --plain streams the raw output instead
        from dash import Dashboard, Proc, TAGCOL
        procs = [Proc(t, c, env, ROOT, TAGCOL[i % len(TAGCOL)]) for i, (t, c) in enumerate(specs)]
        procs.append(Proc("tunnel", TUNNELS[tunnel][1] if tunnel else "", env, ROOT, TAGCOL[2], auto=bool(tunnel)))  # idle until key t
        procs.append(Proc("vercel", "", env, ROOT, TAGCOL[3], auto=False, oneshot=True))  # one-shot `vercel` commands, driven from the panel
        urls = [("client", f"http://localhost:{CLIENT_PORT}"), ("server", f"http://localhost:{SERVER_PORT}")]
        branch = subprocess.run("git rev-parse --abbrev-ref HEAD", shell=True, cwd=ROOT, capture_output=True, text=True).stdout.strip()
        return Dashboard("backrooms", f"{task} · {env.get('RENDERER', 'three')}", procs, urls, branch, [(k, TUNNELS[k][1]) for k in available_tunnels()]).run()
    if tunnel:
        specs.append(("tunnel", TUNNELS[tunnel][1]))
    popens = [subprocess.Popen(c, shell=True, cwd=ROOT, env=env) for _, c in specs]
    return serve(popens, task, env.get("RENDERER", "three"), tunnel)


if __name__ == "__main__":
    sys.exit(main())
