import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS, EMOTE_DEFS, emoteOpen } from '@backrooms/shared';

/*
 * La rueda de emotes (mantener B en la sala de espera): el puntero se suelta mientras está abierta; el emote bajo el puntero se hace al soltar B
 * (o con un clic). Los bloqueados se ven apagados con el logro que los abre. Escape la cierra sin hacer nada.
 */
const N = EMOTE_DEFS.length;
const need = (key: string | null) => ACHIEVEMENTS.find((a) => a.key === key)?.name ?? '';

export default function EmoteWheel({ have, onPick }: { have: ReadonlySet<string>; onPick: (n: number) => void }) {
  const [hot, setHot] = useState(0);
  const cur = useRef(0);
  cur.current = hot;
  useEffect(() => {
    const up = (e: KeyboardEvent) => e.code === 'KeyB' && onPick(cur.current && emoteOpen(cur.current, have) ? cur.current : 0);
    const esc = (e: KeyboardEvent) => e.code === 'Escape' && (e.preventDefault(), e.stopImmediatePropagation(), onPick(0));
    addEventListener('keyup', up);
    addEventListener('keydown', esc, true);
    return () => (removeEventListener('keyup', up), removeEventListener('keydown', esc, true));
  }, [have, onPick]);
  const e = hot ? EMOTE_DEFS[hot - 1] : undefined;
  return (
    <div className="br-wheel" role="menu" aria-label="Emotes">
      <div className="br-wheel__ring">
        {EMOTE_DEFS.map((d, i) => {
          const a = (i / N) * Math.PI * 2 - Math.PI / 2, open = emoteOpen(i + 1, have);
          return (
            <button
              key={d.name}
              type="button"
              role="menuitem"
              className="br-wheel__it"
              data-open={open || undefined}
              data-hot={hot === i + 1 || undefined}
              style={{ '--x': Math.cos(a).toFixed(3), '--y': Math.sin(a).toFixed(3) } as React.CSSProperties}
              onPointerEnter={() => setHot(i + 1)}
              onPointerLeave={() => setHot((h) => (h === i + 1 ? 0 : h))}
              onClick={() => open && onPick(i + 1)}
            >
              {d.name}
            </button>
          );
        })}
        <div className="br-wheel__mid">
          {e ? (
            <>
              <b>{e.name}</b>
              <span className="br-lobby__dim">{emoteOpen(hot, have) ? 'RELEASE [B] TO PLAY' : `LOCKED · ${need(e.need)}`}</span>
            </>
          ) : (
            <span className="br-lobby__dim">EMOTES</span>
          )}
        </div>
      </div>
    </div>
  );
}
