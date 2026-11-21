import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WAIT_HALF } from '@backrooms/shared';
import { Dust, hash, plane, softTex, type Bag } from './waitKit';
import { Rig } from './rig';
import { CLIPS } from './entity';
import type { Assets } from './game';

/*
 * Lo que hay detrás de la puerta de la sala de espera: un pasillo de las backrooms largo y estrecho (paneles de luz
 * cada 3,6 m, moqueta, papel pintado) que acaba en una sala amplia, y al fondo una silueta que cruza. Todo sin luces
 * reales: materiales sin iluminar, charcos de luz aditivos bajo cada panel y la niebla de la escena para la profundidad
 * (la sala de espera la aclara a amarillo al abrirse la puerta). Es lo que enseña la secuencia de entrada.
 */

const HEIGHT = 2.6;
const W = 2.4;
const WALL_T = 0.2;
const Z0 = -(WAIT_HALF.z + WALL_T);
const Z1 = -17; // dónde acaba el pasillo y empieza la sala
const Z2 = -25; // el fondo de la sala
const HALL = 5; // medio ancho de la sala
const STEP = 3.6;

export class Corridor {
  readonly group = new THREE.Group();
  private flick: THREE.MeshBasicMaterial;
  private glow!: THREE.MeshBasicMaterial;
  private dust: Dust;
  private fig: THREE.Group;

