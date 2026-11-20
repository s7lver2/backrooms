"""Genera los packs de alta definicion a partir de las coincidencias de tools/match_hd.py (assets-src/hd-matches.json) y los .zip originales.
  python tools/match_hd.py          # una vez (o al anadir modelos): busca la textura original de cada textura de los .glb
  python tools/make_hd.py [--max 2048] [--err 0.15]

Escribe en client/public/hd/:
  tex/<glb>/<imagen>.webp   la textura original (hasta --max px) que sustituye a la de ese glb (pack HIGH-RES TEXTURES)
  tex.json                  { "<ruta del glb>": { "<indice de imagen>": "tex/..." } }
  nrm/<glb>/<material>.webp el mapa de normales original del material (los glb ligeros se hicieron sin ellos; pack HIGH-DETAIL MODELS)
  nrm.json                  { "<ruta del glb>": { "<indice de material>": "nrm/..." } }
El juego (src/hd.ts) aplica cada uno solo si su pack esta instalado.
"""
import io
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "client/public/models"
OUT = ROOT / "client/public/hd"
arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
MAX = arg("--max", 2048)
ERR = arg("--err", 0.15)
MAXN = arg("--max-normal", 1024)


def zip_of(name: str) -> zipfile.ZipFile:
    for d in (ROOT / "assets-src", ROOT / "client/public"):
        if (d / name).exists():
            return zipfile.ZipFile(d / name)
    raise FileNotFoundError(name)


def glb_json(p: Path) -> dict:
    b = p.read_bytes()
    return json.loads(b[20:20 + struct.unpack("<I", b[12:16])[0]])


def sibling_normal(names: list[str], color: str) -> str | None:
    low = {n.lower(): n for n in names}
    base = color.rsplit(".", 1)[0]
    for a, b in (("basecolor", "normal"), ("albedo", "normal"), ("diffuse", "normal"), ("color", "normal"), ("base_color", "normal"), ("basecolor", "nor_gl")):
        i = base.lower().find(a)
        if i < 0:
            continue
        stem = base[:i] + b + base[i + len(a):]
        for ext in (".png", ".jpg", ".jpeg", ".webp", ".tga"):
            if (stem + ext).lower() in low:
                return low[(stem + ext).lower()]
    return None


def save(zf: zipfile.ZipFile, name: str, dest: Path, side: int, q: int) -> int:
    im = Image.open(io.BytesIO(zf.read(name)))
    im.load()
    if max(im.size) > side:
        r = side / max(im.size)
        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "WEBP", quality=q, method=6)
    return dest.stat().st_size


def main() -> None:
    matches = json.loads((ROOT / "assets-src/hd-matches.json").read_text())
    tex: dict[str, dict[str, str]] = {}
    nrm: dict[str, dict[str, str]] = {}
    done: dict[tuple, str] = {}  # (zip, archivo, lado) -> ruta ya escrita (dos glb pueden compartir textura)
    total = {"tex": 0, "nrm": 0}
    for key, m in sorted(matches.items()):
        glb, idx = key.rsplit("#", 1)
        if m["err"] > ERR or max(m["size"]) <= max(m["have"]) * 1.5 or m["kind"] == "emissive":
            continue
        zf = zip_of(m["zip"])
        rel = f"tex/{glb[:-4]}/{idx}.webp"
        sk = (m["zip"], m["file"], MAX)
        if sk in done:
            tex.setdefault(glb, {})[idx] = done[sk]
        else:
            total["tex"] += save(zf, m["file"], OUT / rel, MAX, 82)
            done[sk] = rel
            tex.setdefault(glb, {})[idx] = rel
        # el mapa de normales del material que usa esta textura de color
        if m["kind"] == "color":
            j = glb_json(MODELS / glb)
            texs = j.get("textures", [])
            src = lambda t: texs[t].get("extensions", {}).get("EXT_texture_webp", {}).get("source", texs[t].get("source"))
            for mi, mat in enumerate(j.get("materials", [])):
                bc = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
                if bc is None or src(bc["index"]) != int(idx):
                    continue
                n = sibling_normal(zf.namelist(), m["file"])
                if not n:
                    continue
                nr = f"nrm/{glb[:-4]}/{mi}.webp"
                nk = (m["zip"], n, MAXN)
                if nk in done:
                    nrm.setdefault(glb, {})[str(mi)] = done[nk]
                else:
                    total["nrm"] += save(zf, n, OUT / nr, MAXN, 90)
                    done[nk] = nr
                    nrm.setdefault(glb, {})[str(mi)] = nr
    (OUT / "tex.json").write_text(json.dumps(tex, separators=(",", ":")))
    (OUT / "nrm.json").write_text(json.dumps(nrm, separators=(",", ":")))
    print(f"tex: {sum(len(v) for v in tex.values())} imagenes de {len(tex)} modelos, {total['tex'] / 1e6:.1f} MB")
    print(f"nrm: {sum(len(v) for v in nrm.values())} normales de {len(nrm)} modelos, {total['nrm'] / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
