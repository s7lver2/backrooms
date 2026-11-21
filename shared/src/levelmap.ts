import { CELL, generateMaze, type Cell, type Maze } from './maze';
import { PK, PR, POOL_CELL, PY, generatePools, poolMaze } from './pools';
import { suitesMaze } from './suites';

/*
 * El plano de un nivel para los minimapas (consola de admin, visor de repeticiones): se calcula en el cliente con los mismos
 * generadores que el servidor (la semilla lo decide todo), asi que no hay que pedirle nada a nadie y es exacto. Cada capa lleva
 * su rejilla de baldosas (un caracter por celda, ver TILE) y hay marcas con el sitio de lo que importa para orientarse o
 * comprobar un fallo (inicio, ascensor, objetos, escondites, escaleras, tuneles...). Posiciones en metros.
 */
export const TILE = {
  wall: '#',
  floor: '.',
  dim: ',',
  column: 'o',
  shallow: '~',
  deep: '=',
  stairs: '/',
  slide: '>',
  gas: 'g',
} as const;

export type MarkKind = 'start' | 'exit' | 'camera' | 'gun' | 'tape' | 'light' | 'hide' | 'water' | 'radar' | 'tank' | 'totem' | 'portal' | 'refill' | 'stairs' | 'vent' | 'gen' | 'control' | 'spawn';
export interface MapMark {
  k: MarkKind;
  x: number;
  z: number;
  /** Capa a la que pertenece (0 la unica o la baja). */
  l?: number;
}
export interface MapLayer {
  name: string;
  /** Altura del suelo (m): sirve para decidir en que capa esta alguien segun su `y`. */
  y: number;
  /** w*h caracteres (fila a fila), uno por celda: ver TILE. */
  tiles: string;
}
export interface LevelMap {
  w: number;
  h: number;
  /** Lado de una celda, en metros. */
  cell: number;
  layers: MapLayer[];
  marks: MapMark[];
}

/** Que significa cada marca: letra, color y nombre (la leyenda y el dibujo salen de aqui). */
export const MARKS: Record<MarkKind, { ch: string; color: string; name: string }> = {
  start: { ch: 'S', color: '#7ee787', name: 'Start' },
  exit: { ch: 'E', color: '#58a6ff', name: 'Elevator' },
  camera: { ch: 'C', color: '#d2a8ff', name: 'Camcorder' },
  gun: { ch: 'R', color: '#ff7b72', name: 'Rifle' },
  tape: { ch: 'T', color: '#e3b341', name: 'Tape' },
  light: { ch: 'F', color: '#f0e68c', name: 'Flashlight' },
  hide: { ch: 'H', color: '#8b949e', name: 'Hiding spot' },
  water: { ch: 'W', color: '#56d4dd', name: 'Water' },
  radar: { ch: 'Ra', color: '#3fb950', name: 'Radar' },
  tank: { ch: 'Tk', color: '#79c0ff', name: 'Diving tank' },
  totem: { ch: 'To', color: '#f778ba', name: 'Totem' },
  portal: { ch: 'P', color: '#bc8cff', name: 'Portal' },
  refill: { ch: 'D', color: '#39c5cf', name: 'Fountain' },
  stairs: { ch: 'St', color: '#ffa657', name: 'Stairs' },
  vent: { ch: 'V', color: '#a5d6ff', name: 'Vent' },
  gen: { ch: 'G', color: '#ffd33d', name: 'Power panel' },
  control: { ch: 'Ct', color: '#ff9bce', name: 'Control room' },
  spawn: { ch: '!', color: '#ff6b6b', name: 'Entity spawn' },
};

const mid = (c: Cell, k = CELL) => [(c.x + 0.5) * k, (c.y + 0.5) * k] as const;

