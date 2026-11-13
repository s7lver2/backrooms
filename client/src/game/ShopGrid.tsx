import { useEffect, useMemo, useRef, useState } from 'react';
import { INV_MAX, ITEMS, canHold, facelingStock, type ShopItem, type Inventory, type ItemId } from '@backrooms/shared';
import type { Sock } from '../net';
import { sound } from './audio';
import type { Assets } from './game';
import { gearIcons } from './invIcons';
import { perks } from './perks';
import './shopgrid.css';

/*
 * La tienda del Faceling de recepción: una cuadrícula como la mochila, con muchas casillas vacías y unas pocas con productos. Pasar el ratón por una
 * da su información; mantener el clic la compra (la casilla se va llenando). La cámara del juego enseña al Faceling de lado a la izquierda.
 */

const COLS = 5, HOLD_MS = 650; // una cuadrícula cuadrada de casillas cuadradas

export default function ShopGrid({ bank, inv, sock, assets, open, seed, floor, onBought }: { seed: number; floor?: number; bank: number; inv: Inventory | null; sock?: Sock; assets?: Assets; open?: ReadonlySet<string>; onBought?: (id: ItemId) => void }) {
  const icons = useMemo(() => (assets ? gearIcons(assets) : null), [assets]);
  const key = open ? [...open].sort().join() : '';
  const stock = useMemo(() => facelingStock(seed, floor ?? 1, open), [seed, floor, key]); // eslint-disable-line react-hooks/exhaustive-deps
  // dónde va cada producto: casillas al azar (distintas en cada visita) de la cuadrícula
  const rows = COLS;
  const cells = useMemo(() => {
    const n = COLS * rows, order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    return new Map(stock.map((s, i) => [order[i], s] as const));
  }, [stock, rows]);
  const [hover, setHover] = useState<ItemId | null>(null);
  const [hold, setHold] = useState<{ id: ItemId; p: number } | null>(null);
  const [msg, setMsg] = useState<{ t: string; bad: boolean }>({ t: '', bad: false });
  const raf = useRef(0), busy = useRef(false);
  const have = (id: ItemId) => (inv ? Number(inv[ITEMS[id].slot]) : 0);
  const cap = (id: ItemId) => (typeof INV_MAX[ITEMS[id].slot] === 'number' ? Number(INV_MAX[ITEMS[id].slot]) : 1);
  const why = (id: ItemId, price: number) => (!inv ? 'LOADING' : !canHold(inv, id) ? 'MAX' : !canHold(inv, id, perks.stats) ? 'NO SPACE' : bank < price ? 'NO FUNDS' : '');

  const buy = (id: ItemId, name: string) => {
    if (!sock || busy.current) return;
    busy.current = true;
    sock.emit('buy', id, (r) => {
      busy.current = false;
      sound(r.ok ? 'buy' : 'denied');
      if (r.ok) onBought?.(id);
      setMsg(r.ok ? { t: `BOUGHT ${name}`, bad: false } : { t: (r.error ?? 'COULD NOT BUY').toUpperCase(), bad: true });
    });
    setTimeout(() => (busy.current = false), 2000);
  };
  const stop = () => (cancelAnimationFrame(raf.current), setHold(null));
  const start = (s: ShopItem) => {
    const w = why(s.id, s.price);
    if (w) return sound('denied'), setMsg({ t: w, bad: true });
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setHold({ id: s.id, p });
      if (p < 1) raf.current = requestAnimationFrame(step);
      else (buy(s.id, s.name), setHold(null));
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const sel = stock.find((s) => s.id === (hover ?? stock[0]?.id));

  return (
    <aside className="sg" aria-label="Reception shop">
      <header className="sg__head">
        <b>RECEPTION</b>
        <span className="sg__bank">${bank}</span>
      </header>
      <div className="sg__grid" onPointerLeave={() => (stop(), setHover(null))}>
        {Array.from({ length: COLS * rows }, (_, i) => {
          const s = cells.get(i);
          if (!s) return <span key={i} className="sg__cell" data-empty />;
          const off = why(s.id, s.price);
          const prog = hold?.id === s.id ? hold.p : 0;
          return (
            <button
              key={i}
              type="button"
              className="sg__cell"
              data-off={!!off || undefined}
              data-sel={sel?.id === s.id || undefined}
              style={{ ['--p' as string]: prog }}
              onPointerEnter={() => setHover(s.id)}
              onPointerDown={(e) => (e.preventDefault(), start(s))}
              onPointerUp={stop}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), buy(s.id, s.name))}
              aria-label={`${s.name}, $${s.price}. Hold to buy`}
            >
              {icons && <img src={icons[s.id]} alt="" draggable={false} />}
              <span className="sg__price">${s.price}</span>
            </button>
          );
        })}
      </div>
      <div className="sg__info" role="status">
        {sel ? (
          <>
            <b>{sel.name}</b> <span className="sg__price2">${sel.price}</span>
            <p>{sel.info}</p>
            <p className="sg__dim">
              CARRY {have(sel.id)}/{cap(sel.id)} {why(sel.id, sel.price) && <em>· {why(sel.id, sel.price)}</em>}
            </p>
          </>
        ) : null}
        <p className="sg__msg" data-bad={msg.bad || undefined}>{msg.t || 'HOLD A PRODUCT TO BUY IT · E TO LEAVE'}</p>
      </div>
    </aside>
  );
}
