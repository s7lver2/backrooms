import * as THREE from 'three';
import { EntitySim, ENTITIES, type Cell, type Maze, type EntState, type HideState, type Kind, type Noise, type SimTarget } from '@backrooms/shared';
import { center } from './world';
import type { Assets } from './game';
import type { Target } from './items';
import { Rig } from './rig';
import { Timeline, Track, worldTl, type Snap } from './interp';

/*
 * Las entidades: la bacteria y el partygoer. Aquí solo se pintan (rig, clips y globo); su cabeza es
 * EntitySim (shared/sim.ts): en solitario la lleva esta clase; en una sala la lleva el servidor y llega
 * en el snapshot del mundo (ver `net`), que se interpola.
 */

export type { Kind };
/** Los clips de cada entidad salen de su ficha (shared/sim.ts: ENTITIES). */
export const CLIPS = Object.fromEntries(Object.entries(ENTITIES).map(([k, d]) => [k, d.clips])) as Record<Kind, (typeof ENTITIES)[Kind]['clips']>;

/** Los estados en que la entidad va por el mapa (los demás: atacar, bailar, muerta). */
const ROAM = new Set<EntState['state']>(['wander', 'search', 'stalk', 'chase', 'inspect']);

/** El cuerpo de una entidad (el «prefab»: modelo a su altura, color de la bacteria, globo del partygoer); lo usan `Entity` y «Run for your life». */
export function entityBody(kind: Kind, assets: Assets) {
  const rig = new Rig(assets.gltf[kind === 'faceling' ? 'suites/faceling' : kind]);
  if (kind === 'faceling') rig.root.scale.setScalar(ENTITIES[kind].height / new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3()).y);
  rig.root.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
  // la bacteria viene sin textura (gris): negra y algo brillante, como en el original
  if (kind === 'bacteria')
    rig.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.isMeshStandardMaterial) m.color.setHex(0x111111), (m.roughness = 0.45);
    });
  let balloon: THREE.Object3D | undefined;
  if (kind === 'partygoer') {
    // el globo, con el cordel en la mano derecha (se coloca cada fotograma)
    const b = assets.gltf.balloon.scene.clone(true), box = new THREE.Box3().setFromObject(b);
    b.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    balloon = new THREE.Group().add(b);
  }
  return { rig, balloon };
}

/** Lo que una entidad pide a su mundo: dónde colgar el cuerpo y, si lleva su cabeza de serie (EntitySim), el mapa y las paredes. Cualquier nivel con `root` vale si le pone su propio `Brain`. */
export interface EntityHost {
  root: THREE.Object3D;
  maze?: Maze;
  solid?: (x: number, z: number) => boolean;
}
/**
 * La cabeza de una entidad: lo que el cuerpo (`Entity`) necesita saber de cualquier IA. `EntitySim` (shared/sim.ts, el laberinto) ya lo cumple tal cual;
 * una IA de otro nivel (con plantas, por lotes...) se adapta a esto y el cuerpo, los clips, el globo y el baile son los mismos.
 */
export interface Brain {
  x: number;
  z: number;
  facing: number;
  state: EntState['state'];
  moving: boolean;
  hp: number;
  /** Un paso; devuelve algo (el id) el fotograma en que alcanza a un objetivo. */
  update(dt: number, targets: SimTarget[], god: boolean, hides: HideState[], noises: Noise[]): unknown;
  /** Un golpe: true si muere. */
  hit(): boolean;
  dance(x: number, z: number): void;
}

/**
 * Sigue una pose que llega a saltos (red, o una IA que decide por lotes): pone el cuerpo en ella, o se acerca con un pulido corto (`smooth`).
 * La usan las entidades del parking; con `smooth` falso, salta directo.
 */
export function followPose(root: THREE.Object3D, p: { x: number; y: number; z: number; yaw: number }, dt: number, smooth: boolean, rate = 17) {
  if (!smooth) return void (root.position.set(p.x, p.y, p.z), (root.rotation.y = p.yaw));
  const a = 1 - Math.exp(-dt * rate);
  root.position.set(THREE.MathUtils.lerp(root.position.x, p.x, a), THREE.MathUtils.lerp(root.position.y, p.y, a), THREE.MathUtils.lerp(root.position.z, p.z, a));
  root.rotation.y += Math.atan2(Math.sin(p.yaw - root.rotation.y), Math.cos(p.yaw - root.rotation.y)) * a;
}

