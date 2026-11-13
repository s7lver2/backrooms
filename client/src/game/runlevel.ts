import * as THREE from 'three';
import type { Assets } from './game';
import type { Controls } from './input';
import type { GameAudio } from './audio';
import { Rig } from './rig';
import { CLIPS, type Kind } from './entity';
import { settings } from '../settings';
import { H, HW, OPEN, Hospital, fit, mulberry, type Slot } from './hospital';

/*
 * «Run for your life»: el nivel al que va el caído que revive con el Tótem. Un pasillo de hospital abandonado, larguísimo y casi a
 * oscuras (hospital.ts lo construye), que se corre en línea recta con todos los monstruos pisándote los talones. Se simula entero aquí,
 * en el cliente del caído; el servidor solo se entera del final (runDone). La cámara es suya (no el mapa ni el World): game.ts la pone en
 * el compositor mientras dura.
 *
 *  - Avanza solo (V0 m/s, estamina infinita); A/D esquiva a los lados, ratón mira (también hacia atrás), Space salta y C/Shift agacha.
 *  - Los monstruos van a su ritmo: si el hueco con el primero es mayor que GAP aprietan, si es menor aflojan. Todos los objetos son
 *    sólidos, pero con colisiones generosas (cajas más pequeñas que el modelo, margen al saltar y al agacharse): un golpe te hace
 *    tropezar (frena un instante y se come ~2 m de hueco) y lo que sale de las aberturas cae/sale EARLY s antes de lo que tocaría;
 *    lo arrimado a las paredes te aparta con suavidad. Solo hay una oportunidad: si te alcanzan, mueres.
 *  - De las aberturas laterales sale lo que va a por ti, siempre avisado (golpeteo, temblor, luz) un instante antes y siempre igual,
 *    para aprenderlo: camillas y sillas de ruedas que cruzan (saltar), taquillas y estantes que se caen (saltar o apartarse), un fluorescente
 *    que se descuelga (agachar) y puertas que se abren de golpe (apartarse). Lo demás es ambiente: cortinas, sombras, taburetes, luces que revientan.
 */

export const RUN_LEN = 320; // m de pista (a ~6 m/s son ~52 s)
const V0 = 6.2, GAP = 5.5, CATCH = 1, LAT = 4.6, JUMP = Math.sqrt(2 * 9.8 * 1.15), G = 9.8, EYE = 1.62;
// colisiones generosas: el jugador es más estrecho que su caja y las de los objetos, más pequeñas que el modelo
const PR = 0.2; // radio del jugador (m)
const GX = 0.1, GZ = 0.12, GY = 0.15; // lo que se encoge cada caja por cada lado (m): rozar no cuenta
const BUMP = 0.5; // s de tropiezo (a 0,35× de velocidad) tras chocar
const FOES = 0.88; // su ritmo respecto al tuyo: un pelín más despacio
const INTRO = 6; // 3 s de aviso y 3 s de cuenta atrás
const LIM = HW - 0.45, BACK = 26, TAIL = 10, EARLY = 1.8; // EARLY: lo que sale de las aberturas arranca esto antes (s): más margen para esquivar
const PACK: { kind: Kind; dz: number; ox: number }[] = [
  { kind: 'bacteria', dz: 0, ox: 0 }, { kind: 'partygoer', dz: 1.4, ox: -1.7 }, { kind: 'bacteria', dz: 2.6, ox: 1.6 }, { kind: 'partygoer', dz: 4.4, ox: -3 },
  { kind: 'bacteria', dz: 6, ox: 3 }, { kind: 'partygoer', dz: 7.8, ox: -0.9 }, { kind: 'bacteria', dz: 10, ox: 1 },
];

interface Obstacle {
  z: number;
  /** Caja que ocupa: x0..x1 a lo ancho, y0..y1 en altura y medio fondo `d`; solo cuenta mientras `on`. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  d: number;
  hit: boolean;
  on: boolean;
}
/** Algo que pasa en una abertura: arranca cuando al jugador le faltan `lead` segundos para llegar a `z`. */
interface Ev {
  z: number;
  lead: number;
  t: number;
  obj?: THREE.Object3D;
  reset(): void;
  tick(t: number, dt: number): void;
}
interface Chaser {
  rig: Rig;
  kind: Kind;
  dz: number;
  ox: number;
  x: number;
  balloon?: THREE.Object3D;
}

export interface RunHud {
  /** Metros hechos y de pista, golpe reciente (1 → 0) y fase. */
  dist: number;
  len: number;
  hit: number;
  state: 'go' | 'caught' | 'won';
  /** Segundos que faltan para empezar: más de 3 es el aviso, de 3 a 0 la cuenta atrás (0 = ya se corre). */
  intro: number;
}

/** La silueta de alguien alto y quieto: negra, con transparencia. */
function silhouette() {
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 256 }), x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.beginPath();
  x.arc(64, 34, 20, 0, 7);
  x.fill();
  x.beginPath();
  x.moveTo(30, 66), x.lineTo(98, 66), x.lineTo(112, 170), x.lineTo(92, 172), x.lineTo(88, 110), x.lineTo(84, 256), x.lineTo(44, 256), x.lineTo(40, 110), x.lineTo(36, 172), x.lineTo(16, 170);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Un punto redondo con caída suave: sin mapa, los puntos salen como cuadrados. */
