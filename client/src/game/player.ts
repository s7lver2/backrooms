import { EYE, WALK, RUN, JUMP, G } from './locomotion';
import { WaterJet, type JetProbe } from './waterjet';
import * as THREE from 'three';
import type { Controls } from './input';
import type { World } from './world';
import { FLASH } from './lightmap';
import type { Assets } from './game';
import { settings } from '../settings';
import { AMMO_PACK, HP_MAX, MONSTER, WATER_HEAL, addItem, hasItem, removeItem, type Inventory, type ItemId, type Look } from '@backrooms/shared';
import { Rig } from './rig';
import { Cosmetics } from './cosmetics';
import { build } from './anim/core';
import { HOT, HOT_SLOTS } from './quickslots';
import { perks } from './perks';
import { boostOf } from '@backrooms/shared';
import { solveArm, solveTwoBone, poseFingers } from './ik';
import { grips, type Hand, type View } from './grips';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadPoolKit, poolPart, tankFx } from './poolmap';
import { itemModel } from './itemModels';

/*
 * El jugador: el hazmat en primera persona. La cámara va a la altura de los ojos y el cuerpo debajo,
 * un poco atrás, sin cabeza (se encoge el hueso): al mirar abajo se ven el pecho, las piernas y las
 * botas. Los brazos los pone el IK encima de la animación: cada mano va a su punto de agarre. La
 * izquierda lleva la linterna; con la pistola (o mirando por la cámara) van las dos al objeto, y la
 * linterna queda montada (su luz sigue saliendo de la vista).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const D = Math.PI / 180;
const wrap = (a: number) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;

export { EYE, WALK, RUN, JUMP };
const _rest = new THREE.Vector3(), _eye = new THREE.Vector3();
/** Dónde va la linterna montada en el rifle (espacio del rifle: metros y grados). */
const MOUNT = { pos: [0, -0.05, -0.12] as [number, number, number], rot: [0, 0, 0] as [number, number, number] };
const _hl = new THREE.Vector3(), _hd = new THREE.Vector3(), _hq = new THREE.Quaternion();
// la linterna se atenúa con la distancia a lo que ilumina: por debajo de FLASH_D0 la intensidad baja con d^decay (la luz recibida se queda
// como a FLASH_D0 y no ciega contra el suelo o una pared cercana); más lejos, alcance completo
const FLICKER_MAX = 0.2; // probabilidad máxima de que la linterna parpadee al encenderla (con la pila casi a cero)
const FLASH_D0 = 4, FLASH_DECAY = 1.2, _fo = new THREE.Vector3(), _ft = new THREE.Vector3(), _v0 = new THREE.Vector3();
const REACH_T = 0.85; // lo que dura recoger algo, en segundos
const DRINK_T = 1.5; // lo que se mantiene la lata para beberla (s)
/** Balance: enfocar con la camcorder (mirar por el visor) frena un 8 %. */
export const CAM_AIM_SLOW = 0.92;
const UNO_T = 1.2; // s manteniendo la carta
const R = 0.3;

/** Un modelo escalado para que su lado mayor mida `size`, centrado en el origen y girado `ry`. */
export function fit(o: THREE.Object3D, size: number, ry = 0) {
  const box = new THREE.Box3().setFromObject(o), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = size / Math.max(s.x, s.y, s.z);
  const g = new THREE.Group();
  o.position.sub(c);
  g.add(o);
  g.scale.setScalar(k);
  g.rotation.y = ry;
  return g;
}

/** Lo que se lleva encima y dónde va: la derecha y el cinturón, camcorder o rifle; la izquierda, la linterna. */
export type Gear = 'flashlight' | 'camera' | 'gun';
export type Slot = 'left' | 'right' | 'belt';
export const FITS: Record<Slot, Gear[]> = { left: ['flashlight'], right: ['camera', 'gun'], belt: ['camera', 'gun'] };

