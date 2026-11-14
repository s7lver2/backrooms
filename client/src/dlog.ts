/*
 * Registro de eventos de juego para la pestaña DEBUG de la consola de admin (F9): recogidas, ascensor, misión, emotes, escondites...
 * Un anillo en memoria (se pierde al recargar); `dlog(etiqueta, texto)` desde cualquier sitio. Barato: solo guarda una línea.
 */
const MAX = 300;
const lines: string[] = [];
const subs = new Set<() => void>();
let ver = 0;
const t0 = Date.now();

export function dlog(tag: string, msg: string) {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(7);
  lines.push(`${s}s [${tag}] ${msg}`);
  if (lines.length > MAX) lines.shift();
  ver++;
  subs.forEach((f) => f());
}
export const dlogLines = () => lines;
export const dlogClear = () => (lines.length = 0, ver++, subs.forEach((f) => f()));
export const dlogSubscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const dlogVersion = () => ver;
