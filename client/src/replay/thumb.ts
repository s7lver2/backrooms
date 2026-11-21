import { TILE, levelMap } from '@backrooms/shared';
import type { ReplayMeta } from './format';

/*
 * El «fotograma especial» de cada repeticion en la lista: el plano de la zona donde se jugo con el recorrido (ambar), el inicio (verde),
 * las muertes (rojo) y el final (blanco). Se dibuja al terminar de grabar y se guarda como JPEG diminuto en la ficha.
 */
export const THUMB_W = 192;
export const THUMB_H = 128;
export const TILE_COLOR: Record<string, string> = {
  [TILE.wall]: '#2f2a1e',
  [TILE.column]: '#2f2a1e',
  [TILE.floor]: '#2b3948',
  [TILE.dim]: '#202a35',
  [TILE.shallow]: '#2f6573',
  [TILE.deep]: '#1f4663',
  [TILE.stairs]: '#7a6522',
  [TILE.slide]: '#7a6522',
  [TILE.gas]: '#55662f',
};

export type Trace = { path: number[][]; deaths: number[][]; end?: number[] };

export function renderThumb(meta: Pick<ReplayMeta, 'levelId' | 'seed' | 'floor' | 'players'>, tr: Trace): string | undefined {
  try {
    const g = Object.assign(document.createElement('canvas'), { width: THUMB_W, height: THUMB_H }).getContext('2d');
    if (!g || !tr.path.length) return undefined;
    g.fillStyle = '#0b0b09';
    g.fillRect(0, 0, THUMB_W, THUMB_H);
    // la zona: el recorrido con margen, al menos 36 m de ancho y con la proporcion de la miniatura
    const xs = tr.path.map((p) => p[0]), zs = tr.path.map((p) => p[1]);
    let x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, z0 = Math.min(...zs) - 10, z1 = Math.max(...zs) + 10;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let bw = Math.max(36, x1 - x0), bh = Math.max(24, z1 - z0);
    if (bw / bh > THUMB_W / THUMB_H) bh = (bw * THUMB_H) / THUMB_W;
    else bw = (bh * THUMB_W) / THUMB_H;
    (x0 = cx - bw / 2), (z0 = cz - bh / 2), (x1 = cx + bw / 2), (z1 = cz + bh / 2);
    const s = THUMB_W / bw;
    const px = (x: number) => (x - x0) * s, pz = (z: number) => (z - z0) * s;
    const m = levelMap(meta.levelId, meta.seed, Math.max(1, meta.players.length), meta.floor ?? 1);
    if (m) {
      // la capa donde se estuvo mas tiempo (Poolrooms tiene dos)
      const ys = tr.path.map((p) => p[2]).sort((a, b) => a - b), my = ys[ys.length >> 1] ?? 0;
      const layer = m.layers.reduce((a, l) => (Math.abs(l.y - my) < Math.abs(a.y - my) ? l : a), m.layers[0]);
      const cs = m.cell * s + 0.6;
      for (let cy = Math.max(0, Math.floor(z0 / m.cell)); cy < Math.min(m.h, Math.ceil(z1 / m.cell)); cy++) {
        for (let cx2 = Math.max(0, Math.floor(x0 / m.cell)); cx2 < Math.min(m.w, Math.ceil(x1 / m.cell)); cx2++) {
          g.fillStyle = TILE_COLOR[layer.tiles[cy * m.w + cx2]] ?? '#202a35';
          g.fillRect(px(cx2 * m.cell), pz(cy * m.cell), cs, cs);
        }
      }
    }
    g.lineJoin = 'round';
    g.strokeStyle = '#e9a23b';
    g.lineWidth = 1.6;
    g.beginPath();
    tr.path.forEach((p, i) => (i ? g.lineTo(px(p[0]), pz(p[1])) : g.moveTo(px(p[0]), pz(p[1]))));
    g.stroke();
    const dot = (p: number[], c: string, r: number) => (g.beginPath(), (g.fillStyle = c), g.arc(px(p[0]), pz(p[1]), r, 0, 7), g.fill());
    dot(tr.path[0], '#7ee787', 3.5);
    for (const d of tr.deaths) {
      g.strokeStyle = '#ff5a52';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px(d[0]) - 4, pz(d[1]) - 4);
      g.lineTo(px(d[0]) + 4, pz(d[1]) + 4);
      g.moveTo(px(d[0]) + 4, pz(d[1]) - 4);
      g.lineTo(px(d[0]) - 4, pz(d[1]) + 4);
      g.stroke();
    }
    if (tr.end) dot(tr.end, '#ffffff', 3);
    return g.canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}
