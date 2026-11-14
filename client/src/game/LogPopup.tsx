import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BackroomsGame } from './game';
import { dlogClear, dlogLines, dlogSubscribe, dlogVersion } from '../dlog';
import { copyText, errClear, errList, errSubscribe, errVersion } from '../errlog';

/*
 * Popup de registro (F8), para cualquiera: los eventos del juego y de la sala (recogidas, ascensor, misión, muertes, emotes...) y los errores de
 * render. Con COPY se pasa todo junto para pegarlo en un aviso de fallo. Mientras está abierto no llegan teclas al juego (llave `block('log')`).
 */
const NL = '\n';
const when = (t: number) => new Date(t).toLocaleTimeString();

export default function LogPopup({ game }: { game: React.RefObject<BackroomsGame | undefined> }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'EVENTS' | 'ERRORS'>('EVENTS');
  const [note, setNote] = useState('');
  useSyncExternalStore(dlogSubscribe, dlogVersion);
  useSyncExternalStore(errSubscribe, errVersion);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'F8' || (open && e.code === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open]);

  useEffect(() => {
    const g = game.current;
    if (!g || !open) return;
    g.input.block('log');
    g.input.unlock();
    return () => {
      g.input.unblock('log');
      g.input.clear();
      if (!g.input.suspend) g.input.lock(true);
    };
  }, [open, game]);

  if (!open) return null;
  const errs = errList(), ev = dlogLines();
  const all = () => [`# EVENTS`, ...ev, '', `# ERRORS`, ...errs.map((e) => `${when(e.last)} [${e.kind}] x${e.n} ${e.msg}`)].join(NL);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setOpen(false)}>
      <div style={{ width: 'min(900px, 94vw)', height: 'min(560px, 80vh)', background: '#0b0b0b', border: '1px solid #666', color: '#ddd', font: '12px/1.4 monospace', display: 'flex', flexDirection: 'column', padding: 10 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <b>LOG</b>
          {(['EVENTS', 'ERRORS'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? '#444' : '#222', color: '#eee', border: '1px solid #555', padding: '2px 8px' }}>
              {t}{t === 'ERRORS' && errs.length ? ` (${errs.length})` : ''}
            </button>
          ))}
          <button onClick={() => void copyText(all()).then(() => setNote('COPIED'))} style={{ background: '#222', color: '#eee', border: '1px solid #555', padding: '2px 8px' }}>COPY ALL</button>
          <button onClick={() => (dlogClear(), errClear())} style={{ background: '#222', color: '#eee', border: '1px solid #555', padding: '2px 8px' }}>CLEAR</button>
          <span style={{ opacity: 0.6 }}>{note}</span>
          <span style={{ marginLeft: 'auto', opacity: 0.6 }}>F8 / ESC CLOSE</span>
        </div>
        <pre style={{ flex: 1, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', userSelect: 'text' }}>
          {tab === 'EVENTS' ? ev.join(NL) || '(no events yet)' : errs.map((e) => `${when(e.last)} [${e.kind}] x${e.n}${NL}${e.msg}`).join(NL + NL) || '(no errors)'}
        </pre>
      </div>
    </div>
  );
}
