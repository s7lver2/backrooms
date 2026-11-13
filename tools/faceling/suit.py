"""Viste al Faceling pintando su textura: chaqueta roja de botones dorados, camisa blanca con corbata negra, puños y pantalón y zapatos negros.
Las islas de la textura se localizan por los pesos de los huesos; los detalles (cuello de camisa, corbata, botones, puños) se pintan texel a texel
según la posición 3D que le toca a cada texel (coordenadas baricéntricas dentro de cada triángulo), así que el dibujo cae donde debe aunque
los triángulos sean enormes.
Uso: python tools/faceling/suit.py <carpeta-del-gltf>  (la carpeta del zip del Faceling, copiada: se modifica en el sitio)."""
import json, struct, sys
import numpy as np
from PIL import Image

S = sys.argv[1].rstrip('/\\') + '/'
j = json.load(open(S + 'scene.gltf'))
buf = open(S + 'scene.bin', 'rb').read()
CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def acc(i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    f, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', sz * n)
    out = np.zeros((a['count'], n), dtype=np.float32 if f == 'f' else np.int64)
    for k in range(a['count']): out[k] = struct.unpack_from('<' + f * n, buf, off + k * stride)
    return out
p = j['meshes'][0]['primitives'][0]
pos = acc(p['attributes']['POSITION']); uv = acc(p['attributes']['TEXCOORD_0'])
jt = acc(p['attributes']['JOINTS_0']); wt = acc(p['attributes']['WEIGHTS_0'])
idx = acc(p['indices']).reshape(-1, 3)
jn = [j['nodes'][n]['name'] for n in j['skins'][0]['joints']]
dom = np.array([jn[int(jt[i][np.argmax(wt[i])])] for i in range(len(pos))])
arr = np.array(Image.open(S + 'textures/H_Body_baseColor.png').convert('RGB')).astype(np.float32)
H, W, _ = arr.shape
lum = (arr @ np.array([0.299, 0.587, 0.114], np.float32)) / 255.0

def cls(t):
    names = [dom[v] for v in idx[t]]
    n = max(set(names), key=names.count)
    if n.startswith(('thigh', 'calf')): return 'trousers'
    if n.startswith('foot'): return 'shoes'
    if n.startswith(('spine', 'shoulder', 'foearm')) or 'rootJoint' in n or n.startswith('Object'): return 'jacket'
    return 'skin'  # manos, cuello, cabeza

RED, DARKRED, WHITE, BLACK, GOLD = (176, 24, 30), (118, 12, 18), (234, 230, 220), (22, 20, 22), (214, 170, 52)
BASE = {'trousers': (24, 24, 28), 'shoes': (14, 12, 12)}
BUTTON_Y = (1.14, 1.22, 1.30)

def jacket(P, orig):
    """Color de cada texel de la chaqueta según su posición 3D (n, 3)."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    col = np.tile(np.array(RED, np.float32), (len(P), 1))
    front = z > -0.01
    # el lado: manga roja, puño negro y la mano (piel del original)
    col[(ax > 0.70) & (ax <= 0.775)] = BLACK
    # el escote en V con la camisa, el borde de la solapa y la corbata
    v = 0.045 + (y - 1.28) * 0.30
    inV = front & (ax < 0.2) & (y > 1.28) & (y < 1.62) & (ax < v)
    col[front & (ax < 0.2) & (y > 1.28) & (y < 1.62) & (ax >= v) & (ax < v + 0.018)] = DARKRED
    col[inV] = WHITE
    col[front & (ax < 0.017) & (y > 1.24) & (y < 1.56)] = BLACK
    col[front & (ax < 0.026) & (y >= 1.50) & (y < 1.58)] = BLACK
    # el cuello de la camisa, alrededor del cuello
    col[(y >= 1.575) & (ax < 0.13)] = WHITE
    # doble botonadura dorada
    for yb in BUTTON_Y:
        for sx in (-1, 1):
            col[front & (np.hypot(x - sx * 0.075, y - yb) < 0.014)] = GOLD
    col[ax > 0.775] = orig[ax > 0.775]
    return col

out = arr.copy()
tcls = [cls(t) for t in range(len(idx))]
for t, c in enumerate(tcls):
    if c == 'skin': continue
    U = uv[idx[t]] * np.array([W - 1, H - 1], np.float32); Pm = pos[idx[t]]
    x0, x1 = int(np.floor(U[:, 0].min())), int(np.ceil(U[:, 0].max())); y0, y1 = int(np.floor(U[:, 1].min())), int(np.ceil(U[:, 1].max()))
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1)); xs, ys = xs.ravel(), ys.ravel()
    d = (U[1, 1] - U[2, 1]) * (U[0, 0] - U[2, 0]) + (U[2, 0] - U[1, 0]) * (U[0, 1] - U[2, 1])
    if abs(d) < 1e-9: continue
    l0 = ((U[1, 1] - U[2, 1]) * (xs - U[2, 0]) + (U[2, 0] - U[1, 0]) * (ys - U[2, 1])) / d
    l1 = ((U[2, 1] - U[0, 1]) * (xs - U[2, 0]) + (U[0, 0] - U[2, 0]) * (ys - U[2, 1])) / d
    l2 = 1 - l0 - l1
    ok = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02) & (xs >= 0) & (xs < W) & (ys >= 0) & (ys < H)
    xs, ys, l0, l1, l2 = xs[ok], ys[ok], l0[ok], l1[ok], l2[ok]
    P = l0[:, None] * Pm[0] + l1[:, None] * Pm[1] + l2[:, None] * Pm[2]
    orig = arr[ys, xs]
    col = jacket(P, orig) if c == 'jacket' else np.tile(np.array(BASE[c], np.float32), (len(P), 1))
    if c in ('jacket', 'trousers'):  # se conserva algo del relieve del original (pliegues)
        keep = col == orig  # (la piel de las manos no se toca)
        shade = (0.85 + 0.3 * np.clip(lum[ys, xs], 0, 1))[:, None]
        col = np.where(keep.all(1, keepdims=True), col, np.where((col == np.array(RED)).all(1, keepdims=True) | (col == np.array(BASE['trousers'])).all(1, keepdims=True), np.clip(col * shade, 0, 255), col))
    out[ys, xs] = col
Image.fromarray(out.astype(np.uint8)).save(S + 'textures/H_Body_baseColor.png')
print('suit ok')
