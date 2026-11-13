/*
 * El mapa de las backrooms, nuevo en cada partida. Una rejilla de celdas de 1,5 m (suelo o pared): salas
 * grandes (alguna enorme, en el centro) con columnas, tabiques sueltos o cuartos, unidas por pasillos de 1–2
 * celdas y por aberturas amplias entre salas contiguas, y alguna zona apagada. En las paredes hay nichos donde
 * esconderse (`hides`). Puro: la misma semilla da el mismo mapa, y todo lo que hay que alcanzar se alcanza
 * desde el inicio sin pisar un hueco.
 */

export type Cell = { x: number; y: number };
export type PropKind = 'vent' | 'socket' | 'armchair' | 'exit' | 'door' | 'cabinet' | 'shelf' | 'chair' | 'chair2' | 'desk' | 'crt' | 'lamp' | 'suitedoor' | 'bed' | 'sofa' | 'luggage' | 'bin' | 'mirror' | 'plant' | 'nightstand' | 'tlamp' | 'wardrobe' | 'wingchair' | 'bistro' | 'reception' | 'stairs' | 'steeldoor' | 'grandoor' | 'faceling' | 'trolley' | 'cart' | 'panel';
/** Tipos de zona (cada sala tiene una; el resto, pasillos, es 0): el suelo y la luz cambian de tono para reconocerlas. */
export const ZONE = { none: 0, pits: 1, hall: 2, cubicles: 3, office: 4, shelves: 5 } as const;
export interface Maze {
  w: number;
  h: number; // en celdas de 1,5 m
  open: Uint8Array; // w*h, 1 = suelo, 0 = pared
  lit: Uint8Array; // w*h, 1 = zona con fluorescentes, 0 = zona apagada
  zone: Uint8Array; // w*h, tipo de zona (ZONE)
  voids: Cell[]; // huecos al vacío (suelo abierto que no se pisa)
  /** Las Suites: la planta (1-5), que da el número de las puertas. */
  floor?: number;
  /** Mapa periódico (Las Suites): las columnas [desde, hasta) donde va lo único (objetos, botín): el jugador no sale de ahí, las demás son copias. */
  span?: [number, number];
  /** Las Suites: la celda del descansillo de arriba de la escalera de servicio (la de verdad, en la copia del medio): al llegar con la misión hecha, se sube de planta. */
  stairs?: Cell;
  /** Las Suites: los cuadros eléctricos que hay que activar (en la copia del medio) para que el ascensor tenga corriente. */
  gens?: Cell[];
  start: Cell;
  elevator: Cell; // un callejón de una celda: la cabina
  camera: Cell;
  pistol: Cell | null;
  extraGuns: Cell[]; // rifles de más para partidas de 3-4 (ids g1, g2...): uno por cada dos jugadores
  tapes: Cell[]; // 8
  flashlights: Cell[]; // linternas sueltas (repuestos: la que se lleva se gasta)
  spawns: Cell[]; // arranque de bacteria y partygoer, y candidatos para las que reaparezcan
  lamps: Cell[]; // celdas con panel de luz encendido
  /** `rot`: índice de DIRS hacia donde mira (o, en lo que se apoya en una pared, hacia la pared). `off`: metros (x, z) desde el centro de la celda, para lo que no cae en el centro (Las Suites). */
  props: { cell: Cell; kind: PropKind; rot: number; off?: [number, number] }[];
  /**
   * Nichos en las paredes donde esconderse: `cell` es la celda del nicho (en `open` sigue siendo pared: para
   * todo lo demás es pared; solo se dibuja hueca) y `side` el índice de DIRS hacia la celda abierta de la boca.
   */
  hides: { cell: Cell; side: number }[];
  /** Las salas grandes (informativo). */
  rooms: { x: number; y: number; w: number; h: number; zone: number }[];
  /** Dónde está el Tótem de la vida, si esta partida lo tiene (se pone con `totemSpot`, no lo trae generateMaze). */
  totem?: Cell | null;
  /** Poolrooms: latas de agua (ids w0...), pistola de agua (id p0) y tanque de buceo (id k0), puestos por poolMaze. */
  waters?: Cell[];
  /** Poolrooms: el radar ya viene puesto (null: no hay); si falta, lo coloca radarSpot. */
  radar?: Cell | null;
  watergun?: Cell | null;
  tank?: Cell | null;
  /** Poolrooms: w*h, 1 = lo que haya en esta celda (objeto, jabón, radar...) está en la planta ALTA (PoolMap.up); 0/ausente = planta baja. */
  lay?: Uint8Array;
}

