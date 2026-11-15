"""Convierte un glTF con texturas PNG grandes (scene.gltf + scene.bin + textures/) en un .glb único y ligero.

  python tools/pack_glb.py <carpeta-del-gltf> <salida.glb> [--max 512]

- Reduce cada textura a `--max` px por el lado mayor y la guarda como JPEG (PNG solo si tiene transparencia real).
- Quita los mapas de normales y los de transmisión (pesan mucho y no aportan a esta distancia) y la
  extensión KHR_materials_transmission (el cristal queda como un material con alfa normal).
- Lo demás (geometría, materiales, nodos) pasa tal cual: se carga con el GLTFLoader del juego.

Solo hace falta Pillow (y node, opcional, para el informe de check_glb.mjs al final). Las fuentes (los .zip de client/public) se extraen a una carpeta temporal propia;
no se ejecuta nada de lo que traen. Ejemplo (lo que se usó para models/waiting):

  unzip client/public/old_computer.zip -d $TMP/old_computer
  python tools/pack_glb.py $TMP/old_computer client/public/models/waiting/computer.glb --max 512
"""
import io
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image

TEX_KEYS = ("baseColorTexture", "metallicRoughnessTexture", "emissiveTexture", "occlusionTexture")


def pad(b: bytes, fill: bytes) -> bytes:
    return b + fill * (-len(b) % 4)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    size = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 512
    if "--max" in sys.argv:
        args.remove(str(size))
    src, out = Path(args[0]), Path(args[1])
    g = json.loads((src / "scene.gltf").read_text(encoding="utf-8"))
    binary = (src / g["buffers"][0]["uri"]).read_bytes()

    g.setdefault("textures", []), g.setdefault("images", [])  # modelos sin texturas (solo colores)
    # 1. fuera lo que pesa y no se ve: normales y transmisión
    used_tex: list[int] = []
    for m in g.get("materials", []):
        m.pop("normalTexture", None)
        m.get("extensions", {}).pop("KHR_materials_transmission", None)
        m.get("extensions", {}).pop("KHR_materials_specular", None)  # sus texturas (specularf0) tampoco se remapean: fuera
        if not m.get("extensions"):
            m.pop("extensions", None)
        holders = [m, m.get("pbrMetallicRoughness", {})]
        for h in holders:
            for k in TEX_KEYS:
                if k in h and h[k]["index"] not in used_tex:
                    used_tex.append(h[k]["index"])
    # las texturas de transmisión ya no cuelgan de nadie; el resto se compacta
    remap = {old: new for new, old in enumerate(used_tex)}
    for m in g.get("materials", []):
        for h in (m, m.get("pbrMetallicRoughness", {})):
            for k in TEX_KEYS:
                if k in h:
                    h[k]["index"] = remap[h[k]["index"]]
    old_tex = g["textures"]
    g["textures"] = [old_tex[i] for i in used_tex]
    used_img = []
    for t in g["textures"]:
        if t["source"] not in used_img:
            used_img.append(t["source"])
    for t in g["textures"]:
        t["source"] = used_img.index(t["source"])
    old_img = g["images"]
    g["images"] = []
    g["extensionsUsed"] = [e for e in g.get("extensionsUsed", []) if e not in ("KHR_materials_transmission", "KHR_materials_specular")]
    if not g["extensionsUsed"]:
        g.pop("extensionsUsed")
    g.pop("extensionsRequired", None)

    # 2. las texturas, reducidas, dentro del mismo binario
    blob = bytearray(pad(binary, b"\0"))
    for i in used_img:
        im = Image.open(src / old_img[i]["uri"])
        im.thumbnail((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        alpha = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 250
        if alpha:
            im.convert("RGBA").save(buf, "PNG", optimize=True)
            mime = "image/png"
        else:
            im.convert("RGB").save(buf, "JPEG", quality=82, optimize=True)
            mime = "image/jpeg"
        data = buf.getvalue()
        g["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob += pad(data, b"\0")
        g["images"].append({"bufferView": len(g["bufferViews"]) - 1, "mimeType": mime, "name": Path(old_img[i]["uri"]).stem})
    g["buffers"] = [{"byteLength": len(blob)}]

    # 3. el .glb: cabecera, JSON y binario
    js = pad(json.dumps(g, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(js) + 8 + len(blob)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob))
    print(f"{out}  {total / 1024:.0f} KB")
    if shutil.which("node"):  # informe de calidad (solo avisa, nunca falla): tools/check_glb.mjs
        subprocess.run(["node", str(Path(__file__).with_name("check_glb.mjs")), str(out)])
    return 0


if __name__ == "__main__":
    sys.exit(main())
