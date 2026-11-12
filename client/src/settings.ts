import { useSyncExternalStore } from 'react';

/*
 * Los ajustes del jugador: un objeto en localStorage (br-settings). `settings` se lee en vivo desde input.ts / player.ts;
 * la pantalla SETTINGS los cambia con `set`. Con cuenta se sincronizarán con el servidor (aún no).
 */

export interface Settings {
  volume: number; // 0–1, general
  sfx: number; // 0–1 (sin aplicar aún)
  ambient: number; // 0–1 (sin aplicar aún)
  sens: number; // multiplicador del ratón
  invertY: boolean;
  vhs: number; // 0–1, intensidad del efecto VHS (sin aplicar aún)
  fov: number; // grados
  fps: boolean; // mostrar FPS
  crosshair: boolean; // el punto de mira, en el centro de la imagen
  reduceMotion: boolean; // sin aplicar aún
  toggleBreath: boolean; // alternar en vez de mantener (sin aplicar aún)
  resScale: number; // 0,5–1: escala de la resolución de dibujo
  brightness: number; // 0,6–1,6: brillo de la imagen
  quality: number; // 0 automático (bajo en táctiles), 1 bajo, 2 alto: el perfil gráfico (bajo: sin sombras, sin brillo, 60 % de resolución); se aplica al recargar
  shadows: number; // 0 sin, 1 bajas (mapa de 512), 2 altas (1024): las sombras de la linterna y del sol; se aplica al recargar
  bloom: boolean; // el halo de los fluorescentes (en vivo; en calidad baja no existe)
  fpsLimit: number; // índice en FPS_CAPS: 30, 45, 60 o sin tope (en vivo)
  poolAO: boolean; // oclusión ambiental de las Poolrooms (al entrar)
  poolAA: boolean; // antialiasing (SMAA) de las Poolrooms (al entrar)
  texFilter: number; // índice en ANISO: filtrado anisótropo de las texturas del mundo; se aplica al recargar
  warmup: number; // 0 perezoso, 1 rápido, 2 completo: cuánto se precompila al cargar (ver game/compile.ts; se aplica al recargar)
}

export const DEFAULTS: Settings = { volume: 1, sfx: 1, ambient: 1, sens: 1, invertY: false, vhs: 1, fov: 70, fps: false, crosshair: true, reduceMotion: false, toggleBreath: false, resScale: 1, brightness: 1, quality: 0, shadows: 2, bloom: true, fpsLimit: 3, poolAO: true, poolAA: true, texFilter: 2, warmup: 2 };

/** Los topes de fotogramas por segundo de FPS LIMIT (0 = sin tope) y los niveles de TEXTURE FILTERING. */
export const FPS_CAPS = [30, 45, 60, 0] as const;
export const ANISO = [1, 2, 4, 8] as const;

/**
 * Los perfiles de PRESET (ajustes): nombre, una línea y los ajustes de rendimiento que fija cada uno. No se guarda cuál está puesto:
 * es el que coincide con los valores de ahora (ninguno = CUSTOM). HIGH es lo de fábrica.
 */
export const PRESETS: readonly (readonly [string, string, Partial<Settings>])[] = [
  ['POTATO', 'ANYTHING TO MAKE IT RUN', { quality: 1, resScale: 0.6, fpsLimit: 0, shadows: 0, bloom: false, texFilter: 0, poolAO: false, poolAA: false, warmup: 0 }],
  ['LOW', 'OLD LAPTOPS AND PHONES', { quality: 1, resScale: 1, fpsLimit: 2, shadows: 0, bloom: false, texFilter: 1, poolAO: false, poolAA: false, warmup: 1 }],
  ['MEDIUM', 'INTEGRATED GRAPHICS', { quality: 0, resScale: 0.8, fpsLimit: 3, shadows: 1, bloom: true, texFilter: 2, poolAO: false, poolAA: true, warmup: 1 }],
  ['HIGH', 'THE FULL LOOK', { quality: 0, resScale: 1, fpsLimit: 3, shadows: 2, bloom: true, texFilter: 2, poolAO: true, poolAA: true, warmup: 2 }],
];
export const presetOf = (s: Settings) => PRESETS.findIndex(([, , v]) => Object.entries(v).every(([k, x]) => s[k as keyof Settings] === x));
export const applyPreset = (i: number) => Object.entries(PRESETS[i]?.[2] ?? {}).forEach(([k, v]) => setSetting(k as keyof Settings, v as never));

const KEY = 'br-settings';
const read = (): Settings => {
  try {
    const saved = localStorage.getItem(KEY);
    // la primera vez, sin nada guardado: un equipo flojo (pocos núcleos o poca memoria) empieza en un perfil bajo, o puede que ni llegue a abrir el juego
    const weak = Math.min((navigator as { deviceMemory?: number }).deviceMemory ?? 8, navigator.hardwareConcurrency ?? 8);
    if (!saved) return { ...DEFAULTS, ...(weak <= 2 ? PRESETS[0][2] : weak <= 4 ? PRESETS[1][2] : {}) };
    return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch {
    return { ...DEFAULTS };
  }
};

/** Los valores de ahora; los lee el juego cada vez que los necesita. */
export let settings: Settings = read();
const subs = new Set<() => void>();
const listeners: Partial<{ [K in keyof Settings]: (v: Settings[K]) => void }> = {};

/** Para quien tiene que reaccionar a un cambio (el volumen del audio). */
export const onSetting = <K extends keyof Settings>(k: K, f: (v: Settings[K]) => void) => void (listeners[k] = f as never);

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings = { ...settings, [k]: v };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  listeners[k]?.(v);
  subs.forEach((f) => f());
}

export const resetSettings = () => Object.entries(DEFAULTS).forEach(([k, v]) => setSetting(k as keyof Settings, v as never));

export const useSettings = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => settings,
  );
