import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Server } from 'socket.io';
import {
  SERVER_PORT, MAX_PLAYERS, DEFAULT_PLAYERS, DEFAULT_LOOK, cosmetic, lookAllowed, HP_MAX, NAME_MAX, CHAT_MAX, CHAT_GAP, ROOM_NAME_MAX, DIFFICULTY, START_DELAY, VOTE_TIME, LOAD_GRACE, WAIT_HALF, WAIT_SPAWNS, EMOTES, EMOTE_GAP, STRIP_MAX, STRIP_PTS, STRIP_GAP, REVIVE_IMMUNE, REVIVE_MIN,
  START_BANK, START_INV, EMPTY_INV, INV_MAX, ASCENT_GRACE, DROP_MAX, DROP_TTL, DROP_GAP, offerMissions, poolMissions, pickLevel, tvCount, generateMaze, cleanInv, addItem, canHold, hasItem, removeItem, purchase, shopItem, penaltyOf, ITEM_IDS, LEVELS, centerOf,
  type ItemId, type Inventory, type Mission, type MissionOffer, type RoundResult, type Fate, type Drop, type ActiveMission,
  type AdminAction, type AdminInfo, type AdminReply, type ClientToServer, type ServerToClient, type Status, type PlayerState, type Room, type RoomView, type RoomInfo, type Look, type Strip,
} from '@backrooms/shared';
import { Match, type Player } from './match';
import { ACHIEVEMENT_KEYS, WATER_HEAL, NOISE_SHOT, NOISE_DROP, levelCaps, solidAt, startOffset } from '@backrooms/shared';
import { lockerContents, type LockerItem, ITEMS, RARITIES, SCALE, UPGRADES, UP_IDS, boostOf, itemOpen, levelsOpen, cleanUps, hasRoom, lootPrice, rarity, rollRarity, sellPrice, spotRarity, statsOf, upCost, upLevel, wearInv, type Qual, type SaveInfo, type Ups } from '@backrooms/shared';
import { allowedOrigins, handleApi, isAdminName, originOk, userFromCookie } from './auth';
import { MONEY_LIMIT, parseAdmin } from './admin';
import { achievementsOf, avatarRef, deleteSave, loadoutOf, saveOf, savesOf, writeSave } from './db';
import { award, count, hooks } from './progress';

/*
 * El servidor de las salas: crea y lista salas, reparte los estados de los jugadores (15 Hz) y lleva la
 * partida (objetos, entidades, muertes, fin) en `Match`. El cliente solo pinta lo que éste le dice.
 */
/**
 * El mantenimiento: MAINTENANCE=1 (y MAINTENANCE_MSG, MAINTENANCE_AT) o, sin reiniciar, un maintenance.json
 * junto al servidor: {"on": true, "message": "...", "at": "2026-11-06T20:00:00Z"}. `at` en el futuro = solo aviso.
 */
function readStatus(): Status {
  let on = process.env.MAINTENANCE === '1', message = process.env.MAINTENANCE_MSG ?? '', at = process.env.MAINTENANCE_AT;
  try {
    const f = JSON.parse(readFileSync(process.env.MAINTENANCE_FILE ?? 'maintenance.json', 'utf8'));
    (on = !!f.on), (message = String(f.message ?? message)), (at = f.at ? String(f.at) : at);
  } catch {}
  const soon = !!at && Date.parse(at) > Date.now();
  return { maintenance: on && !soon, message: message.slice(0, 160), ...(soon ? { at } : {}) };
}
let status = readStatus();

const http = createServer((req, res) => {
  if (handleApi(req, res)) return;
  if (req.url?.startsWith('/status')) {
    status = readStatus();
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    return void res.end(JSON.stringify(status));
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('backrooms ok\n');
});
// with CLIENT_ORIGIN set (one or several, comma-separated), only those origins (production); without it, any origin (dev, LAN, port forwarding).
// `credentials`: the session cookie travels with the socket (see auth.ts)
// latido corto (por defecto 25 s + 20 s): si un túnel no pasa el cierre de la pestaña, el jugador fantasma desaparece en ≤ 13 s, no en 45
const io = new Server<ClientToServer, ServerToClient>(http, { pingInterval: 10000, pingTimeout: 25000, cors: { origin: process.env.CLIENT_ORIGIN ? allowedOrigins : true, credentials: true } });

interface RoomState extends Omit<Room, 'caps' | 'offers' | 'leading' | 'mission' | 'ascent' | 'vote'> {
  players: Map<string, Player>;
  /** Taquillas abiertas esta ronda: su contenido y qué piezas se han cogido. */
  lockers: Map<string, { items: LockerItem[]; taken: boolean[] }>;
  match?: Match;
  startedAt?: number;
  /** Jugadores al empezar la partida y cuántos han caído en ella (para los logros de equipo). */
  size0: number;
  deaths: number;
  /** Cintas de acordonar puestas. */
  strips: Strip[];
  /** La ronda: semilla de la que viene (misiones y mapa), las 3 misiones de la pizarra, los votos (socket → id de misión), la elegida, si ya se cumplió y cuándo subió el primero. */
  nextSeed: number;
  pool: Mission[];
  votes: Map<string, string>;
  chosen?: Mission;
  /** Fase `starting`: cuándo se cierra la votación (undefined hasta que acaba la entrada) y quiénes han avisado de que tienen el nivel cargado. */
  voteEnd?: number;
  loaded: Set<string>;
  done: boolean;
  boardAt?: number;
  lastProgress: number;
  /** Admin: la salida de la cuenta atrás de START_DELAY que vale (si se reinicia la ronda, la anterior no hace nada). */
  tok?: number;
  /** Objetos soltados en el suelo (con la hora a la que se soltaron, para el TTL). */
  drops: Map<string, Drop & { at: number }>;
  /** La cuenta dueña de la sala guardada (0: sala de invitado, no se guarda) y lo de cada cuenta que ha pasado por ella (mejoras e inventario). */
  ownerUid: number;
  members: Map<number, { ups: Ups; inv: Inventory }>;
}
const rooms = new Map<string, RoomState>();
const where = new Map<string, string>(); // socket → código de su sala

let tapeNo = 30;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin la I ni la O (se confunden con 1 y 0)
function newCode() {
  for (;;) {
    const c = Array.from({ length: 5 }, () => LETTERS[(Math.random() * LETTERS.length) | 0]).join('');
    if (!rooms.has(c) && !saveOf(c)) return c;
  }
}
const cleanName = (n: unknown) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX) || 'anon';
const sockets = new Map<number, Set<string>>(); // cuenta → sus sockets conectados
const guestColor = new Map<string, string>(); // socket de invitado → su color (uno gratis)
/** Las misiones de la pizarra con sus votos (solo los de quienes siguen en la sala) y la que va ganando (la más votada; sin votos, la primera). */
function offers(r: RoomState): { offers: MissionOffer[]; leading: string } {
  const out = r.pool.map((m) => ({ ...m, votes: [...r.votes].filter(([s, id]) => id === m.id && r.players.has(s)).map(([s]) => s) }));
  const top = out.reduce((a, o) => (o.votes.length > a.votes.length ? o : a), out[0]);
  return { offers: out, leading: top?.id ?? '' };
}
const active = (r: RoomState): ActiveMission | null => (r.chosen ? { ...r.chosen, progress: r.done ? r.chosen.goal : (r.match?.progress ?? 0), done: r.done } : null);
const view = (r: RoomState): RoomView => {
  const lobby = r.phase === 'lobby', boarded = [...r.players.values()].filter((p) => p.boarded).map((p) => p.id);
  return {
    code: r.code, tape: r.tape, name: r.name, public: r.public, ownerId: r.ownerId, max: r.max, difficulty: r.difficulty, fixedSeed: r.fixedSeed, phase: r.phase, seed: r.seed,
    bank: r.bank, round: r.round, levelId: r.levelId, caps: levelCaps(r.levelId), ...(r.phase === 'starting' ? offers(r) : { offers: [], leading: '' }), mission: lobby ? null : active(r),
    vote: r.phase === 'starting' && r.voteEnd ? { left: r.chosen ? 0 : Math.max(0, r.voteEnd - Date.now()), loaded: [...r.loaded].filter((s) => r.players.has(s)) } : null,
    ascent: r.boardAt ? { left: Math.max(0, Math.round(ASCENT_GRACE - (Date.now() - r.boardAt) / 1000)), boarded } : null,
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, dead: p.dead, look: p.look, avatar: avatarRef(p.uid), ready: !!p.ready, boarded: !!p.boarded, ups: p.ups })),
  };
};
const push = (r: RoomState) => (r.phase === 'lobby' && save(r), io.to(r.code).emit('room', view(r)));
/** Lo que dan las mejoras de un jugador (casillas, vida máxima...). */
const st = (p: Player) => statsOf(p.ups);
/** Los niveles abiertos en la sala: el 0 y los que ha desbloqueado alguno de sus jugadores con el árbol. */
const openOf = (r: RoomState) => levelsOpen([...r.players.values()].map((p) => p.ups));
/** Guarda la sala (si es de una cuenta): ajustes, banco, ronda y lo de cada cuenta. Se llama con cada cambio en el lobby y al irse alguien. */
function save(r: RoomState) {
  if (!r.ownerUid) return;
  for (const p of r.players.values()) if (p.uid) r.members.set(p.uid, { ups: p.ups, inv: p.inv });
  writeSave(r.code, r.ownerUid, { name: r.name, public: r.public, max: r.max, difficulty: r.difficulty, fixedSeed: r.fixedSeed, bank: r.bank, round: r.round, members: Object.fromEntries(r.members) });
}
/** La calidad de lo que lleva y su botín, a su cliente (en partida). */
const bag = (p: Player) => io.to(p.id).emit('bag', { q: p.cap.q ?? {}, loot: p.cap.loot ?? [] });
const START: PlayerState = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 'Neutral Idle', light: true, held: 'none' };
/** Dónde está de pie en la sala de espera quien ocupa el hueco `i` (sin linterna). */
const waitSpot = (i: number): PlayerState => ({ ...START, ...WAIT_SPAWNS[i % WAIT_SPAWNS.length], light: false });
/** Lo que se acepta en la sala de espera: dentro de la caja (menos lo que ocupa el cuerpo). */
const WAIT_PAD = 0.25;
const MAX_ROOMS = 200; // salas a la vez: un script no puede llenar la memoria creándolas
const MAX_SPEED = 9, MOVE_SLACK = 2; // m/s y m: lo más que se deja avanzar en solitario (ver `state`)
const moveAt = new Map<string, number>(); // cuándo llegó el último estado de cada jugador
const emoteAt = new Map<string, number>(); // cuándo cambió cada jugador de emote por última vez
const inWait = (r: RoomState) => r.phase === 'lobby' || r.phase === 'starting';

