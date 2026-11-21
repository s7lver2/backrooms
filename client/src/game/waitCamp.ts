import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LOCKERS, WAIT_H, WAIT_HALF, rarity } from '@backrooms/shared';
import type { Extra } from './waitProps';
import { DOME_R } from './waitDome';
import { fit } from './hospital';
import { Dust, MONO, bagTex, hash, softTex, type Bag, type Box } from './waitKit';

/*
 * El campamento de investigadores de la sala de espera: tiendas de campaña, mini laboratorios (bancos con monitores, centrífuga, microscopio,
 * cristalería, racks de servidores, neveras de muestras), un generador, cajas y barriles, una mesa de campaña con mapa, vigas y luces de feria
 * colgando del techo alto. Todo es geometría simple fundida por material (unas pocas mallas), con las colisiones en `boxes`.
 * Las zonas del centro (spawns), el pasillo hasta la puerta y las paredes con muebles de waiting.ts / waitDecor.ts / waitProps.ts quedan libres.
 */

const H = WAIT_HALF;
const BIG_RY = 0;

type Geo = THREE.BufferGeometry;

export class Camp {
  readonly group = new THREE.Group();
  private blink: { mat: THREE.MeshBasicMaterial; on: number; off: number; rate: number; phase: number }[] = [];
  private glows: THREE.Mesh[] = [];
  private lamps: THREE.PointLight[] = [];
  private doors: { leaf: THREE.Object3D; cur: number; body?: THREE.Mesh; shell: THREE.Group }[] = [];
  private doorsOpen = false;
  private mine = 0;
  private alarm = false;
  /** La alarma de la entrada: las alarmas rotativas destellan en rojo y las luces del campamento pulsan rojas. */
  setAlarm(on: boolean) {
    this.alarm = on;
  }
  private labels: { cv: HTMLCanvasElement; tx: THREE.CanvasTexture; mesh: THREE.Mesh; img?: HTMLImageElement; name: string }[] = [];
  private filled = false;
  private owners: { name: string; avatar?: string }[] = [];
  /** Quién es el dueño de cada casillero (el puesto en la sala): su foto de perfil y su nombre. */
  setOwners(list: { name: string; avatar?: string }[]) {
    this.owners = list;
    this.labels.forEach((l, i) => {
      const o = list[i];
      l.name = o?.name ?? '';
      l.img = undefined;
      if (o?.avatar) {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => ((l.img = im), this.drawLabels());
        im.src = o.avatar;
      }
    });
    this.drawLabels();
  }
  private drawLabels() {
    this.labels.forEach((l, i) => {
      const x = l.cv.getContext('2d')!, mine = i === this.mine && !!l.name, taken = !!this.owners[i];
      x.setTransform(2, 0, 0, 2, 0, 0);
      x.textBaseline = 'alphabetic';
      // placa de acero cepillado con remaches, la foto en un marco hundido y una tira de papel con el nombre
      const g1 = x.createLinearGradient(0, 0, 128, 160);
      g1.addColorStop(0, '#8d948e'), g1.addColorStop(0.5, '#6c726c'), g1.addColorStop(1, '#868c86');
      x.fillStyle = g1;
      x.fillRect(0, 0, 128, 160);
      for (let k = 0; k < 160; k += 2) ((x.fillStyle = k % 4 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'), x.fillRect(0, k, 128, 1));
      x.strokeStyle = mine ? (this.filled ? '#3dff6a' : '#37b862') : '#2a2d2a';
      x.lineWidth = 5;
      x.strokeRect(2.5, 2.5, 123, 155);
      for (const [rx, ry] of [[10, 10], [118, 10], [10, 150], [118, 150]]) ((x.fillStyle = '#c9cec8'), x.beginPath(), x.arc(rx, ry, 3.2, 0, 7), x.fill(), (x.fillStyle = '#4a4e4a'), x.beginPath(), x.arc(rx + 0.8, ry + 0.8, 1.2, 0, 7), x.fill());
      x.fillStyle = '#15160f';
      x.fillRect(14, 16, 100, 100);
      if (taken) {
        if (l.img) {
          const s = Math.min(l.img.naturalWidth, l.img.naturalHeight) || 1;
          x.drawImage(l.img, (l.img.naturalWidth - s) / 2, (l.img.naturalHeight - s) / 2, s, s, 17, 19, 94, 94);
        } else {
          x.fillStyle = '#e8e0a8';
          x.font = `bold 62px ${MONO}`;
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          x.fillText((l.name[0] ?? '?').toUpperCase(), 64, 68);
        }
      } else {
        x.fillStyle = '#4c4f40';
        x.font = `bold 18px ${MONO}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText('FREE', 64, 68);
      }
      x.strokeStyle = 'rgba(0,0,0,0.55)';
      x.lineWidth = 3;
      x.strokeRect(15.5, 17.5, 97, 97);
      x.fillStyle = '#e9e3c8';
      x.fillRect(14, 122, 100, 26);
      x.fillStyle = '#23211a';
      x.font = `bold 14px ${MONO}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(taken ? l.name.slice(0, 10).toUpperCase() : String(i + 1).padStart(2, '0'), 64, 136);
      l.tx.needsUpdate = true;
    });
  }
  private stuff: THREE.Mesh[] = [];
  private shelfY = [0.3, 0.7, 1.1];
  private shelfX = -H.x + 0.3;
  /** Abre o cierra la puerta de mi casillero. */
  openLockers(on: boolean) {
    this.doorsOpen = on;
  }
  private beacons: { gl: THREE.Mesh; ph: number }[] = [];
  private screens: { tex: THREE.CanvasTexture; draw: (t: number) => void; next: number; cx: CanvasRenderingContext2D }[] = [];
  private glitch = 0;
  private shake = 0;
  private skel?: THREE.Object3D;
  private dust?: Dust;
  private dustAmt = 0;
  /** Los monitores: 0 normales, 1 con interferencias, 2 apagados. */
  setGlitch(v: number) {
    this.glitch = v;
  }
  /** El temblor del campamento (0–1): los casilleros vibran, el esqueleto se balancea y cae polvo del techo. */
  setShake(v: number) {
    this.shake = v;
  }

  constructor(S: THREE.Scene, bag: Bag, boxes: Box[], shadow: (b: Box) => void, reduced: boolean, mods: Extra = {}) {
    const g = this.group;
    S.add(g);
    const parts = new Map<THREE.Material, Geo[]>();
    const own = <T extends THREE.Material>(m: T) => (bag.own.push(m), m);
    const std = (color: number, rough = 0.8, metal = 0) => own(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    const basic = (color: number) => own(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const tex = (w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) => bagTex(bag, w, h, draw);

    // ── materiales ───────────────────────────────────────────────────────────
    const canvas = (a: string, b: string) =>
      own(
        new THREE.MeshStandardMaterial({
          roughness: 0.95,
          side: THREE.DoubleSide,
          map: tex(128, 128, (x) => {
            x.fillStyle = a;
            x.fillRect(0, 0, 128, 128);
            for (let i = 0; i < 128; i += 16) ((x.fillStyle = b), x.fillRect(i, 0, 3, 128));
            for (let n = 0; n < 900; n++) ((x.fillStyle = `rgba(0,0,0,${hash(n) * 0.12})`), x.fillRect(hash(n * 3) * 128, hash(n * 5) * 128, 2, 2));
            x.strokeStyle = 'rgba(0,0,0,0.25)';
            x.beginPath();
            x.moveTo(0, 64);
            x.lineTo(128, 64);
            x.stroke();
          }),
        }),
      );
    const tentA = canvas('#6b6d3c', '#5a5c30'), tentB = canvas('#b5651d', '#9d5619'), tentC = canvas('#4f6a78', '#3f5865');
    const wood = own(
      new THREE.MeshStandardMaterial({
        roughness: 0.9,
        map: tex(128, 128, (x) => {
          x.fillStyle = '#8a6a3b';
          x.fillRect(0, 0, 128, 128);
          for (let i = 0; i < 128; i += 32) ((x.fillStyle = '#6d5229'), x.fillRect(0, i, 128, 3));
          for (let n = 0; n < 500; n++) ((x.fillStyle = `rgba(40,24,6,${hash(n) * 0.25})`), x.fillRect(hash(n * 7) * 128, hash(n * 3) * 128, 18, 1));
        }),
      }),
    );
    const metal = std(0x7d8186, 0.45, 0.6), steel = std(0x3b3f44, 0.5, 0.5), white = std(0xd9d8cf, 0.5), black = std(0x1a1a1a, 0.6), rubber = std(0x111111, 0.9);
    const olive = std(0x4d5a3a, 0.7, 0.2), yellow = std(0xd1a21a, 0.6), red = std(0x8c2a20, 0.6), cardboard = std(0x9c7e52, 0.95), paper = std(0xe8e4d2, 0.95), bagOrange = std(0xc2571a, 0.9), bagGreen = std(0x3e5b3a, 0.9);
    const glass = own(new THREE.MeshStandardMaterial({ color: 0xa8d4e6, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }));
    const dim = own(new THREE.MeshBasicMaterial({ color: 0x07080a }));
    const lanternM = basic(0xffd27a), bulbM = basic(0xffe9a8);

    // ── geometría ───────────────────────────────────────────────────────────
    const put = (m: THREE.Material, geo: Geo, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
      const q = geo.index ? geo.toNonIndexed() : geo;
      if (q !== geo) geo.dispose();
      q.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1)));
      (parts.get(m) ?? parts.set(m, []).get(m)!).push(q);
    };
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => put(m, new THREE.BoxGeometry(w, h, d), x, y, z, ry);
    const cyl = (m: THREE.Material, r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 12) => put(m, new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z);
    const solid = (x0: number, x1: number, z0: number, z1: number) => {
      const b = { x0, x1, z0, z1 };
      boxes.push(b);
      shadow(b);
    };
    /** Un modelo descargado (materiales copiados para liberarlos al salir), ajustado a `size` en `axis`, con la base en y. */
    const model = (gl: THREE.Object3D | undefined, size: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, ry = 0, hook?: (m: THREE.Material) => void, sy = 1) => {
      if (!gl) return false;
      const src = cloneSkinned(gl);
      src.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(src), k = size / (bb.max[axis] - bb.min[axis]);
      src.scale.set(k, k * sy, k);
      src.position.set((-(bb.min.x + bb.max.x) / 2) * k, -bb.min.y * k * sy, (-(bb.min.z + bb.max.z) / 2) * k);
      const o = new THREE.Group().add(src);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        m.frustumCulled = false;
        m.material = Array.isArray(m.material) ? m.material.map((q) => q.clone()) : m.material.clone();
        for (const q of Array.isArray(m.material) ? m.material : [m.material]) (bag.own.push(q), hook?.(q));
      });
      o.position.set(x, y, z);
      o.rotation.y = ry;
      g.add(o);
      return true;
    };
    /** Un destello aditivo de luz (sin luces reales). */
    const glow = (x: number, y: number, z: number, size: number, color: number, op = 0.5) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), own(new THREE.MeshBasicMaterial({ map: softTex(bag, 0.8, 0.3), color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending })));
      m.position.set(x, y, z);
      m.userData.base = op;
      m.userData.cam = true;
      m.renderOrder = 2;
      this.glows.push(m);
      g.add(m);
      return m;
    };
    const led = (x: number, y: number, z: number, color: number, rate: number) => {
      const m = basic(color);
      box(m, 0.03, 0.03, 0.03, x, y, z);
      this.blink.push({ mat: m, on: color, off: 0x101010, rate, phase: hash(x * 13 + z * 7) * 6 });
    };
    /** Un monitor con su pantalla pintada (texto o forma de onda). */
    const monitor = (x: number, y: number, z: number, ry: number, kind: 'text' | 'wave', w = 0.42, h = 0.3) => {
      const c = Object.assign(document.createElement('canvas'), { width: 128, height: 96 }), cx = c.getContext('2d')!;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      bag.tex.push(t);
      const seed = hash(x * 9 + z * 5) * 100;
      const draw = (time: number) => {
        cx.fillStyle = '#04120a';
        cx.fillRect(0, 0, 128, 96);
        cx.fillStyle = cx.strokeStyle = '#5dff8a';
        if (kind === 'wave') {
          cx.lineWidth = 2;
          cx.beginPath();
          for (let i = 0; i <= 128; i += 2) {
            const v = 48 + Math.sin(i * 0.12 + time * 2 + seed) * 14 * Math.sin(i * 0.03 + time * 0.7) + Math.sin(i * 0.5 + seed) * 4;
            i ? cx.lineTo(i, v) : cx.moveTo(i, v);
          }
          cx.stroke();
          cx.font = `bold 9px ${MONO}`;
          cx.fillText(`SIG ${(40 + hash(seed) * 40).toFixed(1)} Hz`, 6, 12);
        } else {
          cx.font = `bold 8px ${MONO}`;
          for (let i = 0; i < 9; i++) cx.fillText(`${(hash(seed + i + Math.floor(time * 0.5)) * 9999).toFixed(0).padStart(4, '0')} ${['OK', 'WARN', 'OK', 'OK', 'LOW'][i % 5]} ${'#'.repeat(1 + ((hash(seed * i) * 8) | 0))}`, 5, 12 + i * 9.5);
        }
        t.needsUpdate = true;
      };
      draw(0);
      this.screens.push({ tex: t, draw, next: 0, cx });
      const mat = own(new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y + h / 2 + 0.03, z);
      m.rotation.y = ry;
      g.add(m);
      // marco y pie
      const fx = Math.sin(ry) * 0.012, fz = Math.cos(ry) * 0.012;
      box(black, w + 0.05, h + 0.05, 0.03, x - fx, y + h / 2 + 0.03, z - fz, ry);
      box(black, 0.05, 0.05, 0.05, x - fx * 3, y + 0.025, z - fz * 3, ry);
      glow(x + Math.sin(ry) * 0.4, y + h / 2, z + Math.cos(ry) * 0.4, 0.9, 0x5dff8a, 0.14);
    };

    // ── tiendas de campaña ───────────────────────────────────────────────────
    // el modelo de tienda, repintado de amarillo
    const paintYellow = (m: THREE.Material) => {
      const q = m as THREE.MeshStandardMaterial;
      if (q.name === 'material') (q.map = null), (q.normalMap = null), q.color.setHex(0xd2ad1c), (q.roughness = 0.9), (q.needsUpdate = true);
    };
    /** Una tienda A-frame de ancho `w` (a lo largo de x local), fondo `d` (z local) y alto `h`; la entrada, hacia +z local. `ry` es múltiplo de π/2 (la colisión va alineada). */
    const tent = (cx: number, cz: number, ry: number, w: number, d: number, h: number, cloth: THREE.Material, bagM: THREE.Material) => {
      const T = new THREE.Matrix4().compose(new THREE.Vector3(cx, 0, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
      const local = (m: THREE.Material, geo: Geo, x: number, y: number, z: number, rx = 0, rz = 0, rot = 0) => {
        const q = geo.index ? geo.toNonIndexed() : geo;
        if (q !== geo) geo.dispose();
        q.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, rot, rz, 'YXZ')), new THREE.Vector3(1, 1, 1)));
        q.applyMatrix4(T);
        (parts.get(m) ?? parts.set(m, []).get(m)!).push(q);
      };
      const half = w / 2, len = Math.hypot(half, h), a = Math.atan2(h, half);
      if (mods.tent?.scene && model(mods.tent.scene, w + 0.4, 'x', cx, 0, cz, ry, paintYellow)) {
        const lx = new THREE.Vector3(half * 0.4, 0.2, -d * 0.1).applyMatrix4(T);
        glow(lx.x, 0.6, lx.z, 1.8, 0xffb04a, 0.4);
        const sw = Math.abs(Math.round(Math.sin(ry))) === 1;
        solid(cx - (sw ? d : w) / 2, cx + (sw ? d : w) / 2, cz - (sw ? w : d) / 2, cz + (sw ? w : d) / 2);
        return;
      }
      // las dos vertientes
      local(cloth, new THREE.BoxGeometry(len, 0.03, d + 0.2), -half / 2, h / 2, 0, 0, a);
      local(cloth, new THREE.BoxGeometry(len, 0.03, d + 0.2), half / 2, h / 2, 0, 0, -a);
      // el fondo (triángulo) y los laterales bajos
      const tri = new THREE.Shape();
      tri.moveTo(-half, 0);
      tri.lineTo(half, 0);
      tri.lineTo(0, h);
      local(cloth, new THREE.ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: false }), 0, 0, -d / 2);
      // la entrada: interior oscuro y dos solapas recogidas
      local(dim, new THREE.ShapeGeometry(tri), 0, 0, d / 2 - 0.08);
      for (const s of [-1, 1]) local(cloth, new THREE.BoxGeometry(0.03, h * 0.9, 0.5), s * (half * 0.78), h * 0.42, d / 2 + 0.06, 0, -s * 0.28);
      local(black, new THREE.BoxGeometry(w - 0.1, 0.01, d - 0.1), 0, 0.01, 0); // el suelo de lona
      // postes de la entrada y la cumbrera
      for (const s of [-1, 1]) local(metal, new THREE.CylinderGeometry(0.025, 0.025, h, 8), s * half * 0.98, h / 2, d / 2 + 0.1);
      local(metal, new THREE.CylinderGeometry(0.02, 0.02, d + 0.3, 8), 0, h, 0, Math.PI / 2);
      // dentro: un saco de dormir, una almohada y un farol
      local(bagM, new THREE.BoxGeometry(0.7, 0.12, d * 0.62), -half * 0.35, 0.07, -d * 0.1);
      local(paper, new THREE.BoxGeometry(0.4, 0.1, 0.25), -half * 0.35, 0.1, d * 0.3 - 0.45);
      const lx = new THREE.Vector3(half * 0.4, 0.2, -d * 0.1).applyMatrix4(T);
      put(lanternM, new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), lx.x, 0.17, lx.z);
      glow(lx.x, 0.6, lx.z, 1.8, 0xffb04a, 0.4);
      // la colisión: la huella girada (múltiplo de π/2: alineada con los ejes)
      const sw = Math.abs(Math.round(Math.sin(ry))) === 1;
      const ex = (sw ? d : w) / 2, ez = (sw ? w : d) / 2;
      solid(cx - ex, cx + ex, cz - ez, cz + ez);
    };
    // tres tiendas de investigación iguales (el modelo, repintado de amarillo): se entra por el lado abierto; dentro, un puesto distinto en cada una
    // medidas del modelo (m, sin escalar: 11,18 de ancho con las cuerdas; la lona va de x ±3 y de z −4,5 a +2,75, y la puerta sale hasta z +4): se escala a MW de ancho total
    const MW = 6.8, K = MW / 11.18, TS = 1.2, DOOR = 0.98;
    const CW = 6.0 * K, ZB = -4.5 * K, ZF = 2.75 * K; // (ancho de la lona y fondo/frente respecto al centro del modelo, entrada a +z)
    /** Una tienda con su colisión: paredes finas a los lados y al fondo, y a los lados de la puerta (el hueco, DOOR a cada lado del centro); `south` = la entrada mira a +z (si no, a -z). Solo choca la lona (las cuerdas y piquetas no). */
    const research = (cx: number, cz: number, south: boolean) => {
      const T = 0.18, x0 = cx - CW / 2, x1 = cx + CW / 2;
      const zb = south ? cz + ZB : cz - ZF, zf = south ? cz + ZF : cz - ZB; // (z menor y mayor de la lona)
      void x0, x1; // (sin tienda: solo quedan los puestos, a cielo abierto)
      return south ? { back: zb + T, front: zf } : { back: zf - T, front: zb };
    };
    // A: laboratorio (banco y rack de servidores)
    const A = { x: -4.6, z: -2.7 };
    const ra = research(A.x, A.z, true);
    if (model(mods.bench?.scene, 1.9, 'x', A.x + 0.55, 0, ra.back + 0.5, 0)) solid(A.x - 0.4, A.x + 1.5, ra.back, ra.back + 0.95);
    if (model(mods.rack?.scene, 1.9, 'y', A.x - 1.05, 0, ra.back + 0.35, 0)) solid(A.x - 1.4, A.x - 0.7, ra.back, ra.back + 0.7);
    monitor(A.x + 0.1, 0.0, ra.back + 0.45, 0, 'wave', 0.5, 0.36);
    // B: mando de campo (mesa con mapa, radio, ordenador viejo, cajas y bidones)
    const B = { x: 4.6, z: -2.7 };
    const rb = research(B.x, B.z, true);
    const tx = B.x - 0.45, tz = rb.back + 0.85;
    box(wood, 1.6, 0.05, 0.9, tx, 0.78, tz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(metal, 0.05, 0.78, 0.05, tx + sx * 0.72, 0.39, tz + sz * 0.38);
    box(paper, 0.9, 0.006, 0.6, tx, 0.81, tz, 0.15);
    model(mods.radio?.scene, 0.4, 'x', tx + 0.45, 0.8, tz - 0.1, -0.4);
    model(mods.c64?.scene, 0.4, 'x', tx - 0.5, 0.8, tz - 0.1, 0.4);
    solid(tx - 0.85, tx + 0.85, tz - 0.5, tz + 0.5);
    for (const [sx, sz] of [[-0.45, 0.85], [0.45, 0.85]]) {
      cyl(wood, 0.17, 0.17, 0.04, tx + sx, 0.46, tz + sz, 12);
      for (const a of [0, 2.1, 4.2]) box(metal, 0.03, 0.46, 0.03, tx + sx + Math.cos(a) * 0.1, 0.23, tz + sz + Math.sin(a) * 0.1);
    }
    if (model(mods.crates?.scene, 0.9, 'x', B.x + 1.05, 0, rb.back + 0.95, 0.1)) (model(mods.crates?.scene, 0.8, 'x', B.x + 1.1, 0, rb.back + 2.0, 0.1), solid(B.x + 0.6, B.x + 1.6, rb.back + 0.55, rb.back + 2.45));
    for (const [x, z] of [[B.x - 0.9, rb.back + 2.3], [B.x - 0.4, rb.back + 2.5]] as const) model(mods.jerry?.scene, 0.5, 'y', x, 0, z, x * 3);
    cyl(lanternM, 0.05, 0.05, 0.14, tx + 0.7, 0.88, tz + 0.2, 8);
    glow(tx + 0.7, 1.1, tz + 0.2, 2.4, 0xffb04a, 0.4);
    // C: enfermería (entrada hacia el norte: la pared sur está cerca)
    const C = { x: 4.6, z: 2.8 };
    const rc = research(C.x, C.z, false);
    model(mods.firstaid?.scene, 0.35, 'x', C.x - 1.15, 0, rc.back - 0.45, 0.2);
    solid(C.x - 1.45, C.x - 0.85, rc.back - 0.7, rc.back);
    if (model(mods.extinguisher?.scene, 0.6, 'y', C.x + 1.35, 0, rc.back - 0.35, Math.PI)) solid(C.x + 1.15, C.x + 1.55, rc.back - 0.55, rc.back);
    if (model(mods.barrels?.scene, 0.95, 'y', C.x + 1.1, 0, rc.back - 1.2, 0.6)) solid(C.x + 0.75, C.x + 1.45, rc.back - 1.55, rc.back - 0.85);
    if (model(mods.body?.scene, 2.0, 'z', C.x - 0.3, 0, rc.back - 1.5, 0)) solid(C.x - 0.7, C.x + 0.1, rc.back - 2.5, rc.back - 0.5);
    // el generador junto a la puerta (el modelo del nivel de los coches)
    if (model(mods.generator?.scene, 1.3, 'x', -1.5, 0, -H.z + 0.6, 0)) solid(-2.15, -0.85, -H.z, -H.z + 1.1);
    else (box(olive, 1.0, 0.7, 0.55, -2.3, 0.4, -H.z + 0.4), solid(-2.85, -1.75, -H.z, -H.z + 0.72));
    led(-1.0, 0.6, -H.z + 0.85, 0x3dff6a, 1.1);
    put(rubber, new THREE.TorusGeometry(0.22, 0.02, 6, 16), -0.6, 0.08, -H.z + 0.85, 0, Math.PI / 2); // cable enrollado
    // alarmas rotativas rojas, pequeñas, colgadas del techo junto a las vigas: un destello naranja que pulsa
    for (const [bx, bz] of [[3.9, 2.3], [-3.9, -2.3]] as const) {
      if (!mods.beacon?.scene) break;
      const o = fit({ scene: mods.beacon.scene } as never, 0.3, 'y');
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map((q) => q.clone()) : m.material.clone();
        bag.own.push(...(Array.isArray(m.material) ? m.material : [m.material]));
      });
      o.rotation.x = Math.PI; // (del techo hacia abajo)
      o.position.set(bx, WAIT_H - 0.02, bz);
      g.add(o);
      const gl = glow(bx, WAIT_H - 0.3, bz, 1.6, 0xff4a20, 0.35);
      this.beacons.push({ gl, ph: bx });
    }
    // los casilleros de la pared oeste, pegados (uno por jugador): el modelo del nivel de los coches (cuerpo y puerta con bisagra); solo se abre el mío
    // plantilla: el modelo se endereza (la dimensión larga hacia arriba), se escala al ancho de un casillero y se coloca contra la pared mirando a +x
    const lk = mods.lockerx?.scene;
    let lkH = 1.27, lkD = 0.5;
    let lkMake: ((L: { x: number; z: number }) => THREE.Mesh) | undefined;
    if (lk) {
      const probe = cloneSkinned(lk);
      probe.updateMatrixWorld(true);
      const sz = new THREE.Box3().setFromObject(probe).getSize(new THREE.Vector3()), zUp = sz.z > sz.y;
      lkMake = (L) => {
        const P = new THREE.Group(), src = cloneSkinned(lk);
        if (zUp) P.rotation.x = -Math.PI / 2;
        const dn = src.getObjectByName('Locker003');
        if (dn) dn.position.x = 0; // (la puerta viene suelta, al lado del cuerpo: se pone en su sitio)
        P.add(src);
        const G = new THREE.Group();
        G.add(P);
        G.rotation.y = -Math.PI / 2; // (el frente del modelo, a +x)
        G.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(G), w = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z), k = 0.43 / w;
        G.scale.set(k, k * 1.45, k); // (más alto: el original es bajito)
        G.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(G);
        lkH = b2.max.y - b2.min.y;
        lkD = b2.max.x - b2.min.x;
        // contra la pared (el fondo en -H.x), centrado en el casillero (z) y sobre el suelo
        G.position.set(-H.x - b2.min.x, -b2.min.y + 0.001, L.z - (b2.min.z + b2.max.z) / 2);
        G.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = Array.isArray(m.material) ? m.material.map((q) => q.clone()) : m.material.clone();
          for (const q of Array.isArray(m.material) ? m.material : [m.material]) {
            bag.own.push(q);
            const sm = q as THREE.MeshStandardMaterial;
          }
        });
        g.add(G);
        // el cuerpo es la malla grande (con su puerta cerrada); la otra pieza del archivo sobra
        G.updateMatrixWorld(true);
        const meshes: THREE.Mesh[] = [];
        G.traverse((c) => (c as THREE.Mesh).isMesh && meshes.push(c as THREE.Mesh));
        const vol = (m: THREE.Mesh) => { const s2 = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()); return s2.x * s2.y * s2.z; };
        meshes.sort((p, q) => vol(q) - vol(p));
        meshes.slice(1).forEach((m) => (m.visible = false));
        return meshes[0];
      };
    }
    for (const L of LOCKERS) {
      const body = lkMake?.(L);
      // abierto: el cuerpo se cambia por una caja abierta (fondo, lados, techo) con su puerta suelta que gira sobre la bisagra
      const shell = new THREE.Group(), leaf = new THREE.Object3D();
      shell.visible = false;
      if (body) {
        const mat = new THREE.MeshStandardMaterial({ color: 0x5b625c, roughness: 0.5, metalness: 0.55 });
        bag.own.push(mat);
        const W = 0.42, T = 0.025, X0 = -H.x, X1 = -H.x + lkD, XM = (X0 + X1) / 2;
        const bx = (w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D = shell) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(x, y, z);
          bag.own.push(m.geometry);
          parent.add(m);
          return m;
        };
        bx(T, lkH, W, X0 + T / 2, lkH / 2, L.z);
        bx(lkD, lkH, T, XM, lkH / 2, L.z - W / 2 + T / 2);
        bx(lkD, lkH, T, XM, lkH / 2, L.z + W / 2 - T / 2);
        bx(lkD, T, W, XM, lkH - T / 2, L.z);
        bx(lkD, T, W, XM, T / 2, L.z);
        leaf.position.set(X1, 0, L.z + W / 2);
        bx(T, lkH - 0.03, W - 0.02, 0, lkH / 2, -W / 2, leaf);
        shell.add(leaf);
        g.add(shell);
      }
      this.doors.push({ leaf, cur: 0, body, shell });
      // baldas por dentro
      for (const y of [lkH * 0.25, lkH * 0.55, lkH * 0.85]) box(steel, lkD * 0.6, 0.015, 0.34, -H.x + lkD * 0.5, y, L.z);
      solid(-H.x, -H.x + lkD, L.z - 0.22, L.z + 0.22);
      // la foto de perfil y el nombre de su dueño, sobre la puerta
      const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 320 }), tx = new THREE.CanvasTexture(cv);
      tx.anisotropy = 4;
      tx.colorSpace = THREE.SRGBColorSpace;
      bag.tex.push(tx);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.275), own(new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, side: THREE.DoubleSide })));
      lab.position.set(-H.x + lkD + 0.006, lkH * 0.72, L.z);
      lab.rotation.y = Math.PI / 2;
      g.add(lab);
      this.labels.push({ cv, tx, mesh: lab, img: undefined, name: '' });
    }
    this.drawLabels();
    this.shelfY = [lkH * 0.25, lkH * 0.55, lkH * 0.85];
    this.shelfX = -H.x + lkD * 0.5;
    // lo que dejo en mi casillero (hasta 8 piezas: dos por balda), visible con la puerta abierta
    const stuffM = own(new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x222222 }));
    for (let i = 0; i < 8; i++) {
      const it = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.13), stuffM.clone());
      bag.own.push(it.material as THREE.Material);
      it.geometry.userData.own = true;
      bag.own.push(it.geometry);
      it.visible = false;
      this.stuff.push(it);
      g.add(it);
    }
    // el esqueleto colgado de un soporte de laboratorio (poste, base con cinco patas con ruedas y un brazo con gancho), junto a la pared sur
    {
      const sx = -2.6, sz = H.z - 0.8;
      const sk = model(mods.skeleton?.scene, 1.7, 'y', sx, 0.18, sz - 0.05, Math.PI);
      if (sk) this.skel = g.children[g.children.length - 1];
      cyl(steel, 0.025, 0.025, 2.05, sx, 1.03, sz + 0.28, 8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3, lx = Math.cos(a) * 0.3, lz = Math.sin(a) * 0.3;
        box(steel, 0.6, 0.03, 0.04, sx + lx / 2, 0.08, sz + 0.28 + lz / 2, -a);
        cyl(rubber, 0.04, 0.04, 0.04, sx + lx, 0.04, sz + 0.28 + lz, 8);
      }
      cyl(steel, 0.06, 0.06, 0.1, sx, 0.12, sz + 0.28, 8);
      box(steel, 0.03, 0.03, 0.4, sx, 2.05, sz + 0.1); // brazo hacia delante
      cyl(metal, 0.012, 0.012, 0.3, sx, 1.92, sz - 0.08, 6); // la varilla de la que cuelga
      put(metal, new THREE.TorusGeometry(0.05, 0.01, 6, 12), sx, 1.96, sz - 0.08, 0, Math.PI / 2);
      solid(sx - 0.35, sx + 0.35, sz - 0.35, sz + 0.6);
    }

    // ── el techo alto: vigas, tuberías, luces de feria y una lona ──────────────
    const top = WAIT_H;
    // (nada cruza el hueco de la cúpula: las vigas se cortan donde pasa el círculo y las luces de feria solo cuelgan fuera)
    const clear = DOME_R + 0.45;
    /** Una viga a lo largo de x (o de z) en la línea `c`, partida por el círculo de la cúpula. */
    const beam = (alongX: boolean, c: number, y: number, w: number, hgt: number) => {
      const half = alongX ? H.x : H.z, gap = Math.sqrt(Math.max(0, clear * clear - c * c));
      const segs = gap > 0 ? [[-half, -gap], [gap, half]] : [[-half, half]];
      for (const [p0, p1] of segs) {
        const len = p1 - p0, mid = (p0 + p1) / 2;
        if (len > 0.05) alongX ? box(steel, len, hgt, w, mid, y, c) : box(steel, w, hgt, len, c, y, mid);
      }
    };
    for (let x = -6; x <= 6; x += 3) beam(false, x, top - 0.14, 0.18, 0.28);
    beam(true, -2.3, top - 0.5, 0.16, 0.22);
    beam(true, 2.3, top - 0.5, 0.16, 0.22);
    // luces de feria colgando entre vigas
    const bulbs: { x: number; y: number; z: number }[] = [];
    for (const z of [-2.3, 2.3]) {
      for (let i = 0; i <= 14; i++) {
        const x = -7 + i;
        if (Math.hypot(x, z) < clear) continue;
        const y = top - 0.5 - 0.32 * Math.sin((i / 14) * Math.PI) - (i % 2) * 0.04;
        bulbs.push({ x, y, z });
        put(bulbM, new THREE.SphereGeometry(0.05, 8, 6), x, y, z);
      }
    }
    bulbs.forEach((b, i) => i % 3 === 0 && glow(b.x, b.y, b.z, 1.4, 0xffd27a, 0.3));
    // una pancarta sobre la puerta
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 0.9),
      own(
        new THREE.MeshBasicMaterial({
          map: tex(512, 72, (x) => {
            x.fillStyle = '#3b3a2a';
            x.fillRect(0, 0, 512, 72);
            x.fillStyle = '#e8e0a8';
            x.font = `bold 30px ${MONO}`;
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            x.fillText('BACKROOMS SURVEY · FIELD CAMP', 256, 28);
            x.font = `14px ${MONO}`;
            x.fillText('DO NOT LEAVE THE LIGHT · DO NOT LOOK UP', 256, 54);
            x.strokeStyle = '#d1a21a';
            x.lineWidth = 4;
            x.strokeRect(4, 4, 504, 64);
          }),
        }),
      ),
    );
    banner.position.set(0, top - 0.85, -H.z + 0.04);
    g.add(banner);
    // cinta de peligro en el suelo, alrededor de la zona de los laboratorios
    const tape = own(
      new THREE.MeshBasicMaterial({
        map: (() => {
          const t = tex(64, 16, (x) => {
            x.fillStyle = '#d1a21a';
            x.fillRect(0, 0, 64, 16);
            x.fillStyle = '#111';
            for (let i = -16; i < 64; i += 16) (x.beginPath(), x.moveTo(i, 16), x.lineTo(i + 8, 16), x.lineTo(i + 16, 0), x.lineTo(i + 8, 0), x.fill());
          });
          t.repeat.set(10, 1);
          return t;
        })(),
      }),
    );
    // alfombras de lona bajo las tiendas y la mesa
    const rugM = own(
      new THREE.MeshStandardMaterial({
        roughness: 1,
        map: tex(128, 128, (x) => {
          x.fillStyle = '#4a3a2a';
          x.fillRect(0, 0, 128, 128);
          x.strokeStyle = '#7a5a34';
          x.lineWidth = 6;
          x.strokeRect(10, 10, 108, 108);
          x.strokeStyle = '#2d2418';
          for (let i = 20; i < 110; i += 12) (x.beginPath(), x.moveTo(i, 20), x.lineTo(i, 108), x.stroke());
        }),
      }),
    );
    for (const [x, z, w, d] of [[A.x, A.z, 4, 3.8], [B.x, B.z, 4, 3.8], [C.x, C.z, 4, 3.8]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), rugM);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.008, z);
      g.add(m);
    }

    // ── fundir por material ─────────────────────────────────────────────────
    for (const [m, list] of parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((q) => q.dispose());
      if (!merged) continue;
      bag.own.push(merged);
      const mesh = new THREE.Mesh(merged, m);
      g.add(mesh);
    }

    // ── tres luces reales: dos blancas de laboratorio y una cálida al centro del campamento ───
    for (const [x, y, z, c, i, d] of [[A.x, 1.5, A.z + 0.3, 0xcfe8ff, 4, 6], [B.x, 1.5, B.z + 0.3, 0xffc27a, 4, 6], [C.x, 1.5, C.z - 0.3, 0xcfe8ff, 4, 6]] as const) {
      const l = new THREE.PointLight(c, i, d, 1.4);
      l.position.set(x, y, z);
      l.userData.base = i;
      this.lamps.push(l);
      g.add(l);
    }
    this.dust = new Dust(bag, reduced ? 50 : 120, new THREE.Vector3(-7, 0.3, -5.5), new THREE.Vector3(7, WAIT_H - 0.2, 5.5), 0.035, 0.004, 0xd8d2b0);
    g.add(this.dust.points);
  }

  /** Lo que guarda cada casillero (mío): una luz verde en los ocupados. */
  setStash(slots: ({ kind: string; q?: { r: number } } | null)[], mine = this.mine) {
    this.mine = mine;
    this.filled = slots.some(Boolean);
    this.drawLabels();
    const L = LOCKERS[mine];
    this.stuff.forEach((it, i) => {
      const s = slots[i];
      it.visible = !!s;
      if (!s) return;
      const row = i >> 1, col = i & 1, kind = s.kind;
      it.position.set(this.shelfX, this.shelfY[row % 3] + 0.07, L.z + (col ? 0.08 : -0.08));
      let h = 0;
      for (let k = 0; k < kind.length; k++) h = (h * 31 + kind.charCodeAt(k)) % 360;
      const m = it.material as THREE.MeshStandardMaterial;
      m.color.set(s.q ? rarity(s.q.r).color : new THREE.Color().setHSL(h / 360, 0.5, 0.5));
      m.emissive.copy(m.color).multiplyScalar(0.35);
      it.scale.y = 1 + (h % 5) * 0.25;
    });
  }

  update(dt: number, t: number, cam: THREE.Camera) {
    for (const b of this.blink) b.mat.color.setHex(Math.sin(t * b.rate * 2 + b.phase) > -0.2 ? b.on : b.off);
    for (const s of this.screens)
      if (t > s.next) {
        s.next = t + (this.glitch ? 0.05 : 0.12);
        if (this.glitch === 2) (s.cx.fillStyle = '#010201'), s.cx.fillRect(0, 0, 128, 96), (s.tex.needsUpdate = true);
        else if (this.glitch === 1) {
          // interferencias: nieve y franjas que saltan
          s.cx.fillStyle = '#0a160c';
          s.cx.fillRect(0, 0, 128, 96);
          for (let k = 0; k < 160; k++) ((s.cx.fillStyle = `rgba(190,255,200,${Math.random() * 0.8})`), s.cx.fillRect(Math.random() * 128, Math.random() * 96, 1 + Math.random() * 14, 1));
          s.cx.fillStyle = 'rgba(210,255,215,0.35)';
          s.cx.fillRect(0, (t * 90) % 96, 128, 5 + Math.random() * 8);
          s.tex.needsUpdate = true;
        } else s.draw(t);
      }
    for (const m of this.glows) m.quaternion.copy(cam.quaternion);
    const pulse = Math.max(0, Math.sin(t * 7)) ** 2;
    for (const l of this.lamps) {
      l.userData.col ??= l.color.getHex();
      if (this.alarm) (l.color.setHex(0xff3018), (l.intensity = l.userData.base * (0.25 + 1.1 * pulse)));
      else (l.color.setHex(l.userData.col), (l.intensity = l.userData.base * (Math.sin(t * 37 + l.position.x * 3) > 0.985 ? 0.7 : 1)));
    }
    for (const b of this.beacons) {
      const m = b.gl.material as THREE.MeshBasicMaterial;
      m.color.setHex(this.alarm ? 0xff2010 : 0xff4a20);
      m.opacity = this.alarm ? 0.15 + 0.85 * Math.max(0, Math.sin(t * 7 + b.ph)) ** 2 : 0.05 + 0.5 * Math.max(0, Math.sin(t * 3 + b.ph)) ** 3;
    }
    // temblor: polvo del techo, el esqueleto se balancea y los casilleros cerrados vibran
    this.dustAmt += ((this.shake > 0 ? 1 : 0) - this.dustAmt) * Math.min(1, dt * 1.5);
    this.dust?.opacity(Math.max(0.004, this.dustAmt * 0.65)); // (nunca invisible del todo: así se compila con la sala y no a mitad de la secuencia)
    if (this.dustAmt > 0.02) this.dust?.update(dt * 3, t);
    if (this.skel) this.skel.rotation.z = Math.sin(t * 7.3) * 0.045 * this.shake;
    this.doors.forEach((d, i) => {
      const sh = d.body && !(d.cur > 0.02) ? this.shake : 0;
      if (d.body) {
        d.body.userData.px ??= d.body.position.x;
        d.body.position.x = d.body.userData.px + Math.sin(t * 43 + i * 1.9) * 0.006 * sh;
      }
      d.cur += ((this.doorsOpen && i === this.mine ? 1 : 0) - d.cur) * Math.min(1, dt * 6);
      d.leaf.rotation.y = -d.cur * 1.6;
      const open = d.cur > 0.02;
      d.shell.visible = open;
      if (this.labels[i]) this.labels[i].mesh.visible = !open;
      if (d.body) d.body.visible = !open;
    });
  }
}
