import * as THREE from 'three';
import { glow, lootModel, pulse } from './rarityFx';
import { LEVELS, boostOf, itemSpots, spotRarity, type Drop, type ItemId } from '@backrooms/shared';
import { perks } from './perks';
import { ElevatorCab } from './elevator';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Terrain } from './terrain';
import { PickupField, type Pickup, type PickupHost, type PickupModel } from './pickups';
import { COIL, PK, PR, PY, PDIRS, POOL_CELL as C, POOL_STEP, generatePools, poolCellY, poolFloorY, poolMaze, type Cell, type PoolMap } from '@backrooms/shared';
import type { Controls } from './input';
import { settings } from '../settings';
import { NRIP, frag, tiles, vert } from './pool';
import { EYE, WALK, RUN, JUMP, G, CROUCH_DROP, CROUCH_SLOW, ducking, planar } from './locomotion';

/*
 * Las Poolrooms de verdad (poolmap.ts lo construye a partir de shared/pools.ts): mapa grande con alturas. Geometría fusionada por
 * material (6 mallas en total), agua con un solo Reflector para todas las piscinas, escaleras con peldaños, tobogán que te lleva,
 * túneles inundados y natación. Se abre con `?poolmap` (en desarrollo). Aquí se mueve el jugador a mano: cuando el nivel entre en el
 * juego, la altura y el agua pasarán al servidor (docs/poolrooms.md §4).
 */

export const POOL_KIT = ['window', 'ladder', 'railing', 'lifeguard', 'shower', 'floaty', 'buoy', 'spiral', 'vent', 'birdbath', 'fisheye', 'soap', 'tank', 'watergun'] as const;
export type PoolKit = Partial<Record<(typeof POOL_KIT)[number] | 'water' | 'flashlight' | 'camera', THREE.Object3D>>; // water y flashlight no se bajan aquí: los pone el juego (ya están en assets)
/** Descarga las piezas del nivel (models/pool/*.glb, ver CREDITS.md). Las que falten se saltan: el nivel funciona sin ellas. */
let kitP: Promise<PoolKit> | undefined;
const KIT_WAIT = 9000; // ms: por debajo del LOAD_GRACE del servidor
const kitDone: PoolKit = {};
/** El kit ya descargado (vacío hasta entonces): lo usan los iconos y los avatares de fuera del nivel (tanque, pistola). */
export const poolPart = (n: (typeof POOL_KIT)[number]) => kitDone[n];
/**
 * El depósito de una pistola de agua (el material azul translúcido del modelo): se hace más claro y se le mete dentro una copia azul
 * recortada por un plano horizontal (recorte local: `renderer.localClippingEnabled`), que baja con lo que queda. Devuelve el actualizador (k: 0-1).
 */
export function tankFx(gun: THREE.Object3D) {
  let tank: THREE.Mesh | undefined;
  gun.traverse((o) => { const m = o as THREE.Mesh; if (!tank && m.isMesh && (m.material as THREE.Material).name === 'Material.004') tank = m; });
  if (!tank?.parent) return (_k: number) => {};
  const shell = (tank.material as THREE.MeshStandardMaterial).clone();
  shell.opacity = 0.3, shell.depthWrite = false, tank.material = shell;
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), box = new THREE.Box3();
  const water = new THREE.Mesh(tank.geometry, new THREE.MeshStandardMaterial({ color: 0x2f9bff, emissive: 0x0b4a96, emissiveIntensity: 0.6, roughness: 0.12, transparent: true, opacity: 0.85, clippingPlanes: [plane], side: THREE.DoubleSide }));
  water.scale.set(0.9, 0.9, 0.96), (water.renderOrder = tank.renderOrder + 1);
  tank.parent.add(water);
  tank.geometry.computeBoundingBox();
  const ctr = tank.geometry.boundingBox!.getCenter(new THREE.Vector3());
  water.quaternion.copy(tank.quaternion), water.scale.multiply(tank.scale);
  water.position.copy(tank.position).add(ctr.clone().sub(ctr.clone().multiply(water.scale)).applyQuaternion(tank.quaternion)); // (se encoge desde el centro del depósito, no desde el origen del modelo)
  return (k: number) => {
    water.visible = k > 0.01 && tank!.visible;
    if (!water.visible) return;
    box.setFromObject(tank!);
    plane.constant = box.min.y + (box.max.y - box.min.y) * (0.12 + 0.76 * k); // (el nivel horizontal: el agua chapotea con la mirada)
  };
}
export function loadPoolKit(): Promise<PoolKit> {
  return (kitP ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), kit = kitDone;
    // cada pieza con un máximo de espera (una descarga lenta o colgada no bloquea el nivel: se salta) y el kit se da por bueno pase lo que pase
    const wait = new Promise<void>((r) => setTimeout(r, KIT_WAIT));
    await Promise.race([
      Promise.all(POOL_KIT.map((n) => loader.loadAsync('/models/pool/' + n + '.glb').then((g) => void (kit[n] = g.scene), () => console.warn('pool kit: falta', n)))),
      wait,
    ]);
    return { ...kit }; // (lo que llegue tarde se queda en kitDone para los iconos, pero no entra en este nivel a medias)
  })());
}

/** Un reflejo de la luz del sol por una ventana de 2x2 cristales: blanco con los bordes suaves y los travesaños oscuros. */
function sunPatch() {
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), x = c.getContext('2d')!;
  x.shadowColor = '#fff';
  x.shadowBlur = 7;
  x.fillStyle = '#fff';
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) x.fillRect(14 + i * 51, 14 + j * 51, 49, 49);
  return new THREE.CanvasTexture(c);
}

const LG = 2.6; // ganancia HDR de las luminarias: pasan del umbral del bloom y brillan en vez de ser barras blancas
let raInit = false;
/** Segundos con G mantenida para llenar la pistola de agua en un bebedero. */
const FILL_T = 1.5;
const R = 0.38; // radio del jugador (con 0,3, mirando hacia abajo pegado a una pared, los pies y los hombros la atravesaban)
const EYE_SWIM = 0.5, HEAD = 0.65, O2_SECONDS = 30, TANK_AIR = 2.5, TANK_SLOW = 0.9, JET_TIME = 6, JET_N = 288, O2_REFILL = 2.5, FAINT = 2.4;

const SUB = 1.5; // tamaño máximo (m) de la malla en la que se parte cada cara para hornear la luz
/** Malla que se va llenando de cuadriláteros (con el sentido de la cara decidido por la normal que se pide). */
class Geo {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  i: number[] = [];
  c: number[] = [];
  /** Nivel de luz de la sala a la que pertenece lo que se dibuja (se hornea en el color de los vértices). */
  tint = 1;
  /** Luz de las luminarias y ventanas en un punto (horneada por vértice). */
  lf?: (x: number, y: number, z: number, flat?: boolean) => number;
  quad(a: number[], b: number[], c: number[], d: number[], hint: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return; // cuadrilátero sin área
    nx /= l, ny /= l, nz /= l;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) (nx = -nx), (ny = -ny), (nz = -nz), ([b, d] = [d, b]);
    // la luz va horneada por vértice: en un cuadrilátero grande, cuatro esquinas con luz distinta dejan una banda diagonal (la costura de los dos triángulos).
    // Los paralelogramos se parten en una malla de ~1 m; los puntos de cada arista salen de la propia arista (y se redondean), así dos caras que la comparten coinciden vértice a vértice y no hay grietas.
    if (Math.hypot(b[0] - a[0] - c[0] + d[0], b[1] - a[1] - c[1] + d[1], b[2] - a[2] - c[2] + d[2]) < 1e-6) {
      const nu = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / SUB - 1e-4)), nv = Math.max(1, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) / SUB - 1e-4));
      if (nu * nv > 1) {
        const P = (i: number, j: number) => {
          const o = [a[0] + ((b[0] - a[0]) * i) / nu + ((d[0] - a[0]) * j) / nv, a[1] + ((b[1] - a[1]) * i) / nu + ((d[1] - a[1]) * j) / nv, a[2] + ((b[2] - a[2]) * i) / nu + ((d[2] - a[2]) * j) / nv];
          return (i === 0 || i === nu) && (j === 0 || j === nv) ? o : o.map((v) => Math.round(v * 1e4) / 1e4);
        };
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) this.emit(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), nx, ny, nz);
        return;
      }
    }
    this.emit(a, b, c, d, nx, ny, nz);
  }
  private emit(a: number[], b: number[], c: number[], d: number[], nx: number, ny: number, nz: number) {
    const base = this.p.length / 3;
    for (const v of [a, b, c, d]) {
      this.p.push(v[0], v[1], v[2]), this.n.push(nx, ny, nz), (() => { const k = this.tint * (this.lf ? this.lf(v[0], v[1], v[2], Math.abs(ny) > 0.6) : 1); this.c.push(k, k * (0.985 - 0.015 * k), k * (0.9 + 0.1 * (1 - k))); })();
      // UV plano en metros del mundo (ver pool.ts): el tamaño de la baldosa no depende de la superficie
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      if (ay >= ax && ay >= az) this.uv.push(v[0], v[2]);
      else if (ax >= az) this.uv.push(v[2], v[1]);
      else this.uv.push(v[0], v[1]);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return g;
  }
}

/**
 * Cierra las T-junctions entre todas las mallas dadas: una arista suelta (la de una sola cara) con vértices de otras caras en su interior
 * (un muro de 9,2 m contra tres piezas, el lado de una escalera contra el suelo...) deja una grieta de un píxel que centellea. Cada triángulo así
 * se rehace como un abanico desde su centro que pasa por esos vértices, de modo que las dos caras comparten vértices y no hay hueco.
 */
function healT(geos: Geo[]) {
  const Q = 1e3, key = (x: number, y: number, z: number) => ((Math.round(x * Q) + 1e5) * 262144 + (Math.round(z * Q) + 1e5)) * 65536 + (Math.round(y * Q) + 30000);
  const ids = new Map<number, number>(), P: number[][] = [];
  const vid = geos.map((g) => {
    const n = g.p.length / 3, a = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      const x = g.p[k * 3], y = g.p[k * 3 + 1], z = g.p[k * 3 + 2], kk = key(x, y, z);
      let id = ids.get(kk);
      if (id === undefined) ids.set(kk, (id = P.length)), P.push([x, y, z]);
      a[k] = id;
    }
    return a;
  });
  const ek = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  const cnt = new Map<number, number>();
  for (let gi = 0; gi < geos.length; gi++) {
    const g = geos[gi], v = vid[gi];
    for (let t = 0; t < g.i.length; t += 3) for (let e = 0; e < 3; e++) { const k = ek(v[g.i[t + e]], v[g.i[t + ((e + 1) % 3)]]); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  }
  const bd: number[][] = [], bvs = new Set<number>();
  for (let gi = 0; gi < geos.length; gi++) {
    const g = geos[gi], v = vid[gi];
    for (let t = 0; t < g.i.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = v[g.i[t + e]], b = v[g.i[t + ((e + 1) % 3)]];
      if (a !== b && cnt.get(ek(a, b)) === 1) bd.push([a, b]), bvs.add(a), bvs.add(b);
    }
  }
  if (!bd.length) return;
  const cell = (x: number, z: number) => Math.floor(x / 2) * 4096 + Math.floor(z / 2), hash = new Map<number, number[]>();
  for (const w of bvs) (hash.get(cell(P[w][0], P[w][2])) ?? hash.set(cell(P[w][0], P[w][2]), []).get(cell(P[w][0], P[w][2]))!).push(w);
  const splits = new Map<number, { a: number; list: [number, number][] }>();
  for (const [a, b] of bd) {
    const A = P[a], B = P[b], d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], list: [number, number][] = [];
    for (let cx = Math.floor((Math.min(A[0], B[0]) - 0.01) / 2); cx <= Math.floor((Math.max(A[0], B[0]) + 0.01) / 2); cx++) for (let cz = Math.floor((Math.min(A[2], B[2]) - 0.01) / 2); cz <= Math.floor((Math.max(A[2], B[2]) + 0.01) / 2); cz++) {
      for (const w of hash.get(cx * 4096 + cz) ?? []) {
        if (w === a || w === b) continue;
        const q = P[w], s = ((q[0] - A[0]) * d[0] + (q[1] - A[1]) * d[1] + (q[2] - A[2]) * d[2]) / L2;
        if (s <= 1e-4 || s >= 1 - 1e-4) continue;
        if (Math.hypot(q[0] - A[0] - d[0] * s, q[1] - A[1] - d[1] * s, q[2] - A[2] - d[2] * s) < 2e-3) list.push([s, w]);
      }
    }
    if (list.length) splits.set(ek(a, b), { a, list: list.sort((u, v) => u[0] - v[0]) });
  }
  if (!splits.size) return;
  geos.forEach((g, gi) => {
    const v = vid[gi], out: number[] = [];
    const mk = (pos: number[], n: number, u: number, w: number, r: number, gg: number, b: number) => { const id = g.p.length / 3; g.p.push(pos[0], pos[1], pos[2]); g.n.push(g.n[n * 3], g.n[n * 3 + 1], g.n[n * 3 + 2]); g.uv.push(u, w); g.c.push(r, gg, b); return id; };
    for (let t = 0; t < g.i.length; t += 3) {
      const l = [g.i[t], g.i[t + 1], g.i[t + 2]];
      if (![0, 1, 2].some((e) => splits.has(ek(v[l[e]], v[l[(e + 1) % 3]])))) { out.push(l[0], l[1], l[2]); continue; }
      const poly: number[] = [];
      for (let e = 0; e < 3; e++) {
        const la = l[e], lb = l[(e + 1) % 3], sp = splits.get(ek(v[la], v[lb]));
        poly.push(la);
        if (!sp) continue;
        const fwd = sp.a === v[la];
        for (const [s0, w] of fwd ? sp.list : [...sp.list].reverse()) {
          const s = fwd ? s0 : 1 - s0, lerp = (arr: number[], k: number, o: number) => arr[la * k + o] + (arr[lb * k + o] - arr[la * k + o]) * s;
          poly.push(mk(P[w], la, lerp(g.uv, 2, 0), lerp(g.uv, 2, 1), lerp(g.c, 3, 0), lerp(g.c, 3, 1), lerp(g.c, 3, 2)));
        }
      }
      const mid = (arr: number[], k: number, o: number) => (arr[l[0] * k + o] + arr[l[1] * k + o] + arr[l[2] * k + o]) / 3;
      const cp = [mid(g.p, 3, 0), mid(g.p, 3, 1), mid(g.p, 3, 2)], ci = mk(cp, l[0], mid(g.uv, 2, 0), mid(g.uv, 2, 1), mid(g.c, 3, 0), mid(g.c, 3, 1), mid(g.c, 3, 2));
      for (let k = 0; k < poly.length; k++) out.push(ci, poly[k], poly[(k + 1) % poly.length]);
    }
    g.i = out;
  });
}

/** Geometría troceada: un Geo por trozo de mapa (cada 10x10 celdas), para que el descarte por vista funcione. */
class ChunkGeo {
  cur = 0;
  tint = 1;
  lf?: (x: number, y: number, z: number, flat?: boolean) => number;
  parts = new Map<number, Geo>();
  quad(a: number[], b: number[], c: number[], d: number[], hint: number[]) {
    let g = this.parts.get(this.cur);
    if (!g) this.parts.set(this.cur, (g = new Geo()));
    (g.tint = this.tint), (g.lf = this.lf);
    g.quad(a, b, c, d, hint);
  }
}
const CHUNK = 10;
/** Hondura de los pozos de los túneles sin fondo (m bajo el fondo de la piscina). */
const WELL = 3.5;
/** Un pozo: su boca (m), la altura del fondo de la piscina, su planta y el índice de su pareja. */
type Well = { x0: number; z0: number; x1: number; z1: number; fy: number; layer: 0 | 1; to: number };
// (la planta alta usa las mismas mallas por trozo, con la clave desplazada: así se puede ocultar entera)
const chunkOf = (x: number, y: number, lay = 0) => Math.floor(x / CHUNK) * 1000 + Math.floor(y / CHUNK) + lay * 1e7;

// esquinas de la arista de una celda hacia la dirección d (índices sx, sz) y las de la celda vecina en esa misma arista
const OWN = [[[1, 0], [1, 1]], [[0, 0], [0, 1]], [[0, 1], [1, 1]], [[0, 0], [1, 0]]];
const NB = [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0], [1, 0]], [[0, 1], [1, 1]]];

