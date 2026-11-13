import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import {
  ACHIEVEMENT_KEYS, ADMIN_USER, SERVER_PORT, AVATAR_MAX, AVATAR_PX, AVATAR_TYPES, BODY_MAX, CLIENT_PORT, COSMETICS, PASS_MAX, PASS_MIN, USER_RE, cosmetic, lookAllowed,
  type Look, type Me, type Slot,
} from '@backrooms/shared';
import * as db from './db';
import { award, hooks } from './progress';

/*
 * Cuentas: usuario y contraseña, sin email. La API HTTP vive en el mismo servidor que las salas.
 *
 * - Contraseñas y código de recuperación: argon2id (OWASP: 19 MiB, t = 2, p = 1). Nunca se guardan ni se registran en claro.
 * - Sesión: 32 bytes aleatorios en una cookie httpOnly; en la BD, solo su SHA-256. 30 días deslizantes.
 * - CSRF: solo POST con application/json y un Origin permitido (los navegadores no lo falsean).
 * - Intentos: por IP y por usuario, con bloqueo creciente; errores genéricos y tiempo uniforme (hash falso).
 *
 * Entorno: CLIENT_ORIGIN (orígenes del cliente separados por coma; con él, solo esos), COOKIE_CROSS_SITE=1 (cliente y
 * servidor en dominios distintos: SameSite=None; Secure), TRUST_PROXY=n (n proxies delante: la IP sale de X-Forwarded-For),
 * NODE_ENV=production (cookie Secure), DB_PATH.
 */

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // Argon2id es el algoritmo por defecto
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const COOKIE = 'br_sid';
const cross = process.env.COOKIE_CROSS_SITE === '1';
const secure = cross || process.env.NODE_ENV === 'production';
const strict = !!process.env.CLIENT_ORIGIN;

/** Orígenes del cliente que se aceptan. Sin CLIENT_ORIGIN (desarrollo) también vale el mismo host que la petición (LAN, túnel). */
export const allowedOrigins = strict
  ? process.env.CLIENT_ORIGIN!.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  : [`http://localhost:${CLIENT_PORT}`, `http://127.0.0.1:${CLIENT_PORT}`];
export function originOk(origin: string | undefined, host: string | undefined) {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (strict) return false;
  try {
    const u = new URL(origin);
    if (u.host === host) return true;
    // desarrollo: el proxy de Vite reescribe el Host, así que también vale el puerto del cliente desde localhost o una IP de la red local
    return u.protocol === 'http:' && u.port === String(CLIENT_PORT) && /^(localhost|127\.[\d.]+|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+|169\.254\.[\d.]+|[\w-]+\.local)$/.test(u.hostname);
  } catch {
    return false;
  }
}

// ── hashes ───────────────────────────────────────────────────────────────

// como mucho 2 hashes a la vez (cada uno usa 19 MiB y un hilo) y una cola corta: más allá, 503
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (running >= 2) {
    if (waiting.length >= 24) throw new Busy();
    await new Promise<void>((r) => waiting.push(r));
  } else running++;
  try {
    return await f();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
class Busy extends Error {}
const hashIt = (s: string) => slot(() => hash(s, ARGON));
const check = (h: string, s: string) =>
  slot(() => verify(h, s)).catch((e) => {
    if (e instanceof Busy) throw e;
    return false;
  });
let dummy: Promise<string> | undefined; // contra el que se verifica cuando el usuario no existe: mismo coste, mismo tiempo
const DUMMY_PASS = randomBytes(16).toString('base64url');
const fake = (pass: string) => (dummy ??= hashIt(DUMMY_PASS)).then((h) => check(h, pass));
void (dummy = hashIt(DUMMY_PASS)).catch(() => {}); // calentado al arrancar: la primera verificación falsa no tarda más

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const RC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0 O 1 I L
/** 20 caracteres (≈ 99 bits) en grupos: XXXXX-XXXXX-XXXXX-XXXXX. */
const newRecovery = () => Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => RC[randomInt(RC.length)]).join('')).join('-');
const normRecovery = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── límite de intentos ───────────────────────────────────────────────────

