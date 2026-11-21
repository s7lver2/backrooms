import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, type Maze } from './maze';
import type { Assets } from './game';
import { lightmapped } from './lightmap';

/*
 * Las Suites, bajo el hotel: los conductos de ventilación (chapa, techo bajo, se va agachado), las nubes de gas, los ventiladores de los callejones, la sala de
 * videovigilancia (monitores, puesto de cámaras, terminal del EEH) y las cámaras de seguridad de todo el nivel. La forma (qué celdas, dónde va cada cosa) es de
 * shared/src/suites.ts; aquí solo se pinta. El mundo (`World`) lo monta y le pasa el reloj.
 */
/** El alto de los conductos (m): se pasa agachado. */
export const DUCT_H = 1.6;
/** El alto de la sala de control (m): pequeña pero alta. */
export const ROOM_H = 4.4;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const lit = <M extends THREE.Material>(m: M) => (lightmapped(m), m);
const mapOf = (c: HTMLCanvasElement, repeat = false) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) (t.wrapS = t.wrapT = THREE.RepeatWrapping), (t.anisotropy = 4);
  return t;
};
const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
/** Una mancha de ruido (para dar vida a la chapa). */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Un modelo a medida y fundido por materiales (pocas mallas): el lado `axis` mide `size`, centrado en x/z, con la base (o el techo, si `top`) en y = 0; `roll` lo da la vuelta antes. */
function fitModel(assets: Assets, key: keyof Assets['gltf'], size: number, axis: 'x' | 'y' | 'z' = 'y', opts: { roll?: number; top?: boolean } = {}) {
  const src = assets.gltf[key].scene.clone(true), inner = new THREE.Group().add(src);
  inner.rotation.z = opts.roll ?? 0;
  inner.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(inner), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), k = size / s[axis];
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld.clone());
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
    const ng = g.index ? g.toNonIndexed() : g, mat = Array.isArray(m.material) ? m.material[0] : m.material;
    byMat.set(mat, [...(byMat.get(mat) ?? []), ng]);
  });
  const out = new THREE.Group();
  for (const [mat, gs] of byMat) {
    const g = mergeGeometries(gs);
    if (!g) continue;
    const own = mat.clone();
    own.side = THREE.DoubleSide; // (los nodos con escala negativa dan caras del revés: se ve el interior)
    lightmapped(own);
    const me = new THREE.Mesh(g, own);
    me.castShadow = me.receiveShadow = true;
    out.add(me);
  }
  out.scale.setScalar(k);
  out.position.set(-c.x * k, -(opts.top ? b.max.y : b.min.y) * k, -c.z * k);
  const wrap = new THREE.Group().add(out);
  wrap.userData = { k, cx: c.x, cz: c.z, minY: b.min.y };
  return wrap;
}

/** Desde esta z (m) hacia el sur empiezan los conductos y la sala de control; el hotel acaba antes. */
const DEEP_Z = 28;

