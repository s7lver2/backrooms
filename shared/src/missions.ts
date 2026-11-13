/*
 * El bucle de rondas: misiones (las que se votan en la pizarra), tienda, inventario por jugador, niveles y las constantes del dinero.
 * Todo puro: lo comparten el servidor (que decide) y el cliente (que pinta). El estado vive en la memoria del servidor mientras la sala exista.
 */
import { CELL, DIRS, type Cell, type Maze } from './maze';
import type { Stats } from './upgrades';

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
  /** Suerte del botín: >1 empuja las rarezas hacia arriba (por defecto 1). */
  luck?: number;
  /** El nodo del árbol de mejoras (UpId) que desbloquea este nivel; sin él, está abierto desde el principio. */
  unlock?: string;
}
/** Los niveles que salen en el sorteo de una ronda. Para añadir uno basta otra entrada (el cliente y el servidor de momento solo generan el laberinto de siempre). */
export const LEVELS: Record<string, LevelDef> = {
  level0: { id: 'level0', name: 'LEVEL 0', title: 'THE LOBBY', blurb: 'DAMP CARPET. FLUORESCENT HUM. NO WAY OUT BUT FORWARD.' },
  poolrooms: { id: 'poolrooms', name: 'LEVEL 37', title: 'THE POOLROOMS', blurb: 'WARM WATER. WHITE TILE. SOMETHING BREATHES UNDER THE SURFACE.', luck: 1.8, unlock: 'pool' },
  suites: { id: 'suites', name: 'LEVEL -20', title: 'THE SUITES', blurb: 'WARM LIGHT. RED WALLPAPER. THE STAFF SMILES, AND THERE IS NO FACE TO SMILE WITH.', luck: 1.4 },
};
/** Niveles aún en desarrollo: solo salen si un admin los elige (no entran en el sorteo de rondas). Quitar el nombre de aquí cuando estén listos. */
export const DEV_LEVELS = ['suites'] as readonly string[];
/** Las misiones de las Poolrooms: aguantar o encontrar jabones (aún no hay entidades que fotografiar). */
export const poolMissions = (seed: number, round: number): Mission[] => {
  const r = rng(seed ^ Math.imul(round + 1, 0x9e3779b1));
  return [makeMission('survive', r, `m${round}-0`, 0), makeMission('soaps', r, `m${round}-1`, 0)];
};
/** Las misiones de las Suites: aguantar o recoger objetos del hotel (el resto, cuadros y recepción, llegará con el nivel entero). */
export const suitesMissions = (seed: number, round: number, floor = 1): Mission[] => {
  const r = rng(seed ^ Math.imul(round + 1, 0x9e3779b1));
  // cada planta pide más (un minuto o una cinta cada dos plantas, hasta las 8 que hay) y paga más (+25 % por planta)
  return [makeMission('survive', r, `m${round}-0`, 0), makeMission('tapes', r, `m${round}-1`, 0)].map((m) => {
    const goal = m.kind === 'tapes' ? Math.min(8, m.goal + (floor >> 1)) : m.goal + 60 * (floor - 1);
    return { ...m, goal, text: missionText(m.kind, goal), reward: round10((m.reward * goal * (1 + 0.25 * (floor - 1))) / m.goal) };
  });
};
/** Niveles especiales: no entran en el sorteo (los lleva el cliente aparte). */
export const SPECIAL_LEVELS = ['runforyourlife'] as const;
/** Un nivel del sorteo, según la semilla, entre los desbloqueados (`open`: ids de nivel; sin él, los que no piden desbloqueo). */
export const pickLevel = (seed: number, open?: ReadonlySet<string>) => {
  const ids = Object.keys(LEVELS).filter((id) => !(SPECIAL_LEVELS as readonly string[]).includes(id) && !(DEV_LEVELS as readonly string[]).includes(id) && (!LEVELS[id].unlock || !!open?.has(id)));
  return ids[(seed >>> 0) % ids.length] ?? 'level0';
};

// ── objetos: inventario y tienda ──────────────────────────────────────────

