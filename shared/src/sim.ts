import { bfs, CELL, DIRS as MAZE_DIRS, type Cell, type Maze } from './maze';
import type { ItemKind } from './index';

/*
 * La lógica de las entidades (bacteria y partygoer), sin gráficos: la corre el servidor en las salas y el
 * cliente en solitario (entity.ts solo la pinta). No patrullan: van de un sitio a oscuras a otro cercano
 * y allí se quedan un rato. Se dan cuenta de ti poco a poco (ver notice); a medias, se paran y miran
 * hacia ti; del todo, corren hacia donde te vieron por última vez. Si te pierden de vista 4 s, vuelven a
 * lo suyo. A 1,2 m, atacan. No pisan los huecos, la celda del ascensor ni los sillones.
 *
 * Los escondites (maze.hides): un jugador escondido no es objetivo. Pero si una entidad pasa a <= 2 celdas del
 * nicho, con algo de probabilidad (más si el jugador corrió hace poco) se para frente a él a «inspeccionar»: el
 * jugador tiene que contener la respiración (ver Breath); si no la contiene, o se le acaba, lo encuentra.
 */

export type Kind = 'bacteria' | 'partygoer' | 'faceling';
export type EState = 'wander' | 'search' | 'stalk' | 'chase' | 'attack' | 'dance' | 'dead' | 'inspect';
/** Los comportamientos que hay (ver BRAIN, al final de EntitySim). */
export type BehaviorId = 'inspect' | 'stalk' | 'chase' | 'search' | 'wander';

/**
 * La ficha de una entidad: el «prefab». Una entidad nueva es una entrada más en ENTITIES (y su modelo en el cliente);
 * un comportamiento nuevo, una función más en BRAIN. El cuerpo (rutas, vista, oído, moverse) es EntitySim, igual para todas.
 */
export interface EntDef {
  height: number;
  /** m/s andando y persiguiendo. */
  walk: number;
  run: number;
  /** Multiplicadores de alcance: de la vista y del oído (0: sorda). */
  sight: number;
  hearing: number;
  /** Segundos sin verte hasta que deja de perseguir. */
  lose: number;
  /** Adónde va cuando no tiene nada que hacer (a oscuras o cerca del botín) y cuánto se queda allí. */
  roam: 'dark' | 'loot';
  rest: [number, number];
  /** Persigue a tirones: `on` s a `k` veces su velocidad y `off` s cansada (a `tired` veces). */
  burst?: { k: number; on: number; off: number; tired: number };
  /** Acecha: quieta si la alumbras (hasta `patience` s), embiste si le das la espalda a menos de `pounce` m. */
  stalk?: { pounce: number; patience: number };
  /** Los comportamientos, por prioridad: cada paso manda el primero que quiere. */
  brain: BehaviorId[];
  /** Los clips del modelo; `state` cambia el de un estado concreto (si no: correr persiguiendo, andar o quieta). */
  clips: { idle: string; walk: string; run: string; attack: string; dances: string[]; state?: Partial<Record<EState, string>> };
}
export const ENTITIES: Record<Kind, EntDef> = {
  // el personal del hotel: de pie y en paz hasta que alguien mata a uno; entonces todos van a por quien no esté escondido (y no se rinden)
  faceling: {
    height: 1.75, walk: 1.3, run: 3.1, sight: 2, hearing: 3, lose: 90, roam: 'dark', rest: [1, 2],
    brain: ['inspect', 'chase', 'search', 'wander'],
    clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack', dances: ['strut'] },
  },
  // la acechadora: te sigue de lejos, se queda quieta bajo la linterna y embiste por la espalda
  bacteria: {
    height: 3, walk: 1.1, run: 2.9, sight: 1, hearing: 0.8, lose: 5, roam: 'dark', rest: [3, 8],
    stalk: { pounce: 9, patience: 4 },
    brain: ['inspect', 'stalk', 'chase', 'search', 'wander'],
    clips: { idle: 'Idle', walk: 'Walking', run: 'Run', attack: 'Jump Attack', dances: ['Booty Hip Hop Dance', 'Twist Dance'] },
  },
  // el emboscador: espera cerca del botín, oye mucho y persigue a tirones muy rápidos, pero se cansa
  partygoer: {
    height: 2.2, walk: 1.1, run: 2.9, sight: 1, hearing: 1.4, lose: 3, roam: 'loot', rest: [10, 25],
    burst: { k: 1.45, on: 2.5, off: 3, tired: 0.55 },
    brain: ['inspect', 'chase', 'search', 'wander'],
    clips: { idle: 'Happy Idle', walk: 'Dwarf Walk', run: 'Drunk Run Forward', attack: 'Standing Melee Attack Horizontal', dances: ['Macarena Dance'] },
  },
};

/**
 * Altura de cada tipo (m). El cliente la importa (entity.ts); se deriva de ENTITIES para no duplicar datos.
 * (Estaba sin exportar tras empezar la refactorización: no la quites.)
 */
export const HEIGHT: Record<Kind, number> = { bacteria: ENTITIES.bacteria.height, partygoer: ENTITIES.partygoer.height, faceling: ENTITIES.faceling.height };

/** Un ruido (carrera, disparo, objeto que cae): lo oyen las entidades a `r` m (por su oído). */
export interface Noise {
  x: number;
  z: number;
  r: number;
}
/** Lo que se oye una carrera y un disparo (m). */
export const NOISE_RUN = 9, NOISE_SHOT = 30, NOISE_DROP = 7, NOISE_PHOTO = 16, NOISE_PICK = 8;

/** Lo que percibe una entidad en un paso (y lo que deja dicho: a quién alcanza). */
export interface Sense {
  dt: number;
  targets: SimTarget[];
  hides: HideState[];
  god: boolean;
  /** Cuánto se da cuenta del que más ve, y quién es. */
  rate: number;
  tgt?: SimTarget;
  caught?: string;
}

