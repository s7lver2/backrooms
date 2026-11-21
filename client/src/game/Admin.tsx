import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ACHIEVEMENTS, CELL, ENTITIES, ITEMS, ITEM_IDS, LEVELS, RARITIES, UPGRADES, UP_IDS, upLevel, type AdminAction, type AdminInfo, type AdminMap, type ItemId, type Kind, type RoomView } from '@backrooms/shared';
import type { BackroomsGame } from './game';
import type { Sock } from '../net';
import { netStats } from '../net';
import { copyText, errClear, errList, errReport, errSubscribe, errTotal, errVersion } from '../errlog';
import { dlogClear, dlogLines, dlogSubscribe, dlogVersion } from '../dlog';
import css from './adminwin.css?inline';

/*
 * Consola de admin (tecla ` o F9): una VENTANA EXTERNA del navegador (window.open) en la que se hace clic en todo; el juego sigue vivo en su pestaña
 * (pasar a la ventana no lo pausa). Se pinta con un portal de React en esa ventana, así comparte el estado del juego sin ningún puente.
 * Si el navegador bloquea la ventana, se muestra encima del juego como panel flotante (y entonces sí toma las teclas).
 * OJO: que se vea es solo cosmético (Me.admin de /api/me); el servidor vuelve a comprobar la cuenta en cada evento `admin` (server/src/index.ts).
 *
 * Las listas salen de las tablas de shared (ENTITIES, ITEMS, LEVELS, UPGRADES, ACHIEVEMENTS, RARITIES): una entrada nueva aparece aquí sola.
 * Todas las acciones son «órdenes» (`cmds`): las pestañas las reparten por grupos y el buscador de la cabecera las filtra todas a la vez.
 */
type Host = { el: HTMLElement; win?: Window };
let HOST: Host | null = null;
const subs = new Set<() => void>();
const setHostG = (h: Host | null) => ((HOST = h), subs.forEach((f) => f()));
const subHost = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const getHost = () => HOST;
const name = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
const GIVE: { id: ItemId | 'loot'; name: string }[] = [...ITEM_IDS.map((id) => ({ id, name: ITEMS[id].name })), { id: 'loot', name: 'ARTIFACT (LOOT)' }];
const NL = '\n';
const TABS = ['OVERVIEW', 'MAP', 'PLAYER', 'WORLD', 'ENTITIES', 'ITEMS', 'ECONOMY', 'HISTORY', 'LOGS', 'DEBUG'] as const;
const ICON: Record<(typeof TABS)[number], string> = {
  OVERVIEW: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  MAP: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  PLAYER: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  WORLD: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  ENTITIES: 'M12 3l9 16H3zM12 10v4M12 17v.5',
  ITEMS: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  ECONOMY: 'M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3',
  HISTORY: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2',
  LOGS: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  DEBUG: 'M9 9h6v6H9zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
};
type Tab = (typeof TABS)[number];

interface Props {
  game: React.RefObject<BackroomsGame | undefined>;
  sock?: Sock;
  room: RoomView | null;
  me: string;
  /** Lanza la pantalla de victoria (el final de ronda) sin acabar la ronda. */
  onVictory?: () => void;
}
interface Cmd {
  group: Tab;
  sub: string;
  label: string;
  run: () => void;
  on?: boolean;
  danger?: boolean;
  /** Solo en una sala / solo en solitario. */
  only?: 'room' | 'solo';
}

