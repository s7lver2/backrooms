/*
 * El mapa de las Poolrooms (nivel 2), nuevo en cada partida. Misma idea que maze.ts (rejilla de 1,5 m, pura: la misma semilla da el
 * mismo mapa), pero con ALTURA: cada celda tiene su suelo (`ya`/`yb`: altura en el borde de entrada y en el de salida según `dir`,
 * iguales si es llano) y su techo. Eso da, sin capas apiladas:
 *  - piscinas de dos fondos (poco hondo, hondo) con cubierta alrededor;
 *  - salas altas con una torre (plataforma a 4,5 m), escalera hasta ella y un tobogán que acaba en la piscina;
 *  - túneles inundados bajo tierra que unen piscinas hondas (`tun`: 1 = bajo la cubierta, 2 = bajo una pared).
 * SEGUNDA PLANTA (docs §11): `up` es otra capa con los mismos arrays (suelo a PY.up, techo PY.tall), mapa de 64x64, con piezas y forma PROPIAS (no repite la baja);
 * más túneles sin fondo (`portals`).
 * Ver docs/poolrooms.md §7–8 y §11. `water`: 0 seco, 1 poco hondo (se vadea), 2 hondo (se nada).
 */

import type { Cell, Maze } from './maze';

export const POOL_CELL = 1.5;
/** Alturas del nivel (m): cubierta, fondo de la piscina, superficie del agua, torre, techos y techo de los túneles. */
export const PY = { deck: 0, shallow: -0.9, deep: -4.2, surf: -0.3, tower: 5.0, up: 5.0, upShallow: 4.4, upDeep: 3.5, upSurf: 4.7, ceil: 4.2, tall: 9.2, tunCeil: -2.4, spring: 2.6, abyss: -14 } as const;
/** Tipos de celda de `kind`. */
/** El serpentín de toboganes (models/pool/spiral.glb escalado a 0,45): radio de la hélice, bajada total y radio del tubo, en metros. */
export const COIL = { f: 0.45, rho: 2.4 * 0.45, rise: 12.39 * 0.45, r: 1.083 * 0.45, turns: 5 } as const;
/** Máximo que se sube de un paso (m): para el alcance y para elegir la capa en poolFloorY. */
export const POOL_STEP = 1.0;
export const PK = { wall: 0, floor: 1, column: 2 } as const;
/** Tipos de `ramp`. */
export const PR = { none: 0, stairs: 1, slide: 2 } as const;
/** Direcciones de `dir` (índice): +x, -x, +y, -y. */
export const PDIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export interface PoolRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'pool' | 'hall' | 'plain' | 'showers' | 'hub' | 'colonnade' | 'lounge';
  /** Sala alta (techo a PY.tall) con torre, escalera y tobogán. */
  tall: boolean;
  /** Nivel de luz de la sala (0,25–1): las bajas casi a oscuras. */
  light: number;
  /** Los fluorescentes parpadean. */
  flicker: boolean;
  /** Tiene ventanas al exterior (luz natural intensa que proyecta su sombra en el suelo). */
  sun: boolean;
  /** Sala inundada con un foso hondo de 6x6 (se nada; de él salen túneles). */
  pit?: boolean;
}
/** Una ventana: la celda de la sala junto a la pared y la dirección (índice de PDIRS) hacia la pared donde está. */
export interface PoolWindow {
  x: number;
  y: number;
  d: number;
  room: number;
}
/** Un tobogán de tubo cerrado: puntos de control (m) desde la torre de una sala alta hasta el agua de otra. El jugador lo recorre a la fuerza. */
export interface PoolTube {
  /** Recorrido recto (90°/45°) hasta la entrada del serpentín, que es el último punto. */
  pts: [number, number, number][];
  /** El serpentín de llegada: eje, sentido de entrada (cardinal) y altura del centro del tubo en su base. */
  coil: { x: number; z: number; dx: number; dz: number; yEnd: number; /** largo del tramo recto tras el serpentín: acaba abierto, con sitio libre delante */ tail?: number; /** vueltas del serpentín (2–5; sin dato, COIL.turns) */ turns?: number };
  /** Punto empotrado en la pared que hay tras la boca (la boca se alarga hasta ahí); sin él, la boca se abre en el borde de la galería. */
  back?: [number, number, number];
}
/** Una planta: los mismos arrays que la baja (w*h). En `PoolMap.up`: `kind` PK.wall = macizo, salvo que debajo haya suelo y `PoolMap.ceil[i] >= PY.tall` (entonces es un HUECO abierto a la baja). */
export interface PoolLayer {
  w: number;
  h: number;
  kind: Uint8Array;
  water: Uint8Array;
  ya: Float32Array;
  yb: Float32Array;
  ceil: Float32Array;
  ramp: Uint8Array;
  dir: Uint8Array;
}
/** Un túnel sin fondo: dos bocas de 2x2 celdas (x,y = celda de la esquina menor; layer 0 baja, 1 alta) unidas en los dos sentidos. */
export interface PoolPortal {
  a: { x: number; y: number; layer: 0 | 1 };
  b: { x: number; y: number; layer: 0 | 1 };
}
export interface PoolMap {
  w: number;
  h: number;
  /** w*h: PK.wall, PK.floor o PK.column (columna: sólida, se dibuja como pilar). */
  kind: Uint8Array;
  /** w*h: 0 seco, 1 poco hondo, 2 hondo. */
  water: Uint8Array;
  /** Altura del suelo en el borde de entrada y en el de salida (mirando hacia `dir`); iguales en las celdas llanas. */
  ya: Float32Array;
  yb: Float32Array;
  ceil: Float32Array;
  /** PR.*: escalera (sube hacia `dir`) o tobogán (baja hacia `dir`, te lleva). */
  ramp: Uint8Array;
  dir: Uint8Array;
  /** Túnel inundado bajo la celda: 0 no, 1 bajo la cubierta (arriba se pisa), 2 bajo una pared. Suelo PY.deep, techo PY.tunCeil. */
  tun: Uint8Array;
  start: Cell;
  exit: Cell;
  rooms: PoolRoom[];
  /** Celdas con luminaria en el techo y la sala de cada una (-1: pasillo). */
  lamps: (Cell & { r: number })[];
  windows: PoolWindow[];
  columns: Cell[];
  /** Bóveda de cañón (pasillos de 4 celdas): 0 no, 1 corre a lo largo de x, 2 a lo largo de y; `voff` es la fila (0-3) a lo ancho. */
  vax: Uint8Array;
  voff: Uint8Array;
  tubes: PoolTube[];
  /** Bebederos de recarga (celdas en seco, contra una pared, repartidas sala por sala). */
  refills: Cell[];
  /** SEGUNDA PLANTA: suelo llano a PY.up (ramp/dir de la alta no se usan: las escaleras son de la baja y llegan a PY.up). Agua elevada: water 1 a PY.upShallow, 2 a PY.upDeep (superficie PY.upSurf). */
  up: PoolLayer;
  /** [capa][w*h]: 1 = celda pisable (suelo, no hondo) alcanzable desde el inicio. */
  reach: [Uint8Array, Uint8Array];
  /** [capa][w*h]: 1 = agua honda cuya masa toca suelo pisable (se llega nadando). */
  swim: [Uint8Array, Uint8Array];
  /** Túneles sin fondo (3–5 pares). */
  portals: PoolPortal[];
  /** Bebederos y luminarias de la planta alta (celdas). */
  refillsUp: Cell[];
  lampsUp: Cell[];
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = Pick<PoolLayer, 'w' | 'h' | 'kind' | 'water' | 'ya' | 'yb' | 'ramp' | 'dir'>;

/** Altura del suelo en el borde de la celda hacia `d` (la mitad en los costados de una rampa). */
export function poolEdgeY(m: Grid, i: number, d: number) {
  if (m.ramp[i] === PR.none) return m.ya[i];
  const f = m.dir[i];
  return d === f ? m.yb[i] : d === (f ^ 1) ? m.ya[i] : (m.ya[i] + m.yb[i]) / 2;
}

/** Se puede pisar a pie (suelo, no hondo, ni columna). */
export const poolWalkable = (m: Grid, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.kind[y * m.w + x] === PK.floor && m.water[y * m.w + x] < 2;

/** Altura del suelo (m) en el centro de la celda (cx, cy) de una capa; en una rampa, la media. */
export const poolCellY = (m: PoolMap, cx: number, cy: number, layer: 0 | 1) => {
  const a = layer ? m.up : m, i = cy * m.w + cx;
  return a.ramp[i] ? (a.ya[i] + a.yb[i]) / 2 : a.ya[i];
};

/**
 * Dónde está el suelo bajo (x, z) en metros, dada la altura `y` (pies) del jugador: de las dos capas con suelo se elige la más alta que no supere
 * y + POOL_STEP (si ninguna, la más baja: se cae). Interpola las rampas. null: pared/columna/fuera. Cliente y servidor mueven igual con esto.
 */
export function poolFloorY(m: PoolMap, x: number, z: number, y: number): { y: number; layer: 0 | 1 } | null {
  const cx = Math.floor(x / POOL_CELL), cy = Math.floor(z / POOL_CELL);
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return null;
  const i = cy * m.w + cx, fx = x / POOL_CELL - cx, fz = z / POOL_CELL - cy;
  let best: { y: number; layer: 0 | 1 } | null = null, low: { y: number; layer: 0 | 1 } | null = null;
  for (const l of [0, 1] as const) {
    const a = l ? m.up : m;
    if (a.kind[i] !== PK.floor || (!l && m.ceil[i] < y)) continue; // (con los pies por encima del techo de la baja se está dentro de la losa de la alta)
    const d = a.dir[i], t = d === 0 ? fx : d === 1 ? 1 - fx : d === 2 ? fz : 1 - fz, fy = a.ramp[i] ? a.ya[i] + (a.yb[i] - a.ya[i]) * t : a.ya[i];
    if (!low || fy < low.y) low = { y: fy, layer: l };
    if (fy <= y + POOL_STEP && (!best || fy > best.y)) best = { y: fy, layer: l };
  }
  return best ?? low;
}

interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
  a?: Node;
  b?: Node;
  room?: PoolRoom;
}

/**
 * Lo bueno que ha salido un mapa (1 = vale): a veces un pasillo no cabe y media planta queda aislada (y se poda), el cruce central se come casi todas
 * las salas, no sale planta alta o no hay túneles sin fondo ni toboganes. Cada criterio puntúa 0–1 y cuenta el peor.
 */
function poolQuality(m: PoolMap) {
  const N = m.w * m.h;
  let lo = 0, hi = 0;
  for (let i = 0; i < N; i++) (lo += m.reach[0][i]), (hi += m.reach[1][i]);
  const live = m.rooms.filter((r) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (m.reach[0][y * m.w + x]) return true; return false; }).length;
  return Math.min(1, lo / 1800, hi / 400, live / 6, m.portals.length ? 1 : 0.5, m.tubes.length > 1 ? 1 : m.tubes.length ? 0.95 : 0.85, m.start.x === m.exit.x && m.start.y === m.exit.y ? 0 : 1);
}

/**
 * El mapa de una semilla: se generan candidatos (la semilla y derivadas de ella, siempre las mismas) hasta que uno vale; si ninguno de 16, el mejor.
 * Sigue siendo puro: la misma semilla da el mismo mapa en el servidor y en cada cliente. El último se guarda: poolMaze y el cliente piden el mismo.
 */
let lastPool: { seed: number; m: PoolMap } | undefined;
export function generatePools(seed: number): PoolMap {
  if (lastPool?.seed === seed) return lastPool.m;
  let best: PoolMap | undefined, bs = -1;
  for (let k = 0; k < 16 && bs < 1; k++) {
    const m = buildPools(k ? (seed ^ Math.imul(k, 0x9e3779b1)) >>> 0 : seed), q = poolQuality(m);
    if (q > bs) (best = m), (bs = q);
  }
  lastPool = { seed, m: best! };
  return best!;
}