/** Lo que el servidor reparte de cada entidad. */
export interface EntState {
  id: number;
  kind: Kind;
  x: number;
  z: number;
  yaw: number;
  state: EState;
  hp: number;
  /** Multiplicador de velocidad (las que reaparecen corren más). */
  speed: number;
}

/** Un jugador, visto por una entidad. */
export interface SimTarget {
  id: string;
  /** Los pies. */
  x: number;
  y: number;
  z: number;
  /** Los ojos. */
  ex: number;
  ey: number;
  ez: number;
  /** Hacia dónde apunta la linterna (unitario); null si va apagada. */
  torch: [number, number, number] | null;
  /** Bajo los fluorescentes encendidos. */
  exposed: boolean;
  /** Agachado: lo ven de la mitad de lejos (y la linterna no lo delata de lejos). */
  duck?: boolean;
  /** Hacia dónde mira (yaw del jugador: -z es 0); para las que acechan. */
  yaw?: number;
}

// persiguen más rápido de lo que andas y más despacio de lo que corres: escapar cuesta aguante
const CONE = (50 * Math.PI) / 180, REACH = 1.2;
// la inspección: hasta dónde se fija en un nicho, lo que dura frente a él, lo que tarda en notar que no contienes
// el aire (con el margen de la red) y el enfriamiento del nicho tras una
const HIDE_RANGE = 2 * CELL + 0.3, INSPECT_T = [2.5, 3.5] as const, REACT = 0.9, BAD_T = 0.7, COOL = 20;
// a cuánto te ven: a oscuras, bajo los fluorescentes y con la linterna encendida; el haz en la cara, a 0,3 rad
const SIGHT_DARK = 7, SIGHT_LIT = 14, SIGHT_TORCH = 20, BEAM = 0.3;
// el salto: si lleva FAR_T s a más de FAR_ROUTE celdas de ruta del jugador más cercano, sin verlo nadie ni a menos de
// TP_SAFE m, se recoloca a TP_NEAR celdas de ruta de él (fuera de la vista); luego TP_CD s de enfriamiento
const FAR_ROUTE = 45, FAR_T = 30, TP_CD = 70, TP_NEAR = [22, 35] as const, TP_SAFE = 15;
const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export const centerOf = (c: Cell) => ({ x: c.x * CELL + CELL / 2, z: c.y * CELL + CELL / 2 });

/** Dónde se pone el jugador `i` dentro de la celda de salida: cada uno en una esquina (a ~0,7 m del vecino, más que dos cuerpos de 0,3 m de radio), no todos en el centro. */
export const startOffset = (i: number): [number, number] => {
  const [x, z] = [[-1, -1], [1, 1], [1, -1], [-1, 1]][((i % 4) + 4) % 4];
  return [x * 0.35, z * 0.35];
};

/** Quien está en un nicho: `holding` es lo que de verdad contiene (ya con el aire), `noise` 1 al correr y baja con el tiempo. */
export interface HideOcc {
  id: string;
  holding: boolean;
  noise: number;
}
/** Un nicho en marcha (el servidor y el solitario llevan uno por cada `maze.hides`). */
export interface HideState {
  idx: number;
  /** El centro del nicho y el de la celda de su boca (m). */
  x: number;
  z: number;
  fx: number;
  fz: number;
  /** Hacia dónde mira quien sale (yaw del jugador: -z es yaw 0). */
  yaw: number;
  occ: HideOcc | null;
  /** Segundos hasta poder inspeccionarlo otra vez. */
  cd: number;
  /** La entidad que lo inspecciona ahora. */
  by: EntitySim | null;
}
export function hideStates(m: Maze): HideState[] {
  return m.hides.map((h, idx) => {
    if (h.at && h.front) {
      // un armario: dentro y delante, en metros
      const ux = h.front[0] - h.at[0], uz = h.front[1] - h.at[1], l = Math.hypot(ux, uz) || 1;
      return { idx, x: h.at[0], z: h.at[1], fx: h.front[0], fz: h.front[1], yaw: Math.atan2(-ux / l, -uz / l), occ: null, cd: 0, by: null };
    }
    const n = centerOf(h.cell), [dx, dy] = MAZE_DIRS[h.side];
    return { idx, x: n.x, z: n.z, fx: n.x + dx * CELL, fz: n.z + dy * CELL, yaw: Math.atan2(-dx, -dy), occ: null, cd: 0, by: null };
  });
}
export const tickHides = (hs: HideState[], dt: number) => hs.forEach((h) => (h.cd = Math.max(0, h.cd - dt)));

/**
 * Contener la respiración: 6 s seguidos (1 = lleno), se recupera en 4 al soltar; si se agota, un jadeo y
 * no se puede volver a contener hasta recuperar un 30 %. `slack` > 1 da más aire (el servidor, por la red).
 */
export class Breath {
  air = 1;
  /** Se acaba de agotar en este paso. */
  gasped = false;
  private winded = false;
  /** Un paso; devuelve si de verdad contiene (quiere, y le queda aire). */
  step(dt: number, want: boolean, slack = 1) {
    this.gasped = false;
    const hold = want && !this.winded && this.air > 0;
    this.air = Math.max(0, Math.min(1, this.air + (hold ? -1 / (6 * slack) : 1 / 4) * dt));
    if (hold && this.air <= 0) (this.winded = true), (this.gasped = true);
    else if (this.winded && this.air >= 0.3) this.winded = false;
    return hold;
  }
  reset() {
    this.air = 1;
    this.winded = this.gasped = false;
  }
}

/** Pared (o fuera del mapa) en ese punto; la cabina del ascensor cuenta como pared mientras no se abra. */
export function solidAt(m: Maze, x: number, z: number, elevatorOpen = false) {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || !m.open[cy * m.w + cx]) return true;
  return !elevatorOpen && cx === m.elevator.x && cy === m.elevator.y;
}