const ductTex = () => {
  // chapa galvanizada: una celda (1,5 m) con juntas, remaches, rozaduras y mugre abajo
  const c = canvas(256, 256), g = c.getContext('2d')!;
  g.fillStyle = '#8c9190', g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) (g.fillStyle = `rgba(${hash(i, 1) > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + hash(i, 2) * 0.05})`), g.fillRect(hash(i, 3) * 256, hash(i, 4) * 256, 30 + hash(i, 5) * 90, 1);
  g.fillStyle = 'rgba(30,34,34,0.55)', g.fillRect(0, 0, 256, 5), g.fillRect(0, 251, 256, 5), g.fillRect(0, 0, 5, 256), g.fillRect(251, 0, 5, 256);
  g.fillStyle = 'rgba(20,22,22,0.35)', g.fillRect(0, 126, 256, 3);
  for (const [x, y] of [[14, 14], [242, 14], [14, 242], [242, 242], [14, 128], [242, 128]]) {
    g.fillStyle = '#4a4e4d', g.beginPath(), g.arc(x, y, 5, 0, 7), g.fill();
    g.fillStyle = '#b5bab9', g.beginPath(), g.arc(x - 1, y - 1, 2, 0, 7), g.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = 20 + hash(i, 9) * 216, gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(90,60,35,0)'), gr.addColorStop(1, `rgba(90,60,35,${0.1 + hash(i, 8) * 0.18})`);
    g.fillStyle = gr, g.fillRect(x, 0, 3 + hash(i, 7) * 9, 256);
  }
  const m = g.createLinearGradient(0, 160, 0, 256);
  m.addColorStop(0, 'rgba(15,12,8,0)'), m.addColorStop(1, 'rgba(15,12,8,0.45)');
  g.fillStyle = m, g.fillRect(0, 160, 256, 96);
  return mapOf(c, true);
};
const concreteTex = () => {
  // hormigón visto: manchas, juntas de encofrado cada 128 px (≈ 1,25 m) y los agujeros de los tensores
  const c = canvas(256, 256), g = c.getContext('2d')!;
  g.fillStyle = '#8b8b86', g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) (g.fillStyle = `rgba(${hash(i, 51) > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + hash(i, 52) * 0.06})`), g.fillRect(hash(i, 53) * 256, hash(i, 54) * 256, 3 + hash(i, 55) * 24, 2 + hash(i, 56) * 10);
  for (let i = 0; i < 5; i++) {
    const x = hash(i, 57) * 256, gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(40,36,30,0)'), gr.addColorStop(1, `rgba(40,36,30,${0.1 + hash(i, 58) * 0.2})`);
    g.fillStyle = gr, g.fillRect(x, 0, 4 + hash(i, 59) * 12, 256);
  }
  g.strokeStyle = 'rgba(30,30,28,0.5)', g.lineWidth = 2, g.strokeRect(1, 1, 254, 254);
  g.beginPath(), g.moveTo(128, 0), g.lineTo(128, 256), g.stroke();
  for (const [x, y] of [[32, 64], [96, 64], [160, 64], [224, 64], [32, 192], [96, 192], [160, 192], [224, 192]]) (g.fillStyle = 'rgba(25,25,24,0.7)'), g.beginPath(), g.arc(x, y, 3.2, 0, 7), g.fill();
  return mapOf(c, true);
};
const tileTex = () => {
  const c = canvas(128, 128), g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) (g.fillStyle = (x + y) % 2 ? '#2b2e2d' : '#222524'), g.fillRect(x * 64, y * 64, 64, 64);
  g.strokeStyle = '#0d0e0e', g.lineWidth = 3, g.strokeRect(0, 0, 128, 128), g.beginPath(), g.moveTo(64, 0), g.lineTo(64, 128), g.moveTo(0, 64), g.lineTo(128, 64), g.stroke();
  for (let i = 0; i < 80; i++) (g.fillStyle = `rgba(255,255,255,${hash(i, 12) * 0.05})`), g.fillRect(hash(i, 13) * 128, hash(i, 14) * 128, 6, 2);
  return mapOf(c, true);
};

/** El suelo de la sala de control: baldosas de vinilo oscuras (1,5 m por celda). */
export const roomFloorMaterial = () => {
  const t = tileTex();
  t.repeat.set(2, 2);
  return lit(new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.15 }));
};

