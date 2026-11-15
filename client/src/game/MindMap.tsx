import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type ReactNode, type WheelEvent as RWE } from 'react';
import { ACHIEVEMENTS, BRANCHES, COSMETICS, EMOTE_DEFS, STAT_LABEL, type AchievementDef, type StatKey } from '@backrooms/shared';
import { DoorOpen, Package, Heart, Swords, Waves, type LucideIcon } from 'lucide-react';
import { ic } from './ic';

/*
 * Los logros como mapa mental: en el centro, el jugador; de él salen las ramas (ESCAPE, COLLECT…) y de cada rama, sus logros encadenados
 * (`from`) hacia fuera. Lo ganado va lleno, lo siguiente alcanzable late y lo demás queda apagado. El mapa es mucho más grande que la vista y se
 * arrastra (también con la rueda). Con `panel`, un clic en un nodo abre a un lado cómo se consigue y qué % de jugadores lo tiene; sin él (el perfil
 * propio o de un amigo) los nodos solo se ven.
 */

const GLYPH: Record<string, LucideIcon> = { ESCAPE: DoorOpen, COLLECT: Package, SURVIVE: Heart, COMBAT: Swords, DEPTHS: Waves };
const Glyph = ({ b }: { b: string }) => { const I = GLYPH[b] ?? Package; return <I {...ic} />; };
const R = [0.12, 0.23, 0.33, 0.42]; // radio (0–1 del mapa) de la etiqueta de la rama y de cada nivel de logros
const slot = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;

/** Dónde cae cada nodo: la rama reparte su sector (en grados) entre sus hojas, y cada logro cuelga del que lo precede. */
function layout() {
  const pos: Record<string, { x: number; y: number }> = {}, lab: Record<string, { x: number; y: number }> = {};
  const at = (deg: number, r: number) => ({ x: 50 + Math.cos((deg * Math.PI) / 180) * r * 100 * 0.95, y: 50 + Math.sin((deg * Math.PI) / 180) * r * 100 * 0.85 });
  BRANCHES.forEach((b, i) => {
    const mid = -90 + (360 / BRANCHES.length) * i, span = (360 / BRANCHES.length) * 0.9, list = ACHIEVEMENTS.filter((a) => a.branch === b);
    lab[b] = at(mid, R[0]);
    const kids = (k?: string) => list.filter((a) => (a.from ?? undefined) === k);
    const leaves = (a: AchievementDef): number => Math.max(1, kids(a.key).reduce((n, c) => n + leaves(c), 0));
    const place = (nodes: AchievementDef[], from: number, to: number, depth: number) => {
      const total = nodes.reduce((n, a) => n + leaves(a), 0);
      let cur = from;
      for (const a of nodes) {
        const w = ((to - from) * leaves(a)) / total;
        pos[a.key] = at(cur + w / 2, R[Math.min(depth + 1, R.length - 1)]);
        place(kids(a.key), cur, cur + w, depth + 1);
        cur += w;
      }
    };
    place(kids(undefined), mid - span / 2, mid + span / 2, 0);
  });
  return { pos, lab };
}
const L = layout();

