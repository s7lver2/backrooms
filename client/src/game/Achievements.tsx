import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPE } from 'react';
import { ACHIEVEMENTS, BRANCHES, COSMETICS, EMOTE_DEFS, STAT_LABEL, type AchievementDef } from '@backrooms/shared';
import { type Account } from '../account';
import { list as localAchievements, markImported } from '../achievements';
import Frame from './Frame';
import './achievements.css';

/*
 * Los logros como constelaciones: una por categoría, con sus estrellas unidas por líneas; las que aún no se tienen están apagadas
 * y la siguiente alcanzable de cada una parpadea. A un lado, el detalle de la estrella elegida (progreso, recompensas, rareza).
 * El cielo es más grande que la vista y se arrastra (como el árbol de mejoras); la ficha de la estrella flota encima y solo está cuando se elige una.
 * Teclado: las flechas saltan a la estrella más cercana en esa dirección. Marco con pestañas: ALL o una sola constelación (el resto se apaga y se centra).
 */

// dónde cae cada estrella (% del cielo, 100 × 64) y el rótulo de cada constelación
const POS: Record<string, [number, number]> = {
  first_escape: [9, 30], escape_5: [21, 17], escape_25: [34, 10], team_player: [23, 31], survivor: [36, 25], full_house: [36, 41], lone_wolf: [14, 45],
  first_tape: [60, 30], tape_hoarder: [71, 17], archivist: [84, 10], photographer: [73, 31], paparazzi: [87, 26], locksmith: [68, 45], safecracker: [83, 43],
  first_night: [9, 76], night_owl: [21, 66], veteran: [34, 62], second_chance: [35, 76], held_breath: [19, 86], stone_lungs: [32, 91], pit_fall: [12, 91], gravity: [24, 97],
  idiot: [62, 76], trigger_happy: [73, 66], hunter: [85, 72], exterminator: [92, 88],
  deep_end: [50, 70], no_u: [45, 88], caffeinated: [56, 88],
};
const TITLE: Record<string, [number, number]> = { ESCAPE: [3, 5], COLLECT: [55, 5], SURVIVE: [3, 55], COMBAT: [64, 55], DEPTHS: [44, 58] };
const slotName = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;
const TABS = ['ALL', ...BRANCHES] as const;
const ICON: Record<string, string> = { first_escape: '▲', tape_hoarder: '▣', photographer: '◉', held_breath: '○', team_player: '♣', survivor: '♥', pit_fall: '▼', trigger_happy: '◆', night_owl: '☼', idiot: '☺' };
const glyph = (k: string) => ICON[k] ?? '✦';