export class Entity implements Target {
  readonly pos = new THREE.Vector3();
  readonly height: number;
  readonly rig: Rig;
  alive = true;
  state: EntState['state'] = 'wander';
  balloon?: THREE.Object3D;
  /** La cabeza (solo en solitario). */
  private sim?: Brain;
  private facing = 0;
  /** Hp con el que empezó: la siguiente aguanta uno más. */
  readonly hp0: number;
  // en una sala
  id = -1;
  /** Altura del suelo en (x, z), si no es plano (las Poolrooms). */
  ground?: (x: number, z: number) => number;
  onHit?: (id: number) => void;
  private goal = new THREE.Vector3();
  private goalYaw = 0;
  track = new Track(worldTl, false);
  private out: Snap = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private netState: EntState['state'] = 'wander';
  private moving = false;
  /** Las Suites: dónde estoy yo y lo que mide el bucle del pasillo; se pinta en la copia más cercana a mí. */
  hall?: { x: number; span: number };
  private shown?: string;

  constructor(readonly kind: Kind, host: EntityHost, assets: Assets, at: Cell, public speed = 1, public hp = 1, readonly remote = false, brain?: Brain) {
    this.hp0 = hp;
    this.height = ENTITIES[kind].height;
    const body = entityBody(kind, assets);
    this.rig = body.rig;
    this.balloon = body.balloon;
    this.pos.copy(center(at));
    this.goal.copy(this.pos);
    this.rig.root.position.copy(this.pos);
    host.root.add(this.rig.root);
    if (brain) this.sim = brain;
    else if (!remote) this.sim = new EntitySim(kind, host.maze!, (x, z) => host.solid!(x, z), at, speed, hp, true); // recover: un golpe que no mata, y vuelve a lo suyo
    if (this.balloon) host.root.add(this.balloon);
    this.rig.play(CLIPS[kind].walk, 0);
  }

  /** El estado que manda el servidor, con la hora del snapshot (`snap`: colocarla ya, sin interpolar). La posición se dibuja algo en el pasado: ver interp.ts. */
  /** Mojada por la pistola de agua: chorrea. */
  wet = false;
  private drip?: { pts: THREE.Points; v: Float32Array };
  /** Gotas que caen por el cuerpo mientras está mojada. */
  private dripFx(dt: number) {
    if (!this.drip && !this.wet) return;
    if (!this.drip) {
      const n = 36, pos = new Float32Array(n * 3), v = new Float32Array(n);
      for (let i = 0; i < n; i++) (v[i] = 0.6 + Math.random() * 0.9), this.dripReset(pos, i, true);
      const pts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
      pts.frustumCulled = false;
      this.rig.root.add(pts);
      this.drip = { pts, v };
    }
    const { pts, v } = this.drip, a = pts.geometry.getAttribute('position') as THREE.BufferAttribute, arr = a.array as Float32Array;
    pts.visible = this.wet || arr.some((_, i) => i % 3 === 1 && arr[i] > 0.05); // (al secarse, las gotas que quedan acaban de caer)
    for (let i = 0; i < v.length; i++) {
      arr[i * 3 + 1] -= v[i] * dt;
      if (arr[i * 3 + 1] < 0) this.wet ? this.dripReset(arr, i, false) : (arr[i * 3 + 1] = -1);
    }
    a.needsUpdate = true;
  }
  private dripReset(arr: Float32Array, i: number, spread: boolean) {
    const h = this.rig.root.scale.y * (ENTITIES[this.kind].height);
    const ang = Math.random() * Math.PI * 2, r = 0.12 + Math.random() * 0.22;
    arr[i * 3] = Math.cos(ang) * r;
    arr[i * 3 + 1] = spread ? Math.random() * h : h * (0.55 + Math.random() * 0.4);
    arr[i * 3 + 2] = Math.sin(ang) * r;
  }

  net(s: EntState, snap = false, t = performance.now()) {
    this.track.push({ t, x: s.x, y: 0, z: s.z, yaw: s.yaw, pitch: 0 }, 0);
    this.netState = s.state;
    this.hp = s.hp;
    this.speed = s.speed;
    this.wet = !!s.wet;
    if (snap) (this.goal.set(s.x, 0, s.z), this.pos.copy(this.goal), (this.facing = s.yaw), (this.goalYaw = s.yaw));
  }

  /** Te ha pillado (lo dice el servidor antes de que llegue el siguiente snapshot): ataca ya. */
  forceAttack() {
    this.netState = 'attack';
  }