export const CELL = 1.5;
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hay un panel de luz en el techo de esa celda: uno cada dos celdas (3 m) y, en las salas de pozos, el doble de densos. */
export const hasPanel = (m: Pick<Maze, 'w' | 'zone'>, x: number, y: number) => (x % 2 === 0 && y % 2 === 0) || (x % 2 === 1 && y % 2 === 1 && m.zone[y * m.w + x] === ZONE.pits);

/** Distancias por BFS desde `from` (-1 donde no se llega); `blocked` cuenta como pared. */
export function bfs(m: Pick<Maze, 'w' | 'h' | 'open'>, from: Cell, blocked?: Set<number>) {
  const d = new Int32Array(m.w * m.h).fill(-1), q = [from.y * m.w + from.x];
  d[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % m.w, y = (c / m.w) | 0;
    for (const [dx, dy] of DIRS) {
      const n = (y + dy) * m.w + x + dx;
      if (x + dx < 0 || y + dy < 0 || x + dx >= m.w || y + dy >= m.h || !m.open[n] || d[n] >= 0 || blocked?.has(n)) continue;
      d[n] = d[c] + 1;
      q.push(n);
    }
  }
  return d;
}

/** Lo que mide, en celdas, el recorrido bueno: inicio → cámara → cintas (la más cercana cada vez) → ascensor. */
export function routeLength(m: Maze) {
  const blocked = new Set(m.voids.map((v) => v.y * m.w + v.x));
  let at = m.camera, len = bfs(m, m.start, blocked)[at.y * m.w + at.x];
  const left = [...m.tapes];
  while (left.length) {
    const d = bfs(m, at, blocked);
    left.sort((a, b) => d[a.y * m.w + a.x] - d[b.y * m.w + b.x]);
    const t = left.shift()!;
    len += d[t.y * m.w + t.x];
    at = t;
  }
  return len + bfs(m, at, blocked)[m.elevator.y * m.w + m.elevator.x];
}

type Rect = { x: number; y: number; w: number; h: number };
const area = (r: Rect) => r.w * r.h;