const Lock = () => (
  <svg className="ach__lock" viewBox="0 0 12 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="1.5" y="6" width="9" height="7" fill="currentColor" stroke="none" />
    <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

export function AchievementsScreen({ acct, onSignIn, onBack }: { acct: Account; onSignIn: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('ALL');
  const [sel, setSel] = useState<string | null>(null); // la estrella con la ficha abierta (null: cerrada)
  const [local, setLocal] = useState(localAchievements);
  const [err, setErr] = useState('');
  const me = acct.me;
  const have = me?.achievements ?? {};
  const shown = ACHIEVEMENTS.find((a) => a.key === sel) ?? ACHIEVEMENTS[0];
  const view = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null);
  const pan = useRef({ x: 0, y: 0, d: null as null | { px: number; py: number; x0: number; y0: number }, moved: false });
  // el arrastre mueve el mundo (translate), sin salirse; un arrastre no cuenta como clic
  const setPan = (x: number, y: number, smooth = false) => {
    const v = view.current, w = world.current;
    if (!v || !w) return;
    pan.current.x = Math.max(Math.min(0, v.clientWidth - w.offsetWidth), Math.min(0, x));
    pan.current.y = Math.max(Math.min(0, v.clientHeight - w.offsetHeight), Math.min(0, y));
    w.style.transition = smooth ? 'transform 0.4s ease' : 'none';
    w.style.transform = `translate(${pan.current.x}px, ${pan.current.y}px)`;
  };
  const centerOn = (x: number, y: number) => setPan((view.current?.clientWidth ?? 0) / 2 - ((world.current?.offsetWidth ?? 0) * x) / 100, (view.current?.clientHeight ?? 0) / 2 - ((world.current?.offsetHeight ?? 0) * y) / 100, true);
  const goTab = (t: (typeof TABS)[number]) => {
    setTab(t);
    const ps = t === 'ALL' ? [[50, 50]] : ACHIEVEMENTS.filter((a) => a.branch === t).map((a) => POS[a.key]);
    centerOn(ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length);
  };
  const reveal = (key: string) => {
    const v = view.current, w = world.current;
    if (!v || !w) return;
    const x = (w.offsetWidth * POS[key][0]) / 100 + pan.current.x, y = (w.offsetHeight * POS[key][1]) / 100 + pan.current.y, m = 70;
    if (x < m || y < m || x > v.clientWidth - m || y > v.clientHeight - m) centerOn(POS[key][0], POS[key][1]);
  };
  const down = (e: RPE) => (pan.current.d = { px: e.clientX, py: e.clientY, x0: pan.current.x, y0: pan.current.y });
  const drag = (e: RPE) => {
    const d = pan.current.d;
    if (!d) return;
    if (!pan.current.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) > 5) ((pan.current.moved = true), view.current?.setPointerCapture(e.pointerId));
    if (pan.current.moved) setPan(d.x0 + e.clientX - d.px, d.y0 + e.clientY - d.py);
  };
  const release = () => (pan.current.d = null);

  const importLocal = async () => {
    try {
      await acct.importLegacy(local);
      markImported();
      setLocal([]);
    } catch (e) {
      setErr(String((e as Error)?.message ?? 'SOMETHING WENT WRONG').toUpperCase());
    }
  };
  // la siguiente alcanzable de cada constelación: sin ganar y con la estrella de la que cuelga ya ganada (o sin ella)
  const reach = useMemo(() => new Set(ACHIEVEMENTS.filter((a) => !(a.key in have) && (!a.from || a.from in have)).map((a) => a.key)), [have]);
  const lines = ACHIEVEMENTS.filter((a) => a.from);
  // al abrir, la vista se centra en la siguiente estrella alcanzable (o en el cielo entero)
  useEffect(() => {
    const k = ACHIEVEMENTS.find((a) => reach.has(a.key))?.key;
    if (k) centerOn(POS[k][0], POS[k][1]);
    else centerOn(50, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const move = (e: KeyboardEvent, a: AchievementDef) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    const [x, y] = POS[a.key];
    let best: AchievementDef | undefined, bd = Infinity;
    for (const b of ACHIEVEMENTS) {
      if (b === a || !POS[b.key]) continue;
      const dx = POS[b.key][0] - x, dy = POS[b.key][1] - y, along = dx * d[0] + dy * d[1], off = Math.abs(dx * d[1]) + Math.abs(dy * d[0]);
      if (along <= 0 || off > along * 1.6) continue;
      const dist = along + off * 0.7;
      if (dist < bd) (bd = dist), (best = b);
    }
    if (!best) return;
    e.preventDefault();
    if (sel) setSel(best.key); // con la ficha abierta, sigue a la estrella
    reveal(best.key);
    requestAnimationFrame(() => view.current?.querySelector<HTMLElement>(`[data-key="${best!.key}"]`)?.focus({ preventScroll: true }));
  };

  const on = shown.key in have;
  const n = shown.stat ? me?.stats[shown.stat] ?? 0 : 0;
  const reward = COSMETICS.filter((c) => c.need === shown.key).map((c) => `${c.name} ${slotName[c.slot]}`);
  const emotes = EMOTE_DEFS.filter((e) => e.need === shown.key).map((e) => `${e.name} EMOTE`);
  const rare = me && (me.rarity?.[shown.key] ?? 0);
  const done = Object.keys(have).length;
  const dim = (b: string) => tab !== 'ALL' && tab !== b;

  return (
    <Frame title="ACHIEVEMENTS" tabs={TABS} tab={tab} onTab={goTab} onBack={onBack}>
      <div className="ach">
        <div className="ach__main">
          <p className="ach__sum">
            {me ? `${done}/${ACHIEVEMENTS.length} STARS LIT` : 'GUEST'}
            {!me && (
              <>
                {' · '}SIGN IN TO SAVE PROGRESS
                <button type="button" className="br-opt" onClick={onSignIn}>SIGN IN</button>
              </>
            )}
            {me && local.length > 0 && (
              <button type="button" className="br-opt" onClick={importLocal}>IMPORT {local.length} FROM THIS BROWSER</button>
            )}
          </p>
          {err && <p className="br-lobby__err" role="alert">{err}</p>}
          <div className="ach__view" onKeyDown={(e) => e.key === 'Escape' && sel && (e.stopPropagation(), setSel(null))}>
          <div
            className="ach__sky"
            ref={view}
            role="tabpanel"
            aria-label={tab}
            onPointerDown={down}
            onPointerMove={drag}
            onPointerUp={release}
            onPointerCancel={release}
            onClickCapture={(e) => pan.current.moved && (e.stopPropagation(), e.preventDefault(), (pan.current.moved = false))}
            onClick={(e) => !(e.target as HTMLElement).closest('.ach__st') && setSel(null)}
            onWheel={(e) => setPan(pan.current.x - e.deltaX, pan.current.y - e.deltaY)}
          >
          <div className="ach__world" ref={world}>
            <svg className="ach__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {lines.map((a) => {
                const [x1, y1] = POS[a.from!], [x2, y2] = POS[a.key], lit = a.key in have && a.from! in have;
                return <line key={a.key} x1={x1} y1={y1} x2={x2} y2={y2} data-lit={lit || undefined} data-half={(a.from! in have && !lit) || undefined} data-dim={dim(a.branch) || undefined} />;
              })}
            </svg>
            {BRANCHES.map((b) => (
              <h2 key={b} className="ach__bn" data-dim={dim(b) || undefined} style={{ left: `${TITLE[b][0]}%`, top: `${TITLE[b][1]}%` }}>
                {b}
              </h2>
            ))}
            {ACHIEVEMENTS.map((a) => {
              const got = a.key in have;
              return (
                <div key={a.key} className="ach__st" data-dim={dim(a.branch) || undefined} style={{ left: `${POS[a.key][0]}%`, top: `${POS[a.key][1]}%` } as CSSProperties}>
                  <button
                    type="button"
                    className="ach__node"
                    data-key={a.key}
                    data-on={got || undefined}
                    data-next={(!got && reach.has(a.key)) || undefined}
                    aria-pressed={sel === a.key}
                    aria-label={`${a.name}, ${got ? 'unlocked' : 'locked'}`}
                    tabIndex={shown.key === a.key ? 0 : -1}
                    onClick={() => (setSel(a.key), reveal(a.key))}
                    onKeyDown={(e) => move(e, a)}
                  >
                    <span aria-hidden="true">{glyph(a.key)}</span>
                  </button>
                  <span className="ach__nm" data-on={got || undefined}>{a.name}</span>
                </div>
              );
            })}
          </div>
          </div>
          {!sel && <p className="ach__hint">DRAG TO MOVE · CLICK A STAR</p>}
        {sel && (
        <aside className="ach__det" aria-live="polite" aria-label="Achievement detail" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <button type="button" className="br-opt ach__x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          <div className="ach__big" data-on={on || undefined} aria-hidden="true">
            {glyph(shown.key)}
            {!on && <Lock />}
          </div>
          <p className="ach__dn">{shown.name}</p>
          <p className="br-lobby__dim">{shown.desc}</p>
          {shown.stat && shown.goal ? (
            <div className="ach__prog">
              <div className="ach__meter" role="img" aria-label={`progress ${Math.min(n, shown.goal)} of ${shown.goal}`}>
                <i style={{ width: `${Math.round((Math.min(me ? (on ? shown.goal : n) : 0, shown.goal) / shown.goal) * 100)}%` }} />
              </div>
              <p className="br-lobby__dim">{me ? `${on ? shown.goal : Math.min(n, shown.goal)} / ${shown.goal} ${STAT_LABEL[shown.stat]}` : 'SIGN IN TO TRACK PROGRESS'}</p>
            </div>
          ) : (
            <p className="br-lobby__dim">{on ? 'COMPLETE' : 'ONE-OFF · NO COUNTER'}</p>
          )}
          <dl className="ach__facts">
            <dt>STATUS</dt>
            <dd>{on ? `UNLOCKED ${new Date(have[shown.key]).toLocaleDateString()}` : 'LOCKED'}</dd>
            <dt>REWARD</dt>
            <dd>{[...reward, ...emotes].join(', ') || '—'}</dd>
            <dt>RARITY</dt>
            <dd>{rare == null ? '—' : `${rare}% OF PLAYERS`}</dd>
          </dl>
        </aside>
        )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
