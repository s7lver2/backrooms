import { useMemo, useState } from 'react';
import { AMMO_PACK, INV_MAX, ITEMS, SHOP, canHold, itemOpen, type Inventory, type ItemId } from '@backrooms/shared';
import type { Sock } from '../net';
import { sound } from './audio';
import type { Assets } from './game';
import { gearIcons } from './invIcons';
import { perks } from './perks';

/*
 * La tienda del ordenador: una fila por objeto (icono, nombre y descripción, lo que llevas, precio y BUY), pagada con el dinero común
 * de la sala. El saldo sale de `room.bank`, que el servidor actualiza al comprar: se ve en vivo, también cuando compra otro.
 */

export default function Shop({ bank, inv, sock, assets, open }: { bank: number; inv: Inventory | null; sock?: Sock; assets?: Assets; open?: ReadonlySet<string> }) {
  const icons = useMemo(() => (assets ? gearIcons(assets) : null), [assets]);
  const [msg, setMsg] = useState<{ t: string; bad: boolean }>({ t: '', bad: false });
  const [busy, setBusy] = useState(false);
  const buy = (id: ItemId, name: string) => {
    if (!sock || busy) return;
    setBusy(true);
    sock.emit('buy', id, (r) => {
      setBusy(false);
      sound(r.ok ? 'buy' : 'denied');
      setMsg(r.ok ? { t: `BOUGHT ${name}`, bad: false } : { t: (r.error ?? 'COULD NOT BUY').toUpperCase(), bad: true });
    });
    // sin respuesta del servidor no se queda bloqueado
    setTimeout(() => setBusy(false), 2000);
  };
  const cap = (id: ItemId) => (typeof INV_MAX[ITEMS[id].slot] === 'number' ? Number(INV_MAX[ITEMS[id].slot]) : 1);
  const have = (id: ItemId) => (inv ? Number(inv[ITEMS[id].slot]) : 0);
  return (
    <div className="br-shop">
      <p className="br-shop__bank">
        <span className="br-lobby__dim">TEAM BANK</span>
        <b>${bank}</b>
        <span className="br-lobby__dim br-shop__note">SHARED BY THE TEAM</span>
      </p>
      <ul className="br-shop__grid" aria-label="Items for sale">
        {SHOP.filter((s) => !open || itemOpen(s.id, open)).map((s) => { // (lo de un nivel sin desbloquear no se ofrece)
          const max = !!inv && !canHold(inv, s.id), full = !!inv && !canHold(inv, s.id, perks.stats), poor = bank < s.price; // (el tope de cada cosa, o sin sitio en la mochila)
          const why = max ? 'MAX' : full ? 'NO SPACE' : poor ? 'NO FUNDS' : '';
          const n = have(s.id), m = cap(s.id);
          return (
            <li key={s.id} data-off={!!why || undefined} data-poor={(poor && !full) || undefined}>
              <span className="br-shop__top">
                <span className="br-shop__ic">{icons && <img src={icons[s.id]} alt="" draggable={false} />}</span>
                <span className="br-shop__price">${s.price}</span>
              </span>
              <b className="br-shop__name">{s.name}</b>
              <span className="br-lobby__dim br-shop__info">{s.info}</span>
              <span className="br-shop__own" aria-label={`You carry ${n} of ${m}`}>
                <span className="br-lobby__dim">CARRY </span>
                {m <= 15 ? (
                  <>
                    {'▮'.repeat(Math.min(n, m))}
                    <span className="br-lobby__dim">{'▮'.repeat(Math.max(0, m - n))}</span>
                  </>
                ) : null}
                {m > 15 ? `${n}/${m}` : ''}
              </span>
              <button type="button" className="br-opt" data-nav disabled={!!why || !inv || busy} onClick={() => buy(s.id, s.name)} aria-label={`Buy ${s.name} for $${s.price}`}>
                {why || 'BUY'}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="br-lobby__sub" role={msg.bad ? 'alert' : 'status'} data-bad={msg.bad || undefined}>
        {msg.t || `BOUGHT ITEMS GO IN YOUR BACKPACK WITH A RANDOM RARITY. AMMO COMES IN PACKS OF ${AMMO_PACK}.`}
      </p>
    </div>
  );
}
