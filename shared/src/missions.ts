/*
 * El bucle de rondas: misiones (las que se votan en la pizarra), tienda, inventario por jugador, niveles y las constantes del dinero.
 * Todo puro: lo comparten el servidor (que decide) y el cliente (que pinta). El estado vive en la memoria del servidor mientras la sala exista.
 */
import type { ParkingMinutes, ParkingOptions } from './parking';
import { CELL, DIRS, type Cell, type Maze } from './maze';

// ── dinero ───────────────────────────────────────────────────────────────

/** Saldo común con el que empieza una sala. */
export const START_BANK = 300;
/** Si la ronda sale mal (misión sin cumplir o nadie vuelve vivo) el equipo pierde esta fracción del saldo (redondeada, nunca negativo). */
export const PENALTY = 0.25;
/** Segundos que quedan para cerrar la ronda desde que sube el primero al ascensor. */
export const ASCENT_GRACE = 25;
/** Lo que se pierde de un saldo en una ronda fallida. */
export const penaltyOf = (bank: number) => Math.min(bank, Math.round(bank * PENALTY));

// ── niveles ──────────────────────────────────────────────────────────────

export interface LevelDef {
  id: string;
  name: string;
  /** Lo que sale en la pizarra de la sala de espera: el nombre del sitio y una línea de ambiente. */
  title: string;
  blurb: string;
}
/** Los niveles que salen en el sorteo de una ronda. Para añadir uno basta otra entrada (el cliente y el servidor de momento solo generan el laberinto de siempre). */
export const LEVELS: Record<string, LevelDef> = {
  level0: { id: 'level0', name: 'LEVEL 0', title: 'THE LOBBY', blurb: 'DAMP CARPET. FLUORESCENT HUM. NO WAY OUT BUT FORWARD.' },
  parking: { id: 'parking', name: 'LEVEL 1', title: 'THE HABITABLE ZONE', blurb: 'CONCRETE DECKS. DARK AISLES. FIND THE HIDDEN ELEVATOR.' },
  poolrooms: { id: 'poolrooms', name: 'LEVEL 37', title: 'THE POOLROOMS', blurb: 'WARM WATER. WHITE TILE. SOMETHING BREATHES UNDER THE SURFACE.' },
};
/** Niveles aún en desarrollo: solo salen si un admin los elige (no entran en el sorteo de rondas). Quitar el nombre de aquí cuando estén listos. */
export const DEV_LEVELS = ['parking'] as readonly string[];
/** Las misiones de las Poolrooms: aguantar o encontrar jabones (aún no hay entidades que fotografiar). */
export const poolMissions = (seed: number, round: number): Mission[] => {
  const r = rng(seed ^ Math.imul(round + 1, 0x9e3779b1));
  return [makeMission('survive', r, `m${round}-0`, 0), makeMission('soaps', r, `m${round}-1`, 0)];
};
/** Niveles especiales: no entran en el sorteo (los lleva el cliente aparte). */
export const SPECIAL_LEVELS = ['runforyourlife'] as const;
/** Un nivel del sorteo, según la semilla. */
export const pickLevel = (seed: number, pools = false) => {
  const ids = Object.keys(LEVELS).filter((id) => !(SPECIAL_LEVELS as readonly string[]).includes(id) && !(DEV_LEVELS as readonly string[]).includes(id) && (pools || id !== 'poolrooms'));
  return ids[(seed >>> 0) % ids.length] ?? 'level0';
};

// ── objetos: inventario y tienda ──────────────────────────────────────────

/** Lo que se compra, se suelta y se recoge. `flashlight` es una linterna de repuesto (batería nueva); `ammo`, un cargador (AMMO_PACK balas). */
export type ItemId = 'flashlight' | 'camera' | 'gun' | 'ammo' | 'water' | 'caution' | 'radar' | 'totem' | 'tank' | 'watergun';
export const ITEM_IDS: ItemId[] = ['flashlight', 'camera', 'gun', 'ammo', 'water', 'caution', 'radar', 'totem', 'tank', 'watergun'];
export const AMMO_PACK = 3;

