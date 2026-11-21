/*
 * Las Suites (nivel -20), planta base: un pasillo de hotel con suites a los dos lados, hecho con las mismas piezas del laberinto (`Maze`),
 * así que el mundo, el servidor y los objetos (itemSpots, tótem, botín) lo usan tal cual. Ver docs/suites.md.
 *
 * El mapa es PERIÓDICO a lo largo del pasillo (eje x): `L` celdas se repiten `COPIES` veces con exactamente lo mismo (suites, puertas, ascensores).
 * Como la niebla llega a 19 m y `L` mide 30 m, quien camina hacia un lado puede saltar `L` celdas hacia atrás sin que se note (`wrapX`): el cliente
 * lo hace al pasar de la copia del medio. Solo lo ÚNICO (el ascensor de verdad, los objetos) está en la copia del medio; las demás copias llevan
 * ascensores de adorno. Una planta: cada suite es de 4×6 celdas, el pasillo de 2 (3 m).
 */
import { CELL, type Cell, type Maze } from './maze';

/** Celdas de una copia (4 suites por lado) y copias del mapa. */
export const SUITE_L = 16;
export const SUITE_COPIES = 3;
export const SUITE_UNIT = 4;
const UNIT = SUITE_UNIT; // una suite: 3 de interior (4,5 m) + 1 de tabique; 6 de fondo (9 m)
const CW = SUITE_L * SUITE_COPIES, W = CW + 13, H = 44; // CW: el pasillo (las copias); detrás, la puerta doble (columna CW) y el vestíbulo (12 columnas), fuera del bucle
// (las filas 18-35 son los conductos de ventilación —un laberinto— y las 36-42 la sala de videovigilancia, solo en la copia del medio; ver `vents`)
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
// filas: 0 pared · 1-6 suites norte · 7 puertas · 8-9 pasillo · 10 puertas (y ascensores) · 11-16 suites sur · 17 pared
const NORTH = { back: 1, door: 7, rot: 2, wall: 3 }, SOUTH = { back: 16, door: 10, rot: 3, wall: 2 }; // `rot`: hacia el pasillo; `wall`: hacia la pared del fondo

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** El salto que da el que camina: devuelve la x (en metros) metida en la copia del medio. */
export const wrapX = (x: number) => {
  const span = SUITE_L * CELL;
  return x < span ? x + span : x >= 2 * span && x < 3 * span ? x - span : x; // (pasado el pasillo, el vestíbulo no se envuelve)
};

