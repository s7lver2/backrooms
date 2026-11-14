import { FULL_STATS, statsOf, type Inventory, type Qual, type RoomView, type Stats } from '@backrooms/shared';

/*
 * Lo que el servidor dice de mí y no es del Player: lo que dan mis mejoras del árbol en esta sala (casillas, barra rápida, vida, aguante,
 * velocidad) y la calidad de lo que llevo (rareza y desgaste) con mi botín. Lo pone net.ts al llegar `room`, `inv` y `bag`; lo leen el Player,
 * el inventario y la barra. Fuera de una sala (jugando solo) todo está al máximo.
 */
export const perks = { stats: FULL_STATS as Stats, q: {} as NonNullable<Inventory['q']>, loot: [] as Qual[] };
export const setRoomPerks = (r: RoomView | null, me: string) => {
  perks.stats = r ? statsOf(r.players.find((p) => p.id === me)?.ups) : FULL_STATS;
  if (!r) (perks.q = {}), (perks.loot = []);
};
export const setBag = (b: { q?: Inventory['q']; loot?: Qual[] }) => ((perks.q = b.q ?? {}), (perks.loot = b.loot ?? []));
