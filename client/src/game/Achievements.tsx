import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ACHIEVEMENTS, BRANCHES, COSMETICS, EMOTE_DEFS, STAT_LABEL, type AchievementDef } from '@backrooms/shared';
import { type Account } from '../account';
import { list as localAchievements, markImported } from '../achievements';
import Frame from './Frame';
import './achievements.css';

/*
 * Los logros como constelaciones: una por categoría, con sus estrellas unidas por líneas; las que aún no se tienen están apagadas
 * y la siguiente alcanzable de cada una parpadea. A un lado, el detalle de la estrella elegida (progreso, recompensas, rareza).
 * Teclado: las flechas saltan a la estrella más cercana en esa dirección. Marco con pestañas: ALL o una sola constelación (el resto se apaga).
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

// el fondo: estrellitas fijas (no cambian entre pintados)
const DUST = (() => {
  let s = 7;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 110 }, () => ({ x: r() * 100, y: r() * 100, o: 0.15 + r() * 0.35, k: r() * 0.35 + 0.1 }));
})();

const Lock = () => (
  <svg className="ach__lock" viewBox="0 0 12 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="1.5" y="6" width="9" height="7" fill="currentColor" stroke="none" />
    <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

export function AchievementsScreen({ acct, onSignIn, onBack }: { acct: Account; onSignIn: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('ALL');
  const [sel, setSel] = useState(ACHIEVEMENTS[0].key);
  const [local, setLocal] = useState(localAchievements);
  const [err, setErr] = useState('');
  const sky = useRef<HTMLDivElement>(null);
  const me = acct.me;
  const have = me?.achievements ?? {};
  const shown = ACHIEVEMENTS.find((a) => a.key === sel) ?? ACHIEVEMENTS[0];

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
    setSel(best.key);
    requestAnimationFrame(() => sky.current?.querySelector<HTMLElement>(`[data-key="${best!.key}"]`)?.focus());
  };

  const on = shown.key in have;
  const n = shown.stat ? me?.stats[shown.stat] ?? 0 : 0;
  const reward = COSMETICS.filter((c) => c.need === shown.key).map((c) => `${c.name} ${slotName[c.slot]}`);
  const emotes = EMOTE_DEFS.filter((e) => e.need === shown.key).map((e) => `${e.name} EMOTE`);
  const rare = me && (me.rarity?.[shown.key] ?? 0);
  const done = Object.keys(have).length;
  const dim = (b: string) => tab !== 'ALL' && tab !== b;

  return (
    <Frame title="ACHIEVEMENTS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
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
          <div className="ach__sky" ref={sky} role="tabpanel" aria-label={tab}>
            <svg className="ach__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {DUST.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={d.k} fill="currentColor" opacity={d.o} />
              ))}
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
                    aria-pressed={shown.key === a.key}
                    aria-label={`${a.name}, ${got ? 'unlocked' : 'locked'}`}
                    tabIndex={shown.key === a.key ? 0 : -1}
                    onFocus={() => setSel(a.key)}
                    onMouseEnter={() => setSel(a.key)}
                    onClick={() => setSel(a.key)}
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
        <aside className="ach__det" aria-live="polite" aria-label="Achievement detail">
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
      </div>
    </Frame>
  );
}