/** ¿Se ve (bx,bz) desde (ax,az) sin pared en medio? (pasos de 25 cm por la rejilla) */
export function seesXZ(solid: (x: number, z: number) => boolean, ax: number, az: number, bx: number, bz: number) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.min(Math.ceil(d / 0.25), 800); // (tope: una coordenada disparatada no cuelga el bucle)
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solid(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

export class EntitySim {
  x: number;
  z: number;
  facing = 0;
  state: EState = 'wander';
  alive = true;
  /** Se movió en el último paso (para elegir andar o quieta). */
  moving = false;
  readonly height: number;
  readonly hp0: number;
  path: { x: number; z: number }[] = [];
  repath = 0;
  lost = 0;
  /** Cuánto se ha dado cuenta de ti (0–1): a 1, persigue. */
  alert = 0;
  /** Lo que se queda quieta en un sitio antes de irse a otro. */
  rest = 0;
  seen = { x: 0, z: 0 };
  blocked: Set<number>;
  /** Segundos en el estado de ataque o baile (solo con `recover`). */
  phase = 0;
  /** La inspección en curso y los nichos que ya ha mirado (se olvidan al alejarse). */
  insp?: { h: HideState; t: number; walk: number; bad: number; dur: number };
  rolled = new Set<number>();
  // el salto: segundos lejos, enfriamiento (empieza con algo para no saltar nada más empezar) y reloj de las comprobaciones
  farT = 0;
  tpCd = 40;
  tpChk = 0;
  /** La celda a la que se dirige el camino de persecución y los segundos desde que se trazó (repath con histéresis). */
  routeKey = -1;
  routeAge = 0;
  /** Atasco: dónde estaba hace un rato y cuánto lleva sin avanzar yendo a un sitio. */
  stuckAt = { x: 0, z: 0 };
  stuckT = 0;
  readonly def: EntDef;
  /** Lo último que oyó (o dónde te perdió acechando) y los segundos que le quedan de ir a mirar. */
  heard?: { x: number; z: number; t: number };
  loot: Cell[];
  /** En paz: no hace nada (el personal del hotel) hasta `rage()`; ya furioso, siempre sabe dónde está el jugador más cercano que no esté escondido. */
  passive = false;
  enraged = false;
  /** Pasea en línea recta por el eje x (con la ficha en paz), por el carril `z` y a `v` m/s. */
  patrol?: { z: number; dir: number; v: number };
  /** Despertada por un ruido (un cuadro de luz): va a mirar; si te ve, te mata; si no, vuelve a su sitio en paz. */
  roused = false;
  rouse(x: number, z: number) {
    if (this.enraged || !this.alive) return;
    this.passive = false;
    this.roused = true;
    this.heard = { x, z, t: 40 };
  }
  rage() {
    this.passive = false;
    this.enraged = true;
  }

  /** `recover`: tras atacar, baila un rato y vuelve a lo suyo (en las salas; en solitario la partida acaba). */
  constructor(
    readonly kind: Kind,
    readonly maze: Maze,
    readonly solid: (x: number, z: number) => boolean,
    at: Cell,
    readonly speed = 1,
    public hp = 3, // (el rifle hace 1 de daño por tiro)
    readonly recover = false,
  ) {
    this.hp0 = hp;
    this.def = ENTITIES[kind];
    this.height = this.def.height;
    this.loot = itemSpots(maze).map((i) => i.cell).filter((c) => maze.open[c.y * maze.w + c.x]); // (solo los que pisa: los de la planta alta de las Poolrooms no)
    const c = centerOf(at);
    this.x = c.x;
    this.z = c.z;
    this.blocked = new Set([...maze.voids, maze.elevator, ...maze.props.filter((p) => p.kind === 'armchair').map((p) => p.cell)].map((c) => c.y * maze.w + c.x));
  }

  cellOf(x: number, z: number): Cell {
    return { x: Math.floor(x / CELL), y: Math.floor(z / CELL) };
  }

  /** Camino por la rejilla hasta `to` (centros de celda), evitando huecos y el ascensor. */
  route(to: Cell) {
    // la celda propia nunca cuenta como bloqueada: si una persecución la dejó sobre un hueco, que salga
    const m = this.maze, from = this.cellOf(this.x, this.z), own = from.y * m.w + from.x;
    const blocked = this.blocked.has(own) ? new Set([...this.blocked].filter((i) => i !== own)) : this.blocked;
    const d = bfs(m, to, blocked);
    if (d[from.y * m.w + from.x] < 0) return [];
    // se baja por las distancias desde el destino: cada paso, al vecino más cerca de él
    const out: { x: number; z: number }[] = [];
    let c = from;
    for (let i = 0; i < 400 && (c.x !== to.x || c.y !== to.y); i++) {
      const nb = DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter((n) => n.x >= 0 && n.y >= 0 && n.x < m.w && n.y < m.h && d[n.y * m.w + n.x] >= 0);
      c = nb.sort((a, b) => d[a.y * m.w + a.x] - d[b.y * m.w + b.x])[0];
      if (!c) break;
      out.push(centerOf(c));
    }
    return this.smooth(out);
  }

  /** ¿Cabe un cuerpo (0,6 m) yendo en línea recta de a a b, sin pared, hueco ni sillón? */
  clear(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    const nx = (-dz / d) * 0.3, nz = (dx / d) * 0.3, n = Math.min(Math.ceil(d / 0.3), 400);
    for (let i = 1; i <= n; i++)
      for (const k of [-1, 0, 1]) {
        const x = ax + (dx * i) / n + nx * k, z = az + (dz * i) / n + nz * k;
        if (this.solid(x, z) || this.blockedAt(x, z)) return false;
      }
    return true;
  }

  /** El camino por celdas, sin escalones: de cada punto, al más lejano (de los 14 siguientes) al que se llega en recta. En una sala abierta, en diagonal. */
  smooth(path: { x: number; z: number }[]) {
    const out: { x: number; z: number }[] = [];
    let ax = this.x, az = this.z, i = 0;
    while (i < path.length) {
      let j = i;
      for (let k = Math.min(path.length - 1, i + 14); k > i; k--)
        if (this.clear(ax, az, path[k].x, path[k].z)) {
          j = k;
          break;
        }
      out.push(path[j]);
      ({ x: ax, z: az } = path[j]);
      i = j + 1;
    }
    return out;
  }

  blockedAt(x: number, z: number) {
    const c = this.cellOf(x, z);
    return this.blocked.has(c.y * this.maze.w + c.x);
  }

  /** Adónde ir: un sitio no muy lejos (a 4–14 celdas), mejor a oscuras. */
  darkSpot(me = this.cellOf(this.x, this.z), r0 = 4, r1 = 14): Cell {
    const m = this.maze;
    let best = me, score = -1;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, r = r0 + Math.random() * (r1 - r0);
      const c = { x: Math.round(me.x + Math.cos(a) * r), y: Math.round(me.y + Math.sin(a) * r) }, k = c.y * m.w + c.x;
      if (c.x < 0 || c.y < 0 || c.x >= m.w || c.y >= m.h || !m.open[k] || this.blocked.has(k)) continue;
      const s = (m.lit[k] ? 0 : 2) + Math.random();
      if (s > score) (score = s), (best = c);
    }
    return best;
  }

  /** Adónde ir a pasar el rato, según la ficha: a oscuras, o (dos de cada tres veces) a 1–3 celdas de un objeto no muy lejano. */
  spot(): Cell {
    const m = this.maze;
    // Poolrooms (mapa abierto y grande): a veces, a cualquier celda abierta del nivel, para que lo recorra entero
    if (m.lay && Math.random() < 0.3)
      for (let i = 0; i < 40; i++) {
        const k = (Math.random() * m.w * m.h) | 0;
        if (m.open[k] && !this.blocked.has(k)) return { x: k % m.w, y: (k / m.w) | 0 };
      }
    const me = this.cellOf(this.x, this.z), near = this.loot.filter((c) => Math.abs(c.x - me.x) + Math.abs(c.y - me.y) < 30);
    if (this.def.roam !== 'loot' || !near.length || Math.random() < 0.33) return this.darkSpot();
    return this.darkSpot(near[(Math.random() * near.length) | 0], 1, 3);
  }

  /** Dejar lo que hacía y volver a lo suyo, tras `rest` s quieta. */
  calm(rest: number, alert = 0) {
    (this.state = 'wander'), (this.alert = alert), (this.path = []), (this.rest = rest);
  }
  /** A por él: perseguir hacia donde lo vio. */
  hunt() {
    (this.state = 'chase'), (this.lost = 0), (this.repath = 0), (this.phase = 0), (this.heard = undefined);
  }

  /** Mantener un camino hacia (x, z), con histéresis: solo se retraza si cambió de celda (o el camino ya es viejo). */
  track(x: number, z: number) {
    const sc = this.cellOf(x, z), k = sc.y * this.maze.w + sc.x;
    if (this.repath <= 0 && (!this.path.length || k !== this.routeKey || this.routeAge > 2)) (this.path = this.route(sc)), (this.repath = 0.5), (this.routeKey = k), (this.routeAge = 0);
  }

  /** Un paso hacia `goal` a `v` m/s (el siguiente punto del camino, o `direct`: un jugador en su misma celda). Nunca a una pared ni a un nicho. */
  step(goal: { x: number; z: number } | undefined, v: number, dt: number, direct = false) {
    if (!goal) return;
    const tx = goal.x - this.x, tz = goal.z - this.z, d = Math.hypot(tx, tz);
    if (d < 0.15 && !direct) this.path.shift();
    else if (d > 1e-6) {
      const k = Math.min(d, v * dt) / d, nx = this.x + tx * k, nz = this.z + tz * k;
      if (!this.solid(nx, nz) && (!direct || !this.blockedAt(nx, nz))) (this.x = nx), (this.z = nz);
      this.moving = true;
    }
    this.turn(tx, tz, dt);
  }

  /** ¿Le da el haz de la linterna de `t`? (a 0,3 rad de la línea del ojo a ella) */
  beamed(t: SimTarget) {
    const tx = t.ex - this.x, ty = t.ey - this.height * 0.85, tz = t.ez - this.z, d = Math.hypot(tx, ty, tz);
    if (!t.torch || d >= SIGHT_TORCH || d < 1e-6) return false;
    const cos = -(t.torch[0] * tx + t.torch[1] * ty + t.torch[2] * tz) / d;
    return Math.acos(Math.max(-1, Math.min(1, cos))) < BEAM;
  }

  /**
   * Recolocarse si está muy lejos de todos (ver FAR_*). Cuenta también a los escondidos (nichos ocupados). Se comprueba
   * 1 vez por segundo; nunca a la vista de nadie ni cerca, y solo en `wander` (quien llama).
   */
  maybeTeleport(dt: number, targets: SimTarget[], hides: HideState[]) {
    this.tpCd -= dt;
    if (this.tpCd > 0) return;
    if ((this.tpChk -= dt) > 0) return;
    this.tpChk = 1;
    const m = this.maze, pts = [...targets.map((t) => ({ x: t.x, z: t.z, ex: t.ex, ez: t.ez })), ...hides.filter((h) => h.occ).map((h) => ({ x: h.x, z: h.z, ex: h.x, ez: h.z }))];
    if (!pts.length) return void (this.farT = 0);
    const me = this.cellOf(this.x, this.z), key = (c: Cell) => c.y * m.w + c.x;
    const unseen = pts.every((p) => Math.hypot(p.x - this.x, p.z - this.z) > TP_SAFE && !seesXZ(this.solid, this.x, this.z, p.ex, p.ez));
    const ds = pts.map((p) => bfs(m, this.cellOf(p.x, p.z), this.blocked));
    const near = Math.min(...ds.map((d) => (d[key(me)] < 0 ? Infinity : d[key(me)])));
    if (!unseen || near < FAR_ROUTE) return void (this.farT = 0);
    if ((this.farT += 1) < FAR_T) return;
    // candidatas: a distancia media por ruta del más cercano, lejos en línea recta y sin línea de visión con nadie
    const ok: Cell[] = [];
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const k = y * m.w + x;
        if (!m.open[k] || this.blocked.has(k)) continue;
        const r = Math.min(...ds.map((d) => (d[k] < 0 ? Infinity : d[k])));
        if (r < TP_NEAR[0] || r > TP_NEAR[1]) continue;
        const c = centerOf({ x, y });
        if (pts.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > TP_SAFE && !seesXZ(this.solid, c.x, c.z, p.ex, p.ez))) ok.push({ x, y });
      }
    if (!ok.length) return;
    const to = centerOf(ok[(Math.random() * ok.length) | 0]);
    this.x = to.x;
    this.z = to.z;
    this.path = [];
    this.rest = 2;
    this.alert = 0;
    this.farT = 0;
    this.tpCd = TP_CD;
  }

  /**
   * Cuánto se da cuenta de `t` por segundo (0: no lo ve). Lo ve sin pared en medio, dentro de su cono (o
   * a menos de 2,5 m) y a SIGHT_DARK, SIGHT_LIT o SIGHT_TORCH según dónde esté y si lleva la linterna
   * encendida; si le da con el haz, aunque no mire y más deprisa. Persiguiendo no le hace falta el cono y
   * ve el doble de lejos (18 m como mucho: en las salas grandes no hay que verse hasta el fondo).
   */
  notice(t: SimTarget) {
    const my = this.height * 0.85, tx = t.ex - this.x, ty = t.ey - my, tz = t.ez - this.z, d = Math.hypot(tx, ty, tz), chasing = this.state === 'chase';
    let range = (t.torch ? SIGHT_TORCH : t.exposed ? SIGHT_LIT : SIGHT_DARK) * this.def.sight;
    if (chasing) range = Math.min(18, range * 2);
    // agachado cuesta más verte y seguirte: la mitad de alcance (incluso persiguiendo, así que puedes escabullirte)
    if (t.duck) range *= 0.5;
    const beamed = this.beamed(t);
    const ang = Math.abs(mod(Math.atan2(tx, tz) - this.facing + Math.PI, TAU) - Math.PI);
    if (!beamed && !((chasing || ang < CONE || d < 2.5) && d < range)) return 0;
    if (!seesXZ(this.solid, this.x, this.z, t.ex, t.ez)) return 0;
    return beamed ? 2.5 : 0.4 + 1.6 * (1 - d / range);
  }

  /**
   * Un paso. `hides`: los nichos con alguien dentro (esos jugadores no van en `targets`). Devuelve el id
   * del jugador al que alcanza en este paso (si lo hay).
   */
  update(dt: number, targets: SimTarget[], god = false, hides: HideState[] = [], noises: Noise[] = []): string | undefined {
    this.moving = false;
    // dentro de una pared o un nicho (no debería): a la celda abierta más cercana
    if (this.alive && this.solid(this.x, this.z)) this.unstick();
    if (this.state === 'attack' || this.state === 'dance' || this.state === 'dead') {
      // tras atacar: un momento de ataque y de vuelta a lo suyo (sin baile)
      if (this.recover && this.alive && (this.phase += dt) > 1.3) this.calm(2);
      return undefined;
    }
    if (this.passive) {
      const P = this.patrol;
      if (P) (this.x += P.dir * P.v * dt), (this.z = P.z), (this.facing = P.dir > 0 ? Math.PI / 2 : -Math.PI / 2), (this.moving = true);
      return undefined;
    }
    // los sentidos: al que más se da cuenta (el más cerca que ve) le hace caso; y lo que oye
    const s: Sense = { dt, targets, hides, god, rate: 0 };
    for (const t of targets) {
      const r = this.notice(t);
      if (r > s.rate) (s.rate = r), (s.tgt = t);
    }
    if (s.tgt) this.seen = { x: s.tgt.x, z: s.tgt.z };
    if (this.state !== 'chase') {
      this.alert = s.rate > 0 ? Math.min(1, this.alert + s.rate * dt) : Math.max(0, this.alert - dt / 4);
      for (const n of noises) {
        const d = Math.hypot(n.x - this.x, n.z - this.z);
        if (d > 1.5 && d < n.r * this.def.hearing) this.heard = { x: n.x, z: n.z, t: 25 };
      }
    }
    if (this.enraged && this.state !== 'chase' && this.state !== 'inspect') {
      const t = targets.reduce<SimTarget | undefined>((b, q) => (!b || Math.hypot(q.x - this.x, q.z - this.z) < Math.hypot(b.x - this.x, b.z - this.z) ? q : b), undefined);
      if (t) (this.seen = { x: t.x, z: t.z }), (this.alert = 1);
    }
    this.repath -= dt;
    this.routeAge += dt;
    // el cerebro: manda el primer comportamiento de la ficha que quiere
    for (const b of this.def.brain) if (BRAIN[b](this, s)) break;
    if (this.roused && !this.enraged && this.state === 'wander' && !this.heard) (this.roused = false), (this.passive = true), (this.path = []); // (no encontró nada: vuelve a lo suyo)
    // atasco: yendo a un sitio y sin avanzar 1,5 s, se descarta el camino y se traza otro
    if (this.moving) {
      if ((this.stuckT += dt) > 1.5) {
        if (Math.hypot(this.x - this.stuckAt.x, this.z - this.stuckAt.z) < 0.25) (this.path = []), (this.repath = 0), (this.rest = 0);
        (this.stuckAt = { x: this.x, z: this.z }), (this.stuckT = 0);
      }
    } else (this.stuckT = 0), (this.stuckAt = { x: this.x, z: this.z });
    return s.caught;
  }

  unstick() {
    const m = this.maze, me = this.cellOf(this.x, this.z);
    let best: Cell | undefined, bd = Infinity;
    for (let r = 1; r < 6 && !best; r++)
      for (let y = me.y - r; y <= me.y + r; y++)
        for (let x = me.x - r; x <= me.x + r; x++) {
          if (x < 0 || y < 0 || x >= m.w || y >= m.h || !m.open[y * m.w + x] || this.blocked.has(y * m.w + x)) continue;
          const c = centerOf({ x, y }), d = Math.hypot(c.x - this.x, c.z - this.z);
          if (d < bd) (bd = d), (best = { x, y });
        }
    if (!best) return;
    const c = centerOf(best);
    (this.x = c.x), (this.z = c.z), (this.path = []);
    if (this.insp) (this.insp.h.by = null), (this.insp = undefined), (this.state = 'wander');
  }

  /** Hay un nicho ocupado a <= 2 celdas y a la vista: una vez por pasada, con probabilidad (más si el que está dentro hizo ruido). */
  maybeInspect(hides: HideState[]) {
    for (const h of hides) {
      if (Math.hypot(h.x - this.x, h.z - this.z) > 3 * CELL) this.rolled.delete(h.idx);
      if (!h.occ || h.by || h.cd > 0 || this.rolled.has(h.idx) || Math.hypot(h.x - this.x, h.z - this.z) > HIDE_RANGE) continue;
      if (!seesXZ(this.solid, this.x, this.z, h.fx, h.fz)) continue;
      this.rolled.add(h.idx);
      if (Math.random() > Math.min(0.9, 0.35 + 0.5 * h.occ.noise)) continue;
      this.state = 'inspect';
      this.path = [];
      this.insp = { h, t: 0, walk: 0, bad: 0, dur: INSPECT_T[0] + Math.random() * (INSPECT_T[1] - INSPECT_T[0]) };
      h.by = this;
      return true;
    }
    return false;
  }

  /** Delante del nicho, mirándolo: si el de dentro no contiene la respiración (pasado un instante de margen), lo encuentra. */
  inspect(dt: number, god: boolean): string | undefined {
    const s = this.insp!, h = s.h;
    const stop = () => ((h.by = null), (this.insp = undefined));
    if (!h.occ) {
      // ha salido: lo ve
      stop();
      (this.state = 'chase'), (this.alert = 1), (this.lost = 0), (this.repath = 0), (this.seen = { x: h.fx, z: h.fz });
      return undefined;
    }
    const d = Math.hypot(h.fx - this.x, h.fz - this.z);
    if (d > 0.3 && s.walk < 3) {
      // a la boca, andando
      s.walk += dt;
      const k = Math.min(d, 1.8 * dt) / d;
      this.x += (h.fx - this.x) * k;
      this.z += (h.fz - this.z) * k;
      this.moving = true;
      this.turn(h.fx - this.x, h.fz - this.z, dt);
      return undefined;
    }
    this.turn(h.x - this.x, h.z - this.z, dt);
    if ((s.t += dt) > REACT) s.bad = h.occ.holding ? Math.max(0, s.bad - dt) : s.bad + dt;
    if (s.bad > BAD_T && !god) {
      const id = h.occ.id;
      stop();
      (this.state = 'attack'), (this.phase = 0);
      return id;
    }
    if (s.t > s.dur) {
      // no hay nadie: se marcha
      h.cd = COOL;
      stop();
      (this.state = 'wander'), (this.alert = 0), (this.rest = 1), (this.path = []);
    }
    return undefined;
  }

  /** Girar hacia (tx, tz), a 6 rad/s como mucho. */
  turn(tx: number, tz: number, dt: number) {
    const turn = mod(Math.atan2(tx, tz) - this.facing + Math.PI, TAU) - Math.PI;
    this.facing += Math.sign(turn) * Math.min(Math.abs(turn), dt * 6);
  }

  /** Tras atacar: mira a (x, z) y baila. */
  dance(x: number, z: number) {
    this.state = 'dance';
    this.phase = 0;
    this.facing = Math.atan2(x - this.x, z - this.z);
  }

  /** Un tiro; true si muere. */
  hit() {
    if (!this.alive) return false;
    if (--this.hp > 0) return false;
    if (this.insp) (this.insp.h.by = null), (this.insp = undefined);
    this.alive = false;
    this.state = 'dead';
    return true;
  }
}