class Limiter {
  private m = new Map<string, { n: number; last: number; until: number }>();
  constructor(private max: number, private window: number) {}
  /** ms que faltan para poder volver a intentarlo (0 = adelante). */
  wait(key: string) {
    return Math.max(0, (this.m.get(key)?.until ?? 0) - Date.now());
  }
  /** Un fallo (o un intento): pasado `max`, bloqueo que se duplica (15 s, 30 s...) hasta la ventana. */
  fail(key: string) {
    const now = Date.now();
    let r = this.m.get(key);
    if (!r || now - r.last > this.window) this.m.set(key, (r = { n: 0, last: now, until: 0 }));
    r.n++;
    r.last = now;
    if (r.n >= this.max) r.until = now + Math.min(this.window, 15_000 * 2 ** Math.min(20, r.n - this.max));
    if (this.m.size > 50_000) this.sweep();
  }
  reset(key: string) {
    this.m.delete(key);
  }
  sweep() {
    const now = Date.now();
    for (const [k, r] of this.m) if (now - r.last > this.window && r.until < now) this.m.delete(k);
    if (this.m.size > 50_000) this.m.clear(); // un ataque con millones de claves: mejor perder la cuenta que la memoria
  }
}
const MIN15 = 15 * 60_000;
const loginIp = new Limiter(10, MIN15), loginUser = new Limiter(5, MIN15);
const recoverIp = new Limiter(5, MIN15), recoverUser = new Limiter(5, MIN15);
const registerIp = new Limiter(5, 3600_000);
const avatarUp = new Limiter(6, MIN15); // subidas de foto por cuenta
const discordIp = new Limiter(20, MIN15);
setInterval(() => [loginIp, loginUser, recoverIp, recoverUser, registerIp, avatarUp].forEach((l) => l.sweep()), 5 * 60_000).unref();
setInterval(db.purgeSessions, 3600_000).unref();

/** La IP del cliente. Detrás de proxies de confianza (TRUST_PROXY = cuántos), la del X-Forwarded-For contando desde la derecha. */
function ipOf(req: IncomingMessage) {
  const hops = Number(process.env.TRUST_PROXY) || 0;
  if (hops > 0) {
    const xs = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const x = xs[xs.length - hops];
    if (x) return x;
  }
  return req.socket.remoteAddress ?? '?';
}

// ── sesiones ─────────────────────────────────────────────────────────────

function cookies(h: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const cookieStr = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=${cross ? 'None' : 'Lax'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

/** La cuenta de la cookie de sesión (y desliza su caducidad). */
export function userFromCookie(header: string | undefined) {
  const sid = cookies(header)[COOKIE];
  if (!sid || sid.length > 64) return undefined;
  const idHash = sha(sid);
  const s = db.sessionUser(idHash);
  if (!s) return undefined;
  const now = Date.now();
  let slid = false;
  if (s.expires - now < SESSION_TTL - 24 * 3600_000) (db.slideSession(idHash, now + SESSION_TTL), (slid = true));
  return { user: s.user, idHash, sid, slid };
}

function newSession(userId: number) {
  const sid = randomBytes(32).toString('base64url');
  db.addSession(sha(sid), userId, SESSION_TTL);
  return sid;
}

/** ¿Es el nombre de la cuenta de admin? Comparación exacta (el nombre guardado es el que se escribió al registrarse). */
export const isAdminName = (name: string) => name === ADMIN_USER;

export function meOf(uid: number, username: string): Me {
  const achievements = db.achievementsOf(uid), have = new Set(Object.keys(achievements));
  return {
    username,
    ...(isAdminName(username) ? { admin: true } : {}),
    avatar: db.avatarRef(uid),
    achievements,
    stats: db.statsOf(uid),
    loadout: db.loadoutOf(uid),
    unlocked: COSMETICS.filter((c) => !c.need || have.has(c.need)).map((c) => `${c.slot}:${c.id}`),
    rarity: db.rarity(),
  };
}

// ── la API ───────────────────────────────────────────────────────────────

class HttpErr extends Error {
  constructor(public status: number, msg: string, public extra?: Record<string, string>) {
    super(msg);
  }
}
const BAD_LOGIN = 'Invalid username or password';
const BAD_RECOVER = 'Invalid username or recovery code';
const TOO_MANY = 'Too many attempts. Try again later';

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > BODY_MAX) return reject(new HttpErr(413, 'Request too large'));
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > BODY_MAX) return reject(new HttpErr(413, 'Request too large')), req.destroy();
      parts.push(c);
    });
    req.on('error', () => reject(new HttpErr(400, 'Bad request')));
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
        resolve(v);
      } catch {
        reject(new HttpErr(400, 'Bad JSON'));
      }
    });
  });
}

