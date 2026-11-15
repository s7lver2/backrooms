import { report } from './telemetry';

/*
 * Registro de errores de renderizado, para el botón «COPY RENDER ERRORS» de la consola de admin (game/Admin.tsx).
 * Recoge: console.error (three escribe ahí los shaders que no compilan), los console.warn que hablan de three/WebGL/texturas/glb, los errores sin
 * capturar, las promesas rechazadas y la pérdida del contexto WebGL (watchCanvas). Una entrada por mensaje distinto, con cuántas veces salió:
 * un aviso por fotograma no llena nada. Vive en memoria (se pierde al recargar) y se instala al arrancar, antes de que cargue ningún nivel.
 */

export interface ErrEntry {
  kind: string;
  msg: string;
  /** Veces que ha salido. */
  n: number;
  first: number;
  last: number;
}

const MAX = 40; // mensajes distintos que se guardan (el más viejo se descarta)
const MAXLEN = 4000; // un error de shader lleva el código de alrededor: se recorta
const WARN = /three|webgl|shader|glsl|texture|gltf|glb|geometry|material|framebuffer|render|pool kit/i;

// avisos de three que no son un fallo: la GPU no tiene la extensión (solo se compila en serie) y el dev server de Vite carga three dos veces (HMR)
const BENIGN = /KHR_parallel_shader_compile|Multiple instances of Three\.js/i;

const list: ErrEntry[] = [];
const subs = new Set<() => void>();
let ver = 0;
let pending = 0;
let installed = false;

const fmt = (a: unknown): string => {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
};

// los avisos de un bucle de render salen 60 veces por segundo: la interfaz se entera como mucho cada 0,4 s
const changed = () => {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    ver++;
    subs.forEach((f) => f());
  }, 400);
};

function note(kind: string, msg: string) {
  if (BENIGN.test(msg)) return;
  const now = Date.now(), key = kind + msg.slice(0, 300);
  const old = list.find((e) => e.kind + e.msg.slice(0, 300) === key);
  if (old) (old.n++, (old.last = now));
  else {
    list.push({ kind, msg: msg.length > MAXLEN ? `${msg.slice(0, MAXLEN)}\n… (${msg.length - MAXLEN} more chars)` : msg, n: 1, first: now, last: now });
    if (list.length > MAX) list.shift();
    if (kind.startsWith('console.') || kind === 'webgl') report(kind, msg, kind === 'console.warn' ? 'warning' : 'error'); // (los errores sin capturar y las promesas ya los coge el SDK)
  }
  changed();
}

/** Engancha console.error/warn y los errores globales. Una sola vez. */
export function installErrLog() {
  if (installed) return;
  installed = true;
  for (const k of ['error', 'warn'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => {
      orig(...a);
      try {
        const m = a.map(fmt).join(' ');
        if (k === 'error' || WARN.test(m)) note(`console.${k}`, m);
      } catch {} // (el registro nunca debe romper lo que registra)
    };
  }
  addEventListener('error', (e) => {
    if (/ResizeObserver loop/.test(e.message)) return;
    note('uncaught', e.error ? fmt(e.error) : `${e.message} (${e.filename}:${e.lineno}:${e.colno})`);
  });
  addEventListener('unhandledrejection', (e) => note('promise', fmt(e.reason)));
}

/** El lienzo del juego: perder o recuperar el contexto WebGL es un error de render (three solo lo escribe con console.log). */
export function watchCanvas(c: HTMLCanvasElement) {
  c.addEventListener('webglcontextlost', () => note('webgl', 'CONTEXT LOST (the GPU dropped the WebGL context)'));
  c.addEventListener('webglcontextrestored', () => note('webgl', 'context restored'));
}

export const errList = (): readonly ErrEntry[] => list;
export const errVersion = () => ver;
export const errTotal = () => list.reduce((n, e) => n + e.n, 0);
export function errSubscribe(f: () => void) {
  subs.add(f);
  return () => void subs.delete(f);
}
export function errClear() {
  list.length = 0;
  ver++;
  subs.forEach((f) => f());
}

/** Los errores como texto para pegar: hora, tipo, veces y mensaje. */
export function errReport() {
  if (!list.length) return 'NO RENDER ERRORS RECORDED';
  return list.map((e) => `[${new Date(e.first).toISOString().slice(11, 19)}] ${e.kind}${e.n > 1 ? ` x${e.n}` : ''}\n${e.msg}`).join('\n\n');
}

/** Al portapapeles; sin contexto seguro (http por IP) cae al truco del textarea. Devuelve si se copió. */
export async function copyText(txt: string) {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch {
    const t = Object.assign(document.createElement('textarea'), { value: txt });
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}
