import { ITEMS, ITEM_IDS, itemOpen, rollRarity, type ItemId } from './missions';

/*
 * Las taquillas del mapa (una de cada tres piezas de botín): lo que hay dentro sale de la semilla de la ronda y del id de la taquilla (lo mismo para
 * todos), solo de lo que está desbloqueado (ITEMS[id].level) y con la suerte del nivel: mejor botín en los niveles que se desbloquean.
 */
export interface LockerItem {
  kind: ItemId | 'loot';
  r: number;
}

const rng = (a: number) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** El contenido de la taquilla `id` de la ronda `seed`: 2 o 3 cosas (botín o objetos de la tienda), con rareza empujada por `luck`. */
export function lockerContents(seed: number, id: string, open: ReadonlySet<string>, luck = 1): LockerItem[] {
  const u = rng(id.split('').reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), seed ^ 0x9e3779b1));
  const pool = ITEM_IDS.filter((i) => itemOpen(i, open) && i !== 'ammo');
  const weight = (i: ItemId) => 1 / Math.sqrt(ITEMS[i].price); // lo barato sale más
  const total = pool.reduce((s, i) => s + weight(i), 0);
  const r = () => rollRarity(u() ** (1 / (luck * 1.6))); // (las taquillas son mejores que el suelo)
  const out: LockerItem[] = [];
  for (let k = 0, n = 2 + (u() < 0.4 ? 1 : 0); k < n; k++) {
    if (u() < 0.5) out.push({ kind: 'loot', r: r() });
    else {
      let x = u() * total, pick = pool[pool.length - 1];
      for (const i of pool) {
        x -= weight(i);
        if (x <= 0) {
          pick = i;
          break;
        }
      }
      out.push({ kind: pick, r: r() });
    }
  }
  return out;
}
