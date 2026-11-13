"""Retarget de los clips de Mixamo (client/public/animations) al esqueleto del Faceling; lo usa bake.py. Con un nombre de clip como segundo argumento dibuja un esqueleto de prueba.
Uso: python tools/faceling/retarget.py <carpeta-del-gltf>  (la carpeta del zip del Faceling, copiada: se modifica en el sitio)."""
import json, struct, sys
from pathlib import Path
import numpy as np



ROOT = str(Path(__file__).resolve().parents[2] / 'client' / 'public') + '/'

FACE = sys.argv[1].rstrip('/') + '/'



# ---- cuaterniones (x, y, z, w)

def qmul(a, b):

    ax, ay, az, aw = a; bx, by, bz, bw = b

    return np.array([aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz])

def qinv(a): return np.array([-a[0], -a[1], -a[2], a[3]]) / np.dot(a, a)

def qnorm(a): return a / np.linalg.norm(a)

def qrot(q, v):

    return qmul(qmul(q, np.array([v[0], v[1], v[2], 0.0])), qinv(q))[:3]

def mat2q(m):

    m = np.array(m, float).reshape(4, 4).T  # glTF: column-major

    r = m[:3, :3].copy()

    for i in range(3): r[:, i] /= np.linalg.norm(r[:, i])

    t = np.trace(r)

    if t > 0:

        s = np.sqrt(t + 1) * 2; return qnorm(np.array([(r[2, 1]-r[1, 2])/s, (r[0, 2]-r[2, 0])/s, (r[1, 0]-r[0, 1])/s, s/4]))

    i = np.argmax(np.diag(r)); j, k = (i+1) % 3, (i+2) % 3

    s = np.sqrt(r[i, i] - r[j, j] - r[k, k] + 1) * 2

    q = np.zeros(4); q[i] = s/4; q[3] = (r[k, j]-r[j, k])/s; q[j] = (r[j, i]+r[i, j])/s; q[k] = (r[k, i]+r[i, k])/s

    return qnorm(q)

def local_q(n):

    if 'rotation' in n: return np.array(n['rotation'], float)

    if 'matrix' in n: return mat2q(n['matrix'])

    return np.array([0, 0, 0, 1.0])

def local_t(n):

    if 'translation' in n: return np.array(n['translation'], float)

    if 'matrix' in n: return np.array(n['matrix'][12:15], float)

    return np.zeros(3)



def tree(nodes):

    par = {}

    for i, n in enumerate(nodes):

        for c in n.get('children', []): par[c] = i

    return par

def world_rest(nodes, par):

    cache = {}

    def w(i):

        if i in cache: return cache[i]

        q = local_q(nodes[i]); cache[i] = qmul(w(par[i]), q) if i in par else q

        return cache[i]

    return [w(i) for i in range(len(nodes))]

def world_pos(nodes, par):

    cache = {}

    def w(i):

        if i in cache: return cache[i]

        q, t = local_q(nodes[i]), local_t(nodes[i])

        if i in par:

            pq, pp = w(par[i]); cache[i] = (qmul(pq, q), pp + qrot(pq, t))

        else: cache[i] = (q, t)

        return cache[i]

    return [w(i)[1] for i in range(len(nodes))]



# ---- hazmat (Mixamo)

b = open(ROOT + 'models/backrooms/hazmat.glb', 'rb').read()

L = struct.unpack_from('<I', b, 12)[0]; hj = json.loads(b[20:20+L])

hn = hj['nodes']; hpar = tree(hn); hrest = world_rest(hn, hpar); hpos = world_pos(hn, hpar)

hname = {n['name'].replace('mixamorig:', ''): i for i, n in enumerate(hn) if n.get('name', '').startswith('mixamorig:')}

# ---- Faceling

fj = json.load(open(FACE + 'scene.gltf')); fn = fj['nodes']; fpar = tree(fn); frest = world_rest(fn, fpar); fpos = world_pos(fn, fpar)

fname = {n.get('name'): i for i, n in enumerate(fn)}

def fid(prefix):

    return next(i for n, i in fname.items() if n and n.startswith(prefix))



# ---- paquete de clips

pk = json.load(open(ROOT + 'animations/player.pack.json')); pb = open(ROOT + 'animations/player.pack.bin', 'rb').read()

FPS = pk['fps']; PBONES = pk['bones']

