/*
 * El árbol de mejoras (terminal de la sala de espera). Se empieza con muy poco (2 casillas, sin barra rápida ni espalda, poca vida, poco aguante
 * y lento) y cada nodo sube un nivel pagando del dinero común. Las mejoras son de cada jugador dentro de cada sala. Una mejora nueva es una
 * entrada más en UPGRADES (y un campo en Stats si da algo distinto): el terminal, el servidor y la consola de admin salen de esta tabla.
 */

export type UpId = 'pack' | 'belt' | 'back' | 'hp' | 'lungs' | 'legs' | 'pool';
export interface UpDef {
  name: string;
  info: string;
  /** Lo que cuesta cada nivel (el largo es el nivel máximo). */
  cost: number[];
  /** El valor en cada nivel, del 0 al máximo. */
  val: number[];
  /** Cómo se lee un valor en el terminal. */
  fmt: (v: number) => string;
  /** Los tramos del árbol: cada mejora se reparte en nodos (fases) de `n` niveles seguidos, en la fila `row`; un tramo no se abre hasta acabar el anterior de la misma mejora ni hasta tener `needs` (otra mejora a ese nivel como mínimo). La suma de `n` es el nivel máximo. */
  stages: Stage[];
  /** La rama (carril) en el árbol. */
  col: number;
  /** Si es el nodo que desbloquea un nivel (LEVELS): su id. */
  level?: string;
}
export interface Stage {
  n: number;
  row: number;
  needs?: [UpId, number][];
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const st = (n: number, row: number, ...needs: [UpId, number][]): Stage => ({ n, row, ...(needs.length ? { needs } : {}) });
export const UPGRADES: Record<UpId, UpDef> = {
  pack: { name: 'POCKETS', info: 'Backpack cells. Everything you carry needs one.', cost: [80, 140, 220, 340, 500, 750], val: [2, 4, 6, 9, 12, 16, 20], fmt: (v) => `${v} CELLS`, stages: [st(2, 0), st(2, 1), st(2, 4, ['pool', 1])], col: 0 },
  belt: { name: 'TOOL BELT', info: 'Quick access slots. Cameras, rifles and gadgets are only used from here.', cost: [120, 200, 320, 480], val: [0, 1, 2, 3, 4], fmt: (v) => `${v} SLOTS`, stages: [st(2, 1, ['pack', 2]), st(2, 2, ['pack', 4])], col: 1 },
  back: { name: 'HARNESS', info: 'The back slot: wear a diving tank.', cost: [300], val: [0, 1], fmt: (v) => (v ? 'BACK SLOT' : 'LOCKED'), stages: [st(1, 4, ['belt', 4], ['pool', 1])], col: 1 },
  hp: { name: 'VITALITY', info: 'Maximum health.', cost: [100, 180, 300, 460], val: [40, 55, 70, 85, 100], fmt: (v) => `${v} HP`, stages: [st(2, 0), st(2, 2)], col: 2 },
  lungs: { name: 'LUNGS', info: 'How long you can run before you are out of breath.', cost: [100, 180, 300, 460], val: [0.4, 0.55, 0.7, 0.85, 1], fmt: pct, stages: [st(2, 0), st(2, 2)], col: 3 },
  legs: { name: 'LEGS', info: 'Walking and running speed.', cost: [150, 260, 420], val: [0.85, 0.9, 0.95, 1], fmt: pct, stages: [st(1, 1, ['lungs', 2]), st(2, 4, ['lungs', 4], ['pool', 1])], col: 3 },
  pool: { name: 'LEVEL 37', info: 'Unlocks the Poolrooms: they can come up in a round, with better loot and its own gear in the shop.', cost: [600], val: [0, 1], fmt: (v) => (v ? 'UNLOCKED' : 'LOCKED'), stages: [st(1, 3, ['pack', 4], ['belt', 2], ['hp', 4], ['lungs', 4], ['legs', 1])], col: 2, level: 'poolrooms' },
};
export const UP_IDS = Object.keys(UPGRADES) as UpId[];
/** Niveles comprados (lo que falta es 0). */
export type Ups = Partial<Record<UpId, number>>;

/** Lo que dan las mejoras: casillas de mochila, ranuras de la barra rápida, ranura de espalda, vida máxima y factores de aguante y velocidad. */
export interface Stats {
  cells: number;
  hot: number;
  back: boolean;
  hp: number;
  stamina: number;
  speed: number;
}
export const upLevel = (u: Ups | undefined, id: UpId) => Math.max(0, Math.min(UPGRADES[id].cost.length, Math.floor(Number(u?.[id]) || 0)));
const v = (u: Ups | undefined, id: UpId) => UPGRADES[id].val[upLevel(u, id)];
export const statsOf = (u?: Ups): Stats => ({ cells: v(u, 'pack'), hot: v(u, 'belt'), back: !!v(u, 'back'), hp: v(u, 'hp'), stamina: v(u, 'lungs'), speed: v(u, 'legs') });
/** Todo al máximo: jugando solo (sin sala) no hay árbol. */
export const FULL_UPS: Ups = Object.fromEntries(UP_IDS.map((id) => [id, UPGRADES[id].cost.length]));
export const FULL_STATS = statsOf(FULL_UPS);
/** Lo que cuesta el siguiente nivel de `id`; null si ya está al máximo o falta el nodo del que cuelga. */
export function upCost(u: Ups | undefined, id: UpId): number | null {
  const d = UPGRADES[id], L = upLevel(u, id);
  if (L >= d.cost.length) return null;
  return (stageAt(id, L).needs ?? []).some(([n, k]) => upLevel(u, n) < k) ? null : d.cost[L];
}
/** El tramo del árbol al que pertenece el nivel `L` (el que se compra al pasar de L a L + 1). */
export function stageAt(id: UpId, L: number): Stage {
  let from = 0;
  for (const s of UPGRADES[id].stages) {
    if (L < from + s.n) return s;
    from += s.n;
  }
  return UPGRADES[id].stages[UPGRADES[id].stages.length - 1];
}
/** Unas mejoras saneadas (lo guardado o lo que llega de fuera). */
export const cleanUps = (x: unknown): Ups => Object.fromEntries(UP_IDS.map((id) => [id, upLevel(x && typeof x === 'object' ? (x as Ups) : undefined, id)]).filter(([, n]) => n));

/** Los niveles abiertos en una sala: el que no pide desbloqueo (el 0) y los que desbloquea algún jugador. */
export function levelsOpen(all: (Ups | undefined)[]): Set<string> {
  const s = new Set<string>(['level0']);
  for (const id of UP_IDS) {
    const l = UPGRADES[id].level;
    if (l && all.length && all.every((u) => upLevel(u, id) >= 1)) s.add(l); // (hace falta que lo tengan todos)
  }
  return s;
}
