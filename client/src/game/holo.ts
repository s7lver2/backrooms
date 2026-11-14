import * as THREE from 'three';

/*
 * El holograma del radar: un volumen verde que flota sobre el aparato, en espacio de cámara (hijo de la cámara), inclinado hacia quien mira.
 * Un disco con rejilla y anillos a escala (el centro eres tú, arriba es hacia donde miras), una cortina de barrido que gira, una
 * onda que sube por el volumen y, por cada compañero vivo, una baliza vertical: su base cae donde está en el plano y el alto
 * de la baliza es su altura relativa (arriba o abajo de ti), con los metros al lado. Parpadeo y algún fallo de señal de vez en cuando.
 * Solo se pinta mientras el radar está en la mano.
 */

const R = 0.105; // radio del disco en metros de cámara
/** Alcance del radar sin balancear (m de mundo hasta el borde del disco). */
export const RADAR_BASE = 25;
/** Balance: con el radar solo en la mano, un 80 % menos; al escanear, un 150 % más que el de antes. */
export const RADAR_IDLE = RADAR_BASE * 0.2;
export const RADAR_SCAN = RADAR_BASE * 2.5;
const H = 0.06; // alto de las balizas a ±6 m de desnivel (la mitad por arriba, la mitad por abajo)
const TILT = 1.1; // radianes: el disco se levanta hacia quien mira (0 = tumbado, π/2 = de cara)
const INK = 0xd6ffe9, COL = 0x6fe8a8;

