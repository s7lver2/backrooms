import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanLook, type Look, type StatKey } from '@backrooms/shared';

/*
 * La base de datos: SQLite embebido (node:sqlite), un archivo (DB_PATH o server/data/backrooms.db). Toda consulta va
 * parametrizada; nada que venga del cliente se concatena nunca en el SQL. Las migraciones son una lista que se aplica
 * al arrancar (PRAGMA user_version).
 */

const path = process.env.DB_PATH || fileURLToPath(new URL('../data/backrooms.db', import.meta.url));
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL,
     username_lower TEXT NOT NULL UNIQUE,
     pass_hash TEXT NOT NULL,
     recovery_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     id_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE achievements (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     unlocked_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, key)
   );
   CREATE TABLE stats (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     value INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, key)
   );
   CREATE TABLE loadout (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     color TEXT NOT NULL DEFAULT 'stock',
     head TEXT NOT NULL DEFAULT '',
     back TEXT NOT NULL DEFAULT ''
   );`,
  // foto de perfil: una por cuenta (webp o jpeg ya validado), aparte de users para no cargar el blob en cada consulta
  `CREATE TABLE avatars (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     mime TEXT NOT NULL,
     data BLOB NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // salas guardadas: una partida del dueño (ajustes, banco, ronda y lo de cada cuenta: mejoras e inventario) en un JSON
  `CREATE TABLE saves (
     code TEXT PRIMARY KEY,
     owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX saves_owner ON saves(owner_id);`,
  // login con Discord: la cuenta de Discord (su id) enlazada a una cuenta del juego
  `CREATE TABLE discord (
     discord_id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
   );`,
];
const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
for (let v = version; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`); // v es nuestro entero, no una entrada
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
  recovery_hash: string;
}
const user = (r: Record<string, unknown> | undefined) => r as unknown as UserRow | undefined;

const q = {
  byLower: db.prepare('SELECT id, username, pass_hash, recovery_hash FROM users WHERE username_lower = ?'),
  byId: db.prepare('SELECT id, username, pass_hash, recovery_hash FROM users WHERE id = ?'),
  insUser: db.prepare('INSERT INTO users (username, username_lower, pass_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
  setPass: db.prepare('UPDATE users SET pass_hash = ?, recovery_hash = ? WHERE id = ?'),
  insSession: db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  session: db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?'),
  slide: db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
  delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  delExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  trimSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash NOT IN (SELECT id_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)'),
  achs: db.prepare('SELECT key, unlocked_at FROM achievements WHERE user_id = ?'),
  insAch: db.prepare('INSERT OR IGNORE INTO achievements (user_id, key, unlocked_at) VALUES (?, ?, ?)'),
  stats: db.prepare('SELECT key, value FROM stats WHERE user_id = ?'),
  bump: db.prepare('INSERT INTO stats (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = value + excluded.value'),
  stat: db.prepare('SELECT value FROM stats WHERE user_id = ? AND key = ?'),
  loadout: db.prepare('SELECT color, head, back FROM loadout WHERE user_id = ?'),
  setLoadout: db.prepare('INSERT INTO loadout (user_id, color, head, back) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET color = excluded.color, head = excluded.head, back = excluded.back'),
};

export const userByName = (name: string) => user(q.byLower.get(name.toLowerCase()));
export const userById = (id: number) => user(q.byId.get(id));
/** La cuenta enlazada a una cuenta de Discord (por su id), si la hay. */
export const userByDiscord = (did: string) => user(db.prepare('SELECT u.id, u.username, u.pass_hash, u.recovery_hash FROM discord d JOIN users u ON u.id = d.user_id WHERE d.discord_id = ?').get(did));
/** Cambia el nombre de la cuenta; false si ya lo lleva otra (la restricción UNIQUE lo decide). */
export function renameUser(id: number, name: string) {
  try {
    db.prepare('UPDATE users SET username = ?, username_lower = ? WHERE id = ?').run(name, name.toLowerCase(), id);
    return true;
  } catch {
    return false;
  }
}
/** Enlaza una cuenta de Discord a la cuenta; false si esa cuenta ya tiene otra Discord (o esta ya es de otra). */
export function linkDiscord(did: string, uid: number) {
  try {
    db.prepare('INSERT INTO discord (discord_id, user_id) VALUES (?, ?)').run(did, uid);
    return true;
  } catch {
    return false;
  }
}
/** Crea la cuenta; null si el usuario ya existe (la restricción UNIQUE lo decide, sin carreras). */
export function createUser(username: string, passHash: string, recoveryHash: string): number | null {
  try {
    const r = q.insUser.run(username, username.toLowerCase(), passHash, recoveryHash, Date.now());
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error).message))) return null;
    throw e;
  }
}
/** Nueva contraseña y nuevo código de recuperación; todas las sesiones de la cuenta caen. */
export function resetCredentials(id: number, passHash: string, recoveryHash: string) {
  q.setPass.run(passHash, recoveryHash, id);
  q.delUserSessions.run(id);
}

// sesiones: en la BD solo está el SHA-256 del id que lleva la cookie
const MAX_SESSIONS = 10;
export function addSession(idHash: string, userId: number, ttl: number) {
  const now = Date.now();
  q.delExpired.run(now);
  q.insSession.run(idHash, userId, now, now + ttl);
  q.trimSessions.run(userId, userId, MAX_SESSIONS);
}
export function sessionUser(idHash: string): { user: UserRow; expires: number } | undefined {
  const s = q.session.get(idHash);
  if (!s) return undefined;
  if (Number(s.expires_at) < Date.now()) return void q.delSession.run(idHash);
  const u = userById(Number(s.user_id));
  return u && { user: u, expires: Number(s.expires_at) };
}
export const slideSession = (idHash: string, expires: number) => void q.slide.run(expires, idHash);
export const deleteSession = (idHash: string) => void q.delSession.run(idHash);
export const purgeSessions = () => void q.delExpired.run(Date.now());

// logros y contadores
export const achievementsOf = (id: number) => Object.fromEntries(q.achs.all(id).map((r) => [String(r.key), Number(r.unlocked_at)]));
let rar = { at: 0, v: {} as Record<string, number> };
/** % de cuentas que tienen cada logro (cacheado 60 s). */
export function rarity() {
  if (Date.now() - rar.at < 60_000) return rar.v;
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0) || 1;
  const v = Object.fromEntries(db.prepare('SELECT key, COUNT(*) AS n FROM achievements GROUP BY key').all().map((r) => [String(r.key), Math.round((Number(r.n) / total) * 100)]));
  return (rar = { at: Date.now(), v }).v;
}
/** true si se acaba de desbloquear (no lo tenía). */
export const unlockAchievement = (id: number, key: string) => Number(q.insAch.run(id, key, Date.now()).changes) > 0;
export const statsOf = (id: number) => Object.fromEntries(q.stats.all(id).map((r) => [String(r.key), Number(r.value)])) as Partial<Record<StatKey, number>>;
/** Suma `by` al contador y devuelve su valor nuevo. */
export function bumpStat(id: number, key: StatKey, by = 1) {
  q.bump.run(id, key, by);
  return Number(q.stat.get(id, key)?.value ?? 0);
}
export function loadoutOf(id: number): Look {
  return cleanLook(q.loadout.get(id));
}

// foto de perfil
const qa = {
  get: db.prepare('SELECT mime, data, updated_at FROM avatars WHERE user_id = ?'),
  ver: db.prepare('SELECT updated_at FROM avatars WHERE user_id = ?'),
  set: db.prepare('INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at'),
  del: db.prepare('DELETE FROM avatars WHERE user_id = ?'),
};
export const avatarOf = (id: number) => qa.get.get(id) as unknown as { mime: string; data: Uint8Array; updated_at: number } | undefined;
/** El valor de `avatar` en Me y Member: `<id>?v=<versión>`, o vacío si no tiene foto. */
export const avatarRef = (id: number) => (id && qa.ver.get(id) ? `${id}?v=${qa.ver.get(id)!.updated_at}` : '');
export const saveAvatar = (id: number, mime: string, data: Uint8Array) => void qa.set.run(id, mime, data, Date.now());
export const deleteAvatar = (id: number) => void qa.del.run(id);

// salas guardadas
const qs = {
  get: db.prepare('SELECT owner_id, data FROM saves WHERE code = ?'),
  list: db.prepare('SELECT code, data, updated_at FROM saves WHERE owner_id = ? ORDER BY updated_at DESC'),
  set: db.prepare('INSERT INTO saves (code, owner_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
  del: db.prepare('DELETE FROM saves WHERE code = ? AND owner_id = ?'),
  trim: db.prepare('DELETE FROM saves WHERE owner_id = ? AND code NOT IN (SELECT code FROM saves WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?)'),
};
/** Salas guardadas por cuenta: al pasar de aquí se borra la más antigua. */
export const MAX_SAVES = 6;
const parse = (t: unknown) => {
  try {
    return JSON.parse(String(t)) as Record<string, unknown>;
  } catch {
    return {};
  }
};
export const saveOf = (code: string) => {
  const r = qs.get.get(code);
  return r && { owner: Number(r.owner_id), data: parse(r.data) };
};
export const savesOf = (owner: number) => qs.list.all(owner).map((r) => ({ code: String(r.code), data: parse(r.data), at: Number(r.updated_at) }));
export function writeSave(code: string, owner: number, data: unknown) {
  qs.set.run(code, owner, JSON.stringify(data), Date.now());
  qs.trim.run(owner, owner, MAX_SAVES);
}
export const deleteSave = (code: string, owner: number) => Number(qs.del.run(code, owner).changes) > 0;

export const saveLoadout =(id: number, l: Look) => void q.setLoadout.run(id, l.color, l.head, l.back);

// OJO: los statements solo guardan una referencia débil a la base; si nada más la retiene, el GC la cierra y fallan ("statement has been finalized")
export const database = db;
