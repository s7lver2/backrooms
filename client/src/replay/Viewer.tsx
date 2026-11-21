import { useEffect, useMemo, useRef, useState } from 'react';
import { HP_MAX, type Inventory } from '@backrooms/shared';
import Frame from '../game/Frame';
import type { BackroomsGame as Game } from '../game/game';
import { REPLAY_BUILD, REPLAY_FORMAT, type ReplayMeta } from './format';
import { MAX_GIF_MS, MAX_VIDEO_MS, exportGif, exportVideo } from './export';
import { MiniMap, type Dot } from './MiniMap';
import { deleteReplays, exportReplay, importReplay, listReplays, patchReplay } from './store';
import './viewer.css';

/*
 * El visor de repeticiones. `ReplayList` es el menu de partidas guardadas (miniatura, nombre, fijar, seleccion multiple para borrar, peso y
 * con quien se jugo) y `ReplayBar` va encima del juego mientras se mira una: jugadores (vida, mano, linterna), el HUD de quien se mira
 * (aguante, cordura, bateria e inventario de quien grabo), minimapa con el plano real, registro de sucesos, timeline y mandos.
 * El render es el del juego real (el espectador de siempre); aqui solo esta la interfaz.
 */
const COLORS = ['#e9a23b', '#5ec2c2', '#d97aa6', '#8fbf5a', '#7f8cf0', '#e0e0e0', '#c98a5a', '#b57cf0'];
const colorOf = (meta: ReplayMeta, id: string) => COLORS[Math.max(0, meta.players.findIndex((p) => p.id === id)) % COLORS.length];
const nameOf = (meta: ReplayMeta, id: string) => meta.players.find((p) => p.id === id)?.name ?? id.slice(0, 4);
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const LEVELS: Record<string, string> = { level0: 'LEVEL 0', poolrooms: 'POOLROOMS', suites: 'SUITES', parking: 'HABITABLE ZONE' };
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const people = (m: ReplayMeta) => m.players.filter((p) => p.id !== m.me);
const heading = (m: ReplayMeta) => m.name?.trim() || `${LEVELS[m.levelId] ?? m.levelId.toUpperCase()}${m.floor ? ` · FLOOR ${m.floor}` : ''}`;
const isOld = (m: ReplayMeta) => m.v !== REPLAY_FORMAT || m.build !== REPLAY_BUILD;
function when(t: number) {
  const d = new Date(t), now = new Date(), day = (x: Date) => Math.floor(x.getTime() / 864e5 - x.getTimezoneOffset() / 1440);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return day(d) === day(now) ? `TODAY ${hm}` : day(d) === day(now) - 1 ? `YESTERDAY ${hm}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`;
}

/** El «fotograma especial» de cada repeticion: el plano con el recorrido dentro de un marco de cinta, con el instante destacado. */
function Thumb({ m, big }: { m: ReplayMeta; big?: boolean }) {
  return (
    <span className="rp-th" data-big={big ? '1' : undefined}>
      {m.thumb ? <img src={m.thumb} alt="" draggable={false} /> : <b className="rp-th__no">{(LEVELS[m.levelId] ?? '?')[0]}</b>}
      <i className="rp-th__rec">●</i>
      <span className="rp-th__tc">{mmss(m.hl ?? m.durationMs)}</span>
      {m.starred && <span className="rp-th__pin">PIN</span>}
    </span>
  );
}

