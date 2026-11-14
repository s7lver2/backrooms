import * as THREE from 'three';

/*
 * La cabina del ascensor, por dentro: el «prefab» de salida de todos los niveles (nivel 0, Poolrooms...). Geometría y texturas hechas aquí (sin modelos):
 * suelo de vinilo en damero, paredes de acero cepillado con juntas, zócalo y faja, espejo ahumado, pasamanos, techo de rejilla con focos, botonera
 * numerada, placa de carga, indicador de planta, pisadera y dos hojas de puerta que se cierran.
 *
 * Ejes locales de `group`: el origen es el centro del umbral, en el suelo; +z mira hacia fuera (por donde se entra) y la cabina se mete hacia -z.
 * Quien la usa la coloca y la gira, llama a `open()` cuando se puede salir, a `board()` cuando el jugador está dentro (cierra y arranca) y a
 * `update(dt)` cada fotograma; `shake` es lo que tiembla la cámara durante el viaje.
 */
export class ElevatorCab {
  readonly group = new THREE.Group();
  /** Temblor de la cámara (m) en este fotograma. */
  shake = 0;
  /** Segundos de viaje (-1: parada). */
  rideT = -1;
  private closed: number;
  private want: number;
  readonly doorLeaves: THREE.Mesh[] = [];
  private light: THREE.PointLight;
  private lamp: THREE.MeshStandardMaterial;
  private led: THREE.CanvasTexture;
  private shown = '';
  private owned: { dispose(): void }[] = [];

