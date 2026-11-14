import {
  Breath, levelCaps, seesXZ, CELL, DIFFICULTY, HIT_DAMAGE, EntitySim, TV_REACH, centerOf, generateMaze, poolMaze, hideStates, itemSpots, solidAt, tickHides, totemSpot, tvPoint, tvSites, NOISE_RUN, NOISE_SHOT,
  type Difficulty, type Inventory, type Look, type Mission, type HideState, type EntState, type ItemSpot, type Kind, type Maze, type Noise, type PlayerState, type SimTarget, type WorldSnapshot,
} from '@backrooms/shared';
import { ParkingMatch } from './parking-match';

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
  /** Ha subido vivo al ascensor: ya no juega (las entidades no lo ven) hasta que acabe la ronda. */
  boarded?: boolean;
  /** Cuándo soltó (o compró) algo por última vez (anti-spam). */
  lastDrop?: number;
  lastBuy?: number;
  /** Fotos de esta partida (ids de entidad ya contados), la última y si lo están inspeccionando ahora. */
  shot?: Set<number>;
  lastPhoto?: number;
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
    this.noises.push({ x, z, r });
  }
  private nextId = 1;
  private age = 0;
  /** La misión de la ronda, las televisiones que hay que apagar (de tvSites), las ya apagadas y las fotos válidas (por jugador y entidad) de todos. */
  mission?: Mission;
  tvs: { cell: { x: number; y: number }; rot: number }[] = [];
  readonly tvOff = new Set<number>();
  private photos = 0;
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

  constructor(readonly seed: number, difficulty: Difficulty = 'normal', players = 1, readonly levelId = 'level0') {
    this.speed = DIFFICULTY[difficulty].speed;
    this.grace = DIFFICULTY[difficulty].grace;
    const caps = levelCaps(levelId);
    this.noEnts = !caps.ents;
    this.maze = caps.pool ? poolMaze(seed) : generateMaze(seed, players);
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
    if (!this.noEnts) for (let i = 0; i < D.ents; i++) this.spawn(i % 2 ? 'partygoer' : 'bacteria', m.spawns[i] ?? m.spawns[i % Math.max(1, m.spawns.length)] ?? m.spawns[0]);
  }

  /** Se juega esta misión (la elegida en la pizarra). */
  setMission(m: Mission) {
    this.mission = m;
    if (this.levelId === 'parking') { this.parking = new ParkingMatch(this.seed, m); return; }
    // las cintas solo hay si la misión es encontrarlas
    if (m.kind !== 'tapes' && m.kind !== 'soaps') for (const id of [...this.items.keys()]) if (id[0] === 't' && this.items.get(id)?.kind === 'tape') this.items.delete(id);
    this.tvs =m.kind === 'tvs' ? tvSites(this.maze, m.goal) : [];
  }

  /** Segundos de partida. */
  get elapsed() {
    return this.age;
  }

  /** El progreso de la misión (fotos, cintas, segundos o televisiones apagadas), sin pasar de la meta. */
  get progress() {
    if (this.parking) return this.parking.progress;
    const m = this.mission;
    if (!m) return 0;
    const v = m.kind === 'photos' ? this.photos : m.kind === 'tapes' || m.kind === 'soaps' ? this.tapes : m.kind === 'survive' ? Math.floor(this.age) : this.tvOff.size;
    return Math.min(m.goal, v);
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

  private spawn(kind: Kind, at: { x: number; y: number }, speed = 1, hp = 1) {
    const m = this.maze;
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
    this.spawn(kind, open[(Math.random() * open.length) | 0] ?? m.spawns[0], 1, 1);
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
    if (this.parking) { this.parking.frozen=this.frozen; this.parking.tick(dt, players, Date.now(), p=>caught(p,-1)); return; }
    const targets: SimTarget[] = [];
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
        });
      }
    }
    const noises = this.age > this.grace ? this.noises : [];
    this.noises = [];
    for (const e of this.frozen ? [] : this.ents) {
      const id = e.sim.update(dt, targets, false, hidden, noises);
      if (id === undefined) continue;
      const p = players.find((q) => q.id === id);
      if (!p) continue;
      // un golpe quita vida; muere con la vida a cero o si lo pillan en un nicho (sin salida)
      p.hp = (p.hide ?? -1) >= 0 ? 0 : Math.max(0, p.hp - HIT_DAMAGE);
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

  /** Recoger un objeto: el primero en llegar se lo lleva; hay que estar cerca de donde está. */
  pickup(p: Player, id: string) {
    const it = this.items.get(id);
    if (!it || this.taken.has(id) || p.dead) return false;
    const c = centerOf(it.cell);
    if (Math.hypot(p.st.x - c.x, p.st.z - c.z) > PICK_REACH) return false;
    this.taken.add(id);
    return true;
  }

  /** Un tiro a una entidad: se acepta si va con el rifle y está a tiro; muere al llegar su hp a cero (true) y otra la sustituye. */
  hit(p: Player, entityId: number) {
    const i = this.ents.findIndex((e) => e.id === entityId);
    if (i < 0 || p.dead || p.st.held !== 'gun') return false;
    const e = this.ents[i];
    if (Math.hypot(p.st.x - e.sim.x, p.st.z - e.sim.z) > SHOT_REACH) return false;
    this.noise(p.st.x, p.st.z, NOISE_SHOT);
    if (!e.sim.hit()) return false;
    this.ents.splice(i, 1);
    if (this.noEnts) return true;
    // la siguiente, en el arranque más lejano del que disparó: 15 % más rápida y un tiro más
    const far = [...this.maze.spawns].sort((a, b) => dist(centerOf(b), p.st) - dist(centerOf(a), p.st))[0];
    this.spawn(e.sim.kind === 'bacteria' ? 'partygoer' : 'bacteria', far, Math.min(1.2, (e.sim.speed / this.speed) * 1.1), e.sim.hp0 + 1);
    return true;
  }

  /**
   * Una foto que vale: con la cámara en la mano, a una entidad viva delante (en el cono del visor), a la vista y a tiro, y que no
   * se haya contado ya en esta partida. El cliente decide el encuadre fino (zoom); aquí se comprueba lo grueso. Devuelve su id.
   */
  photo(p: Player): number | undefined {
    const now = Date.now();
    if (p.dead || p.st.held !== 'camera' || now - (p.lastPhoto ?? 0) < 800) return undefined;
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
