import { useCallback, useEffect, useRef, useState } from 'react';
import { DIFFICULTY, NAME_MAX, type Difficulty, type Joined, type RoomInfo, type SaveInfo } from '@backrooms/shared';
import type { Net, Link, Server } from '../net';
import { DIFF } from './RoomSettings';

/*
 * La lista de salas, como cintas de vídeo: cada sala es una cinta (TAPE 031). Mismo OSD de los 90 que el
 * resto, sin cajas: el nombre, la lista de cintas, crear y unirse por código. Al entrar en una sala ya no
 * se ve esto: Backrooms.tsx monta la sala de espera 3D (waiting.ts); los ajustes viven en RoomSettings.tsx.
 */

const LINK: Record<Link, string> = {
  connecting: 'CONNECTING…',
  waking: 'WAKING SERVER…',
  online: 'ONLINE',
  offline: 'OFFLINE',
};
const tape = (n: number) => String(n).padStart(3, '0');
const DIFF_FILTER: (Difficulty | 'all')[] = ['all', 'easy', 'normal', 'hard'];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** El aviso del servidor: en mantenimiento, con su mensaje y, si está anunciado, cuándo empieza; o sin respuesta. Nada si todo va bien. */
export function ServerNotice({ server }: { server: Server }) {
  const when = server.at ? new Date(server.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
  const msg = server.message && ` · ${server.message.toUpperCase()}`;
  if (server.state === 'maintenance')
    return (
      <p className="br-notice" role="status" data-bad>
        ● SERVERS UNDER MAINTENANCE{msg}
      </p>
    );
  if (server.state === 'down')
    return (
      <p className="br-notice" role="status" data-bad>
        ● SERVER NOT RESPONDING · YOU CAN PLAY SOLO
      </p>
    );
  if (server.at)
    return (
      <p className="br-notice" role="status">
        ● SCHEDULED MAINTENANCE · {when}
        {msg}
      </p>
    );
  return null;
}

export default function Lobby({ net, onSolo, server, error, account }: { net: Net; onSolo: () => void; server: Server; error?: string; account?: string }) {
  const { sock, link, room, setRoom } = net;
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('br-name') ?? '';
    } catch {
      return '';
    }
  });
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  // mis salas guardadas (solo con cuenta) y la que se está a punto de borrar (pide un segundo clic)
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [del, setDel] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [hideFull, setHideFull] = useState(false);
  const [diff, setDiff] = useState<Difficulty | 'all'>('all');
  const [sort, setSort] = useState<'players' | 'name'>('players');
  const [sel, setSel] = useState(0);
  const [ping, setPing] = useState<number | null>(null);
  const ready = link === 'online' && !!sock && server.state !== 'maintenance';

  const remember = (n: string) => {
    setName(n);
    try {
      localStorage.setItem('br-name', n);
    } catch {}
  };
  const joined = useCallback((r: Joined) => ('error' in r ? setErr(r.error.toUpperCase()) : (setErr(''), setRoom(r.room))), [setRoom]);
  const nick = account || name.trim() || 'anon'; // con cuenta, el nombre es el de la cuenta (el servidor lo impone)
  // la lista de cintas; lo que tarda en volver es el ping al servidor
  const refresh = useCallback(() => {
    const t = performance.now();
    sock?.emit('list', (r) => (setRooms(r), setPing(Math.round(performance.now() - t))));
    if (account) sock?.emit('saves', setSaves);
  }, [sock, account]);
  const join = (c: string) => sock!.emit('join', { code: c, name: nick }, joined);
  const joinable = (r: RoomInfo) => r.phase === 'lobby' && r.count < r.max;
  const shown = rooms
    .filter((r) => {
      const t = q.trim().toLowerCase();
      return (!t || [r.name, r.owner, r.code, `tape ${tape(r.tape)}`].some((x) => x.toLowerCase().includes(t))) && (!hideFull || joinable(r)) && (diff === 'all' || r.difficulty === diff);
    })
    .sort((a, b) => Number(joinable(b)) - Number(joinable(a)) || (sort === 'name' ? a.name.localeCompare(b.name) : b.count - a.count || a.tape - b.tape));
  // entrada rápida: la sala pública con hueco más llena; si no hay, una nueva
  const quick = () => {
    const best = rooms.filter(joinable).sort((a, b) => b.count - a.count)[0];
    best ? join(best.code) : sock!.emit('create', { name: nick, public: true }, joined);
  };
  // teclado: ↑ ↓ eligen sala de la lista (también escribiendo en la búsqueda) e Intro entra
  const list = useRef<HTMLUListElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pane.current?.focus({ preventScroll: true });
  }, [room]); // para que ↑ ↓ funcionen nada más entrar
  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (el.tagName === 'INPUT' && !el.classList.contains('br-find__q')) return; // el campo del código o del nombre
      e.preventDefault();
      const n = Math.min(Math.max(0, shown.length - 1), Math.max(0, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      setSel(n);
      if (el.closest('.br-rooms')) list.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.focus();
    } else if (e.key === 'Enter' && el.classList.contains('br-find__q') && shown[sel] && joinable(shown[sel])) {
      e.preventDefault();
      join(shown[sel].code);
    }
  };
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel, shown.length]);

  // la lista de cintas: al entrar y cada 3 s
  useEffect(() => {
    if (!ready || room) return;
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [ready, room, refresh]);

  // con sala, lo que se ve es la sala de espera (3D): esto solo dura el fotograma del cambio
  if (room) return null;
  const [pick, setPick] = useState<boolean | null>(null); // el aviso para elegir la dificultad de la sala nueva (true: pública)
  const create = (pub: boolean, difficulty: Difficulty) => (setPick(null), sock!.emit('create', { name: nick, public: pub, difficulty }, joined));
  return (
    <div className="br-pane br-pane--rooms" role="region" aria-label="Rooms" tabIndex={-1} ref={pane} onKeyDown={onKey}>
      <div className="br-toolbar">
        {!account && (
          <label className="br-lobby__row">
            NAME
            <input className="br-field br-field--name" value={name} maxLength={NAME_MAX} placeholder="ANON" autoComplete="off" onChange={(e) => remember(e.target.value)} />
          </label>
        )}
        <label className="br-lobby__row">
          SEARCH
          <input className="br-field br-find__q" value={q} placeholder="NAME, PLAYER OR CODE" autoComplete="off" onChange={(e) => (setQ(e.target.value), setSel(0))} />
        </label>
        <button type="button" className="br-opt" aria-pressed={hideFull} onClick={() => setHideFull(!hideFull)}>
          HIDE FULL: {hideFull ? 'YES' : 'NO'}
        </button>
        <button type="button" className="br-opt" onClick={() => setDiff(DIFF_FILTER[(DIFF_FILTER.indexOf(diff) + 1) % DIFF_FILTER.length])}>
          DIFFICULTY: {diff === 'all' ? 'ALL' : DIFF[diff]}
        </button>
        <button type="button" className="br-opt" onClick={() => setSort(sort === 'players' ? 'name' : 'players')}>
          SORT: {sort === 'players' ? 'PLAYERS' : 'NAME'}
        </button>
        <span className="br-toolbar__end">
          <span className="br-lobby__link" data-link={link}>
            {LINK[link]}
          </span>
          <span className="br-lobby__dim">
            {ping != null && ` · PING ${ping} MS`} · {rooms.length} {rooms.length === 1 ? 'TAPE' : 'TAPES'}
          </span>
        </span>
      </div>
      {(err || error) && (
        <p className="br-lobby__err" role="alert">
          {err || error}
        </p>
      )}
      <div className="br-rooms" role="group" aria-label="Public rooms">
        <p className="br-rooms__row br-rooms__head" aria-hidden="true">
          <span>TAPE</span>
          <span>NAME</span>
          <span>OWNER</span>
          <span>DIFFICULTY</span>
          <span>PLAYERS</span>
          <span>STATUS</span>
        </p>
        <ul className="br-rooms__list" ref={list}>
          {shown.map((r, i) => {
            const ok = joinable(r);
            return (
              <li key={r.code}>
                <button type="button" className="br-rooms__row" data-i={i} aria-selected={i === sel} disabled={!ok} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => join(r.code)}>
                  <span>{tape(r.tape)}</span>
                  <span className="br-tape__name">{r.name}</span>
                  <span className="br-rooms__dim">{r.owner || '—'}</span>
                  <span>
                    {DIFF[r.difficulty]}
                    {r.seeded && ' ·S'}
                  </span>
                  <span>
                    {r.count}/{r.max}
                  </span>
                  <span className="br-rooms__dim">{ok ? 'WAITING' : r.phase === 'starting' ? 'STARTING' : r.phase !== 'lobby' ? `IN PROGRESS ${clock(r.age)}` : 'FULL'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!shown.length && <p className="br-rooms__empty">{!ready ? 'NOT CONNECTED' : rooms.length ? 'NO TAPE MATCHES' : 'NO TAPES · CREATE THE FIRST'}</p>}
      </div>
      {!!saves.length && (
        <div className="br-saves" role="group" aria-label="My saved rooms">
          <p className="br-lobby__dim br-saves__h">MY SAVED ROOMS · BANK, ROUND AND UPGRADES ARE KEPT</p>
          <ul>
            {saves.map((s) => (
              <li key={s.code}>
                <span className="br-tape__name">{s.name}</span>
                <span className="br-rooms__dim">{s.code}</span>
                <span>${s.bank}</span>
                <span className="br-rooms__dim">ROUND {s.round}</span>
                <button type="button" className="br-opt" disabled={!ready} onClick={() => sock!.emit('create', { name: nick, public: false, resume: s.code }, joined)}>
                  {s.live ? 'REJOIN' : 'RESUME'}
                </button>
                <button type="button" className="br-opt" disabled={!ready || s.live} onClick={() => (del === s.code ? (setDel(''), sock!.emit('unsave', s.code, refresh)) : setDel(s.code))}>
                  {del === s.code ? 'SURE? DELETE' : 'DELETE'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="br-actions" role="group" aria-label="Actions">
        <button type="button" className="br-opt" disabled={!ready} onClick={quick}>
          QUICK JOIN
        </button>
        <button type="button" className="br-opt" disabled={!ready} onClick={() => setPick(true)}>
          NEW PUBLIC ROOM
        </button>
        <button type="button" className="br-opt" disabled={!ready} onClick={() => setPick(false)}>
          NEW PRIVATE ROOM
        </button>
        <button type="button" className="br-opt" onClick={onSolo}>
          PLAY SOLO
        </button>
        <form
          className="br-actions__code"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length >= 3) join(code);
          }}
        >
          CODE
          <input className="br-field br-field--code" value={code} maxLength={5} placeholder="ABCDE" aria-label="Room code" autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
          <button type="submit" className="br-opt" disabled={!ready || code.length < 3}>
            JOIN
          </button>
        </form>
        <span className="br-lobby__dim br-lobby__keys">↑ ↓ SELECT · ENTER JOIN</span>
      </div>
      {pick !== null && (
        <aside className="br-board" role="dialog" aria-label="Room difficulty" onKeyDown={(e) => e.key === 'Escape' && setPick(null)}>
          <p className="br-board__bar">
            <span>ROOM DIFFICULTY</span>
            <span className="br-lobby__dim">{pick ? 'PUBLIC' : 'PRIVATE'} ROOM</span>
            <button type="button" className="br-opt" autoFocus onClick={() => setPick(null)}>CANCEL</button>
          </p>
          <p className="br-lobby__dim br-board__sub">PICK HOW HARD IT IS. IT SETS THE MONEY YOU EARN, THE LOOT ON THE MAP AND HOW MANY ENTITIES START. THE OWNER CAN CHANGE IT LATER IN THE ROOM SETTINGS.</p>
          <ul className="br-board__grid">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d, i) => {
              const D = DIFFICULTY[d];
              return (
                <li key={d}>
                  <button type="button" className="br-tile" data-lead={d === 'normal' || undefined} onClick={() => create(pick, d)}>
                    <span className="br-tile__top">
                      <span className="br-lobby__dim">{String(i + 1).padStart(2, '0')}</span>
                      <span className="br-tile__tag">{d === 'normal' ? 'DEFAULT' : ''}</span>
                    </span>
                    <b className="br-tile__t">{DIFF[d]}</b>
                    <span className="br-tile__pay"><span className="br-lobby__dim">MONEY</span> x{D.money}</span>
                    <span className="br-tile__votes" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span>LOOT {Math.round(D.loot * 100)}%</span>
                      <span>{D.ents} ENTIT{D.ents === 1 ? 'Y' : 'IES'} AT THE START</span>
                      <span>ENTITY SPEED x{D.speed}</span>
                      <span>{D.life}S OF FLASHLIGHT</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
    </div>
  );
}
