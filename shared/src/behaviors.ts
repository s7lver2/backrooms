/** Ejecuta el primer comportamiento que acepta lo que percibe la entidad. */
export function runBehaviors<Id extends string, Actor, Sense>(
  order: readonly Id[],
  handlers: Record<Id, (actor: Actor, sense: Sense) => boolean>,
  actor: Actor,
  sense: Sense,
) {
  for (const id of order) if (handlers[id](actor, sense)) break;
}