/** El aspecto de quien juega: el de su cuenta (si aún le vale) o, de invitado, su color gratis. Nunca lo manda el cliente tal cual. */
function lookFor(uid: number, id: string): Look {
  if (uid) {
    const l = loadoutOf(uid);
    return lookAllowed(l, new Set(Object.keys(achievementsOf(uid)))) ? l : DEFAULT_LOOK;
  }
  return { ...DEFAULT_LOOK, color: guestColor.get(id) ?? 'stock' };
}
function addPlayer(r: RoomState, id: string, name: string, uid: number) {
  const mine = r.members.get(uid), ups = mine?.ups ?? {}, inv = mine?.inv ?? { ...START_INV };
  r.players.set(id, { id, name, st: waitSpot(r.players.size), dead: false, lastChat: 0, lastHit: 0, seen: false, uid, look: lookFor(uid, id), hp: statsOf(ups).hp, water: 0, totem: 0, inv, cap: { ...inv }, ups });
  where.set(id, r.code);
}

function leave(id: string) {
  const code = where.get(id);
  where.delete(id);
  emoteAt.delete(id);
  moveAt.delete(id);
  const r = code ? rooms.get(code) : undefined;
  if (!r) return;
  io.sockets.sockets.get(id)?.leave(code!);
  save(r); // (con quien se va todavía dentro: lo suyo queda guardado)
  r.players.delete(id);
  r.votes.delete(id);
  r.loaded.delete(id);
  for (const k of r.strips.filter((k) => k.owner === id)) io.to(code!).emit('unstrip', k.id);
  r.strips = r.strips.filter((k) => k.owner !== id);
  if (!r.players.size) return void rooms.delete(code!);
  if (r.ownerId === id) r.ownerId = r.players.keys().next().value!; // el siguiente pasa a ser el propietario
  push(r);
  if (r.phase === 'playing') checkOver(r);
}

/**
 * La ronda se acaba cuando ya no queda nadie jugando (todos los vivos han subido al ascensor, o no queda ninguno vivo) o han pasado
 * ASCENT_GRACE s desde que subió el primero.
 */
function checkOver(r: RoomState) {
  if (r.phase !== 'playing') return;
  const grace = !!r.boardAt && Date.now() - r.boardAt >= ASCENT_GRACE * 1000;
  if (!grace && [...r.players.values()].some((p) => !p.dead && !p.boarded)) return;
  finish(r);
}

/** Prepara la ronda que viene (en el lobby): su semilla, el nivel y las tres misiones de la pizarra, sin votos. */
function prepare(r: RoomState, seed = 0, level?: string) {
  r.nextSeed = seed || r.fixedSeed || 1 + ((Math.random() * 2 ** 31) | 0);
  r.levelId = level ?? pickLevel(r.nextSeed, openOf(r));
  const pool = levelCaps(r.levelId).pool ? poolMissions(r.nextSeed, r.round) : offerMissions(r.nextSeed, r.round, tvCount(generateMaze(r.nextSeed))); // (el mapa dice cuántas televisiones hay)
  r.pool = pool.map((m) => ({ ...m, reward: Math.round((m.reward * DIFFICULTY[r.difficulty].money) / 5) * 5 })); // la dificultad escala el dinero que da cada misión
  r.votes.clear();
}

/** La sala vuelve al lobby (fin de ronda o admin): el propietario puede empezar otra. */
function backToLobby(r: RoomState, ps: Player[]) {
  // la sala vuelve al lobby: el propietario puede empezar otra
  r.phase = 'lobby';
  r.seed = 0;
  r.match = undefined;
  r.strips = [];
  r.startedAt = undefined;
  r.round++;
  r.chosen = undefined;
  r.done = false;
  r.boardAt = undefined;
  r.drops.clear();
  r.lockers.clear();
  prepare(r);
  // de vuelta a la sala de espera: cada uno en su sitio
  ps.forEach((p, i) => ((p.dead = false), (p.boarded = false), (p.seen = false), (p.hp = st(p).hp), (p.water = 0), (p.totem = 0), (p.reviving = p.immuneUntil = undefined), (p.ready = false), (p.st = waitSpot(i)), (p.cap = { ...p.inv })));
  push(r);
  for (const p of ps) io.to(p.id).emit('inv', p.inv);
}

/**
 * Fin de la ronda: cobro o penalización, qué se conserva (solo quienes subieron vivos) y de vuelta al lobby. Si nadie subió, la derrota
 * se retrasa 5 s para que el último termine de caer.
 */
function finish(r: RoomState) {
  if (r.phase !== 'playing') return;
  r.phase = 'over';
  const done = () => {
    if (rooms.get(r.code) !== r) return;
    const ps = [...r.players.values()], back = ps.filter((p) => p.boarded && !p.dead);
    const won = r.done && back.length > 0;
    const reward = won ? (r.chosen?.reward ?? 0) : 0, penalty = won ? 0 : penaltyOf(r.bank);
    r.bank = Math.max(0, r.bank + reward - penalty);
    const fates: Record<string, Fate> = {};
    for (const p of ps) fates[p.id] = back.includes(p) ? 'back' : p.dead ? 'dead' : 'stranded';
    if (won) creditEscape(r);
    for (const p of ps) if (fates[p.id] !== 'back') p.inv = { ...EMPTY_INV }; // lo que llevaban se pierde
    const result: RoundResult = { won, completed: r.done, mission: r.chosen ?? null, reward, penalty, bank: r.bank, fates };
    io.to(r.code).emit('over', result);
    backToLobby(r, ps);
  };
  if ([...r.players.values()].some((p) => p.boarded)) done();
  else setTimeout(done, 5000);
}

