import { useEffect, useMemo, useRef, useState } from 'react';
import { MARKS, levelMap, type MarkKind } from '@backrooms/shared';
import { TILE_COLOR } from './thumb';

/*
 * El minimapa del visor de repeticiones (y de cualquier sitio que quiera orientarse): el plano REAL del nivel (se calcula con la semilla,
 * ver shared/levelmap.ts), una pestaña por capa (sigue solo a quien se mira), las marcas de lo que importa (inicio, ascensor, objetos,
 * escondites, escaleras...) con leyenda que se enciende y apaga, cuadricula con metros, y coordenadas bajo el cursor.
 * Rueda: zoom · arrastrar: mover · doble clic: encajar · clic en un punto: elegirlo · clic en el suelo: copia la posicion (formato F9).
 */
export type Dot = { id: string; x: number; y: number; z: number; yaw: number; color: string; label: string; dead?: boolean; watched?: boolean; ent?: boolean };

type Props = { levelId: string; seed: number; count: number; floor?: number; dots: Dot[]; cam?: { x: number; z: number } | null; onPick?: (id: string) => void; big?: boolean };

export function MiniMap({ levelId, seed, count, floor, dots, cam, onPick, big }: Props) {
  const map = useMemo(() => levelMap(levelId, seed, count, floor ?? 1), [levelId, seed, count, floor]);
  const cv = useRef<HTMLCanvasElement>(null);
  const out = useRef<HTMLSpanElement>(null);
  const [layer, setLayer] = useState<number | null>(null); // null: la de quien se mira
  const [follow, setFollow] = useState(true);
  const [off, setOff] = useState<Set<MarkKind>>(() => new Set(['spawn', 'vent', 'hide']));
  const [legend, setLegend] = useState(false);
  const P = useRef({ map, dots, cam, layer, follow, off, big });
  P.current = { map, dots, cam, layer, follow, off, big };
  const V = useRef({ s: 4, ox: 0, oz: 0, fit: true, mx: -1, my: -1 });
  const base = useRef<(HTMLCanvasElement | null)[]>([]);
  const hits = useRef<{ x: number; y: number; r: number; id: string }[]>([]);

  // la capa de cada punto: la mas cercana por altura
  const layerOf = (y: number) => {
    const ls = P.current.map?.layers ?? [];
    let b = 0;
    for (let i = 1; i < ls.length; i++) if (Math.abs(ls[i].y + 1 - y) < Math.abs(ls[b].y + 1 - y)) b = i;
    return b;
  };
  const watched = dots.find((d) => d.watched);
  const auto = watched ? layerOf(watched.y) : 0;
  const shown = layer ?? auto;

  useEffect(() => {
    base.current = [];
    V.current.fit = true;
  }, [map]);

  useEffect(() => {
    const c = cv.current;
    const win = c?.ownerDocument.defaultView;
    if (!c || !win) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const loop = (t: number) => {
      raf = win.requestAnimationFrame(loop);
      const p = P.current, v = V.current, dpr = win.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
      if (!W || !H) return;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) (c.width = Math.round(W * dpr)), (c.height = Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const m = p.map, cell = m?.cell ?? 1;
      const pts = p.dots.filter((d) => !d.ent);
      const wd = pts.find((d) => d.watched);
      const li = p.layer ?? (wd ? layerOf(wd.y) : 0);
      // el encuadre: todo el plano (o los puntos si no hay), o centrado en quien se mira
      if (v.fit) {
        const bw = m ? m.w * cell : Math.max(20, ...pts.map((d) => d.x)) + 10, bh = m ? m.h * cell : Math.max(20, ...pts.map((d) => d.z)) + 10;
        v.s = Math.min(W / bw, H / bh) * 0.97;
        v.ox = (bw - W / v.s) / 2;
        v.oz = (bh - H / v.s) / 2;
      } else if (p.follow && wd) {
        v.ox = wd.x - W / 2 / v.s;
        v.oz = wd.z - H / 2 / v.s;
      }
      const sx = (x: number) => (x - v.ox) * v.s, sz = (z: number) => (z - v.oz) * v.s;
      if (m) {
        let b = base.current[li];
        if (!b) {
          b = ctx.canvas.ownerDocument.createElement('canvas');
          b.width = m.w;
          b.height = m.h;
          const bx = b.getContext('2d')!, img = bx.createImageData(m.w, m.h), tiles = m.layers[li].tiles;
          for (let i = 0; i < m.w * m.h; i++) {
            const col = TILE_COLOR[tiles[i]] ?? '#202a35';
            img.data.set([parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16), tiles[i] === '#' ? 0 : 255], i * 4);
          }
          bx.putImageData(img, 0, 0);
          base.current[li] = b;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(b, sx(0), sz(0), m.w * cell * v.s, m.h * cell * v.s);
      }
      // cuadricula cada 10 m (cada 5 si se acerca mucho) con los metros en los bordes
      const step = v.s > 14 ? 5 : v.s > 3.5 ? 10 : 20;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(216,212,192,0.07)';
      ctx.fillStyle = 'rgba(216,212,192,0.45)';
      ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.beginPath();
      for (let x = Math.ceil(v.ox / step) * step; sx(x) < W; x += step) (ctx.moveTo(sx(x), 0), ctx.lineTo(sx(x), H), ctx.fillText(String(x), sx(x) + 2, 9));
      for (let z = Math.ceil(v.oz / step) * step; sz(z) < H; z += step) (ctx.moveTo(0, sz(z)), ctx.lineTo(W, sz(z)), ctx.fillText(String(z), 2, sz(z) - 2));
      ctx.stroke();
      hits.current = [];
      // las marcas de esta capa
      if (m) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const k of m.marks) {
          if ((k.l ?? 0) !== li || p.off.has(k.k)) continue;
          const x = sx(k.x), y = sz(k.z);
          if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
          const d = MARKS[k.k];
          ctx.fillStyle = d.color;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(x - 5, y - 5, 10, 10);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#0b0b09';
          ctx.font = 'bold 8px ui-monospace, Consolas, monospace';
          ctx.fillText(d.ch, x, y + 0.5);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      // entidades (rombos rojos) y jugadores (punto con cono de hacia donde miran)
      const pulse = 0.5 + 0.5 * Math.sin(t / 300);
      for (const e of p.dots.filter((d) => d.ent)) {
        const x = sx(e.x), y = sz(e.z), r = 5, here = !m || layerOf(e.y) === li;
        ctx.globalAlpha = here ? 1 : 0.25;
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        (ctx.moveTo(x, y - r), ctx.lineTo(x + r, y), ctx.lineTo(x, y + r), ctx.lineTo(x - r, y), ctx.closePath());
        ctx.fill();
        if (here) (ctx.strokeStyle = `rgba(255,59,48,${0.5 * pulse})`), ctx.beginPath(), ctx.arc(x, y, r + 3 + pulse * 3, 0, 7), ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const d of pts) {
        const x = sx(d.x), y = sz(d.z), r = d.watched ? 6 : 4.5, here = !m || layerOf(d.y) === li;
        ctx.globalAlpha = here ? 1 : 0.28;
        const a = Math.atan2(-Math.cos(d.yaw), -Math.sin(d.yaw)); // (yaw 0 mira hacia -z, como en el juego)
        ctx.fillStyle = d.dead ? 'rgba(120,120,120,0.35)' : `${d.color}33`;
        ctx.beginPath();
        (ctx.moveTo(x, y), ctx.arc(x, y, 22, a - 0.55, a + 0.55), ctx.closePath());
        ctx.fill();
        ctx.fillStyle = d.dead ? '#777' : d.color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        if (d.watched) (ctx.strokeStyle = '#fff'), (ctx.lineWidth = 1.5), ctx.beginPath(), ctx.arc(x, y, r + 3 + pulse * 2, 0, 7), ctx.stroke();
        if (d.dead) (ctx.strokeStyle = '#ff5a52'), (ctx.lineWidth = 1.5), ctx.beginPath(), (ctx.moveTo(x - 4, y - 4), ctx.lineTo(x + 4, y + 4), ctx.moveTo(x + 4, y - 4), ctx.lineTo(x - 4, y + 4)), ctx.stroke();
        ctx.fillStyle = '#e8e4d0';
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.fillText(d.label, x + r + 3, y + 3);
        ctx.globalAlpha = 1;
        if (here) hits.current.push({ x, y, r: r + 5, id: d.id });
      }
      if (p.cam) (ctx.strokeStyle = '#fff'), (ctx.lineWidth = 1), ctx.strokeRect(sx(p.cam.x) - 4, sz(p.cam.z) - 4, 8, 8);
      // las coordenadas bajo el cursor
      if (out.current && v.mx >= 0 && !out.current.dataset.flash) out.current.textContent = `X ${(v.mx / v.s + v.ox).toFixed(1)} · Z ${(v.my / v.s + v.oz).toFixed(1)}`;
    };
    raf = win.requestAnimationFrame(loop);
    return () => win.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = V.current, r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const wx = mx / v.s + v.ox, wz = my / v.s + v.oz;
      v.fit = false;
      v.s = Math.max(1.5, Math.min(40, v.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      if (!P.current.follow || !P.current.dots.some((d) => d.watched)) (v.ox = wx - mx / v.s), (v.oz = wz - my / v.s);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, []);

  const drag = useRef<{ x: number; y: number; ox: number; oz: number; moved: boolean } | null>(null);
  const flash = (text: string) => {
    const o = out.current;
    if (!o) return;
    o.dataset.flash = '1';
    o.textContent = text;
    setTimeout(() => delete o.dataset.flash, 1400);
  };
  const click = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const h = hits.current.find((q) => (q.x - mx) ** 2 + (q.y - my) ** 2 <= q.r * q.r);
    if (h) return onPick?.(h.id);
    const v = V.current, x = mx / v.s + v.ox, z = my / v.s + v.oz, y = map?.layers[shown]?.y ?? 0;
    const text = `seed ${seed} level ${levelId} x ${x.toFixed(3)} y ${y.toFixed(3)} z ${z.toFixed(3)}`;
    void navigator.clipboard?.writeText(text).then(() => flash('POSITION COPIED'), () => flash('COULD NOT COPY'));
  };
  const present = map ? [...new Set(map.marks.filter((k) => (k.l ?? 0) === shown).map((k) => k.k))] : [];

  return (
    <div className="rp-mm" data-big={big ? '1' : undefined}>
      <div className="rp-mm__tabs">
        {map && map.layers.length > 1 && (
          <>
            <button type="button" aria-pressed={layer === null} onClick={() => setLayer(null)} title="Follow the watched player's layer">AUTO</button>
            {map.layers.map((l, i) => <button key={l.name} type="button" aria-pressed={layer === i} data-on={shown === i ? '1' : undefined} onClick={() => setLayer(i)}>{l.name}</button>)}
          </>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" aria-pressed={follow} onClick={() => setFollow((f) => !f)} title="Keep the watched player centered">FOLLOW</button>
        <button type="button" onClick={() => ((V.current.fit = true), setFollow(false))} title="Fit the whole level">FIT</button>
        <button type="button" aria-pressed={legend} onClick={() => setLegend((l) => !l)}>KEY</button>
      </div>
      <canvas
        ref={cv}
        className="rp-mm__cv"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: V.current.ox, oz: V.current.oz, moved: false };
        }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect(), v = V.current;
          v.mx = e.clientX - r.left;
          v.my = e.clientY - r.top;
          const d = drag.current;
          if (!d) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
          if (d.moved) (v.fit = false), setFollow(false), (v.ox = d.ox - (e.clientX - d.x) / v.s), (v.oz = d.oz - (e.clientY - d.y) / v.s);
        }}
        onPointerUp={(e) => {
          if (drag.current && !drag.current.moved) click(e);
          drag.current = null;
        }}
        onPointerLeave={() => (V.current.mx = -1)}
        onDoubleClick={() => (V.current.fit = true)}
      />
      {legend && (
        <div className="rp-mm__key">
          {present.length === 0 && <span className="rp-dim">NOTHING MARKED HERE</span>}
          {present.map((k) => (
            <button key={k} type="button" aria-pressed={!off.has(k)} onClick={() => setOff((o) => (o.has(k) ? new Set([...o].filter((x) => x !== k)) : new Set([...o, k])))}>
              <i style={{ background: MARKS[k].color }}>{MARKS[k].ch}</i>{MARKS[k].name}
            </button>
          ))}
        </div>
      )}
      <div className="rp-mm__foot"><span ref={out}>—</span><span className="rp-dim">{map ? `${map.layers[shown]?.name ?? ''} · CLICK = COPY` : 'NO PLAN · POINTS ONLY'}</span></div>
    </div>
  );
}