function buildPools(seed: number): PoolMap {
  const rnd = mulberry32(seed ^ 0x9001),
    int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1)),
    W = 64,
    H = 64,
    kind = new Uint8Array(W * H),
    water = new Uint8Array(W * H),
    ya = new Float32Array(W * H),
    yb = new Float32Array(W * H),
    ceil = new Float32Array(W * H).fill(PY.ceil),
    ramp = new Uint8Array(W * H),
    dir = new Uint8Array(W * H),
    tun = new Uint8Array(W * H),
    vax = new Uint8Array(W * H),
    voff = new Uint8Array(W * H),
    up: PoolLayer = { w: W, h: H, kind: new Uint8Array(W * H), water: new Uint8Array(W * H), ya: new Float32Array(W * H), yb: new Float32Array(W * H), ceil: new Float32Array(W * H).fill(PY.tall), ramp: new Uint8Array(W * H), dir: new Uint8Array(W * H) },
    HR = 8,
    roomAt = new Int16Array(W * H).fill(-1),
    rooms: PoolRoom[] = [],
    at = (x: number, y: number) => y * W + x;

  // 1. árbol de cortes: cada hoja es una sala
  const split = (n: Node, depth: number) => {
    const canX = n.w >= 36, canY = n.h >= 36;
    if (!(canX || canY) && !(depth < 3 && rnd() < 0.5 && (n.w >= 30 || n.h >= 30))) return;
    const vertical = canX && canY ? n.w >= n.h : canX || (!canY && n.w >= 30);
    if (vertical) {
      const c = int(17, n.w - 17);
      (n.a = { x: n.x, y: n.y, w: c, h: n.h }), (n.b = { x: n.x + c, y: n.y, w: n.w - c, h: n.h });
    } else {
      const c = int(17, n.h - 17);
      (n.a = { x: n.x, y: n.y, w: n.w, h: c }), (n.b = { x: n.x, y: n.y + c, w: n.w, h: n.h - c });
    }
    split(n.a, depth + 1);
    split(n.b, depth + 1);
  };
  const root: Node = { x: 0, y: 0, w: W, h: H };
  split(root, 0);

  // 2. una sala por hoja, con margen
  const leaves = (n: Node): Node[] => (n.a && n.b ? [...leaves(n.a), ...leaves(n.b)] : [n]);
  // el cruce central: una cámara circular con un foso de agua muy profunda; las hojas que lo tocan pasan a ser esa sala
  const HUB = { x: (W >> 1) - HR, y: (H >> 1) - HR, w: HR * 2, h: HR * 2 };
  let hub: PoolRoom | undefined;
  for (const n of leaves(root)) {
    if (n.x < HUB.x + HUB.w && n.x + n.w > HUB.x && n.y < HUB.y + HUB.h && n.y + n.h > HUB.y) {
      if (!hub) {
        hub = { ...HUB, type: 'hub', tall: false, light: 0.7, flicker: false, sun: false };
        rooms.push(hub);
        const hi = rooms.length - 1;
        for (let j = HUB.y; j < HUB.y + HUB.h; j++) for (let i = HUB.x; i < HUB.x + HUB.w; i++) if (Math.hypot(i + 0.5 - (HUB.x + HR), j + 0.5 - (HUB.y + HR)) <= HR - 0.5) (kind[at(i, j)] = PK.floor), (roomAt[at(i, j)] = hi), (ceil[at(i, j)] = PY.tall);
      }
      n.room = hub;
      continue;
    }
    const w = Math.max(9, n.w - 2 - int(0, 2)), h = Math.max(9, n.h - 2 - int(0, 2));
    const x = n.x + 1 + int(0, Math.max(0, n.w - 2 - w)), y = n.y + 1 + int(0, Math.max(0, n.h - 2 - h));
    const rw = Math.min(w, W - x - 1), rh = Math.min(h, H - y - 1), t = rnd();
    const type: PoolRoom['type'] = rw >= 12 && rh >= 12 && t < 0.28 ? 'pool' : t < 0.43 ? 'hall' : t < 0.53 ? 'colonnade' : t < 0.64 ? 'showers' : rw >= 11 && rh >= 10 && t < 0.78 ? 'lounge' : 'plain';
    const tall = (type === 'pool' || type === 'hall') && rw >= 16 && rh >= 15 && rnd() < (type === 'pool' ? 0.75 : 0.6);
    const high = !tall && type !== 'showers' && rnd() < 0.35;
    n.room = { x, y, w: rw, h: rh, type, tall, light: type === 'showers' ? 0.35 + rnd() * 0.3 : 0.3 + rnd() * 0.7, flicker: rnd() < 0.22, sun: type !== 'showers' && rnd() < 0.4 };
    rooms.push(n.room);
    const ri = rooms.length - 1;
    // forma: las salas altas, las duchas y la mayoría de piscinas son rectas; el resto, redondas, octogonales, en L o en cruz
    const shape = tall || type === 'showers' || type === 'lounge' ? 0 : type === 'pool' ? (rnd() < 0.35 ? 1 : 0) : int(0, 5);
    const inShape = (i: number, j: number) => {
      const u = ((i - x + 0.5) / rw) * 2 - 1, v = ((j - y + 0.5) / rh) * 2 - 1;
      return shape === 1 ? u * u + v * v <= 1.02 : shape === 2 ? Math.abs(u) + Math.abs(v) <= 1.5 : shape === 3 ? !(u > 0.15 && v > 0.15) : shape === 4 ? Math.abs(u) < 0.42 || Math.abs(v) < 0.42 : shape === 5 ? Math.abs(u) >= 0.4 || Math.abs(v) >= 0.4 : true; // 5: anillo (borde completo: los pasillos, que buscan el borde del rectángulo, siempre encuentran suelo)
    };
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) if (inShape(i, j)) (kind[at(i, j)] = PK.floor), (roomAt[at(i, j)] = ri), (ceil[at(i, j)] = tall ? PY.tall : high ? 6.2 : PY.ceil);
  }

  // siempre hay una sala de duchas
  if (!rooms.some((r) => r.type === 'showers')) {
    const c = rooms.filter((r) => (r.type === 'plain' || r.type === 'hall') && !r.tall && r.w >= 10 && r.h >= 10).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (c) (c.type = 'showers'), (c.light = 0.45), (c.sun = false);
  }

  // al menos tres salas altas (los toboganes unen torres con serpentines de llegada)
  for (let n = rooms.filter((r) => r.tall).length; n < 3; n++) {
    const c = rooms.filter((r) => !r.tall && (r.type === 'pool' || r.type === 'hall') && r.w >= 14 && r.h >= 15).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!c) break;
    c.tall = true;
    const ri = rooms.indexOf(c);
    for (let j = c.y; j < c.y + c.h; j++) for (let i = c.x; i < c.x + c.w; i++) (kind[at(i, j)] = PK.floor), (roomAt[at(i, j)] = ri), (ceil[at(i, j)] = PY.tall); // las salas altas son rectas (la torre y la galería lo suponen)
  }

  // 3. pasillos abovedados de 4 celdas, inundados y rectos entre las dos mitades de cada corte; si no se solapan, en L con un cruce llano
  const anyRoom = (n: Node): PoolRoom => n.room ?? (rnd() < 0.5 ? anyRoom(n.a!) : anyRoom(n.b!));
  type Strip = [number, number, number, number, number];
  const inb = (i: number, j: number) => i >= 1 && j >= 1 && i < W - 1 && j < H - 1;
  const flat = (k: number) => ((kind[k] = PK.floor), (water[k] = 1), (ceil[k] = PY.ceil), (vax[k] = 0), (voff[k] = 0));
  /** ¿Todas las bóvedas son completas (4 filas), sin vecinas de otro eje o fila, y con pared a los lados? Si no, hay cuñas y huecos. */
  const vaultsClean = () => {
    for (let k = 0; k < W * H; k++) {
      const ax = vax[k];
      if (!ax) continue;
      const x = k % W, y = (k / W) | 0, vo = voff[k];
      for (let s = -vo; s <= 3 - vo; s++) {
        const i = ax === 1 ? x : x + s, j = ax === 1 ? y + s : y;
        if (!inb(i, j) || vax[at(i, j)] !== ax || voff[at(i, j)] !== vo + s) return false;
      }
      for (const sg of [-1, 1]) {
        const i = ax === 1 ? x + sg : x, j = ax === 1 ? y : y + sg;
        if (inb(i, j) && vax[at(i, j)] && (vax[at(i, j)] !== ax || voff[at(i, j)] !== vo)) return false;
      }
      if (vo === 0 || vo === 3) {
        const sg = vo === 0 ? -1 : 1, i = ax === 1 ? x : x + sg, j = ax === 1 ? y + sg : y;
        if (inb(i, j) && kind[at(i, j)] !== PK.wall) return false;
      }
    }
    return true;
  };
  /**
   * Coloca una lista de tiras de pasillo todo o nada (si queda algo a medias, se deshace y devuelve false). ax 1/2: bóveda de 4 filas a lo largo de x/y;
   * una columna con parte de sala o sin pared a los lados se hace llana; el cruce con otro pasillo (4x4) se hace llano; ax 0: cruce llano.
   */
  const place = (list: Strip[]) => {
    const sk = kind.slice(), sw = water.slice(), sc = ceil.slice(), sv = vax.slice(), so = voff.slice();
    const fail = () => (kind.set(sk), water.set(sw), ceil.set(sc), vax.set(sv), voff.set(so), false);
    for (const [x0, y0, x1, y1, ax] of list) {
      if (ax === 0) {
        for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (inb(i, j)) { if (vax[at(i, j)]) return fail(); if (kind[at(i, j)] === PK.wall) flat(at(i, j)); }
        continue;
      }
      const n = (ax === 1 ? x1 - x0 : y1 - y0) + 1, plan: string[] = [], cells: number[][] = [];
      for (let t = 0; t < n; t++) {
        const col: number[] = [];
        for (let s = 0; s < 4; s++) { const i = ax === 1 ? x0 + t : x0 + s, j = ax === 1 ? y0 + s : y0 + t; col.push(inb(i, j) ? at(i, j) : -1); }
        const fl = (c: number) => { const i = ax === 1 ? x0 + t : x0 + c, j = ax === 1 ? y0 + c : y0 + t; return !inb(i, j) || kind[at(i, j)] === PK.wall; };
        let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
        let n4 = 0;
        col.forEach((k, s) => { if (k < 0) n3++; else if (vax[k]) { if (vax[k] === ax && voff[k] === s) n4++; else if (vax[k] === ax) n3 += 9; else n2++; } else if (kind[k] === PK.wall) n0++; else n1++; });
        cells.push(col);
        if (n3 === 4 || n4 === 4) plan.push('skip');
        else if (n3 || n4 || (n2 && n2 < 4)) return fail();
        else if (n2 === 4) plan.push('cross');
        else if (n1 === 4) plan.push('pass');
        else plan.push(n0 === 4 && fl(-1) && fl(4) ? 'v' : 'flat');
      }
      for (let t = 0; t < n; t++) {
        if (plan[t] === 'cross') { // el cruce con otro pasillo: exactamente 4 columnas seguidas, alineadas con su ancho
          const run = t === 0 || plan[t - 1] !== 'cross';
          if (run) for (let q = 0; q < 4; q++) if (plan[t + q] !== 'cross' || !cells[t + q].every((k) => voff[k] === q) || (q === 3 && plan[t + 4] === 'cross')) return fail();
          for (const k of cells[t]) flat(k);
        } else if (plan[t] === 'v') cells[t].forEach((k, s) => ((kind[k] = PK.floor), (water[k] = 1), (ceil[k] = PY.spring), (vax[k] = ax), (voff[k] = s)));
        else if (plan[t] === 'flat') for (const k of cells[t]) if (kind[k] === PK.wall) flat(k);
      }
    }
    return vaultsClean() || fail();
  };
  const cl = (v: number) => Math.max(1, Math.min(W - 5, v));
  const link = (n: Node) => {
    if (!n.a || !n.b) return;
    link(n.a), link(n.b);
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = anyRoom(n.a), b = anyRoom(n.b);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y), ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (oy >= 6 && ox <= 0) {
        const y0 = ((Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) >> 1) - 2;
        const xl = a.x < b.x ? a.x + a.w - 1 : b.x + b.w - 1, xr = a.x < b.x ? b.x : a.x;
        const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h) - 4;
        for (const sh of [0, -1, 1, -2, 2, -3, 3, -4, 4]) if (y0 + sh >= lo && y0 + sh <= hi && place([[xl, y0 + sh, xr, y0 + sh + 3, 1]])) return;
      } else if (ox >= 6 && oy <= 0) {
        const x0 = ((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) >> 1) - 2;
        const yl = a.y < b.y ? a.y + a.h - 1 : b.y + b.h - 1, yr = a.y < b.y ? b.y : a.y;
        const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w) - 4;
        for (const sh of [0, -1, 1, -2, 2, -3, 3, -4, 4]) if (x0 + sh >= lo && x0 + sh <= hi && place([[x0 + sh, yl, x0 + sh + 3, yr, 2]])) return;
      }
      const acx = a.x + (a.w >> 1), bcy = b.y + (b.h >> 1);
      for (const s1 of [0, 1, -1, 2, -2, 3, -3, 4, -4]) for (const s2 of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        const ay = cl(a.y + (a.h >> 1) - 2 + s1), bx = cl(b.x + (b.w >> 1) - 2 + s2); // en L con un cruce llano; si choca con otro pasillo, se prueba desplazado
        if (place([acx < bx ? [acx, ay, bx - 1, ay + 3, 1] : [bx + 4, ay, acx, ay + 3, 1], [bx, ay, bx + 3, ay + 3, 0], bcy > ay + 3 ? [bx, ay + 4, bx + 3, bcy, 2] : [bx, bcy, bx + 3, ay - 1, 2]])) return;
      }
    }
  };
  link(root);
  // cuatro accesos al cruce central, uno por lado, hasta dar con otra sala
  if (hub) {
    const hx = HUB.x + HR, hy = HUB.y + HR;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let kEnd = HR - 3;
      for (let k = HR - 2; k < 60; k++) {
        const x = hx + dx * k, y = hy + dy * k;
        if (x < 2 || y < 2 || x > W - 3 || y > H - 3) break;
        if (k > HR + 1 && kind[at(x, y)] === PK.floor && !vax[at(x, y)] && roomAt[at(x, y)] >= 0 && roomAt[at(x, y)] !== rooms.indexOf(hub)) break;
        kEnd = k;
      }
      const ea = hx + dx * (HR - 2), eb = hx + dx * kEnd, fa = hy + dy * (HR - 2), fb = hy + dy * kEnd;
      if (kEnd >= HR - 2) for (const sh of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) if (place(dx ? [[Math.min(ea, eb), hy - 2 + sh, Math.max(ea, eb), hy + 1 + sh, 1]] : [[hx - 2 + sh, Math.min(fa, fb), hx + 1 + sh, Math.max(fa, fb), 2]])) break;
    }
  }

  // 4. piscinas: salas altas con cubierta de 4 celdas (cabe la torre), el resto de 2; poco hondo en el borde, hondo en el centro
  const columns: Cell[] = [];
  const daisBox = new Map<PoolRoom, number[]>();
  for (const r of rooms) {
    if (r.type === 'pool') {
      const ring = r.tall ? 4 : 2;
      const round = rnd() < 0.6, ccx = r.x + r.w / 2, ccy = r.y + r.h / 2, ax = r.w / 2 - ring, ay = r.h / 2 - ring; // piscina curva (elipse) o rectangular
      for (let j = r.y + ring; j < r.y + r.h - ring; j++) for (let i = r.x + ring; i < r.x + r.w - ring; i++) {
        const e = ((i + 0.5 - ccx) / ax) ** 2 + ((j + 0.5 - ccy) / ay) ** 2;
        if ((round && e > 1) || kind[at(i, j)] !== PK.floor) continue;
        const core = round ? ((i + 0.5 - ccx) / Math.max(1, ax - 2)) ** 2 + ((j + 0.5 - ccy) / Math.max(1, ay - 2)) ** 2 <= 1 : i >= r.x + ring + 2 && i < r.x + r.w - ring - 2 && j >= r.y + ring + 2 && j < r.y + r.h - ring - 2;
        water[at(i, j)] = core ? 2 : 1;
      }
    } else if (r.type === 'hub') {
      const hx = r.x + HR, hy = r.y + HR;
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (roomAt[at(i, j)] === rooms.indexOf(r) && Math.hypot(i + 0.5 - hx, j + 0.5 - hy) < 4) water[at(i, j)] = 2;
      for (let k = 0; k < 12; k++) { // un anillo de columnas gordas en la cubierta
        const a = (k / 12) * Math.PI * 2, i = Math.floor(hx + Math.cos(a) * 6), j = Math.floor(hy + Math.sin(a) * 6);
        if (kind[at(i, j)] === PK.floor) (kind[at(i, j)] = PK.column), columns.push({ x: i, y: j });
      }
    } else if (r.type === 'hall' || r.type === 'colonnade') {
      const ri = rooms.indexOf(r);
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (roomAt[at(i, j)] === ri) water[at(i, j)] = 1; // sala inundada de pared a pared
      const px = r.x + (r.w >> 1) - 3, py = r.y + (r.h >> 1) - 3;
      let whole = r.type === 'hall' && r.w >= 14 && r.h >= 14 && rnd() < 0.6;
      for (let j = py; j < py + 6 && whole; j++) for (let i = px; i < px + 6; i++) if (roomAt[at(i, j)] !== ri) whole = false;
      if (whole) {
        r.pit = true;
        for (let j = py; j < py + 6; j++) for (let i = px; i < px + 6; i++) water[at(i, j)] = 2;
      }
    }
    let dbox: number[] | null = null; // plataforma baja en el centro de una sala lisa
    if (r.type === 'plain' && !r.tall && r.w >= 10 && r.h >= 10) {
      const v = rnd(), ri = rooms.indexOf(r), bx0 = r.x + 3, by0 = r.y + 3, bx1 = r.x + r.w - 3, by1 = r.y + r.h - 3;
      let ok = v < 0.66;
      for (let j = by0 - 1; j <= by1 && ok; j++) for (let i = bx0 - 1; i <= bx1; i++) if (roomAt[at(i, j)] !== ri || kind[at(i, j)] !== PK.floor) { ok = false; break; }
      if (ok && v < 0.33) { for (let j = by0; j < by1; j++) for (let i = bx0; i < bx1; i++) water[at(i, j)] = bx1 - bx0 >= 6 && by1 - by0 >= 6 && i > bx0 && i < bx1 - 1 && j > by0 && j < by1 - 1 ? 2 : 1; } // estanque: poco hondo, y hondo en el centro si cabe (fondo de túneles sin fondo)
      else if (ok) dbox = [bx0, by0, bx1, by1];
    }
    if (r.type !== 'pool' && r.type !== 'hub' && r.type !== 'showers') {
      // retícula de columnas gordas cada 4 celdas, sin tapar la boca de un pasillo
      const free = (i: number, j: number) => {
        for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) {
          const k = at(Math.min(W - 1, Math.max(0, i + a)), Math.min(H - 1, Math.max(0, j + b)));
          if (kind[k] === PK.floor && roomAt[k] < 0) return false;
        }
        return true;
      };
      if (dbox) daisBox.set(r, dbox);
      const sp = r.type === 'colonnade' ? 3 : 4; // la columnata: retícula más tupida
      for (let j = r.y + 2; j < r.y + r.h - 2; j += sp) for (let i = r.x + 2; i < r.x + r.w - 2; i += sp) if (kind[at(i, j)] === PK.floor && free(i, j) && water[at(i, j)] < 2 && !(dbox && i >= dbox[0] && i < dbox[2] && j >= dbox[1] && j < dbox[3])) (kind[at(i, j)] = PK.column), columns.push({ x: i, y: j });
    }
  }
  for (let i = 0; i < W * H; i++) ya[i] = yb[i] = water[i] === 2 ? PY.deep : water[i] === 1 ? PY.shallow : PY.deck;
  for (const r of rooms) {
    if (r.type === 'hub') for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (water[at(i, j)] === 2) ya[at(i, j)] = yb[at(i, j)] = PY.abyss;
    const db = daisBox.get(r);
    if (db) for (let j = db[1]; j < db[3]; j++) for (let i = db[0]; i < db[2]; i++) ya[at(i, j)] = yb[at(i, j)] = 0.45; // la tarima: un peldaño de 0,45 m
    if (r.type === 'lounge') {
      // lounge: un canal poco hondo de 3 celdas por el centro y dos tarimas de 0,45 m a cada lado
      const ri = rooms.indexOf(r), mid = r.x + (r.w >> 1);
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
        const k = at(i, j);
        if (roomAt[k] !== ri || kind[k] !== PK.floor || water[k] || ramp[k]) continue;
        if (Math.abs(i - mid) <= 1) (water[k] = 1), (ya[k] = yb[k] = PY.shallow);
        else if (Math.abs(i - mid) >= 3 && Math.abs(i - mid) <= 4 && j >= r.y + 2 && j < r.y + r.h - 2) ya[k] = yb[k] = 0.45; // (lejos de las bocas de pasillo, que están inundadas: de -0,9 a 0,45 no se sube)
      }
    }
    if (r.type === 'showers') {
      // duchas: bancos de azulejo (0,45 m) en hileras en el centro de la sala
      for (let j = r.y + 3; j < r.y + r.h - 3; j += 3) for (let i = r.x + 3; i < r.x + r.w - 3; i++) if (kind[at(i, j)] === PK.floor && !water[at(i, j)]) ya[at(i, j)] = yb[at(i, j)] = 0.45;
    }
    if (r.type === 'pool' && !r.tall) {
      // escalones al agua: un tramo ancho de peldaños en un lado de la piscina (si el borde es recto)
      const ring = 2, side = int(0, 3), horizontal = side >= 2, len = 5;
      const cells: number[] = [];
      for (let k = 0; k < len; k++) {
        const mid = horizontal ? r.x + (r.w >> 1) - 2 + k : r.y + (r.h >> 1) - 2 + k;
        const x = horizontal ? mid : side === 0 ? r.x + ring : r.x + r.w - ring - 1, y = horizontal ? (side === 2 ? r.y + ring : r.y + r.h - ring - 1) : mid;
        cells.push(at(x, y));
      }
      if (cells.every((i) => kind[i] === PK.floor && water[i] === 1 && !ramp[i])) {
        const out = side === 0 ? 1 : side === 1 ? 0 : side === 2 ? 3 : 2; // hacia la cubierta
        for (const i of cells) (ya[i] = PY.shallow), (yb[i] = PY.deck), (ramp[i] = PR.stairs), (dir[i] = out);
      }
    }
  }

  const towers: { room: PoolRoom; x: number; z: number; d: number; cx: number; cy: number; su: number; sv: number; gl: number }[] = [];
  // 5. torre + escalera + tobogán en una esquina de cada sala alta. Marco local (u a lo largo de la pared, v hacia dentro).
  for (const r of rooms) {
    if (!r.tall) continue;
    const su = rnd() < 0.5 ? 1 : -1, sv = rnd() < 0.5 ? 1 : -1;
    const cx = su > 0 ? r.x : r.x + r.w - 1, cy = sv > 0 ? r.y : r.y + r.h - 1;
    const cell = (u: number, v: number) => at(cx + su * u, cy + sv * v);
    const dU = (s: number) => ((su * s > 0 ? 0 : 1) as number), dV = (s: number) => ((sv * s > 0 ? 2 : 3) as number); // índice de PDIRS de +/-u, +/-v
    if (r.type === 'hall') for (let v = 0; v <= 3; v++) for (let u = 0; u <= 11; u++) { const i = cell(u, v); (kind[i] = PK.floor), (water[i] = 0), (ya[i] = yb[i] = PY.deck), (ceil[i] = PY.tall); } // la base seca de la torre
    const set = (u: number, v: number, a: number, b: number, rp: number, d: number) => {
      const i = cell(u, v);
      (ya[i] = a), (yb[i] = b), (ramp[i] = rp), (dir[i] = d), (ceil[i] = PY.tall);
    };
    const upSet = (u: number, v: number) => { const i = cell(u, v); (up.kind[i] = PK.floor), (up.water[i] = 0), (up.ya[i] = up.yb[i] = PY.up), (up.ramp[i] = 0); };
    for (let v = 0; v <= 3; v++) for (let u = 0; u <= 3; u++) upSet(u, v); // la torre: ahora en la planta alta
    // la galería: un balcón de 3 celdas de ancho a lo largo de la pared, en la planta alta, sobre la sala de abajo
    const gl = Math.min(14, r.h - 8);
    for (let v = 4; v < 4 + gl; v++) for (let u = 0; u <= 2; u++) upSet(u, v);
    for (let k = 0; k < 8; k++) {
      const top = PY.tower - k * (PY.tower / 8); // la escalera sube hacia -u (hacia la torre)
      set(4 + k, 1, top - PY.tower / 8, top, PR.stairs, dU(-1));
    }
    towers.push({ room: r, x: (cx + su * 2.5 + 0.5) * POOL_CELL, z: (cy + sv * (3 + gl) + 0.5) * POOL_CELL, d: su, cx, cy, su, sv, gl }); // la boca del tubo: el borde de la torre hacia dentro de la sala
  }

  // 6. túneles inundados entre piscinas hondas de cortes vecinos: recto, de núcleo a núcleo, sin cruzar una tercera sala
  const core = (r: PoolRoom) => {
    if (r.type !== 'pool') { const x0 = r.x + (r.w >> 1) - 3, y0 = r.y + (r.h >> 1) - 3; return { x0, x1: x0 + 5, y0, y1: y0 + 5 }; }
    const ring = r.tall ? 4 : 2;
    return { x0: r.x + ring + 2, x1: r.x + r.w - ring - 3, y0: r.y + ring + 2, y1: r.y + r.h - ring - 3 };
  };
  const tunnel = (n: Node) => {
    if (!n.a || !n.b) return;
    tunnel(n.a), tunnel(n.b);
    const A = leaves(n.a).map((l) => l.room!).filter((r) => r.type === 'pool' || r.pit), B = leaves(n.b).map((l) => l.room!).filter((r) => r.type === 'pool' || r.pit);
    for (const a of A) for (const b of B) {
      const ca = core(a), cb = core(b);
      if (ca.x1 < ca.x0 || ca.y1 < ca.y0 || cb.x1 < cb.x0 || cb.y1 < cb.y0) continue;
      const ia = rooms.indexOf(a), ib = rooms.indexOf(b);
      // alineados en x (túnel vertical) o en y (horizontal): se elige una fila/columna común a los dos núcleos
      for (const horiz of [true, false]) {
        const lo = horiz ? Math.max(ca.y0, cb.y0) : Math.max(ca.x0, cb.x0), hi = horiz ? Math.min(ca.y1, cb.y1) : Math.min(ca.x1, cb.x1);
        if (lo > hi) continue;
        const c = (lo + hi) >> 1, from = horiz ? (ca.x1 < cb.x0 ? ca.x1 : cb.x1) : ca.y1 < cb.y0 ? ca.y1 : cb.y1, to = horiz ? (ca.x1 < cb.x0 ? cb.x0 : ca.x0) : ca.y1 < cb.y0 ? cb.y0 : ca.y0;
        if (horiz ? ca.x1 >= cb.x0 && cb.x1 >= ca.x0 : ca.y1 >= cb.y0 && cb.y1 >= ca.y0) continue;
        const cells: number[] = [];
        let bad = false;
        for (let p = Math.min(from, to) + 1; p < Math.max(from, to); p++) {
          const i = horiz ? at(p, c) : at(c, p), ri = roomAt[i];
          if (ri >= 0 && ri !== ia && ri !== ib) bad = true;
          if (kind[i] === PK.column || vax[i] || ya[i] > 0.5 || (ri < 0 && water[i] === 1)) bad = true;
          cells.push(i);
        }
        const e1 = horiz ? at(from, c) : at(c, from), e2 = horiz ? at(to, c) : at(c, to);
        if (bad || cells.length > 22 || water[e1] !== 2 || water[e2] !== 2) continue; // el túnel debe empezar y acabar en agua honda
        for (const i of cells) {
          if (water[i] === 1 && rooms[roomAt[i]]?.type === 'pool') (water[i] = 2), (ya[i] = yb[i] = PY.deep); // el borde poco hondo de una piscina se hace zanja
          else if (water[i] <= 1) tun[i] = kind[i] === PK.floor && ramp[i] === PR.none ? 1 : kind[i] === PK.wall ? 2 : 0;
        }
        break;
      }
    }
  };
  tunnel(root);

  // 6b. pozos para los túneles sin fondo: 6x6 (núcleo hondo de 4x4, borde poco hondo) en salas secas y llanas, hasta 9 por mapa (3 por sala)
  {
    const rw = mulberry32(seed ^ 0x77e1), list = rooms.map((r, ri) => ({ r, ri })).filter(({ r }) => r.type !== 'hub' && !r.tall && r.w >= 10 && r.h >= 10);
    for (let a = list.length - 1; a > 0; a--) { const b = Math.floor(rw() * (a + 1)); [list[a], list[b]] = [list[b], list[a]]; }
    let n = 0;
    for (const { r, ri } of [...list, ...list, ...list]) {
      if (n >= 9) break;
      const wins: number[][] = [];
      for (let py = r.y + 2; py <= r.y + r.h - 8; py++) for (let px = r.x + 2; px <= r.x + r.w - 8; px++) {
        let ok = true;
        for (let j = py - 1; j <= py + 6 && ok; j++) for (let i = px - 1; i <= px + 6; i++) { const k = at(i, j); if (roomAt[k] !== ri || (kind[k] !== PK.floor && kind[k] !== PK.column) || water[k] || ya[k] > 0.5 || yb[k] > 0.5 || ramp[k] || tun[k] || vax[k]) { ok = false; break; } }
        if (ok) wins.push([px, py]);
      }
      if (!wins.length) continue;
      const [px, py] = wins[Math.floor(rw() * wins.length)];
      for (let j = py; j < py + 6; j++) for (let i = px; i < px + 6; i++) { const k = at(i, j), c = i > px && i < px + 5 && j > py && j < py + 5; (kind[k] = PK.floor), (water[k] = c ? 2 : 1), (ya[k] = yb[k] = c ? PY.deep : PY.shallow); }
      n++;
    }
  }

  // 7. el mapa (con el inicio) y la SEGUNDA PLANTA (docs §11): suelo a PY.up sobre casi todo (salas, pasillos, anillos de piscina), con huecos
  // (atrios) y escaleras reales que enlazan las dos plantas. Lo inalcanzable (a pie, subiendo hasta 1 m y bajando lo que sea) se vuelve pared.
  const first = rooms.find((r) => r.type !== 'hub') ?? rooms[0];
  let start: Cell = { x: first.x + 1, y: first.y + 1 };
  for (let j = first.y; j < first.y + first.h; j++) for (let i = first.x; i < first.x + first.w; i++) if (kind[at(i, j)] === PK.floor && water[at(i, j)] < 2 && !ramp[at(i, j)] && (kind[at(start.x, start.y)] !== PK.floor || water[at(start.x, start.y)] > 1)) start = { x: i, y: j };
  const m: PoolMap = { w: W, h: H, kind, water, ya, yb, ceil, ramp, dir, tun, vax, voff, up, reach: [new Uint8Array(W * H), new Uint8Array(W * H)], swim: [new Uint8Array(W * H), new Uint8Array(W * H)], portals: [], tubes: [], refills: [], refillsUp: [], start, exit: start, rooms, lamps: [], lampsUp: [], windows: [], columns };
  const N = W * H, STEP = PY.up / 8, lay = (l: number): PoolLayer => (l ? up : m), orig = ceil.slice();
  const hubI = hub ? rooms.indexOf(hub) : -1, ru = mulberry32(seed ^ 0x2f10), ri2 = (a: number, b: number) => a + Math.floor(ru() * (b - a + 1));
  const upFloor = (i: number) => ((up.kind[i] = PK.floor), (up.water[i] = 0), (up.ya[i] = up.yb[i] = PY.up), (up.ramp[i] = 0));
  const upPools: { rim: number[]; core: number[] }[] = [];
  // La planta alta es INDEPENDIENTE de la baja: piezas propias (salas, anillos, lounges, pasarelas) con su forma, repartidas por el mapa y ancladas a las
  // escaleras; pueden quedar sobre salas, sobre macizo o medio fuera. Vetado: las salas altas (traen su torre), el centro del cruce y, con margen, las salas de techo
  // alto (su aire llegaría al suelo de arriba). `lock`: celdas de escalera, rellano o pasarela que los atrios no tocan.
  const noUp = new Uint8Array(N), lock = new Uint8Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = at(i, j), r = rooms[roomAt[k]];
    if (r?.tall || (hubI >= 0 && roomAt[k] === hubI && Math.hypot(i + 0.5 - (HUB.x + HR), j + 0.5 - (HUB.y + HR)) < 5.5)) noUp[k] = 1;
    else if (kind[k] === PK.floor && ceil[k] > 5 && ceil[k] < 8) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (inb(i + a, j + b)) noUp[at(i + a, j + b)] = 1;
  }
  /** Suelo en la alta (también sobre las piscinas de abajo: el forjado es cerrado, sin atrios; el único hueco es el de cada escalera). */
  const put = (k: number) => {
    if (noUp[k] || lock[k] || up.kind[k] === PK.floor || ramp[k]) return;
    upFloor(k);
  };
  /**
   * La planta alta es un conjunto de SALAS cerradas (como la baja, sin laberinto): rectángulos de 6–11 celdas, alguno en L y algún lounge con piscina elevada,
   * unidos por pasillos de 2 o 3 celdas abiertos en el macizo, o pegados y fundidos en una sala mayor. Formas: 0 rect, 3 L, 6 lounge (con piscina elevada).
   */
  type Meta = { cx: number; cy: number; w: number; h: number; sh: number };
  const metas: Meta[] = [];
  const piece = (cx: number, cy: number, w: number, h: number, sh: number) => {
    const x0 = cx - (w >> 1), y0 = cy - (h >> 1), cells: number[] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!inb(x0 + i, y0 + j)) continue;
      const u = ((i + 0.5) / w) * 2 - 1, v = ((j + 0.5) / h) * 2 - 1, c = Math.abs(u) < 0.45 && Math.abs(v) < 0.45;
      const inside = sh === 1 ? u * u + v * v <= 1.02 : sh === 2 ? !c : sh === 3 ? !(u > 0.1 && v > 0.1) : sh === 4 ? Math.abs(u) < 0.4 || Math.abs(v) < 0.4 : true;
      if (inside) cells.push(at(x0 + i, y0 + j));
    }
    cells.forEach((k) => put(k));
    metas.push({ cx, cy, w, h, sh });
  };
  const size = (sh: number): [number, number] => (sh === 6 ? [ri2(11, 13), ri2(11, 13)] : [ri2(6, 11), ri2(6, 11)]);
  const shape = () => { const v = ru(); return v < 0.2 ? 6 : v < 0.4 ? 3 : 0; };
  const hAt = (i: number) => (ramp[i] === PR.stairs ? (ya[i] + yb[i]) / 2 : ya[i]);
  const groundReach = () => { // celdas de suelo alcanzables a pie desde el inicio en la planta baja (sin nadar por agua honda)
    const seen = new Uint8Array(N), stack = [at(start.x, start.y)];
    let n = 0;
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i / W) | 0;
      n++;
      for (const [dx, dy] of PDIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || kind[j] !== PK.floor || water[j] >= 2 || Math.abs(hAt(j) - hAt(i)) > 1) continue;
        (seen[j] = 1), stack.push(j);
      }
    }
    return n;
  };
  let reachNow = groundReach();
  // escaleras entre plantas: 8 peldaños rectos en planta baja (seca y llana) cuyo extremo sube al suelo de la alta; abren el forjado. Cada una ancla una pieza de arriba
  const strips: { i: number; d: number }[] = [];
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) for (let d = 0; d < 4; d++) {
    const dx = PDIRS[d][0], dy = PDIRS[d][1], ex = x0 + dx * 8, ey = y0 + dy * 8, bx = x0 - dx, by = y0 - dy;
    if (!inb(ex, ey) || bx < 0 || by < 0 || bx >= W || by >= H) continue;
    const e = at(ex, ey);
    if (noUp[e] || ramp[e] || (kind[e] === PK.floor && water[e] === 2) || kind[at(bx, by)] !== PK.floor || water[at(bx, by)] > 1) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) {
      const i = at(x0 + dx * k, y0 + dy * k), r = rooms[roomAt[i]];
      if (!r || r.tall || r.type === 'hub' || kind[i] !== PK.floor || water[i] || ya[i] !== PY.deck || yb[i] !== PY.deck || ramp[i] || tun[i] || vax[i]) ok = false;
      // a cada lado, pared o cubierta seca y llana: una escalera pegada al agua, a los peldaños de una piscina o a un pilar los atravesaba
      for (const sg of [-1, 1]) {
        const sx = x0 + dx * k + dy * sg, sy = y0 + dy * k + dx * sg, j = inb(sx, sy) ? at(sx, sy) : -1;
        if (j < 0 || (kind[j] === PK.wall ? tun[j] : kind[j] !== PK.floor || water[j] || ramp[j] || ya[j] !== PY.deck || vax[j])) ok = false;
      }
    }
    if (ok) strips.push({ i: at(x0, y0), d });
  }
  for (let a = strips.length - 1; a > 0; a--) { const b = Math.floor(ru() * (a + 1)); [strips[a], strips[b]] = [strips[b], strips[a]]; }
  const usedS = new Set<number>(), landings: { x: number; y: number; d: number }[] = [];
  for (const s of strips) {
    if (landings.length >= 8) break;
    const dx = PDIRS[s.d][0], dy = PDIRS[s.d][1], x0 = s.i % W, y0 = (s.i / W) | 0, lx = x0 + dx * 8, ly = y0 + dy * 8;
    const idx = Array.from({ length: 8 }, (_, k) => at(x0 + dx * k, y0 + dy * k));
    if (idx.some((k) => usedS.has(k)) || landings.some((o) => Math.abs(o.x - lx) + Math.abs(o.y - ly) < 14)) continue;
    const snap = idx.map((k) => [k, ya[k], yb[k], ramp[k], dir[k], ceil[k], up.kind[k]]);
    idx.forEach((k, n) => ((ya[k] = n * STEP), (yb[k] = (n + 1) * STEP), (ramp[k] = PR.stairs), (dir[k] = s.d), (ceil[k] = n < 3 ? ceil[k] : PY.tall), (up.kind[k] = PK.wall))); // (los tres primeros peldaños caben bajo el techo: el hueco del forjado empieza después)
    const rn = groundReach();
    if (rn < reachNow) { snap.forEach(([k, a, b, r, d, c, u]) => ((ya[k] = a), (yb[k] = b), (ramp[k] = r), (dir[k] = d), (ceil[k] = c), (up.kind[k] = u))); continue; }
    reachNow = rn;
    landings.push({ x: lx, y: ly, d: s.d });
    idx.forEach((k) => { usedS.add(k); lock[k] = 1; for (const [ddx, ddy] of PDIRS) usedS.add(k + ddy * W + ddx); });
  }
  // una pieza por rellano: el rellano (3x3) y una sala que se extiende desde él con forma y tamaño propios
  for (const l of landings) {
    const dx = PDIRS[l.d][0], dy = PDIRS[l.d][1], pad: number[] = [];
    for (let a = 0; a < 3; a++) for (let b = -1; b <= 1; b++) { const x = l.x + dx * a + dy * b, y = l.y + dy * a + dx * b; if (inb(x, y)) pad.push(at(x, y)); }
    pad.forEach((k) => put(k));
    pad.forEach((k) => (lock[k] = 1));
    const sh = shape(), [w, h] = size(sh), off = ri2(2, 6), side = ri2(-3, 3);
    piece(Math.max(4, Math.min(W - 5, l.x + dx * off + dy * side)), Math.max(4, Math.min(H - 5, l.y + dy * off + dx * side)), w, h, sh);
  }
  // piezas sueltas (sin escalera propia): se unen a la más cercana por una pasarela de 3 celdas, o se quedan fuera
  for (let n = 7 + ri2(0, 4), tries = 0; n > 0 && tries < 160; tries++) {
    const sh = shape(), [w, h] = size(sh), cx = ri2(6, W - 7), cy = ri2(6, H - 7);
    if (metas.some((o) => Math.max(Math.abs(o.cx - cx), Math.abs(o.cy - cy)) < 8)) continue;
    let free = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = cx - (w >> 1) + i, y = cy - (h >> 1) + j; if (inb(x, y) && !noUp[at(x, y)]) free++; }
    if (free < w * h * 0.6) continue;
    piece(cx, cy, w, h, sh);
    n--;
  }
  for (let a = 1; a < metas.length; a++) {
    const A = metas[a], q = metas.slice(0, a).sort((p, r) => Math.abs(p.cx - A.cx) + Math.abs(p.cy - A.cy) - Math.abs(r.cx - A.cx) - Math.abs(r.cy - A.cy))[0];
    const wide = ru() < 0.5 ? 1 : 0; // el pasillo: de 3 celdas o de 2
    for (const hFirst of [true, false]) {
      const cells: number[] = [], xr = [Math.min(A.cx, q.cx), Math.max(A.cx, q.cx)], yr = [Math.min(A.cy, q.cy), Math.max(A.cy, q.cy)];
      for (let t = -1; t <= wide; t++) {
        for (let x = xr[0]; x <= xr[1]; x++) cells.push(at(x, (hFirst ? A.cy : q.cy) + t));
        for (let y = yr[0]; y <= yr[1]; y++) cells.push(at((hFirst ? q.cx : A.cx) + t, y));
      }
      if (cells.some((k) => k < 0 || k >= N || (up.kind[k] !== PK.floor && (noUp[k] || lock[k] || ramp[k])))) continue;
      cells.forEach((k) => (put(k), (lock[k] = 1)));
      break;
    }
  }
  // piscinas elevadas en los lounges (borde de 0,6 m, núcleo hondo de 4x4 a 1,5 m; el techo de debajo baja a 3,0) en las piezas grandes
  for (const M of metas) {
    if (M.w < 11 || M.h < 11 || M.sh !== 6) continue;
    const wins: number[] = [];
    for (let py = M.cy - (M.h >> 1); py <= M.cy - (M.h >> 1) + M.h - 6; py++) for (let px = M.cx - (M.w >> 1); px <= M.cx - (M.w >> 1) + M.w - 6; px++) {
      let ok = true;
      for (let j = py; j < py + 6 && ok; j++) for (let i = px; i < px + 6; i++) {
        const k = at(i, j);
        if (!inb(i, j) || up.kind[k] !== PK.floor || lock[k] || kind[k] === PK.column || water[k] === 2 || ramp[k]) { ok = false; break; }
      }
      if (ok) wins.push(py * W + px);
    }
    if (!wins.length) continue;
    const w0 = wins[Math.floor(ru() * wins.length)], px = w0 % W, py = (w0 / W) | 0, cells: number[] = [];
    for (let j = py; j < py + 6; j++) for (let i = px; i < px + 6; i++) cells.push(at(i, j));
    const pl = { rim: [] as number[], core: [] as number[] };
    cells.forEach((k, n) => {
      const cx = n % 6, cy = (n / 6) | 0, c = cx >= 1 && cx <= 4 && cy >= 1 && cy <= 4;
      (up.kind[k] = PK.floor), (up.water[k] = c ? 2 : 1), (up.ya[k] = up.yb[k] = c ? PY.upDeep : PY.upShallow), (ceil[k] = Math.min(ceil[k], 3));
      (c ? pl.core : pl.rim).push(k);
    });
    upPools.push(pl);
  }

  /** Alcance en 3D desde el inicio: nodo = capa * N + celda. Subir hasta 1 m, bajar lo que sea; entre plantas solo por escaleras. */
  const bfs3 = () => {
    const dist = new Int32Array(2 * N).fill(-1), q = [at(start.x, start.y)];
    dist[q[0]] = 0;
    for (let a = 0; a < q.length; a++) {
      const n = q[a], l = n >= N ? 1 : 0, c = n - l * N, x = c % W, y = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + PDIRS[d][0], ny = y + PDIRS[d][1];
        for (let l2 = 0; l2 < 2; l2++) {
          if (!poolWalkable(lay(l2), nx, ny)) continue;
          const nn = l2 * N + ny * W + nx, h0 = poolEdgeY(lay(l), c, d);
          if (dist[nn] >= 0 || poolEdgeY(lay(l2), ny * W + nx, d ^ 1) - h0 > POOL_STEP || (!l2 && ceil[ny * W + nx] < h0)) continue; // (de la alta a la baja solo por un hueco: bajo la losa no se cabe)
          dist[nn] = dist[n] + 1;
          q.push(nn);
        }
      }
    }
    return dist;
  };
  /** Lo inalcanzable, a pared (baja) o a macizo (alta); una piscina elevada sin borde alcanzable desaparece. */
  const prune = () => {
    for (let i = 0; i < N; i++) if (up.kind[i] === PK.floor && kind[i] === PK.column) up.kind[i] = PK.column; // el pilar sigue arriba
    const dist = bfs3();
    for (let i = 0; i < N; i++) {
      if (kind[i] === PK.floor && water[i] < 2 && dist[i] < 0) (kind[i] = PK.wall), (water[i] = 0), (ramp[i] = 0), (tun[i] = tun[i] ? 2 : 0);
      if (up.kind[i] === PK.floor && up.water[i] < 2 && dist[N + i] < 0) (up.kind[i] = PK.wall), (up.water[i] = 0), (up.ramp[i] = 0);
    }
    for (const p of upPools) if (!p.rim.some((k) => up.kind[k] === PK.floor)) for (const k of p.core) (up.kind[k] = PK.wall), (up.water[k] = 0), (ceil[k] = orig[k]);
    return dist;
  };
  const dist = prune();
  // la salida: celda llana alcanzable con una pared al lado (la puerta va contra ella), la más lejana del inicio. Mejor seca y a nivel de cubierta;
  // si no la hay (sala inicial inundada) vale una poco honda, nunca el inicio
  let best = -1, tier = 0;
  const wallNear = (i: number) => PDIRS.some(([dx, dy]) => { const x = (i % W) + dx, y = ((i / W) | 0) + dy; return x >= 0 && y >= 0 && x < W && y < H && kind[y * W + x] === PK.wall; });
  for (let i = 0; i < W * H; i++) {
    if (dist[i] <= 0 || kind[i] !== PK.floor || water[i] > 1 || ramp[i] !== 0 || ya[i] !== yb[i] || !wallNear(i)) continue;
    const t = water[i] === 0 && ya[i] === 0 ? 2 : 1;
    if (t > tier || (t === tier && dist[i] > best)) (tier = t), (best = dist[i]), (m.exit = { x: i % W, y: (i / W) | 0 });
  }

  // 7b. tubos cerrados desde la galería de cada sala alta (uno al final y, si es larga, otro cerca de la torre) hasta un serpentín en CUALQUIER otra sala:
  // van por encima del edificio a 90° y bajan en el último tramo. Hasta 6 por mapa.
  const mouths = [...towers.map((t) => ({ t, z: t.z, back: true })), ...towers.filter((t) => t.gl >= 8).map((t) => ({ t, z: (t.cy + t.sv * 5 + 0.5) * POOL_CELL, back: false }))];
  const took = new Map<PoolRoom, number>();
  for (let ti = 0; ti < mouths.length && m.tubes.length < 6; ti++) {
    const { t, z: tz0, back } = mouths[ti], own = rooms.indexOf(t.room);
    // adónde llega: a las demás salas por orden, primero las que aún no tienen serpentín
    const dests = rooms.map((_, k) => rooms[(own + 1 + k + ti) % rooms.length]).filter((d) => d !== t.room && d.type !== 'hub').sort((a, b) => (took.get(a) ?? 0) - (took.get(b) ?? 0));
    // la boca mira hacia atrás, a la pared lateral de la sala: se alarga hasta empotrarla en el muro; si ahí no hay muro macizo, sin tubo
    const wallX = (t.su > 0 ? t.cx : t.cx + 1) * POOL_CELL;
    if (back && ![-0.45, 0, 0.45].every((l) => kind[at(t.cx - t.su, Math.floor((tz0 + l) / POOL_CELL))] === PK.wall)) continue;
    for (const r of dests) {
    const blocks: (Cell & { fit: number })[] = [];
    for (let j = r.y + 1; j < r.y + r.h - 4; j++) for (let i = r.x + 1; i < r.x + r.w - 4; i++) {
      const k0 = at(i, j);
      let ok = ramp[k0] === 0 && ya[k0] <= 0 && water[k0] < 2;
      for (let b = 0; b < 4 && ok; b++) for (let a = 0; a < 4; a++) { const k = at(i + a, j + b); if ((kind[k] !== PK.floor && kind[k] !== PK.column) || water[k] !== water[k0] || ya[k] !== ya[k0] || ramp[k] || tun[k]) { ok = false; break; } }
      // cuántas vueltas caben bajo el techo (2–5); nada bajo una torre, galería o embarcadero
      let cm: number = PY.tall;
      for (let b = -1; b < 5 && ok; b++) for (let a = -1; a < 5; a++) { const k = at(i + a, j + b); cm = Math.min(cm, kind[k] === PK.wall ? cm : ceil[k]); if (up.kind[k] === PK.floor && ceil[k] >= PY.tall) ok = false; }
      const fit = Math.min(5, Math.floor((cm - 0.15 - (ya[k0] + COIL.r * 2 + 0.02)) / (COIL.rise / 5)));
      if (ok && fit >= 2) blocks.push({ x: i, y: j, fit });
    }
    if (!blocks.length) continue;
    // la salida: 2 m de tubo recto tras el serpentín, abierto, y 3 m de suelo llano y libre delante (ni pared, ni columna, ni escalón)
    const sx = t.x + t.d * 5;
    const landing = (b: Cell, a: [number, number]) => {
      const bx0 = (b.x + 2) * POOL_CELL, bz0 = (b.y + 2) * POOL_CELL, fl = ya[at(b.x, b.y)];
      const ex0 = bx0 + COIL.rho * a[1], ez0 = bz0 - COIL.rho * a[0], lat = [-0.45, 0, 0.45];
      const cellK = (x: number, z: number) => at(Math.floor(x / POOL_CELL), Math.floor(z / POOL_CELL));
      for (let s = 0.25; s <= 5; s += 0.25) {
        const ks = lat.map((l) => cellK(ex0 + a[0] * s - a[1] * l, ez0 + a[1] * s + a[0] * l));
        const inB = (k: number) => k % W >= b.x && k % W < b.x + 4 && ((k / W) | 0) >= b.y && ((k / W) | 0) < b.y + 4; // en el bloque las columnas se retiran luego
        if (!ks.every((k) => (kind[k] === PK.floor || (kind[k] === PK.column && inB(k))) && ya[k] === fl && !ramp[k] && water[k] < 2)) return null;
      }
      return { a, tail: 2 };
    };
    // la ruta ortogonal solo es válida si cada tramo avanza hacia delante y mide al menos 3 m (o es nulo)
    const routeOk = (B: Cell, lnd: NonNullable<ReturnType<typeof landing>>) => {
      const bx = (B.x + 2) * POOL_CELL, bz = (B.y + 2) * POOL_CELL, ax = lnd.a, tx = bx + COIL.rho * ax[1], tz = bz - COIL.rho * ax[0], ex = tx - ax[0] * 6, ez = tz - ax[1] * 6;
      const seg = (len: number) => len === 0 || len >= 3;
      if (ax[1] === 0) return (ex - sx) * t.d >= 3 && seg(Math.abs(ez - tz0));
      return (tx - sx) * t.d >= 3 && seg(Math.abs(ez - tz0)) && (ez - tz0) * ax[1] >= 0;
    };
    const make = (B: Cell, lnd: NonNullable<ReturnType<typeof landing>>, turns: number) => {
      const bx = (B.x + 2) * POOL_CELL, bz = (B.y + 2) * POOL_CELL, floor = ya[at(B.x, B.y)];
      const yEnd = floor + COIL.r + 0.02, yTop = yEnd + (COIL.rise * turns) / 5, y0 = PY.tower + COIL.r, drop = yTop < y0 - 0.3;
      const dx = bx - sx, dz = bz - tz0, horiz = Math.abs(dx) >= Math.abs(dz), ax = lnd.a;
      const tx = bx + COIL.rho * ax[1], tz = bz - COIL.rho * ax[0], ex = tx - ax[0] * 6, ez = tz - ax[1] * 6; // la entrada del serpentín: la tangente de la hélice mira a ax
      // solo tramos a 90° (así cruzan las paredes de frente): sale en x, y llega por x o por z
      void horiz;
      const xy: [number, number][] = [[t.x, tz0], [sx, tz0]];
      if (ax[1] === 0) xy.push([ex, tz0], [ex, ez], [tx, tz]);
      else xy.push([tx, tz0], [tx, ez], [tx, tz]);
      for (let q = xy.length - 1; q > 0; q--) if (Math.hypot(xy[q][0] - xy[q - 1][0], xy[q][1] - xy[q - 1][1]) < 0.01) xy.splice(q, 1); // sin tramos nulos
      let tot = 0;
      const cum = xy.map((p, k) => (k ? (tot += Math.hypot(p[0] - xy[k - 1][0], p[1] - xy[k - 1][1])) : 0));
      // (un serpentín corto queda más bajo: el tubo va a la altura de la torre y solo baja en el último tramo, ya sobre la sala de llegada)
      const pts: PoolTube['pts'] = xy.map((p, k) => [p[0], drop ? (k === xy.length - 1 ? yTop : y0) : y0 + (yTop - y0) * (k === 0 ? 0 : Math.min(1, Math.max(0, (cum[k] - 5) / Math.max(1, tot - 5)))), p[1]]);
      return { pts, coil: { x: bx, z: bz, dx: ax[0], dz: ax[1], yEnd, tail: lnd.tail, turns }, back: back ? ([wallX - t.su * 0.3, y0, tz0] as [number, number, number]) : undefined };
    };
    // en planta: la ruta, el serpentín (un círculo) y la cola de salida, a puntos cada medio metro
    const plan = (tb: PoolTube) => {
      const out: [number, number][] = [];
      const seg = (x0: number, z0: number, x1: number, z1: number) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5)); for (let k = 0; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]); };
      for (let q = 1; q < tb.pts.length; q++) seg(tb.pts[q - 1][0], tb.pts[q - 1][2], tb.pts[q][0], tb.pts[q][2]);
      const c = tb.coil, ex1 = c.x + COIL.rho * c.dz, ez1 = c.z - COIL.rho * c.dx;
      for (let k = 0; k < 12; k++) out.push([c.x + COIL.rho * Math.cos((k / 12) * 2 * Math.PI), c.z + COIL.rho * Math.sin((k / 12) * 2 * Math.PI)]);
      seg(ex1, ez1, ex1 + c.dx * (c.tail ?? 2.5), ez1 + c.dz * (c.tail ?? 2.5));
      return out;
    };
    const SEP = 3; // m: ningún tubo pasa por encima ni cerca de otro
    const apart = (cand: ReturnType<typeof make>) => {
      const mine = plan(cand as PoolTube);
      return m.tubes.every((o) => { const theirs = plan(o); return mine.every((p) => theirs.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > SEP)); });
    };
    // la ruta no atraviesa columnas (miden 0,6 m de radio y llegan al techo de su sala)
    const colsClear = (tb: PoolTube, B: Cell) => {
      const pl = plan({ ...tb, coil: { ...tb.coil, tail: 0 } } as PoolTube).slice(0, -14);
      const a = tb.pts[tb.pts.length - 2], b = tb.pts[tb.pts.length - 1], fin = Array.from({ length: 13 }, (_, q) => [a[0] + ((b[0] - a[0]) * q) / 12, a[2] + ((b[2] - a[2]) * q) / 12]); // el último tramo baja: ahí cuentan todas las columnas
      const far = (c: Cell) => (p: number[]) => Math.hypot(p[0] - (c.x + 0.5) * POOL_CELL, p[1] - (c.y + 0.5) * POOL_CELL) > 1.15;
      return columns.every((c) => (c.x >= B.x && c.x < B.x + 4 && c.y >= B.y && c.y < B.y + 4) || ((ceil[at(c.x, c.y)] <= PY.tower || pl.every(far(c))) && fin.every(far(c))));
    };
    const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // el primero que valga desde un punto al azar (probarlos todos tardaba)
    const cands = blocks.flatMap((b) => DIRS.map((a) => ({ b, a })));
    let pick: { b: (typeof blocks)[number]; l: NonNullable<ReturnType<typeof landing>> } | undefined;
    for (let q = 0, o = int(0, cands.length - 1); q < cands.length && !pick; q++) {
      const { b, a } = cands[(o + q) % cands.length], l = landing(b, a);
      if (!l || !routeOk(b, l)) continue;
      const tb = make(b, l, b.fit);
      if (colsClear(tb, b) && apart(tb)) pick = { b, l };
    }
    if (!pick) continue;
    const B = pick.b;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) if (kind[at(B.x + a, B.y + b)] === PK.column) kind[at(B.x + a, B.y + b)] = PK.floor; // el serpentín se lleva las columnas que estorben
    m.tubes.push(make(B, pick.l, int(Math.max(2, B.fit - 2), B.fit)));
    took.set(r, (took.get(r) ?? 0) + 1);
    { // el tubo cruza la planta alta como macizo
      const tb = m.tubes[m.tubes.length - 1], ox = rooms.indexOf(t.room);
      for (const [px, pz] of plan(tb)) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ci = Math.floor(px / POOL_CELL) + di, cj = Math.floor(pz / POOL_CELL) + dj;
        if (ci < 0 || cj < 0 || ci >= W || cj >= H) continue;
        const k = at(ci, cj), cxm = (ci + 0.5) * POOL_CELL, czm = (cj + 0.5) * POOL_CELL;
        if (roomAt[k] === ox || Math.hypot(cxm - px, czm - pz) > 1.6) continue;
        (up.kind[k] = PK.wall), (up.water[k] = 0), (up.ramp[k] = 0);
      }
    }
    break; // ya tiene tubo
    }
  }

  // 7c. el segundo nivel: la galería de cada sala alta sigue por el muro del fondo (un balcón en L sobre la sala); en las salas secas baja por otra escalera. Se detiene donde pasa un tubo.
  for (const t of towers) {
    const r = t.room, ri = rooms.indexOf(r), cell = (u: number, v: number) => at(t.cx + t.su * u, t.cy + t.sv * v);
    const clear = (u: number, v: number) => {
      const x = (t.cx + t.su * u + 0.5) * POOL_CELL, z = (t.cy + t.sv * v + 0.5) * POOL_CELL;
      for (const tb of m.tubes) if (Math.hypot(x - tb.coil.x, z - tb.coil.z) < 4) return false; // (ni encima de un serpentín)
      for (const tb of m.tubes) for (let q = 1; q < tb.pts.length; q++) {
        const [ax_, , az_] = tb.pts[q - 1], [bx_, , bz_] = tb.pts[q], dx_ = bx_ - ax_, dz_ = bz_ - az_, l2 = dx_ * dx_ + dz_ * dz_ || 1, f = Math.max(0, Math.min(1, ((x - ax_) * dx_ + (z - az_) * dz_) / l2));
        if (Math.hypot(x - ax_ - f * dx_, z - az_ - f * dz_) < 2.3) return false;
      }
      return true;
    };
    const ok = (u: number, v: number) => u >= 0 && v >= 0 && u < r.w && v < r.h && roomAt[cell(u, v)] === ri;
    const undo: (() => void)[] = [];
    const fin = () => {
      const rn = groundReach();
      if (rn < reachNow) undo.reverse().forEach((f) => f()); // si el embarcadero aísla suelo, se quita
      else reachNow = rn;
    };
    const put = (u: number, v: number, a: number, b: number, rp: number, d: number) => {
      const i = cell(u, v), o = [kind[i], water[i], tun[i], ya[i], yb[i], ramp[i], dir[i], ceil[i]];
      undo.push(() => ([kind[i], water[i], tun[i], ya[i], yb[i], ramp[i], dir[i], ceil[i]] = o as [number, number, number, number, number, number, number, number]));
      (kind[i] = PK.floor), (water[i] = 0), (tun[i] = 0), (ya[i] = a), (yb[i] = b), (ramp[i] = rp), (dir[i] = d), (ceil[i] = PY.tall);
    };
    const putUp = (u: number, v: number) => {
      const i = cell(u, v), o = [up.kind[i], up.water[i], up.ya[i], up.yb[i], up.ramp[i]];
      undo.push(() => ([up.kind[i], up.water[i], up.ya[i], up.yb[i], up.ramp[i]] = o as [number, number, number, number, number]));
      upFloor(i);
    };
    // embarcadero: una pasarela de 2 celdas desde la mitad de la galería que se queda a 3 celdas del muro de enfrente (así el suelo de abajo sigue comunicado), con un mirador de 3x4 al final y una escalera que baja al suelo
    const vb = 4 + (t.gl >> 1);
    let uEnd = 2;
    for (let u = 3; u < r.w - 3; u++) {
      let good = true;
      for (let v = vb; v <= vb + 1; v++) if (!ok(u, v) || !clear(u, v)) good = false;
      if (!good) break;
      uEnd = u;
    }
    if (uEnd < 7) continue;
    for (let u = 3; u <= uEnd; u++) for (let v = vb; v <= vb + 1; v++) putUp(u, v);
    let view = true;
    for (let u = uEnd - 2; u <= uEnd; u++) for (let v = vb - 1; v <= vb + 2; v++) if (!ok(u, v) || !clear(u, v)) view = false;
    if (!view) { fin(); continue; }
    for (let u = uEnd - 2; u <= uEnd; u++) for (let v = vb - 1; v <= vb + 2; v++) putUp(u, v);
    // escalera desde el mirador (hacia el lado con sitio), solo sobre suelo seco o poco hondo; sus peldaños bajan alejándose del mirador
    for (const sg of [1, -1]) {
      const vs = sg > 0 ? vb + 3 : vb - 2;
      let good = true;
      for (let k = 0; k < 8 && good; k++) for (let u = uEnd - 1; u <= uEnd; u++) { const v = vs + sg * k; if (!ok(u, v) || !clear(u, v) || ramp[cell(u, v)] || water[cell(u, v)] > 1 || tun[cell(u, v)]) good = false; }
      if (!good) continue;
      const upDir = -sg * t.sv > 0 ? 2 : 3; // cuesta arriba, hacia el mirador
      for (let k = 0; k < 8; k++) for (let u = uEnd - 1; u <= uEnd; u++) put(u, vs + sg * k, PY.tower - (k + 1) * (PY.tower / 8), PY.tower - k * (PY.tower / 8), PR.stairs, upDir);
      break;
    }
    fin();
  }


  // 10. el forjado: bajo suelo de la planta alta el techo baja a PY.ceil (3,0 bajo una piscina elevada); los pilares siguen arriba
  const fd = prune();
  for (let i = 0; i < N; i++) {
    if (ramp[i] === PR.stairs && ya[i] === yb[i]) ramp[i] = 0; // un peldaño que quedó bajo un foso o una piscina puesta después: fuera
    if (up.kind[i] === PK.floor || up.kind[i] === PK.column) ceil[i] = Math.min(ceil[i], up.water[i] ? 3 : PY.ceil);
  }
  // alcance y masas de agua honda a las que se llega nadando (tocan suelo pisable de su capa)
  for (let l = 0; l < 2; l++) {
    const a = lay(l), seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (a.kind[i] === PK.floor && a.water[i] < 2 && fd[l * N + i] >= 0) m.reach[l][i] = 1;
    for (let s = 0; s < N; s++) {
      if (seen[s] || a.kind[s] !== PK.floor || a.water[s] !== 2) continue;
      const cs = [s], st = [s];
      let touch = false;
      seen[s] = 1;
      while (st.length) {
        const c = st.pop()!, x = c % W, y = (c / W) | 0;
        for (const [dx, dy] of PDIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (a.kind[j] === PK.floor && a.water[j] === 2) { if (!seen[j]) (seen[j] = 1), cs.push(j), st.push(j); } else if (m.reach[l][j]) touch = true;
        }
      }
      if (touch) for (const i of cs) m.swim[l][i] = 1;
    }
  }
  // 11. túneles sin fondo: bocas de 2x2 celdas en el fondo hondo (con 1 celda de margen también honda: nada de zanjas ni túneles `tun`) de piscinas
  // de las dos plantas, emparejadas A<->B lejos del inicio y de la salida y entre sí
  {
    const rp = mulberry32(seed ^ 0x90a1), man = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    type Blk = Cell & { l: 0 | 1 };
    const blocks: Blk[] = [];
    for (const l of [0, 1] as const) for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 2; x++) {
      const a = lay(l);
      let ok = true;
      for (let j = y - 1; j <= y + 2 && ok; j++) for (let i = x - 1; i <= x + 2; i++) {
        const k = at(i, j);
        if (a.kind[k] !== PK.floor || a.water[k] !== 2 || !m.swim[l][k] || Math.abs(a.ya[k] - (l ? PY.upDeep : PY.deep)) > 0.01 || (l === 0 && (tun[k] || rooms[roomAt[k]]?.type === 'hub'))) { ok = false; break; }
      }
      if (ok) blocks.push({ x, y, l });
    }
    const pool = blocks.filter((b) => man(b, m.start) >= 9 && man(b, m.exit) >= 8), taken: Blk[] = [];
    const free = (b: Blk) => taken.every((t) => man(b, t) >= 5), nPairs = 3 + Math.floor(rp() * 3);
    for (let p = 0; p < nPairs; p++) {
      const ups = pool.filter((b) => b.l === 1 && free(b)), fa = p === 0 && ups.length ? ups : pool.filter(free);
      if (!fa.length) break;
      const a = fa[Math.floor(rp() * fa.length)];
      taken.push(a);
      const fb = pool.filter((b) => free(b) && man(a, b) >= 10);
      let b: Blk | null = null, bs = -1;
      for (let t = 0; t < 40 && fb.length; t++) {
        const c = fb[Math.floor(rp() * fb.length)], sc = man(a, c) + (c.l !== a.l ? (p === 0 ? 100 : 10) : 0);
        if (sc > bs) (bs = sc), (b = c);
      }
      if (!b) { taken.pop(); continue; }
      taken.push(b);
      m.portals.push({ a: { x: a.x, y: a.y, layer: a.l }, b: { x: b.x, y: b.y, layer: b.l } });
    }
  }
  // lámparas y bebederos de la planta alta (los de abajo, más adelante)
  for (let y = 1; y < H; y += 3) for (let x = 1; x < W; x += 3) if (up.kind[at(x, y)] === PK.floor && !up.water[at(x, y)] && m.reach[1][at(x, y)]) m.lampsUp.push({ x, y });
  const ru2 = mulberry32(seed ^ 0x3a11);
  metas.forEach((M, mi) => { // un bebedero en una de cada dos piezas de arriba (celda seca contra un muro macizo)
    if (mi % 2) return;
    const c: Cell[] = [];
    for (let y = M.cy - (M.h >> 1); y < M.cy - (M.h >> 1) + M.h; y++) for (let x = M.cx - (M.w >> 1); x < M.cx - (M.w >> 1) + M.w; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const i = at(x, y);
      if (up.kind[i] !== PK.floor || up.water[i] || !m.reach[1][i] || lock[i]) continue;
      if (PDIRS.some(([dx, dy]) => { const k = at(x + dx, y + dy); return up.kind[k] === PK.wall && (kind[k] !== PK.floor || ceil[k] < PY.tall - 0.01); })) c.push({ x, y });
    }
    if (c.length) m.refillsUp.push(c[Math.floor(ru2() * c.length)]);
  });

  // zonas a oscuras: ~35 % de las salas (menos la inicial, la de la salida y el cruce central) casi sin luz y sin sol (azar aparte: no mueve el mapa)
  const rd = mulberry32(seed ^ 0xda7c), keep = new Set([roomAt[at(m.start.x, m.start.y)], roomAt[at(m.exit.x, m.exit.y)]]);
  rooms.forEach((r, ri) => {
    if (r.type === 'hub' || keep.has(ri) || rd() >= 0.35) return;
    r.light = 0.05 + rd() * 0.07;
    r.flicker = rd() < 0.4;
    r.sun = false;
  });

  // 8. luminarias: una cada 3 celdas; ventanas en una pared de las salas con sol (cada 4 celdas, solo donde fuera hay pared)
  for (let y = 1; y < H; y += 3) for (let x = 1; x < W; x += 3) if (kind[at(x, y)] === PK.floor && ramp[at(x, y)] === 0 && (!vax[at(x, y)] || voff[at(x, y)] === 1 || voff[at(x, y)] === 2)) m.lamps.push({ x, y, r: roomAt[at(x, y)] });
  rooms.forEach((r, ri) => {
    if (!r.sun) return;
    const d: number = 0, horizontal = false; // el sol viene del este: solo esa pared tiene ventanas con haz
    const n = horizontal ? r.w : r.h;
    const at_ = (k: number) => [d === 0 ? r.x + r.w - 1 : d === 1 ? r.x : r.x + k, d === 2 ? r.y + r.h - 1 : d === 3 ? r.y : r.y + k];
    const okAt = (k: number) => {
      const [x, y] = at_(k), i = at(x, y), nx = x + PDIRS[d][0], ny = y + PDIRS[d][1];
      // y fuera, las tres celdas contiguas (la de la ventana y sus vecinas) son pared: el cielo de detrás ocupa ese hueco y no puede caer dentro de un pasillo
      const solidOut = (kk: number) => { const [ax, ay] = at_(kk), ox = ax + PDIRS[d][0], oy = ay + PDIRS[d][1]; return ox >= 0 && oy >= 0 && ox < W && oy < H && kind[at(ox, oy)] === PK.wall && !tun[at(ox, oy)]; };
      return kind[i] === PK.floor && water[i] <= 1 && ramp[i] === 0 && nx >= 0 && ny >= 0 && nx < W && ny < H && kind[at(nx, ny)] === PK.wall && !tun[at(nx, ny)] && solidOut(k - 1) && solidOut(k + 1);
    };
    // por cada tramo seguido de pared lisa (sin bocas de pasillo ni escaleras): ventanas cada 4 celdas, centradas en el tramo
    for (let k = 0; k < n;) {
      if (!okAt(k)) { k++; continue; }
      let e = k;
      while (e < n && okAt(e)) e++;
      const L = e - k, cnt = L >= 3 ? Math.floor((L - 3) / 4) + 1 : 0, s0 = k + Math.floor((L - 1 - 4 * (cnt - 1)) / 2);
      for (let j = 0; j < cnt; j++) { const [x, y] = at_(s0 + 4 * j); m.windows.push({ x, y, d, room: ri }); }
      k = e;
    }
  });
  m.columns = columns.filter((c) => kind[at(c.x, c.y)] === PK.column);
  // 9. bebederos: uno cada dos salas, en una celda llana y seca pegada a una pared (aparte de `rnd`, para no mover el resto del mapa)
  const rr = mulberry32(seed ^ 0x7ef1);
  rooms.forEach((r, ri) => {
    if (ri % 2) return;
    const c: Cell[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = at(x, y);
      if (roomAt[i] !== ri || kind[i] !== PK.floor || water[i] || tun[i] || ramp[i] || ya[i] !== PY.deck || yb[i] !== PY.deck) continue;
      if (PDIRS.some(([dx, dy]) => kind[at(x + dx, y + dy)] === PK.wall)) c.push({ x, y });
    }
    if (c.length) m.refills.push(c[Math.floor(rr() * c.length)]);
  });
  return m;
}

