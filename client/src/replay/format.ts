/*
 * Formato del archivo de repeticion (.replay). Se guarda en IndexedDB y se puede exportar/importar.
 * `v` cambia cuando cambia el formato; `build` es la version del juego con la que se grabo.
 */
export const REPLAY_FORMAT = 1;
/** Version del juego para las repeticiones: se sube a mano cuando cambian el generador de mapas o los modelos (una repeticion de otra version se avisa como antigua). */
export const REPLAY_BUILD = 'r1';
/** Cada cuanto se guarda un fotograma completo (clave) para poder saltar en la timeline, en ms. */
export const KEY_EVERY = 5000;
/** Tope de una partida comprimida: pasado esto se deja de grabar y se marca como truncada. */
export const MAX_BYTES = 20 * 1024 * 1024;
/** Partidas sin estrella que se conservan. */
export const KEEP = 10;

export type ReplayPlayer = { id: string; name: string; color?: string };

export type ReplayMeta = {
  id: string;
  v: number;
  build: string;
  levelId: string;
  floor?: number;
  seed: number;
  /** Date.now() al empezar. */
  started: number;
  durationMs: number;
  players: ReplayPlayer[];
  /** Mi id de socket al grabar (quien grabo: su camara exacta va en los fotogramas `own`). */
  me?: string;
  /** Fijada: va arriba en la lista y no se borra sola al rotar. */
  starred: boolean;
  /** Nombre puesto a mano (vacio: el de siempre, nivel y fecha). */
  name?: string;
  /** El «fotograma especial» de la lista: el plano con el recorrido, un JPEG pequeño en data URL. */
  thumb?: string;
  /** Instante (ms) del momento que sale en la miniatura (la primera muerte, o el final). */
  hl?: number;
  /** Bytes comprimidos guardados. */
  size: number;
  /** Se paso del tope y la grabacion quedo cortada. */
  truncated?: boolean;
};

export type ReplayEvent = {
  /** ms desde el inicio de la grabacion. */
  t: number;
  /** `inv`: mi inventario (solo el de quien grabo); `stat`: [aguante, cordura, bateria] 0-1 de quien grabo, cada medio segundo. */
  k: 'death' | 'hit' | 'hurt' | 'elevator' | 'fx' | 'inv' | 'stat';
  id?: string;
  data?: unknown;
};

export type ReplayFrame = {
  t: number;
  /** players/world: estado de la red; own: la camara propia (x,y,z,yaw,pitch) a 30 Hz. */
  k: 'players' | 'world' | 'own';
  d: unknown;
};

export type ReplayChunk = {
  from: number;
  to: number;
  /** Empieza con fotogramas completos (no deltas): se puede saltar aqui. */
  key: boolean;
  frames: ReplayFrame[];
  events: ReplayEvent[];
};