  constructor(w = 1.46, d = 1.46, h = 2.5, private floor = 0, closed = false, openingWidth = 1.1) {
    this.closed = this.want = closed ? 1 : 0;
    const own = <T extends { dispose(): void }>(o: T) => (this.owned.push(o), o), T = 0.04;
    /** Una textura pintada a mano (lienzo). */
    const cv = (cw: number, ch: number, draw: (g: CanvasRenderingContext2D) => void, rx = 1, ry = 1) => {
      const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      draw(c.getContext('2d')!);
      const t = own(new THREE.CanvasTexture(c));
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      return t;
    };
    // acero cepillado: vetas finas en un sentido (`vert`: verticales, como las hojas de las puertas) y, si se pide, juntas de panel
    const brushed = (base: number[], vert: boolean, seams = 0) =>
      cv(256, 256, (g) => {
        g.fillStyle = 'rgb(' + base.join(',') + ')';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 900; i++) {
          const p = Math.random() * 256, l = 40 + Math.random() * 216, o = Math.random() * 256, v = Math.random() < 0.5 ? 255 : 0;
          g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.03 + Math.random() * 0.05) + ')';
          if (vert) g.fillRect(p, o, 1, l);
          else g.fillRect(o, p, l, 1);
        }
        for (let k = 0; k < seams; k++) {
          const x = Math.round(((k + 0.5) * 256) / seams);
          (g.fillStyle = 'rgba(0,0,0,0.55)'), g.fillRect(x - 1, 0, 2, 256);
          (g.fillStyle = 'rgba(255,255,255,0.18)'), g.fillRect(x + 1, 0, 1, 256);
        }
      });
    const mat = (map: THREE.Texture | null, color: number, roughness: number, metalness: number) => own(new THREE.MeshStandardMaterial({ map, color, roughness, metalness }));
    const steel = mat(brushed([150, 154, 152], false), 0xffffff, 0.42, 0.75), wall = mat(brushed([168, 170, 166], true, 3), 0xffffff, 0.38, 0.7);
    const door = mat(brushed([140, 145, 143], true), 0xffffff, 0.34, 0.8), dark = mat(null, 0x1c1e1d, 0.5, 0.6), trim = mat(null, 0x2b2e2d, 0.4, 0.7);
    // el suelo: vinilo de losetas en damero apagado, con el desgaste del centro
    const vinyl = mat(
      cv(128, 128, (g) => {
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) (g.fillStyle = (i + j) % 2 ? '#3b3a36' : '#55534c'), g.fillRect(i * 32, j * 32, 32, 32);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        for (let i = 0; i <= 4; i++) g.fillRect(i * 32, 0, 1, 128), g.fillRect(0, i * 32, 128, 1);
        const wear = g.createRadialGradient(64, 64, 8, 64, 64, 80);
        wear.addColorStop(0, 'rgba(190,180,160,0.22)'), wear.addColorStop(1, 'rgba(0,0,0,0.12)');
        (g.fillStyle = wear), g.fillRect(0, 0, 128, 128);
      }),
      0xffffff, 0.85, 0,
    );
    // el espejo ahumado del fondo: sin reflejo de verdad, un cristal oscuro muy pulido con un brillo en diagonal
    const mirror = mat(
      cv(64, 128, (g) => {
        const l = g.createLinearGradient(0, 0, 64, 128);
        l.addColorStop(0, '#7f898c'), l.addColorStop(0.45, '#c9d2d4'), l.addColorStop(0.55, '#8b9598'), l.addColorStop(1, '#5d6669');
        (g.fillStyle = l), g.fillRect(0, 0, 64, 128);
      }),
      0x9aa3a6, 0.08, 0.9,
    );
    const box = (bw: number, bh: number, bd: number, mt: THREE.Material, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(own(new THREE.BoxGeometry(bw, bh, bd)), mt);
      b.position.set(x, y, z);
      this.group.add(b);
      return b;
    };
    // la caja: suelo, fondo, lados y techo (con grosor: también se ve desde fuera)
    box(w, 0.04, d, vinyl, 0, 0, -d / 2);
    box(w, h, T, wall, 0, h / 2, -d + T / 2);
    for (const s of [-1, 1]) box(T, h, d, wall, s * (w / 2 - T / 2), h / 2, -d / 2);
    box(w, T, d, trim, 0, h - T / 2, -d / 2);
    // el frente: jambas y dintel alrededor del hueco de la puerta, y la pisadera de aluminio ranurado en el umbral
    const ow = Math.min(w - 0.3, openingWidth), oh = Math.min(2.1, h - 0.3), jw = (w - ow) / 2;
    for (const s of [-1, 1]) box(jw, h, T, steel, s * (ow / 2 + jw / 2), h / 2, -T / 2);
    box(ow, h - oh, T, steel, 0, oh + (h - oh) / 2, -T / 2);
    const sill = mat(
      cv(64, 16, (g) => {
        (g.fillStyle = '#9a9d9b'), g.fillRect(0, 0, 64, 16);
        g.fillStyle = '#3c3e3d';
        for (let y = 2; y < 16; y += 4) g.fillRect(0, y, 64, 1.5);
      }),
      0xffffff, 0.4, 0.8,
    );
    box(ow, 0.012, 0.14, sill, 0, 0.022, -0.07);
    // por dentro: zócalo oscuro, faja de protección a media altura, espejo ahumado en el fondo y pasamanos con sus soportes
    const in0 = -d + T, sx = w / 2 - T, mh = h * 0.42, my = 1.12 + mh / 2;
    box(w - 2 * T, 0.2, 0.012, dark, 0, 0.12, in0 + 0.006);
    box(w - 2 * T, 0.09, 0.016, trim, 0, 0.62, in0 + 0.008);
    box(w - 0.24, mh, 0.01, mirror, 0, my, in0 + 0.006);
    for (const s of [-1, 1]) {
      box(0.012, 0.2, d - 2 * T, dark, s * (sx - 0.006), 0.12, -d / 2);
      box(0.016, 0.09, d - 2 * T, trim, s * (sx - 0.008), 0.62, -d / 2);
    }
    const rail = (len: number, x: number, z: number, alongX: boolean) => {
      const r = new THREE.Mesh(own(new THREE.CylinderGeometry(0.02, 0.02, len, 12)), steel);
      r.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      r.position.set(x, 0.95, z);
      this.group.add(r);
      // dos soportes hasta la pared
      for (const e of [-1, 1]) {
        const o = (e * (len - 0.16)) / 2;
        if (alongX) box(0.022, 0.022, 0.07, trim, x + o, 0.95, z - 0.035);
        else box(0.07, 0.022, 0.022, trim, x + Math.sign(x) * 0.035, 0.95, z + o);
      }
    };
    rail(w - 0.34, 0, in0 + 0.075, true);
    for (const s of [-1, 1]) rail(d - 0.5, s * (sx - 0.075), -d / 2 - 0.1, false);
    // el techo: una rejilla difusora negra con cuatro focos empotrados
    this.lamp = own(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 1.2 }));
    const grid = mat(
      cv(64, 64, (g) => {
        (g.fillStyle = '#0d0e0e'), g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#3a3d3c';
        for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 1, 64), g.fillRect(0, i, 64, 1);
      }, 4, 4),
      0xffffff, 0.7, 0.3,
    );
    box(w - 2 * T, 0.012, d - 2 * T, grid, 0, h - T - 0.006, -d / 2);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const spot = new THREE.Mesh(own(new THREE.CylinderGeometry(0.07, 0.07, 0.014, 16)), this.lamp);
      spot.position.set(a * w * 0.22, h - T - 0.014, -d / 2 + b * d * 0.22);
      this.group.add(spot);
    }
    this.light = new THREE.PointLight(0xfff1d0, 1.3, 4.5, 1.8);
    this.light.position.set(0, h - 0.4, -d / 2);
    this.group.add(this.light);
    // la botonera (a la derecha según se entra): placa de acero con el visor, los botones numerados, puertas, alarma y parada
    const keys = cv(96, 256, (g) => {
      (g.fillStyle = '#a9adab'), g.fillRect(0, 0, 96, 256);
      (g.strokeStyle = '#5f6362'), (g.lineWidth = 2), g.strokeRect(3, 3, 90, 250);
      g.fillStyle = '#6a6e6c';
      for (const [x, y] of [[9, 9], [87, 9], [9, 247], [87, 247]]) g.beginPath(), g.arc(x, y, 2.5, 0, 7), g.fill();
      (g.fillStyle = '#0b0605'), g.fillRect(18, 16, 60, 26);
      (g.textAlign = 'center'), (g.textBaseline = 'middle');
      (g.fillStyle = '#ff3b1f'), (g.font = 'bold 20px monospace'), g.fillText('▲', 48, 30);
      const btn = (x: number, y: number, label: string, ring: string, fill: string, ink = '#1b1d1c') => {
        g.beginPath(), g.arc(x, y, 11, 0, 7), (g.fillStyle = fill), g.fill(), (g.lineWidth = 2.5), (g.strokeStyle = ring), g.stroke();
        (g.fillStyle = ink), (g.font = 'bold 10px monospace'), g.fillText(label, x, y + 1);
      };
      ['5', '6', '3', '4', '1', '2', '-1', '0'].forEach((l, i) => btn(30 + (i % 2) * 36, 64 + Math.floor(i / 2) * 30, l, l === '0' ? '#ffb43a' : '#4c504e', l === '0' ? '#ffe7b0' : '#d9dcda'));
      btn(30, 192, '<|>', '#4c504e', '#d9dcda'), btn(66, 192, '>|<', '#4c504e', '#d9dcda');
      btn(30, 226, '!', '#8a6a00', '#ffcf3a'), btn(66, 226, 'STOP', '#7a1410', '#e2362c', '#fff');
    });
    box(0.018, 0.62, 0.24, steel, sx - 0.009, 1.22, -0.36);
    const kp = new THREE.Mesh(own(new THREE.PlaneGeometry(0.22, 0.6)), own(new THREE.MeshStandardMaterial({ map: keys, roughness: 0.45, metalness: 0.5, emissiveMap: keys, emissive: 0xffffff, emissiveIntensity: 0.25 })));
    kp.rotation.y = -Math.PI / 2;
    kp.position.set(sx - 0.019, 1.22, -0.36);
    this.group.add(kp);
    // la placa de carga, en la pared de enfrente
    const plate = new THREE.Mesh(
      own(new THREE.PlaneGeometry(0.2, 0.12)),
      mat(
        cv(128, 76, (g) => {
          (g.fillStyle = '#c9c4ae'), g.fillRect(0, 0, 128, 76);
          (g.strokeStyle = '#2a2a26'), (g.lineWidth = 2), g.strokeRect(3, 3, 122, 70);
          (g.fillStyle = '#2a2a26'), (g.textAlign = 'center'), (g.textBaseline = 'middle');
          (g.font = 'bold 14px monospace'), g.fillText('MAX 8 PERSONS', 64, 22);
          (g.font = 'bold 20px monospace'), g.fillText('630 kg', 64, 44);
          (g.font = '8px monospace'), g.fillText('INSPECTED - DO NOT REMOVE', 64, 63);
        }),
        0xffffff, 0.6, 0.2,
      ),
    );
    plate.rotation.y = Math.PI / 2;
    plate.position.set(-sx + 0.002, 1.5, -0.36);
    this.group.add(plate);
    // el indicador de planta: sobre la puerta por dentro y encima del espejo
    this.led = cv(128, 56, () => {});
    const ledMat = own(new THREE.MeshBasicMaterial({ map: this.led }));
    const over = new THREE.Mesh(own(new THREE.PlaneGeometry(0.36, 0.16)), ledMat);
    over.rotation.y = Math.PI;
    over.position.set(0, oh + (h - oh) / 2, -T - 0.002);
    const back = new THREE.Mesh(own(new THREE.PlaneGeometry(0.3, 0.13)), ledMat);
    back.position.set(0, Math.min(h - 0.16, my + mh / 2 + 0.12), in0 + 0.004);
    this.group.add(over, back);
    // las hojas: cada una crece desde su jamba hasta el centro
    for (const s of [-1, 1]) {
      const g = own(new THREE.BoxGeometry(ow / 2, oh, 0.03).translate((-s * ow) / 4, oh / 2, 0)), l = new THREE.Mesh(g, door);
      l.position.set((s * ow) / 2, 0, -T / 2 - 0.02);
      this.doorLeaves.push(l);
      this.group.add(l);
    }
    this.paint();
    this.update(0);
  }

  /** Abrir las puertas (se puede entrar). */
  open() {
    this.want = 0;
  }
  /** El jugador está dentro: se cierran y, ya cerradas, arranca. */
  board() {
    this.want = 1;
    if (this.rideT < 0) this.rideT = 0;
  }
  get isOpen() {
    return this.closed < 0.5;
  }
  get isFullyOpen() {
    return this.closed === 0;
  }

  resetClosed() {
    this.closed = this.want = 1;
    this.rideT = -1;
    this.update(0);
  }

  /** El indicador: la planta, y la flecha en marcha. */
  private paint() {
    const up = this.rideT > 0 && this.closed >= 1, n = this.floor + (up ? Math.floor(this.rideT / 0.9) : 0), text = (up ? '▲ ' : '') + n;
    if (text === this.shown) return;
    this.shown = text;
    const c = this.led.image as HTMLCanvasElement, g = c.getContext('2d')!;
    (g.fillStyle = '#0b0605'), g.fillRect(0, 0, c.width, c.height);
    (g.font = 'bold 40px monospace'), (g.textAlign = 'center'), (g.textBaseline = 'middle');
    (g.fillStyle = '#ff3b1f'), (g.shadowColor = '#ff3b1f'), (g.shadowBlur = 10);
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    this.led.needsUpdate = true;
  }

  update(dt: number) {
    this.closed = THREE.MathUtils.clamp(this.closed + Math.sign(this.want - this.closed) * (dt / 1.1), 0, 1);
    const k = this.closed * this.closed * (3 - 2 * this.closed);
    for (const leaf of this.doorLeaves) leaf.scale.x = 0.04 + 0.96 * k;
    this.shake = 0;
    let glow = 1;
    if (this.rideT >= 0 && this.closed >= 1) {
      const t = (this.rideT += dt);
      // el tirón de arrancar y luego un traqueteo fino; la luz acusa el tirón y parpadea a ratos
      this.shake = Math.exp(-t * 3) * 0.035 * Math.sin(t * 22) + 0.004 * Math.sin(t * 31) + 0.002 * Math.sin(t * 47.3);
      glow = 1 - 0.5 * Math.exp(-t * 4) - (Math.sin(t * 5.3) > 0.97 ? 0.45 : 0);
    }
    this.light.intensity = 1.3 * glow;
    this.lamp.emissiveIntensity = 1.2 * glow;
    this.paint();
  }

  dispose() {
    this.owned.forEach((o) => o.dispose());
    this.group.removeFromParent();
  }
}
