import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AMMO_PACK, RIFLE_MAG, ITEMS } from '@backrooms/shared';
import { CELL, type Cell } from './maze';
import { fit } from './player';
import type { Player } from './player';
import { canHold, hasRoom, spotRarity, type Drop, type ItemId } from '@backrooms/shared';
import { glow, pulse } from './rarityFx';
import { perks } from './perks';
import type { Controls } from './input';
import type { GameAudio } from './audio';

/*
 * Lo recogible del suelo, una sola vez para todos los niveles (ver docs/engine-unification.md): el objeto que flota y gira con el brillo de su rareza, lo que
 * queda a tiro, el aviso en pantalla, la mano que baja a por él, el pedido al servidor (`claim`), lo que otros ya cogieron (`sync`) y lo que sueltan los
 * jugadores (`syncDrops`, con su caída). `Items` (nivel 0, Suites) le suma la cámara, el rifle y el ascensor; `PoolPickups` (Poolrooms), su propia colocación.
 */
const REACH = 1.6; // metros para recoger
export const MAG = RIFLE_MAG, TOTAL = AMMO_PACK; // el rifle: monta 2 balas a la vez y el del mapa trae un cargador de 4

/** Lo que el nivel le da: dónde colgar los objetos, paredes (para lo que cae), de qué celda es un punto y, si el mundo se repite (Las Suites), cuánto. */
export interface PickupHost {
  readonly root: THREE.Object3D;
  solid(x: number, z: number): boolean;
  cellAt(x: number, z: number): Cell;
  /** Las Suites: el mapa se repite (celdas [desde, hasta)); cada objeto tiene sus copias. */
  readonly span?: [number, number];
}

export interface Pickup {
  id: string;
  obj: THREE.Object3D;
  kind: ItemId | 'tape' | 'loot' | 'locker' | 'gen';
  taken: boolean;
  /** La altura a la que flota y el brillo de su rareza. */
  y: number;
  fx?: THREE.Object3D;
  /** Soltado por un jugador (id `d…`): al recogerlo vuelve a su inventario tal cual, sin lo que da el del mapa. */
  drop?: boolean;
  /** Pedido al servidor, sin respuesta aún. */
  pending?: boolean;
  /** Una pieza de una taquilla abierta (id `taquilla:i`): al cogerla es suya tal cual, como lo soltado, pero sin caer. */
  given?: boolean;
  /** Un objeto soltado cae con físicas (gravedad, rebotes, choca con las paredes) y se queda quieto en el suelo. */
  phys?: { v: THREE.Vector3; spin: THREE.Vector3; rest: boolean; floor: number };
}

/** Un asset compartido, o una fábrica cuyo modelo procedural pertenece a este objeto. */
export type PickupModel = [THREE.Object3D, number] | ((rarity?: number) => [THREE.Object3D, number]);

const LABEL: Record<Pickup['kind'], string> = { tape: 'tape', camera: 'camcorder', gun: 'rifle', flashlight: 'flashlight', water: 'almond water', totem: 'totem of life', radar: 'radar', ammo: 'ammo', caution: 'caution tape', tank: 'diving tank', watergun: 'water gun', loot: 'artifact', uno: 'uno reverse', monster: 'monster', pokeball: 'pokeball', grenade: 'smoke grenade', nokia: 'nokia', bat: 'baseball bat', locker: 'locker', gen: 'power switch', glasses: ITEMS.glasses.name.toLowerCase(), pills: ITEMS.pills.name.toLowerCase(), steelcard: ITEMS.steelcard.name.toLowerCase(), beer: ITEMS.beer.name.toLowerCase() };

