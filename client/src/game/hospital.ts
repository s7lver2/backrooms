import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Assets } from './game';

/*
 * El pasillo de hospital de «Run for your life» (runlevel.ts lo mete en su escena): paredes, suelo de linóleo, falso techo, puertas,
 * pasamanos y fluorescentes, todo instanciado por tramos de BAY metros con texturas dibujadas en canvas (sin ficheros). Limpio pero
 * abandonado, y casi a oscuras: solo luces los fluorescentes que quedan vivos (parpadean, alguno se apaga al pasar), los carteles de
 * EXIT en verde y una luz mínima del propio jugador. A los lados hay aberturas a pasillos negros por los que no se puede entrar:
 * de ahí sale lo que cae o rueda hacia el camino (lo lleva runlevel.ts).
 */

export const HW = 2.3; // medio ancho del pasillo
export const H = 2.9; // altura del falso techo
export const BAY = 4; // largo de cada tramo
export const OPEN = 2.6; // ancho de una abertura lateral
export const OPEN_H = 2.45;

export function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un modelo del pack a una medida (`size` m a lo largo del eje `axis`), apoyado en y = 0 y centrado en x/z. */
export function fit(g: GLTF, size: number, axis: 'x' | 'y' | 'z' = 'y') {
  const o = g.scene.clone(true), b = new THREE.Box3().setFromObject(o), s = size / (b.max[axis] - b.min[axis]);
  o.scale.setScalar(s);
  o.position.set((-(b.min.x + b.max.x) / 2) * s, -b.min.y * s, (-(b.min.z + b.max.z) / 2) * s);
  return new THREE.Group().add(o);
}

type Ctx = CanvasRenderingContext2D;

/** Una textura dibujada en canvas; el ruido fino se añade al final (`grain`, en niveles de 0–255). */
function paint(w: number, h: number, seed: number, grain: number, draw: (x: Ctx, r: () => number) => void) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d')!, r = mulberry(seed);
  draw(x, r);
  if (grain) {
    const im = x.getImageData(0, 0, w, h), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * grain;
      d[i] += n, d[i + 1] += n, d[i + 2] += n;
    }
    x.putImageData(im, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Manchas suaves de brillo (pintura que no es perfecta, nada de suciedad): `n` círculos grandes y muy tenues. */
function mottle(x: Ctx, r: () => number, w: number, h: number, n: number, rad: number, a: number) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    x.beginPath();
    x.arc(r() * w, r() * h, rad * (0.4 + r()), 0, 7);
    x.fill();
  }
}

/** Linóleo gris verdoso: baldosas de 1 m con su junta, 2 × 2 m por textura. */
const floorTex = () =>
  paint(512, 512, 11, 9, (x, r) => {
    for (let i = 0; i < 4; i++) {
      const g = 128 + ((r() - 0.5) * 14) | 0;
      x.fillStyle = `rgb(${g - 6},${g + 4},${g})`;
      x.fillRect((i % 2) * 256, ((i / 2) | 0) * 256, 256, 256);
    }
    mottle(x, r, 512, 512, 90, 40, 0.025);
    for (let i = 0; i < 2600; i++) { // las motas del linóleo
      x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      x.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
    }
    x.fillStyle = 'rgba(30,38,35,0.85)';
    for (const p of [0, 256]) x.fillRect(p - 1.5, 0, 3, 512), x.fillRect(0, p - 1.5, 512, 3);
    x.fillRect(510, 0, 2, 512), x.fillRect(0, 510, 512, 2);
  });

/** Pared de 2 m de ancho y 3 de alto (v = y / 3): arriba crema, abajo verde hasta el pasamanos, zócalo oscuro. */
const wallTex = () =>
  paint(512, 768, 23, 8, (x, r) => {
    const Y = (m: number) => (1 - m / 3) * 768;
    x.fillStyle = '#d6d8cd';
    x.fillRect(0, 0, 512, 768);
    x.fillStyle = '#5f8279';
    x.fillRect(0, Y(1.1), 512, Y(0.12) - Y(1.1));
    x.fillStyle = '#e9e7dc'; // el listón del pasamanos
    x.fillRect(0, Y(1.16), 512, Y(1.1) - Y(1.16));
    x.fillStyle = '#2d3633';
    x.fillRect(0, Y(0.12), 512, Y(0) - Y(0.12));
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, Y(0.12), 512, 2);
    mottle(x, r, 512, 768, 110, 60, 0.02);
    for (let i = 0; i < 260; i++) { // rodillo: vetas verticales casi invisibles
      x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)';
      x.fillRect(r() * 512, 0, 1 + r() * 3, 768);
    }
    const sh = (y0: number, y1: number, a: number) => { // sombra de oclusión contra techo y suelo
      const gr = x.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, `rgba(0,0,0,${a})`), gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.fillRect(0, Math.min(y0, y1), 512, Math.abs(y1 - y0));
    };
    sh(0, 90, 0.35), sh(768, 640, 0.3);
  });