/** Lo que un jugador lleva (y conserva entre rondas). La linterna principal no cuenta: nunca se pierde. */
export interface Inventory {
  /** Linternas de repuesto. */
  spares: number;
  /** Latas de Almond Water. */
  water: number;
  /** Tótems de la vida. */
  totem: number;
  /** Balas en total (cargador y reserva). */
  ammo: number;
  radar: boolean;
  camera: boolean;
  gun: boolean;
  /** Traje de buzo (aire x2, -15 % de velocidad) y pistola de agua. */
  tank: boolean;
  watergun: boolean;
  /** Cinta de acordonar (se tiene o no; se usa sin gastarse). */
  caution: boolean;
}
export const EMPTY_INV: Inventory = { spares: 0, water: 0, totem: 0, ammo: 0, radar: false, camera: false, gun: false, tank: false, watergun: false, caution: false };
/** Con lo que entra quien llega a una sala: una linterna de repuesto. */
export const START_INV: Inventory = { ...EMPTY_INV, spares: 1 };
/** Lo máximo que se puede llevar de cada cosa. */
export const INV_MAX: Inventory = { spares: 6, water: 5, totem: 2, ammo: 15, radar: true, camera: true, gun: true, tank: true, watergun: true, caution: true };

/** Un inventario saneado: lo que no es número o booleano, a cero; nada por encima de `cap` (por defecto, el máximo de INV_MAX). */
export function cleanInv(x: unknown, cap: Inventory = INV_MAX): Inventory {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const n = (k: 'spares' | 'water' | 'totem' | 'ammo') => (Number.isFinite(o[k]) ? Math.max(0, Math.min(Math.floor(o[k] as number), cap[k], INV_MAX[k])) : 0);
  const b = (k: 'radar' | 'camera' | 'gun' | 'tank' | 'watergun' | 'caution') => o[k] === true && cap[k] && INV_MAX[k];
  return { spares: n('spares'), water: n('water'), totem: n('totem'), ammo: n('ammo'), radar: b('radar'), camera: b('camera'), gun: b('gun'), tank: b('tank'), watergun: b('watergun'), caution: b('caution') };
}

/**
 * La ficha de un objeto: el «prefab». Un objeto nuevo es una entrada más aquí (cómo se llama, qué hace, cuánto cuesta, en qué campo del inventario se
 * guarda y cuántas unidades trae cada compra o recogida), su tope en INV_MAX y, en el cliente, su modelo y su entrada en HOT (quickslots.ts) si se usa
 * desde la barra rápida. De la ficha salen la tienda y las cuentas del inventario (caber, sumar, tener, quitar): no hay un `if` por objeto.
 */
export interface ItemDef {
  name: string;
  info: string;
  price: number;
  /** El campo de Inventory que lo cuenta (un número, o un booleano si solo se tiene o no). */
  slot: keyof Inventory;
  /** Unidades por compra o recogida (por defecto 1). */
  pack?: number;
}
export const ITEMS: Record<ItemId, ItemDef> = {
  flashlight: { name: 'SPARE FLASHLIGHT', price: 70, info: 'A fresh battery: F when the light dies.', slot: 'spares' },
  camera: { name: 'CAMCORDER', price: 400, info: 'Film entities. Needed for photo missions.', slot: 'camera' },
  gun: { name: 'RIFLE', price: 750, info: 'Comes with one magazine.', slot: 'gun' },
  ammo: { name: 'AMMO', price: 120, info: `${AMMO_PACK} rounds for the rifle.`, slot: 'ammo', pack: AMMO_PACK },
  water: { name: 'ALMOND WATER', price: 150, info: 'Restores health, stamina and sanity.', slot: 'water' },
  caution: { name: 'CAUTION TAPE', price: 70, info: 'Mark the way for your team.', slot: 'caution' },
  radar: { name: 'RADAR', price: 500, info: 'Shows where your teammates are.', slot: 'radar' },
  tank: { name: 'DIVING TANK', price: 400, info: 'Doubles your air underwater, slows you 15%.', slot: 'tank' },
  watergun: { name: 'WATER GUN', price: 250, info: 'Soaks and stalls whoever it hits.', slot: 'watergun' },
  totem: { name: 'TOTEM OF LIFE', price: 650, info: 'Brings back a fallen teammate.', slot: 'totem' },
};
const qty = (inv: Inventory, id: ItemId) => Number(inv[ITEMS[id].slot]), pack = (id: ItemId) => ITEMS[id].pack ?? 1;
const withQty = (inv: Inventory, id: ItemId, n: number): Inventory => ({ ...inv, [ITEMS[id].slot]: typeof inv[ITEMS[id].slot] === 'boolean' ? n > 0 : n });

