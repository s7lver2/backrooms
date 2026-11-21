import type { DeathInfo } from '@backrooms/shared';

/* Los rotulos graciosos (en ingles: el juego va en ingles) de las repeticiones: uno al azar de la lista segun como se murio. `{n}` es la victima y `{k}` quien la mato. */
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

const FALL = ['{n} checked if the floor was real', '{n} did not see the floor. The floor saw {n}', '{n} discovered gravity'];
const INSANE = ['{n} lost their mind (literally)', '{n} stopped getting along with {n}', '{n} gave in to the walls'];
const GAS = ['{n} found out what is in the vents', '{n} took a deep breath. Mistake.'];
const ADMIN = ['{n} was deleted by management', '{n} was not on the list'];
const ENTITY = ['{n} tried to make friends with {k}', '{n} and {k}: a misunderstanding', '{n} was dessert', '{k} was hungry'];
const PLAYER = ["{k} took away {n}'s will to live", 'Friendly fire: {k} → {n}', '{k} did not think twice about {n}'];
const PLAIN = ['{n} had a bad day', '{n} is no longer with us'];
const NEAR = ['{n} barely made it', '{n} got lucky. Very lucky.', '{n} had two heartbeats left'];

const fill = (t: string, n: string, k = '') => t.replaceAll('{n}', n).replaceAll('{k}', k);

/** El rotulo de una muerte. `ent` es el nombre de la entidad si la mato una. */
export function deathCaption(info: DeathInfo | undefined, name: string, killer?: string, ent?: string): string {
  const by = info?.by;
  if (by?.kind === 'env') return fill(pick(by.why === 'fall' ? FALL : by.why === 'insane' ? INSANE : by.why === 'gas' ? GAS : by.why === 'admin' ? ADMIN : PLAIN), name);
  if (by?.kind === 'entity') return fill(pick(ENTITY), name, (ent ?? by.ent).toUpperCase());
  if (by?.kind === 'player') return fill(pick(PLAYER), name, killer ?? '???');
  return fill(pick(PLAIN), name);
}

export const nearCaption = (name: string) => fill(pick(NEAR), name);