/**
 * Los comportamientos: cada uno mira si le toca y, si manda en este paso, devuelve true (los de después no corren).
 * Para uno nuevo: su nombre en BehaviorId, su función aquí y ponerlo en el `brain` de las fichas que lo usen.
 */
const BRAIN: Record<BehaviorId, (e: EntitySim, s: Sense) => boolean> = {
  /** Los nichos: seguir con la inspección, o empezar una si pasa junto a uno ocupado. */
  inspect: (e, s) => {
    if (e.state === 'inspect') return (s.caught = e.inspect(s.dt, s.god)), true;
    return s.hides.length > 0 && e.maybeInspect(s.hides);
  },

  /** Acechar: te ha visto pero no embiste. Quieta bajo el haz (hasta hartarse), se acerca si no, y embiste por la espalda. */
  stalk: (e, s) => {
    const K = e.def.stalk, t = s.tgt;
    if (!K || e.state === 'chase') return false;
    if (!t || e.alert < 0.35) {
      // te ha perdido: va a mirar donde te vio
      if (e.state === 'stalk') (e.heard = { ...e.seen, t: 25 }), e.calm(0, e.alert);
      return false;
    }
    if (e.state !== 'stalk') (e.state = 'stalk'), (e.path = []), (e.phase = 0), (e.repath = 0);
    e.alert = Math.min(e.alert, 0.99);
    const dx = e.x - t.x, dz = e.z - t.z, d = Math.hypot(dx, dz), lit = e.beamed(t);
    const faced = t.yaw !== undefined && d > 1e-6 && (-Math.sin(t.yaw) * dx - Math.cos(t.yaw) * dz) / d > 0.5;
    e.phase = lit ? e.phase + s.dt : Math.max(0, e.phase - s.dt / 2);
    if (e.phase > K.patience || d < 2.5 || (!faced && !lit && d < K.pounce)) return e.hunt(), false; // (sigue en chase)
    if (lit) return e.turn(-dx, -dz, s.dt), true;
    e.track(t.x, t.z);
    e.step(e.path[0], e.def.walk * (faced ? 1 : 2), s.dt);
    return true;
  },

  /** Perseguir hacia donde te vio por última vez; si te pierde `lose` s, lo deja. A REACH m, ataca. */
  chase: (e, s) => {
    const D = e.def;
    if (e.state !== 'chase') {
      if (e.alert < 1) return false;
      e.hunt();
    }
    if (s.rate > 0) e.lost = 0;
    // te ha perdido: aún se acuerda un poco (si vuelve a verte, persigue antes)
    // (si lo último que vio fue a alguien meterse en un nicho, se rinde antes: no se queda plantado esperando a que salga)
    else if ((e.lost += s.dt * (s.hides.some((h) => h.occ && Math.hypot(h.x - e.seen.x, h.z - e.seen.z) < 3 * CELL) ? 3 : 1)) > D.lose) return e.calm(1, 0.5), false;
    e.track(e.seen.x, e.seen.z);
    // en la misma celda que un jugador, directo a él
    const near = s.targets.find((t) => Math.hypot(t.x - e.x, t.z - e.z) < CELL * 1.2 && seesXZ(e.solid, e.x, e.z, t.x, t.z) && !e.blockedAt(t.x, t.z));
    let v = D.run * e.speed;
    if (D.burst) v *= (e.phase += s.dt) % (D.burst.on + D.burst.off) < D.burst.on ? D.burst.k : D.burst.tired;
    e.step(near ?? e.path[0], v, s.dt, !!near);
    if (!s.god) {
      const hit = s.targets.find((t) => Math.hypot(t.x - e.x, t.z - e.z) < REACH && Math.abs(t.y) < 1.2);
      if (hit) (e.state = 'attack'), (e.phase = 0), (s.caught = hit.id);
    }
    return true;
  },

  /** Ir a mirar lo que oyó, a paso ligero; al llegar (o si no hay camino, o se le pasa) lo olvida. */
  search: (e, s) => {
    const h = e.heard;
    if (!h) return false;
    if (e.state !== 'search') (e.state = 'search'), (e.path = []), (e.repath = 0);
    e.track(h.x, h.z);
    if ((h.t -= s.dt) <= 0 || !e.path.length) return (e.heard = undefined), e.calm(3, e.alert), false;
    e.step(e.path[0], e.def.walk * 1.7, s.dt);
    return true;
  },

  /** Lo suyo: de un sitio a otro (ver spot) y allí un rato; a medio darse cuenta de ti, se para y te mira. */
  wander: (e, s) => {
    e.state = 'wander';
    e.maybeTeleport(s.dt, s.targets, s.hides);
    if (!e.path.length && (e.rest -= s.dt) <= 0) (e.path = e.route(e.spot())), (e.rest = e.def.rest[0] + Math.random() * (e.def.rest[1] - e.def.rest[0]));
    const watch = s.tgt ?? s.targets.reduce<SimTarget | undefined>((b, t) => (!b || Math.hypot(t.x - e.x, t.z - e.z) < Math.hypot(b.x - e.x, b.z - e.z) ? t : b), undefined);
    if (e.alert > 0.35 && watch) e.turn(watch.x - e.x, watch.z - e.z, s.dt);
    else e.step(e.path[0], e.def.walk, s.dt);
    return true;
  },
};

