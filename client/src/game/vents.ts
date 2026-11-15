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
export const DUCT_H = 1.25;
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
    lightmapped(own);
    const me = new THREE.Mesh(g, own);
    me.castShadow = me.receiveShadow = true;
    out.add(me);
  }
  out.scale.setScalar(k);
  out.position.set(-c.x * k, -(opts.top ? b.max.y : b.min.y) * k, -c.z * k);
  return new THREE.Group().add(out);
}

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
  private feeds: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; cam: number }[] = [];
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
    if (maze.control) this.control(maze.control);
    this.cameras();
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

  /** El gas: nubes de partículas suaves que se arremolinan en cada celda con fuga. */
  private gas() {
    const cells = this.maze.gas ?? [];
    if (!cells.length) return;
    const N = 34, pos = new Float32Array(cells.length * N * 3), seed = new Float32Array(cells.length * N);
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
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: this.gasU },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aSeed; uniform float uT; varying float vA; varying float vS;
        void main() {
          float s = aSeed, h = fract(position.y / ${DUCT_H.toFixed(2)} + uT * (0.03 + s * 0.05));
          vec3 p = position;
          p.y = h * ${DUCT_H.toFixed(2)};
          p.x += sin(uT * (0.3 + s * 0.4) + s * 40.0) * 0.32;
          p.z += cos(uT * (0.25 + s * 0.35) + s * 70.0) * 0.32;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = max(-mv.z, 0.4);
          vA = sin(h * 3.14159); vS = s;
          gl_PointSize = min((0.4 + s * 0.6) * 560.0 / d, 260.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying float vS;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = length(q) * 2.0, a = smoothstep(1.0, 0.0, r);
          a *= a * (0.8 + 0.2 * sin(atan(q.y, q.x) * 3.0 + vS * 20.0));
          gl_FragColor = vec4(mix(vec3(0.38, 0.78, 0.2), vec3(0.62, 0.95, 0.35), vS), a * vA * 0.24);
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

  /** La sala de videovigilancia. */
  private control(ctl: NonNullable<Maze['control']>) {
    const g = this.group, a = this.assets, cams = this.maze.cams ?? [];
    const x0 = ctl.x * CELL, x1 = (ctl.x + ctl.w) * CELL, zF = (ctl.y + ctl.h) * CELL;
    for (let y = ctl.y; y < ctl.y + ctl.h; y++) for (let x = ctl.x; x < ctl.x + ctl.w; x++) this.roomFloor.add(y * this.maze.w + x);
    const plastic = lit(new THREE.MeshStandardMaterial({ color: 0x1d2020, roughness: 0.55, metalness: 0.3 })), top = lit(new THREE.MeshStandardMaterial({ color: 0x3a3f3e, roughness: 0.45, metalness: 0.3 }));
    const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
      b.position.set(x, y, z);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      return b;
    };
    // la pared del fondo: dos filas de monitores, cada uno con su señal (estática y el nombre de la cámara)
    const xs = Array.from({ length: 6 }, (_, i) => x0 + 3 + i * 3);
    for (const [r, y] of [[0, 1.2], [1, 1.95]] as const)
      xs.forEach((x, i) => {
        const cv = canvas(112, 84), tex = mapOf(cv), mon = new THREE.Group(), cam = (r * 6 + i) % Math.max(1, cams.length);
        mon.position.set(x, y, zF - 0.19);
        mon.rotation.y = Math.PI;
        mon.add(new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.64, 0.32), plastic));
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.52), new THREE.MeshBasicMaterial({ map: tex }));
        scr.position.z = 0.162;
        mon.add(scr);
        g.add(mon);
        this.feeds.push({ cv, tex, cam });
        this.paint(this.feeds[this.feeds.length - 1], 0);
      });
    // la mesa de operadores y sus sillas
    box(18.6, 0.72, 0.8, (x0 + x1) / 2, 0.36, zF - 0.95, plastic);
    box(18.8, 0.04, 0.9, (x0 + x1) / 2, 0.74, zF - 0.95, top);
    for (let x = x0 + 1; x < x1 - 0.5; x += 1.5) this.blockers.push({ x, z: zF - 0.95, r: 0.55 });
    const chair = fitModel(a, 'suites/officechair', 1.0, 'y');
    [xs[0], xs[2], xs[3], xs[5]].forEach((x, i) => {
      const c = chair.clone(true);
      c.position.set(x + (i % 2 ? 0.3 : -0.2), 0, zF - 2.2 - (i % 2) * 0.4);
      c.rotation.y = Math.PI * (i % 2 ? 0.9 : 1.15);
      g.add(c);
    });
    for (const x of xs) box(0.46, 0.025, 0.17, x, 0.775, zF - 1.35, plastic);
    // el puesto de cámaras: tres paneles de control con un cartel encima
    const st = ctl.station, [snx, snz] = DIRS[st.face] ?? DIRS[0], panel = fitModel(a, 'suites/control', 1.05, 'y');
    for (const t of [-0.95, 0, 0.95]) {
      const p = panel.clone(true);
      p.position.set(st.x, 0, st.z).addScaledVector(new THREE.Vector3(-snz, 0, snx), t);
      p.rotation.y = Math.atan2(snx, snz);
      g.add(p);
      this.blockers.push({ x: p.position.x, z: p.position.z, r: 0.5 });
    }
    const sc = canvas(384, 64), sg = sc.getContext('2d')!;
    sg.fillStyle = '#06120a', sg.fillRect(0, 0, 384, 64), (sg.strokeStyle = '#2cff7a'), (sg.lineWidth = 3), sg.strokeRect(3, 3, 378, 58);
    sg.fillStyle = '#4dff93', sg.font = 'bold 30px monospace', sg.textAlign = 'center', sg.textBaseline = 'middle', sg.fillText('SECURITY CAMERAS', 192, 34);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.27), new THREE.MeshBasicMaterial({ map: mapOf(sc) }));
    sign.position.set(st.x, 1.75, st.z).addScaledVector(new THREE.Vector3(snx, 0, snz), 0.0);
    sign.rotation.y = Math.atan2(snx, snz);
    g.add(sign);
    box(0.05, 0.6, 0.05, st.x - 0.7, 1.45, st.z, plastic), box(0.05, 0.6, 0.05, st.x + 0.7, 1.45, st.z, plastic);
    // el terminal del EEH, contra la pared este
    const k = ctl.console, [nx, nz] = DIRS[k.face] ?? DIRS[0], eh = new THREE.Group(), cv = canvas(256, 112);
    this.eehTex = mapOf(cv);
    eh.position.set(k.x, 0, k.z);
    eh.rotation.y = Math.atan2(nx, nz);
    const tp = fitModel(a, 'suites/control', 1.0, 'y');
    tp.position.z = 0.32;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.57), new THREE.MeshBasicMaterial({ map: this.eehTex }));
    scr.position.set(0, 1.55, 0.03);
    eh.add(tp, scr);
    g.add(eh);
    this.blockers.push({ x: k.x + nx * 0.4, z: k.z + nz * 0.4, r: 0.5 });
    this.eehScreen(true);
    // los cables por el suelo: de la mesa al puesto, y algunos sueltos
    const cable = fitModel(a, 'suites/cables', 1.0, 'x');
    const lay = (x: number, z: number, ry: number) => {
      const c = cable.clone(true);
      c.position.set(x, 0.01, z);
      c.rotation.y = ry;
      g.add(c);
    };
    for (const x of [xs[1], xs[2] + 0.2, xs[3] - 0.2, xs[4]]) for (let z = zF - 1.6; z > st.z + 0.5; z -= 1) lay(x + (x < st.x ? 1 : -1) * (zF - 1.6 - z) * 0.18, z, Math.PI / 2 + (x < st.x ? 0.18 : -0.18));
    for (let i = 0; i < 8; i++) lay(x0 + 1 + hash(i, 40) * (x1 - x0 - 2), (ctl.y + 0.5 + hash(i, 41) * 4.2) * CELL, hash(i, 42) * 3.1);
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

  /** Las cámaras de seguridad (el modelo, colgado del techo, girando despacio hacia donde miran). */
  private cameras() {
    const cams = this.maze.cams ?? [];
    if (!cams.length) return;
    const proto = fitModel(this.assets, 'suites/camera', 0.5, 'z', { roll: Math.PI, top: true });
    cams.forEach((c, i) => {
      const h = proto.clone(true);
      h.position.set(c.x, c.y + 0.03, c.z);
      this.group.add(h);
      this.heads[i] = h;
    });
  }

  /** La pose desde la que mira la cámara `i` en el instante `t` (barre de un lado a otro). */
  camPose(i: number, t: number) {
    const c = this.maze.cams![i], yaw = c.yaw + Math.sin(t * 0.45 + i * 1.7) * 0.55;
    return { x: c.x, y: c.y - 0.1, z: c.z, yaw, pitch: c.y > 2 ? -0.3 : -0.04 };
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

  update(t: number, dt: number) {
    this.gasU.value = t;
    for (const f of this.fans) f.rotor.rotation.z += f.v * dt;
    this.heads.forEach((h, i) => {
      const p = this.camPose(i, t);
      h.rotation.y = p.yaw + Math.PI;
    });
    // las pantallas de la sala de control: una por fotograma, unas 6 veces por segundo cada una
    this.feedT += dt;
    if (this.feeds.length && this.feedT > 0.016) {
      this.feedT = 0;
      this.paint(this.feeds[this.feedI++ % this.feeds.length], t);
    }
  }
}