function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > max) return reject(new HttpErr(413, 'Image too large'));
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > max) return reject(new HttpErr(413, 'Image too large')), req.destroy();
      parts.push(c);
    });
    req.on('error', () => reject(new HttpErr(400, 'Bad request')));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}

/** Ancho y alto leídos de la cabecera del webp o del jpeg (null si no es uno válido): no se fía del Content-Type. */
function imageSize(b: Buffer, mime: string): [number, number] | null {
  try {
    if (mime === 'image/webp') {
      if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
      const t = b.toString('latin1', 12, 16);
      if (t === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      if (t === 'VP8L') return [(b.readUInt32LE(21) & 0x3fff) + 1, ((b.readUInt32LE(21) >> 14) & 0x3fff) + 1];
      if (t === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
      return null;
    }
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < b.length && b[i] === 0xff; i += 2 + b.readUInt16BE(i + 2)) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    }
  } catch {}
  return null;
}

/** Subir la foto de perfil: el cuerpo es la imagen tal cual (webp o jpeg). Solo el dueño (su sesión), con límite de tasa. */
async function uploadAvatar(req: IncomingMessage): Promise<Out> {
  const s = userFromCookie(req.headers.cookie);
  if (!s) throw new HttpErr(401, 'Not signed in');
  const key = String(s.user.id), w = avatarUp.wait(key);
  if (w) throw new HttpErr(429, TOO_MANY, { 'retry-after': String(Math.ceil(w / 1000)) });
  avatarUp.fail(key);
  const mime = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!AVATAR_TYPES.includes(mime)) throw new HttpErr(415, 'Use a WebP or JPEG image');
  const buf = await readRaw(req, AVATAR_MAX);
  const dim = imageSize(buf, mime);
  if (!dim || dim.some((v) => v < 16 || v > AVATAR_PX * 2)) throw new HttpErr(400, 'Invalid image');
  db.saveAvatar(s.user.id, mime, buf);
  hooks.loadout(s.user.id); // si está en una sala, su foto se refresca para todos
  return { body: { me: meOf(s.user.id, s.user.username) } };
}
function removeAvatar(req: IncomingMessage): Out {
  const s = userFromCookie(req.headers.cookie);
  if (!s) throw new HttpErr(401, 'Not signed in');
  db.deleteAvatar(s.user.id);
  hooks.loadout(s.user.id);
  return { body: { me: meOf(s.user.id, s.user.username) } };
}

// ── Discord (OAuth2, solo `identify`) ───────────────────────────────────

/*
 * Entorno: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET y DISCORD_REDIRECT (la URL pública de este servidor + /api/discord/callback; la misma
 * que se registra en el portal de Discord > OAuth2 > Redirects). Sin ellas el botón no aparece. El flujo: /api/discord/start guarda un
 * «state» en una cookie y manda a Discord; /api/discord/callback lo comprueba, canjea el código, lee el id de Discord y entra en la cuenta
 * enlazada (si no hay, la crea; si ya hay sesión, enlaza Discord a esa cuenta) y vuelve al cliente.
 */
const DC = { id: process.env.DISCORD_CLIENT_ID ?? '', secret: process.env.DISCORD_CLIENT_SECRET ?? '', redirect: process.env.DISCORD_REDIRECT || `http://localhost:${Number(process.env.PORT) || SERVER_PORT}/api/discord/callback` };
const discordOn = !!(DC.id && DC.secret);
/** La cuenta de Discord del admin: entrar con ella da siempre la cuenta ADMIN_USER (la crea, la enlaza o le devuelve el nombre). */
const ADMIN_DISCORD = process.env.ADMIN_DISCORD_ID || '1023628644213587998';
const DS = 'br_ds';
const stateCookie = (v: string, maxAge: number) => `${DS}=${v}; Path=/api/discord; HttpOnly; SameSite=${cross ? 'None' : 'Lax'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
const clientHome = () => allowedOrigins[0] ?? `http://localhost:${CLIENT_PORT}`;

