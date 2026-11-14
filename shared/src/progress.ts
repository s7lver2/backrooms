/**
 * Cuentas, logros y cosméticos: el único archivo de datos. El servidor concede los logros (a partir de
 * eventos de la partida) y valida el armario; el cliente solo lo muestra.
 */

// ── cuentas ──────────────────────────────────────────────────────────────
export const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
/** La única cuenta con consola de admin (nombre exacto, ver server/src/index.ts: la comprobación real es del servidor). */
export const ADMIN_USER = 's7lver';
export const PASS_MIN = 8;
export const PASS_MAX = 128;
/** Lo que el servidor acepta de cuerpo en la API (bytes). */
export const BODY_MAX = 4096;
/** La foto de perfil: bytes máximos, lado (px) y tipos permitidos (nada de SVG). */
export const AVATAR_MAX = 40 * 1024;
export const AVATAR_PX = 128;
export const AVATAR_TYPES = ['image/webp', 'image/jpeg'];

// ── logros ───────────────────────────────────────────────────────────────
/** Contadores de progreso (los lleva el servidor por cuenta). */
export type StatKey = 'games' | 'escapes' | 'tapes' | 'photos' | 'holds' | 'kills' | 'falls' | 'lockers' | 'unos' | 'monsters';
export const STAT_LABEL: Record<StatKey, string> = { games: 'GAMES', escapes: 'ESCAPES', tapes: 'TAPES', photos: 'PHOTOS', holds: 'INSPECTIONS HELD', kills: 'KILLS', falls: 'FALLS', lockers: 'LOCKERS OPENED', unos: 'CARDS PLAYED', monsters: 'MONSTERS DRUNK' };