export class Player {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hand: 'none' | 'camera' | 'gun' | 'watergun' = 'none';
  /** Lo que se lleva en la mano sin ser camcorder ni rifle (cinta de acordonar, radar); con uno de ellos la mano derecha queda libre. */
  gadget: 'none' | 'caution' | 'radar' | 'totem' = 'none';
  /** Un objeto suelto en la mano derecha, sin función de juego (lo usa Anim Studio para colocar su agarre). */
  prop: 'none' | 'water' | 'monster' | 'uno' | 'soap' | 'tape' | 'ammo' = 'none';
  left: 'none' | 'flashlight' = 'none'; // la linterna es una del inventario (inv.spares): la mano la lleva si se equipa (y la primera que se tiene se equipa sola)
  belt: 'none' | 'camera' | 'gun' = 'none';
  readonly has = { camera: false, gun: false };
  /** Lleva el radar (un solo ejemplar por mapa: se lo queda quien lo coja). */
  radar = false;
  /** Tiene cinta de acordonar (se tiene o no; se usa sin gastarse). En una sala la da la tienda o el suelo; solo, se empieza con ella. */
  caution = true;
  /** Correr lo gasta y a cero no se corre hasta recuperar un cuarto; la cordura la lleva game.ts. */
  stamina = 1;
  sanity = 1;
  /** Vida (0–100), sin regeneración: solo la devuelve una lata de Almond Water. En una sala la manda el servidor. */
  hp = perks.stats.hp;
  winded = false;
  ammo = 0; // en el cargador
  spare = 0; // de reserva
  flashOn = true;
  /** Lo que le queda a la linterna (0–1) y las de repuesto en la mochila. */
  charge = 1;
  /** Segundos de luz que da una linterna (la dificultad de la sala lo cambia). */
  life = 54; // s de linterna (por defecto; la sala manda el de su dificultad)
  /** Segundos que le quedan al parpadeo de encendido (la luz titubea en vez de encenderse del todo). */
  private flickerT = 0;
  spares = 0;
  /** Latas de Almond Water y la barra de acceso rápido (ver quickslots.ts): el objeto de cada ranura y la elegida. */
  water = 0;
  /** Tótems de la vida que lleva (ver totem en shared y runlevel.ts). */
  totem = 0;
  readonly hot: (string | null)[] = ['caution', ...Array<null>(HOT_SLOTS - 1).fill(null)]; // la linterna va en la mano secundaria, no en la barra
  hotSel = 0;
  /** Pistola de agua (nivel 0): lo que queda en el depósito (0–1; aquí no hay donde rellenarlo), mojado/parado por la de otro, y el aviso del chorro (x, z, yaw). */
  squirt = 1;
  private wetT = 0;
  private stunT = 0;
  private tankLvl?: (k: number) => void;
  private jetT = 0;
  jetting = false;
  /** La barra de las Poolrooms la lleva PoolLevel: allí esta pistola no se saca. */
  poolMode = false;
  /** Poolrooms: lo que PoolLevel dice del cuerpo este fotograma (velocidad real, en el aire, velocidad vertical). */
  /**
   * Un mundo con su propio movimiento (las Poolrooms: agua, tubos, plantas): el Player le pide que mueva el cuerpo y se queda con lo que devuelve; la cámara,
   * los pasos y las manos siguen siendo suyos. Sin él, el Player mueve el cuerpo por la rejilla del nivel (World).
   */
  terrain?: {
    drive(dt: number, c: Controls, yaw: number, pitch: number): { x: number; y: number; z: number; yaw: number; pitch: number; speed: number; air: boolean; vy: number; swim: boolean; eye: number; jetOk: boolean };
    /** Dónde está el suelo (o el agua) y las paredes, para las gotas de la pistola de agua. */
    jetProbe: JetProbe;
    splash(x: number, z: number, amp: number): void;
    /** ¿Hay un bebedero para recargar aquí? */
    refillNear(x: number, y: number, z: number): boolean;
  };
  private eyeBase = EYE;
  private swimNow = false;
  /** Cuánto baja la vista el agachado ahora (m): quien le da la altura de la cámara lo suma para no bajarla dos veces. */
  get duckLift() {
    return this.duckD * this.duckK;
  }
  /** La bombona de buceo puesta en la espalda (si se tiene): se puede guardar en la mochila. */
  tankOn = true;
  get tankWorn() {
    return this.poolGear.tank && this.tankOn && perks.stats.back;
  }
  onSquirt?: (x: number, z: number, yaw: number) => void;
  private readonly jet = new WaterJet();
  private jetOk = true;
  private fillT = 0;
  /** Recargando la pistola en un bebedero, y el aviso de «mantén para recargar». */
  refilling = false;
  refillAct: string | null = null;
  /** Echando agua ahora mismo (para el sonido). */
  get spraying() {
    return this.jetting && this.jetOk && this.squirt > 0;
  }
  /** Cuánto lleva recargado (0–1). */
  get fill() {
    return this.refilling ? Math.min(1, this.fillT / 1.5) : 0;
  }
  /** Se bebió una lata (sonido). */
  onDrink?: () => void;
  private lens?: THREE.MeshStandardMaterial;
  // recoger: la vista se agacha hacia el objeto y la mano derecha baja a por él (0 → REACH_T)
  private reachAt?: THREE.Vector3;
  private reachT = 0;
  private reachCb?: () => void;
  /** Mirando por la camcorder (clic derecho). */
  aiming = false;
  /** Mirando por la mira del rifle (ver update). */
  scoped = false;
  /** El zoom de la camcorder, 1×–4×. */
  zoom = 1;
  private aimK = 0; // 0 → 1 mientras se sube la cámara al ojo
  onFall?: () => void;
  readonly rig: Rig;
  /** Lo que va en las manos, pegado a la cámara: la linterna a la izquierda y la cámara o la pistola a la derecha. */
  readonly items = { flashlight: new THREE.Group(), camera: new THREE.Group(), gun: new THREE.Group(), caution: new THREE.Group(), radar: new THREE.Group(), totem: new THREE.Group(), watergun: new THREE.Group(), water: new THREE.Group(), monster: new THREE.Group(), uno: new THREE.Group(), soap: new THREE.Group(), tape: new THREE.Group(), ammo: new THREE.Group() };
  speed = 0;
  /** Agachado (C o Ctrl): ojos más bajos, mitad de velocidad, sin correr; las entidades te ven de menos lejos. `duckK` es la transición (0–1). */
  duck = false;
  private duckK = 0;
  /** Consola de admin: velocidad x2 y atravesar paredes. */
  speedMul = 1;
  jumpMul = 1;
  noclip = false;
  private velY = 0;
  private ground = true;
  private falling = false;
  private fell = false;
  private bob = 0;
  private duckD = 0.6;
  /** Segundos que lleva pulsado el botón de beber (la lata se bebe al mantener 0,5 s). */
  private drinkT = 0;
  /** Monster: latas, segundos bebiendo la actual, segundos que le quedan al efecto, y la carta Uno Reverse. */
  monster = 0;
  private monsterT = 0;
  private unoT = 0;
  buffT = 0;
  uno = false;
  onMonster?: () => void;
  onUno?: (done: (ok: boolean) => void) => void;
  /** La barra de aguante es un arcoíris mientras dura el efecto de la Monster (no mientras se bebe: hasta acabar de beber no hace nada). */
  get rainbow() {
    return this.buffT > 0;
  }
  /** Lo que acelera el efecto de la Monster (1 sin él). */
  get buffSpeed() {
    return this.buffT > 0 ? MONSTER.speed : 1;
  }
  /** Lo que lleva bebido de la Monster (0–1). */
  get drinkingMonster() {
    return this.monsterT > 0 ? Math.min(1, this.monsterT / MONSTER.drink) : 0;
  }
  /** Lo que lleva jugada la carta Uno Reverse (0–1). */
  get drinkingUno() {
    return this.unoT > 0 ? Math.min(1, this.unoT / UNO_T) : 0;
  }
  private drankAt = -1e9;
  /** En la sala de espera no se bebe (el servidor solo da vida en una ronda). */
  drinkOff = false;
  private busy = 0; // segundos de una animación de una vez (recoger, recargar)
  private recoil = 0;
  /** El jugador ya no manda (muerto, en el ascensor): solo se pinta. */
  frozen = false;
  /** En la tienda del Faceling: sin manos ni objetos a la vista. */
  away = false;
  /** Con `frozen`: sí se puede mirar alrededor (dentro del ascensor en marcha). */
  lookFree = false;
  /** Le ha pillado una entidad: el cuerpo cae (y la cámara ya no es suya: la lleva game.ts). */
  dead = false;
  private deadT = 0;
  private bones: Record<string, THREE.Bone | undefined>;
  private torso: { b: THREE.Bone; q: THREE.Quaternion; p?: THREE.Vector3 }[] = [];
  /**
   * Escondite en un nicho de la pared: fuera, entrando (0,4 s), dentro, o saliendo. Dentro, la vista se agacha y se
   * acerca al fondo, no se camina, la mirada se limita a ±70° de la salida, la linterna se apaga y las manos bajan.
   */
  hideState: 'out' | 'in' | 'hidden' | 'leaving' = 'out';
  private hideK = 0;
  private hideFrom = new THREE.Vector3();
  private hideTo = new THREE.Vector3();
  private hideYaw = 0;
  private hideYaw0 = 0;
  private flashWas = false;
  /** Distancia suavizada de la linterna a lo que ilumina (m). */
  private flashD = 12;

