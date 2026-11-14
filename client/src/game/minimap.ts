/*
 * Minimapa (solo admin, F9 → MINIMAP): un cuadro arriba a la derecha con las celdas de alrededor, el jugador (flecha), los compañeros (azul)
 * y las entidades (rojo). Es un lienzo 2D que se pinta cada fotograma con lo que le dan; no sabe de niveles (se le pasa `solid`).
 */
const SIZE = 168, CELLS = 25, CS = 1.5; // celdas visibles por lado y metros por celda

export interface Dot {
  x: number;
  z: number;
  color: string;
}

export class Minimap {
  readonly el = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  private g = this.el.getContext('2d')!;
  constructor(parent: HTMLElement) {
    Object.assign(this.el.style, { position: 'fixed', right: '14px', bottom: '14px', width: SIZE + 'px', height: SIZE + 'px', zIndex: '8', pointerEvents: 'none', border: '1px solid #ffffff55', background: '#000000aa', display: 'none' });
    parent.append(this.el);
  }
  show(on: boolean) {
    this.el.style.display = on ? 'block' : 'none';
  }
  draw(solid: (x: number, z: number) => boolean, me: { x: number; z: number; yaw: number }, dots: Dot[]) {
    const g = this.g, px = SIZE / CELLS;
    g.clearRect(0, 0, SIZE, SIZE);
    const c0x = Math.floor(me.x / CS), c0z = Math.floor(me.z / CS), h = (CELLS - 1) / 2;
    // el mapa gira con el jugador no: norte arriba (x a la derecha, z hacia abajo)
    const ox = SIZE / 2 - ((me.x / CS - c0x) + h) * px, oz = SIZE / 2 - ((me.z / CS - c0z) + h) * px;
    g.fillStyle = '#d8d4c8';
    for (let j = -h; j <= h; j++) for (let i = -h; i <= h; i++) if (!solid((c0x + i + 0.5) * CS, (c0z + j + 0.5) * CS)) g.fillRect(ox + (i + h) * px, oz + (j + h) * px, px + 0.5, px + 0.5);
    for (const d of dots) {
      const x = SIZE / 2 + ((d.x - me.x) / CS) * px, z = SIZE / 2 + ((d.z - me.z) / CS) * px;
      if (x < 0 || z < 0 || x > SIZE || z > SIZE) continue;
      g.fillStyle = d.color;
      g.beginPath();
      g.arc(x, z, 3, 0, 7);
      g.fill();
    }
    // el jugador: una flecha hacia donde mira (yaw 0 mira a -z)
    g.save();
    g.translate(SIZE / 2, SIZE / 2);
    g.rotate(-me.yaw);
    g.fillStyle = '#ffd24a';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(-5, 5);
    g.fill();
    g.restore();
  }
  dispose() {
    this.el.remove();
  }
}