/** Lo que se gana al recoger algo del mapa (por la primera letra de su id): sube lo que puede llevar. */
const GAIN: Record<string, ItemId> = { f: 'flashlight', w: 'water', m: 'totem', r: 'radar', c: 'camera', g: 'gun', k: 'tank', p: 'watergun' };
function gain(p: Player, id: string, r: number) {
  const k = GAIN[id[0]];
  if (id[0] === 'v') p.cap = { ...p.cap, loot: [...(p.cap.loot ?? []), { r, w: 0 }] }; // botín: una pieza más
  if (k) p.cap = addItem(p.cap, k, r);
  if (k === 'gun') p.cap.ammo += 6; // el rifle del mapa trae dos cargadores
  bag(p);
}
/** Con lo soltado `d` de vuelta en el inventario. */
const withDrop = (inv: Inventory, d: Drop): Inventory => (d.kind === 'loot' ? { ...inv, loot: [...(inv.loot ?? []), d.q ?? { r: 0, w: 0 }] } : addItem(inv, d.kind, d.q?.r, d.q?.w));
const fitsDrop = (inv: Inventory, d: Drop, p: Player) => (d.kind === 'loot' ? hasRoom(inv, st(p), 'loot') : canHold(inv, d.kind, st(p)));
/** Sin una unidad de `kind` (la pieza `i` si es botín): lo que queda y la calidad de lo que sale; undefined si no lo lleva. */
function without(inv: Inventory, kind: ItemId | 'loot', i: number): { inv: Inventory; q: Qual } | undefined {
  if (kind === 'loot') {
    const q = inv.loot?.[i];
    return q && { inv: { ...inv, loot: inv.loot!.filter((_, k) => k !== i) }, q };
  }
  return ITEM_IDS.includes(kind) && hasItem(inv, kind) ? { inv: removeItem(inv, kind), q: inv.q?.[kind] ?? { r: 0, w: 0 } } : undefined;
}
/** Recoger un objeto soltado: cerca de donde está y si cabe; el primero se lo lleva. */
function takeDrop(r: RoomState, p: Player, id: string) {
  const d = r.drops.get(id);
  if (!d || p.dead || Math.hypot(p.st.x - d.x, p.st.z - d.z) > 3.6 || !fitsDrop(p.cap, d, p)) return false;
  r.drops.delete(id);
  p.cap = withDrop(p.cap, d);
  bag(p);
  return true;
}
let dropNo = 0;

/** Cada tick de la partida: progreso de la misión (al cumplirse se abre el ascensor) y caducidad de lo soltado. Avisa a la sala si algo cambia. */
function roundTick(r: RoomState) {
  const m = r.match!, now = Date.now();
  let changed = false;
  if (r.chosen) {
    const v = m.progress;
    if (!r.done && v >= r.chosen.goal) (r.done = true), (changed = true);
    if (v !== r.lastProgress) (r.lastProgress = v), (changed = true);
  }
  for (const [id, d] of r.drops) if (now - d.at > DROP_TTL * 1000) r.drops.delete(id);
  if (changed) push(r);
}

/** Quienes siguen vivos al salir por el ascensor: contadores y logros de su cuenta. Los invitados no acumulan nada. */
function creditEscape(r: RoomState) {
  for (const p of r.players.values()) {
    if (!p.uid || p.dead || !p.boarded) continue;
    count(p.uid, 'escapes');
    if (r.size0 >= 3) award(p.uid, 'team_player');
    if (!r.deaths) award(p.uid, 'survivor');
    if (r.size0 === 1) award(p.uid, 'lone_wolf');
    if (r.size0 >= 6) award(p.uid, 'full_house');
    if (r.levelId === 'poolrooms') award(p.uid, 'deep_end');
  }
}

/**
 * Empieza la ronda desde el lobby. Fase `starting`: primero la entrada por la puerta (START_DELAY ms, sin misión) y, al acabar, la votación de la
 * misión (VOTE_TIME ms o hasta que voten todos) mientras cada cliente carga el nivel y avisa con `ready`. La partida empieza cuando la votación
 * está cerrada y todos han cargado (o pasan LOAD_GRACE ms).
 */
function begin(r: RoomState) {
  r.seed = r.nextSeed;
  r.chosen = undefined;
  r.voteEnd = undefined;
  r.votes.clear();
  r.loaded.clear();
  r.done = false;
  r.boardAt = undefined;
  r.lastProgress = -1;
  for (const d of r.drops.values()) {
    const o = r.players.get(d.by); // lo soltado en la sala de espera vuelve a quien lo soltó (si cabe)
    if (o && fitsDrop(o.inv, d, o)) o.inv = withDrop(o.inv, d);
  }
  r.drops.clear();
  // lo que cada uno lleva a la ronda: su inventario (la tienda y lo conservado)
  for (const p of r.players.values()) (p.boarded = false), (p.cap = { ...p.inv }), io.to(p.id).emit('inv', p.inv);
  r.phase = 'starting';
  push(r);
  const tok = (r.tok = (r.tok ?? 0) + 1);
  const live = () => rooms.get(r.code) === r && r.phase === 'starting' && r.tok === tok;
  setTimeout(() => {
    if (!live()) return;
    r.voteEnd = Date.now() + VOTE_TIME;
    push(r);
    let fast = false;
    const iv = setInterval(() => {
      if (!live()) return clearInterval(iv);
      const now = Date.now(), ids = [...r.players.keys()];
      if (!r.chosen) {
        // todos han votado: la cuenta atrás se acorta para que se vea el resultado
        if (!fast && ids.every((id) => r.votes.has(id))) (fast = true), (r.voteEnd = Math.min(r.voteEnd!, now + 1500)), push(r);
        if (now >= r.voteEnd!) (r.chosen = closeVote(r)), push(r);
      } else if (ids.every((id) => r.loaded.has(id)) || now >= r.voteEnd! + LOAD_GRACE) (clearInterval(iv), play(r));
    }, 200);
  }, START_DELAY);
}

/** La misión más votada (empate: al azar entre las empatadas; sin votos, la primera de la pizarra). */
function closeVote(r: RoomState): Mission {
  const o = offers(r).offers, top = Math.max(...o.map((m) => m.votes.length)), tied = o.filter((m) => m.votes.length === top);
  const { votes: _v, ...pick } = top > 0 ? tied[(Math.random() * tied.length) | 0] : o[0];
  return pick;
}

/** Votación cerrada y nivel cargado: empieza la partida. */
function play(r: RoomState) {
  r.match = new Match(r.seed, r.difficulty, r.players.size, r.levelId);
  r.match.setMission(r.chosen!);
  r.match.onHeld = (p) => p.uid && (count(p.uid, 'holds'), award(p.uid, 'held_breath'));
  r.strips = [];
  r.size0 = r.players.size;
  r.deaths = 0;
  for (const p of r.players.values()) (p.shot = new Set()), p.uid && count(p.uid, 'games');
  r.phase = 'playing';
  r.startedAt = Date.now();
  let slot = 0;
  for (const p of r.players.values()) {
    const [ox, oz] = startOffset(slot++);
    (p.dead = false), (p.seen = false), (p.hp = st(p).hp), (p.water = 0), (p.totem = 0), (p.reviving = p.immuneUntil = undefined), (p.st = { ...START, x: r.match.start.x + ox, z: r.match.start.z + oz });
  }
  push(r);
}

/** Un caído vuelve a la partida junto a `at` (a 0,7 m por el primer lado libre; si no, encima), con la vida llena e inmune un rato. */
function revive(r: RoomState, p: Player, at: PlayerState) {
  const m = r.match!.maze, o = [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]].find(([dx, dz]) => !solidAt(m, at.x + dx, at.z + dz)) ?? [0, 0];
  p.dead = false;
  p.hp = st(p).hp;
  p.seen = false;
  p.reviving = undefined;
  p.immuneUntil = Date.now() + REVIVE_IMMUNE;
  p.st = { ...START, x: at.x + o[0], y: 0, z: at.z + o[1], yaw: at.yaw };
  io.to(r.code).emit('revived', { id: p.id, name: p.name, x: p.st.x, y: 0, z: p.st.z, yaw: p.st.yaw });
  push(r);
}

const roomOf = (id: string) => rooms.get(where.get(id) ?? '');

