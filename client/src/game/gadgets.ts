import * as THREE from 'three';
import { perks } from './perks';
import { boostOf, MAX_PLAYERS, STRIP_GAP, STRIP_MAX, STRIP_PTS, type Strip } from '@backrooms/shared';
import type { Controls } from './input';
import type { Player } from './player';
import type { World } from './world';
import type { Sock } from '../net';
import type { Assets } from './game';
import { Holo, RADAR_IDLE, RADAR_SCAN } from './holo';
import { sees } from './items';

/*
 * La cinta de acordonar y el radar: lo que se lleva en la mano sin ser camcorder ni rifle (Player.gadget).
 *  - Cinta: con ella en la mano, un clic marca el primer punto en el suelo y otro el segundo: queda una recta de cinta (ancha, con chevrones
 *    de un punto al otro) entre los dos, sin paredes ni huecos en medio; con la vista se ve la previa. Clic derecho cancela. G sobre un tramo lo quita entero. En una sala los tramos terminados los reparte
 *    el servidor (strip / unstrip); solo, se llevan aquí. Todos son una sola malla que se reconstruye al cambiar.
 *  - Tótem de la vida: en la mano; un clic llama a `onTotem` (game.ts abre el selector de compañeros caídos).
 *  - Radar: un holograma 3D que flota sobre el propio aparato (holo.ts: un disco con una baliza por compañero, con su altura y sus metros). Nada en el HUD.
 *  Los tres objetos de la mano (rollo, radar, tótem) son de Player.items: los coloca y les pone los brazos con grips.json, igual que la linterna o la camcorder.
 */

const GRAB = 2.4, WIDTH = 0.12, LIFT = 0.012, PERIOD = 0.24; // metros: alcance de G, ancho, altura sobre el suelo y largo de un chevrón
const CAP = STRIP_MAX * MAX_PLAYERS * STRIP_PTS; // puntos como mucho en pantalla
export const ROLL = 60; // metros de cinta que trae el rollo
const TAPE_MAX = 40; // metros: lo más larga que sale una recta de cinta
const SCAN_TIME = 3, SCAN_COOL = 5; // s: lo que dura un escaneo del radar y lo que hay que esperar para el siguiente (cuenta desde que se usa)

const _v = new THREE.Vector3(), _x = new THREE.Vector3();

