import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BedDouble, Car, Database, HardDrive, Image as ImageIcon, Layers, Package, SlidersHorizontal, Waves } from 'lucide-react';
import { PREFIX, cancelDownload, fmt, loadManifest, remove, startInstall, status, useDownloads, type Pack } from '../packs';
import './Storage.css';

/*
 * STORAGE (ajustes): la misma pantalla que las demás pestañas (lista a la izquierda, detalle del elegido a la derecha), en dos bloques:
 * PACKS (core, phoenyx, texturas HD y uno por nivel: instalar es dejarlos en el disco, ver src/packs.ts) y BROWSER DATA (la caché de
 * descargas, los ajustes guardados y pedir al navegador que no borre nada). Quitar algo solo significa bajarlo otra vez más tarde.
 */

const ICON: Record<string, ReactNode> = { core: <Package />, phoenyx: <Layers />, hd: <ImageIcon />, level0: <Layers />, parking: <Car />, poolrooms: <Waves />, suites: <BedDouble /> };
const LONG: Record<string, string> = {
  core: 'Everything the game needs whatever the level: the menu, the lobby, items, cosmetics and the shared models. Kept on disk so it opens without downloading it again.',
  phoenyx: 'The graphics engine (WebGPU). Kept on disk so the game starts faster.',
  hd: 'Sharper textures for walls, floors and props. Not available yet.',
};

interface Row {
  id: string;
  name: string;
  desc: string;
  long: string;
  icon: ReactNode;
  cover?: string;
  stats: [string, string][];
  act?: { label: string; run: () => void; off?: boolean };
  dim?: boolean;
}