export interface AchievementDef {
  key: string;
  name: string;
  desc: string;
  /** Si va por contador: cuál y cuántos hacen falta. */
  stat?: StatKey;
  goal?: number;
  /** La constelación a la que pertenece. */
  branch: Branch;
  /** La estrella de la que cuelga en la constelación (solo dibuja la línea: no hace falta tenerla para ganar este). */
  from?: string;
}
export const BRANCHES = ['ESCAPE', 'COLLECT', 'SURVIVE', 'COMBAT', 'DEPTHS'] as const;
export type Branch = (typeof BRANCHES)[number];
export const ACHIEVEMENTS: AchievementDef[] = [
  // ESCAPE
  { key: 'first_escape', name: 'FIRST EXIT', desc: 'Escape the Backrooms.', stat: 'escapes', goal: 1, branch: 'ESCAPE' },
  { key: 'escape_5', name: 'REGULAR', desc: 'Escape 5 times.', stat: 'escapes', goal: 5, branch: 'ESCAPE', from: 'first_escape' },
  { key: 'escape_25', name: 'COMMUTER', desc: 'Escape 25 times.', stat: 'escapes', goal: 25, branch: 'ESCAPE', from: 'escape_5' },
  { key: 'lone_wolf', name: 'LONE WOLF', desc: 'Escape in a room where you are alone.', branch: 'ESCAPE', from: 'first_escape' },
  { key: 'team_player', name: 'TEAM PLAYER', desc: 'Escape in a room of 3 or more.', branch: 'ESCAPE', from: 'first_escape' },
  { key: 'survivor', name: 'NO ONE LEFT BEHIND', desc: 'Escape with nobody in your room caught.', branch: 'ESCAPE', from: 'team_player' },
  { key: 'full_house', name: 'FULL HOUSE', desc: 'Escape in a room of 6 or more.', branch: 'ESCAPE', from: 'team_player' },
  // COLLECT
  { key: 'first_tape', name: 'FIRST TAPE', desc: 'Collect a tape.', stat: 'tapes', goal: 1, branch: 'COLLECT' },
  { key: 'tape_hoarder', name: 'TAPE HOARDER', desc: 'Collect 20 tapes in total.', stat: 'tapes', goal: 20, branch: 'COLLECT', from: 'first_tape' },
  { key: 'archivist', name: 'ARCHIVIST', desc: 'Collect 100 tapes in total.', stat: 'tapes', goal: 100, branch: 'COLLECT', from: 'tape_hoarder' },
  { key: 'photographer', name: 'PHOTOGRAPHER', desc: 'Take 10 photos.', stat: 'photos', goal: 10, branch: 'COLLECT', from: 'first_tape' },
  { key: 'paparazzi', name: 'PAPARAZZI', desc: 'Take 50 photos.', stat: 'photos', goal: 50, branch: 'COLLECT', from: 'photographer' },
  { key: 'locksmith', name: 'LOCKSMITH', desc: 'Open a locker.', stat: 'lockers', goal: 1, branch: 'COLLECT', from: 'first_tape' },
  { key: 'safecracker', name: 'SAFECRACKER', desc: 'Open 20 lockers.', stat: 'lockers', goal: 20, branch: 'COLLECT', from: 'locksmith' },
  // SURVIVE
  { key: 'first_night', name: 'FIRST NIGHT', desc: 'Play a game.', stat: 'games', goal: 1, branch: 'SURVIVE' },
  { key: 'night_owl', name: 'NIGHT OWL', desc: 'Play 10 games.', stat: 'games', goal: 10, branch: 'SURVIVE', from: 'first_night' },
  { key: 'veteran', name: 'VETERAN', desc: 'Play 50 games.', stat: 'games', goal: 50, branch: 'SURVIVE', from: 'night_owl' },
  { key: 'second_chance', name: 'SECOND CHANCE', desc: 'Bring a teammate back with a Totem.', branch: 'SURVIVE', from: 'night_owl' },
  { key: 'held_breath', name: 'HELD BREATH', desc: 'Hold your breath through an inspection while hiding.', branch: 'SURVIVE', from: 'first_night' },
  { key: 'stone_lungs', name: 'STONE LUNGS', desc: 'Hold your breath through 10 inspections.', stat: 'holds', goal: 10, branch: 'SURVIVE', from: 'held_breath' },
  { key: 'pit_fall', name: 'WATCH YOUR STEP', desc: 'Fall into the void.', stat: 'falls', goal: 1, branch: 'SURVIVE', from: 'first_night' },
  { key: 'gravity', name: 'GRAVITY WINS', desc: 'Fall into the void 5 times.', stat: 'falls', goal: 5, branch: 'SURVIVE', from: 'pit_fall' },
  // COMBAT
  { key: 'idiot', name: 'GOOD JOB IDIOT', desc: 'Kill an entity. Now what?', branch: 'COMBAT' },
  { key: 'trigger_happy', name: 'TRIGGER HAPPY', desc: 'Take down 5 entities.', stat: 'kills', goal: 5, branch: 'COMBAT', from: 'idiot' },
  { key: 'hunter', name: 'HUNTER', desc: 'Take down 25 entities.', stat: 'kills', goal: 25, branch: 'COMBAT', from: 'trigger_happy' },
  { key: 'exterminator', name: 'EXTERMINATOR', desc: 'Take down 100 entities.', stat: 'kills', goal: 100, branch: 'COMBAT', from: 'hunter' },
  // DEPTHS
  { key: 'deep_end', name: 'DEEP END', desc: 'Escape from the Poolrooms.', branch: 'DEPTHS' },
  { key: 'no_u', name: 'NO U', desc: 'Play an Uno Reverse.', stat: 'unos', goal: 1, branch: 'DEPTHS', from: 'deep_end' },
  { key: 'caffeinated', name: 'CAFFEINATED', desc: 'Drink 5 Monsters.', stat: 'monsters', goal: 5, branch: 'DEPTHS', from: 'deep_end' },
];
export const ACHIEVEMENT_KEYS = new Set(ACHIEVEMENTS.map((a) => a.key));

