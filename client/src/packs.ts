/*
 * Los paquetes: lo que el juego puede dejar guardado en el disco (cachés br-pack-<id>, servidas por el service worker /sw.js).
 * El manifiesto (/models/packs/manifest.json) lo genera la compilación (packsManifest en vite.config.ts) con los archivos de cada paquete.
 * Instalar = bajar sus archivos a su caché; quitar = borrarla. Sin instalar, el juego baja lo que necesita de la red como siempre.
 */

export interface Pack {
  id: string;
  name: string;
  desc: string;
  files: string[];
  bytes: number;
  /** Se instala solo, en segundo plano, mientras no se haya quitado a mano. */
  auto?: boolean;
  /** Imprescindible: no se puede quitar. */
  required?: boolean;
  /** Aún no existe (sin archivos). */
  soon?: boolean;
  /** Portada (URL de una imagen); sin ella, un icono. */
  cover?: string;
}

import { useSyncExternalStore } from 'react';

export const PREFIX = 'br-pack-';
export const MANIFEST = '/models/packs/manifest.json'; // (fuera de /assets: la reescritura de la SPA no la toca)
const OFF = 'br-pack-off:'; // ajuste local: quitado a mano, no se reinstala solo

export const fmt = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);

export async function loadManifest(): Promise<Pack[]> {
  try {
    const m = (await (await fetch(MANIFEST, { cache: 'no-cache' })).json()) as { packs?: Pack[] };
    return Array.isArray(m.packs) ? m.packs : [];
  } catch {
    return []; // (sin manifiesto, o la reescritura devolvió la página)
  }
}

/** Qué hay en la caché de un paquete: sus archivos (de los del manifiesto) y lo que ocupan. */
export async function status(p: Pack): Promise<{ have: number; bytes: number }> {
  if (!('caches' in window)) return { have: 0, bytes: 0 };
  const c = await caches.open(PREFIX + p.id), want = new Set(p.files.map((f) => new URL(f, location.origin).href));
  let have = 0, bytes = 0;
  for (const r of await c.keys()) {
    if (!want.has(r.url)) continue;
    have++;
    bytes += (await (await c.match(r))?.clone().blob())?.size ?? 0;
  }
  return { have, bytes };
}

/** Baja los archivos que falten, quita los que ya no son del paquete (una versión nueva) y avisa del avance (0–1). */
export async function install(p: Pack, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<void> {
  const c = await caches.open(PREFIX + p.id), want = new Set(p.files.map((f) => new URL(f, location.origin).href));
  for (const r of await c.keys()) if (!want.has(r.url)) await c.delete(r);
  let done = 0;
  const queue = [...p.files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      if (!(await c.match(f))) {
        // (hasta 3 intentos por archivo: un corte suelto de red no tira todo el paquete; lo ya bajado se conserva y se reanuda)
        for (let t = 1; ; t++) {
          try {
            const r = await fetch(f, { signal });
            if (!r.ok) throw new Error(`${f}: ${r.status}`);
            if (!/\.(html?|json)$/.test(f) && (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${f}: NOT FOUND`); // (la reescritura de la SPA devuelve la pagina)
            await c.put(f, r);
            break;
          } catch (e) {
            if (signal?.aborted || t >= 3) throw e;
            await new Promise((ok) => setTimeout(ok, 400 * t));
          }
        }
      }
      onProgress?.(++done / p.files.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker)); // (cuatro descargas a la vez)
    localStorage.removeItem(OFF + p.id);
    void navigator.storage?.persist?.().catch(() => {}); // (que el navegador no lo borre al faltar espacio)
  } catch (e) {
    queue.length = 0;
    throw e;
  }
}

/*
 * Las descargas en curso viven aqui (no en una pantalla): se pueden dejar y seguir jugando o cambiar de pestaña del navegador, siguen bajando, y
 * DownloadToast las enseña abajo en cualquier pantalla. Cada una se puede cancelar.
 */
export interface Download {
  id: string;
  name: string;
  f: number; // 0-1
  done?: boolean;
  err?: string;
  quiet?: boolean; // las automaticas no enseñan el aviso
}
const dls = new Map<string, Download>(), ctl = new Map<string, AbortController>(), subs = new Set<() => void>();
let snap: Download[] = [];
const emit = () => ((snap = [...dls.values()].map((d) => ({ ...d }))), subs.forEach((f) => f()));
export const useDownloads = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => snap,
  );
export const dismissDownload = (id: string) => (dls.delete(id), emit());
export const cancelDownload = (id: string) => ctl.get(id)?.abort();

export async function startInstall(p: Pack, quiet = false): Promise<void> {
  const cur = dls.get(p.id);
  if (cur && !cur.done && !cur.err) return;
  const d: Download = { id: p.id, name: p.name, f: 0, quiet };
  const ac = new AbortController();
  dls.set(p.id, d), ctl.set(p.id, ac), emit();
  let last = -1;
  try {
    await install(
      p,
      (f) => {
        d.f = f;
        if (Math.round(f * 100) !== last) ((last = Math.round(f * 100)), emit());
      },
      ac.signal,
    );
    d.done = true;
    d.f = 1;
    emit();
    setTimeout(() => dls.get(p.id) === d && dismissDownload(p.id), 4000);
  } catch (e) {
    // (si falla o se cancela, lo ya bajado se queda: al reintentar solo baja lo que falta)
    if (ac.signal.aborted) dismissDownload(p.id);
    else ((d.err = (e as Error).message || 'FAILED'), emit());
  } finally {
    ctl.delete(p.id);
  }
}

export async function remove(p: Pack): Promise<void> {
  if (p.required) return;
  await caches.delete(PREFIX + p.id);
  try {
    localStorage.setItem(OFF + p.id, '1');
  } catch {}
}

/** Al abrir el juego, en segundo plano: instala (o actualiza) los paquetes automáticos que no se hayan quitado a mano. */
export async function autoInstall(): Promise<void> {
  if (!('caches' in window) || !('serviceWorker' in navigator) || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
  for (const p of await loadManifest()) {
    try {
      if (!p.auto || p.soon || (!p.required && localStorage.getItem(OFF + p.id))) continue;
      if ((await status(p)).have < p.files.length) await startInstall(p, true);
    } catch {}
  }
}

export function registerWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
