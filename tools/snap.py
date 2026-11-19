"""Dev helper: renders one dashboard frame with sample logs to an HTML page (ANSI -> spans) so the look can be checked in a browser.
  python tools/snap.py [WIDTH HEIGHT [TAB]]  ->  tools/snap.html
"""
import html
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dash  # noqa: E402

W, H = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (120, 34)
TAB = int(sys.argv[3]) if len(sys.argv) > 3 else 0
env: dict = {}
ps = [dash.Proc("server", "", env, ".", "run", auto=False), dash.Proc("client", "", env, ".", "accent", auto=False),
      dash.Proc("tunnel", "", env, ".", "warn", auto=False), dash.Proc("vercel", "", env, ".", "ok", auto=False, oneshot=True)]
d = dash.Dashboard("backrooms", "dev · phoenyx", ps, [("client", "http://localhost:5180"), ("server", "http://localhost:5181")], "master", [])
for p in ps[:2]:
    p.p = type("P", (), {"poll": lambda s: None, "pid": 0})()
    p.started = time.time() - 42
d.tunnel_url = ""
sample = [
    ("server", "> @backrooms/server@0.1.0 dev"), ("server", "listening on http://localhost:5181"), ("server", "room WMESY created (private)"),
    ("client", "VITE v5.4.0  ready in 812 ms"), ("client", "➜  Local:   http://localhost:5180/"), ("client", "warn: deprecated import in game.ts"),
    ("server", "player ANON joined WMESY"), ("client", "Error: Could not load collide.ts"), ("server", "player ANON left WMESY"),
]
for tag, text in sample:
    d.sink(next(p for p in ps if p.tag == tag), text)
d.tab = TAB
if TAB == 4:
    for a,u,st in [("19m","https://backrooms-boq2vfp1t.vercel.app","Ready"),("36m","https://backrooms-l2s963ae7.vercel.app","Ready"),("40m","https://backrooms-23osz6gs7.vercel.app","Error")]: d.vrows.append((a,u,st))
    d.vsel=1
out = d.frame(W, H, 12)
rows = out.split("\r\n")
rows[0] = rows[0].replace("\x1b[H", "")
parts = []
for row in rows:
    s = ""
    fg = bg = "inherit"
    bold = False
    for m in re.finditer(r"\x1b\[([0-9;]*)m|([^\x1b]+)", row):
        if m.group(2) is not None:
            s += f'<span style="color:{fg};background:{bg};font-weight:{700 if bold else 400}">{html.escape(m.group(2))}</span>'
            continue
        c = [int(x) if x else 0 for x in m.group(1).split(";")]
        i = 0
        while i < len(c):
            if c[i] == 0:
                fg, bg, bold = "inherit", "inherit", False
            elif c[i] == 1:
                bold = True
            elif c[i] == 38 and c[i + 1] == 2:
                fg = f"rgb({c[i + 2]},{c[i + 3]},{c[i + 4]})"
                i += 4
            elif c[i] == 48 and c[i + 1] == 2:
                bg = f"rgb({c[i + 2]},{c[i + 3]},{c[i + 4]})"
                i += 4
            i += 1
    parts.append(s)
Path(__file__).with_name("snap.html").write_text(
    '<meta charset="utf-8"><body style="margin:0;background:#000"><pre style="margin:0;padding:8px;color:#ededed;background:#000;'
    f'font:14px/1.15 Consolas,\'Cascadia Mono\',monospace">{chr(10).join(parts)}</pre>', encoding="utf-8")
print("snap.html")