export default function StoragePane() {
  const [use, setUse] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [have, setHave] = useState<Record<string, { have: number; bytes: number }>>({});
  const [cache, setCache] = useState<{ files: number; bytes: number; names: string[] }>({ files: 0, bytes: 0, names: [] });
  const dl = useDownloads(); // (las descargas viven en packs.ts: siguen al salir de esta pestaña; ver DownloadToast)
  const busy: Record<string, number> = Object.fromEntries(dl.filter((d) => !d.done && !d.err).map((d) => [d.id, d.f]));
  const failed = dl.find((d) => d.err);
  const msg = failed ? `COULD NOT DOWNLOAD ${failed.name}: ${failed.err}`.toUpperCase() : '';
  const [pick, setPick] = useState('');

  const refresh = useCallback(async () => {
    try {
      const e = await navigator.storage?.estimate?.();
      setUse({ usage: e?.usage ?? 0, quota: e?.quota ?? 0, persisted: !!(await navigator.storage?.persisted?.()) });
    } catch {
      setUse(null);
    }
    const list = await loadManifest();
    setPacks(list);
    const h: typeof have = {};
    for (const p of list) h[p.id] = await status(p).catch(() => ({ have: 0, bytes: 0 }));
    setHave(h);
    // la caché que no es de un paquete (lo que dejen otras versiones o el navegador): se puede limpiar aparte
    const c = { files: 0, bytes: 0, names: [] as string[] };
    if ('caches' in window)
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX)) continue;
        const ca = await caches.open(name);
        for (const r of await ca.keys()) (c.files++, (c.bytes += (await (await ca.match(r))?.clone().blob())?.size ?? 0));
        c.names.push(name);
      }
    setCache(c);
  }, []);
  useEffect(() => void refresh(), [refresh, dl]);

  const doInstall = (p: Pack) => void startInstall(p);
  const local = (() => {
    try {
      return Object.keys(localStorage).reduce((a, k) => a + k.length + (localStorage.getItem(k)?.length ?? 0), 0) * 2;
    } catch {
      return 0;
    }
  })();

  const packRows: Row[] = packs.map((p) => {
    const h = have[p.id], done = !!h && p.files.length > 0 && h.have >= p.files.length, work = busy[p.id];
    return {
      id: p.id,
      name: p.name,
      desc: p.soon ? 'COMING SOON' : work !== undefined ? `DOWNLOADING ${Math.round(work * 100)}%` : p.required ? `REQUIRED · ${done ? fmt(h.bytes) : 'DOWNLOADING SOON'}` : done ? `INSTALLED · ${fmt(h.bytes)}` : `NOT INSTALLED · ${fmt(p.bytes)}`,
      long: LONG[p.id] ?? `${p.desc}. Its models and textures, kept on disk so entering the level does not wait for the download.`,
      icon: ICON[p.id] ?? <Package />,
      cover: p.cover,
      stats: [['SIZE', p.soon ? '-' : fmt(p.bytes)], ['FILES', String(p.files.length)], ['STATE', p.soon ? 'SOON' : done ? 'INSTALLED' : 'NOT INSTALLED'], ...(p.required ? ([['REMOVABLE', 'NO · REQUIRED']] as [string, string][]) : p.auto ? ([['INSTALL', 'AUTOMATIC']] as [string, string][]) : [])],
      dim: p.soon,
      act: p.soon || p.required ? undefined : { label: work !== undefined ? 'CANCEL' : done ? 'REMOVE' : 'INSTALL', run: () => void (done ? remove(p).then(refresh) : work !== undefined ? cancelDownload(p.id) : doInstall(p)) },
    };
  });
  const dataRows: Row[] = [
    {
      id: '_cache',
      name: 'DOWNLOAD CACHE',
      desc: `${cache.files} FILES · ${fmt(cache.bytes)}`,
      long: 'Loose files the browser or older versions of the game left in the cache. Packs are not here: they are managed above. Clearing it only means downloading them again.',
      icon: <Database />,
      stats: [['FILES', String(cache.files)], ['SIZE', fmt(cache.bytes)]],
      act: { label: 'CLEAR', run: () => void Promise.all(cache.names.map((n) => caches.delete(n))).then(refresh), off: !cache.files },
    },
    {
      id: '_saves',
      name: 'SETTINGS AND SAVES',
      desc: `${fmt(local)} IN THIS BROWSER`,
      long: 'Your options and small things the game remembers, stored in this browser. Your account is on the server and is not affected.',
      icon: <SlidersHorizontal />,
      stats: [['SIZE', fmt(local)]],
    },
    ...(use
      ? [
          {
            id: '_keep',
            name: 'KEEP MY DATA',
            desc: use.persisted ? 'THE BROWSER WILL NOT CLEAR IT' : 'THE BROWSER MAY CLEAR IT WHEN SPACE RUNS LOW',
            long: 'Asks the browser not to remove the installed packs on its own when the disk runs low. The browser may ask you or decide by itself.',
            icon: <HardDrive />,
            stats: [['USED', fmt(use.usage)], ['AVAILABLE', fmt(use.quota)], ['PROTECTED', use.persisted ? 'YES' : 'NO']] as [string, string][],
            act: { label: use.persisted ? 'ON' : 'ASK', run: () => void navigator.storage.persist().then(refresh), off: use.persisted },
          },
        ]
      : []),
  ];
  const all = [...packRows, ...dataRows], row = all.find((r) => r.id === pick) ?? all[0];
  const installed = packs.reduce((a, p) => a + (have[p.id]?.bytes ?? 0), 0);
  const BLOCKS = 24, frac = use?.quota ? Math.min(1, use.usage / use.quota) : 0, on = Math.max(use?.usage ? 1 : 0, Math.round(frac * BLOCKS));

  const line = (r: Row, data?: boolean) => (
    <li key={r.id} className="br-row br-row--pack" data-kind={data ? 'data' : 'pack'} data-sel={r.id === row?.id || undefined} data-dim={r.dim || undefined} onMouseEnter={() => setPick(r.id)} onFocus={() => setPick(r.id)}>
      <span className="br-row__cv" aria-hidden="true">
        {r.cover ? <img src={r.cover} alt="" /> : r.icon}
      </span>
      <span className="br-row__l">
        <span className="br-row__t">{r.name}</span>
        <span className="br-row__d">{r.desc}</span>
      </span>
      {r.act && (
        <button type="button" className="br-opt br-row__sw" disabled={r.act.off} onClick={r.act.run}>
          {r.act.label}
        </button>
      )}
    </li>
  );

  return (
    <div className="br-set2" role="tabpanel" aria-label="STORAGE">
      <ul className="br-set2__list">
        <li className="br-grp br-grp--packs">
          <b>PACKS</b>
          <span>GAME CONTENT · {fmt(installed)} INSTALLED</span>
        </li>
        {packRows.length ? packRows.map((r) => line(r)) : <li className="br-row"><span className="br-row__l"><span className="br-row__d">NO PACK LIST IN THIS VERSION</span></span></li>}
        <li className="br-grp br-grp--data">
          <b>BROWSER DATA</b>
          <span>CACHE AND LOCAL SETTINGS, NOT GAME CONTENT</span>
        </li>
        {dataRows.map((r) => line(r, true))}
      </ul>
      <aside className="br-set2__side" aria-live="polite">
        <p className="br-set2__h">{row?.name}</p>
        <p>{row?.long}</p>
        <div className="br-set2__prev br-prev--col">
          <span className="br-cover" aria-hidden="true">
            {row?.cover ? <img src={row.cover} alt="" /> : row?.icon}
          </span>
          <dl className="br-stats">
            {row?.stats.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="br-meter" aria-hidden="true">
            {'▮'.repeat(on)}
            <span className="br-lobby__dim">{'▮'.repeat(BLOCKS - on)}</span>
          </p>
          <p className="br-lobby__dim">{use ? `${fmt(use.usage)} OF ${fmt(use.quota)} USED BY THIS SITE` : ''}</p>
        </div>
        {msg && <p role="alert">{msg}</p>}
      </aside>
      <div className="br-pane__foot">
        <button type="button" className="br-opt" disabled={!packs.some((p) => !p.required && have[p.id]?.have)} onClick={() => void Promise.all(packs.filter((p) => !p.required).map((p) => remove(p))).then(refresh)}>
          REMOVE OPTIONAL PACKS
        </button>
        <span className="br-lobby__dim br-lobby__keys">↑ ↓ SELECT · ESC BACK</span>
      </div>
    </div>
  );
}
