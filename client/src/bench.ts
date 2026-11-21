/*
 * Benchmark gráfico (ajustes > VIDEO > BENCHMARK): prueba los perfiles de PRESETS de mejor a peor, cada uno con un recorrido fijo por un nivel real,
 * y se queda con el primero que va fluido. Cada perfil se prueba tras recargar la página (la calidad, las sombras y la precarga de shaders se fijan
 * al arrancar): el estado vive en sessionStorage y la partida de prueba arranca sola (Backrooms.tsx -> Game.runBench).
 * Durante la prueba se mide sin tope de FPS y sin resolución adaptable (lo que de verdad aguanta la tarjeta); al acabar se aplica el perfil entero.
 */
import { PRESETS, applyPreset, setSetting, settings, type Settings } from './settings';

const KEY = 'br-bench';
const LAST = 'br-bench-last';
/** Fluido: media por encima de PASS_FPS y el 95 % de los fotogramas por debajo de PASS_P95 ms (≈ 40 fps en lo peor). */
export const PASS_FPS = 55;
export const PASS_P95 = 25;

export interface BenchState {
  /** El perfil que se está probando (índice de PRESETS). */
  step: number;
  /** Los ajustes de antes, para volver a ellos si se cancela. */
  orig: Partial<Settings>;
  log: { preset: number; fps: number; p95: number }[];
}
export interface BenchLast {
  preset: number;
  fps: number;
  at: number;
}

const keysOf = () => [...new Set(PRESETS.flatMap(([, , v]) => Object.keys(v)))] as (keyof Settings)[];
const read = (): BenchState | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
const write = (s: BenchState | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: el benchmark no puede seguir entre recargas */
  }
};

/** El benchmark en curso (tras una recarga), o null. */
export const benchState = () => read();

export function lastBench(): BenchLast | null {
  try {
    return JSON.parse(localStorage.getItem(LAST) ?? 'null');
  } catch {
    return null;
  }
}

/** Un perfil con lo que hace falta para medir: sin tope de FPS ni resolución adaptable. */
function measure(i: number) {
  applyPreset(i);
  setSetting('fpsLimit', 3);
  setSetting('autoRes', false);
}

/** Empieza: guarda los ajustes de ahora, pone el perfil más alto y recarga. */
export function startBench() {
  const orig: Partial<Settings> = {};
  for (const k of keysOf()) (orig as Record<string, unknown>)[k] = settings[k];
  const step = PRESETS.length - 1;
  write({ step, orig, log: [] });
  measure(step);
  location.reload();
}

/** Esc: se devuelven los ajustes de antes. */
export function cancelBench() {
  const s = read();
  if (s) for (const [k, v] of Object.entries(s.orig)) setSetting(k as keyof Settings, v as never);
  write(null);
  location.reload();
}

/** El recorrido del perfil actual ha terminado: el siguiente más bajo, o el definitivo (recarga en los dos casos). */
export function benchDone(fps: number, p95: number) {
  const s = read();
  if (!s) return;
  s.log.push({ preset: s.step, fps, p95 });
  const ok = fps >= PASS_FPS && p95 <= PASS_P95;
  if (ok || s.step === 0) {
    write(null);
    applyPreset(s.step);
    try {
      localStorage.setItem(LAST, JSON.stringify({ preset: s.step, fps: Math.round(fps), at: Date.now() } satisfies BenchLast));
      sessionStorage.setItem('br-bench-open', '1'); // (al volver, se abren los ajustes de vídeo con el resultado)
    } catch {
      /* da igual */
    }
  } else {
    s.step--;
    write(s);
    measure(s.step);
  }
  location.reload();
}
