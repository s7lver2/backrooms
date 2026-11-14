import {
  Breath, levelCaps, seesXZ, CELL, DIFFICULTY, EEH_HOLD, HIT_DAMAGE, EntitySim, TV_REACH, centerOf, generateMaze, poolMaze, generatePools, PK, suitesMaze, hideStates, itemSpots, subOf, solidAt, tickHides, totemSpot, tvPoint, tvSites, NOISE_RUN, NOISE_SHOT, NOISE_DROP, SUITE_L, wrapX,
  type Difficulty, type Inventory, type Ups, type Look, type Mission, type HideState, type EntState, type ItemSpot, type Kind, type Maze, type Noise, type PlayerState, type SimTarget, type WorldSnapshot,
} from '@backrooms/shared';
import { ParkingMatch } from './parking-match';
import { POOL_CELL, poolFloorY, type PoolMap } from '@backrooms/shared';

/*
 * Lo que el servidor sabe de una partida en marcha: el mapa de la semilla, los objetos que quedan, las
 * entidades (su IA es la de shared/sim.ts) y quién ha caído. Todo lo decide aquí; los clientes pintan.
 */

const EYE = 1.62;
const PICK_REACH = 3.6; // m en el suelo: el alcance del cliente (2,4) más lo que se mueve entre mensajes
const SHOT_REACH = 32;
const PHOTO_REACH = 50; // m: 15 del visor por la raíz del zoom máximo, con margen
const PHOTO_COS = Math.cos((24 * Math.PI) / 180); // el visor cierra 12° como mucho; aquí se perdona el doble por la red

export interface Player {
  pillsUntil?: number;
  glassesUntil?: number;
  id: string;
  name: string;
  st: PlayerState;
  dead: boolean;
  lastChat: number;
  lastHit: number;
  /** Ya mandó su primer estado de la partida. */
  seen: boolean;
  /** La cuenta con la que entró (0 = invitado: no acumula nada) y su aspecto, validado por el servidor. */
  uid: number;
  look: Look;
  /** Vida (0–100, sin regeneración) y latas de Almond Water que lleva. */
  hp: number;
  water: number;
  /** Tótems de la vida que lleva, a quién está reviviendo en «Run for your life» (este jugador, muerto, corriendo) y hasta cuándo es inmune al volver. */
  totem: number;
  reviving?: { by: string; at: number };
  immuneUntil?: number;
  /** Admin: munición infinita (el servidor se lo ordena al cliente y lo recuerda entre rondas). */
  infAmmo?: boolean;
  /** Listo en la sala de espera (informativo). */
  ready?: boolean;
  /** Lo que conserva entre rondas (la tienda y lo que trajo del ascensor) y lo que puede llevar ahora (inicio + recogido - soltado): el tope de lo que declara al subir. */
  inv: Inventory;
  cap: Inventory;
  /** Sus mejoras del árbol en esta sala (niveles comprados). */
  ups: Ups;
  /** Ha subido vivo al ascensor: ya no juega (las entidades no lo ven) hasta que acabe la ronda. */
  boarded?: boolean;
  /** Cuándo soltó (o compró) algo por última vez (anti-spam). */
  lastDrop?: number;
  lastBuy?: number;
  /** Fotos de esta partida (ids de entidad ya contados), la última y si lo están inspeccionando ahora. */
  shot?: Set<number>;
  lastPhoto?: number;
  lastSnap?: number;
  inspected?: boolean;
  /** Escondites (los lleva Match): el nicho en que está (-1 ninguno), su aire y el ruido reciente (1 al correr). */
  hide?: number;
  breath?: Breath;
  noise?: number;
  /** Dónde estaba en el paso anterior y su velocidad suavizada (m/s): de ahí sale si corre. */
  px?: number;
  pz?: number;
  vel?: number;
  /** Pistola de agua: estado de mojado/parada (ver applyWet). */
  wet?: WetState;
  /** Pokeball: quién lo tiene encerrado (este jugador, caído, vuelve cuando su dueño la usa, la suelta o muere). */
  ball?: string;
  ballAt?: [number, number];
  /** Nokia: con quién habla, y si él es quien llamó (gasta su batería). */
  call?: string;
  caller?: boolean;
  /** Cuándo usó cada objeto de las Suites (ms) por última vez. */
  toolAt?: Record<string, number>;
}

