import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { emoteGate } from './emotes';
import { EMOTE_DEFS, EMOTE_GAP, emoteOpen, INV_MAX, SCALE, WAIT_HALF, WAIT_SPAWNS, canHold, rarity, shopItem, type Inventory, type Sold } from '@backrooms/shared';
import type { Assets } from './game';
import type { Controls } from './input';
import { Corridor } from './waitCorridor';
import { Decor, TUBE_Z } from './waitDecor';
import { addProps, type Extra } from './waitProps';
import { canvasTex, clamp, hash, plane, smooth, type Box } from './waitKit';

/*
 * La sala de espera: una habitación de 6 × 5 m (baldosas, techo con dos fluorescentes, zócalo) con una puerta
 * cerrada, el botón industrial de al lado y un ordenador viejo sobre una mesa, más el decorado de waitDecor.ts.
 * Es una escena aparte que pinta el compositor del juego (game.ts), con su propia cámara en primera persona y
 * colisiones contra cajas. Pocas luces reales (cielo, los dos tubos, la puerta, la máquina y la lámpara); el
 * resto, emisivo o aditivo.
 *
 * Interacciones (E): el ordenador acerca la cámara a su pantalla; el botón lo pulsa el propietario; la máquina
 * suelta una lata; el sillón sienta; la lámpara de pie se enciende y apaga. Teclas 1–4: emotes (ver doEmote()).
 * En `begin()` (la fase `starting`, en todos los clientes) se juega la entrada: el botón se hunde, los tubos
 * parpadean y se van, suena la alarma, la puerta cede y se abre, la cámara (en mano) se acerca, cruza el umbral
 * en un travelling por el pasillo de detrás (waitCorridor.ts) y se funde a negro con el zumbido subiendo.
 */

const R = 0.3; // el radio del cuerpo
const EYE = 1.62;
const WALK = 1.6, RUN = 3.6;
const H = WAIT_HALF;
const SCALE_H = 1.1; // altura de la báscula (m)
const HEIGHT = 2.6;
const DOOR_W = 1.1, DOOR_H = 2.1;
const HINGE_X = -DOOR_W / 2;
const TUBE = [12, 8]; // lo que alumbra cada fluorescente (cd)
const SEAT = { x: H.x - 0.6, z: H.z - 0.6, yaw: Math.PI / 4 }; // el sillón: dónde se sienta uno y hacia dónde mira
const FOG0 = new THREE.Color(0x17130a), HAZE = new THREE.Color(0x8c7634);
/** Cuánto dura cada emote con tiempo (s). */
const EMOTE_LEN = [0, ...EMOTE_DEFS.map((e) => e.len)];

/**
 * Los tiempos de la entrada (s): los tubos, la alarma, el golpe de la cerradura, la puerta, la cámara, el negro y el
 * total (≤ START_DELAY). Con movimiento reducido, corta y sin cámara ni alarma.
 */
const FULL = { off1: 1.8, off2: 0.9, alarmA: 1.0, alarmB: 4.8, boom: 2.3, doorA: 2.4, doorB: 4.0, camA: 0.5, camB: 6.5, fadeA: 6.1, fadeB: 7.0, total: 7.2 };
const SHORT = { off1: 0.4, off2: 0.2, alarmA: 0, alarmB: 0, boom: 0.15, doorA: 0.2, doorB: 0.8, camA: 0, camB: 0, fadeA: 0.9, fadeB: 1.6, total: 1.7 };

export interface WaitSfx {
  (name: 'click' | 'thunk' | 'creak' | 'boom' | 'alarm' | 'alarmoff' | 'vend'): void;
}
export type Hint = 'computer' | 'board' | 'button' | 'vending' | 'chair' | 'lamp' | 'stand';