// ── emotes ───────────────────────────────────────────────────────────────
/** Los emotes de la sala de espera (el número del emote es la posición + 1; 0 = ninguno). `clip`: la animación (anim/); `len`: segundos (0 = hasta que te muevas). */
export interface EmoteDef {
  name: string;
  clip: string;
  len: number;
  /** El logro que lo desbloquea (null: gratis; hay dos gratis). */
  need: string | null;
  /** Se sienta en el suelo. */
  sit?: boolean;
}
export const EMOTE_DEFS: EmoteDef[] = [
  { name: 'WAVE', clip: 'Cheering', len: 3, need: null },
  { name: 'POINT', clip: 'Pointing', len: 2.5, need: 'first_night' },
  { name: 'CLAP', clip: 'Fist Pump', len: 3.2, need: 'first_escape' },
  { name: 'SIT', clip: 'Crouching', len: 0, need: null, sit: true },
  { name: 'TWIST', clip: 'Twist Dance', len: 0, need: 'night_owl' },
  { name: 'MACARENA', clip: 'Macarena Dance', len: 0, need: 'team_player' },
  { name: 'MOONWALK', clip: 'Moonwalk', len: 0, need: 'lone_wolf' },
  { name: 'SAMBA', clip: 'Samba Dancing', len: 0, need: 'photographer' },
  { name: 'HIP HOP', clip: 'Hip Hop Dancing', len: 0, need: 'veteran' },
  { name: 'CAN CAN', clip: 'Can Can', len: 0, need: 'full_house' },
  { name: 'BELLY DANCE', clip: 'Belly Dance', len: 0, need: 'deep_end' },
  { name: 'ANGRY', clip: 'Angry Gesture', len: 3, need: 'idiot' },
  { name: 'FLAIR', clip: 'Flair', len: 0, need: 'survivor' },
  { name: 'PHONE', clip: 'Talking On Phone', len: 0, need: 'locksmith' },
  { name: 'BAD SHOT', clip: 'Golf Bad Shot', len: 3.5, need: 'pit_fall' },
];
/** ¿Tiene quien ha ganado `have` (claves de logro) el emote `n` (1…)? */
export const emoteOpen = (n: number, have: ReadonlySet<string> | Record<string, unknown>) => {
  const e = EMOTE_DEFS[n - 1];
  return !!e && (!e.need || (have instanceof Set ? have.has(e.need) : e.need in have));
};