function discordStart(req: IncomingMessage, res: ServerResponse) {
  const q = new URL(req.url ?? '', 'http://x').searchParams, o = q.get('o') ?? '';
  const back = o && originOk(o, req.headers.host) ? o : clientHome();
  if (!discordOn) return void (res.writeHead(302, { location: `${back}/?discord=off` }), res.end());
  const state = randomBytes(16).toString('base64url');
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: DC.id, redirect_uri: DC.redirect, response_type: 'code', scope: 'identify', state, prompt: 'none' }).toString();
  res.writeHead(302, { location: url.toString(), 'set-cookie': stateCookie(`${state}.${Buffer.from(back).toString('base64url')}`, 600), 'cache-control': 'no-store' });
  res.end();
}

/** Un nombre de Discord a un usuario válido (3-16 letras, números o _), libre y que no se parezca al del admin. */
function freeName(raw: string) {
  const base = (raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, 12) || 'player').padEnd(3, '0');
  for (let i = 0; i < 12; i++) {
    const n = i === 0 ? base : base + randomInt(10, 9999);
    if (n.toLowerCase() !== ADMIN_USER && !db.userByName(n)) return n;
  }
  return `user${randomInt(100000, 999999)}`;
}

async function discordCallback(req: IncomingMessage, res: ServerResponse) {
  const ip = ipOf(req), q = new URL(req.url ?? '', 'http://x').searchParams;
  const [state, enc] = (cookies(req.headers.cookie)[DS] ?? '').split('.');
  const back = enc ? Buffer.from(enc, 'base64url').toString() : clientHome();
  const fin = (why: string, extra: string[] = []) => {
    res.writeHead(302, { location: `${back}/?discord=${why}`, 'set-cookie': [stateCookie('', 0), ...extra], 'cache-control': 'no-store' });
    res.end();
  };
  if (!discordOn || discordIp.wait(ip)) return fin('fail');
  discordIp.fail(ip);
  const code = q.get('code');
  if (!state || state !== q.get('state') || !code || !(allowedOrigins.includes(back) || originOk(back, req.headers.host))) return fin('fail');
  try {
    const t = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DC.id, client_secret: DC.secret, grant_type: 'authorization_code', code, redirect_uri: DC.redirect }),
    }).then((r) => (r.ok ? (r.json() as Promise<{ access_token?: string }>) : null));
    if (!t?.access_token) return fin('fail');
    const u = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => (r.ok ? (r.json() as Promise<{ id?: string; global_name?: string | null; username?: string }>) : null));
    if (!u?.id || !/^\d{5,25}$/.test(u.id)) return fin('fail');
    const prev = userFromCookie(req.headers.cookie), owner = db.userByDiscord(u.id);
    if (u.id === ADMIN_DISCORD) {
      let id = owner?.id;
      if (!id) {
        const old = db.userByName(ADMIN_USER);
        if (old) id = old.id; // la cuenta s7lver que ya existía (con contraseña) pasa a ser también la de esta Discord
        else {
          const [ph, rh] = await Promise.all([hashIt(randomBytes(24).toString('base64url')), hashIt(normRecovery(newRecovery()))]);
          id = db.createUser(ADMIN_USER, ph, rh) ?? undefined;
        }
        if (!id || !db.linkDiscord(u.id, id)) return fin('fail');
      } else if (owner!.username !== ADMIN_USER) db.renameUser(id, ADMIN_USER);
      return fin('ok', [cookieStr(newSession(id), SESSION_TTL / 1000)]);
    }
    if (prev) {
      // ya con sesión: enlazar esta Discord a la cuenta (si no es de otra ni esta cuenta tiene ya una)
      if (owner && owner.id !== prev.user.id) return fin('taken');
      if (!owner && !db.linkDiscord(u.id, prev.user.id)) return fin('taken');
      return fin('linked');
    }
    let id = owner?.id;
    if (!id) {
      const [ph, rh] = await Promise.all([hashIt(randomBytes(24).toString('base64url')), hashIt(normRecovery(newRecovery()))]);
      for (let i = 0; i < 5 && !id; i++) id = db.createUser(freeName(u.global_name || u.username || ''), ph, rh) ?? undefined;
      if (!id || !db.linkDiscord(u.id, id)) return fin('fail');
    }
    return fin('ok', [cookieStr(newSession(id), SESSION_TTL / 1000)]);
  } catch {
    return fin('fail');
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : '');

