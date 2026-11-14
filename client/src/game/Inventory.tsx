'use client';
import { Fragment, memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { DEFAULT_LOOK, RIFLE_MAG, ITEMS, SHOP, BALL_KINDS, SUBS, fmtSub, subOf, lootPrice, rarity, sellPrice, type ItemId, type Look, type Qual } from '@backrooms/shared';
import { perks } from './perks';
import { lootIcon } from './rarityFx';
import type { Assets, Inv } from './game';
import { FITS, type Gear, type Slot } from './player';
import { gearIcons, type IconKey } from './invIcons';
import { HOT, HOT_SLOTS } from './quickslots';
import InvAvatar from './InvAvatar';
import ItemView from './ItemView';
import './inventory.css';

/*
 * El inventario (E): el menú en pantalla de la camcorder encima de la partida, que sigue corriendo.
 * A la izquierda, el personaje en 3D con sus ranuras de equipo (cabeza y espalda, el aspecto que llevas; manos y
 * cinturón, lo que se usa); en medio, la mochila en casillas; a la derecha, el detalle de lo elegido y los objetivos.
 * Se arrastra de una casilla a otra (ratón o dedo), doble clic o clic derecho equipa o guarda, Mayús+clic lo mueve
 * al instante. Qué se puede llevar y dónde lo decide player.ts (FITS); aquí solo se pide con onPlace.
 */

/** Los substats de un objeto de las Suites según su rareza (varias filas). */
function Subs({ id, q }: { id: ItemId; q: Qual }) {
  return (
    <>
      {SUBS[id]!.map((x) => (
        <Fragment key={x.key}>
          <span>{x.name}</span>
          <span data-up={rarity(q.r).boost > 1 || undefined}>{fmtSub(x, subOf({ q: { [id]: q } }, id, x.key))}</span>
        </Fragment>
      ))}
      {q.c && BALL_KINDS[q.c] && (
        <>
          <span>CAUGHT</span>
          <span data-up>{BALL_KINDS[q.c].name} · ×{BALL_KINDS[q.c].mul} TIME</span>
        </>
      )}
    </>
  );
}
const NAME: Partial<Record<Item, string>> = { flashlight: 'FLASHLIGHT', camera: 'CAMCORDER', gun: 'RIFLE', water: 'ALMOND WATER', tape: 'VHS TAPES', spare: 'SPARE FLASHLIGHTS', ammo: 'RIFLE AMMO', tank: 'DIVING TANK', loot: 'ARTIFACT', uno: 'UNO REVERSE', monster: 'MONSTER', pokeball: 'POKEBALL', grenade: 'SMOKE GRENADE', nokia: 'NOKIA', bat: 'BASEBALL BAT' };
type Item = Gear | 'water' | 'caution' | 'radar' | 'totem' | 'watergun' | 'tape' | 'spare' | 'ammo' | 'tank' | 'loot' | 'uno' | 'monster' | 'pokeball' | 'grenade' | 'nokia' | 'bat';
/** El objeto de la tienda (ITEMS) que corresponde a cada cosa del inventario: de él salen su rareza, su estado y su precio. La linterna de la mano y las cintas no tienen. */
const SHOP_ID: Partial<Record<Item, ItemId>> = { flashlight: 'flashlight', camera: 'camera', gun: 'gun', water: 'water', caution: 'caution', radar: 'radar', totem: 'totem', watergun: 'watergun', spare: 'flashlight', ammo: 'ammo', tank: 'tank', uno: 'uno', monster: 'monster', pokeball: 'pokeball', grenade: 'grenade', nokia: 'nokia', bat: 'bat' };
const hex = (r: number) => '#' + rarity(r).color.toString(16).padStart(6, '0');
/** Una casilla de la mochila: qué hay y cuántas unidades (solo lo que se cuenta pasa de 1). */
export type Cell = { k: Item; n: number };
const STACK = new Set<Item>(['water', 'tape', 'spare', 'ammo']);
/** Lo que el servidor deja soltar al suelo (id de ItemId); las cintas no. */
const DROP: Partial<Record<Item, string>> = { loot: 'loot', water: 'water', spare: 'flashlight', ammo: 'ammo', camera: 'camera', gun: 'gun', caution: 'caution', radar: 'radar', totem: 'totem', watergun: 'watergun', tank: 'tank', uno: 'uno', monster: 'monster', pokeball: 'pokeball', grenade: 'grenade', nokia: 'nokia', bat: 'bat' };
const hotable = (g: Item) => g === 'camera' || g === 'gun' || barOnly(g);
/** Lo que solo va en la barra de acceso rápido (no se equipa en las manos): se arrastra a una ranura de la barra. */
const barOnly = (g: Item): g is 'water' | 'caution' | 'radar' | 'totem' | 'watergun' | 'uno' | 'monster' | 'pokeball' | 'grenade' | 'nokia' | 'bat' => g === 'uno' || g === 'monster' || g === 'pokeball' || g === 'grenade' || g === 'nokia' || g === 'bat' || g === 'water' || g === 'caution' || g === 'radar' || g === 'totem' || g === 'watergun';
const fits = (s: string, g: Item) => (s === 'left' && (g === 'flashlight' || g === 'spare')) || (s === 'back' && g === 'tank');
const label = (g: Item) => NAME[g] ?? HOT[g]?.name ?? g;
const SLOTS: [Slot, string][] = [
  ['left', 'L HAND'],
  ['right', 'R HAND'],
  ['belt', 'BELT'],
];
const PACK = 20; // casillas de la mochila (5 × 4); las que no dan las mejoras (perks.stats.cells) están cerradas

/** Una barra de bloques del OSD, de diez. */
const Bar = ({ v }: { v: number }) => {
  const n = Math.round(v * 10);
  return (
    <span aria-label={`${Math.round(v * 100)}%`}>
      {'▮'.repeat(n)}
      <span className="br-osd__dim">{'▮'.repeat(10 - n)}</span>
    </span>
  );
};

type Where = Slot | 'store' | 'back' | `hot${number}` | `cell${number}`;
const pk = (w: Where) => (w.startsWith('cell') ? +w.slice(4) : -1);
const inPack = (w: Where) => w === 'store' || pk(w) >= 0;
const hotIdx = (w: Where) => (w.startsWith('hot') ? +w.slice(3) : -1);
type Sel = { kind: 'gear'; g: Gear } | { kind: 'hot'; id: Item } | { kind: 'tape' | 'spare' | 'ammo' | 'water' | 'tank' } | { kind: 'loot'; i: number };

/** Cuadra la disposición con lo que realmente se lleva: lo gastado libera casilla, lo nuevo va a la primera libre (o a la que pide `pend`). */
function sync(prev: (Cell | null)[], want: Map<Item, number>, pend: MutableRefObject<{ k: Item; i: number } | null>, cap: number) {
  const left = new Map(want);
  const out = Array.from({ length: PACK }, (_, i): Cell | null => {
    const c = i < cap ? prev[i] : null;
    const n = c ? Math.min(c.n, left.get(c.k) ?? 0) : 0;
    if (!c || n <= 0) return null;
    left.set(c.k, left.get(c.k)! - n);
    return { k: c.k, n };
  });
  for (const [k, n] of left) {
    if (n <= 0) continue;
    const same = STACK.has(k) ? out.findIndex((c) => c?.k === k) : -1;
    if (same >= 0) {
      out[same]!.n += n;
      continue;
    }
    const free = () => out.findIndex((c, i) => !c && i < cap);
    if (k === 'loot') {
      // el botín no se apila: una casilla por pieza
      for (let j = 0, i = free(); j < n && i >= 0; j++, i = free()) out[i] = { k, n: 1 };
      continue;
    }
    const p = pend.current, i = p && p.k === k && !out[p.i] && p.i < cap ? p.i : free();
    if (p && p.k === k) pend.current = null;
    if (i >= 0) out[i] = { k, n };
  }
  return out;
}

function Inventory({
  open,
  inv,
  assets,
  look = DEFAULT_LOOK,
  reduced = false,
  onPlace,
  onLight,
  onHot,
  onUse,
  onDrop,
  onTank,
  onClose,
  bag,
}: {
  /** Montado siempre (montarlo al abrir cuesta ~0,1 s): cerrado, solo se oculta y no se vuelve a pintar. */
  open: boolean;
  inv: Inv;
  assets: Assets;
  look?: Look;
  reduced?: boolean;
  onPlace: (s: Slot, g: Gear | 'none') => void;
  onLight: () => void;
  /** Poner un objeto en una ranura de la barra de acceso rápido (null la vacía). */
  onHot: (slot: number, id: string | null) => void;
  onUse: (id: string) => void;
  /** Soltar una unidad al suelo (arrastrando fuera del panel). */
  onDrop?: (id: string, index?: number) => void;
  /** Ponerse la bombona en la espalda (true) o guardarla en la mochila (false). */
  onTank?: (on: boolean) => void;
  onClose: () => void;
  /** La disposición de la mochila (solo de la sesión): la guarda quien monta el menú para que sobreviva a cerrarlo. */
  bag?: MutableRefObject<(Cell | null)[]>;
}) {
  const [tab, setTab] = useState<'items' | 'photos'>('items');
  // la foto ampliada (índice) o ninguna
  const [zoom, setZoom] = useState<number | null>(null);
  // lo que se arrastra (el fantasma lo mueve el puntero sin pasar por React) y sobre qué casilla está
  const [held, setHeld] = useState<{ g: Item; from: Where; one: boolean } | null>(null);
  const [over, setOver] = useState<Where | null>(null);
  const [out, setOut] = useState(false); // el objeto arrastrado está fuera del panel: se soltará al suelo
  const [sel, setSel] = useState<Sel>({ kind: 'gear', g: 'flashlight' });
  const dn = useRef<{ g: Item; from: Where; x: number; y: number; on: boolean; one: boolean } | null>(null);
  const own = useRef<(Cell | null)[]>([]), lay = bag ?? own;
  const pend = useRef<{ k: Item; i: number } | null>(null);
  const [, bump] = useState(0);
  const pos = useRef({ x: 0, y: 0 });
  const ghostEl = useRef<HTMLDivElement>(null);
  const dragged = useRef(false); // un arrastre no cuenta como clic
  const api = useRef({ mv: (_e: PointerEvent) => {}, end: (_e: PointerEvent, _abort: boolean) => {} });

  const icons = useMemo(() => gearIcons(assets), [assets]);
  const st = perks.stats; // lo que dan mis mejoras: casillas, ranuras de la barra y la espalda
  const hotIn = inv.hot.slice(0, st.hot); // lo que de verdad está en la barra: una ranura cerrada no guarda nada (lo suyo va a la mochila)
  const at: Record<Slot, Gear | 'none'> = { left: inv.left, right: inv.hand === 'watergun' ? 'none' : inv.hand, belt: inv.belt };
  const owned: Gear[] = [...(inv.camera ? (['camera'] as const) : []), ...(inv.gun ? (['gun'] as const) : [])];
  // la mano es para lo pasivo (la linterna); lo demás va a la barra de abajo, y lo que no está en ella se guarda en la mochila
  const stored = owned.filter((g) => !hotIn.includes(g));
  const lamps = inv.spares - (at.left === 'flashlight' ? 1 : 0); // las linternas de la mochila: todas menos la que lleva en la mano
  // la mochila: primero lo que se cuenta, luego el equipo guardado
  // un objeto está en un solo sitio: lo que está en la barra no sale en la mochila. Con agua: las unidades de la mochila son las
  // que el jugador separó (barra + mochila = inv.water); sin ninguna en la barra, todas van a la mochila
  const waterBag = hotIn.includes('water') ? Math.min(lay.current.reduce((s, c) => s + (c?.k === 'water' ? c.n : 0), 0), Math.max(0, inv.water - 1)) : inv.water;
  const stacks: { kind: 'tape' | 'spare' | 'ammo' | 'water'; n: number }[] = [
    ...(waterBag ? [{ kind: 'water' as const, n: waterBag }] : []),
    ...(lamps > 0 ? [{ kind: 'spare' as const, n: lamps }] : []),
    ...(inv.gun && inv.spare ? [{ kind: 'ammo' as const, n: inv.spare }] : []),
  ];
  const loose = [...(['caution', 'radar', 'totem', 'watergun', 'uno', 'monster', 'pokeball', 'grenade', 'nokia', 'bat'] as const).filter((id) => HOT[id].have(inv) && !hotIn.includes(id)), ...(inv.tank && !(inv.tankOn && st.back) ? (['tank'] as const) : [])]; // lo de la barra que se ha quitado de ella y la bombona sin puesta
  const loot = perks.loot;
  const cells = stacks.length + loose.length + stored.length + loot.length;
  // lo que se lleva por tipo, y la disposición (la que eligió el jugador) cuadrada con ello
  const want = new Map<Item, number>([...stacks.map((s) => [s.kind, s.n] as const), ...loose.map((k) => [k, 1] as const), ...stored.map((k) => [k, 1] as const), ...(loot.length ? [['loot', loot.length] as const] : [])]);
  const grid = (lay.current = sync(lay.current, want, pend, st.cells));
  // qué pieza del botín es la de la casilla `i`: por orden en la mochila
  const lootAt = (i: number) => grid.slice(0, i).filter((c) => c?.k === 'loot').length;
  const room = grid.some((c, i) => !c && i < st.cells); // queda una casilla libre
  const put = (g: (Cell | null)[]) => ((lay.current = g), bump((x) => x + 1));

  // Tab cierra; con una foto ampliada, Escape la cierra (y no el inventario) y las flechas pasan de una a otra
  useEffect(() => {
    if (!open) return;
    const n = inv.full.length;
    const key = (e: KeyboardEvent) => {
      if (zoom === null) {
        if (e.code === 'Tab') (e.preventDefault(), onClose());
        return;
      }
      if (e.code !== 'Escape' && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.code === 'Escape') setZoom(null);
      else setZoom((z) => (z === null ? z : (z + (e.code === 'ArrowRight' ? 1 : -1) + n) % n));
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open, zoom, inv.full.length, onClose]);

  const cancel = () => {
    dn.current = null;
    setHeld(null);
    setOver(null);
    setOut(false);
  };
  // Escape cancela lo que se arrastra (y no cierra el inventario); al cerrarlo, todo vuelve a su sitio
  useEffect(() => {
    if (!open) return (cancel(), setZoom(null));
    if (!held) return;
    const key = (e: KeyboardEvent) => e.code === 'Escape' && (e.stopImmediatePropagation(), e.preventDefault(), cancel());
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open, held]);

  // mover dentro de la mochila: a una libre se va (o, con Mayús, una unidad), sobre la misma clase se funden, sobre otra se intercambian
  const toCell = (h: { g: Item; from: Where; one: boolean }, i: number) => {
    const g = grid.slice(), j = pk(h.from), t = g[i];
    if (j === i) return;
    if (i >= st.cells) return; // casilla cerrada
    if (j < 0) {
      // venía de una ranura (mano, barra): se saca y la casilla elegida es para él
      if (!room) return;
      if (hotIdx(h.from) >= 0) onHot(hotIdx(h.from), null);
      else onPlace(h.from as Slot, 'none');
      if (!t) pend.current = { k: h.g, i };
      return;
    }
    const s = g[j];
    if (!s) return;
    const mv = h.one ? 1 : s.n;
    if (!t) g[i] = { k: s.k, n: mv };
    else if (t.k === s.k && STACK.has(s.k)) g[i] = { k: t.k, n: t.n + mv };
    else if (h.one) return;
    else return ((g[i] = s), (g[j] = t), put(g));
    g[j] = s.n > mv ? { k: s.k, n: s.n - mv } : null;
    put(g);
  };
  // lo que va de la mochila a la barra sale de su casilla (una unidad con Mayús, si no toda la pila)
  const leavePack = (h: { from: Where; one: boolean }) => {
    const j = pk(h.from), s = grid[j];
    if (j < 0 || !s) return;
    const g = grid.slice();
    g[j] = h.one && s.n > 1 ? { k: s.k, n: s.n - 1 } : null;
    put(g);
  };
  // soltar `h` en `to`: en una casilla que le vale, va ahí; en la mochila, sale de donde estaba; si no vale, vuelve
  const drop = (h: { g: Item; from: Where; one: boolean }, to: Where | null) => {
    if (!to || to === h.from) return;
    if (h.g === 'tank') {
      // la bombona: de la mochila a la espalda se pone, de la espalda a la mochila se guarda (a otro sitio no va)
      if (to === 'back') inPack(h.from) && onTank?.(true);
      else if (h.from === 'back' && (to === 'store' || pk(to) >= 0)) (onTank?.(false), pk(to) >= 0 && !grid[pk(to)] && (pend.current = { k: 'tank', i: pk(to) }));
      if (to === 'back' || h.from === 'back') return;
    }
    if (hotIdx(to) >= 0) {
      if (!hotable(h.g)) return;
      leavePack(h);
      // a una ranura de la barra; si venía de otra, se intercambian
      const prev = inv.hot[hotIdx(to)] ?? null;
      onHot(hotIdx(to), h.g);
      if (hotIdx(h.from) >= 0 && prev) onHot(hotIdx(h.from), prev);
    } else if (pk(to) >= 0) toCell(h, pk(to));
    else if (to === 'store') {
      if (!room) return;
      if (hotIdx(h.from) >= 0) onHot(hotIdx(h.from), null);
      else if (!inPack(h.from)) onPlace(h.from as Slot, 'none');
    } else if (fits(to as Slot, h.g) && (!h.one || h.g === 'spare')) onPlace(to as Slot, h.g === 'spare' ? 'flashlight' : (h.g as Gear));
  };
  // la casilla bajo el puntero o, si se suelta cerca de una, la más cercana (a menos de 48 px): no hay que afinar la puntería
  const whereAt = (g: Item, x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-where]') as HTMLElement | null;
    const n = near(g, x, y);
    if (el && !(el.dataset.where === 'store' && n)) return el.dataset.where as Where;
    return n ?? (el?.dataset.where as Where | undefined);
  };
  // ¿sobre el fondo (el margen o el hueco entre columnas, no sobre una columna) y sin casilla cerca? La linterna de la mano no se suelta
  const outside = (g: Item, x: number, y: number) => !!onDrop && !!DROP[g] && !whereAt(g, x, y) && !!document.elementFromPoint(x, y)?.matches('.br-inv, .iv');
  const near = (g: Item, x: number, y: number) => {
    let best: Where | undefined, bd = 48;
    document.querySelectorAll<HTMLElement>('.iv-slot[data-where], .iv-cell[data-where]').forEach((n) => {
      const r = n.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const w = n.dataset.where as Where;
      if (d < bd && (hotIdx(w) >= 0 ? hotable(g) : pk(w) >= 0 || fits(w as Slot, g))) ((bd = d), (best = w));
    });
    return best;
  };

  // doble clic, clic derecho o Mayús+clic: de la mochila, a la primera casilla libre que le vale; de una casilla, a la mochila
  const quick = (g: Item, from: Where) => {
    if (hotIdx(from) >= 0) return room ? onHot(hotIdx(from), null) : undefined;
    if (g === 'tank') return st.back || from === 'back' ? onTank?.(from === 'back' ? false : true) : undefined;
    if (g === 'spare') return at.left === 'none' ? onPlace('left', 'flashlight') : undefined;
    if (g === 'tape' || g === 'ammo' || g === 'loot') return;
    if (g === 'camera' || g === 'gun' || barOnly(g)) {
      if (!st.hot) return; // sin barra rápida (falta la mejora)
      const free = inv.hot.findIndex((h, i) => !h && i < st.hot);
      return (leavePack({ from, one: false }), onHot(free < 0 ? Math.min(inv.hotSel, st.hot - 1) : free, g));
    }
    if (!inPack(from)) return onPlace(from as Slot, 'none');
    const ok = SLOTS.map(([s]) => s).filter((s) => fits(s, g));
    onPlace(ok.find((s) => at[s] === 'none') ?? ok[0], g as Gear);
  };

  // arrastrar: el fantasma sale al pasar de 5 px (un clic suelto solo elige) y sigue al puntero; se suelta al levantarlo
  api.current.mv = (e) => {
    const d = dn.current;
    if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 5) return;
      d.on = dragged.current = true;
      pos.current = { x: e.clientX, y: e.clientY };
      setHeld({ g: d.g, from: d.from, one: d.one });
    }
    pos.current = { x: e.clientX, y: e.clientY };
    ghostEl.current?.style.setProperty('transform', `translate(${e.clientX}px, ${e.clientY}px)`);
    setOver(whereAt(d.g, e.clientX, e.clientY) ?? null);
    setOut(outside(d.g, e.clientX, e.clientY));
  };
  api.current.end = (e, abort) => {
    const d = dn.current;
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    if (!d) return;
    cancel();
    if (!d.on) return;
    setTimeout(() => (dragged.current = false)); // el clic que sigue al soltar no cuenta
    if (abort) return;
    if (outside(d.g, e.clientX, e.clientY)) onDrop!(DROP[d.g]!, d.g === 'loot' ? lootAt(pk(d.from)) : undefined);
    else drop(d, whereAt(d.g, e.clientX, e.clientY) ?? null);
  };
  const onMove = (e: PointerEvent) => api.current.mv(e);
  const onUp = (e: PointerEvent) => api.current.end(e, false);
  const onCancel = (e: PointerEvent) => api.current.end(e, true);
  const grab = (g: Item, from: Where, n?: number) => (e: React.PointerEvent) => {
    setSel(g === 'loot' ? { kind: 'loot', i: lootAt(pk(from)) } : g === 'water' || g === 'tape' || g === 'spare' || g === 'ammo' || g === 'tank' ? { kind: g } : barOnly(g) ? { kind: 'hot', id: g } : { kind: 'gear', g });
    if (e.button !== 0) return;
    e.preventDefault(); // sin selección de texto ni arrastre nativo
    dragged.current = false;
    dn.current = { g, from, x: e.clientX, y: e.clientY, on: false, one: e.shiftKey && (n ?? 0) > 1 && pk(from) >= 0 }; // Mayús: se separa una unidad de la pila
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
  };

  const qual = (g: Item, from: Where): Qual | undefined => (g === 'loot' ? loot[lootAt(pk(from))] : SHOP_ID[g] ? (perks.q[SHOP_ID[g]!] ?? { r: 0, w: 0 }) : undefined);
  const tip = (g: Item, q: Qual) => {
    const id = SHOP_ID[g], d = id && ITEMS[id], R = rarity(q.r);
    const cond = Math.round((1 - q.w) * 100);
    return (
      <span className="iv-tip" role="tooltip" data-r={q.r} style={{ '--rar': hex(q.r) } as React.CSSProperties}>
        <span className="iv-tip__banner">{R.name}</span>
        <span className="iv-tip__name">{label(g)}</span>
        <span className="iv-tip__rows">
          {id && SUBS[id] ? <Subs id={id} q={q} /> : d?.boost && (
            <>
              <span>{d.boost}</span>
              <span data-up={R.boost > 1 || undefined}>{R.boost > 1 ? `+${Math.round((R.boost - 1) * 100)}%` : '—'}</span>
            </>
          )}
          <span>CONDITION</span>
          <span data-low={cond < 40 || undefined}>
            <i className="iv-tip__bar">
              <i style={{ width: `${cond}%` }} />
            </i>
            {cond}%
          </span>
          <span>SELLS FOR</span>
          <span className="iv-tip__price">${g === 'loot' ? lootPrice(q) : sellPrice(id!, q)}</span>
        </span>
      </span>
    );
  };
  const gear = (g: Item, from: Where, n?: number, q = qual(g, from)) => (
    <button
      type="button"
      className="iv-item"
      data-rar={q?.r || undefined}
      style={q?.r ? ({ '--rar': hex(q.r) } as React.CSSProperties) : undefined}
      data-held={(held?.g === g && held.from === from && !held.one) || undefined}
      data-sel={(g === 'loot' ? sel.kind === 'loot' && sel.i === lootAt(pk(from)) : g === 'water' || g === 'tape' || g === 'spare' || g === 'ammo' || g === 'tank' ? sel.kind === g : barOnly(g) ? sel.kind === 'hot' && sel.id === g : sel.kind === 'gear' && sel.g === g) || undefined}
      onPointerDown={grab(g, from, n)}
      draggable={false}
      onDoubleClick={() => quick(g, from)}
      onContextMenu={(e) => (e.preventDefault(), quick(g, from))}
      onClick={(e) => e.shiftKey && !dragged.current && quick(g, from)}
      onDragStart={(e) => e.preventDefault()}
      aria-label={`${label(g)}${n !== undefined ? ` ×${n}` : ''}: drag to move${n && n > 1 ? ', shift drag to split one' : ''}${DROP[g] ? ', drag outside the panel to drop' : ''}`}
    >
      <img src={g === 'loot' ? lootIcon(q?.r) : icons[g as IconKey]} alt="" draggable={false} />
      {n !== undefined && n > 1 && <b>×{n}</b>}
      {q && !held && tip(g, q)}
    </button>
  );
  // cabeza (reservada: máscara) y espalda (la bombona de buceo de las Poolrooms); el aspecto del personaje no se enseña aquí
  const headSlot = (
    <div className="iv-slot" data-cos data-locked>
      <span className="iv-label">HEAD</span>
      <span className="iv-empty">LOCKED</span>
    </div>
  );
  const backSlot = (
    <div className="iv-slot" data-cos data-locked={!st.back || undefined} data-where={st.back ? 'back' : undefined} data-fits={(st.back && held?.g === 'tank' && inPack(held.from)) || undefined} data-over={(st.back && over === 'back' && held?.g === 'tank' && inPack(held.from)) || undefined}>
      <span className="iv-label">BACK</span>
      {!st.back ? <span className="iv-empty">LOCKED</span> : inv.tank && inv.tankOn ? gear('tank', 'back') : <span className="iv-empty">NONE</span>}
    </div>
  );

  // lo elegido ya no se tiene (p. ej. tras perderlo todo): nada que enseñar
  const gone = sel.kind === 'loot' ? !loot[sel.i] : sel.kind === 'gear' ? !(sel.g === 'flashlight' ? inv.spares > 0 : inv[sel.g]) : sel.kind === 'spare' ? inv.spares < 1 : sel.kind === 'water' ? inv.water < 1 : sel.kind === 'ammo' ? !inv.gun || !inv.spare : sel.kind === 'tank' ? !inv.tank : sel.kind === 'hot' ? !HOT[sel.id].have(inv) : false;
  // el detalle de lo elegido
  const detail = (() => {
    if (gone) return { title: 'NOTHING SELECTED', lines: ['Pick something from the backpack.'], icon: '' };
    if (sel.kind === 'loot') {
      const q = loot[sel.i];
      return q
        ? { title: `${rarity(q.r).name} ARTIFACT`, lines: [`CONDITION ${Math.round((1 - q.w) * 100)}%`, `SELLS FOR $${lootPrice(q)}`, 'It wears out while you carry it. Drop it on the scale in the waiting room to sell it.'], icon: lootIcon(q.r) }
        : { title: 'ARTIFACT', lines: ['SOLD OR DROPPED'], icon: '' };
    }
    if (sel.kind === 'tank') return { title: 'DIVING TANK', lines: [!st.back ? 'NEEDS THE HARNESS UPGRADE TO WEAR IT' : inv.tankOn ? 'WORN ON THE BACK' : 'IN THE BACKPACK', SHOP.find((s) => s.id === 'tank')?.info ?? ''], icon: icons.tank };
    if (sel.kind === 'tape') return { title: 'VHS TAPE', lines: [`COLLECTED ${inv.tapes}/8`, 'Recorded tapes. Find them all.'], icon: icons.tape };
    if (sel.kind === 'spare') return { title: 'SPARE FLASHLIGHT', lines: [`×${inv.spares} IN THE BACKPACK`, 'Swaps in when the battery dies.'], icon: icons.spare };
    if (sel.kind === 'water') return { title: HOT.water.name, lines: [`×${inv.water} CARRIED`, HOT.water.info, 'Drag it to the quick access bar.'], icon: icons.water };
    if (sel.kind === 'hot') return { title: HOT[sel.id].name, lines: [HOT[sel.id].info, 'Drag it to the quick access bar.'], icon: icons[HOT[sel.id].icon] };
    if (sel.kind === 'ammo') return { title: 'RIFLE AMMO', lines: [`${inv.spare} IN RESERVE`, 'Reloads the rifle (R).'], icon: icons.ammo };
    const g = (sel as { g: Gear }).g; // lo demás ya volvió arriba
    const lines =
      g === 'flashlight'
        ? [`BATTERY ${Math.round(inv.charge * 100)}%`, inv.flashOn ? 'ON' : 'OFF', 'Lights the way. [F] switches it.']
        : g === 'camera'
          ? [`BATTERY ${Math.round(inv.battery * 100)}%`, `PHOTOS ${inv.photos}/2`, 'Hold it, right click, click.']
          : [`AMMO ${inv.ammo}/${RIFLE_MAG} +${inv.spare}`, 'Right click to aim, click to fire.'];
    return { title: label(g), lines, icon: icons[g] };
  })();

  // lo elegido en 3D: su modelo, su rareza y su estado
  const viewKey: IconKey | 'loot' | null = gone ? null : sel.kind === 'loot' ? 'loot' : sel.kind === 'gear' ? sel.g : sel.kind === 'hot' ? HOT[sel.id].icon : sel.kind;
  const selItem: Item | undefined = sel.kind === 'gear' ? sel.g : sel.kind === 'hot' ? sel.id : sel.kind === 'loot' ? 'loot' : sel.kind;
  const selId = selItem && SHOP_ID[selItem];
  const selQ: Qual | undefined = gone ? undefined : sel.kind === 'loot' ? loot[sel.i] : selId ? (perks.q[selId] ?? { r: 0, w: 0 }) : undefined;
  const goals: [string, number, number][] = [
    ['FIND A CAMCORDER', inv.camera ? 1 : 0, 1],
    ['FIND VHS TAPES', inv.tapes, 8],
    ['PHOTOGRAPH ENTITIES', inv.photos, 2],
    ['REACH THE ELEVATOR', inv.escaped ? 1 : 0, 1],
  ];
  const worn = { left: inv.left, hand: inv.hand === 'watergun' ? 'none' : inv.hand, belt: inv.belt };

  return (
    <div
      className="br-inv"
      role="dialog"
      aria-label="Inventory"
      hidden={!open}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="br-inv__tabs" role="tablist">
        <button type="button" role="tab" className="br-opt" aria-selected={tab === 'items'} onClick={() => setTab('items')}>
          CHARACTER
        </button>
        <button type="button" role="tab" className="br-opt" aria-selected={tab === 'photos'} onClick={() => setTab('photos')}>
          PHOTOS {inv.thumbs.length}
        </button>
        <button type="button" className="br-opt br-inv__exit" onClick={onClose}>
          EXIT [E]
        </button>
      </div>
      {tab === 'items' ? (
        <div className="iv">
          <section className="iv-col" aria-label="Equipment">
            <p className="br-inv__head">EQUIPMENT</p>
            <div className="iv-eq">
              <div className="iv-side">
                {headSlot}
                {backSlot}
              </div>
              <InvAvatar assets={assets} look={look} worn={worn} reduced={reduced} active={open && tab === 'items'} />
              <div className="iv-side">
                <div className="iv-slot" data-where="left" data-fits={(held && fits('left', held.g)) || undefined} data-over={(over === 'left' && held && fits('left', held.g)) || undefined}>
                  <span className="iv-label">SECONDARY HAND</span>
                  {at.left !== 'none' ? gear(at.left, 'left') : <span className="iv-empty">NONE</span>}
                </div>
              </div>
            </div>
            <p className="br-inv__keys">DRAG THE CHARACTER TO TURN IT. DRAG A FLASHLIGHT TO THE SECONDARY HAND. EVERYTHING ELSE GOES ON THE QUICK BAR.</p>
          </section>

          <section className="iv-col" aria-label="Backpack">
            <p className="br-inv__head iv-between">
              <span>BACKPACK</span>
              <span>
                {cells}/{st.cells}
              </span>
            </p>
            <div className="iv-grid" data-where="store" data-fits={(held && !inPack(held.from)) || undefined} data-over={(over === 'store' && held && !inPack(held.from)) || undefined}>
              {grid.map((c, i) => {
                const w = `cell${i}` as const;
                return (
                  <div key={i} className="iv-cell" data-locked={i >= st.cells || undefined} data-where={i < st.cells ? w : undefined} data-fits={(i < st.cells && held) || undefined} data-over={(over === w && held) || undefined}>
                    {c && gear(c.k, w, STACK.has(c.k) ? c.n : undefined)}
                  </div>
                );
              })}
            </div>
            <p className="br-inv__keys">DRAG TO ARRANGE. SHIFT+DRAG SPLITS ONE. DROP OUTSIDE TO THROW IT. DOUBLE CLICK EQUIPS. ESC CANCELS. LOCKED CELLS AND SLOTS OPEN WITH UPGRADES AT THE TERMINAL.</p>
          </section>

          <section className="iv-col" aria-label="Details">
            <p className="br-inv__head">DETAILS</p>
            <div className="iv-detail">
              {selQ && (
                <div className="iv-card" data-r={selQ.r} style={{ '--rar': hex(selQ.r) } as React.CSSProperties}>
                  <span className="iv-tip__banner">{rarity(selQ.r).name}</span>
                </div>
              )}
              <div className="iv-detail__icon">
                {viewKey && assets && open && tab === 'items' ? <ItemView assets={assets} kind={viewKey} r={selQ?.r ?? 0} /> : detail.icon ? <img src={detail.icon} alt="" /> : <span className="br-osd__dim">∅</span>}
              </div>
              <div>
                <p className="iv-detail__t">{detail.title}</p>
                {selQ && selItem && (
                  <span className="iv-tip__rows iv-card__rows">
                    {selId && SUBS[selId] ? <Subs id={selId} q={selQ} /> : selId && ITEMS[selId].boost && (
                      <>
                        <span>{ITEMS[selId].boost}</span>
                        <span data-up={rarity(selQ.r).boost > 1 || undefined}>{rarity(selQ.r).boost > 1 ? `+${Math.round((rarity(selQ.r).boost - 1) * 100)}%` : '—'}</span>
                      </>
                    )}
                    <span>CONDITION</span>
                    <span data-low={Math.round((1 - selQ.w) * 100) < 40 || undefined}>
                      <i className="iv-tip__bar"><i style={{ width: `${Math.round((1 - selQ.w) * 100)}%` }} /></i>
                      {Math.round((1 - selQ.w) * 100)}%
                    </span>
                    <span>SELLS FOR</span>
                    <span className="iv-tip__price">${selItem === 'loot' ? lootPrice(selQ) : selId ? sellPrice(selId, selQ) : 0}</span>
                  </span>
                )}
                {detail.lines.map((l) => (
                  <p key={l} className="iv-detail__l">
                    {l}
                  </p>
                ))}
                {sel.kind === 'water' && (
                  <button type="button" className="br-opt br-inv__switch" onClick={() => onUse('water')} disabled={inv.water <= 0}>
                    DRINK
                  </button>
                )}
                {sel.kind === 'tank' && inv.tank && st.back && (
                  <button type="button" className="br-opt br-inv__switch" onClick={() => onTank?.(!inv.tankOn)}>
                    {inv.tankOn ? 'TAKE OFF' : 'PUT ON'}
                  </button>
                )}
                {sel.kind === 'gear' && sel.g === 'flashlight' && at.left === 'flashlight' && (
                  <button type="button" className="br-opt br-inv__switch" onClick={onLight}>
                    {inv.charge <= 0 ? (inv.spares ? 'NEW BATTERY' : 'DEAD') : inv.flashOn ? 'SWITCH OFF' : 'SWITCH ON'}
                  </button>
                )}
              </div>
            </div>
            <p className="br-inv__head">TAPES {inv.tapes}/8</p>
            <ul className="br-inv__goals">
              {goals.map(([t, n, of]) => (
                <li key={t} data-done={n >= of || undefined}>
                  <span>{t}</span>
                  <span>
                    {n}/{of}
                  </span>
                </li>
              ))}
            </ul>
            <p className="br-inv__head">BIOMETRICS</p>
            <ul className="br-inv__goals">
              <li data-low={inv.sanity < 0.3 || undefined}>
                <span>SANITY</span>
                <Bar v={inv.sanity} />
              </li>
              <li data-low={inv.stamina < 0.25 || undefined}>
                <span>STAMINA</span>
                <Bar v={inv.stamina} />
              </li>
            </ul>
          </section>

          <section className="iv-col iv-hot" aria-label="Quick access">
            <p className="br-inv__head">QUICK ACCESS. [1-4] USE. WHEEL SELECTS. [X] USES THE SELECTED.</p>
            <div className="iv-hotrow">
              {Array.from({ length: HOT_SLOTS }, (_, i) => {
                // solo lo que se lleva: una ranura con algo ya soltado o aún sin coger se ve vacía (como en la barra del HUD)
                const w = `hot${i}` as const, d = inv.hot[i] ? HOT[inv.hot[i]!] : undefined, id = d?.have(inv) ? inv.hot[i] : null;
                return (
                  <div key={i} className="iv-slot" data-locked={i >= st.hot || undefined} data-where={i < st.hot ? w : undefined} data-fits={(i < st.hot && held && hotable(held.g)) || undefined} data-over={(over === w && held && hotable(held.g)) || undefined} data-sel={(i < st.hot && inv.hotSel === i) || undefined}>
                    <span className="iv-label">{i + 1}</span>
                    {i >= st.hot ? <span className="iv-empty">LOCKED</span> : d && id ? gear(id as Item, w, id === 'water' ? inv.water - waterBag : d.count?.(inv)) : <span className="iv-empty">EMPTY</span>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : inv.thumbs.length ? (
        <div className="br-inv__photos">
          {inv.thumbs.map((src, i) => (
            <button key={i} type="button" className="br-inv__photo" onClick={() => setZoom(i)} aria-label={`Photo ${i + 1}: enlarge`}>
              <img src={src} alt="" width={160} height={120} />
            </button>
          ))}
        </div>
      ) : (
        <p className="br-inv__head">NO PHOTOS. HOLD THE CAMCORDER, RIGHT CLICK, CLICK.</p>
      )}
      {zoom !== null && inv.full[zoom] && (
        <div className="br-zoom" role="dialog" aria-label={`Photo ${zoom + 1}`} onClick={() => setZoom(null)}>
          <p className="br-zoom__head">
            PHOTO {zoom + 1}/{inv.full.length}
          </p>
          <img className="br-zoom__img" src={inv.full[zoom]} alt={`Photo ${zoom + 1}`} onClick={(e) => e.stopPropagation()} />
          <div className="br-zoom__bar" onClick={(e) => e.stopPropagation()}>
            {inv.full.length > 1 && (
              <button type="button" className="br-opt" onClick={() => setZoom((zoom + inv.full.length - 1) % inv.full.length)}>
                PREV
              </button>
            )}
            {inv.full.length > 1 && (
              <button type="button" className="br-opt" onClick={() => setZoom((zoom + 1) % inv.full.length)}>
                NEXT
              </button>
            )}
            <a className="br-opt" href={inv.full[zoom]} download={`backrooms-photo-${zoom + 1}.jpg`}>
              DOWNLOAD
            </a>
            <button type="button" className="br-opt" autoFocus onClick={() => setZoom(null)}>
              BACK [ESC]
            </button>
          </div>
        </div>
      )}
      {held && (
        <div ref={ghostEl} className="iv-ghost" data-drop={out || undefined} style={{ transform: `translate(${pos.current.x}px, ${pos.current.y}px)` }} aria-hidden="true">
          <img src={icons[held.g as IconKey]} alt="" />
          {out && <span className="iv-ghost__drop">DROP</span>}
        </div>
      )}
    </div>
  );
}

// cerrado no se vuelve a pintar (el estado del juego llega diez veces por segundo): al abrirlo ya está montado
export default memo(Inventory, (a, b) => !a.open && !b.open);
