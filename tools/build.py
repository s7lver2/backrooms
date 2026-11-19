"""Backrooms launcher: dev / release servers, production build, typecheck, optional public tunnel.

Styled after the phycode TUI (braille spinner at 100 ms, half-block wordmark, teal accent, elapsed timers).
Run with no arguments for the interactive menu, or pass flags to skip the questions:

  python tools/build.py                          interactive
  python tools/build.py dev|release              start servers (client :5180, server :5181)
  python tools/build.py --build                  production client build (client/dist)
  python tools/build.py --check                  typecheck client and server
  --renderer three|phoenyx                       graphics engine (default: three)
  --phoenyx-dir PATH                             Phoenyx repo (default: E:/phoenix)
  --tunnel cloudflared|ngrok|localtunnel         expose the client publicly
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


COL = {"accent": "#58d6b8", "text": "#d9dee7", "dim": "#6b7588", "ok": "#7bd88f", "warn": "#f2c36b", "err": "#ff6b81", "run": "#6cb6ff"}


def paint(name: str, s: str, bold: bool = False) -> str:
    return f"{'\x1b[1m' if bold else ''}{_rgb(COL[name])}{s}\x1b[0m" if TTY else s


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
            print(f"\x1b[2K{mark}{num}{paint('accent', label, bold=True) if i == sel else paint('text', label)}")
        print(f"\x1b[2K{paint('dim', '↑↓ move · enter select · q quit')}")
        key = read_key()
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
            print(f"{paint('ok', '✓')} {paint('dim', question)} {paint('accent', options[sel][1])}\n")
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
        task = ask("What do you want to do?", [
            ("dev", "Dev servers (hot reload, client + game server)"),
            ("release", "Release (production build, preview + game server)"),
            ("build", "Production build only (client/dist)"),
            ("check", "Typecheck only"),
        ]) if interactive else "dev"

    env = dict(os.environ)
    if task in ("dev", "release", "build"):
        renderer = a.renderer or (ask("Graphics engine?", [
            ("three", "three.js (classic, WebGL)"),
            ("phoenyx", "Phoenyx (own engine, WebGPU; needs the Phoenyx repo)"),
        ]) if interactive else "three")
        if renderer == "phoenyx":
            pdir = a.phoenyx_dir or env.get("PHOENYX_DIR") or "E:/phoenix"
            if interactive and not a.phoenyx_dir and not env.get("PHOENYX_DIR"):
                pdir = input(f"Phoenyx repo path [{pdir}]: ").strip() or pdir
            if not (Path(pdir) / "packages" / "phoenyx").is_dir():
                print(f"{paint('err', '✗')} Phoenyx not found at {pdir} (expected packages/phoenyx inside it).")
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

    tunnel = a.tunnel
    if not tunnel and interactive:
        found = available_tunnels()
        opts = [("none", "No tunnel (local only)")] + [(k, f"{k} (installed)") for k in found] + [
            (k, f"{k} (not installed: needs `{TUNNELS[k][0]}` on PATH)") for k in TUNNELS if k not in found
        ]
        tunnel = ask("Expose the game publicly through a tunnel?", opts)
    tunnel = None if tunnel in (None, "none") else tunnel
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
    procs = [
        subprocess.Popen(f"npm run {'start' if release else 'dev'} -w server", shell=True, cwd=ROOT, env=env),
        subprocess.Popen(f"npm run {'preview' if release else 'dev'} -w client", shell=True, cwd=ROOT, env=env),
    ]
    if tunnel:
        procs.append(subprocess.Popen(TUNNELS[tunnel][1], shell=True, cwd=ROOT, env=env))
    return serve(procs, task, env.get("RENDERER", "three"), tunnel)


if __name__ == "__main__":
    sys.exit(main())