function build(seed: number, n: number): Maze {
  const rnd = mulberry32(seed), w = n, h = n, open = new Uint8Array(w * h), lit = new Uint8Array(w * h), zone = new Uint8Array(w * h);
  const gridVoids: Cell[] = []; // los fosos de las salas de pozos
  const nooks: { cell: Cell; side: number; kind: 'desk' }[] = []; // los cubículos: celda y lado de la pared del fondo
  const at = (x: number, y: number) => y * w + x;
  const int = (a: number, b: number) => a + ((rnd() * (b - a + 1)) | 0); // entero en [a, b]
  const pick = <T,>(a: T[]) => a[(rnd() * a.length) | 0];
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fill = (r: Rect, v: 0 | 1) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) open[at(x, y)] = v;
  };
  const wall = (x: number, y: number) => void (open[at(x, y)] = 0);

  // un hueco de puerta de `len` celdas en una línea de pared (vertical u horizontal), donde haya suelo a los dos lados
  const door = (vertical: boolean, line: number, from: number, to: number, len = 2) => {
    const ok: number[] = [];
    for (let i = from; i + len - 1 <= to; i++) {
      let good = true;
      for (let k = 0; k < len && good; k++) {
        const [a, b] = vertical ? [at(line - 1, i + k), at(line + 1, i + k)] : [at(i + k, line - 1), at(i + k, line + 1)];
        good = !!open[a] && !!open[b];
      }
      if (good) ok.push(i);
    }
    if (!ok.length) return false;
    const i = pick(ok);
    for (let k = 0; k < len; k++) open[vertical ? at(line, i + k) : at(i + k, line)] = 1;
    return true;
  };

  // lo que llena cada sala (ya abierta): columnas, tiras, cuartos o tabiques sueltos
  const pillars = (r: Rect, step = rnd() < 0.35 ? 5 : 3) => {
    const cross = step === 5;
    for (let y = r.y + 1; y < r.y + r.h - 1; y++)
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        if ((x - r.x) % step !== step >> 1 || (y - r.y) % step !== step >> 1) continue;
        wall(x, y);
        if (cross) DIRS.forEach(([dx, dy]) => wall(x + dx, y + dy)); // columnas en cruz
      }
  };
  const office = (r: Rect, depth = 0): void => {
    // cuartos pequeños: se parte en dos con un muro y una puerta, hasta cuartos de 3–6 celdas
    const big = Math.max(r.w, r.h);
    if (big < 7 || depth > 4 || (big < 10 && rnd() < 0.3)) {
      // un tabique suelto dentro, a veces
      if (r.w >= 4 && r.h >= 4 && rnd() < 0.4) {
        const vert = rnd() < 0.5, l = int(2, 3);
        const x = int(r.x + 1, r.x + r.w - 2), y = int(r.y + 1, r.y + r.h - 2);
        for (let i = 0; i < l; i++) vert ? y + i < r.y + r.h - 1 && wall(x, y + i) : x + i < r.x + r.w - 1 && wall(x + i, y);
      }
      return;
    }
    const vert = r.w > r.h || (r.w === r.h && rnd() < 0.5);
    const s = vert ? int(r.x + 3, r.x + r.w - 4) : int(r.y + 3, r.y + r.h - 4);
    if (vert) {
      for (let y = r.y; y < r.y + r.h; y++) wall(s, y);
      office({ x: r.x, y: r.y, w: s - r.x, h: r.h }, depth + 1);
      office({ x: s + 1, y: r.y, w: r.x + r.w - s - 1, h: r.h }, depth + 1);
      door(true, s, r.y, r.y + r.h - 1, rnd() < 0.7 ? 1 : 2);
    } else {
      for (let x = r.x; x < r.x + r.w; x++) wall(x, s);
      office({ x: r.x, y: r.y, w: r.w, h: s - r.y }, depth + 1);
      office({ x: r.x, y: s + 1, w: r.w, h: r.y + r.h - s - 1 }, depth + 1);
      door(false, s, r.x, r.x + r.w - 1, rnd() < 0.7 ? 1 : 2);
    }
  };
  const hall = (r: Rect, per = 40) => {
    // sala grande: casi vacía, con algún tabique y alguna columna sueltos (uno cada `per` celdas)
    const k = Math.round(area(r) / per);
    for (let i = 0; i < k; i++) {
      const x = int(r.x + 2, r.x + r.w - 3), y = int(r.y + 2, r.y + r.h - 3);
      if (rnd() < 0.5) wall(x, y);
      else {
        const vert = rnd() < 0.5, l = int(2, 4);
        for (let q = 0; q < l; q++) vert ? y + q < r.y + r.h - 2 && wall(x, y + q) : x + q < r.x + r.w - 2 && wall(x + q, y);
      }
    }
  };

  // sala de pozos: suelo con una rejilla de fosos de 3×3 celdas separados por pasarelas de una (r.w y r.h = 4k+1:
  // el borde y cada cuarta fila quedan de suelo y todo se alcanza). `bridge`: un campo de fosos con un puente en cruz
  const pitGrid = (r: Rect, bridge: boolean) => {
    for (let y = r.y + 1; y < r.y + r.h - 1; y++)
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        const ox = x - r.x, oy = y - r.y;
        const hole = bridge ? ox >= 2 && ox <= r.w - 3 && oy >= 2 && oy <= r.h - 3 && ox !== r.w >> 1 && oy !== r.h >> 1 : ox % 4 !== 0 && oy % 4 !== 0;
        if (hole) gridVoids.push({ x, y });
      }
  };
  // cubículos: filas de tabiques cada dos celdas contra un muro de fondo, de dos en dos (abiertos a un pasillo de 2 celdas)
  const cubicles = (r: Rect) => {
    for (let y0 = r.y + 1; y0 + 5 <= r.y + r.h - 2; y0 += 6)
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        const part = (x - r.x - 1) % 2 === 0;
        for (const [wy, py, side] of [[y0, y0 + 1, 3], [y0 + 5, y0 + 4, 2]] as const) {
          wall(x, wy);
          if (part) wall(x, py);
          else nooks.push({ cell: { x, y: py }, side, kind: 'desk' });
        }
      }
  };

  // 1. las salas: una enorme cerca del centro y el resto repartidas sin pisarse (a una celda de pared unas de otras,
  // o con un pasillo de por medio)
  const rooms: Rect[] = [];
  const sep = (a: Rect, b: Rect, pad: number) => a.x - pad >= b.x + b.w || b.x - pad >= a.x + a.w || a.y - pad >= b.y + b.h || b.y - pad >= a.y + a.h;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const bw = int(14, 17), bh = int(11, 13);
  rooms.push({ x: clamp(((n - bw) >> 1) + int(-3, 3), 1, n - 1 - bw), y: clamp(((n - bh) >> 1) + int(-3, 3), 1, n - 1 - bh), w: bw, h: bh });
  let filled = bw * bh;
  // las salas de pozos (una o dos), de lados impares
  const pits = new Set<number>();
  for (let k = 0; k < 1; k++)
    for (let i = 0; i < 80; i++) {
      let rw = 4 * int(3, 4) + 1, rh = 4 * int(2, 3) + 1;
      if (rnd() < 0.5) [rw, rh] = [rh, rw];
      const r = { x: int(1, n - 1 - rw), y: int(1, n - 1 - rh), w: rw, h: rh };
      if (!rooms.every((o) => sep(r, o, 2))) continue;
      pits.add(rooms.length);
      rooms.push(r);
      filled += area(r);
      break;
    }
  for (let i = 0; i < 700 && filled < 0.5 * (n - 2) * (n - 2); i++) {
    let rw = int(8, 15), rh = int(6, 11);
    if (rnd() < 0.5) [rw, rh] = [rh, rw];
    const r = { x: int(1, n - 1 - rw), y: int(1, n - 1 - rh), w: rw, h: rh }, pad = rnd() < 0.55 ? 1 : int(3, 5);
    if (!rooms.every((o) => sep(r, o, pad))) continue;
    rooms.push(r);
    filled += area(r);
  }
  const roomLit: number[] = [], roomZone: number[] = [];
  rooms.forEach((r, i) => {
    fill(r, 1);
    const huge = i === 0 || (r.w >= 18 && r.h >= 14);
    let z: number = ZONE.none;
    if (pits.has(i)) {
      pitGrid(r, rnd() < 0.3);
      z = ZONE.pits;
    } else {
      // en L: se le quita una esquina
      if (!huge && r.w >= 11 && r.h >= 9 && rnd() < 0.2) {
        const cw = int((r.w * 0.35) | 0, (r.w * 0.5) | 0), ch = int((r.h * 0.35) | 0, (r.h * 0.5) | 0);
        fill({ x: rnd() < 0.5 ? r.x : r.x + r.w - cw, y: rnd() < 0.5 ? r.y : r.y + r.h - ch, w: cw, h: ch }, 0);
      }
      const hallZ = (f: () => void) => () => (f(), (z = ZONE.hall));
      const office_ = () => (office(r), (z = ZONE.office));
      const cub = () => (cubicles(r), (z = ZONE.cubicles));
      if (huge) pick([hallZ(() => pillars(r, 4)), hallZ(() => (pillars(r, 4), hall(r, 90))), hallZ(() => pillars(r, 5)), hallZ(() => hall(r, 60))])();
      else {
        // el resto: según el tamaño, de todo un poco (se reconocen por la forma y por el tono de la luz)
        const opts: (() => unknown)[] = [hallZ(() => pillars(r)), hallZ(() => hall(r, 25)), office_];
        if (area(r) >= 12 * 9) opts.push(hallZ(() => pillars(r, 4)), hallZ(() => (pillars(r, 4), hall(r, 70))));
        if (r.w >= 7 && r.h >= 8) opts.push(cub, cub, cub);
        pick(opts)();
      }
    }
    // zonas apagadas: pocas y solo en salas pequeñas
    roomLit.push(z === ZONE.pits || rnd() < (area(r) >= 70 ? 0.97 : 0.85) ? 1 : 0);
    roomZone.push(z);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        lit[at(x, y)] = roomLit[i];
        zone[at(x, y)] = z;
      }
  });

  // 2. las uniones: un árbol (para que todas se alcancen), algunos ciclos y alguna recta larga; entre salas
  // contiguas, una abertura amplia (3–6 celdas); si no, un pasillo de 1–2
  const ctr = (r: Rect) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
  const gapOf = (a: Rect, b: Rect) => Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)) + Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  const carve = (x: number, y: number, on: number) => {
    if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) return;
    if (!open[at(x, y)]) lit[at(x, y)] = on;
    open[at(x, y)] = 1;
  };
  const link = (ia: number, ib: number, wide = true) => {
    const a = rooms[ia], b = rooms[ib], on = roomLit[ia];
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w), y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
    const vertical = x1 - x0 >= 3, horizontal = y1 - y0 >= 3;
    if (vertical || horizontal) {
      // una al lado de la otra: una abertura recta por el hueco que las separa
      const [lo, hi] = vertical ? (a.y < b.y ? [a, b] : [b, a]) : a.x < b.x ? [a, b] : [b, a];
      const from = vertical ? lo.y + lo.h : lo.x + lo.w, to = vertical ? hi.y : hi.x; // celdas [from, to) del hueco
      const span0 = vertical ? x0 : y0, span1 = vertical ? x1 : y1, g = to - from;
      const ww = Math.min(span1 - span0, g <= 2 && wide ? int(3, 6) : rnd() < 0.3 ? 2 : 1);
      const ok: number[] = [];
      for (let i = span0; i + ww <= span1; i++) {
        let good = true;
        for (let k = 0; k < ww && good; k++) good = vertical ? !!open[at(i + k, from - 1)] && !!open[at(i + k, to)] : !!open[at(from - 1, i + k)] && !!open[at(to, i + k)];
        if (good) ok.push(i);
      }
      if (ok.length) {
        const i = pick(ok);
        for (let k = 0; k < ww; k++) for (let q = from; q < to; q++) vertical ? carve(i + k, q, on) : carve(q, i + k, on);
        return;
      }
    }
    // en diagonal (o sin sitio): un pasillo en L de centro a centro
    const ca = ctr(a), cb = ctr(b), ww = rnd() < 0.5 ? 2 : 1;
    const hline = (xa: number, xb: number, y: number) => {
      for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) for (let k = 0; k < ww; k++) carve(x, y + k, on);
    };
    const vline = (ya: number, yb: number, x: number) => {
      for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) for (let k = 0; k < ww; k++) carve(x + k, y, on);
    };
    if (rnd() < 0.5) (hline(ca.x, cb.x, ca.y), vline(ca.y, cb.y, cb.x));
    else (vline(ca.y, cb.y, ca.x), hline(ca.x, cb.x, cb.y));
  };
  const pairs: [number, number][] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) pairs.push([i, j]);
  const dd = (p: [number, number]) => {
    const a = ctr(rooms[p[0]]), b = ctr(rooms[p[1]]);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  pairs.sort((p, q) => dd(p) - dd(q));
  const grp = rooms.map((_, i) => i);
  const find = (i: number): number => (grp[i] === i ? i : (grp[i] = find(grp[i])));
  const linked = new Set<number>();
  for (const [i, j] of pairs) {
    const adj = gapOf(rooms[i], rooms[j]) <= 6;
    if (find(i) !== find(j)) (grp[find(i)] = find(j)), linked.add(i * rooms.length + j), link(i, j);
    else if ((adj && rnd() < 0.7) || (dd([i, j]) < 30 && rnd() < 0.15)) linked.add(i * rooms.length + j), link(i, j);
  }
  // alguna recta larga: dos salas alineadas con nada en medio, y un pasillo de una a otra
  for (const [i, j] of shuffle(pairs.filter(([i, j]) => !linked.has(i * rooms.length + j) && gapOf(rooms[i], rooms[j]) >= 9))) {
    const a = rooms[i], b = rooms[j];
    const bx0 = Math.max(a.x, b.x), bx1 = Math.min(a.x + a.w, b.x + b.w), by0 = Math.max(a.y, b.y), by1 = Math.min(a.y + a.h, b.y + b.h);
    const band: Rect | null =
      bx1 - bx0 >= 3 ? { x: bx0, y: Math.min(a.y, b.y), w: bx1 - bx0, h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }
      : by1 - by0 >= 3 ? { x: Math.min(a.x, b.x), y: by0, w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: by1 - by0 }
      : null;
    if (!band || rooms.some((o, k) => k !== i && k !== j && !sep(o, band, 0))) continue;
    link(i, j, false);
    break;
  }

  // el inicio: el suelo más cerca de la esquina (no un foso); lo que no se alcanza desde él se tapia
  const isPit = new Set(gridVoids.map((c) => at(c.x, c.y)));
  let start: Cell = { x: 1, y: 1 };
  for (let s = 2; s < w + h; s++) {
    const c = Array.from({ length: s - 1 }, (_, i) => ({ x: 1 + i, y: s - 1 - i })).find((c) => c.x < w - 1 && c.y < h - 1 && open[at(c.x, c.y)] && zone[at(c.x, c.y)] !== ZONE.pits);
    if (c) {
      start = c;
      break;
    }
  }
  const m = { w, h, open };
  const d0 = bfs(m, start);
  for (let i = 0; i < w * h; i++) if (open[i] && d0[i] < 0) open[i] = 0;

  const nOpen = (c: Cell) => DIRS.filter(([dx, dy]) => open[at(c.x + dx, c.y + dy)]).length;
  const near = (a: Cell, b: Cell, k: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < k;

  // el ascensor: un nicho de una celda abierto en una pared, lo más lejos posible del inicio, con
  // pared a sus otros tres lados (la cabina)
  let elevator: Cell = start, best = -1;
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      if (open[at(x, y)]) continue;
      const opens = DIRS.filter(([dx, dy]) => open[at(x + dx, y + dy)]);
      if (opens.length !== 1) continue;
      const [dx, dy] = opens[0], o = d0[at(x + dx, y + dy)];
      if (o < 0 || zone[at(x + dx, y + dy)] === ZONE.pits) continue;
      if (o > best) (best = o), (elevator = { x, y });
    }
  open[at(elevator.x, elevator.y)] = 1;
  lit[at(elevator.x, elevator.y)] = 1;

  const cells: Cell[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (open[at(x, y)] && !(x === elevator.x && y === elevator.y)) cells.push({ x, y });
  const total = cells.length + 1;
  const reach = (blocked: Set<number>) => bfs(m, start, blocked).reduce((s, v) => s + (v >= 0 ? 1 : 0), 0);

  // huecos al vacío: en sitios abiertos (4 vecinos) y lejos del inicio y del ascensor, sin desconectar nada
  const blocked = new Set<number>(isPit), voids: Cell[] = [...gridVoids];
  for (const c of shuffle([...cells])) {
    if (voids.length - gridVoids.length >= 2 + ((seed >>> 3) & 1) * 2) break;
    if (zone[at(c.x, c.y)] === ZONE.pits) continue;
    // en pleno suelo (los ocho vecinos abiertos: en una sala, no en un pasillo)
    if (nOpen(c) < 4 || !open[at(c.x + 1, c.y + 1)] || !open[at(c.x - 1, c.y - 1)] || !open[at(c.x + 1, c.y - 1)] || !open[at(c.x - 1, c.y + 1)]) continue;
    if (near(c, start, 10) || near(c, elevator, 6) || voids.some((v) => near(v, c, 10))) continue;
    blocked.add(at(c.x, c.y));
    if (reach(blocked) === total - blocked.size) voids.push(c);
    else blocked.delete(at(c.x, c.y));
  }

  const d = bfs(m, start, blocked);
  const free = cells.filter((c) => !blocked.has(at(c.x, c.y)) && !(c.x === start.x && c.y === start.y) && d[at(c.x, c.y)] > 0);
  const used = new Set<number>([at(start.x, start.y), at(elevator.x, elevator.y)]);
  const take = (c: Cell) => (used.add(at(c.x, c.y)), c);
  const dist = (c: Cell) => d[at(c.x, c.y)];
  const camera = take(pick(free.filter((c) => dist(c) >= 6 && dist(c) <= 12)) ?? free[0]);
  // las cintas, repartidas por todo el mapa: cada una donde más lejos queda, andando, de las demás y de
  // la cámara (con algo de azar para que no salgan siempre en las mismas puntas)
  const tapes: Cell[] = [];
  const cand = shuffle(free.filter((c) => !used.has(at(c.x, c.y)) && dist(c) >= 8 && !near(c, elevator, 6)));
  const gap = new Float32Array(m.w * m.h).fill(Infinity);
  const mark = (c: Cell) => bfs(m, c, blocked).forEach((v, i) => v >= 0 && v < gap[i] && (gap[i] = v));
  mark(camera);
  while (tapes.length < 8 && cand.length) {
    let bi = 0, bs = -1;
    cand.forEach((c, i) => {
      const s = gap[at(c.x, c.y)] * (0.8 + rnd() * 0.4);
      if (s > bs) (bs = s), (bi = i);
    });
    const c = take(cand.splice(bi, 1)[0]);
    tapes.push(c);
    mark(c);
  }
  // la pistola, a veces, en un rincón (dos paredes al lado) lejos del inicio
  const corners = free.filter((c) => nOpen(c) <= 2 && dist(c) >= 14 && !used.has(at(c.x, c.y)));
  const pistol = rnd() < 0.5 && corners.length ? take(pick(corners)) : null;
  // los arranques de las entidades: lejos del inicio y separados entre sí
  const spawns: Cell[] = [];
  for (const c of [...free].sort((a, b) => dist(b) - dist(a))) {
    if (spawns.length === 8) break;
    if (dist(c) < 14 || used.has(at(c.x, c.y)) || near(c, elevator, 3) || spawns.some((s) => near(s, c, 9))) continue;
    spawns.push(c);
  }
  // los fluorescentes: uno cada dos celdas (3 m) en las zonas encendidas, uno de cada nueve fundido
  const lamps = cells.filter((c) => hasPanel({ w, zone }, c.x, c.y) && lit[at(c.x, c.y)] && rnd() > (zone[at(c.x, c.y)] === ZONE.pits ? 1 / 30 : 1 / 14));
  // detalles: rejillas en el techo, enchufes y puertas falsas en las paredes, sillones en las salas
  const props: Maze['props'] = [];
  const wallSide = (c: Cell) => DIRS.findIndex(([dx, dy]) => !open[at(c.x + dx, c.y + dy)]);
  for (const c of free) {
    const r = rnd();
    if (used.has(at(c.x, c.y))) continue;
    if (r < 0.025 && c.x % 2 && c.y % 2) props.push({ cell: c, kind: 'vent', rot: 0 });
    else if (r < 0.05 && wallSide(c) >= 0) props.push({ cell: c, kind: 'socket', rot: wallSide(c) });
    else if (r < 0.058 && wallSide(c) >= 0) props.push({ cell: c, kind: 'door', rot: wallSide(c) });
    else if (r >= 0.058 && r < 0.066 && nOpen(c) === 4 && zone[at(c.x, c.y)] !== ZONE.pits) props.push({ cell: c, kind: 'armchair', rot: (rnd() * 4) | 0 });
  }
  // el mobiliario, por zonas, contra la pared (`rot` = lado de la pared): cubículos con mesa, silla y tele o lámpara, archivadores en las
  // oficinas, estantes en las naves de estantería y algo suelto en el resto. Nunca sobre objetos, arranques ni fosos, ni en pasillos.
  const spawnAt = new Set(spawns.map((c) => at(c.x, c.y)));
  const taken = new Set(props.map((p) => at(p.cell.x, p.cell.y)));
  const okCell = (c: Cell) => open[at(c.x, c.y)] && !used.has(at(c.x, c.y)) && !spawnAt.has(at(c.x, c.y)) && !blocked.has(at(c.x, c.y)) && !taken.has(at(c.x, c.y));
  const put = (c: Cell, kind: PropKind, rot: number) => (props.push({ cell: c, kind, rot }), taken.add(at(c.x, c.y)));
  const desk = (c: Cell, side: number) => {
    put(c, 'desk', side);
    const k = rnd();
    if (k < 0.45) props.push({ cell: c, kind: 'crt', rot: side });
    if (k < 0.8) props.push({ cell: c, kind: rnd() < 0.5 ? 'chair' : 'chair2', rot: (rnd() * 4) | 0 });
  };
  for (const q of nooks) if (okCell(q.cell) && rnd() < 0.7) desk(q.cell, q.side);
  for (const c of free) {
    const z = zone[at(c.x, c.y)], side = wallSide(c), r = rnd();
    if (side < 0 || nOpen(c) < 3 || z === ZONE.pits || z === ZONE.cubicles || !okCell(c)) continue;
    if (r > 0.97) desk(c, side), taken.add(at(c.x, c.y));
  }
  // las linternas sueltas: una no muy lejos del inicio (para ver pronto que se gastan) y el resto repartidas por el mapa
  const flashlights: Cell[] = [];
  const spare = shuffle(free.filter((c) => !used.has(at(c.x, c.y))));
  const first = spare.find((c) => dist(c) >= 8 && dist(c) <= 18);
  if (first) flashlights.push(take(first));
  for (const c of spare) {
    if (flashlights.length >= 6) break;
    if (used.has(at(c.x, c.y)) || flashlights.some((l) => near(l, c, 10))) continue;
    flashlights.push(take(c));
  }
  // los escondites: nichos de una celda en una pared lisa (a los lados de su boca, suelo), uno por cada ~125 celdas,
  // lejos del inicio, del ascensor y de los huecos, y separados entre sí. El nicho sigue siendo pared en `open`.
  const hides: Maze['hides'] = [];
  const mouths: { c: Cell; side: number }[] = [];
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      if (open[at(x, y)]) continue;
      const sides = [0, 1, 2, 3].filter((i) => open[at(x + DIRS[i][0], y + DIRS[i][1])]);
      if (sides.length !== 1) continue;
      const side = sides[0], [dx, dy] = DIRS[side], mx = x + dx, my = y + dy;
      if (!open[at(mx - dy, my + dx)] || !open[at(mx + dy, my - dx)] || blocked.has(at(mx, my)) || d[at(mx, my)] < 0) continue;
      const m0 = { x: mx, y: my };
      if (near(m0, start, 12) || near(m0, elevator, 10) || voids.some((v) => near(v, m0, 4)) || used.has(at(mx, my)) || props.some((p) => p.cell.x === mx && p.cell.y === my)) continue;
      mouths.push({ c: { x, y }, side });
    }
  for (const k of shuffle(mouths)) {
    if (hides.length >= Math.max(3, Math.round(cells.length / 100))) break;
    if (hides.every((q) => !near(q.cell, k.c, 12))) hides.push({ cell: k.c, side: k.side });
  }
  // la salida: el cartel encima del ascensor, en su lado abierto
  props.push({ cell: elevator, kind: 'exit', rot: DIRS.findIndex(([dx, dy]) => open[at(elevator.x + dx, elevator.y + dy)]) });
  return { w, h, open, lit, zone, voids, start, elevator, camera, pistol, extraGuns: [], tapes, flashlights, spawns, lamps, props, hides, rooms: rooms.map((r, i) => ({ ...r, zone: roomZone[i] })) };
}

