import { useEffect, useRef, useState } from 'react';
import { ITEMS, lootPrice, rarity, type LockerItem } from '@backrooms/shared';
import type { Sock } from '../net';
import type { Assets } from './game';
import { sound } from './audio';
import { gearIcons } from './invIcons';
import { lootIcon } from './rarityFx';

/*
 * Una taquilla: primero el minijuego de la cerradura (la aguja de la ganzúa da vueltas; hay una zona naranja y se pulsa ESPACIO, o un clic, cuando la
 * punta pasa por ella; 3 aciertos, cada vez más rápido y con la zona más estrecha; un fallo quita un acierto) y, al abrirla, lo que hay dentro
 * (lo pide al servidor con `locker`; cada pieza se coge con `lockerTake`). Escape cierra.
 */

const HITS = 3;
const SPEED = [150, 210, 280]; // grados por segundo en cada intento
const WIDTH = [52, 40, 30]; // anchura de la zona naranja (grados)
const hex = (r: number) => '#' + rarity(r).color.toString(16).padStart(6, '0');
const pt = (deg: number, rad: number) => [50 + Math.sin((deg * Math.PI) / 180) * rad, 50 - Math.cos((deg * Math.PI) / 180) * rad];
const arc = (a: number, b: number, rad: number) => {
  const [x0, y0] = pt(a, rad), [x1, y1] = pt(b, rad);
  return `M${x0} ${y0}A${rad} ${rad} 0 ${b - a > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

export default function LockerGame({ id, sock, assets, onTake, onClose }: { id: string; sock?: Sock; assets?: Assets; onTake: (it: LockerItem) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<'pick' | 'loot'>('pick');
  const [hits, setHits] = useState(0);
  const [bad, setBad] = useState(false);
  const [ok, setOk] = useState(false);
  const [angle, setAngle] = useState(0);
  const [zone, setZone] = useState(120);
  const [items, setItems] = useState<LockerItem[]>([]);
  const [taken, setTaken] = useState<boolean[]>([]);
  const [msg, setMsg] = useState('');
  const g = useRef({ a: 0, hits: 0, zone: 120, last: 0, lock: 0 });
  const icons = assets ? gearIcons(assets) : undefined;

  // la aguja
  useEffect(() => {
    if (phase !== 'pick') return;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = g.current, dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 0;
      s.last = now;
      s.a = (s.a + SPEED[Math.min(s.hits, HITS - 1)] * dt) % 360;
      setAngle(s.a);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const open = () =>
    sock?.emit('locker', id, (r) => {
      if (!r.ok || !r.items) return setMsg('TOO FAR, OR IT IS STUCK'), setPhase('loot');
      setItems(r.items);
      setTaken(r.taken ?? r.items.map(() => false));
      setPhase('loot');
      sound('upgrade');
    });
  // abrir de una si ya la abrió alguien (el servidor devuelve lo que queda): se prueba al montar sin jugar? no: siempre se juega la primera vez
  const press = () => {
    const s = g.current;
    if (phase !== 'pick' || performance.now() < s.lock) return;
    const w = WIDTH[Math.min(s.hits, HITS - 1)], d = Math.abs(((s.a - s.zone + 540) % 360) - 180);
    if (d <= w / 2) {
      s.hits++;
      s.zone = 30 + Math.random() * 300;
      setHits(s.hits);
      setZone(s.zone);
      sound('buy');
      setOk(true);
      setTimeout(() => setOk(false), 260);
      if (s.hits >= HITS) open();
    } else {
      s.hits = Math.max(0, s.hits - 1);
      setHits(s.hits);
      s.lock = performance.now() + 350; // un fallo bloquea la cerradura un momento
      setBad(true);
      setTimeout(() => setBad(false), 350);
      sound('denied');
    }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return e.preventDefault(), e.stopImmediatePropagation(), onClose();
      if (e.code === 'Space') return e.preventDefault(), e.stopImmediatePropagation(), press();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  });

  const take = (i: number) =>
    sock?.emit('lockerTake', id, i, (ok) => {
      if (!ok) return setMsg('NO SPACE IN THE BACKPACK');
      sound('equip');
      setMsg('');
      setTaken((t) => t.map((x, k) => x || k === i));
      onTake(items[i]);
    });

  const w = WIDTH[Math.min(hits, HITS - 1)];
  return (
    <div className="br-modal br-locker" role="dialog" aria-label="Locker" data-bad={bad || undefined}>
      {phase === 'pick' ? (
        <div className="br-locker__box" onPointerDown={press}>
          <p className="br-locker__t">LOCKED · {hits}/{HITS}</p>
          <svg viewBox="0 0 100 100" className="br-locker__dial" data-ok={ok || undefined} aria-hidden="true">
            <defs>
              <radialGradient id="lk-metal" cx="50%" cy="38%" r="70%">
                <stop offset="0" stopColor="#4b4a42" />
                <stop offset="0.55" stopColor="#25241f" />
                <stop offset="1" stopColor="#0d0c0a" />
              </radialGradient>
              <linearGradient id="lk-trail" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#ffe9a8" stopOpacity="0" />
                <stop offset="1" stopColor="#ffe9a8" stopOpacity="0.35" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="49" fill="url(#lk-metal)" className="br-locker__ring" />
            {[45, 135, 225, 315].map((d) => {
              const [x, y] = pt(d, 45.5);
              return <circle key={d} cx={x} cy={y} r="1.4" className="br-locker__bolt" />;
            })}
            <circle cx="50" cy="50" r="38" className="br-locker__face" />
            <path d={arc(zone - w / 2, zone + w / 2, 41)} className="br-locker__zone" />
            <path d={arc(zone - w / 2, zone + w / 2, 41)} className="br-locker__zone br-locker__zone--hot" />
            {Array.from({ length: 60 }, (_, i) => {
              const big = i % 5 === 0, [x0, y0] = pt(i * 6, big ? 33 : 35.5), [x1, y1] = pt(i * 6, 38);
              return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={big ? 'br-locker__tick br-locker__tick--big' : 'br-locker__tick'} />;
            })}
            <path d={`M50 50L${pt(angle - 38, 36).join(' ')}A36 36 0 0 1 ${pt(angle, 36).join(' ')}Z`} className="br-locker__trail" />
            <g transform={`rotate(${angle} 50 50)`}>
              <polygon points="49.2,54 50.8,54 50.4,12 49.6,12" className="br-locker__needle" />
              <circle cx="50" cy="11.5" r="1.6" className="br-locker__tip" />
            </g>
            <circle cx="50" cy="50" r="6" className="br-locker__hub" />
            <circle cx="50" cy="50" r="2" className="br-locker__hub2" />
          </svg>
          <p className="br-lobby__dim">SPACE WHEN THE TIP CROSSES THE ORANGE</p>
          <p className="br-locker__pips" aria-label={`${hits} of ${HITS}`}>{Array.from({ length: HITS }, (_, i) => <i key={i} data-on={i < hits || undefined} />)}</p>
          <button type="button" className="br-opt" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>LEAVE [ESC]</button>
        </div>
      ) : (
        <div className="br-locker__box">
          <p className="br-locker__t">OPEN</p>
          <ul className="br-locker__items">
            {items.map((it, i) => (
              <li key={i} data-taken={taken[i] || undefined} style={{ '--rar': hex(it.r) } as React.CSSProperties}>
                <img src={it.kind === 'loot' ? lootIcon(it.r) : icons?.[it.kind as keyof typeof icons]} alt="" draggable={false} />
                <span>
                  <b>{rarity(it.r).name}</b> {it.kind === 'loot' ? 'ARTIFACT' : ITEMS[it.kind].name}
                  {it.kind === 'loot' && <span className="br-lobby__dim"> · SELLS ${lootPrice({ r: it.r, w: 0 })}</span>}
                </span>
                <button type="button" className="br-opt" disabled={taken[i]} onClick={() => take(i)}>{taken[i] ? 'TAKEN' : 'TAKE'}</button>
              </li>
            ))}
          </ul>
          {msg && <p className="br-lobby__err" role="alert">{msg}</p>}
          <button type="button" className="br-opt" onClick={onClose}>CLOSE [ESC]</button>
        </div>
      )}
    </div>
  );
}