export class PickupField {
  readonly root = new THREE.Group();
  protected pickups: Pickup[] = [];
  xrayTargets() {
    return this.pickups.filter(p => !p.taken && !p.pending && p.kind !== 'locker').map(p => p.obj);
  }
  protected player!: Player;
  /** En una sala: pedir al servidor quedarse con un objeto (el primero se lo lleva). */
  claim?: (id: string, done: (ok: boolean) => void) => void;
  /** El jugador pulsa G ante una taquilla: la abre el minijuego (game.ts / Backrooms.tsx). */
  onLocker?: (id: string) => void;
  /** Algo se ha recogido (ya es mío): el juego puede refrescar su inventario. */
  onGot?: (p: Pickup) => void;
  /** Cintas recogidas (en solitario las cuenta el campo; en una sala, el servidor). */
  tapes = 0;
  /** Taquillas que se están abriendo: la puerta gira hasta abrirse. */
  private doors = new Map<Pickup, { door: THREE.Object3D; t: number }>();
  protected swing(p: Pickup) {
    const door = p.obj.getObjectByName('door');
    if (door && !this.doors.has(p)) this.doors.set(p, { door, t: 0 });
  }
  /** Lo que se recogería con G ahora mismo (para el aviso en pantalla). */
  hint: string | null = null;
  private nearDx = 0;
  private ghosts = new Map<Pickup, THREE.Object3D[]>();
  private resources = new Map<Pickup, Set<{ dispose(): void }>>();
  protected disposed = false;

  constructor(protected host: PickupHost, protected camera: THREE.Camera, public audio?: GameAudio) {
    host.root.add(this.root);
  }

  bind(player: Player) {
    this.player = player;
  }

  // ── cómo se ve cada cosa (los niveles lo retocan) ──
  /** El modelo a su tamaño. */
  protected shape(_kind: Pickup['kind'], src: THREE.Object3D, size: number): THREE.Object3D {
    return fit(skClone(src), size); // (SkeletonUtils: el tótem lleva piel)
  }
  /** A qué altura flota (en el suelo del punto). */
  protected yOf(kind: Pickup['kind'], size: number, _c: Cell): number {
    return kind === 'locker' ? size / 2 : 0.32 + size / 4; // (la taquilla está de pie en el suelo)
  }
  /** Dónde cae lo soltado: el suelo de ese punto. */
  protected floorOf(_x: number, _z: number): number {
    return 0;
  }
  protected label(kind: Pickup['kind']) {
    return LABEL[kind];
  }
  /** Dónde queda un objeto del mapa dentro de su celda (un poco tirado, no en el centro exacto). */
  protected spot(c: Cell): { x: number; z: number } {
    return { x: (c.x + 0.5) * CELL + (Math.sin(c.x * 7.1 + c.y) * CELL) / 5, z: (c.y + 0.5) * CELL + (Math.cos(c.y * 5.3 + c.x) * CELL) / 5 };
  }

