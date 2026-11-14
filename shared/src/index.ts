import type { ParkingInteraction, ParkingSnapshot } from './parking';
/** Lo que comparten el cliente y el servidor: los puertos fijos, el protocolo de las salas y la lógica de la partida. */
export * from './maze';
export * from './pools';
export * from './suites';
export * from './lockers';
export * from './sim';
export * from './behaviors';
export * from './progress';
export * from './missions';
export * from './caps';
export * from './parking';
export * from './parking-skinwalker-ai';
export * from './parking-smiler-ai';
export * from './upgrades';
import type { EntState, Kind } from './sim';
import type { Look } from './progress';
import type { LevelCaps } from './caps';
import type { ActiveMission, Drop, Inventory, ItemId, MissionOffer, Qual, RoundResult } from './missions';
import { EMOTE_DEFS } from './progress';
import type { LockerItem } from './lockers';
import type { UpId, Ups } from './upgrades';

export const CLIENT_PORT = 5180;
export const SERVER_PORT = 5181;

export const MAX_PLAYERS = 8;
/** Jugadores de una sala nueva si no se dice otra cosa. */
export const DEFAULT_PLAYERS = 4;
/** Cinta de acordonar: tramos continuos por el suelo. Cada jugador puede tener STRIP_MAX a la vez (al pasar, se va el más viejo). */
export const STRIP_MAX = 4;
/** Puntos por tramo y metros mínimos entre dos puntos seguidos. */
export const STRIP_PTS = 60;
export const STRIP_GAP = 0.4;
/** Un tramo: la lista de puntos (x, z, x, z...) por donde se fue tendiendo, en el orden en que se hizo (los chevrones apuntan hacia el final). */
export interface Strip {
  id: string;
  owner: string;
  pts: number[];
}
export const NAME_MAX = 16;
export const CHAT_MAX = 200;
/** Vida: el máximo y lo que quita cada golpe de una entidad (dos matan). */
export const HP_MAX = 100;
/** Almond Water: la fracción (0–1) de vida, aguante y cordura que devuelve una lata. */
export const WATER_HEAL = 0.4;
export const HIT_DAMAGE = 60;
/** Tótem de la vida: ms de inmunidad al volver y lo mínimo (ms) que puede tardar en acabarse el nivel «Run for your life» (anti-trampas). */
export const REVIVE_IMMUNE = 3000;
export const REVIVE_MIN = 30000;
/** Milisegundos mínimos entre dos mensajes de chat de un jugador. */
export const CHAT_GAP = 500;
/** Cintas repartidas por el mapa (la misión «FIND TAPES» pide algunas de ellas). */
export const TAPES_NEEDED = 8;

/** Lo que cada jugador manda ~15 veces por segundo (el servidor lo reparte a su sala; también en la sala de espera). */
export interface PlayerState {
  /** Cuenta de saltos del bucle de Las Suites (`wrapX`): al subir, el servidor acepta el salto de posición sin recortarlo. */
  tp?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** El clip que lleva puesto el cuerpo (andar, correr, quieto...). */
  anim: string;
  /** La linterna está encendida. */
  light: boolean;
  /** Lo que lleva en la mano derecha. */
  held: 'none' | 'camera' | 'gun';
  /** Agachado: las entidades te ven de menos lejos. */
  duck?: boolean;
  /** Poolrooms: lleva la bombona de buceo a la espalda. */
  tank?: boolean;
  /** Poolrooms: ms restantes de «sin señal» del radar (lo pone el cliente al usar un túnel sin fondo; ver docs/poolrooms.md §11). */
  jam?: number;
  /** Solo en la sala de espera: 0 nada, 1 saludar, 2 señalar, 3 aplaudir, 4 sentarse. */
  emote?: number;
  /** Baile de victoria que está bailando (id de client/src/game/anim/dances.json); vacío = ninguno. */
  dance?: string;
  /** Variante de animación que lleva puesta (cosmético: id de anim/variants.json). */
  variant?: string;
  /** Escondido en un nicho de la pared (x, z son los del nicho). El servidor lo valida. */
  hiding?: boolean;
  /** Mantiene la respiración (Space) mientras está escondido; el servidor lo devuelve ya con el aire. */
  holding?: boolean;
  /**
   * Cuándo se tomó este estado, en ms del reloj de quien lo manda (performance.now()). El servidor lo reenvía tal cual:
   * quien lo recibe reconstruye el ritmo del emisor aunque los paquetes lleguen en ráfaga o tarde (ver client/src/game/interp.ts).
   */
  t?: number;
  /** Vida (0–100). La pone el servidor al repartir los estados; lo que mande el cliente se ignora. */
  hp?: number;
}
/** Emotes de la sala de espera (teclas 1–4) y los ms mínimos entre dos cambios de uno. */
export const EMOTES: readonly string[] = ['', ...EMOTE_DEFS.map((e) => e.name)];
export const EMOTE_GAP = 200;