export class Vents {
  readonly group = new THREE.Group();
  /** Lo que no se atraviesa (mesas, puesto, terminal). */
  readonly blockers: { x: number; z: number; r: number }[] = [];
  /** Las celdas de la sala de control (el mundo les pone su propio suelo). */
  readonly roomFloor = new Set<number>();
  private gasU = { value: 0 };
  private fans: { rotor: THREE.Object3D; v: number }[] = [];
  private heads: THREE.Object3D[] = [];
  private feeds: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; cam: number; mat?: THREE.MeshBasicMaterial }[] = [];
  private live?: { rt: THREE.WebGLRenderTarget; cam: THREE.PerspectiveCamera; tv: number; src: number; until: number; next: number; acc: number };
  private roomAt?: { x: number; z: number };
  private feedI = 0;
  private feedT = 0;
  private eehTex?: THREE.CanvasTexture;
  private eehShown: boolean | null = null;

  constructor(private maze: Maze, private assets: Assets) {
    const w = maze.w, open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < maze.h && !!maze.open[y * w + x];
    if (maze.duct) this.ducts(maze.duct, open);
    this.grates();
    this.gas();
    this.fanBlades(open);
    this.dimLights(open);
    if (maze.control) this.control(maze.control);
    // lo de abajo (conductos y sala de control, todo al sur del hotel): se deja de dibujar mientras no se está cerca (las paredes lo tapan, pero la GPU no lo sabe)
    const box = new THREE.Box3(), c = new THREE.Vector3();
    this.deep = this.group.children.filter((o) => !(o as THREE.Light).isLight && box.setFromObject(o).getCenter(c).z > DEEP_Z);
    this.cameras();
    for (let i = 0; i < Math.min(3, this.cand.length); i++) { const l = new THREE.PointLight(0xffffff, 0, 6, 1.5); this.pool.push(l), this.group.add(l); }
  }
  private deep: THREE.Object3D[] = [];
  private deepOn = true;
  /** Las luces de abajo (9 en total) son candidatas: solo 3 luces reales (constantes: sin recompilar) se colocan en las más cercanas; cada luz de más cuesta en cada píxel de todo el mundo. */
  private cand: { p: THREE.Vector3; c: number; i: number; d: number }[] = [];
  private pool: THREE.PointLight[] = [];
  private near(at: THREE.Vector3) {
    const s = this.cand.map((k) => ({ k, r: k.p.distanceTo(at) / k.d })).sort((a, b) => a.r - b.r);
    this.pool.forEach((l, i) => {
      const k = s[i]?.k, on = !!k && s[i].r < 1.6;
      if (!k || (!on && l.intensity === 0)) return;
      l.intensity = on ? k.i : 0;
      if (on) (l.position.copy(k.p), l.color.set(k.c), (l.distance = k.d));
    });
  }
  /** Dibuja lo de abajo solo si el jugador está allí (o si se mira por una cámara, que puede ver los conductos). */
  gate(z: number, force: boolean, at: THREE.Vector3) {
    this.near(at);
    if (!force) for (const h of this.heads) h.visible = Math.hypot(h.position.x - at.x, h.position.z - at.z) < 26; // (las cámaras de más allá, no se dibujan)
    const on = force || z > DEEP_Z - 3;
    if (on === this.deepOn) return;
    this.deepOn = on;
    for (const o of this.deep) o.visible = on;
  }

  /** Precarga: con `on`, lo de abajo se dibuja entero y sin recorte de cámara (así sus shaders y texturas se suben a la GPU antes de empezar, no con un tirón al entrar al conducto). */
  warm(on: boolean) {
    for (const o of this.deep) o.traverse((c) => (c.frustumCulled = !on));
    if (on) {
      this.deepOn = true;
      for (const o of this.deep) o.visible = true;
      for (const h of this.heads) h.visible = true;
    }
  }

  /** ¿Es una celda de los conductos? */
  inDuct(x: number, y: number) {
    const d = this.maze.duct;
    return !!d && x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1;
  }

  private mat() {
    return lit(new THREE.MeshStandardMaterial({ map: ductTex(), color: 0xc9cecd, roughness: 0.5, metalness: 0.4, emissive: 0x0a0c0c }));
  }

  /** Los conductos: un tubo de chapa de 1,25 m (suelo, techo y las paredes donde no se pasa), con bridas en cada empalme. */
  private ducts(d: NonNullable<Maze['duct']>, open: (x: number, y: number) => boolean) {
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    const quad = (v: number[][], n: number[], su: number, sv: number) => {
      const a = v[0], b = v[1], c = v[2], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0, i0 = P.length / 3;
      for (const p of v) (P.push(p[0], p[1], p[2]), N.push(n[0], n[1], n[2]));
      U.push(0, 0, su, 0, su, sv, 0, sv);
      I.push(...(flip ? [i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2] : [i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3]));
    };
    const H = DUCT_H, flanges: THREE.BufferGeometry[] = [], fb = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => flanges.push(new THREE.BoxGeometry(bw, bh, bd).translate(x, y, z));
    for (let y = d.y0; y < d.y1; y++)
      for (let x = d.x0; x < d.x1; x++) {
        if (!open(x, y)) continue;
        const x0 = x * CELL, x1 = x0 + CELL, z0 = y * CELL, z1 = z0 + CELL;
        quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, 1, 0], 1, 1);
        quad([[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]], [0, -1, 0], 1, 1);
        for (const [dx, dy] of DIRS) {
          if (open(x + dx, y + dy)) {
            // un empalme: la brida (solo una vez por borde: hacia +x y +z)
            if (dx === 1) (fb(0.07, 0.08, CELL, x1, H - 0.04, (z0 + z1) / 2), fb(0.07, H, 0.08, x1, H / 2, z0 + 0.04), fb(0.07, H, 0.08, x1, H / 2, z1 - 0.04));
            if (dy === 1) (fb(CELL, 0.08, 0.07, (x0 + x1) / 2, H - 0.04, z1), fb(0.08, H, 0.07, x0 + 0.04, H / 2, z1), fb(0.08, H, 0.07, x1 - 0.04, H / 2, z1));
            continue;
          }
          const [p0, p1] = dx ? [[dx > 0 ? x1 : x0, z0], [dx > 0 ? x1 : x0, z1]] : [[x0, dy > 0 ? z1 : z0], [x1, dy > 0 ? z1 : z0]];
          quad([[p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], H, p1[1]], [p0[0], H, p0[1]]], [-dx, 0, -dy], 1, H / CELL);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat());
    m.receiveShadow = true;
    this.group.add(m);
    const fg = flanges.length ? mergeGeometries(flanges) : null;
    if (fg) this.group.add(Object.assign(new THREE.Mesh(fg, lit(new THREE.MeshStandardMaterial({ color: 0x5b6060, roughness: 0.5, metalness: 0.5, emissive: 0x070808 }))), { receiveShadow: true }));
  }

  /** Las rejillas de ventilación: en las suites, en la cabecera del laberinto y en la sala de control. */
  private grates() {
    if (!this.maze.vents?.length) return;
    const c = canvas(128, 96), g = c.getContext('2d')!;
    g.fillStyle = '#7d8280', g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#0a0b0b';
    for (let y = 10; y < 90; y += 11) g.fillRect(10, y, 108, 6);
    g.strokeStyle = '#4d5150', g.lineWidth = 4, g.strokeRect(2, 2, 124, 92);
    const gm = lit(new THREE.MeshStandardMaterial({ map: mapOf(c), metalness: 0.5, roughness: 0.5 })), gg = new THREE.PlaneGeometry(0.8, 0.6);
    for (const v of this.maze.vents) {
      const m = new THREE.Mesh(gg, gm), [nx, nz] = DIRS[v.face] ?? DIRS[0];
      m.position.set(v.x + nx * 0.02, v.to.z > 19 * CELL && v.to.z < 22 * CELL ? 0.45 : 0.45, v.z + nz * 0.02);
      m.rotation.y = Math.atan2(nx, nz);
      this.group.add(m);
    }
  }

  /** El gas: bocanadas de humo verde (partículas grandes y suaves con textura de nube) que se arremolinan y suben despacio en cada celda con fuga. */
  private gas() {
    const cells = this.maze.gas ?? [];
    if (!cells.length) return;
    // la textura de una bocanada: varias manchas suaves superpuestas
    const pc = canvas(128, 128), pg = pc.getContext('2d')!;
    for (let i = 0; i < 14; i++) {
      const x = 64 + (hash(i, 31) - 0.5) * 56, y = 64 + (hash(i, 32) - 0.5) * 56, r = 22 + hash(i, 33) * 26, gr = pg.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)'), gr.addColorStop(1, 'rgba(255,255,255,0)');
      pg.fillStyle = gr, pg.fillRect(0, 0, 128, 128);
    }
    const N = 26, pos = new Float32Array(cells.length * N * 3), seed = new Float32Array(cells.length * N);
    cells.forEach((c, k) => {
      for (let i = 0; i < N; i++) {
        const j = k * N + i;
        pos.set([(c.x + Math.random()) * CELL, Math.random() * DUCT_H, (c.y + Math.random()) * CELL], j * 3);
        seed[j] = Math.random();
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const H = DUCT_H.toFixed(2), mat = new THREE.ShaderMaterial({
      uniforms: { uT: this.gasU, uMap: { value: mapOf(pc) } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aSeed; uniform float uT; varying float vA; varying float vS; varying float vR;
        void main() {
          float s = aSeed, h = fract(position.y / ${H} + uT * (0.025 + s * 0.04));
          vec3 p = position;
          p.y = h * ${H};
          p.x += sin(uT * (0.25 + s * 0.35) + s * 40.0) * 0.4;
          p.z += cos(uT * (0.2 + s * 0.3) + s * 70.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = max(-mv.z, 0.4);
          vA = sin(h * 3.14159) * smoothstep(0.35, 1.2, d); vS = s; vR = uT * (0.15 + s * 0.2) * (s > 0.5 ? 1.0 : -1.0) + s * 6.0;
          gl_PointSize = min((0.9 + s * 0.9) * 640.0 / d, 260.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vA; varying float vS; varying float vR;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vR), sn = sin(vR);
          vec2 uv = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y) + 0.5;
          float m = texture2D(uMap, uv).a * smoothstep(0.5, 0.2, length(q));
          vec3 col = mix(vec3(0.30, 0.62, 0.12), vec3(0.62, 0.92, 0.28), vS);
          gl_FragColor = vec4(col * (0.8 + 0.5 * m), m * vA * 0.9);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  /** Un ventilador en el fondo de cada callejón sin salida. */
  private fanBlades(open: (x: number, y: number) => boolean) {
    const fm = lit(new THREE.MeshStandardMaterial({ color: 0x575c5c, roughness: 0.5, metalness: 0.6, emissive: 0x070808 })), dark = new THREE.MeshBasicMaterial({ color: 0x050606 });
    for (const c of this.maze.fans ?? []) {
      const d = DIRS.findIndex(([dx, dy]) => open(c.x + dx, c.y + dy));
      if (d < 0) continue;
      const [dx, dy] = DIRS[d], g = new THREE.Group(), rotor = new THREE.Group();
      g.position.set((c.x + 0.5) * CELL - dx * (CELL / 2 - 0.05), 0.62, (c.y + 0.5) * CELL - dy * (CELL / 2 - 0.05));
      g.rotation.y = Math.atan2(dx, dy);
      const back = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), dark);
      back.position.z = -0.02;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 24), fm);
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.46, 0.012), fm);
        const arm = new THREE.Group().add(b);
        b.position.y = 0.26;
        b.rotation.y = 0.5;
        arm.rotation.z = (i * Math.PI * 2) / 5;
        rotor.add(arm);
      }
      rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10).rotateX(Math.PI / 2), fm));
      g.add(back, ring, rotor);
      this.group.add(g);
      this.fans.push({ rotor, v: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3) });
    }
  }

  /** De vez en cuando, una luz de emergencia tenue en el techo de los conductos (un fijo naranja con su luz). */
  private dimLights(open: (x: number, y: number) => boolean) {
    const d = this.maze.duct;
    if (!d) return;
    const cells: [number, number][] = [];
    for (let y = d.y0 + 2; y < d.y1 - 2; y++)
      for (let x = d.x0; x < d.x1; x++) if (open(x, y) && hash(x, y) < 0.07 && cells.every(([a, b]) => Math.hypot(a - x, b - y) > 4)) cells.push([x, y]);
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffa860 });
    for (const [x, y] of cells.slice(0, 6)) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.1), lamp);
      g.position.set((x + 0.5) * CELL, DUCT_H - 0.03, (y + 0.5) * CELL);
      this.cand.push({ p: new THREE.Vector3(g.position.x, DUCT_H - 0.25, g.position.z), c: 0xff9a50, i: 1.1, d: 6.5 });
      this.group.add(g);
    }
  }

  /** La sala de videovigilancia: pequeña, de hormigón y alta; pared de televisores, mesa de operadores, puesto de cámaras y terminal del EEH. */
  private control(ctl: NonNullable<Maze['control']>) {
    const g = this.group, a = this.assets, cams = this.maze.cams ?? [], m = this.maze, RH = ROOM_H;
    const x0 = ctl.x * CELL, x1 = (ctl.x + ctl.w) * CELL, zN = ctl.y * CELL, zF = (ctl.y + ctl.h) * CELL, xc = (x0 + x1) / 2;
    for (let y = ctl.y; y < ctl.y + ctl.h; y++) for (let x = ctl.x; x < ctl.x + ctl.w; x++) this.roomFloor.add(y * m.w + x);
    // el hormigón: paredes (con el hueco de la entrada del conducto) y techo
    const cmat = lit(new THREE.MeshStandardMaterial({ map: concreteTex(), color: 0xb9b9b4, roughness: 0.95, metalness: 0.02, emissive: 0x161615 }));
    const slab = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
      const bg = new THREE.BoxGeometry(bw, bh, bd), uv = bg.getAttribute('uv'), dims = [[bd, bh], [bd, bh], [bw, bd], [bw, bd], [bw, bh], [bw, bh]];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * dims[(i / 4) | 0][0]) / 2.5, (uv.getY(i) * dims[(i / 4) | 0][1]) / 2.5);
      const me = new THREE.Mesh(bg, cmat);
      me.position.set(x, y, z);
      me.castShadow = me.receiveShadow = true;
      g.add(me);
    };
    const T = 0.4;
    let gx = -1;
    for (let x = ctl.x; x < ctl.x + ctl.w; x++) if (m.open[(ctl.y - 1) * m.w + x]) gx = x; // el hueco por donde entra el conducto
    const gl = gx * CELL, gr = gl + CELL;
    if (gx < 0) slab(x1 - x0 + 2 * T, RH, T, xc, RH / 2, zN - T / 2);
    else {
      slab(gl - x0 + T, RH, T, (x0 - T + gl) / 2, RH / 2, zN - T / 2);
      slab(x1 - gr + T, RH, T, (gr + x1 + T) / 2, RH / 2, zN - T / 2);
      slab(CELL, RH - DUCT_H, T, (gl + gr) / 2, (RH + DUCT_H) / 2, zN - T / 2);
    }
    slab(x1 - x0 + 2 * T, RH, T, xc, RH / 2, zF + T / 2);
    slab(T, RH, zF - zN, x0 - T / 2, RH / 2, (zN + zF) / 2);
    slab(T, RH, zF - zN, x1 + T / 2, RH / 2, (zN + zF) / 2);
    slab(x1 - x0 + 2 * T, T, zF - zN + 2 * T, xc, RH + T / 2, (zN + zF) / 2);
    // las luces: tres tubos en el techo (fríos, tenues) con su luz
    const tube = new THREE.MeshBasicMaterial({ color: 0xd9e6ff });
    for (const x of [x0 + (x1 - x0) * 0.2, xc, x0 + (x1 - x0) * 0.8]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.22), tube);
      t.position.set(x, RH - 0.04, (zN + zF) / 2);
      this.cand.push({ p: new THREE.Vector3(x, RH - 0.6, (zN + zF) / 2), c: 0xcfe0ff, i: 3.6, d: 12 });
      g.add(t);
    }
    const plastic = lit(new THREE.MeshStandardMaterial({ color: 0x1d2020, roughness: 0.55, metalness: 0.3 })), top = lit(new THREE.MeshStandardMaterial({ color: 0x3a3f3e, roughness: 0.45, metalness: 0.3 }));
    const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, mm: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mm);
      b.position.set(x, y, z);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
    };
    // la pared de televisores: dos filas de seis (el modelo de tv), cada una con su señal falsa sobre la pantalla
    const TV_H = 0.9, tv = fitModel(a, 'suites/tv', TV_H, 'y'), ud = tv.userData as { k: number; cx: number; minY: number };
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < 6; i++) {
        const cv = canvas(112, 84), tex = mapOf(cv), cam = (r * 6 + i) % Math.max(1, cams.length), t = tv.clone(true), k = ud.k;
        // (la pantalla del modelo: en su cara +x, a 0,545 de x y centrada en y = 2,4, z = 0; 1,7 × 1,25 en sus unidades)
        const smat = new THREE.MeshBasicMaterial({ map: tex }), scr = new THREE.Mesh(new THREE.PlaneGeometry(1.7 * k, 1.25 * k), smat);
        scr.rotation.y = Math.PI / 2;
        scr.position.set((0.545 - ud.cx) * k, (2.4 - ud.minY) * k, 0);
        t.add(scr);
        t.rotation.y = Math.PI / 2; // (el frente, hacia -z: a la sala)
        t.position.set(xc + (i - 2.5) * 1.75, 0.8 + r * TV_H, zF - 0.55);
        g.add(t);
        this.feeds.push({ cv, tex, cam, mat: smat });
        this.paint(this.feeds[this.feeds.length - 1], 0);
      }
    this.roomAt = { x: xc, z: (zN + zF) / 2 };
    // la mesa de operadores y sus sillas
    box(11, 0.78, 1.0, xc, 0.39, zF - 0.55, plastic);
    box(11.1, 0.04, 1.1, xc, 0.8, zF - 0.55, top);
    for (let x = xc - 5; x <= xc + 5.1; x += 1.6) this.blockers.push({ x, z: zF - 0.55, r: 0.6 });
    const chair = fitModel(a, 'suites/officechair', 1.15, 'y');
    [-2.7, -0.9, 0.9, 2.7].forEach((dx, i) => {
      const c = chair.clone(true);
      c.position.set(xc + dx + (i % 2 ? 0.2 : -0.2), 0, zF - 2.1 - (i % 2) * 0.35);
      c.rotation.y = Math.PI * (i % 2 ? 0.9 : 1.15);
      g.add(c);
    });
    // el puesto de cámaras: tres paneles de control (más grandes) con un cartel encima
    const st = ctl.station, [snx, snz] = DIRS[st.face] ?? DIRS[0], panel = fitModel(a, 'suites/control', 1.5, 'y'), side = new THREE.Vector3(-snz, 0, snx);
    for (const t of [-1.25, 0, 1.25]) {
      const p = panel.clone(true);
      p.position.set(st.x, 0, st.z).addScaledVector(side, t);
      p.rotation.y = Math.atan2(snx, snz);
      g.add(p);
      this.blockers.push({ x: p.position.x, z: p.position.z, r: 0.65 });
    }
    const sc = canvas(384, 64), sg = sc.getContext('2d')!;
    sg.fillStyle = '#06120a', sg.fillRect(0, 0, 384, 64), (sg.strokeStyle = '#2cff7a'), (sg.lineWidth = 3), sg.strokeRect(3, 3, 378, 58);
    sg.fillStyle = '#4dff93', sg.font = 'bold 30px monospace', sg.textAlign = 'center', sg.textBaseline = 'middle', sg.fillText('SECURITY CAMERAS', 192, 34);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.34), new THREE.MeshBasicMaterial({ map: mapOf(sc) }));
    sign.position.set(st.x, 2.35, st.z);
    sign.rotation.y = Math.atan2(snx, snz);
    g.add(sign);
    box(0.05, 0.9, 0.05, st.x - 0.9, 1.9, st.z, plastic), box(0.05, 0.9, 0.05, st.x + 0.9, 1.9, st.z, plastic);
    // el terminal del EEH, contra la pared este
    const k = ctl.console, [nx, nz] = DIRS[k.face] ?? DIRS[0], eh = new THREE.Group(), cv = canvas(256, 112);
    this.eehTex = mapOf(cv);
    eh.position.set(k.x, 0, k.z);
    eh.rotation.y = Math.atan2(nx, nz);
    const tp = fitModel(a, 'suites/control', 1.5, 'y');
    tp.position.z = 0.45;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.66), new THREE.MeshBasicMaterial({ map: this.eehTex }));
    scr.position.set(0, 2.2, 0.03);
    eh.add(tp, scr);
    g.add(eh);
    this.blockers.push({ x: k.x + nx * 0.55, z: k.z + nz * 0.55, r: 0.65 });
    this.eehScreen(true);
    // los cables, por el techo (el modelo es de techo): tendidos sobre la mesa y el puesto
    const cable = fitModel(a, 'suites/cables', 1.0, 'x', { top: true });
    for (const z of [zF - 1.5, zF - 3.4, st.z - 1.0])
      for (let x = x0 + 0.5; x < x1 - 0.2; x += 1) {
        const c = cable.clone(true);
        c.position.set(x + 0.5, RH - 0.03, z + Math.sin(x * 1.7 + z) * 0.08);
        g.add(c);
      }
  }

  /** Una pantalla: estática, barras, el nombre de la cámara y la hora. */
  private paint(f: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; cam: number }, t: number) {
    const g = f.cv.getContext('2d')!, cams = this.maze.cams ?? [];
    g.fillStyle = '#0a1411', g.fillRect(0, 0, 112, 84);
    for (let i = 0; i < 90; i++) (g.fillStyle = `rgba(190,230,210,${Math.random() * 0.22})`), g.fillRect(Math.random() * 112, Math.random() * 84, 2 + Math.random() * 12, 1);
    g.fillStyle = 'rgba(120,200,160,0.12)', g.fillRect(0, (t * 30 + f.cam * 9) % 84, 112, 6);
    g.fillStyle = '#7dffb0', g.font = 'bold 11px monospace', g.textBaseline = 'top', g.fillText(cams[f.cam]?.name ?? 'NO SIGNAL', 5, 4);
    g.fillStyle = Math.floor(t * 1.5 + f.cam) % 2 ? '#ff4040' : '#401010', g.beginPath(), g.arc(102, 9, 3, 0, 7), g.fill();
    g.fillStyle = 'rgba(125,255,176,0.8)', g.font = '9px monospace', g.fillText(`CAM ${String(f.cam + 1).padStart(2, '0')}`, 5, 72);
    f.tex.needsUpdate = true;
  }

  /** Las cámaras de seguridad: el modelo de pared (la placa y el brazo, quietos; la cámara gira sobre su eje barriendo de un lado a otro). */
  private cameras() {
    const cams = this.maze.cams ?? [];
    if (!cams.length) return;
    const K = 0.45, PX = 0.06, PZ = -0.2, BACK = 0.7, MOVE = /LightBulb|Joint|CamShield|Lense|CameraBody|Buttons|knob/; // (el modelo: la pared en z = -0,7, mira a +z; el eje, en (0,06, -0,2))
    const src = this.assets.gltf['suites/camera'].scene.clone(true);
    src.updateMatrixWorld(true);
    const sets: Map<THREE.Material, THREE.BufferGeometry[]>[] = [new Map(), new Map()];
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
      const ng = g.index ? g.toNonIndexed() : g, mat = Array.isArray(m.material) ? m.material[0] : m.material, set = sets[MOVE.test(m.parent?.name ?? '') ? 1 : 0];
      set.set(mat, [...(set.get(mat) ?? []), ng]);
    });
    const body = new THREE.Group(), mov = new THREE.Group();
    mov.name = 'mov';
    mov.position.set(PX * K, 0, PZ * K);
    sets.forEach((set, k) => {
      for (const [mat, gs] of set) {
        const g = mergeGeometries(gs);
        if (!g) continue;
        const own = mat.clone();
        own.side = THREE.DoubleSide;
        (own.transparent = false), (own.depthWrite = true), (own.alphaTest = 0.5); // (el modelo viene en mezcla de alfa y sin orden se veían a través: recorte)
        lightmapped(own);
        const me = new THREE.Mesh(g, own);
        me.castShadow = me.receiveShadow = true;
        me.scale.setScalar(K);
        if (k) (me.position.set(-PX * K, 0, -PZ * K), mov.add(me));
        else body.add(me);
      }
    });
    body.add(mov);
    body.position.z = BACK * K; // (el origen, en el plano de la pared)
    const proto = new THREE.Group().add(body);
    cams.forEach((c, i) => {
      const h = proto.clone(true), [wx, wz] = c.wall ?? [0, 0], th = c.wall ? Math.atan2(-wx, -wz) : c.yaw + Math.PI;
      h.position.set(c.x + wx * 0.32, c.y - 0.3, c.z + wz * 0.32);
      h.rotation.y = th;
      h.userData = { th, mov: h.getObjectByName('mov') };
      this.group.add(h);
      this.heads[i] = h;
    });
  }

  /** La pose desde la que mira la cámara `i` en el instante `t` (barre de un lado a otro). */
  camPose(i: number, t: number) {
    const c = this.maze.cams![i], yaw = c.yaw + Math.sin(t * 0.45 + i * 1.7) * 0.55;
    return { x: c.x, y: c.y - 0.3, z: c.z, yaw, pitch: c.y > 2 ? -0.3 : -0.04 };
  }

  /** Con la vista en la cámara `i`, su propio cuerpo no se dibuja (se vería por dentro); -1 = se ven todas. */
  hideHead(i: number) {
    this.heads.forEach((h, k) => (h.visible = k !== i));
  }

  eehScreen(down: boolean) {
    if (!this.eehTex || down === this.eehShown) return;
    this.eehShown = down;
    const c = this.eehTex.image as HTMLCanvasElement, g = c.getContext('2d')!;
    g.fillStyle = '#050806', g.fillRect(0, 0, 256, 112);
    g.textAlign = 'center', g.textBaseline = 'middle';
    g.fillStyle = down ? '#ff4a3a' : '#5dff8a';
    g.font = 'bold 22px monospace', g.fillText('E.E.H. · EVAPORATOR', 128, 26);
    g.font = 'bold 30px monospace', g.fillText(down ? 'OFFLINE' : 'ONLINE', 128, 62);
    g.font = '14px monospace', g.fillText(down ? 'PRESS G TO RESTORE' : 'ALL SYSTEMS NOMINAL', 128, 92);
    this.eehTex.needsUpdate = true;
  }

  /** De vez en cuando, uno de los televisores enseña lo que ve de verdad una cámara de seguridad (se pinta el mundo a una textura pequeña unas 6 veces por segundo, solo si estás en la sala). */
  renderLive(r: THREE.WebGLRenderer, scene: THREE.Scene, t: number, dt: number, at: { x: number; z: number }) {
    const room = this.roomAt, cams = this.maze.cams ?? [];
    if (!room || !cams.length || !this.feeds.length) return;
    const L = (this.live ??= { rt: new THREE.WebGLRenderTarget(256, 192), cam: new THREE.PerspectiveCamera(62, 4 / 3, 0.1, 40), tv: -1, src: 0, until: 0, next: t + 6, acc: 0 });
    const near = Math.hypot(at.x - room.x, at.z - room.z) < 16, show = (i: number, on: boolean) => {
      const f = this.feeds[i];
      if (f?.mat) ((f.mat.map = on ? L.rt.texture : f.tex), (f.mat.needsUpdate = true));
    };
    if (L.tv >= 0 && (t > L.until || !near)) (show(L.tv, false), (L.tv = -1), (L.next = t + 15 + Math.random() * 25));
    if (L.tv < 0 && near && t > L.next) {
      L.tv = (Math.random() * this.feeds.length) | 0;
      L.src = (Math.random() * cams.length) | 0;
      L.until = t + 8 + Math.random() * 8;
      show(L.tv, true);
    }
    if (L.tv < 0) return;
    L.acc += dt;
    if (L.acc < 0.16) return;
    L.acc = 0;
    const p = this.camPose(L.src, t);
    L.cam.position.set(p.x, p.y, p.z);
    L.cam.quaternion.setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
    L.cam.updateMatrixWorld(true);
    const prev = r.getRenderTarget();
    r.setRenderTarget(L.rt);
    r.render(scene, L.cam);
    r.setRenderTarget(prev);
  }

  update(t: number, dt: number) {
    this.gasU.value = t;
    for (const f of this.fans) f.rotor.rotation.z += f.v * dt;
    this.heads.forEach((h, i) => {
      const p = this.camPose(i, t);
      (h.userData.mov as THREE.Object3D).rotation.y = p.yaw + Math.PI - h.userData.th; // (solo gira la cámara; la placa y el brazo se quedan)
    });
    // las pantallas de la sala de control: una por fotograma, unas 6 veces por segundo cada una
    this.feedT += dt;
    if (this.feeds.length && this.feedT > 0.016) {
      this.feedT = 0;
      this.paint(this.feeds[this.feedI++ % this.feeds.length], t);
    }
  }
}