  constructor(bag: Bag, tex: { wall: THREE.Texture; ceiling: THREE.Texture; carpet: THREE.Texture }, plain: THREE.Material, plainFloor: THREE.Material, gltf?: Assets['gltf']) {
    const g = this.group;
    const wallM = new THREE.MeshBasicMaterial({ map: tex.wall, color: 0xb4a56a });
    const ceilM = new THREE.MeshBasicMaterial({ map: tex.ceiling, color: 0xa39a6c });
    const floorM = new THREE.MeshBasicMaterial({ map: tex.carpet, color: 0xa29252 });
    const steady = new THREE.MeshBasicMaterial({ color: 0xffefb0, toneMapped: false });
    this.flick = new THREE.MeshBasicMaterial({ color: 0xffefb0, toneMapped: false });
    this.flick2 = new THREE.MeshBasicMaterial({ color: 0xffefb0, toneMapped: false });
    bag.own.push(wallM, ceilM, floorM, steady, this.flick, this.flick2);
    const len = Z0 - Z1, zc = (Z0 + Z1) / 2, hl = Z1 - Z2, hz = (Z1 + Z2) / 2;
    g.add(
      // el pasillo
      plane(W, len, floorM, 2, [0, 0, zc], -Math.PI / 2, 0),
      plane(W, len, ceilM, 1.5, [0, HEIGHT, zc], Math.PI / 2, 0),
      plane(len, HEIGHT, wallM, 1.5, [-W / 2, HEIGHT / 2, zc], 0, Math.PI / 2),
      plane(len, HEIGHT, wallM, 1.5, [W / 2, HEIGHT / 2, zc], 0, -Math.PI / 2),
      // la sala del fondo
      plane(HALL * 2, hl, floorM, 2, [0, 0, hz], -Math.PI / 2, 0),
      plane(HALL * 2, hl, ceilM, 1.5, [0, HEIGHT, hz], Math.PI / 2, 0),
      plane(hl, HEIGHT, wallM, 1.5, [-HALL, HEIGHT / 2, hz], 0, Math.PI / 2),
      plane(hl, HEIGHT, wallM, 1.5, [HALL, HEIGHT / 2, hz], 0, -Math.PI / 2),
      plane(HALL * 2, HEIGHT, wallM, 1.5, [0, HEIGHT / 2, Z2], 0, 0),
      // el grosor de la pared al abrir la puerta, con el material de dentro (la hoja lo tapa al principio)
      plane(WALL_T, HEIGHT, plain, 1.5, [-0.55, HEIGHT / 2, -WAIT_HALF.z - WALL_T / 2], 0, Math.PI / 2),
      plane(WALL_T, HEIGHT, plain, 1.5, [0.55, HEIGHT / 2, -WAIT_HALF.z - WALL_T / 2], 0, -Math.PI / 2),
      plane(1.1, WALL_T, plain, 1.5, [0, 2.1, -WAIT_HALF.z - WALL_T / 2], Math.PI / 2, 0),
      plane(1.1, WALL_T, plainFloor, 1, [0, 0.001, -WAIT_HALF.z - WALL_T / 2], -Math.PI / 2, 0),
    );

    // los paneles de luz y sus charcos: cada 3,6 m; en la sala del fondo, cuatro más
    const spots: [number, number][] = [];
    for (let z = Z0 - 1.8; z > Z1; z -= STEP) spots.push([0, z]);
    for (const [x, z] of [[-2.5, -20], [2.5, -20], [-2.5, -23], [2.5, -23]]) spots.push([x, z]);
    const A: THREE.BufferGeometry[] = [], B: THREE.BufferGeometry[] = [], C: THREE.BufferGeometry[] = [], pool: THREE.BufferGeometry[] = [];
    spots.forEach(([x, z], i) => {
      const gm = new THREE.BoxGeometry(0.62, 0.04, 1.2).translate(x, HEIGHT - 0.02, z).toNonIndexed();
      (i % 3 === 1 ? B : i % 3 === 2 ? C : A).push(gm);
      const f = new THREE.PlaneGeometry(2.6, 3.4).rotateX(-Math.PI / 2).translate(x, 0.012, z);
      pool.push(f.toNonIndexed());
      if (Math.abs(x) < 0.1) {
        for (const s of [-1, 1]) pool.push(new THREE.PlaneGeometry(3.4, 1.7).rotateY(-s * Math.PI / 2).translate(s * (W / 2 - 0.012), 1.9, z).toNonIndexed());
      }
    });
    const mk = (a: THREE.BufferGeometry[], m: THREE.Material) => {
      const mesh = new THREE.Mesh(mergeGeometries(a)!, m);
      g.add(mesh);
      return mesh;
    };
    mk(A, steady);
    mk(B, this.flick);
    mk(C, this.flick2);
    const glow = new THREE.MeshBasicMaterial({ map: softTex(bag, 0.7, 0.3), color: 0xffd47a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    bag.own.push(glow);
    mk(pool, glow).renderOrder = 1;
    this.glow = glow;

    // polvo en el pasillo (se ve al abrirse la puerta)
    this.dust = new Dust(bag, 150, new THREE.Vector3(-1.1, 0.2, -12), new THREE.Vector3(1.1, 2.4, Z0), 0.05, 0, 0xfff0c0);
    g.add(this.dust.points);

    // la silueta: el modelo de la bacteria, negro del todo (sin luz ni brillo) y rodeado de motas de oscuridad; si no hay modelo, una figura de cápsulas
    const sil = new THREE.MeshBasicMaterial({ color: 0x010101 });
    bag.own.push(sil);
    this.fig = new THREE.Group();
    if (gltf?.bacteria) {
      this.rig = new Rig(gltf.bacteria);
      this.rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material = sil), (m.castShadow = false);
      });
      const h = new THREE.Box3().setFromObject(this.rig.root).getSize(new THREE.Vector3()).y || 1;
      this.rig.root.scale.setScalar(2.5 / h);
      this.rig.play(CLIPS.bacteria.walk, 0);
      this.fig.add(this.rig.root);
    }
    // las motas: puntos negros sin mezcla aditiva (se ven sobre el papel amarillo) que orbitan y suben alrededor del cuerpo
    const N = 190, mp = new Float32Array(N * 3);
    this.mote = Array.from({ length: N }, () => ({ a: Math.random() * 6.28, r: 0.15 + Math.random() * 0.9, y: Math.random() * 2.8, v: 0.15 + Math.random() * 0.5, w: (Math.random() - 0.5) * 2.4 }));
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.moteMat = new THREE.PointsMaterial({ size: 0.17, color: 0x000000, map: softTex(bag, 1, 0.8), transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.motes = new THREE.Points(mg, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    bag.own.push(mg, this.moteMat);
    if (!this.rig) {
      const limb = (len: number, r: number, x: number, y: number, hang: number) => {
        const pivot = new THREE.Group(), geo = new THREE.CapsuleGeometry(r, len, 3, 6), m = new THREE.Mesh(geo, sil);
        m.position.y = -len / 2 - r;
        pivot.add(m);
        pivot.position.set(x, y, 0);
        pivot.rotation.z = hang;
        bag.own.push(geo);
        this.fig.add(pivot);
        return pivot;
      };
      const torsoG = new THREE.CapsuleGeometry(0.12, 0.8, 3, 8), torso = new THREE.Mesh(torsoG, sil);
      torso.position.y = 1.35;
      torso.scale.set(1, 1, 0.7);
      this.fig.add(torso);
      this.head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), sil);
      this.head.position.set(0.02, 2.05, 0.03);
      this.fig.add(this.head);
      bag.own.push(torsoG, this.head.geometry);
      this.arms = [limb(1.15, 0.03, -0.2, 1.8, 0.06), limb(1.15, 0.03, 0.2, 1.8, -0.06)];
      this.legs = [limb(0.9, 0.05, -0.08, 0.98, 0), limb(0.9, 0.05, 0.08, 0.98, 0)];
      this.fig.scale.set(1.05, 1.22, 1.05);
    }
    this.fig.visible = false;
    g.add(this.fig, this.motes);
    this.steady = steady;
    this.reseed();
  }
  private rig?: Rig;
  private motes!: THREE.Points;
  private moteMat!: THREE.PointsMaterial;
  private mote: { a: number; r: number; y: number; v: number; w: number }[] = [];
  /** Cuánto se ve el cuerpo (0–1, con un fundido corto) y dónde quedó por última vez (las motas se deshacen en el sitio). */
  private shown = 0;
  private last = new THREE.Vector3();
  /** La variante de esta entrada (cada vez distinta): los tiempos y sitios de las apariciones, qué paneles fallan y cuándo se «traba» la figura. */
  private wins: [number, number, number, number][] = Corridor.WINDOWS.map((w) => [...w]);
  private fail = { relight: 9.2, panel: 1, stutter: 0.3, skip: -1 };
  private frozen = 0;
  private jerk = 0;
  /** Una variante nueva: las apariciones se mueven un poco, a veces una falla (se la salta o aparece ya lejos) y los paneles se rompen en otro orden. */
  reseed() {
    const r = Math.random;
    this.wins = Corridor.WINDOWS.map(([a, b, z, x], i) => {
      const j = (r() - 0.5) * 0.5;
      return [a + j, b === 99 ? 99 : b + j + (r() - 0.5) * 0.3, z + (r() - 0.5) * 1.2, x + (r() - 0.5) * 0.5 * (i < 3 ? 1 : 0.2)] as [number, number, number, number];
    });
    this.fail = { relight: 8.6 + r() * 1.2, panel: Math.floor(r() * 3), stutter: 0.15 + r() * 0.35, skip: r() < 0.45 ? 1 + Math.floor(r() * 2) : -1 };
    this.frozen = 0;
  }
  private head!: THREE.Mesh;
  private arms: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private steady!: THREE.MeshBasicMaterial;
  private flick2!: THREE.MeshBasicMaterial;
  /** Dónde y cuándo aparece (s de la secuencia, z, x): solo con las luces del pasillo apagadas entre un destello y otro; cada vez más cerca. */
  static readonly WINDOWS: [number, number, number, number][] = [[7.0, 7.7, -23.5, 0.5], [8.2, 8.9, -20.5, -0.15], [9.3, 10.0, -18.2, 0.05], [10.15, 99, -16.2, 0]];