def clip(name):

    c = pk['clips'][name]; n = c['n']; nb = len(c['bones'])

    q = np.frombuffer(pb, dtype='<i2', count=nb * n * 4, offset=c['q']).reshape(nb, n, 4).astype(float) / 32767

    q /= np.linalg.norm(q, axis=2, keepdims=True)

    hips = np.frombuffer(pb, dtype='<f4', count=n * 3, offset=c['hips']).reshape(n, 3).astype(float) if c['hips'] >= 0 else np.zeros((n, 3))

    return dict(n=n, bones={PBONES[b]: q[k] for k, b in enumerate(c['bones'])}, hips=hips)



# faceling joint -> hueso de Mixamo cuyo giro acumulado lleva

MAP = {'spine1': 'Hips', 'spine2': 'Spine2', 'neck': 'Neck', 'head': 'Head',

       'shoulder.L': 'LeftArm', 'foearm.L': 'LeftForeArm', 'hand.L': 'LeftHand', 'shoulder.R': 'RightArm', 'foearm.R': 'RightForeArm', 'hand.R': 'RightHand',

       'thigh.L': 'LeftUpLeg', 'calf.L': 'LeftLeg', 'foot.L': 'LeftFoot', 'thigh.R': 'RightUpLeg', 'calf.R': 'RightLeg', 'foot.R': 'RightFoot'}

fmap = {fid(k): hname[v] for k, v in MAP.items()}   # nodo faceling -> nodo hazmat

hmx = {i: n for n, i in hname.items()}



def retarget(c):

    n = c['n']; out = {f: np.zeros((n, 4)) for f in fmap}; trans = np.zeros((n, 3))

    for t in range(n):

        # mundo animado de Mixamo (los que no tienen dato en el clip, en reposo)

        aw = {}

        def A(i):

            if i in aw: return aw[i]

            nm = hmx.get(i); lq = c['bones'][nm][t] if nm in c['bones'] else local_q(hn[i])

            # la cadera del paquete va en el espacio del FBX (mundo, y arriba): el Animator le quita el giro de sus padres
            aw[i] = lq if (nm == 'Hips' or i not in hpar) else qmul(A(hpar[i]), lq)

            return aw[i]

        fw = {}

        def F(i):

            if i in fw: return fw[i]

            if i in fmap:

                d = qmul(A(fmap[i]), qinv(hrest[fmap[i]])); fw[i] = qnorm(qmul(d, frest[i]))

            else:

                fw[i] = qmul(F(fpar[i]), local_q(fn[i])) if i in fpar else local_q(fn[i])

            return fw[i]

        for f in fmap:

            pq = F(fpar[f]) if f in fpar else np.array([0, 0, 0, 1.0])

            q = qnorm(qmul(qinv(pq), F(f)))

            if t > 0 and np.dot(q, out[f][t - 1]) < 0: q = -q

            out[f][t] = q

    # la cadera: sube y baja y se mece (cm de Mixamo -> m del Faceling, a su proporción)

    f0 = fid('spine1'); k = fpos[f0][1] / pk['hipsBindY']

    h = c['hips']; rest = local_t(fn[f0])

    for t in range(n): trans[t] = rest + np.array([(h[t, 0] - h[:, 0].mean()) * k, (h[t, 1] - pk['hipsBindY']) * k, (h[t, 2] - h[:, 2].mean()) * k])

    return out, trans



if __name__ == '__main__':

    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

    name = sys.argv[1] if len(sys.argv) > 1 else 'Walking'

    c = clip(name); rot, tr = retarget(c); n = c['n']

    fig, axs = plt.subplots(1, 4, figsize=(14, 4))

    for ax, t in zip(axs, [0, n // 4, n // 2, 3 * n // 4]):

        # FK con los giros animados

        wq, wp = {}, {}

        def go(i):

            if i in wq: return

            q = rot[i][t] if i in rot else local_q(fn[i]); tt = tr[t] if i == fid('spine1') else local_t(fn[i])

            if i in fpar:

                go(fpar[i]); wq[i] = qmul(wq[fpar[i]], q); wp[i] = wp[fpar[i]] + qrot(wq[fpar[i]], tt)

            else: wq[i], wp[i] = q, tt

        for j in fj['skins'][0]['joints']: go(j)

        for j in fj['skins'][0]['joints']:

            if j in fpar and fpar[j] in wp: ax.plot([wp[fpar[j]][2], wp[j][2]], [wp[fpar[j]][1], wp[j][1]], 'k-')

        ax.set_aspect('equal'); ax.set_xlim(-1, 1); ax.set_ylim(0, 2); ax.set_title(f'{name} {t}')

    plt.savefig(FACE + '../retarget_' + name.replace(' ', '_') + '.png', dpi=60)

    print('hips range y', tr[:, 1].min(), tr[:, 1].max())

