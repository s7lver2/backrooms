import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ACHIEVEMENTS, ENTITIES, ITEMS, ITEM_IDS, LEVELS, RARITIES, UPGRADES, UP_IDS, upLevel, type AdminAction, type AdminFx, type AdminInfo, type ItemId, type Kind, type RoomView } from '@backrooms/shared';
import type { BackroomsGame } from './game';
import type { Sock } from '../net';
import { netStats } from '../net';
import { copyText, errClear, errList, errReport, errSubscribe, errTotal, errVersion } from '../errlog';
import './admin.css';

/*
 * Consola de admin (tecla ` o F9). OJO: que se vea es solo cosmético (Me.admin de /api/me); el servidor vuelve a comprobar la cuenta en
 * cada evento `admin` (server/src/index.ts) y rechaza a cualquiera que no sea ADMIN_USER. En una sala los trucos de partida van al servidor;
 * los del propio cliente (velocidad, salto, aguante y cordura infinitos, luz total...) se aplican aquí. Con la consola abierta el puntero
 * queda suelto y el juego no recibe teclas: se hace con una llave propia de Input (`block('admin')`), que lo que haga el juego con
 * `suspend` (inventario, ordenador, tótem...) no pisa ni deja colgada.
 *
 * Las listas salen de las tablas de shared, no de botones escritos a mano: las entidades de ENTITIES, los objetos de ITEMS (más el botín), las
 * rarezas de RARITIES, las mejoras de UPGRADES, los niveles de LEVELS y los logros de ACHIEVEMENTS. Una entrada nueva en cualquiera de ellas
 * aparece aquí sola (y el servidor la valida contra la misma tabla).
 */
const name = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
/** Lo que se puede dar: todo ITEMS y una pieza de botín. */
const GIVE: { id: ItemId | 'loot'; name: string }[] = [...ITEM_IDS.map((id) => ({ id, name: ITEMS[id].name })), { id: 'loot', name: 'ARTIFACT (LOOT)' }];
interface Props {
  game: React.RefObject<BackroomsGame | undefined>;
  sock?: Sock;
  room: RoomView | null;
  me: string;
}

const POS = 'br-adm-pos';
const TABS = ['PLAYER', 'WORLD', 'ENTITIES', 'ITEMS', 'ROOM', 'DEBUG'] as const;
type Tab = (typeof TABS)[number];

const B = ({ children, run, on, wide }: { children: React.ReactNode; run: () => void; on?: boolean; wide?: boolean }) => (
  <button
    type="button"
    className="br-adm__b"
    data-on={on || undefined}
    data-wide={wide || undefined}
    onClick={(e) => (run(), e.currentTarget.blur())} // sin foco: Espacio o Intro no repiten el último botón
  >
    {children}
  </button>
);

const Slider = ({ label, v, min, max, step, set, fmt }: { label: string; v: number; min: number; max: number; step: number; set: (n: number) => void; fmt?: (n: number) => string }) => (
  <label className="br-adm__sl">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} onMouseUp={(e) => e.currentTarget.blur()} />
    <b>{fmt ? fmt(v) : v}</b>
  </label>
);