type Out = { status?: number; body: unknown; cookie?: string };

async function register(req: IncomingMessage, b: Record<string, unknown>): Promise<Out> {
  const ip = ipOf(req);
  if (registerIp.wait(ip)) throw new HttpErr(429, TOO_MANY, { 'retry-after': String(Math.ceil(registerIp.wait(ip) / 1000)) });
  const username = str(b.username, 64), password = typeof b.password === 'string' ? b.password : '';
  if (!USER_RE.test(username)) throw new HttpErr(400, 'Username must be 3-16 letters, numbers or _');
  if (password.length < PASS_MIN || password.length > PASS_MAX) throw new HttpErr(400, `Password must be ${PASS_MIN}-${PASS_MAX} characters`);
  // nadie registra variantes (S7LVER, s7Lver...) del nombre de admin: solo el nombre exacto, y los nombres son únicos sin mayúsculas (username_lower)
  if (username.toLowerCase() === ADMIN_USER) throw new HttpErr(409, 'Username taken'); // el nombre del admin solo lo lleva la cuenta de su Discord (ver ADMIN_DISCORD)
  registerIp.fail(ip); // cada intento cuenta (5 cuentas por hora y por IP)
  if (db.userByName(username)) throw new HttpErr(409, 'Username taken');
  const code = newRecovery();
  const [ph, rh] = await Promise.all([hashIt(password), hashIt(normRecovery(code))]);
  const id = db.createUser(username, ph, rh);
  if (id === null) throw new HttpErr(409, 'Username taken'); // otro se lo llevó entre medias
  return { body: { me: meOf(id, username), recoveryCode: code }, cookie: cookieStr(newSession(id), SESSION_TTL / 1000) };
}

async function login(req: IncomingMessage, b: Record<string, unknown>): Promise<Out> {
  const ip = ipOf(req), name = str(b.username, 64), key = name.toLowerCase(), password = typeof b.password === 'string' ? b.password : '';
  const w = Math.max(loginIp.wait(ip), loginUser.wait(key));
  if (w) throw new HttpErr(429, TOO_MANY, { 'retry-after': String(Math.ceil(w / 1000)) });
  const u = USER_RE.test(name) ? db.userByName(name) : undefined;
  // si no existe (o la contraseña es absurda) se verifica contra el hash falso: misma respuesta, mismo tiempo
  const ok = password.length <= PASS_MAX && (u ? await check(u.pass_hash, password) : (await fake(password.slice(0, PASS_MAX)), false));
  if (!u || !ok) {
    loginIp.fail(ip);
    loginUser.fail(key);
    throw new HttpErr(401, BAD_LOGIN);
  }
  loginUser.reset(key); // la IP no se perdona: si no, bastaría entrar en una cuenta propia entre intentos
  const prev = userFromCookie(req.headers.cookie);
  if (prev) db.deleteSession(prev.idHash); // sesión nueva: nada de fijación
  return { body: { me: meOf(u.id, u.username) }, cookie: cookieStr(newSession(u.id), SESSION_TTL / 1000) };
}