/** `starting`: el propietario ha pulsado el botón y la puerta se abre (START_DELAY ms) antes de que empiece la partida. */
export type Phase = 'lobby' | 'starting' | 'playing' | 'over';
/** Lo que dura la entrada por la puerta (ms) entre el botón y la partida. */
export const START_DELAY = 7500;
/** Al acabar la entrada se vota la misión: ms que dura la votación (se cierra antes si han votado todos) y ms extra que se espera a que todos hayan cargado el nivel. */
export const VOTE_TIME = 15000;
export const LOAD_GRACE = 12000;
/**
 * La sala de espera 3D: 9 × 7 m centrada en el origen (x a lo ancho, z a lo largo; el suelo, en y = 0). En la
 * fase `lobby` y `starting`, las posiciones de los jugadores son de esta sala; el servidor las recorta a la caja.
 */
export const WAIT_HALF = { x: 4.5, z: 3.5 };
/** Dónde aparece cada jugador (por orden en la sala): en fila frente a la puerta, mirando a -z. */
export const WAIT_SPAWNS = [-2.25, -0.75, 0.75, 2.25].flatMap((x) => [{ x, z: 0.2 }, { x, z: 1.4 }]); // hasta 8, en dos filas en medio de la sala, lejos de los muebles de las paredes
export type Difficulty = 'easy' | 'normal' | 'hard';
/**
 * Lo que mueve cada dificultad: entidades más o menos rápidas, tiempo sin que ataquen al empezar (s), vida de la linterna (s; balance: un 40 % menos que antes, 140/90/60),
 * cuántas entidades hay al empezar, qué parte de las latas, linternas y rifles extra del mapa queda (loot) y cuánto paga cada misión (money).
 */
