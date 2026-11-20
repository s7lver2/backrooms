"""Busca, para cada textura incrustada de los .glb del juego, la textura original de mayor resolucion en los .zip de assets-src/ y client/public/.
  python tools/match_hd.py [--out assets-src/hd-matches.json]
Compara miniaturas (32x32, gris) de la textura del glb y de cada textura grande de los zips (son la misma imagen reducida: mismo UV). Guarda por imagen del glb la mejor
coincidencia (zip, ruta, tamano, error). Es lenta la primera vez (decodifica las texturas grandes); la cache de miniaturas queda en assets-src/hd-thumbs.json.
"""
import io
import json
import struct
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "client/public/models"
ZIPS = sorted(list((ROOT / "assets-src").glob("*.zip")) + list((ROOT / "client/public").glob("*.zip")))
CACHE = ROOT / "assets-src/hd-thumbs.json"
OUT = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "assets-src/hd-matches.json"
MIN_SIDE = 1536  # solo interesan las fuentes mayores que lo que hay


def thumb(img: Image.Image) -> list[float]:
    g = img.convert("L").resize((32, 32), Image.BILINEAR)
    a = np.asarray(g, dtype=np.float32).ravel()
    a = (a - a.mean()) / (a.std() + 1e-3)
    return a.round(2).tolist()


def glb_images(p: Path):
    b = p.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack("<I", b[off:off + 4])[0]
    bin_ = b[off + 8:off + 8 + bl]
    tex = j.get("textures", [])
    src = lambda t: tex[t].get("extensions", {}).get("EXT_texture_webp", {}).get("source", tex[t].get("source"))
    kinds = {}
    for m in j.get("materials", []):
        pb = m.get("pbrMetallicRoughness", {})
        for k, s in (("normal", m.get("normalTexture")), ("mr", pb.get("metallicRoughnessTexture")), ("color", pb.get("baseColorTexture")), ("emissive", m.get("emissiveTexture"))):
            if s is not None and "index" in s:
                kinds.setdefault(src(s["index"]), k)
    for i, im in enumerate(j.get("images", [])):
        bv = j["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        yield i, kinds.get(i, "color"), Image.open(io.BytesIO(bin_[o:o + bv["byteLength"]]))


def main() -> None:
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    sources = []  # (zip, name, w, h, thumb)
    for z in ZIPS:
        try:
            zf = zipfile.ZipFile(z)
        except Exception:
            continue
        for info in zf.infolist():
            n = info.filename
            if not n.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".tga")) or info.file_size < 150_000:
                continue
            key = f"{z.name}|{n}|{info.file_size}"
            if key not in cache:
                try:
                    im = Image.open(io.BytesIO(zf.read(info)))
                    w, h = im.size
                    if max(w, h) < MIN_SIDE:
                        cache[key] = None
                    else:
                        im.draft("RGB", (256, 256))
                        cache[key] = [w, h, thumb(im)]
                except Exception:
                    cache[key] = None
            if cache[key]:
                sources.append((z.name, n, cache[key][0], cache[key][1], np.array(cache[key][2], dtype=np.float32)))
        CACHE.write_text(json.dumps(cache))
        print("zip", z.name, len(sources), flush=True)
    S = np.stack([s[4] for s in sources]) if sources else np.zeros((0, 1024), np.float32)
    res = {}
    for p in sorted(MODELS.rglob("*.glb")):
        if "lods" in p.parts:
            continue
        for i, kind, im in glb_images(p):
            if im.width * im.height < 128 * 128:
                continue
            t = np.array(thumb(im), dtype=np.float32)
            d = np.abs(S - t).mean(axis=1) if len(S) else np.array([])
            if not len(d):
                continue
            k = int(d.argmin())
            # (normales y mapas de datos se parecen entre si: solo se acepta con poco error y si la fuente es mayor)
            res[f"{p.relative_to(MODELS).as_posix()}#{i}"] = {"kind": kind, "have": [im.width, im.height], "zip": sources[k][0], "file": sources[k][1], "size": [sources[k][2], sources[k][3]], "err": round(float(d[k]), 3)}
    OUT.write_text(json.dumps(res, indent=1))
    good = [k for k, v in res.items() if v["err"] < 0.25 and max(v["size"]) > max(v["have"])]
    print("images", len(res), "matched", len(good))


if __name__ == "__main__":
    main()