io.on('connection', (sock) => {
  sock.emit('status', status);
  // la cuenta, por la cookie de sesión (sin Origin: es una petición del propio origen; con él, tiene que ser uno permitido). Si no, invitado
  const hs = sock.handshake.headers;
  const acct = !hs.origin || originOk(hs.origin, hs.host) ? userFromCookie(hs.cookie) : undefined;
  const uid = acct?.user.id ?? 0;
  if (uid) (sockets.get(uid) ?? sockets.set(uid, new Set()).get(uid)!).add(sock.id);
  const join = (r: RoomState, name: string, cb: (x: { id: string; room: RoomView }) => void) => {
    addPlayer(r, sock.id, acct ? acct.user.username : name, uid);
    sock.join(r.code);
    cb({ id: sock.id, room: view(r) });
    sock.emit('inv', r.players.get(sock.id)!.inv);
    push(r);
  };

  sock.on('create', (a, cb) => {
    if (typeof cb !== 'function') return;
    if (status.maintenance) return cb({ error: 'Maintenance' });
    if (rooms.size >= MAX_ROOMS) return cb({ error: 'Server full' });
    // reabrir una guardada: tiene que ser de esta cuenta; si ya está abierta, se entra en ella
    const code = typeof a?.resume === 'string' ? a.resume.trim().toUpperCase() : '', sv = code ? saveOf(code) : undefined;
    if (code && (!sv || sv.owner !== uid)) return cb({ error: 'No such saved room' });
    const live = code ? rooms.get(code) : undefined;
    if (live) {
      if (where.get(sock.id) === live.code) return cb({ id: sock.id, room: view(live) });
      if (live.phase !== 'lobby') return cb({ error: 'Game in progress' });
      if (live.players.size >= live.max) return cb({ error: 'Room is full' });
      leave(sock.id);
      return join(live, cleanName(a?.name), cb);
    }
    leave(sock.id);
    const d = (sv?.data ?? {}) as Partial<RoomState> & { members?: Record<string, { ups?: unknown; inv?: unknown }> };
    const num = (v: unknown, def: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v as number))) : def);
    const diff = sv ? d.difficulty : a?.difficulty;
    const r: RoomState = {
      lockers: new Map(), code: code || newCode(), tape: ++tapeNo, name: typeof d.name === 'string' ? d.name.slice(0, ROOM_NAME_MAX) : `SALA ${tapeNo}`, public: sv ? !!d.public : !!a?.public, ownerId: sock.id, max: num(d.max, DEFAULT_PLAYERS, 2, MAX_PLAYERS),
      difficulty: diff && diff in DIFFICULTY ? diff : 'normal', fixedSeed: num(d.fixedSeed, 0, 0, 2 ** 31 - 1), phase: 'lobby', seed: 0, players: new Map(), size0: 0, deaths: 0, strips: [],
      bank: num(d.bank, START_BANK, 0, MONEY_LIMIT), round: num(d.round, 1, 1, 1e6), levelId: 'level0', nextSeed: 0, pool: [], votes: new Map(), loaded: new Set(), done: false, lastProgress: -1, drops: new Map(),
      ownerUid: uid, // (las salas de invitado, uid 0, no se guardan)
      members: new Map(Object.entries(d.members ?? {}).map(([k, m]) => [Number(k), { ups: cleanUps(m?.ups), inv: { ...cleanInv(m?.inv), q: (m?.inv as Inventory | undefined)?.q ?? {}, loot: ((m?.inv as Inventory | undefined)?.loot ?? []).slice(0, 20) } }])),
    };
    prepare(r);
    rooms.set(r.code, r);
    join(r, cleanName(a?.name), cb);
  });

  sock.on('join', (a, cb) => {
    if (typeof cb !== 'function') return;
    if (status.maintenance) return cb({ error: 'Maintenance' });
    const r = rooms.get(String(a?.code ?? '').trim().toUpperCase());
    if (!r) return cb({ error: 'No such room' });
    if (where.get(sock.id) === r.code) return cb({ id: sock.id, room: view(r) });
    if (r.phase !== 'lobby') return cb({ error: 'Game in progress' });
    if (r.players.size >= r.max) return cb({ error: 'Room is full' });
    leave(sock.id);
    join(r, cleanName(a?.name), cb);
  });

  // las salas guardadas de la cuenta (MY ROOMS) y borrar una (si no está abierta)
  sock.on('saves', (cb) => {
    if (typeof cb !== 'function') return;
    cb(uid ? savesOf(uid).map((s): SaveInfo => ({ code: s.code, name: String(s.data.name ?? s.code), bank: Number(s.data.bank) || 0, round: Number(s.data.round) || 1, at: s.at, live: rooms.has(s.code) })) : []);
  });
  sock.on('unsave', (code, cb) => {
    const ok = !!uid && typeof code === 'string' && !rooms.has(code) && deleteSave(code, uid);
    if (typeof cb === 'function') cb(ok);
  });

  // las salas públicas, también las llenas y las que ya juegan (el cliente las enseña sin dejar entrar)
  sock.on('list', (cb) => {
    if (typeof cb !== 'function') return;
    const out: RoomInfo[] = [];
    for (const r of rooms.values())
      if (r.public)
        out.push({
          code: r.code, name: r.name, tape: r.tape, owner: r.players.get(r.ownerId)?.name ?? '', count: r.players.size, max: r.max,
          phase: r.phase, difficulty: r.difficulty, seeded: !!r.fixedSeed, age: r.startedAt ? Math.round((Date.now() - r.startedAt) / 1000) : 0,
        });
    cb(out);
  });

  sock.on('settings', (a) => {
    const r = roomOf(sock.id);
    if (!r || r.ownerId !== sock.id || r.phase !== 'lobby' || !a || typeof a !== 'object') return;
    if (typeof a.name === 'string') r.name = a.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, ROOM_NAME_MAX) || r.name;
    if (typeof a.public === 'boolean') r.public = a.public;
    if (Number.isFinite(a.max)) r.max = Math.min(MAX_PLAYERS, Math.max(2, r.players.size, Math.round(a.max!)));
    if (a.difficulty && a.difficulty in DIFFICULTY && a.difficulty !== r.difficulty) (r.difficulty = a.difficulty), prepare(r, r.nextSeed, r.levelId); // mismas semilla y nivel: solo cambia lo que da cada misión
    if (Number.isFinite(a.fixedSeed)) {
      const f = Math.min(2 ** 31 - 1, Math.max(0, Math.floor(a.fixedSeed!)));
      if (f !== r.fixedSeed) (r.fixedSeed = f), prepare(r); // otra semilla: otro mapa y otras misiones
    }
    push(r);
  });

  sock.on('ready', (on) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r || !p) return;
    if (r.phase === 'starting') {
      // durante la votación: este cliente ya tiene el nivel cargado
      if (on) (r.loaded.add(sock.id), push(r));
      return;
    }
    if (r.phase !== 'lobby') return;
    p.ready = !!on;
    push(r);
  });

  sock.on('start', () => {
    const r = roomOf(sock.id);
    if (!r || r.ownerId !== sock.id || r.phase !== 'lobby') return;
    begin(r);
  });

  sock.on('state', (s) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r || !p || !s || (r.phase !== 'playing' && !inWait(r)) || (r.phase === 'playing' && (p.dead || p.boarded))) return;
    const n = (v: unknown) => (Number.isFinite(v) ? (v as number) : 0);
    const st: PlayerState = {
      x: n(s.x), y: n(s.y), z: n(s.z), yaw: n(s.yaw), pitch: n(s.pitch),
      anim: String(s.anim ?? '').slice(0, 40), light: !!s.light, held: s.held === 'camera' || s.held === 'gun' ? s.held : 'none',
      duck: !!s.duck, tank: !!s.tank, dance: /^\w{1,24}$/.test(String(s.dance)) ? String(s.dance) : undefined, variant: /^\w{1,24}$/.test(String(s.variant)) ? String(s.variant) : undefined, jam: Math.max(0, Math.min(20000, n(s.jam))),
      hiding: !!s.hiding, holding: !!s.holding, // el escondite lo valida Match (ver hiding)
      t: n(s.t), // el reloj del emisor: se reenvía tal cual para que los demás reconstruyan su ritmo
    };
    if (inWait(r)) {
      // en la sala de espera no hay a dónde ir: se recorta a la caja, sin saltos ni linterna
      const c = (v: number, h: number) => Math.min(h - WAIT_PAD, Math.max(-h + WAIT_PAD, v));
      // el emote: solo los permitidos, y un cambio cada EMOTE_GAP ms como mucho
      const e = Number.isInteger(s.emote) && s.emote! >= 0 && s.emote! < EMOTES.length ? s.emote! : 0, now = Date.now();
      if (e !== (p.st.emote ?? 0) && now - (emoteAt.get(sock.id) ?? 0) >= EMOTE_GAP) (st.emote = e), emoteAt.set(sock.id, now);
      else st.emote = p.st.emote ?? 0;
      (st.x = c(st.x, WAIT_HALF.x)), (st.z = c(st.z, WAIT_HALF.z)), (st.y = Math.min(0.5, Math.max(0, st.y))), (st.light = false), (st.held = 'none');
      p.st = st;
      return;
    }
    // velocidad: el cliente manda su posición, así que se limita lo que puede avanzar entre mensajes (correr son 3,6 m/s; margen para el retraso).
    // Quien pasa de ahí (teletransporte, velocidad x2 desde la consola) se queda a lo máximo alcanzable. El admin queda fuera: tiene sus trucos de velocidad y tp.
    const now2 = Date.now(), prev = moveAt.get(sock.id) ?? now2;
    moveAt.set(sock.id, now2);
    // un salto de `jam` al alza es un túnel sin fondo (teletransporte legítimo): no se recorta
    if (!isAdmin() && !((st.jam ?? 0) > (p.st.jam ?? 0))) {
      const reach = Math.min(2, (now2 - prev) / 1000) * MAX_SPEED + MOVE_SLACK, dx = st.x - p.st.x, dz = st.z - p.st.z, d = Math.hypot(dx, dz);
      if (d > reach) (st.x = p.st.x + (dx / d) * reach), (st.z = p.st.z + (dz / d) * reach);
    }
    if (st.hiding && !r.match?.hideOk(p, st)) st.hiding = st.holding = false; // solo en un nicho libre
    p.st = st;
    p.seen = true;
  });

  sock.on('ping', (cb) => typeof cb === 'function' && cb());

  // ── consola de admin ──────────────────────────────────────────────────────
  // La autorización se decide AQUÍ, en cada llamada: la cuenta del socket (la de la cookie de sesión al conectar) tiene que seguir teniendo una sesión
  // válida y llamarse exactamente ADMIN_USER. Un invitado (uid 0) o cualquier otra cuenta se rechaza sin ejecutar nada. El cliente solo muestra la consola.
  const isAdmin = () => {
    if (!acct || !uid) return false;
    const s = userFromCookie(hs.cookie);
    return !!s && s.user.id === uid && isAdminName(s.user.username);
  };
  sock.on('admin', (raw, cb) => {
    const reply = (x: AdminReply) => typeof cb === 'function' && cb(x);
    if (!isAdmin()) {
      console.warn(`[admin] DENIED socket=${sock.id} uid=${uid}`);
      return reply({ ok: false, error: 'FORBIDDEN' });
    }
    const a = parseAdmin(raw);
    if (!a) return reply({ ok: false, error: 'BAD ACTION' });
    const r = roomOf(sock.id);
    console.log(`[admin] ${acct!.user.username} room=${r?.code ?? '-'} ${JSON.stringify(a)}`);
    if (!r) return reply({ ok: false, error: 'NOT IN A ROOM' });
    const me = r.players.get(sock.id)!, m = r.match;
    const who = (t: string): Player[] => (t === 'all' ? [...r.players.values()] : [r.players.get(t === 'me' ? sock.id : t)].filter((p): p is Player => !!p));
    const targets = 't' in a ? who(a.t) : [];
    if ('t' in a && !targets.length) return reply({ ok: false, error: 'NO SUCH PLAYER' });
    const playing = r.phase === 'playing' && !!m;
    const need = (ok: boolean) => (ok ? true : (reply({ ok: false, error: 'ONLY DURING A ROUND' }), false));
    const kill = (p: Player) => {
      if (p.dead || p.boarded) return;
      p.hp = 0;
      p.dead = true;
      r.deaths++;
      io.to(r.code).emit('dead', p.id);
    };
    switch (a.a) {
      case 'info': {
        const info: AdminInfo = {
          seed: r.seed || r.nextSeed, levelId: r.levelId, round: r.round, phase: r.phase, elapsed: Math.round(m?.elapsed ?? 0), bank: r.bank, mission: r.chosen ? `${r.chosen.text} ${m?.progress ?? 0}/${r.chosen.goal}${r.done ? ' DONE' : ''}` : '-',
          ents: m?.entCount ?? 0, frozen: !!m?.frozen,
          players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, hp: p.hp, dead: p.dead, god: (p.immuneUntil ?? 0) > Date.now() + 3600_000, ammo: !!p.infAmmo })),
        };
        return reply({ ok: true, info });
      }
      case 'level': {
        if (!(a.id in LEVELS)) return reply({ ok: false, error: 'NO SUCH LEVEL' });
        // una ronda de prueba para todos con ese nivel y esa semilla: si hay una en marcha se corta (todos vuelven a la sala de espera) y empieza otra
        const go = () => {
          if (rooms.get(r.code) !== r || r.phase !== 'lobby') return;
          prepare(r, a.seed, a.id);
          begin(r);
        };
        if (r.phase === 'lobby') go();
        else if (r.phase === 'playing' || r.phase === 'starting') (r.tok = (r.tok ?? 0) + 1), backToLobby(r, [...r.players.values()]), setTimeout(go, 3500);
        else return reply({ ok: false, error: 'ROUND ENDING' });
        return reply({ ok: true });
      }
      case 'lobby':
        if (r.phase === 'playing' || r.phase === 'starting') (r.tok = (r.tok ?? 0) + 1), backToLobby(r, [...r.players.values()]);
        return reply({ ok: true });
      case 'money':
        r.bank = Math.min(MONEY_LIMIT, Math.max(0, a.mode === 'set' ? a.n : r.bank + a.n));
        push(r);
        return reply({ ok: true });
      case 'give':
        for (const p of targets) {
          // (el admin no mira el sitio de la mochila: solo el tope de cada cosa)
          const rr = a.r ?? rollRarity(Math.random()), it = a.item;
          const plus = (inv: Inventory): Inventory | undefined => (it === 'loot' ? ((inv.loot?.length ?? 0) < 20 ? { ...inv, loot: [...(inv.loot ?? []), { r: rr, w: 0 }] } : undefined) : canHold(inv, it) ? purchase(inv, it, rr) : undefined);
          if (r.phase === 'lobby') {
            const n = plus(p.inv);
            if (n) (p.inv = n), io.to(p.id).emit('inv', p.inv);
          } else if (playing && !p.dead && !p.boarded) {
            const n = plus(p.cap); // lo que puede llevar (y declarar al subir); el cliente lo recibe en la mano
            if (!n) continue;
            p.cap = n;
            if (it !== 'loot') io.to(p.id).emit('adminFx', { k: 'give', item: it });
            bag(p);
          }
        }
        return reply({ ok: true });
      case 'ups':
        for (const p of targets) (p.ups = cleanUps({ ...p.ups, ...Object.fromEntries((a.id === '*' ? UP_IDS : [a.id]).map((id) => [id, a.lv])) })), (p.hp = Math.min(p.hp, st(p).hp) || st(p).hp);
        push(r);
        return reply({ ok: true });
      case 'award': {
        // un logro a quien tenga cuenta (los invitados no guardan nada); `award` lo guarda y avisa al jugador (`achievement`) si era nuevo
        const accounts = targets.filter((p) => p.uid);
        if (!accounts.length) return reply({ ok: false, error: 'NO ACCOUNT' });
        const keys = a.key === '*' ? [...ACHIEVEMENT_KEYS] : [a.key];
        const given = accounts.reduce((n, p) => n + keys.filter((k) => award(p.uid, k)).length, 0);
        return reply(given ? { ok: true } : { ok: false, error: 'ALREADY UNLOCKED' });
      }
      case 'god':
        if (!need(playing)) return;
        for (const p of targets) p.immuneUntil = a.on ? Number.MAX_SAFE_INTEGER : 0;
        return reply({ ok: true });
      case 'ammo':
        for (const p of targets) (p.infAmmo = a.on), io.to(p.id).emit('adminFx', { k: 'ammo', on: a.on });
        return reply({ ok: true });
      case 'heal':
        if (!need(playing)) return;
        for (const p of targets) if (!p.dead) (p.hp = st(p).hp), io.to(p.id).emit('adminFx', { k: 'heal' });
        return reply({ ok: true });
      case 'kill':
        if (!need(playing)) return;
        targets.forEach(kill);
        push(r);
        checkOver(r);
        return reply({ ok: true });
      case 'revive': {
        if (!need(playing)) return;
        for (const p of targets) {
          if (!p.dead || p.boarded) continue;
          const at = [...r.players.values()].find((q) => q !== p && !q.dead && !q.boarded)?.st ?? { ...START, x: m!.start.x, z: m!.start.z };
          revive(r, p, at);
        }
        return reply({ ok: true });
      }
      case 'run': {
        // «Run for your life» a quien sea (lo corre su cliente por el flujo del Tótem): se le mata, empieza el nivel y al llegar el servidor lo revive (sin esperar REVIVE_MIN)
        if (!need(playing)) return;
        for (const p of targets) {
          if (p.boarded) continue;
          kill(p);
          p.reviving = { by: sock.id, at: Date.now() - REVIVE_MIN };
          io.to(r.code).emit('reviving', { id: p.id, name: p.name, by: sock.id });
        }
        push(r);
        return reply({ ok: true });
      }
      case 'tp': {
        if (!need(playing)) return;
        const dest = a.to === 'elevator' ? centerOf(m!.maze.elevator) : a.to === 'start' ? m!.start : r.players.get(a.who === 'me' ? sock.id : (a.who ?? ''))?.st;
        if (!dest) return reply({ ok: false, error: 'NO SUCH PLAYER' });
        for (const p of targets) {
          if (p.dead || p.boarded || p.st === dest) continue;
          io.to(p.id).emit('adminFx', { k: 'tp', x: dest.x, y: 0, z: dest.z, yaw: p.st.yaw });
        }
        return reply({ ok: true });
      }
      case 'mission':
        if (!need(playing && !!r.chosen)) return;
        r.done = true;
        push(r);
        return reply({ ok: true });
      case 'end': {
        if (!need(playing)) return;
        for (const p of r.players.values()) p.boarded = a.ok && !p.dead;
        r.done = a.ok && [...r.players.values()].some((p) => p.boarded); // sin nadie vivo a quien subir, es un fracaso
        finish(r);
        return reply({ ok: true });
      }
      case 'tvs':
        if (!need(playing)) return;
        m!.allTvsOff();
        return reply({ ok: true });
      case 'ent': {
        if (!need(playing)) return;
        if (a.op === 'clear') m!.clearEnts();
        else if (a.op === 'freeze' || a.op === 'thaw') m!.frozen = a.op === 'freeze';
        else {
          const at = r.players.get(a.near === 'me' || !a.near ? sock.id : a.near)?.st ?? me.st;
          m!.adminSpawn(a.kind ?? (Math.random() < 0.5 ? 'bacteria' : 'partygoer'), at.x, at.z);
        }
        return reply({ ok: true });
      }
    }
  });

  sock.on('pickup', (id, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    const k = String(id);
    const kind = GAIN[k[0]];
    // (ids d...: soltados) Lo del mapa que no cabe (ya lo lleva, o el tope) se deja donde está: si no, se perdería para todos sin llegar a nadie
    // (en la sala de espera solo hay soltados `d…`: se recogen para el inventario que se conserva)
    if (r?.phase === 'lobby' && p && k[0] === 'd') {
      const d = r.drops.get(k);
      const got = !!d && Math.hypot(p.st.x - d.x, p.st.z - d.z) < 3.6 && fitsDrop(p.inv, d, p);
      if (got) (r.drops.delete(k), (p.inv = withDrop(p.inv, d!)), sock.emit('inv', p.inv), save(r));
      if (typeof cb === 'function') cb(got);
      return;
    }
    const cell = r?.match?.cellOf(k), rar = cell ? spotRarity(k, cell, LEVELS[r!.levelId]?.luck) : 0; // (la rareza del objeto del mapa sale de su celda: la misma que pinta el cliente)
    const room = !p || (k[0] === 'v' ? hasRoom(p.cap, st(p), 'loot') : !kind || canHold(p.cap, kind, st(p)));
    const ok = !!r?.match && !!p && r.phase === 'playing' && !p.boarded && (k[0] === 'd' ? takeDrop(r, p, k) : room && r.match.pickup(p, k));
    if (ok && p!.uid && k[0] === 't') count(p!.uid, 'tapes'); // las cintas (ids t...)
    if (ok && k[0] !== 'd') gain(p!, k, rar); // lo que se lleva: hay que tenerlo para soltarlo, beberlo o declararlo al subir
    if (typeof cb === 'function') cb(ok);
  });

  sock.on('strip', (pts) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r || !p || p.dead || r.phase !== 'playing' || !Array.isArray(pts)) return;
    // puntos válidos, a más de STRIP_GAP*0,75 del anterior, hasta STRIP_PTS
    const out: number[] = [];
    for (let i = 0; i + 1 < pts.length && out.length < STRIP_PTS * 2; i += 2) {
      const x = pts[i], z = pts[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e4 || Math.abs(z) > 1e4) return;
      const n = out.length;
      if (n && Math.hypot(x - out[n - 2], z - out[n - 1]) < STRIP_GAP * 0.75) continue;
      out.push(x, z);
    }
    if (out.length < 4) return;
    const mine = r.strips.filter((k) => k.owner === sock.id);
    if (mine.length >= STRIP_MAX) {
      r.strips.splice(r.strips.indexOf(mine[0]), 1);
      io.to(r.code).emit('unstrip', mine[0].id);
    }
    const k: Strip = { id: Math.random().toString(36).slice(2, 8), owner: sock.id, pts: out };
    r.strips.push(k);
    io.to(r.code).emit('strip', k);
  });

  sock.on('unstrip', (id) => {
    const r = roomOf(sock.id);
    if (!r || r.phase !== 'playing' || !r.strips.some((k) => k.id === id)) return;
    r.strips = r.strips.filter((k) => k.id !== id);
    io.to(r.code).emit('unstrip', id);
  });

  sock.on('hit', (id) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing') return;
    // como mucho un tiro cada 0,2 s
    if (Date.now() - p.lastHit < 200) return;
    p.lastHit = Date.now();
    if (r.match.hit(p, Number(id)) && p.uid) (award(p.uid, 'idiot'), count(p.uid, 'kills'));
  });

  // fuego amigo: un tiro del rifle que da a un compañero lo mata (el cliente apunta; aquí se comprueba rifle en mano, distancia y ritmo)
  sock.on('shoot', (id) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), q = r?.players.get(String(id));
    if (!r?.match || !p || !q || q === p || r.phase !== 'playing' || p.dead || p.boarded || q.dead || q.boarded || p.st.held !== 'gun' || (q.immuneUntil ?? 0) > Date.now()) return;
    if (Date.now() - p.lastHit < 200 || Math.hypot(p.st.x - q.st.x, p.st.z - q.st.z) > 35) return;
    p.lastHit = Date.now();
    r.match.noise(p.st.x, p.st.z, NOISE_SHOT);
    q.hp = 0;
    q.dead = true;
    r.deaths++;
    io.to(r.code).emit('dead', q.id);
    push(r);
    checkOver(r);
  });

  // el estampido de un tiro (también los que fallan): atrae a las entidades
  sock.on('bang', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (r?.match && p && r.phase === 'playing' && !p.dead && !p.boarded && p.st.held === 'gun') (r.match.noise(p.st.x, p.st.z, NOISE_SHOT), (p.cap = wearInv(p.cap, 0, 'gun')));
  });

  sock.on('photo', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    // la foto vale para la misión (de cualquiera, también invitados); el contador de la cuenta solo cuenta las de quien tiene cuenta
    if (r?.match && p && r.phase === 'playing' && !p.boarded && r.match.photo(p) !== undefined) ((p.cap = wearInv(p.cap, 0, 'camera')), p.uid && count(p.uid, 'photos'));
  });

  // invitados: su color, uno de los gratis (con cuenta el aspecto sale de la cuenta, no del cliente)
  sock.on('look', (c) => {
    if (uid || typeof c !== 'string') return;
    const def = cosmetic('color', c);
    if (!def || def.need) return;
    guestColor.set(sock.id, c);
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (r && p) (p.look = lookFor(0, sock.id), push(r));
  });

  sock.on('fell', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || p.boarded || !levelCaps(r.levelId).fall || !r.match.fell(p)) return; // (en las Poolrooms no hay vacío: las alturas negativas son agua)
    p.dead = true; // (fell ya le dejó la vida a cero)
    r.deaths++;
    if (p.uid) count(p.uid, 'falls');
    io.to(r.code).emit('dead', p.id);
    push(r);
    checkOver(r);
  });

  // el Tótem de la vida: lo usa un vivo que lo lleva con un compañero muerto, que pasa a correr «Run for your life» (lo simula su cliente)
  sock.on('totem', (target, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), t = r?.players.get(String(target));
    const ok = !!r?.match && r.phase === 'playing' && !!p && !!t && t !== p && !p.dead && p.cap.totem > 0 && t.dead && !t.reviving;
    if (ok) {
      p!.cap.totem--;
      if (p!.uid) award(p!.uid, 'second_chance');
      t!.reviving = { by: p!.id, at: Date.now() };
      io.to(r!.code).emit('reviving', { id: t!.id, name: t!.name, by: p!.id });
    }
    if (typeof cb === 'function') cb(ok);
  });

  // el caído llega a la meta: solo vale una vez y pasado el tiempo mínimo; vuelve con la vida llena, inmune y junto a quien usó el Tótem
  sock.on('runDone', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || !p.dead || !p.reviving || Date.now() - p.reviving.at < REVIVE_MIN) return;
    const by = r.players.get(p.reviving.by), at = by && !by.dead ? by : [...r.players.values()].find((q) => q !== p && !q.dead);
    p.reviving = undefined;
    if (!at) return;
    revive(r, p, at.st);
  });

  // el caído no llega a la meta: solo hay una oportunidad, sigue muerto
  sock.on('runFail', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || !p.dead || !p.reviving) return;
    p.reviving = undefined;
    io.to(r.code).emit('runFailed', { id: p.id, name: p.name });
    push(r);
  });

  // la cordura a cero: muere (como al caer). Vale mientras esté vivo y en partida
  sock.on('insane', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || p.boarded || p.dead || !levelCaps(r.levelId).insane) return; // (la cordura es del nivel 0)
    p.hp = 0;
    p.dead = true;
    r.deaths++;
    io.to(r.code).emit('dead', p.id);
    push(r);
    checkOver(r);
  });

  // sube al ascensor (abierto con la misión cumplida): conserva lo que lleva, acotado a lo que podía tener; ya no juega
  sock.on('ascend', (inv) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || !r.done || !r.match.canBoard(p)) return;
    p.boarded = true;
    p.inv = cleanInv(inv, p.cap);
    r.boardAt ??= Date.now();
    push(r);
    checkOver(r);
  });

  // la votación de la misión (abierta al acabar la entrada por la puerta): un voto por jugador ('' lo quita)
  sock.on('vote', (id) => {
    const r = roomOf(sock.id);
    if (!r || r.phase !== 'starting' || !r.voteEnd || r.chosen) return;
    if (id === '') r.votes.delete(sock.id);
    else if (typeof id === 'string' && r.pool.some((m) => m.id === id)) r.votes.set(sock.id, id);
    else return;
    push(r);
  });

  // la tienda: solo en el lobby; el dinero es de todos y el objeto, de quien lo compra
  sock.on('buy', (id, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), it = shopItem(id);
    const reply = (ok: boolean, error?: string) => typeof cb === 'function' && cb({ ok, error });
    if (!r || !p || !it || r.phase !== 'lobby') return reply(false, 'NOT AVAILABLE');
    const now = Date.now();
    if (now - (p.lastBuy ?? 0) < 150) return reply(false, 'TOO FAST');
    p.lastBuy = now;
    if (!itemOpen(it.id, openOf(r))) return reply(false, 'LEVEL LOCKED');
    if (!canHold(p.inv, it.id, st(p))) return reply(false, 'CANNOT CARRY MORE');
    if (r.bank < it.price) return reply(false, 'NOT ENOUGH MONEY');
    r.bank -= it.price;
    p.inv = purchase(p.inv, it.id, rollRarity(Math.random()));
    sock.emit('inv', p.inv);
    push(r);
    reply(true);
  });

  // el árbol de mejoras: solo en el lobby; el dinero es de todos y la mejora, de quien la compra (y se guarda con la sala)
  sock.on('upgrade', (id, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    const reply = (ok: boolean, error?: string) => typeof cb === 'function' && cb({ ok, error });
    if (!r || !p || r.phase !== 'lobby' || !UP_IDS.includes(id)) return reply(false, 'NOT AVAILABLE');
    const cost = upCost(p.ups, id);
    if (cost === null) return reply(false, upLevel(p.ups, id) >= UPGRADES[id].cost.length ? 'MAXED OUT' : 'LOCKED');
    if (r.bank < cost) return reply(false, 'NOT ENOUGH MONEY');
    r.bank -= cost;
    p.ups = { ...p.ups, [id]: upLevel(p.ups, id) + 1 };
    p.hp = st(p).hp;
    if (UPGRADES[id].level) prepare(r, r.nextSeed); // un nivel nuevo entra en el sorteo de la ronda que viene
    push(r);
    reply(true);
  });

  // soltar una unidad delante de uno: sale de lo que podía llevar y aparece en el suelo para todos
  sock.on('drop', (kind, index, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), now = Date.now();
    let ok = false;
    const free = !!r && !!p && now - (p.lastDrop ?? 0) >= DROP_GAP && [...r.drops.values()].filter((d) => d.by === p.id).length < DROP_MAX;
    // en la sala de espera también se suelta (de lo que se conserva, `inv`): lo del suelo vuelve a su dueño al empezar la ronda
    const out = free && (r!.phase === 'lobby' ? without(p!.inv, kind, Number(index) || 0) : r!.match && r!.phase === 'playing' && !p!.dead && !p!.boarded ? without(p!.cap, kind, Number(index) || 0) : undefined);
    if (out && r!.phase === 'lobby') {
      p!.lastDrop = now;
      p!.inv = out.inv;
      const x = p!.st.x - Math.sin(p!.st.yaw) * 0.7, z = p!.st.z - Math.cos(p!.st.yaw) * 0.7;
      if (Math.hypot(x - SCALE.x, z - SCALE.z) < SCALE.r) {
        // sobre la báscula: se vende (lo que valga por su rareza y su estado) y el dinero va al banco común
        const price = kind === 'loot' ? lootPrice(out.q) : sellPrice(kind, out.q);
        r!.bank += price;
        io.to(r!.code).emit('sold', { by: p!.name, name: kind === 'loot' ? 'ARTIFACT' : ITEMS[kind].name, price, r: out.q.r });
      } else {
        const id = 'd' + (++dropNo).toString(36);
        r!.drops.set(id, { id, kind, x, z, by: p!.id, at: now, q: out.q });
      }
      sock.emit('inv', p!.inv);
      push(r!);
      ok = true;
    } else if (out) {
      p!.lastDrop = now;
      p!.cap = out.inv;
      let x = p!.st.x - Math.sin(p!.st.yaw) * 0.7, z = p!.st.z - Math.cos(p!.st.yaw) * 0.7;
      if (solidAt(r!.match!.maze, x, z)) (x = p!.st.x), (z = p!.st.z); // con una pared delante, a sus pies
      const id = 'd' + (++dropNo).toString(36);
      r!.drops.set(id, { id, kind, x, z, by: p!.id, at: now, q: out.q });
      r!.match!.noise(x, z, NOISE_DROP);
      bag(p!);
      ok = true;
    }
    if (typeof cb === 'function') cb(ok);
  });

  // una televisión apagada (misión «TURN OFF THE TVS»)
  sock.on('tv', (i, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    const ok = !!r?.match && !!p && r.phase === 'playing' && Number.isInteger(i) && r.match.tv(p, i);
    if (typeof cb === 'function') cb(ok);
  });

  // una lata de Almond Water: la vida vuelve (la lleva el servidor) si de verdad la llevaba
  sock.on('drink', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || p.dead || p.boarded || p.cap.water <= 0) return;
    const heal = HP_MAX * WATER_HEAL * boostOf(p.cap, 'water'); // (la rareza de la lata cura más)
    p.cap = removeItem(p.cap, 'water');
    p.hp = Math.min(st(p).hp, p.hp + heal);
    bag(p);
  });

  // las taquillas: el cliente ya ha hecho el minijuego; aquí se comprueba que está cerca y se reparte lo que hay dentro
  sock.on('locker', (id, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), cell = typeof id === 'string' ? r?.match?.cellOf(id) : undefined;
    if (!r?.match || !p || r.phase !== 'playing' || p.dead || p.boarded || !cell || id[0] !== 'l' || typeof cb !== 'function') return void (typeof cb === 'function' && cb({ ok: false }));
    const c = centerOf(cell);
    if (Math.hypot(p.st.x - c.x, p.st.z - c.z) > 4) return cb({ ok: false });
    let l = r.lockers.get(id);
    if (!l) {
      const items = lockerContents(r.seed, id, openOf(r), LEVELS[r.levelId]?.luck ?? 1);
      r.lockers.set(id, (l = { items, taken: items.map(() => false) }));
      if (p.uid) count(p.uid, 'lockers');
    }
    cb({ ok: true, items: l.items, taken: l.taken });
  });
  sock.on('lockerTake', (id, i, cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), l = typeof id === 'string' ? r?.lockers.get(id) : undefined, it = l?.items[i];
    const reply = (ok: boolean) => typeof cb === 'function' && cb(ok);
    if (!r?.match || !p || !l || !it || l.taken[i] || r.phase !== 'playing' || p.dead || p.boarded) return reply(false);
    const cell = r.match.cellOf(id), c = cell && centerOf(cell);
    if (!c || Math.hypot(p.st.x - c.x, p.st.z - c.z) > 4) return reply(false);
    if (it.kind === 'loot' ? !hasRoom(p.cap, st(p), 'loot') : !canHold(p.cap, it.kind, st(p))) return reply(false);
    l.taken[i] = true;
    p.cap = it.kind === 'loot' ? { ...p.cap, loot: [...(p.cap.loot ?? []), { r: it.r, w: 0 }] } : addItem(p.cap, it.kind, it.r);
    bag(p);
    reply(true);
  });

  // la Monster: se gasta una lata (el efecto de velocidad lo aplica el cliente; el servidor ya deja avanzar lo que hace falta)
  sock.on('monster', () => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r?.match || !p || r.phase !== 'playing' || p.dead || p.boarded || p.cap.monster <= 0) return;
    p.cap = removeItem(p.cap, 'monster');
    if (p.uid) count(p.uid, 'monsters');
    bag(p);
  });

  // la carta Uno Reverse: cambia de sitio con un compañero vivo al azar; una sola vez
  sock.on('uno', (cb) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    const reply = (ok: boolean) => typeof cb === 'function' && cb(ok);
    if (!r?.match || !p || r.phase !== 'playing' || p.dead || p.boarded || !p.cap.uno) return reply(false);
    const others = [...r.players.values()].filter((q) => q.id !== p.id && !q.dead && !q.boarded);
    const q = others[(Math.random() * others.length) | 0];
    if (!q) return reply(false);
    const a = { ...p.st }, b = { ...q.st };
    p.st = { ...p.st, x: b.x, y: b.y, z: b.z };
    q.st = { ...q.st, x: a.x, y: a.y, z: a.z };
    io.to(p.id).emit('adminFx', { k: 'tp', x: b.x, y: b.y, z: b.z, yaw: a.yaw });
    io.to(q.id).emit('adminFx', { k: 'tp', x: a.x, y: a.y, z: a.z, yaw: b.yaw });
    p.cap = removeItem(p.cap, 'uno');
    if (p.uid) count(p.uid, 'unos');
    bag(p);
    reply(true);
  });

  // pistola de agua: el servidor decide a quién moja o para (el cliente solo pinta el chorro)
  const squirtAt = new Map<string, number>();
  sock.on('squirt', (a) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id), now = Date.now();
    if (!r?.match || !p || r.phase !== 'playing' || !a || !Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.yaw)) return;
    if (now - (squirtAt.get(sock.id) ?? 0) < 50) return; // ~20 mensajes/s
    squirtAt.set(sock.id, now);
    const hit = r.match.squirt(p, [...r.players.values()], a, now);
    if (hit) io.to(hit.to.id).emit('wet', hit.ev);
  });

  sock.on('chat', (text) => {
    const r = roomOf(sock.id), p = r?.players.get(sock.id);
    if (!r || !p || typeof text !== 'string') return;
    const t = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX);
    const now = Date.now();
    if (!t || now - p.lastChat < CHAT_GAP) return;
    p.lastChat = now;
    io.to(r.code).emit('chat', { id: p.id, name: p.name, text: t });
  });

  // chat de voz: el audio va entre jugadores (WebRTC); aquí solo se reenvía la señalización, y solo dentro de la misma sala
  sock.on('rtc', (to, data) => {
    if (typeof to !== 'string' || !data || typeof data !== 'object' || JSON.stringify(data).length > 8000) return;
    const r = roomOf(sock.id);
    if (!r || !r.players.has(sock.id) || !r.players.has(to)) return;
    io.to(to).emit('rtc', sock.id, data);
  });

  sock.on('leave', () => leave(sock.id));
  sock.on('disconnect', () => {
    leave(sock.id);
    guestColor.delete(sock.id);
    if (uid) {
      const s = sockets.get(uid);
      s?.delete(sock.id);
      if (!s?.size) sockets.delete(uid);
    }
  });
});