/** Falso techo: placas de 60 × 60 cm con su perfil y los poros, 1,2 × 1,2 m por textura. */
const ceilTex = () =>
  paint(512, 512, 37, 10, (x, r) => {
    x.fillStyle = '#c9cbc3';
    x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5200; i++) {
      x.fillStyle = 'rgba(60,64,58,0.30)';
      x.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1);
    }
    mottle(x, r, 512, 512, 60, 50, 0.02);
    x.fillStyle = '#7d817b';
    for (const p of [0, 256]) x.fillRect(p - 2, 0, 4, 512), x.fillRect(0, p - 2, 512, 4);
  });

/** Puerta de 1,1 × 2,1 m: pintura gris azulada, ventanuco oscuro, chapa en la base y una placa de número. */
const doorTex = (n: number) =>
  paint(256, 512, 50 + n, 6, (x, r) => {
    x.fillStyle = '#a9b8b2';
    x.fillRect(0, 0, 256, 512);
    x.strokeStyle = 'rgba(0,0,0,0.28)';
    x.lineWidth = 5;
    x.strokeRect(14, 14, 228, 484);
    x.fillStyle = '#9aa4a1';
    x.fillRect(10, 410, 236, 90);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(10, 410, 236, 3);
    const gr = x.createLinearGradient(0, 70, 0, 230);
    gr.addColorStop(0, '#0c1517'), gr.addColorStop(1, '#040708');
    x.fillStyle = '#d9d9d0'; // el marco del ventanuco
    x.fillRect(66, 66, 124, 172);
    x.fillStyle = gr;
    x.fillRect(74, 74, 108, 156);
    x.fillStyle = '#e8e8e0';
    x.fillRect(96, 262, 64, 30);
    x.fillStyle = '#233';
    x.font = 'bold 22px sans-serif';
    x.textAlign = 'center';
    x.fillText(String(100 + ((r() * 90) | 0) * 1 + n), 128, 285);
    x.fillStyle = '#6e7773';
    x.beginPath();
    x.arc(214, 270, 9, 0, 7);
    x.fill();
    mottle(x, r, 256, 512, 30, 40, 0.025);
  });

/** Cartel de pared (planta o sala) para los pocos que se leen: letras blancas sobre azul de hospital. */
const signTex = (txt: string, arrow: string) =>
  paint(512, 128, 77, 4, (x) => {
    x.fillStyle = '#1d4a73';
    x.fillRect(0, 0, 512, 128);
    x.strokeStyle = '#e8eef2';
    x.lineWidth = 4;
    x.strokeRect(6, 6, 500, 116);
    x.fillStyle = '#eef3f5';
    x.font = 'bold 54px sans-serif';
    x.textAlign = 'left';
    x.textBaseline = 'middle';
    x.fillText(txt, 28, 68);
    x.font = 'bold 70px sans-serif';
    x.textAlign = 'right';
    x.fillText(arrow, 484, 66);
  });

/** El cartel EXIT: una caja verde con la palabra y la flecha (se enciende y se apaga). */
const exitTex = () =>
  paint(256, 96, 91, 0, (x) => {
    x.fillStyle = '#2a0504';
    x.fillRect(0, 0, 256, 96);
    x.strokeStyle = '#ff4a3a';
    x.lineWidth = 3;
    x.strokeRect(4, 4, 248, 88);
    x.fillStyle = '#ff6a58';
    x.font = 'bold 56px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('EXIT', 128, 52);
  });

/** La esfera del reloj (el modelo pone el aro): blanco hueso, marcas y cifras. */
const clockFace = () =>
  paint(256, 256, 63, 5, (x) => {
    x.fillStyle = '#e7e5da';
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#16181a';
    x.font = 'bold 34px serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) x.fillText(String(i), 128 + Math.sin((i * Math.PI) / 6) * 92, 128 - Math.cos((i * Math.PI) / 6) * 92);
  });

export interface Slot {
  z: number;
  side: -1 | 1;
}

