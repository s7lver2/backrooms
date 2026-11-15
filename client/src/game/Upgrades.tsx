import { useState } from 'react';
import { ITEMS, ITEM_IDS, LEVELS, UPGRADES, UP_IDS, upCost, upLevel, type ItemId, type UpId, type Ups } from '@backrooms/shared';
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
const PH = Math.max(...NODES.map((n) => n.row)) + 2; // (las fases son las filas 0…PH-2)
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
  const buy = (id: UpId) => {
    if (!sock || busy) return;
    setBusy(true);
    sock.emit('upgrade', id, (r) => {
      setBusy(false);
      sound(r.ok ? 'upgrade' : 'denied');
      setMsg(r.ok ? { t: `${UPGRADES[id].name} UPGRADED`, bad: false } : { t: (r.error ?? 'COULD NOT UPGRADE').toUpperCase(), bad: true });
    });
    setTimeout(() => setBusy(false), 2000); // sin respuesta del servidor no se queda bloqueado
  };
  const state = (k: NodeKey) => {
    const nd = node(k), d = UPGRADES[nd.id], L = upLevel(ups, nd.id), lv = Math.max(0, Math.min(nd.n, L - nd.from));
    const need = d.stages[nd.i].needs?.find(([n, k]) => upLevel(ups, n) < k), needOk = !need;
    const locked = L < nd.from || !needOk, done = lv >= nd.n, cost = locked || done ? null : (upCost(ups, nd.id) ?? null);
    return { nd, d, lv, max: nd.n, cost, locked, done, poor: cost !== null && bank < cost, need: needOk ? undefined : need };
  };
  const shown = hover ?? sel, s = state(shown);
  return (
    <div className="br-shop">
      <p className="br-shop__bank">
        <span className="br-lobby__dim">TEAM BANK</span>
        <b>${bank}</b>
        <span className="br-lobby__dim br-shop__note">UPGRADES ARE YOURS, IN THIS ROOM</span>
      </p>
      <div className="br-tree">
        <ul className="br-tree__list" role="tree" aria-label="Upgrades">
          {Array.from({ length: PH - 1 }, (_, p) => {
            const here = NODES.filter((n) => n.row === p).sort((x, y) => UPGRADES[x.id].col - UPGRADES[y.id].col), got = here.reduce((n, x) => n + state(x.key).lv, 0), all = here.reduce((n, x) => n + x.n, 0);
            return (
              <li key={p} className="br-tree__grp">
                <p className="br-tree__gh">
                  <span>PHASE {ROMAN[p]}</span>
                  <span>{got}/{all}</span>
                </p>
                <ul>
                  {here.map(({ key: id, id: up }) => {
                    const st = state(id), tag = st.locked ? 'LOCKED' : st.done ? 'MAX' : `$${st.cost}`;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          role="treeitem"
                          className="br-tree__row"
                          data-nav
                          aria-selected={shown === id}
                          aria-label={`${nameOf(id)}, level ${st.lv} of ${st.max}, ${tag}`}
                          data-locked={st.locked || undefined}
                          data-done={st.done || undefined}
                          data-poor={(!st.locked && !st.done && st.poor) || undefined}
                          onClick={() => setSel(id)}
                          onDoubleClick={() => !st.locked && !st.done && !st.poor && buy(up)}
                          onMouseEnter={() => setHover(id)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setSel(id)}
                        >
                          <Icon d={ICON[up] ?? STAR} />
                          <span className="br-tree__rn">{nameOf(id)}</span>
                          <span className="br-tree__rl">{'▰'.repeat(st.lv)}<span className="off">{'▱'.repeat(st.max - st.lv)}</span></span>
                          <span className="br-tree__tag">{tag}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
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
          <p className="br-tree__val">
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
              {assets && s.d.level && <div className="br-tree__model"><ItemView assets={assets} kind={unlocks(s.nd.id)[unlocks(s.nd.id).length - 1] as 'uno'} r={2} /></div>}
            </>
          )}
          <button type="button" className="br-opt" data-nav disabled={s.locked || s.done || s.poor || busy} onClick={() => (setSel(shown), buy(s.nd.id))}>
            {s.locked ? (s.need ? `NEEDS ${UPGRADES[s.need[0]].name} ${s.need[1]}` : 'FINISH THE PREVIOUS PHASE') : s.done ? 'MAXED OUT' : s.poor ? `$${s.cost} · NO FUNDS` : `UPGRADE · $${s.cost}`}
          </button>
          <p className="br-lobby__sub" role={msg.bad ? 'alert' : 'status'} data-bad={msg.bad || undefined}>
            {msg.t || 'PICK A NODE. DOUBLE CLICK BUYS.'}
          </p>
        </aside>
      </div>
    </div>
  );
}