  /** Pone un objeto en el suelo (los del mapa y los soltados). */
  put(id: string, kind: Pickup['kind'], c: Cell, src: THREE.Object3D, size: number, rot = 0, at?: { x: number; z: number }, drop?: boolean, rar = spotRarity(id, c), ownSource = false) {
    if (this.disposed) return;
    const resources = new Set<{ dispose(): void }>();
    // Los modelos procedurales son nuestros; los GLTF conservan geometrías, materiales y texturas compartidos.
    if (ownSource) src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) resources.add(mesh.geometry);
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => resources.add(m));
    });
    const g = this.shape(kind, src, size);
    // que se vea con la linterna: un brillo propio leve, del color de cada material (con su textura), no un gris plano
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const clone = (mat: THREE.Material) => {
        if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
        const own = mat.clone() as THREE.MeshStandardMaterial;
        resources.add(own);
        // la lata es casi blanca: con el brillo de los demás se quema; se queda mate y casi sin brillo propio
        const gl = kind === 'water' ? 0.04 : 0.22;
        if (kind === 'water') (own.color.multiplyScalar(0.7), (own.roughness = 1), (own.metalness = 0));
        if (own.map) (own.emissiveMap = own.map), own.emissive.setScalar(gl);
        else own.emissive.copy(own.color).multiplyScalar(gl * 1.4);
        return own;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    const holder = new THREE.Group();
    holder.add(g);
    const p = at ?? this.spot(c);
    const y = this.yOf(kind, size, c); // flota a media pierna (todo levita y gira) con el brillo de su rareza
    holder.position.set(p.x, y, p.z);
    holder.rotation.set(0, rot, 0);
    const fx = kind === 'tape' || kind === 'locker' ? undefined : glow(rar); // (las cintas son de la misión: sin rareza)
    if (fx) (holder.add(fx), resources.add(fx.material));
    this.root.add(holder);
    let phys: Pickup['phys'];
    if (drop) {
      // lo soltado sale a la altura de la mano con un empujón hacia delante (el mismo para todos: sale del id), cae, rebota y se queda en el suelo
      const h = Math.sin(id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) * 43758.5453, u = h - Math.floor(h), a = u * Math.PI * 2, fl = this.floorOf(p.x, p.z);
      holder.position.y = fl + 1.1;
      phys = { v: new THREE.Vector3(Math.cos(a) * 0.9, 1.6, Math.sin(a) * 0.9), spin: new THREE.Vector3((u - 0.5) * 9, (u - 0.3) * 6, (0.5 - u) * 9), rest: false, floor: fl + 0.03 + size * 0.35 };
    }
    const pickup = { id, obj: holder, kind, taken: false, drop, y, fx, phys };
    this.pickups.push(pickup);
    this.resources.set(pickup, resources);
  }

  /** ¿Hay corriente? (todos los cuadros eléctricos del mapa activados; sin cuadros, siempre.) */
  get powered() {
    return this.pickups.every((p) => p.kind !== 'gen' || p.taken);
  }
  /** Cuadros activados y total. */
  get gens() {
    const g = this.pickups.filter((p) => p.kind === 'gen');
    return { on: g.filter((p) => p.taken).length, n: g.length };
  }

  /** Un paso de físicas de un objeto soltado: gravedad, rebote en el suelo, choque con las paredes y rozamiento hasta quedarse quieto. */
  private fall(p: Pickup, dt: number) {
    const f = p.phys!;
    if (f.rest) return;
    const o = p.obj, s = Math.min(dt, 0.05);
    f.v.y -= 9.8 * s;
    const nx = o.position.x + f.v.x * s, nz = o.position.z + f.v.z * s;
    if (this.host.solid(nx, o.position.z)) f.v.x *= -0.4;
    else o.position.x = nx;
    if (this.host.solid(o.position.x, nz)) f.v.z *= -0.4;
    else o.position.z = nz;
    o.position.y += f.v.y * s;
    o.rotation.x += f.spin.x * s;
    o.rotation.y += f.spin.y * s;
    o.rotation.z += f.spin.z * s;
    if (o.position.y <= f.floor) {
      o.position.y = f.floor;
      f.v.y *= -0.38; // rebota
      f.v.x *= 0.7;
      f.v.z *= 0.7;
      f.spin.multiplyScalar(0.55);
      if (Math.abs(f.v.y) < 0.5 && Math.hypot(f.v.x, f.v.z) < 0.25) {
        f.rest = true; // quieto: tumbado en el suelo
        o.rotation.x = o.rotation.z = 0;
      }
    }
  }

  /** ¿Hay algo para coger a menos de 2 m de mis ojos, mire a donde mire? (entonces G no es para hablar con nadie) */
  close() {
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    return this.pickups.some((p) => !p.taken && !p.pending && p.obj.position.distanceTo(eye) < 2);
  }
  /** Lo recogible más cerca y de frente, a menos de REACH. */
  private nearest() {
    const eye = this.camera.getWorldPosition(new THREE.Vector3()), fwd = this.camera.getWorldDirection(new THREE.Vector3());
    let best: Pickup | undefined, bd = Infinity;
    const span = this.host.span, sw = span ? (span[1] - span[0]) * CELL : 0; // (Las Suites: en las otras copias del pasillo se ven sus copias, y se cogen igual)
    this.nearDx = 0;
    for (const p of this.pickups) {
      if (p.taken || p.pending) continue;
      // lo que no cabe ni se ofrece (el servidor lo rechazaría): el tope de cada cosa y el sitio de la mochila
      const inv = { ...this.player.inventory, loot: perks.loot };
      if (p.kind === 'loot' ? !hasRoom(inv, perks.stats, 'loot') : p.kind !== 'tape' && p.kind !== 'locker' && p.kind !== 'gen' && !canHold(inv, p.kind, perks.stats)) continue;
      for (const dx of sw ? [0, -sw, sw] : [0]) {
        const to = p.obj.position.clone().sub(eye), d0 = to.x;
        to.x = d0 + dx;
        const d = to.length();
        if (d > REACH + 1.62 * 0.5 || to.normalize().dot(fwd) < 0.5) continue;
        if (d < bd) (bd = d), (best = p), (this.nearDx = dx);
      }
    }
    return best;
  }

  /** Las Suites: el pasillo se repite (cada 24 m el mapa es el mismo), así que cada objeto tiene sus copias a un lado y a otro, que lo imitan (y se van con él al cogerlo). */
  private ghostsSync() {
    const span = this.host.span;
    if (!span) return;
    const w = (span[1] - span[0]) * CELL, live = new Set(this.pickups);
    for (const [p, gs] of this.ghosts) if (!live.has(p)) (gs.forEach((g) => g.removeFromParent()), this.ghosts.delete(p));
    for (const p of this.pickups) {
      let gs = this.ghosts.get(p);
      if (!gs) this.ghosts.set(p, (gs = [0, 1].map(() => p.obj.clone(true))));
      gs.forEach((g, i) => {
        if (!g.parent) this.root.add(g);
        g.visible = p.obj.visible && !p.taken;
        g.position.copy(p.obj.position).x += (i ? 1 : -1) * w;
        g.rotation.copy(p.obj.rotation);
      });
    }
  }

  /** Cada fotograma: flotan y giran, el aviso de lo que hay a tiro y, con G, la mano baja a por ello. */
  tick(t: number, dt: number, c: Controls) {
    if (this.disposed) return;
    const pl = this.player;
    for (const p of this.pickups) {
      if (p.taken) continue;
      if (p.kind === 'locker' || p.kind === 'gen') continue; // (de pie, quieta)
      if (p.phys) this.fall(p, dt);
      else (p.obj.rotation.y += dt * 0.8), (p.obj.position.y = p.y + Math.sin(t * 1.6 + p.obj.position.x * 3) * 0.04);
      pulse(p.fx, t);
    }
    for (const d of this.doors.values()) {
      d.t = Math.min(1, d.t + dt * 1.6);
      d.door.rotation.y = -1.9 * d.t * d.t * (3 - 2 * d.t);
    }
    this.ghostsSync();
    const near = this.nearest();
    this.hint = near ? this.label(near.kind) : null;
    if (c.grab && near?.kind === 'locker') this.onLocker?.(near.id);
    else if (c.grab) {
      const p = near, ndx = this.nearDx;
      // la mano baja a por él; es tuyo cuando llega
      const take = (p: Pickup) => {
        const got = () => {
          if (this.disposed) return;
          p.obj.visible = false;
          this.audio?.pickup(p.fx?.userData.glow?.k ?? 0);
          if (p.kind === 'loot') return; // el botín lo lleva el servidor (llega con `bag`)
          if (p.drop || p.given) pl.receive(p.kind as ItemId); // lo soltado vuelve tal cual (y va a la barra o a la mano)
          else if (p.kind === 'tape') this.claim || this.tapes++; // en una sala, las cintas son de todos: las cuenta el servidor
          else if (p.kind === 'flashlight') pl.spares++;
          else if (p.kind === 'water') (pl.water++, pl.autoSlot('water'));
          else if (p.kind === 'totem') (pl.totem++, pl.autoSlot('totem'));
          else if (p.kind === 'radar') (pl.radar = true, pl.autoSlot('radar'));
          else if (p.kind === 'camera' || p.kind === 'gun') {
            pl.has[p.kind] = true;
            if (p.kind === 'gun') {
              // el rifle del mapa trae dos cargadores, que se suman a las balas que ya se llevaran (como cuenta el servidor)
              const tt = pl.ammo + pl.spare + TOTAL;
              (pl.ammo = Math.min(MAG, tt)), (pl.spare = tt - pl.ammo);
            }
            pl.stow(p.kind);
            pl.autoSlot(p.kind);
          } else if (p.kind !== 'gen' && p.kind !== 'locker') pl.receive(p.kind as ItemId); // (el tanque, la pistola de agua...)
          this.onGot?.(p);
        };
        const at = p.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(ndx, 0, 0));
        if (p.kind === 'gen') pl.onType = () => this.audio?.click(); // (un cuadro eléctrico: se teclea, y se enciende al acabar)
        if (p.kind === 'gen' ? pl.typing(at, got) : pl.reach(at, got)) p.taken = true;
        else if (this.claim) (p.taken = true), got(); // el servidor ya se lo ha dado: sin gesto
      };
      if (p && this.claim) {
        p.pending = true;
        this.claim(p.id, (ok) => {
          if (this.disposed) return;
          p.pending = false;
          // si no: lo ha cogido otro (el aviso del servidor, `sync`/`syncDrops`, lo quita) o no cabe / no llegas: sigue ahí, sin esconderlo por si acaso
          if (ok) take(p);
        });
      } else if (p) take(p);
    }
  }

  /** Lo que dice el servidor: lo recogido por otros desaparece y las cintas son las de todos. */
  sync(taken: string[], tapes: number) {
    this.tapes = tapes;
    const gone = new Set(taken);
    for (const p of this.pickups)
      if (!p.taken && gone.has(p.id)) (p.taken = true), (p.obj.visible = false);
  }

  /**
   * Los objetos soltados que hay ahora en el suelo (lista del servidor): los nuevos se ponen con su modelo (`models`: tipo → [modelo, tamaño]), los que
   * ya no están se quitan (los recogió alguien o caducaron).
   */
  syncDrops(list: Drop[], models: Partial<Record<ItemId | 'loot', PickupModel>>) {
    if (this.disposed) return;
    const here = new Set(list.map((d) => d.id));
    for (const p of this.pickups)
      if (p.drop && !here.has(p.id)) this.remove(p);
    this.pickups = this.pickups.filter((p) => !(p.drop && !here.has(p.id)));
    for (const d of list) {
      if (this.pickups.some((p) => p.id === d.id) || !models[d.kind]) continue;
      const model = models[d.kind]!, own = typeof model === 'function';
      const [src, size] = own ? model(d.q?.r) : model;
      this.put(d.id, d.kind as Pickup['kind'], this.host.cellAt(d.x, d.z), src, size, (d.x * 3.1 + d.z) % 6.28, { x: d.x, z: d.z }, true, d.q?.r ?? 0, own);
    }
  }

  private remove(p: Pickup) {
    p.taken = true;
    p.obj.removeFromParent();
    this.ghosts.get(p)?.forEach((g) => g.removeFromParent());
    this.ghosts.delete(p);
    this.doors.delete(p);
    this.resources.get(p)?.forEach((resource) => resource.dispose());
    this.resources.delete(p);
  }

  /** Libera solo las copias y los modelos propios, conservando los assets compartidos. */
  dispose() {
    this.disposed = true;
    for (const p of this.pickups) this.remove(p);
    this.pickups = [];
    this.root.removeFromParent();
  }
}