/** Plantas de Las Suites: se sube de una en una; al llegar a la última se vuelve a empezar. */
export const SUITE_FLOORS = 5;
/** Probabilidad de que el ascensor falle y caiga a la planta 1. */
export const SUITE_FALL = 0.1;
export function suitesMaze(seed: number, floor = 1): Maze {
  const rnd = mulberry32(seed ^ 0x5017e5), int = (n: number) => (rnd() * n) | 0;
  const open = new Uint8Array(W * H), at = (x: number, y: number) => y * W + x;
  const cell = (x: number, y: number): Cell => ({ x, y });
  const props: Maze['props'] = [], rooms: Maze['rooms'] = [];
  // las suites de slot impar están abiertas (se entra: botín y escondites); las demás, con puerta cerrada, son pared por ahora
  const ajar = (_slot: number) => true; // todas las suites son habitaciones de verdad, con su puerta que se abre
  for (let x = 0; x < CW; x++) {
    for (const y of [8, 9]) open[at(x, y)] = 1;
    if (x % UNIT === 0) continue;
    for (let y = 1; y <= 6; y++) open[at(x, y)] = 1;
    for (let y = 11; y <= 16; y++) open[at(x, y)] = 1;
    if (x % UNIT === 2) for (const y of [7, 10]) open[at(x, y)] = 1;
  }
  // el vestíbulo (fuera del bucle: se entra al empezar la ronda): un salón al este del pasillo, y la puerta doble en la columna CW, filas 8-9
  for (const y of [8, 9]) open[at(CW, y)] = 1;
  for (let y = 4; y <= 13; y++) for (let x = CW + 1; x < W; x++) open[at(x, y)] = 1;
  // el vestíbulo: el mostrador con el Faceling al norte (mirando al sur), salas de estar al este y plantas en las esquinas; la puerta doble al oeste
  {
    const X0 = (CW + 1) * CELL, lp = (kind: Maze['props'][number]['kind'], X: number, Z: number, face: number) => {
      const cx = Math.floor(X / CELL), cy = Math.floor(Z / CELL);
      props.push({ cell: cell(cx, cy), kind, rot: face, off: [X - (cx + 0.5) * CELL, Z - (cy + 0.5) * CELL] });
    };
    props.push({ cell: cell(CW, 8), kind: 'grandoor', rot: 0 }, { cell: cell(CW, 9), kind: 'grandoor', rot: 0 }); // (dos hojas, una por celda, hacia el salón)
    rooms.push({ x: CW + 1, y: 4, w: 12, h: 10, zone: 0 });
    lp('reception', X0 + 9, 7.6, 2);
    lp('sofa', X0 + 17.0, 10.5, 1), lp('sofa', X0 + 17.0, 16.0, 1), lp('wingchair', X0 + 17.1, 13.2, 1), lp('bistro', X0 + 15.6, 13.2, 1);
    lp('sofa', X0 + 1.0, 7.4, 0), lp('wingchair', X0 + 1.1, 9.4, 0), lp('bistro', X0 + 2.3, 8.4, 0);
    for (const [px, pz] of [[0.5, 6.9], [17.5, 6.9], [0.5, 20.1], [17.5, 20.1], [9, 20.1]]) lp('plant', X0 + px, pz, 2);
  }
  // el ascensor: un callejón de una celda detrás de la puerta sur del primer hueco de cada copia; el de verdad, el de la copia del medio
  const elevator = cell(SUITE_L + 2, 10);
  for (let k = 0; k < SUITE_COPIES; k++) {
    const c = cell(k * SUITE_L + 2, 10);
    open[at(c.x, c.y)] = 1;
    props.push({ cell: c, kind: 'exit', rot: 3 });
  }
  // los conductos de ventilación: un laberinto de chapa bajo el hotel (solo en la copia del medio: `wrapX` no lo toca), con fugas de gas y, al fondo, la sala de
  // videovigilancia. Cada suite tiene una rejilla que lleva a una de sus 7 entradas (por la parte de arriba del laberinto). Un laberinto de verdad: 7 × 8 nudos,
  // casi sin atajos (callejones sin salida por todas partes) y la salida al fondo, en el nudo más lejano de cualquier entrada.
  const vents: NonNullable<Maze['vents']> = [], gas: Cell[] = [], fans: Cell[] = [], rv = mulberry32(seed ^ 0xbe47), VX = SUITE_L + 1, VY = 20, NX = 7, NY = 8;
  const YAW = [-Math.PI / 2, Math.PI / 2, Math.PI, 0]; // yaw de quien mira hacia DIRS[i]
  const node = (i: number, j: number) => cell(VX + 2 * i, VY + 2 * j);
  const RY = VY + 2 * NY - 1; // la fila de paso a la sala (la 35)
  let exitI = 0, roomX = VX;
  {
    const seen = new Set<number>(), stack: [number, number][] = [[0, 0]], idx = (i: number, j: number) => j * NX + i, adj: number[][] = Array.from({ length: NX * NY }, () => []);
    const link = (i: number, j: number, a: number, b: number) => (adj[idx(i, j)].push(idx(a, b)), adj[idx(a, b)].push(idx(i, j)));
    open[at(node(0, 0).x, node(0, 0).y)] = 1;
    seen.add(0);
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      // (casi siempre sigue recto: pasillos largos y retorcidos, no un enjambre de esquinas)
      const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([a, b]) => [i + a, j + b, a, b] as const).filter(([a, b]) => a >= 0 && b >= 0 && a < NX && b < NY && !seen.has(idx(a, b)));
      if (!next.length) { stack.pop(); continue; }
      const [a, b] = next[(rv() * next.length) | 0], n = node(a, b), m = node(i, j);
      open[at(n.x, n.y)] = open[at((n.x + m.x) / 2, (n.y + m.y) / 2)] = 1;
      link(i, j, a, b);
      seen.add(idx(a, b));
      stack.push([a, b]);
    }
    // dos atajos nada más: el laberinto casi no tiene vueltas
    for (let k = 0; k < 2; k++) {
      const i = (rv() * (NX - 1)) | 0, j = 1 + ((rv() * (NY - 1)) | 0), a = node(i, j);
      if (!open[at(a.x + 1, a.y)]) (open[at(a.x + 1, a.y)] = 1), link(i, j, i + 1, j);
    }
    // la salida, en el nudo del fondo más lejos de cualquier entrada
    const dist = new Array(NX * NY).fill(-1), q: number[] = [];
    for (let i = 0; i < NX; i++) (dist[idx(i, 0)] = 0), q.push(idx(i, 0));
    for (let h = 0; h < q.length; h++) for (const n of adj[q[h]]) if (dist[n] < 0) ((dist[n] = dist[q[h]] + 1), q.push(n));
    for (let i = 0; i < NX; i++) if (dist[idx(i, NY - 1)] > dist[idx(exitI, NY - 1)]) exitI = i;
    const last = node(exitI, NY - 1);
    open[at(last.x, RY)] = 1;
    // la sala de videovigilancia: pequeña y compacta, 8 × 5 celdas (filas 36-40), de hormigón y alta
    roomX = Math.max(VX, Math.min(VX + 14 - 8, last.x - 3));
    for (let y = RY + 1; y <= RY + 5; y++) for (let x = roomX; x < roomX + 8; x++) open[at(x, y)] = 1;
    // los callejones sin salida llevan un ventilador en el fondo
    for (let y = VY + 2; y < RY; y++)
      for (let x = VX; x < VX + 13; x++) {
        const nb = DIR4.filter(([dx, dy]) => open[at(x + dx, y + dy)]).length;
        if (open[at(x, y)] && nb === 1 && rv() < 0.55) fans.push(cell(x, y));
      }
    // las fugas: unas pocas nubes de 1-2 celdas en el laberinto (nunca en la entrada ni cerca de la salida); si una cierra el único camino de una entrada, no se pone
    const reach = (): boolean => {
      const bad = new Set(gas.map((c) => at(c.x, c.y))), goal = at(last.x, RY);
      return Array.from({ length: NX }, (_, i) => at(node(i, 0).x, VY)).every((s0) => {
        if (bad.has(s0)) return false;
        const seenC = new Set([s0]), st = [s0];
        while (st.length) {
          const c = st.pop()!;
          if (c === goal) return true;
          for (const [dx, dy] of DIR4) {
            const n = c + dy * W + dx;
            if (open[n] && !bad.has(n) && !seenC.has(n) && n >= VY * W && n < (RY + 1) * W) (seenC.add(n), st.push(n));
          }
        }
        return false;
      });
    };
    for (let k = 0, tries = 0; k < 6 && tries < 80; tries++) {
      const x = VX + ((rv() * 13) | 0), y = VY + 3 + ((rv() * (RY - VY - 6)) | 0);
      if (!open[at(x, y)] || (x === last.x && y > RY - 5)) continue;
      const add = [cell(x, y), ...DIR4.map(([dx, dy]) => cell(x + dx, y + dy)).filter((c) => open[at(c.x, c.y)] && c.y >= VY + 3 && c.y < RY - 2 && rv() < 0.45)];
      gas.push(...add);
      if (reach()) k++;
      else gas.splice(gas.length - add.length, add.length);
    }
  }
  const ventIn = Array.from({ length: NX }, (_, i) => ({ x: (node(i, 0).x + 0.5) * CELL, z: (node(i, 0).y + 0.5) * CELL, yaw: Math.PI })), ventBack: ({ x: number; z: number; yaw: number } | undefined)[] = [];
  // las suites: el mismo moblaje en las de cada posición de cada copia (por el hueco, no por la copia), así el bucle es perfecto.
  // Cada una es una suite de hotel de verdad: cama contra el fondo, sofá y escritorio con espejo en las paredes de los lados, maleta, planta y papelera.
  // `t` son metros desde la pared del fondo hacia la puerta; las piezas se ponen por metros (`off`) y miran hacia donde `rot` (índice de DIRS).
  const hides: Maze['hides'] = [];
  const free: Cell[] = [], reserve = new Set<number>(), gens: Cell[] = [];
  // los cuadros eléctricos: escondidos en dos suites al azar (la misma en las tres copias; el de verdad, el de la copia del medio)
  const rg = mulberry32(seed ^ 0x6e6e), g0 = (rg() * 6) | 0, g1 = (g0 + 1 + ((rg() * 5) | 0)) % 6;
  for (let k = 0; k < SUITE_COPIES; k++)
    for (const [side, R] of [[0, NORTH], [1, SOUTH]] as const)
      for (let slot = 0; slot < 4; slot++) {
        const x0 = k * SUITE_L + slot * UNIT;
        if (side && slot === 0) continue;
        if (!side && slot === 0) {
          // la escalera de servicio (solo personal): de hormigón, tras una puerta de acero justo enfrente del ascensor; sube por la izquierda y baja por la derecha
          props.push({ cell: cell(x0 + 2, 3), kind: 'stairs', rot: 3 }, { cell: cell(x0 + 2, R.door), kind: 'steeldoor', rot: R.rot }); // (detrás de una puerta de acero)
          rooms.push({ x: x0 + 1, y: 1, w: 3, h: 6, zone: 0 });
          continue;
        }
        if (!ajar(slot)) {
          props.push({ cell: cell(x0 + 2, R.door + (side ? -1 : 1)), kind: 'suitedoor', rot: R.wall }); // la puerta cerrada, en la cara de la pared que da al pasillo
          continue;
        }
        const row = (d: number) => R.back + (side ? -d : d); // d filas desde el fondo hacia el pasillo
        rooms.push({ x: x0 + 1, y: Math.min(row(0), row(5)), w: 3, h: 6, zone: 0 });
        props.push({ cell: cell(x0 + 2, R.door), kind: 'door', rot: R.rot });
        const wallZ = side ? (R.back + 1) * CELL : R.back * CELL, inward = side ? 3 : 2, Xw = (x0 + 1) * CELL, Xe = (x0 + 4) * CELL, Xc = (x0 + 2.5) * CELL;
        const zAt = (t: number) => (side ? wallZ - t : wallZ + t);
        /** Una pieza en (X, t) mirando hacia `face` (DIRS), reservando las celdas que cubre `cover` (metros a cada lado). */
        const put = (kind: Maze['props'][number]['kind'], X: number, t: number, face: number, cover = 0) => {
          const Z = zAt(t), cx = Math.floor(X / CELL), cy = Math.floor(Z / CELL);
          props.push({ cell: cell(cx, cy), kind, rot: face, off: [X - (cx + 0.5) * CELL, Z - (cy + 0.5) * CELL] });
          if (cover) for (let i = Math.floor((X - cover) / CELL); i <= Math.floor((X + cover) / CELL); i++) for (let j = Math.floor((Z - cover) / CELL); j <= Math.floor((Z + cover) / CELL); j++) reserve.add(at(i, j));
          return cell(cx, cy);
        };
        // todo al azar de la semilla (y de la posición de la suite: las copias del pasillo repiten cada suite, para que el bucle siga siendo perfecto):
        // el lado del sofá y del escritorio, dónde cae la cama, el orden y los huecos de lo que va contra las paredes, y qué hay y qué no
        const rs = mulberry32(seed * 31 + side * 7 + slot * 131 + 17), rr = (lo: number, hi: number) => lo + rs() * (hi - lo), chance = (pr: number) => rs() < pr;
        const ws = chance(0.5) ? 1 : -1, faceA = ws > 0 ? 0 : 1, faceB = ws > 0 ? 1 : 0, colB = ws > 0 ? x0 + 3 : x0 + 1; // A: la pared del sofá; B: la del escritorio (DIRS 0 mira al este, 1 al oeste)
        const wallA = (d: number) => (ws > 0 ? Xw + d : Xe - d), wallB = (d: number) => (ws > 0 ? Xe - d : Xw + d);
        const busyA: [number, number][] = [], busyB: [number, number][] = [];
        // a veces, un Faceling de pie en un rincón de la suite, junto a la puerta (mira hacia dentro); en las tres copias a la vez, como todo
        if (mulberry32(seed * 17 + side * 5 + slot * 3 + 11)() < 0.16) (busyA.push([7.85, 8.75]), put('faceling', wallA(0.7), 8.3, faceA, 0.45));
        /** Un hueco libre de `len` m a lo largo de la pared, pasada la cama (desde t = 2,4); null si no cabe. */
        const spot = (busy: [number, number][], len: number) => {
          for (let i = 0; i < 10; i++) {
            const t = rr(2.4 + len / 2, 8.7 - len / 2);
            if (busy.every(([lo, hi]) => t + len / 2 + 0.15 < lo || t - len / 2 - 0.15 > hi)) return busy.push([t - len / 2, t + len / 2]), t;
          }
          return null;
        };
        const bx = Xc + rr(-0.35, 0.35);
        put('bed', bx, 1.15, inward, 0.9);
        put('nightstand', bx - 1.2, 0.3, inward), put('nightstand', bx + 1.2, 0.3, inward);
        // el escritorio (a una fila al azar), con su silla, su espejo y la TV o la lámpara
        const dr = 1 + ((rs() * 4) | 0), td = (dr + 0.5) * CELL;
        busyB.push([td - 0.9, td + 0.9]);
        props.push({ cell: cell(colB, row(dr)), kind: 'desk', rot: faceA }, { cell: cell(x0 + 2, row(dr)), kind: 'chair2', rot: faceA });
        reserve.add(at(colB, row(dr))), reserve.add(at(x0 + 2, row(dr)));
        if (chance(0.5)) props.push({ cell: cell(colB, row(dr)), kind: 'crt', rot: faceA });
        else put('tlamp', wallB(0.35), td, faceB);
        put('mirror', wallB(0.025), td, faceB);
        // la rejilla de ventilación (lleva a los conductos): contra una pared, donde quepa
        {
          const tB = spot(busyB, 0.8), tv = tB ?? spot(busyA, 0.8);
          if (tv !== null) {
            const face = tB !== null ? faceB : faceA, X = tB !== null ? wallB(0.03) : wallA(0.03), Z = zAt(tv), e = (side * 4 + slot) % NX, [nx, nz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][face];
            vents.push({ x: X, z: Z, face, to: ventIn[e] });
            if (k === 1) ventBack[e] ??= { x: X + nx * 0.9, z: Z + nz * 0.9, yaw: YAW[face] };
          }
        }
        const sid = side * 3 + slot - 1;
        if (sid === g0 || sid === g1) {
          const gc = put('panel', wallB(0.12), spot(busyB, 0.7) ?? 8.2, faceB);
          if (k === 1) gens[sid === g0 ? 0 : 1] = gc;
        }
        // contra la pared del sofá y la del escritorio, lo que toque, donde quepa
        // (la suite con el cuadro eléctrico del ascensor siempre tiene armario —y se coloca antes que el sofá, para que quepa—)
        const ward = () => {
          const t = spot(busyA, 1.2);
          if (t !== null) {
            const c = put('wardrobe', wallA(0.55), t, faceA, 0.5), Z = zAt(t);
            hides.push({ cell: c, side: faceA, at: [wallA(0.55), Z], front: [wallA(0.55) + (ws > 0 ? 1.1 : -1.1), Z] }); // (se puede uno esconder en él)
          }
        };
        const panelRoom = sid === g0 || sid === g1;
        if (panelRoom) ward();
        const sofa = spot(busyA, 1.9);
        if (sofa !== null) put('sofa', wallA(0.62), sofa, faceA, 0.8);
        if (!panelRoom && chance(0.75)) ward();
        if (chance(0.7)) { const t = spot(busyA, 0.9); if (t !== null) put('wingchair', wallA(0.55), t, faceA, 0.35); }
        if (chance(0.6)) { const t = spot(busyA, 0.4); if (t !== null) put('bin', wallA(0.3), t, faceA); }
        if (chance(0.65)) { const t = spot(busyB, 0.6); if (t !== null) put('bistro', wallB(0.5), t, faceB, 0.3); }
        if (chance(0.5)) { const t = spot(busyB, 0.4); if (t !== null) put('bin', wallB(0.3), t, faceB); }
        if (chance(0.6)) put('plant', bx < Xc ? Xe - 0.45 : Xw + 0.45, 0.55, inward, 0.3); // en el rincón, del lado donde sobra sitio
        if (chance(0.6)) { const lt = rr(2.7, 3.2); if (Math.abs(lt - td) > 1.2) put('luggage', Xc + rr(-0.15, 0.15), lt, chance(0.5) ? faceA : faceB, 0.3); } // a los pies de la cama, en el centro: ni contra la silla del escritorio ni donde se sale de un armario
        if (k === 1) for (let d = 0; d < 6; d++) for (let i = 1; i <= 3; i++) free.push(cell(x0 + i, row(d)));
      }
  // los conductos: la rejilla de vuelta en cada entrada (a la suite de donde sale; si no hay, al pasillo) y la sala de videovigilancia (mesas con pantallas, el terminal del EEH y la rejilla al pasillo)
  const hall = { x: (SUITE_L + 4 + 0.5) * CELL, z: 9 * CELL, yaw: 0 };
  for (let i = 0; i < NX; i++) vents.push({ x: (node(i, 0).x + 0.5) * CELL, z: (node(i, 0).y) * CELL + 0.03, face: 2, to: ventBack[i] ?? hall });
  // la sala de control (8 × 5 celdas, de hormigón y alta): la pared de televisores al fondo, el puesto de cámaras en medio, el terminal del EEH en la pared este y la rejilla al pasillo en la oeste
  const CY = RY + 1, control: NonNullable<Maze['control']> = {
    x: roomX, y: CY, w: 8, h: 5,
    console: { x: (roomX + 8) * CELL - 0.06, z: (CY + 2.5) * CELL, face: 1 },
    station: { x: (roomX + 4) * CELL, z: (CY + 2.2) * CELL, face: 3 },
  };
  vents.push({ x: roomX * CELL + 0.03, z: (CY + 2.5) * CELL, face: 0, to: hall });
  // las cámaras de seguridad de todo el nivel (se ven desde el puesto de la sala de control): el pasillo, cada suite, el vestíbulo y los conductos
  const cams: NonNullable<Maze['cams']> = [], addCam = (name: string, x: number, y: number, z: number, yaw: number) => cams.push({ name, x, y, z, yaw });
  for (let k = 0; k < 4; k++) addCam(`HALL ${k + 1}`, (SUITE_L + 3 + k * 4 + 0.5) * CELL, 2.7, 9 * CELL, k % 2 ? Math.PI / 2 : -Math.PI / 2);
  for (let u = 0; u < 4; u++) {
    const cx = (SUITE_L + u * UNIT + 2.5) * CELL;
    addCam(`SUITE ${u * 2 + 1}`, cx, 2.7, 1 * CELL + 0.2, Math.PI);
    addCam(`SUITE ${u * 2 + 2}`, cx, 2.7, 17 * CELL - 0.2, 0);
  }
  addCam('LOBBY', (CW + 11) * CELL, 2.7, 4.3 * CELL, Math.PI);
  addCam('LOBBY EAST', (W - 1) * CELL - 0.2, 2.7, 9 * CELL, Math.PI / 2);
  for (const [i, j] of [[1, 1], [4, 3], [2, 5], [5, 6]] as const) {
    const n = node(i, j), d = DIR4.findIndex(([dx, dy]) => open[at(n.x + dx, n.y + dy)]);
    if (d >= 0) addCam(`VENT ${cams.filter((c) => c.name.startsWith('VENT')).length + 1}`, (n.x + 0.5) * CELL, 1.6, (n.y + 0.5) * CELL, YAW[d]);
  }
  // y de vez en cuando, cámaras de más en sitios al azar (cambian con la semilla)
  for (let k = 0, n = 3 + ((rv() * 3) | 0); k < n; k++) {
    const hx = SUITE_L + 1 + ((rv() * (SUITE_L - 2)) | 0); // (la columna del pasillo: nunca la de una puerta, para que haya pared donde colgarla)
    if (rv() < 0.5) addCam(`AUX ${k + 1}`, (hx + (hx % UNIT === 2 ? 1 : 0) + 0.5) * CELL, 2.7, 9 * CELL, rv() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    else {
      const u = (rv() * 4) | 0, north = rv() < 0.5;
      addCam(`AUX ${k + 1}`, (SUITE_L + u * UNIT + 1.5 + rv() * 2) * CELL, 2.7, north ? 6.8 * CELL : 11.2 * CELL, north ? 0 : Math.PI);
    }
  }
  addCam('CONTROL', (control.x + 4) * CELL, 4.4, (CY + 0.3) * CELL, 0);
  // todas van contra la pared (no colgadas en el aire): se pega cada una a la pared de detrás (la de su lado, si no) y se anota hacia dónde está
  const EDGE = 0.32;
  for (const c of cams) {
    if (c.name === 'CONTROL') { (c.z = CY * CELL + EDGE), (c.wall = [0, -1]); continue; }
    const hit = ([dx, dz]: [number, number]) => {
      for (let s = 0.1; s <= 3.2; s += 0.1) {
        const px = c.x + dx * s, pz = c.z + dz * s;
        if (px < 0 || px >= W * CELL || !open[at(Math.floor(px / CELL), Math.floor(pz / CELL))]) return dx ? (dx > 0 ? Math.floor(px / CELL) : Math.floor(px / CELL) + 1) * CELL : (dz > 0 ? Math.floor(pz / CELL) : Math.floor(pz / CELL) + 1) * CELL;
      }
      return undefined;
    };
    const back: [number, number] = [Math.round(Math.sin(c.yaw)), Math.round(Math.cos(c.yaw))], dirs: [number, number][] = [back, [0, -1], [0, 1], [1, 0], [-1, 0]];
    for (const d of /^(HALL|AUX)/.test(c.name) && Math.abs(c.z - 9 * CELL) < 1e-6 ? (cams.indexOf(c) % 2 ? [[0, 1], [0, -1]] as [number, number][] : dirs.slice(1)) : dirs) {
      const e = hit(d);
      if (e === undefined) continue;
      if (d[0]) c.x = e - d[0] * EDGE; else c.z = e - d[1] * EDGE;
      c.wall = d;
      break;
    }
  }
  // el pasillo: enchufes en las paredes y alguna rejilla de aire en el techo
  for (let x = 0; x < CW; x++) {
    if (x % 8 === 3) props.push({ cell: cell(x, 8), kind: 'socket', rot: 3 });
    if (x % 8 === 7) props.push({ cell: cell(x, 9), kind: 'socket', rot: 2 });
    // una consola con lámpara contra la pared, a un lado y a otro del pasillo
    if (x % SUITE_L === 5) props.push({ cell: cell(x, 8), kind: 'desk', rot: 3 }, { cell: cell(x, 8), kind: 'tlamp', rot: 3, off: [0, -0.35] });
    if (x % SUITE_L === 15) props.push({ cell: cell(x, 9), kind: 'desk', rot: 2 }, { cell: cell(x, 9), kind: 'tlamp', rot: 2, off: [0, 0.35] });
    if (x % SUITE_L === 12) props.push({ cell: cell(x, 8), kind: 'vent', rot: 0 });
    // el servicio del hotel, contra las paredes (delante de un pilar, nunca de una puerta): un carro de limpieza, un carrito de maletas, equipaje suelto
    if (x % SUITE_L === 4) props.push({ cell: cell(x, 9), kind: 'cart', rot: 3, off: [0, 0.4] });
    if (x % SUITE_L === 12) props.push({ cell: cell(x, 8), kind: 'trolley', rot: 2, off: [0, -0.4] });
    if (x % SUITE_L === 8) props.push({ cell: cell(x, 9), kind: 'luggage', rot: 3, off: [-0.3, 0.45] }, { cell: cell(x, 9), kind: 'luggage', rot: 2, off: [0.35, 0.4] });
  }
  // lo único (la copia del medio): los objetos en las suites, sin ocupar una pieza
  const used = new Set(props.map((p) => at(p.cell.x, p.cell.y)));
  const spots = free.filter((c) => !used.has(at(c.x, c.y)));
  for (let i = spots.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  spots.sort((a, b) => Number(reserve.has(at(a.x, a.y))) - Number(reserve.has(at(b.x, b.y)))); // primero las celdas libres de muebles (estable: conserva el orden al azar)
  // y nunca dentro de un mueble: se descartan las reservadas y las pegadas a una celda con pieza (los muebles se salen de su celda)
  const near = (c: Cell) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => used.has(at(c.x + dx, c.y + dy)) && (dx || dy) && props.some((p) => p.cell.x === c.x + dx && p.cell.y === c.y + dy && p.kind !== 'door' && p.kind !== 'plant' && p.kind !== 'bin')));
  const clear = spots.filter((c) => !reserve.has(at(c.x, c.y)) && !near(c));
  if (clear.length >= 14) spots.splice(0, spots.length, ...clear);
  const take = (n: number) => spots.splice(0, n);
  const [camera] = take(1), [pistol] = take(1);
  const lamps: Cell[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (open[at(x, y)] && x % 2 === 0 && y % 2 === 0 && y < 18) lamps.push(cell(x, y)); // (los conductos y la sala de control, sin lámparas: la sala lleva sus propias luces)
  // (los conductos, a oscuras; la sala de control, con luz: a oscuras la cordura se va)
  const litMap = new Uint8Array(W * H).fill(1).fill(0, 18 * W);
  for (let y = control.y; y < control.y + control.h; y++) for (let x = control.x; x < control.x + control.w; x++) litMap[at(x, y)] = 1;
  return {
    floor, span: [SUITE_L, 2 * SUITE_L], w: W, h: H, open, lit: litMap, zone: new Uint8Array(W * H), voids: [],
    start: floor > 1 ? elevator /* de la segunda planta en adelante se llega en el ascensor */ : cell(CW + 10, 12), stairs: cell(SUITE_L + 1, 1), gens, elevator, camera, pistol, extraGuns: [],
    tapes: take(8), flashlights: take(4), spawns: [cell(SUITE_L + 4, 8), cell(SUITE_L + 5, 9), cell(SUITE_L + 15, 9)],
    lamps, props, hides, rooms, vents, gas, control, cams, fans, duct: { x0: VX, y0: VY, x1: VX + 14, y1: RY + 1 },
  };
}