export const DIFFICULTY: Record<Difficulty, { speed: number; grace: number; life: number; ents: number; loot: number; money: number }> = {
  easy: { speed: 0.75, grace: 16, life: 84, ents: 1, loot: 1, money: 0.75 },
  normal: { speed: 0.88, grace: 10, life: 54, ents: 2, loot: 0.8, money: 1 },
  hard: { speed: 0.95, grace: 6, life: 36, ents: 3, loot: 0.5, money: 1.5 },
};
export const ROOM_NAME_MAX = 20;
/** Lo que el propietario puede cambiar de la sala (en el lobby). */
export interface RoomSettings {
  name: string;
  public: boolean;
  max: number;
  difficulty: Difficulty;
  /** 0 = aleatoria. */
  fixedSeed: number;
}
export interface Room extends RoomSettings {
  code: string;
  /** Contador de «cinta» de la lista (un número de la sala, por estética). */
  tape: number;
  ownerId: string;
  phase: Phase;
  /** 0 hasta que el propietario da a EMPEZAR. */
  seed: number;
  /** Saldo común del equipo (dinero). Sube con las recompensas, baja con las compras y las penalizaciones. */
  bank: number;
  /** Número de la ronda (1 la primera; sube al volver al lobby). */
  round: number;
  /** El nivel de la ronda (clave de LEVELS en shared/missions.ts). */
  levelId: string;
  /** Las Suites: la planta de la ronda (1-5). */
  floor?: number;
  /** Las Suites: encargos del contrato votado (1, 3 o 5; 0 = aún sin contrato) y los ya cumplidos. El -1 del ascensor solo sale con `jobs >= quota`. */
  quota?: number;
  jobs?: number;
  /** Capacidades del nivel (levelCaps(levelId)): qué componentes del jugador están activos. */
  caps: LevelCaps;
  /** Fase `starting`: las 3 misiones a votar con sus votos. Vacío en las demás fases. */
  offers: MissionOffer[];
  /** `starting`: la misión que ganaría ahora (la más votada; sin votos, la primera). El empate real se sortea al cerrar la votación. */
  leading: string;
  /** `starting`, ya abierta la votación (acabada la entrada por la puerta): ms que le quedan (cuenta atrás local desde este valor; 0 = cerrada, el servidor espera a la carga) y quiénes ya han cargado el nivel. Null si no. */
  vote: { left: number; loaded: string[] } | null;
  /** La misión elegida (al cerrarse la votación) con su progreso; `done` = el ascensor está abierto. Null en el lobby y mientras se vota. */
  mission: ActiveMission | null;
  /** Partida, tras subir el primero: segundos que quedan para cerrar la ronda (cuenta atrás local desde este valor) y quiénes han subido. Null si nadie ha subido. */
  ascent: { left: number; boarded: string[] } | null;
}
export interface Member {
  id: string;
  name: string;
  dead: boolean;
  /** Su aspecto: el de su cuenta (lo valida el servidor) o, siendo invitado, un color gratis. */
  look: Look;
  /** Su foto de perfil: `<id>?v=<versión>` para GET /api/avatar/...; vacío si no tiene. */
  avatar: string;
  /** Marcó que está listo en la sala de espera (solo informativo: empieza el propietario). */
  ready: boolean;
  /** Sus mejoras del árbol en esta sala (niveles comprados; ver upgrades.ts). */
  ups: Ups;
  /** Ha subido vivo al ascensor en la ronda en curso. */
  boarded: boolean;
}
export type RoomView = Room & { players: Member[] };
export interface RoomInfo {
  code: string;
  name: string;
  tape: number;
  owner: string;
  count: number;
  max: number;
  phase: Phase;
  difficulty: Difficulty;
  /** La sala fija la semilla del mapa. */
  seeded: boolean;
  /** Segundos que lleva la partida en marcha (0 en el lobby). */
  age: number;
}
/** Una sala guardada del dueño (lista MY ROOMS): se reabre con `create` y su código. */
export interface SaveInfo {
  code: string;
  name: string;
  bank: number;
  round: number;
  /** Cuándo se guardó por última vez (ms). */
  at: number;
  /** Está abierta ahora mismo. */
  live: boolean;
}
/** Algo vendido en la báscula de la sala de espera. */
export interface Sold {
  by: string;
  name: string;
  price: number;
  /** Rareza (índice de RARITIES). */
  r: number;
}
/** Dónde está la báscula en la sala de espera (m) y a qué distancia de su centro cuenta lo que se suelta. */
export const SCALE = { x: -3.7, z: 1.6, r: 0.6 }; // (cerca de la pared oeste, entre la mesa del ordenador y los sillones)
export type Joined = { id: string; room: RoomView } | { error: string };

/** Un objeto de la partida: cinta, linterna, cámara o rifle. */
export type ItemKind = 'tape' | 'flashlight' | 'camera' | 'gun' | 'water' | 'totem' | 'radar' | 'tank' | 'watergun' | 'loot' | 'locker' | 'gen' | 'ammo';
export interface WorldSnapshot {
  parking?: ParkingSnapshot;
  /** Reloj del servidor (Date.now()) al tomar el snapshot: las entidades se interpolan con él, no con la hora de llegada. */
  t?: number;
  ents: EntState[];
  /** Ids de los objetos ya recogidos. */
  taken: string[];
  /** Cintas recogidas entre todos. */
  tapes: number;
  /** Jugadores a los que una entidad inspecciona ahora en su nicho (hay que contener la respiración). */
  insp?: string[];
  /** Objetos soltados que hay ahora en el suelo (ids `d…`); los pickups del cliente se sincronizan con esta lista. */
  drops?: Drop[];
  /** Índices (de tvSites) de las televisiones ya apagadas; solo con la misión «TURN OFF THE TVS». */
  tvOff?: number[];
}

