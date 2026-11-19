"""Backrooms launcher: dev / release servers, production build, typecheck, optional public tunnel.

Run with no arguments for an interactive menu, or pass flags to skip the questions:

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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT_PORT, SERVER_PORT = 5180, 5181  # same as shared/src/index.ts
TUNNELS = {  # name -> (executable, command line for a tunnel to the client port)
    "cloudflared": ("cloudflared", f"cloudflared tunnel --url http://localhost:{CLIENT_PORT}"),
    "ngrok": ("ngrok", f"ngrok http {CLIENT_PORT}"),
    "localtunnel": ("npx", f"npx --yes localtunnel --port {CLIENT_PORT}"),
}


def run(cmd: str, env: dict | None = None) -> int:
    return subprocess.call(cmd, shell=True, cwd=ROOT, env=env)


def ask(question: str, options: list[tuple[str, str]], default: int = 0) -> str:
    """Numbered single-choice prompt. Returns the key of the chosen option."""
    print(f"\n{question}")
    for i, (_, label) in enumerate(options, 1):
        print(f"  {i}) {label}{'  [default]' if i - 1 == default else ''}")
    while True:
        raw = input("> ").strip()
        if not raw:
            return options[default][0]
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1][0]
        print(f"  enter a number from 1 to {len(options)}")


def port_busy(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def available_tunnels() -> list[str]:
    return [k for k, (exe, _) in TUNNELS.items() if shutil.which(exe)]


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backrooms launcher", add_help=True)
    p.add_argument("mode", nargs="?", choices=["dev", "release"])
    p.add_argument("--build", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--release", action="store_true")
    p.add_argument("--renderer", choices=["three", "phoenyx"])
    p.add_argument("--phoenyx-dir")
    p.add_argument("--tunnel", choices=list(TUNNELS))
    p.add_argument("--yes", action="store_true")
    return p.parse_args()


def main() -> int:
    a = parse()
    if a.release:
        a.mode = "release"
    interactive = not a.yes and sys.stdin.isatty()
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
            ("three", "three.js (classic, WebGL; what Vercel builds)"),
            ("phoenyx", "Phoenyx (own engine, WebGPU; needs the Phoenyx repo)"),
        ]) if interactive else "three")
        if renderer == "phoenyx":
            pdir = a.phoenyx_dir or env.get("PHOENYX_DIR") or "E:/phoenix"
            if interactive and not a.phoenyx_dir and not env.get("PHOENYX_DIR"):
                pdir = input(f"Phoenyx repo path [{pdir}]: ").strip() or pdir
            if not (Path(pdir) / "packages" / "phoenyx").is_dir():
                print(f"Phoenyx not found at {pdir} (expected packages/phoenyx inside it).")
                return 1
            env["RENDERER"], env["PHOENYX_DIR"] = "phoenyx", pdir
        else:
            env.pop("RENDERER", None)

    if not (ROOT / "node_modules").exists() and run("npm install"):
        return 1
    if task == "build":
        return run("npm run build -w client", env)
    if task == "check":
        return run("npm run typecheck", env)

    tunnel = a.tunnel
    if not tunnel and interactive:
        found = available_tunnels()
        opts = [("none", "No tunnel (local only)")] + [(k, f"{k} (installed)") for k in found] + [
            (k, f"{k} (not installed: needs `{TUNNELS[k][0]}` on PATH)") for k in TUNNELS if k not in found
        ]
        tunnel = ask("Expose the game publicly through a tunnel?", opts)
    tunnel = None if tunnel in (None, "none") else tunnel
    if tunnel and not shutil.which(TUNNELS[tunnel][0]):
        print(f"`{TUNNELS[tunnel][0]}` is not on PATH, so the {tunnel} tunnel cannot start.")
        return 1

    for port in (CLIENT_PORT, SERVER_PORT):  # an old server on the port: say so instead of dying halfway
        if port_busy(port):
            print(f"Port {port} is already in use (another dev/preview still running). Free it with:\n"
                  f'  powershell -c "Stop-Process -Id (Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess -Force"')
            return 1
    release = task == "release"
    if release and run("npm run build -w client", env):  # release: client build + server on `start` (no reload, no watch)
        return 1
    engine = env.get("RENDERER", "three")
    print(f"\n{task} · {engine} · client http://localhost:{CLIENT_PORT} · server http://localhost:{SERVER_PORT}"
          + (f" · tunnel {tunnel} (the public URL appears below)" if tunnel else "") + "\nCtrl+C stops everything.\n")
    procs = [
        subprocess.Popen(f"npm run {'start' if release else 'dev'} -w server", shell=True, cwd=ROOT, env=env),
        subprocess.Popen(f"npm run {'preview' if release else 'dev'} -w client", shell=True, cwd=ROOT, env=env),
    ]
    if tunnel:
        procs.append(subprocess.Popen(TUNNELS[tunnel][1], shell=True, cwd=ROOT, env=env))
    try:
        return procs[1].wait()
    except KeyboardInterrupt:
        return 0
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    sys.exit(main())