/** ¿Cabe uno más de `id`? */
export const canHold = (inv: Inventory, id: ItemId) => qty(inv, id) + pack(id) <= Number(INV_MAX[ITEMS[id].slot]);
/** Con uno más de `id` (comprado o recogido del suelo). */
export const addItem = (inv: Inventory, id: ItemId) => withQty(inv, id, qty(inv, id) + pack(id));
/** ¿Se puede soltar una unidad de `id`? */
export const hasItem = (inv: Inventory, id: ItemId) => qty(inv, id) >= pack(id);
/** Sin una unidad de `id` (soltada). El rifle se va sin sus balas: esas siguen en el inventario. */
export const removeItem = (inv: Inventory, id: ItemId) => withQty(inv, id, qty(inv, id) - pack(id));

export interface ShopItem {
  id: ItemId;
  name: string;
  price: number;
  info: string;
}
/** La tienda del ordenador de la sala de espera: lo de todo el juego, cada cosa a su precio (sale de ITEMS). */
export const SHOP: ShopItem[] = (Object.keys(ITEMS) as ItemId[]).map((id) => ({ id, name: ITEMS[id].name, price: ITEMS[id].price, info: ITEMS[id].info }));
export const shopItem = (id: unknown) => SHOP.find((s) => s.id === id);
/** Lo que se lleva al comprar `id`: la compra y, con el rifle, un cargador de regalo. */
export function purchase(inv: Inventory, id: ItemId): Inventory {
  const o = addItem(inv, id);
  if (id === 'gun') o.ammo = Math.min(INV_MAX.ammo, o.ammo + AMMO_PACK);
  return o;
}

// ── objetos soltados ─────────────────────────────────────────────────────

/** Un objeto soltado en el suelo (id `d…`). Se recoge con el mismo `pickup` que lo demás. */
export interface Drop {
  id: string;
  kind: ItemId;
  x: number;
  z: number;
  /** Quién lo soltó (id de socket). */
  by: string;
}
/** Soltados a la vez por jugador, segundos que dura uno en el suelo y ms mínimos entre dos soltados. */
export const DROP_MAX = 6;
export const DROP_TTL = 300;
export const DROP_GAP = 250;

// ── misiones ─────────────────────────────────────────────────────────────

export type MissionKind = 'photos' | 'tapes' | 'soaps' | 'survive' | 'tvs' | 'generators';
export interface Mission {
  id: string;
  kind: MissionKind;
  /** «PHOTOGRAPH 3 ENTITIES», «TURN OFF 4 TVS»... */
  text: string;
  /** Lo que hay que llegar a: fotos, cintas, segundos o televisiones. */
  goal: number;
  /** Dinero que cobra el equipo si se cumple y alguien vuelve vivo. */
  reward: number;
}
/** La misión elegida, con su progreso (0 → goal; en `survive`, segundos). `done` abre el ascensor. */
export interface ActiveMission extends Mission {
  progress: number;
  done: boolean;
}
/** Una de las ofrecidas en la pizarra, con los ids de quienes la votan. */
export interface MissionOffer extends Mission {
  votes: string[];
}

export function parkingOptionsForMission(mission: Pick<Mission, 'kind' | 'goal'>): ParkingOptions {
  if (mission.kind === 'generators' || mission.kind === 'tapes') return { mission: mission.kind };
  const minutes: ParkingMinutes = mission.goal === 900 ? 15 : mission.goal === 600 ? 10 : 5;
  return { mission: 'survive', minutes };
}

export function parkingMissions(seed: number, round: number): Mission[] {
  const goals = [8, 5, [300, 600, 900][(seed >>> 0) % 3]];
  return (['tapes', 'generators', 'survive'] as const).map((kind, i) => ({
    id: `parking-${round}-${kind}`, kind, goal: goals[i], text: missionText(kind, goals[i]), reward: [80, 100, goals[2] / 5][i],
  }));
}