export class WaitingRoom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  // el jugador
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  speed = 0;
  /** Soy el propietario de la sala (game.ts lo actualiza): solo yo pulso el botón. */
  owner = false;
  /** Lo que se puede hacer ahora mismo (E), o nada. */
  hint: Hint | null = null;
  /** Un aviso corto (p. ej. «SOLO EL PROPIETARIO») y hasta cuándo (age). */
  notice = '';
  private noticeUntil = 0;
  mode: 'free' | 'computer' | 'board' | 'starting' = 'free';
  /** Qué vista toma la cámara al acercarse: la pantalla del ordenador o la pizarra. */
  private view: 'pc' | 'board' = 'pc';
  private boardPos = new THREE.Vector3(-1.73, 1.5, 0.97);
  private boardQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ'));
  private blend = 0; // 0 → 1: la cámara de pie → ante la pantalla
  private age = 0;
  onComputer?: (open: boolean) => void;
  onBoard?: (open: boolean) => void;
  onPress?: () => void;
  /** E sin nada a lo que apuntar: abre el inventario. */
  onBag?: () => void;
  /** Compra una lata en la máquina (el servidor cobra del dinero común y la pone en la mochila). */
  onVend?: (done: (r: { ok: boolean; error?: string }) => void) => void;
  /** Saldo común y mochila, para el precio y los avisos de la máquina. */
  bank = 0;
  inv: Inventory | null = null;
  private vendBusy = false;
  sfx?: WaitSfx;
  // sentado (en el sillón o en el suelo) y emotes
  private seat: 'none' | 'chair' | 'floor' = 'none';
  private sit = 0; // 0 → 1: la cámara baja
  /** El emote en marcha (0 ninguno; ver PlayerState.emote). */
  emote = 0;
  private emoteUntil = 0;
  /** 0 → 1: la cámara pasa de mis ojos a verme bailar. */
  private emK = 0;
  private emoteAt = -1e9;
  private hop?: { from: THREE.Vector3; t: number };
  // la escena
  private own: { dispose?: () => void }[] = [];
  private tex: THREE.Texture[] = [];
  private boxes: Box[] = [];
  private hinge = new THREE.Group();
  private tubeMats = [new THREE.MeshBasicMaterial({ color: 0x14120c }), new THREE.MeshBasicMaterial({ color: 0x14120c })];
  private tubes = [new THREE.PointLight(0xffecc0, TUBE[0], 14, 1.2), new THREE.PointLight(0xffe2a8, TUBE[1], 12, 1.3)];
  private doorLight = new THREE.PointLight(0xffd37a, 3, 10, 1.3);
  private alarmLight = new THREE.PointLight(0xff2a18, 0, 9, 1.4);
  private strip = new THREE.MeshBasicMaterial({ color: 0xffcf6a, toneMapped: false });
  private screenMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private screenCv = Object.assign(document.createElement('canvas'), { width: 256, height: 192 });
  private screenTex = new THREE.CanvasTexture(this.screenCv);
  private screenLines: string[] = [];
  private screenAt = 0;
  private button?: THREE.Object3D;
  private buttonZ0 = 0;
  private sink = 0;
  private pressed = false;
  private pressedAt = 0;
  private targets: { kind: Hint; p: THREE.Vector3; reach: number }[] = [];
  private compPos = new THREE.Vector3();
  private compQuat = new THREE.Quaternion();
  private compYaw = 0;
  private compPitch = 0;
  private decor!: Decor;
  private props!: (age: number) => void;
  private corridor!: Corridor;
  private me!: THREE.Mesh; // mi sombra falsa
  // la entrada
  private seq?: { t: number; from: THREE.Vector3; fromQ: THREE.Quaternion; curve?: THREE.CatmullRomCurve3 };
  private waiters: (() => void)[] = [];
  private cue = { boom: false, alarm: false, alarmOff: false, creak: false };
  /** 0–1: el corte a negro de la entrada. */
  black = 0;
  /** 0–1: lo encendido que está el fluorescente (el zumbido le sigue). */
  power = 1;
  private done = false;
  private bob = 0;

  /** Descarga el ordenador y el botón (si no llegan, la sala sale con cajas en su lugar) y monta la sala. */
  static async load(assets: Assets, reduced: boolean) {
    const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const get = (n: string) => gl.loadAsync(`/models/waiting/${n}.glb`).catch((e) => (console.warn('waiting model', n, e), undefined));
    const [pc, btn, chair, vend, wb, scale] = await Promise.all([get('computer'), get('button'), get('chair50'), get('vending'), get('whiteboard'), get('scale')]);
    return new WaitingRoom(assets, reduced, pc, btn, { chair }, vend, wb, scale);
  }

  private constructor(assets: Assets, private reduced: boolean, pc?: GLTF, btn?: GLTF, extra: Extra = {}, vend?: GLTF, wb?: GLTF, scaleGltf?: GLTF) {
    const S = this.scene;
    S.background = FOG0.clone();
    S.fog = new THREE.Fog(FOG0.getHex(), 6, 20);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat.map = this.screenTex;
    this.screenTex.minFilter = THREE.LinearFilter;
    const bag = { own: this.own, tex: this.tex };

    // las texturas del juego, copiadas (la repetición es de cada copia; la imagen, la de siempre)
    const sh = (t: THREE.Texture) => {
      const c = t.clone();
      c.needsUpdate = true;
      this.tex.push(c);
      return c;
    };
    const wallMat = new THREE.MeshStandardMaterial({ map: sh(assets.tex.wall), color: 0xb4a574, roughness: 0.95 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: sh(assets.tex.ceiling), color: 0x9a9170, roughness: 0.95 });
    // las baldosas: cuatro por metro cuadrado, de dos crema, con su junta
    const tiles = canvasTex(256, 256, (x) => {
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const v = 150 + hash(i * 7 + j * 13 + 1) * 28;
          x.fillStyle = `rgb(${v},${v * 0.93},${v * 0.72})`;
          x.fillRect(i * 128, j * 128, 128, 128);
        }
      for (let n = 0; n < 2600; n++) {
        x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,30,10' : '230,220,170'},${Math.random() * 0.12})`;
        x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      x.fillStyle = 'rgba(30,24,10,0.85)';
      for (const p of [0, 128]) (x.fillRect(p - 1, 0, 3, 256), x.fillRect(0, p - 1, 256, 3));
      x.fillRect(254, 0, 2, 256);
      x.fillRect(0, 254, 256, 2);
    });
    this.tex.push(tiles);
    const floorMat = new THREE.MeshStandardMaterial({ map: tiles, color: 0xa89c78, roughness: 0.55 });
    const base = new THREE.MeshStandardMaterial({ color: 0x2b2216, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1710, roughness: 0.8 });
    this.own.push(wallMat, ceilMat, floorMat, base, dark);
    const add = (...o: THREE.Object3D[]) => S.add(...o);

    // el cuarto: suelo, techo y cuatro paredes (la del norte con el hueco de la puerta)
    add(
      plane(H.x * 2, H.z * 2, floorMat, 1, [0, 0, 0], -Math.PI / 2, 0),
      plane(H.x * 2, H.z * 2, ceilMat, 1.5, [0, HEIGHT, 0], Math.PI / 2, 0),
      plane(H.z * 2, HEIGHT, wallMat, 1.5, [-H.x, HEIGHT / 2, 0], 0, Math.PI / 2),
      plane(H.z * 2, HEIGHT, wallMat, 1.5, [H.x, HEIGHT / 2, 0], 0, -Math.PI / 2),
      plane(H.x * 2, HEIGHT, wallMat, 1.5, [0, HEIGHT / 2, H.z], 0, Math.PI),
      // norte: a cada lado de la puerta y encima
      plane(H.x - DOOR_W / 2, HEIGHT, wallMat, 1.5, [(-H.x - DOOR_W / 2) / 2, HEIGHT / 2, -H.z], 0, 0),
      plane(H.x - DOOR_W / 2, HEIGHT, wallMat, 1.5, [(H.x + DOOR_W / 2) / 2, HEIGHT / 2, -H.z], 0, 0),
      plane(DOOR_W, HEIGHT - DOOR_H, wallMat, 1.5, [0, (HEIGHT + DOOR_H) / 2, -H.z], 0, 0),
    );
    // el zócalo, en los cuatro lados (el de la puerta, partido)
    const skirt = (w: number, d: number, x: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), base);
      b.position.set(x, 0.05, z);
      add(b);
    };
    skirt(0.03, H.z * 2, -H.x + 0.015, 0);
    skirt(0.03, H.z * 2, H.x - 0.015, 0);
    skirt(H.x * 2, 0.03, 0, H.z - 0.015);
    skirt(H.x - DOOR_W / 2 - 0.05, 0.03, (-H.x - DOOR_W / 2) / 2, -H.z + 0.015);
    skirt(H.x - DOOR_W / 2 - 0.05, 0.03, (H.x + DOOR_W / 2) / 2, -H.z + 0.015);

    // los dos fluorescentes del techo: marco y panel (el segundo, peor)
    const frame = mergeGeometries(
      [
        new THREE.BoxGeometry(1.32, 0.07, 0.05).translate(0, 0, 0.335),
        new THREE.BoxGeometry(1.32, 0.07, 0.05).translate(0, 0, -0.335),
        new THREE.BoxGeometry(0.05, 0.07, 0.62).translate(0.635, 0, 0),
        new THREE.BoxGeometry(0.05, 0.07, 0.62).translate(-0.635, 0, 0),
      ].map((g) => g.toNonIndexed()),
    )!;
    const fixMat = new THREE.MeshStandardMaterial({ color: 0x8e8a7c, roughness: 0.55, metalness: 0.35 });
    this.own.push(fixMat);
    TUBE_Z.forEach((z, i) => {
      const fixture = new THREE.Mesh(frame, fixMat);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.6), this.tubeMats[i]);
      fixture.position.set(0, HEIGHT - 0.035, z);
      panel.position.set(0, HEIGHT - 0.03, z);
      this.tubes[i].position.set(0, HEIGHT - 0.5, z);
      add(fixture, panel, this.tubes[i]);
    });
    this.own.push(frame, ...this.tubeMats);
    add(new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 0.9));

    // la puerta: marco, la hoja sobre sus goznes (a la izquierda) y la rendija de luz por debajo
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2f20, roughness: 0.6 });
    const leafMat = new THREE.MeshStandardMaterial({
      map: canvasTex(128, 256, (x) => {
        x.fillStyle = '#5d6256';
        x.fillRect(0, 0, 128, 256);
        for (let n = 0; n < 900; n++) {
          x.fillStyle = `rgba(${Math.random() < 0.6 ? '20,22,16' : '170,175,150'},${Math.random() * 0.1})`;
          x.fillRect(Math.random() * 128, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 6);
        }
        x.strokeStyle = 'rgba(0,0,0,0.45)';
        x.lineWidth = 3;
        x.strokeRect(14, 16, 100, 100);
        x.strokeRect(14, 134, 100, 106);
        x.fillStyle = 'rgba(20,18,10,0.9)';
        x.fillRect(0, 244, 128, 12);
        // la banda de aviso, abajo
        for (let i = -2; i < 10; i++) (x.fillStyle = i % 2 ? '#c9a227' : '#17140c'), x.fillRect(i * 14, 226, 14, 12);
      }),
      roughness: 0.7,
      metalness: 0.2,
    });
    this.tex.push(leafMat.map!);
    this.own.push(frameMat, leafMat);
    const jamb = (w: number, h: number, x: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), frameMat);
      b.position.set(x, y, -H.z + 0.03);
      add(b);
    };
    jamb(0.08, DOOR_H + 0.08, -DOOR_W / 2 - 0.04, (DOOR_H + 0.08) / 2);
    jamb(0.08, DOOR_H + 0.08, DOOR_W / 2 + 0.04, (DOOR_H + 0.08) / 2);
    jamb(DOOR_W + 0.16, 0.08, 0, DOOR_H + 0.04);
    this.hinge.position.set(HINGE_X, 0, -H.z + 0.04);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W - 0.01, DOOR_H - 0.03, 0.05), leafMat);
    leaf.position.set(DOOR_W / 2, DOOR_H / 2 + 0.015, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.07), new THREE.MeshStandardMaterial({ color: 0xa6a08a, metalness: 0.8, roughness: 0.3 }));
    handle.position.set(DOOR_W - 0.14, 1.0, 0);
    this.own.push(handle.material as THREE.Material);
    this.hinge.add(leaf, handle);
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W - 0.04, 0.03), this.strip);
    gap.position.set(0, 0.016, -H.z + 0.03);
    add(this.hinge, gap);
    this.doorLight.position.set(0, 1.4, -H.z - 1.6);
    this.alarmLight.position.set(0, 2.2, -H.z + 0.7);
    add(this.doorLight, this.alarmLight);
    this.own.push(this.strip);

    // lo que hay detrás: el pasillo de las backrooms (waitCorridor.ts)
    this.corridor = new Corridor(bag, { wall: sh(assets.tex.wall), ceiling: sh(assets.tex.ceiling), carpet: sh(assets.tex.carpet) }, wallMat, floorMat);
    add(this.corridor.group);

    // una placa sobre la pared, junto a la puerta
    const signMat = new THREE.MeshBasicMaterial({
      map: canvasTex(256, 64, (x) => {
        x.fillStyle = '#1b1912';
        x.fillRect(0, 0, 256, 64);
        x.strokeStyle = '#8a8466';
        x.lineWidth = 3;
        x.strokeRect(3, 3, 250, 58);
        x.fillStyle = '#d9d3b8';
        x.font = 'bold 26px ui-monospace, Consolas, monospace';
        x.textAlign = 'center';
        x.fillText('WAITING ROOM', 128, 40);
      }),
      color: 0xbdb79e,
    });
    this.tex.push(signMat.map!);
    this.own.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), signMat);
    sign.position.set(-1.6, 1.75, -H.z + 0.01);
    add(sign);

    // el decorado (pósters, máquina, cables, manchas, polvo...)
    this.decor = new Decor(S, bag, reduced, vend, assets.gltf.water, wb);
    this.boxes.push(...this.decor.boxes);

    // la mesa del ordenador (contra la pared oeste) y su ordenador
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 1.5), frameMat);
    top.position.y = 0.75;
    for (const z of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.72, 0.04), frameMat);
      leg.position.set(0, 0.36, z);
      desk.add(leg);
    }
    desk.add(top);
    desk.position.set(-H.x + 0.375, 0, -0.2);
    add(desk);
    this.boxes.push({ x0: -H.x, x1: -H.x + 0.75, z0: -0.2 - 0.75, z1: -0.2 + 0.75 });
    this.decor.shadowUnder(this.boxes[this.boxes.length - 1]);
    this.placeComputer(pc, desk);

    // el botón, sobre un pedestal junto a la puerta
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.0, 0.44), dark);
    ped.position.set(1.5, 0.5, -H.z + 0.26);
    add(ped);
    this.boxes.push({ x0: 1.28, x1: 1.72, z0: -H.z, z1: -H.z + 0.48 });
    this.decor.shadowUnder(this.boxes[this.boxes.length - 1]);
    this.placeButton(btn, new THREE.Vector3(1.5, 1.0, -H.z + 0.26));

    // la báscula: una plataforma en el suelo (sin colisión: se pisa) con su visor; lo que se suelta encima se vende (lo decide el servidor)
    const plat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), new THREE.MeshStandardMaterial({ color: 0x4a4d46, roughness: 0.45, metalness: 0.7 }));
    plat.position.set(SCALE.x, 0.025, SCALE.z);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, 1.0), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 }));
    rim.position.set(SCALE.x, 0.015, SCALE.z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.25, 0.06), dark);
    post.position.set(-H.x + 0.1, 0.625, SCALE.z - 0.2);
    this.scaleTex.colorSpace = THREE.SRGBColorSpace;
    const read = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: this.scaleTex }));
    read.position.set(-H.x + 0.14, 1.1, SCALE.z - 0.2);
    read.rotation.y = Math.PI / 2;
    if (scaleGltf) {
      // el modelo de la báscula (CC-BY, ver LICENSES.txt): se centra sobre su sitio, apoyado en el suelo y a la altura de una báscula de tienda
      const m = scaleGltf.scene.clone(true);
      m.updateMatrixWorld(true);
      // el modelo trae un suelo/sombra enorme (la malla más grande): fuera
      let big: THREE.Object3D | undefined, bigV = 0;
      m.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()), v = sz.x * sz.y * sz.z;
        if (v > bigV) (bigV = v), (big = o);
      });
      big?.removeFromParent();
      m.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(m), size = bx.getSize(new THREE.Vector3()), c = bx.getCenter(new THREE.Vector3());
      const k = SCALE_H / size.y;
      const holder = new THREE.Group();
      m.position.set(-c.x, -bx.min.y, -c.z);
      holder.add(m);
      holder.scale.setScalar(k);
      holder.position.set(SCALE.x, 0, SCALE.z);
      holder.rotation.y = Math.PI / 2;
      add(holder);
      add(read);
    } else add(rim, plat, post, read);
    this.own.push(plat.geometry, plat.material as THREE.Material, rim.geometry, rim.material as THREE.Material, post.geometry, read.geometry, read.material as THREE.Material);
    this.tex.push(this.scaleTex);
    this.sold();

    // un sillón en la esquina, de cara al cuarto (sus materiales, copiados: los del juego llevan el parche del mapa de luz)
    const chair = assets.gltf.armchair.scene.clone(true);
    chair.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.shared = true;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      this.own.push(...(Array.isArray(m.material) ? m.material : [m.material]));
    });
    const cb = new THREE.Box3().setFromObject(chair), cs = cb.getSize(new THREE.Vector3()), ck = 0.95 / Math.max(cs.x, cs.z);
    chair.scale.multiplyScalar(ck);
    const holder = new THREE.Group();
    const cb2 = new THREE.Box3().setFromObject(chair), cc = cb2.getCenter(new THREE.Vector3());
    chair.position.set(-cc.x, -cb2.min.y, -cc.z);
    holder.add(chair);
    holder.position.set(SEAT.x, 0, SEAT.z);
    holder.rotation.y = Math.PI * 0.75; // el frente de todos los sillones del juego mira a +z
    add(holder);
    this.boxes.push({ x0: H.x - 1.1, x1: H.x, z0: H.z - 1.1, z1: H.z });
    this.decor.shadowUnder(this.boxes[this.boxes.length - 1]);
    // y a lo que se apunta para usar el sillón, la máquina y la lámpara
    this.targets.push(
      { kind: 'chair', p: new THREE.Vector3(SEAT.x, 0.6, SEAT.z), reach: 2.2 },
      { kind: 'vending', p: this.decor.vendAt.clone(), reach: 2.2 },
      { kind: 'lamp', p: this.decor.lampAt.clone(), reach: 2.6 },
    );

    // sillones, tele y ventana (waitProps.ts)
    this.props = addProps(S, assets, extra, bag, this.boxes, (b) => this.decor.shadowUnder(b));

    // mi sombra falsa
    this.me = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), this.decor.blobMaterial);
    this.me.renderOrder = 1;
    this.own.push(this.me.geometry);
    add(this.me);

    // el jugador: en el primer hueco, mirando a la puerta
    this.spawn(0);
    this.drawScreen(0);
    this.camera.position.set(this.pos.x, EYE, this.pos.z);
  }

  // ── los muebles ──────────────────────────────────────────────────────────

  private placeComputer(g: GLTF | undefined, desk: THREE.Object3D) {
    const holder = new THREE.Group();
    if (g) {
      const o = g.scene;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        // la pantalla: la imagen de la sala (la pinta drawScreen), con las UV del cristal de lado a lado
        if ((m.material as THREE.Material).name === 'Screen') {
          m.material = this.screenMat;
          const p = m.geometry.getAttribute('position'), uv = new Float32Array(p.count * 2);
          m.geometry.computeBoundingBox();
          const b = m.geometry.boundingBox!;
          for (let i = 0; i < p.count; i++) (uv[i * 2] = (b.max.z - p.getZ(i)) / (b.max.z - b.min.z)), (uv[i * 2 + 1] = (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
          m.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          m.userData.screen = true;
        }
      });
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()), k = 0.78 / Math.max(s.x, s.y, s.z), c = b.getCenter(new THREE.Vector3());
      o.scale.setScalar(k);
      o.position.set(-c.x * k, -b.min.y * k, -c.z * k);
      holder.add(o);
    } else {
      holder.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0x8e8a7c })));
    }
    holder.position.set(0.02, 0.775, 0);
    desk.add(holder);
    // la pantalla en el mundo: el centro del cristal y hacia dónde mira, para acercar la cámara
    desk.updateMatrixWorld(true);
    let sc = new THREE.Vector3(-H.x + 0.4, 1.1, -0.2);
    holder.traverse((c) => {
      if (c.userData.screen) new THREE.Box3().setFromObject(c).getCenter(sc);
    });
    sc = sc.clone();
    this.targets.push({ kind: 'computer', p: sc, reach: 2.3 });
    // la pizarra (en la pared sur, ver waitDecor.ts): se mira desde 1,5 m, algo a su derecha (mirando a +z, la derecha es -x) para que la pizarra quede en la mitad izquierda de la pantalla de la pantalla
    this.targets.push({ kind: 'board', p: new THREE.Vector3(-1.1, 1.5, H.z - 0.03), reach: 2.8 });
    // la vista: delante de la pantalla (mira a -x), a 0,34 m: el cristal llena casi todo el alto
    this.compPos.set(sc.x + 0.34, sc.y + 0.005, sc.z);
    this.compYaw = Math.PI / 2; // yaw = π/2 mira a -x
    this.compPitch = 0;
    this.compQuat.setFromEuler(new THREE.Euler(this.compPitch, this.compYaw, 0, 'YXZ'));
  }

  private placeButton(g: GLTF | undefined, top: THREE.Vector3) {
    const holder = new THREE.Group();
    if (g) {
      const o = g.scene;
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()), k = 0.4 / Math.max(s.x, s.z), c = b.getCenter(new THREE.Vector3());
      o.scale.setScalar(k);
      o.position.set(-c.x * k, -b.min.y * k, -c.z * k);
      holder.add(o);
      o.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.Material).name === 'Button') (this.button = m), (this.buttonZ0 = m.position.z);
      });
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xaa2222 }));
      m.position.y = 0.05;
      holder.add(m);
      this.button = m;
    }
    holder.position.copy(top);
    this.scene.add(holder);
    this.targets.push({ kind: 'button', p: top.clone().setY(top.y + 0.1), reach: 2.2 });
  }

  // ── el jugador ───────────────────────────────────────────────────────────

  /** De pie en el hueco `i`, mirando a la puerta. */
  spawn(i: number) {
    const s = WAIT_SPAWNS[i % WAIT_SPAWNS.length];
    this.pos.set(s.x, 0, s.z);
    this.yaw = 0;
    this.pitch = 0;
    this.seat = 'none';
    this.emote = 0;
  }

  private blocked(x: number, z: number) {
    if (Math.abs(x) > H.x - R || Math.abs(z) > H.z - R) return true;
    for (const b of this.boxes) if (x > b.x0 - R && x < b.x1 + R && z > b.z0 - R && z < b.z1 + R) return true;
    return false;
  }

  /** Lo que se manda a los demás (a 15 Hz): de pie donde estoy; ante el ordenador, mirándolo. */
  get state() {
    const pc = this.mode === 'computer' || this.mode === 'board' || (this.mode === 'free' && this.blend > 0.5);
    const anim = 'Neutral Idle'; // (el campo se conserva en el protocolo; el cuerpo lo lleva el Animator por movimiento)
    const t = this.targets[this.view === 'board' ? 1 : 0].p, yaw = pc ? Math.atan2(this.pos.x - t.x, this.pos.z - t.z) : this.yaw;
    return { x: this.pos.x, y: this.py, z: this.pos.z, yaw, pitch: pc ? 0 : this.pitch, anim, light: this.lit, duck: this.duckK > 0.5, held: this.held, emote: this.emote };
  }
  /** Salto y agachado (el Player de la sala de espera lo copia), y lo que se lleva (linterna encendida, objeto en la mano: lo pone game.ts). */
  py = 0;
  private vy = 0;
  duckK = 0;
  lit = false;
  held: 'none' | 'camera' | 'gun' = 'none';
  /** De pie y libre (ni sentado, ni ante la pantalla, ni en la entrada): entonces se ven las manos y los objetos del Player. */
  get driving() {
    return this.mode === 'free' && this.blend === 0 && this.seat === 'none' && !this.seq;
  }
  /** El clip del emote que se está haciendo con la cámara delante (para verse bailar; sentado en el suelo también), o '' si no hay. */
  get emoteClip() {
    return this.emote && this.mode === 'free' && this.seat !== 'chair' && this.emK > 0.15 ? EMOTE_DEFS[this.emote - 1].clip : '';
  }
  /** ¿Choca un círculo de la sala en (x, z)? (la física del Player de la sala de espera). */
  solid(x: number, z: number) {
    return this.blocked(x, z);
  }

  private get vendLabel() {
    const w = shopItem('water')!, inv = this.inv;
    const why = inv && !canHold(inv, 'water') ? `MAX ${INV_MAX.water}` : this.bank < w.price ? 'NO FUNDS' : '';
    return `ALMOND WATER $${w.price}${why ? ` · ${why}` : ''}`;
  }

  /** Lo que se lee en el aviso de «E» según a lo que se apunte. */
  get hintLabel() {
    switch (this.hint) {
      case 'computer': return 'COMPUTER';
      case 'board': return 'LEVEL BOARD';
      case 'button': return this.owner ? 'PRESS THE BUTTON' : 'BUTTON';
      case 'vending': return this.vendLabel;
      case 'chair': return 'SIT DOWN';
      case 'lamp': return this.decor.lampOn ? 'LAMP OFF' : 'LAMP ON';
      case 'stand': return 'STAND UP';
      default: return '';
    }
  }

  /**
   * Un emote (teclas 1–4): 1 saludar, 2 señalar, 3 aplaudir, 4 sentarse en el suelo. Volver a pulsarlo lo quita, y
   * moverse también. Con tiempo (1–3) se acaban solos. Los demás lo ven por `PlayerState.emote`.
   */
  doEmote(n: number) {
    if (this.mode !== 'free' || this.blend > 0 || this.seat === 'chair' || n < 1 || n > EMOTE_DEFS.length || !emoteOpen(n, emoteGate.have) || this.age - this.emoteAt < EMOTE_GAP * 1.5e-3) return;
    this.emoteAt = this.age;
    if (this.emote === n) return this.endEmote();
    this.emote = n;
    this.emoteUntil = EMOTE_LEN[n] ? this.age + EMOTE_LEN[n] : 0;
    if (EMOTE_DEFS[n - 1].sit) this.sitAt('floor');
    else if (this.seat === 'floor') this.seat = 'none';
  }
  private endEmote() {
    this.emote = 0;
    this.emoteUntil = 0;
    if (this.seat === 'floor') this.seat = 'none';
  }
  private sitAt(w: 'chair' | 'floor') {
    this.hop = { from: this.camera.position.clone(), t: 0 };
    this.seat = w;
    this.emote = 4;
    this.emoteUntil = 0;
    if (w === 'chair') {
      this.pos.set(SEAT.x, 0, SEAT.z);
      this.yaw = SEAT.yaw;
      this.pitch = 0;
    }
  }
  private standUp() {
    if (this.seat === 'none') return;
    this.hop = { from: this.camera.position.clone(), t: 0 };
    // del sillón, delante de él y fuera de su caja
    if (this.seat === 'chair') this.pos.set(SEAT.x - 0.9, 0, SEAT.z - 0.9);
    this.seat = 'none';
    this.emote = 0;
    this.emoteUntil = 0;
  }

  // ── cada fotograma ───────────────────────────────────────────────────────

  update(dt: number, c: Controls) {
    this.age += dt;
    if (this.seq) this.sequence(dt);
    else this.free(dt, c);
    this.lights(dt);
    this.corridor.update(dt, this.seq?.t ?? 0, this.hinge.rotation.y / 1.75, !!this.seq, this.reduced);
    this.props(this.age);
    this.decor.update(dt, this.age, this.p, this.pressed, this.seq && this.p[0] + this.p[1] < 0.2 ? 1 : 0);
    this.me.visible = this.mode !== 'computer' && this.mode !== 'board' && this.blend < 0.2 && this.seat !== 'chair';
    this.me.position.set(this.pos.x, 0.01, this.pos.z);
    // el botón se hunde (0,12 s) y, si el servidor no lo acepta, vuelve a su sitio
    if (this.pressed && !this.seq && this.age - this.pressedAt > 1.3) this.pressed = false;
    this.sink += ((this.pressed ? 1 : 0) - this.sink) * Math.min(1, dt * 22);
    if (this.button) this.button.position.z = this.buttonZ0 - this.sink * 0.38;
    if (this.noticeUntil && this.age > this.noticeUntil) (this.notice = ''), (this.noticeUntil = 0);
    // la pantalla: el cursor parpadea
    if (this.age - this.screenAt > 0.4) this.drawScreen(this.age);
  }

  private free(dt: number, c: Controls) {
    const want = this.mode === 'computer' || this.mode === 'board' ? 1 : 0;
    this.blend = clamp(this.blend + (want ? dt : -dt) / 0.7, 0, 1);
    if (this.mode === 'free' && this.blend === 0) {
      this.yaw -= c.look.x;
      this.pitch = clamp(this.pitch - c.look.y, -1.45, 1.45);
      const moving = c.move.length() > 0.05;
      if (this.seat !== 'none') {
        // sentado: quieto; moverse (o E) levanta
        this.speed = 0;
        this.hint = 'stand';
        if (c.bag || (moving && this.seat === 'floor') || (c.move.length() > 0.4 && this.seat === 'chair')) this.standUp();
      } else {
        // saltar y agacharse (como en las Backrooms: agachado se anda a la mitad y correr manda)
        const duck = !!c.crouch && !c.run && this.py <= 0;
        this.duckK += ((duck ? 1 : 0) - this.duckK) * Math.min(1, dt * 10);
        if (c.jump && this.py <= 0 && !duck) (this.vy = Math.sqrt(2 * 9.8 * 0.9)), this.endEmote();
        this.vy -= 9.8 * dt;
        this.py = Math.max(0, this.py + this.vy * dt);
        if (this.py === 0) this.vy = 0;
        const speed = moving ? (c.run ? RUN : WALK) * Math.min(1, c.move.length()) * (duck ? 0.5 : 1) : 0;
        const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
        const v = f.multiplyScalar(c.move.y).add(r.multiplyScalar(c.move.x));
        if (v.lengthSq() > 0) v.normalize().multiplyScalar(speed * dt);
        if (!this.blocked(this.pos.x + v.x, this.pos.z)) this.pos.x += v.x;
        if (!this.blocked(this.pos.x, this.pos.z + v.z)) this.pos.z += v.z;
        this.speed = speed;
        this.bob += speed * dt * 4.2;
        // un emote se acaba solo, o al moverse
        if (this.emote && ((this.emoteUntil && this.age > this.emoteUntil) || speed > 0)) this.endEmote();
        this.look();
        if (c.bag) (this.hint ? this.use(this.hint) : this.onBag?.());
      }
    } else {
      this.speed = 0;
      this.hint = null;
      if ((this.mode === 'computer' || this.mode === 'board') && c.bag) this.closeComputer();
    }
    // la cámara: de pie (con el paso), sentada o, ante el ordenador, la vista de la pantalla
    this.sit += ((this.seat === 'none' ? 0 : 1) - this.sit) * Math.min(1, dt * 7);
    const e = smooth(this.blend), cam = this.camera;
    const eye = EYE + (this.seat === 'chair' ? 1.1 - EYE : 0.85 - EYE) * this.sit;
    const y = eye + this.py - 0.6 * this.duckK + (this.reduced || this.py > 0 ? 0 : Math.sin(this.bob) * 0.012 * Math.min(1, this.speed));
    const vp = this.view === 'board' ? this.boardPos : this.compPos, vq = this.view === 'board' ? this.boardQuat : this.compQuat;
    cam.position.set(this.pos.x, y, this.pos.z).lerp(vp, e);
    _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    cam.quaternion.copy(_q).slerp(vq, e);
    // con un emote en marcha, la cámara se pone delante para verte bailar (y vuelve a tus ojos al acabar); la sala es pequeña: sin salirse de ella
    this.emK += ((this.emote && this.mode === 'free' && this.seat !== 'chair' ? 1 : 0) - this.emK) * Math.min(1, dt * 5);
    if (this.emK > 0.01) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), cx = WAIT_HALF.x - 0.25, cz = WAIT_HALF.z - 0.25, at = (d: number) => _v.set(clamp(this.pos.x + fx * d, -cx, cx), 1.35 + this.py * 0.5, clamp(this.pos.z + fz * d, -cz, cz));
      let tp = at(2.3).clone();
      if (Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) < 1.5) tp = at(-2.3).clone(); // (contra una pared: por detrás)
      const look = new THREE.Vector3(this.pos.x, 0.95 + this.py * 0.6, this.pos.z), qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(tp, look, new THREE.Vector3(0, 1, 0)));
      const k = smooth(this.emK);
      cam.position.lerp(tp, k);
      cam.quaternion.slerp(qd, k);
    }
    // al sentarse o levantarse, la cámara viaja (no salta)
    if (this.hop) {
      this.hop.t += dt / 0.45;
      cam.position.lerpVectors(this.hop.from, cam.position, smooth(this.hop.t));
      if (this.hop.t >= 1) this.hop = undefined;
    }
  }

  /** A qué se apunta: lo más centrado en la vista y a mano. */
  private look() {
    const eye = _v.set(this.pos.x, EYE, this.pos.z), fwd = _f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    let best = 0.82;
    this.hint = null;
    for (const t of this.targets) {
      const d = _d.copy(t.p).sub(eye), dist = d.length();
      if (dist > t.reach) continue;
      const cos = d.divideScalar(dist).dot(fwd);
      if (cos > best) (best = cos), (this.hint = t.kind);
    }
  }

  private use(what: Hint) {
    if (what === 'board') {
      this.endEmote();
      this.mode = 'board';
      this.view = 'board';
      this.hint = null;
      this.onBoard?.(true);
    } else if (what === 'computer') {
      this.endEmote();
      this.mode = 'computer';
      this.view = 'pc';
      this.hint = null;
      this.onComputer?.(true);
    } else if (what === 'button') {
      if (this.owner) {
        this.press();
        this.onPress?.();
      } else {
        this.say('OWNER ONLY');
        this.sfx?.('click');
      }
    } else if (what === 'chair') {
      this.sitAt('chair');
      this.sfx?.('click');
    } else if (what === 'vending') {
      const w = shopItem('water')!;
      if (this.decor.dispensing || this.vendBusy) return;
      if (this.inv && !canHold(this.inv, 'water')) return this.say(`YOU CANNOT CARRY MORE WATER (${INV_MAX.water})`), this.sfx?.('click');
      if (this.bank < w.price) return this.say(`NOT ENOUGH MONEY · $${w.price}`), this.sfx?.('click');
      this.vendBusy = true;
      this.onVend?.((r) => {
        this.vendBusy = false;
        if (!r.ok) return this.say((r.error ?? 'COULD NOT BUY').toUpperCase());
        this.decor.dispense(this.age);
        this.sfx?.('vend');
        this.say(`BOUGHT ALMOND WATER · $${w.price}`);
      });
      setTimeout(() => (this.vendBusy = false), 2000);
    } else if (what === 'lamp') {
      this.decor.toggleLamp();
      this.sfx?.('click');
    }
  }

  /** Cierra el ordenador o la pizarra, el que esté abierto. */
  closeComputer() {
    if (this.mode !== 'computer' && this.mode !== 'board') return;
    const was = this.mode;
    this.mode = 'free';
    (was === 'board' ? this.onBoard : this.onComputer)?.(false);
  }

  /** El nivel al que lleva la puerta, en la pizarra de la pared. */
  setBoard(round: number, levelId: string) {
    this.decor.setBoard(round, levelId);
  }

  private scaleCv = Object.assign(document.createElement('canvas'), { width: 256, height: 128 });
  private scaleTex = new THREE.CanvasTexture(this.scaleCv);
  /** El visor de la báscula: lo último vendido (nombre, rareza y precio) o, sin nada, cómo se usa. */
  sold(s?: Sold) {
    const x = this.scaleCv.getContext('2d')!;
    x.fillStyle = '#0b1408';
    x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#3d5a2a';
    x.lineWidth = 4;
    x.strokeRect(4, 4, 248, 120);
    x.textAlign = 'center';
    x.font = 'bold 20px ui-monospace, Consolas, monospace';
    x.fillStyle = '#7fd35a';
    x.fillText(s ? 'SOLD' : 'SCALE', 128, 30);
    if (s) {
      x.fillStyle = '#' + rarity(s.r).color.toString(16).padStart(6, '0');
      x.font = 'bold 18px ui-monospace, Consolas, monospace';
      x.fillText(`${rarity(s.r).name} ${s.name}`.slice(0, 22), 128, 62);
      x.fillStyle = '#e8f7c8';
      x.font = 'bold 34px ui-monospace, Consolas, monospace';
      x.fillText(`+$${s.price}`, 128, 104);
    } else {
      x.fillStyle = '#9fc48a';
      x.font = 'bold 17px ui-monospace, Consolas, monospace';
      x.fillText('DROP AN ITEM HERE', 128, 66);
      x.fillText('TO SELL IT', 128, 92);
    }
    this.scaleTex.needsUpdate = true;
    if (s) this.say(`${s.by} SOLD ${s.name} · +$${s.price}`);
  }

  /** Un aviso corto sobre la escena. */
  say(t: string) {
    this.notice = t;
    this.noticeUntil = this.age + 2.2;
  }

  private press() {
    if (this.pressed) return;
    this.pressed = true;
    this.pressedAt = this.age;
    this.sfx?.('thunk');
  }

  /** Lo que sabe de la sala la pantalla del ordenador (una línea por fila). */
  setScreen(lines: string[]) {
    this.screenLines = lines;
    this.drawScreen(this.age);
  }

  private drawScreen(t: number) {
    this.screenAt = t;
    const x = this.screenCv.getContext('2d')!;
    x.fillStyle = '#08100a';
    x.fillRect(0, 0, 256, 192);
    x.fillStyle = '#c8d6bf';
    x.font = 'bold 15px ui-monospace, Consolas, monospace';
    x.textBaseline = 'top';
    const rows = this.screenLines.length ? this.screenLines : ['BACKROOMS', 'WAITING ROOM'];
    rows.slice(0, 9).forEach((l, i) => x.fillText(l.slice(0, 24), 14, 14 + i * 19));
    if (Math.floor(t * 2.5) % 2 === 0) x.fillRect(14, 14 + Math.min(rows.length, 9) * 19 + 2, 10, 15);
    x.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < 192; y += 3) x.fillRect(0, y, 256, 1);
    this.screenTex.needsUpdate = true;
  }

  // ── la luz ───────────────────────────────────────────────────────────────

  /** Lo encendido que está cada fluorescente (0–1). */
  private p: [number, number] = [1, 1];

  private lights(dt: number) {
    void dt;
    const t = this.age, s = this.seq, D = this.reduced ? SHORT : FULL;
    let l1 = 1, l2 = 1;
    if (!s) {
      // el primero, casi siempre firme y a rachas un parpadeo corto; el segundo, más enfermo y con otro compás
      const burst = !this.reduced && Math.sin(t * 0.37) + Math.sin(t * 1.13 + 1) > 1.75;
      if (burst && hash(Math.floor(t * 16)) < 0.45) l1 = 0.3;
      if (!this.reduced && Math.sin(t * 0.91 + 2) + Math.sin(t * 2.3) > 1.2 && hash(Math.floor(t * 11) + 50) < 0.55) l2 = 0.2;
    } else {
      // al pulsar: parpadean cada vez más y se van, uno detrás de otro
      const u = s.t;
      const go = (off: number, seed: number) => (u < 0.3 ? 1 : u > off ? 0 : hash(Math.floor(u * 20) + seed) < 0.3 + (u / off) * 0.65 ? 0.08 : 0.9);
      l1 = go(D.off1, 0);
      l2 = go(D.off2, 90);
    }
    this.p = [l1, l2];
    this.power = Math.max(l1, l2 * 0.6);
    this.tubes.forEach((tb, i) => (tb.intensity = this.p[i] * TUBE[i]));
    this.tubeMats.forEach((m, i) => m.color.setRGB(0.07 + 0.93 * this.p[i] * 0.82, 0.06 + 0.9 * this.p[i] * 0.78, 0.04 + 0.8 * this.p[i] * 0.62));
    // lo que se cuela por debajo de la puerta, y mucho más al abrirla
    const open = this.hinge.rotation.y / 1.75;
    this.doorLight.intensity = 3 + open * 30;
    const g = 0.7 + open * 0.3;
    this.strip.color.setRGB(1 * g, 0.78 * g, 0.34 * g);
    // la alarma: una luz roja que pulsa sobre la puerta mientras suena
    const al = s && D.alarmB > 0 && s.t > D.alarmA && s.t < D.alarmB + 0.4 ? (0.35 + 0.65 * Math.max(0, Math.sin(s.t * 5.5))) * 16 * (1 - smooth((s.t - D.alarmB) / 0.4)) : 0;
    this.alarmLight.intensity = al;
    // la niebla se aclara a amarillo con la puerta abierta (si no, el pasillo se hundiría en negro)
    const fog = this.scene.fog as THREE.Fog, bg = this.scene.background as THREE.Color;
    bg.copy(FOG0).lerp(HAZE, open);
    fog.color.copy(bg);
    fog.near = 6 - 2 * open;
    fog.far = 20 + 14 * open;
  }

  // ── la entrada ───────────────────────────────────────────────────────────

  /** Empieza la entrada por la puerta (la fase `starting`): vale una sola vez por sala. */
  begin() {
    if (this.seq) return;
    if (this.mode === 'computer') this.onComputer?.(false);
    if (this.mode === 'board') this.onBoard?.(false);
    if (this.seat !== 'none') this.standUp();
    this.emote = 0;
    this.mode = 'starting';
    this.hint = null;
    const from = this.camera.position.clone(), fromQ = this.camera.quaternion.clone();
    this.seq = { t: 0, from, fromQ };
    if (!this.pressed) this.press();
    this.sfx?.('click');
    if (!this.reduced) {
      const z0 = -H.z;
      const p2 = new THREE.Vector3(0, 1.58, z0 + 1.3);
      const p1 = from.clone().lerp(p2, 0.5).setY(1.6);
      this.seq.curve = new THREE.CatmullRomCurve3([from, p1, p2, new THREE.Vector3(0, 1.58, z0 - 1.6), new THREE.Vector3(0, 1.56, -14.5)], false, 'centripetal');
    }
  }

  get entering() {
    return !!this.seq;
  }

  /** Se cumple cuando la entrada ha terminado (si no había empezado, la empieza). */
  whenDone() {
    this.begin();
    return this.done ? Promise.resolve() : new Promise<void>((r) => this.waiters.push(r));
  }

  private sequence(dt: number) {
    const s = this.seq!, D = this.reduced ? SHORT : FULL, t = (s.t += dt), cam = this.camera, c = this.cue;
    // los avisos de sonido, una sola vez cada uno: la alarma, el golpe de la cerradura, el chirrido de los goznes
    if (D.alarmB > 0 && !c.alarm && t > D.alarmA) (c.alarm = true), this.sfx?.('alarm');
    if (D.alarmB > 0 && !c.alarmOff && t > D.alarmB) (c.alarmOff = true), this.sfx?.('alarmoff');
    if (!c.boom && t > D.boom) (c.boom = true), this.sfx?.('boom');
    const d = smooth((t - D.doorA) / (D.doorB - D.doorA));
    if (!c.creak && d > 0) (c.creak = true), this.sfx?.('creak');
    this.hinge.rotation.y = d * 1.75;
    if (s.curve) {
      // el travelling: despacio hacia la puerta, y al cruzar el umbral acelera por el pasillo con la lente abriéndose
      const x = clamp((t - D.camA) / (D.camB - D.camA), 0, 1), u = x * x * x;
      const p = s.curve.getPointAt(u), ahead = s.curve.getPointAt(Math.min(1, u + 0.06));
      const ramp = smooth(t / 1.2), run = smooth((t - 3.8) / 2.5);
      // cámara en mano: el paso, un balanceo lento y un temblor leve
      cam.position.set(p.x + Math.sin(t * 3.1) * 0.012 * ramp, p.y + (Math.sin(t * 7.4) * 0.016 + Math.sin(t * 11.3) * 0.03 * run) * ramp, p.z);
      _m.lookAt(p, _v.set(ahead.x, 1.45, ahead.z), _up);
      _q.setFromRotationMatrix(_m);
      cam.quaternion.copy(s.fromQ).slerp(_q, smooth(t / 1.6));
      cam.rotateZ((Math.sin(t * 1.7) * 0.012 + Math.sin(t * 5.3) * 0.006 + Math.sin(t * 9) * 0.01 * run) * ramp);
      const fov = 70 + 20 * run;
      if (cam.fov !== fov) (cam.fov = fov), cam.updateProjectionMatrix();
    }
    this.black = smooth((t - D.fadeA) / (D.fadeB - D.fadeA));
    if (t >= D.total && !this.done) {
      this.done = true;
      this.waiters.splice(0).forEach((r) => r());
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Libera todo lo que se creó aquí (las texturas y mallas del juego, que son compartidas, no). */
  dispose() {
    this.waiters.splice(0).forEach((r) => r());
    if (this.cue.alarm && !this.cue.alarmOff) this.sfx?.('alarmoff');
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.userData.shared) {
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
          mat.dispose();
        }
      }
    });
    for (const m of this.own) m.dispose?.();
    for (const t of this.tex) t.dispose();
    this.screenTex.dispose();
    this.screenMat.dispose();
    this.scene.clear();
  }
}

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