  /**
   * Un fotograma. `torch`: hacia dónde apunta la linterna (null, apagada); `exposed`: si estás bajo
   * los fluorescentes encendidos. Devuelve true el fotograma en que alcanza al jugador (solo en solitario).
   * `hidden`: el jugador está en un nicho (no es objetivo); `hides`: los nichos con alguien dentro (pueden inspeccionarlo).
   */
  private lag = 0;
  private skip = 0;
  update(dt: number, player: THREE.Vector3, eye: THREE.Vector3, torch: THREE.Vector3 | null, exposed: boolean, god: boolean, hides: HideState[] = [], hidden = false, duck = false, yaw?: number, noises: Noise[] = []) {
    const clip = CLIPS[this.kind];
    let caught = false;
    if (this.sim) {
      const t: SimTarget = { id: 'me', x: player.x, y: player.y, z: player.z, ex: eye.x, ey: eye.y, ez: eye.z, torch: torch ? [torch.x, torch.y, torch.z] : null, exposed, duck, yaw };
      caught = this.sim.update(dt, hidden ? [] : [t], god, hides, noises) !== undefined;
      if (ROAM.has(this.sim.state)) this.pos.set(this.sim.x, 0, this.sim.z);
      this.facing = this.sim.facing;
      this.state = this.sim.state;
      this.moving = this.sim.moving;
      if (caught) this.rig.play(clip.attack, 0.1, true);
      else if (ROAM.has(this.state)) {
        const a = this.rig.play(this.clipOf());
        if (a && this.state === 'chase') a.timeScale = this.speed;
      }
    } else this.follow(dt);
    if (this.ground) this.pos.y = this.ground(this.pos.x, this.pos.z);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    // los esqueletos lejanos (a más de 20 m) animan cada tercer fotograma, con el tiempo acumulado: se ven pequeños y borrosos tras la niebla y el hueso es lo caro
    this.lag += dt;
    if (this.pos.distanceToSquared(player) < 400 || ++this.skip >= 3) (this.rig.update(this.lag), (this.lag = 0), (this.skip = 0));
    this.dripFx(dt);
    if (this.balloon && this.state !== 'dead') {
      const hand = this.rig.bone('RightHand');
      if (hand) this.balloon.position.copy(hand.getWorldPosition(new THREE.Vector3()));
      this.balloon.rotation.z = Math.sin(performance.now() / 700) * 0.12;
    }
    return caught;
  }

  /** El clip de un estado en que se mueve por el mapa: el que diga la ficha para ese estado; si no, correr persiguiendo, andar o quieta. */
  private clipOf() {
    const c = CLIPS[this.kind];
    return c.state?.[this.state] ?? (this.state === 'chase' ? c.run : this.moving ? c.walk : c.idle);
  }

  /** En una sala: ir hacia lo que dice el servidor y poner el clip que toca. */
  private follow(dt: number) {
    const clip = CLIPS[this.kind], k = 1 - Math.exp(-dt * 28); // ya viene suave de la interpolación: solo un pulido corto
    if (this.track.sample(performance.now(), this.out)) (this.goal.set(this.out.x, 0, this.out.z), (this.goalYaw = this.out.yaw));
    if (this.hall && (this.hall.x < 3 * this.hall.span) === (this.goal.x < 3 * this.hall.span)) { // (el vestíbulo no es del bucle: el personal del pasillo no se pinta allí, ni al revés)
      const d = Math.round((this.hall.x - this.goal.x) / this.hall.span) * this.hall.span;
      if (d) (this.goal.x += d), (this.pos.x += d);
    }
    const bx = this.pos.x, bz = this.pos.z;
    Timeline.follow(this.pos, this.goal, dt, k, 9);
    this.facing += (THREE.MathUtils.euclideanModulo(this.goalYaw - this.facing + Math.PI, Math.PI * 2) - Math.PI) * k;
    this.moving = Math.hypot(this.pos.x - bx, this.pos.z - bz) > 0.3 * dt;
    this.state = this.netState;
    const want = this.state === 'attack' ? clip.attack : this.state === 'dance' ? clip.dances[this.id % clip.dances.length] : this.clipOf();
    if (want === this.shown) return;
    this.shown = want;
    const a = this.rig.play(want, 0.2, this.state === 'attack');
    if (a) a.timeScale = this.state === 'chase' ? this.speed : 1;
  }

  /** Tras atacar: mira al jugador y baila uno de sus bailes. */
  dance(at: THREE.Vector3) {
    const clips = CLIPS[this.kind].dances;
    this.state = 'dance';
    this.facing = Math.atan2(at.x - this.pos.x, at.z - this.pos.z);
    if (this.sim) {
      this.sim.x = this.pos.x;
      this.sim.z = this.pos.z;
      this.sim.dance(at.x, at.z);
    } else this.goalYaw = this.facing;
    this.rig.play(clips[(Math.random() * clips.length) | 0], 0.3);
    this.shown = undefined;
  }

  hit(_from?: THREE.Vector3) {
    if (!this.alive) return false;
    // en una sala decide el servidor: el cliente solo avisa
    if (!this.sim) return this.onHit?.(this.id), false;
    if (!this.sim.hit()) return (this.hp = this.sim.hp), false;
    this.alive = false;
    this.state = 'dead';
    return true;
  }

  dispose() {
    this.rig.mixer.stopAllAction();
    this.rig.root.removeFromParent();
    this.balloon?.removeFromParent();
  }
}