/** La cinta: amarilla con una banda negra en V (chevrón) por cada tile; la V apunta hacia +v, que es hacia donde se avanza. */
function tapeTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 128 }), x = c.getContext('2d')!;
  x.fillStyle = '#f2c200';
  x.fillRect(0, 0, 64, 128);
  x.strokeStyle = '#121212';
  x.lineWidth = 30;
  x.lineJoin = 'miter';
  x.beginPath();
  x.moveTo(-6, 112), x.lineTo(32, 56), x.lineTo(70, 112);
  x.stroke();
  x.fillStyle = '#121212';
  x.fillRect(0, 0, 5, 128), x.fillRect(59, 0, 5, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export class Gadgets {
  /** «Pick up caution tape» mientras se apunta a un tramo (lo enseña el aviso de G). */
  hint: string | null = null;
  /** Metros que quedan en el rollo. */
  left = ROLL;
  /** Aviso corto (p. ej. rollo vacío) para el HUD; `noteT` son los segundos que le quedan. */
  note: string | null = null;
  private noteT = 0;
  private strips: Strip[] = [];
  /** La recta que se está marcando: [x0, z0, x1, z1] con el primer punto fijo y el segundo donde se mira; null si no hay primer punto. */
  private cur: number[] | null = null;
  private start: [number, number] | null = null;
  private mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private uv: THREE.BufferAttribute;
  /** Clic con el tótem en la mano. */
  onTotem?: () => void;
  private holo = new Holo(MAX_PLAYERS);
  private offs: (() => void)[] = [];
  private t = 0;
  private cool = 0;
  private scanLeft = 0;
  private scanCool = 0;
  private sock?: Sock;
  private serial = 0;

  constructor(private world: World, private player: Player, private camera: THREE.Camera, _assets: Assets, _host: HTMLElement, private peers: () => Iterable<{ pos: THREE.Vector3; dead: boolean }>, private exit?: () => THREE.Vector3 | undefined) {
    const tex = tapeTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', (this.pos = new THREE.BufferAttribute(new Float32Array(CAP * 12), 3).setUsage(THREE.DynamicDrawUsage)));
    g.setAttribute('uv', (this.uv = new THREE.BufferAttribute(new Float32Array(CAP * 8), 2).setUsage(THREE.DynamicDrawUsage)));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(CAP * 12).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // sin normales la luz da NaN y el bloom lo pinta todo de negro
    const ix = new Uint16Array(CAP * 6);
    for (let i = 0; i < CAP; i++) ix.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    world.root.add(this.mesh);

    camera.add(this.holo.root);
  }

  /** Multijugador: los tramos son los que dice el servidor. */
  net(sock: Sock) {
    this.sock = sock;
    const add = (k: Strip) => (this.strips.push(k), this.rebuild());
    const del = (id: string) => (this.refund(this.strips.find((k) => k.id === id)), (this.strips = this.strips.filter((k) => k.id !== id)), this.rebuild());
    sock.on('strip', add);
    sock.on('unstrip', del);
    this.offs.push(() => (sock.off('strip', add), sock.off('unstrip', del)));
  }

  /** La malla de todos los tramos (y el que se está tendiendo, hasta los pies): una cinta de WIDTH por segmento, con la v corriendo a lo largo. */
  private rebuild() {
    const all = this.cur ? [...this.strips.map((k) => k.pts), this.cur] : this.strips.map((k) => k.pts);
    let q = 0;
    for (const pts of all) {
      let len = 0;
      for (let i = 2; i < pts.length && q < CAP; i += 2) {
        const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1], d = Math.hypot(bx - ax, bz - az);
        if (d < 1e-3) continue;
        const nx = (-(bz - az) / d) * (WIDTH / 2), nz = ((bx - ax) / d) * (WIDTH / 2), v0 = len / PERIOD, v1 = (len + d) / PERIOD;
        this.pos.setXYZ(q * 4, ax - nx, LIFT, az - nz), this.pos.setXYZ(q * 4 + 1, ax + nx, LIFT, az + nz);
        this.pos.setXYZ(q * 4 + 2, bx - nx, LIFT, bz - nz), this.pos.setXYZ(q * 4 + 3, bx + nx, LIFT, bz + nz);
        this.uv.setXY(q * 4, 0, v0), this.uv.setXY(q * 4 + 1, 1, v0), this.uv.setXY(q * 4 + 2, 0, v1), this.uv.setXY(q * 4 + 3, 1, v1);
        len += d;
        q++;
      }
    }
    this.pos.needsUpdate = this.uv.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, q * 6);
  }

  private refund(k?: Strip) {
    if (k) this.left = Math.min(ROLL, this.left + this.len(k.pts));
  }

  private len(pts: number[]) {
    let d = 0;
    for (let i = 2; i < pts.length; i += 2) d += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return d;
  }

  /** Deja la recta marcada (se manda al servidor o, solo, se guarda) o, con `keep` falso, la descarta. */
  private finish(keep = true) {
    const pts = this.cur;
    this.cur = this.start = null;
    if (keep && pts && pts.length === 4) {
      this.left = Math.max(0, this.left - this.len(pts));
      if (this.sock) this.sock.emit('strip', pts);
      else {
        this.strips.push({ id: 'l' + this.serial++, owner: '', pts });
        if (this.strips.length > STRIP_MAX) this.strips.shift();
      }
    }
    this.rebuild();
  }

  /** Dónde cae en el suelo lo que se mira (a menos de TAPE_MAX y a la vista), o null. */
  private floorAim(): [number, number] | null {
    const eye = this.camera.getWorldPosition(_v.clone()), dir = this.camera.getWorldDirection(new THREE.Vector3());
    if (dir.y > -0.03) return null;
    const t = (LIFT - eye.y) / dir.y, x = eye.x + dir.x * t, z = eye.z + dir.z * t;
    if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) > TAPE_MAX || !sees(this.world, eye, _x.set(x, LIFT, z)) || this.world.voidAt(x, z)) return null;
    return [x, z];
  }

  /** La recta no debe cruzar paredes ni huecos. */
  private clear(a: number[], b: number[]) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / 0.3);
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
      if (this.world.solid(x, z) || this.world.voidAt(x, z)) return false;
    }
    return true;
  }

  /** El tramo a menos de GRAB al que se apunta (la línea de mira pasa a menos de 35 cm de uno de sus puntos o de la mitad de un segmento) y que se ve sin pared en medio. */
  private aimed(eye: THREE.Vector3, dir: THREE.Vector3) {
    let best: Strip | undefined, bt = Infinity;
    for (const k of this.strips)
      for (let i = 2; i < k.pts.length; i += 2) {
        const ax = k.pts[i - 2], az = k.pts[i - 1], bx = k.pts[i], bz = k.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
        for (let j = 0; j <= n; j++) {
          const x = ax + ((bx - ax) * j) / n, z = az + ((bz - az) * j) / n;
          _v.set(x, LIFT, z).sub(eye);
          const t = _v.dot(dir);
          if (t < 0.2 || t > GRAB || t >= bt || _v.addScaledVector(dir, -t).length() > 0.35) continue;
          if (sees(this.world, eye, _x.set(x, LIFT, z))) (bt = t), (best = k);
        }
      }
    return best;
  }

  /** Cada fotograma: tiende y quita cinta, pinta el radar y devuelve los mandos sin lo que se ha gastado aquí (clic o G). */
  update(dt: number, c: Controls): Controls {
    const p = this.player, g = p.gadget, free = !p.dead && p.hideState === 'out';
    this.t += dt;
    this.cool -= dt;
    this.scanLeft = Math.max(0, this.scanLeft - dt);
    this.scanCool = Math.max(0, this.scanCool - dt);
    // el holograma sigue al radar de la mano (Player lo coloca con grips.json); solo con él en la mano y a la vista
    const it = p.items.radar;
    const status = this.scanLeft > 0 ? `SCAN ${Math.ceil(this.scanLeft)}` : this.scanCool > 0 ? `WAIT ${Math.ceil(this.scanCool)}` : 'READY';
    this.holo.update(dt, g === 'radar' && free && it.visible, it.position, p.yaw, p.pos, this.peers(), (this.scanLeft > 0 ? RADAR_SCAN : RADAR_IDLE) * boostOf(perks, 'radar'), status, this.exit?.()); // (la rareza del radar: más alcance)
    // la recta en marcha: se cancela al guardar la cinta, esconderse, morir o con el clic derecho; si no, el segundo punto sigue a la mira
    if (this.start) {
      if (g !== 'caution' || !free || c.aim) this.finish(false);
      else {
        const a = this.floorAim();
        this.cur = a ? [this.start[0], this.start[1], a[0], a[1]] : [this.start[0], this.start[1], this.start[0], this.start[1]];
        this.rebuild();
      }
    }
    this.hint = null;
    if ((this.noteT -= dt) <= 0) this.note = null;
    if (!free) return c;
    if (!this.cur) {
      const eye = this.camera.getWorldPosition(_v.clone()), dir = this.camera.getWorldDirection(new THREE.Vector3());
      const k = this.aimed(eye, dir);
      if (k) {
        this.hint = 'caution tape';
        if (c.grab) {
          if (this.sock) this.sock.emit('unstrip', k.id);
          else (this.refund(k), this.strips = this.strips.filter((m) => m !== k)), this.rebuild();
          c = { ...c, grab: false };
        }
      }
    }
    if (g === 'radar' && c.fire) {
      if (this.scanCool <= 0) (this.scanLeft = SCAN_TIME), (this.scanCool = SCAN_COOL);
      c = { ...c, fire: false };
    }
    if (g === 'totem' && c.fire) {
      this.onTotem?.();
      c = { ...c, fire: false };
    }
    if (g === 'caution' && c.fire) {
      const a = this.floorAim();
      if (!this.start) {
        if (this.left < 0.5) (this.note = 'TAPE ROLL EMPTY'), (this.noteT = 2);
        else if (a) this.start = a;
      } else if (a && Math.hypot(a[0] - this.start[0], a[1] - this.start[1]) >= 0.5 && this.clear(this.start, a)) {
        if (Math.hypot(a[0] - this.start[0], a[1] - this.start[1]) > this.left) (this.note = 'NOT ENOUGH TAPE LEFT'), (this.noteT = 2);
        else ((this.cur = [this.start[0], this.start[1], a[0], a[1]]), this.finish());
      }
      c = { ...c, fire: false };
    }
    return c;
  }

  dispose() {
    this.offs.forEach((o) => o());
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.MeshStandardMaterial).map?.dispose();
    (this.mesh.material as THREE.MeshStandardMaterial).dispose();
    this.holo.dispose();
  }
}
