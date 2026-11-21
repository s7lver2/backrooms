'use client';
import { useEffect, useState } from 'react';
import { ITEMS, ITEM_IDS, hasItem, rarity, type Inventory, type ItemId, type Stashed } from '@backrooms/shared';
import type { Sock } from '../net';
import { sound } from './audio';
import type { Assets } from './game';
import { useIcons } from './invIcons';
import './shopgrid.css';
import './lockers.css';

/*
 * Mi casillero de la sala de espera, con el mismo aspecto que la tienda de los NPC: arriba, las ranuras del casillero (clic = sacar); debajo, lo que llevo
 * (clic = guardar). La cámara mira al casillero con la puerta abierta (waiting.ts) y lo guardado se ve dentro. Lo que se guarda lo lleva el servidor.
 */
const COLS = 5;
const name = (k: string) => (k === 'loot' ? 'ARTIFACT' : (ITEMS[k as ItemId]?.name ?? k)).toUpperCase();
const hex = (r: number) => '#' + rarity(r).color.toString(16).padStart(6, '0');

export default function LockersPanel({ sock, inv, assets, onClose }: { sock: Sock; inv: Inventory; assets?: Assets; onClose: () => void }) {
  const [slots, setSlots] = useState<(Stashed | null)[]>([null, null]);
  const [mineIdx, setMineIdx] = useState(0);
  const [note, setNote] = useState<{ t: string; bad: boolean }>({ t: '', bad: false });
  const [sel, setSel] = useState<string>('');
  const icons = useIcons(assets);
  useEffect(() => {
    const on = (l: (Stashed | null)[], m: number) => (setSlots(l), setMineIdx(m));
    sock.on('stash', on);
    sock.emit('stashTake', -1);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => (sock.off('stash', on), removeEventListener('keydown', key));
  }, [sock, onClose]);
  const bagItems: { kind: ItemId | 'loot'; index: number }[] = [
    ...ITEM_IDS.filter((k) => k !== 'pills' && hasItem(inv, k)).map((kind) => ({ kind, index: 0 })),
    ...(inv.loot ?? []).map((_, index) => ({ kind: 'loot' as const, index })),
  ];
  const used = slots.filter(Boolean).length;
  const put = (kind: ItemId | 'loot', index: number) => sock.emit('stashPut', kind, index, (ok) => (sound(ok ? 'bag' : 'denied'), setNote({ t: ok ? `STORED ${name(kind)}` : 'LOCKER FULL', bad: !ok })));
  const take = (slot: number) => sock.emit('stashTake', slot, (ok) => (sound(ok ? 'bag' : 'denied'), setNote({ t: ok ? 'TAKEN' : 'NO ROOM IN YOUR BAG', bad: !ok })));
  const cell = (key: string, kind: string | null, q: { r: number } | undefined, onClick?: () => void, tag?: string) => (
    <button key={key} type="button" className="sg__cell" data-empty={!kind || undefined} disabled={!kind} data-sel={sel === key || undefined} style={q ? { borderColor: hex(q.r) } : undefined} onPointerEnter={() => setSel(key)} onClick={onClick} aria-label={kind ? name(kind) : 'Empty slot'}>
      {kind && icons && kind !== 'loot' && icons[kind as ItemId] ? <img src={icons[kind as ItemId]} alt="" draggable={false} /> : kind ? <span className="lk__txt">{name(kind)}</span> : null}
      {tag && <span className="sg__price">{tag}</span>}
    </button>
  );
  const pad = (n: number) => Array.from({ length: Math.max(0, COLS - (n % COLS || COLS)) }, (_, i) => <span key={'p' + i} className="sg__cell" data-empty />);
  const sl = sel.startsWith('s') ? slots[Number(sel.slice(1))] : null, bi = sel.startsWith('b') ? bagItems[Number(sel.slice(1))] : null;
  const info = sl ? { kind: sl.kind as string, q: sl.q } : bi ? { kind: bi.kind as string, q: bi.kind === 'loot' ? inv.loot?.[bi.index] : inv.q?.[bi.kind] } : null;
  return (
    <aside className="sg lk" role="dialog" aria-label="Locker">
      <header className="sg__head">
        <b>LOCKER {mineIdx + 1}</b>
        <span className="sg__bank">
          {used}/{slots.length}
        </span>
      </header>
      <div className="sg__grid">
        {slots.map((s, i) => cell('s' + i, s?.kind ?? null, s?.q, () => take(i), s ? '←' : undefined))}
        {pad(slots.length)}
      </div>
      <header className="sg__head lk__sub">
        <b>YOUR BAG</b>
      </header>
      <div className="sg__grid">
        {bagItems.map((m, i) => cell('b' + i, m.kind, m.kind === 'loot' ? inv.loot?.[m.index] : inv.q?.[m.kind], () => put(m.kind, m.index), '→'))}
        {pad(bagItems.length)}
      </div>
      <div className="sg__info" role="status">
        {info && (
          <p>
            <b>{name(info.kind)}</b> {info.q && <span style={{ color: hex(info.q.r) }}>{rarity(info.q.r).name?.toUpperCase?.()}</span>}
          </p>
        )}
        <p className="sg__msg" data-bad={note.bad || undefined}>
          {note.t || (bagItems.length ? 'CLICK AN ITEM TO MOVE IT · E TO CLOSE' : 'NOTHING TO STORE · E TO CLOSE')}
        </p>
        <p className="sg__dim">MORE SLOTS: LOCKER UPGRADE IN THE TERMINAL</p>
      </div>
    </aside>
  );
}