function mazeMarks(m: Maze, k: number, out: MapMark[]) {
  const add = (kind: MarkKind, c: Cell | null | undefined, l?: number) => {
    if (!c) return;
    const [x, z] = mid(c, k);
    out.push({ k: kind, x, z, ...(l ? { l } : {}) });
  };
  const lay = (c: Cell) => m.lay?.[c.y * m.w + c.x] ?? 0;
  add('start', m.start);
  add('exit', m.elevator, lay(m.elevator));
  add('camera', m.camera, lay(m.camera));
  add('gun', m.pistol, m.pistol ? lay(m.pistol) : 0);
  for (const c of m.extraGuns) add('gun', c, lay(c));
  for (const c of m.tapes) add('tape', c, lay(c));
  for (const c of m.flashlights) add('light', c, lay(c));
  for (const h of m.hides) add('hide', h.cell, lay(h.cell));
  for (const c of m.spawns) add('spawn', c, lay(c));
  for (const c of m.waters ?? []) add('water', c, lay(c));
  add('radar', m.radar, m.radar ? lay(m.radar) : 0);
  add('tank', m.tank, m.tank ? lay(m.tank) : 0);
  add('totem', m.totem, m.totem ? lay(m.totem) : 0);
  add('stairs', m.stairs);
  for (const v of m.vents ?? []) out.push({ k: 'vent', x: v.x, z: v.z });
  for (const c of m.gens ?? []) add('gen', c);
  if (m.control) out.push({ k: 'control', x: (m.control.x + m.control.w / 2) * k, z: (m.control.y + m.control.h / 2) * k });
}

function poolLevel(seed: number): LevelMap {
  const p = generatePools(seed), maze = poolMaze(seed), n = p.w * p.h;
  const tiles = (L: { kind: Uint8Array; water: Uint8Array; ramp?: Uint8Array }) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const kind = L.kind[i];
      s += kind === PK.wall ? TILE.wall : kind === PK.column ? TILE.column : L.ramp?.[i] === PR.stairs ? TILE.stairs : L.ramp?.[i] === PR.slide ? TILE.slide : L.water[i] === 2 ? TILE.deep : L.water[i] === 1 ? TILE.shallow : TILE.floor;
    }
    return s;
  };
  const marks: MapMark[] = [];
  mazeMarks(maze, POOL_CELL, marks);
  const portal = (c: { x: number; y: number; layer: 0 | 1 }) => marks.push({ k: 'portal', x: (c.x + 1) * POOL_CELL, z: (c.y + 1) * POOL_CELL, l: c.layer });
  for (const q of p.portals) (portal(q.a), portal(q.b));
  for (const c of p.refills) marks.push({ k: 'refill', x: (c.x + 0.5) * POOL_CELL, z: (c.y + 0.5) * POOL_CELL });
  for (const c of p.refillsUp) marks.push({ k: 'refill', x: (c.x + 0.5) * POOL_CELL, z: (c.y + 0.5) * POOL_CELL, l: 1 });
  return { w: p.w, h: p.h, cell: POOL_CELL, layers: [{ name: 'LOWER', y: 0, tiles: tiles(p) }, { name: 'UPPER', y: PY.up, tiles: tiles(p.up) }], marks };
}

/** El plano de un nivel (`null`: sin plano, p. ej. el parking: solo se ven los puntos). `players` solo mueve los objetos sueltos. */
export function levelMap(levelId: string, seed: number, players = 1, floor = 1): LevelMap | null {
  if (levelId === 'parking') return null;
  try {
    if (levelId === 'poolrooms') return poolLevel(seed);
    const m = levelId === 'suites' ? suitesMaze(seed, floor) : generateMaze(seed, players);
    const gas = new Set((m.gas ?? []).map((c) => c.y * m.w + c.x));
    let tiles = '';
    for (let i = 0; i < m.w * m.h; i++) tiles += !m.open[i] ? TILE.wall : gas.has(i) ? TILE.gas : m.lit[i] ? TILE.floor : TILE.dim;
    const marks: MapMark[] = [];
    mazeMarks(m, CELL, marks);
    return { w: m.w, h: m.h, cell: CELL, layers: [{ name: 'FLOOR', y: 0, tiles }], marks };
  } catch {
    return null;
  }
}