// ── cosméticos ───────────────────────────────────────────────────────────
export type Slot = 'color' | 'head' | 'back';
export interface CosmeticDef {
  slot: Slot;
  id: string;
  name: string;
  /** El logro que lo desbloquea (null: gratis). */
  need: string | null;
  /** color: el tinte. head / back: el modelo (client/public/models/cosmetics/<id>.glb). */
  hex?: string;
}
export const COSMETICS: CosmeticDef[] = [
  { slot: 'color', id: 'stock', name: 'STOCK', need: null, hex: '#ffffff' },
  { slot: 'color', id: 'rust', name: 'RUST', need: null, hex: '#ff8f78' },
  { slot: 'color', id: 'sand', name: 'SAND', need: null, hex: '#e9d9a6' },
  { slot: 'color', id: 'slate', name: 'SLATE', need: null, hex: '#9db4c8' },
  { slot: 'color', id: 'ice', name: 'ICE', need: 'night_owl', hex: '#8fd6ff' },
  { slot: 'color', id: 'moss', name: 'MOSS', need: 'photographer', hex: '#a6e07e' },
  { slot: 'color', id: 'amber', name: 'AMBER', need: 'tape_hoarder', hex: '#ffd24a' },
  { slot: 'color', id: 'ash', name: 'ASH', need: 'pit_fall', hex: '#9a9a94' },
  { slot: 'color', id: 'ink', name: 'INK', need: 'first_escape', hex: '#55555f' },
  { slot: 'color', id: 'teal', name: 'TEAL', need: 'team_player', hex: '#5fd1bd' },
  { slot: 'color', id: 'rose', name: 'ROSE', need: 'held_breath', hex: '#f2a1c0' },
  { slot: 'color', id: 'crimson', name: 'CRIMSON', need: 'trigger_happy', hex: '#e2534b' },
  { slot: 'color', id: 'snow', name: 'SNOW', need: 'first_night', hex: '#f3f6fa' },
  { slot: 'color', id: 'violet', name: 'VIOLET', need: 'escape_25', hex: '#a78bfa' },
  { slot: 'color', id: 'coral', name: 'CORAL', need: 'full_house', hex: '#ff7f6b' },
  { slot: 'color', id: 'mint', name: 'MINT', need: 'lone_wolf', hex: '#9df2c9' },
  { slot: 'color', id: 'brass', name: 'BRASS', need: 'safecracker', hex: '#c9a24b' },
  { slot: 'color', id: 'void', name: 'VOID', need: 'gravity', hex: '#2b2b36' },
  { slot: 'color', id: 'cobalt', name: 'COBALT', need: 'stone_lungs', hex: '#4f7cff' },
  { slot: 'color', id: 'sky', name: 'SKY', need: 'deep_end', hex: '#7fd3ff' },
  { slot: 'color', id: 'lime', name: 'LIME', need: 'caffeinated', hex: '#c7f43a' },
  { slot: 'color', id: 'plum', name: 'PLUM', need: 'no_u', hex: '#8e4a8e' },
  { slot: 'color', id: 'smoke', name: 'SMOKE', need: 'hunter', hex: '#6f7580' },
  { slot: 'head', id: 'bicorn_hat', name: 'BICORN', need: 'first_escape' },
  { slot: 'head', id: 'asian_conical_hat', name: 'CONICAL HAT', need: 'team_player' },
  { slot: 'head', id: 'ushanka', name: 'USHANKA', need: 'survivor' },
  { slot: 'head', id: 'witch_hat', name: 'WITCH HAT', need: 'held_breath' },
  { slot: 'head', id: 'doge_hat', name: 'DOGE HAT', need: 'idiot' },
  { slot: 'head', id: 'bucket_hat', name: 'BUCKET HAT', need: 'escape_5' },
  { slot: 'head', id: 'teto_pear', name: 'TETO PEAR', need: 'first_tape' },
  { slot: 'back', id: 'sukonbu', name: 'SUKONBU', need: 'paparazzi' },
  { slot: 'back', id: 'battery', name: 'BATTERY PACK', need: 'trigger_happy' },
  { slot: 'back', id: 'teto_plush', name: 'TETO PLUSH', need: 'archivist' },
  { slot: 'back', id: 'scythe', name: 'SCYTHE', need: 'exterminator' },
];
export const cosmetic = (slot: Slot, id: string) => COSMETICS.find((c) => c.slot === slot && c.id === id);

/** Lo que lleva puesto un jugador: color (id) y, si lleva, sombrero y mochila ('' = nada). */
export interface Look {
  color: string;
  head: string;
  back: string;
}
export const DEFAULT_LOOK: Look = { color: 'stock', head: '', back: '' };
/** ¿Puede llevar este aspecto quien ha desbloqueado `unlocked` (claves de logro)? Un campo vacío siempre vale (menos el color). */
export function lookAllowed(look: Look, unlocked: ReadonlySet<string>) {
  const ok = (slot: Slot, id: string) => {
    const c = cosmetic(slot, id);
    return !!c && (!c.need || unlocked.has(c.need));
  };
  return ok('color', look.color) && (!look.head || ok('head', look.head)) && (!look.back || ok('back', look.back));
}
/** Un aspecto de lo que llegue por la red (o de la BD): solo ids conocidos; lo demás, por defecto. */
export function cleanLook(x: unknown): Look {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const pick = (slot: Slot, dflt: string) => (typeof o[slot] === 'string' && cosmetic(slot, o[slot] as string) ? (o[slot] as string) : dflt);
  return { color: pick('color', 'stock'), head: pick('head', ''), back: pick('back', '') };
}

// ── lo que devuelve la API ───────────────────────────────────────────────
export interface Me {
  username: string;
  /** Es la cuenta de admin (solo para MOSTRAR la consola: el servidor vuelve a comprobarlo en cada acción). */
  admin?: boolean;
  /** Su foto de perfil (`<id>?v=<versión>`), vacío si no tiene. */
  avatar: string;
  /** clave → cuándo (ms). */
  achievements: Record<string, number>;
  stats: Partial<Record<StatKey, number>>;
  loadout: Look;
  /** Ids de cosméticos desbloqueados, `slot:id`. */
  unlocked: string[];
  /** logro → % de las cuentas que lo tienen. */
  rarity: Record<string, number>;
}
