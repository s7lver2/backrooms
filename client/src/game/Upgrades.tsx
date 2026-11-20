import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { ITEMS, ITEM_IDS, LEVELS, UPGRADES, UP_IDS, boughtBefore, upCost, upLevel, type ItemId, type UpId, type Ups } from '@backrooms/shared';
import type { Assets } from './game';
import { gearIcons } from './invIcons';
import ItemView from './ItemView';
import type { Sock } from '../net';
import { sound } from './audio';

/*
 * Las mejoras del terminal en una lista por fases (UPGRADES, shared/upgrades.ts): cada fila lleva icono, nombre, niveles y precio; las que aún no
 * se pueden comprar salen apagadas. El texto vive en la ficha de la derecha (el hito elegido o el que se señala): ahí se compra, con el dinero común.
 */

/** El dibujo de cada hito (24 × 24, a trazo). Uno nuevo sin dibujo sale con la estrella. */
const ICON: Partial<Record<UpId, string>> = {
  pack: 'M8 7V5a4 4 0 0 1 8 0v2M6 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 13h8v4H8z',
  belt: 'M2 9h20v6H2zM9 7h6v10H9zM12 11v2',
  back: 'M7 3l10 18M17 3L7 21M5 9h14M5 15h14',
  hp: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  lungs: 'M12 3v9M12 9c-2 0-3 1-4 3s-3 5-3 7 1 2 3 2 4-1 4-4zM12 9c2 0 3 1 4 3s3 5 3 7-1 2-3 2-4-1-4-4z',
  legs: 'M8 3h5v10l6 3a2 2 0 0 1 1 2v2H8zM8 16h5',
  light: 'M13 2L4 14h7l-1 8 9-12h-7z',
  rest: 'M4 12a8 8 0 1 0 8-8M12 4l3 3-3 3',
  heal: 'M12 5v14M5 12h14',
  sneak: 'M4 18h16M7 18l2-6h6l2 6M10 8a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  suites: 'M6 21V4h12v17M4 21h16M14 12h.01',
  parking: 'M3 17v-4l2-5h14l2 5v4zM3 17v2h3v-2M18 17v2h3v-2M7 13h.01M17 13h.01',
  reach: 'M4 20L20 4M14 4h6v6',
};
const STAR = 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z';
const YOU = 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3';