/** Lo que se compra, se suelta y se recoge. `flashlight` es una linterna de repuesto (batería nueva); `ammo`, un cargador (AMMO_PACK balas). */
export type ItemId = 'flashlight' | 'camera' | 'gun' | 'ammo' | 'water' | 'caution' | 'radar' | 'totem' | 'tank' | 'watergun' | 'uno' | 'monster';
export const ITEM_IDS: ItemId[] = ['flashlight', 'camera', 'gun', 'ammo', 'water', 'caution', 'radar', 'totem', 'tank', 'watergun', 'uno', 'monster'];
/** Monster: segundos que se tarda en beberla, lo que dura el efecto, y lo que acelera. Uno Reverse: ver ITEMS.uno. */
export const MONSTER = { drink: 3, time: 5, speed: 1.4 } as const;
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
  /** Carta Uno Reverse (una sola, un solo uso) y latas de Monster. */
  uno: boolean;
  monster: number;
  /** La calidad de cada cosa que se lleva (rareza y desgaste; una por tipo: una pila comparte la suya). La lleva el servidor. */
  q?: Partial<Record<ItemId, Qual>>;
  /** El botín de valor recogido en los niveles: cada pieza ocupa una casilla y solo sirve para venderse en la báscula. */
  loot?: Qual[];
}
/** Rareza (índice de RARITIES) y desgaste (0 nuevo – 1 destrozado) de un objeto. */
export interface Qual {
  r: number;
  w: number;
}
export const EMPTY_INV: Inventory = { spares: 0, water: 0, totem: 0, ammo: 0, radar: false, camera: false, gun: false, tank: false, watergun: false, caution: false, uno: false, monster: 0 };
/** Con lo que entra quien llega a una sala: una linterna de repuesto. */
export const START_INV: Inventory = { ...EMPTY_INV, spares: 1 };
/** Lo máximo que se puede llevar de cada cosa. */
export const INV_MAX: Inventory = { spares: 6, water: 5, totem: 2, ammo: 15, radar: true, camera: true, gun: true, tank: true, watergun: true, caution: true, uno: true, monster: 3 };

/** Un inventario saneado: lo que no es número o booleano, a cero; nada por encima de `cap` (por defecto, el máximo de INV_MAX). */
export function cleanInv(x: unknown, cap: Inventory = INV_MAX): Inventory {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const n = (k: 'spares' | 'water' | 'totem' | 'ammo' | 'monster') => (Number.isFinite(o[k]) ? Math.max(0, Math.min(Math.floor(o[k] as number), cap[k], INV_MAX[k])) : 0);
  const b = (k: 'radar' | 'camera' | 'gun' | 'tank' | 'watergun' | 'caution' | 'uno') => o[k] === true && cap[k] && INV_MAX[k];
  const out: Inventory = { spares: n('spares'), water: n('water'), totem: n('totem'), ammo: n('ammo'), radar: b('radar'), camera: b('camera'), gun: b('gun'), tank: b('tank'), watergun: b('watergun'), caution: b('caution'), uno: b('uno'), monster: n('monster') };
  // la calidad y el botín no los declara el cliente: son los de `cap` (lo que el servidor sabe que lleva)
  if (cap.q) out.q = Object.fromEntries(ITEM_IDS.filter((id) => cap.q![id] && Number(out[ITEMS[id].slot]) > 0).map((id) => [id, cap.q![id]]));
  if (cap.loot) out.loot = cap.loot;
  return out;
}

// ── rarezas, desgaste y venta ─────────────────────────────────────────────

/**
 * Las rarezas: todo objeto (del mapa, de la tienda o botín) sale con una al azar. `p` es su probabilidad, `price` multiplica lo que vale en la
 * báscula, `loot` lo que vale una pieza de botín y `boost` mejora la característica del objeto (ItemDef.boost). El color es el del brillo en el suelo.
 */
