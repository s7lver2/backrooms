import * as THREE from 'three';
import { CELL, type Cell } from './maze';
import { center, type World } from './world';
import type { Assets } from './game';
import type { Player } from './player';
import { PickupField, MAG, TOTAL, type Pickup } from './pickups';
export { MAG, TOTAL };
import { boostOf, lootSpots, radarSpot, spotRarity, waterSpots, type Drop, type ItemId } from '@backrooms/shared';
import { lootModel } from './rarityFx';
import { perks } from './perks';
import type { Controls } from './input';
import type { GameAudio } from './audio';
import { loadPoolKit, type PoolKit } from './poolmap';
import { itemModel } from './itemModels';

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

export class Items extends PickupField {
  readonly photographed = new Set<Target>();
  targets: Target[] = [];
  /** Las puertas del ascensor se han abierto. */
  open = false;
  /** La misión está cumplida: el ascensor se abre al acercarse. */
  ready = false;
  onWin?: (stairs?: boolean) => void;
  onKill?: (t: Target, from: THREE.Vector3) => void;
  /** Los compañeros vivos (el centro del cuerpo) y qué pasa si el tiro da a uno: fuego amigo. */
  peers: () => { id: string; at: THREE.Vector3 }[] = () => [];
  onShootPlayer?: (id: string) => void;
  /** Cada disparo (dé o no): el ruido que oyen las entidades. */
  onShot?: () => void;
  /** Una foto que cuenta (multijugador: se avisa al servidor, que lo comprueba). */
  onPhoto?: () => void;
  private won = false;
  private rejectAt = 0;
  /** Los fotogramas que la foto se queda congelada. */
  freeze = 0;
  flash = 0;
  /** Hay una entidad en el recuadro de enfoque. */
  focus = false;
  /** Pedir una miniatura de este fotograma (la toma game.ts al pintar). */
  snap = false;
  private kit?: PoolKit;
  /** Las fotos hechas, en miniatura (data URL). */
  readonly thumbs: string[] = [];
  /** Las mismas fotos en grande (zoom y descarga). */
  readonly full: string[] = [];