export function missionText(kind: MissionKind, goal: number) {
  if (kind === 'photos') return `PHOTOGRAPH ${goal} ENTITIES`;
  if (kind === 'tapes') return `FIND ${goal} TAPES`;
  if (kind === 'soaps') return `FIND ${goal} SOAPS`;
  if (kind === 'survive') return `SURVIVE ${Math.round(goal / 60)} MINUTES`;
  if (kind === 'generators') return `ACTIVATE ${goal} GENERATORS`;
  return `TURN OFF ${goal} TVS`;
}
/** La línea del HUD: «PHOTOS 1/3», «TAPES 2/4», «TVS 2/4», «SURVIVE 3:20» (lo que falta). */
export function missionLine(m: Pick<ActiveMission, 'kind' | 'goal' | 'progress'>) {
  if (m.kind === 'survive') {
    const left = Math.max(0, m.goal - m.progress);
    return `SURVIVE ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  }
  return `${{ photos: 'PHOTOS', tapes: 'TAPES', soaps: 'SOAPS', tvs: 'TVS', generators: 'GENERATORS' }[m.kind]} ${Math.min(m.progress, m.goal)}/${m.goal}`;
}

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const round10 = (n: number) => Math.round(n / 10) * 10;

/** La misión de ese tipo con parámetros al azar (de `r`); `tvs` es cuántas televisiones hay en el mapa (3 como mínimo para ofrecer esa misión). La recompensa sube con lo difícil. */
export function makeMission(kind: MissionKind, r: () => number, id: string, tvs: number): Mission {
  let goal: number, reward: number;
  if (kind === 'photos') (goal = between(r, 2, 4)), (reward = 80 + 90 * goal);
  else if (kind === 'tapes') (goal = between(r, 3, 6)), (reward = 50 + 60 * goal);
  else if (kind === 'soaps') (goal = between(r, 3, 5)), (reward = 60 + 60 * goal);
  else if (kind === 'survive') (goal = between(r, 4, 8) * 60), (reward = 40 + 55 * (goal / 60));
  else if (kind === 'generators') (goal = 5), (reward = 0);
  else (goal = Math.min(between(r, 3, 5), tvs)), (reward = 70 + 80 * goal);
  return { id, kind, text: missionText(kind, goal), goal, reward: round10(reward) };
}

/**
 * Las tres misiones de una ronda, distintas entre sí, según la semilla (la misma en el servidor y el cliente).
 * Sin televisiones suficientes en el mapa (`tvs` < 3) no sale la de apagarlas.
 */
export function offerMissions(seed: number, round: number, tvs: number): Mission[] {
  const r = rng(seed ^ Math.imul(round + 1, 0x9e3779b1));
  const kinds: MissionKind[] = ['photos', 'tapes', 'survive', ...(tvs >= 3 ? (['tvs'] as const) : [])];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds.slice(0, 3).map((k, i) => makeMission(k, r, `m${round}-${i}`, tvs));
}

// ── televisiones de la misión «TURN OFF THE TVS» ─────────────────────────

/** Las televisiones CRT del mapa (props `crt`, siempre sobre un escritorio contra una pared). */
export const crtProps = (m: Maze) => m.props.filter((p) => p.kind === 'crt');

/** Cuántas hay para apagar. */
export const tvCount = (m: Maze) => crtProps(m).length;

/**
 * Las `n` televisiones que hay que apagar: las CRT del mapa, bien repartidas (la más lejos del inicio y, después, cada vez la que
 * queda más lejos de las ya elegidas). Determinista por el mapa: el índice de cada una es el que viaja por la red.
 */
export function tvSites(m: Maze, n: number): { cell: Cell; rot: number }[] {
  const all = crtProps(m), out: { cell: Cell; rot: number }[] = [];
  const d = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const left = [...all];
  while (out.length < n && left.length) {
    let bi = 0, bs = -1;
    left.forEach((p, i) => {
      const s = Math.min(d(p.cell, m.start), ...out.map((o) => d(p.cell, o.cell)));
      if (s > bs) (bs = s), (bi = i);
    });
    const [p] = left.splice(bi, 1);
    out.push({ cell: p.cell, rot: p.rot });
  }
  return out;
}

/** Dónde está una televisión (el centro de su pantalla en planta): contra la pared de su celda, como la dibuja world.ts. */
export function tvPoint(s: { cell: Cell; rot: number }) {
  const [dx, dy] = DIRS[s.rot] ?? DIRS[0], off = CELL / 2 - 0.46 / 2 - 0.02;
  return { x: (s.cell.x + 0.5) * CELL + dx * off, z: (s.cell.y + 0.5) * CELL + dy * off };
}
/** Lo cerca que hay que estar de una televisión (m, en planta) para apagarla; el servidor admite algo más por la red. */
export const TV_REACH = 2.4;

// ── resultado de una ronda ───────────────────────────────────────────────

/** Qué fue de cada jugador: subió vivo al ascensor (conserva lo que llevaba), murió o se quedó vivo sin subir (lo pierden). */
export type Fate = 'back' | 'dead' | 'stranded';
export interface RoundResult {
  /** Misión cumplida y al menos uno volvió vivo: el equipo cobra. */
  won: boolean;
  /** La misión se cumplió (el ascensor llegó a abrirse). */
  completed: boolean;
  mission: Mission | null;
  /** Dinero cobrado (0 si no se ganó) y perdido (0 si se ganó). */
  reward: number;
  penalty: number;
  /** El saldo común después de la ronda. */
  bank: number;
  fates: Record<string, Fate>;
}
