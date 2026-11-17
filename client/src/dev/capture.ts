// Modo captura (solo desarrollo local): congela semilla y reloj para sacar imágenes y cifras repetibles del juego.
// Se activa con /?capture&seed=N[&preset=potato|low|medium|high] junto a las banderas de desarrollo de siempre (&pool, &suites, &parking…).
// Sirve para comparar el renderer actual (three) con Phoenyx: ver E:\phoenix\docs\FIDELIDAD.md.
import { DEV_LOCAL } from '../devGate';
import { PRESETS, resetSettings, setSetting, type Settings } from '../settings';

const SETTINGS_KEY = 'br-settings';

interface CaptureApi {
  ready: boolean;
  /** Coloca al jugador (x, y, z de los pies, giro y cabeceo en radianes). */
  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  /** Reinicia la semilla aleatoria: el orden de las cargas asíncronas ya no influye en los fotogramas que vienen. */
  reseed(seed: number): void;
  /** Avanza n fotogramas de 1/60 s (el reloj y requestAnimationFrame son virtuales). */
  advance(frames: number): Promise<void>;
  /** Cifras del renderer del último fotograma. */
  info(): { drawCalls: number; triangles: number; geometries: number; textures: number };
  /** Devuelve el reloj y requestAnimationFrame reales (para medir rendimiento de verdad). */
  release(): void;
}

declare global {
  interface Window {
    __capture?: CaptureApi;
    /** Lo pone Backrooms.tsx en modo captura: la partida en curso. */
    __game?: { pool?: unknown; player?: { pos: { set(x: number, y: number, z: number): void }; yaw: number; pitch: number }; renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number }; memory: { geometries: number; textures: number } } } };
  }
}

const STEP = 1000 / 60;

/** Generador pequeño y repetible (mulberry32). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function installCapture() {
  if (!DEV_LOCAL) return;
  const q = new URLSearchParams(location.search);
  if (!q.has('capture')) return;

  // Ajustes fijos: ni los guardados del navegador ni la resolución dinámica ni el tope de FPS cambian la imagen.
  const name = (q.get('preset') ?? 'high').toUpperCase();
  const preset = PRESETS.find((p) => p[0] === name) ?? PRESETS[3];
  // Se parte de los valores de fábrica (no de los guardados del navegador) y no se deja nada escrito en localStorage.
  const stored = localStorage.getItem(SETTINGS_KEY);
  resetSettings();
  for (const [k, v] of Object.entries(preset[2])) setSetting(k as keyof Settings, v as never);
  setSetting('fpsLimit', 3);
  setSetting('resScale', preset[2].resScale ?? 1);
  if (stored === null) localStorage.removeItem(SETTINGS_KEY);
  else localStorage.setItem(SETTINGS_KEY, stored);

  const realNow = performance.now.bind(performance);
  const realDate = Date.now.bind(Date);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const realRandom = Math.random;
  const t0Date = realDate();
  let vt = 1000; // reloj virtual (ms); empieza lejos de 0 por si algún código usa 0 como «sin valor»
  let nextId = 1;
  let queue = new Map<number, FrameRequestCallback>();
  let virtual = true;

  // `new Date()` sin argumentos también usa el reloj virtual (el reloj de pared de waitProps.ts, por ejemplo).
  const RealDate = Date;
  class VDate extends RealDate {
    constructor(...a: unknown[]) {
      super(...((a.length ? a : [virtual ? t0Date + (vt - 1000) : realDate()]) as [number]));
    }
  }
  window.Date = VDate as unknown as DateConstructor;

  Math.random = mulberry32(Number(q.get('seed')) || 1);
  performance.now = () => (virtual ? vt : realNow());
  Date.now = () => (virtual ? t0Date + (vt - 1000) : realDate());
  window.requestAnimationFrame = (cb) => {
    if (!virtual) return realRaf(cb);
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => void (queue.delete(id) || realCaf(id));

  const tick = () => {
    vt += STEP;
    const run = queue;
    queue = new Map();
    run.forEach((cb) => cb(vt));
  };

  window.__capture = {
    ready: false,
    setPose(x, y, z, yaw, pitch) {
      const p = window.__game?.player;
      if (!p) throw new Error('capture: sin jugador (en las Poolrooms la pose no se puede fijar todavía)');
      p.pos.set(x, y, z);
      p.yaw = yaw;
      p.pitch = pitch;
    },
    reseed(seed) {
      Math.random = mulberry32(seed);
    },
    async advance(frames) {
      // Entre fotogramas se cede el turno al navegador: las cargas (fetch, imágenes, shaders) siguen en tiempo real.
      for (let i = 0; i < frames; i++) {
        // El compositor dibuja en varias pasadas: se cuentan todas y se reinicia aquí, antes de cada fotograma.
        const ri = window.__game?.renderer.info;
        if (ri) (ri.autoReset = false), ri.reset();
        tick();
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
    },
    info() {
      const i = window.__game?.renderer.info;
      return { drawCalls: i?.render.calls ?? 0, triangles: i?.render.triangles ?? 0, geometries: i?.memory.geometries ?? 0, textures: i?.memory.textures ?? 0 };
    },
    release() {
      virtual = false;
      Math.random = realRandom;
      queue.forEach((cb) => realRaf(cb));
      queue.clear();
    },
  };

  // Mientras no hay partida, el reloj virtual avanza solo para que las pantallas de carga progresen.
  // «Listo» = hay partida con jugador (o nivel de Poolrooms, que lleva su propia cámara). Se mira antes de cada fotograma de arranque:
  // así no corre ninguno con la partida ya creada y el estado al capturar no depende de la velocidad de carga.
  const boot = setInterval(() => {
    if (window.__game?.player || window.__game?.pool) {
      window.__capture!.ready = true;
      return clearInterval(boot);
    }
    if (!virtual) return clearInterval(boot);
    tick();
  }, 16);
}