interface Fix {
  z: number;
  kind: 0 | 1 | 2; // 0 muerto, 1 vivo con parpadeos, 2 vivo y se apaga al pasar el jugador
  ph: number;
  b: number; // brillo actual (0–1)
  dying: number; // desde cuándo se apaga (s; -1 aún no)
  off: boolean;
}

interface Clock {
  z: number;
  g: THREE.Group;
  hands: THREE.Object3D[];
  a: number[];
  v: number[];
  next: number;
}

const _m = new THREE.Matrix4();

export class Hospital {
  readonly group = new THREE.Group();
  readonly openings: Slot[] = [];
  readonly solids: Slot[] = []; // tramos de pared llenos que quedan sin puerta fija ni utillaje: para las puertas que se abren de golpe
  /** Lo que ocupa cada objeto arrimado a las paredes (cajas del mundo): runlevel.ts los vuelve sólidos, con margen. */
  readonly colliders: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[] = [];
  readonly zEnd: number;
  /** Un fluorescente que se apaga o revienta: z, para el sonido. */
  onPop?: (z: number) => void;
  /** Luces móviles (las pone runlevel.ts en la escena): las 2 de los fluorescentes y las 2 de los carteles. */
  readonly lights: THREE.PointLight[] = [];
  private fl = [0, 1, 2].map(() => new THREE.PointLight(0xff1a10, 0, 14, 2));
  private gl = [0, 1].map(() => new THREE.PointLight(0xff1a10, 0, 9, 2));
  private flIdx = [-1, -1, -1];
  private glIdx = [-1, -1];
  private fixtures: Fix[] = [];
  private glow!: THREE.InstancedMesh;
  private signs: { z: number; m: THREE.MeshBasicMaterial; ph: number }[] = [];
  private clocks: Clock[] = [];
  private owned: { dispose(): void }[] = [];
  private doorM!: THREE.MeshStandardMaterial;
  private doorG = new THREE.BoxGeometry(0.08, 2.1, 1.1);