/** Una celda con su planta (l = 1: alta). Los objetos de poolMaze salen así; `Maze.lay` guarda la planta. */
type LCell = Cell & { l?: 0 | 1 };

/**
 * Los jabones de la misión (items `tape` con id `t…`): mitad en seco (cubierta y salas, de las dos plantas) y mitad con riesgo, en el fondo de
 * piscinas hondas (también las elevadas) y en túneles inundados. Lejos del inicio y entre sí; los de agua, solo en masas que se alcanzan nadando.
 * Nunca en una boca de túnel sin fondo.
 */
function soapSpots(m: PoolMap, seed: number, open: Uint8Array, n = 8): LCell[] {
  const rnd = mulberry32(seed ^ 0x50a9), W = m.w, H = m.h;
  const swim = (i: number) => m.water[i] === 2 || m.tun[i] > 0;
  // masas de agua honda/túnel que tocan suelo pisable
  const ok = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !swim(s)) continue;
    const comp = [s], st = [s];
    seen[s] = 1;
    let touch = false;
    while (st.length) {
      const i = st.pop()!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of PDIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (swim(j)) { if (!seen[j]) (seen[j] = 1), comp.push(j), st.push(j); }
        else if (open[j] && m.kind[j] === PK.floor) touch = true;
      }
    }
    if (touch) for (const i of comp) ok[i] = 1;
  }
  const noPortal = new Set<number>();
  for (const p of m.portals) for (const e of [p.a, p.b]) for (let j = e.y - 1; j <= e.y + 2; j++) for (let i = e.x - 1; i <= e.x + 2; i++) noPortal.add(j * W + i);
  const dry: LCell[] = [], wet: LCell[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (m.kind[i] === PK.floor && m.water[i] === 0 && !m.tun[i] && !m.ramp[i] && m.ya[i] === PY.deck && m.yb[i] === PY.deck) dry.push({ x, y, l: 0 });
    else if (ok[i] && m.kind[i] === PK.floor && m.water[i] === 2 && !noPortal.has(i)) wet.push({ x, y, l: 0 });
    else if (ok[i] && m.tun[i] === 2) wet.push({ x, y, l: 0 });
    if (m.reach[1][i] && m.up.water[i] === 0 && m.up.ya[i] === PY.up) dry.push({ x, y, l: 1 });
    else if (m.swim[1][i] && m.up.water[i] === 2 && !noPortal.has(i)) wet.push({ x, y, l: 1 });
  }
  const d = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y), out: LCell[] = [];
  for (let k = 0; k < n; k++) {
    // alterna seco / agua (si una lista se agota, la otra); de una muestra al azar, la que queda más lejos de lo ya puesto
    const pool = k % 2 && wet.length ? wet : dry.length ? dry : wet;
    let best: LCell | null = null, bs = -1;
    for (let t = 0; t < 80; t++) {
      const c = pool[Math.floor(rnd() * pool.length)];
      if (!c) break;
      const sc = Math.min(d(c, m.start) + 8, d(c, m.exit) * 2, ...out.map((o) => d(c, o)));
      if (sc > bs && !out.some((o) => o.x === c.x && o.y === c.y)) (bs = sc), (best = c);
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Las Poolrooms vistas como un `Maze` plano, para lo que el servidor ya sabe hacer con él (jugadores, misión, ascensor, entidades): `open`
 * son las celdas que se pisan en CUALQUIER planta (suelo y agua poco honda; el agua honda se nada y no cuenta), `elevator` es la salida.
 * `lay[i]` = 1 si lo que haya en esa celda está en la planta alta (por defecto, la baja; la alta si solo es pisable arriba). La altura la lleva
 * el cliente (poolCellY). Sin cintas, linternas ni escondites de momento.
 */
export function poolMaze(seed: number): Maze {
  const m = generatePools(seed), n = m.w * m.h, open = new Uint8Array(n), lay = new Uint8Array(n);
  const upOpen = (i: number) => m.up.kind[i] === PK.floor && m.up.water[i] < 2;
  for (let i = 0; i < n; i++) {
    const lo = m.kind[i] === PK.floor && m.water[i] < 2, hi = upOpen(i); // (un pilar no se pisa)
    open[i] = lo || hi ? 1 : 0;
    lay[i] = !lo && hi ? 1 : 0;
  }
  const far = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const cand: LCell[] = [], candUp: LCell[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x;
    if (m.kind[i] !== PK.wall && m.water[i] < 2 && m.kind[i] === PK.floor && m.ramp[i] === 0) cand.push({ x, y, l: 0 });
    if (upOpen(i) && m.reach[1][i]) candUp.push({ x, y, l: 1 });
  }
  // la cámara y los arranques de entidades: celdas llanas de la planta baja, lejos del inicio y entre sí
  const spawns: Cell[] = [];
  for (const c of [...cand].sort((a, b) => far(b, m.start) - far(a, m.start))) if (spawns.length < 4 && far(c, m.start) > 30 && far(c, m.exit) > 8 && spawns.every((o) => far(c, o) > 20)) spawns.push({ x: c.x, y: c.y });
  const tapes = soapSpots(m, seed, open);
  const camera = cand.find((c) => far(c, m.start) > 6 && far(c, m.start) < 20 && !tapes.some((t) => t.x === c.x && t.y === c.y)) ?? { ...m.start, l: 0 as const };
  // objetos del mapa: celdas secas y llanas (de las dos plantas), lejos del inicio y entre sí; la mitad de linternas/latas en salas a oscuras (premio por arriesgarse)
  const inRoom = (c: Cell, solid: boolean) => m.rooms.findIndex((r) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h && (!solid || m.kind[c.y * m.w + c.x] === PK.floor));
  const dry: LCell[] = [], dark: LCell[] = [], deck: LCell[] = [], dryRoom: LCell[] = [];
  for (const c of cand) {
    const i = c.y * m.w + c.x;
    if (m.water[i] || m.tun[i] || m.ya[i] !== PY.deck || m.yb[i] !== PY.deck) continue;
    const r = m.rooms[inRoom(c, true)];
    if (!r) continue;
    dry.push(c);
    if (r.light < 0.15) dark.push(c);
    if (r.type !== 'pool' && r.type !== 'hub') dryRoom.push(c);
    let near = false; // junto a agua honda (a 2 celdas)
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (m.water[(c.y + dy) * m.w + c.x + dx] === 2) { near = true; break; }
    if (near && r.type === 'pool') deck.push(c);
  }
  for (const c of candUp) {
    const i = c.y * m.w + c.x, r = m.rooms[inRoom(c, false)]; // (la alta puede quedar fuera de toda sala de abajo)
    if (m.up.water[i] || m.up.ramp[i] || m.up.ya[i] !== PY.up) continue;
    dry.push(c);
    if (r && r.light < 0.15) dark.push(c);
    if (!r || (r.type !== 'pool' && r.type !== 'hub')) dryRoom.push(c);
  }
  const rs = mulberry32(seed ^ 0x17e5), used: Cell[] = [m.start, m.exit, camera, ...tapes, ...m.refills, ...m.refillsUp];
  const placed: Cell[] = [], put = (pool: LCell[], gap: number) => {
    let best: LCell | null = null, bs = -1;
    for (let t = 0; t < 150 && pool.length; t++) {
      const c = pool[Math.floor(rs() * pool.length)];
      if (far(c, m.start) < 20 || far(c, m.exit) < 8 || used.some((o) => far(c, o) < 4)) continue;
      const sc = Math.min(...placed.map((o) => far(c, o)), 99);
      if (sc >= gap && sc > bs) (bs = sc), (best = c);
    }
    if (best) used.push(best), placed.push(best);
    return best;
  };
  const tank = put(deck.length ? deck : dry, 12), watergun = put(dryRoom.length ? dryRoom : dry, 12);
  const pk = (i: number) => put(i % 2 === 0 && dark.length ? dark : dry, 10) ?? put(dry, 6);
  const radar = put(dryRoom.length ? dryRoom : dry, 10) ?? put(dry, 4);
  const flashlights = Array.from({ length: 2 + (seed & 1) }, (_, i) => pk(i)).filter((c): c is LCell => !!c);
  const waters = Array.from({ length: 4 + ((seed >> 1) & 1) }, (_, i) => pk(i)).filter((c): c is LCell => !!c);
  // la planta de cada objeto y las celdas limpias (sin la marca `l`)
  const plain = (c: LCell): Cell => (c.l && (lay[c.y * m.w + c.x] = 1), { x: c.x, y: c.y });
  const camera2 = plain(camera), tapes2 = tapes.map(plain), fl2 = flashlights.map(plain), wa2 = waters.map(plain), tank2 = tank ? plain(tank) : null, wg2 = watergun ? plain(watergun) : null;
  return {
    w: m.w, h: m.h, open, lit: new Uint8Array(n).fill(1), zone: new Uint8Array(n), voids: [], start: m.start, elevator: m.exit, camera: camera2, pistol: null, extraGuns: [], tapes: tapes2, flashlights: fl2, waters: wa2, tank: tank2, watergun: wg2, radar: radar ? plain(radar) : null, lay,
    spawns: spawns.length ? spawns : [m.exit], lamps: m.lamps.map((l) => ({ x: l.x, y: l.y })), props: [], hides: [], rooms: m.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, zone: 0 })), totem: null,
  };
}
