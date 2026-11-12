import * as THREE from 'three';
import { EntitySim, ENTITIES, type Cell, type EntState, type HideState, type Kind, type Noise, type SimTarget } from '@backrooms/shared';
import { center, type World } from './world';
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

export class Entity implements Target {
  readonly pos = new THREE.Vector3();
  readonly height: number;
  readonly rig: Rig;
  alive = true;
  state: EntState['state'] = 'wander';
  balloon?: THREE.Object3D;
  /** La cabeza (solo en solitario). */
  private sim?: EntitySim;
  private facing = 0;
  /** Hp con el que empezó: la siguiente aguanta uno más. */
  readonly hp0: number;
  // en una sala
  id = -1;
  onHit?: (id: number) => void;
  private goal = new THREE.Vector3();
  private goalYaw = 0;
  track = new Track(worldTl, false);
  private out: Snap = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private netState: EntState['state'] = 'wander';
  private moving = false;
  private shown?: string;

  constructor(readonly kind: Kind, private world: World, assets: Assets, at: Cell, public speed = 1, public hp = 1, readonly remote = false) {
    this.hp0 = hp;
    this.height = ENTITIES[kind].height;
    this.rig = new Rig(assets.gltf[kind]);
    this.rig.root.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    // la bacteria viene sin textura (gris): negra y algo brillante, como en el original
    if (kind === 'bacteria')
      this.rig.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.isMeshStandardMaterial) m.color.setHex(0x111111), (m.roughness = 0.45);
      });
    this.pos.copy(center(at));
    this.goal.copy(this.pos);
    this.rig.root.position.copy(this.pos);
    world.root.add(this.rig.root);
    if (!remote) this.sim = new EntitySim(kind, world.maze, (x, z) => world.solid(x, z), at, speed, hp, true); // recover: un golpe que no mata, y vuelve a lo suyo
    if (kind === 'partygoer') {
      // el globo, con el cordel en la mano derecha (se coloca cada fotograma: ver update)
      const b = assets.gltf.balloon.scene.clone(true), box = new THREE.Box3().setFromObject(b);
      b.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      this.balloon = new THREE.Group().add(b);
      world.root.add(this.balloon);
    }
    this.rig.play(CLIPS[kind].walk, 0);
  }

  /** El estado que manda el servidor, con la hora del snapshot (`snap`: colocarla ya, sin interpolar). La posición se dibuja algo en el pasado: ver interp.ts. */
  net(s: EntState, snap = false, t = performance.now()) {
    this.track.push({ t, x: s.x, y: 0, z: s.z, yaw: s.yaw, pitch: 0 }, 0);
    this.netState = s.state;
    this.hp = s.hp;
    this.speed = s.speed;
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
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    this.rig.update(dt);
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
