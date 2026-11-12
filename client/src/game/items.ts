import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CELL, type Cell } from './maze';
import { center, type World } from './world';
import type { Assets } from './game';
import type { Player } from './player';
import { fit } from './player';
import { canHold, radarSpot, waterSpots, type Drop, type ItemId } from '@backrooms/shared';
import type { Controls } from './input';
import type { GameAudio } from './audio';
import { loadPoolKit, type PoolKit } from './poolmap';

/*
 * Lo que se recoge y lo que se hace con ello: las 8 cintas, la cámara (fotos) y el rifle (disparos), lo que sueltan los compañeros
 * (ids `d…`, ver syncDrops) y el ascensor, que se abre al cumplirse la misión de la ronda (`ready`, lo pone game.ts).
 */

/** Algo a lo que se puede disparar o fotografiar (las entidades). */
export interface Target {
  readonly pos: THREE.Vector3; // los pies
  readonly height: number;
  readonly alive: boolean;
  /** Un tiro; true si muere. `from` es de donde viene, para que los trozos salgan hacia allí. */
  hit(from: THREE.Vector3): boolean;
}

const REACH = 1.6; // metros para recoger
export const MAG = 3, TOTAL = 6; // el rifle: dos cargadores de 3, sin más balas

/** ¿Se ve `b` desde `a` sin pared en medio? (pasos de 25 cm por la rejilla) */
export function sees(world: World, a: THREE.Vector3, b: THREE.Vector3) {
  const d = a.distanceTo(b), n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (world.solid(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** El punto del cuerpo (de 0,3 m a la cabeza) más cerca de la línea de mira: el encuadre no exige el ombligo. */
function aimPoint(tg: Target, eye: THREE.Vector3, fwd: THREE.Vector3) {
  const dh = Math.hypot(tg.pos.x - eye.x, tg.pos.z - eye.z), flat = Math.hypot(fwd.x, fwd.z) || 1e-6;
  return tg.pos.clone().setY(THREE.MathUtils.clamp(eye.y + (fwd.y / flat) * dh, 0.3, tg.height));
}

interface Pickup {
  id: string;
  obj: THREE.Object3D;
  kind: 'tape' | 'camera' | 'gun' | 'flashlight' | 'water' | 'totem' | 'radar' | 'ammo' | 'caution' | 'tank' | 'watergun';
  taken: boolean;
  /** Soltado por un jugador (id `d…`): al recogerlo vuelve a su inventario tal cual, sin lo que da el del mapa. */
  drop?: boolean;
  /** Pedido al servidor, sin respuesta aún. */
  pending?: boolean;
}

export class Items {
  readonly root = new THREE.Group();
  tapes = 0;
  readonly photographed = new Set<Target>();
  targets: Target[] = [];
  /** Las puertas del ascensor se han abierto. */
  open = false;
  /** La misión está cumplida: el ascensor se abre al acercarse. */
  ready = false;
  onWin?: () => void;
  onKill?: (t: Target, from: THREE.Vector3) => void;
  /** Los compañeros vivos (el centro del cuerpo) y qué pasa si el tiro da a uno: fuego amigo. */
  peers: () => { id: string; at: THREE.Vector3 }[] = () => [];
  onShootPlayer?: (id: string) => void;
  /** Cada disparo (dé o no): el ruido que oyen las entidades. */
  onShot?: () => void;
  /** Una foto que cuenta (multijugador: se avisa al servidor, que lo comprueba). */
  onPhoto?: () => void;
  private pickups: Pickup[] = [];
  /** En una sala: pedir al servidor quedarse con un objeto (el primero se lo lleva). */
  claim?: (id: string, done: (ok: boolean) => void) => void;
  private won = false;
  private rejectAt = 0;
  /** Los fotogramas que la foto se queda congelada. */
  freeze = 0;
  flash = 0;
  /** Hay una entidad en el recuadro de enfoque. */
  focus = false;
  /** Pedir una miniatura de este fotograma (la toma game.ts al pintar). */
  snap = false;
  /** Lo que se recogería con G ahora mismo (para el aviso en pantalla). */
  hint: string | null = null;
  private kit?: PoolKit;
  /** Las fotos hechas, en miniatura (data URL). */
  readonly thumbs: string[] = [];
  /** Las mismas fotos en grande (zoom y descarga). */
  readonly full: string[] = [];

  /** Pone un objeto en el suelo (los del mapa y los soltados). */
  private add: (id: string, kind: Pickup['kind'], c: Cell, src: THREE.Object3D, size: number, rot?: number, at?: { x: number; z: number }, drop?: boolean) => void;

  constructor(private world: World, private assets: Assets, private player: Player, private camera: THREE.Camera, private audio?: GameAudio, withTapes = true) {
    const m = world.maze;
    const put = (id: string, kind: Pickup['kind'], c: Cell, src: THREE.Object3D, size: number, rot = 0, at?: { x: number; z: number }, drop?: boolean) => {
      const g = fit(skClone(src), size); // (SkeletonUtils: el tótem lleva piel)
      // que se vea con la linterna: un brillo propio leve, del color de cada material (con su textura), no un gris plano
      g.traverse((o) => {
        const mesh = o as THREE.Mesh, mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mat?.isMeshStandardMaterial) return;
        const own = (mesh.material = mat.clone()) as THREE.MeshStandardMaterial;
        // la lata es casi blanca: con el brillo de los demás se quema; se queda mate y casi sin brillo propio
        const glow = kind === 'water' ? 0.04 : 0.22;
        if (kind === 'water') (own.color.multiplyScalar(0.7), (own.roughness = 1), (own.metalness = 0));
        if (own.map) (own.emissiveMap = own.map), own.emissive.setScalar(glow);
        else own.emissive.copy(own.color).multiplyScalar(glow * 1.4);
      });
      const holder = new THREE.Group();
      holder.add(g);
      const p = center(c);
      // no en el centro exacto de la celda: un poco tirado
      holder.position.set(at ? at.x : p.x + (Math.sin(c.x * 7.1 + c.y) * CELL) / 5, size / 4, at ? at.z : p.z + (Math.cos(c.y * 5.3 + c.x) * CELL) / 5);
      holder.rotation.set(0, rot, 0);
      this.root.add(holder);
      this.pickups.push({ id, obj: holder, kind, taken: false, drop });
    };
    this.add = put;
    if (withTapes) m.tapes.forEach((c, i) => put('t' + i, 'tape', c, assets.gltf.vhs.scene, 0.19, i * 1.3));
    m.flashlights.forEach((c, i) => put('f' + i, 'flashlight', c, assets.gltf.flashlight.scene, 0.24, i * 2.1));
    waterSpots(m).forEach((c, i) => put('w' + i, 'water', c, assets.gltf.water.scene, 0.17, i * 1.7));
    if (m.totem) put('m0', 'totem', m.totem, assets.gltf.totem.scene, 0.5, 0.4);
    const rd = radarSpot(m);
    if (rd) put('r0', 'radar', rd, assets.gltf.radar.scene, 0.2, 2.2); // el radar: uno por mapa, de quien lo coja
    put('c', 'camera', m.camera, assets.gltf.camcorder.scene, 0.22, 0.6);
    if (m.pistol) put('g', 'gun', m.pistol, assets.gltf.gun.scene, 0.72, 1.1);
    m.extraGuns.forEach((c, i) => put('g' + (i + 1), 'gun', c, assets.gltf.gun.scene, 0.72, 1.1 + i));
    world.root.add(this.root);
  }

  /** Lo recogible más cerca y de frente, a menos de REACH. */
  private nearest() {
    const eye = this.camera.getWorldPosition(new THREE.Vector3()), fwd = this.camera.getWorldDirection(new THREE.Vector3());
    let best: Pickup | undefined, bd = Infinity;
    for (const p of this.pickups) {
      if (p.taken || p.pending) continue;
      if (p.kind !== 'tape' && !canHold(this.player.inventory, p.kind)) continue; // lo que no cabe ni se ofrece (el servidor lo rechazaría)
      const to = p.obj.position.clone().sub(eye), d = to.length();
      if (d > REACH + 1.62 * 0.5 || to.normalize().dot(fwd) < 0.5) continue;
      if (d < bd) (bd = d), (best = p);
    }
    return best;
  }

  update(t: number, dt: number, c: Controls) {
    const pl = this.player;
    for (const p of this.pickups) if (!p.taken && p.kind === 'tape') p.obj.rotation.y += dt * 0.4;
    this.flash = Math.max(0, this.flash - dt * 4);

    const near = this.nearest();
    this.hint = near ? ({ tape: 'tape', camera: 'camcorder', gun: 'rifle', flashlight: 'flashlight', water: 'almond water', totem: 'totem of life', radar: 'radar', ammo: 'ammo', caution: 'caution tape', tank: 'diving tank', watergun: 'water gun' } as const)[near.kind] : null;
    if (c.grab) {
      const p = near;
      // la mano baja a por él; es tuyo cuando llega
      const take = (p: Pickup) => {
        const got = () => {
          p.obj.visible = false;
          this.audio?.pickup();
          if (p.drop) pl.receive(p.kind as ItemId); // lo soltado vuelve tal cual (y va a la barra o a la mano)
          else if (p.kind === 'tape') this.claim || this.tapes++; // en una sala, las cintas son de todos: las cuenta el servidor
          else if (p.kind === 'flashlight') pl.spares++;
          else if (p.kind === 'water') (pl.water++, pl.autoSlot('water'));
          else if (p.kind === 'totem') (pl.totem++, pl.autoSlot('totem'));
          else if (p.kind === 'radar') (pl.radar = true, pl.autoSlot('radar'));
          else if (p.kind === 'camera' || p.kind === 'gun') {
            pl.has[p.kind] = true;
            if (p.kind === 'gun') {
              // el rifle del mapa trae dos cargadores, que se suman a las balas que ya se llevaran (como cuenta el servidor)
              const t = pl.ammo + pl.spare + TOTAL;
              (pl.ammo = Math.min(MAG, t)), (pl.spare = t - pl.ammo);
            }
            pl.stow(p.kind);
            pl.autoSlot(p.kind);
          }
        };
        if (pl.reach(p.obj.getWorldPosition(new THREE.Vector3()), got)) p.taken = true;
        else if (this.claim) (p.taken = true), got(); // el servidor ya se lo ha dado: sin gesto
      };
      if (p && this.claim) {
        p.pending = true;
        this.claim(p.id, (ok) => {
          p.pending = false;
          // si no: lo ha cogido otro (el aviso del servidor, `sync`/`syncDrops`, lo quita) o no cabe / no llegas: sigue ahí, sin esconderlo por si acaso
          if (ok) take(p);
        });
      } else if (p) take(p);
    }
    if (c.reload && pl.hand === 'gun') this.reload();
    if (c.fire && pl.hand === 'gun') this.shoot();
    // la foto, solo mirando por la cámara; mirando, el recuadro de enfoque se cierra sobre una entidad
    if (c.fire && pl.hand === 'camera' && pl.aiming) this.photo();
    this.focus = pl.aiming && !!this.framed(15);
    this.elevator(t);
  }

  private reload() {
    const pl = this.player;
    if (pl.ammo >= MAG || pl.spare <= 0) return;
    const n = Math.min(MAG - pl.ammo, pl.spare);
    pl.ammo += n;
    pl.spare -= n;
    pl.act('Reloading');
    this.audio?.reload();
  }

  private shoot() {
    const pl = this.player;
    // sin balas en el cargador: recarga sola si quedan (en táctil no hace falta buscar el botón)
    if (pl.ammo <= 0) return pl.spare > 0 ? this.reload() : this.audio?.reject();
    pl.ammo--;
    pl.kick();
    this.audio?.shot();
    this.onShot?.();
    // el tiro: la entidad viva más cerca dentro de un cono estrecho, a la vista, a menos de 30 m
    const eye = this.camera.getWorldPosition(new THREE.Vector3()), fwd = this.camera.getWorldDirection(new THREE.Vector3());
    let best: Target | undefined, bd = 30;
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const mid = aimPoint(tg, eye, fwd), to = mid.clone().sub(eye), d = to.length();
      const spread = Math.atan2(0.3, d); // medio ancho del cuerpo visto desde aquí
      if (d < bd && to.normalize().angleTo(fwd) < spread && sees(this.world, eye, mid)) (bd = d), (best = tg);
    }
    // fuego amigo: un compañero vivo más cerca que lo que apuntas (o sin nada delante) recibe el tiro y muere
    let peer: { id: string; at: THREE.Vector3 } | undefined;
    for (const q of this.peers()) {
      const to = q.at.clone().sub(eye), d = to.length();
      if (d < bd && to.normalize().angleTo(fwd) < Math.atan2(0.3, d) && sees(this.world, eye, q.at)) (bd = d), (peer = q);
    }
    if (peer) return this.onShootPlayer?.(peer.id);
    if (best?.hit(eye)) this.onKill?.(best, eye);
  }

  /** La entidad viva (sin foto aún) mejor encuadrada, a menos de `range` m; el cono se estrecha con el zoom. */
  private framed(range: number) {
    const eye = this.camera.getWorldPosition(new THREE.Vector3()), fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const cone = THREE.MathUtils.degToRad(12) / Math.sqrt(this.player.zoom);
    for (const tg of this.targets) {
      if (!tg.alive || this.photographed.has(tg)) continue;
      const mid = aimPoint(tg, eye, fwd), to = mid.clone().sub(eye), d = to.length();
      if (d <= range * Math.sqrt(this.player.zoom) && to.normalize().angleTo(fwd) < cone && sees(this.world, eye, mid)) return tg;
    }
  }

  /** La foto: flash, un instante congelado y, si hay una entidad viva bien encuadrada, cuenta. Guarda una miniatura (game.ts). */
  photo() {
    this.flash = 1;
    this.freeze = 0.15;
    this.snap = true;
    this.audio?.shutter();
    const tg = this.framed(15);
    if (tg) (this.photographed.add(tg), this.onPhoto?.());
    return !!tg;
  }

  /** Lo que dice el servidor: lo recogido por otros desaparece y las cintas son las de todos. */
  sync(taken: string[], tapes: number) {
    this.tapes = tapes;
    const gone = new Set(taken);
    for (const p of this.pickups)
      if (!p.taken && gone.has(p.id)) (p.taken = true), (p.obj.visible = false);
  }

  /**
   * Los objetos soltados que hay ahora en el suelo (lista del servidor): los nuevos se ponen con su modelo, los que ya no están se quitan
   * (los recogió alguien o caducaron).
   */
  syncDrops(list: Drop[]) {
    const here = new Set(list.map((d) => d.id));
    for (const p of this.pickups)
      if (p.drop && !here.has(p.id)) (p.taken = true), p.obj.removeFromParent();
    this.pickups = this.pickups.filter((p) => !(p.drop && !here.has(p.id)));
    const g = this.assets.gltf;
    if (!this.kit && list.some((d) => d.kind === 'tank' || d.kind === 'watergun')) void loadPoolKit().then((k) => (this.kit = k)); // (sus modelos están en el kit de las Poolrooms; se reintenta en el siguiente mundo)
    const kit = this.kit;
    const model: Partial<Record<ItemId, [THREE.Object3D, number]>> = {
      ...(kit?.tank && { tank: [kit.tank, 0.6] as [THREE.Object3D, number] }),
      ...(kit?.watergun && { watergun: [kit.watergun, 0.4] as [THREE.Object3D, number] }),
      flashlight: [g.flashlight.scene, 0.24],
      camera: [g.camcorder.scene, 0.22],
      gun: [g.gun.scene, 0.72],
      water: [g.water.scene, 0.17],
      caution: [g.duct.scene, 0.16],
      radar: [g.radar.scene, 0.2],
      totem: [g.totem.scene, 0.5],
      ammo: [new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.5, metalness: 0.5 })), 0.12],
    };
    for (const d of list) {
      if (this.pickups.some((p) => p.id === d.id) || !model[d.kind]) continue;
      const [src, size] = model[d.kind]!;
      this.add(d.id, d.kind as Pickup['kind'], this.world.cellAt(d.x, d.z), src, size, (d.x * 3.1 + d.z) % 6.28, { x: d.x, z: d.z }, true);
    }
  }

  get photos() {
    return this.photographed.size;
  }

  private elevator(t: number) {
    const w = this.world, door = w.elevator.position, d = Math.hypot(this.player.pos.x - door.x, this.player.pos.z - door.z);
    const ready = this.ready;
    if (ready && !this.open && d < 3) {
      this.open = w.elevatorOpen = true;
      this.audio?.elevator();
      w.cab.open();
    }
    if (!ready && d < 1.3 && t > this.rejectAt) {
      this.rejectAt = t + 1.5;
      this.audio?.reject();
    }
    // dentro de la cabina, se cierra la grabación
    const cab = center(w.maze.elevator);
    if (this.open && !this.won && Math.hypot(this.player.pos.x - cab.x, this.player.pos.z - cab.z) < CELL * 0.3) {
      this.won = true;
      this.onWin?.();
    }
  }
}