const LANES = ['CARRY', 'TOOLS', 'HEALTH', 'MOVE'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
/** Los nodos: cada mejora se reparte en tramos (UPGRADES[id].stages); un nodo es un tramo con sus niveles (`from`: el nivel de la mejora en el que empieza). */
type NodeKey = string;
const NODES = UP_IDS.flatMap((id) => {
  let from = 0;
  return UPGRADES[id].stages.map((s, i) => {
    const n = { key: `${id}:${i}` as NodeKey, id, i, from, n: s.n, row: s.row };
    from += s.n;
    return n;
  });
});
const node = (k: NodeKey) => NODES.find((n) => n.key === k)!;
/** Las columnas del árbol, de izquierda a derecha: fases (las filas de UPGRADES) y, entre ellas, las puertas (los nodos que abren un nivel). */
const COLS: { gate?: UpId; rows: number[]; label: string }[] = [
  { rows: [0], label: 'I' }, { rows: [1], label: 'II' }, { rows: [2], label: 'III' },
  { gate: 'pool', rows: [], label: '' }, { rows: [4], label: 'IV' },
  { gate: 'parking', rows: [], label: '' }, { rows: [6], label: 'V' },
  { gate: 'suites', rows: [], label: '' }, { rows: [8], label: 'VI' },
];
const nameOf = (k: NodeKey) => {
  const n = node(k), d = UPGRADES[n.id];
  return d.stages.length > 1 ? `${d.name} ${ROMAN[n.i]}` : d.name;
};

const Icon = ({ d }: { d: string }) => (
  <svg className="br-tree__ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Lo que desbloquea un hito, para enseñarlo en su ficha: los objetos de su nivel (el nodo que abre un nivel), los de la barra rápida (el cinturón) o la bombona (el arnés). */
const unlocks = (id: UpId): ItemId[] => {
  const lv = UPGRADES[id].level;
  if (lv) return ITEM_IDS.filter((i) => ITEMS[i].level === lv);
  if (id === 'belt') return ITEM_IDS.filter((i) => ITEMS[i].hot && !ITEMS[i].level);
  if (id === 'back') return ['tank'];
  return [];
};

export default function Upgrades({ bank, ups, sock, assets }: { bank: number; ups: Ups; sock?: Sock; assets?: Assets }) {
  const icons = assets ? gearIcons(assets) : undefined;
  const [sel, setSel] = useState<NodeKey>(NODES[0].key);
  const [hover, setHover] = useState<NodeKey | null>(null);
  const [msg, setMsg] = useState<{ t: string; bad: boolean }>({ t: '', bad: false });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<UpId | null>(null); // la mejora recién comprada: su casilla destella
  const buy = (id: UpId) => {
    if (!sock || busy) return;
    setBusy(true);
    sock.emit('upgrade', id, (r) => {
      setBusy(false);
      sound(r.ok ? 'upgrade' : 'denied');
      if (r.ok) (setFlash(id), setTimeout(() => setFlash(null), 1400));
      setMsg(r.ok ? { t: `${UPGRADES[id].name} UPGRADED`, bad: false } : { t: (r.error ?? 'COULD NOT UPGRADE').toUpperCase(), bad: true });
    });
    setTimeout(() => setBusy(false), 2000); // sin respuesta del servidor no se queda bloqueado
  };
  const state = (k: NodeKey) => {
    const nd = node(k), d = UPGRADES[nd.id], L = upLevel(ups, nd.id), lv = Math.max(0, Math.min(nd.n, L - nd.from));
    const need = d.stages[nd.i].needs?.find(([n, k]) => upLevel(ups, n) < k), needOk = !need;
    const any = d.stages[nd.i].any, have = any ? boughtBefore(ups, nd.row) : 0, anyOk = !any || have >= any;
    const locked = L < nd.from || !needOk || !anyOk, done = lv >= nd.n, cost = locked || done ? null : (upCost(ups, nd.id) ?? null);
    return { nd, d, lv, max: nd.n, cost, locked, done, poor: cost !== null && bank < cost, need: needOk ? undefined : need, any: any && !anyOk ? { have, any } : undefined };
  };
  const shown = hover ?? sel, s = state(shown);
  // el árbol se mueve arrastrando y se acerca o aleja con la rueda o los botones (nada de barras de desplazamiento)
  const view = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null);
  const pan = useRef({ x: 0, y: 0, z: 1, d: null as null | { px: number; py: number; x0: number; y0: number }, moved: false });
  const [zoom, setZoom] = useState(1);
  const setPan = (x: number, y: number, smooth = false) => {
    const v = view.current, w = world.current;
    if (!v || !w) return;
    const lim = (vs: number, ws: number, p: number) => (ws <= vs ? (vs - ws) / 2 : Math.max(vs - ws, Math.min(0, p)));
    pan.current.x = lim(v.clientWidth, w.offsetWidth * pan.current.z, x);
    pan.current.y = lim(v.clientHeight, w.offsetHeight * pan.current.z, y);
    w.style.transition = smooth ? 'transform 0.35s ease' : 'none';
    w.style.transform = `translate(${pan.current.x}px, ${pan.current.y}px) scale(${pan.current.z})`;
  };
  const zoomTo = (z: number, cx = (view.current?.clientWidth ?? 0) / 2, cy = (view.current?.clientHeight ?? 0) / 2, smooth = false) => {
    const p = pan.current, nz = Math.max(0.4, Math.min(1.8, z)), k = nz / p.z;
    p.z = nz;
    setZoom(nz);
    setPan(cx - (cx - p.x) * k, cy - (cy - p.y) * k, smooth);
  };
  const fit = (smooth = false) => {
    const v = view.current, w = world.current;
    if (!v || !w) return;
    pan.current.z = Math.max(0.8, Math.min(1, v.clientWidth / w.offsetWidth, v.clientHeight / w.offsetHeight)) || 1; // (no por debajo de 0,8: más pequeño el texto se emborrona; el resto se recorre arrastrando)
    setZoom(pan.current.z);
    setPan(0, 0, smooth);
  };
  useEffect(() => fit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const down = (e: RPE) => (pan.current.d = { px: e.clientX, py: e.clientY, x0: pan.current.x, y0: pan.current.y });
  const drag = (e: RPE) => {
    const d = pan.current.d;
    if (!d) return;
    if (!pan.current.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) > 5) ((pan.current.moved = true), view.current?.setPointerCapture(e.pointerId));
    if (pan.current.moved) setPan(d.x0 + e.clientX - d.px, d.y0 + e.clientY - d.py);
  };
  const release = () => (pan.current.d = null);
  const wheel = (e: { clientX: number; clientY: number; deltaY: number }) => {
    const r = view.current!.getBoundingClientRect();
    zoomTo(pan.current.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
  };
  const best = NODES.filter((n) => { const t = state(n.key); return !t.locked && !t.done && !t.poor; }).sort((x, y) => (state(x.key).cost ?? 0) - (state(y.key).cost ?? 0))[0]?.key;
  return (
    <div className="br-shop">
      <p className="br-shop__bank">
        <span className="br-lobby__dim">TEAM BANK</span>
        <b>${bank}</b>
        <span className="br-lobby__dim br-shop__note">UPGRADES ARE YOURS, IN THIS ROOM</span>
      </p>
      <p className="br-tree__best">
        {best ? (
          <button type="button" className="br-opt" data-nav onClick={() => setSel(best)}>NEXT BEST BUY: {nameOf(best)} · ${state(best).cost}</button>
        ) : (
          <span className="br-lobby__dim">NOTHING YOU CAN AFFORD RIGHT NOW</span>
        )}
        <span className="br-lobby__dim">GREEN = BUY NOW · DIM = LOCKED · DOUBLE CLICK BUYS</span>
      </p>
      <div className="br-tree">
        <div className="br-tree__scroll" ref={view} onPointerDown={down} onPointerMove={drag} onPointerUp={release} onPointerCancel={release} onClickCapture={(e) => pan.current.moved && (e.stopPropagation(), e.preventDefault(), (pan.current.moved = false))} onWheel={wheel}>
          <span className="br-tree__zoom">
            <button type="button" className="br-opt" aria-label="Zoom out" onClick={() => zoomTo(pan.current.z / 1.25, undefined, undefined, true)}>−</button>
            <small>{Math.round(zoom * 100)}%</small>
            <button type="button" className="br-opt" aria-label="Zoom in" onClick={() => zoomTo(pan.current.z * 1.25, undefined, undefined, true)}>+</button>
            <button type="button" className="br-opt" aria-label="Fit" onClick={() => fit(true)}>⌂</button>
          </span>
          <div className="br-tree__grid" ref={world} role="tree" aria-label="Upgrades" style={{ gridTemplateColumns: `4.5em ${COLS.map((c) => (c.gate ? '6.5em' : 'minmax(6.5em, 1fr)')).join(' ')}` }}>
            {COLS.map((c, i) => <p key={i} className="br-tree__lane" data-gate={c.gate ? '' : undefined} style={{ gridColumn: i + 2, gridRow: 1 }}>{c.label}</p>)}
            {LANES.map((l, r) => <p key={l} className="br-tree__ph" style={{ gridColumn: 1, gridRow: r + 2 }}>{l}</p>)}
            {LANES.map((_, r) => <i key={r} className="br-tree__rail" style={{ gridColumn: `2 / ${COLS.length + 2}`, gridRow: r + 2 }} aria-hidden="true" />)}
            {COLS.map((c, ci) => {
              if (c.gate) {
                const id = NODES.find((n) => n.id === c.gate)!.key, st = state(id), tag = st.done ? 'OPEN' : st.locked ? 'LOCKED' : `$${st.cost}`;
                return (
                  <button
                    key={ci}
                    type="button"
                    role="treeitem"
                    className="br-tree__gate"
                    data-nav
                    style={{ gridColumn: ci + 2, gridRow: `2 / ${LANES.length + 2}` }}
                    aria-selected={shown === id}
                    aria-label={`${nameOf(id)}, ${tag}`}
                    data-locked={st.locked || undefined}
                    data-done={st.done || undefined}
                    data-next={(!st.locked && !st.done && !st.poor) || undefined}
                    data-poor={(!st.locked && !st.done && st.poor) || undefined}
                    data-flash={flash === c.gate || undefined}
                    onClick={() => setSel(id)}
                    onDoubleClick={() => !st.locked && !st.done && !st.poor && buy(c.gate!)}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setSel(id)}
                  >
                    <Icon d={ICON[c.gate] ?? STAR} />
                    <b>{nameOf(id)}</b>
                    <span className="br-tree__tag">{st.done ? 'OPEN' : st.any ? `${st.any.have}/${st.any.any}` : st.need ? 'LOCKED' : `$${st.cost}`}</span>
                  </button>
                );
              }
              return LANES.map((_, li) => (
                <div key={`${ci}-${li}`} className="br-tree__cell" style={{ gridColumn: ci + 2, gridRow: li + 2 }}>
                  {NODES.filter((n) => !UPGRADES[n.id].level && UPGRADES[n.id].col === li && c.rows.includes(n.row)).map(({ key: id, id: up }) => {
                    const st = state(id), tag = st.locked ? 'LOCKED' : st.done ? 'MAXED' : `+ $${st.cost}`, buyable = !st.locked && !st.done;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="treeitem"
                        className="br-tree__node"
                        data-nav
                        aria-selected={shown === id}
                        aria-label={`${nameOf(id)}, level ${st.lv} of ${st.max}, ${tag}`}
                        data-locked={st.locked || undefined}
                        data-done={st.done || undefined}
                        data-next={(buyable && !st.poor) || undefined}
                        data-poor={(buyable && st.poor) || undefined}
                        data-flash={flash === up || undefined}
                        onClick={() => setSel(id)}
                        onDoubleClick={() => buyable && !st.poor && buy(up)}
                        onMouseEnter={() => setHover(id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setSel(id)}
                      >
                        <Icon d={ICON[up] ?? STAR} />
                        <span className="br-tree__rn">{nameOf(id)}</span>
                        <span className="br-tree__rl">{'▰'.repeat(st.lv)}<span className="off">{'▱'.repeat(st.max - st.lv)}</span></span>
                        {buyable && <span className="br-tree__tag">${st.cost}</span>}
                      </button>
                    );
                  })}
                </div>
              ));
            })}
          </div>
        </div>
        <aside className="br-tree__card" aria-live="polite">
          <div className="br-tree__head">
            <span className="br-tree__badge" data-got={s.lv > 0 || undefined}>
              <Icon d={ICON[s.nd.id] ?? STAR} />
            </span>
            <span>
              <p className="br-tree__name">{nameOf(shown)}</p>
              <p className="br-lobby__dim">{s.d.level ? 'LEVEL GATE' : `PHASE ${ROMAN[s.nd.row] ?? s.nd.row + 1}`}</p>
            </span>
          </div>
          <p className="br-tree__lv">
            {'▰'.repeat(s.lv)}
            <span className="br-lobby__dim">{'▱'.repeat(s.max - s.lv)}</span>
          </p>
          {s.d.val.length > 2 && (() => {
            const lo = s.d.val[0], hi = s.d.val[s.d.val.length - 1], f = (v: number) => (v - lo) / (hi - lo || 1), cur = s.d.val[s.nd.from + s.lv], nxt = s.d.val[s.nd.from + s.lv + 1];
            const bars = (x: number) => (<>{'▮'.repeat(Math.round(f(x) * 12))}<span className="off">{'▮'.repeat(12 - Math.round(f(x) * 12))}</span></>);
            return (
              <p className="br-tree__cmp" data-flash={flash === s.nd.id || undefined}>
                <span>NOW {bars(cur)}</span>
                {!s.done && nxt !== undefined && <span className="br-tree__after">NEXT {bars(nxt)}</span>}
              </p>
            );
          })()}
          <p className="br-tree__val" data-flash={flash === s.nd.id || undefined}>
            {s.d.fmt(s.d.val[s.nd.from + s.lv])}
            {!s.done && <span className="br-lobby__dim"> → {s.d.fmt(s.d.val[s.nd.from + s.lv + 1])}</span>}
          </p>
          <p className="br-lobby__dim br-tree__info">{s.d.info}</p>
          {s.d.level && LEVELS[s.d.level] && (
            <div className="br-tree__lvl">
              <b>{LEVELS[s.d.level].name} · {LEVELS[s.d.level].title}</b>
              <span className="br-lobby__dim">{LEVELS[s.d.level].blurb}</span>
              <span>BETTER LOOT: ×{LEVELS[s.d.level].luck ?? 1} LUCK, MORE RARE FINDS</span>
            </div>
          )}
          {unlocks(s.nd.id).length > 0 && (
            <>
              <p className="br-lobby__dim br-tree__sec">{s.d.level ? 'UNLOCKS IN THE SHOP AND ON THE MAP' : 'UNLOCKS'}</p>
              <ul className="br-tree__items">
                {unlocks(s.nd.id).map((i) => (
                  <li key={i} title={ITEMS[i].info}>
                    {icons?.[i as keyof typeof icons] && <img src={icons[i as keyof typeof icons]} alt="" draggable={false} />}
                    <span>{ITEMS[i].name}</span>
                  </li>
                ))}
              </ul>
              {assets && <div className="br-tree__model"><ItemView assets={assets} kind={unlocks(s.nd.id)[unlocks(s.nd.id).length - 1] as 'uno'} r={2} /></div>}
            </>
          )}
          <button type="button" className="br-opt" data-nav disabled={s.locked || s.done || s.poor || busy} onClick={() => (setSel(shown), buy(s.nd.id))}>
            {s.locked ? (s.any ? `BUY ${s.any.any - s.any.have} MORE UPGRADES FIRST (${s.any.have}/${s.any.any})` : s.need ? `NEEDS ${UPGRADES[s.need[0]].name} ${s.need[1]}` : 'FINISH THE PREVIOUS STEP') : s.done ? 'MAXED OUT' : s.poor ? `$${s.cost} · NO FUNDS` : `UPGRADE · $${s.cost}`}
          </button>
          <p className="br-lobby__sub" role={msg.bad ? 'alert' : 'status'} data-bad={msg.bad || undefined}>
            {msg.t || 'PICK A NODE. DOUBLE CLICK BUYS.'}
          </p>
        </aside>
      </div>
    </div>
  );
}
