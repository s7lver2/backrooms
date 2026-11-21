import { useEffect, useMemo, useRef, useState } from 'react';
import { CELL, HP_MAX } from '@backrooms/shared';
import Frame from '../game/Frame';
import type { BackroomsGame as Game } from '../game/game';
import { REPLAY_BUILD, REPLAY_FORMAT, type ReplayMeta } from './format';
import { deleteReplay, exportReplay, importReplay, listReplays, starReplay } from './store';
import './viewer.css';

/*
 * El visor de repeticiones. `ReplayList` es la lista de partidas guardadas (abrir, estrella, borrar, importar/exportar) y
 * `ReplayBar` va encima del juego mientras se mira una: mapa, jugadores (su punto de vista), timeline con marcadores y mandos.
 * El render es el del juego real (el espectador de siempre); aqui solo esta la interfaz.
 */
const COLORS = ['#e9a23b', '#5ec2c2', '#d97aa6', '#8fbf5a', '#7f8cf0', '#e0e0e0', '#c98a5a', '#b57cf0'];
const colorOf = (meta: ReplayMeta, id: string) => COLORS[Math.max(0, meta.players.findIndex((p) => p.id === id)) % COLORS.length];
const nameOf = (meta: ReplayMeta, id: string) => meta.players.find((p) => p.id === id)?.name ?? id.slice(0, 4);
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const LEVELS: Record<string, string> = { level0: 'LEVEL 0', poolrooms: 'POOLROOMS', suites: 'SUITES', parking: 'HABITABLE ZONE' };

export function ReplayList({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [list, setList] = useState<ReplayMeta[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = () => void listReplays().then(setList);
  useEffect(load, []);
  const file = useRef<HTMLInputElement>(null);
  const save = async (m: ReplayMeta) => {
    const b = await exportReplay(m.id);
    if (!b) return setMsg('COULD NOT EXPORT');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `backrooms-${m.levelId}-${m.seed}.replay` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <Frame title="REPLAYS" onBack={onBack}>
      <div className="rp-list">
        <div className="rp-list__bar">
          <button type="button" className="br-opt" onClick={() => file.current?.click()}>IMPORT FILE</button>
          <input ref={file} type="file" accept=".replay,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setMsg((await importReplay(f)) ? 'IMPORTED' : 'THAT FILE IS NOT A REPLAY OF THIS VERSION');
            load();
          }} />
          <span className="rp-dim">{msg}</span>
        </div>
        {list === null && <p className="rp-dim">LOADING…</p>}
        {list?.length === 0 && <p className="rp-dim">NO REPLAYS YET. THEY ARE SAVED AUTOMATICALLY WHEN YOU PLAY (SETTINGS → SAVE REPLAYS). THE LAST 10 ARE KEPT; STAR ONE TO KEEP IT.</p>}
        <ul>
          {list?.map((m) => {
            const old = m.v !== REPLAY_FORMAT || m.build !== REPLAY_BUILD;
            return (
              <li key={m.id} className="rp-row">
                <button type="button" className="rp-row__main" onClick={() => onOpen(m.id)}>
                  <b>{LEVELS[m.levelId] ?? m.levelId.toUpperCase()}{m.floor ? ` · FLOOR ${m.floor}` : ''}</b>
                  <span>{new Date(m.started).toLocaleString()} · {mmss(m.durationMs)} · {m.players.map((p) => p.name).join(', ') || '—'}</span>
                  <span className="rp-dim">SEED {m.seed} · {(m.size / 1024 / 1024).toFixed(1)} MB{m.truncated ? ' · CUT SHORT' : ''}{old ? ' · OLD VERSION (MAY NOT PLAY RIGHT)' : ''}</span>
                </button>
                <button type="button" className="rp-ico" aria-label={m.starred ? 'Unstar' : 'Star'} aria-pressed={m.starred} onClick={() => void starReplay(m.id, !m.starred).then(load)}>{m.starred ? '★' : '☆'}</button>
                <button type="button" className="rp-ico" aria-label="Export" onClick={() => void save(m)}>↓</button>
                <button type="button" className="rp-ico" aria-label="Delete" onClick={() => void deleteReplay(m.id).then(load)}>✕</button>
              </li>
            );
          })}
        </ul>
      </div>
    </Frame>
  );
}

type View = ReturnType<Game['replayView']>;

/** Capas de altura (cada ~3 m) que hay en la partida: las que se pueden elegir en el mapa. */
const band = (y: number) => Math.round(y / 3);