async function recover(req: IncomingMessage, b: Record<string, unknown>): Promise<Out> {
  const ip = ipOf(req), name = str(b.username, 64), key = name.toLowerCase(), code = normRecovery(str(b.code, 64)), password = typeof b.password === 'string' ? b.password : '';
  const w = Math.max(recoverIp.wait(ip), recoverUser.wait(key));
  if (w) throw new HttpErr(429, TOO_MANY, { 'retry-after': String(Math.ceil(w / 1000)) });
  if (password.length < PASS_MIN || password.length > PASS_MAX) throw new HttpErr(400, `Password must be ${PASS_MIN}-${PASS_MAX} characters`);
  const u = USER_RE.test(name) ? db.userByName(name) : undefined;
  const ok = code.length === 20 && (u ? await check(u.recovery_hash, code) : (await fake(code), false));
  if (!u || !ok) {
    recoverIp.fail(ip);
    recoverUser.fail(key);
    throw new HttpErr(401, BAD_RECOVER);
  }
  recoverUser.reset(key);
  const fresh = newRecovery();
  const [ph, rh] = await Promise.all([hashIt(password), hashIt(normRecovery(fresh))]);
  db.resetCredentials(u.id, ph, rh); // todas las sesiones de la cuenta caen
  return { body: { recoveryCode: fresh } };
}

const renameIp = new Limiter(10, MIN15);
/** Cambiar el nombre de usuario (no al del admin, y la cuenta del admin no se renombra). */
function rename(req: IncomingMessage, b: Record<string, unknown>): Out {
  const s = userFromCookie(req.headers.cookie);
  if (!s) throw new HttpErr(401, 'Not signed in');
  const key = String(s.user.id), w = renameIp.wait(key);
  if (w) throw new HttpErr(429, TOO_MANY, { 'retry-after': String(Math.ceil(w / 1000)) });
  renameIp.fail(key);
  const name = str(b.username, 64);
  if (!USER_RE.test(name)) throw new HttpErr(400, 'Username must be 3-16 letters, numbers or _');
  if (isAdminName(s.user.username)) throw new HttpErr(403, 'This account keeps its name');
  if (name.toLowerCase() === ADMIN_USER) throw new HttpErr(409, 'Username taken');
  const other = db.userByName(name);
  if (other && other.id !== s.user.id) throw new HttpErr(409, 'Username taken');
  if (!db.renameUser(s.user.id, name)) throw new HttpErr(409, 'Username taken');
  return { body: { me: meOf(s.user.id, name) } };
}

function loadout(req: IncomingMessage, b: Record<string, unknown>): Out {
  const s = userFromCookie(req.headers.cookie);
  if (!s) throw new HttpErr(401, 'Not signed in');
  const l = { color: str(b.color, 40), head: str(b.head, 40), back: str(b.back, 40) } satisfies Look;
  for (const slot of ['color', 'head', 'back'] as Slot[]) if (l[slot] ? !cosmetic(slot, l[slot]) : slot === 'color') throw new HttpErr(400, 'Unknown item');
  if (!lookAllowed(l, new Set(Object.keys(db.achievementsOf(s.user.id))))) throw new HttpErr(403, 'Item locked');
  db.saveLoadout(s.user.id, l);
  hooks.loadout(s.user.id);
  return { body: { loadout: l } };
}

/** Los logros de localStorage (solo los que pueden justificarse): `backrooms` (escapó) y `idiot` (mató a una entidad). */
function importLegacy(req: IncomingMessage, b: Record<string, unknown>): Out {
  const s = userFromCookie(req.headers.cookie);
  if (!s) throw new HttpErr(401, 'Not signed in');
  // el cliente solo AFIRMA haberlos ganado (localStorage): cualquiera con cuenta pediría `first_escape` e `idiot` gratis. Cerrado salvo LEGACY_IMPORT=1 (migración puntual)
  if (process.env.LEGACY_IMPORT !== '1') return { body: { me: meOf(s.user.id, s.user.username) } };
  const list = Array.isArray(b.keys) ? b.keys.slice(0, 8) : [];
  const map: Record<string, string> = { backrooms: 'first_escape', idiot: 'idiot' };
  for (const k of list) if (typeof k === 'string' && map[k] && ACHIEVEMENT_KEYS.has(map[k])) award(s.user.id, map[k]);
  return { body: { me: meOf(s.user.id, s.user.username) } };
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}