  constructor(private world: World, assets: Assets, private camera: THREE.PerspectiveCamera, private flash: THREE.SpotLight, private reduced: boolean) {
    this.rig = new Rig(assets.gltf.hazmat);
    const An = this.rig.useAnimator(); // el cuerpo lo lleva el Animator (anim/); sin el paquete de animaciones, los clips del modelo
    if (An) {
      // los brazos a sus agarres van por la pila de IK del Animator: con peso que sube y baja (sin saltos al coger o soltar) y sobre la animación
      An.deferIk = true;
      for (const s of ['Left', 'Right'] as const) An.ik.goals.push({ chain: `${s}Arm`, weight: 1, rate: 16, target: () => this.gripT[s], pole: () => this.gripT[s]?.pole ?? null });
    }
    world.root.add(this.rig.root);
    this.cos = new Cosmetics(this.rig.root);
    world.root.add(this.cos.root);
    this.bones = Object.fromEntries(['Head', 'Neck', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1'].map((n) => [n, this.rig.bone(n)]));
    // los objetos de la mano, a escala de mano y apuntando al frente (-z): el rifle y la linterna
    // miran a +z en su modelo; la cámara, a +x
    this.items.flashlight.add(fit(assets.gltf.flashlight.scene.clone(true), 0.26, Math.PI));
    this.items.flashlight.getObjectByName('Circle_6')?.removeFromParent(); // la tira de la muñeca
    // la lente: su emisiva va con la linterna (encendida o no); un material propio, que es la única
    this.items.flashlight.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).emissive?.getHex()) this.lens = m.material = (m.material as THREE.MeshStandardMaterial).clone();
    });
    this.items.camera.add(fit(assets.gltf.camcorder.scene.clone(true), 0.2, Math.PI / 2));
    this.items.gun.add(fit(assets.gltf.gun.scene.clone(true), 0.72, Math.PI));
    // lo de la barra rápida: el rollo de cinta americana, el radar (la radio de re1monsen) y el tótem; mismos agarres que lo demás
    this.items.caution.add(fit(assets.gltf.duct.scene.clone(true), 0.11));
    this.items.radar.add(fit(assets.gltf.radar.scene.clone(true), 0.16));
    this.items.totem.add(fit(skClone(assets.gltf.totem.scene), 0.2));
    // otros objetos que se llevan en la mano (la lata de Almond Water, la cinta VHS, la caja de balas; el jabón viene con el kit de las Poolrooms): hoy solo los usa Anim Studio para colocar los agarres
    if (assets.gltf.water) this.items.water.add(fit(assets.gltf.water.scene.clone(true), 0.17));
    if (assets.gltf.vhs) this.items.tape.add(fit(assets.gltf.vhs.scene.clone(true), 0.19));
    this.items.ammo.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.5, metalness: 0.5 })));
    this.placeItems(0);
    for (const it of Object.values(this.items)) camera.add(it);
    for (const k of ['camera', 'gun', 'caution', 'radar', 'totem', 'watergun', 'water', 'monster', 'uno', 'soap', 'tape', 'ammo'] as const) this.items[k].visible = false;
    // la pose de referencia: el primer fotograma de Neutral Idle. Con algo en las manos el torso y los dos brazos (hombros, brazos, manos y dedos)
    // vuelven a ella cada fotograma, después del mezclador: los hombros no se mueven con el paso, y el IK parte siempre del mismo sitio y no
    // hereda el giro del antebrazo del clip (que daba un salto en cada vuelta del ciclo de andar o correr)
    this.rig.update(0);
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2']) this.keepPose(this.rig.bone(n), n === 'Hips');
    for (const n of ['LeftShoulder', 'RightShoulder']) this.rig.bone(n)?.traverse((o) => this.keepPose(o as THREE.Bone, false));
  }

  private keepPose(b: THREE.Bone | undefined, pos: boolean) {
    if (b) this.torso.push({ b, q: b.quaternion.clone(), p: pos ? b.position.clone() : undefined });
  }

  /** Cada objeto en su sitio respecto a la vista (grips.json); la camcorder, de su sitio en reposo al ojo según `k` (0–1). */
  private swayK = 0;
  /** Dónde llevar cada muñeca este fotograma (null = suelta). */
  private gripT: Record<'Left' | 'Right', { pos: THREE.Vector3; quat: THREE.Quaternion; pole: THREE.Vector3 } | null> = { Left: null, Right: null };
  /** Qué muñeca agarra qué objeto este fotograma y dónde debía quedar (mundo): para que el objeto vaya con la mano si el brazo no llega. */
  private gripList: { side: 'Left' | 'Right'; item: THREE.Object3D; at: THREE.Vector3 }[] = [];
  private placeItems(k: number) {
    const put = (it: THREE.Object3D, v: View, pos: THREE.Vector3) => (it.position.copy(pos), it.rotation.set(v.rot[0] * D, v.rot[1] * D, v.rot[2] * D));
    put(this.items.flashlight, grips.flashlight.view, _rest.fromArray(grips.flashlight.view.pos));
    const gv = grips.gun.view;
    put(this.items.gun, gv, _rest.fromArray(gv.pos).lerp(_eye.fromArray(gv.aim ?? gv.pos), k));
    // con el rifle las dos manos van en él: la linterna va montada bajo el cañón y se mueve con el arma
    if (this.hand === 'gun') {
      const g = this.items.gun, f = this.items.flashlight;
      f.position.copy(g.position).add(_hd.set(...MOUNT.pos).applyEuler(g.rotation));
      f.rotation.copy(g.rotation);
      f.rotateX(MOUNT.rot[0] * D), f.rotateY(MOUNT.rot[1] * D), f.rotateZ(MOUNT.rot[2] * D);
    }
    for (const k of ['caution', 'radar', 'totem', 'water', 'soap', 'tape', 'ammo'] as const) put(this.items[k], grips[k].view, _rest.fromArray(grips[k].view.pos));
    const wv = grips.watergun.view;
    put(this.items.watergun, wv, _rest.fromArray(wv.pos).lerp(_eye.fromArray(wv.aim ?? wv.pos), k));
    const cv = grips.camera.view;
    put(this.items.camera, cv, _rest.fromArray(cv.pos).lerp(_eye.fromArray(cv.aim ?? cv.pos), k));
  }

  spawn(at: THREE.Vector3, yaw: number) {
    this.pos.copy(at).setY(0);
    this.yaw = yaw;
    this.pitch = 0;
    this.velY = 0;
    this.ground = true;
    this.falling = this.fell = false;
  }

  private blocked(x: number, z: number) {
    const w = this.world;
    return w.solid(x - R, z - R) || w.solid(x + R, z - R) || w.solid(x - R, z + R) || w.solid(x + R, z + R) || w.furniture(x, z, R);
  }

  update(dt: number, c: Controls) {
    if (this.dead) {
      // lo que la mano iba a coger (y el servidor ya dio) se entrega igualmente: si no, se pierde del inventario
      if (this.reachCb) (this.reachCb(), (this.reachCb = undefined));
      this.reachAt = undefined;
      return this.fall(dt);
    }
    if (this.frozen) c = { ...c, move: new THREE.Vector2(), look: this.lookFree ? c.look : new THREE.Vector2(), jump: false, flash: false, swap: false, slot: -1, wheel: 0, use: false, aim: false };
    const hs = this.hideState;
    if (hs !== 'out') c = { ...c, move: new THREE.Vector2(), jump: false, flash: false, swap: false, aim: false, run: false };
    // mirar por la cámara: se sube al ojo, la vista se cierra y, ya arriba, se mira a través (el modelo se esconde)
    const want = c.aim && (this.hand === 'camera' || this.hand === 'gun' || this.hand === 'watergun');
    this.aimK = THREE.MathUtils.clamp(this.aimK + (want ? dt : -dt) * 6, 0, 1);
    this.aiming = this.aimK > 0.85 && this.hand === 'camera'; // (rifle y pistola de agua solo acercan el arma al ojo)
    // el rifle apuntado es una mira de verdad: la vista se cierra (zoom 1–2,5 con la rueda), el arma y los brazos no se ven y el HUD pone la retícula
    this.scoped = this.aimK > 0.85 && this.hand === 'gun';
    // camcorder: empieza en 1× (la vista de siempre) y la rueda sube hasta 4×; el rifle sí arranca cerrado (1,8×, entre 1,5× y 3×)
    this.zoom = this.aiming || this.scoped ? THREE.MathUtils.clamp((this.zoom < (this.scoped ? 1.5 : 1) ? (this.scoped ? 1.8 : 1) : this.zoom) + c.zoom * 0.5, this.scoped ? 1.5 : 1, this.scoped ? 3 : 4) : 1;
    const k = this.aimK * this.aimK * (3 - 2 * this.aimK);
    this.placeItems(k);
    this.items.camera.visible = this.hand === 'camera' && !this.aiming;
    this.items.gun.visible = this.hand === 'gun' && !this.scoped;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(settings.fov / 2)) / THREE.MathUtils.lerp(1, this.zoom * (this.scoped ? 1.25 : 1), k)));
    if (Math.abs(fov - this.camera.fov) > 0.01) (this.camera.fov = fov), this.camera.updateProjectionMatrix();
    this.yaw -= c.look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - c.look.y, -1.45, 1.45);
    if (hs === 'hidden') {
      // dentro, mirando hacia la salida: ±70° de lado y poco arriba o abajo
      this.yaw = this.hideYaw + THREE.MathUtils.clamp(wrap(this.yaw - this.hideYaw), -70 * D, 70 * D);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.7, 0.7);
    }
    if (this.flickerT > 0) this.flickerT = Math.max(0, this.flickerT - dt);
    if (c.flash) this.toggleLight();
    if (this.lightOn) {
      this.charge = Math.max(0, this.charge - dt / (this.life * boostOf(perks, 'flashlight'))); // (la rareza de las linternas de repuesto que se llevan alarga la batería)
      if (this.charge === 0) this.flashOn = false;
    }
    if (c.swap) this.swap();
    const slots = perks.stats.hot; // las ranuras de la barra que dan las mejoras (0: sin barra)
    if (c.slot >= 0 && c.slot < slots) (this.hotSel = c.slot), this.useHot(c.slot);
    if (c.wheel && slots) this.pickHot((Math.min(this.hotSel, slots - 1) + Math.sign(c.wheel) + slots) % slots);
    if (c.use && slots) this.useHot(this.hotSel);
    // la lata en la mano: mantener su tecla (o X, o el clic) medio segundo para beberla; soltar y volver a mantener para otra
    const wi = this.hot.indexOf('water');
    const held = !this.drinkOff && this.prop === 'water' && this.water > 0 && ((wi >= 0 && c.slotHeld === wi) || !!c.useHeld || !!c.fireHeld);
    if (held && this.drinkT >= 0) {
      this.drinkT += dt;
      if (this.drinkT >= DRINK_T) (this.drinkT = -1e9), this.drink(); // (para otra lata, soltar y volver a mantener)
    } else if (!held) this.drinkT = 0;
    // la carta Uno Reverse en la mano: se juega al mantener (como el agua lo hacía), para que no se gaste sin querer
    const ui = this.hot.indexOf('uno');
    const playing = this.prop === 'uno' && this.uno && ((ui >= 0 && c.slotHeld === ui) || !!c.useHeld || !!c.fireHeld);
    this.unoT = playing ? this.unoT + dt : 0;
    if (this.unoT >= UNO_T) (this.unoT = -1e9), this.useUno();
    // la Monster: mantener 3 s; después 5 s de velocidad y aguante sin límite
    const mi = this.hot.indexOf('monster');
    const sip = !this.drinkOff && this.prop === 'monster' && this.monster > 0 && this.buffT <= 0 && ((mi >= 0 && c.slotHeld === mi) || !!c.useHeld || !!c.fireHeld);
    this.monsterT = sip ? this.monsterT + dt : 0;
    if (this.monsterT >= MONSTER.drink) {
      this.monsterT = 0;
      this.monster--;
      this.buffT = MONSTER.time * boostOf(perks, 'monster');
      if (this.monster <= 0) this.prop = 'none';
      this.onMonster?.();
    }
    if (this.buffT > 0) this.buffT = Math.max(0, this.buffT - dt);
    this.wetT = Math.max(0, this.wetT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.spray(dt, c);

    // andar: hacia donde se mira, chocando eje a eje con las paredes
    // agacharse: no con la linterna de pie en un nicho ni en el aire; al soltar, vuelve a levantarse
    this.duck = !!c.crouch && !c.run && hs === 'out' && this.ground && !this.swimNow; // (nadando, Ctrl es bajar, no agacharse) // (correr, Shift, manda: Ctrl+Shift = sprint)
    this.duckK += ((this.duck ? 1 : 0) - this.duckK) * Math.min(1, dt * 10);
    const moving = c.move.length() > 0.05, run = c.run && moving && !this.winded && !this.duck;
    // ~9 s corriendo; se recupera en ~6 s andando y ~4 s parado; agotado, no se corre hasta el 30 %
    if (this.buffT > 0) (this.stamina = 1), (this.winded = false);
    else this.stamina = THREE.MathUtils.clamp(this.stamina + dt * (run ? -1 / (11 * perks.stats.stamina) : moving ? 1 / 6 : 1 / 4), 0, 1);
    if (this.stamina <= 0) this.winded = true;
    else if (this.stamina > 0.3) this.winded = false;
    let speed = moving ? (run ? RUN : WALK) * Math.min(1, c.move.length()) * this.speedMul * this.buffSpeed * perks.stats.speed * (this.duck ? 0.5 : 1) * (this.stunT > 0 ? 0 : this.wetT > 0 ? 0.5 : 1) * (this.aiming ? CAM_AIM_SLOW : 1) : 0;
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const v = f.multiplyScalar(c.move.y).add(r.multiplyScalar(c.move.x));
    if (v.lengthSq() > 0) v.normalize().multiplyScalar(speed * dt);
    // el borde de un pozo es un muro mientras se pisa suelo (se desliza por él, como por las paredes): sin ese colisionador, una pasarela de 0,75 m
    // se pierde con cualquier giro de ratón. Ya no se cae saltando (saltar y agacharse sin parar acababa en el pozo); quien ya está dentro del borde no se frena. Los mundos falsos no tienen pitAt.
    const edge = (x: number, z: number) => !this.falling && !!this.world.pitAt?.(x, z) && !this.world.pitAt(this.pos.x, this.pos.z);
    let tb: ReturnType<NonNullable<Player['terrain']>['drive']> | undefined;
    if (this.poolMode && this.terrain) {
      // Poolrooms: el mundo mueve el cuerpo (con las constantes de locomotion.ts) y el Player toma el resultado
      tb = this.terrain.drive(dt, c, this.yaw, this.pitch);
      this.pos.set(tb.x, tb.y, tb.z);
      (this.yaw = tb.yaw), (this.pitch = tb.pitch); // (el tubo gira el cuerpo y el pozo da la vuelta a la mirada: lo decide el mundo)
      this.swimNow = tb.swim;
      speed = tb.swim ? 0 : tb.speed; // (la velocidad real, para que el Animator case los pasos)
      this.eyeBase = tb.eye;
      this.jetOk = tb.jetOk;
    } else {
      if (this.noclip || !(this.blocked(this.pos.x + v.x, this.pos.z) || edge(this.pos.x + v.x, this.pos.z))) this.pos.x += v.x;
      if (this.noclip || !(this.blocked(this.pos.x, this.pos.z + v.z) || edge(this.pos.x, this.pos.z + v.z))) this.pos.z += v.z;
    }
    this.speed = speed;

    // saltar y caer: sobre un hueco no hay suelo
    if (tb) (this.velY = tb.vy), (this.ground = !tb.air), (this.falling = false); // (en las Poolrooms la altura la pone PoolLevel: aquí no hay suelo en 0, y la gravedad hacía temblar el cuerpo en el agua)
    else {
      if (c.jump && this.ground && !this.falling) (this.velY = JUMP * this.jumpMul), (this.ground = false);
      const floor = this.falling || this.world.voidAt(this.pos.x, this.pos.z) ? -Infinity : (this.world.floorAt?.(this.pos.x, this.pos.z) ?? 0); // (los mundos falsos no tienen escaleras)
      this.velY -= G * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= floor) (this.pos.y = floor), (this.velY = 0), (this.ground = true);
      else if (this.pos.y < -0.2) this.falling = true;
      if (this.pos.y < -3 && !this.fell) (this.fell = true), this.onFall?.();
    }

    // el escondite: de la boca al fondo (o al revés) en 0,4 s, y la vista se agacha (hk: 0 de pie, 1 dentro)
    let hk = hs === 'hidden' ? 1 : 0;
    if (hs === 'in' || hs === 'leaving') {
      this.hideK = Math.min(1, this.hideK + dt / 0.4);
      const e = this.hideK * this.hideK * (3 - 2 * this.hideK);
      this.pos.lerpVectors(this.hideFrom, this.hideTo, e);
      this.pos.y = 0;
      this.velY = 0;
      if (hs === 'in') this.yaw = this.hideYaw + this.hideYaw0 * (1 - e); // se da la vuelta: de cara a la salida
      hk = hs === 'in' ? e : 1 - e;
      if (this.hideK >= 1) {
        this.hideState = hs === 'in' ? 'hidden' : 'out';
        if (hs === 'leaving') this.flashOn = this.flashWas && this.charge > 0;
      }
    }
    // recoger: sube y baja en REACH_T; a mitad, la mano llega y el objeto es suyo
    let rk = 0;
    if (this.reachAt) {
      this.reachT += dt;
      if (this.reachT >= REACH_T / 2 && this.reachCb) this.reachCb(), (this.reachCb = undefined);
      if (this.reachT >= REACH_T) this.reachAt = undefined;
      else rk = Math.sin((Math.PI * this.reachT) / REACH_T);
    }
    // el cuerpo: detrás de los ojos, mirando hacia donde se mira (los de Mixamo miran a +z); al mirar
    // abajo se retrasa (y el ojo se adelanta, sobre el cuello), que no se vea por dentro
    const down = Math.max(0, -this.pitch) / 1.45;
    const body = this.rig.root, back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.16 + 0.2 * down);
    body.position.copy(this.pos).add(back);
    body.position.y -= 0.45 * rk + 0.9 * hk;
    body.rotation.y = this.yaw + Math.PI;
    body.visible = hk < 0.3;
    // el vaivén de una cámara de mano al andar (el cuerpo lo sigue en vertical: los hombros, y con ellos los brazos, no se mueven respecto a la vista)
    this.bob += dt * (speed > 2 ? 11 : 7) * (speed > 0 ? 1 : 0);
    const amp = this.reduced || this.poolMode || !this.ground ? 0 : speed > 2 ? 0.045 : speed > 0 ? 0.025 : 0;
    const bobY = Math.sin(this.bob * 2) * amp;
    // agachado: con el Animator la cadera ya baja con la animación (y los pies siguen en el suelo: bajar también el cuerpo los hundía); la vista baja lo mismo que ella (en reposo 0,57 m, andando 0,2), y así los hombros no se alejan de las manos
    // sin Animator (rig antiguo) el cuerpo baja casi lo que la vista
    const AN = this.rig.animator;
    this.duckD += ((AN ? THREE.MathUtils.lerp(0.57, 0.2, Math.min(1, speed / 0.8)) : 0.6) - this.duckD) * Math.min(1, dt * 6);
    body.position.y += bobY - (AN ? 0 : 0.5) * this.duckK;
    this.busy -= dt;
    const A = this.rig.animator, holding = this.hand !== 'none' || this.left === 'flashlight' || this.gadget !== 'none';
    if (A) {
      // los parámetros del árbol de animación; con algo en las manos, la capa «hold» fija torso y brazos (el vaivén lo pone el balanceo de más abajo)
      A.p.speed = speed;
      A.p.crouch = this.duck ? 1 : 0;
      A.p.air = this.ground ? 0 : 1;
      A.p.vy = this.velY;
      A.p.hold += ((holding ? 1 : 0) - A.p.hold) * (1 - Math.exp(-dt * 12));
    }
    this.rig.update(dt);
    // con algo en las manos el torso y los brazos se quedan quietos (ver `torso`); el vaivén lo pone el balanceo de más abajo
    body.updateMatrixWorld(true);
    this.bones.Head?.scale.setScalar(0.001);
    this.cos.update(this.pitch, false); // (mi skin: el color y la mochila; el gorro no, que está dentro de la cabeza)
    // con la cámara en el ojo, los brazos no se ven (estarían delante de la lente)
    for (const s of ['LeftArm', 'RightArm']) this.bones[s]?.scale.setScalar(this.aiming || this.scoped ? 0.001 : 1);
    this.bones.Neck?.scale.setScalar(0.5);

    // la cámara: los ojos, con el vaivén de una cámara de mano al andar
    const neck = this.poolMode ? 0 : Math.sin(down * 1.45) * 0.12; // (en las Poolrooms la cámara es de PoolLevel y no se mueve: si el Player la adelantara, los brazos irían a otro sitio que los objetos)
    // (agachado en un nicho, algo hacia el fondo: de espaldas a la salida)
    const bx = Math.sin(this.hideYaw) * 0.32 * hk, bz = Math.cos(this.hideYaw) * 0.32 * hk;
    this.camera.position.set(this.pos.x - Math.sin(this.yaw) * neck + bx, this.pos.y + this.eyeBase - 0.5 * rk - 0.82 * hk - this.duckD * this.duckK + bobY, this.pos.z - Math.cos(this.yaw) * neck + bz);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    // al recoger, la vista se va al objeto
    let pitch = this.pitch;
    if (this.reachAt) {
      const d = Math.hypot(this.reachAt.x - this.camera.position.x, this.reachAt.z - this.camera.position.z);
      pitch = THREE.MathUtils.lerp(this.pitch, Math.atan2(this.reachAt.y - this.camera.position.y, d), rk * 0.85);
    }
    this.camera.rotation.set(pitch + this.recoil * 0.06, this.yaw, Math.sin(this.bob) * amp * 0.3, 'YXZ');
    this.camera.updateMatrixWorld();
    // ese movimiento, del espacio del cuerpo al de la vista, sumado a cada objeto (y los brazos lo siguen: van a sus agarres)
    // (procedural, a la cadencia del paso, con la amplitud suavizada: sin saltos al empezar, parar ni al acabar el ciclo)
    const swayT = this.reduced || !this.ground || this.aiming ? 0 : speed > 2 ? 1 : speed > 0 ? 0.6 : 0;
    this.swayK += (swayT - this.swayK) * (1 - Math.exp(-dt * 6));
    if (this.swayK > 0.001) {
      const a = 0.014 * this.swayK;
      _hd.set(Math.cos(this.bob) * a, Math.sin(this.bob * 2) * a * 1.2, 0);
      for (const it of Object.values(this.items)) it.position.add(_hd);
    }

    // los brazos, a sus agarres: la muñeca al punto, la mano con su orientación y los dedos cerrados (ver ik.ts y grips.ts)
    const q = this.camera.quaternion;
    const grip = (side: 'Left' | 'Right', item: THREE.Object3D, h: Hand) => {
      if (this.rig.animator?.playing) return; // bailando: los brazos son de la animación
      if (!item.children.length) return; // sin modelo todavía (se carga al sacarlo): la mano no agarra el aire
      const arm = this.bones[side + 'Arm'], fore = this.bones[side + 'ForeArm'], hand = this.bones[side + 'Hand'];
      if (!arm || !fore || !hand) return;
      const pole = arm.getWorldPosition(new THREE.Vector3()).add(V(...h.pole).applyQuaternion(q));
      item.updateWorldMatrix(true, false);
      const want = item.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(h.rot[0] * D, h.rot[1] * D, h.rot[2] * D)));
      const at = item.localToWorld(V(...h.pos));
      this.gripList.push({ side, item, at: at.clone() });
      if (this.rig.animator) this.gripT[side] = { pos: at, quat: want, pole };
      else solveArm({ shoulder: this.rig.bone(side + 'Shoulder'), arm, fore, hand }, at, pole, want);
      poseFingers((n) => this.rig.bone(n), side, h.curl, h.spread);
    };
    this.gripT.Left = this.gripT.Right = null;
    this.gripList.length = 0;
    const gd = this.gadget !== 'none' ? grips[this.gadget] : undefined;
    const two = this.hand === 'gun' || (this.hand === 'camera' && this.aiming) || (this.hand === 'none' && !!gd?.left);
    const lamp = this.left === 'flashlight' && hk < 0.3;
    this.items.flashlight.visible = lamp && !(this.hand === 'camera' && this.aiming) && !this.scoped; // la linterna siempre se ve (con el rifle, montada); solo la lente de la camcorder la tapa
    if (!two && lamp && grips.flashlight.left) grip('Left', this.items.flashlight, grips.flashlight.left);
    if (this.hand !== 'none' && hk < 0.3) {
      const it = this.items[this.hand], g = grips[this.hand];
      it.visible = !rk && !(this.hand === 'camera' && this.aiming) && !this.scoped && (this.hand !== 'watergun' || it.children.length > 0); // la derecha suelta lo que lleva mientras recoge
      if (!rk && g.right) grip('Right', it, g.right);
      if (two && !rk && g.left) grip('Left', it, g.left);
    }
    for (const k of ['caution', 'radar', 'totem', 'water', 'monster', 'uno', 'soap', 'tape', 'ammo'] as const) this.items[k].visible = false;
    if (this.prop === 'soap' && !this.items.soap.children.length) {
      const m = poolPart('soap');
      if (m) this.items.soap.add(fit(m.clone(true), 0.2));
      else void loadPoolKit();
    }
    const pg = this.prop !== 'none' && this.hand === 'none' && this.gadget === 'none' && hk < 0.3 && !this.aiming ? grips[this.prop === 'monster' || this.prop === 'uno' ? 'water' : this.prop] : undefined;
    if (pg) {
      // un objeto suelto en la mano (lata, jabón, cinta VHS, balas)
      const it = this.items[this.prop as 'water'];
      it.visible = !rk;
      if (!rk && pg.right) grip('Right', it, pg.right);
      if (!rk && pg.left) grip('Left', it, pg.left);
    }
    if (gd && this.hand === 'none' && hk < 0.3 && !this.aiming) {
      // cinta, radar o tótem en la mano derecha (y la izquierda si su agarre la trae)
      const it = this.items[this.gadget as 'caution'];
      it.visible = !rk;
      if (!rk && gd.right) grip('Right', it, gd.right);
      if (!rk && gd.left) grip('Left', it, gd.left);
    }
    if (hk >= 0.3) for (const it of Object.values(this.items)) it.visible = false;
    if (this.away) (body.visible = false), Object.values(this.items).forEach((it) => (it.visible = false));
    this.rig.animator?.ik.run(dt); // (los agarres y el resto del IK, ya con los objetivos de este fotograma)
    // el objeto va con la mano: si el brazo no llega al agarre (objeto lejos del hombro) o aún se está acomodando, el objeto se acerca a
    // la muñeca lo que falte, en vez de quedarse en el aire con la mano lejos. Se recalcula cada fotograma desde su sitio (placeItems), sin acumular
    if (this.gripList.length) {
      const sum = new Map<THREE.Object3D, { d: THREE.Vector3; n: number }>();
      for (const g of this.gripList) {
        const hb = this.bones[g.side + 'Hand'];
        if (!hb) continue;
        const e = sum.get(g.item) ?? { d: new THREE.Vector3(), n: 0 };
        e.d.add(hb.getWorldPosition(new THREE.Vector3()).sub(g.at)), e.n++;
        sum.set(g.item, e);
      }
      const inv = this.camera.quaternion.clone().invert();
      for (const [it, e] of sum) {
        e.d.divideScalar(e.n);
        if (e.d.length() < 0.006) continue;
        e.d.clampLength(0, 0.3).applyQuaternion(inv);
        it.position.add(e.d);
        if (it === this.items.gun && this.hand === 'gun') this.items.flashlight.position.add(e.d); // (la linterna va montada en el rifle)
        it.updateMatrixWorld(true);
      }
    }
    if (rk && this.reachAt) {
      // la mano derecha, de su sitio en reposo hasta el objeto, con los dedos hacia abajo
      const arm = this.bones.RightArm, fore = this.bones.RightForeArm, hand = this.bones.RightHand;
      if (arm && fore && hand) {
        // hacia el objeto, hasta donde llega el brazo (y se vea en cuadro): medio metro desde el ojo
        const eye = this.camera.position, dir = this.reachAt.clone().sub(eye), far = Math.min(0.5, dir.length());
        const rest = this.camera.localToWorld(V(0.2, -0.32, -0.3)), to = rest.lerp(eye.clone().addScaledVector(dir.normalize(), far).add(V(0.06, 0, 0)), rk);
        const pole = arm.getWorldPosition(new THREE.Vector3()).add(V(0.5, -0.6, 0.2).applyQuaternion(q));
        solveTwoBone(arm, fore, hand, to, pole, this.bones.RightHandMiddle1, V(0, -1, 0).lerp(V(0, 0, -1).applyQuaternion(q), 0.4).normalize());
      }
    }

    // las pilas se acaban: por debajo del 25 % da menos y a ratos parpadea
    const low = this.charge < 0.25, flick = low && Math.random() > 0.3 + this.charge * 2 ? 0.15 : 1;
    const dim = (0.35 + 0.65 * Math.min(1, this.charge / 0.25)) * flick;
    if (this.lightOn) {
      this.flashD += (this.flashDist() - this.flashD) * Math.min(1, dt * 12);
      // la luz sale 0,5 m por delante de los ojos; con una pared cerca se queda dentro de ella: se echa atrás para que quede delante
      const out = THREE.MathUtils.clamp(this.flashD * 0.4, 0.06, 0.5);
      this.flash.position.z = -out;
      const near = THREE.MathUtils.clamp((this.flashD - out) / FLASH_D0, 0.1, 1);
      this.flash.intensity = FLASH * dim * near ** FLASH_DECAY;
      this.flash.angle = THREE.MathUtils.lerp(0.9, 0.55, near); // de cerca el cono se abre: menos hotspot
    } else this.flash.intensity = 0;
    this.lens?.emissive.setScalar(this.lightOn ? dim : 0.04);
  }

  /** A qué distancia de los ojos cae lo que ilumina la linterna: el suelo o la primera pared por delante (se marcha por la rejilla, hasta 12 m). */
  private flashDist() {
    this.camera.getWorldPosition(_fo);
    this.flash.target.getWorldPosition(_ft).sub(this.flash.getWorldPosition(_v0)).normalize();
    let t = _ft.y < -0.01 ? -_fo.y / _ft.y : Infinity;
    t = Math.min(t, 12);
    for (let s = 0.2; s < t; s += 0.2) if (this.world.solid(_fo.x + _ft.x * s, _fo.z + _ft.z * s)) return s;
    return t;
  }

  /**
   * Muerto: el cuerpo entero se ve (con la cabeza) y cae de espaldas: con el clip de muerte de Mixamo
   * si lo hay; si no, se desploma por código, girando sobre los pies.
   */
  private fall(dt: number) {
    const first = this.deadT === 0;
    this.deadT += dt;
    this.rig.root.visible = true;
    if (first) for (const it of Object.values(this.items)) it.visible = false;
    const body = this.rig.root, back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.16);
    body.position.copy(this.pos).add(back);
    if (first) this.rig.animator?.playOver(build({ type: 'clip', clip: 'Standing React Death Backward', loop: false }), { fadeIn: 0.1, hold: true });
    body.rotation.set(0, this.yaw + Math.PI, 0);
    this.rig.update(dt);
    for (const s of ['Head', 'Neck', 'LeftArm', 'RightArm']) this.bones[s]?.scale.setScalar(1);
  }

  /** Espectador: nada de lo que llevaba en las manos (ni el cuerpo caído) va con la cámara de quien se mira. Se llama cada fotograma, después de todo lo que los muestra. */
  hideHeld() {
    for (const it of Object.values(this.items)) it.visible = false;
  }

  /** Se mete en el nicho `h` (centro y yaw de salida, ver HideState): entra en 0,4 s, la linterna se apaga. */
  enterHide(h: { x: number; z: number; yaw: number }) {
    if (this.hideState !== 'out' || this.frozen || this.dead) return;
    this.hideState = 'in';
    this.hideK = 0;
    this.hideFrom.copy(this.pos);
    this.hideTo.set(h.x, 0, h.z);
    this.hideYaw = h.yaw;
    this.hideYaw0 = wrap(this.yaw - h.yaw);
    this.flashWas = this.flashOn;
    this.flashOn = false;
    this.aiming = false;
  }
  /** Sale a la boca del nicho (`fx`, `fz`: el centro de su celda). */
  leaveHide(h: { fx: number; fz: number }) {
    if (this.hideState !== 'hidden') return;
    this.hideState = 'leaving';
    this.hideK = 0;
    this.hideFrom.copy(this.pos);
    this.hideTo.set(h.fx, 0, h.fz);
  }
  /** Fuera del nicho ya (te han encontrado): de pie en la boca. */
  cancelHide(h: { fx: number; fz: number }) {
    if (this.hideState === 'out') return;
    if (this.hideState !== 'leaving' || this.hideK < 1) this.pos.set(h.fx, 0, h.fz);
    this.hideState = 'out';
    this.rig.root.visible = true;
    this.flashOn = this.flashWas && this.charge > 0;
  }
  /** Escondido de verdad (dentro): no cuenta como objetivo. */
  get concealed() {
    return this.hideState === 'hidden';
  }

  /** Vuelve a la partida (el Tótem de la vida): de pie en `at`, con todo lo que llevaba y la vida llena. */
  revive(at: THREE.Vector3, yaw: number) {
    this.dead = this.frozen = this.lookFree = this.fell = this.falling = false;
    this.deadT = 0;
    this.hp = perks.stats.hp;
    this.stamina = 1;
    this.winded = false;
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.animator?.stopOver();
    this.spawn(at, yaw);
  }

  /** Donde queda el cuerpo tirado (el centro, en el suelo). */
  get corpse() {
    return this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.9));
  }

  /** Una animación de una vez sobre el cuerpo (recoger, recargar): manda hasta que acaba. */
  /** Recoger lo que hay en `at`: `grab` se llama cuando la mano llega (a mitad del gesto). */
  reach(at: THREE.Vector3, grab: () => void) {
    if (this.reachAt) return false;
    this.reachAt = at.clone();
    this.reachT = 0;
    this.reachCb = grab;
    return true;
  }

  /** Variante de animación puesta (cosmético; id de anim/variants.json, '' = ninguna). */
  setVariant(id: string) {
    this.rig.animator?.setVariant(id);
  }
  get variant() {
    return this.rig.animator?.variant ?? '';
  }
  /** Baile de victoria (id de anim/dances.json) o '' para dejarlo. */
  dance(id: string) {
    const A = this.rig.animator;
    if (!A) return;
    if (id) A.playOver(id, { hold: true });
    else A.stopOver();
    A.p.hold = 0;
  }
  get dancing() {
    return this.rig.animator?.playing ? this.rig.animator.current : '';
  }

  act(name: string) {
    this.rig.animator?.playOver(build({ type: 'clip', clip: name, rate: 1.6, loop: false }), { fadeIn: 0.15, fadeOut: 0.15 });
  }

  /** El retroceso del disparo: la vista salta un poco hacia arriba y el rifle hacia atrás. */
  kick() {
    this.recoil = 1;
  }

  /** Pistola de agua: el modelo (viene con el kit de las Poolrooms: se baja la primera vez), y el chorro mientras se mantiene el clic. */
  private spray(dt: number, c: Controls) {
    const wg = this.items.watergun;
    if (this.hand === 'watergun' && !wg.children.length) {
      const m = poolPart('watergun');
      if (m) (wg.add(fit(m.clone(true), 0.4)), (this.tankLvl = tankFx(wg)), this.poolMode && wg.traverse((o) => o.layers.set(1))); // (en las Poolrooms, capa 1: el reflejo del agua no lo repinta)
      else void loadPoolKit();
    }
    if (wg.visible) this.tankLvl?.(this.squirt); // el agua dentro del depósito
    this.jetting = this.hand === 'watergun' && !this.dead && !this.frozen && this.hideState === 'out' && !!(c.fire || c.fireHeld) && this.squirt > 0;
    const J = this.jet;
    if (!J.points.parent) this.world.root.add(J.points);
    // dispara mientras se mantiene el clic: no bajo el agua ni dentro de un tubo (lo dice el mundo)
    const t = this.terrain, eye = _eye.set(this.pos.x, this.pos.y + this.eyeBase, this.pos.z), go = this.jetting && this.jetOk;
    if (go) {
      this.squirt = Math.max(0, this.squirt - dt / (6 * boostOf(perks, 'watergun'))); // (la rareza de la pistola: un depósito que dura más)
      if ((this.jetT -= dt) <= 0) (this.jetT = 1 / 15), this.onSquirt?.(this.pos.x, this.pos.z, this.yaw);
    }
    // el mundo dice dónde está el suelo (o el agua) y las paredes; sin él, la rejilla del nivel
    const probe = t?.jetProbe ?? ((x: number, _y: number, z: number) => (this.world.solid(x, z) ? null : { gy: this.world.floorAt?.(x, z) ?? 0, wet: false }));
    J.update(dt, go ? eye : null, this.yaw, this.pitch, probe, t?.splash);
    // recargar junto a un bebedero (las Poolrooms): mantener G ~1,5 s
    const at = !!t?.refillNear?.(this.pos.x, this.pos.y, this.pos.z) && this.poolGear.watergun && this.squirt < 1;
    this.refilling = at && !!c.grabHeld;
    this.refillAct = at ? 'HOLD TO REFILL' : null;
    if (this.refilling) {
      this.fillT += dt;
      if (this.fillT >= 1.5) (this.squirt = 1), (this.fillT = 0);
    } else this.fillT = 0;
  }

  /** Le ha dado la pistola de agua de otro (el servidor lo avisa): mojado frena a la mitad, parado no se mueve. */
  hit(kind: 'wet' | 'stun', ms: number) {
    if (kind === 'stun') this.stunT = ms / 1000;
    else this.wetT = ms / 1000;
  }

  hold(h: Player['hand']) {
    this.hand = h;
    if (h !== 'none') (this.gadget = 'none'), (this.prop = 'none');
    this.items.camera.visible = h === 'camera';
    if (h !== 'camera' && h !== 'gun' && h !== 'watergun') this.aimK = 0;
    this.items.gun.visible = h === 'gun';
    this.items.watergun.visible = h === 'watergun';
  }

  /** Sacar la cinta o el radar (o guardarlo si ya está en la mano): deja libre la mano derecha. */
  equipGadget(g: 'caution' | 'radar' | 'totem') {
    if (this.gadget === g) return void (this.gadget = 'none');
    this.hold('none');
    this.prop = 'none';
    this.gadget = g;
  }

  /** F o el interruptor: enciende o apaga; con la linterna gastada, saca una de repuesto si hay. */
  toggleLight() {
    if (this.left !== 'flashlight') return;
    if (this.charge <= 0) {
      if (this.spares < 2) return; // (una de repuesto además de la que lleva)
      this.spares--;
      this.charge = 1;
      this.flashOn = true;
      this.flickerT = 0;
    } else {
      this.flashOn = !this.flashOn;
      // balance: cuanto menos pila, más probable que al encender parpadee en vez de dar luz del todo (de 0 % con pila llena hasta un 20 %)
      this.flickerT = this.flashOn && Math.random() < FLICKER_MAX * (1 - this.charge) ? 0.5 + Math.random() * 0.5 : 0;
    }
  }

  /** La linterna da luz: encendida y en la mano izquierda. */
  get lightOn() {
    // durante el parpadeo la luz va y viene de forma irregular (y mientras está «apagada» tampoco delata ni ilumina)
    const stutter = this.flickerT > 0 && Math.sin(this.flickerT * 47) * Math.sin(this.flickerT * 13 + 1) > 0.15;
    return this.flashOn && this.left === 'flashlight' && !stutter;
  }

  /** Usar lo de la ranura `i` (si se tiene). */
  useHot(i: number) {
    const d = i < perks.stats.hot && this.hot[i] ? HOT[this.hot[i]!] : undefined;
    if (d?.have(this.own)) d.use(this);
    else this.empty();
  }

  /** La rueda deja elegida la ranura `i` y saca lo que hay en ella; si está vacía (o ya no se tiene), las manos quedan libres: no se queda lo de antes. */
  pickHot(i: number) {
    this.hotSel = i;
    const d = this.hot[i] ? HOT[this.hot[i]!] : undefined;
    if (!d?.have(this.own)) this.empty();
    else if (!d.held(this)) d.use(this);
  }
  /** Guarda lo de la mano derecha (lo que se saca con la barra rápida); la linterna de la izquierda sigue. */
  empty() {
    this.hold('none');
    this.gadget = this.prop = 'none';
  }

  /** Poner `id` en la ranura `i` (o vaciarla con null); un objeto solo está en una ranura. */
  assign(i: number, id: string | null) {
    if (id && !HOT[id]) return;
    if (id) for (let k = 0; k < HOT_SLOTS; k++) if (this.hot[k] === id) this.hot[k] = null;
    this.hot[i] = id;
  }

  /** Lo recién cogido va a la primera ranura libre si aún no está en la barra. */
  autoSlot(id: string) {
    if (this.hot.includes(id)) return;
    // una ranura vacía o con algo que ya no se lleva (soltado, gastado): si la barra se llena de huecos muertos, lo nuevo no se vería
    const own = this.own;
    const free = this.hot.findIndex((h, i) => i < perks.stats.hot && (!h || !HOT[h]?.have(own)));
    if (free >= 0) this.hot[free] = id;
  }

  /** Beber una lata de Almond Water: devuelve un 40 % (vida, aguante y cordura). */
  drink() {
    if (this.water <= 0) return;
    this.drankAt = performance.now();
    this.water--;
    this.stamina = Math.min(1, this.stamina + WATER_HEAL);
    this.hp = Math.min(perks.stats.hp, this.hp + HP_MAX * WATER_HEAL * boostOf(perks, 'water')); // (la rareza de la lata cura más)
    if (this.stamina > 0.3) this.winded = false;
    this.sanity = Math.min(1, this.sanity + WATER_HEAL);
    if (this.water <= 0) this.prop = 'none';
    this.onDrink?.();
  }

  /** Cuánto lleva la lata en los labios (0–1; 0 si no se bebe). Tras el trago se queda llena un instante, para que la barra del HUD (10 Hz) llegue al final. */
  get drinking() {
    return this.drinkT > 0 ? Math.min(1, this.drinkT / DRINK_T) : performance.now() - this.drankAt < 250 ? 1 : 0;
  }

  /** Sacar una Monster (se bebe manteniendo 3 s; ver `monsterT`). */
  equipMonster() {
    if (this.monster <= 0) return;
    this.hold('none');
    this.gadget = 'none';
    this.prop = 'monster';
    if (!this.items.monster.children.length) {
      const m = itemModel('monster');
      if (m) this.items.monster.add(fit(m.clone(true), 0.2));
    }
  }
  /** Usar la carta Uno Reverse: cambia de sitio con un compañero al azar (lo decide el servidor) y se gasta. */
  useUno() {
    if (!this.uno || !this.onUno) return;
    this.onUno((ok) => ok && ((this.uno = false), this.prop === 'uno' && (this.prop = 'none')));
  }
  /** Sacar la carta Uno Reverse (se juega manteniendo; ver `unoT`). */
  equipUno() {
    if (!this.uno) return;
    this.hold('none');
    this.gadget = 'none';
    this.prop = 'uno';
    if (!this.items.uno.children.length) {
      const m = itemModel('uno');
      if (m) this.items.uno.add(fit(m.clone(true), 0.2));
    }
  }

  /** Sacar la lata de Almond Water (se bebe manteniendo; ver `drinkT`). */
  equipWater() {
    if (this.water <= 0) return;
    this.hold('none');
    this.gadget = 'none';
    this.prop = 'water';
  }

  /** Lo que se lleva, para HOT. */
  get own() {
    return { water: this.water, monster: this.monster, uno: this.uno, totem: this.totem, radar: this.radar, camera: this.has.camera, gun: this.has.gun, caution: this.caution, watergun: this.poolGear.watergun };
  }

  /** Todo lo que lleva, como lo cuenta el servidor (el inventario que se conserva entre rondas). */
  get inventory(): Inventory {
    return { spares: this.spares, water: this.water, totem: this.totem, ammo: this.ammo + this.spare, radar: this.radar, camera: this.has.camera, gun: this.has.gun, caution: this.caution, uno: this.uno, monster: this.monster, ...this.poolGear };
  }
  /** Lo de las Poolrooms (traje de buzo, pistola de agua): aquí no se usa, pero se conserva para devolverlo al servidor. */
  private poolGear = { tank: false, watergun: false };

  /**
   * Pone lo que lleva según `inv`: cantidades y qué tiene. Lo que ya no tiene sale de la mano, el cinturón y los gadgets; lo nuevo
   * va a su sitio (mano o cinturón, barra rápida).
   */
  apply(inv: Inventory) {
    const had = this.inventory;
    this.poolGear = { tank: inv.tank, watergun: inv.watergun };
    if (!inv.watergun && this.hand === 'watergun') this.hold('none');
    this.spares = inv.spares;
    if (inv.spares < 1) this.left = 'none';
    else if (!had.spares && this.left === 'none') this.left = 'flashlight';
    this.water = inv.water;
    this.totem = inv.totem;
    this.monster = inv.monster;
    this.uno = inv.uno;
    if (!inv.monster && this.prop === 'monster') this.prop = 'none';
    if (!inv.uno && this.prop === 'uno') this.prop = 'none';
    this.radar = inv.radar;
    this.caution = inv.caution;
    this.has.camera = inv.camera;
    this.has.gun = inv.gun;
    const d = inv.ammo - had.ammo; // balas: lo que sobra va a la reserva; lo que falta sale primero de ella
    if (d > 0) this.spare += d;
    else {
      const k = Math.min(this.spare, -d);
      this.spare -= k;
      this.ammo = Math.max(0, this.ammo - (-d - k));
    }
    for (const g of ['camera', 'gun'] as const)
      if (!inv[g]) {
        if (this.hand === g) this.hold('none');
        if (this.belt === g) this.belt = 'none';
      }
    if (!inv.radar && this.gadget === 'radar') this.gadget = 'none';
    if (!inv.caution && this.gadget === 'caution') this.gadget = 'none';
    if (!inv.totem && this.gadget === 'totem') this.gadget = 'none';
    for (const g of ['camera', 'gun'] as const) if (inv[g] && !had[g]) (this.stow(g), this.autoSlot(g));
    for (const k of ['water', 'totem', 'radar', 'caution', 'watergun', 'uno', 'monster'] as const) if (inv[k] && !had[k]) this.autoSlot(k);
  }

  /** Empezar la ronda con este inventario (el del servidor): nada de lo anterior, el cargador lleno. */
  load(inv: Inventory) {
    this.hot.fill(null);
    this.hand = this.belt = 'none';
    this.gadget = 'none';
    this.has.camera = this.has.gun = this.radar = this.caution = false;
    this.spares = this.water = this.totem = this.ammo = this.spare = this.monster = 0;
    this.uno = false;
    this.buffT = this.monsterT = this.unoT = 0;
    this.apply(inv);
    const t = this.ammo + this.spare;
    this.ammo = Math.min(AMMO_PACK, t);
    this.spare = t - this.ammo;
  }

  /** ¿Lleva una unidad de `id` que soltar? */
  owns(id: ItemId) {
    return hasItem(this.inventory, id);
  }
  /** Una unidad menos de `id` (la soltó) o una más (la recogió del suelo). */
  lose(id: ItemId) {
    this.apply(removeItem(this.inventory, id));
  }
  receive(id: ItemId) {
    this.apply(addItem(this.inventory, id));
  }

  /** Q: lo de la mano derecha al cinturón y lo del cinturón a la mano. */
  swap() {
    if (this.hand === 'watergun') return;
    const b = this.belt;
    this.belt = this.hand;
    this.hold(b);
  }

  /** Poner `it` en `slot` (o vaciarlo con 'none'): sale de donde estuviera; lo que había, al almacén. */
  place(slot: Slot, it: Gear | 'none') {
    if (it !== 'none') {
      if (!FITS[slot].includes(it) || (it === 'flashlight' ? this.spares < 1 : !this.has[it])) return false;
      if (this.hand === it) this.hold('none');
      if (this.belt === it) this.belt = 'none';
      if (this.left === it) this.left = 'none';
    }
    if (slot === 'right') this.hold(it as Player['hand']);
    else if (slot === 'belt') this.belt = it as Player['belt'];
    else this.left = it as Player['left'];
    return true;
  }

  /** Lo recién cogido: a la mano si está libre, si no al cinturón, si no al almacén. */
  stow(it: 'camera' | 'gun') {
    if (!perks.stats.hot) return; // sin barra rápida (mejora) no se saca nada: queda en la mochila
    if (this.hand === 'none') this.hold(it);
    else if (this.belt === 'none') this.belt = it;
  }

  /** Mi aspecto (el color del traje y la mochila). */
  private cos: Cosmetics;
  setLook(l: Look) {
    this.cos.set(l);
  }
  dispose() {
    this.cos.dispose();
    for (const it of Object.values(this.items)) it.removeFromParent();
    this.jet.dispose();
    this.rig.root.removeFromParent();
    this.rig.mixer.stopAllAction();
  }
}