  constructor(private world: World, private assets: Assets, player: Player, camera: THREE.Camera, audio?: GameAudio, withTapes = true) {
    super({ root: world.root, solid: (x, z) => world.solid(x, z), cellAt: (x, z) => world.cellAt(x, z), span: world.maze.span }, camera, audio);
    this.bind(player);
    const m = world.maze, put = this.put.bind(this);
    if (withTapes) m.tapes.forEach((c, i) => put('t' + i, 'tape', c, assets.gltf.vhs.scene, 0.19, i * 1.3));
    m.flashlights.forEach((c, i) => put('f' + i, 'flashlight', c, assets.gltf.flashlight.scene, 0.24, i * 2.1));
    waterSpots(m).forEach((c, i) => put('w' + i, 'water', c, assets.gltf.water.scene, 0.17, i * 1.7));
    if (m.totem) put('m0', 'totem', m.totem, assets.gltf.totem.scene, 0.5, 0.4);
    const rd = radarSpot(m);
    if (rd) put('r0', 'radar', rd, assets.gltf.radar.scene, 0.2, 2.2); // el radar: uno por mapa, de quien lo coja
    put('c', 'camera', m.camera, assets.gltf.camcorder.scene, 0.22, 0.6);
    if (m.pistol) put('g', 'gun', m.pistol, assets.gltf.gun.scene, 0.72, 1.1);
    m.extraGuns.forEach((c, i) => put('g' + (i + 1), 'gun', c, assets.gltf.gun.scene, 0.72, 1.1 + i));
    lootSpots(m).forEach((c, i) => {
      if (i % 8 === 7) {
        // una taquilla (se abre con un minijuego y guarda botín y objetos)
        const lk = itemModel('locker') ?? new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), new THREE.MeshStandardMaterial({ color: 0x59636b, roughness: 0.6, metalness: 0.6 }));
        // siempre pegada a una pared: la primera de las cuatro de la celda con muro, de frente a la sala
        const cc = center(c), D = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const, w = D.find(([dx, dz]) => this.world.solid(cc.x + dx * (CELL / 2 + 0.2), cc.z + dz * (CELL / 2 + 0.2))) ?? D[0];
        put('l' + i, 'locker', c, lk, 1.8, Math.atan2(-w[0], -w[1]), { x: cc.x + w[0] * (CELL / 2 - 0.4), z: cc.z + w[1] * (CELL / 2 - 0.4) });
      } else put('v' + i, 'loot', c, lootModel(spotRarity('v' + i, c)), 0.24, i); // el botín: solo para vender
    });
    // los cuadros eléctricos de Las Suites: sin modelo propio (ya están en la pared), solo el sitio al que apuntar
    (m.gens ?? []).forEach((c, i) => {
      const holder = new THREE.Group(), cc = center(c), pp = m.props.find((q) => q.kind === 'panel' && q.cell.x === c.x && q.cell.y === c.y); // (donde cuelga el cuadro, escondido en una suite)
      holder.position.set(cc.x + (pp?.off?.[0] ?? 0), 1.4, cc.z + (pp?.off?.[1] ?? 0));
      this.root.add(holder);
      this.pickups.push({ id: 'e' + i, obj: holder, kind: 'gen', taken: false, y: 1.4 });
    });
  }
  update(t: number, dt: number, c: Controls) {
    const pl = this.player;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.tick(t, dt, c); // (lo recogible: ver pickups.ts)
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
    let best: Target | undefined, bd = 30 * boostOf(perks, 'gun'); // (la rareza del rifle: más alcance)
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
    range *= boostOf(perks, 'camera'); // (la rareza de la cámara: más alcance)
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

  /** Los objetos soltados que hay ahora en el suelo (lista del servidor), con los modelos de este mundo. */
  override syncDrops(list: Drop[]) {
    const g = this.assets.gltf;
    if (!this.kit && list.some((d) => d.kind === 'tank' || d.kind === 'watergun')) void loadPoolKit().then((k) => (this.kit = k)); // (sus modelos están en el kit de las Poolrooms; se reintenta en el siguiente mundo)
    const kit = this.kit;
    const model: Partial<Record<ItemId | 'loot', [THREE.Object3D, number]>> = {
      loot: [lootModel(), 0.24],
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
    super.syncDrops(list, model, lootModel);
  }

  get photos() {
    return this.photographed.size;
  }

  private elevator(t: number) {
    const w = this.world, door = w.elevator.position, d = Math.hypot(this.player.pos.x - door.x, this.player.pos.z - door.z);
    const ready = this.ready;
    this.world.genLeds.forEach((m, i) => m.color.setHex(this.pickups.find((p) => p.id === 'e' + i)?.taken ? 0x33ff66 : 0xff3322));
    if (ready && this.powered && !this.open && d < 3) {
      this.open = w.elevatorOpen = true;
      this.audio?.elevator();
      w.cab.open();
    }
    if (!(ready && this.powered) && d < 1.3 && t > this.rejectAt) {
      this.rejectAt = t + 1.5;
      this.audio?.reject();
    }
    // dentro de la cabina, se cierra la grabación
    const cab = center(w.maze.elevator);
    if (this.open && !this.won && Math.hypot(this.player.pos.x - cab.x, this.player.pos.z - cab.z) < CELL * 0.3) {
      this.won = true;
      this.onWin?.();
    }
    // la escalera de servicio (Las Suites): arriba del todo (el rellano, a una planta de altura), con la misión hecha, se pasa de planta (en silencio y a oscuras)
    if (w.maze.stairs && !this.won && this.player.pos.y > 2.2) {
      if (ready) (this.won = true), this.onWin?.(true);
      else if (t > this.rejectAt) (this.rejectAt = t + 1.5), this.audio?.reject();
    }
  }
}
