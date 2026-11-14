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
const CW = SUITE_L * SUITE_COPIES, W = CW + 13, H = 18; // CW: el pasillo (las copias); detrás, la puerta doble (columna CW) y el vestíbulo (12 columnas), fuera del bucle
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
        if (mulberry32(seed * 17 + side * 5 + slot * 3 + 11)() < 0.04) (busyA.push([7.85, 8.75]), put('faceling', wallA(0.7), 8.3, faceA, 0.45));
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
        const sid = side * 3 + slot - 1;
        if (sid === g0 || sid === g1) {
          const gc = put('panel', wallB(0.12), spot(busyB, 0.7) ?? 8.2, faceB);
          if (k === 1) gens[sid === g0 ? 0 : 1] = gc;
        }
        // contra la pared del sofá y la del escritorio, lo que toque, donde quepa
        const sofa = spot(busyA, 1.9);
        if (sofa !== null) put('sofa', wallA(0.62), sofa, faceA, 0.8);
        if (chance(0.75)) {
          const t = spot(busyA, 1.2);
          if (t !== null) {
            const c = put('wardrobe', wallA(0.55), t, faceA, 0.5), Z = zAt(t);
            hides.push({ cell: c, side: faceA, at: [wallA(0.55), Z], front: [wallA(0.55) + (ws > 0 ? 1.1 : -1.1), Z] }); // (se puede uno esconder en él)
          }
        }
        if (chance(0.7)) { const t = spot(busyA, 0.9); if (t !== null) put('wingchair', wallA(0.55), t, faceA, 0.35); }
        if (chance(0.6)) { const t = spot(busyA, 0.4); if (t !== null) put('bin', wallA(0.3), t, faceA); }
        if (chance(0.65)) { const t = spot(busyB, 0.6); if (t !== null) put('bistro', wallB(0.5), t, faceB, 0.3); }
        if (chance(0.5)) { const t = spot(busyB, 0.4); if (t !== null) put('bin', wallB(0.3), t, faceB); }
        if (chance(0.6)) put('plant', bx < Xc ? Xe - 0.45 : Xw + 0.45, 0.55, inward, 0.3); // en el rincón, del lado donde sobra sitio
        if (chance(0.6)) put('luggage', bx + rr(-0.4, 0.4), rr(2.7, 3.2), chance(0.5) ? faceA : faceB, 0.3); // a los pies de la cama
        if (k === 1) for (let d = 0; d < 6; d++) for (let i = 1; i <= 3; i++) free.push(cell(x0 + i, row(d)));
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
  const take = (n: number) => spots.splice(0, n);
  const [camera] = take(1), [pistol] = take(1);
  const lamps: Cell[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (open[at(x, y)] && x % 2 === 0 && y % 2 === 0) lamps.push(cell(x, y));
  return {
    floor, span: [SUITE_L, 2 * SUITE_L], w: W, h: H, open, lit: new Uint8Array(W * H).fill(1), zone: new Uint8Array(W * H), voids: [],
    start: cell(CW + 10, 12), stairs: cell(SUITE_L + 1, 1), gens, elevator, camera, pistol, extraGuns: [],
    tapes: take(8), flashlights: take(4), spawns: [cell(SUITE_L + 4, 8), cell(SUITE_L + 5, 9), cell(SUITE_L + 15, 9)],
    lamps, props, hides, rooms,
  };
}