export function ReplayBar({ game, onExit }: { game: Game; onExit: () => void }) {
  const clock = game.replayClock, data = game.replayData;
  const [, tick] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [layer, setLayer] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const last = useRef<View | null>(null);

  useEffect(() => {
    const iv = setInterval(() => ((last.current = game.replayView()), setView(last.current), tick((n) => n + 1)), 100);
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
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [clock]);

  // los marcadores: muertes y «casi muertes» (la vida bajo del 20 % y sigue vivo)
  const marks = useMemo(() => {
    if (!data) return [];
    const out: { t: number; k: 'death' | 'near'; who: string; text: string }[] = [];
    const lastNear = new Map<string, number>();
    for (const e of data.events) {
      if (e.k === 'death' && e.id) out.push({ t: e.t, k: 'death', who: e.id, text: `${nameOf(data.meta, e.id)} DIED` });
      else if (e.k === 'hurt' && e.id) {
        const hp = (e.data as { hp: number }).hp;
        if (hp > 0 && hp <= HP_MAX * 0.2 && e.t - (lastNear.get(e.id) ?? -1e9) > 8000) (lastNear.set(e.id, e.t), out.push({ t: e.t, k: 'near', who: e.id, text: `${nameOf(data.meta, e.id)} · LOW HP` }));
      }
    }
    return out;
  }, [data]);

  useEffect(() => {
    const c = cv.current;
    if (!c || !view) return;
    const ctx = c.getContext('2d')!, W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const m = view.map;
    const mw = m?.w ?? 1, mh = m?.h ?? 1, s = Math.min(W / mw, H / mh);
    if (m) {
      const img = ctx.createImageData(m.w, m.h);
      for (let i = 0; i < m.w * m.h; i++) img.data.set(m.open[i] ? [44, 56, 70, 255] : [0, 0, 0, 0], i * 4);
      const o = document.createElement('canvas');
      o.width = m.w;
      o.height = m.h;
      o.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(o, 0, 0, m.w * s, m.h * s);
    }
    // sin plano (Poolrooms, parking): los puntos se encajan en lo que se ve de la partida
    const pts = [...view.players, ...view.ents];
    const minX = Math.min(...pts.map((p) => p.x), 0), maxX = Math.max(...pts.map((p) => p.x), 1), minZ = Math.min(...pts.map((p) => p.z), 0), maxZ = Math.max(...pts.map((p) => p.z), 1);
    const fs = Math.min(W / (maxX - minX + 4), H / (maxZ - minZ + 4));
    const px = (x: number) => (m ? (x / CELL) * s : (x - minX + 2) * fs), pz = (z: number) => (m ? (z / CELL) * s : (z - minZ + 2) * fs);
    const here = (y: number) => layer === null || band(y) === layer;
    ctx.fillStyle = '#c2362f';
    for (const e of view.ents) if (here(e.y)) (ctx.beginPath(), ctx.arc(px(e.x), pz(e.z), 3, 0, 7), ctx.fill());
    for (const p of view.players) {
      if (!data) break;
      ctx.globalAlpha = here(p.y) ? 1 : 0.25;
      ctx.fillStyle = p.dead ? '#666' : colorOf(data.meta, p.id);
      ctx.beginPath();
      ctx.arc(px(p.x), pz(p.z), p.id === view.watching ? 6 : 4, 0, 7);
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(px(p.x), pz(p.z));
      ctx.lineTo(px(p.x) - Math.sin(p.yaw) * 10, pz(p.z) - Math.cos(p.yaw) * 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (view.free) (ctx.strokeStyle = '#fff'), ctx.strokeRect(px(view.cam.x) - 4, pz(view.cam.z) - 4, 8, 8);
  }, [view, layer, data]);

  if (!clock || !data) return null;
  const bands = [...new Set((view?.players ?? []).map((p) => band(p.y)))].sort((a, b) => b - a);
  const seek = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    clock.seek(((e.clientX - r.left) / r.width) * clock.end);
  };
  return (
    <div className="rp-hud" onKeyDown={(e) => e.stopPropagation()}>
      <div className="rp-top">
        <span>REPLAY · {LEVELS[data.meta.levelId] ?? data.meta.levelId.toUpperCase()} · SEED {data.meta.seed}</span>
        <button type="button" className="br-opt" onClick={onExit}>EXIT</button>
      </div>
      <div className="rp-side">
        <canvas ref={cv} width={220} height={220} className="rp-map" />
        {bands.length > 1 && (
          <div className="rp-layers" aria-label="Layers">
            <button type="button" aria-pressed={layer === null} onClick={() => setLayer(null)}>ALL</button>
            {bands.map((b) => <button key={b} type="button" aria-pressed={layer === b} onClick={() => setLayer(b)}>{b}</button>)}
          </div>
        )}
        <div className="rp-who">
          {data.meta.players.map((p) => (
            <button key={p.id} type="button" aria-pressed={view?.watching === p.id} style={{ borderColor: colorOf(data.meta, p.id) }} onClick={() => game.replayWatch(p.id)} onDoubleClick={() => game.replayWatch(p.id, 'chase')} title="Click: their eyes · double click: from behind">{p.name}</button>
          ))}
          <button type="button" aria-pressed={view?.free} onClick={() => game.replayFree()}>FREE CAM</button>
        </div>
      </div>
      <div className="rp-bottom">
        <button type="button" className="rp-ico" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => (clock.playing = !clock.playing)}>{clock.playing ? '❚❚' : '▶'}</button>
        <button type="button" className="rp-ico" aria-label="Back 5 seconds" onClick={() => clock.seek(clock.t - 5000)}>−5</button>
        <button type="button" className="rp-ico" aria-label="Forward 5 seconds" onClick={() => clock.seek(clock.t + 5000)}>+5</button>
        <div className="rp-tl" ref={bar} onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), seek(e))} onPointerMove={(e) => e.buttons && seek(e)}>
          <div className="rp-tl__fill" style={{ width: `${(clock.t / clock.end) * 100}%` }} />
          {marks.map((m, i) => <i key={i} className="rp-mk" data-k={m.k} title={`${mmss(m.t)} · ${m.text}`} style={{ left: `${(m.t / clock.end) * 100}%` }} />)}
        </div>
        <span className="rp-time">{mmss(clock.t)} / {mmss(clock.end)}</span>
        <select aria-label="Speed" value={clock.speed} onChange={(e) => (clock.speed = Number(e.target.value))}>
          {[0.25, 0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}×</option>)}
        </select>
      </div>
      <p className="rp-help">SPACE PAUSE · , . ±5 S · [ ] SPEED · TAB / ← → NEXT PLAYER · V EYES / BEHIND · C FREE CAM · CLICK THE PICTURE TO LOOK AROUND</p>
    </div>
  );
}
