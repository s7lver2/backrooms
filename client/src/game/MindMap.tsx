import { useMemo, useState, type ReactNode } from 'react';
import { ACHIEVEMENTS, BRANCHES, COSMETICS, EMOTE_DEFS, STAT_LABEL, type AchievementDef, type StatKey } from '@backrooms/shared';

/*
 * Los logros como mapa mental: en el centro, el jugador; de él salen las ramas (ESCAPE, COLLECT…) y de cada rama, sus logros encadenados
 * (`from`) hacia fuera. Lo ganado va lleno, lo siguiente alcanzable late y lo demás queda apagado. Un clic en un nodo enseña su ficha.
 * Sirve para el perfil propio y para el de otro jugador (basta con darle sus logros y contadores).
 */

const GLYPH: Record<string, string> = { ESCAPE: '▲', COLLECT: '▣', SURVIVE: '♥', COMBAT: '◆', DEPTHS: '≋' };
const R = [0.19, 0.31, 0.42, 0.53]; // radio (0–1) de la etiqueta de la rama y de cada nivel de logros
const slot = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;

/** Dónde cae cada nodo: la rama reparte su sector (en grados) entre sus hojas, y cada logro cuelga del que lo precede. */
function layout() {
  const pos: Record<string, { x: number; y: number }> = {}, lab: Record<string, { x: number; y: number }> = {};
  const at = (deg: number, r: number) => ({ x: 50 + Math.cos((deg * Math.PI) / 180) * r * 100 * 0.92, y: 50 + Math.sin((deg * Math.PI) / 180) * r * 100 * 0.8 });
  BRANCHES.forEach((b, i) => {
    const mid = -90 + (360 / BRANCHES.length) * i, span = (360 / BRANCHES.length) * 0.86, list = ACHIEVEMENTS.filter((a) => a.branch === b);
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

export function MindMap({ name, center, have, stats, rarity, dim }: { name: string; center: ReactNode; have: Record<string, number>; stats?: Partial<Record<StatKey, number>>; rarity?: Record<string, number>; dim?: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const reach = useMemo(() => new Set(ACHIEVEMENTS.filter((a) => !(a.key in have) && (!a.from || a.from in have)).map((a) => a.key)), [have]);
  const shown = ACHIEVEMENTS.find((a) => a.key === sel);
  const n = shown?.stat ? stats?.[shown.stat] ?? 0 : 0, on = !!shown && shown.key in have;
  const reward = shown ? [...COSMETICS.filter((c) => c.need === shown.key).map((c) => `${c.name} ${slot[c.slot]}`), ...EMOTE_DEFS.filter((e) => e.need === shown.key).map((e) => `${e.name} EMOTE`)] : [];
  const off = (b: string) => !!dim && dim !== 'ALL' && dim !== b;
  return (
    <div className="mm" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
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
          {GLYPH[b]} {b}
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
          style={{ left: `${L.pos[a.key].x}%`, top: `${L.pos[a.key].y}%` }}
          onClick={() => setSel(a.key)}
        >
          <b aria-hidden="true">{GLYPH[a.branch]}</b>
          <span>{a.name}</span>
        </button>
      ))}
      {shown && (
        <aside className="mm__card" aria-live="polite">
          <button type="button" className="br-opt mm__x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          <p className="mm__cn">{shown.name}</p>
          <p className="mm__cs">{on ? `■ UNLOCKED ${new Date(have[shown.key]).toLocaleDateString()}` : '□ LOCKED'}</p>
          <p>{shown.desc}</p>
          {shown.stat && shown.goal && stats && <p className="br-lobby__dim">{on ? shown.goal : Math.min(n, shown.goal)} / {shown.goal} {STAT_LABEL[shown.stat]}</p>}
          {reward.length > 0 && <p className="br-lobby__dim">REWARD: {reward.join(', ')}</p>}
          {rarity && <p className="br-lobby__dim">{rarity[shown.key] ?? 0}% OF PLAYERS</p>}
        </aside>
      )}
    </div>
  );
}