export function MindMap({ name, center, have, stats, rarity, dim, panel }: { name: string; center: ReactNode; have: Record<string, number>; stats?: Partial<Record<StatKey, number>>; rarity?: Record<string, number>; dim?: string; panel?: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const reach = useMemo(() => new Set(ACHIEVEMENTS.filter((a) => !(a.key in have) && (!a.from || a.from in have)).map((a) => a.key)), [have]);
  const shown = panel ? ACHIEVEMENTS.find((a) => a.key === sel) : undefined;
  const n = shown?.stat ? stats?.[shown.stat] ?? 0 : 0, on = !!shown && shown.key in have;
  const reward = shown ? [...COSMETICS.filter((c) => c.need === shown.key).map((c) => `${c.name} ${slot[c.slot]}`), ...EMOTE_DEFS.filter((e) => e.need === shown.key).map((e) => `${e.name} EMOTE`)] : [];
  const off = (b: string) => !!dim && dim !== 'ALL' && dim !== b;

  // el arrastre mueve el mapa (translate), sin salirse; un arrastre no cuenta como clic
  const view = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null);
  const pan = useRef({ x: 0, y: 0, z: 1, d: null as null | { px: number; py: number; x0: number; y0: number }, moved: false });
  const [zoom, setZoom] = useState(1);
  const apply = (smooth = false) => {
    const w = world.current;
    if (!w) return;
    w.style.transition = smooth ? 'transform 0.35s ease' : 'none';
    w.style.transform = `translate(${pan.current.x}px, ${pan.current.y}px) scale(${pan.current.z})`;
  };
  const setPan = (x: number, y: number, smooth = false) => {
    const v = view.current, w = world.current;
    if (!v || !w) return;
    const lim = (vs: number, ws: number, p: number) => (ws <= vs ? (vs - ws) / 2 : Math.max(vs - ws, Math.min(0, p)));
    pan.current.x = lim(v.clientWidth, w.offsetWidth * pan.current.z, x);
    pan.current.y = lim(v.clientHeight, w.offsetHeight * pan.current.z, y);
    apply(smooth);
  };
  /** Cambia el zoom (0,35–2) manteniendo quieto el punto (cx, cy) de la vista (el centro, con los botones). */
  const zoomTo = (z: number, cx = (view.current?.clientWidth ?? 0) / 2, cy = (view.current?.clientHeight ?? 0) / 2, smooth = false) => {
    const p = pan.current, nz = Math.max(0.35, Math.min(2, z)), k = nz / p.z;
    p.z = nz;
    setZoom(nz);
    setPan(cx - (cx - p.x) * k, cy - (cy - p.y) * k, smooth);
  };
  const centerOn = (px: number, py: number, smooth = false) => setPan((view.current?.clientWidth ?? 0) / 2 - ((world.current?.offsetWidth ?? 0) * pan.current.z * px) / 100, (view.current?.clientHeight ?? 0) / 2 - ((world.current?.offsetHeight ?? 0) * pan.current.z * py) / 100, smooth);
  // al abrir (y al cambiar de rama) la vista se centra: en el jugador, o en la rama elegida
  useEffect(() => {
    const ps = dim && dim !== 'ALL' ? ACHIEVEMENTS.filter((a) => a.branch === dim).map((a) => L.pos[a.key]) : [{ x: 50, y: 50 }];
    centerOn(ps.reduce((s, p) => s + p.x, 0) / ps.length, ps.reduce((s, p) => s + p.y, 0) / ps.length, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim]);
  const wheel = (e: RWE) => {
    const r = view.current!.getBoundingClientRect();
    zoomTo(pan.current.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
  };
  const down = (e: RPE) => (pan.current.d = { px: e.clientX, py: e.clientY, x0: pan.current.x, y0: pan.current.y });
  const drag = (e: RPE) => {
    const d = pan.current.d;
    if (!d) return;
    if (!pan.current.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) > 5) ((pan.current.moved = true), view.current?.setPointerCapture(e.pointerId));
    if (pan.current.moved) setPan(d.x0 + e.clientX - d.px, d.y0 + e.clientY - d.py);
  };
  const release = () => (pan.current.d = null);

  return (
    <div className="mm" data-panel={!!shown || undefined}>
      <div
        className="mm__view"
        ref={view}
        onPointerDown={down}
        onPointerMove={drag}
        onPointerUp={release}
        onPointerCancel={release}
        onClickCapture={(e) => pan.current.moved && (e.stopPropagation(), e.preventDefault(), (pan.current.moved = false))}
        onClick={(e) => !(e.target as HTMLElement).closest('.mm__node') && setSel(null)}
        onWheel={wheel}
      >
        <div className="mm__world" ref={world}>
          <svg className="mm__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {BRANCHES.map((b) => (
              <line key={b} x1="50" y1="50" x2={L.lab[b].x} y2={L.lab[b].y} data-lit={ACHIEVEMENTS.some((a) => a.branch === b && a.key in have) || undefined} data-off={off(b) || undefined} />
            ))}
            {ACHIEVEMENTS.map((a) => {
              const p = a.from ? L.pos[a.from] : L.lab[a.branch], q = L.pos[a.key];
              return <line key={a.key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} data-lit={(a.key in have && (!a.from || a.from in have)) || undefined} data-off={off(a.branch) || undefined} />;
            })}
          </svg>
          <div className="mm__center" aria-label={name}>
            {center}
            <span>{name}</span>
            <small>{Object.keys(have).length}/{ACHIEVEMENTS.length}</small>
          </div>
          {BRANCHES.map((b) => (
            <span key={b} className="mm__branch" data-off={off(b) || undefined} style={{ left: `${L.lab[b].x}%`, top: `${L.lab[b].y}%` }}>
              <Glyph b={b} /> {b}
              <small>{ACHIEVEMENTS.filter((a) => a.branch === b && a.key in have).length}/{ACHIEVEMENTS.filter((a) => a.branch === b).length}</small>
            </span>
          ))}
          {ACHIEVEMENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              className="mm__node"
              data-on={a.key in have || undefined}
              data-next={reach.has(a.key) || undefined}
              data-off={off(a.branch) || undefined}
              aria-pressed={sel === a.key}
              title={panel ? undefined : a.name}
              style={{ left: `${L.pos[a.key].x}%`, top: `${L.pos[a.key].y}%` }}
              onClick={() => panel && setSel(a.key)}
            >
              <b aria-hidden="true"><Glyph b={a.branch} /></b>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      </div>
      <span className="mm__zoom">
        <button type="button" className="br-opt" aria-label="Zoom out" onClick={() => zoomTo(pan.current.z / 1.25, undefined, undefined, true)}>−</button>
        <small>{Math.round(zoom * 100)}%</small>
        <button type="button" className="br-opt" aria-label="Zoom in" onClick={() => zoomTo(pan.current.z * 1.25, undefined, undefined, true)}>+</button>
        <button type="button" className="br-opt" aria-label="Reset view" onClick={() => (zoomTo(1, undefined, undefined, true), centerOn(50, 50, true))}>⌂</button>
      </span>
      {shown && (
        <aside className="mm__side" aria-live="polite">
          <button type="button" className="br-opt mm__x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          <p className="mm__cn">{shown.name}</p>
          <p className="mm__cs">{on ? `■ UNLOCKED ${new Date(have[shown.key]).toLocaleDateString()}` : '□ LOCKED'}</p>
          <p className="mm__h">HOW TO GET IT</p>
          <p>{shown.desc}</p>
          {shown.from && !(shown.from in have) && <p className="br-lobby__dim">FIRST: {ACHIEVEMENTS.find((a) => a.key === shown.from)?.name}</p>}
          {shown.stat && shown.goal && stats && <p className="br-lobby__dim">PROGRESS: {on ? shown.goal : Math.min(n, shown.goal)} / {shown.goal} {STAT_LABEL[shown.stat]}</p>}
          <p className="mm__h">PLAYERS WHO HAVE IT</p>
          <p className="mm__pc">{rarity ? `${rarity[shown.key] ?? 0}%` : '—'}</p>
          {reward.length > 0 && (
            <>
              <p className="mm__h">REWARD</p>
              <p>{reward.join(', ')}</p>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
