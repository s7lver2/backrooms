import type { Maze } from './maze';

/*
 * Detector de desincronización: huellas FNV-1a de lo que cliente y servidor deben derivar igual.
 * Solo lo determinista se puede comparar: el MAPA (sale de la semilla). Las entidades las lleva el servidor (EntitySim usa Math.random y
 * llegan por snapshot), así que `stateHash` sirve para comparar dos ejecuciones de la misma simulación o dos snapshots, no cliente contra servidor.
 * Regla: nada de `Math.random()` ni `Date.now()` en los generadores de mapas (maze.ts, suites.ts, pools.ts, parking.ts): el servidor y el cliente
 * llaman a la misma función con la misma semilla y han de dar el mismo resultado.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a de 32 bits sobre una lista de enteros (cada uno como 4 bytes). */
export function fnv1a(values: Iterable<number>, h = FNV_OFFSET): number {
  for (const v of values) {
    const n = v | 0;
    for (let s = 0; s < 32; s += 8) h = Math.imul(h ^ ((n >>> s) & 0xff), FNV_PRIME);
  }
  return h >>> 0;
}

/** Huella de un conjunto de entidades: posiciones cuantizadas a `1/q` m (por defecto 1 cm), en el orden que se pase. */
export function stateHash(ents: Iterable<{ id: number; x: number; z: number; hp?: number }>, q = 100): number {
  let h = FNV_OFFSET;
  for (const e of ents) h = fnv1a([e.id, Math.round(e.x * q), Math.round(e.z * q), e.hp ?? 0], h);
  return h;
}

/** Huella del mapa (rejilla, zonas, puntos clave y props): si cliente y servidor generan lo mismo desde la semilla, coincide. */
export function mazeHash(m: Maze): number {
  let h = fnv1a([m.w, m.h], FNV_OFFSET);
  for (const a of [m.open, m.lit, m.zone]) h = fnv1a(a, h);
  const cells = [m.start, m.elevator, m.camera, ...(m.pistol ? [m.pistol] : []), ...m.tapes, ...m.spawns, ...m.flashlights, ...m.extraGuns, ...(m.gens ?? [])];
  h = fnv1a(cells.flatMap((c) => [c.x, c.y]), h);
  return fnv1a(m.props.flatMap((p) => [p.cell.x, p.cell.y, p.rot, p.kind.length, p.kind.charCodeAt(0), p.kind.charCodeAt(p.kind.length - 1)]), h);
}