export const RARITIES = [
  { name: 'COMMON', color: 0xc8c4b4, p: 0.55, price: 1, loot: 1, boost: 1 },
  { name: 'UNCOMMON', color: 0x5fd35f, p: 0.25, price: 1.3, loot: 1.7, boost: 1.1 },
  { name: 'RARE', color: 0x4aa3ff, p: 0.12, price: 1.8, loot: 2.8, boost: 1.2 },
  { name: 'EPIC', color: 0xb565f0, p: 0.06, price: 2.6, loot: 4.5, boost: 1.35 },
  { name: 'LEGENDARY', color: 0xffb020, p: 0.02, price: 4, loot: 8, boost: 1.5 },
] as const;
export const rarity = (r: number | undefined) => RARITIES[Math.max(0, Math.min(RARITIES.length - 1, Math.floor(Number(r) || 0)))];
/** La rareza que toca con un azar `u` en [0, 1). */
export function rollRarity(u: number) {
  let i = 0;
  for (let acc: number = RARITIES[0].p; u >= acc && i < RARITIES.length - 1; acc += RARITIES[++i].p);
  return i;
}
/** La rareza de un objeto del mapa: sale de su id y su celda (la misma en el servidor y el cliente). */
export const spotRarity = (id: string, c: Cell, luck = 1) => rollRarity(((Math.imul((c.x * 73856093) ^ (c.y * 19349663) ^ (id.charCodeAt(0) * 83492791) ^ (id.length * 0x27d4eb2d), 0x9e3779b1) >>> 0) / 4294967296) ** (1 / luck));
/** Lo que mejora la característica de `id` por su rareza (1 = nada). */
export const boostOf = (inv: Pick<Inventory, 'q'> | undefined | null, id: ItemId) => rarity(inv?.q?.[id]?.r).boost;
/** Lo que paga la báscula por un objeto de la tienda (la mitad de su precio, por su rareza y su estado) y por una pieza de botín. */
export const SELL = 0.5, LOOT_BASE = 50, WEAR_LOSS = 0.7;
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
export const sellPrice = (id: ItemId, q?: Qual) => round5(ITEMS[id].price * SELL * rarity(q?.r).price * (1 - WEAR_LOSS * (q?.w ?? 0)));
export const lootPrice = (q: Qual) => round5(LOOT_BASE * rarity(q.r).loot * (1 - WEAR_LOSS * q.w));
/** Segundos de llevar algo encima en un nivel para desgastarlo del todo (objetos y botín), y lo que desgasta cada uso (un tiro, una foto). */
export const WEAR_TIME = 2400, LOOT_WEAR_TIME = 1500, WEAR_USE = 0.03;
/** Con `dt` segundos más de desgaste en todo lo que se lleva (y `use`, un uso de ese objeto). */
export function wearInv(inv: Inventory, dt: number, use?: ItemId): Inventory {
  const q = Object.fromEntries(Object.entries(inv.q ?? {}).map(([id, x]) => [id, { r: x.r, w: Math.min(1, x.w + dt / WEAR_TIME + (id === use ? WEAR_USE : 0)) }]));
  return { ...inv, q, loot: inv.loot?.map((x) => ({ r: x.r, w: Math.min(1, x.w + dt / LOOT_WEAR_TIME) })) };
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
  /** Va en la barra de acceso rápido (si no, solo en la mochila). */
  hot?: boolean;
  /** Lo que mejora con la rareza (se lee en el inventario): quien lo usa multiplica esa característica por boostOf. */
  boost?: string;
  /** El nivel al que pertenece: mientras no esté desbloqueado no se vende en la tienda ni sale del suelo ni de las taquillas. Sin él, es del nivel 0. */
  level?: string;
}
/** ¿Se puede ofrecer `id` con estos niveles abiertos? */
export const itemOpen = (id: ItemId, open: ReadonlySet<string>) => !ITEMS[id].level || open.has(ITEMS[id].level!);
export const ITEMS: Record<ItemId, ItemDef> = {
  flashlight: { name: 'SPARE FLASHLIGHT', price: 70, info: 'A fresh battery: F when the light dies.', slot: 'spares', boost: 'BATTERY LIFE' },
  camera: { name: 'CAMCORDER', price: 400, info: 'Film entities. Needed for photo missions.', slot: 'camera', hot: true, boost: 'LENS RANGE' },
  gun: { name: 'RIFLE', price: 750, info: 'Comes with one magazine.', slot: 'gun', hot: true, boost: 'BULLET RANGE' },
  ammo: { name: 'AMMO', price: 120, info: `${AMMO_PACK} rounds for the rifle.`, slot: 'ammo', pack: AMMO_PACK },
  water: { name: 'ALMOND WATER', price: 150, info: 'Restores 40% health, stamina and sanity.', slot: 'water', hot: true, boost: 'HEALING' },
  caution: { name: 'CAUTION TAPE', price: 70, info: 'Mark the way for your team.', slot: 'caution', hot: true },
  radar: { name: 'RADAR', price: 500, info: 'Shows where your teammates are.', slot: 'radar', hot: true, boost: 'SCAN RANGE' },
  tank: { name: 'DIVING TANK', price: 400, info: 'Doubles your air underwater, slows you 10%.', slot: 'tank', boost: 'AIR', level: 'poolrooms' },
  watergun: { name: 'WATER GUN', price: 250, info: 'Soaks and stalls whoever it hits.', slot: 'watergun', hot: true, boost: 'WATER TANK', level: 'poolrooms' },
  uno: { name: 'UNO REVERSE', price: 450, info: 'Swap places with a random teammate. One use, one card at a time.', slot: 'uno', hot: true, level: 'poolrooms' },
  monster: { name: 'MONSTER', price: 180, info: '3 s to drink. Then 5 s of +40% speed and endless stamina.', slot: 'monster', hot: true, boost: 'BOOST TIME' },
  totem: { name: 'TOTEM OF LIFE', price: 650, info: 'Brings back a fallen teammate.', slot: 'totem', hot: true },
};
const qty = (inv: Inventory, id: ItemId) => Number(inv[ITEMS[id].slot]), pack = (id: ItemId) => ITEMS[id].pack ?? 1;
const withQty = (inv: Inventory, id: ItemId, n: number): Inventory => ({ ...inv, [ITEMS[id].slot]: typeof inv[ITEMS[id].slot] === 'boolean' ? n > 0 : n });