/** Mojado/parada de quien recibe el chorro (jugador; sirve igual para una entidad). Tiempos en ms de reloj. */
export interface WetState {
  last: number;
  acc: number;
  wetUntil: number;
  stunUntil: number;
  coolUntil: number;
}
const WET_MS = 4000, STUN_MS = 3000, STUN_AFTER = 1200, STUN_COOL = 6000, SQUIRT_REACH = 6, SQUIRT_COS = Math.cos((12 * Math.PI) / 180);
/** Un impacto de chorro en `now`: devuelve el efecto a notificar (o nada). Acumula chorro continuo (huecos > 250 ms lo reinician); tras la parada, enfriamiento. */
export function applyWet(w: WetState, now: number): { kind: 'wet' | 'stun'; ms: number } | undefined {
  w.acc = now - w.last > 250 ? 0 : w.acc + (now - w.last);
  w.last = now;
  if (now < w.stunUntil) return;
  if (w.acc >= STUN_AFTER && now >= w.coolUntil) {
    w.stunUntil = now + STUN_MS;
    w.coolUntil = w.stunUntil + STUN_COOL;
    w.acc = 0;
    return { kind: 'stun', ms: STUN_MS };
  }
  if (now > w.wetUntil - WET_MS + 1000) { // se renueva como mucho una vez por segundo
    w.wetUntil = now + WET_MS;
    return { kind: 'wet', ms: WET_MS };
  }
}

interface Ent {
  id: number;
  sim: EntitySim;
  /** Personal del vestíbulo (no sale de él, ni el del pasillo entra). */
  lobby?: boolean;
  /** Pokeball: las demás entidades son su enemigo hasta `until` (segundos de partida), salvo su dueño `by`; `prev` es lo que era antes. */
  charm?: { until: number; by: string; prev: { passive: boolean; enraged: boolean; roused: boolean } };
}

export class Match {
  parking?: ParkingMatch;
  readonly maze: Maze;
  private items = new Map<string, ItemSpot>();
  private taken = new Set<string>();
  private ents: Ent[] = [];
  /** Los ruidos de este paso (carreras, disparos, objetos que caen): los oyen las entidades. */
  private noises: Noise[] = [];
  noise(x: number, z: number, r: number) {
    if (!this.parking) this.noises.push({ x, z, r });
  }

  curseUntil = 0;
  private poolGeometry?: PoolMap;

  openItemPath(x: number, z: number, y: number) {
    if (this.parking) return this.parking.openItemPath(x, z, y);
    const pool = this.poolGeometry;
    if (pool) {
      const surface = poolFloorY(pool, x, z, y);
      const index = Math.floor(z / POOL_CELL) * pool.w + Math.floor(x / POOL_CELL);
      return !!surface && y >= surface.y && (surface.layer === 1 || y < pool.ceil[index]);
    }
    return !solidAt(this.maze, x, z) && y >= 0 && y < 3;
  }
  private nextId = 1;
  private age = 0;
  /** La misión de la ronda, las televisiones que hay que apagar (de tvSites), las ya apagadas y las fotos válidas (por jugador y entidad) de todos. */
  mission?: Mission;
  tvs: { cell: { x: number; y: number }; rot: number }[] = [];
  readonly tvOff = new Set<number>();
  private photos = 0;
  /** Misión de recepción: artefactos entregados al Faceling. */
  delivered = 0;
  /** Lo que ya valía el contador de la misión al empezarla (las misiones se encadenan en una ronda). */
  private base = 0;
  private readonly hotel: boolean;
  private eehOn = false;
  /** Admin: las entidades se quedan quietas. */
  frozen = false;

  private speed: number;
  private grace: number;
  /** Aguantó una inspección escondido (lo llama tick). */
  onHeld?: (p: Player) => void;
  /** Los nichos de las paredes, con quien hay dentro. */
  readonly hides: HideState[];

  /** Nivel sin entidades (las Poolrooms, mientras no tengan sus propias). */
  private noEnts: boolean;
  /** El mapa por el que andan las entidades (en las Poolrooms, sin la planta alta). */
  private emaze?: Maze;