/** Los recogibles de las Poolrooms: lo de `PickupField` (pickups.ts) con su propia colocación (cada celda tiene su altura y planta) y sus nombres. */
class PoolPickups extends PickupField {
  /** Altura de mis pies: la mejor pista de en qué planta caen los objetos soltados (no se sabe la de quien los suelta). */
  floorHint = () => 0;
  constructor(host: PickupHost, camera: THREE.Camera, private map: PoolMap, private lay?: Uint8Array) {
    super(host, camera);
  }
  private static UP = new Set<Pickup['kind']>(['tape', 'water', 'tank', 'loot']);
  /** Un modelo a `size` metros (lado mayor), centrado en su origen; `up`: el lado largo vertical, si no a lo largo de -z. */
  protected override shape(kind: Pickup['kind'], src: THREE.Object3D, size: number) {
    const up = PoolPickups.UP.has(kind), c = src.clone(true), g = new THREE.Group(), d = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3());
    if (up && d.z > d.y && d.z >= d.x) c.rotation.x = -Math.PI / 2;
    else if (!up && d.x > d.z) c.rotation.y = Math.PI / 2;
    g.add(c);
    const b = new THREE.Box3().setFromObject(g), k = size / Math.max(...b.getSize(new THREE.Vector3()).toArray()), ctr = b.getCenter(new THREE.Vector3());
    c.scale.multiplyScalar(k), c.position.sub(ctr.multiplyScalar(k));
    const out = new THREE.Group();
    out.add(g);
    return out;
  }
  protected override yOf(_kind: Pickup['kind'], size: number, c: Cell) {
    return poolCellY(this.map, c.x, c.y, this.lay?.[c.y * this.map.w + c.x] ? 1 : 0) + size / 2 + 0.3; // (la planta del objeto: maze.lay; flota a media pierna)
  }
  protected override floorOf(x: number, z: number) {
    return poolFloorY(this.map, x, z, this.floorHint())?.y ?? 0;
  }
  protected override spot(c: Cell) {
    return { x: (c.x + 0.5) * C, z: (c.y + 0.5) * C };
  }
  protected override label(kind: Pickup['kind']) {
    return kind === 'tape' ? 'soap' : super.label(kind);
  }
}

const ZERO = new THREE.Vector2();
export class PoolLevel implements Terrain {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly map: PoolMap;
  private water: THREE.ShaderMaterial;
  private rfm?: Reflector;
  private cm: THREE.Object3D[] = [];
  /** Lo que es de la planta alta (se oculta cuando se está en un túnel bajo tierra) y su agua. */
  private upMeshes: THREE.Object3D[] = [];
  private upWater?: THREE.Mesh;
  /** Planta en la que estoy (0 baja, 1 alta) y la superficie del agua de esa planta. */
  private lay: 0 | 1 = 0;
  private surf: number = PY.surf;
  private culled: THREE.Object3D[] = [];
  /** Adornos de muchos triángulos (las duchas): fuera del reflejo del agua y de la pasada del AO, donde no se notan y costaban otra pasada entera cada uno. */
  private heavy: THREE.Object3D[] = [];
  /** El agua fuera de la pasada de normales del AO (el Reflector volvería a renderizar el reflejo). */
  setWater(v: boolean) { if (this.rfm) this.rfm.visible = v; if (this.upWater) this.upWater.visible = v && this.upOn; }
  private upOn = true;
  private skipRefl = false;
  private shadowFr = 0;
  /** ¿Hay huecos en el forjado? Entonces desde arriba se ve el agua de abajo y su reflejo debe pintarse (si no, sale un rectángulo negro). */
  private holes = false;
  /** Para la pasada de normales del AO: fuera lo que está a más de 40 m (la niebla ya se lo come); al terminar, se devuelve. */
  aoCull(on: boolean, dist = 40, ghosts = false) {
    if (!on) return void (this.culled.forEach((o) => (o.visible = true)), (this.culled.length = 0));
    // la pasada de normales pinta TODO con un material opaco: sprites (brillos, nombres) y mallas translúcidas (haces, sombras blob, discos de túnel) salían como cuadrados sólidos que el AO oscurecía
    if (ghosts) this.scene.traverse((o) => { const mt = (o as THREE.Mesh).material as THREE.Material | undefined; if (o.visible && ((o as THREE.Sprite).isSprite || (mt && !Array.isArray(mt) && mt.transparent && mt.depthWrite === false))) (o.visible = false), this.culled.push(o); });
    for (const o of this.heavy) if (o.visible) (o.visible = false), this.culled.push(o);
    const c = this.camera.position;
    for (const o of this.cm) {
      const b = (o as THREE.Mesh).geometry?.boundingSphere;
      if (!b || !o.visible) continue;
      if (Math.hypot(b.center.x + o.position.x - c.x, b.center.z + o.position.z - c.z) - b.radius > dist) (o.visible = false), this.culled.push(o);
    }
  }
  private rip = Array.from({ length: NRIP }, () => new THREE.Vector4(0, 0, -99, 0));
  private ri = 0;
  private stepT = 0;
  /** Aire al nadar: 1 lleno, 0 sin aire. Bajo el agua dura O2_SECONDS; fuera se recupera en O2_REFILL. Sin aire te desmayas y despiertas donde respiraste por última vez. */
  o2 = 1;
  private faint = 0;
  private lastAir = { x: 0, z: 0, y: 0 };
  private hud?: { bar: HTMLDivElement; fill: HTMLDivElement; veil: HTMLDivElement; sq: HTMLDivElement; sqFill: HTMLDivElement };
  private t = 0;
  private owned: { dispose(): void }[] = [];
  private px: number;
  private pz: number;
  private py = 0;
  private vy = 0;
  private fx = 0;
  private fz = 0;
  private yaw = 0;
  private pitch = 0;
  private swim = false;
  private air = false;
  private vyNow = 0;
  private hs = 0;
  private wet = false;
  private deadK = 0;
  /** ms de «sin señal» del radar (lo pondrán los túneles; el juego lo manda en el estado). */
  jam = 0;
  /**
   * Los túneles sin fondo son pozos de verdad: cada boca (2x2 celdas) baja WELL m bajo el fondo de la piscina y se pierde en lo negro. Al llegar abajo se sale
   * por el fondo del pozo de la pareja, con el arriba y el abajo cambiados: buceas hacia abajo y sales hacia arriba en otra piscina.
   * `well`: el pozo sobre el que estoy (o en el que estoy metido); `wellLock`: recién llegado, no vuelve a saltar hasta subir un poco.
   */
  private wells: Well[] = [];
  private well?: Well;
  private wellLock = false;
  /** La salida (centro de su celda): una puerta de ascensor con luz; se sube al acercarse con la misión cumplida. */
  readonly exit = { x: 0, z: 0 };
  /** La cabina del ascensor de la salida; su celda (x0, z0, x1, z1) y hacia dónde da la puerta: solo se entra y se sale por ella, y abierta. */
  cab!: ElevatorCab;
  private exitBox = [0, 0, 0, 0, 0, 0];
  /** Dentro del ascensor en marcha: no me muevo (sí miro). */
  hold = false;
  private eye = EYE;
  private torch = new THREE.PointLight(0xfff6e8, 1.6, 14, 2);
  private fog: THREE.FogExp2;
  private hemi: THREE.HemisphereLight;
  readonly sun = new THREE.DirectionalLight(0xfff1d2, 3.4);
  private lamps?: THREE.InstancedMesh;
  /** Puntos de la ruta de los toboganes (cada ~0,4 m), para chocar con los tubos: [x, y, z]. Se saltan la boca y la salida, por donde se entra y se sale. */
  private tubePts: [number, number, number][] = [];
  private tubes: { curve: THREE.Curve<THREE.Vector3>; len: number; x: number; z: number; s0: number }[] = [];
  private ride?: { curve: THREE.Curve<THREE.Vector3>; len: number; s: number; h?: number };
  private lampLvl: number[] = [];
  private lampCur = new Float32Array(0);
  private lampPos: number[][] = [];
  private flickIdx: number[] = [];
  private pls: THREE.PointLight[] = [];
  private ras: THREE.RectAreaLight[] = [];
  private raK: number[] = [];
  private raT = 0;
  private lampBase = new THREE.Color();
  private mats?: Record<string, THREE.MeshPhysicalMaterial>;
  private roomLight = 1;