// los logros nuevos llegan al jugador por su socket; un cambio de armario refresca su aspecto en la sala
hooks.notify = (uid, key) => sockets.get(uid)?.forEach((id) => io.to(id).emit('achievement', key));
hooks.loadout = (uid) =>
  sockets.get(uid)?.forEach((id) => {
    const r = roomOf(id), p = r?.players.get(id);
    if (r && p) (p.look = lookFor(uid, id), push(r));
  });

// el estado de mantenimiento: si cambia, se avisa a todos (también a los que están jugando)
setInterval(() => {
  const next = readStatus();
  if (JSON.stringify(next) !== JSON.stringify(status)) (status = next), io.emit('status', next);
}, 10_000);

// la IA y las muertes, 20 veces por segundo
const DT = 1 / 20;
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.phase !== 'playing' || !r.match) continue;
    r.match.tick(DT, [...r.players.values()], (p) => {
      r.deaths++;
      io.to(r.code).emit('dead', p.id);
      push(r);
    });
    roundTick(r);
    checkOver(r);
  }
}, DT * 1000);

// el desgaste: cada segundo de partida gasta un poco lo que lleva cada uno; su cliente lo sabe cada 5 s
let wearN = 0;
setInterval(() => {
  wearN++;
  for (const r of rooms.values()) {
    if (r.phase !== 'playing') continue;
    for (const p of r.players.values()) if (!p.dead && !p.boarded) (p.cap = wearInv(p.cap, 1)), wearN % 5 || bag(p);
  }
}, 1000);