const Btn = ({ c }: { c: Cmd }) => (
  <button type="button" className="b" data-on={c.on || undefined} data-danger={c.danger || undefined} onClick={(e) => (c.run(), e.currentTarget.blur())}>
    {c.label}
  </button>
);
const Slider = ({ label, v, min, max, step, set, fmt }: { label: string; v: number; min: number; max: number; step: number; set: (n: number) => void; fmt?: (n: number) => string }) => (
  <label className="sl">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} />
    <b>{fmt ? fmt(v) : v}</b>
  </label>
);
const Card = ({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) => (
  <section className="card">
    <h3>
      {title}
      {aside && <span>{aside}</span>}
    </h3>
    {children}
  </section>
);

export default function AdminConsole({ game, sock, room, me, onVictory }: Props) {
  // la ventana vive fuera del componente: si React lo desmonta y vuelve a montar (cambio de pantalla, recarga de la sala), no se pierde ni se cierra sola
  const host = useSyncExternalStore(subHost, getHost); // (el estado de la ventana es global: si hay otra instancia montada, también lo ve)
  const setHost = setHostG;
  const [tab, setTab] = useState<Tab>('OVERVIEW');
  const [t, setT] = useState('me'); // el objetivo: 'me', 'all' o el id de un jugador
  const [q, setQ] = useState('');
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [solo, setSolo] = useState<ReturnType<BackroomsGame['adminInfo']> | null>(null);
  const [tog, setTog] = useState({ noclip: false, light: true, god: false, ammo: false, stamina: false, sanity: false, bright: false, minimap: false, speed: 1, jump: 1, slow: 1 });
  const [marks, setMarks] = useState<({ x: number; z: number; yaw: number } | null)[]>([null, null, null]);
  const [fx, setFx] = useState({ ao: false, smaa: false, sun: false });
  const [count, setCount] = useState(1);
  const [rar, setRar] = useState(-1); // la rareza de lo que se da (-1: al azar)
  const [seed, setSeed] = useState('');
  const [money, setMoney] = useState('1000');
  const [log, setLog] = useState<{ at: string; m: string; ok: boolean }[]>([]);
  const [shot, setShot] = useState('');
  const [map, setMap] = useState<{ key: string; m: AdminMap } | null>(null);
  const [slog, setSlog] = useState<string[]>([]);
  const [lsrc, setLsrc] = useState<'SERVER' | 'GAME'>('SERVER');
  const [lq, setLq] = useState('');
  useSyncExternalStore(dlogSubscribe, dlogVersion);
  useSyncExternalStore(errSubscribe, errVersion);
  const inRoom = !!sock && !!room;
  const hostRef = useRef(host);
  hostRef.current = host;
  const g = game.current;
  const note = useCallback((m: string, ok = true) => setLog((l) => [{ at: new Date().toLocaleTimeString(), m, ok }, ...l].slice(0, 60)), []);

  const close = useCallback(() => {
    const h = hostRef.current;
    if (!h) return;
    game.current && ((game.current.input.noPause = false), game.current.input.unblock('admin'));
    if (h.win) h.win.close();
    else h.el.remove();
    setHost(null);
  }, [game, setHost]);

  const open = useCallback(() => {
    const h = hostRef.current;
    if (h?.win && !h.win.closed) return void h.win.focus();
    if (h) return void close();
    const gm = game.current;
    const w = window.open(`${import.meta.env.BASE_URL}admin.html`, 'br-admin', 'popup=yes,width=1100,height=800'); // (una página real del mismo origen: un about:blank se recargaba o fallaba según el navegador)
    const mount = (win?: Window) => {
      let el: HTMLElement;
      if (win) {
        const st = win.document.createElement('style');
        st.textContent = css;
        win.document.head.append(st);
        el = win.document.createElement('div');
        el.id = 'adm-root';
        win.document.body.append(el);
        // se sabe que se cerró mirando `closed` (pagehide también salta al recargarse el documento y la cerraba sola)
        const iv = setInterval(() => win.closed && (clearInterval(iv), gm && (gm.input.noPause = false), setHost(null)), 500);
        win.addEventListener('keydown', (e) => !e.repeat && (e.code === 'F9' || e.code === 'Backquote') && !(e.target as HTMLElement | null)?.matches('input') && (e.preventDefault(), win.close()));
        addEventListener('pagehide', () => win.close());
        if (gm) gm.input.noPause = true;
        win.focus();
      } else {
        // ventana bloqueada: panel flotante sobre el juego (el juego no recibe teclas mientras esté)
        const st = document.createElement('style');
        st.textContent = css + '#adm-root.inline{position:fixed;inset:16px;z-index:60;box-shadow:0 0 0 9999px #000a}';
        el = document.createElement('div');
        el.id = 'adm-root';
        el.className = 'inline';
        el.append(st);
        document.body.append(el);
        if (gm) gm.input.block('admin'), gm.input.unlock();
      }
      if (gm) setTog(gm.adminState());
      setHost({ el, win });
    };
    if (!w) return mount();
    // se espera a que la página de la ventana esté cargada (si no llega en 4 s, panel flotante)
    let tries = 0;
    const wait = setInterval(() => {
      let ready = false;
      try {
        ready = (w as unknown as { __admReady?: boolean }).__admReady === true && !!w.document.body; // (la página avisa al terminar de cargar: el documento en blanco previo también dice «complete» y el panel se montaba en él)
      } catch { /* aún no es del mismo origen */ }
      if (ready) (clearInterval(wait), mount(w));
      else if (w.closed || ++tries > 80) (clearInterval(wait), w.closed ? undefined : (w.close(), mount()));
    }, 50);
  }, [game, close, setHost]);

  // la tecla: en el juego abre la ventana (o la trae al frente); con ella abierta, otra vez la cierra
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Backquote' && e.code !== 'F9') return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) open();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open]);

  // el objetivo desaparece de la sala: vuelve a ME
  useEffect(() => {
    if (t !== 'me' && t !== 'all' && !room?.players.some((p) => p.id === t)) setT('me');
  }, [room, t]);

  const send = useCallback(
    (a: AdminAction, then?: (i?: AdminInfo) => void) => {
      if (!sock) return;
      sock.emit('admin', a, (r) => {
        note(`${a.a}${'t' in a ? ' → ' + a.t : ''}${'id' in a ? ' ' + a.id : ''}${'item' in a ? ' ' + a.item : ''}${'kind' in a && a.kind ? ' ' + a.kind : ''}: ${r.ok ? 'OK' : (r.error ?? 'ERROR')}`, r.ok);
        if (r.ok) then?.(r.info);
      });
    },
    [sock, note],
  );

  // información de la partida: en la sala la da el servidor; solo, el cliente. El plano se pide una vez por ronda y el registro de la sala solo en su pestaña
  useEffect(() => {
    if (!host || !['OVERVIEW', 'MAP', 'HISTORY', 'DEBUG', 'WORLD', 'LOGS'].includes(tab)) return;
    const ask = () => {
      if (!inRoom) return setSolo(game.current?.adminInfo() ?? null);
      sock!.emit('admin', { a: 'info' }, (r) => r.ok && r.info && setInfo(r.info));
      if (tab === 'LOGS' && lsrc === 'SERVER') sock!.emit('admin', { a: 'logs' }, (r) => r.ok && r.logs && setSlog(r.logs));
    };
    ask();
    const id = setInterval(ask, tab === 'MAP' ? 500 : 1000);
    return () => clearInterval(id);
  }, [host, tab, inRoom, sock, game, lsrc]);
  const mapKey = info ? `${info.levelId}:${info.seed}` : '';
  useEffect(() => {
    if (!host || !inRoom || !mapKey || map?.key === mapKey || (tab !== 'MAP' && tab !== 'OVERVIEW')) return;
    // se reintenta cada segundo hasta que llega (antes se pedia una vez y, si fallaba, no volvia a pedirse hasta que algo cambiaba)
    let alive = true, t: ReturnType<typeof setTimeout> | undefined;
    const go = () => sock!.emit('admin', { a: 'map' }, (r) => alive && (r.ok && r.map ? setMap({ key: mapKey, m: r.map }) : (t = setTimeout(go, 1000))));
    go();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [host, inRoom, mapKey, map?.key, tab, sock]);

  const one = t !== 'me' && t !== 'all';
  const mine = t === 'me' || !inRoom;
  const others = room?.players.filter((p) => p.id !== me) ?? [];
  const solo1 = (op: Parameters<BackroomsGame['adminSolo']>[0]) => game.current?.adminSolo(op);
  const hold = (f: () => void) => (f(), game.current?.input.unlock());
  const nErr = errList().length;
  const ups = room?.players.find((p) => p.id === (one ? t : me))?.ups;

  const flipLocal = (k: 'noclip' | 'light' | 'god') => {
    const on = !tog[k];
    setTog({ ...tog, [k]: on });
    game.current?.adminToggle(k, on);
  };
  const flipCheat = (k: 'stamina' | 'sanity' | 'bright' | 'ammo' | 'minimap') => {
    const on = !tog[k];
    setTog({ ...tog, [k]: on });
    game.current?.adminCheat(k, on);
  };
  const godMode = !!(tog.god && tog.stamina && tog.sanity && tog.noclip);
  const flipGodMode = () => {
    const on = !godMode, gm = game.current;
    setTog({ ...tog, god: on, stamina: on, sanity: on, noclip: on, speed: on ? 2 : 1 });
    gm?.adminToggle('god', on);
    gm?.adminToggle('noclip', on);
    gm?.adminCheat('stamina', on);
    gm?.adminCheat('sanity', on);
    gm?.adminCheat('speed', on ? 2 : 1);
    if (inRoom) send({ a: 'god', t: 'me', on });
  };
  const val = (k: 'speed' | 'jump' | 'slow', n: number) => (setTog({ ...tog, [k]: n }), game.current?.adminCheat(k, n));
  const give = (id: ItemId | 'loot') => (inRoom ? send({ a: 'give', t, item: id, ...(rar >= 0 ? { r: rar } : {}) }) : id !== 'loot' && solo1({ item: id }));
  const spawn = (kind: Kind) => Array.from({ length: count }).forEach(() => (inRoom ? send({ a: 'ent', op: 'spawn', kind, near: t === 'all' ? 'me' : t }) : solo1({ spawn: kind })));
  const seedN = /^\d+$/.test(seed.trim()) && Number(seed) >= 1 && Number(seed) < 2 ** 31 ? Number(seed) : undefined;
  const loadLevel = (id: string) => (inRoom ? send({ a: 'level', id, seed: seedN }) : hold(() => game.current?.adminLevel0(seedN)));
  const copyErrs = async () => {
    const where = inRoom ? `room ${room!.code}  ${room!.phase}  round ${room!.round}  ${room!.levelId}  players ${room!.players.length}` : 'solo';
    const txt = [`${new Date().toISOString()}  ${where}`, game.current?.adminDiag(), '', errReport()].filter((l) => l !== undefined).join('\n');
    note((await copyText(txt)) ? `COPIED · ${nErr ? `${nErr} RENDER ERRORS (${errTotal()}×)` : 'NO ERRORS RECORDED'}` : 'COPY FAILED', true);
  };

  // todas las órdenes, con su grupo: las pestañas las reparten y el buscador las filtra
  const cmds = useMemo(() => {
    const c: Cmd[] = [];
    const add = (group: Tab, sub: string, label: string, run: () => void, extra: Partial<Cmd> = {}) => c.push({ group, sub, label, run, ...extra });
    add('PLAYER', 'STATE', 'GOD MODE', flipGodMode, { on: godMode });
    add('PLAYER', 'STATE', 'FULL HEAL', () => (inRoom ? send({ a: 'heal', t }) : solo1('heal')));
    add('PLAYER', 'STATE', 'KILL', () => (inRoom ? send({ a: 'kill', t }) : solo1('kill')), { danger: true });
    add('PLAYER', 'STATE', 'REVIVE', () => send({ a: 'revive', t }), { only: 'room' });
    add('PLAYER', 'STATE', 'GOD', () => (inRoom && !mine ? send({ a: 'god', t, on: true }) : flipLocal('god')), { on: tog.god });
    add('PLAYER', 'STATE', 'GOD OFF', () => send({ a: 'god', t, on: false }), { only: 'room' });
    add('PLAYER', 'STATE', 'INF AMMO', () => (inRoom ? (send({ a: 'ammo', t, on: mine ? !tog.ammo : true }), mine && setTog({ ...tog, ammo: !tog.ammo })) : flipCheat('ammo')), { on: tog.ammo });
    add('PLAYER', 'STATE', 'AMMO OFF', () => send({ a: 'ammo', t, on: false }), { only: 'room' });
    add('PLAYER', 'CHEATS · THIS CLIENT', 'NOCLIP', () => flipLocal('noclip'), { on: tog.noclip });
    add('PLAYER', 'CHEATS · THIS CLIENT', 'INF STAMINA', () => flipCheat('stamina'), { on: tog.stamina });
    add('PLAYER', 'CHEATS · THIS CLIENT', 'INF SANITY', () => flipCheat('sanity'), { on: tog.sanity });
    add('PLAYER', 'CHEATS · THIS CLIENT', 'FULLBRIGHT', () => flipCheat('bright'), { on: tog.bright });
    add('PLAYER', 'CHEATS · THIS CLIENT', 'MINIMAP', () => flipCheat('minimap'), { on: tog.minimap });
    add('PLAYER', 'CHEATS · THIS CLIENT', 'LIGHTS OFF', () => flipLocal('light'), { on: !tog.light });
    add('PLAYER', 'TELEPORT', 'ELEVATOR', () => (inRoom ? send({ a: 'tp', t, to: 'elevator' }) : solo1('elevator')));
    add('PLAYER', 'TELEPORT', 'START', () => (inRoom ? send({ a: 'tp', t, to: 'start' }) : solo1('start')));
    if (one) add('PLAYER', 'TELEPORT', 'BRING TO ME', () => send({ a: 'tp', t, to: 'player', who: 'me' }), { only: 'room' });
    if (one) add('PLAYER', 'TELEPORT', 'GO TO PLAYER', () => send({ a: 'tp', t: 'me', to: 'player', who: t }), { only: 'room' });
    for (const l of Object.values(LEVELS)) add('WORLD', 'LEVELS · SEED BELOW (EMPTY: NEW)', `${l.id === 'parking' ? l.title : l.name}`, () => loadLevel(l.id), { only: l.id === 'level0' ? undefined : 'room' });
    add('WORLD', 'ROUND', 'RUN FOR YOUR LIFE', () => (inRoom ? send({ a: 'run', t }) : hold(() => game.current?.adminRun())));
    add('WORLD', 'ROUND', 'WAITING ROOM', () => send({ a: 'lobby' }), { only: 'room' });
    add('WORLD', 'ROUND', 'COMPLETE MISSION', () => (inRoom ? send({ a: 'mission' }) : solo1('mission')));
    add('WORLD', 'ROUND', 'TVS OFF', () => (inRoom ? send({ a: 'tvs' }) : solo1('tvs')));
    add('WORLD', 'ROUND', 'END · SUCCESS', () => send({ a: 'end', ok: true }), { only: 'room' });
    add('WORLD', 'ROUND', 'END · FAILURE', () => send({ a: 'end', ok: false }), { only: 'room', danger: true });
    if (onVictory) add('WORLD', 'ROUND', 'VICTORY SCREEN', () => (close(), onVictory()));
    for (const k of Object.keys(ENTITIES) as Kind[]) add('ENTITIES', `SPAWN × ${count}`, `+ ${name(k)}`, () => spawn(k));
    add('ENTITIES', 'CONTROL', 'CLEAR ALL', () => (inRoom ? send({ a: 'ent', op: 'clear' }) : solo1('clear')), { danger: true });
    add('ENTITIES', 'CONTROL', 'FREEZE', () => (inRoom ? send({ a: 'ent', op: 'freeze' }) : solo1('freeze')));
    add('ENTITIES', 'CONTROL', 'THAW', () => (inRoom ? send({ a: 'ent', op: 'thaw' }) : solo1('thaw')));
    add('ITEMS', 'GIVE', 'GIVE ALL', () => GIVE.forEach((s) => give(s.id)), { danger: true });
    for (const s of GIVE) add('ITEMS', 'GIVE', s.name, () => give(s.id), { only: s.id === 'loot' ? 'room' : undefined });
    for (const n of [100, 1000, 10000]) add('ECONOMY', 'BANK', `+${n}`, () => send({ a: 'money', mode: 'add', n }), { only: 'room' });
    add('ECONOMY', 'BANK', 'SET 0', () => send({ a: 'money', mode: 'set', n: 0 }), { only: 'room' });
    add('ECONOMY', 'BANK', 'SET 5000', () => send({ a: 'money', mode: 'set', n: 5000 }), { only: 'room' });
    add('ECONOMY', 'UPGRADES', 'MAX ALL', () => send({ a: 'ups', t, id: '*', lv: 99 }), { only: 'room' });
    add('ECONOMY', 'UPGRADES', 'RESET ALL', () => send({ a: 'ups', t, id: '*', lv: 0 }), { only: 'room', danger: true });
    add('ECONOMY', 'ACHIEVEMENTS · TARGET NEEDS AN ACCOUNT', 'AWARD ALL', () => send({ a: 'award', t, key: '*' }), { only: 'room' });
    for (const x of ACHIEVEMENTS) add('ECONOMY', 'ACHIEVEMENTS · TARGET NEEDS AN ACCOUNT', x.name, () => send({ a: 'award', t, key: x.key }), { only: 'room' });
    return c.filter((x) => !x.only || (x.only === 'room') === inRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, t, one, mine, tog, godMode, count, rar, seed, tab, sock, room?.code]);

  const groups = (group: Tab, list: Cmd[] = cmds) => {
    const subs = [...new Set(list.filter((x) => x.group === group).map((x) => x.sub))];
    return subs.map((sub) => (
      <Card key={sub} title={sub}>
        <div className="row">{list.filter((x) => x.group === group && x.sub === sub).map((x) => <Btn key={x.label} c={x} />)}</div>
        {group === 'ITEMS' && sub === 'GIVE' && null}
      </Card>
    ));
  };

  if (!host) return null;

  const hits = q.trim() ? cmds.filter((x) => `${x.group} ${x.sub} ${x.label}`.toLowerCase().includes(q.trim().toLowerCase())) : null;
  const players = inRoom ? (info?.players ?? room!.players.map((p) => ({ id: p.id, name: p.name, hp: NaN, dead: false, god: false, x: 0, z: 0, yaw: 0 }))) : [];
  const lvName = (id: string) => LEVELS[id]?.name ?? id;
  const ago = (at: number) => {
    const d = Math.max(0, Math.round((Date.now() - at) / 1000));
    return d < 90 ? `${d}s ago` : d < 5400 ? `${Math.round(d / 60)} min ago` : `${(d / 3600).toFixed(1)} h ago`;
  };
  const copy = (v: string) => void copyText(v).then(() => note(`COPIED ${v}`));

  const panel = (
    <div className="adm">
      <header className="top">
        <div className="brand">
          <i /> <b>ADMIN</b>
          <small>CONTROL ROOM</small>
        </div>
        <div className="pills">
          {inRoom ? (
            <>
              <span className="pill" data-phase={room!.phase}>{room!.phase.toUpperCase()}</span>
              <span className="pill">{lvName(room!.levelId).toUpperCase()}</span>
              <button type="button" className="pill pill--btn" title="Copy seed" onClick={() => info && copy(String(info.seed))}>SEED {info?.seed ?? '…'}</button>
              <span className="pill">ROUND {room!.round}</span>
              <span className="pill">ROOM {room!.code}</span>
            </>
          ) : (
            <span className="pill">SOLO</span>
          )}
          <span className="pill" data-ping={netStats.rtt > 150 ? 'bad' : netStats.rtt > 80 ? 'mid' : 'ok'}>{netStats.rtt} ms</span>
        </div>
        <input className="search" type="text" placeholder="Search every action…  heal · spawn · seed · give" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoFocus />
        {host.win ? null : (
          <button type="button" className="b" onClick={close}>
            CLOSE
          </button>
        )}
      </header>

      <div className="target">
        <span>TARGET</span>
        {inRoom ? (
          <>
            <button type="button" className="chip" data-on={t === 'me' || undefined} onClick={() => setT('me')}>
              ME
            </button>
            <button type="button" className="chip" data-on={t === 'all' || undefined} onClick={() => setT('all')}>
              ALL
            </button>
            {others.map((p) => (
              <button key={p.id} type="button" className="chip" data-on={t === p.id || undefined} onClick={() => setT(p.id)}>
                {p.name.slice(0, 14)}
              </button>
            ))}
          </>
        ) : (
          <em>solo run: everything applies to you</em>
        )}
      </div>

      <div className="body">
        <nav className="side">
          {TABS.map((x) => (
            <button key={x} type="button" data-on={(!hits && tab === x) || undefined} onClick={() => (setQ(''), setTab(x))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[x]} /></svg>
              <span>{x}</span>
              {x === 'DEBUG' && nErr > 0 && <b>{nErr}</b>}
            </button>
          ))}
        </nav>

        <main className="main" key={hits ? "q" : tab}>
          {hits ? (
            <Card title={`RESULTS · ${hits.length}`}>
              <div className="row">{hits.map((x) => <Btn key={x.group + x.label} c={{ ...x, label: `${x.label}` }} />)}</div>
              {!hits.length && <p className="dim">Nothing matches.</p>}
            </Card>
          ) : (
            <>
              {tab === 'OVERVIEW' && (
                <>
                  {inRoom && info && (
                    <div className="tiles">
                      <div className="tile"><em>PLAYERS</em><b>{info.players.filter((p) => !p.dead).length}<small> / {info.players.length}</small></b><i style={{ width: `${(info.players.filter((p) => !p.dead).length / Math.max(1, info.players.length)) * 100}%` }} /></div>
                      <div className="tile"><em>ENTITIES</em><b>{info.ents}{info.frozen && <small> frozen</small>}</b></div>
                      <div className="tile"><em>TIME</em><b>{Math.floor(info.elapsed / 60)}:{String(info.elapsed % 60).padStart(2, '0')}</b></div>
                      <div className="tile"><em>BANK</em><b>${info.bank}</b></div>
                    </div>
                  )}
                  <Card title="STATUS">
                    {inRoom && info ? (
                      <dl className="kv">
                        <dt>SEED</dt><dd>{info.seed}</dd>
                        <dt>LEVEL</dt><dd>{info.levelId}</dd>
                        <dt>ROUND</dt><dd>{info.round} · {info.phase}</dd>
                        <dt>TIME</dt><dd>{info.elapsed}s</dd>
                        <dt>ENTITIES</dt><dd>{info.ents}{info.frozen ? ' (frozen)' : ''}</dd>
                        <dt>BANK</dt><dd>${info.bank}</dd>
                        <dt>MISSION</dt><dd>{info.mission}</dd>
                      </dl>
                    ) : solo ? (
                      <dl className="kv">
                        <dt>SEED</dt><dd>{solo.seed}</dd>
                        <dt>LEVEL</dt><dd>{solo.level}</dd>
                        <dt>TIME</dt><dd>{solo.t}s</dd>
                        <dt>ENTITIES</dt><dd>{solo.ents}</dd>
                        <dt>HP</dt><dd>{solo.hp}</dd>
                        <dt>MISSION</dt><dd>{solo.mission}</dd>
                      </dl>
                    ) : (
                      <p className="dim">Loading…</p>
                    )}
                  </Card>
                  {inRoom && (
                    <Card title={`PLAYERS · ${players.length}`}>
                      <table className="pl">
                        <tbody>
                          {players.map((p) => (
                            <tr key={p.id} data-me={p.id === me || undefined}>
                              <td className="nm">{p.name}{p.id === me ? ' (you)' : ''}</td>
                              <td className="hp"><span className="bar"><i style={{ width: `${Number.isFinite(p.hp) ? Math.max(0, Math.min(100, p.hp)) : 0}%` }} /></span></td>
                              <td className="st">{p.dead ? 'DEAD' : p.god ? 'GOD' : Number.isFinite(p.hp) ? Math.round(p.hp) : ''}</td>
                              <td className="ac">
                                <button type="button" onClick={() => send({ a: 'heal', t: p.id })}>HEAL</button>
                                <button type="button" onClick={() => send({ a: 'kill', t: p.id })}>KILL</button>
                                <button type="button" onClick={() => send({ a: 'revive', t: p.id })}>REVIVE</button>
                                <button type="button" onClick={() => send({ a: 'god', t: p.id, on: !p.god })}>{p.god ? 'GOD OFF' : 'GOD'}</button>
                                {p.id !== me && <button type="button" onClick={() => send({ a: 'tp', t: p.id, to: 'player', who: 'me' })}>BRING</button>}
                                {p.id !== me && <button type="button" onClick={() => send({ a: 'tp', t: 'me', to: 'player', who: p.id })}>GO TO</button>}
                                {p.id !== me && <button type="button" data-danger onClick={() => send({ a: 'kick', t: p.id })}>KICK</button>}
                                <button type="button" data-on={t === p.id || undefined} onClick={() => setT(p.id)}>TARGET</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  )}
                  <Card title="QUICK">
                    <div className="row">
                      {cmds.filter((x) => ['GOD MODE', 'FULL HEAL', 'NOCLIP', 'COMPLETE MISSION', 'ELEVATOR', 'CLEAR ALL', 'FREEZE', 'THAW', 'WAITING ROOM'].includes(x.label)).map((x) => <Btn key={x.label} c={x} />)}
                    </div>
                  </Card>
                </>
              )}

              {tab === 'PLAYER' && (
                <>
                  {groups('PLAYER')}
                  <Card title="MOVEMENT">
                    <Slider label="SPEED" v={tog.speed} min={0.5} max={6} step={0.5} set={(n) => val('speed', n)} fmt={(n) => `x${n}`} />
                    <Slider label="JUMP" v={tog.jump} min={1} max={4} step={0.5} set={(n) => val('jump', n)} fmt={(n) => `x${n}`} />
                    {!inRoom && <Slider label="TIME" v={tog.slow} min={0.1} max={1} step={0.1} set={(n) => val('slow', n)} fmt={(n) => `x${n.toFixed(1)}`} />}
                  </Card>
                  {!inRoom && (
                    <Card title="SAVED POSITIONS">
                      <div className="row">
                        {marks.map((m, i) => (
                          <span key={i} className="pair">
                            <button type="button" className="b" onClick={() => setMarks(marks.map((x, j) => (j === i ? (game.current?.adminPos() ?? null) : x)))}>SAVE {i + 1}</button>
                            {m && <button type="button" className="b" onClick={() => game.current?.adminGoto(m)}>GO {i + 1}</button>}
                          </span>
                        ))}
                      </div>
                    </Card>
                  )}
                </>
              )}

              {tab === 'WORLD' && (
                <>
                  <Card title="SEED">
                    <div className="row">
                      <input className="field" type="text" inputMode="numeric" placeholder="seed (1 – 2147483647), empty = random" value={seed} onChange={(e) => setSeed(e.target.value)} spellCheck={false} />
                      <button type="button" className="b" onClick={() => setSeed(String((Math.random() * 2 ** 31) | 0 || 1))}>RANDOM</button>
                      {inRoom && info && <button type="button" className="b" onClick={() => setSeed(String(info.seed))}>CURRENT</button>}
                    </div>
                    {seed.trim() && seedN === undefined && <p className="dim">Not a valid seed: a number from 1 to 2147483647.</p>}
                  </Card>
                  {groups('WORLD')}
                </>
              )}

              {tab === 'ENTITIES' && (
                <>
                  <Card title="AMOUNT">
                    <Slider label="COUNT" v={count} min={1} max={12} step={1} set={setCount} />
                  </Card>
                  {groups('ENTITIES')}
                </>
              )}

              {tab === 'ITEMS' && (
                <>
                  {inRoom && (
                    <Card title="RARITY">
                      <div className="row">
                        <button type="button" className="b" data-on={rar < 0 || undefined} onClick={() => setRar(-1)}>RANDOM</button>
                        {RARITIES.map((x, i) => <button key={x.name} type="button" className="b" data-on={rar === i || undefined} onClick={() => setRar(i)}>{x.name}</button>)}
                      </div>
                    </Card>
                  )}
                  {groups('ITEMS')}
                </>
              )}

              {tab === 'ECONOMY' && (
                <>
                  {inRoom && (
                    <Card title="CUSTOM AMOUNT" aside={`BANK $${room!.bank}`}>
                      <div className="row">
                        <input className="field" type="text" inputMode="numeric" value={money} onChange={(e) => setMoney(e.target.value)} spellCheck={false} />
                        <button type="button" className="b" onClick={() => Number.isInteger(Number(money)) && send({ a: 'money', mode: 'add', n: Number(money) })}>ADD</button>
                        <button type="button" className="b" onClick={() => Number.isInteger(Number(money)) && send({ a: 'money', mode: 'set', n: Number(money) })}>SET</button>
                      </div>
                    </Card>
                  )}
                  {groups('ECONOMY')}
                  {inRoom && (
                    <Card title={`UPGRADES · ${t === 'all' ? 'ALL' : one ? 'TARGET' : 'ME'}`}>
                      {UP_IDS.map((id) => (
                        <Slider key={id} label={UPGRADES[id].name} v={upLevel(ups, id)} min={0} max={UPGRADES[id].cost.length} step={1} set={(n) => send({ a: 'ups', t, id, lv: n })} fmt={(n) => UPGRADES[id].fmt(UPGRADES[id].val[n])} />
                      ))}
                    </Card>
                  )}
                </>
              )}

              {tab === 'MAP' && (
                <Card title="ROOM MAP" aside={map ? `${map.m.w}×${map.m.h} cells` : undefined}>
                  {inRoom && info ? (
                    <>
                      <MapView map={map?.m ?? null} players={info.players} ents={info.ents2} me={me} target={t} onPick={setT} />
                      <div className="legend">
                        <span><i className="d me" /> YOU</span>
                        <span><i className="d pl" /> PLAYER</span>
                        <span><i className="d en" /> ENTITY</span>
                        <span><i className="d dead" /> DEAD</span>
                        <span className="dim">wheel: zoom · drag: pan · double click: fit · click a player: target</span>
                      </div>
                    </>
                  ) : (
                    <p className="dim">The room map is available in a room.</p>
                  )}
                </Card>
              )}
              {tab === 'MAP' && inRoom && info && (
                <Card title={`ENTITIES · ${info.ents2.length}`}>
                  {info.ents2.length ? (
                    <table className="pl">
                      <tbody>
                        {info.ents2.slice(0, 40).map((e, i) => (
                          <tr key={i}><td className="nm">{name(e.k)}</td><td className="st">{e.s}</td><td className="ac">{e.x.toFixed(0)}, {e.z.toFixed(0)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="dim">No entities alive.</p>
                  )}
                </Card>
              )}

              {tab === 'HISTORY' && (
                <Card title="LEVEL HISTORY" aside={info ? `NEXT SEED ${info.seedNext}` : undefined}>
                  {inRoom && info ? (
                    info.hist?.length ? (
                      <table className="hist">
                        <thead><tr><th>#</th><th>LEVEL</th><th>FLOOR</th><th>SEED</th><th>STARTED</th><th /></tr></thead>
                        <tbody>
                          {[...(info.hist ?? [])].reverse().map((h, i) => (
                            <tr key={h.at} data-now={(i === 0 && info.phase !== 'lobby') || undefined}>
                              <td>{h.round}</td>
                              <td>{lvName(h.level)}</td>
                              <td>{h.level === 'suites' ? h.floor : '—'}</td>
                              <td className="mono">{h.seed}</td>
                              <td className="dim">{ago(h.at)}</td>
                              <td className="ac">
                                <button type="button" onClick={() => copy(String(h.seed))}>COPY</button>
                                <button type="button" onClick={() => (setSeed(String(h.seed)), setTab('WORLD'))}>USE SEED</button>
                                <button type="button" data-danger onClick={() => send({ a: 'level', id: h.level, seed: h.seed })}>REPLAY</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="dim">No rounds played in this room yet.</p>
                    )
                  ) : (
                    <p className="dim">The history is kept per room.</p>
                  )}
                </Card>
              )}

              {tab === 'LOGS' && (
                <Card
                  title="LOGS"
                  aside={
                    <span className="seg">
                      {(['SERVER', 'GAME'] as const).map((k) => (
                        <button key={k} type="button" data-on={lsrc === k || undefined} onClick={() => setLsrc(k)}>{k === 'SERVER' ? 'ROOM' : 'THIS CLIENT'}</button>
                      ))}
                    </span>
                  }
                >
                  <div className="row">
                    <input className="field" type="text" placeholder="Filter…" value={lq} onChange={(e) => setLq(e.target.value)} spellCheck={false} />
                    <button type="button" className="b" onClick={() => copy((lsrc === 'SERVER' ? slog : dlogLines()).join(NL))}>COPY ALL</button>
                    {lsrc === 'GAME' && <button type="button" className="b" onClick={dlogClear}>CLEAR</button>}
                  </div>
                  <LogView lines={(lsrc === 'SERVER' ? slog : dlogLines()).filter((l) => !lq.trim() || l.toLowerCase().includes(lq.trim().toLowerCase()))} />
                  {lsrc === 'SERVER' && !inRoom && <p className="dim">The room log needs a room.</p>}
                </Card>
              )}

              {tab === 'DEBUG' && (
                <>
                  <Card title="CAPTURE">
                    <div className="row">
                      <button type="button" className="b" onClick={(e) => void game.current?.adminShot(e.currentTarget.ownerDocument.defaultView ?? window).then((s) => (setShot(s), note('SCREENSHOT + SEED + POS COPIED')))}>SCREENSHOT + SEED + POS → CLIPBOARD</button>
                      <button type="button" className="b" data-on={nErr > 0 || undefined} onClick={() => void copyErrs()}>{nErr ? `COPY RENDER ERRORS · ${nErr}` : 'COPY RENDER ERRORS'}</button>
                      {nErr > 0 && <button type="button" className="b" onClick={() => (errClear(), note('ERRORS CLEARED'))}>CLEAR ERRORS</button>}
                    </div>
                    {shot && <pre className="pre">{shot}</pre>}
                  </Card>
                  <Card title="RENDER">
                    <div className="row">
                      {(['ao', 'smaa', 'sun'] as const).map((k) => (
                        <button key={k} type="button" className="b" data-on={fx[k] || undefined} onClick={() => game.current && setFx(game.current.adminPerf(k))}>{`${k === 'sun' ? 'SUN SHADOW' : k.toUpperCase()} ${fx[k] ? 'ON' : 'OFF'}`}</button>
                      ))}
                      <button type="button" className="b" onClick={() => game.current && setFx(game.current.adminPerf())}>REFRESH</button>
                    </div>
                  </Card>
                  <Card title="GAME LOG">
                    <div className="row">
                      <button type="button" className="b" onClick={() => void copyText(dlogLines().join(NL)).then(() => note('LOG COPIED'))}>COPY LOG</button>
                      <button type="button" className="b" onClick={() => void copyText((game.current?.adminDump() ?? '') + NL + NL + dlogLines().slice(-60).join(NL)).then(() => note('STATE + LOG COPIED'))}>COPY STATE + LOG</button>
                      <button type="button" className="b" onClick={dlogClear}>CLEAR</button>
                    </div>
                    <pre className="pre">{game.current?.adminDump()}</pre>
                    <pre className="pre tall">{dlogLines().slice(-60).join(NL) || '(no events yet)'}</pre>
                  </Card>
                </>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="log">
        {log.length ? log.slice(0, 5).map((l, i) => <div key={i} data-bad={!l.ok || undefined}><time>{l.at}</time> {l.m}</div>) : <div className="dim">Results of your actions show here.</div>}
      </footer>
    </div>
  );

  return createPortal(panel, host.el);
}


/** El registro: líneas de monoespaciada, coloreadas por lo que dicen, que se queda abajo mientras llegan líneas nuevas. */
function LogView({ lines }: { lines: string[] }) {
  const el = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const e = el.current;
    if (e && stick.current) e.scrollTop = e.scrollHeight;
  }, [lines]);
  const kind = (l: string) => (/denied|error|fail|dead|died|refused|forbidden/i.test(l) ? 'bad' : /complete|round start|restored|victory|boarded/i.test(l) ? 'good' : /admin|kick|level|seed/i.test(l) ? 'acc' : undefined);
  return (
    <div className="logv" ref={el} onScroll={(e) => (stick.current = e.currentTarget.scrollTop + e.currentTarget.clientHeight >= e.currentTarget.scrollHeight - 24)}>
      {lines.length ? lines.map((l, i) => <div key={i} data-k={kind(l)}>{l}</div>) : <div className="dim">(empty)</div>}
    </div>
  );
}

const COLORS = ['#4cc9f0', '#f72585', '#b8f35b', '#ffb703', '#a78bfa', '#2ec4b6', '#ff7b54', '#e0e0e0'];
/** El plano de la sala en vivo: celdas abiertas, jugadores (con hacia dónde miran) y entidades. Rueda: zoom; arrastrar: mover; doble clic: encajar; clic en un jugador: lo elige como objetivo. */
function MapView({ map, players, ents, me, target, onPick }: { map: AdminMap | null; players: AdminInfo['players']; ents: AdminInfo['ents2']; me: string; target: string; onPick: (id: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const data = useRef({ map, players, ents, me, target });
  data.current = { map, players, ents, me, target };
  const view = useRef({ s: 8, ox: 0, oy: 0, fit: true });
  const base = useRef<{ key: string; c: HTMLCanvasElement } | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const hit = useRef<{ x: number; y: number; r: number; id?: string; text: string }[]>([]);

  useEffect(() => {
    const c = cv.current;
    const win = c?.ownerDocument.defaultView;
    if (!c || !win) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const loop = (t: number) => {
      raf = win.requestAnimationFrame(loop);
      const d = data.current, dpr = win.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) (c.width = Math.round(W * dpr)), (c.height = Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const v = view.current, mw = d.map?.w ?? 0, mh = d.map?.h ?? 0;
      if (v.fit && mw) {
        v.s = Math.max(2, Math.min(W / mw, H / mh) * 0.96);
        v.ox = (W / v.s - mw) / 2;
        v.oy = (H / v.s - mh) / 2;
      }
      const sx = (x: number) => (x / CELL + v.ox) * v.s, sy = (z: number) => (z / CELL + v.oy) * v.s;
      // el plano: una imagen de 1 px por celda, escalada sin suavizar
      if (d.map) {
        const key = `${d.map.w}x${d.map.h}:${d.map.open.length}:${d.map.open.slice(0, 64)}`;
        if (base.current?.key !== key) {
          const o = c.ownerDocument.createElement('canvas');
          o.width = mw, o.height = mh;
          const ox = o.getContext('2d')!, img = ox.createImageData(mw, mh);
          for (let i = 0; i < mw * mh; i++) {
            const on = d.map.open.charCodeAt(i) === 49;
            img.data.set(on ? [34, 46, 60, 255] : [0, 0, 0, 0], i * 4);
          }
          ox.putImageData(img, 0, 0);
          base.current = { key, c: o };
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(base.current.c, (v.ox) * v.s, (v.oy) * v.s, mw * v.s, mh * v.s);
        if (v.s >= 9) {
          ctx.strokeStyle = 'rgba(255,255,255,0.045)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i <= mw; i++) (ctx.moveTo((i + v.ox) * v.s, v.oy * v.s), ctx.lineTo((i + v.ox) * v.s, (mh + v.oy) * v.s));
          for (let j = 0; j <= mh; j++) (ctx.moveTo(v.ox * v.s, (j + v.oy) * v.s), ctx.lineTo((mw + v.ox) * v.s, (j + v.oy) * v.s));
          ctx.stroke();
        }
      }
      hit.current = [];
      const pulse = 0.5 + 0.5 * Math.sin(t / 380);
      // entidades: rombos rojos
      for (const e of d.ents) {
        const x = sx(e.x), y = sy(e.z), r = Math.max(4, v.s * 0.32);
        ctx.fillStyle = e.s === 'chase' || e.s === 'hunt' ? '#ff3b30' : '#c2362f';
        ctx.beginPath();
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
        hit.current.push({ x, y, r: r + 3, text: `${e.k} · ${e.s}` });
      }
      // jugadores: punto con su color, la mirada y el nombre
      d.players.forEach((p, i) => {
        const x = sx(p.x), y = sy(p.z), r = Math.max(5, v.s * 0.36), col = COLORS[i % COLORS.length], isT = d.target === p.id || (d.target === 'me' && p.id === d.me) || d.target === 'all';
        if (isT) {
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.35 + 0.45 * pulse;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, r + 5 + pulse * 4, 0, 6.283); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (p.dead) {
          ctx.strokeStyle = '#7c857a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
        } else {
          const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + fx * (r + 7), y + fz * (r + 7)); ctx.stroke();
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
          if (p.id === d.me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, 6.283); ctx.stroke(); }
        }
        ctx.font = '11px ui-monospace, Consolas, monospace';
        ctx.fillStyle = 'rgba(232,236,240,0.92)';
        ctx.fillText(p.name.slice(0, 14), x + r + 6, y + 4);
        hit.current.push({ x, y, r: r + 6, id: p.id, text: `${p.name}${p.dead ? ' · dead' : ` · ${Math.round(p.hp)} hp`}` });
      });
      // el cursor: ficha con lo que hay bajo él
      const h = hover.current;
      if (h) {
        const near = hit.current.find((q) => Math.hypot(q.x - h.x, q.y - h.y) <= q.r);
        if (near) {
          ctx.font = '12px ui-monospace, Consolas, monospace';
          const w = ctx.measureText(near.text).width + 14;
          ctx.fillStyle = 'rgba(8,11,16,0.94)'; ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath(); ctx.rect(Math.min(W - w - 4, h.x + 12), Math.min(H - 28, h.y + 12), w, 22); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#e8ecf0';
          ctx.fillText(near.text, Math.min(W - w - 4, h.x + 12) + 7, Math.min(H - 28, h.y + 12) + 15);
          c.style.cursor = near.id ? 'pointer' : 'default';
        } else c.style.cursor = 'grab';
      }
    };
    raf = win.requestAnimationFrame(loop);
    return () => win.cancelAnimationFrame(raf);
  }, []);

  const pos = (e: React.PointerEvent | React.WheelEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <div className="map">
      <canvas
        ref={cv}
        onPointerDown={(e) => ((drag.current = { ...pos(e), moved: false }), e.currentTarget.setPointerCapture(e.pointerId))}
        onPointerMove={(e) => {
          const p = pos(e), v = view.current, d = drag.current;
          hover.current = p;
          if (d && Math.hypot(p.x - d.x, p.y - d.y) > 3) {
            d.moved = true;
            v.fit = false;
            v.ox += (p.x - d.x) / v.s;
            v.oy += (p.y - d.y) / v.s;
            d.x = p.x;
            d.y = p.y;
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current, p = pos(e);
          drag.current = null;
          if (d && !d.moved) hit.current.find((q) => q.id && Math.hypot(q.x - p.x, q.y - p.y) <= q.r) && onPick(hit.current.find((q) => q.id && Math.hypot(q.x - p.x, q.y - p.y) <= q.r)!.id!);
        }}
        onPointerLeave={() => (hover.current = null)}
        onDoubleClick={() => (view.current.fit = true)}
        onWheel={(e) => {
          const v = view.current, p = pos(e), k = e.deltaY < 0 ? 1.15 : 1 / 1.15, ns = Math.max(2, Math.min(60, v.s * k));
          v.fit = false;
          v.ox = p.x / ns - (p.x / v.s - v.ox);
          v.oy = p.y / ns - (p.y / v.s - v.oy);
          v.s = ns;
        }}
      />
      <div className="radar" aria-hidden="true" />
      {!map && <p className="map__wait">Loading the plan…</p>}
    </div>
  );
}
