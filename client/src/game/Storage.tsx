import { useCallback, useEffect, useState } from 'react';

/*
 * STORAGE (ajustes): lo que el juego guarda en este navegador (la caché de descargas y los paquetes opcionales) y cuánto ocupa,
 * con lo necesario para liberarlo. Los paquetes se describen en /models/packs/manifest.json ({ packs: [{ id, name, desc, files: [url] }] });
 * instalar uno es bajar sus archivos a una caché propia (br-pack-<id>) y quitarlo es borrarla. Los ajustes y las cuentas no se tocan.
 */

interface Pack {
  id: string;
  name: string;
  desc: string;
  files: string[];
}
interface Entry {
  name: string;
  bytes: number;
  files: number;
}

const MANIFEST = '/models/packs/manifest.json'; // (fuera de /assets: la reescritura de la SPA de vercel.json no la toca)
const PREFIX = 'br-pack-';

export const fmt = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);

async function sizes(): Promise<Entry[]> {
  if (!('caches' in window)) return [];
  const out: Entry[] = [];
  for (const name of await caches.keys()) {
    const c = await caches.open(name), reqs = await c.keys();
    let bytes = 0;
    for (const r of reqs) bytes += (await (await c.match(r))?.clone().blob())?.size ?? 0;
    out.push({ name, bytes, files: reqs.length });
  }
  return out;
}

export default function StoragePane() {
  const [use, setUse] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [busy, setBusy] = useState<Record<string, number>>({}); // paquete -> 0..1 mientras se baja
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const e = await navigator.storage?.estimate?.();
      setUse({ usage: e?.usage ?? 0, quota: e?.quota ?? 0, persisted: !!(await navigator.storage?.persisted?.()) });
    } catch {
      setUse(null);
    }
    setEntries(await sizes().catch(() => []));
  }, []);
  useEffect(() => {
    void refresh();
    fetch(MANIFEST)
      .then((r) => r.json())
      .then((m: { packs?: Pack[] }) => setPacks(Array.isArray(m.packs) ? m.packs : []))
      .catch(() => setPacks([])); // (sin manifiesto, o la reescritura devolvió la página: no hay paquetes)
  }, [refresh]);

  const bytesOf = (name: string) => entries.find((e) => e.name === name);
  const install = async (p: Pack) => {
    setMsg('');
    try {
      const c = await caches.open(PREFIX + p.id);
      for (let i = 0; i < p.files.length; i++) {
        setBusy((b) => ({ ...b, [p.id]: i / p.files.length }));
        if (!(await c.match(p.files[i]))) {
          const r = await fetch(p.files[i]);
          if (!r.ok) throw new Error(`${p.files[i]}: ${r.status}`);
          await c.put(p.files[i], r);
        }
      }
    } catch (e) {
      await caches.delete(PREFIX + p.id);
      setMsg(`COULD NOT DOWNLOAD ${p.name}: ${(e as Error).message}`.toUpperCase());
    }
    setBusy(({ [p.id]: _, ...rest }) => rest);
    void refresh();
  };
  const drop = async (name: string) => {
    await caches.delete(name);
    void refresh();
  };
  const others = entries.filter((e) => !e.name.startsWith(PREFIX));
  const frac = use && use.quota ? Math.min(1, use.usage / use.quota) : 0;
  const BLOCKS = 24, on = Math.max(use?.usage ? 1 : 0, Math.round(frac * BLOCKS));

  return (
    <div className="br-set2" role="tabpanel" aria-label="STORAGE">
      <ul className="br-set2__list">
        <li className="br-row">
          <span className="br-row__l">
            <span className="br-row__t">USED BY THE GAME</span>
            <span className="br-row__d">{use ? `${fmt(use.usage)} OF ${fmt(use.quota)} AVAILABLE` : 'THIS BROWSER DOES NOT SAY'}</span>
          </span>
          <span className="br-row__c">
            <p className="br-meter" aria-hidden="true">
              {'▮'.repeat(on)}
              <span className="br-lobby__dim">{'▮'.repeat(BLOCKS - on)}</span>
            </p>
          </span>
        </li>
        {packs.map((p) => {
          const e = bytesOf(PREFIX + p.id), have = !!e && e.files >= p.files.length, work = busy[p.id];
          return (
            <li key={p.id} className="br-row">
              <span className="br-row__l">
                <span className="br-row__t">{p.name}</span>
                <span className="br-row__d">{work !== undefined ? `DOWNLOADING ${Math.round(work * 100)}%` : have ? `INSTALLED · ${fmt(e!.bytes)}` : p.desc}</span>
              </span>
              <button type="button" className="br-opt br-row__sw" disabled={work !== undefined} onClick={() => (have ? void drop(PREFIX + p.id) : void install(p))}>
                {have ? 'REMOVE' : 'INSTALL'}
              </button>
            </li>
          );
        })}
        {!packs.length && (
          <li className="br-row">
            <span className="br-row__l">
              <span className="br-row__t">OPTIONAL PACKS</span>
              <span className="br-row__d">NONE YET: HIGH-RES TEXTURES WILL APPEAR HERE</span>
            </span>
          </li>
        )}
        {others.map((e) => (
          <li key={e.name} className="br-row">
            <span className="br-row__l">
              <span className="br-row__t">CACHE · {e.name}</span>
              <span className="br-row__d">{`${e.files} FILES · ${fmt(e.bytes)}`}</span>
            </span>
            <button type="button" className="br-opt br-row__sw" onClick={() => void drop(e.name)}>
              CLEAR
            </button>
          </li>
        ))}
        {use && (
          <li className="br-row">
            <span className="br-row__l">
              <span className="br-row__t">KEEP MY DATA</span>
              <span className="br-row__d">{use.persisted ? 'THE BROWSER WILL NOT CLEAR IT ON ITS OWN' : 'THE BROWSER MAY CLEAR IT WHEN SPACE RUNS LOW'}</span>
            </span>
            <button type="button" className="br-opt br-row__sw" disabled={use.persisted} onClick={() => void navigator.storage.persist().then(refresh)}>
              {use.persisted ? 'ON' : 'ASK'}
            </button>
          </li>
        )}
      </ul>
      <aside className="br-set2__side" aria-live="polite">
        <p className="br-set2__h">STORAGE</p>
        <p>What the game keeps in this browser so it does not download it again, and the optional packs (for example, higher resolution textures). Removing something only means downloading it again later. Your settings and account are not touched.</p>
        {msg && <p role="alert">{msg}</p>}
      </aside>
      <div className="br-pane__foot">
        <button type="button" className="br-opt" disabled={!entries.length} onClick={() => void Promise.all(entries.map((e) => caches.delete(e.name))).then(refresh)}>
          CLEAR EVERYTHING
        </button>
        <span className="br-lobby__dim br-lobby__keys">ESC BACK</span>
      </div>
    </div>
  );
}
