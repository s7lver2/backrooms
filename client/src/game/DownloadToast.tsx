import { cancelDownload, dismissDownload, useDownloads } from '../packs';

/** Las descargas de paquetes en curso, abajo a la izquierda en cualquier pantalla (siguen aunque se cambie de pestaña o de pantalla). */
export default function DownloadToast() {
  const list = useDownloads().filter((d) => !d.quiet);
  if (!list.length) return null;
  return (
    <aside className="br-dl" role="status" aria-live="polite">
      {list.map((d) => (
        <div key={d.id} className="br-dl__row" data-err={d.err ? true : undefined}>
          <p className="br-dl__t">
            {d.err ? `FAILED · ${d.name}` : d.done ? `INSTALLED · ${d.name}` : `DOWNLOADING · ${d.name}`}
            {!d.err && <span> {Math.round(d.f * 100)}%</span>}
          </p>
          <div className="br-dl__bar" aria-hidden="true">
            <i style={{ width: `${Math.round(d.f * 100)}%` }} />
          </div>
          {!d.done && (
            <button type="button" className="br-dl__x" onClick={() => (d.err ? dismissDownload(d.id) : cancelDownload(d.id))} aria-label={d.err ? 'Dismiss' : 'Cancel download'}>
              ✕
            </button>
          )}
        </div>
      ))}
    </aside>
  );
}