export function ReplayList({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [list, setList] = useState<ReplayMeta[] | null>(null);
  const [msg, setMsg] = useState('');
  const [cur, setCur] = useState('');
  const [sel, setSel] = useState(false);
  const [chk, setChk] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const anchor = useRef('');
  const file = useRef<HTMLInputElement>(null);
  const load = () =>
    void listReplays().then((l) => {
      const s = [...l].sort((a, b) => Number(b.starred) - Number(a.starred) || b.started - a.started);
      setList(s);
      setCur((c) => (s.some((m) => m.id === c) ? c : s[0]?.id ?? ''));
      setChk((c) => new Set([...c].filter((id) => s.some((m) => m.id === id))));
    });
  useEffect(load, []);
  useEffect(() => document.getElementById(`rp-${cur}`)?.scrollIntoView({ block: 'nearest' }), [cur]);
  useEffect(() => setAsk(false), [cur, chk, sel]);
  useEffect(() => {
    if (!ask) return;
    const t = setTimeout(() => setAsk(false), 3500);
    return () => clearTimeout(t);
  }, [ask]);

  const now = list?.find((m) => m.id === cur);
  const total = (list ?? []).reduce((a, m) => a + m.size, 0);
  const targets = sel && chk.size ? [...chk] : now ? [now.id] : [];
  const save = async (m: ReplayMeta) => {
    const b = await exportReplay(m.id);
    if (!b) return setMsg('COULD NOT EXPORT');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `backrooms-${m.levelId}-${m.seed}.replay` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const del = async () => {
    if (!targets.length) return;
    if (!ask) return setAsk(true);
    setAsk(false);
    await deleteReplays(targets);
    setMsg(`${targets.length} DELETED`);
    setChk(new Set());
    load();
  };
  const pin = async (m: ReplayMeta) => (await patchReplay(m.id, { starred: !m.starred }), load());
  const rename = async (m: ReplayMeta, v: string) => (await patchReplay(m.id, { name: v.trim() || undefined }), setEdit(null), load());
  const pick = (m: ReplayMeta, e: React.MouseEvent) => {
    setCur(m.id);
    if (!sel || !list) return;
    if (e.shiftKey && anchor.current) {
      const a = list.findIndex((x) => x.id === anchor.current), b = list.findIndex((x) => x.id === m.id);
      setChk(new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id)));
    } else {
      anchor.current = m.id;
      setChk((c) => new Set(c.has(m.id) ? [...c].filter((x) => x !== m.id) : [...c, m.id]));
    }
  };
  const key = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || !list?.length) return;
    const i = list.findIndex((m) => m.id === cur);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), setCur(list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].id));
    else if (e.key === 'Home' || e.key === 'End') (e.preventDefault(), setCur(list[e.key === 'Home' ? 0 : list.length - 1].id));
    else if (e.key === 'Enter' && now) (e.preventDefault(), onOpen(now.id));
    else if (e.key === ' ' && sel && now) (e.preventDefault(), setChk((c) => new Set(c.has(now.id) ? [...c].filter((x) => x !== now.id) : [...c, now.id])));
    else if (e.key === 'F2' && now) (e.preventDefault(), setEdit(now.id));
    else if (e.key === 'Delete') (e.preventDefault(), void del());
    else if ((e.key === 'p' || e.key === 'P') && now) void pin(now);
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && sel) (e.preventDefault(), setChk(new Set(list.map((m) => m.id))));
  };

  return (
    <Frame title="REPLAYS" onBack={onBack}>
      <div className="rp-menu" tabIndex={-1} onKeyDown={key}>
        <div className="rp-menu__l">
          <div className="rp-tools">
            <span className="rp-dim">{list?.length ?? 0} SAVED · {mb(total)}</span>
            <span className="rp-tools__sp" />
            {sel && (
              <>
                <button type="button" className="br-opt" onClick={() => setChk(new Set(list?.map((m) => m.id)))}>ALL</button>
                <button type="button" className="br-opt" onClick={() => setChk(new Set())}>NONE</button>
                <button type="button" className="br-opt rp-danger" disabled={!chk.size} data-ask={ask ? '1' : undefined} onClick={() => void del()}>{ask ? `SURE? DELETE ${chk.size}` : `DELETE ${chk.size || ''}`}</button>
              </>
            )}
            <button type="button" className="br-opt" aria-pressed={sel} onClick={() => (setSel((s) => !s), setChk(new Set()), (anchor.current = ''))}>{sel ? 'DONE' : 'SELECT'}</button>
            <button type="button" className="br-opt" onClick={() => file.current?.click()}>IMPORT</button>
            <input ref={file} type="file" accept=".replay,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setMsg((await importReplay(f)) ? 'IMPORTED' : 'THAT FILE IS NOT A REPLAY OF THIS VERSION');
              load();
            }} />
          </div>
          {msg && <p className="rp-msg" key={msg}>{msg}</p>}
          {list === null && <p className="rp-dim">LOADING…</p>}
          {list?.length === 0 && <p className="rp-dim rp-empty">NO REPLAYS YET. THEY ARE SAVED AUTOMATICALLY WHEN YOU PLAY (SETTINGS → SAVE REPLAYS). THE LAST 10 ARE KEPT; PIN ONE TO KEEP IT.</p>}
          <ul className="rp-rows">
            {list?.map((m, i) => (
              <li key={m.id} id={`rp-${m.id}`} className="rp-r" style={{ ['--i' as string]: Math.min(i, 14) }} data-cur={m.id === cur ? '1' : undefined} data-chk={chk.has(m.id) ? '1' : undefined}>
                <button type="button" className="rp-r__b" onClick={(e) => pick(m, e)} onDoubleClick={() => !sel && onOpen(m.id)}>
                  {sel && <span className="rp-box">{chk.has(m.id) ? '■' : '□'}</span>}
                  <Thumb m={m} />
                  <span className="rp-r__t">
                    <b>{m.starred && '★ '}{heading(m)}</b>
                    <span>{when(m.started)} · {mmss(m.durationMs)} · {mb(m.size)}</span>
                    <span className="rp-dim">WITH {people(m).map((p) => p.name).join(', ') || 'NOBODY · SOLO'}{isOld(m) ? ' · OLD VERSION' : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <aside className="rp-menu__r" key={sel && chk.size > 1 ? 'multi' : cur}>
          {sel && chk.size > 1 ? (
            <div className="rp-det">
              <b className="rp-det__n">{chk.size} SELECTED</b>
              <span className="rp-dim">{mb((list ?? []).filter((m) => chk.has(m.id)).reduce((a, m) => a + m.size, 0))} IN TOTAL</span>
              <div className="rp-det__act"><button type="button" className="br-opt rp-danger" data-ask={ask ? '1' : undefined} onClick={() => void del()}>{ask ? 'SURE? DELETE ALL' : 'DELETE SELECTED'}</button></div>
            </div>
          ) : now ? (
            <div className="rp-det">
              <Thumb m={now} big />
              {edit === now.id ? (
                <input className="rp-name" autoFocus maxLength={40} defaultValue={now.name ?? ''} placeholder={heading({ ...now, name: undefined })} aria-label="Replay name"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') void rename(now, e.currentTarget.value);
                    else if (e.key === 'Escape') setEdit(null);
                  }}
                  onBlur={(e) => void rename(now, e.currentTarget.value)} />
              ) : (
                <b className="rp-det__n" onDoubleClick={() => setEdit(now.id)} title="Double click to rename">{heading(now)}</b>
              )}
              <dl className="rp-facts">
                <dt>PLAYED</dt><dd>{when(now.started)}</dd>
                <dt>LENGTH</dt><dd>{mmss(now.durationMs)}{now.truncated ? ' · CUT SHORT' : ''}</dd>
                <dt>SIZE</dt><dd>{mb(now.size)}</dd>
                <dt>PLACE</dt><dd>{LEVELS[now.levelId] ?? now.levelId.toUpperCase()}{now.floor ? ` · FLOOR ${now.floor}` : ''}</dd>
                <dt>SEED</dt><dd>{now.seed}</dd>
                <dt>WITH</dt><dd>{people(now).map((p) => p.name).join(', ') || 'NOBODY · SOLO'}</dd>
              </dl>
              {isOld(now) && <p className="rp-dim">RECORDED ON AN OLD VERSION. IT MAY NOT PLAY RIGHT.</p>}
              <div className="rp-det__act">
                <button type="button" className="br-opt" onClick={() => onOpen(now.id)}>WATCH</button>
                <button type="button" className="br-opt" onClick={() => setEdit(now.id)}>RENAME</button>
                <button type="button" className="br-opt" onClick={() => void pin(now)}>{now.starred ? 'UNPIN' : 'PIN'}</button>
                <button type="button" className="br-opt" onClick={() => void save(now)}>EXPORT</button>
                <button type="button" className="br-opt rp-danger" data-ask={ask ? '1' : undefined} onClick={() => void del()}>{ask ? 'SURE? DELETE' : 'DELETE'}</button>
              </div>
              <p className="rp-keys rp-dim">↑ ↓ MOVE · ENTER WATCH · F2 RENAME · P PIN · DEL DELETE</p>
            </div>
          ) : null}
        </aside>
      </div>
    </Frame>
  );
}

