import { DEV_LOCAL } from './devGate';

/*
 * Marcas de tiempo de la carga (solo en desarrollo, sin coste en producción): `perf.mark('nombre')` guarda los ms desde que
 * arrancó la página y `perf.report()` los devuelve (también en `window.__perf`). Sirve para medir las fases de carga y compilación.
 */
const marks: Record<string, number> = {};

export const perf = {
  mark(name: string) {
    if (!DEV_LOCAL) return;
    marks[name] = Math.round(performance.now());
    performance.mark(name);
  },
  report(): Record<string, number> {
    return { ...marks };
  },
};

if (DEV_LOCAL && typeof window !== 'undefined') (window as unknown as { __perf: typeof perf }).__perf = perf;