  /** `t`: segundos de la secuencia; `open`: lo abierta que está la puerta (0–1). */
  update(dt: number, t: number, open: number, seq: boolean, reduced: boolean) {
    const win = Corridor.windowAt(this.wins, t, this.fail.skip);
    const live = seq && !reduced;
    // con la puerta abierta las luces del pasillo se van en los huecos entre aparición y aparición; un panel se queda muerto y otro tiene un reencendido que falla
    const dark = live && t > 6.8 && t < 10.15 && !win ? 0.12 : 1;
    const hit = (k: number) => (hash(Math.floor(t * 13) + k * 31) < 0.18 ? 0.3 : 1);
    const dead = live && t > 7.4 ? 0 : 1; // el panel que se rompe al empezar a acercarse
    const miss = live && t > this.fail.relight && t < this.fail.relight + 0.45 && hash(Math.floor(t * 24)) < 0.6 ? 0.1 : 1;
    const P = [this.fail.panel === 0 ? dead : 1, this.fail.panel === 1 ? dead : 1, this.fail.panel === 2 ? dead : 1];
    this.steady.color.setScalar(dark * P[0] * miss).multiply(_c);
    this.flick.color.setScalar(hit(0) * dark * P[1] * miss).multiply(_c);
    this.flick2.color.setScalar(hit(1) * dark * P[2] * miss).multiply(_c);
    this.glow.opacity = 0.55 * (0.25 + 0.75 * (dark * miss * (0.6 + 0.4 * (P[0] + P[1] + P[2]) / 3)));
    this.dust.opacity(reduced ? 0 : open * 0.55);
    if (open > 0.02 && !reduced) this.dust.update(dt, t);
    this.shown = THREE.MathUtils.clamp(this.shown + ((live && win ? 1 : 0) - this.shown) * Math.min(1, dt * (win ? 14 : 5)), 0, 1);
    this.fig.visible = live && !!win;
    if (this.fig.visible && win) {
      const [a, , z, x] = win, k = t - a;
      // se «traba»: a ratos el cuerpo se congela un instante y salta unos centímetros, como un vídeo que falla
      if (this.frozen > 0) this.frozen -= dt;
      else if (hash(Math.floor(t * 9) + 3) < this.fail.stutter * 0.35) (this.frozen = 0.08 + Math.random() * 0.14), (this.jerk = (Math.random() - 0.5) * 0.35);
      const stuck = this.frozen > 0;
      this.fig.position.set(x + Math.sin(t * 0.9) * 0.03 + (stuck ? this.jerk : 0), 0, z + (stuck ? -this.jerk * 0.6 : 0));
      this.fig.rotation.y = Math.sin(t * 0.6) * 0.12 + (stuck ? this.jerk * 1.2 : 0); // mira de frente, apenas se mece
      this.fig.visible = !(stuck && hash(Math.floor(t * 60)) < 0.35); // y a veces parpadea fuera un fotograma
      this.last.copy(this.fig.position);
      if (this.rig) {
        if (!stuck) this.rig.update(dt * 0.7);
        this.fig.rotation.x = 0.12; // algo encorvado, rozando el techo
      } else {
        const w = Math.sin(t * 3.2);
        this.legs[0].rotation.x = w * 0.28;
        this.legs[1].rotation.x = -w * 0.28;
        this.arms[0].rotation.x = -w * 0.1;
        this.arms[1].rotation.x = w * 0.1;
        this.head.rotation.z = 0.35 + (hash(Math.floor(t * 6) + 7) - 0.5) * 0.5 * Math.min(1, k * 2);
        this.fig.position.y = Math.abs(w) * 0.025;
      }
    }
    // las motas de oscuridad: giran y suben alrededor del cuerpo, y al irse se quedan un momento en el sitio
    this.motes.visible = live && this.shown > 0.02;
    if (this.motes.visible) {
      this.moteMat.opacity = 0.85 * this.shown;
      const pa = (this.motes.geometry.getAttribute('position') as THREE.BufferAttribute), p = pa.array as Float32Array;
      this.mote.forEach((m, i) => {
        m.a += m.w * dt;
        m.y += m.v * dt;
        if (m.y > 2.9) (m.y = 0), (m.r = 0.15 + Math.random() * 0.9);
        const rr = m.r * (0.55 + 0.45 * Math.sin(m.y * 2.2 + i)); // más densas junto al cuerpo
        p[i * 3] = this.last.x + Math.cos(m.a) * rr;
        p[i * 3 + 1] = m.y;
        p[i * 3 + 2] = this.last.z + Math.sin(m.a) * rr * 0.8;
      });
      pa.needsUpdate = true;
    }
  }
  static windowAt(w: [number, number, number, number][], t: number, skip: number) {
    const i = w.findIndex(([a, b]) => t >= a && t < b);
    return i === skip ? undefined : w[i];
  }
}
const _c = new THREE.Color(0xffefb0);