  /** `withSoaps`: los jabones solo están si la misión elegida es encontrarlos. */
  constructor(aspect: number, renderer: THREE.WebGLRenderer, readonly seed = 1, kit: PoolKit = {}, readonly withSoaps = true) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, aspect, 0.05, 140);
    const sc = this.scene, own = <T extends { dispose(): void }>(o: T) => (this.owned.push(o), o);
    const m = (this.map = generatePools(seed)), W = m.w, H = m.h;
    this.fog = new THREE.FogExp2(0xdad5bc, 0.0065); // más clara y cálida: el gris verdoso se comía el azulejo y el agua
    sc.fog = this.fog;
    { const ex = renderer.toneMappingExposure; renderer.toneMappingExposure = Math.max(ex, 0.9); own({ dispose: () => (renderer.toneMappingExposure = ex) }); } // más claro que el laberinto amarillo
    {
      const css = <T extends HTMLElement>(e: T, t: string) => ((e.style.cssText = t), e);
      const veil = css(document.createElement('div'), 'position:fixed;inset:0;pointer-events:none;z-index:8;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 35%,rgba(2,14,12,.95) 100%)');
      const bar = css(document.createElement('div'), 'position:fixed;left:50%;bottom:9%;width:200px;height:3px;margin-left:-100px;background:rgba(255,255,255,.18);pointer-events:none;z-index:9;opacity:0;transition:opacity .25s');
      const fill = css(document.createElement('div'), 'height:100%;width:100%;background:#9fe8dc');
      const lab = css(document.createElement('span'), 'position:absolute;left:0;top:-15px;font:600 10px/1 monospace;letter-spacing:.2em;color:#9fe8dc');
      lab.textContent = 'AIR';
      bar.append(lab, fill);
      // el depósito de la pistola de agua: otra barra, justo encima de la del aire
      const sq = css(document.createElement('div'), 'position:fixed;left:50%;bottom:calc(9% + 24px);width:200px;height:3px;margin-left:-100px;background:rgba(255,255,255,.18);pointer-events:none;z-index:9;opacity:0;transition:opacity .25s');
      const sqFill = css(document.createElement('div'), 'height:100%;width:100%;background:#6ab8ff');
      const sqLab = css(document.createElement('span'), 'position:absolute;left:0;top:-15px;font:600 10px/1 monospace;letter-spacing:.2em;color:#6ab8ff');
      sqLab.textContent = 'WATER';
      sq.append(sqLab, sqFill);
      document.body.append(veil, bar, sq);
      this.hud = { bar, fill, veil, sq, sqFill };
      own({ dispose: () => (veil.remove(), bar.remove(), sq.remove()) });
    }
    sc.background = new THREE.Color(0x1b211e); // oscuro: una grieta entre dos caras se ve como sombra, no como una línea de luz
    this.hemi = new THREE.HemisphereLight(0xf6efd6, 0x9aa890, 0.6);
    sc.add(this.hemi, this.torch, this.sun, this.sun.target);
    // el sol: un haz que solo entra por los huecos de las ventanas y proyecta su forma y las sombras de las columnas; sigue al jugador
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(settings.shadows === 1 ? 1024 : 2048); // (SHADOWS: bajas = la mitad)
    Object.assign(this.sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 220 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.sun.shadow.autoUpdate = false; // el mapa de sombras se repinta un fotograma sí y otro no (ver update): es otra pasada entera de medio mapa

    // entorno para los reflejos de las baldosas (caja con tubos de neón, horneada una vez)
    {
      const env = new THREE.Scene(), em = own(new THREE.MeshBasicMaterial({ color: 0x8f9892, side: THREE.BackSide }));
      env.add(new THREE.Mesh(own(new THREE.BoxGeometry(30, 10, 30)), em));
      const nm = own(new THREE.MeshBasicMaterial({ color: 0xfffaea })), ng = own(new THREE.BoxGeometry(3.4, 0.1, 0.7));
      for (const x of [-9, -3, 3, 9]) for (const z of [-9, -3, 3, 9]) { const n = new THREE.Mesh(ng, nm); n.position.set(x, 4.8, z); env.add(n); }
      const gen = new THREE.PMREMGenerator(renderer);
      sc.environment = gen.fromScene(env, 0.04).texture;
      gen.dispose();
    }

    const mat = (tile: number, irregular: boolean | number, gloss = true, bump = 2.2) => {
      const t = tiles(tile, irregular, gloss);
      own(t.map), own(t.bump), own(t.rough);
      for (const tx of [t.map, t.bump, t.rough]) tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return own(new THREE.MeshPhysicalMaterial({ map: t.map, bumpMap: t.bump, bumpScale: gloss ? bump : 0.8, roughnessMap: t.rough, roughness: 1, metalness: 0, vertexColors: true, clearcoat: gloss ? 0.7 : 0, specularIntensity: 0.5, clearcoatRoughness: 0.28, envMapIntensity: gloss ? 1.7 : 0.3 }));
    };
    const G = { deck: new ChunkGeo(), wall: new ChunkGeo(), pool: new ChunkGeo(), ceil: new ChunkGeo(), slide: new ChunkGeo(), win: new ChunkGeo(), bar: new ChunkGeo() };
    const tile = mat(0.12, 0, true, 3.2); // (el relieve más suave: menos moiré lejos) // la baldosa aprobada, para todo
    // variación en el shader por coordenadas del mundo (sin texturas nuevas): cada baldosa un poco distinta, manchas anchas y suciedad pegada al suelo
    tile.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying float vUp;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying float vUp;\nfloat h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y), mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }')
        // el sol solo calienta lo que mira hacia arriba (suelos): en las caras verticales se colaba por las esquinas de las paredes de grosor cero
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= smoothstep(0.5, 0.8, vUp);'))
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        { float fl = smoothstep(0.6, 0.9, vUp); material.clearcoat *= fl; material.roughness = mix(max(material.roughness, 0.6), material.roughness, fl); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        { float t = h31(floor(vWp / 0.12 + 0.01)), b = vn(vWp * 0.35), s = vn(vWp * 1.7 + 9.0);
          diffuseColor.rgb *= (0.93 + 0.1 * t) * (0.86 + 0.28 * b) * vec3(1.0 + 0.05 * (b - 0.5), 1.0, 1.0 - 0.06 * (b - 0.5));
          diffuseColor.rgb *= 1.0 - 0.28 * smoothstep(0.55, 0.9, s) * (0.4 + 0.6 * smoothstep(1.2, -0.2, vWp.y)); }`);
    };
    tile.customProgramCacheKey = () => 'poolTile';
    tile.shadowSide = THREE.DoubleSide; // paredes de grosor cero: que proyecten sombra por las dos caras y el sol no se cuele por las esquinas
    const mats = {
      deck: tile,
      wall: tile,
      pool: tile,
      ceil: tile,
      slide: own(new THREE.MeshPhysicalMaterial({ color: 0x3cc6c0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 })),
      win: own(new THREE.MeshBasicMaterial({ color: 0xfffbea, fog: false })),
      bar: own(new THREE.MeshBasicMaterial({ color: 0x1b1f1d })),
    };
    this.mats = mats as unknown as Record<string, THREE.MeshPhysicalMaterial>;

    const at = (x: number, y: number) => y * W + x;
    // los pozos de los túneles sin fondo y sus celdas (ahí no se pinta el fondo de la piscina: es la boca)
    const mouth = new Set<number>();
    m.portals.forEach((p, k) => [p.a, p.b].forEach((s, e) => {
      this.wells.push({ x0: s.x * C, z0: s.y * C, x1: (s.x + 2) * C, z1: (s.y + 2) * C, fy: (s.layer ? m.up : m).ya[s.y * W + s.x], layer: s.layer, to: 2 * k + 1 - e });
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) mouth.add(s.layer * W * H + at(s.x + i, s.y + j));
    }));
    const solid = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || m.kind[at(x, y)] === PK.wall;
    // el ascensor va EMPOTRADO: la cabina ocupa la celda de pared de detrás de la salida (`cabCell`, hacia `exW`), y esa cara de la pared se abre
    const wallAt = (d: readonly [number, number], dry: boolean) => { const j = at(m.exit.x + d[0], m.exit.y + d[1]); return m.kind[j] === PK.wall && !(dry && m.tun[j]); };
    const exW = PDIRS.find((d) => wallAt(d, true)) ?? PDIRS.find((d) => wallAt(d, false)) ?? PDIRS[1], exitCell = at(m.exit.x, m.exit.y), cabCell = at(m.exit.x + exW[0], m.exit.y + exW[1]);
    /** Altura del suelo en la esquina (sx, sz) de la celda. */
    const corner = (i: number, sx: number, sz: number) => {
      if (m.ramp[i] === PR.none) return m.ya[i];
      const d = m.dir[i];
      const end = d === 0 ? sx === 1 : d === 1 ? sx === 0 : d === 2 ? sz === 1 : sz === 0;
      return end ? m.yb[i] : m.ya[i];
    };
    /** Una cara vertical entre dos esquinas (a, b) de alturas inferiores bo y superiores to, hacia dentro (hint); se parte a y=0 (azulejo de piscina debajo, de pared encima). */
    const vface = (x0: number, z0: number, x1: number, z1: number, b0: number, b1: number, t0: number, t1: number, hint: number[]) => {
      const lowTop0 = Math.min(t0, 0), lowTop1 = Math.min(t1, 0);
      if (b0 < 0 || b1 < 0) G.pool.quad([x0, b0, z0], [x1, b1, z1], [x1, Math.max(lowTop1, b1), z1], [x0, Math.max(lowTop0, b0), z0], hint);
      const hb0 = Math.max(b0, 0), hb1 = Math.max(b1, 0);
      if (t0 > 0 || t1 > 0) G.wall.quad([x0, hb0, z0], [x1, hb1, z1], [x1, Math.max(t1, hb1), z1], [x0, Math.max(t0, hb0), z0], hint);
    };
    const cw = (cx: number, cz: number, s: number[]) => [(cx + s[0]) * C, (cz + s[1]) * C];
    /** Altura de la bóveda (arco rebajado de 6 m de ancho) a t metros del eje del pasillo. */
    const archY = (t: number) => PY.spring + (PY.ceil - PY.spring) * Math.sqrt(Math.max(0, 1 - (Math.max(-3, Math.min(3, t)) / 3) ** 2));
    /** Altura del arco de la bóveda de la celda j en un punto (px, pz) de su borde. */
    const archAt = (j: number, px: number, pz: number) => archY((m.vax[j] === 1 ? pz - (((j / W) | 0) - m.voff[j]) * C : px - ((j % W) - m.voff[j]) * C) - 3);

    // luz horneada por sala (las salas bajas casi oscuras se ven así aunque estés lejos); pasillos algo apagados
    const roomIdx = new Int16Array(W * H).fill(-1);
    m.rooms.forEach((r, ri) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (m.kind[at(x, y)] !== PK.wall) roomIdx[at(x, y)] = ri; });
    // fuentes de luz horneadas: cada luminaria y cada ventana (más fuerte), con caída rápida: charcos de luz y penumbra entre ellos
    const SRC: number[][] = m.lamps.map((l) => [(l.x + 0.5) * C, (m.vax[at(l.x, l.y)] ? 4.1 : m.ceil[at(l.x, l.y)]) - 0.1, (l.y + 0.5) * C, l.r >= 0 && m.rooms[l.r].flicker ? 0.35 : 1, 1.8]);
    for (const w of m.windows) SRC.push([(w.x + 0.5) * C + PDIRS[w.d][0] * (C / 2) * 0.6, 2.3, (w.y + 0.5) * C + PDIRS[w.d][1] * (C / 2) * 0.6, 2.6, 3.2]);
    for (const l of m.lampsUp) SRC.push([(l.x + 0.5) * C, PY.tall - 0.1, (l.y + 0.5) * C, 1, 1.8]); // luminarias de la planta alta
    const HASH = 8, grid = new Map<number, number[]>();
    SRC.forEach((q, k) => { const key = Math.floor(q[0] / HASH) * 4096 + Math.floor(q[2] / HASH); (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); });
    // oclusión de contacto horneada: lo vertical (paredes, columnas) se oscurece al pie y en el encuentro con el techo
    const contact = (x: number, y: number, z: number) => {
      const ci = Math.floor(x / C), cj = Math.floor(z / C), L = y > PY.up - 0.6 ? m.up : m; // (la planta alta mira sus propios arrays)
      let fy = 1e9, cy = -1e9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const u = ci + a, v = cj + b;
        if (u < 0 || v < 0 || u >= W || v >= H || L.kind[at(u, v)] === PK.wall) continue;
        fy = Math.min(fy, L.ya[at(u, v)]), cy = Math.max(cy, L.ceil[at(u, v)]);
      }
      if (fy > 1e8) return 1;
      const s = (t: number) => Math.max(0, Math.min(1, t)), lo = s((y - fy) / 0.7), hi = s((cy - y) / 0.5);
      return (0.74 + 0.26 * lo * lo * (3 - 2 * lo)) * (0.88 + 0.12 * hi);
    };
    const lightAt = (x: number, y: number, z: number, flat = true) => {
      let sum = 0;
      const gx = Math.floor(x / HASH), gz = Math.floor(z / HASH);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get((gx + a) * 4096 + gz + b) ?? []) {
        const q = SRC[k], d2 = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2;
        if (y > PY.up - 0.05 && q[1] < PY.up - 0.5) continue; // una luminaria de la planta baja no alumbra a través del forjado (dejaba una franja clara al pie de las paredes de arriba)
        sum += q[3] / (1 + d2 / (q[4] * q[4])) ** 1.5;
      }
      return (0.66 + 0.4 * Math.min(1.25, sum / 1.3)) * (flat ? 1 : contact(x, y, z));
    };
    for (const gg of Object.values(G)) gg.lf = lightAt;
    const winAt = new Set(m.windows.map((w) => (w.y * W + w.x) * 4 + w.d));
    const tintOf = (i: number) => { const r = roomIdx[i] >= 0 ? m.rooms[roomIdx[i]] : null; return r ? 0.56 + 0.44 * Math.min(1, r.light + (r.sun ? 0.2 : 0)) : 0.7; };
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const i = at(cx, cy), x0 = cx * C, x1 = x0 + C, z0 = cy * C, z1 = z0 + C;
      for (const gg of Object.values(G)) (gg.tint = tintOf(i)), (gg.cur = chunkOf(cx, cy));
      // el túnel inundado de abajo (una pseudocelda): suelo, techo (cara de abajo de la losa) y paredes donde no hay otra celda inundada
      if (m.tun[i]) {
        G.pool.quad([x0, PY.deep, z0], [x1, PY.deep, z0], [x1, PY.deep, z1], [x0, PY.deep, z1], [0, 1, 0]);
        G.pool.quad([x0, PY.tunCeil, z0], [x1, PY.tunCeil, z0], [x1, PY.tunCeil, z1], [x0, PY.tunCeil, z1], [0, -1, 0]);
        for (let d = 0; d < 4; d++) {
          const nx = cx + PDIRS[d][0], ny = cy + PDIRS[d][1];
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && (m.tun[at(nx, ny)] || m.water[at(nx, ny)] === 2)) continue;
          const [a, b] = OWN[d].map((s) => cw(cx, cy, s));
          G.pool.quad([a[0], PY.deep, a[1]], [b[0], PY.deep, b[1]], [b[0], PY.tunCeil, b[1]], [a[0], PY.tunCeil, a[1]], [-PDIRS[d][0], 0, -PDIRS[d][1]]);
        }
      }
      if (m.kind[i] === PK.wall) continue;
      const f = [corner(i, 0, 0), corner(i, 1, 0), corner(i, 0, 1), corner(i, 1, 1)], c = m.ceil[i];
      // esquina saliente del contorno de una piscina: agua con cubierta seca a dos lados contiguos y agua en los otros dos
      let cut: { sx: number; sz: number; a: number; b: number } | null = null;
      if (m.water[i] && !m.ramp[i] && !m.tun[i] && !m.vax[i] && f.every((v) => v === f[0])) {
        const nbOf = (d: number) => (cx + PDIRS[d][0] >= 0 && cy + PDIRS[d][1] >= 0 && cx + PDIRS[d][0] < W && cy + PDIRS[d][1] < H ? at(cx + PDIRS[d][0], cy + PDIRS[d][1]) : -1);
        const dry = (d: number) => { const n = nbOf(d); return n >= 0 && m.kind[n] === PK.floor && !m.water[n] && !m.ramp[n] && !m.vax[n] && !m.tun[n] && m.ya[n] === 0; };
        const wet = (d: number) => { const n = nbOf(d); return n >= 0 && m.kind[n] === PK.floor && m.water[n] > 0 && !m.ramp[n] && !m.tun[n]; };
        for (const a of [0, 1]) for (const b of [2, 3]) if (!cut && dry(a) && dry(b) && wet(a ^ 1) && wet(b ^ 1)) cut = { sx: a === 0 ? 1 : 0, sz: b === 2 ? 1 : 0, a, b };
      }
      // suelo: peldaños, tobogán o llano
      if (m.ramp[i] === PR.stairs) {
        const d = m.dir[i], up = m.yb[i] - m.ya[i], horiz = d < 2; // horiz: el eje de avance es x
        const along = (t: number) => (d === 0 || d === 2 ? t : 1 - t);
        const P = (u: number, v: number, y: number) => (horiz ? [x0 + u * C, y, z0 + v * C] : [x0 + v * C, y, z0 + u * C]);
        for (let k = 0; k < 4; k++) {
          const a0 = along(k / 4), a1 = along((k + 1) / 4), h = m.ya[i] + (up * (k + 1)) / 4, hp = m.ya[i] + (up * k) / 4;
          G.deck.quad(P(a0, 0, h), P(a1, 0, h), P(a1, 1, h), P(a0, 1, h), [0, 1, 0]); // huella
          G.deck.quad(P(a0, 0, hp), P(a0, 1, hp), P(a0, 1, h), P(a0, 0, h), [-PDIRS[d][0], 0, -PDIRS[d][1]]); // contrahuella
          // costados macizos hasta el suelo vecino (que siempre es más bajo: los peldaños empiezan a ras de la cubierta)
          for (const v of [0, 1]) {
            const side = horiz ? (v === 0 ? 3 : 2) : v === 0 ? 1 : 0, nb2 = at(cx + PDIRS[side][0], cy + PDIRS[side][1]);
            if (solid(cx + PDIRS[side][0], cy + PDIRS[side][1])) continue;
            const hn = m.ya[nb2];
            if (h > hn) G.deck.quad(P(a0, v, hn), P(a1, v, hn), P(a1, v, h), P(a0, v, h), [PDIRS[side][0], 0, PDIRS[side][1]]);
            else if (hn > h + 0.02 && m.ramp[nb2] !== PR.stairs) G.deck.quad(P(a0, v, h), P(a1, v, h), P(a1, v, hn), P(a0, v, hn), [-PDIRS[side][0], 0, -PDIRS[side][1]]); // el vecino es más alto que el peldaño (borde curvo de una piscina): se cierra el hueco
          }
        }
      } else if (m.ramp[i] === PR.slide) {
        G.slide.quad([x0, f[0], z0], [x1, f[1], z0], [x1, f[3], z1], [x0, f[2], z1], [0, 1, 0]);
      } else {
        if (cut) {
          // esquina saliente del contorno de la piscina: se corta en diagonal (la mitad de cada lado) y el triángulo pasa a ser cubierta
          const kx = cut.sx ? x1 : x0, kz = cut.sz ? z1 : z0, ox = cut.sx ? x0 : x1, oz = cut.sz ? z0 : z1, mx = (kx + ox) / 2, mz = (kz + oz) / 2, y = f[0];
          G.pool.quad([ox, y, oz], [mx, y, oz], [mx, y, kz], [ox, y, kz], [0, 1, 0]);
          G.pool.quad([mx, y, oz], [kx, y, oz], [kx, y, mz], [mx, y, kz], [0, 1, 0]);
          G.deck.quad([mx, 0, kz], [kx, 0, mz], [kx, 0, kz], [kx, 0, kz], [0, 1, 0]);
        } else if (!mouth.has(i)) (m.water[i] ? G.pool : G.deck).quad([x0, f[0], z0], [x1, f[1], z0], [x1, f[3], z1], [x0, f[2], z1], [0, 1, 0]);
        if (m.ya[i] > 1 && !m.water[i]) G.ceil.quad([x0, f[0], z0], [x1, f[1], z0], [x1, f[3], z1], [x0, f[2], z1], [0, -1, 0]); // la cara de abajo de una planta alta (balcón, pasarela)
      }
      if (m.vax[i]) {
        // bóveda de cañón: 6 tiras a lo ancho del pasillo siguiendo el arco
        const ax = m.vax[i], vo = m.voff[i];
        for (let k = 0; k < 6; k++) {
          const ta = (vo + k / 6) * C - 3, tb = (vo + (k + 1) / 6) * C - 3, ya_ = archY(ta), yb_ = archY(tb), tm = (ta + tb) / 2;
          const hl = -tm, hy = PY.spring - (ya_ + yb_) / 2;
          if (ax === 1) G.ceil.quad([x0, ya_, z0 + (k / 6) * C], [x1, ya_, z0 + (k / 6) * C], [x1, yb_, z0 + ((k + 1) / 6) * C], [x0, yb_, z0 + ((k + 1) / 6) * C], [0, hy, hl]);
          else G.ceil.quad([x0 + (k / 6) * C, ya_, z0], [x0 + (k / 6) * C, ya_, z1], [x0 + ((k + 1) / 6) * C, yb_, z1], [x0 + ((k + 1) / 6) * C, yb_, z0], [hl, hy, 0]);
        }
      } else G.ceil.quad([x0, c, z0], [x1, c, z0], [x1, c, z1], [x0, c, z1], [0, -1, 0]);

      for (let d = 0; d < 4; d++) {
        const nx = cx + PDIRS[d][0], ny = cy + PDIRS[d][1], hint = [-PDIRS[d][0], 0, -PDIRS[d][1]];
        const [pa, pb] = OWN[d].map((s) => cw(cx, cy, s)), hc = OWN[d].map(([sx, sz]) => corner(i, sx, sz));
        const nb = nx >= 0 && ny >= 0 && nx < W && ny < H ? at(nx, ny) : -1;
        // la abertura del túnel en la pared de la piscina: solo se cierra por encima del techo del túnel
        const capN = nb >= 0 && m.up.kind[nb] !== PK.wall ? Math.min(c, m.up.ya[nb]) : c; // si el vecino tiene suelo arriba, la pared llega hasta él, no más
        const tunOpen = nb >= 0 && m.tun[nb] && m.water[i] === 2;
        const lift = (h: number) => (tunOpen ? Math.max(h, PY.tunCeil) : h);
        if (solid(nx, ny)) {
          if (m.vax[i] === (d < 2 ? 1 : 2)) {
            // el fondo de una bóveda contra una pared: se rellena el hueco entre la línea de arranque y el arco
            const vo = m.voff[i], base = d < 2 ? (cy - vo) * C : (cx - vo) * C;
            for (let k = 0; k < 6; k++) {
              const p0 = [pa[0] + (pb[0] - pa[0]) * (k / 6), pa[1] + (pb[1] - pa[1]) * (k / 6)], p1 = [pa[0] + (pb[0] - pa[0]) * ((k + 1) / 6), pa[1] + (pb[1] - pa[1]) * ((k + 1) / 6)];
              const h0 = archY((d < 2 ? p0[1] : p0[0]) - base - 3), h1 = archY((d < 2 ? p1[1] : p1[0]) - base - 3);
              G.wall.quad([p0[0], c, p0[1]], [p1[0], c, p1[1]], [p1[0], h1, p1[1]], [p0[0], h0, p0[1]], hint);
            }
          }
          if (i === exitCell && nb === cabCell) {
            // la boca del ascensor: la pared solo sigue por encima de la cabina
            const yl = m.ya[i] + 2.5;
            if (c > yl) G.wall.quad([pa[0], yl, pa[1]], [pb[0], yl, pb[1]], [pb[0], c, pb[1]], [pa[0], c, pa[1]], hint);
            continue;
          }
          if (winAt.has(i * 4 + d)) {
            // ventana: un hueco real en la pared (por él entra el sol y se proyecta su sombra), con el marco dibujado aparte
            const P = (f: number) => [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f], f0 = 0.5 - 0.7 / C, f1 = 0.5 + 0.7 / C, A = P(f0), Bp = P(f1), fl = lift(hc[0]);
            vface(pa[0], pa[1], A[0], A[1], fl, fl, c, c, hint), vface(Bp[0], Bp[1], pb[0], pb[1], fl, fl, c, c, hint);
            vface(A[0], A[1], Bp[0], Bp[1], fl, fl, 1.5, 1.5, hint), vface(A[0], A[1], Bp[0], Bp[1], 3.2, 3.2, c, c, hint);
          } else vface(pa[0], pa[1], pb[0], pb[1], lift(hc[0]), lift(hc[1]), capN, capN, hint);
        } else if (m.kind[nb] !== PK.wall) {
          if (m.vax[i] && m.vax[nb] && nb > i) {
            // dos bóvedas contiguas (cruce en T, pasillos paralelos): se cierra con pared el hueco entre los dos arcos, mirando hacia el más alto
            for (let k = 0; k < 6; k++) {
              const f0 = k / 6, f1 = (k + 1) / 6, p0 = [pa[0] + (pb[0] - pa[0]) * f0, pa[1] + (pb[1] - pa[1]) * f0], p1 = [pa[0] + (pb[0] - pa[0]) * f1, pa[1] + (pb[1] - pa[1]) * f1];
              const i0 = archAt(i, p0[0], p0[1]), i1 = archAt(i, p1[0], p1[1]), n0 = archAt(nb, p0[0], p0[1]), n1 = archAt(nb, p1[0], p1[1]);
              if (Math.abs(i0 - n0) < 0.01 && Math.abs(i1 - n1) < 0.01) continue;
              const iHigh = i0 + i1 > n0 + n1;
              G.wall.quad([p0[0], Math.min(i0, n0), p0[1]], [p1[0], Math.min(i1, n1), p1[1]], [p1[0], Math.max(i1, n1), p1[1]], [p0[0], Math.max(i0, n0), p0[1]], iHigh ? hint : [PDIRS[d][0], 0, PDIRS[d][1]]);
            }
          }
          const hn = NB[d].map(([sx, sz]) => corner(nb, sx, sz));
          const latStairs = (j: number) => m.ramp[j] === PR.stairs && d !== m.dir[j] && d !== (m.dir[j] ^ 1); // los peldaños dibujan sus propios costados
          if (!latStairs(i) && !latStairs(nb) && (hn[0] > hc[0] + 0.02 || hn[1] > hc[1] + 0.02)) {
            let a = pa, b = pb;
            if (cut && (d === cut.a || d === cut.b)) {
              const kx = cut.sx ? x1 : x0, kz = cut.sz ? z1 : z0, mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
              const aK = a[0] === kx && a[1] === kz;
              if (aK) a = mid(pa, pb); else b = mid(pa, pb);
              if (d === cut.a) { // la diagonal, una sola vez: de la mitad de un lado a la mitad del otro
                const ox = cut.sx ? x0 : x1, oz = cut.sz ? z0 : z1, p = [kx, (kz + oz) / 2], q = [(kx + ox) / 2, kz];
                vface(p[0], p[1], q[0], q[1], lift(hc[0]), lift(hc[0]), Math.max(hc[0], hn[0]), Math.max(hc[0], hn[0]), [-(cut.sx ? 1 : -1), 0, -(cut.sz ? 1 : -1)]);
              }
            }
            vface(a[0], a[1], b[0], b[1], lift(hc[0]), lift(hc[1]), Math.max(hc[0], hn[0]), Math.max(hc[1], hn[1]), hint);
          }
          const mouth = m.vax[nb] === (d < 2 ? 1 : 2) && !m.vax[i];
          if (mouth && c > PY.ceil + 0.02 || mouth && c >= PY.ceil - 0.02) {
            // boca del pasillo: la pared de la sala sobre el arco (lunete)
            const vo = m.voff[nb], base = d < 2 ? (ny - vo) * C : (nx - vo) * C;
            for (let k = 0; k < 6; k++) {
              const f0 = k / 6, f1 = (k + 1) / 6, p0 = [pa[0] + (pb[0] - pa[0]) * f0, pa[1] + (pb[1] - pa[1]) * f0], p1 = [pa[0] + (pb[0] - pa[0]) * f1, pa[1] + (pb[1] - pa[1]) * f1];
              const t0 = (d < 2 ? p0[1] : p0[0]) - base - 3, t1 = (d < 2 ? p1[1] : p1[0]) - base - 3, h0 = archY(t0), h1 = archY(t1);
              if (c > Math.min(h0, h1) + 0.01) G.wall.quad([p0[0], h0, p0[1]], [p1[0], h1, p1[1]], [p1[0], Math.max(c, h1), p1[1]], [p0[0], Math.max(c, h0), p0[1]], hint);
            }
          } else if (m.vax[nb] && !m.vax[i] && c > PY.spring + 0.02) {
            // el costado de una bóveda contra una sala: la pared sigue el arco (no una línea plana a 2,6 m, que tapaba el interior del arco)
            for (let k = 0; k < 6; k++) {
              const f0 = k / 6, f1 = (k + 1) / 6, p0 = [pa[0] + (pb[0] - pa[0]) * f0, pa[1] + (pb[1] - pa[1]) * f0], p1 = [pa[0] + (pb[0] - pa[0]) * f1, pa[1] + (pb[1] - pa[1]) * f1];
              const h0 = Math.min(c, archAt(nb, p0[0], p0[1])), h1 = Math.min(c, archAt(nb, p1[0], p1[1]));
              if (c > Math.min(h0, h1) + 0.01) G.wall.quad([p0[0], h0, p0[1]], [p1[0], h1, p1[1]], [p1[0], c, p1[1]], [p0[0], c, p0[1]], hint);
            }
          } else if (m.ceil[nb] < c - 0.02 && capN > m.ceil[nb] + 0.02 && !(m.vax[nb] === (d < 2 ? 1 : 2) && !m.vax[i])) G.wall.quad([pa[0], m.ceil[nb], pa[1]], [pb[0], m.ceil[nb], pb[1]], [pb[0], capN, pb[1]], [pa[0], capN, pa[1]], hint); // (junto a un hueco del forjado: solo el canto de la losa, la planta alta sigue abierta)
        }
        // balcón: parapeto de 1,05 m en los bordes de la torre y la galería que dan al vacío (salvo la escalera y la boca del tubo)
        if (m.ramp[i] === PR.none && m.ya[i] >= PY.tower - 0.01 && nb >= 0 && m.kind[nb] !== PK.wall && m.ya[nb] < PY.tower - 1 && m.ramp[nb] !== PR.stairs) {
          const mx_ = (pa[0] + pb[0]) / 2, mz_ = (pa[1] + pb[1]) / 2;
          if (!m.tubes.some((t) => Math.hypot(t.pts[0][0] - mx_, t.pts[0][2] - mz_) < 1.5)) {
            const y0 = m.ya[i], y1 = y0 + 1.05, dx = PDIRS[d][0], dz = PDIRS[d][1], th = 0.15;
            const qa = [pa[0] - dx * th, pa[1] - dz * th], qb = [pb[0] - dx * th, pb[1] - dz * th];
            G.wall.quad([pa[0], y0, pa[1]], [pb[0], y0, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]], [dx, 0, dz]);
            G.wall.quad([pa[0], y1, pa[1]], [pb[0], y1, pb[1]], [qb[0], y1, qb[1]], [qa[0], y1, qa[1]], [0, 1, 0]);
            G.wall.quad([qa[0], y0, qa[1]], [qb[0], y0, qb[1]], [qb[0], y1, qb[1]], [qa[0], y1, qa[1]], hint);
          }
        }
        // barandilla del tobogán: un borde de 0,45 m en los costados que no son de entrada ni de salida
        if (m.ramp[i] === PR.slide && d !== m.dir[i] && d !== (m.dir[i] ^ 1)) {
          const other = nb >= 0 && m.ramp[nb] === PR.slide;
          if (!other) G.slide.quad([pa[0], hc[0], pa[1]], [pb[0], hc[1], pb[1]], [pb[0], hc[1] + 0.45, pb[1]], [pa[0], hc[0] + 0.45, pa[1]], hint);
        }
      }
    }
    // PLANTA ALTA (m.up): suelo (llano o fondo de piscina elevada), techo a PY.tall, paredes contra el macizo y escalones entre suelos distintos.
    // Todo va a la malla 'deck' (mismo azulejo) con la clave de trozo desplazada. Los cantos de la losa junto a un hueco los dibuja la planta baja.
    const upWater: number[] = [];
    {
      const U = m.up, hole = (j: number) => U.kind[j] === PK.wall && m.kind[j] === PK.floor && m.ceil[j] >= PY.tall - 0.01, D = G.deck;
      for (let j = 0; j < W * H && !this.holes; j++) this.holes = hole(j);
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
        const i = at(cx, cy);
        if (U.kind[i] === PK.wall) continue; // (las columnas también llevan losa: sin ella se veía a través)
        const x0 = cx * C, x1 = x0 + C, z0 = cy * C, z1 = z0 + C, y = U.ya[i], c = U.ceil[i];
        (D.tint = tintOf(i)), (D.cur = chunkOf(cx, cy, 1));
        if (!mouth.has(W * H + i)) D.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0]);
        D.quad([x0, c, z0], [x1, c, z0], [x1, c, z1], [x0, c, z1], [0, -1, 0]);
        if (U.water[i]) upWater.push(x0, z0, x1, z1);
        for (let d = 0; d < 4; d++) {
          const nx = cx + PDIRS[d][0], ny = cy + PDIRS[d][1], hint = [-PDIRS[d][0], 0, -PDIRS[d][1]], [pa, pb] = OWN[d].map((s) => cw(cx, cy, s));
          const nb = nx >= 0 && ny >= 0 && nx < W && ny < H ? at(nx, ny) : -1;
          const top = nb < 0 || (U.kind[nb] === PK.wall && !hole(nb)) ? c : U.kind[nb] !== PK.wall ? U.ya[nb] : y;
          if (top > y + 0.02) D.quad([pa[0], y, pa[1]], [pb[0], y, pb[1]], [pb[0], top, pb[1]], [pa[0], top, pa[1]], hint);
        }
      }
    }
    // las paredes de los pozos: azulejo de piscina en franjas que se apagan con la hondura (hacia dentro: desde fuera no se ven)
    for (const w of this.wells) {
      G.pool.cur = chunkOf(Math.floor(w.x0 / C), Math.floor(w.z0 / C), w.layer);
      const NB = 10, h = WELL / NB;
      for (let k = 0; k < NB; k++) {
        const yt = w.fy - k * h, yb = yt - h;
        G.pool.tint = k < NB - 2 ? 0.8 * (1 - k / (NB - 2)) ** 2 : 0;
        G.pool.quad([w.x0, yb, w.z0], [w.x1, yb, w.z0], [w.x1, yt, w.z0], [w.x0, yt, w.z0], [0, 0, 1]);
        G.pool.quad([w.x0, yb, w.z1], [w.x1, yb, w.z1], [w.x1, yt, w.z1], [w.x0, yt, w.z1], [0, 0, -1]);
        G.pool.quad([w.x0, yb, w.z0], [w.x0, yb, w.z1], [w.x0, yt, w.z1], [w.x0, yt, w.z0], [1, 0, 0]);
        G.pool.quad([w.x1, yb, w.z0], [w.x1, yb, w.z1], [w.x1, yt, w.z1], [w.x1, yt, w.z0], [-1, 0, 0]);
      }
    }
    // ventanas al exterior (cristal blanco brillante con travesaños y marco) y la mancha de sol que proyectan en el suelo
    const patch: number[] = [], patchUv: number[] = [], patchI: number[] = [];
    const flatDeck = (x: number, z: number) => {
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) return false;
      const i = at(cx, cz);
      return m.kind[i] !== PK.wall && m.water[i] === 0 && m.ramp[i] === PR.none && m.ya[i] === 0 && !m.tun[i];
    };
    for (const w of m.windows) {
      const dx = PDIRS[w.d][0], dz = PDIRS[w.d][1], nx = -dx, nz = -dz, tx = dz !== 0 ? 1 : 0, tz = dx !== 0 ? 1 : 0;
      const ex = (w.x + 0.5) * C + dx * (C / 2) + nx * 0.03, ez = (w.y + 0.5) * C + dz * (C / 2) + nz * 0.03;
      const P = (t: number, y: number, off = 0) => [ex + tx * t + nx * off, y, ez + tz * t + nz * off];
      const hint = [nx, 0, nz], y0 = 1.5, y1 = 3.2, hw = 0.7;
      G.win.cur = G.bar.cur = chunkOf(w.x, w.y);
      G.win.quad(P(-hw - 0.7, y0 - 1, -0.7), P(hw + 0.7, y0 - 1, -0.7), P(hw + 0.7, y1 + 1, -0.7), P(-hw - 0.7, y1 + 1, -0.7), hint); // el exterior: cielo luminoso detrás del hueco
      const bar = (a: number, b: number, c: number, d: number) => G.bar.quad(P(a, c, 0.012), P(b, c, 0.012), P(b, d, 0.012), P(a, d, 0.012), hint);
      bar(-0.04, 0.04, y0, y1), bar(-hw, hw, 2.31, 2.39); // cruz central
      bar(-hw - 0.06, -hw, y0 - 0.06, y1 + 0.06), bar(hw, hw + 0.06, y0 - 0.06, y1 + 0.06), bar(-hw, hw, y0 - 0.06, y0), bar(-hw, hw, y1, y1 + 0.06); // marco
    }
    healT((['deck', 'wall', 'pool', 'ceil', 'slide'] as const).flatMap((k) => [...G[k].parts.values()]));
    for (const k of Object.keys(G) as (keyof typeof G)[]) for (const [key, g] of G[k].parts) {
      const mesh = new THREE.Mesh(own(g.build()), mats[k]);
      if (k !== 'win' && k !== 'bar') (mesh.castShadow = true), (mesh.receiveShadow = true, mesh.geometry.computeBoundingSphere(), this.cm.push(mesh));
      if (key >= 1e7) this.upMeshes.push(mesh); // planta alta: se oculta bajo tierra
      sc.add(mesh);
    }
    // el agua de las piscinas elevadas: un plano barato a PY.upSurf (sin reflector: el reflejo planar es solo el de la planta baja)
    if (upWater.length) {
      const p: number[] = [], ix: number[] = [];
      for (let k = 0; k < upWater.length; k += 4) {
        const b = p.length / 3, [x0, z0, x1, z1] = upWater.slice(k, k + 4);
        p.push(x0, PY.upSurf, z0, x1, PY.upSurf, z0, x1, PY.upSurf, z1, x0, PY.upSurf, z1), ix.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
      const ug = own(new THREE.BufferGeometry());
      ug.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      ug.setAttribute('normal', new THREE.Float32BufferAttribute(p.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3)); // sin normales el sombreado daba NaN: cuadrados negros (el bloom lo extendía)
      ug.setIndex(ix);
      const uw = new THREE.Mesh(ug, own(new THREE.MeshStandardMaterial({ color: 0x3fbfb4, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.2 })));
      uw.frustumCulled = false;
      this.upWater = uw;
      this.upMeshes.push(uw);
      sc.add(uw);
    }
    // el fondo de cada pozo: un tapón negro mate (sin niebla ni brillo) que cierra lo que haya debajo
    if (this.wells.length) {
      const pmat = own(new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
      for (const l of [0, 1] as const) {
        const gs = this.wells.filter((w) => w.layer === l).map((w) => new THREE.PlaneGeometry(C * 2, C * 2).rotateX(-Math.PI / 2).translate(w.x0 + C, w.fy - WELL + 0.05, w.z0 + C));
        if (!gs.length) continue;
        const dm = new THREE.Mesh(own(mergeGeometries(gs)!), pmat);
        if (l) this.upMeshes.push(dm);
        sc.add(dm);
      }
    }

    // columnas: por trozo de mapa, una malla fusionada con la luz horneada en los vértices y dos niveles de detalle (cerca / lejos)
    const colLen = PY.tall - PY.deep + 0.3, tmp = new THREE.Object3D();
    const byChunk = new Map<number, { x: number; y: number }[]>();
    m.columns.forEach((c) => { const key = chunkOf(c.x, c.y); (byChunk.get(key) ?? byChunk.set(key, []).get(key)!).push(c); });
    for (const list of byChunk.values()) {
      const ox = list.reduce((a, c) => a + (c.x + 0.5) * C, 0) / list.length, oz = list.reduce((a, c) => a + (c.y + 0.5) * C, 0) / list.length;
      const build = (radial: number, hs: number) =>
        own(mergeGeometries(list.map((c) => {
          const g = new THREE.CylinderGeometry(0.61, 0.61, colLen, radial, hs, true), per = 0.96, turns = Math.round((2 * Math.PI * 0.61) / per), uv = g.attributes.uv;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * turns * per, uv.getY(k) * colLen);
          g.translate((c.x + 0.5) * C - ox, (PY.tall + PY.deep + 0.3) / 2, (c.y + 0.5) * C - oz);
          const pos = g.attributes.position, col = new Float32Array(pos.count * 3), tn = tintOf(at(c.x, c.y));
          for (let k = 0; k < pos.count; k++) { const v = tn * lightAt(pos.getX(k) + ox, pos.getY(k), pos.getZ(k) + oz, false); col.set([v, v * (0.985 - 0.015 * v), v * (0.9 + 0.1 * (1 - v))], k * 3); }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          return g;
        }))!);
      const lod = new THREE.LOD(), hi = new THREE.Mesh(build(32, 12), mats.wall), lo = new THREE.Mesh(build(12, 4), mats.wall);
      hi.castShadow = hi.receiveShadow = lo.castShadow = lo.receiveShadow = true;
      lod.addLevel(hi, 0), lod.addLevel(lo, 45), lod.position.set(ox, 0, oz);
      sc.add(lod);
    }
    const fg = own(new THREE.BoxGeometry(1.1, 0.06, 0.28)), fm = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const nLow = m.lamps.length, fix = new THREE.InstancedMesh(fg, fm, Math.max(1, nLow + m.lampsUp.length));
    m.lampsUp.forEach((c, k) => (tmp.position.set((c.x + 0.5) * C, PY.tall - 0.04, (c.y + 0.5) * C), tmp.updateMatrix(), fix.setMatrixAt(nLow + k, tmp.matrix)));
    m.lamps.forEach((c, k) => (tmp.position.set((c.x + 0.5) * C, (m.vax[at(c.x, c.y)] ? archY((m.voff[at(c.x, c.y)] + 0.5) * C - 3) : m.ceil[at(c.x, c.y)]) - 0.04, (c.y + 0.5) * C), tmp.updateMatrix(), fix.setMatrixAt(k, tmp.matrix)));
    fix.count = nLow + m.lampsUp.length;
    fix.frustumCulled = false;
    sc.add(fix);

    // toboganes de tubo cerrado, opacos: tramos rectos a 90°/45° (generados) y un serpentín de llegada (models/pool/spiral.glb)
    const TUBE_COL = [0xc4120a, 0x1f7fd0, 0xe6c200, 0x8a35c0, 0x2aa05a, 0xe08a00, 0x12a39a, 0xd42a8a, 0x6cb81e, 0x3b46c4, 0xe8e6dc], col0 = m.start.x * 7 + m.start.y * 13 + m.exit.x; // cada mapa empieza la paleta por un sitio
    const ribs = (len: number) => {
      const cv = Object.assign(document.createElement('canvas'), { width: 64, height: 4 }), x = cv.getContext('2d')!, gr = x.createLinearGradient(0, 0, 64, 0);
      gr.addColorStop(0, '#000'), gr.addColorStop(0.5, '#fff'), gr.addColorStop(1, '#000');
      (x.fillStyle = gr), x.fillRect(0, 0, 64, 4);
      const tx = own(new THREE.CanvasTexture(cv));
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping, tx.repeat.set(Math.max(1, len / 0.6), 1);
      return tx;
    };
    class Helix extends THREE.Curve<THREE.Vector3> {
      constructor(private ax: number, private az: number, private yTop: number, private a0: number, private turns: number) { super(); }
      getPoint(u: number, out = new THREE.Vector3()) {
        const a = this.a0 + u * this.turns * 2 * Math.PI;
        return out.set(this.ax + COIL.rho * Math.cos(a), this.yTop - ((COIL.rise * this.turns) / 5) * u, this.az + COIL.rho * Math.sin(a));
      }
    }
    m.tubes.forEach((t, k) => {
      const col = TUBE_COL[(col0 + k * 4) % TUBE_COL.length], col2 = k % 2 ? TUBE_COL[(col0 + k * 4 + 5) % TUBE_COL.length] : col, mkMat = (len: number) => own(new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.34, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.22, sheen: 0.4, sheenColor: new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.5), bumpMap: len ? ribs(len) : null, bumpScale: 1.2, emissive: col, emissiveIntensity: 0.06, side: THREE.DoubleSide }));
      const v = (t.back ? [t.back, ...t.pts] : t.pts).map((p) => new THREE.Vector3(...p)), route = new THREE.CurvePath<THREE.Vector3>();
      let cur = v[0];
      for (let j = 1; j < v.length - 1; j++) {
        // esquinas redondeadas de 3 m: recta hasta el arranque de la curva y Bézier por el vértice
        const a = v[j].clone().sub(v[j - 1]), b = v[j + 1].clone().sub(v[j]), r = Math.min(3, a.length() / 2, b.length() / 2);
        const p0 = v[j].clone().addScaledVector(a.normalize(), -r), p1 = v[j].clone().addScaledVector(b.normalize(), r);
        route.add(new THREE.LineCurve3(cur, p0)), route.add(new THREE.QuadraticBezierCurve3(p0, v[j], p1));
        cur = p1;
      }
      route.add(new THREE.LineCurve3(cur, v[v.length - 1]));
      const c = t.coil, nt = c.turns ?? COIL.turns, a0 = Math.atan2(-c.dx, c.dz), helix = new Helix(c.x, c.z, v[v.length - 1].y, a0, nt), hEnd = helix.getPoint(1);
      const tl = c.tail ?? 2.5, tail = new THREE.LineCurve3(hEnd, hEnd.clone().add(new THREE.Vector3(c.dx * tl, 0, c.dz * tl)));
      const whole = new THREE.CurvePath<THREE.Vector3>();
      route.curves.forEach((q) => whole.add(q)), whole.add(helix as unknown as THREE.Curve<THREE.Vector3>), whole.add(tail);
      const len = whole.getLength();
      for (const part of [route, tail] as THREE.Curve<THREE.Vector3>[]) {
        const pl = part.getLength();
        const mesh = new THREE.Mesh(own(new THREE.TubeGeometry(part, Math.ceil(pl / 0.5), COIL.r, 20, false)), mkMat(pl));
        mesh.frustumCulled = false;
        sc.add(mesh);
      }
      if (kit.spiral && nt === COIL.turns) { // (el modelo trae 5 vueltas: los más cortos se generan)
        const g = new THREE.Group(), o = kit.spiral.clone(true), sm = mkMat(0);
        o.position.set(-0.066, 0, -0.054);
        o.traverse((n) => { if ((n as THREE.Mesh).isMesh) (n as THREE.Mesh).material = sm; });
        g.add(o), g.scale.setScalar(COIL.f), (g.rotation.y = -a0);
        const lowGeo = own(new THREE.TubeGeometry(helix, 140, COIL.r, 10, false));
        lowGeo.translate(-c.x, -c.yEnd, -c.z);
        const lod = new THREE.LOD();
        lod.addLevel(g, 0), lod.addLevel(new THREE.Mesh(lowGeo, mkMat(0)), 35), lod.position.set(c.x, c.yEnd, c.z);
        sc.add(lod);
      } else {
        const mesh = new THREE.Mesh(own(new THREE.TubeGeometry(helix, 80 * nt, COIL.r, 16, false)), mkMat(0));
        mesh.frustumCulled = false;
        sc.add(mesh);
      }
      // bridas de plástico atornilladas cada ~2.4 m (perfil de revolución escalonado + 16 tornillos hexagonales por cara) y boca acampanada
      {
        const R = COIL.r, prof = [[R - 0.01, -0.05], [R + 0.035, -0.05], [R + 0.035, -0.032], [R + 0.075, -0.03], [R + 0.08, -0.018], [R + 0.08, 0.018], [R + 0.075, 0.03], [R + 0.035, 0.032], [R + 0.035, 0.05], [R - 0.01, 0.05]].map(([x, y]) => new THREE.Vector2(x, y));
        const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(prof, 40)];
        for (const side of [-1, 1]) for (let q = 0; q < 16; q++) {
          const an = (q / 16) * Math.PI * 2, bolt = new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6);
          bolt.translate(Math.cos(an) * (R + 0.058), side * 0.04, Math.sin(an) * (R + 0.058));
          parts.push(bolt);
        }
        const fg = own(mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g))!);
        fg.rotateX(Math.PI / 2);
        const fm = own(new THREE.MeshPhysicalMaterial({ color: col2, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, side: THREE.DoubleSide }));
        const bell = [[R, 0.0], [R + 0.01, -0.06], [R + 0.05, -0.2], [R + 0.16, -0.38], [R + 0.3, -0.5], [R + 0.33, -0.52], [R + 0.33, -0.55], [R + 0.28, -0.55], [R + 0.26, -0.5], [R + 0.13, -0.36], [R + 0.03, -0.2], [R - 0.01, -0.06], [R - 0.02, 0]].map(([x, y]) => new THREE.Vector2(x, y));
        const bg = own(new THREE.LatheGeometry(bell, 40));
        bg.rotateX(Math.PI / 2);
        const place = (u: number, M: THREE.Matrix4, fwd = 1, cv: THREE.Curve<THREE.Vector3> = route) => {
          const p = cv.getPointAt(u), tg = cv.getTangentAt(u).multiplyScalar(fwd);
          M.lookAt(new THREE.Vector3(), tg.clone().negate(), new THREE.Vector3(0, 1, 0));
          return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromRotationMatrix(M), new THREE.Vector3(1, 1, 1));
        };
        const rl = route.getLength(), n = Math.max(1, Math.floor(rl / 2.4)), M = new THREE.Matrix4(), im = new THREE.InstancedMesh(fg, fm, n);
        for (let q = 0; q < n; q++) im.setMatrixAt(q, place((q + 0.5) / n, M));
        im.computeBoundingSphere(), sc.add(im);
        // fundas de goma donde la ruta atraviesa una pared o un techo: un anillo grueso que tapa el corte
        const solid = (q: number) => { const p = route.getPointAt(q), i = at(Math.floor(p.x / C), Math.floor(p.z / C)); return m.kind[i] === 0 || p.y > m.ceil[i] - 0.1; };
        const cuts: number[] = [], steps = Math.ceil(rl / 0.15);
        let prev = solid(0);
        for (let q = 1; q <= steps; q++) { const u = q / steps, now = solid(u); if (now !== prev) cuts.push(u); prev = now; }
        if (cuts.length) {
          const gp = [[R - 0.01, -0.22], [R + 0.03, -0.2], [R + 0.12, -0.14], [R + 0.2, -0.07], [R + 0.23, 0], [R + 0.2, 0.07], [R + 0.12, 0.14], [R + 0.03, 0.2], [R - 0.01, 0.22]].map(([x, y]) => new THREE.Vector2(x, y));
          const gg = own(new THREE.LatheGeometry(gp, 32));
          gg.rotateX(Math.PI / 2);
          const gm = own(new THREE.MeshPhysicalMaterial({ color: 0x2c312e, roughness: 0.85, side: THREE.DoubleSide })), gi = new THREE.InstancedMesh(gg, gm, cuts.length);
          cuts.forEach((u, q) => gi.setMatrixAt(q, place(u, M)));
          gi.frustumCulled = false, sc.add(gi);
        }
        const mouth = new THREE.Mesh(bg, fm);
        mouth.applyMatrix4(place(0, M)), mouth.frustumCulled = false;
        sc.add(mouth);
        const end = new THREE.Mesh(bg, fm); // la salida: abierta y acampanada, con sitio libre delante
        end.applyMatrix4(place(1, M, -1, tail)), end.frustumCulled = false;
        sc.add(end);
      }
      {
        const mouth = v[0], endP = tail.getPoint(1), n = Math.ceil(len / 0.4);
        for (let q = 0; q <= n; q++) {
          const p = whole.getPointAt(q / n);
          if (Math.hypot(p.x - mouth.x, p.z - mouth.z) < 1.4 || Math.hypot(p.x - t.pts[0][0], p.z - t.pts[0][2]) < 1.4 || Math.hypot(p.x - endP.x, p.z - endP.z) < 1.8) continue;
          this.tubePts.push([p.x, p.y, p.z]);
        }
      }
      this.tubes.push({ curve: whole, len, x: t.pts[0][0], z: t.pts[0][2], s0: t.back ? Math.hypot(t.pts[0][0] - t.back[0], t.pts[0][2] - t.back[2]) : 0 });
    });

    // el reflejo del sol en el suelo (aditivo, sin escribir profundidad)
    if (patch.length && (patch as number[]).length < 0) {
      const pg = own(new THREE.BufferGeometry());
      pg.setAttribute('position', new THREE.Float32BufferAttribute(patch, 3));
      pg.setAttribute('uv', new THREE.Float32BufferAttribute(patchUv, 2));
      pg.setIndex(patchI);
      const pm = own(new THREE.MeshBasicMaterial({ map: own(sunPatch()), color: 0xfff0c4, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const pmesh = new THREE.Mesh(pg, pm);
      pmesh.frustumCulled = false;
      pmesh.renderOrder = 2;
      sc.add(pmesh);
    }

    // luz por sala: cada luminaria sale del nivel de su sala (las bajas casi apagadas); el parpadeo se mueve en update()
    this.lamps = fix;
    this.lampLvl = [...m.lamps.map((l) => (l.r < 0 ? 0.7 : m.rooms[l.r].light)), ...m.lampsUp.map(() => 0.8)];
    this.lampLvl.forEach((v, k) => fix.setColorAt(k, this.lampBase.setScalar((v < 0.45 ? 0.12 : v) * LG)));
    this.lampCur = Float32Array.from(this.lampLvl);
    this.lampPos = [...m.lamps.map((c) => [(c.x + 0.5) * C, (m.vax[at(c.x, c.y)] ? archY((m.voff[at(c.x, c.y)] + 0.5) * C - 3) : m.ceil[at(c.x, c.y)]) - 0.3, (c.y + 0.5) * C]), ...m.lampsUp.map((c) => [(c.x + 0.5) * C, PY.tall - 0.3, (c.y + 0.5) * C])];
    m.lamps.forEach((l, k) => { if (l.r >= 0 && m.rooms[l.r].flicker && this.lampLvl[k] >= 0.45) this.flickIdx.push(k); });
    // luces reales para las luminarias que parpadean más cercanas (el resto de la luz está horneada): el parpadeo se ve en las superficies
    this.pls = Array.from({ length: 4 }, () => new THREE.PointLight(0xfff0d8, 0, 11, 1.6));
    if (!raInit) (RectAreaLightUniformsLib.init(), (raInit = true));
    this.ras = Array.from({ length: 3 }, () => { const l = new THREE.RectAreaLight(0xfff0d8, 0, 1.1, 0.28); l.rotation.x = -Math.PI / 2; sc.add(l); return l; });
    sc.add(...this.pls);

    // piezas del kit sobre el nivel (pocas y colocadas por semilla; escalas en metros)
    const rnd = (() => { let a = seed ^ 0x51ed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const fitObj = (o: THREE.Object3D | undefined, h: number) => {
      if (!o) return null;
      const c = o.clone(true), b = new THREE.Box3().setFromObject(c), k = h / Math.max(b.max.y - b.min.y, 1e-6), g = new THREE.Group();
      c.scale.setScalar(k), c.position.set(-((b.min.x + b.max.x) / 2) * k, -b.min.y * k, -((b.min.z + b.max.z) / 2) * k);
      g.add(c);
      return g;
    };
    /** Una pieza pequeña solo se dibuja cerca (nivel de detalle: a más de `far` metros desaparece). */
    const addLod = (o: THREE.Object3D, far = 40) => {
      const l = new THREE.LOD();
      l.position.copy(o.position), o.position.set(0, 0, 0);
      l.addLevel(o, 0), l.addLevel(new THREE.Object3D(), far);
      sc.add(l);
    };
    const put = (o: THREE.Object3D | null, x: number, y: number, z: number, ry: number) => {
      if (!o) return;
      o.position.set(x, y, z), (o.rotation.y = ry), addLod(o);
    };
    // las duchas (hasta 60, de 8 mallas cada una) van por lotes: una malla instanciada por material y sala, en vez de ~480 llamadas de dibujo
    const showerTpl = fitObj(kit.shower, 2.1), showers = new Map<number, THREE.Matrix4[]>();
    const cellC = (x: number, y: number) => [(x + 0.5) * C, (y + 0.5) * C];
    const flat = (i: number) => m.kind[i] !== PK.wall && m.water[i] === 0 && m.ramp[i] === PR.none && m.ya[i] === 0 && !m.tun[i];
    let nRail = 0, nLadder = 0, nShower = 0, nVent = 0, nGuard = 0, nBuoy = 0, nLamp = 0;
    m.rooms.forEach((r, ri) => {
      let edge = 0, wallCells = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = at(x, y);
        if (!flat(i)) continue;
        for (let d = 0; d < 4; d++) {
          const ox = x + PDIRS[d][0], oy = y + PDIRS[d][1];
          if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue;
          const [cx, cz] = cellC(x, y), dx = PDIRS[d][0], dz = PDIRS[d][1];
          if (m.water[at(ox, oy)] === 1 && m.ramp[at(ox, oy)] === PR.none && r.type === 'pool') {
            edge++;
            // escalerilla de la piscina en el borde de la cubierta, cada 9 celdas de borde
            if (edge % 9 === 4 && nLadder < 12) (put(fitObj(kit.ladder, 1.5), cx + dx * (C / 2 - 0.05), -0.6, cz + dz * (C / 2 - 0.05), Math.atan2(dx, dz)), nLadder++);
            // foco de ojo de pez en la pared sumergida de la piscina (el disco mira hacia el agua)
            if (edge % 17 === 3 && nLamp < 8) {
              const f = fitObj(kit.fisheye, 0.16);
              if (f) {
                f.position.set(cx + dx * (C / 2 + 0.02), -0.6, cz + dz * (C / 2 + 0.02));
                f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz));
                addLod(f, 25), nLamp++;
              }
            }
          } else if (solid(ox, oy) && !m.tun[at(ox, oy)]) {
            wallCells++;
            // ducha pegada a la pared en salas con piscina; rejilla de ventilación alta en las demás
            if (r.type === 'showers') { if ((x + y) % 3 === 0 && nShower < 36 && showerTpl) (showers.set(ri, [...(showers.get(ri) ?? []), new THREE.Matrix4().makeRotationY(Math.atan2(-dx, -dz)).setPosition(cx + dx * (C / 2 - 0.25), 0, cz + dz * (C / 2 - 0.25))]), nShower++); }
            else if (wallCells % 19 === 7 && nVent < 14 && !m.windows.some((w) => w.room === ri)) {
              const v = fitObj(kit.vent, 0.9);
              if (v) (v.position.set(cx + dx * (C / 2 - 0.02), 2.9, cz + dz * (C / 2 - 0.02)), (v.rotation.y = Math.atan2(dz, -dx)), addLod(v), nVent++);
            }
          }
        }
      }
      // pasamanos a los dos lados de los escalones que bajan al agua
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = at(x, y);
        if (m.ramp[i] !== PR.stairs || m.water[i] !== 1 || nRail >= 10) continue;
        const d = m.dir[i], horiz = d < 2;
        for (const sd of horiz ? [2, 3] : [0, 1]) {
          const ox = x + PDIRS[sd][0], oy = y + PDIRS[sd][1];
          if (m.ramp[at(ox, oy)] === PR.stairs || m.kind[at(ox, oy)] === PK.wall) continue;
          const rl = fitObj(kit.railing, 1.0);
          if (rl) (put(rl, (x + 0.5) * C + PDIRS[sd][0] * (C / 2 - 0.1), -0.4, (y + 0.5) * C + PDIRS[sd][1] * (C / 2 - 0.1), horiz ? Math.PI / 2 : 0), nRail++);
        }
      }
      // silla de socorrista en la esquina de la cubierta de las piscinas grandes
      if (r.type === 'pool' && r.w >= 16 && nGuard < 5) {
        const gx = r.x + r.w - 2, gy = r.y + r.h - 2;
        if (flat(at(gx, gy))) {
          const [cx, cz] = cellC(gx, gy);
          put(fitObj(kit.lifeguard, 2.3), cx, 0, cz, Math.atan2(r.x + r.w / 2 - gx, r.y + r.h / 2 - gy)), nGuard++;
        }
      }
      // boyas flotando en el centro hondo de la piscina
      if (r.type === 'pool' && nBuoy < 6) {
        const bx = r.x + (r.w >> 1), by = r.y + (r.h >> 1);
        if (m.water[at(bx, by)] === 2) {
          const [cx, cz] = cellC(bx, by);
          put(fitObj(kit.buoy, 1.0), cx + (rnd() - 0.5), PY.surf - 0.25, cz + (rnd() - 0.5), rnd() * 6), nBuoy++;
        }
      }
    });

    for (const [ri, ms] of showers) {
      const r = m.rooms[ri], g = new THREE.Group(), l = new THREE.LOD(), M = new THREE.Matrix4();
      showerTpl!.updateMatrixWorld(true);
      showerTpl!.traverse((o) => {
        const me = o as THREE.Mesh;
        if (!me.isMesh) return;
        const im = own(new THREE.InstancedMesh(me.geometry, me.material, ms.length));
        ms.forEach((P, i) => im.setMatrixAt(i, M.multiplyMatrices(P, me.matrixWorld)));
        im.computeBoundingSphere();
        g.add(im);
      });
      // (las matrices van en coordenadas del mundo: el LOD se queda en el origen y mide la distancia con su propia posición, así que se le da el centro de la sala y se compensa)
      l.position.set((r.x + r.w / 2) * C, 0, (r.y + r.h / 2) * C), g.position.copy(l.position).negate();
      l.addLevel(g, 0), l.addLevel(new THREE.Object3D(), 40 + (Math.hypot(r.w, r.h) * C) / 2);
      sc.add(l), this.heavy.push(l);
    }

    // el agua: una sola malla con todas las celdas, un Reflector para todas (la profundidad y el borde de espuma vienen por vértice)
    const wp: number[] = [], wd: number[] = [], we: number[] = [], wi: number[] = [];
    const isW = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m.water[at(x, y)] > 0;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const i = at(cx, cy);
      if (!m.water[i]) continue;
      const base = wp.length / 3;
      for (const [sx, sz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        wp.push((cx + sx) * C, -(cy + sz) * C, 0); // el Reflector se gira -90° en X: y local = -z del mundo
        // profundidad media de las celdas de agua que tocan la esquina: sin corte seco entre una zona honda y otra llana
        let ds = 0, dn = 0;
        for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (isW(cx + sx + ox, cy + sz + oz)) (ds += PY.surf - m.ya[at(cx + sx + ox, cy + sz + oz)]), dn++;
        wd.push(ds / dn);
        we.push(isW(cx + sx - 1, cy + sz - 1) && isW(cx + sx, cy + sz - 1) && isW(cx + sx - 1, cy + sz) && isW(cx + sx, cy + sz) ? 1 : 0);
      }
      wi.push(base, base + 2, base + 1, base, base + 3, base + 2); // (el eje y local es -z: el orden se invierte para que mire hacia arriba)
    }
    const wg = own(new THREE.BufferGeometry());
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute('aDepth', new THREE.Float32BufferAttribute(wd, 1));
    wg.setAttribute('aEdge', new THREE.Float32BufferAttribute(we, 1));
    wg.setIndex(wi);
    const shader = {
      name: 'PoolWaterMap',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        uTime: { value: 0 }, uRip: { value: this.rip }, uCam: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector2(1, 1) }, uDeep: { value: 1 }, uCeil: { value: PY.ceil },
      }]),
      vertexShader: vert
        .replace('varying vec4 vUv;', 'varying vec4 vUv;\nattribute float aDepth;\nattribute float aEdge;\nvarying float vDepth;\nvarying float vEdge;')
        .replace('vUv = textureMatrix', 'vDepth = aDepth; vEdge = aEdge; vUv = textureMatrix'),
      fragmentShader: frag
        .replace('varying vec4 vUv;', 'varying vec4 vUv;\nvarying float vDepth;\nvarying float vEdge;')
        .replace('float depth = uDeep + 0.0;', 'float depth = vDepth;')
        .replace('vec2 e = uHalf - abs(vW.xz);', 'vec2 e = vec2(vEdge * 1.5);')
        // visto desde abajo (nadando): la superficie es un techo verdoso con cáusticas
        .replace('void main(){\n  vec3 V', 'void main(){\n  if (!gl_FrontFacing) { gl_FragColor = vec4(mix(vec3(0.10, 0.42, 0.38), vec3(0.75, 0.95, 0.85), 0.3 + 0.5 * caustic(vW.xz * 0.7, uTime)), 1.0);\n  #include <fog_fragment>\n  return; }\n  vec3 V'),
    };
    const dpr = Math.min(devicePixelRatio, 1080 / Math.max(renderer.domElement.clientHeight, 1));
    const rf = new Reflector(wg, {
      textureWidth: Math.max(256, Math.floor(renderer.domElement.clientWidth * dpr * 0.5)),
      textureHeight: Math.max(256, Math.floor(renderer.domElement.clientHeight * dpr * 0.5)),
      clipBias: 0.003, multisample: 0, shader,
    });
    this.rfm = rf;
    const rb = rf.onBeforeRender.bind(rf); // el reflejo solo pinta lo cercano (60 m): es otra pasada entera de la escena
    rf.onBeforeRender = (...a: Parameters<typeof rb>) => { if (this.skipRefl) return; this.aoCull(true, 60), rb(...a), this.aoCull(false); };
    this.water = rf.material as THREE.ShaderMaterial;
    this.water.fog = true;
    this.water.side = THREE.DoubleSide;
    rf.position.set(0, PY.surf, 0);
    rf.rotation.x = -Math.PI / 2;
    rf.frustumCulled = false;
    sc.add(rf);
    own(rf);

    this.px = (m.start.x + 0.5) * C;
    this.pz = (m.start.y + 0.5) * C;
    this.py = poolCellY(m, m.start.x, m.start.y, 0);
    this.yaw = Math.atan2(-(W / 2 * C - this.px), -(H / 2 * C - this.pz)); // mirando al centro del mapa

    // la salida: un marco de puerta de ascensor con una luz verdosa, contra la pared de la celda y mirando a su primer lado libre
    {
      const e = m.exit, [wx, wy] = exW, dx = -wx, dy = -wy, ex = (e.x + wx + 0.5) * C, ez = (e.y + wy + 0.5) * C; // (ex, ez): el centro de la cabina, en la celda de pared; la puerta mira a la celda de la salida
      this.exit.x = ex, this.exit.z = ez;
      // la cabina (ver elevator.ts) llena esa celda de pared: la puerta queda a ras del muro; cerrada hasta cumplir la misión
      const cab = (this.cab = own(new ElevatorCab(C, C - 0.04, 2.5, 0, true))), g = cab.group, fy = m.ya[e.y * W + e.x];
      const glow = new THREE.Mesh(own(new THREE.BoxGeometry(0.9, 0.07, 0.07)), own(new THREE.MeshStandardMaterial({ color: 0x9dffd0, emissive: 0x7dffc0, emissiveIntensity: 2.2 })));
      glow.position.set(0, 2.3, 0.04), g.add(glow);
      const lt = new THREE.PointLight(0xbfffe0, 5, 9, 2);
      lt.position.set(0, 2.1, 0.8), g.add(lt);
      g.position.set(ex + dx * (C / 2), fy, ez + dy * (C / 2)); // el umbral, en el plano del muro (a la altura del suelo de la salida: puede ser poco honda)
      g.rotation.y = Math.atan2(dx, dy);
      this.exitBox = [ex - C / 2, ez - C / 2, ex + C / 2, ez + C / 2, dx, dy];
      sc.add(g);
    }
    this.initExtras(kit);
  }

  // ── jabones, bebederos, tanque y pistola de agua ─────────────────────────

  /** Con el traje de buzo: aire x2,5 y -15 % de velocidad. */
  tank = false;
  /** Lo recogible del nivel (ver pickups.ts). */
  pickups!: PoolPickups;
  private kit!: PoolKit;
  /** Multiplicador de velocidad que pone quien lleva las manos (game.poolHands): p. ej. enfocar con la camcorder. */
  slowMul = 1;
  /** Multiplicadores de velocidad (mejoras, dificultad) y de salto: los pone Game con los del Player; las constantes de andar, correr y saltar son las de locomotion.ts. */
  speedK = 1;
  jumpK = 1;
  private refillAt: { x: number; z: number; y: number }[] = [];
  private wetT = 0;
  private stunT = 0;
  /** La barra de la pistola de agua del HUD: si se muestra y cuánto queda (lo pone Game con los del Player). */
  sqShow = false;
  sqVal = 1;
  private fxEl?: HTMLDivElement;

  /** Mojado (x0,5 de velocidad) o parado, durante `ms` (lo manda el servidor). */
  hit(kind: 'wet' | 'stun', ms: number) {
    if (kind === 'wet') this.wetT = Math.max(this.wetT, ms / 1000);
    else this.stunT = Math.max(this.stunT, ms / 1000);
  }

  /** Los objetos soltados por los jugadores (`snapshot.drops`, ids `d…`): los nuevos aparecen y los que ya no están desaparecen. */
  syncDrops(list: Drop[]) {
    const k = this.kit, models = Object.fromEntries(Object.entries({ water: [k.water, 0.17], flashlight: [k.flashlight, 0.24], camera: [k.camera, 0.22], tank: [k.tank, 0.6], watergun: [k.watergun, 0.4] }).filter(([, v]) => v[0])) as Partial<Record<ItemId | 'loot', PickupModel>>;
    models.loot = (r) => [lootModel(r), 0.24];
    this.pickups.syncDrops(list, models);
  }

  private initExtras(kit: PoolKit) {
    const sc = this.scene, m = this.map, own = <T extends { dispose(): void }>(o: T) => (this.owned.push(o), o);
    this.kit = kit;
    // recogibles: las celdas del mapa plano del servidor (jabones t…, latas w…, linternas f…, tanque k0, pistola p0); si su celda es honda quedan sumergidos
    const pm = poolMaze(this.seed);
    const pk = (this.pickups = new PoolPickups({ root: sc, solid: (x, z) => this.solidAt(x, z), cellAt: (x, z) => ({ x: Math.floor(x / C), y: Math.floor(z / C) }) }, this.camera, m, pm.lay));
    pk.floorHint = () => this.py;
    const put = (id: string, kind: Pickup['kind'], src: THREE.Object3D | undefined, c: Cell, size: number, rar?: number) => src && pk.put(id, kind, c, src, size, 0, undefined, false, rar);
    if (this.withSoaps) pm.tapes.forEach((c, i) => put('t' + i, 'tape', kit.soap, c, 0.2));
    (pm.waters ?? []).forEach((c, i) => put('w' + i, 'water', kit.water, c, 0.17));
    (pm.flashlights ?? []).forEach((c, i) => put('f' + i, 'flashlight', kit.flashlight, c, 0.24));
    if (pm.camera) put('c', 'camera', kit.camera, pm.camera, 0.22); // la cámara de fotos (servidor: id 'c')
    if (pm.tank) put('k0', 'tank', kit.tank, pm.tank, 0.6);
    if (pm.watergun) put('p0', 'watergun', kit.watergun, pm.watergun, 0.4);
    itemSpots(pm).filter((o) => o.kind === 'loot').forEach(({ id, cell: c }) => pk.put(id, 'loot', c, lootModel(spotRarity(id, c, LEVELS.poolrooms?.luck)), 0.24, 0, undefined, false, spotRarity(id, c, LEVELS.poolrooms?.luck), true)); // el botín: solo para vender (los ids, los del servidor)
    // bebederos: los puntos de recarga del mapa (`refills`, cuando shared los trae)
    for (const [c, l] of [...m.refills.map((c) => [c, 0] as const), ...m.refillsUp.map((c) => [c, 1] as const)]) {
      const x = (c.x + 0.5) * C, z = (c.y + 0.5) * C, gy = poolCellY(m, c.x, c.y, l);
      this.refillAt.push({ x, z, y: gy });
      if (!kit.birdbath) continue;
      const b = kit.birdbath.clone(true), bb = new THREE.Box3().setFromObject(b), k = 1.0 / Math.max(bb.max.y - bb.min.y, 1e-6);
      b.scale.setScalar(k);
      b.position.set(x - ((bb.min.x + bb.max.x) / 2) * k, gy - bb.min.y * k, z - ((bb.min.z + bb.max.z) / 2) * k);
      sc.add(b);
    }
    sc.add(this.camera);
    // mojado: viñeta azul
    const fx = (this.fxEl = document.createElement('div'));
    fx.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:8;opacity:0;transition:opacity .3s;background:radial-gradient(ellipse at center,rgba(0,40,90,0) 40%,rgba(30,110,200,.5) 100%)';
    document.body.append(fx);
    own({ dispose: () => fx.remove() });
  }

  /** Cada fotograma: jabones (giran y flotan, se cogen con G), pistola, chorro, recarga y mojado/parada. Devuelve los controles con la velocidad que toca. */
  private extras(dt: number, c: Controls): Controls {
    // mojado / parado
    this.wetT = Math.max(0, this.wetT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    if (this.fxEl) this.fxEl.style.opacity = this.wetT > 0 || this.stunT > 0 ? '1' : '0';
    const k = (this.stunT > 0 ? 0 : this.wetT > 0 ? 0.5 : 1) * (this.tank ? TANK_SLOW : 1) * this.slowMul;
    return k === 1 ? c : { ...c, move: c.move.clone().multiplyScalar(k), jump: this.stunT > 0 ? false : c.jump };
  }

  /** Lo que la sala necesita saber de mí (posición de los pies, hacia dónde miro, a qué ritmo ando y si nado). */
  get state() {
    return { x: this.px, y: this.py, z: this.pz, yaw: this.yaw, pitch: this.pitch, speed: this.hs, air: this.air && !this.swim, vy: this.vyNow, swim: this.swim, ride: !!this.ride, wet: this.wet };
  }

  /** Arrancar en el sitio de mi puesto en la sala (desplazamiento respecto a la celda de inicio, mirando al centro). */
  /** Colocarme en (x, z) mirando a `yaw` (admin: teletransporte); el suelo y los choques los arregla el siguiente fotograma. */
  teleport(x: number, z: number, yaw: number, y = 0) {
    (this.px = x), (this.pz = z), (this.py = y), (this.yaw = yaw), (this.vy = 0), (this.swim = false), (this.ride = undefined);
  }

  /** Para la cinta de acordonar: pared o columna (sólido) / agua o desnivel (no se pisa). */
  solidAt(x: number, z: number) {
    const i = this.idx(x, z);
    return i < 0 || this.map.kind[i] === PK.wall || this.map.kind[i] === PK.column;
  }
  wetAt(x: number, z: number) {
    const i = this.idx(x, z);
    return i >= 0 && (!!this.map.water[i] || this.map.ya[i] > 0.5 || !!this.map.tun[i]);
  }

  // ── Terrain (ver terrain.ts): lo que el nivel dice de sí mismo ──
  get root() {
    return this.scene;
  }
  floorAt(x: number, z: number, y = this.py): number | null {
    return this.fl(x, z, y)?.y ?? null;
  }
  solid(x: number, z: number) {
    return this.solidAt(x, z);
  }
  fits(x: number, z: number, y: number, _r?: number) {
    return this.fits_(x, z, y);
  }
  liquidAt(x: number, z: number, y = this.py) {
    const i = this.idx(x, z), f = i < 0 ? null : this.fl(x, z, y);
    if (!f) return null;
    const m = this.map, tun = !f.layer && m.tun[i] > 0, w = f.layer ? m.up.water[i] : m.water[i];
    if (!w && !tun) return null;
    const surface = f.layer ? PY.upSurf : PY.surf;
    return { surface, depth: Math.max(0, surface - f.y) };
  }
  voidAt(_x: number, _z: number) {
    return false; // (no hay vacío: las alturas negativas son agua)
  }
  /** `fits` con lo de ahora (nadando o no, desde mi celda). */
  private fits_(x: number, z: number, y: number) {
    return this.canMove(x, z, y, this.swim, this.idx(this.px, this.pz));
  }
  /** Para las gotas de la pistola: la pared las pierde; si no, la altura del suelo o del agua. */
  jetProbe = (x: number, y: number, z: number) => {
    const f = poolFloorY(this.map, x, z, y), i = this.idx(x, z);
    if (!f || i < 0) return null;
    const wet = (f.layer ? this.map.up.water[i] : this.map.water[i]) > 0;
    return { gy: wet ? (f.layer ? PY.upSurf : PY.surf) : f.y, wet };
  };
  /** ¿Hay un bebedero a menos de 2,2 m (y a mi altura)? */
  refillNear(x: number, y: number, z: number) {
    return this.refillAt.some((r) => Math.hypot(r.x - x, r.z - z) < 2.2 && Math.abs(r.y - y) < 1.5);
  }
  /** Altura del suelo en (x, z) (para las entidades). */
  floorY(x: number, z: number) {
    const i = this.idx(x, z);
    return i < 0 ? 0 : this.ground(i, x, z);
  }

  spawnAt(dx: number, dz: number) {
    this.px += dx;
    this.pz += dz;
  }

  private idx(x: number, z: number) {
    const cx = Math.floor(x / C), cz = Math.floor(z / C), m = this.map;
    return cx < 0 || cz < 0 || cx >= m.w || cz >= m.h ? -1 : cz * m.w + cx;
  }

  /** Altura del suelo en (x, z): rampa lineal en el tobogán y peldaños en la escalera. */
  private ground(i: number, x: number, z: number) {
    const m = this.map;
    if (m.ramp[i] === PR.none) return m.ya[i];
    const fx = x / C - (i % m.w), fz = z / C - ((i / m.w) | 0), d = m.dir[i];
    let t = d === 0 ? fx : d === 1 ? 1 - fx : d === 2 ? fz : 1 - fz;
    t = Math.min(0.999, Math.max(0, t));
    if (m.ramp[i] === PR.stairs) t = (Math.floor(t * 4) + 1) / 4;
    return m.ya[i] + (m.yb[i] - m.ya[i]) * t;
  }

  /** Suelo bajo (x, z) para unos pies a altura py: poolFloorY (capa + altura); en la escalera de la baja, con peldaños. null: pared. */
  private fl(x: number, z: number, py: number) {
    const f = poolFloorY(this.map, x, z, py), i = this.idx(x, z);
    if (f && !f.layer && this.map.ramp[i] === PR.stairs) f.y = this.ground(i, x, z);
    return f;
  }
  /** Suelo bajo el CENTRO con 5 cm de margen: el más alto de los 9 puntos (centro y alrededor), para no caer de un puente por pisar su borde. */
  private flc(x: number, z: number, py: number) {
    let b = this.fl(x, z, py);
    for (const ox of [-0.05, 0, 0.05]) for (const oz of [-0.05, 0, 0.05]) {
      if (!ox && !oz) continue;
      const f = this.fl(x + ox, z + oz, py);
      if (f && (!b || f.y > b.y)) b = f;
    }
    return b;
  }
  /** Agua de la capa en la que estoy en la celda i (0 seco, 1 poco hondo, 2 hondo). */
  private wat(i: number) {
    return this.lay ? this.map.up.water[i] : this.map.water[i];
  }

  /** ¿Cabe el jugador (radio R) con los pies en py en (x, z)? */
  private canMove(x: number, z: number, py: number, swim: boolean, from: number) {
    const m = this.map;
    // la cabina del ascensor: sus paredes no se cruzan (solo por la puerta, hacia donde da, y abierta)
    {
      const [x0, z0, x1, z1, dx, dy] = this.exitBox, inside = (a: number, b: number) => a > x0 - R && a < x1 + R && b > z0 - R && b < z1 + R;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, lat = (a: number, b: number) => Math.abs((a - cx) * dy - (b - cz) * dx), fwd = (a: number, b: number) => (a - cx) * dx + (b - cz) * dy;
      const was = inside(this.px, this.pz) && fwd(this.px, this.pz) < C / 2, now = inside(x, z) && fwd(x, z) < C / 2 + R;
      if (now && !was && (!this.cab.isOpen || lat(x, z) > 0.3 || fwd(this.px, this.pz) < C / 2)) return false; // entrar: por la puerta, de frente
      if (was && (lat(x, z) > C / 2 - R - 0.04 || fwd(x, z) < -C / 2 + R + 0.04 || (fwd(x, z) > C / 2 - R && (!this.cab.isOpen || lat(x, z) > 0.3)))) return false; // dentro: las tres paredes y las jambas
      if (now) return true; // (la cabina está en una celda de pared: lo de abajo la daría por maciza)
    }
    for (const [tx, ty, tz] of this.tubePts) { // los tubos (cilindros de radio COIL.r): no se atraviesan; quien ya está dentro de uno se puede apartar
      const d = Math.hypot(tx - x, tz - z);
      if (d < COIL.r + R && py < ty + COIL.r && py + 1.7 > ty - COIL.r && d < Math.hypot(tx - this.px, tz - this.pz)) return false;
    }
    for (const r of this.refillAt) {
      const d = Math.hypot(r.x - x, r.z - z);
      if (d < R + 0.3 && Math.abs(r.y - py) < 1.2 && d < Math.hypot(r.x - this.px, r.z - this.pz)) return false; // el pedestal del bebedero
    }
    for (const [ox, oz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
      const i = this.idx(x + ox, z + oz);
      if (i < 0) return false;
      if (m.tun[i] === 2 && swim && py <= PY.tunCeil - HEAD) continue; // túnel bajo una pared
      if (m.kind[i] === PK.column && Math.hypot(x + ox - ((i % m.w) + 0.5) * C, z + oz - (((i / m.w) | 0) + 0.5) * C) < 0.61 + 0.05) return false;
      const f = this.fl(x + ox, z + oz, py); // el suelo de la capa que toca a mi altura (poolFloorY: paso máximo POOL_STEP)
      if (!f) { if (m.kind[i] === PK.column) continue; return false; } // pared (o columna fuera de su radio)
      if (m.tun[i] === 1 && f.layer === 0) {
        // sobre el túnel: o se pisa la cubierta (arriba) o se nada por debajo del techo del túnel
        if (!(py >= PY.surf - 0.2 || (swim && py <= PY.tunCeil - HEAD))) return false;
        continue;
      }
      const g = f.y, w = f.layer ? m.up.water[i] : m.water[i];
      if (swim) {
        if (!w && g - py > 0.9) return false; // salir del agua a la cubierta: hasta 0,9 m
        if (w && py < g - (!f.layer && m.ramp[i] === PR.stairs ? 0.3 : 0.01)) return false; // en la escalera, un peldaño (0,22 m) no es una pared
      } else if (g - py > (f.layer !== this.lay ? 0.3 : POOL_STEP)) return false; // (a otra planta solo se pasa a ras de ella: en lo alto de la escalera; antes, en las escaleras el suelo alto a 1 m contaba y se atravesaban sus paredes) // no se sube un escalón de más de 1 m (los peldaños son de 0,19)
    }
    // un tobogán solo se pisa desde la torre o desde otro tramo de tobogán (cuenta la celda del centro, no las esquinas)
    const ci = this.idx(x, z);
    if (ci >= 0 && m.ramp[ci] === PR.slide && from >= 0 && from !== ci && m.ramp[from] !== PR.slide && !(m.ya[from] === PY.tower && m.ramp[from] === PR.none)) return false;
    return true;
  }

  splash(x: number, z: number, amp: number) {
    this.rip[this.ri].set(x, z, this.t, amp);
    this.ri = (this.ri + 1) % NRIP;
  }

  /** Lo ha matado el servidor: se queda donde está. */
  dead = false;
  /** Espectador: dónde están (pies) los ojos que se miran. Con ello la luz, el sol, el parpadeo y el agua se calculan donde se mira y no donde cayó el cuerpo. */
  ghost?: THREE.Vector3;
  /** Hasta dónde puede volar la cámara libre del espectador: x, z máximos y alturas mínima y máxima. */
  freeBox() {
    return { x: this.map.w * C, z: this.map.h * C, y0: PY.deep, y1: PY.tall - 0.3 };
  }
  /** El cuerpo en el mundo: mirar, tubos, nadar, tobogán, andar con choques por ejes, saltar y las plantas (ver locomotion.ts para lo común a todos los niveles). */
  private move(dt: number, c: Controls) {
    const m = this.map;
    dt = Math.min(dt, 0.05); // (un tirón largo no da un paso enorme: atravesaría paredes y suelos)
    this.yaw -= c.look.x;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - c.look.y));
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwd = new THREE.Vector3(-sy, 0, -cy), right = new THREE.Vector3(cy, 0, -sy);
    let rode = false;
    if (this.ride) {
      const rd = this.ride;
      rd.s += (4 + Math.min(rd.s, 12) * 0.35) * dt; // arranca despacio y se embala
      rode = true;
      if (rd.s >= rd.len) {
        const tg = rd.curve.getTangentAt(1), p = rd.curve.getPointAt(1); // sale por la boca, con el impulso
        (this.px = p.x), (this.pz = p.z), (this.py = p.y - COIL.r), (this.fx = tg.x * 5), (this.fz = tg.z * 5), (this.vy = 0), (this.ride = undefined), (rode = false);
        this.splash(p.x, p.z, 2.4);
      } else {
        const p = rd.curve.getPointAt(rd.s / rd.len), tg = rd.curve.getTangentAt(rd.s / rd.len), h = Math.atan2(-tg.x, -tg.z);
        if (rd.h !== undefined) this.yaw += Math.atan2(Math.sin(h - rd.h), Math.cos(h - rd.h)); // el cuerpo gira con el tubo (curvas y serpentín); se sigue pudiendo mirar
        rd.h = h;
        (this.px = p.x), (this.pz = p.z), (this.py = p.y - COIL.r), (this.swim = false), (this.vy = 0);
      }
    } else if (!this.swim && this.py > PY.tower - 0.4) {
      const t = this.tubes.find((u) => Math.hypot(this.px - u.x, this.pz - u.z) < 0.7);
      if (t) this.ride = { curve: t.curve, len: t.len, s: t.s0 };
    }
    if (!rode) {
    const i0 = this.idx(this.px, this.pz);
    // el pozo: `dw` si estoy metido en uno (bajo su boca); si no, el que tenga debajo nadando
    const dw = this.well && this.py < this.well.fy - 0.05 ? this.well : undefined;
    if (!dw) this.well = this.swim ? this.wells.find((w) => w.layer === this.lay && this.px >= w.x0 && this.px < w.x1 && this.pz >= w.z0 && this.pz < w.z1) : undefined;
    // nadar: se entra donde el agua cubre más de 1,4 m y se sale al bajar de 1 m (dentro de un pozo siempre se nada)
    if (i0 >= 0 && !dw) {
      const f = this.fl(this.px, this.pz, this.py), tn = !this.lay && m.tun[i0], g = tn && this.py < PY.surf - 0.6 ? PY.deep : f ? f.y : this.py, depth = (this.wat(i0) || tn) && this.py < this.surf + 0.05 ? this.surf - g : 0;
      const thr = this.lay ? 0.8 : 1.4; // (las piscinas elevadas son menos hondas: 1,2 m)
      if (!this.swim && depth > thr) (this.swim = true), !this.lay && this.splash(this.px, this.pz, 2.2);
      else if (this.swim && depth < thr - 0.4) this.swim = false;
    }
    let mx = 0, mz = 0, mvy = 0;
    const slide = i0 >= 0 && !this.lay && m.ramp[i0] === PR.slide && !this.swim && this.py <= this.ground(i0, this.px, this.pz) + 0.25;
    if (this.swim) {
      const sp = c.run ? 3.4 : 2.2, look = new THREE.Vector3(-sy * Math.cos(this.pitch), Math.sin(this.pitch), -cy * Math.cos(this.pitch));
      const v = look.multiplyScalar(c.move.y).addScaledVector(right, c.move.x);
      mx = v.x * sp * dt, mz = v.z * sp * dt, mvy = (v.y + (c.jump ? 0.8 : 0) - (c.crouch ? 0.8 : 0)) * sp * dt;
      if (c.move.lengthSq() < 0.01 && !c.jump && !c.crouch) mvy = (this.surf - 0.15 - this.py) * Math.min(1, dt * 0.9); // sin tocar nada, el cuerpo sube despacio a flote
    } else if (slide) {
      const d = m.dir[i0], sx = PDIRS[d][0], sz = PDIRS[d][1], ci = (i0 % m.w + 0.5) * C, cj = (((i0 / m.w) | 0) + 0.5) * C;
      mx = sx * 5.2 * dt + (sx === 0 ? (ci - this.px) * Math.min(1, dt * 6) : 0);
      mz = sz * 5.2 * dt + (sz === 0 ? (cj - this.pz) * Math.min(1, dt * 6) : 0);
      (this.fx = sx * 4.5), (this.fz = sz * 4.5);
    } else {
      const sp = (c.run ? RUN : WALK) * this.speedK * (ducking(c.crouch, c.run) ? CROUCH_SLOW : 1), pm = planar(this.yaw, c.move, sp, dt);
      mx = pm.x + this.fx * dt;
      mz = pm.y + this.fz * dt;
      const k = Math.max(0, 1 - dt * 2.2); // el impulso del tobogán se apaga
      (this.fx *= k), (this.fz *= k);
    }
    // por ejes, para deslizarse por las paredes
    const from = i0;
    const inside = !this.canMove(this.px, this.pz, this.py, this.swim, from); // metido en algo (p. ej. subiendo una escalera pegado a su lado: al subir los pies, la esquina entra en la losa de al lado)
    let stuck = inside && !this.air;
    if (inside && !dw) { // se saca el cuerpo por el sitio libre más cercano (antes, atrapado, se podía andar hacia dentro de la pared)
      const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
      out: for (const d of [0.04, 0.08, 0.16, 0.3, 0.5]) for (const [a, b] of D) if (this.canMove(this.px + a * d, this.pz + b * d, this.py, this.swim, from)) { (this.px += a * d), (this.pz += b * d), (stuck = false); break out; }
    }
    if (dw) (this.px = Math.max(dw.x0 + 0.35, Math.min(dw.x1 - 0.35, this.px + mx))), (this.pz = Math.max(dw.z0 + 0.35, Math.min(dw.z1 - 0.35, this.pz + mz))); // dentro del pozo, sus cuatro paredes
    else {
      if (stuck || this.canMove(this.px + mx, this.pz, this.py, this.swim, from)) this.px += mx;
      if (stuck || this.canMove(this.px, this.pz + mz, this.py, this.swim, from)) this.pz += mz;
    }
    const i1 = this.idx(this.px, this.pz);
    if (i1 >= 0) {
      const f1 = this.flc(this.px, this.pz, this.py), lay0 = this.lay;
      if (f1 && !dw) (this.lay = f1.layer), (this.surf = f1.layer ? PY.upSurf : PY.surf); // (en un pozo de la alta se baja por dentro de la losa: sigue siendo la alta)
      if (this.swim) {
        const tn = !this.lay && m.tun[i1] && this.py < PY.surf - 0.6, floor = this.well ? this.well.fy - WELL : tn ? PY.deep : f1 ? f1.y : this.py;
        const top = tn ? PY.tunCeil - HEAD : this.surf - 0.15;
        this.py = Math.min(top, Math.max(floor, this.py + mvy));
        this.vy = 0;
        // túnel sin fondo: al llegar al fondo del pozo se sale por el fondo del de su pareja, mirando al revés (lo que era bajar ahora es subir)
        const w = this.well;
        if (!w || this.py > w.fy - WELL + 2) this.wellLock = false; // ya subí (o salí): puede volver a saltar
        if (w && !this.wellLock && this.py < w.fy - WELL + 0.9) {
          const o = this.wells[w.to];
          (this.px = o.x0 + this.px - w.x0), (this.pz = o.z0 + this.pz - w.z0), (this.py = o.fy - WELL + 1.1), (this.pitch = -this.pitch);
          (this.lay = o.layer), (this.surf = o.layer ? PY.upSurf : PY.surf), (this.well = o), (this.wellLock = true);
          this.jam = 12000;
        }
      } else {
        let g = f1 ? f1.y : this.py;
        if (this.air && f1 && f1.layer !== lay0 && g > this.py + 0.5) g = this.py - 1; // (solo el suelo de OTRA planta: con el de la misma, saliendo de una piscina en el aire, el cuerpo caía para siempre por el suelo) en el aire no se aterriza en un suelo que está muy por encima de los pies (pegado a una pared junto a unas escaleras, se subía de golpe a la otra planta)
        this.vy -= G * dt;
        if (c.jump && this.py <= g + 0.05 && !slide && !(i0 >= 0 && m.ramp[i0] !== PR.none)) this.vy = JUMP * this.jumpK; // (no se salta en escaleras ni rampas: en el aire el suelo de la otra planta contaba y se atravesaban las paredes)
        this.py += this.vy * dt;
        if (this.py <= g) {
          // en el suelo: sube los peldaños con suavidad, baja de golpe si el desnivel es grande
          this.py = g - this.py > 0.3 ? g : this.py + (g - this.py) * Math.min(1, dt * 18);
          if (this.py > g - 0.002) this.py = Math.max(this.py, g - 0.001);
          this.vy = 0;
        }
        if (this.py < g) this.py = g;
        this.air = this.py > g + 0.05;
        this.vyNow = this.vy;
      }
      // ondas: entrar, nadar y vadear
      const inWater = !!this.wat(i1) && this.py < this.surf + 0.1;
      const speed = Math.hypot(mx, mz) / Math.max(dt, 1e-4);
      this.hs = speed;
      this.wet = inWater;
      this.stepT -= dt;
      if (inWater && speed > 0.4 && this.stepT <= 0) (this.stepT = this.swim ? 0.45 : speed > 4 ? 0.2 : 0.38), this.splash(this.px, this.pz, this.swim ? 1.2 : speed > 4 ? 1.7 : 1);
    }
    }
  }

  /** Antes de mover el cuerpo: el reloj, los mandos que no valen (muerto, desmayado, en el ascensor), lo recogible, la pistola y la cabina. Devuelve los mandos que se usan. */
  pre(dt: number, c: Controls): Controls {
    this.t += dt;
    if (this.dead && this.ghost) (this.px = this.ghost.x), (this.py = this.ghost.y), (this.pz = this.ghost.z), (this.vy = 0), (this.ride = undefined);
    if (this.dead) c = { ...c, move: new THREE.Vector2(), jump: false, crouch: false, run: false, fire: false, fireHeld: false, grab: false, grabHeld: false }; // muerto (lo decide el servidor): sin mandos
    c = this.extras(dt, c);
    if (this.faint > 0 || this.hold) c = { ...c, move: new THREE.Vector2(), jump: false, crouch: false, run: false }; // desmayado (o dentro del ascensor en marcha): no controlas el cuerpo
    this.cab.update(dt);
    return c;
  }
  /**
   * El Player mueve el cuerpo por este mundo (mirada ya aplicada por él): devuelve dónde queda y cómo (para sus pasos y sus manos).
   * `eye` es la altura de los ojos sobre los pies, sin lo que baja el agacharse (eso lo pone el Player, que también pone la cámara).
   */
  drive(dt: number, c: Controls, yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.move(dt, { ...c, look: ZERO });
    this.eye += ((this.ride ? 0.55 : this.swim ? EYE_SWIM : EYE) - this.eye) * Math.min(1, dt * 8);
    return { x: this.px, y: this.py, z: this.pz, yaw: this.yaw, pitch: this.pitch, speed: this.hs, air: this.air && !this.swim, vy: this.vyNow, swim: this.swim, eye: this.eye, jetOk: !(this.py + this.eye < this.surf && this.swim) && !this.ride };
  }
  /** Sin Player (desarrollo): el mundo lo mueve todo, cámara incluida. */
  update(dt: number, c: Controls) {
    c = this.pre(dt, c);
    this.move(dt, c);
    this.post(dt, c, true);
  }
  /** Después de mover: la luz, el agua, el aire, la niebla y los efectos de la cámara. `own`: la cámara es de este mundo (si no, la pone el Player; muerto, siempre es de este). */
  post(dt: number, c: Controls, own = false) {
    const m = this.map;
    this.deadK = Math.min(1, Math.max(0, this.deadK + (this.dead ? dt : -dt * 2) * 1.5)); // muerto: la cámara cae al suelo y se ladea
    this.jam = Math.max(0, this.jam - dt * 1000);
    if (own || this.dead) {
      const wantEye = (this.ride ? 0.55 : this.swim ? EYE_SWIM : ducking(c.crouch, c.run) ? EYE - CROUCH_DROP : EYE) * (1 - 0.8 * this.deadK);
      this.eye += (wantEye - this.eye) * Math.min(1, dt * 8);
      this.camera.position.set(this.px, this.py + this.eye, this.pz);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    if (this.deadK > 0) this.camera.rotation.z = this.deadK * 1.2;
    if (this.stunT > 0) (this.camera.rotation.x += Math.sin(this.t * 7) * 0.05), (this.camera.rotation.z = Math.sin(this.t * 4.3) * 0.08);
    if (this.hold) this.camera.position.y += this.cab.shake;
    this.torch.position.copy(this.camera.position);
    this.sun.target.position.set(this.px, 0, this.pz);
    this.sun.shadow.needsUpdate = (this.shadowFr++ & 1) === 0; // (en los fotogramas sin repintar, three sigue usando el mapa y la matriz del anterior: no baila)
    this.sun.position.set(this.px + 0.85 * 90, 0.8 * 90, this.pz - 0.2 * 90); // del este y algo del norte, a unos 45° de altura
    // luz de la sala donde estás: nivel fijo por sala, con parpadeo en algunas (y las luminarias de esas salas parpadean en conjunto)
    // fluorescente de verdad: zumbido casi estable y, de vez en cuando, una ráfaga de parpadeos irregulares (~24 Hz); apagan rápido y encienden con retraso
    const sig = (r: number, t: number) => {
      const per = 4 + ((r * 1.7) % 5), tt = t + r * 3.1, ph = tt % per;
      if (ph > 0.6) return 1 - 0.03 * Math.sin(t * 90 + r);
      const h = Math.sin(Math.floor(ph * 24) * 12.9898 + Math.floor(tt / per) * 4.1 + r * 78.233) * 43758.5453;
      return h - Math.floor(h) < 0.45 ? 0.06 : 1;
    };
    const pr = m.rooms.findIndex((r) => this.px / C >= r.x && this.px / C < r.x + r.w && this.pz / C >= r.y && this.pz / C < r.y + r.h);
    const room = pr >= 0 ? m.rooms[pr] : undefined;
    // la luz de la sala: fuera de una sala (pasillos, túneles) se queda la de la última, y el paso de una a otra es lento: antes saltaba a un valor fijo
    // al entrar en cada túnel y volvía a saltar al salir. El parpadeo va aparte, sin suavizar
    if (room) this.roomLight += (Math.min(1, room.light + (room.sun ? 0.25 : 0)) - this.roomLight) * Math.min(1, dt * 1.2);
    const L = this.roomLight * (room?.flicker ? 0.6 + 0.4 * sig(pr, this.t) : 1);
    // el sol solo entra por las ventanas de abajo y en las salas altas: en las salas cerradas de la planta alta se colaba una franja clara al pie de las
    // paredes (el sesgo del mapa de sombras), así que allí se apaga
    this.sun.intensity += ((this.lay === 1 && !room?.tall ? 0 : 3.4) - this.sun.intensity) * Math.min(1, dt * 3);
    this.hemi.intensity = 0.08 + 0.26 * L;
    this.torch.intensity = 0.2 + 0.8 * (1 - L);
    if (this.mats) for (const k of ['deck', 'wall', 'pool'] as const) this.mats[k].envMapIntensity = 0.9 * (0.25 + 0.75 * L);
    if (this.lamps && this.flickIdx.length) {
      for (const k of this.flickIdx) {
        const target = this.lampLvl[k] * sig(m.lamps[k].r, this.t + (k % 7) * 0.012), cur = this.lampCur[k];
        this.lampCur[k] = cur + (target - cur) * (1 - Math.exp(-dt * (target < cur ? 70 : 22)));
        this.lamps.setColorAt(k, this.lampBase.setScalar(Math.max(0.05, this.lampCur[k]) * LG));
      }
      if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
      // las 4 luminarias parpadeantes más cercanas (a menos de 14 m) hacen de luz real
      const near: [number, number][] = [];
      for (const k of this.flickIdx) { const p = this.lampPos[k], d = (p[0] - this.px) ** 2 + (p[2] - this.pz) ** 2; if (d < 196 && Math.abs(p[1] - this.camera.position.y) < 6 && !(this.py > PY.up - 0.5 && p[1] < PY.up - 0.5)) near.push([d, k]); } // (las de la planta de abajo no: su luz atravesaba el suelo)
      near.sort((a, b) => a[0] - b[0]);
      this.pls.forEach((pl, i) => {
        const k = near[i]?.[1];
        if (k === undefined) return void (pl.intensity = 0);
        pl.position.set(this.lampPos[k][0], this.lampPos[k][1], this.lampPos[k][2]);
        pl.intensity = 7 * this.lampCur[k];
      });
    }
    // las 3 luminarias más cercanas (a menos de 15 m) dan una luz de área alargada: el reflejo en el suelo mojado y el charco de luz bajo ellas
    this.raT -= dt;
    if (this.raT <= 0) {
      this.raT = 0.2;
      const near: [number, number][] = [];
      for (let k = 0; k < this.lampPos.length; k++) { const p = this.lampPos[k], d = (p[0] - this.px) ** 2 + (p[2] - this.pz) ** 2; if (d < 225 && Math.abs(p[1] - this.camera.position.y) < 6 && !(this.py > PY.up - 0.5 && p[1] < PY.up - 0.5)) near.push([d, k]); }
      near.sort((a, b) => a[0] - b[0]);
      this.raK = near.slice(0, 3).map((n) => n[1]);
      this.ras.forEach((l, i) => { const k = this.raK[i]; if (k !== undefined) l.position.set(this.lampPos[k][0], this.lampPos[k][1] + 0.26, this.lampPos[k][2]); });
    }
    // (se apagan con la distancia: al cambiar de luminaria, la que entra y la que sale están lejos y casi a oscuras, y no se nota el salto)
    this.ras.forEach((l, i) => { const k = this.raK[i], p = k === undefined ? undefined : this.lampPos[k], w = p ? Math.max(0, 1 - ((p[0] - this.px) ** 2 + (p[2] - this.pz) ** 2) / 225) : 0; l.intensity = k === undefined ? 0 : 11 * this.lampCur[k] * Math.min(1, w * 1.6); });
    // aire: baja con la cabeza bajo el agua nadando, sube fuera; sin aire, desmayo y vuelta al último sitio donde respiraste
    const head = this.camera.position.y < this.surf && this.swim;
    if (this.faint > 0) {
      this.faint -= dt;
      if (this.faint < FAINT - 1.2 && this.faint + dt >= FAINT - 1.2) (this.px = this.lastAir.x), (this.pz = this.lastAir.z), (this.py = this.lastAir.y), (this.swim = false), (this.vy = 0), this.splash(this.px, this.pz, 1.4);
      if (this.faint <= 0) this.o2 = 0.35;
    } else if (head) {
      this.o2 = Math.max(0, this.o2 - dt / (O2_SECONDS * (this.tank ? TANK_AIR * boostOf(perks, 'tank') : 1))); // (la rareza de la bombona da más aire)
      if (this.o2 <= 0) this.faint = FAINT;
    } else {
      this.o2 = Math.min(1, this.o2 + dt / O2_REFILL);
      const j = this.idx(this.px, this.pz);
      if (j >= 0 && (this.swim || this.py > this.surf - 0.2) && !this.ride) this.lastAir = { x: this.px, z: this.pz, y: this.py };
    }
    if (this.hud) {
      const low = this.o2 < 0.28, f = this.faint > 0 ? Math.min(1, Math.min(this.faint, FAINT - this.faint) * 1.6) : 0;
      this.hud.bar.style.opacity = this.o2 < 0.999 ? '1' : '0';
      this.hud.fill.style.width = this.o2 * 100 + '%';
      this.hud.sq.style.opacity = this.sqShow ? '1' : '0';
      this.hud.sqFill.style.width = this.sqVal * 100 + '%';
      this.hud.fill.style.background = low ? '#ff6a4d' : '#9fe8dc';
      this.hud.veil.style.background = f > 0.01 ? '#000' : 'radial-gradient(ellipse at center,rgba(0,0,0,0) 35%,rgba(2,14,12,.95) 100%)';
      this.hud.veil.style.opacity = String(f > 0.01 ? f : Math.max(0, (0.5 - this.o2) * 1.6) * (low ? 0.75 + 0.25 * Math.sin(this.t * 9) : 1));
    }
    // bajo el agua: niebla verdosa y densa
    const under = this.camera.position.y < this.surf;
    // culling por planta: en un túnel bajo tierra no se dibuja la planta alta; con la cámara arriba, el reflejo planar (la planta baja) no se repinta
    const upOn = this.py > PY.tunCeil + 0.3;
    if (upOn !== this.upOn) (this.upOn = upOn), this.upMeshes.forEach((o) => (o.visible = upOn));
    this.skipRefl = this.lay === 1 && this.camera.position.y > 3.5 && !this.holes;
    this.fog.density += ((under ? 0.07 : 0.009) - this.fog.density) * Math.min(1, dt * 6);
    this.fog.color.set(under ? 0x1c6a5e : 0xbcc4a4).multiplyScalar(under ? 1 : 0.25 + 0.75 * L);
    (this.scene.background as THREE.Color).copy(this.fog.color);
    this.water.uniforms.uTime.value = this.t;
    this.water.uniforms.uCam.value.copy(this.camera.position);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.pickups?.dispose();
    this.owned.forEach((o) => o.dispose());
    this.owned = [];
  }
}