/** Atiende /api/*; false si la URL no es de la API. */
export function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url ?? '').split('?')[0];
  if (!path.startsWith('/api/')) return false;
  const origin = req.headers.origin, ok = originOk(origin, req.headers.host);
  const cors: Record<string, string> = origin && ok ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : { vary: 'Origin' };
  void (async () => {
    try {
      if (req.method === 'OPTIONS') {
        if (!ok) throw new HttpErr(403, 'Origin not allowed');
        return void (res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }), res.end());
      }
      if (origin && !ok) throw new HttpErr(403, 'Origin not allowed');
      if (req.method === 'GET' && path === '/api/providers') return send(res, 200, { discord: discordOn }, cors);
      if (req.method === 'GET' && path === '/api/discord/start') return discordStart(req, res);
      if (req.method === 'GET' && path === '/api/discord/callback') return void (await discordCallback(req, res));
      if (req.method === 'GET' && path === '/api/me') {
        const s = userFromCookie(req.headers.cookie);
        const extra: Record<string, string> = s?.slid ? { 'set-cookie': cookieStr(s.sid, SESSION_TTL / 1000) } : {};
        return send(res, 200, { me: s ? meOf(s.user.id, s.user.username) : null }, { ...cors, ...extra });
      }
      // la foto de cualquiera es pública (como su nombre en la sala); la URL lleva la versión, así que se cachea para siempre
      const av = req.method === 'GET' ? /^\/api\/avatar\/(\d{1,9})$/.exec(path) : null;
      if (av) {
        const a = db.avatarOf(Number(av[1]));
        if (!a) throw new HttpErr(404, 'Not found');
        const etag = `"${a.updated_at}"`;
        const h = {
          'content-type': a.mime, etag, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'cross-origin',
          'cache-control': (req.url ?? '').includes('v=') ? 'public, max-age=31536000, immutable' : 'public, max-age=300', ...cors,
        };
        if (req.headers['if-none-match'] === etag) return void (res.writeHead(304, h), res.end());
        return void (res.writeHead(200, { ...h, 'content-length': a.data.length }), res.end(Buffer.from(a.data)));
      }
      if (req.method === 'POST' && path === '/api/avatar') {
        if (!ok) throw new HttpErr(403, 'Origin not allowed'); // anti CSRF: Origin permitido, y un Content-Type que un formulario ajeno no puede mandar
        const out = await uploadAvatar(req);
        return send(res, 200, out.body, cors);
      }
      const routes: Record<string, (req: IncomingMessage, b: Record<string, unknown>) => Promise<Out> | Out> = {
        '/api/register': register, '/api/login': login, '/api/recover': recover, '/api/loadout': loadout, '/api/rename': rename, '/api/import': importLegacy, '/api/avatar-remove': removeAvatar,
      };
      const isPost = req.method === 'POST';
      if (path === '/api/logout' ? !isPost : !(path in routes && isPost)) throw new HttpErr(path in routes || path === '/api/logout' ? 405 : 404, 'Not found');
      // anti CSRF: JSON y un Origin permitido (un formulario de otra web no puede mandar ninguna de las dos cosas)
      if (!ok) throw new HttpErr(403, 'Origin not allowed');
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpErr(415, 'Expected JSON');
      const b = await readBody(req);
      if (path === '/api/logout') {
        const s = userFromCookie(req.headers.cookie);
        if (s) db.deleteSession(s.idHash);
        return send(res, 200, { ok: true }, { ...cors, 'set-cookie': cookieStr('', 0) });
      }
      const out = await routes[path](req, b);
      send(res, out.status ?? 200, out.body, { ...cors, ...(out.cookie ? { 'set-cookie': out.cookie } : {}) });
    } catch (e) {
      if (e instanceof HttpErr) return send(res, e.status, { error: e.message }, { ...cors, ...e.extra });
      if (e instanceof Busy) return send(res, 503, { error: 'Server busy, try again' }, { ...cors, 'retry-after': '3' });
      // nunca el cuerpo de la petición: solo el tipo y el mensaje del error
      console.error('api error:', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
      if (!res.headersSent) send(res, 500, { error: 'Server error' }, cors);
    }
  })();
  return true;
}