/** Consola de admin (solo la cuenta ADMIN_USER; el servidor lo comprueba en cada llamada). `t`: 'me', 'all' o el id de un jugador de la sala. */
export type AdminAction =
  | { a: 'level'; id: string; seed?: number }
  | { a: 'run'; t: string }
  | { a: 'lobby' }
  | { a: 'kill' | 'revive' | 'heal'; t: string }
  | { a: 'god'; t: string; on: boolean }
  | { a: 'ammo'; t: string; on: boolean }
  | { a: 'tp'; t: string; to: 'start' | 'elevator' | 'player'; who?: string }
  | { a: 'money'; mode: 'add' | 'set'; n: number }
  | { a: 'give'; t: string; item: ItemId | 'loot'; r?: number } // r: rareza (sin ella, al azar)
  | { a: 'ups'; t: string; id: UpId | '*'; lv: number } // pone ese nivel de una mejora (o de todas)
  | { a: 'award'; t: string; key: string } // key: la de un logro, o '*' para todos
  | { a: 'mission' }
  | { a: 'end'; ok: boolean }
  | { a: 'tvs' }
  | { a: 'ent'; op: 'spawn' | 'clear' | 'freeze' | 'thaw'; kind?: Kind; near?: string }
  | { a: 'info' };
export interface AdminInfo {
  seed: number;
  levelId: string;
  round: number;
  phase: Phase;
  elapsed: number;
  bank: number;
  mission: string;
  ents: number;
  frozen: boolean;
  players: { id: string; name: string; hp: number; dead: boolean; god: boolean; ammo?: boolean }[];
}
export type AdminReply = { ok: boolean; error?: string; info?: AdminInfo };
/** Efectos de admin que el servidor manda a un cliente (el resto de la consola usa los canales de siempre: room, dead, revived, inv...). */
export type AdminFx = { k: 'tp'; x: number; y: number; z: number; yaw: number } | { k: 'give'; item: ItemId } | { k: 'heal' } | { k: 'ammo'; on: boolean };

