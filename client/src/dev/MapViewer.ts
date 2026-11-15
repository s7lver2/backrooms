// Desarrollo: /?mapviewer&seed=N&level=level0|suites|poolrooms[&floor=1-5] dibuja la rejilla de `shared` en un canvas 2D (rueda: zoom, arrastrar: mover).
// Solo lee los generadores (generateMaze / suitesMaze / poolMaze); no toca el juego.
import { type Cell, type Maze, generateMaze, poolMaze, suitesMaze } from '@backrooms/shared';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed')) || 1;
const level = q.get('level') ?? 'level0';
const floor = Number(q.get('floor')) || 1;
const m: Maze = level === 'suites' ? suitesMaze(seed, floor) : level === 'poolrooms' ? poolMaze(seed) : generateMaze(seed);

const ZONE_COLOR = ['#555', '#4a5a6a', '#6a6a4a', '#5a4a6a', '#4a6a5a', '#6a5a4a']; // ZONE: none, pits, hall, cubicles, office, shelves
const DOOR = new Set(['door', 'suitedoor', 'steeldoor', 'grandoor']);
type Mark = { name: string; color: string; cells: Cell[]; round?: boolean };
const marks: Mark[] = [
  { name: 'inicio', color: '#3f3', cells: [m.start], round: true },
  { name: 'ascensor', color: '#f0f', cells: [m.elevator] },
  { name: 'cámara', color: '#0ff', cells: [m.camera], round: true },
  { name: 'pistola / rifles', color: '#fa0', cells: [...(m.pistol ? [m.pistol] : []), ...m.extraGuns], round: true },
  { name: 'cintas', color: '#ff6', cells: m.tapes, round: true },
  { name: 'linternas', color: '#fff', cells: m.flashlights, round: true },
  { name: 'spawns', color: '#f33', cells: m.spawns, round: true },
  { name: 'interruptores (gens)', color: '#ff0', cells: m.gens ?? [] },
  { name: 'escalera', color: '#08f', cells: m.stairs ? [m.stairs] : [] },
  { name: 'huecos (vacío)', color: '#000', cells: m.voids },
  { name: 'gas', color: '#7c3', cells: m.gas ?? [] },
  { name: 'ventiladores', color: '#9cf', cells: m.fans ?? [] },
  { name: 'tótem', color: '#f8f', cells: m.totem ? [m.totem] : [], round: true },
  { name: 'agua / pistola de agua / tanque', color: '#4af', cells: [...(m.waters ?? []), ...(m.watergun ? [m.watergun] : []), ...(m.tank ? [m.tank] : [])], round: true },
  { name: 'puertas (props)', color: '#e80', cells: m.props.filter((p) => DOOR.has(p.kind)).map((p) => p.cell) },
  { name: 'otros props', color: '#aaa', cells: m.props.filter((p) => !DOOR.has(p.kind)).map((p) => p.cell), round: true },
  { name: 'escondites', color: '#a6f', cells: m.hides.map((h) => h.cell) },
  { name: 'lámparas', color: '#ee8', cells: m.lamps, round: true },
];

document.body.style.cssText = 'margin:0;background:#111;color:#ddd;font:12px monospace;overflow:hidden';
const cv = document.createElement('canvas');
cv.style.cssText = 'display:block;width:100vw;height:100vh;cursor:grab';
const info = document.createElement('div');
info.style.cssText = 'position:fixed;top:8px;left:8px;background:#000c;padding:8px;line-height:1.5;max-height:95vh;overflow:auto';
info.innerHTML = `<b>${level}${level === 'suites' ? ` planta ${floor}` : ''} · semilla ${seed}</b><br>${m.w}×${m.h} celdas · ${m.props.length} props<br>` +
  `<span style="color:#888">rueda: zoom · arrastrar: mover<br>muro / suelo (color por zona) / apagado más oscuro</span><br>` +
  marks.filter((k) => k.cells.length).map((k) => `<span style="color:${k.color}">${k.round ? '●' : '■'}</span> ${k.name} (${k.cells.length})`).join('<br>');
document.body.append(cv, info);
document.getElementById('root')?.remove();

let s = Math.min(innerWidth / m.w, innerHeight / m.h), ox = 0, oy = 0;
function draw() {
  cv.width = innerWidth;
  cv.height = innerHeight;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x;
    g.fillStyle = m.open[i] ? ZONE_COLOR[m.zone[i]] ?? '#555' : '#222';
    g.globalAlpha = m.open[i] && !m.lit[i] ? 0.5 : 1;
    g.fillRect(ox + x * s, oy + y * s, s + 0.5, s + 0.5);
  }
  g.globalAlpha = 1;
  for (const k of marks) {
    g.fillStyle = k.color;
    for (const c of k.cells) {
      const cx = ox + (c.x + 0.5) * s;
      const cy = oy + (c.y + 0.5) * s;
      if (k.round) { g.beginPath(); g.arc(cx, cy, s * 0.3, 0, 7); g.fill(); } else g.fillRect(cx - s * 0.35, cy - s * 0.35, s * 0.7, s * 0.7);
    }
  }
}
cv.onwheel = (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  ox = e.clientX - (e.clientX - ox) * f;
  oy = e.clientY - (e.clientY - oy) * f;
  s *= f;
  draw();
};
cv.onpointerdown = (e) => {
  cv.setPointerCapture(e.pointerId);
  cv.onpointermove = (ev) => { ox += ev.movementX; oy += ev.movementY; draw(); };
};
cv.onpointerup = () => { cv.onpointermove = null; };
addEventListener('resize', draw);
draw();
