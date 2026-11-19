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
export async function install(p: Pack, onProgress?: (f: number) => void): Promise<void> {
  const c = await caches.open(PREFIX + p.id), want = new Set(p.files.map((f) => new URL(f, location.origin).href));
  for (const r of await c.keys()) if (!want.has(r.url)) await c.delete(r);
  let done = 0;
  const queue = [...p.files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      if (!(await c.match(f))) {
        const r = await fetch(f);
        if (!r.ok) throw new Error(`${f}: ${r.status}`);
        await c.put(f, r);
      }
      onProgress?.(++done / p.files.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker)); // (cuatro descargas a la vez)
    localStorage.removeItem(OFF + p.id);
  } catch (e) {
    queue.length = 0;
    throw e;
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
      if ((await status(p)).have < p.files.length) await install(p);
    } catch {}
  }
}

export function registerWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