/**
 * ¿Hay sitio para una cosa más (un tipo nuevo `plus`, o una pieza de botín)? Cada tipo que se lleva ocupa una casilla de la mochila (las pilas, una
 * sola) y cada pieza de botín, otra; lo que va en la barra rápida (ItemDef.hot) ocupa primero sus ranuras y solo lo que no quepa ahí, mochila.
 */
export function hasRoom(inv: Inventory, st: Stats, plus: ItemId | 'loot') {
  // (la primera linterna se equipa sola en la mano: no ocupa casilla de mochila)
  const kinds = ITEM_IDS.filter((k) => (k === 'flashlight' ? qty(inv, k) + (plus === k ? 1 : 0) > 1 : qty(inv, k) > 0 || k === plus)), hot = kinds.filter((k) => ITEMS[k].hot).length;
  return kinds.length - hot + (inv.loot?.length ?? 0) + (plus === 'loot' ? 1 : 0) + Math.max(0, hot - st.hot) <= st.cells;
}
/** ¿Cabe uno más de `id`? Con `st` (lo que dan las mejoras del jugador) cuenta también el sitio de la mochila. */
export const canHold = (inv: Inventory, id: ItemId, st?: Stats) => qty(inv, id) + pack(id) <= Number(INV_MAX[ITEMS[id].slot]) && (!st || qty(inv, id) > 0 || hasRoom(inv, st, id));
/** Con uno más de `id` (comprado o recogido del suelo), de rareza `r`: una pila conserva la rareza que ya tenía y reparte el desgaste. */
export function addItem(inv: Inventory, id: ItemId, r = 0, w = 0): Inventory {
  const n = qty(inv, id), old = n > 0 ? inv.q?.[id] : undefined;
  return { ...withQty(inv, id, n + pack(id)), q: { ...inv.q, [id]: old ? { r: old.r, w: (old.w * n + w * pack(id)) / (n + pack(id)) } : { r, w } } };
}
/** ¿Se puede soltar una unidad de `id`? */
export const hasItem = (inv: Inventory, id: ItemId) => qty(inv, id) >= pack(id);
/** Sin una unidad de `id` (soltada). El rifle se va sin sus balas: esas siguen en el inventario. */
export function removeItem(inv: Inventory, id: ItemId): Inventory {
  const o = withQty(inv, id, qty(inv, id) - pack(id));
  if (qty(o, id) <= 0 && o.q?.[id]) (o.q = { ...o.q }), delete o.q[id];
  return o;
}

