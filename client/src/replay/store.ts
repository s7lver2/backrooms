import { KEEP, REPLAY_FORMAT, type ReplayChunk, type ReplayMeta } from './format';

/*
 * Las repeticiones viven en IndexedDB del navegador (nada va al servidor). Dos almacenes: `meta` (la lista, ligera) y `chunks`
 * (los bloques de la partida, cada uno gzip). Todo con try/catch: si IndexedDB no esta (modo privado, lleno, bloqueado) no se
 * guarda nada y el juego sigue como si no existiera.
 */
const DB = 'bk-replays';
let dbp: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise<IDBDatabase>((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('no indexedDB'));
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('meta', { keyPath: 'id' });
      q.result.createObjectStore('chunks');
    };
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
    q.onblocked = () => no(new Error('blocked'));
  }).catch((e) => ((dbp = undefined), Promise.reject(e))));
}

const done = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => no(r.error))));
const tx = async (stores: string[], mode: IDBTransactionMode) => (await db()).transaction(stores, mode);

export async function putMeta(m: ReplayMeta): Promise<void> {
  const t = await tx(['meta'], 'readwrite');
  await done(t.objectStore('meta').put(m));
}

export async function putChunk(id: string, i: number, b: Blob): Promise<void> {
  const t = await tx(['chunks'], 'readwrite');
  await done(t.objectStore('chunks').put(b, `${id}:${i}`));
}

export async function listReplays(): Promise<ReplayMeta[]> {
  try {
    const t = await tx(['meta'], 'readonly');
    const all = (await done(t.objectStore('meta').getAll())) as ReplayMeta[];
    return all.sort((a, b) => b.started - a.started);
  } catch {
    return [];
  }
}

export async function deleteReplay(id: string): Promise<void> {
  try {
    const t = await tx(['meta', 'chunks'], 'readwrite');
    t.objectStore('meta').delete(id);
    t.objectStore('chunks').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
    await new Promise<void>((ok) => ((t.oncomplete = () => ok()), (t.onerror = () => ok()), (t.onabort = () => ok())));
  } catch {
    /* sin IndexedDB no hay nada que borrar */
  }
}

export async function starReplay(id: string, on: boolean): Promise<void> {
  try {
    const t = await tx(['meta'], 'readwrite');
    const m = (await done(t.objectStore('meta').get(id))) as ReplayMeta | undefined;
    if (m) await done(t.objectStore('meta').put({ ...m, starred: on }));
  } catch {
    /* igual que arriba */
  }
}

/** Deja las ultimas KEEP partidas sin estrella (las de la lista, la mas nueva primero); `keep` es la que se esta grabando. */
export async function rotate(keep: string): Promise<void> {
  const olds = (await listReplays()).filter((m) => !m.starred && m.id !== keep).slice(KEEP - 1);
  for (const m of olds) await deleteReplay(m.id);
}

async function gunzip(b: Blob): Promise<unknown> {
  const s = b.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(s).text());
}

/** La partida entera, con los bloques en orden. `null` si no existe o el formato no se conoce. */
export async function loadReplay(id: string): Promise<{ meta: ReplayMeta; chunks: ReplayChunk[] } | null> {
  try {
    const t = await tx(['meta', 'chunks'], 'readonly');
    const meta = (await done(t.objectStore('meta').get(id))) as ReplayMeta | undefined;
    if (!meta || meta.v !== REPLAY_FORMAT) return null;
    const keys = (await done(t.objectStore('chunks').getAllKeys(IDBKeyRange.bound(`${id}:`, `${id}:￿`)))) as string[];
    keys.sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
    const blobs = await Promise.all(keys.map((k) => done(t.objectStore('chunks').get(k)) as Promise<Blob>));
    return { meta, chunks: (await Promise.all(blobs.map(gunzip))) as ReplayChunk[] };
  } catch {
    return null;
  }
}

const b64 = (b: Blob) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => no(r.error);
  r.readAsDataURL(b);
});

/** La partida como un archivo `.replay` (JSON con los bloques gzip en base64) para compartirla a mano. */
export async function exportReplay(id: string): Promise<Blob | null> {
  try {
    const t = await tx(['meta', 'chunks'], 'readonly');
    const meta = await done(t.objectStore('meta').get(id));
    if (!meta) return null;
    const keys = (await done(t.objectStore('chunks').getAllKeys(IDBKeyRange.bound(`${id}:`, `${id}:￿`)))) as string[];
    keys.sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
    const chunks = await Promise.all(keys.map(async (k) => b64((await done(t.objectStore('chunks').get(k))) as Blob)));
    return new Blob([JSON.stringify({ meta, chunks })], { type: 'application/json' });
  } catch {
    return null;
  }
}

/** Mete un `.replay` en la lista (con id nuevo). `null` si el archivo no vale. */
export async function importReplay(file: File): Promise<ReplayMeta | null> {
  try {
    const o = JSON.parse(await file.text()) as { meta?: ReplayMeta; chunks?: string[] };
    if (!o.meta || o.meta.v !== REPLAY_FORMAT || !Array.isArray(o.chunks)) return null;
    const meta: ReplayMeta = { ...o.meta, id: `${Date.now().toString(36)}i${Math.random().toString(36).slice(2, 5)}`, starred: false };
    for (const [i, c] of o.chunks.entries()) {
      const bin = atob(c), u = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
      await putChunk(meta.id, i, new Blob([u]));
    }
    await putMeta(meta);
    return meta;
  } catch {
    return null;
  }
}