export interface ClientToServer {
  /** Consola de admin: el servidor rechaza (ok = false) a cualquiera que no sea la cuenta de admin. */
  admin: (a: AdminAction, cb?: (r: AdminReply) => void) => void;
  /** Crea una sala; con `resume` (el código de una guardada de esta cuenta) la reabre con su banco, su ronda y lo de cada uno. */
  create: (a: { name: string; public: boolean; difficulty?: Difficulty; resume?: string }, cb: (r: Joined) => void) => void;
  /** Las salas guardadas de esta cuenta (vacío de invitado). */
  saves: (cb: (list: SaveInfo[]) => void) => void;
  /** Borra una sala guardada de esta cuenta (si no está abierta). */
  unsave: (code: string, cb?: (ok: boolean) => void) => void;
  /** Lobby: subir un nivel de una mejora del árbol con el dinero común. */
  upgrade: (id: UpId, cb?: (r: { ok: boolean; error?: string }) => void) => void;
  /** El propietario cambia los ajustes (solo en el lobby). */
  settings: (patch: Partial<RoomSettings>) => void;
  join: (a: { code: string; name: string }, cb: (r: Joined) => void) => void;
  list: (cb: (rooms: RoomInfo[]) => void) => void;
  start: () => void;
  state: (s: PlayerState) => void;
  /** Medir el ping: el servidor contesta al momento. */
  ping: (cb: () => void) => void;
  pickup: (itemId: string, cb?: (ok: boolean) => void) => void;
  /** Un disparo que acierta a una entidad: el servidor decide si muere. */
  hit: (entityId: number) => void;
  /** Fuego amigo: el tiro del rifle dio a este compañero. */
  shoot: (playerId: string) => void;
  /** Un disparo del rifle (dé o no a algo): las entidades lo oyen. */
  bang: () => void;
  /** El rifle te ha explotado en la cara: mueres y el estallido daña alrededor. */
  blast: () => void;
  /** Se ha caído al vacío. */
  fell: () => void;
  chat: (text: string) => void;
  /** Abrir una taquilla (tras el minijuego): lo que hay dentro y qué piezas ya se han cogido; y coger la pieza `i`. */
  locker: (id: string, cb: (r: { ok: boolean; items?: LockerItem[]; taken?: boolean[] }) => void) => void;
  lockerTake: (id: string, i: number, cb: (ok: boolean) => void) => void;
  /** Beber una Monster (se gasta; el servidor da el margen de velocidad) y usar la carta Uno Reverse (cambia de sitio con un compañero vivo al azar; responde si pudo). */
  monster: () => void;
  uno: (cb: (ok: boolean) => void) => void;
  /** Chat de voz: un mensaje de señalización WebRTC (oferta, respuesta o candidato ICE) para un compañero de la sala; el servidor solo lo reenvía. */
  rtc: (to: string, data: unknown) => void;
  leave: () => void;
  /**
   * Ha entrado en el ascensor abierto (la misión está cumplida) y sube. Manda lo que lleva: el servidor lo acota a lo que podía tener
   * (inventario del inicio + lo recogido, menos lo soltado) y es lo que conserva para la siguiente ronda. Por la escalera de servicio de Las Suites
   * `floor` es la planta (1-5) a la que se va, la que sea; sin él, la siguiente.
   */
  ascend: (inv: Inventory, floor?: number) => void;
  parkingInteract: (action: ParkingInteraction, cb?: (ok: boolean) => void) => void;
  /** Las Suites, misión del encargo de recepción: entregar una pieza de botín al Faceling del mostrador (responde si la tenía y la misión la pide). */
  deliver: (cb: (ok: boolean) => void) => void;
  /** Suites: un Faceling ofrece otra misión tras cumplir la actual. `pick` < 0 solo pregunta cuántas quedan (n); `pick` ≥ 0 elige a ciegas una de ellas (n = las que había; 0 = ninguna). */
  nextMission: (pick: number, cb: (n: number) => void) => void;
  /** Votación (fase `starting`, tras la entrada): votar una misión por su id (cambia el voto anterior; '' lo quita). */
  vote: (missionId: string) => void;
  /**
   * Lobby: comprar un objeto en el ordenador con el dinero común. Va al inventario de quien compra. `error` en inglés si no se puede
   * (NOT ENOUGH MONEY, ALREADY HAVE IT, TOO FAST, ...).
   */
  buy: (item: ItemId, cb?: (r: { ok: boolean; error?: string }) => void) => void;
  /** Partida: soltar una unidad del objeto delante de uno (el servidor comprueba que lo llevaba); se ve en `world.drops` y se recoge con `pickup`. */
  drop: (item: ItemId | 'loot', index: number, cb?: (ok: boolean) => void) => void; // (`index`: cuál de las piezas de botín; 0 para lo demás)
  /** Partida, misión de las televisiones: apagar la número `index` (de tvSites); el servidor mira la distancia. */
  tv: (index: number, cb?: (ok: boolean) => void) => void;
  /** Usar el Tótem de la vida con un compañero caído: el servidor comprueba que lo tenía y que el otro está muerto. */
  totem: (target: string, cb?: (ok: boolean) => void) => void;
  /** El caído ha llegado a la meta de «Run for your life» (el servidor mira que haya pasado el tiempo mínimo). */
  runDone: () => void;
  /** El caído ha fallado «Run for your life» (solo hay una oportunidad): vuelve a estar muerto. */
  runFail: () => void;
  /** La cordura ha llegado a cero: muere (el servidor solo comprueba que está vivo y en partida). */
  insane: () => void;
  /** Se ha bebido una lata de Almond Water (el servidor comprueba que la tenía y devuelve la vida). */
  drink: () => void;
  /** Se ha sacado una foto (el servidor cuenta las que valen, solo con cámara en la mano). */
  photo: () => void;
  snap: () => void;
  /** Solo invitados: su color (uno de los gratis). Con cuenta, el aspecto sale de la cuenta. */
  look: (color: string) => void;
  /** Listo / no listo en la sala de espera. En la fase `starting` (votación): `true` = este cliente ya tiene el nivel cargado. */
  ready: (on: boolean) => void;
  /** Terminar un tramo de cinta (el servidor le pone id y dueño y lo reparte). */
  strip: (pts: number[]) => void;
  /** Quitar un tramo (el de cualquiera). */
  unstrip: (id: string) => void;
  /** Pistola de agua: un chorro desde (x, z) mirando a `yaw` (unos 20 mensajes/s como mucho mientras dispara). El servidor busca a quién moja. */
  squirt: (a: SquirtMsg) => void;
}
export interface SquirtMsg {
  x: number;
  z: number;
  yaw: number;
}
/** Efecto de la pistola de agua sobre ti: `wet` = velocidad x0,5 durante `ms`; `stun` = parado `ms`. */
export interface WetMsg {
  kind: 'wet' | 'stun';
  ms: number;
}
/** Lo que dice el servidor de sí mismo (GET /status): si está en mantenimiento y por qué. */
export interface Status {
  maintenance: boolean;
  message: string;
  /** Cuándo empieza el mantenimiento anunciado (ISO), si aún no ha empezado. */
  at?: string;
}