export interface ShopItem {
  id: ItemId;
  name: string;
  price: number;
  info: string;
}
/** La tienda del ordenador de la sala de espera: lo de todo el juego, cada cosa a su precio (sale de ITEMS). */
export const SHOP: ShopItem[] = (Object.keys(ITEMS) as ItemId[]).map((id) => ({ id, name: ITEMS[id].name, price: ITEMS[id].price, info: ITEMS[id].info }));
/** Lo que vende un Faceling: pocas cosas y un 20 % más caras (4 o 5 al azar según la semilla y la planta: iguales para todos los Facelings y jugadores de la ronda). */
export function facelingStock(seed: number, floor = 1, open?: ReadonlySet<string>): ShopItem[] {
  const pool = SHOP.filter((s) => !open || itemOpen(s.id, open));
  let a = (seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0;
  const rnd = () => (a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296;
  rnd();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, rnd() < 0.5 ? 4 : 5).map((s) => ({ ...s, price: Math.ceil(s.price * 1.2) }));
}
export const shopItem = (id: unknown) => SHOP.find((s) => s.id === id);
/** Lo que se lleva al comprar `id`: la compra y, con el rifle, un cargador de regalo. */
export function purchase(inv: Inventory, id: ItemId, r = 0): Inventory {
  const o = addItem(inv, id, r);
  if (id === 'gun') o.ammo = Math.min(INV_MAX.ammo, o.ammo + AMMO_PACK);
  return o;
}

// ── objetos soltados ─────────────────────────────────────────────────────

/** Un objeto soltado en el suelo (id `d…`). Se recoge con el mismo `pickup` que lo demás. */
export interface Drop {
  id: string;
  kind: ItemId | 'loot';
  x: number;
  z: number;
  /** Quién lo soltó (id de socket). */
  by: string;
  /** Su rareza y su desgaste. */
  q?: Qual;
}
/** Soltados a la vez por jugador, segundos que dura uno en el suelo y ms mínimos entre dos soltados. */
export const DROP_MAX = 6;
export const DROP_TTL = 300;
export const DROP_GAP = 250;

// ── misiones ─────────────────────────────────────────────────────────────

export type MissionKind = 'photos' | 'tapes' | 'soaps' | 'survive' | 'tvs';
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

export function missionText(kind: MissionKind, goal: number) {
  if (kind === 'photos') return `PHOTOGRAPH ${goal} ENTITIES`;
  if (kind === 'tapes') return `FIND ${goal} TAPES`;
  if (kind === 'soaps') return `FIND ${goal} SOAPS`;
  if (kind === 'survive') return `SURVIVE ${Math.round(goal / 60)} MINUTES`;
  return `TURN OFF ${goal} TVS`;
}
/** La línea del HUD: «PHOTOS 1/3», «TAPES 2/4», «TVS 2/4», «SURVIVE 3:20» (lo que falta). */
export function missionLine(m: Pick<ActiveMission, 'kind' | 'goal' | 'progress'>) {
  if (m.kind === 'survive') {
    const left = Math.max(0, m.goal - m.progress);
    return `SURVIVE ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  }
  return `${{ photos: 'PHOTOS', tapes: 'TAPES', soaps: 'SOAPS', tvs: 'TVS' }[m.kind]} ${Math.min(m.progress, m.goal)}/${m.goal}`;
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

/** Lo que pagan las misiones respecto a la tabla de abajo: un tercio (el resto del dinero sale de vender en la báscula). */
export const MISSION_PAY = 1 / 3;
/** La misión de ese tipo con parámetros al azar (de `r`); `tvs` es cuántas televisiones hay en el mapa (3 como mínimo para ofrecer esa misión). La recompensa sube con lo difícil. */
export function makeMission(kind: MissionKind, r: () => number, id: string, tvs: number): Mission {
  let goal: number, reward: number;
  if (kind === 'photos') (goal = between(r, 2, 4)), (reward = 80 + 90 * goal);
  else if (kind === 'tapes') (goal = between(r, 3, 6)), (reward = 50 + 60 * goal);
  else if (kind === 'soaps') (goal = between(r, 3, 5)), (reward = 60 + 60 * goal);
  else if (kind === 'survive') (goal = between(r, 4, 8) * 60), (reward = 40 + 55 * (goal / 60));
  else (goal = Math.min(between(r, 3, 5), tvs)), (reward = 70 + 80 * goal);
  return { id, kind, text: missionText(kind, goal), goal, reward: round10(reward * MISSION_PAY) };
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
  /** Las Suites: la planta de la ronda que viene, y si el ascensor falló y cayó a la 1. */
  floor?: number;
  fell?: boolean;
}
