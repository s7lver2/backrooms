"""Recomprime las texturas webp incrustadas de un .glb (sin tocar la geometria ni las extensiones).
  python tools/recompress_glb.py modelo.glb [--max 2048] [--q-color 85] [--q-normal 92] [--q-data 85]
La textura se reconoce por como la usan los materiales: normal -> --q-normal; metalico/rugosidad/oclusion -> --q-data; el resto (color) -> --q-color.
Con --max se reduce el lado mayor (por defecto, el original). Guarda el glb en su sitio; haz copia antes si quieres el original.
"""
import argparse
import io
import json
import struct

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('--max', type=int, default=0)
ap.add_argument('--q-color', type=int, default=85)
ap.add_argument('--q-normal', type=int, default=92)
ap.add_argument('--q-data', type=int, default=85)
a = ap.parse_args()

raw = open(a.glb, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]
j = json.loads(raw[20:20 + jl])
off = 20 + jl
bl = struct.unpack('<I', raw[off:off + 4])[0]
bin_ = raw[off + 8:off + 8 + bl]

kind = {}  # indice de imagen -> 'normal' | 'data' | 'color'
tex = j.get('textures', [])
src = lambda t: tex[t].get('extensions', {}).get('EXT_texture_webp', {}).get('source', tex[t].get('source'))
for m in j.get('materials', []):
    pb = m.get('pbrMetallicRoughness', {})
    for k, slot in (('normal', m.get('normalTexture')), ('data', pb.get('metallicRoughnessTexture')), ('data', m.get('occlusionTexture')), ('color', pb.get('baseColorTexture')), ('color', m.get('emissiveTexture'))):
        if slot is not None and 'index' in slot:
            kind.setdefault(src(slot['index']), k)

new_images = {}
for i, im in enumerate(j.get('images', [])):
    bv = j['bufferViews'][im['bufferView']]
    data = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    img = Image.open(io.BytesIO(data))
    img.load()
    if a.max and max(img.size) > a.max:
        r = a.max / max(img.size)
        img = img.resize((max(1, round(img.width * r)), max(1, round(img.height * r))), Image.LANCZOS)
    q = {'normal': a.q_normal, 'data': a.q_data}.get(kind.get(i, 'color'), a.q_color)
    out = io.BytesIO()
    img.save(out, 'WEBP', quality=q, method=6)
    if len(out.getvalue()) < len(data):
        new_images[im['bufferView']] = out.getvalue()
    print('img', i, kind.get(i, 'color'), len(data) // 1024, 'KB ->', min(len(out.getvalue()), len(data)) // 1024, 'KB')

# la zona binaria de nuevo: cada trozo del buffer 0 con su sitio nuevo (alineado a 4). Los trozos son los bufferViews de ese buffer
# (las imagenes) y los datos comprimidos de EXT_meshopt_compression, que apuntan al buffer 0 por su extension; los bufferViews del buffer de
# reserva (sin datos en el glb) no se tocan
segs = []  # (donde se guarda el sitio, indice de bufferView o None)
for k, bv in enumerate(j['bufferViews']):
    ext = bv.get('extensions', {}).get('EXT_meshopt_compression')
    if ext is not None:
        if ext.get('buffer', 0) == 0:
            segs.append((ext, k))
    elif bv.get('buffer', 0) == 0:
        segs.append((bv, k))
segs.sort(key=lambda s: s[0].get('byteOffset', 0))
chunks = bytearray()
for holder, k in segs:
    o = holder.get('byteOffset', 0)
    data = new_images.get(k, bin_[o:o + holder['byteLength']])
    chunks += bytes(1) * (-len(chunks) % 4)
    holder['byteOffset'] = len(chunks)
    holder['byteLength'] = len(data)
    chunks += data
chunks += bytes(1) * (-len(chunks) % 4)
j['buffers'][0]['byteLength'] = len(chunks)
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
total = 12 + 8 + len(js) + 8 + len(chunks)
open(a.glb, 'wb').write(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(chunks), b'BIN\0') + bytes(chunks))
print(a.glb, len(raw) // 1024, 'KB ->', total // 1024, 'KB')