function dot() {
  const c = Object.assign(document.createElement('canvas'), { width: 32, height: 32 }), x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'), g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const red = (c: THREE.Color, v: number) => c.setRGB(v, v * 0.08, v * 0.05);

export class RunLevel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** La cinta se corrompe (0–1) y la imagen se va a negro (0–1): lo pinta game.ts con la pasada VHS. */
  glitch = 0;
  black = 1;
  state: RunHud['state'] = 'go';
  /** Llegó a la meta (tras el fundido). */
  onDone?: () => void;
  /** Te alcanzaron (tras el fundido): no hay segundo intento. */
  onFail?: () => void;
  private hitFlash = 0;
  /** Aviso + cuenta atrás antes de empezar (HUD: RunHud.intro) y segundos de carrera. */
  private intro = INTRO;
  private go = 0;
  private pz = 0;
  private px = 0;
  private py = 0;
  private vy = 0;
  private sp = V0;
  private stumble = 0;
  private duck = 0;
  private yaw = Math.PI;
  private pitch = 0;
  private lead = 0;
  private t = 0;
  private ct = 0;
  private stepAcc = 0;
  private done = false;
  private obs: Obstacle[] = [];
  /** Lo arrimado a las paredes (hospital.ts): cajas fijas; `hit` = ya se ha chocado con él en este intento. */
  private fixed: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; hit: boolean }[] = [];
  private evs: Ev[] = [];
  private pack: Chaser[] = [];
  private hosp: Hospital;
  private torch = new THREE.PointLight(0xff1a10, 2.6, 12, 2);
  private ahead = new THREE.PointLight(0xff2a14, 5, 20, 1.6); // el pasillo por delante se lee: una luz roja que va por delante del jugador
  private surge = 6; // segundos hasta la próxima embestida de la manada
  private lunge = 0; // 0..1: la embestida en curso
  private warned = false;
  private evL = [0, 1].map(() => new THREE.PointLight(0xff1a10, 0, 9, 2)); // un resplandor rojo sobre lo que sale de las aberturas, para que se vea
  private flash = new THREE.PointLight(0xff2a10, 0, 14, 2);
  private flashT = 0;
  private sparks: THREE.Points;
  private sparkV: THREE.Vector3[] = [];
  private sparkT = 0;
  private owned: { dispose(): void }[] = [];
  private hand = new THREE.Vector3();
  private shake = 0;

  constructor(private assets: Assets, private audio: GameAudio | undefined, private reduced: boolean, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, aspect, 0.05, 90);
    const sc = this.scene, own = <T extends { dispose(): void }>(o: T) => (this.owned.push(o), o);
    sc.background = new THREE.Color(0x010000);
    sc.fog = new THREE.FogExp2(0x050101, 0.056);
    sc.add(new THREE.AmbientLight(0x4a0606, 0.16), this.torch, this.ahead, this.flash, ...this.evL);

    // el pasillo
    const hall = (this.hosp = new Hospital(assets, BACK + RUN_LEN + TAIL, BACK, mulberry(0x7e57), reduced));
    hall.onPop = (z) => Math.abs(z - this.pz) < 14 && this.audio?.clunk(false);
    sc.add(hall.group);
    this.fixed = hall.colliders.map((c) => ({ ...c, hit: false }));
    // las paredes de los dos extremos, y la meta: una puerta doble de emergencia con una raya de luz en el suelo
    const endM = own(new THREE.MeshStandardMaterial({ color: 0x8a8d86, roughness: 0.7 }));
    for (const [z, ry] of [[hall.zEnd, Math.PI], [-BACK, 0]] as const) {
      const w = new THREE.Mesh(own(new THREE.PlaneGeometry(HW * 2, H)), endM);
      w.position.set(0, H / 2, z);
      w.rotation.y = ry;
      sc.add(w);
    }
    const door = fit(assets.gltf['hospital/exitdoor'], 2.2);
    door.position.set(0, 0, hall.zEnd - 0.02);
    door.rotation.y = Math.PI;
    sc.add(door);
    const lightM = own(new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false }));
    for (const x of [-0.5, 0.5]) {
      const win = new THREE.Mesh(own(new THREE.PlaneGeometry(0.28, 0.6)), lightM);
      win.position.set(x, 1.55, hall.zEnd - 0.06);
      win.rotation.y = Math.PI;
      sc.add(win);
    }
    const goal = new THREE.PointLight(0xff1a10, 22, 12, 2);
    goal.position.set(0, 2.2, hall.zEnd - 2.5);
    const line = new THREE.Mesh(own(new THREE.PlaneGeometry(HW * 2, 0.5)), own(new THREE.MeshBasicMaterial({ color: 0xcc0a08 })));
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, RUN_LEN);
    sc.add(goal, line);

    // chispas y destello (un solo juego, se reutiliza)
    const sg = own(new THREE.BufferGeometry());
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30 * 3), 3));
    this.sparks = new THREE.Points(sg, own(new THREE.PointsMaterial({ color: 0xff3010, size: 0.07, map: own(dot()), transparent: true, alphaTest: 0.02, depthWrite: false })));
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    sc.add(this.sparks);

    // lo que sale de las aberturas, siempre lo mismo: se aprende
    this.plan(mulberry(0x51c0));

    // los monstruos: los modelos de las entidades del juego, corriendo hacia delante (+z)
    for (const c of PACK) {
      const rig = new Rig(assets.gltf[c.kind]);
      if (c.kind === 'bacteria')
        rig.root.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m?.isMeshStandardMaterial) m.color.setHex(0x111111), (m.roughness = 0.45);
        });
      const a = rig.play(CLIPS[c.kind].run, 0);
      if (a) a.timeScale = 1.15;
      sc.add(rig.root);
      const hh = new THREE.Box3().setFromObject(rig.root).max.y || 1.8; // ojos rojos: se ven aunque no haya luz, mirando atrás
      for (const ex of [-0.07, 0.07]) {
        const eye = new THREE.Mesh(own(new THREE.SphereGeometry(0.035, 6, 6)), own(new THREE.MeshBasicMaterial({ color: 0xff2210, fog: false })));
        eye.position.set(ex, hh * 0.9, 0.14);
        rig.root.add(eye);
      }
      const ch: Chaser = { ...c, rig, x: c.ox };
      if (c.kind === 'partygoer') {
        const b = assets.gltf.balloon.scene.clone(true), box = new THREE.Box3().setFromObject(b);
        b.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        ch.balloon = new THREE.Group().add(b);
        sc.add(ch.balloon);
      }
      this.pack.push(ch);
    }
    this.restart();
  }

  /** Un choque: destello, golpe sordo y un tropiezo (frena un instante). */
  private bump(flash: number) {
    this.hitFlash = Math.max(this.hitFlash, flash);
    this.stumble = Math.max(this.stumble, BUMP);
    this.audio?.clunk(false);
  }
  private near(z: number) {
    return Math.abs(z - this.pz) < 16;
  }
  /** Un golpe sordo desde el lado `side` (el +x queda a la izquierda al mirar a +z). */
  private thump(z: number, side: number, vol = 0.9) {
    if (this.near(z)) this.audio?.step(true, vol, -side * 0.8);
  }
  private boom(z: number) {
    if (this.near(z)) this.audio?.boom();
  }
  private spark(x: number, y: number, z: number) {
    const p = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    this.sparkV = [];
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, x, y, z);
      this.sparkV.push(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 1.5, (Math.random() - 0.5) * 2.5));
    }
    p.needsUpdate = true;
    this.sparkT = 1;
    this.sparks.visible = true;
    this.flash.position.set(x, y - 0.3, z);
    this.flashT = 0.35;
  }
  private addObs(z: number, y0: number, y1: number, d: number) {
    const o: Obstacle = { z, x0: 0, x1: 0, y0, y1, d, hit: false, on: false };
    this.obs.push(o);
    return o;
  }
  private add(e: Omit<Ev, 't'>) {
    this.evs.push({ ...e, t: -1 });
    if (e.obj) this.scene.add(e.obj);
  }

  /** Reparte lo que pasa en cada abertura: un obstáculo cada 14–22 m y, entre medias, ambiente. */
  private plan(r: () => number) {
    const hall = this.hosp;
    let last = 28;
    for (const op of hall.openings) {
      if (op.z < 30 || op.z > RUN_LEN - 14) continue;
      if (op.z - last >= 14 + r() * 8) {
        last = op.z;
        const q = r();
        if (q < 0.32) this.roll(op, r() < 0.6);
        else if (q < 0.62) this.tip(op, r() < 0.55);
        else if (q < 0.82) this.beam(op, r() < 0.5 ? -1 : 1);
        else this.slam(op);
      } else {
        const q = r();
        if (q < 0.3) this.curtain(op);
        else if (q < 0.5) this.stool(op);
        else if (q < 0.7) this.shadow(op);
        else if (q < 0.85) this.burst(op.z + (r() - 0.5) * 8);
      }
    }
    // puertas que golpean y luces que revientan entre medias
    let d = 24;
    for (const s of hall.solids) if (s.z > d && s.z < RUN_LEN - 10 && r() < 0.18) (this.slam(s), (d = s.z + 16));
  }

  /** Camilla o silla de ruedas que sale disparada de la abertura y cruza el pasillo hasta la otra pared (saltar). */
  private roll(op: Slot, stretcher: boolean) {
    const { side, z } = op, obj = stretcher ? fit(this.assets.gltf['hospital/stretcher'], 2.1, 'x') : fit(this.assets.gltf['hospital/wheelchair'], 1, 'y');
    const half = stretcher ? 1.1 : 0.42, x0 = side * (HW + 3.2), xEnd = -side * (HW - (stretcher ? 1.2 : 0.7)), v = 11, TEL = 1.0, ob = this.addObs(z, 0, 0.7, stretcher ? 0.5 : 0.4);
    let stopped = false;
    this.add({
      z, lead: TEL + (HW + 3.2) / v, obj,
      reset: () => ((obj.position.set(x0, 0, z)), (obj.rotation.y = 0), (ob.on = ob.hit = stopped = false)),
      tick: (t) => {
        if (t < TEL) {
          obj.position.x = x0 + Math.sin(t * 55) * 0.03 * Math.min(1, t * 3);
          obj.rotation.y = Math.sin(t * 43) * 0.02;
          for (const k of [0, 0.4, 0.75]) if (t - k >= 0 && t - k < 0.02) this.thump(z, side, 0.8);
          return;
        }
        if (stopped) return;
        const x = x0 - side * v * (t - TEL);
        if (side * (x - xEnd) <= 0) {
          obj.position.x = xEnd;
          obj.rotation.y = side * 0.25;
          stopped = true;
          this.boom(z);
        } else obj.position.x = x;
        ob.x0 = obj.position.x - half;
        ob.x1 = obj.position.x + half;
        ob.on = true;
      },
    });
  }

  /** Taquilla o estante que se tumba hacia el pasillo al pasar el jugador (saltar o apartarse). */
  private tip(op: Slot, locker: boolean) {
    const { side, z } = op, obj = locker ? fit(this.assets.gltf['hospital/locker'], 1.9) : fit(this.assets.gltf['hospital/shelf'], 1.8);
    const pivot = new THREE.Group(), TEL = 1.0, ob = this.addObs(z, 0, 2, locker ? 0.45 : 0.6);
    obj.position.x = side * 0.35;
    obj.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    pivot.add(obj);
    let th = 0, w = 0, landed = false;
    ob.x0 = side > 0 ? HW - 1.9 : -HW;
    ob.x1 = side > 0 ? HW : -HW + 1.9;
    this.add({
      z, lead: TEL + 0.65, obj: pivot,
      reset: () => ((pivot.position.set(side * HW, 0, z)), (pivot.rotation.z = th = w = 0), (landed = ob.on = ob.hit = false)),
      tick: (t, dt) => {
        if (t < TEL) {
          th = Math.sin(t * 38) * 0.025 * Math.min(1, t * 2) + t * 0.05;
          for (const k of [0, 0.35, 0.7]) if (t - k >= 0 && t - k < 0.02) this.thump(z, side, 0.9);
        } else if (!landed) {
          w += 15 * dt;
          th += w * dt;
          if (th >= Math.PI / 2) (th = Math.PI / 2), (landed = true), this.boom(z);
        }
        pivot.rotation.z = side * th;
        ob.y1 = 0.55 + 1.9 * Math.cos(th);
        ob.on = th > 0.4;
      },
    });
  }

  /** Fluorescente que se descuelga del techo y queda balanceándose a la altura de la cabeza (agachar). */
  private beam(op: Slot, side: -1 | 1) {
    const z = op.z, g = new THREE.Group(), TEL = 0.9, ob = this.addObs(z, 1.3, H, 0.2);
    const cx = side * (HW - 1.5), mat = new THREE.MeshStandardMaterial({ color: 0x3d4440, roughness: 0.6 }), tube = new THREE.MeshBasicMaterial({ color: 0xff1a10 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.3), mat), tb = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.03, 0.08), tube), cab = new THREE.CylinderGeometry(0.008, 0.008, 1);
    const sw = new THREE.Group(), c1 = new THREE.Mesh(cab, mat), c2 = new THREE.Mesh(cab, mat);
    tb.position.y = -0.06;
    sw.add(body, tb);
    for (const [c, x] of [[c1, -1.2], [c2, 1.2]] as const) c.position.x = x, sw.add(c);
    g.add(sw);
    this.owned.push(body.geometry, tb.geometry, cab, mat, tube);
    let drop = 0, v = 0, bounced = false;
    const set = () => {
      sw.position.y = -drop;
      for (const c of [c1, c2]) (c.scale.y = drop + 0.05), (c.position.y = drop / 2 + 0.02);
      g.rotation.z = drop > 1 ? Math.sin(this.t * 2.2) * 0.04 : 0;
      ob.y0 = H - drop - 0.12;
    };
    this.add({
      z, lead: TEL + 0.45, obj: g,
      reset: () => ((g.position.set(cx, H - 0.1, z)), (drop = v = 0), (bounced = ob.on = ob.hit = false), red(tube.color, 0.1), set()),
      tick: (t, dt) => {
        if (t < TEL) {
          red(tube.color, Math.sin(t * 70) * Math.sin(t * 29) > 0 ? 1 : 0.05); // chisporrotea
          if (t > 0.05 && Math.random() < dt * 10) this.spark(cx + (Math.random() - 0.5) * 2, H - 0.15, z);
          if (t - 0.02 < dt) this.near(z) && this.audio?.clunk(false);
        } else {
          red(tube.color, 0.7 + 0.3 * Math.sin(this.t * 31));
          if (drop < 1.35 || v < 0) {
            v += 12 * dt;
            drop = Math.min(1.35, drop + v * dt);
            if (drop >= 1.35 && !bounced) (bounced = true), (v = -2.2), this.boom(z), this.spark(cx, H - drop, z);
            else if (drop >= 1.35) v = 0;
          }
        }
        set();
        ob.x0 = side > 0 ? -0.7 : -HW;
        ob.x1 = side > 0 ? HW : 0.7;
        ob.on = drop > 1;
      },
    });
  }

  /** Puerta que se abre de golpe hacia el pasillo y se queda abierta, estorbando (apartarse). */
  private slam(s: Slot) {
    const { side, z } = s, pivot = new THREE.Group(), leaf = this.hosp.door(side), TEL = 0.75, ob = this.addObs(z, 0, 2.1, 0.14);
    leaf.position.set(0, 1.05, 0.55);
    pivot.add(leaf);
    let ang = 0, v = 0, hit = false;
    ob.x0 = side > 0 ? HW - 1.1 : -HW;
    ob.x1 = side > 0 ? HW : -HW + 1.1;
    const hz = z - 0.55;
    this.add({
      z, lead: TEL + 0.2, obj: pivot,
      reset: () => ((pivot.position.set(side * (HW - 0.04), 0, hz)), (ang = v = 0), (hit = ob.on = ob.hit = false), (ob.z = hz + 0.1), (pivot.rotation.y = 0)),
      tick: (t, dt) => {
        if (t < TEL) {
          ang = Math.sin(t * 50) * 0.018 * Math.min(1, t * 2);
          for (const k of [0, 0.3, 0.55]) if (t - k >= 0 && t - k < 0.02) this.thump(z, side, 1);
        } else {
          v += 55 * dt;
          ang = Math.min(1.45, ang + v * dt);
          if (ang >= 1.45 && !hit) (hit = true), (v = -2.5), this.boom(z), this.near(z) && this.audio?.creak();
          if (hit) {
            ang = Math.max(1.0, ang + v * dt);
            v *= 0.97;
          }
        }
        pivot.rotation.y = -side * ang;
        ob.on = ang > 0.9;
      },
    });
  }

  /** Un fluorescente revienta en : tartamudea, chispas y se queda apagado. */
  private burst(z: number) {
    let fz: number | undefined, popped = false;
    this.add({
      z, lead: 1.1,
      reset: () => ((fz = undefined), (popped = false)),
      tick: (t) => {
        fz ??= this.hosp.burst(z) ?? z; // empieza a tartamudear
        if (t > 0.9 && !popped) {
          popped = true;
          this.spark(0, H - 0.1, fz);
          this.near(z) && this.audio?.clunk(false);
        }
      },
    });
  }

  /** Cortina que ondea en la abertura; con el jugador cerca, el aire la sacude. */
  private curtain(op: Slot) {
    const { side, z } = op, g = fit(this.assets.gltf['hospital/curtain'], 2.3), holder = new THREE.Group(), sw = new THREE.Group();
    g.scale.x = (OPEN / 0.8);
    g.rotation.y = 0;
    holder.add(g);
    holder.rotation.y = Math.PI / 2;
    sw.add(holder);
    const ph = Math.random() * 6;
    this.add({
      z, lead: 1e9, obj: sw,
      reset: () => sw.position.set(side * (HW + 0.2), 0, z),
      tick: () => {
        const d = (this.pz - z) / 5, amp = 0.04 + 0.35 * Math.exp(-d * d) * (this.pz > z - 8 ? 1 : 0.3);
        sw.rotation.z = side * (Math.sin(this.t * 2.3 + ph) * amp + amp * 0.5);
        sw.rotation.x = Math.sin(this.t * 3.1 + ph) * amp * 0.4;
      },
    });
    this.evs[this.evs.length - 1].t = 0;
  }

  /** Un taburete que rueda de una abertura a la pared de enfrente (pequeño: se salta o se esquiva). */
  private stool(op: Slot) {
    const { side, z } = op, obj = fit(this.assets.gltf['hospital/stools'], 0.62), x0 = side * (HW + 3), xEnd = -side * (HW - 0.4), oz = z + (side > 0 ? 0.4 : -0.4), ob = this.addObs(oz, 0, 0.6, 0.3);
    let stopped = false;
    this.add({
      z, lead: 0.9, obj,
      reset: () => (obj.position.set(x0, 0, oz), (obj.rotation.set(0, 0, 0)), (stopped = ob.on = ob.hit = false)),
      tick: (t) => {
        if (t < 0.3) return void this.thump(z, side, 0.4);
        if (!stopped) {
          const x = x0 - side * 8 * (t - 0.3);
          obj.rotation.z = -side * (t - 0.3) * 7;
          if (side * (x - xEnd) <= 0) (obj.position.x = xEnd), (stopped = true), this.near(z) && this.audio?.step(true, 1.3, -side * 0.6);
          else obj.position.x = x;
        }
        ob.x0 = obj.position.x - 0.3;
        ob.x1 = obj.position.x + 0.3;
        ob.on = true;
      },
    });
  }

  /** Una sombra alta que cruza el pasillo de lado a lado (ambiente). */
  private shadow(op: Slot) {
    const { side, z } = op, m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.9), new THREE.MeshBasicMaterial({ map: silhouette(), transparent: true, color: 0x050607, depthWrite: false })), x0 = side * (HW + 3.5);
    this.owned.push(m.geometry, m.material as THREE.Material);
    m.rotation.y = Math.PI;
    this.add({
      z, lead: 1.1, obj: m,
      reset: () => (m.position.set(x0, 0.95, z), (m.visible = false)),
      tick: (t) => {
        const x = x0 - side * 7 * Math.max(0, t - 0.2);
        m.position.x = x;
        m.position.y = 0.95 + Math.sin(t * 16) * 0.04;
        m.visible = t > 0.2 && side * x > -HW + 0.1;
      },
    });
  }

  /** Un intento desde la salida: todo a su sitio (los obstáculos, otra vez enteros). */
  private restart() {
    this.pz = this.px = this.py = this.vy = this.stumble = this.duck = this.pitch = 0;
    this.sp = V0;
    this.surge = 6;
    this.lunge = 0;
    this.warned = false;
    this.yaw = Math.PI;
    this.lead = -GAP - 3;
    this.state = 'go';
    this.ct = this.glitch = 0;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    for (const o of this.obs) o.hit = o.on = false;
    for (const f of this.fixed) f.hit = false;
    for (const e of this.evs) {
      e.t = e.lead > 1e8 ? 0 : -1;
      e.reset();
    }
    this.place(0);
  }

  get hud(): RunHud {
    return { dist: Math.max(0, Math.min(RUN_LEN, this.pz)), len: RUN_LEN, hit: this.hitFlash, state: this.state, intro: Math.max(0, this.intro) };
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Los monstruos y la cámara donde toca. */
  private place(dt: number) {
    for (const c of this.pack) {
      const i = this.pack.indexOf(c), z = this.lead - c.dz + Math.sin(this.t * (3.1 + i * 0.7) + i * 2) * 0.55 + this.lunge * (0.6 + 0.25 * (i % 3)), k = 1 - Math.exp(-dt * (3 + this.lunge * 4));
      // siguen al jugador por detrás, cada uno en su hueco de la fila
      c.x += (THREE.MathUtils.clamp(this.px + c.ox, -LIM, LIM) - c.x) * (dt ? k : 1);
      c.rig.root.position.set(c.x + Math.sin(this.t * 2.2 + i * 1.9) * 0.35, 0, z);
      c.rig.mixer.timeScale = 1 + this.lunge * 0.5;
      c.rig.root.rotation.y = 0;
      c.rig.update(dt);
      if (c.balloon) {
        const h = c.rig.bone('RightHand');
        if (h) c.balloon.position.copy(h.getWorldPosition(this.hand));
        c.balloon.rotation.z = Math.sin(this.t * 1.4) * 0.12;
      }
    }
    const cam = this.camera, bob = this.reduced || this.py > 0 ? 0 : Math.sin(this.t * 13) * 0.035;
    const eye = THREE.MathUtils.lerp(EYE, 0.95, this.duck) + this.py + bob;
    // vibración leve de la cámara cuanto más cerca están los monstruos (y fuerte si tropiezas)
    const gap = this.pz - this.lead, near = THREE.MathUtils.clamp((7 - gap) / 5, 0, 1);
    const shake = this.reduced ? 0 : this.stumble > 0 ? 0.05 : near * near * 0.022;
    this.shake = shake;
    if (this.state === 'go' || this.state === 'won') {
      cam.position.set(this.px + (Math.random() - 0.5) * shake, eye + (Math.random() - 0.5) * shake, this.pz);
      cam.rotation.set(this.pitch, this.yaw, this.reduced ? 0 : Math.sin(this.t * 6.5) * 0.012 + (Math.random() - 0.5) * shake * 0.3, 'YXZ');
    }
    // una luz mínima y fría detrás del jugador: apenas perfila la pared y la cara de quien viene detrás
    this.torch.position.set(this.px, 2.1, this.pz - 1.2);
    // la luz de delante parpadea (más cuanto más cerca estén): el pasillo se lee ~18 m
    this.ahead.position.set(this.px * 0.5, 2.4, this.pz + 6);
    this.ahead.intensity = 5 * (this.reduced ? 1 : 0.8 + 0.2 * Math.sin(this.t * 23) * Math.sin(this.t * 7.3) + (Math.random() < near * 0.15 ? -0.5 : 0));
    this.torch.intensity = 2.6 + near * 3;
  }

  update(dt: number, c: Controls) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.2);
    this.black = Math.max(0, this.black - dt / 0.7);
    this.world(dt);
    if (this.state === 'caught') return this.caught(dt);
    if (this.state === 'won') {
      // la meta: se frena, los monstruos aflojan y la imagen se va a negro
      this.sp *= Math.exp(-dt * 3);
      this.pz += this.sp * dt;
      this.lead += Math.min(V0, Math.max(0, this.pz - 3 - this.lead) * 4) * dt;
      this.ct += dt;
      this.black = Math.max(this.black, THREE.MathUtils.clamp((this.ct - 0.7) / 1, 0, 1));
      this.place(dt);
      if (this.ct > 1.9 && !this.done) (this.done = true), this.onDone?.();
      return;
    }
    // mirar: también hacia atrás, para ver lo que viene
    this.yaw = THREE.MathUtils.clamp(this.yaw - c.look.x, Math.PI - 2.6, Math.PI + 2.6);
    this.pitch = THREE.MathUtils.clamp(this.pitch - c.look.y, -1.2, 1.2);
    // el aviso (WARN s) y la cuenta atrás (3, 2, 1): se puede mirar pero no correr, y ellos esperan
    if (this.intro > 0) {
      this.intro -= dt;
      if (this.intro <= 0) this.audio?.boom();
      this.place(dt);
      return;
    }
    this.go += dt;
    // esquivar, saltar y agacharse (a la derecha es -x: se corre hacia +z)
    // los mismos controles que en las Backrooms: WASD relativo a hacia dónde miras, Shift corre, C agacha (correr manda)
    const duck = !!c.crouch && !c.run && this.py <= 0;
    this.duck += ((duck ? 1 : 0) - this.duck) * Math.min(1, dt * 14);
    const mv = Math.min(1, c.move.length()), want = mv * (c.run ? V0 : duck ? 1.5 : 3) * (this.stumble > 0 ? 0.35 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // hacia delante (yaw = π mira a +z); la derecha es (-fz, fx)
    const dx = c.move.y * fx - c.move.x * fz, dz = c.move.y * fz + c.move.x * fx, dl = Math.hypot(dx, dz) || 1;
    this.px = THREE.MathUtils.clamp(this.px + (dx / dl) * want * dt, -LIM, LIM);
    if (c.jump && this.py <= 0 && !duck) this.vy = JUMP;
    this.vy -= G * dt;
    this.py = Math.max(0, this.py + this.vy * dt);
    if (this.py === 0) this.vy = 0;
    // la velocidad: un golpe la frena un momento (el hueco con ellos se come ~2 m)
    this.stumble = Math.max(0, this.stumble - dt);
    this.pz = Math.max(0, this.pz + (dz / dl) * want * dt);
    this.sp += (Math.max(0, (dz / dl) * want) - this.sp) * Math.min(1, dt * 7);
    // ellos: aprietan si te alejas, aflojan si se acercan demasiado
    const gap = this.pz - this.lead;
    // la embestida: cada 8–13 s avisan (golpe seco + estática) y un segundo después se lanzan; luego aflojan. Nunca te alcanzan solo por ella
    this.surge -= dt;
    if (this.surge < 1 && !this.warned) (this.warned = true), this.audio?.boom(), (this.hitFlash = Math.max(this.hitFlash, 0.4));
    if (this.surge <= 0) {
      this.lunge = Math.min(1, this.lunge + dt * 5);
      if (this.surge < -0.9 || gap < CATCH + 2.2) (this.surge = 8 + Math.random() * 5), (this.warned = false);
    } else this.lunge = Math.max(0, this.lunge - dt * 1.5);
    // los primeros 2,5 s ellos esperan: da tiempo a ponerse a correr
    this.lead += Math.min(1, Math.max(0, (this.go - 1.5) / 1)) * V0 * FOES * (1 + 0.3 * THREE.MathUtils.clamp((gap - GAP) / 3, -0.3, 1) + this.lunge * 0.3) * dt;
    // choques (generosos: cajas encogidas, y por arriba y por abajo basta con rozar para pasar)
    const head = 1.8 - 0.8 * this.duck;
    for (const o of this.obs) {
      if (!o.on || o.hit || Math.abs(o.z - this.pz) > o.d * 0.8 + 0.1 || this.px + PR < o.x0 + GX || this.px - PR > o.x1 - GX || this.py >= o.y1 - GY || this.py + head <= o.y0 + GY) continue;
      o.hit = true;
      this.bump(0.6);
    }
    // lo arrimado a las paredes: te aparta con suavidad (no se atraviesa ni te frena); solo un choque de verdad hace tropezar
    for (const f of this.fixed) {
      if (Math.abs(f.z0 - this.pz) > 8 && Math.abs(f.z1 - this.pz) > 8) continue;
      const x0 = f.x0 + GX, x1 = f.x1 - GX;
      if (this.pz + PR < f.z0 + GZ || this.pz - PR > f.z1 - GZ || this.px + PR < x0 || this.px - PR > x1 || this.py >= f.y1 - GY || this.py + head <= f.y0 + GY) continue;
      const side = (f.x0 + f.x1) / 2 > 0 ? 1 : -1, to = side > 0 ? x0 - PR : x1 + PR, depth = Math.abs(to - this.px);
      this.px += THREE.MathUtils.clamp(to - this.px, -5 * dt, 5 * dt);
      if (!f.hit && depth > 0.12) (f.hit = true), this.bump(0.35);
    }
    // pasos, y su ruido: más fuerte cuanto más cerca
    this.stepAcc += this.sp * dt;
    if (this.stepAcc > 1.9) (this.stepAcc = 0), this.py === 0 && this.audio?.step(true);
    this.audio?.near('bacteria', gap);
    this.audio?.near('partygoer', gap + 2);
    this.glitch = Math.max(this.hitFlash * 0.35, THREE.MathUtils.clamp((3.2 - gap) / 3, 0, 1) * 0.3);
    this.place(dt);
    if (this.pz - this.lead < CATCH) {
      this.state = 'caught';
      this.ct = 0;
      this.audio?.boom();
    } else if (this.pz >= RUN_LEN) {
      this.state = 'won';
      this.ct = 0;
      this.audio?.pickup();
    }
  }

  /** El pasillo vivo: luces, relojes, lo que sale de las aberturas, chispas. */
  private world(dt: number) {
    this.hosp.update(this.t, this.pz, dt);
    let k = 0;
    for (const l of this.evL) l.intensity = 0;
    for (const e of this.evs) {
      if (e.t < 0 && this.state === 'go' && (e.z - this.pz) / V0 <= e.lead + EARLY && e.z - this.pz > -6) e.t = 0;
      if (e.t < 0 || Math.abs(e.z - this.pz) > 60) continue;
      e.tick(e.t, dt);
      if (e.obj && e.lead < 1e8 && k < 2 && e.t < 3) {
        const l = this.evL[k++];
        e.obj.getWorldPosition(l.position);
        l.position.y = 1.6;
        l.intensity = 8 * (0.75 + 0.25 * Math.sin(this.t * 40 + k));
      }
      if (e.lead < 1e8) e.t += dt;
    }
    if (this.sparkT > 0) {
      this.sparkT = Math.max(0, this.sparkT - dt * 1.6);
      const p = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
      this.sparkV.forEach((v, i) => {
        v.y -= 9 * dt;
        p.setXYZ(i, p.getX(i) + v.x * dt, Math.max(0.02, p.getY(i) + v.y * dt), p.getZ(i) + v.z * dt);
      });
      p.needsUpdate = true;
      (this.sparks.material as THREE.PointsMaterial).opacity = this.sparkT;
      if (!this.sparkT) this.sparks.visible = false;
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT > 0 ? 30 * (this.flashT / 0.35) * (Math.random() < 0.7 ? 1 : 0.3) : 0;
  }

  /** Te alcanzan: la vista se clava en su cara, la cinta se rompe y, a los dos segundos, se acabó (una sola oportunidad). */
  private caught(dt: number) {
    this.ct += dt;
    const cam = this.camera, lead = this.pack[0], head = lead.rig.bone('Head')?.getWorldPosition(this.hand) ?? this.hand.set(lead.x, 2, this.lead);
    if (this.ct < 1.6) {
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, head, new THREE.Vector3(0, 1, 0)));
      cam.quaternion.slerp(q, Math.min(1, dt * 14));
      cam.fov = THREE.MathUtils.lerp(cam.fov, 100, Math.min(1, dt * 6));
      cam.updateProjectionMatrix();
      this.lead += Math.min(1, V0 * dt);
      for (const p of this.pack) p.rig.update(dt);
      lead.rig.root.position.z = Math.min(lead.rig.root.position.z + V0 * dt, this.pz + 0.3);
    }
    this.glitch = THREE.MathUtils.clamp(this.ct / 1.1, 0, 1);
    this.black = Math.max(this.black, THREE.MathUtils.clamp((this.ct - 1.1) / 0.5, 0, 1));
    if (this.ct > 1.7 && !this.done) (this.done = true), (this.black = 1), this.onFail?.();
  }

  dispose() {
    for (const c of this.pack) (c.rig.mixer.stopAllAction(), c.rig.root.removeFromParent(), c.balloon?.removeFromParent());
    this.hosp.dispose();
    this.owned.forEach((o) => o.dispose());
    this.scene.clear();
  }
}