const mat = (c: number, o: number, map?: THREE.Texture) => new THREE.MeshBasicMaterial({ color: c, ...(map ? { map } : {}), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** El suelo del radar: rejilla, anillos a 1/3, 2/3 y borde, cruz, marcas cada 30° y líneas de escaneo, pintado una vez. */
function baseTexture() {
  const S = 512, C = S / 2, r = C - 6, c = canvas(S, S), x = c.getContext('2d')!;
  const g = x.createRadialGradient(C, C, 0, C, C, r);
  g.addColorStop(0, 'rgba(60,170,110,0.05)'), g.addColorStop(1, 'rgba(60,170,110,0.32)');
  x.fillStyle = g;
  x.beginPath(), x.arc(C, C, r, 0, 7), x.fill();
  x.save();
  x.beginPath(), x.arc(C, C, r, 0, 7), x.clip();
  x.strokeStyle = 'rgba(111,232,168,0.16)';
  x.lineWidth = 1;
  for (let i = -8; i <= 8; i++) x.beginPath(), x.moveTo(C + (i * r) / 4, 0), x.lineTo(C + (i * r) / 4, S), x.moveTo(0, C + (i * r) / 4), x.lineTo(S, C + (i * r) / 4), x.stroke();
  x.restore();
  x.strokeStyle = '#6fe8a8';
  x.lineWidth = 4;
  x.beginPath(), x.arc(C, C, r, 0, 7), x.stroke();
  x.lineWidth = 2;
  x.strokeStyle = 'rgba(111,232,168,0.6)';
  x.beginPath(), x.arc(C, C, r / 3, 0, 7), x.moveTo(C + (r * 2) / 3, C), x.arc(C, C, (r * 2) / 3, 0, 7), x.stroke();
  x.beginPath(), x.moveTo(C, C - r), x.lineTo(C, C + r), x.moveTo(C - r, C), x.lineTo(C + r, C), x.stroke();
  x.lineWidth = 3;
  x.strokeStyle = '#6fe8a8';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6, k = i % 3 ? 0.94 : 0.88;
    x.beginPath(), x.moveTo(C + Math.sin(a) * r * k, C - Math.cos(a) * r * k), x.lineTo(C + Math.sin(a) * r, C - Math.cos(a) * r), x.stroke();
  }
  x.fillStyle = '#d6ffe9'; // yo: una punta de flecha mirando arriba
  x.beginPath(), x.moveTo(C, C - 20), x.lineTo(C + 13, C + 14), x.lineTo(C, C + 7), x.lineTo(C - 13, C + 14), x.fill();
  x.fillStyle = 'rgba(0,0,0,0.22)'; // líneas de escaneo
  for (let y = 0; y < S; y += 6) x.fillRect(0, y, S, 2);
  return tex(c);
}

/** La cortina del barrido: una cuña que se apaga hacia atrás. */
function wedgeTexture() {
  const S = 256, C = S / 2, c = canvas(S, S), x = c.getContext('2d')!;
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(111,232,168,${0.5 * (1 - i / 40) ** 2})`;
    x.beginPath(), x.moveTo(C, C), x.arc(C, C, C, -Math.PI / 2 - (i + 1) * 0.026, -Math.PI / 2 - i * 0.026), x.fill();
  }
  x.strokeStyle = '#d6ffe9';
  x.lineWidth = 3;
  x.beginPath(), x.moveTo(C, C), x.lineTo(C, 2), x.stroke();
  return tex(c);
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Un rótulo de texto (sprite aditivo) que solo se vuelve a pintar si cambia el texto. */
function label(w: number, text = '') {
  const c = canvas(128, 40), x = c.getContext('2d')!, t = tex(c);
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const s = new THREE.Sprite(m);
  s.scale.set(w, (w * 40) / 128, 1);
  const set = (v: string) => {
    if (v === (s.userData.text ?? '')) return;
    s.userData.text = v;
    x.clearRect(0, 0, 128, 40);
    x.font = 'bold 26px ui-monospace, Consolas, monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#d6ffe9';
    x.fillText(v, 64, 21);
    t.needsUpdate = true;
  };
  set(text);
  return { s, set, t };
}

interface Beacon {
  g: THREE.Group;
  stem: THREE.Mesh;
  head: THREE.Mesh;
  foot: THREE.Mesh;
  tag: ReturnType<typeof label>;
}

export class Holo {
  readonly root = new THREE.Group();
  private map = new THREE.Group();
  private base: THREE.Mesh;
  private wedge: THREE.Mesh;
  private wave: THREE.Mesh;
  private mats: [THREE.Material & { opacity: number }, number][] = [];
  private beacons: Beacon[] = [];
  private title = label(0.07, 'RADAR');
  private none = label(0.08, 'NO SIGNAL');
  private t = 0;
  private glitch = 0;
  private nextGlitch = 2;
  private disposables: { dispose(): void }[] = [];

  constructor(slots: number) {
    const own = <T extends THREE.Material & { opacity: number }>(m: T, o: number) => (this.mats.push([m, o]), this.disposables.push(m), m);
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2), own(mat(0xffffff, 0.95, baseTexture()), 0.95));
    this.wedge = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2), own(mat(0xffffff, 0.9, wedgeTexture()), 0.9));
    this.wedge.position.y = 0.002;
    // el volumen: un cilindro de cristal en el borde y un cono tenue desde el aparato al centro del disco
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H * 1.7, 40, 1, true).translate(0, H * 0.35, 0), own(mat(COL, 0.07), 0.07));
    const rim = new THREE.Mesh(new THREE.RingGeometry(R * 0.985, R, 64).rotateX(-Math.PI / 2).translate(0, H * 1.2, 0), own(mat(COL, 0.5), 0.5));
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, 0.02, 0.13, 28, 1, true).translate(0, -0.065, 0), own(mat(COL, 0.06), 0.06));
    this.wave = new THREE.Mesh(new THREE.RingGeometry(R * 0.96, R, 64).rotateX(-Math.PI / 2), own(mat(INK, 0.6), 0.6));
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.011), own(mat(INK, 1), 1));
    this.disposables.push(this.base.geometry, this.wedge.geometry, wall.geometry, rim.geometry, cone.geometry, this.wave.geometry, beacon.geometry);
    this.map.add(this.base, this.wedge, wall, rim, this.wave);
    this.title.s.position.set(0, 0.012, -R * 1.12);
    this.none.s.position.set(0, 0.03, 0);
    this.map.add(this.title.s, this.none.s);
    for (let i = 0; i < slots; i++) {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 1, 0.0035).translate(0, 0.5, 0), own(mat(INK, 0.8), 0.8));
      const head = beacon.clone();
      const foot = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.017, 20).rotateX(-Math.PI / 2), own(mat(INK, 0.9), 0.9));
      const tag = label(0.055);
      g.add(stem, head, foot, tag.s);
      g.visible = false;
      this.map.add(g);
      this.beacons.push({ g, stem, head, foot, tag });
      this.disposables.push(stem.geometry, foot.geometry, tag.t);
    }
    this.root.add(this.map, cone);
    this.root.visible = false;
    this.map.rotation.x = TILT;
    this.disposables.push(this.title.t, this.none.t);
  }

  /** `at`: el aparato (espacio de cámara); `yaw`: hacia dónde se mira; `me`: donde estoy; `peers`: los compañeros vivos. */
  update(dt: number, on: boolean, at: THREE.Vector3, yaw: number, me: THREE.Vector3, peers: Iterable<{ pos: THREE.Vector3; dead: boolean }>, range = RADAR_IDLE, status = 'RADAR', exit?: THREE.Vector3) {
    this.root.visible = on;
    if (!on) return;
    this.t += dt;
    this.root.position.copy(at).add(_off);
    this.title.set(status);
    // el parpadeo de siempre y, de vez en cuando, un fallo de señal: el volumen se encoge y tiembla un instante
    this.nextGlitch -= dt;
    if (this.nextGlitch < 0) (this.glitch = 0.12 + Math.random() * 0.1), (this.nextGlitch = 1.5 + Math.random() * 3.5);
    this.glitch = Math.max(0, this.glitch - dt);
    const fl = 0.86 + 0.14 * Math.sin(this.t * 31) * Math.sin(this.t * 7.3), gl = this.glitch > 0;
    for (const [m, o] of this.mats) m.opacity = o * fl * (gl ? 0.5 + Math.random() * 0.5 : 1);
    this.map.scale.set(gl ? 1 + (Math.random() - 0.5) * 0.12 : 1, gl ? 0.6 + Math.random() * 0.5 : 1, 1);
    this.map.position.set(gl ? (Math.random() - 0.5) * 0.02 : 0, 0, 0);
    this.wedge.rotation.y = -this.t * 2.1; // el barrido, en el sentido de las agujas del reloj visto desde arriba
    const w = (this.t * 0.55) % 1; // la onda sube por el volumen y se apaga
    this.wave.position.y = w * H * 1.2;
    this.wave.scale.setScalar(0.4 + 0.6 * w);
    (this.wave.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - w) * fl;
    // las balizas: a la derecha y al frente respecto a la mirada
    const f0 = -Math.sin(yaw), f1 = -Math.cos(yaw);
    let n = 0;
    const put = (pos: THREE.Vector3, tag: string, clamp: boolean) => {
      const dx = pos.x - me.x, dz = pos.z - me.z, d = Math.hypot(dx, dz);
      if (n >= this.beacons.length || (!clamp && d > range)) return; // fuera de alcance no se ve (la salida sí: su dirección siempre)
      const b = this.beacons[n++];
      const right = (dx * -f1 + dz * f0) / (d || 1), fwd = (dx * f0 + dz * f1) / (d || 1), k = (Math.min(d, range) / range) * R * 0.94;
      const dh = THREE.MathUtils.clamp((pos.y - me.y) / 6, -1, 1) * H * 0.5; // alto relativo
      b.g.visible = true;
      b.g.position.set(right * k, 0, -fwd * k);
      b.stem.scale.y = Math.max(0.004, Math.abs(dh));
      b.stem.scale.x = b.stem.scale.z = 1;
      b.stem.rotation.x = dh < 0 ? Math.PI : 0;
      b.head.position.y = dh + (dh < 0 ? 0 : 0.012);
      b.head.rotation.y = this.t * 2;
      b.head.visible = true;
      b.tag.s.position.set(0.03, Math.max(0.01, dh) + 0.018, 0);
      b.tag.set(tag);
    };
    for (const r of peers) if (!r.dead) put(r.pos, `${Math.round(Math.hypot(r.pos.x - me.x, r.pos.z - me.z))}M`, false);
    if (exit) put(exit, `EXIT ${Math.round(Math.hypot(exit.x - me.x, exit.z - me.z))}M`, true);
    for (let i = n; i < this.beacons.length; i++) this.beacons[i].g.visible = false;
    this.none.s.visible = !n && Math.sin(this.t * 5) > -0.3;
    this.title.s.visible = true;
  }

  dispose() {
    this.root.removeFromParent();
    this.disposables.forEach((d) => d.dispose());
  }
}

const _off = new THREE.Vector3(0.03, 0.13, -0.05); // dónde flota respecto al aparato, en espacio de cámara
