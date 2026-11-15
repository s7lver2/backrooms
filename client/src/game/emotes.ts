import { EMOTE_DEFS, EMOTE_SLOTS, emoteOpen } from '@backrooms/shared';

/*
 * Los emotes (bailes): qué logros tiene quien juega (los abren: shared/progress.ts), cuáles lleva equipados (hasta EMOTE_SLOTS, se eligen en el armario;
 * son lo que sale en la rueda y en las teclas 1–5) y cuál es su pose de victoria (una de las equipadas). Lo equipado se guarda en este navegador.
 * Lo rellena Backrooms.tsx desde la cuenta; un invitado solo tiene los gratis.
 */
export const emoteGate = { have: new Set<string>(), equipped: [] as number[], victory: 0 };
const listeners = new Set<() => void>();
/** Avisa cuando cambia lo equipado (el armario se repinta). */
export const onEmotes = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

const read = <T,>(k: string): T | undefined => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
let saved = read<number[]>('br-emote-slots'), pick = read<number>('br-victory');

/** Recalcula lo equipado con los logros de ahora (un emote que ya no se tiene sale solo). */
export function refreshEmotes() {
  const open = (n: number) => emoteOpen(n, emoteGate.have);
  const list = saved ? saved.filter((n, i, a) => Number.isInteger(n) && open(n) && a.indexOf(n) === i).slice(0, EMOTE_SLOTS) : EMOTE_DEFS.map((_, i) => i + 1).filter(open).slice(0, EMOTE_SLOTS);
  emoteGate.equipped = list;
  emoteGate.victory = pick && list.includes(pick) ? pick : list.find((n) => !EMOTE_DEFS[n - 1].sit) ?? 0;
  listeners.forEach((f) => f());
}
/** Equipa o quita el emote `n`; false si no cabe (ya hay EMOTE_SLOTS) o no se tiene. */
export function toggleEmote(n: number) {
  const cur = emoteGate.equipped;
  if (cur.includes(n)) saved = cur.filter((x) => x !== n);
  else if (cur.length < EMOTE_SLOTS && emoteOpen(n, emoteGate.have)) saved = [...cur, n];
  else return false;
  write('br-emote-slots', saved);
  refreshEmotes();
  return true;
}
/** La pose de victoria: uno de los equipados. */
export function setVictory(n: number) {
  if (!emoteGate.equipped.includes(n)) return;
  pick = n;
  write('br-victory', n);
  refreshEmotes();
}
refreshEmotes();
