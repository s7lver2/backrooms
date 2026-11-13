/** Capacidades por nivel: el jugador es un «prefab» con componentes y el servidor decide cuáles están activos en cada nivel (docs/level-caps.md). */
export interface LevelCaps {
  /** El nivel es un mapa de piscinas (Poolrooms) en vez del laberinto. */
  pool: boolean;
  /** Entidades (bacteria, partygoer) y tótem. */
  ents: boolean;
  /** Vacío: caer fuera del mapa mata ('fell'). Sin él, las alturas negativas son agua. */
  fall: boolean;
  /** Cordura: sin ella se muere ('insane'). */
  insane: boolean;
  /** Nadar, traje de buzo (bombona) y pistola de agua. */
  swim: boolean;
  /** El nivel es un hotel periódico (Las Suites, shared/src/suites.ts): el mapa se cierra sobre sí mismo a lo largo del pasillo. */
  hotel?: boolean;
}
const LEVEL0: LevelCaps = { pool: false, ents: true, fall: true, insane: true, swim: false };
export const LEVEL_CAPS: Record<string, LevelCaps> = {
  level0: LEVEL0,
  poolrooms: { pool: true, ents: false, fall: false, insane: false, swim: true },
  suites: { pool: false, ents: false, fall: false, insane: false, swim: false, hotel: true },
};
/** Un nivel desconocido se comporta como el nivel 0. */
export const levelCaps = (id: string): LevelCaps => LEVEL_CAPS[id] ?? LEVEL0;