// el estado de cada jugador a su sala, 15 veces por segundo; el del mundo, 10
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.phase !== 'playing' && !inWait(r)) continue;
    // volatile: si el socket de alguien (un túnel lento) no ha terminado de vaciar lo anterior, este se descarta en vez de
    // encolarse: llega siempre lo último y no una ráfaga de estados viejos
    io.to(r.code).volatile.emit('players', Object.fromEntries([...r.players].map(([id, p]) => [id, { ...p.st, name: p.name, dead: p.dead, hp: p.dead ? 0 : p.hp }])));
  }
}, 1000 / 15);
const lobbyHad = new Set<string>(); // salas de espera a las que ya se mandó una lista con algo (para mandar también la vacía)
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.phase === 'playing' && r.match) io.to(r.code).volatile.emit('world', { ...r.match.snapshot(), drops: [...r.drops.values()].map(({ at: _a, ...d }) => d), t: Date.now() });
    else if (r.phase === 'lobby') {
      const now = Date.now();
      for (const [id, d] of r.drops) if (now - d.at > DROP_TTL * 1000) r.drops.delete(id);
      if (r.drops.size || lobbyHad.has(r.code)) io.to(r.code).volatile.emit('ldrops', [...r.drops.values()].map(({ at: _a, ...d }) => d));
      r.drops.size ? lobbyHad.add(r.code) : lobbyHad.delete(r.code);
    }
  }
}, 100);

http.listen(Number(process.env.PORT) || SERVER_PORT, () => console.log(`backrooms server en :${process.env.PORT || SERVER_PORT}`));