  constructor(assets: Assets, total: number, back: number, rnd: () => number, private reduced: boolean) {
    const n = Math.ceil(total / BAY), z0 = -back, zc = (i: number) => z0 + BAY * (i + 0.5);
    this.zEnd = z0 + n * BAY;
    this.lights.push(...this.fl, ...this.gl);
    const own = <T extends { dispose(): void }>(o: T) => (this.owned.push(o), o);
    const std = (map: THREE.Texture | null, rough: number, color = 0xffffff, side: THREE.Side = THREE.FrontSide) =>
      own(new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, color, side }));
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, at: [number, number, number][]) => {
      const im = new THREE.InstancedMesh(own(g), m, Math.max(1, at.length));
      im.count = at.length;
      at.forEach((p, i) => im.setMatrixAt(i, _m.makeTranslation(...p)));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
      return im;
    };
    const tex = (t: THREE.Texture) => own(t);
    /** Un cuadrado vertical en la pared de `side` (mira hacia dentro): z de -dz/2 a dz/2 y y de y0 a y1; la textura va por metros. */
    const wall = (side: -1 | 1, dz: number, y0: number, y1: number) => {
      const g = new THREE.BufferGeometry(), a = -dz / 2, b = dz / 2;
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, y0, a, 0, y0, b, 0, y1, b, 0, y1, a], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([-side, 0, 0, -side, 0, 0, -side, 0, 0, -side, 0, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([a / 2, y0 / 3, b / 2, y0 / 3, b / 2, y1 / 3, a / 2, y1 / 3], 2));
      g.setIndex(side < 0 ? [0, 3, 1, 1, 3, 2] : [0, 1, 3, 1, 2, 3]);
      return g;
    };

    // el reparto de tramos: aberturas laterales cada 3–5 tramos por lado, el resto de pared maciza
    const open = [new Set<number>(), new Set<number>()];
    for (const s of [0, 1]) for (let i = 4 + s * 2; i < n - 4; i += 3 + ((rnd() * 3) | 0)) open[s].add(i);
    const lintelAt: [number, number, number][][] = [[], []];
    const rooms: [number, number, number][] = [], rails: [number, number, number][] = [], doors: [number, number, number][] = [], doorsB: [number, number, number][] = [];
    for (let i = 0; i < n; i++)
      for (const s of [0, 1]) {
        const side = (s ? 1 : -1) as -1 | 1, z = zc(i), x = side * HW;
        if (open[s].has(i)) {
          this.openings.push({ z, side });
          lintelAt[s].push([x, 0, z]);
          rooms.push([side * (HW + 2.5), (OPEN_H + 0.1) / 2, z]);
        } else {
          rails.push([side * (HW - 0.045), 0.93, z]);
          if (rnd() < 0.55) (s ? doors : doorsB).push([side * (HW - 0.04), 1.05, z + (rnd() - 0.5) * 1.2]);
          else this.solids.push({ z, side });
        }
      }
    // las piezas de pared: entera, jamba (0,7 m) y dintel (sobre la abertura)
    const wm = std(tex(wallTex()), 0.62);
    for (const s of [0, 1]) {
      const side = (s ? 1 : -1) as -1 | 1, full: [number, number, number][] = [];
      for (let i = 0; i < n; i++) if (!open[s].has(i)) full.push([side * HW, 0, zc(i)]);
      inst(wall(side, BAY, 0, H), wm, full);
      const jambs: [number, number, number][] = [];
      for (const p of lintelAt[s]) jambs.push([p[0], 0, p[2] - (OPEN + BAY) / 4], [p[0], 0, p[2] + (OPEN + BAY) / 4]);
      inst(wall(side, (BAY - OPEN) / 2, 0, H), wm, jambs);
      inst(wall(side, OPEN, OPEN_H, H), wm, lintelAt[s]);
    }
    // suelo y techo
    const fg = new THREE.PlaneGeometry(HW * 2, BAY).rotateX(-Math.PI / 2), fuv = fg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, (fg.attributes.position.getX(i)) / 2, -fg.attributes.position.getZ(i) / 2);
    const cg = new THREE.PlaneGeometry(HW * 2, BAY).rotateX(Math.PI / 2), cuv = cg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cg.attributes.position.getX(i) / 1.2, cg.attributes.position.getZ(i) / 1.2);
    const bays = Array.from({ length: n }, (_, i) => i);
    inst(fg, std(tex(floorTex()), 0.32), bays.map((i) => [0, 0, zc(i)]));
    inst(cg, std(tex(ceilTex()), 0.9), bays.map((i) => [0, H, zc(i)]));
    // pasamanos, puertas y los cuartos negros detrás de las aberturas
    inst(new THREE.BoxGeometry(0.06, 0.06, BAY - 0.1), std(null, 0.5, 0xb8a98c), rails);
    const dm = std(tex(doorTex(0)), 0.5), dg = this.doorG;
    this.doorM = std(tex(doorTex(3)), 0.5);
    inst(dg, dm, doors);
    inst(dg, std(tex(doorTex(7)), 0.5), doorsB);
    inst(new THREE.BoxGeometry(5, OPEN_H + 0.1, OPEN), std(null, 1, 0x0b0d0c, THREE.BackSide), rooms);

    // los fluorescentes: caja metálica (iluminada) y panel que brilla (el brillo de cada uno se mueve por instancia)
    const frame = inst(new THREE.BoxGeometry(0.64, 0.07, 1.26), std(null, 0.7, 0x9aa09c), bays.map((i) => [0, H - 0.035, zc(i)]));
    frame.name = 'frame';
    this.glow = inst(new THREE.PlaneGeometry(0.52, 1.14).rotateX(Math.PI / 2), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), bays.map((i) => [0, H - 0.072, zc(i)]));
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (const i of bays) {
      const alive = i % 4 === 2 || rnd() < 0.08;
      this.fixtures.push({ z: zc(i), kind: alive ? (rnd() < 0.35 ? 2 : 1) : 0, ph: rnd() * 40, b: 0, dying: -1, off: !alive });
    }

    // lo que da vida: carteles de EXIT colgados, relojes, extintores, taquillas y camillas aparcadas, cortinas
    const gl = assets.gltf;
    const et = tex(exitTex());
    for (let z = 10, k = 0; z < this.zEnd - 6; z += 34 + rnd() * 10, k++) {
      const m = own(new THREE.MeshBasicMaterial({ map: et, color: 0xffffff })), box = new THREE.Mesh(own(new THREE.BoxGeometry(0.62, 0.24, 0.07)), [std(null, 0.6, 0x1b201d), std(null, 0.6, 0x1b201d), std(null, 0.6, 0x1b201d), std(null, 0.6, 0x1b201d), m, m]);
      box.position.set(0, H - 0.34, z);
      const rod = new THREE.Mesh(own(new THREE.CylinderGeometry(0.01, 0.01, 0.2)), std(null, 0.6, 0x222222));
      rod.position.set(0, H - 0.1, z);
      this.group.add(box, rod);
      this.signs.push({ z, m, ph: rnd() * 30 });
    }
    // relojes en la pared (los de aro del modelo; esfera y agujas propias, que giran enloquecidas)
    const face = tex(clockFace()), faceM = own(new THREE.MeshBasicMaterial({ map: face, color: 0x6a1410 })), handG = own(new THREE.BoxGeometry(0.012, 1, 0.004)), handM = [0xe9e9e9, 0xe9e9e9, 0xb02a24].map((c) => own(new THREE.MeshBasicMaterial({ color: c })));
    const sol = this.solids.slice();
    for (let k = 0; k < sol.length; k += 5 + ((rnd() * 4) | 0)) {
      const s = sol[k];
      const g = new THREE.Group(), disc = new THREE.Mesh(own(new THREE.CircleGeometry(0.2, 32)), faceM);
      disc.position.z = 0.05;
      g.add(fit(gl['hospital/clock'], 0.46, 'x'), disc);
      const hands = [0.11, 0.16, 0.17].map((len, i) => {
        const pv = new THREE.Group(), h = new THREE.Mesh(handG, handM[i]);
        h.scale.set(i === 2 ? 0.5 : 1.6, len, 1);
        h.position.y = len / 2;
        pv.add(h);
        pv.position.z = 0.055 + i * 0.004;
        g.add(pv);
        return pv;
      });
      g.position.set(s.side * (HW - 0.03), 2.15, s.z);
      g.rotation.y = s.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(g);
      this.clocks.push({ z: s.z, g, hands, a: [rnd() * 6, rnd() * 6, rnd() * 6], v: [3, 9, 25], next: 0 });
    }
    this.props(assets, rnd);
    this.group.add(...this.lights);
    this.update(0, 0, 0);
  }

  /** Utillaje de hospital arrimado a las paredes: taquillas, estantes, sillas de ruedas, goteros, camillas aparcadas, extintores. */
  private props(assets: Assets, rnd: () => number) {
    const gl = assets.gltf;
    for (const m of Object.values(gl)) m.scene.traverse((o) => {
      const k = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (k?.isMeshStandardMaterial) k.metalness = Math.min(k.metalness, 0.3);
    });
    const kinds = ['locker', 'locker', 'shelf', 'wheelchair', 'drip', 'stretcher', 'stools', 'ext'];
    // la caja de cada objeto ya colocado (su sitio y giro finales), para que se pueda chocar con él
    const solid = (o: THREE.Object3D) => {
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o);
      this.colliders.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y0: b.min.y, y1: b.max.y });
    };
    for (const s of this.solids) {
      if (rnd() < 0.45) continue;
      const k = kinds[(rnd() * kinds.length) | 0], x = s.side * (HW - 0.38), z = s.z + (rnd() - 0.5) * 1.4, yaw = s.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      let o: THREE.Object3D;
      if (k === 'locker') o = fit(gl['hospital/locker'], 1.9);
      else if (k === 'shelf') o = fit(gl['hospital/shelf'], 1.8);
      else if (k === 'wheelchair') o = fit(gl['hospital/wheelchair'], 0.95);
      else if (k === 'drip') o = fit(gl['hospital/drip'], 1.9);
      else if (k === 'stretcher') o = fit(gl['hospital/stretcher'], 2.0, 'x');
      else if (k === 'stools') o = fit(gl['hospital/stools'], 1);
      else {
        o = fit(gl['hospital/extinguisher'], 0.55);
        o.position.set(s.side * (HW - 0.12), 0.95, s.z + 1.2);
        this.group.add(o);
        solid(o);
        const c = fit(gl['hospital/cupboard'], 0.66);
        c.position.set(s.side * (HW - 0.01), 1.3, s.z - 1);
        c.rotation.y = s.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        this.group.add(c);
        solid(c);
        continue;
      }
      o.position.set(x, 0, z);
      o.rotation.y = yaw + (k === 'stretcher' ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.25;
      this.group.add(o);
      solid(o);
    }
  }

  /** Una hoja de puerta suelta (para las que se abren de golpe): la cara pintada mira a la pared de enfrente. */
  door(_side: -1 | 1) {
    return new THREE.Mesh(this.doorG, this.doorM);
  }

  /** Brillo del fluorescente `f` en el instante `t`: los vivos tiemblan a ratos; el que se apaga lo hace con tartamudeo. */
  private bright(f: Fix, t: number, pz: number) {
    if (f.kind === 0 || f.off) return 0;
    if (f.kind === 2 && f.dying < 0 && f.z - pz < 7 && f.z - pz > -2) (f.dying = t), this.onPop?.(f.z);
    if (f.dying >= 0) {
      const d = t - f.dying;
      if (d > 0.9) return (f.off = true), 0;
      return this.reduced ? 1 - d / 0.9 : Math.sin(d * 52) > -0.2 ? 1 - d / 1.4 : 0.05;
    }
    const cyc = (t * 0.27 + f.ph) % 1; // un tartamudeo de medio segundo cada 4 s más o menos
    if (cyc > 0.13) return 0.92 + 0.08 * Math.sin(t * 90 + f.ph);
    return this.reduced ? 0.55 + 0.35 * Math.sin(t * 9 + f.ph) : Math.sin(t * 61 + f.ph) * Math.sin(t * 23 + f.ph * 2) > 0 ? 1 : 0.12;
  }

  /** Un fluorescente cualquiera revienta (z más cercana por delante): lo apaga y devuelve su z. */
  burst(z: number) {
    let best: Fix | undefined;
    for (const f of this.fixtures) if (!f.off && f.kind && (!best || Math.abs(f.z - z) < Math.abs(best.z - z))) best = f;
    if (best && Math.abs(best.z - z) < 8) (best.dying = -2), (best.off = false);
    return best?.z;
  }

  update(t: number, pz: number, dt: number) {
    const ic = this.glow.instanceColor!;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      if (Math.abs(f.z - pz) > 42) continue;
      if (f.dying === -2) f.dying = t; // revienta ya
      f.b = this.bright(f, t, pz);
      ic.setXYZ(i, f.b, f.b * 0.08, f.b * 0.05);
    }
    ic.needsUpdate = true;
    // las luces móviles: cada una sigue a un fluorescente vivo; si se queda atrás, salta al siguiente por delante (lejos, tapado por la niebla)
    const take = (idx: number[], pool: THREE.PointLight[], zs: (i: number) => number, count: number, ok: (i: number) => boolean, y: number, gain: (i: number) => number) => {
      pool.forEach((l, k) => {
        let i = idx[k];
        if (i < 0 || zs(i) < pz - 9 || !ok(i)) {
          i = -1;
          for (let j = 0; j < count; j++)
            if (zs(j) > pz - 4 && ok(j) && !idx.includes(j) && (i < 0 || zs(j) < zs(i))) i = j;
          idx[k] = i;
        }
        if (i < 0) return void (l.intensity = 0);
        l.position.set(0, y, zs(i));
        l.intensity = gain(i);
      });
    };
    take(this.flIdx, this.fl, (i) => this.fixtures[i].z, this.fixtures.length, (i) => !this.fixtures[i].off && this.fixtures[i].kind > 0, H - 0.3, (i) => 9 * this.fixtures[i].b);
    take(this.glIdx, this.gl, (i) => this.signs[i].z, this.signs.length, () => true, H - 0.7, (i) => 1.2 * this.signs[i].m.color.r / 0.12);
    // carteles de EXIT: parpadean en rojo, uno con más ganas
    for (const s of this.signs) {
      if (Math.abs(s.z - pz) > 50) continue;
      const q = (t * 0.6 + s.ph) % 1, v = q < 0.16 ? (Math.sin(t * 47 + s.ph) > 0 ? 1 : 0.15) : 0.85 + 0.15 * Math.sin(t * 3 + s.ph);
      const k = this.reduced ? 0.35 + 0.65 * (0.6 + 0.4 * Math.sin(t * 2 + s.ph)) : v;
            s.m.color.setScalar(0.12 + 0.88 * k); // la textura ya es roja: el color solo modula
    }
    // relojes: agujas locas (velocidad enorme y a saltos), solo los cercanos
    for (const c of this.clocks) {
      if (Math.abs(c.z - pz) > 45) continue;
      if ((c.next -= dt) < 0) {
        c.next = 0.12 + Math.random() * 0.4;
        c.v = [(Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 14), (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 30), (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 60)];
        if (Math.random() < 0.15) c.v = [0, 0, 0]; // se queda clavado un instante
      }
      c.hands.forEach((h, i) => (h.rotation.z = c.a[i] += c.v[i] * dt));
    }
  }

  dispose() {
    this.owned.forEach((o) => o.dispose());
    this.group.removeFromParent();
  }
}