export interface ServerToClient {
  adminFx: (m: AdminFx) => void;
  status: (s: Status) => void;
  room: (r: RoomView) => void;
  players: (all: Record<string, PlayerState & { name: string; dead: boolean }>) => void;
  world: (w: WorldSnapshot) => void;
  chat: (m: { id: string; name: string; text: string }) => void;
  /** Señalización WebRTC de `from` (un compañero de la sala). */
  rtc: (from: string, data: unknown) => void;
  dead: (id: string) => void;
  /** El rifle de `id` ha explotado en (x, y, z): todos ven la explosión y a él salir volando. */
  blastFx: (m: { id: string; x: number; y: number; z: number }) => void;
  /** Fin de la ronda (todos vuelven al lobby): el resultado completo (cobro o penalización, saldo, qué fue de cada uno). */
  over: (r: RoundResult) => void;
  /**
   * Tu inventario según el servidor (solo para ti): al entrar en la sala, tras comprar o recoger, al empezar la ronda (lo que hay que cargar
   * en el jugador) y al volver al lobby (lo conservado o perdido).
   */
  inv: (i: Inventory) => void;
  /** El servidor te ha concedido un logro (clave de ACHIEVEMENTS). */
  achievement: (key: string) => void;
  /** Un caído empieza «Run for your life» por el Tótem de `by`. */
  reviving: (m: { id: string; name: string; by: string }) => void;
  /** Ha vuelto a la partida en (x, y, z), con la vida llena e inmune REVIVE_IMMUNE ms. */
  revived: (m: { id: string; name: string; x: number; y: number; z: number; yaw: number }) => void;
  /** El caído ha fallado la carrera y sigue muerto. */
  runFailed: (m: { id: string; name: string }) => void;
  /** Un tramo de cinta nuevo. */
  strip: (s: Strip) => void;
  /** Un tramo de cinta quitado (o los de quien se fue). */
  unstrip: (id: string) => void;
  /** Te ha mojado o parado alguien con la pistola de agua. */
  wet: (m: WetMsg) => void;
  /** En partida: la calidad de lo que llevas y tu botín según el servidor (al recoger, soltar y cada pocos segundos por el desgaste). */
  bag: (b: { q: NonNullable<Inventory['q']>; loot: Qual[] }) => void;
  /** Alguien ha vendido algo en la báscula. */
  sold: (s: Sold) => void;
  /** Lo que hay soltado en el suelo de la sala de espera (la lista entera, cuando cambia). */
  ldrops: (list: Drop[]) => void;
}
