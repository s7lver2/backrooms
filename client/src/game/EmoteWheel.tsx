import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS, EMOTE_DEFS, emoteOpen } from '@backrooms/shared';

/*
 * La rueda de emotes (mantener B en la sala de espera): el puntero se suelta mientras está abierta; el emote bajo el puntero se hace al soltar B
 * (o con un clic). Los bloqueados se ven apagados con el logro que los abre. Escape la cierra sin hacer nada.
 */
const N = EMOTE_DEFS.length;
/** El pictograma de cada emote: un monigote de palo. Ángulos (0 = hacia abajo, 90 = a la derecha de la imagen) de [brazo, antebrazo] y [muslo, pierna] de cada lado, y cuánto baja el cuerpo. */
type Pose = { l: [number, number]; r: [number, number]; ll: [number, number]; rl: [number, number]; oy?: number };
const LEGS: [[number, number], [number, number]] = [[-8, -4], [8, 4]];
const POSES: Record<string, Partial<Pose>> = {
  WAVE: { l: [-15, -10], r: [150, 185] },
  POINT: { l: [-12, -8], r: [90, 90] },
  CLAP: { l: [-12, -5], r: [125, 175] },
  SIT: { oy: 5, ll: [-70, -5], rl: [70, 5] },
  TWIST: { l: [-75, -95], r: [75, 95], ll: [-12, -6], rl: [12, 6] },
  MACARENA: { l: [-85, -30], r: [95, 165] },
  MOONWALK: { l: [-40, -30], r: [40, 30], ll: [-30, -5], rl: [22, 40] },
  SAMBA: { l: [-130, -165], r: [130, 165], ll: [-18, -30], rl: [18, 30] },
  'HIP HOP': { l: [-55, 20], r: [140, 170] },
  'CAN CAN': { l: [-100, -100], r: [100, 100], ll: [-6, -3], rl: [100, 130] },
  'BELLY DANCE': { l: [-150, -175], r: [150, 175], ll: [-6, -6], rl: [6, 6] },
  ANGRY: { l: [-120, -170], r: [120, 170] },
  FLAIR: { l: [-100, -120], r: [100, 120], rl: [70, 20] },
  PHONE: { l: [-10, -5], r: [140, -140] },
  'BAD SHOT': { l: [-45, -55], r: [-30, -60], ll: [-14, -8], rl: [14, 8] },
};
function EmoteIcon({ name }: { name: string }) {
  const q = { l: [-12, -6], r: [12, 6], ll: LEGS[0], rl: LEGS[1], oy: 0, ...POSES[name] } as Required<Pose>;
  const sh = [16, 12 + q.oy], hip = [16, 21 + q.oy];
  const at = (o: number[], a: number, len: number) => [o[0] + Math.sin((a * Math.PI) / 180) * len, o[1] + Math.cos((a * Math.PI) / 180) * len];
  const limb = (o: number[], [a, b]: [number, number], l1: number, l2: number) => {
    const m = at(o, a, l1), e = at(m, b, l2);
    return `${o[0]},${o[1]} ${m[0].toFixed(1)},${m[1].toFixed(1)} ${e[0].toFixed(1)},${e[1].toFixed(1)}`;
  };
  return (
    <svg className="br-wheel__ic" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="16" cy={7.5 + q.oy} r="3" />
      <polyline points={`16,${10.5 + q.oy} ${hip[0]},${hip[1]}`} />
      <polyline points={limb(sh, q.l, 6, 5.5)} />
      <polyline points={limb(sh, q.r, 6, 5.5)} />
      <polyline points={limb(hip, q.ll, 6.5, 6.5)} />
      <polyline points={limb(hip, q.rl, 6.5, 6.5)} />
    </svg>
  );
}
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
              <EmoteIcon name={d.name} />
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
