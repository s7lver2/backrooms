"""Hornea en el glTF del Faceling las animaciones de Mixamo (idle, walk, run, strut, point, angry, attack, death).
Uso: python tools/faceling/bake.py <carpeta-del-gltf>  (la carpeta del zip del Faceling, copiada: se modifica en el sitio)."""
import sys, json, numpy as np
import sys
src = open(__import__('pathlib').Path(__file__).with_name('retarget.py'), encoding='utf-8').read().split('if __name__')[0]
exec(src)
CLIPS = {'idle': 'Idle', 'walk': 'Walking', 'run': 'Running', 'strut': 'Strut Walking', 'point': 'Pointing', 'angry': 'Angry Gesture', 'attack': 'Brutal Assassination', 'death': 'Standing React Death Backward'}
gj = json.load(open(FACE + 'scene.gltf')); binp = FACE + 'scene.bin'
data = bytearray(open(binp, 'rb').read())
gj['accessors'] = gj['accessors']; gj['bufferViews'] = gj['bufferViews']; gj['animations'] = []
def add(arr, typ, comp=5126, minmax=False):
    arr = np.asarray(arr, np.float32)
    while len(data) % 4: data.append(0)
    off = len(data); data.extend(arr.tobytes())
    gj['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
    a = {'bufferView': len(gj['bufferViews']) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = [float(arr.min())]; a['max'] = [float(arr.max())]
    gj['accessors'].append(a); return len(gj['accessors']) - 1
spine1 = fid('spine1')
for key, nm in CLIPS.items():
    c = clip(nm); rot, tr = retarget(c); n = c['n']
    ti = add(np.arange(n) / FPS, 'SCALAR', minmax=True)
    samplers, channels = [], []
    for f, q in rot.items():
        samplers.append({'input': ti, 'output': add(q, 'VEC4'), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': f, 'path': 'rotation'}})
    samplers.append({'input': ti, 'output': add(tr, 'VEC3'), 'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers) - 1, 'target': {'node': spine1, 'path': 'translation'}})
    gj['animations'].append({'name': key, 'samplers': samplers, 'channels': channels})
    print(key, n, 'frames', round((n - 1) / FPS, 2), 's')
gj['buffers'][0]['byteLength'] = len(data)
json.dump(gj, open(FACE + 'scene.gltf', 'w')); open(binp, 'wb').write(bytes(data))