  constructor(readonly seed: number, difficulty: Difficulty = 'normal', players = 1, readonly levelId = 'level0', floor = 1, round = 2) {
    // la primera ronda de la sala es de rodaje: entidades un 20 % más lentas, 8 s más de gracia y una entidad menos al empezar
    const first = round <= 1;
    this.speed = DIFFICULTY[difficulty].speed * (first ? 0.8 : 1);
    this.grace = DIFFICULTY[difficulty].grace + (first ? 8 : 0);
    const caps = levelCaps(levelId);
    this.noEnts = !caps.ents;
    this.hotel = !!caps.hotel;
    this.maze = caps.hotel ? suitesMaze(seed, floor) : caps.pool ? poolMaze(seed) : generateMaze(seed, players);
    this.maze.totem = this.noEnts ? null : totemSpot(this.maze, seed, players);
    this.hides = hideStates(this.maze);
    const D = DIFFICULTY[difficulty];
    if (levelId !== 'parking') for (const it of itemSpots(this.maze)) this.items.set(it.id, it);
    // el loot según la dificultad: solo lo prescindible (latas, linternas, rifles extra); lo que pide una misión o da una ventaja grande no. Lo quitado cuenta como ya cogido: el cliente no lo pinta
    for (const it of [...this.items.values()]) {
      const n = Number(it.id.slice(1)) || 0;
      if (!caps.pool && (it.kind === 'water' || it.kind === 'flashlight' || (it.kind === 'gun' && it.id !== 'g')) && ((n * 2654435761) >>> 0) / 2 ** 32 >= D.loot) (this.items.delete(it.id), this.taken.add(it.id));
    }
    // al empezar, entidades según la dificultad (alternando bacteria y partygoer), en los arranques más lejanos
    const m = this.maze;
    if (caps.pool) {
      // Poolrooms: una sola entidad, al azar (según la semilla), y solo por la planta baja (la alta no se pisa desde el suelo)
      // la planta baja entera, agua honda incluida (la cruzan nadando); `lay` no sirve: también marca celdas con objeto arriba y suelo abajo
      const gp = this.poolGeometry = generatePools(seed);
      if (m.lay) this.emaze = { ...m, open: gp.kind.map((k) => (k === PK.floor ? 1 : 0)) as unknown as Uint8Array };
      this.spawn(((seed >>> 3) & 1 ? 'partygoer' : 'bacteria') as Kind, m.spawns[0]);
    }
    if (this.hotel) {
      const span = SUITE_L * CELL;
      // el paseante del pasillo (en el centro del bucle; el cliente lo pinta en la copia más cercana)
      this.spawn('faceling', { x: Math.floor((span * 1.5) / CELL), y: Math.floor(12.75 / CELL) }, 1, 3);
      const w = this.ents[this.ents.length - 1].sim;
      (w.z = 12.75), (w.passive = true), (w.patrol = { z: 12.75, dir: 1, v: 1 });
      // el personal: un Faceling de pie en cada sitio donde el cliente pinta uno (suelto, o tras el mostrador)
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const p of m.props) {
        if (p.kind !== 'faceling' && p.kind !== 'reception') continue;
        const c = centerOf(p.cell), [dx, dz] = DIRS[p.rot] ?? DIRS[0], k = p.kind === 'reception' ? -0.95 : 0;
        const x = c.x + (p.off?.[0] ?? 0) + dx * k, z = c.z + (p.off?.[1] ?? 0) + dz * k;
        if (x < span || (x >= 2 * span && x < 3 * span)) continue; // (el pasillo se repite: solo la copia del medio y el vestíbulo)
        this.spawn('faceling', { x: Math.floor(x / CELL), y: Math.floor(z / CELL) }, 1, 3);
        const e = this.ents[this.ents.length - 1].sim;
        (e.x = x), (e.z = z), (e.facing = Math.atan2(dx, dz)), (e.passive = true);
        this.ents[this.ents.length - 1].lobby = x >= 3 * span;
      }
    }
    if (!this.noEnts) for (let i = 0, n = first ? Math.max(1, D.ents - 1) : D.ents; i < n; i++) this.spawn(i % 2 ? 'partygoer' : 'bacteria', m.spawns[i] ?? m.spawns[i % Math.max(1, m.spawns.length)] ?? m.spawns[0]);
  }

  /** Se juega esta misión (la elegida en la pizarra). */
  setMission(m: Mission) {
    this.mission = m;
    if (this.levelId === 'parking') { this.parking = new ParkingMatch(this.seed, m); return; }
    this.eehOn = false;
    this.base = this.raw(m);
    // las cintas solo hay si la misión es encontrarlas (en el hotel hay siempre, por si toca encadenar esa misión)
    if (!this.hotel && m.kind !== 'tapes' && m.kind !== 'soaps') for (const id of [...this.items.keys()]) if (id[0] === 't' && this.items.get(id)?.kind === 'tape') this.items.delete(id);
    this.tvs =m.kind === 'tvs' ? tvSites(this.maze, m.goal) : [];
  }

  /** Se cumplió el fallo del evaporador: el personal vuelve a estar en paz (salvo que lo enfurecieran matando a uno). */
  calmStaff() {
    if (this.vengeance) return;
    for (const q of this.ents) if (q.sim.kind === 'faceling') (q.sim.enraged = q.sim.roused = false), (q.sim.passive = true), (q.sim.path = []), (q.sim.state = 'wander');
  }
  private vengeance = false;
  /** Las nubes de humo de las granadas. */
  private smokes: { x: number; z: number; r: number; fog: number; until: number }[] = [];
  /** Cuánto dura una nube (s). */
  static readonly SMOKE_S = 18;
  private sealed = false;
  private sealT = 0;
  private readonly sealAt = 40 + Math.random() * 80;
  /** La puerta del vestíbulo ha desaparecido. */
  onSeal?: () => void;

  /** Segundos de partida. */
  get elapsed() {
    return this.age;
  }

  /** El progreso de la misión (fotos, cintas, segundos o televisiones apagadas), sin pasar de la meta. */
  get progress() {
    if (this.parking) return this.parking.progress;
    const m = this.mission;
    if (!m) return 0;
    return Math.min(m.goal, this.raw(m) - this.base);
  }

  private raw(m: Mission) {
    return m.kind === 'photos' ? this.photos : m.kind === 'tapes' || m.kind === 'soaps' ? this.tapes : m.kind === 'survive' || m.kind === 'eeh' ? Math.floor(this.age) : m.kind === 'power' ? [...this.taken].filter((id) => id[0] === 'e').length : m.kind === 'order' ? this.delivered : this.tvOff.size;
  }

  /** Apagar la televisión `i`: hay que estar cerca de ella. */
  tv(p: Player, i: number) {
    const s = this.tvs[i];
    if (!s || this.tvOff.has(i) || p.dead || p.boarded) return false;
    const c = tvPoint(s);
    if (Math.hypot(p.st.x - c.x, p.st.z - c.z) > TV_REACH + 1.2) return false;
    this.tvOff.add(i);
    return true;
  }

  /** Dónde empiezan todos. */
  get start() {
    return this.parking?.map.spawn ?? centerOf(this.maze.start);
  }

  private spawn(kind: Kind, at: { x: number; y: number }, speed = 1, hp = 3) {
    const m = this.emaze ?? this.maze;
    this.ents.push({ id: this.nextId++, sim: new EntitySim(kind, m, (x, z) => solidAt(m, x, z), at, speed * this.speed, hp, true) });
  }

  /** Admin: una entidad en una celda abierta cerca de (x, z) (a 3–7 celdas), o en el arranque más lejano si no hay. */
  adminSpawn(kind: Kind, x: number, z: number) {
    if (this.parking) return;
    const m = this.maze, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    const open: { x: number; y: number }[] = [];
    for (let y = Math.max(0, cy - 7); y <= Math.min(m.h - 1, cy + 7); y++)
      for (let xx = Math.max(0, cx - 7); xx <= Math.min(m.w - 1, cx + 7); xx++) {
        const d = Math.max(Math.abs(xx - cx), Math.abs(y - cy));
        if (d >= 3 && m.open[y * m.w + xx]) open.push({ x: xx, y });
      }
    this.spawn(kind, open[(Math.random() * open.length) | 0] ?? m.spawns[0], 1, 3);
  }
  /** Admin: quita todas las entidades. */
  clearEnts() {
    this.ents = [];
  }
  get entCount() {
    return this.ents.length;
  }
  /** Admin: apaga todas las televisiones de la misión. */
  allTvsOff() {
    this.tvs.forEach((_, i) => this.tvOff.add(i));
  }

  /** Las cintas recogidas entre todos. */
  get tapes() {
    let n = 0;
    for (const id of this.taken) if (id[0] === 't') n++;
    return n;
  }

  /** Un paso de la IA (la llaman 20 veces por segundo). `caught` se llama por cada jugador al que alcanza una. */
  tick(dt: number, players: Player[], caught: (p: Player, entityId: number) => void) {
    this.age += dt;
    if (this.parking) {
      const now = Date.now();
      this.parking.frozen = this.frozen;
      this.parking.skinwalkers.speedBonus = now < this.curseUntil ? .5 : 0;
      this.parking.tick(dt, players, now, p => caught(p, -1));
      return;
    }
    // misión EEH: el evaporador falla a su hora y entran las entidades (partygoers y una bacteria, por los arranques más lejanos)
    if (this.mission?.kind === 'eeh' && !this.eehOn && this.age - this.base >= this.mission.goal - EEH_HOLD) {
      this.eehOn = true;
      for (const q of this.ents) q.sim.kind === 'faceling' && q.sim.rage(); // el evaporador falla: el personal, que estaba en paz, va a por todos
    }
    // la puerta doble del vestíbulo desaparece a una hora al azar, cuando todos los vivos están ya en el pasillo: el bucle queda cerrado (ya no hay vuelta atrás)
    if (this.hotel && !this.sealed) {
      const alive = players.filter((p) => !p.dead && !p.boarded);
      this.sealT = alive.length && alive.every((p) => p.st.x < 3 * SUITE_L * CELL - 3) ? this.sealT + dt : 0;
      if (this.sealT >= this.sealAt) {
        this.sealed = true;
        for (const y of [8, 9]) this.maze.open[y * this.maze.w + SUITE_L * 3] = 0;
        this.ents = this.ents.filter((e) => !e.lobby);
        this.onSeal?.();
      }
    }
    const targets: SimTarget[] = [];
    this.smokes = this.smokes.filter((q) => q.until > this.age);
    const fogAt = (x: number, z: number) => this.smokes.reduce((f, q) => (this.far({ x, z }, q) < q.r ? Math.max(f, q.fog) : f), 0);
    this.hiding(dt, players);
    const hidden = this.age > this.grace ? this.hides.filter((h) => h.occ) : [];
    if (this.age > this.grace) {
      for (const p of players) {
        if (p.dead || p.boarded || !p.seen || (p.hide ?? -1) >= 0 || (p.immuneUntil ?? 0) > Date.now()) continue; // (inmune: recién vuelto con el Tótem)
        const s = p.st, cx = Math.floor(s.x / CELL), cy = Math.floor(s.z / CELL), m = this.maze;
        const cp = Math.cos(s.pitch);
        targets.push({
          id: p.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, ex: s.x, ey: s.y + EYE - (s.duck ? 0.6 : 0), ez: s.z, duck: !!s.duck,
          torch: s.light ? [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp] : null,
          exposed: cx >= 0 && cy >= 0 && cx < m.w && cy < m.h && !!m.lit[cy * m.w + cx],
          fog: fogAt(s.x, s.z) || undefined,
        });
      }
    }
    const noises = this.age > this.grace ? this.noises : [];
    this.noises = [];
    for (const e of this.frozen ? [] : [...this.ents]) {
      if (!this.ents.includes(e)) continue; // (otra entidad, hechizada, acaba de matarla)
      e.sim.blind = fogAt(e.sim.x, e.sim.z);
      let tg = targets;
      if (e.charm) {
        if (this.age >= e.charm.until) (Object.assign(e.sim, e.charm.prev), (e.sim.path = []), (e.charm = undefined));
        else {
          // hechizada: a por todo lo que no sea su dueño, entidades incluidas
          const by = e.charm.by;
          e.sim.passive = false;
          e.sim.enraged = true;
          tg = [...targets.filter((t) => t.id !== by), ...this.ents.filter((o) => o !== e && o.sim.alive).map((o) => ({ id: '#' + o.id, x: o.sim.x, y: 0, z: o.sim.z, ex: o.sim.x, ey: o.sim.height * 0.85, ez: o.sim.z, torch: null, exposed: true }))];
        }
      }
      e.sim.speedBonus = Date.now() < this.curseUntil ? .5 : 0;
      const id = e.sim.update(dt, tg, false, hidden, noises);
      if (this.hotel) {
        const x = e.lobby ? Math.max(e.sim.x, 3 * SUITE_L * CELL + 0.6) : wrapX(e.sim.x); // (el del vestíbulo no pasa al pasillo; el del pasillo, como los jugadores, siempre en la copia del medio)
        if (x !== e.sim.x) (e.sim.x = x), (e.sim.path = []);
      }
      if (id === undefined) continue;
      if (id[0] === '#') {
        // una hechizada alcanza a otra entidad: 2 de daño
        const i = this.ents.findIndex((o) => o.id === Number(id.slice(1)));
        e.sim.state = 'attack';
        if (i >= 0 && (this.ents[i].sim.hit(), this.ents[i].sim.hit() || !this.ents[i].sim.alive)) this.down(i, { st: e.sim });
        continue;
      }
      const p = players.find((q) => q.id === id);
      if (!p || p.dead || p.boarded) continue;
      if (e.sim.kind === 'faceling') console.log(`[staff] un Faceling mata a ${p.id}: enraged=${e.sim.enraged} roused=${e.sim.roused} vengeance=${this.vengeance} eehOn=${this.eehOn} estado=${e.sim.state} mision=${this.mission?.kind}`);
      // un golpe quita vida; muere con la vida a cero o si lo pillan en un nicho (sin salida)
      p.hp = (p.hide ?? -1) >= 0 || e.sim.kind === 'faceling' ? 0 : Math.max(0, p.hp - HIT_DAMAGE); // (el personal no deja heridos)
      e.sim.state = 'attack'; // ataca y vuelve a lo suyo (ver recover)
      if (p.hp > 0) continue; // sigue vivo
      p.dead = true;
      caught(p, e.id);
    }
  }

  snapshot(): WorldSnapshot {
    if (this.parking) {
      const parking = this.parking.snapshot();
      return { parking, ents: [], taken: parking.tapes, tapes: parking.tapes.length };
    }
    return {
      ents: this.ents.map((e) => ({ id: e.id, kind: e.sim.kind, x: e.sim.x, z: e.sim.z, yaw: e.sim.facing, state: e.sim.state, hp: e.sim.hp, speed: e.sim.speed }) satisfies EntState),
      taken: [...this.taken],
      tapes: this.tapes,
      ...(this.vengeance ? { vengeance: true } : {}),
      insp: this.hides.filter((h) => h.by && h.occ).map((h) => h.occ!.id),
      ...(this.tvs.length ? { tvOff: [...this.tvOff] } : {}),
    };
  }

  /** ¿Puede estar escondido en (x, z)? Dentro de un nicho que no ocupa otro. */
  hideOk(p: Player, st: PlayerState) {
    return !p.dead && this.hides.some((h) => Math.hypot(h.x - st.x, h.z - st.z) < 1 && (!h.occ || h.occ.id === p.id));
  }

  /**
   * Quién está en qué nicho: lo que el cliente dice (`hiding`) solo vale si está dentro de uno libre. Su aire
   * lo lleva el servidor (con algo más de margen que el cliente, por la red) y de ahí sale si de verdad contiene.
   */
  private hiding(dt: number, players: Player[]) {
    tickHides(this.hides, dt);
    for (const p of players) {
      const st = p.st, b = (p.breath ??= new Breath());
      // corre si va a más de 2,6 m/s (anda a 1,6 y corre a 3,6); un salto de posición (teletransporte) no cuenta
      const v = Math.hypot(st.x - (p.px ?? st.x), st.z - (p.pz ?? st.z)) / dt;
      (p.px = st.x), (p.pz = st.z), (p.vel = v > 12 ? 0 : (p.vel ?? 0) + (v - (p.vel ?? 0)) * 0.2);
      const ran = p.vel > 2.6 && !p.dead && !p.boarded;
      p.noise = ran ? 1 : Math.max(0, (p.noise ?? 0) - dt / 8);
      if (ran && (p.hide ?? -1) < 0) this.noise(st.x, st.z, NOISE_RUN);
      const want = !p.dead && p.seen && st.hiding ? this.hides.findIndex((h) => Math.hypot(h.x - st.x, h.z - st.z) < 1 && (!h.occ || h.occ.id === p.id)) : -1;
      const was = p.hide ?? -1;
      if (was !== want) {
        if (this.hides[was]?.occ?.id === p.id) this.hides[was].occ = null; // (was puede venir de la partida anterior)
        if (want >= 0) (this.hides[want].occ = { id: p.id, holding: false, noise: p.noise }), b.reset();
        p.hide = want;
      }
      if (st.hiding && want < 0) st.hiding = st.holding = false;
      // una inspección que acaba con él aún dentro y vivo (la entidad se marcha): la aguantó
      if (want >= 0 && this.hides[want].by && this.hides[want].occ?.id === p.id) p.inspected = true;
      else {
        if (p.inspected && want >= 0 && !p.dead) this.onHeld?.(p);
        p.inspected = false;
      }
      if (want >= 0) {
        const occ = this.hides[want].occ!;
        occ.holding = b.step(dt, !!st.holding, 1.2);
        occ.noise = p.noise;
      }
    }
  }

  /** La celda de un objeto del mapa que sigue ahí (de ella sale su rareza). */
  cellOf(id: string) {
    return this.taken.has(id) ? undefined : this.items.get(id)?.cell;
  }

  /** Recoger un objeto: el primero en llegar se lo lleva; hay que estar cerca de donde está. */
  pickup(p: Player, id: string) {
    const it = this.items.get(id);
    if (!it || this.taken.has(id) || p.dead) return false;
    const c = centerOf(it.cell);
    if (Math.hypot(p.st.x - c.x, p.st.z - c.z) > PICK_REACH) return false;
    this.taken.add(id);
    if (id[0] === 'e') this.ents.forEach((q) => q.sim.kind === 'faceling' && q.sim.rouse(c.x, c.z)); // un cuadro de luz encendido: el personal va a mirar
    return true;
  }

  /** Distancia en el plano entre un jugador y una entidad (en el hotel, el pasillo se repite: la copia más cercana). */
  private far(a: { x: number; z: number }, b: { x: number; z: number }) {
    const span = SUITE_L * CELL;
    let dx = a.x - b.x;
    if (this.hotel && a.x < 3 * span && b.x < 3 * span) dx = ((((dx + span / 2) % span) + span) % span) - span / 2;
    return Math.hypot(dx, a.z - b.z);
  }

  /** Un tiro a una entidad: se acepta si va con el rifle y está a tiro; muere al llegar su hp a cero (true) y otra la sustituye. */
  hit(p: Player, entityId: number) {
    const i = this.ents.findIndex((e) => e.id === entityId);
    if (i < 0 || p.dead || p.boarded || !p.cap.gun || p.st.held !== 'gun') return false;
    const e = this.ents[i];
    if (this.far(p.st, e.sim) > SHOT_REACH) return false;
    this.noise(p.st.x, p.st.z, NOISE_SHOT);
    if (!e.sim.hit()) return false;
    this.down(i, p);
    return true;
  }

  /** Una entidad muerta: sale, y la siguiente entra en el arranque más lejano de quien la mató (15 % más rápida y un tiro más). */
  private down(i: number, p: { st: { x: number; z: number } }) {
    const e = this.ents[i];
    this.ents.splice(i, 1);
    if (e.sim.kind === 'faceling') return void ((this.vengeance = true), this.ents.forEach((q) => q.sim.rage())); // matan a uno del personal: van todos a por vosotros
    if (this.noEnts) return;
    const far = [...this.maze.spawns].sort((a, b) => dist(centerOf(b), p.st) - dist(centerOf(a), p.st))[0];
    this.spawn(e.sim.kind === 'bacteria' ? 'partygoer' : 'bacteria', far, Math.min(1.2, (e.sim.speed / this.speed) * 1.1), e.sim.hp0 + 1);
  }

  /** Estallido del rifle: las entidades a ≤ `r` m reciben 2 de daño. */
  blast(x: number, z: number, r: number, p: Player) {
    for (const e of [...this.ents]) if (this.far({ x, z }, e.sim) <= r && (e.sim.hit(), e.sim.hit() || !e.sim.alive)) this.down(this.ents.indexOf(e), p);
  }

  /**
   * Una foto que vale: con la cámara en la mano, a una entidad viva delante (en el cono del visor), a la vista y a tiro, y que no
   * se haya contado ya en esta partida. El cliente decide el encuadre fino (zoom); aquí se comprueba lo grueso. Devuelve su id.
   */
  photo(p: Player): number | undefined {
    const now = Date.now();
    if (p.dead || p.boarded || !p.cap.camera || p.st.held !== 'camera' || now - (p.lastPhoto ?? 0) < 800) return undefined;
    p.lastPhoto = now;
    const s = p.st, fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), m = this.maze;
    for (const e of this.ents) {
      if (p.shot?.has(e.id) || !e.sim.alive) continue;
      const dx = e.sim.x - s.x, dz = e.sim.z - s.z, d = Math.hypot(dx, dz);
      if (d > PHOTO_REACH || (d > 1 && (dx * fx + dz * fz) / d < PHOTO_COS) || !seesXZ((x, z) => solidAt(m, x, z), s.x, s.z, e.sim.x, e.sim.z)) continue;
      (p.shot ??= new Set()).add(e.id);
      this.photos++;
      return e.id;
    }
  }

  /** Un chorro de la pistola de agua: moja al jugador más cercano dentro del cono (6 m, ±12°). Devuelve a quién y el efecto, si lo hay. */
  squirt(p: Player, players: Player[], a: { x: number; z: number; yaw: number }, now = Date.now()) {
    if (p.dead || p.boarded || !p.cap.watergun) return;
    const near = Math.hypot(a.x - p.st.x, a.z - p.st.z) < 3, x = near ? a.x : p.st.x, z = near ? a.z : p.st.z;
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    let best: Player | undefined, bd = SQUIRT_REACH;
    for (const q of players) {
      if (q === p || q.dead || q.boarded || !q.seen) continue;
      const dx = q.st.x - x, dz = q.st.z - z, d = Math.hypot(dx, dz);
      if (d < bd && (d < 0.3 || (dx * fx + dz * fz) / d >= SQUIRT_COS)) (bd = d), (best = q);
    }
    if (!best) return;
    const ev = applyWet((best.wet ??= { last: 0, acc: 0, wetUntil: 0, stunUntil: 0, coolUntil: 0 }), now);
    return ev && { to: best, ev };
  }

  // ── los cuatro objetos de las Suites ──

  /** Pokeball: lo primero que toca en su vuelo (`pts`). Una entidad queda hechizada `secs` s (devuelve su tipo); un jugador, en `player`. `at` es dónde cae. */
  ballHit(p: Player, players: Player[], pts: number[], secs: number) {
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      for (const q of players) if (q !== p && !q.dead && !q.boarded && q.seen && Math.hypot(q.st.x - x, q.st.z - z) < 0.8 && y - q.st.y > 0 && y - q.st.y < 2) return { player: q, at: [x, z] as [number, number] };
      for (const e of this.ents)
        if (e.sim.alive && Math.hypot(e.sim.x - x, e.sim.z - z) < 0.9 && y < 2.2) {
          e.charm = { until: this.age + secs, by: p.id, prev: e.charm?.prev ?? { passive: e.sim.passive, enraged: e.sim.enraged, roused: e.sim.roused } };
          return { ent: e.sim.kind, at: [e.sim.x, e.sim.z] as [number, number] };
        }
    }
    return { at: [pts[pts.length - 3], pts[pts.length - 1]] as [number, number] };
  }

  /** Granada de humo caída en (x, z): nube de radio `r`, ruido de `noise` m y daño de impacto `dmg` a lo que esté debajo. */
  grenade(p: Player, x: number, z: number, o: { r: number; dmg: number; fog: number; noise: number }) {
    this.smokes.push({ x, z, r: o.r, fog: o.fog, until: this.age + Match.SMOKE_S });
    this.noise(x, z, o.noise);
    for (const e of [...this.ents])
      if (this.far({ x, z }, e.sim) < 1.6 && (e.sim.hp -= o.dmg) <= 0) {
        e.sim.hp = 1;
        if (e.sim.hit()) this.down(this.ents.indexOf(e), p);
      }
  }

  /** Bate: lo que hay delante a ≤ 2,6 m sale despedido `force` m. Las entidades se mueven aquí (y caen al vacío si lo pisan); a los jugadores los empuja su cliente. */
  bat(p: Player, players: Player[], yaw: number, force: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), pushed: Player[] = [];
    let hit = false;
    const inCone = (x: number, z: number) => {
      const dx = x - p.st.x, dz = z - p.st.z, d = Math.hypot(dx, dz);
      return d <= 2.6 && (d < 0.4 || (dx * fx + dz * fz) / d >= 0.55);
    };
    for (const q of players) if (q !== p && !q.dead && !q.boarded && inCone(q.st.x, q.st.z)) (pushed.push(q), (hit = true));
    for (const e of [...this.ents]) {
      if (!e.sim.alive || !inCone(e.sim.x, e.sim.z)) continue;
      hit = true;
      if (this.shove(e, fx, fz, force)) this.down(this.ents.indexOf(e), p);
    }
    this.noise(p.st.x, p.st.z, NOISE_DROP);
    return { pushed, hit, fx, fz };
  }

  /** Empuja una entidad `len` m hacia (dx, dz) hasta una pared; true si acaba sobre un hueco (cae). */
  private shove(e: Ent, dx: number, dz: number, len: number) {
    const m = this.maze, n = Math.ceil(len / 0.3);
    for (let i = 0; i < n; i++) {
      const x = e.sim.x + (dx * len) / n, z = e.sim.z + (dz * len) / n;
      if (solidAt(m, x, z)) break;
      (e.sim.x = x), (e.sim.z = z);
    }
    e.sim.path = [];
    const c = e.sim.cellOf(e.sim.x, e.sim.z);
    return m.voids.some((v) => v.x === c.x && v.y === c.y);
  }

  /** Entrar en el ascensor (abierto: la misión está cumplida). */
  canBoard(p: Player) {
    if (this.parking) return this.parking.canBoard(p);
    const c = centerOf(this.maze.elevator);
    return !p.dead && !p.boarded && Math.hypot(p.st.x - c.x, p.st.z - c.z) < 2.5;
  }

  /** Ha caído al vacío de verdad (no un salto). */
  fell(p: Player) {
    if (p.dead || p.st.y >= -1) return false;
    p.hp = 0;
    return true;
  }
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