/**
 * El mapa de una semilla, del tamaño justo para una partida de ≤ 10 min: el recorrido bueno
 * (inicio → cámara → cintas → ascensor) mide 240–400 celdas (360–600 m, unos 3–5 min entre andar y
 * correr; con lo que se busca, se pierde y se esquiva, 7–10).
 */
export function generateMaze(seed: number, players = 1): Maze {
  const m = base(seed);
  supply(m, seed, players);
  return m;
}

/**
 * Los recursos del suelo para una sala: un jugador se apaña con lo de siempre (el mapa de la semilla no cambia);
 * con más, hay 2 linternas más por jugador extra y un rifle por cada dos. Se reparten por el mapa, lejos unos de otros.
 */
function supply(m: Maze, seed: number, players: number) {
  if (players <= 1) return;
  const rnd = mulberry32(seed ^ 0x9e3779b9), used = new Set<number>();
  const key = (c: Cell) => c.y * m.w + c.x;
  [m.start, m.elevator, m.camera, ...(m.pistol ? [m.pistol] : []), ...m.tapes, ...m.flashlights, ...m.voids, ...m.props.map((p) => p.cell)].forEach((c) => used.add(key(c)));
  const spare: Cell[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.open[y * m.w + x] && !used.has(y * m.w + x)) spare.push({ x, y });
  for (let i = spare.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [spare[i], spare[j]] = [spare[j], spare[i]];
  }
  const near = (a: Cell, b: Cell, k: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < k;
  const placed: Cell[] = [...m.flashlights];
  const put = (list: Cell[], n: number) => {
    for (const c of spare) {
      if (list.length >= n) break;
      if (used.has(key(c)) || near(c, m.start, 4) || placed.some((p) => near(p, c, 8))) continue;
      used.add(key(c));
      placed.push(c);
      list.push(c);
    }
  };
  put(m.flashlights, 6 + 2 * (players - 1));
  if (m.pistol) {
    const extra: Cell[] = [];
    put(extra, Math.ceil(players / 2) - 1);
    m.extraGuns = extra;
  }
}

/** Lo que mide el recorrido bueno (celdas): partidas de 7–10 min. */
const ROUTE = [160, 270] as const;
/** Rejilla más pequeña y más grande (celdas de lado): las salas abiertas piden más sitio para el mismo recorrido. */
const N_MIN = 38, N_MAX = 60;
function base(seed: number): Maze {
  let n = 46, best: Maze | undefined, bestErr = Infinity;
  for (let i = 0; i < 8; i++) {
    const m = build(seed, n), len = routeLength(m);
    const err = len < ROUTE[0] ? ROUTE[0] - len : len > ROUTE[1] ? len - ROUTE[1] : 0;
    if (err < bestErr && m.tapes.length === 8 && m.spawns.length >= 2) (best = m), (bestErr = err);
    if (!err) break;
    n = Math.max(N_MIN, Math.min(N_MAX, n + (len < ROUTE[0] ? 4 : -4)));
  }
  return best ?? build(seed, 46);
}