/** Los objetos de una partida, sacados del mapa (la misma lista en el servidor y el cliente). */
export interface ItemSpot {
  id: string;
  kind: ItemKind;
  cell: Cell;
  /** Poolrooms: 1 si está en la planta alta (ver Maze.lay); su altura sale de poolCellY(mapa, x, y, 1). */
  floor?: 0 | 1;
}
/**
 * Dónde hay latas de Almond Water: 8 celdas abiertas (antes 5: +50 %), lejos del inicio, del ascensor, de lo demás y unas de otras.
 * Solo depende del mapa (no consume su azar): cliente y servidor sacan las mismas.
 */
export function waterSpots(m: Maze, n = 6): Cell[] {
  if (m.waters) return m.waters; // Poolrooms: ya vienen puestas
  const used = new Set<number>(), key = (c: Cell) => c.y * m.w + c.x;
  [m.start, m.elevator, m.camera, ...(m.pistol ? [m.pistol] : []), ...m.extraGuns, ...m.tapes, ...m.flashlights, ...m.voids, ...m.props.map((p) => p.cell)].forEach((c) => used.add(key(c)));
  const free: Cell[] = [];
  for (let y = 0; y < m.h; y++) for (let x = m.span?.[0] ?? 0; x < (m.span?.[1] ?? m.w); x++) if (m.open[y * m.w + x] && !used.has(y * m.w + x)) free.push({ x, y });
  // orden fijo pero revuelto (un hash de la celda)
  const h = (c: Cell) => Math.imul((c.x * 73856093) ^ (c.y * 19349663) ^ (m.w * 83492791), 0x9e3779b1) >>> 0;
  free.sort((a, b) => h(a) - h(b));
  const far = (a: Cell, b: Cell, k: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= k;
  const out: Cell[] = [];
  for (const c of free) {
    if (out.length >= n) break;
    if (far(c, m.start, 12) && far(c, m.elevator, 6) && [m.camera, ...m.tapes, ...m.flashlights].every((o) => far(c, o, 4)) && out.every((o) => far(c, o, 14))) out.push(c);
  }
  return out;
}

/**
 * El Tótem de la vida: en ~35 % de las partidas (según la semilla) y solo con 2 o más jugadores, una celda abierta lejos del inicio,
 * del ascensor, de lo demás y de las latas. No consume el azar del mapa: cliente y servidor sacan la misma.
 */
export const TOTEM_CHANCE = 0.35;
export function totemSpot(m: Maze, seed: number, players: number): Cell | null {
  if (players < 2 || (Math.imul(seed ^ 0x2545f491, 0x9e3779b1) >>> 0) / 4294967296 >= TOTEM_CHANCE) return null;
  const used = new Set<number>(), key = (c: Cell) => c.y * m.w + c.x;
  const water = waterSpots(m);
  [m.start, m.elevator, m.camera, ...(m.pistol ? [m.pistol] : []), ...m.extraGuns, ...m.tapes, ...m.flashlights, ...water, ...(m.tank ? [m.tank] : []), ...(m.watergun ? [m.watergun] : []), ...m.voids, ...m.props.map((p) => p.cell)].forEach((c) => used.add(key(c)));
  const h = (c: Cell) => Math.imul((c.x * 19349663) ^ (c.y * 73856093) ^ seed, 0x85ebca6b) >>> 0;
  const far = (a: Cell, b: Cell, k: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= k;
  const free: Cell[] = [];
  for (let y = 0; y < m.h; y++) for (let x = m.span?.[0] ?? 0; x < (m.span?.[1] ?? m.w); x++) if (m.open[y * m.w + x] && !used.has(y * m.w + x)) free.push({ x, y });
  free.sort((a, b) => h(a) - h(b));
  return free.find((c) => far(c, m.start, 14) && far(c, m.elevator, 6) && [m.camera, ...m.tapes, ...m.flashlights, ...water].every((o) => far(c, o, 5))) ?? null;
}

/**
 * El radar: uno por mapa, siempre; una celda abierta lejos del inicio, del ascensor y de lo demás (latas y tótem incluidos).
 * Solo depende del mapa: cliente y servidor sacan la misma. Se lo queda quien lo coja (id r0).
 */
export function radarSpot(m: Maze): Cell | null {
  if (m.radar !== undefined) return m.radar; // Poolrooms: ya viene puesto
  const used = new Set<number>(), key = (c: Cell) => c.y * m.w + c.x, water = waterSpots(m), others = [m.camera, ...m.tapes, ...m.flashlights, ...water, ...(m.totem ? [m.totem] : []), ...(m.tank ? [m.tank] : []), ...(m.watergun ? [m.watergun] : [])];
  [m.start, m.elevator, ...others, ...(m.pistol ? [m.pistol] : []), ...m.extraGuns, ...m.voids, ...m.props.map((p) => p.cell)].forEach((c) => used.add(key(c)));
  const h = (c: Cell) => Math.imul((c.x * 83492791) ^ (c.y * 73856093) ^ (m.w * 19349663), 0xc2b2ae35) >>> 0;
  const far = (a: Cell, b: Cell, k: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= k;
  const free: Cell[] = [];
  for (let y = 0; y < m.h; y++) for (let x = m.span?.[0] ?? 0; x < (m.span?.[1] ?? m.w); x++) if (m.open[y * m.w + x] && !used.has(y * m.w + x)) free.push({ x, y });
  free.sort((a, b) => h(a) - h(b));
  return free.find((c) => far(c, m.start, 16) && far(c, m.elevator, 6) && others.every((o) => far(c, o, 4))) ?? free.find((c) => far(c, m.start, 8)) ?? null;
}

/**
 * El botín de valor (ids v…): piezas repartidas por el mapa que solo sirven para venderse en la báscula. Celdas abiertas lejos del inicio,
 * del ascensor y unas de otras. Solo depende del mapa: cliente y servidor sacan las mismas.
 */
export function lootSpots(m: Maze, n = m.lay ? 14 : 7): Cell[] { // (las Poolrooms: el doble)
  const used = new Set<number>(), key = (c: Cell) => c.y * m.w + c.x, rd = radarSpot(m);
  [m.start, m.elevator, m.camera, ...(m.pistol ? [m.pistol] : []), ...m.extraGuns, ...m.tapes, ...m.flashlights, ...waterSpots(m), ...(rd ? [rd] : []), ...(m.tank ? [m.tank] : []), ...(m.watergun ? [m.watergun] : []), ...m.voids, ...m.props.map((p) => p.cell)].forEach((c) => c && used.add(key(c)));
  const free: Cell[] = [];
  for (let y = 0; y < m.h; y++) for (let x = m.span?.[0] ?? 0; x < (m.span?.[1] ?? m.w); x++) if (m.open[y * m.w + x] && !used.has(y * m.w + x)) free.push({ x, y });
  const h = (c: Cell) => Math.imul((c.x * 2654435761) ^ (c.y * 40503) ^ (m.h * 19349663), 0x85ebca6b) >>> 0;
  free.sort((a, b) => h(a) - h(b));
  const far = (a: Cell, b: Cell, k: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= k;
  const out: Cell[] = [];
  for (const c of free) {
    if (out.length >= n) break;
    if (far(c, m.start, 8) && far(c, m.elevator, 4) && out.every((o) => far(c, o, 9))) out.push(c);
  }
  return out;
}

export function itemSpots(m: Maze): ItemSpot[] {
  const out: ItemSpot[] = [], add = (id: string, kind: ItemKind, cell: Cell) => out.push(m.lay ? { id, kind, cell, floor: m.lay[cell.y * m.w + cell.x] ? 1 : 0 } : { id, kind, cell });
  m.tapes.forEach((cell, i) => add('t' + i, 'tape', cell));
  m.flashlights.forEach((cell, i) => add('f' + i, 'flashlight', cell));
  waterSpots(m).forEach((cell, i) => add('w' + i, 'water', cell));
  if (m.totem) add('m0', 'totem', m.totem);
  if (m.tank) add('k0', 'tank', m.tank);
  if (m.watergun) add('p0', 'watergun', m.watergun);
  const rd = radarSpot(m);
  if (rd) add('r0', 'radar', rd);
  (m.gens ?? []).forEach((cell, i) => add('e' + i, 'gen', cell)); // (los cuadros eléctricos: se "cogen" con G para encenderlos)
  add('c', 'camera', m.camera);
  if (m.pistol) add('g', 'gun', m.pistol);
  m.extraGuns.forEach((cell, i) => add('g' + (i + 1), 'gun', cell));
  // una de cada ocho es una taquilla; el 4 % (por celda, fijo para la semilla) es un cargador suelto
  lootSpots(m).forEach((cell, i) => (i % 8 === 7 ? add('l' + i, 'locker', cell) : (cell.x * 7 + cell.y * 13 + m.h * 31) % 25 === 0 ? add('a' + i, 'ammo', cell) : add('v' + i, 'loot', cell)));
  return out;
}