type View = ReturnType<Game['replayView']>;

const CHIPS: [keyof Inventory, string][] = [['spares', 'SPARE LIGHTS'], ['water', 'WATER'], ['totem', 'TOTEM'], ['ammo', 'AMMO']];
const FLAGS: [keyof Inventory, string][] = [['camera', 'CAMCORDER'], ['gun', 'RIFLE'], ['radar', 'RADAR'], ['tank', 'DIVING TANK'], ['watergun', 'WATER GUN']];
const HELD: Record<string, string> = { none: 'EMPTY HANDS', camera: 'CAMCORDER', gun: 'RIFLE' };

function Bar({ v, c, label }: { v: number; c?: string; label?: string }) {
  return (
    <span className="rp-bar" data-low={v < 0.25 ? '1' : undefined} title={label}>
      <i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: c }} />
    </span>
  );
}

export function ReplayBar({ game, onExit }: { game: Game; onExit: () => void }) {
  const clock = game.replayClock, data = game.replayData;
  const [, tick] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [hide, setHide] = useState(false);
  const [big, setBig] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; t: number } | null>(null);
  // el tramo a exportar (entrada y salida, en ms) y la exportacion en curso (progreso 0-1)
  const [range, setRange] = useState<[number, number] | null>(null);
  const [job, setJob] = useState<{ f: number; ctl: AbortController } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const iv = setInterval(() => (setView(game.replayView()), tick((n) => n + 1)), 70);
    return () => clearInterval(iv);
  }, [game]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!clock || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'Space') (e.preventDefault(), (clock.playing = !clock.playing));
      else if (e.code === 'Comma') clock.seek(clock.t - 5000);
      else if (e.code === 'Period') clock.seek(clock.t + 5000);
      else if (e.code === 'BracketLeft') clock.speed = Math.max(0.25, clock.speed / 2);
      else if (e.code === 'BracketRight') clock.speed = Math.min(4, clock.speed * 2);
      else if (e.code === 'KeyH') setHide((h) => !h);
      else if (e.code === 'KeyM') setBig((b) => !b);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [clock]);

  // los marcadores (muertes y «casi muertes») y el registro de sucesos
  const { marks, log, invs, stats } = useMemo(() => {
    const marks: { t: number; k: 'death' | 'near'; who: string; text: string }[] = [];
    const log: { t: number; k: string; text: string }[] = [];
    const invs: { t: number; d: Inventory }[] = [], stats: { t: number; d: number[] }[] = [];
    if (!data) return { marks, log, invs, stats };
    const lastNear = new Map<string, number>();
    for (const e of data.events) {
      if (e.k === 'death' && e.id) {
        const by = (e.data as { by?: { kind: string; ent?: string; id?: string; why?: string } } | undefined)?.by;
        const who = nameOf(data.meta, e.id);
        const how = by?.kind === 'player' ? ` TO ${nameOf(data.meta, by.id ?? '')}` : by?.kind === 'entity' ? ` TO A ${String(by.ent ?? 'THING').toUpperCase()}` : by?.why ? ` · ${by.why.toUpperCase()}` : '';
        marks.push({ t: e.t, k: 'death', who: e.id, text: `${who} DIED` });
        log.push({ t: e.t, k: 'death', text: `${who} WENT DOWN${how}` });
      } else if (e.k === 'hurt' && e.id) {
        const d = e.data as { hp: number; was: number };
        log.push({ t: e.t, k: 'hurt', text: `${nameOf(data.meta, e.id)} −${Math.round(d.was - d.hp)} HP` });
        if (d.hp > 0 && d.hp <= HP_MAX * 0.2 && e.t - (lastNear.get(e.id) ?? -1e9) > 8000) (lastNear.set(e.id, e.t), marks.push({ t: e.t, k: 'near', who: e.id, text: `${nameOf(data.meta, e.id)} · LOW HP` }));
      } else if (e.k === 'inv') invs.push({ t: e.t, d: e.data as Inventory });
      else if (e.k === 'stat') stats.push({ t: e.t, d: e.data as number[] });
    }
    return { marks, log, invs, stats };
  }, [data]);

  if (!clock || !data) return null;
  const meta = data.meta;
  const at = <T extends { t: number }>(a: T[]) => {
    let lo = 0, hi = a.length - 1, r: T | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].t <= clock.t) ((r = a[mid]), (lo = mid + 1));
      else hi = mid - 1;
    }
    return r;
  };
  const watched = view?.players.find((p) => p.id === view.watching);
  const mine = !!watched && watched.id === meta.me;
  const inv = at(invs)?.d, st = at(stats)?.d;
  const recent = log.filter((l) => l.t <= clock.t && clock.t - l.t < 14000).slice(-6);

  const save = async (kind: 'video' | 'gif') => {
    const [a, b] = range ?? [Math.max(0, clock.t - 5000), Math.min(clock.end, clock.t + 5000)];
    const ctl = new AbortController();
    setErr('');
    setJob({ f: 0, ctl });
    const was = clock.playing;
    try {
      const o = { canvas: game.canvas, clock, from: a, to: b, signal: ctl.signal, onProgress: (f: number) => setJob({ f, ctl }) };
      const blob = await (kind === 'video' ? exportVideo(o) : exportGif(o));
      if (blob) {
        const ext = kind === 'gif' ? 'gif' : blob.type.includes('mp4') ? 'mp4' : 'webm';
        const el = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `backrooms-${meta.seed}-${mmss(a).replace(':', 'm')}.${ext}` });
        el.click();
        setTimeout(() => URL.revokeObjectURL(el.href), 4000);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message.toUpperCase() : 'EXPORT FAILED');
    }
    clock.playing = was;
    setJob(null);
  };
  const seek = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    clock.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * clock.end);
  };
  const dots: Dot[] = [
    ...(view?.players ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, color: colorOf(meta, p.id), label: nameOf(meta, p.id), dead: p.dead, watched: p.id === view?.watching })),
    ...(view?.ents ?? []).map((e, i) => ({ id: `e${i}`, x: e.x, y: e.y, z: e.z, yaw: 0, color: '#ff3b30', label: '', ent: true })),
  ];
  const frac = clock.t / clock.end;

  return (
    <div className="rp-hud" data-hide={hide ? '1' : undefined} onKeyDown={(e) => e.stopPropagation()}>
      <div className="rp-scan" aria-hidden="true" />
      <div className="rp-top">
        <span className="rp-title"><i className="rp-rec">●</i> REPLAY · {meta.name?.trim() || LEVELS[meta.levelId] || meta.levelId.toUpperCase()} · {mmss(clock.t)}</span>
        <span className="rp-top__sp" />
        <button type="button" className="rp-btn" onClick={() => setHide((h) => !h)} aria-pressed={hide}>{hide ? 'SHOW HUD · H' : 'HIDE HUD · H'}</button>
        <button type="button" className="rp-btn" onClick={onExit}>EXIT</button>
      </div>

      <div className="rp-roster">
        {meta.players.map((p, i) => {
          const v = view?.players.find((q) => q.id === p.id);
          const on = view?.watching === p.id, hp = (v?.hp ?? HP_MAX) / HP_MAX;
          return (
            <button key={p.id} type="button" className="rp-pl" aria-pressed={on} data-dead={v?.dead ? '1' : undefined} style={{ ['--c' as string]: colorOf(meta, p.id), ['--i' as string]: i }}
              onClick={() => game.replayWatch(p.id)} onDoubleClick={() => game.replayWatch(p.id, 'chase')} title="Click: their eyes · double click: from behind">
              <b>{on ? '▶ ' : ''}{p.name}{p.id === meta.me ? ' (REC)' : ''}</b>
              {v?.dead ? <span className="rp-dim">DOWN</span> : <Bar v={hp} c="#7ee787" label="Health" />}
              <span className="rp-dim">{v ? `${v.held === 'none' ? '' : `${HELD[v.held]} · `}${v.light ? 'LIGHT ON' : 'LIGHT OFF'}` : ''}</span>
            </button>
          );
        })}
        <button type="button" className="rp-pl rp-pl--free" aria-pressed={view?.free} onClick={() => game.replayFree()}><b>{view?.free ? '▶ ' : ''}FREE CAM</b><span className="rp-dim">C · FLY ANYWHERE</span></button>
      </div>

      <div className="rp-mapbox" data-big={big ? '1' : undefined}>
        <MiniMap levelId={meta.levelId} seed={meta.seed} count={Math.max(1, meta.players.length)} floor={meta.floor} dots={dots} cam={view?.free ? view.cam : null} big={big} onPick={(id) => game.replayWatch(id)} />
        <button type="button" className="rp-btn rp-mapbox__sz" onClick={() => setBig((b) => !b)}>{big ? 'SMALLER · M' : 'BIGGER · M'}</button>
      </div>

      {watched && (
        <div className="rp-me" key={watched.id} style={{ ['--c' as string]: colorOf(meta, watched.id) }}>
          <b className="rp-me__n">{nameOf(meta, watched.id)}</b>
          <div className="rp-me__row"><span>HP</span><Bar v={(watched.hp ?? HP_MAX) / HP_MAX} c="#7ee787" /><em>{Math.round(watched.hp ?? HP_MAX)}</em></div>
          {mine && st && (
            <>
              <div className="rp-me__row"><span>STA</span><Bar v={st[0]} c="#e9a23b" /><em>{Math.round(st[0] * 100)}</em></div>
              <div className="rp-me__row"><span>SAN</span><Bar v={st[1]} c="#b57cf0" /><em>{Math.round(st[1] * 100)}</em></div>
              <div className="rp-me__row"><span>BAT</span><Bar v={st[2]} c="#f0e68c" /><em>{Math.round(st[2] * 100)}</em></div>
            </>
          )}
          <div className="rp-me__hand">IN HAND · {HELD[watched.held] ?? '—'} · {watched.light ? 'LIGHT ON' : 'LIGHT OFF'}</div>
          {mine && inv ? (
            <div className="rp-inv">
              {FLAGS.filter(([k]) => inv[k]).map(([k, n]) => <i key={k} data-on="1">{n}</i>)}
              {CHIPS.filter(([k]) => Number(inv[k]) > 0).map(([k, n]) => <i key={k} data-on="1">{n} ×{String(inv[k])}</i>)}
              {!FLAGS.some(([k]) => inv[k]) && !CHIPS.some(([k]) => Number(inv[k]) > 0) && <i>NOTHING CARRIED</i>}
            </div>
          ) : (
            <div className="rp-me__note rp-dim">{meta.me ? `FULL INVENTORY ONLY FOR ${nameOf(meta, meta.me)} (WHO RECORDED)` : 'NO INVENTORY RECORDED'}</div>
          )}
        </div>
      )}

      <div className="rp-evs" aria-live="off">
        {recent.map((l) => <p key={`${l.t}${l.text}`} data-k={l.k} style={{ opacity: Math.max(0.25, 1 - (clock.t - l.t) / 14000) }}><em>{mmss(l.t)}</em> {l.text}</p>)}
      </div>

      <div className="rp-clip">
        <button type="button" onClick={() => setRange((r) => [Math.min(clock.t, (r?.[1] ?? clock.end) - 500), Math.max(r?.[1] ?? clock.end, clock.t + 500)])}>IN {range ? mmss(range[0]) : ''}</button>
        <button type="button" onClick={() => setRange((r) => [Math.min(r?.[0] ?? 0, clock.t - 500), Math.max(clock.t, (r?.[0] ?? 0) + 500)])}>OUT {range ? mmss(range[1]) : ''}</button>
        {range && <button type="button" onClick={() => setRange(null)}>CLEAR</button>}
        {job ? (
          <>
            <span>RECORDING {Math.round(job.f * 100)}%</span>
            <button type="button" onClick={() => job.ctl.abort()}>CANCEL</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void save('video')} title={`Up to ${MAX_VIDEO_MS / 1000} s, no sound`}>EXPORT VIDEO</button>
            <button type="button" onClick={() => void save('gif')} title={`Up to ${MAX_GIF_MS / 1000} s`}>EXPORT GIF</button>
          </>
        )}
        {err && <span className="rp-dim">{err}</span>}
      </div>

      <div className="rp-bottom">
        <button type="button" className="rp-ico" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => (clock.playing = !clock.playing)}>{clock.playing ? '❚❚' : '▶'}</button>
        <button type="button" className="rp-ico" aria-label="Back 5 seconds" onClick={() => clock.seek(clock.t - 5000)}>−5</button>
        <button type="button" className="rp-ico" aria-label="Forward 5 seconds" onClick={() => clock.seek(clock.t + 5000)}>+5</button>
        <div className="rp-tl" ref={bar}
          onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), seek(e))}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setTip({ x: f, t: f * clock.end });
            if (e.buttons) seek(e);
          }}
          onPointerLeave={() => setTip(null)}>
          <div className="rp-tl__fill" style={{ width: `${frac * 100}%` }} />
          {range && <div className="rp-tl__range" style={{ left: `${(range[0] / clock.end) * 100}%`, width: `${((range[1] - range[0]) / clock.end) * 100}%` }} />}
          {marks.map((m, i) => <i key={i} className="rp-mk" data-k={m.k} data-now={Math.abs(m.t - clock.t) < 1500 ? '1' : undefined} title={`${mmss(m.t)} · ${m.text}`} style={{ left: `${(m.t / clock.end) * 100}%` }} />)}
          <i className="rp-tl__head" style={{ left: `${frac * 100}%` }} />
          {tip && <span className="rp-tl__tip" style={{ left: `${tip.x * 100}%` }}>{mmss(tip.t)}</span>}
        </div>
        <span className="rp-time">{mmss(clock.t)} / {mmss(clock.end)}</span>
        <select aria-label="Speed" value={clock.speed} onChange={(e) => (clock.speed = Number(e.target.value))}>
          {[0.25, 0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}×</option>)}
        </select>
      </div>
      <p className="rp-help">SPACE PAUSE · , . ±5 S · [ ] SPEED · TAB / ← → NEXT PLAYER · V EYES / BEHIND · C FREE CAM · H HUD · M BIG MAP · DRAG THE PICTURE TO LOOK AROUND</p>
    </div>
  );
}