export default function AdminConsole({ game, sock, room, me }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('PLAYER');
  const [t, setT] = useState('me'); // el objetivo: 'me', 'all' o el id de un jugador
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [tog, setTog] = useState({ noclip: false, light: true, god: false, ammo: false, stamina: false, sanity: false, bright: false, speed: 1, jump: 1, slow: 1 });
  const [marks, setMarks] = useState<({ x: number; z: number; yaw: number } | null)[]>([null, null, null]);
  const [shot, setShot] = useState('');
  const [fx, setFx] = useState({ ao: false, smaa: false, sun: false });
  const [find, setFind] = useState('');
  const [count, setCount] = useState(1);
  const [rar, setRar] = useState(-1); // la rareza de lo que se da (-1: al azar)
  useSyncExternalStore(errSubscribe, errVersion); // los errores de render que van saliendo (errlog.ts): el contador de la cabecera y del botón
  const inRoom = !!sock && !!room;
  const openRef = useRef(open);
  openRef.current = open;
  // abierta, la consola es una ventana que se arrastra por la cabecera (la posición se recuerda) y, en vivo (por defecto), no pide el puntero ni se traga las teclas:
  // se sigue jugando con ella abierta (un clic en el juego recaptura el ratón). Con el modo en vivo apagado es modal, como antes
  const [live, setLive] = useState(true);
  const liveRef = useRef(live);
  liveRef.current = live;
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS) ?? 'null');
    } catch {
      return null;
    }
  });
  const drag = (e: React.PointerEvent) => {
    const b = box.current;
    if ((e.target as HTMLElement).closest('button') || !b) return;
    const r = b.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    let pos = { x: r.left, y: r.top };
    const mv = (m: PointerEvent) => {
      pos = { x: Math.max(0, Math.min(innerWidth - 60, m.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 30, m.clientY - dy)) };
      setAt(pos);
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      try {
        localStorage.setItem(POS, JSON.stringify(pos));
      } catch {}
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
    e.preventDefault();
  };

  // los efectos que manda el servidor a este jugador (teletransporte, objeto, curación)
  useEffect(() => {
    if (!sock) return;
    const on = (fx: AdminFx) => game.current?.adminFx(fx);
    sock.on('adminFx', on);
    return () => void sock.off('adminFx', on);
  }, [sock, game]);

  const toggle = useCallback(
    (on: boolean) => {
      const g = game.current;
      setOpen(on);
      if (!g) return;
      if (on) {
        if (!liveRef.current) g.input.clear();
        g.input.block('admin');
        g.input.unlock();
        setTog(g.adminState()); // el juego pudo reiniciarse: el panel muestra lo que hay de verdad
      } else {
        g.input.unblock('admin');
        g.input.clear();
        if (!g.input.suspend) g.input.lock(true); // (con Esc el navegador no da el puntero: sale «click to continue» y basta un clic)
      }
    },
    [game],
  );

  // la tecla: en captura y antes que nadie. Abierta, se traga todas (el juego no las recibe), 1–6 cambian de pestaña y Esc o la misma tecla la cierran
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text';
      const mine = e.code === 'Backquote' || e.code === 'F9';
      if (!openRef.current) return void (mine && !typing && !e.repeat && (e.preventDefault(), e.stopPropagation(), toggle(true)));
      if (!liveRef.current || typing) e.stopPropagation(); // en vivo, el juego sigue recibiendo las teclas (salvo escribiendo en el filtro)
      if (mine || e.code === 'Escape') return void (e.preventDefault(), !e.repeat && (typing && e.code === 'Escape' ? (e.target as HTMLElement).blur() : toggle(false)));
      const n = /^Digit([1-6])$/.exec(e.code);
      if (n && !typing && !liveRef.current) setTab(TABS[Number(n[1]) - 1]);
    };
    const up = (e: KeyboardEvent) => openRef.current && !liveRef.current && e.stopPropagation();
    // en vivo, un clic fuera de la consola vuelve a capturar el ratón para seguir jugando
    const click = (e: MouseEvent) => openRef.current && liveRef.current && e.button === 0 && !box.current?.contains(e.target as Node) && game.current?.input.lock(true);
    addEventListener('keydown', key, true);
    addEventListener('keyup', up, true);
    addEventListener('mousedown', click, true);
    return () => {
      removeEventListener('mousedown', click, true);
      removeEventListener('keydown', key, true);
      removeEventListener('keyup', up, true);
      if (openRef.current) game.current?.input.unblock('admin');
    };
  }, [toggle, game]);

  // el objetivo desaparece de la sala: vuelve a ME
  useEffect(() => {
    if (t !== 'me' && t !== 'all' && !room?.players.some((p) => p.id === t)) setT('me');
  }, [room, t]);

  const send = useCallback(
    (a: AdminAction, then?: (i?: AdminInfo) => void) => {
      if (!sock) return;
      sock.emit('admin', a, (r) => {
        if (r.ok) (setMsg('OK'), then?.(r.info));
        else setMsg(r.error ?? 'ERROR');
      });
    },
    [sock],
  );

  // información de depuración: en la sala la da el servidor; solo, el cliente
  const [solo, setSolo] = useState<ReturnType<BackroomsGame['adminInfo']> | null>(null);
  useEffect(() => {
    if (!open || tab !== 'DEBUG') return;
    const ask = () => (inRoom ? send({ a: 'info' }, (i) => i && setInfo(i)) : setSolo(game.current?.adminInfo() ?? null));
    ask();
    const id = setInterval(ask, 1000);
    return () => clearInterval(id);
  }, [open, tab, inRoom, send, game]);

  if (!open) return null;
  const g = game.current;
  const one = t !== 'me' && t !== 'all';
  const others = room?.players.filter((p) => p.id !== me) ?? [];
  const solo1 = (op: Parameters<BackroomsGame['adminSolo']>[0]) => g?.adminSolo(op);
  // cargar un nivel en solitario reinicia el juego: la llave del panel sigue puesta, solo se vuelve a soltar el puntero
  const hold = (f: () => void) => (f(), g?.input.unlock());
  const flipLocal = (k: 'noclip' | 'light' | 'god') => {
    const on = !tog[k];
    setTog({ ...tog, [k]: on });
    g?.adminToggle(k, on);
  };
  const flipCheat = (k: 'stamina' | 'sanity' | 'bright' | 'ammo') => {
    const on = !tog[k];
    setTog({ ...tog, [k]: on });
    g?.adminCheat(k, on);
  };
  // modo dios: inmortal, sin cansancio ni locura, atravesando paredes y con el doble de velocidad; otra vez lo apaga todo
  const godMode = !!(tog.god && tog.stamina && tog.sanity && tog.noclip);
  const flipGodMode = () => {
    const on = !godMode;
    setTog({ ...tog, god: on, stamina: on, sanity: on, noclip: on, speed: on ? 2 : 1 });
    g?.adminToggle('god', on);
    g?.adminToggle('noclip', on);
    g?.adminCheat('stamina', on);
    g?.adminCheat('sanity', on);
    g?.adminCheat('speed', on ? 2 : 1);
    if (inRoom) send({ a: 'god', t: 'me', on });
  };
  const val = (k: 'speed' | 'jump' | 'slow', n: number) => (setTog({ ...tog, [k]: n }), g?.adminCheat(k, n));
  const give = (id: ItemId | 'loot') => (inRoom ? send({ a: 'give', t, item: id, ...(rar >= 0 ? { r: rar } : {}) }) : id !== 'loot' && solo1({ item: id }));
  const spawn = (kind: Kind) => Array.from({ length: count }).forEach(() => (inRoom ? send({ a: 'ent', op: 'spawn', kind, near: t === 'all' ? 'me' : t }) : solo1({ spawn: kind })));
  // las mejoras del objetivo (las de ME cuando es ALL)
  const ups = room?.players.find((p) => p.id === (one ? t : me))?.ups;
  const mine = t === 'me' || !inRoom;
  const nErr = errList().length;
  // los errores de render al portapapeles, con la sala y la GPU, para pegarlos tal cual (sin errores copia igualmente el contexto)
  const copyErrs = async () => {
    const where = inRoom ? `room ${room!.code}  ${room!.phase}  round ${room!.round}  ${room!.levelId}  players ${room!.players.length}` : 'solo';
    const txt = [`${new Date().toISOString()}  ${where}`, g?.adminDiag(), '', errReport()].filter((l) => l !== undefined).join('\n');
    setMsg((await copyText(txt)) ? `COPIED · ${nErr ? `${nErr} RENDER ERRORS (${errTotal()}×)` : 'NO ERRORS RECORDED'}` : 'COPY FAILED');
  };

  return (
    <div ref={box} className="br-adm" role="dialog" aria-label="Admin console" style={at ? { left: at.x, top: at.y, right: 'auto' } : undefined} onContextMenu={(e) => e.stopPropagation()}>
      <header className="br-adm__h" onPointerDown={drag} title="Drag to move">
        <span>● ADMIN{nErr > 0 && <b className="br-adm__err"> · {nErr} RENDER ERR</b>}</span>
        <span className="br-adm__dim">{inRoom ? `ROOM ${room!.code}` : 'SOLO'} · DRAG HERE · ` / F9 / ESC CLOSE</span>
      </header>
      <div className="br-adm__row">
        <B on={live} run={() => setLive(!live)}>{live ? 'LIVE: KEEP PLAYING' : 'LIVE OFF: INPUT PAUSED'}</B>
        <B on={nErr > 0} run={() => void copyErrs()}>{nErr ? `COPY RENDER ERRORS · ${nErr}` : 'COPY RENDER ERRORS'}</B>
        {nErr > 0 && <B run={() => (errClear(), setMsg('ERRORS CLEARED'))}>CLEAR</B>}
        {at && <B run={() => (setAt(null), localStorage.removeItem(POS))}>RESET POSITION</B>}
      </div>
      <nav className="br-adm__tabs">
        {TABS.filter((x) => x !== 'ROOM' || inRoom).map((x) => (
          <button key={x} type="button" data-on={tab === x || undefined} onClick={(e) => (setTab(x), e.currentTarget.blur())}>
            {TABS.indexOf(x) + 1} {x}
          </button>
        ))}
      </nav>
      {msg && <p className="br-adm__msg">{msg}</p>}

      {inRoom && (tab === 'PLAYER' || tab === 'ITEMS' || tab === 'ENTITIES') && (
        <section>
          <h3>TARGET</h3>
          <div className="br-adm__row">
            <B on={t === 'me'} run={() => setT('me')}>ME</B>
            <B on={t === 'all'} run={() => setT('all')}>ALL</B>
            {others.map((p) => (
              <B key={p.id} on={t === p.id} run={() => setT(p.id)}>{p.name.slice(0, 12)}</B>
            ))}
          </div>
        </section>
      )}

      {tab === 'PLAYER' && (
        <>
          <section>
            <h3>STATE</h3>
            <div className="br-adm__row">
              <B wide on={godMode} run={flipGodMode}>★ GOD MODE</B>
              <B run={() => (inRoom ? send({ a: 'heal', t }) : solo1('heal'))}>FULL HEAL</B>
              <B run={() => (inRoom ? send({ a: 'kill', t }) : solo1('kill'))}>KILL</B>
              {inRoom && <B run={() => send({ a: 'revive', t })}>REVIVE</B>}
              <B on={tog.god} run={() => (inRoom && !mine ? send({ a: 'god', t, on: true }) : flipLocal('god'))}>GOD</B>
              {inRoom && !mine && <B run={() => send({ a: 'god', t, on: false })}>GOD OFF</B>}
              <B on={tog.ammo} run={() => (inRoom ? (send({ a: 'ammo', t, on: mine ? !tog.ammo : true }), mine && setTog({ ...tog, ammo: !tog.ammo })) : flipCheat('ammo'))}>INF AMMO</B>
              {inRoom && !mine && <B run={() => send({ a: 'ammo', t, on: false })}>AMMO OFF</B>}
            </div>
          </section>
          {inRoom && (
            <section>
              <h3>ACHIEVEMENTS · TARGET NEEDS AN ACCOUNT</h3>
              <div className="br-adm__row">
                <B run={() => send({ a: 'award', t, key: '*' })}>AWARD ALL</B>
              </div>
              <div className="br-adm__row">
                {ACHIEVEMENTS.map((x) => (
                  <B key={x.key} run={() => send({ a: 'award', t, key: x.key })}>{x.name}</B>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3>CHEATS · THIS CLIENT</h3>
            <div className="br-adm__row">
              <B on={tog.noclip} run={() => flipLocal('noclip')}>NOCLIP</B>
              <B on={tog.stamina} run={() => flipCheat('stamina')}>INF STAMINA</B>
              <B on={tog.sanity} run={() => flipCheat('sanity')}>INF SANITY</B>
              <B on={tog.bright} run={() => flipCheat('bright')}>FULLBRIGHT</B>
              <B on={!tog.light} run={() => flipLocal('light')}>LIGHTS OFF</B>
            </div>
            <Slider label="SPEED" v={tog.speed} min={0.5} max={6} step={0.5} set={(n) => val('speed', n)} fmt={(n) => `x${n}`} />
            <Slider label="JUMP" v={tog.jump} min={1} max={4} step={0.5} set={(n) => val('jump', n)} fmt={(n) => `x${n}`} />
            {!inRoom && <Slider label="TIME" v={tog.slow} min={0.1} max={1} step={0.1} set={(n) => val('slow', n)} fmt={(n) => `x${n.toFixed(1)}`} />}
          </section>
          <section>
            <h3>TELEPORT</h3>
            <div className="br-adm__row">
              <B run={() => (inRoom ? send({ a: 'tp', t, to: 'elevator' }) : solo1('elevator'))}>ELEVATOR</B>
              <B run={() => (inRoom ? send({ a: 'tp', t, to: 'start' }) : solo1('start'))}>START</B>
              {inRoom && one && <B run={() => send({ a: 'tp', t, to: 'player', who: 'me' })}>BRING TO ME</B>}
              {inRoom && one && <B run={() => send({ a: 'tp', t: 'me', to: 'player', who: t })}>GO TO PLAYER</B>}
            </div>
            {!inRoom && (
              <div className="br-adm__row">
                {marks.map((m, i) => (
                  <span key={i} className="br-adm__mark">
                    <B run={() => setMarks(marks.map((x, j) => (j === i ? (g?.adminPos() ?? null) : x)))}>SAVE {i + 1}</B>
                    {m && <B run={() => g?.adminGoto(m)}>GO {i + 1}</B>}
                  </span>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'WORLD' && (
        <>
          <section>
            <h3>LEVELS</h3>
            <div className="br-adm__row">
              {Object.values(LEVELS).filter((l) => inRoom || l.id === 'level0').map((l) => (
                <B key={l.id} run={() => (inRoom ? send({ a: 'level', id: l.id }) : hold(() => g?.adminLevel0()))}>{l.name} · NEW SEED</B>
              ))}
              <B run={() => (inRoom ? send({ a: 'run', t }) : hold(() => g?.adminRun()))}>RUN FOR YOUR LIFE</B>
              {inRoom && <B run={() => send({ a: 'lobby' })}>WAITING ROOM</B>}
            </div>
          </section>
          <section>
            <h3>ROUND</h3>
            <div className="br-adm__row">
              <B run={() => (inRoom ? send({ a: 'mission' }) : solo1('mission'))}>COMPLETE MISSION</B>
              <B run={() => (inRoom ? send({ a: 'tvs' }) : solo1('tvs'))}>TVS OFF</B>
              {inRoom && <B run={() => send({ a: 'end', ok: true })}>END · SUCCESS</B>}
              {inRoom && <B run={() => send({ a: 'end', ok: false })}>END · FAILURE</B>}
            </div>
          </section>
        </>
      )}

      {tab === 'ENTITIES' && (
        <section>
          <h3>SPAWN × {count}</h3>
          <Slider label="COUNT" v={count} min={1} max={8} step={1} set={setCount} />
          <div className="br-adm__row">
            {(Object.keys(ENTITIES) as Kind[]).map((k) => (
              <B key={k} run={() => spawn(k)}>+ {name(k)}</B>
            ))}
          </div>
          <div className="br-adm__row">
            <B run={() => (inRoom ? send({ a: 'ent', op: 'clear' }) : solo1('clear'))}>CLEAR ALL</B>
            <B run={() => (inRoom ? send({ a: 'ent', op: 'freeze' }) : solo1('freeze'))}>FREEZE</B>
            <B run={() => (inRoom ? send({ a: 'ent', op: 'thaw' }) : solo1('thaw'))}>THAW</B>
          </div>
        </section>
      )}

      {tab === 'ITEMS' && (
        <section>
          <h3>GIVE ITEM</h3>
          {inRoom && (
            <div className="br-adm__row">
              <B on={rar < 0} run={() => setRar(-1)}>RANDOM</B>
              {RARITIES.map((x, i) => (
                <B key={x.name} on={rar === i} run={() => setRar(i)}>{x.name}</B>
              ))}
            </div>
          )}
          <div className="br-adm__row">
            <B run={() => GIVE.forEach((s) => give(s.id))}>GIVE ALL</B>
          </div>
          <input className="br-adm__find" type="text" placeholder="FILTER…" value={find} onChange={(e) => setFind(e.target.value)} spellCheck={false} />
          <div className="br-adm__row">
            {GIVE.filter((s) => (inRoom || s.id !== 'loot') && s.name.toLowerCase().includes(find.trim().toLowerCase())).map((s) => (
              <B key={s.id} run={() => give(s.id)}>{s.name}</B>
            ))}
          </div>
        </section>
      )}

      {tab === 'ROOM' && inRoom && (
        <section>
          <h3>UPGRADES · {t === 'all' ? 'ALL' : one ? 'TARGET' : 'ME'}</h3>
          <div className="br-adm__row">
            {(['me', 'all', ...others.map((p) => p.id)] as string[]).map((id) => (
              <B key={id} on={t === id} run={() => setT(id)}>{id === 'me' ? 'ME' : id === 'all' ? 'ALL' : (others.find((p) => p.id === id)?.name ?? '').slice(0, 12)}</B>
            ))}
          </div>
          <div className="br-adm__row">
            <B run={() => send({ a: 'ups', t, id: '*', lv: 99 })}>MAX ALL</B>
            <B run={() => send({ a: 'ups', t, id: '*', lv: 0 })}>RESET ALL</B>
          </div>
          {UP_IDS.map((id) => (
            <Slider key={id} label={UPGRADES[id].name} v={upLevel(ups, id)} min={0} max={UPGRADES[id].cost.length} step={1} set={(n) => send({ a: 'ups', t, id, lv: n })} fmt={(n) => UPGRADES[id].fmt(UPGRADES[id].val[n])} />
          ))}
        </section>
      )}
      {tab === 'ROOM' && inRoom && (
        <section>
          <h3>MONEY · BANK ${room!.bank}</h3>
          <div className="br-adm__row">
            <B run={() => send({ a: 'money', mode: 'add', n: 100 })}>+100</B>
            <B run={() => send({ a: 'money', mode: 'add', n: 1000 })}>+1000</B>
            <B run={() => send({ a: 'money', mode: 'add', n: 10000 })}>+10000</B>
            <B run={() => send({ a: 'money', mode: 'set', n: 0 })}>SET 0</B>
            <B run={() => send({ a: 'money', mode: 'set', n: 5000 })}>SET 5000</B>
          </div>
        </section>
      )}

      {tab === 'DEBUG' && (
        <section>
          <h3>INFO</h3>
          <div className="br-adm__row">
            <B wide run={() => void g?.adminShot().then((t) => setShot(t))}>SCREENSHOT + SEED + POS → CLIPBOARD</B>
          </div>
          <div className="br-adm__row">
            {(['ao', 'smaa', 'sun'] as const).map((k) => (
              <B key={k} run={() => g && setFx(g.adminPerf(k))}>{`${k === 'sun' ? 'SUN SHADOW' : k.toUpperCase()} ${fx[k] ? 'ON' : 'OFF'}`}</B>
            ))}
            <B run={() => g && setFx(g.adminPerf())}>REFRESH</B>
          </div>
          {shot && <pre className="br-adm__info">{`COPIED
${shot}`}</pre>}
          {inRoom && info && (
            <pre className="br-adm__info">
              {`SEED ${info.seed}  LEVEL ${info.levelId}  ROUND ${info.round}  ${info.phase.toUpperCase()}\nT ${info.elapsed}s  ENTS ${info.ents}${info.frozen ? ' (FROZEN)' : ''}  PING ${netStats.rtt}ms\nMISSION ${info.mission}\n`}
              {info.players.map((p) => `${p.name.slice(0, 12)} HP ${Math.round(p.hp)}${p.dead ? ' DEAD' : ''}${p.god ? ' GOD' : ''}`).join('\n')}
            </pre>
          )}
          {!inRoom && solo && <pre className="br-adm__info">{`SEED ${solo.seed}  LEVEL ${solo.level}  T ${solo.t}s\nENTS ${solo.ents}  HP ${solo.hp}\nMISSION ${solo.mission}`}</pre>}
        </section>
      )}
    </div>
  );
}
