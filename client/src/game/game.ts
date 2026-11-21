import { bugWatch, report } from '../telemetry';
import { DEV_LOCAL } from '../devGate';
import { claimPickup } from '../pickup-claim';
import { dlog } from '../dlog';
import * as THREE from 'three';
import { glow, lootModel, pulse } from './rarityFx';
import { itemModel, loadItemModels } from './itemModels';
import { perks } from './perks';
import { loadLods } from './lods';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { compileGently } from './compile';
import { perf } from '../perf';
import { emoteGate } from './emotes';
import { CELL, SUITE_L, generateMaze, suitesMaze, wrapX } from './maze';
import { mazeHash, stateHash } from '@backrooms/shared';
import { World, center, HEIGHT } from './world';
import { FLASH } from './lightmap';
import { Input, type Controls } from './input';
import { Player, EYE, fit, CAM_AIM_SLOW } from './player';
import { HOT } from './quickslots';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FilmShader, VhsShader } from './vhsPass';
import { GameAudio } from './audio';
import { Items, type Target } from './items';
import { Entity, type Kind } from './entity';
import { Shatter } from './shatter';
import { unlock } from '../achievements';
import { Remote } from './remote';
import { voice, type VoicePos } from '../voice';
import { gridWorld } from '@phoenyx/voice';
import { Minimap } from './minimap';
import { Gadgets, ROLL } from './gadgets';
import { loadAnimations } from './anim/animator';
import type { RunLevel, RunHud } from './runlevel'; // (el nivel rojo y la sala de espera se bajan al usarlos: cada uno es un trozo aparte)
import { PoolTest } from './pool';
import { PoolLevel, loadPoolKit, type PoolKit } from './poolmap';
import type { ParkingRound } from './parking-round';
import type { WaitingRoom } from './waiting';
import { Tvs } from './mission';
import { holdStill } from './still';
import { netStats, type Sock } from '../net';
import { worldTl } from './interp';
import { ANISO, FPS_CAPS, setSetting, settings } from '../settings';
import { loadTapes, saveTape } from './tapes';
import { watchCanvas } from '../errlog';
import { gearIcons } from './invIcons';
import { prepAvatar } from './InvAvatar';
import { ParkingPickups } from './parking-pickups';
import { Epilogue, findSpot, type Actor, type Arena, type Stage } from './epilogue';
import { POOL_CELL, WAIT_HALF, EMOTE_DEFS, type RoundResult, type Sold } from '@backrooms/shared';
import { type LockerItem, RIFLE_MAG, canHold, ITEM_IDS, START_INV, type AdminFx, makeMission, missionLine, tvCount, type ActiveMission, type Inventory, type ItemId, type MissionKind, type Maze, type LevelCaps, levelCaps, NOISE_RUN, NOISE_SHOT, NOISE_PHOTO, type Noise } from '@backrooms/shared';
import { Explosion } from './explosion';
import { Breath, HEIGHT as ENT_HEIGHT, DEFAULT_LOOK, EEH_HOLD, HIT_DAMAGE, HP_MAX, MONSTER, PILLS, GLASSES, SUITE_FLOORS, REVIVE_IMMUNE, boostOf, totemSpot, type Look, hideStates, tickHides, startOffset, type HideState, type PlayerState, type RoomView, type ToolFx, type WorldSnapshot, FLIGHT_DT, flight } from '@backrooms/shared';
import { parkingOptionsForMission, PARKING_HEIGHT, isEeh } from '@backrooms/shared';
import { ITEMS, PARKING_ITEM_IDS, type ParkingItemId } from '@backrooms/shared';

/** Lo que el juego necesita de una sala: el socket y quién soy. */
export interface Mp {
  sock: Sock;
  id: string;
  /** Segundos de luz de cada linterna (según la dificultad de la sala). */
  life?: number;
  /** Jugadores al empezar: de ellos depende cuántos recursos hay en el suelo (lo mismo calcula el servidor). */
  players?: number;
  /** Mi puesto en la sala (para no salir todos en el mismo punto). */
  index?: number;
  /** Mi inventario según el servidor (la tienda y lo conservado): es con lo que empiezo la ronda. Sin él, el de quien llega nuevo. */
  inv?: Inventory;
  /** La misión elegida en la pizarra (con su progreso al empezar). */
  mission?: ActiveMission | null;
  /** El nivel de la ronda (LEVELS): por ahora level0 (el laberinto) o poolrooms. */
  level?: string;
  /** Las Suites: la planta (1-5). */
  floor?: number;
  /** Capacidades del nivel que manda el servidor (LevelCaps): qué componentes del jugador están activos. */
  caps?: LevelCaps;
}

/** Lo que enseña el inventario. */
export interface Inv {
  hand: 'none' | 'camera' | 'gun' | 'watergun';
  left: 'none' | 'flashlight' | 'glasses';
  belt: 'none' | 'camera' | 'gun';
  stamina: number;
  sanity: number;
  escaped: boolean;
  camera: boolean;
  gun: boolean;
  ammo: number;
  spare: number;
  tapes: number;
  photos: number;
  thumbs: string[];
  /** Las mismas fotos en grande (para el zoom y la descarga). */
  full: string[];
  flashOn: boolean;
  battery: number; // la camcorder
  charge: number; // lo que le queda a la linterna (0–1)
  spares: number; // linternas de repuesto en la mochila
  water: number; // latas de Almond Water
  totem: number; // Tótems de la vida
  /** Carta Uno Reverse y latas de Monster; `rainbow`: bebiendo una o con su efecto (la barra de aguante es un arcoíris). */
  uno?: boolean;
  monster?: number;
  glasses?: boolean;
  pills?: number;
  steelcard?: boolean;
  beer?: number;
  pokeball?: boolean;
  nokia?: boolean;
  bat?: boolean;
  grenade?: number;
  rainbow?: boolean;
  radar: boolean;
  /** Tiene cinta de acordonar. */
  caution: boolean;
  /** Lo que queda del rollo de cinta (0–1). */
  tape: number;
  /** La barra de acceso rápido: el objeto de cada ranura y la elegida. */
  hot: (string | null)[];
  hotSel: number;
  gadget: 'none' | 'caution' | 'radar' | 'totem';
  /** Poolrooms: la pistola de agua (se tiene) y lo que queda en su depósito (0–1). */
  watergun?: boolean;
  squirt?: number;
  /** Poolrooms: la bombona de buceo (se tiene). */
  tank?: boolean;
  /** La bombona puesta (si no, va en la mochila). */
  tankOn?: boolean;
}

/** La misión tal como la pinta el HUD. */
export interface MissionHud {
  kind: MissionKind;
  /** «PHOTOGRAPH 3 ENTITIES»... */
  text: string;
  /** «PHOTOS 1/3»... */
  line: string;
  progress: number;
  goal: number;
  done: boolean;
  /** La salida está abierta (alguna misión de la ronda cumplida). */
  exit: boolean;
}

/** Lo que el OSD enseña, leído desde React diez veces por segundo. */
export interface Hud {
  /** Las gafas están activas (el filtro de Warden). */
  warden?: number;
  /** Cuadros eléctricos que faltan por encender (el ascensor no abre sin corriente): activados y total. */
  power?: { on: number; n: number };
  /** Las puertas del ascensor están de verdad abiertas (se abren al acercarse, con la misión hecha y corriente). */
  liftOpen?: boolean;
  parkingItemHeld?: ParkingItemId;
  steelRoll?: { labels: string[]; winner: string; serial: number };
  /** Efectos activos del personaje (cuadraditos del HUD): positivos y negativos, con una fracción de lo que queda si dura un tiempo. */
  /** Selector de planta de la escalera de servicio (Las Suites): la de ahora y cuántas hay. */

  effects: { id: string; icon: string; label: string; kind: 'good' | 'bad'; frac?: number }[];
  bag: boolean;
  hint: string | null;
  /** Aviso corto de la cinta (rollo vacío...). */
  note: string | null;
  inv: Inv;
  aiming: boolean;
  /** La mira del rifle (la retícula). */
  scoped: boolean;
  zoom: number;
  focus: boolean;
  tapes: number;
  photos: number;
  ammo: number | null; // en el cargador; null sin el rifle
  spare: number;
  battery: number; // 0–1
  time: number; // segundos de grabación
  /** En una sala, muerto: el nombre del compañero por cuyos ojos se mira (vacío si no queda ninguno). */
  spectating: string | null;
  /** Espectador: los compañeros (el que se mira, marcado), si están vivos, y desde dónde se mira. */
  watchList?: { name: string; on: boolean; dead: boolean }[];
  specView?: 'eyes' | 'chase' | 'free';
  /** Cerca de un nicho y mirándolo: «E HIDE»; escondido: «E LEAVE». */
  hide: 'hide' | 'leave' | null;
  /** Mi vida (0–100) y la de los demás de la sala por id (según el servidor). */
  hp: number;
  hps: Record<string, number>;
  /** Bebiendo una lata de Almond Water: lo que lleva del trago (0–1; 0 si no). */
  drink: number;
  drinkName: string;
  /** Recargando la pistola de agua en un bebedero (0–1; 0 si no). */
  refill: number;
  /** Escondido: el aire (0–1), si una entidad lo inspecciona (hay que mantener Space) y si lo contiene. */
  breath: { air: number; warn: boolean; held: boolean } | null;
  /** Se juega sin el puntero capturado (se reanudó con Esc): un clic lo captura. */
  needClick: boolean;
  /** La misión de la ronda y su progreso (la línea del HUD: «PHOTOS 1/3», «TVS 2/4», «SURVIVE 3:20»). `done`: el ascensor está abierto. */
  mission: MissionHud | null;
  parking?: { floor: string; pendingFloors: string; prompt: string; repair: number | null; open: boolean };
  /** El diálogo de un Faceling: cuántas opciones (a ciegas) ofrece; 0 = cerrado. */
  talk: number;
  /** El panel del ascensor de Las Suites está abierto. */
  lift: boolean;
  /** Tras subir el primero al ascensor: si yo ya subí y los segundos que quedan para cerrar la ronda. Null si nadie ha subido. */
  ascent: { boarded: boolean; left: number } | null;
  /** La tienda del Faceling está abierta (Las Suites). */
  shop: boolean;
  /** Lo que haría G ahora si no es recoger algo («TURN OFF TV»). */
  act: string | null;
  /** El Tótem de la vida: el selector (compañeros caídos a los que se puede revivir; null cerrado), el nivel «Run for your life» si lo estoy corriendo, los avisos y los segundos de inmunidad que quedan. */
  totem: { pick: { id: string; name: string }[] | null; phone?: boolean; run: RunHud | null; notes: string[]; immune: number };
}

const _aim = new THREE.Vector2(0, 0), _spec = new THREE.Vector3(), _want = new THREE.Vector3(), _none = new THREE.Vector2(), _feet = new THREE.Vector3(), _head = new THREE.Vector3(), _dir = new THREE.Vector3(), _eu = new THREE.Euler();

/*
 * Las backrooms: el juego de juegos/backrooms.exe. Sin React; el caparazón (Backrooms.tsx) lo carga,
 * lo arranca y lee su estado para el OSD.
 */

const DIR = '/models/backrooms/';
/** Segundos de viaje dentro del ascensor (ya con las puertas cerradas) antes de que la grabación se corte a negro. */
const RIDE = 3.5;
export const MODELS = ['hazmat', 'bacteria', 'partygoer', 'balloon', 'camcorder', 'vhs', 'gun', 'flashlight', 'water', 'elevator', 'vent', 'socket', 'exit', 'door', 'armchair', 'cabinet', 'shelf', 'chair', 'chair2', 'desk', 'crt', 'lamp', 'duct', 'radar', 'totem', 'hospital/stretcher', 'hospital/stools', 'hospital/curtain', 'hospital/extinguisher', 'hospital/cupboard', 'hospital/clock', 'hospital/exitdoor', 'hospital/locker', 'hospital/drip', 'hospital/wheelchair', 'hospital/shelf', 'suites/door', 'suites/bed', 'suites/sofa', 'suites/secretary', 'suites/faceling', 'suites/chair', 'suites/wardrobe', 'suites/table', 'suites/luggage', 'suites/bin', 'suites/mirror', 'suites/plant', 'suites/panel', 'suites/trolley', 'suites/cart', 'suites/camera', 'suites/control', 'suites/officechair', 'suites/cables', 'suites/tv'] as const;
export type ModelName = (typeof MODELS)[number];
/** Los modelos de Las Suites: solo hacen falta en ese nivel, así que no se bajan en la carga del menú (`ensureSuites`). */
export const SUITE_MODELS = MODELS.filter((m) => m.startsWith('suites/') && m !== 'suites/faceling'); // (el faceling sí: sale en las cintas del menú)
const SUITE_SET = new Set<string>(SUITE_MODELS);
/** Fotogramas dibujados por el juego (los lee el contador de FPS). */
export const drawn = { n: 0 };
export const TEXTURES =['wall', 'carpet', 'ceiling'] as const;

export interface Assets {
  gltf: Record<ModelName, GLTF>;
  tex: Record<(typeof TEXTURES)[number], THREE.Texture>;
}

/** Las fases de la carga y lo que pesa cada una en la barra (suman 1). Son estimaciones: se afinan aquí. */
export const LOAD_PHASES = [
  { label: 'DOWNLOADING MODELS', w: 0.4 },
  { label: 'BUILDING GEOMETRY', w: 0.2 },
  { label: 'COMPILING SHADERS', w: 0.3 },
  { label: 'RENDERING MENU TAPES', w: 0.1 },
] as const;
/** Cuánto lleva la carga: el total (0–1), la fase en curso (índice de LOAD_PHASES) y lo que lleva esa fase (0–1). */
export interface LoadProgress {
  f: number;
  phase: number;
  pf: number;
}
/** Cede el hilo para que se pinte el avance. Con tope: en una pestaña oculta no hay fotogramas y la carga no puede quedarse esperando. */
const paint = () =>
  new Promise<void>((r) => {
    const id = setTimeout(r, 50);
    requestAnimationFrame(() => (clearTimeout(id), setTimeout(r)));
  });

const lateP = new Map<string, Promise<void>>();
/** Baja modelos que la carga dejó para después y los pone en `assets.gltf` (una sola descarga por modelo). */
export function loadModels(assets: Assets, names: readonly string[]): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return Promise.all(
    names.map(
      (m) =>
        (assets.gltf as Record<string, GLTF | undefined>)[m]
          ? Promise.resolve()
          : (lateP.get(m) ??
            (lateP.set(
              m,
              loader.loadAsync(DIR + m + '.glb').then(
                (g) => void ((g.scene.userData.model = m), ((assets.gltf as Record<string, GLTF>)[m] = g)),
                (e) => (lateP.delete(m), Promise.reject(e)), // (un fallo no se queda guardado: la próxima petición reintenta)
              ),
            ),
            lateP.get(m)!)),
    ),
  ).then(() => undefined);
}
/** Los modelos de Las Suites (ver SUITE_MODELS). */
export const ensureSuites = (assets: Assets) => loadModels(assets, SUITE_MODELS);

/** Descarga todo, con el progreso en bytes (aproximado: lo que diga cada respuesta). */
export async function loadAssets(progress: (f: number) => void): Promise<Assets> {
  perf.mark('assets:start');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const eager = MODELS.filter((m) => !SUITE_SET.has(m));
  const urls = [...eager.map((m) => DIR + m + '.glb'), ...TEXTURES.map((t) => DIR + 'tex/' + t + '.webp')];  const got = new Map<string, number>(), total = new Map<string, number>();
  const tick = () => {
    let a = 0, b = 0;
    for (const u of urls) {
      const t = total.get(u) ?? 1;
      b += t;
      a += Math.min(t, got.get(u) ?? 0);
    }
    progress(a / b);
  };
  const on = (u: string) => (e: ProgressEvent) => {
    if (e.lengthComputable) total.set(u, e.total);
    got.set(u, e.loaded);
    tick();
  };
  const gltf = {} as Assets['gltf'], tex = {} as Assets['tex'];
  const tl = new THREE.TextureLoader();
  await Promise.all([
    loadLods(MODELS),
    ...eager.map((m) => loader.loadAsync(DIR + m + '.glb', on(DIR + m + '.glb')).then((g) => void ((g.scene.userData.model = m), (gltf[m] = g)))),
    ...TEXTURES.map((t) =>
      tl.loadAsync(DIR + 'tex/' + t + '.webp').then((x) => {
        x.wrapS = x.wrapT = THREE.RepeatWrapping;
        x.colorSpace = THREE.SRGBColorSpace;
        x.anisotropy = ANISO[settings.texFilter] ?? 4;
        tex[t] = x;
        got.set(DIR + 'tex/' + t + '.webp', 1);
        tick();
      }),
    ),
  ]);
  // sin mapa de entorno un metal puro (metalness 1, el valor por defecto de glTF) no refleja nada y se ve gris o negro:
  // las piezas del suelo (cinta, rifle, linterna, globo) se quedan con un poco de metal y su color propio
  for (const m of ['vhs', 'gun', 'flashlight', 'balloon', 'cabinet', 'shelf', 'chair', 'chair2', 'desk', 'crt', 'lamp', 'duct', 'radar'] as const)
    gltf[m].scene.traverse((o) => {
      const k = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (k?.isMeshStandardMaterial) k.metalness = Math.min(k.metalness, 0.25);
    });
  perf.mark('assets:end');
  return { gltf, tex };
}

/**
 * El juego. `load` lo descarga todo y compila los materiales con un laberinto de prueba (los de cada
 * partida comparten programas: no se vuelve a compilar al darle a Play); `start` monta una partida.
 */
export class BackroomsGame {
  private steelRoll?: NonNullable<Hud['steelRoll']> & { until: number };
  private lastFrameErr = '';
  private rollSerial = 0;
  private readonly xray = new THREE.Group();
  private readonly xrayMaterial = new THREE.LineBasicMaterial({ color: 0xff2525, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  private readonly xrayEdges = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private readonly throws = new Set<{ mesh: THREE.Object3D; path: THREE.Vector3[]; start: number; duration: number }>();
  private xrayNext = 0;
  /** Visión nocturna de las gafas: 0–1, suave; sube la exposición (sin luces nuevas, para no recompilar shaders) y `wardenSerial` reinicia la animación de hexágonos en cada activación. */
  private nvK = 0;
  private nvBase?: number;
  private nvLast = 0;
  private wardenSerial = 0;
  private wasGlasses = false;
  /** Las gafas (visión de Warden): una silueta que atraviesa las paredes sobre cada entidad (roja) y cada compañero (cian), al día cada fotograma. */
  private readonly warden = new Map<THREE.Object3D, THREE.Mesh>();
  private readonly wardenGeo = new THREE.CapsuleGeometry(0.3, 1.0, 4, 10).translate(0, 0.9, 0);
  private readonly wardenMats = [0xff3030, 0x35e0ff].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, toneMapped: false }));

  private wardenFrame(on: boolean, scene: THREE.Object3D) {
    if (!on) {
      for (const m of this.warden.values()) m.removeFromParent();
      this.warden.clear();
      return;
    }
    const live = new Set<THREE.Object3D>(), v = new THREE.Vector3();
    const mark = (root: THREE.Object3D, ally: boolean, h: number) => {
      live.add(root);
      let m = this.warden.get(root);
      if (!m) (m = new THREE.Mesh(this.wardenGeo, this.wardenMats[ally ? 1 : 0])), (m.renderOrder = 49), (m.frustumCulled = false), this.warden.set(root, m);
      if (m.parent !== scene) scene.add(m);
      root.getWorldPosition(v);
      m.position.set(v.x, v.y, v.z);
      m.scale.set(1, h, 1);
    };
    for (const e of this.entities) if (e.alive) mark(e.rig.root, false, ENT_HEIGHT[e.kind] / 1.8);
    for (const r of this.remotes.values()) if (!r.dead) mark(r.root, true, 1);
    for (const o of this.parking?.enemies?.bodies() ?? []) mark(o, false, 1); // (la Habitable Zone: skinwalkers y smilers, que no son `Entity`)
    for (const [k, m] of this.warden) if (!live.has(k)) (m.removeFromParent(), this.warden.delete(k));
  }

  private clearXray() {
    this.xray.clear();
    for (const edges of this.xrayEdges.values()) edges.dispose();
    this.xrayEdges.clear();
  }

  private itemEffects() {
    const now = performance.now(), player = this.player;
    for (const shot of this.throws) {
      const progress = (now - shot.start) / shot.duration;
      if (progress >= 1) {
        shot.mesh.removeFromParent();
        this.throws.delete(shot);
        const distance = this.camera.position.distanceTo(shot.path[shot.path.length - 1]);
        if (distance < 36) this.audio?.bottleBreak(1 / (1 + (distance / 8) ** 2));
      } else {
        const index = progress * (shot.path.length - 1), first = Math.floor(index);
        shot.mesh.position.copy(shot.path[first]).lerp(shot.path[Math.min(first + 1, shot.path.length - 1)], index - first);
        shot.mesh.rotation.x = progress * 16;
      }
    }
    const nvOn = !!player && !player.dead && !this.winning && player.glassesOn, ndt = Math.min(0.1, (now - this.nvLast) / 1000);
    this.nvLast = now;
    if (nvOn && !this.wasGlasses) this.wardenSerial++;
    this.wasGlasses = nvOn;
    this.nvK += ((nvOn ? 1 : 0) - this.nvK) * Math.min(1, ndt * 5);
    if (this.nvK > 0.005) {
      this.nvBase ??= this.renderer.toneMappingExposure;
      this.renderer.toneMappingExposure = this.nvBase * (1 + 0.85 * this.nvK);
    } else if (this.nvBase !== undefined) (this.renderer.toneMappingExposure = this.nvBase), (this.nvBase = undefined);
    this.wardenFrame(!!player && !player.dead && !this.winning && player.glassesOn, this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene));
    if (!player || player.dead || this.winning || !player.glassesOn) {
      if (this.xray.children.length) this.clearXray();
      return;
    }
    if (now < this.xrayNext) return;
    this.xrayNext = now + 200;
    this.xray.clear();
    const parking = this.parking;
    const pool = this.pool instanceof PoolLevel ? this.pool : undefined;
    const targets = parking ? parking.level.xrayTargets(parking.position.floor) : pool ? pool.pickups.xrayTargets() : this.items?.xrayTargets() ?? [];
    if (this.mission?.exit && !parking) {
      if (pool) targets.push(pool.exitModel);
      else if (this.world) targets.push(this.world.elevator);
    }
    const scene = parking?.level.scene ?? pool?.scene ?? this.scene;
    scene.add(this.xray);
    const box = new THREE.Box3(), distance = new THREE.Vector3();
    for (const target of targets) {
      if (box.setFromObject(target).clampPoint(player.pos, distance).distanceToSquared(player.pos) > 25 ** 2) continue;
      target.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        let edges = this.xrayEdges.get(mesh.geometry);
        if (!edges) {
          edges = new THREE.EdgesGeometry(mesh.geometry, 28);
          this.xrayEdges.set(mesh.geometry, edges);
        }
        const outline = new THREE.LineSegments(edges, this.xrayMaterial);
        outline.matrix.copy(mesh.matrixWorld);
        outline.matrixAutoUpdate = false;
        outline.renderOrder = 50;
        this.xray.add(outline);
      });
    }
  }
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  assets?: Assets;
  world?: World;
  // las luces, siempre las mismas (cambiar cuántas hay recompilaría todo): el cielo, la linterna y
  // cuatro puntos que se van a las lámparas más cercanas
  // (la luz del mapa va horneada: ver lightmap.ts; estas alumbran a los personajes y lo que se recoge)
  readonly hemi = new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 0.16);
  readonly flash = new THREE.SpotLight(0xfff6e0, 0, 22, 0.55, 0.75, 1.2);
  readonly points = Array.from({ length: 4 }, () => new THREE.PointLight(0xffefc6, 3, 7, 1.8));
  private clock = new THREE.Clock(false);
  private t = 0;
  readonly input: Input;
  readonly composer: EffectComposer;
  readonly vhs = new ShaderPass(VhsShader);
  readonly film = new ShaderPass(FilmShader);
  // el polvo del aire: una caja de 8 m que va con la cámara (cada mota da la vuelta al salirse); brilla
  // dentro del haz de la linterna y apenas se ve fuera
  private dust = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 1600 * 3 }, () => Math.random() * 8), 3)),
    new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBeam: { value: 1 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform vec3 uCam;
        uniform float uTime, uBeam, uPx;
        varying float vA;
        void main() {
          // a la deriva, lenta, y siempre en una caja de 8 m centrada en la cámara
          vec3 p = position + vec3(sin(uTime * 0.13 + position.y) * 0.4, -uTime * 0.03, cos(uTime * 0.11 + position.x) * 0.4);
          p = mod(p - uCam + 4.0, 8.0) - 4.0 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = length(mv.xyz);
          // el haz: el cono de la linterna (mira al frente desde la cámara), más fuerte cerca
          float beam = smoothstep(0.86, 0.97, dot(normalize(mv.xyz), vec3(0.0, -0.05, -1.0))) * uBeam * (1.0 - smoothstep(1.0, 7.0, d));
          // cada mota con su tamaño y su brillo, y un centelleo lento: unas pocas se ven siempre, flotando en la luz
          float h = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw = 0.65 + 0.35 * sin(uTime * (0.6 + h * 1.4) + h * 40.0);
          vA = (0.03 + 0.5 * beam) * (0.45 + h) * tw;
          gl_PointSize = uPx * (0.6 + h * 1.0) / max(d, 1.2); // las de muy cerca, no como pelotas
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * vA * (1.0 - smoothstep(0.1, 0.5, r)), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  audio?: GameAudio;
  private stepAcc = 0;
  corruption = 0;
  player?: Player;
  items?: Items;
  /** Las televisiones de la misión «TURN OFF THE TVS» (si es esa). */
  tvs?: Tvs;
  /** El aviso de G de la puerta que tienes delante (Las Suites). */
  private doorAct: string | null = null;
  /** La misión de la ronda: en una sala, la del servidor (progreso y si está cumplida); solo, una sencilla que se lleva aquí. */
  private mission: ActiveMission | null = null;
  /** Tras subir el primero: segundos que quedaban al llegar el aviso, cuándo llegó y quiénes han subido. */
  private ascent: { left: number; at: number; boarded: string[] } | null = null;
  onWin?: () => void;
  /** Una taquilla pide abrirse (el minijuego lo pone la interfaz); y devolver el control al cerrarla. */
  onLocker?: (id: string) => void;
  /** Un emote de la sala de espera (la rueda de Backrooms.tsx y las teclas 1–4). */
  emote(n: number) {
    this.waiting?.doEmote(n);
  }
  /** Las Suites: la planta en la que se está (el ascensor y la escalera solo suben a la siguiente) y el rayo con el que se apunta a los botones. */
  private floorNo = 1;
  private arriveFloor = 1;
  private travelTo = 0; // (la planta a la que voy, hasta que llega su mundo)
  private travelFrom = 0;
  /** Las Suites: voy a otra planta (el servidor me pasa a su sala; el cliente carga su mundo y entra en la cabina). */
  onTravel?: (f: number) => void;
  onTravelFail?: () => void;
  private arrive = 0; // (s que quedan del viaje al llegar a una planta superior)
  private readonly aimRay = new THREE.Raycaster();
  /** Las Suites: las cámaras de seguridad, vistas desde el puesto de la sala de control (A/D o clic cambian de cámara; E o G salen). -1 = no se usan. */
  private eehTyping = false;
  private camUse = -1;
  private camAx = 0;
  private camLast = 0;
  private camHud?: HTMLElement;
  private camKept: THREE.Object3D[] = [];
  private camVis = new Map<THREE.Object3D, boolean>();
  private camInt = new Map<THREE.Light, number>();
  private camTop?: HTMLElement;
  private camNoise?: HTMLCanvasElement;
  private camStatic = 0;
  private camOn() {
    const n = this.world?.maze.cams?.length ?? 0;
    if (!n || this.camUse >= 0) return;
    this.camUse = this.camLast % n;
    this.camVis = new Map(this.camera.children.map((o) => [o, o.visible])); // (las manos y la linterna quedan fuera de la imagen)
    const hud = (this.camHud = Object.assign(document.createElement('div'), { className: 'br-camhud' }));
    hud.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;font:700 clamp(12px,1.6vw,20px) monospace;color:#7dffb0;text-shadow:0 0 6px #000;padding:3vh 3vw;display:flex;flex-direction:column;justify-content:space-between;box-shadow:inset 0 0 0 3px rgba(125,255,176,0.35),inset 0 0 12vw rgba(0,0,0,0.8)';
    const noise = (this.camNoise = Object.assign(document.createElement('canvas'), { width: 160, height: 90 }));
    noise.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;opacity:0';
    this.camTop = document.createElement('div');
    const bottom = Object.assign(document.createElement('div'), { textContent: '◄ A  ·  D ►   CLICK: NEXT   E / G: LEAVE' });
    bottom.style.cssText = 'text-align:center;opacity:.85;position:relative';
    this.camTop.style.position = 'relative';
    hud.append(noise, this.camTop, bottom);
    (this.canvas.parentElement ?? document.body).append(hud);
    this.camStatic = 0.45;
    this.camLabel();
    this.audio?.click();
  }
  private camOff() {
    if (this.camUse < 0) return;
    this.camLast = this.camUse;
    this.camUse = -1;
    this.camVis.forEach((v, o) => (o.visible = v));
    this.camVis.clear();
    this.camInt.forEach((v, l) => (l.intensity = v));
    this.camInt.clear();
    this.camHud?.remove();
    this.camHud = this.camTop = this.camNoise = undefined;
    this.world?.setWatch(undefined);
    this.world?.vents?.hideHead(-1);
  }
  private camLabel() {
    const m = this.world?.maze, c = m?.cams?.[this.camUse];
    if (this.camTop && c) this.camTop.textContent = `● REC   CAM ${String(this.camUse + 1).padStart(2, '0')}/${m!.cams!.length}   ${c.name}`;
  }
  /** Con la vista en una cámara: cambiar de cámara con A/D o el clic, y ponerla donde está (barriendo). */
  private camFrame(c: Controls) {
    const n = this.world?.maze.cams?.length ?? 0;
    if (this.camUse < 0 || !n) return;
    const ax = c.move.x > 0.5 ? 1 : c.move.x < -0.5 ? -1 : 0, step = ax && ax !== this.camAx ? ax : c.fire ? 1 : 0;
    this.camAx = ax;
    if (step) ((this.camUse = (this.camUse + step + n) % n), (this.camStatic = 0.4), this.camLabel(), this.audio?.click());
  }
  private camPlace(dt = 0.016) {
    const v = this.world?.vents;
    if (this.camUse < 0 || !v) return;
    const p = v.camPose(this.camUse, this.t);
    v.hideHead(this.camUse);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.quaternion.setFromEuler(_eu.set(p.pitch, p.yaw, 0, 'YXZ'));
    this.camera.updateMatrixWorld(true);
    // (cada fotograma: el Player los vuelve a poner) las luces NO se ocultan, se apagan: cambiar la cuenta de luces recompilaba todos los shaders (el tirón al entrar y en cada cámara nueva)
    this.camera.children.forEach((o) => {
      const l = o as THREE.Light;
      if (l.isLight) (this.camInt.has(l) || this.camInt.set(l, l.intensity), (l.visible = true), (l.intensity = 0));
      else o.visible = false;
    });
    // la estática entre cámaras
    const n = this.camNoise;
    if (n) {
      this.camStatic = Math.max(0, this.camStatic - dt);
      n.style.opacity = String(Math.min(1, this.camStatic / 0.25));
      if (this.camStatic > 0) {
        const g = n.getContext('2d')!, im = g.createImageData(160, 90);
        for (let i = 0; i < im.data.length; i += 4) (im.data[i] = im.data[i + 1] = im.data[i + 2] = 40 + Math.random() * 190), (im.data[i + 3] = 255);
        g.putImageData(im, 0, 0);
      }
    }
  }
  /** Mirando las cámaras, todas las entidades se vuelven hacia ti (saben dónde estás) sin dejar de moverse. */
  private camWatch() {
    const p = this.player;
    if (this.camUse < 0 || !p) return;
    for (const e of this.entities) if (e.alive) e.rig.root.rotation.y = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    this.world?.setWatch(p.pos);
  }
  /** Las Suites: las rejillas de ventilación (E ante una te lleva a donde da) y el terminal de la sala de control (restaura el EEH). */
  private ventAct(cc: Controls): Controls {
    const p = this.player, w = this.world;
    if (!p || !w) return cc;
    const m = w.maze, x = p.pos.x, z = p.pos.z, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const v of m.vents ?? []) {
      const dx = v.x - x, dz = v.z - z, d = Math.hypot(dx, dz), [nx, nz] = D[v.face];
      if (d > 1.6 || (dx * fx + dz * fz) / (d || 1) < 0.45 || (x - v.x) * nx + (z - v.z) * nz < 0) continue; // cerca, mirándola y por su lado
      this.doorAct = v.to.z > 19 * CELL ? 'ENTER THE VENT' : 'CLIMB OUT';
      if (cc.grab) {
        this.audio?.click();
        p.spawn(new THREE.Vector3(v.to.x, 0, v.to.z), v.to.yaw);
        return { ...cc, grab: false };
      }
      return cc;
    }
    const st = m.control?.station;
    if (st && Math.hypot(st.x - x, st.z - z) < 2.3) {
      this.doorAct = 'USE THE SECURITY CAMERAS';
      if (cc.grab) (this.camOn(), (cc = { ...cc, grab: false }));
      return cc;
    }
    const k = m.control?.console;
    if (k && Math.hypot(k.x - x, k.z - z) < 2.2) {
      this.doorAct = this.eehTyping ? 'REBOOTING THE EEH…' : this.eehSnap ? 'REBOOT THE EEH' : 'EEH ONLINE';
      if (cc.grab && this.eehSnap && !this.eehTyping) {
        // teclear el reinicio (unos segundos, con la barra como la del agua de almendra); al acabar, el servidor lo confirma
        const at = _spec.set(k.x, 1.0, k.z);
        this.player?.onType && (this.player.onType = () => this.audio?.click());
        this.eehTyping = !!this.player?.typing(at, () => {
          this.eehTyping = false;
          this.mp?.sock.emit('eehRestore', (ok) => (this.note = { text: ok ? 'EEH REBOOTED · THE STAFF CALMS DOWN' : 'COULD NOT REBOOT THE EEH', until: performance.now() + 4000 }));
        }, 3.6);
        if (this.eehTyping && this.player) this.player.onType = () => this.audio?.click();
      }
      return cc.grab ? { ...cc, grab: false } : cc;
    }
    return cc;
  }
  /** ¿Estoy en una celda de los conductos con gas? */
  private inGas() {
    const w = this.world, p = this.player;
    if (!w || !p || !w.maze.gas?.length) return false;
    const cx = Math.floor(p.pos.x / CELL), cy = Math.floor(p.pos.z / CELL);
    return w.maze.gas.some((c) => c.x === cx && c.y === cy);
  }
  /** Se ha pulsado el botón de la planta `f` en la cabina: sube. */
  /** Las Suites: ir a otra planta, en el ascensor (la cabina sube o baja mientras llega el mundo nuevo) o por la escalera. */
  travel(f: number, stairs = false) {
    const p = this.player;
    if (!p || this.travelTo || !this.mp) return;
    this.travelTo = f;
    this.travelFrom = this.floorNo;
    p.frozen = p.lookFree = true;
    this.bagOpen = false;
    const cab = this.world?.cab;
    if (cab && !stairs) ((cab.target = f), cab.board());
    this.mp.sock.emit('ascend', p.inventory, f);
    this.onTravel?.(f);
    setTimeout(() => this.travelTo === f && this.travelFail(), 9000);
  }
  /** El servidor no me ha pasado de planta: se abre la cabina y sigo donde estaba. */
  travelFail() {
    const p = this.player, cab = this.world?.cab;
    this.travelTo = 0;
    if (p) p.frozen = p.lookFree = false;
    if (this.items) this.items.won = false;
    if (cab) ((cab.target = undefined), (cab.rideT = -1), cab.open());
    this.onTravelFail?.();
  }
  pickFloor(f: number) {
    if (!this.items) return;
    this.items.won = true;
    this.win(false, f);
  }
  /** El diálogo con un Faceling para otra misión: habla con glifos sin sentido y se elige a ciegas entre `n` opciones. */
  private talkN = 0;
  private openTalk(n: number) {
    this.talkN = n;
    this.input.clear();
    this.input.suspend = true;
    this.input.unlock();
  }
  closeTalk() {
    if (!this.talkN) return;
    this.talkN = 0;
    this.input.suspend = false;
    this.input.lock();
  }
  /** Elegida la opción `i` (sin saber qué misión es): el servidor da la que toca. */
  pickMission(i: number) {
    this.closeTalk();
    this.mp?.sock.emit('nextMission', i, () => ((this.note = { text: 'NEW MISSION', until: performance.now() + 2000 }), this.audio?.cue('equip')));
  }
  /** Una taquilla se ha abierto: su puerta gira y su contenido queda a la vista (lo coge cada jugador con G). */
  openLocker(id: string, items: LockerItem[], taken: boolean[]) {
    this.items?.openLocker(id, items, taken);
  }
  /** Ganado el minijuego de una taquilla con llave de la Habitable Zone: el servidor la da por forzada y se abre. */
  parkingUnlock(id: string) {
    this.sendState(true);
    this.mp?.sock.emit('parkingInteract', { kind: 'unlock', id });
    this.mp?.sock.emit('parkingInteract', { kind: 'door', id });
  }
  setLockerUi(on: boolean) {
    this.input.suspend = on;
    if (on) this.input.clear(), this.input.unlock();
    else this.input.lock();
  }
  private black = 0;
  private winning = false;
  entities: Entity[] = [];
  private shatters: Shatter[] = [];
  private balloons: THREE.Object3D[] = [];
  /** Segundos desde que se muere (-1: vivo). */
  private dying = -1;
  private killer?: Entity;
  // la sala
  mp?: Mp;
  /** Capacidades del nivel en curso (las del servidor; level0 si es solitario). */
  caps: LevelCaps = levelCaps('level0');
  private remotes = new Map<string, Remote>();
  /** La vida de cada jugador de la sala (0–100), según el servidor. */
  private hps: Record<string, number> = {};
  private gadgets?: Gadgets;
  private spare: Remote[] = [];
  /** El aspecto de cada jugador de la sala (lo manda el servidor con la sala). */
  private looks = new Map<string, Look>();
  /** Mi aspecto (el de mi cuenta o el de invitado) cuando no hay sala que lo dé. */
  myLook?: Look;
  private lookOf = (id?: string) => this.looks.get(id ?? '') ?? this.myLook ?? DEFAULT_LOOK;
  private entMap = new Map<number, Entity>();
  private offNet: (() => void)[] = [];
  private sendT = 0;
  private lastFrame = 0;
  private spectating = false;
  private watching = '';
  private specView: 'eyes' | 'chase' | 'free' = 'eyes';
  /** La vista de espectador de antes de pasar a la cámara libre (C vuelve a ella). */
  private specBack: 'eyes' | 'chase' = 'eyes';
  private freePos = new THREE.Vector3();
  private freeYaw = 0;
  private freePitch = 0;
  private specPos = new THREE.Vector3();
  private god = false;
  /** Consola de admin: solo si la cuenta es admin (Me.admin) o se está en desarrollo local. Cosmético (el cliente es del jugador): el servidor decide lo de las salas. */
  adminOn = false;
  private get adminOk() {
    return this.adminOn || DEV_LOCAL;
  }
  /** Consola de admin: trucos de este cliente (se aplican cada fotograma). */
  readonly cheats = { ammo: false, stamina: false, sanity: false, speed: 1, jump: 1, bright: false, slow: 1, minimap: false };
  private brightLight?: THREE.HemisphereLight;
  /** Consola de admin: sin luz y entidades quietas (solo en este cliente / en solitario). */
  private lightsOff = false;
  private entFrozen = false;
  private seed0 = 0;
  // los escondites (nichos de las paredes): en solitario los lleva la sim de las entidades; en una sala, el servidor
  private hides: HideState[] = [];
  private hideIdx = -1;
  private breath = new Breath();
  private holding = false;
  private inspected = false;
  private noise = 0;
  /** Solitario: los ruidos de este fotograma (carrera, disparo) para las entidades. */
  private noises: Noise[] = [];
  onDeath?: () => void;
  // el Tótem de la vida: el selector abierto, quién corre «Run for your life» (id → nombre), un aviso suelto y la inmunidad al volver
  private run?: RunLevel;
  /** El Player del nivel de antes, mientras dura «Run for your life» (el de la carrera es otro). */
  private runSaved?: Player;
  private pool?: PoolTest | PoolLevel;
  private parking?: ParkingRound;
  private parkingBoardRequest = 0;
  /** Los objetos soltados en la Habitable Zone (el PickupField de siempre, con plantas). */
  private parkPick?: ParkingPickups;
  private parkingToken = 0;
  private disposed = false;
  get inParking() { return !!this.parking; }
  private fx?: { ao: GTAOPass; smaa: SMAAPass };
  private bloom?: UnrealBloomPass;
  get bloomPass() { return this.bloom; }
  private nextDraw = 0;

  /** El halo de los fluorescentes, en vivo (en calidad baja no hay: nada que hacer). */
  setBloom(on: boolean) {
    if (this.bloom) this.bloom.enabled = on;
  }

  /** Resolución dinámica: si el equipo no llega a ~50 fps baja la resolución de dibujo de 0,1 en 0,1 (hasta 0,6) y la sube si le sobra de largo (>90 fps). Un paso cada 4 s, con la media de ese rato. */
  private drs = 1;
  private rescued = false;
  private alerted = false;
  /** Va muy mal (menos de ~15 fps ya a la resolución mínima, o limitado por la CPU): una sola vez por partida, para que el menú avise de qué se puede hacer. */
  onSlow?: (fps: number) => void;
  private fogBase = 40;
  /** Las sombras de la linterna, en vivo (el interruptor cambia el shader: una recompilación). */
  setShadows(on: boolean) {
    this.renderer.shadowMap.enabled = on;
    this.flash.castShadow = on;
  }
  /** Luces puntuales (EXTRA LIGHTS) y polvo (DUST): cuántas luces se mandan al shader cambia el programa, así que solo al cambiar el ajuste. */
  applyLooks() {
    const n = [0, 2, 4][settings.lights] ?? 4;
    this.points.forEach((l, i) => (l.visible = i < n));
    this.dust.visible = settings.dust;
  }
  private renderMs = 0;
  private drsAcc = { n: 0, ms: 0, t: 0 };
  private upStreak = 0;
  private drsAt = 0;
  private relayout?: () => void;
  private adapt(dt: number) {
    const a = this.drsAcc, cap = FPS_CAPS[settings.fpsLimit] ?? 0, now = performance.now();
    if (!settings.autoRes) return void (this.drs !== 1 && ((this.drs = 1), this.relayout?.()));
    // (dt > 2 s: cambio de pestaña o una carga, no es rendimiento; antes, con dt > 0,25 s —menos de 4 fps— jamás se actuaba, justo cuando más hacía falta)
    if (window.__capture || dt > 2 || document.hidden || !document.hasFocus() || (cap && cap < 60)) return void (a.n = a.ms = 0);
    if (dt > 0.25) return; // (un tirón suelto —cargar un nivel, reaparecer— no es lo que va a costar cada fotograma)
    (a.n++, (a.ms += dt * 1000));
    if (a.ms < 2500 || a.n < 4 || now - a.t < 1500) return; // (una ventana de 2,5 s de juego, sean los fotogramas que sean)
    const avg = a.ms / a.n;
    (a.n = a.ms = 0), (a.t = now);
    // si el fotograma lo come la CPU (mandar los dibujos), bajar píxeles no ayuda: se deja la resolución entera
    const cpuBound = this.renderMs > avg * 0.6;
    const down = avg > 200 ? 0.3 : avg > 100 ? 0.2 : 0.1;
    // sube otra vez si, al subir, el fotograma seguiria bajo ~18 ms (el coste de los pixeles crece con el cuadrado de la escala): antes solo subia por encima de 90 fps y se quedaba borroso para siempre
    const up = Math.min(1, this.drs + 0.1), canUp = up > this.drs && avg * (up / this.drs) ** 2 < 18;
    // (cada cambio de escala rehace los buffers y da un tirón: a subir solo tras dos ventanas seguidas que lo permitan, y nunca antes de 4 s del ultimo cambio)
    this.upStreak = canUp || cpuBound ? this.upStreak + 1 : 0;
    const wantUp = this.upStreak >= 2 && now - this.drsAt > 4000;
    const next = avg > 20 && !cpuBound ? Math.max(0.35, this.drs - down) : wantUp ? up : this.drs;
    if (next !== this.drs) ((this.upStreak = 0), (this.drsAt = now));
    if (Math.abs(next - this.drs) > 1e-3) ((this.drs = next), this.relayout?.());
    if (avg > 66 && (this.drs <= 0.45 || cpuBound) && !this.alerted) ((this.alerted = true), this.onSlow?.(Math.round(1000 / avg)));
    // si aun así va por debajo de ~10 fps (a la resolución mínima, o porque manda la CPU): lo opcional se apaga y queda guardado
    if (avg > 100 && (this.drs <= 0.4 || cpuBound) && !this.rescued) {
      this.rescued = true;
      (setSetting('bloom', false), setSetting('film', false), setSetting('dust', false), setSetting('lights', 0), setSetting('drawDist', 0), setSetting('poolAO', false), setSetting('shadows', 0));
      this.setShadows(false);
    }
  }

  /** El tope de fotogramas (ajuste FPS LIMIT): true si a este fotograma le toca saltarse el dibujo. */
  private capped() {
    // sin el foco (otra ventana encima): ni se dibuja a tope, 10 fotogramas por segundo bastan para que el juego siga vivo
    const cap = document.hasFocus() ? (FPS_CAPS[settings.fpsLimit] ?? 0) : 10;
    if (!cap) return false;
    const now = performance.now(), step = 1000 / cap;
    if (now < this.nextDraw - 2) return true; // (2 ms de margen: el reloj del navegador no es exacto)
    const n = this.nextDraw + step;
    this.nextDraw = n < now ? now + step : n; // (si se ha ido muy por detrás, vuelve a empezar de ahora)
    return false;
  }

  /** Oclusión ambiental (GTAO, antes del bloom) y antialiasing (SMAA, ya en sRGB) solo dentro de las Poolrooms y fuera de la calidad baja. */
  private poolFx(p?: PoolLevel) {
    const c = this.composer;
    if (this.fx && !p) {
      c.removePass(this.fx.ao), c.removePass(this.fx.smaa);
      this.fx.ao.dispose(), this.fx.smaa.dispose();
      this.fx = undefined;
    }
    if (!p || this.opts.low || (!settings.poolAO && !settings.poolAA)) return;
    if (!this.fx) {
      const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight, pr = this.renderer.getPixelRatio();
      const ao = new GTAOPass(p.scene, p.camera, (w * pr) >> 1, (h * pr) >> 1), smaa = new SMAAPass(w * pr, h * pr), draw = ao.render.bind(ao), size = ao.setSize.bind(ao);
      ao.setSize = (a: number, b: number) => size(a >> 1, b >> 1); // el AO a media resolución: cuesta la cuarta parte y apenas se nota
      ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 8 });
      ao.blendIntensity = 0.85;
      ao.render = (...a: Parameters<GTAOPass['render']>) => {
        const lv = this.pool instanceof PoolLevel ? this.pool : undefined;
        lv?.setWater(false), lv?.aoCull(true, 40, true);
        draw(...a);
        lv?.setWater(true), lv?.aoCull(false);
      };
      c.insertPass(ao, 1);
      c.insertPass(smaa, c.passes.findIndex((x) => x instanceof OutputPass) + 1);
      this.fx = { ao, smaa };
    }
    this.fx.ao.enabled = settings.poolAO; // (los ajustes AMBIENT OCCLUSION y SMOOTH EDGES, al entrar)
    this.fx.smaa.enabled = settings.poolAA;
    this.fx.ao.scene = p.scene;
    this.fx.ao.camera = p.camera;
  }
  private totemOpen = false;
  /** El selector abierto es el del Nokia (llamar a un compañero), no el del Tótem. */
  private phone = false;
  /** Con quién hablo por el Nokia ahora (ids). */
  private callPeers = new Set<string>();
  /** Efectos sueltos (proyectiles, humo): cada uno recibe `dt` y devuelve false al acabar. */
  private fxList: ((dt: number) => boolean)[] = [];
  private runners = new Map<string, string>();
  private note = { text: '', until: 0 };
  private immuneUntil = 0;
  private snap?: THREE.WebGLRenderTarget;
  // la camcorder que sale volando al morir: la vista es ella
  private fly?: { pos: THREE.Vector3; vel: THREE.Vector3; q: THREE.Quaternion; spin: THREE.Vector3; bounced: boolean };
  onPause?: () => void;
  private offs: (() => void)[] = [];
  private paused = false;
  bagOpen = false;
  private froze = false;
  // la sala de espera (ver waiting.ts): su escena sustituye a la del juego en el compositor mientras se está en el lobby
  waiting?: WaitingRoom;
  private waitTok = 0;
  private waitMp?: Mp;
  private waitPhase = '';
  private offWait: (() => void)[] = [];
  private fadeIn = 0;
  /** El ordenador de la sala de espera se abre o se cierra (lo oye el caparazón para sacar la pantalla de ajustes). */
  onWaitComputer?: (open: boolean) => void;
  /** La pizarra de misiones de la sala de espera se abre o se cierra. */
  onWaitBoard?: (open: boolean) => void;
  /** El inventario (E) abierto en la sala de espera. */
  onWaitBag?: (open: boolean) => void;
  onWaitLockers?: (open: boolean) => void;
  /** Nombre y foto de cada jugador de la sala (por puesto): van a las etiquetas de los casilleros. */
  lockerOwners: { name: string; avatar?: string }[] = [];
  setLockerOwners(list: { name: string; avatar?: string }[]) {
    this.lockerOwners = list;
    this.waiting?.setOwners(list);
  }
  waitBag = false;
  closeWaitBag() {
    if (!this.waitBag) return;
    this.waitBag = false;
    this.input.suspend = false;
    this.input.lock();
    this.onWaitBag?.(false);
  }
  /** Un aviso corto sobre la sala de espera. */
  waitSay(t: string) {
    this.waiting?.say(t);
  }
  /** Escenas prerenderizadas para la nieve del menú: cada una, unos fotogramas de una sala con entidades bailando (ver prerender). */
  stills: HTMLCanvasElement[][] = [];
  /** Sin sonido (lo decide el menú; se aplica al crear el audio si aún no existe). */
  muted = false;
  /** El volumen general de los ajustes (0–1). */
  volume = 1;

  constructor(readonly canvas: HTMLCanvasElement, readonly opts: { low: boolean; reduced: boolean }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    watchCanvas(canvas);
    if (/[?&]nogpulod/.test(location.search)) (this.renderer as unknown as { gpuDriven: boolean }).gpuDriven = false; // (depuración: sin LOD en GPU, para comparar capturas)
    this.renderer.localClippingEnabled = true; // (el agua dentro del depósito de la pistola de agua, poolmap.ts tankFx)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72; // sin la cinta encima, el amarillo quema
    // la sombra de la linterna, solo en escritorio y si el ajuste SHADOWS la deja (0 sin, 1 mapa de 512, 2 de 1024)
    const shadows = !opts.low && settings.shadows > 0, sm = settings.shadows === 1 ? 512 : 1024;
    this.renderer.shadowMap.enabled = shadows;
    this.flash.castShadow = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.flash.shadow.mapSize.set(sm, sm);
    this.flash.shadow.radius = 4; // sombra suave (el borde de una pared no corta seco)
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.camera.far = settings.shadows === 1 ? 14 : 22; // (SHADOWS LOW: el mapa solo cubre lo cercano, menos geometría dentro de la sombra)
    this.flash.shadow.bias = -0.002;
    this.input = new Input(canvas);
    // la imagen: escena, el halo de los fluorescentes (no en calidad baja), color de pantalla, el grano y,
    // mirando por la cámara, la cinta encima
    this.composer = new EffectComposer(this.renderer);
    // con el contexto WebGL perdido (la GPU lo suelta) no se pinta: pintar en ese estado lanza dentro de three y tumbaba la pantalla entera (o el cierre del juego)
    const paintScene = this.composer.render.bind(this.composer), gl = this.renderer;
    this.composer.render = (dt?: number) => {
      if (gl.getContext().isContextLost()) return;
      const t0 = performance.now();
      try {
        paintScene(dt);
      } catch (e) {
        if (!gl.getContext().isContextLost()) throw e;
      }
      this.renderMs += (performance.now() - t0 - this.renderMs) * 0.05; // (lo que tarda la CPU en mandar el fotograma: la resolución dinámica lo mira)
      this.tapeTick();
    };
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!opts.low) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.92);
      this.bloom.enabled = settings.bloom;
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.film);
    this.film.enabled = settings.film;
    this.composer.addPass(this.vhs);
    this.film.uniforms.uMove.value = opts.reduced ? 0 : 1;
    const u = this.vhs.uniforms;
    u.uMove.value = opts.reduced ? 0 : 1;
    u.uLow.value = opts.low ? 1 : 0;
    u.tPrev.value = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    u.tPrev.value.needsUpdate = true;
    this.scene.background = new THREE.Color(0x17130a);
    this.scene.fog = new THREE.Fog(0x17130a, 2.5, 40);
    this.scene.add(this.hemi, this.camera, this.dust, ...this.points);
    this.applyLooks();
    this.dust.frustumCulled = false;
    this.camera.add(this.flash, this.flash.target);
    // sale de la lente de la linterna (en la mano izquierda), hacia el centro de la vista
    this.flash.position.set(-0.13, -0.16, -0.5);
    this.flash.target.position.set(0, -0.3, -6);
    const resize = () => {
      // como mucho a 1080 líneas (y a la mitad en calidad baja): el grano y la cinta lo ablandan igual
      const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight, pr = Math.min(devicePixelRatio, 1080 / h) * (opts.low ? 0.6 : 1) * settings.resScale * this.drs;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.composer?.setPixelRatio(pr);
      this.composer?.setSize(w, h);
      this.vhs?.uniforms.uRes.value.set(w * pr, h * pr);
      if (this.vhs) this.vhs.uniforms.uAspect.value = w / h;
      this.film?.uniforms.uRes.value.set(w * pr, h * pr);
      this.run?.resize(w / h);
      this.pool?.resize(w / h);
      this.waiting?.resize(w / h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.paused) this.composer?.render(0); // el lienzo se borra al cambiar de tamaño: que la pausa no quede en negro
    };
    resize();
    addEventListener('resize', resize);
    this.relayout = resize;
    this.offs.push(() => removeEventListener('resize', resize));
    // al volver de otra pestaña/ventana el lienzo (sobre todo en WebGPU) puede haberse vaciado: en pausa no hay bucle que lo repinte, se hace aqui
    const repaint = () => {
      if (document.hidden || !this.paused) return;
      this.composer?.render(0);
      requestAnimationFrame(() => this.paused && this.composer?.render(0));
    };
    document.addEventListener('visibilitychange', repaint);
    addEventListener('focus', repaint);
    this.offs.push(() => (document.removeEventListener('visibilitychange', repaint), removeEventListener('focus', repaint)));
    const resumeParkingAudio = () => this.parking?.audio?.resume();
    canvas.addEventListener('pointerdown', resumeParkingAudio);
    this.offs.push(() => canvas.removeEventListener('pointerdown', resumeParkingAudio));
  }

  /** Quitar o devolver el sonido (vale también antes de empezar: se aplica al crear el audio). */
  setVolume(v: number) {
    this.volume = v;
    this.audio?.setVolume(v);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.audio?.setMuted(m);
    this.parking?.audio?.setLocalMute(m);
  }

  /**
   * La carga de la pantalla de título. `progress` recibe el avance de verdad (no un reloj): la fase en curso
   * (LOAD_PHASES) y cuánto lleva (bytes bajados, pasos de preparación hechos, programas compilados) y el total,
   * que pesa cada fase por su `w`. La interfaz lo pinta en Loading.tsx.
   */
  async load(progress: (p: LoadProgress) => void) {
    const at = (phase: number, pf: number) => {
      pf = Math.max(0, Math.min(1, pf));
      progress({ f: Math.min(1, LOAD_PHASES.slice(0, phase).reduce((a, p) => a + p.w, 0) + LOAD_PHASES[phase].w * pf), phase, pf });
    };
    at(0, 0);
    this.assets = await loadAssets((f) => at(0, f)); // fase 0: descargar modelos y texturas
    // fase 1: la geometría (el muñeco, las animaciones, un mundo de prueba con todo lo que pinta el juego); 6 pasos
    at(1, 0);
    await paint();
    prepAvatar(this.assets); // y el muñeco del inventario (con sus shaders compilados), listo antes de abrirlo
    at(1, 1 / 6);
    await loadAnimations().catch((e) => (console.error('animations', e), setTimeout(() => void loadAnimations().catch(() => {}), 8000))); // (el paquete de animaciones del jugador: sin él, los clips del modelo; si falla se reintenta)
    at(1, 2 / 6);
    at(1, 3 / 6);
    gearIcons(this.assets); // los iconos del inventario se pintan aquí, en la carga: la primera vez creaban un contexto WebGL y daban un tirón al abrirlo
    at(1, 4 / 6);
    await paint();
    // compilar con un laberinto cualquiera y el jugador con todo en las manos, en la pantalla de carga
    // (en Firefox, sin paralelo, es lento)
    const w = new World(generateMaze(1), this.assets), p = new Player(w, this.assets, this.camera, this.flash, true);
    for (const it of Object.values(p.items)) it.visible = true;
    this.scene.add(w.root);
    p.spawn(center(w.maze.start), 0);
    p.update(0, this.input.read());
    at(1, 5 / 6);
    await paint();
    // las dos entidades (con piel) y sus trozos al reventar (sin piel)
    const es = (['bacteria', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, w.maze.spawns[i] ?? w.maze.start));
    es.forEach((e) => e.update(0, p.pos, this.camera.position, null, true, true));
    w.root.add(Shatter.warm(es.map((e) => e.rig.root)));
    const warmItems = new Items(w, this.assets, p, this.camera); // y lo que se recoge (cintas, cámara y rifle en el suelo)
    // fase 2: los shaders (el avance es el de los programas ya compilados; el 15 % final es esperar a que el navegador termine)
    at(2, 0);
    await paint();
    await compileGently(this.renderer, this.scene, this.camera, undefined, (f) => at(2, f * 0.85));
    at(2, 0.9);
    // y las pasadas (con todo lo de antes ya compilado): con y sin VHS, que la última pinta a pantalla y es otro programa
    this.vhs.enabled = false;
    this.composer.render(0);
    this.vhs.enabled = true;
    this.composer.render(0);
    // fase 3: las escenas de la nieve del menú
    at(3, 0);
    await paint();
    this.stills = [...this.prerender(w, p, es), ...(await loadTapes())];
    warmItems.dispose();
    es.forEach((e) => e.dispose());
    p.dispose();
    w.dispose();
    at(3, 1);
    void this.later(); // lo que el menú no necesita (objetos, kit de las Poolrooms) se baja ya con el menú abierto
  }

  private ready = new Set<string>();
  private laterP?: Promise<void>;
  /** Objetos de ronda y kit de las Poolrooms: se bajan tras la carga del menú (una sola vez); `levelReady` los espera antes de montar un nivel. */
  private later() {
    return (this.laterP ??= Promise.all([loadItemModels(), loadPoolKit()]).then(() => {
      perf.mark('later:end');
      if (this.assets) gearIcons(this.assets); // (los iconos de lo que acaba de llegar se pintan ya, en el menú, no a media partida)
    }));
  }
  /** Todo lo que un nivel necesita y el menú dejó para después (objetos, kit y, en Las Suites, sus modelos); undefined si ya está. */
  private levelReady(level: string): Promise<unknown> | undefined {
    const a = this.assets;
    if (!a) return undefined;
    const parts: Promise<unknown>[] = [this.later()];
    if (levelCaps(level).hotel) parts.push(ensureSuites(a));
    return Promise.all(parts);
  }

  /** Grabar cintas para el menu: en niveles que no son la Lobby, cada ~40 s, 3 fotogramas (ver tapes.ts). Se copia en el mismo momento de pintar (el lienzo WebGPU no se puede leer despues). */
  private tape = { next: 0, last: 0, frames: [] as HTMLCanvasElement[] };
  private tapeTick() {
    const t = this.tape, now = performance.now();
    if (!this.player || this.paused || this.waiting || this.winning || this.dying >= 0 || document.hidden || this.opts.low || window.__capture) return;
    const lvl = this.mp?.level ?? (this.parking ? 'parking' : this.pool instanceof PoolLevel ? 'poolrooms' : 'level0');
    if (lvl === 'level0') return;
    if (!t.next) t.next = now + 15000;
    if (!t.frames.length && now < t.next) return;
    if (now - t.last < 250) return;
    const src = this.renderer.domElement, c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }), k = Math.max(320 / src.width, 180 / src.height);
    c.getContext('2d')!.drawImage(src, (320 - src.width * k) / 2, (180 - src.height * k) / 2, src.width * k, src.height * k);
    t.frames.push(c), (t.last = now);
    if (t.frames.length >= 3) (saveTape(lvl, t.frames), (t.frames = []), (t.next = now + 40000 + Math.random() * 30000));
  }

  /**
   * Las escenas de la nieve del menú, pintadas una vez con el mapa de prueba ya compilado: salas y pasillos
   * vistos desde el suelo, con una a tres entidades bailando; cada escena son 4 fotogramas de su baile, a
   * 320×180, que el menú saca de vez en cuando entre la nieve.
   */
  private prerender(w: World, p: Player, es: Entity[]) {
    const m = w.maze, cam = this.camera, out: HTMLCanvasElement[][] = [];
    p.rig.root.visible = false;
    for (const it of Object.values(p.items)) it.visible = false;
    this.vhs.enabled = false;
    const extra = (['bacteria', 'partygoer', 'faceling', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, m.spawns[i] ?? m.start));
    const pool = [...es, ...extra];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && !!m.open[y * m.w + x] && !m.voids.some((v) => v.x === x && v.y === y);
    const du = (this.dust.material as THREE.ShaderMaterial).uniforms;
    const shoot = () => {
      const src = this.renderer.domElement, c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }), k = Math.max(320 / src.width, 180 / src.height);
      c.getContext('2d')!.drawImage(src, (320 - src.width * k) / 2, (180 - src.height * k) / 2, src.width * k, src.height * k);
      return c;
    };
    cam.fov = 70;
    cam.updateProjectionMatrix();
    for (let tries = 0; out.length < 10 && tries < 600; tries++) {
      const cx = 1 + ((Math.random() * (m.w - 2)) | 0), cy = 1 + ((Math.random() * (m.h - 2)) | 0);
      if (!free(cx, cy)) continue;
      // hacia dónde hay más sitio libre en línea recta (se quiere profundidad: un pasillo o una sala)
      let best: { d: readonly [number, number]; len: number } = { d: DIRS[0], len: 0 };
      for (const d of DIRS) {
        let len = 0;
        while (len < 8 && free(cx + d[0] * (len + 1), cy + d[1] * (len + 1))) len++;
        if (len > best.len) best = { d, len };
      }
      if (best.len < 4) continue;
      const [dx, dz] = best.d, side = new THREE.Vector3(-dz, 0, dx);
      const eye = center({ x: cx, y: cy }, 1.3).addScaledVector(new THREE.Vector3(dx, 0, dz), -0.4);
      // una tercera parte con la linterna encendida: en las zonas apagadas no se vería nada
      const lit = !!m.lit[cy * m.w + cx], torch = !lit || Math.random() < 0.3;
      const n = 1 + (Math.random() < 0.7 ? 1 : 0) + (Math.random() < 0.45 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
      const cast = [...pool].sort(() => Math.random() - 0.5);
      cast.forEach((e, i) => {
        const on = i < n;
        e.rig.root.visible = on;
        if (e.balloon) e.balloon.visible = on;
        if (!on) return;
        const dist = Math.min(2.4 + i * 1.2 + Math.random() * 0.6, best.len * CELL - 0.3);
        // en un pasillo de una celda no hay sitio para apartarse; en una sala, sí
        const wide = free(cx + dx * Math.round(dist / CELL) + (side.x ? Math.sign(side.x) : 0), cy + dz * Math.round(dist / CELL) + (side.z ? Math.sign(side.z) : 0));
        const lateral = i === 0 || !wide ? 0 : (i % 2 ? 1 : -1) * (0.45 + Math.random() * 0.3);
        e.pos.copy(eye).setY(0).addScaledVector(new THREE.Vector3(dx, 0, dz), dist).addScaledVector(side, lateral);
        e.dance(eye);
      });
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(new THREE.Vector3(dx, -0.04, dz).multiplyScalar(8)).addScaledVector(side, (Math.random() - 0.5) * 0.8));
      cam.rotateZ((Math.random() - 0.5) * 0.12);
      cam.updateMatrixWorld(true);
      this.flash.intensity = torch ? FLASH : 0;
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < 4; f++) {
        // el baile avanza entre fotogramas (el primero, desde un punto cualquiera del clip)
        cast.slice(0, n).forEach((e) => e.update(f ? 0.16 : Math.random() * 3, eye, eye, null, false, true));
        w.update(this.t + f * 0.1, 0.1);
        w.lightsNear(cam.position).forEach((l, i) => (this.points[i].position.copy(l.pos), (this.points[i].intensity = 3 * l.level)));
        du.uCam.value.copy(cam.position);
        this.composer.render(0);
        frames.push(shoot());
      }
      out.push(frames);
    }
    extra.forEach((e) => e.dispose());
    this.flash.intensity = 0;
    return out;
  }

  start(seed: number, mp?: Mp) {
    // (los objetos y los modelos del nivel que la carga del menú dejó para después tienen que estar: si aún no, se espera y se arranca)
    if (!this.ready.has(mp?.level ?? this.devLevel ?? 'level0')) {
      const lv = mp?.level ?? this.devLevel ?? 'level0', wait = this.levelReady(lv);
      if (wait) return void wait.then(() => (this.ready.add(lv), this.start(seed, mp)), (e) => (console.error('level models failed to load', e), report('level', `level "${lv}" models failed to load`), this.onLevelError?.()));
      this.ready.add(lv);
    }
    if (mp?.level === 'parking') {
      void this.startParking(seed, mp).catch(error => {
        console.error('Habitable Zone failed to load', error);
        report('level', `level "${this.mp?.level ?? (this.parking ? 'parking' : 'level0')}" failed to load (floor ${this.floorNo}, seed ${this.seed0})`, 'error');
        this.onLevelError?.();
      });
      return;
    }
    this.endParking();
    this.seed0 = seed;
    this.fadeIn = this.waiting ? 0.9 : 0; // de la sala de espera a la partida: el negro de la entrada se abre
    this.leaveWaiting();
    this.stopMp();
    this.entities.forEach((e) => e.dispose());
    this.shatters.forEach((s) => s.dispose());
    this.shatters = [];
    this.spectating = false;
    for (const r of this.remotes.values()) r.setFirstPerson(false);
    this.endRun();
    this.totemOpen = false;
    this.immuneUntil = 0;
    this.gadgets?.dispose();
    this.tvs?.dispose();
    this.tvs = undefined;
    this.audio?.tvStatic(0);
    this.ascent = null;

    this.endPool();
    this.player?.dispose();
    this.items?.dispose();
    this.world?.dispose();
    this.black = 0;
    this.winning = false;
    this.viaStairs = false;
    this.dying = -1;
    this.killer = undefined;
    this.outT = -1;
    this.lightsOff = this.entFrozen = false;
    this.nextOut = 70 + Math.random() * 50;
    this.audio?.power(1);
    this.bagOpen = false;
    this.input.suspend = false;
    this.hideIdx = -1;
    this.holding = this.inspected = false;
    this.noise = 0;
    this.breath.reset();
    this.vhs.uniforms.uCorrupt.value = 0;
    this.hides = []; // (las Poolrooms no tienen nichos; sin esto quedan los de la ronda anterior)
    this.caps = mp?.caps ?? levelCaps(mp?.level ?? this.devLevel ?? 'level0');
    if (mp && this.caps.pool) return void this.startPool(seed, mp);
    // Las Suites: más luz de ambiente y la niebla más lejos (hotel cálido, no sótano); el resto de niveles, lo de siempre
    this.hemi.intensity = this.caps.hotel ? 0.45 : 0.16;
    (this.scene.fog as THREE.Fog).far = this.fogBase = this.caps.hotel ? 44 : 40;
    (this.scene.fog as THREE.Fog).color.set(this.caps.hotel ? 0x1d0c0a : 0x17130a);
    this.points.forEach((l) => l.color.set(this.caps.hotel ? 0xffd2a0 : 0xffefc6)); // las luces puntuales que dan el brillo al cuarzo: cálidas en el hotel
    if (this.bloom) (this.bloom.strength = this.caps.hotel ? 0.62 : 0.55), (this.bloom.threshold = this.caps.hotel ? 0.9 : 0.92), (this.bloom.radius = this.caps.hotel ? 0.9 : 0.6);
    // desarrollo: &god, inmortal
    this.god = !mp && DEV_LOCAL && new URLSearchParams(location.search).has('god');
    const w = (this.world = new World(this.caps.hotel ? suitesMaze(seed, mp?.floor) : generateMaze(seed, mp?.players ?? 1), this.assets!, this.caps.hotel));
    w.maze.totem = totemSpot(w.maze, seed, mp?.players ?? 1); // el Tótem de la vida, si toca (como en el servidor)
    voice.setWorld(gridWorld({ open: w.maze.open, w: w.maze.w, h: w.maze.h, cell: CELL, ceil: 2.8 })); // (la voz mide paredes y salas contra el laberinto)
    this.scene.add(w.root);
    const m = w.maze, s = m.start;
    this.hides = hideStates(m);
    const p = (this.player = new Player(w, this.assets!, this.camera, this.flash, this.opts.reduced));
    p.noCaution = this.caps.hotel === true;
    p.setLook(this.lookOf(mp?.id)); // (mi skin sobre mi cuerpo en primera persona)
    if (mp?.life) p.life = mp.life;
    p.onDrink = () => (this.audio?.drink(), this.mp?.sock.emit('drink'));
    this.hookGear(p);
    if (mp) p.load(mp.inv ?? START_INV); // en una sala se empieza con el inventario del servidor (tienda y lo conservado), no desnudo
    // mirando hacia el primer lado abierto (con yaw = 0 se mira a -z)
    const side = this.caps.hotel ? [-1, 0] : [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => m.open[(s.y + dy) * m.w + s.x + dx]) ?? [0, -1];
    const at0 = center(s), [sx, sz] = startOffset(mp?.index ?? 0);
    if (mp) (at0.x += sx), (at0.z += sz);
    p.spawn(at0, Math.atan2(-side[0], -side[1]));
    this.arrive = 0;
    if (this.caps.hotel && ((mp?.floor ?? 1) > 1 || this.travelTo)) {
      // llegando en el ascensor desde la planta de abajo: dentro de la cabina, con las puertas cerradas, el rumor del viaje y el indicador subiendo; al llegar se abren
      const hr = w.elevator.rotation.y, ox = Math.sin(hr), oz = Math.cos(hr), cc = center(m.elevator);
      p.spawn(new THREE.Vector3(cc.x + (mp?.index ?? 0) * 0.0, 0, cc.z), Math.atan2(-ox, -oz));
      p.frozen = p.lookFree = true;
      w.cab.floor = mp?.floor ?? 2;
      w.cab.target = mp?.floor ?? 2;
      w.cab.down = this.travelFrom > (mp?.floor ?? 2);
      w.cab.resetClosed();
      w.cab.rideT = 0.95; // (el indicador ya marca la planta nueva: el viaje sigue donde lo dejó la cabina anterior)
      this.arrive = 1.7;
      this.arriveFloor = mp?.floor ?? 2;
      this.travelTo = 0;
    }
    if (!mp && DEV_LOCAL && new URLSearchParams(location.search).has('totem')) m.totem = { x: s.x + side[0], y: s.y + side[1] }; // desarrollo: &totem pone el tótem junto al inicio
    p.onFall = () => {
      if (this.mp && this.caps.fall) (this.sendState(), this.mp.sock.emit('fell'));
      this.die();
    };
    this.audio ??= new GameAudio(undefined, this.muted, this.volume);
    // la misión: la del servidor o, solo, una al azar (las cintas solo se colocan si la misión es encontrarlas)
    this.mission = mp ? (mp.mission ?? null) : this.soloMission(m);
    const it = (this.items = new Items(w, this.assets!, p, this.camera, this.audio, this.mission?.kind === 'tapes'));
    it.onWin = (stairs, floor) => (this.caps.hotel && stairs && floor && floor <= SUITE_FLOORS ? this.travel(floor, true) : this.win(stairs, floor));
    if (this.caps.hotel) it.onCab = () => {}; // (dentro de la cabina no pasa nada solo: se pulsa el botón de la planta)
    it.onLocker = (id) => this.onLocker?.(id);
    it.ready = !!this.mission?.exit;
    if (this.mission?.kind === 'tvs') {
      this.tvs = new Tvs(w, this.assets!, this.mission.goal);
      if (mp) this.tvs.claim = (i, done) => mp.sock.emit('tv', i, done);
    }
    this.gadgets = new Gadgets(w, p, this.camera, this.assets!, this.canvas.parentElement ?? document.body, () => this.remotes.values(), () => this.world && this.world.maze.elevator && new THREE.Vector3((this.world.maze.elevator.x + 0.5) * CELL, this.player?.pos.y ?? 0, (this.world.maze.elevator.y + 0.5) * CELL));
    // al empezar, una de cada: la bacteria y el partygoer, en los arranques más lejanos
    // (en una sala las lleva el servidor y llegan en el snapshot del mundo)
    this.entities = mp ? [] : (['bacteria', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, m.spawns[i] ?? m.spawns[0]));
    it.targets = this.entities;
    this.gadgets.onTotem = () => this.openTotem();
    if (mp) (this.wire(mp, it), this.gadgets.net(mp.sock));
    if (mp) {
      // la pistola de agua también en el nivel 0 (sin recarga): el chorro avisa al servidor y lo que me hacen los demás llega como 'wet'
      let sq = 0;
      p.onSquirt = (x, z, yaw) => (mp.sock.volatile.emit('squirt', { x, z, yaw }), performance.now() - sq > 120 && ((sq = performance.now()), this.audio?.squirt()));
      const onWet = (m: { kind: 'wet' | 'stun'; ms: number }) => (p.hit(m.kind, m.ms), this.wetFx(m.kind));
      mp.sock.on('wet', onWet);
      this.offNet.push(() => mp.sock.off('wet', onWet));
    }
    it.onKill = (t, from) => this.kill(t as Entity, from);
    if (mp) {
      it.peers = () => [...this.remotes.values()].filter((r) => !r.dead && !r.hiding).map((r) => ({ id: r.id, at: r.pos.clone().setY(r.pos.y + 1) }));
      it.onShootPlayer = (id) => mp.sock.emit('shoot', id);
      it.onShot = () => mp.sock.emit('bang');
      it.onMisfire = () => (mp.sock.emit('blast'), this.misfire());
    } else (it.onShot = () => this.noises.push({ x: p.pos.x, z: p.pos.z, r: NOISE_SHOT })), (it.onSnap = () => this.noises.push({ x: p.pos.x, z: p.pos.z, r: NOISE_PHOTO })), (it.onMisfire = () => this.misfire());
    if (this.caps.hotel) {
      // las habitaciones cerradas se dibujan una vez antes de empezar: sus mallas y texturas se suben a la GPU ahora, no (con un tirón de segundos) al abrir la primera puerta
      this.camera.position.set(p.pos.x, p.pos.y + 1.6, p.pos.z);
      w.viewer = this.camera.position;
      w.warmAll = true;
      w.update(0, 0);
      w.vents?.warm(true);
      this.composer.render(0);
      w.vents?.warm(false);
      w.warmAll = false;
      w.update(0, 0);
    }
    this.input.begin();
    this.audio.start();
    this.t = 0;
    this.paused = false;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    if (this.capped()) return;
    drawn.n++; // (el contador de FPS cuenta fotogramas dibujados, no los del monitor: con el tope puesto no marca de mas)
    this.renderer.shadowMap.autoUpdate = true;
    const realDt = this.clock.getDelta();
    this.adapt(realDt);
    bugWatch(realDt, this.paused, this.player?.pos);
    if (this.bench) this.benchTick(realDt);
    const dt = Math.min(realDt, 0.05) * (this.mp ? 1 : this.cheats.slow); // (cámara lenta: solo en solitario)
    this.lastFrame = performance.now();
    if (this.epi) return this.epiFrame(dt);
    if (this.player && !this.winning && this.dying < 0) {
      // dónde estaba y hacia dónde miraba por última vez (el final de ronda empieza ahí): en el parking y las Poolrooms, por la cámara
      const cam = this.parking ? this.camera : this.pool instanceof PoolLevel ? this.pool.camera : undefined;
      if (cam) (this.liveAt.copy(cam.position), (this.liveAt.y -= EYE), (this.liveYaw = Math.atan2(-cam.getWorldDirection(_dir).x, -_dir.z)));
      else (this.liveAt.copy(this.player.pos), (this.liveYaw = this.player.yaw));
    }
    // en una sala la pausa no detiene el mundo (los demás siguen jugando): solo se sueltan los mandos
    if (this.paused && (!this.mp || this.run)) return;
    const c = this.input.read();
    if ((this.run || this.dying >= 0) && this.eehRed) this.eehCheck(); // (la sirena del nivel -20 se calla al morir o llegar al nivel rojo)
    this.itemEffects();
    if (this.fxList.length) this.fxList = this.fxList.filter((f) => f(dt));
    if (this.player?.charging || this.arc) this.arcFrame();
    if (this.run) return this.runFrame(dt, c); // (el nivel rojo del Tótem vale en cualquier nivel, también en el parking)
    if (this.parking) {
      // (un fallo en un fotograma de la Habitable Zone se anota en el registro y no deja el juego congelado)
      try {
        return this.parkingFrame(dt, c);
      } catch (e) {
        const m = e instanceof Error ? e.stack ?? e.message : String(e);
        if (m !== this.lastFrameErr) (this.lastFrameErr = m), dlog('frame-error', m.slice(0, 600));
        this.composer.render(dt);
        return;
      }
    }
    if (this.run) return this.runFrame(dt, c);
    this.vhs.uniforms.uPool.value = this.film.uniforms.uVhs.value = this.pool instanceof PoolLevel ? 1 : 0; // (el aspecto de cinta de las Poolrooms: sin amarillo, con barrido y croma)
    this.film.uniforms.uWarm.value = this.caps.hotel && !this.run ? 1 : 0; // (Las Suites: el color cálido del hotel)
    if (this.pool) return this.poolFrame(dt, c);
    if (this.camUse >= 0 && (this.dying >= 0 || this.winning || this.player?.dead || c.bag || c.grab || c.jump || c.pause)) {
      const quit = c.pause; // (Esc: la pausa de siempre; E, G o salto: solo se sale de la cámara)
      this.camOff();
      if (!quit) c.bag = c.grab = c.jump = false;
    }
    if (this.totemOpen && c.bag) (c.bag = false), this.closeTotem(); // Esc o E cierran el selector del Tótem
    if (this.arrive > 0 && this.player && this.world) {
      this.arrive -= dt;
      if (this.arrive <= 0) {
        const cab = this.world.cab;
        (cab.floor = this.arriveFloor), (cab.target = undefined), (cab.rideT = -1), cab.open();
        if (this.items) this.items.open = this.world.elevatorOpen = true; // (la puerta deja de ser pared: se puede salir)
        this.player.frozen = this.player.lookFree = false;
        this.audio?.click();
      }
    }
    if (this.shopOpen && c.grab) (c.grab = false), (c.bag = true); // con la tienda abierta, G también la cierra
    // el inventario: E lo abre y lo cierra (Escape también lo cierra, sin pausar)
    if (this.dying < 0 && !this.winning && c.bag) {
      if (this.bagOpen) this.closeBag();
      else if (!this.hideKey()) this.openBag();
    }
    if (c.pause && this.dying < 0 && !this.winning) {
      if (this.talkN) this.closeTalk();
      if (this.bagOpen) (this.bagOpen = false), (this.input.suspend = false); // una pausa de verdad también lo cierra
      return this.pause();
    }
    this.t += dt;
    if (this.player) (this.player.speedMul = this.cheats.speed), (this.player.jumpMul = this.cheats.jump);
    if (this.brightLight) this.brightLight.visible = this.cheats.bright;
    if (this.camUse >= 0) this.camFrame(c);
    // Las Suites: en los conductos se va siempre agachado; mirando las cámaras el cuerpo se queda quieto
    const pp = this.player, duct = !!pp && !!this.world?.vents?.inDuct(Math.floor(pp.pos.x / CELL), Math.floor(pp.pos.z / CELL));
    const pc = this.camUse >= 0 ? { ...c, move: _none, look: _none, run: false, jump: false, crouch: true, fire: false, grab: false, flash: false, swap: false, slot: -1, wheel: 0, use: false, aim: false, zoom: 0 } : duct ? { ...c, crouch: true, run: false, jump: false } : c;
    if (pp) (pp.duckMin = duct ? 0.9 : 0), (pp.maxEye = Infinity), (pp.camFwd = duct ? 0.22 : 0);
    const nr = duct ? 0.025 : 0.05; // (pegado a la pared del conducto, la cámara quedaba a 2 cm del muro: se veía a su través)
    // (la niebla lo borra todo pasados 19 m: en el pasillo del hotel no se dibuja lo de más allá de 32; en el vestíbulo, con la cúpula, ni en las cámaras, todo)
    let far = this.caps.hotel && pp && this.camUse < 0 && pp.pos.x < 3 * SUITE_L * CELL - 3 ? 56 : 70;
    const fg = this.scene.fog;
    if (fg instanceof THREE.Fog) {
      fg.far = this.fogBase * (settings.drawDist === 0 ? 0.55 : 1); // (DRAW DISTANCE: la niebla cierra y no se dibuja lo que tapa)
      if (settings.drawDist < 2) far = Math.min(far, fg.far + 4);
    }
    if (this.camera.near !== nr || this.camera.far !== far) (this.camera.near = nr), (this.camera.far = far), this.camera.updateProjectionMatrix(); // (en el conducto, agachado casi al paso de andar y con la vista adelantada: el pecho no se mete en la cámara)
    if (!this.spectating || this.player?.dead) this.player?.update(dt, pc);
    this.camPlace(dt);
    if (this.player) this.world?.vents?.gate(this.player.pos.z, this.camUse >= 0, this.camera.position);
    if (this.player && this.camUse < 0) this.world?.vents?.renderLive(this.renderer, this.scene, this.t, dt, this.player.pos); // (un televisor de la sala de control enseña de vez en cuando una cámara de verdad)
    if (this.caps.hotel && this.player) {
      // Las Suites: el pasillo se cierra sobre sí mismo (shared/src/suites.ts). Quien acaba de entrar del vestíbulo NO salta: la puerta se cierra a su espalda y recorre la última copia
      // (igual que las demás); el salto empieza al pasar a la anterior
      const px = this.player.pos.x, span = SUITE_L * CELL;
      if (px >= 3 * span) this.hallIn = true;
      else if (this.hallIn && px >= 2 * span) px < 3 * span - 1.2 && this.world?.closeGrand();
      else {
        this.hallIn = false;
        const nx = wrapX(px);
        this.player.pos.x = nx;
      }
    }
    // escondido, las manos están quietas: nada de recoger, disparar ni linterna
    const hiding = !!this.player && this.player.hideState !== 'out';
    let cc = hiding ? { ...c, grab: false, fire: false, reload: false, flash: false, swap: false, slot: -1, wheel: 0, use: false, aim: false, zoom: 0 } : c;
    if (c.flash && this.dying < 0 && !hiding) this.audio?.click();
    if (this.dying < 0) {
      this.gadgets && (cc = this.gadgets.update(dt, cc));
      this.player && this.tvs && (cc = this.tvs.update(dt, this.player, cc, this.audio));
      this.doorAct = null;
      this.world?.setTalk(this.talkN && this.player ? { x: this.player.pos.x, z: this.player.pos.z } : undefined); // (el Faceling con quien se habla se gira hacia ti)
      if (this.world && this.caps.hotel && this.player && !this.player.dead && !this.tvs?.hint) {
        let d = this.world.nearDoor(this.player.pos.x, this.player.pos.z, this.player.yaw, this.player.pos.y);
        // (con un objeto a la vista —al abrir se ve el botín de dentro— la puerta solo manda si se mira de frente: si no, no se podía volver a cerrar)
        if (d && this.items?.hint) {
          const px = d.x + d.nx * 0.3 - this.player.pos.x, pz = d.z + d.nz * 0.3 - this.player.pos.z;
          if ((px * -Math.sin(this.player.yaw) + pz * -Math.cos(this.player.yaw)) / Math.max(Math.hypot(px, pz), 0.01) < 0.85) d = undefined;
        } // Las Suites: G abre y cierra las puertas de las suites (las de la escalera, solo con la misión cumplida)
        if (d) {
          const lock = d.stair && !this.items?.ready;
          this.doorAct = lock ? 'FLOOR DOOR LOCKED · FINISH THE MISSION' : d.tgt ? 'CLOSE DOOR' : 'OPEN DOOR';
          if (cc.grab) (lock ? this.audio?.reject() : this.world.toggleDoor(d), (cc = { ...cc, grab: false }));
        }
      }
      if (this.world && this.mp && this.caps.hotel && this.player && !this.player.dead && !this.doorAct && !this.tvs?.hint && !this.items?.hint && !this.items?.close()) {
        // Las Suites: la tienda de recepción; con la misión del encargo en marcha, el mostrador recoge los artefactos. Cumplida una misión, cualquier Faceling (mostrador o paseando) da otra
        const { x, z } = this.player.pos, counter = this.world.nearCounter(x, z, this.player.yaw), talk = !!this.mission?.done, hand = this.mission?.kind === 'order' && !talk, walker = (talk || hand) && !counter && this.staffNear(x, z, this.player.yaw);
        if (counter || walker) {
          const order = hand; // (el encargo se entrega a cualquier Faceling: el vestíbulo se cierra y no se puede volver)
          this.doorAct = order ? 'HAND OVER AN ARTIFACT' : talk ? 'ASK THE FACELING FOR ANOTHER MISSION' : 'TALK TO THE FACELING';
          if (cc.grab) {
            const say = (text: string) => (this.note = { text, until: performance.now() + 2000 });
            if (order) this.mp.sock.emit('deliver', (ok) => (ok ? (this.audio?.cue('equip'), say('ORDER RECEIVED')) : counter ? this.openShop() : say('YOU HAVE NO ARTIFACT TO HAND OVER')));
            else if (talk) this.mp.sock.emit('nextMission', -1, (n) => (n > 1 ? this.openTalk(n) : n === 1 ? this.pickMission(0) : counter ? this.openShop() : say('NO MORE MISSIONS')));
            else this.openShop();
            cc = { ...cc, grab: false };
          }
        }
      }
      if (this.world && this.caps.hotel && this.player && !this.doorAct && this.items && !this.items.hint) {
        const it = this.items, e = this.world.maze.elevator, q = this.player.pos, gs = it.gens;
        const sd = this.world.stairDoors.find((d) => Math.hypot(q.x - d.x, q.z - d.z) < 1.6 && Math.abs(q.y - d.y) < 0.8);
        const cab = this.world.cab;
        it.floorNo = this.floorNo;
        this.aimRay.setFromCamera(_aim, this.camera);
        this.aimRay.far = 2.6;
        let key: string | null = null;
        if (it.wasCab) {
          // dentro de la cabina: se pulsa el botón de la planta (la siguiente; el juego del hotel se completa en la 5)
          key = cab.pickKey(this.aimRay);
          const n = key && /^[1-6]$/.test(key) ? Number(key) : 0, fl = this.floorNo;
          if (n) {
            const exit = n === SUITE_FLOORS + 1, ok = exit ? fl === SUITE_FLOORS && it.ready : n < fl || (n === fl + 1 && it.ready);
            this.doorAct = n === fl ? `FLOOR ${n} · YOU ARE HERE` : exit ? (fl === SUITE_FLOORS ? (it.ready ? 'LEAVE THE BUILDING' : 'FINISH THE MISSION TO LEAVE') : 'THE EXIT IS ON FLOOR 5') : n < fl ? `GO DOWN TO FLOOR ${n}` : n === fl + 1 ? (it.ready ? `GO UP TO FLOOR ${n}` : 'LOCKED · FINISH THE MISSION') : 'ONE FLOOR UP AT A TIME';
            if (cc.grab) {
              cc = { ...cc, grab: false };
              if (n === fl) this.audio?.reject();
              else if (!ok) this.audio?.reject();
              else if (exit) this.pickFloor(n);
              else this.travel(n);
            }
          }
        } else if (!it.open && cab.callBtn && this.aimRay.intersectObject(cab.callBtn, false).length) {
          // fuera: el botón de llamada del ascensor
          const ok = it.ready && it.powered;
          this.doorAct = !it.powered ? `ELEVATOR HAS NO POWER · SWITCH ON THE PANELS ${gs.on}/${gs.n}` : !it.ready ? 'ELEVATOR OFFLINE · FINISH THE MISSION' : it.called ? 'ELEVATOR ON ITS WAY' : 'CALL THE ELEVATOR';
          if (cc.grab) {
            cc = { ...cc, grab: false };
            if (ok && !it.called) ((it.called = true), this.audio?.click());
            else if (!ok) this.audio?.reject();
          }
        }
        cab.setKeys(key ?? '', String(this.floorNo));
        cab.setCall(it.ready && it.powered);
        if (this.doorAct) {
          // (ya hay aviso: botón de la cabina o de llamada)
        } else if (sd) this.doorAct = sd.n === this.floorNo ? `FLOOR ${sd.n} · YOU ARE HERE` : sd.n < this.floorNo || (it.ready && sd.n === this.floorNo + 1) ? `FLOOR ${sd.n}` : it.ready ? 'ONE FLOOR UP AT A TIME' : 'FLOOR DOOR LOCKED · FINISH THE MISSION';
        else if (e && Math.hypot(q.x - (e.x + 0.5) * CELL, q.z - (e.y + 0.5) * CELL) < 3) {
          if (!it.powered) this.doorAct = `ELEVATOR HAS NO POWER · SWITCH ON THE PANELS ${gs.on}/${gs.n}`;
          else if (!it.ready) this.doorAct = 'ELEVATOR OFFLINE · FINISH THE MISSION';
        }
        if (!this.doorAct) cc = this.ventAct(cc);
        this.world.eehScreen(this.eehSnap);
      }
      this.items?.update(this.t, dt, cc);
      if (cc.drop) this.dropSelected();
    }
    if (!this.mp) this.soloTick();
    this.hideFrame(dt, c.hold);
    this.monsters(dt);
    this.camWatch();
    if (this.shopOpen && !this.bagOpen) this.shopOpen = false; // (cualquier cosa que cierre la mochila —una pausa, la muerte, un reinicio— cierra la tienda)
    if (this.shopOpen && (this.dying >= 0 || this.winning)) this.closeBag();
    if (this.shopOpen || this.shopT > 0) this.shopCam(dt);
    if (this.mp) this.netFrame(dt, c);
    if (this.dying >= 0 && !this.spectating) this.dyingFrame(dt);
    // pasos: uno cada ~0,7 m andando (algo más largos corriendo), si se pisa suelo
    const p = this.player;
    if (p && p.speed > 0 && p.pos.y === 0) {
      this.stepAcc += p.speed * dt;
      const len = p.speed > 2 ? 1.1 : 0.7;
      if (this.stepAcc > len) (this.stepAcc -= len), this.audio?.step(p.speed > 2);
    }
    if (this.world) {
      this.world.occupants ??= () => [...(this.player ? [this.player.pos] : []), ...[...this.remotes.values()].filter((r) => !r.dead).map((r) => r.pos)]; // (para que las puertas no se cierren encima de nadie)
      this.world.viewer = this.camera.position;
      this.world.update(this.t, dt);
      this.blackouts(dt);
      const near = this.world.lightsNear(this.camera.position);
      near.forEach((l, i) => (this.points[i].position.copy(l.pos), (this.points[i].intensity = 3 * l.level)));
      // el zumbido: el del tubo que tienes encima (y nada en un apagón)
      this.audio?.power((near[0]?.level ?? 0) * (0.4 + 0.6 * THREE.MathUtils.clamp(1 - Math.sqrt(near[0]?.d ?? 99) / 6, 0, 1)));
      if (p) this.audio?.ambient(dt, this.openness(p.pos), 1 - p.sanity);
      if (this.caps.hotel) this.audio?.muzak(dt);
      if (p) this.audio?.pit(this.world.pitNear(p.pos.x, p.pos.z));
      const du = (this.dust.material as THREE.ShaderMaterial).uniforms;
      du.uCam.value.copy(this.camera.position);
      du.uTime.value = this.t;
      du.uBeam.value = this.spectating ? (this.remotes.get(this.watching)?.light ? 1 : 0) : p?.lightOn ? 1 : 0;
      du.uPx.value = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.02;
    }
    // la cinta solo se ve mirando por la cámara (y al morir y en el ascensor, que es la grabación la que se corta)
    if (this.fadeIn > 0) this.fadeIn = Math.max(0, this.fadeIn - dt);
    this.vhs.enabled = (!!p?.aiming && !this.spectating) || (this.dying >= 0 && !this.spectating) || this.winning || this.fadeIn > 0;
    const u = this.vhs.uniforms;
    u.uTime.value = this.film.uniforms.uTime.value = this.t;
    u.uFlash.value = this.items?.flash ?? 0;
    // en el ascensor: puertas, arranque y un rato de viaje (la cámara tiembla con la cabina); luego la grabación se corta a negro
    const cab = this.world?.cab;
    if (this.winning && cab && !this.viaStairs) this.camera.position.y += cab.shake;
    if (this.winning && (!cab || this.viaStairs || cab.rideT > RIDE)) this.black = Math.min(1, this.black + dt / 1.5);
    u.uBlack.value = Math.max(this.black, this.fadeIn / 0.9);
    u.uAspect.value = this.fadeIn > 0 && !p?.aiming && this.dying < 0 && !this.winning ? 1 : this.camera.aspect;
    // la foto: se pinta el fotograma del flash y se queda congelado un instante
    const it = this.items;
    if (it && it.freeze > 0) {
      it.freeze -= dt;
      if (this.froze) return;
      this.froze = true;
    } else this.froze = false;
    // la foto: primero el fotograma sin flash, a una miniatura para el inventario
    if (it?.snap) {
      it.snap = false;
      u.uFlash.value = 0;
      this.composer.render(dt);
      it.thumbs.push(this.shot(160, 120, 0.7));
      it.full.push(this.shot(960, 720, 0.88));
      u.uFlash.value = it.flash;
    }
    this.drawMap();
    this.shakeCam(dt);
    this.eehCheck();
    this.renderer.shadowMap.autoUpdate = this.flash.intensity > 0.01; // (con la linterna apagada su mapa de sombras no se ve: no se repinta)
    this.composer.render(dt);
  }

  /** Lo que hay ahora en el lienzo, recortado al cuadro 4:3 de la cinta, a `w`×`h` en jpeg. */
  private shot(w: number, h: number, q: number) {
    const src = this.renderer.domElement, c = Object.assign(document.createElement('canvas'), { width: w, height: h }), k = Math.max(w / src.width, h / src.height);
    c.getContext('2d')!.drawImage(src, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k);
    return c.toDataURL('image/jpeg', q);
  }

  get hud(): Hud {
    const p = this.player;
    const battery = Math.max(0.15, 1 - this.t / 900);
    const inv: Inv = { left: p?.left ?? 'none', belt: p?.belt ?? 'none', stamina: p?.stamina ?? 1, sanity: p?.sanity ?? 1, escaped: this.winning, hand: p?.hand ?? 'none', camera: !!p?.has.camera, gun: !!p?.has.gun, ammo: p?.ammo ?? 0, spare: p?.spare ?? 0, tapes: this.items?.tapes ?? 0, photos: this.items?.photos ?? 0, thumbs: this.items?.thumbs ?? this.pics.thumbs, full: this.items?.full ?? this.pics.full, flashOn: !!p?.flashOn, battery, charge: p?.charge ?? 1, spares: p?.spares ?? 0, uno: !!p?.uno, monster: p?.monster ?? 0, pokeball: !!p?.pokeball, nokia: !!p?.nokia, bat: !!p?.bat, grenade: p?.grenade ?? 0, glasses: p?.glasses, pills: p?.pills, steelcard: p?.steelcard, beer: p?.beer, rainbow: !!p?.rainbow, water: p?.water ?? 0, hot: p?.hot ?? [], hotSel: p?.hotSel ?? 0, gadget: p?.gadget ?? 'none', totem: p?.totem ?? 0, radar: !!p?.radar, caution: !!p?.caution, tape: (this.gadgets?.left ?? ROLL) / ROLL };
    // la pistola de agua y el tanque se conservan en el nivel 0 (aunque no sirvan allí): siguen en la mochila y en la ranura de equipo
    const gear = p?.inventory;
    if (gear) Object.assign(inv, { tank: gear.tank, tankOn: p!.tankOn, watergun: gear.watergun, squirt: p!.squirt });
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (pl && this.mp?.inv?.tank) inv.tank = true;
    const hidden = !!p && p.hideState !== 'out';
    const ms = this.mission, up = this.ascent;
    const pr = this.parking;
    if (pr) inv.tapes = pr.level.tapesCollected;
    const parking = pr ? { floor: pr.floorLabel, pendingFloors: pr.pendingFloors, prompt: pr.prompt, repair: pr.level.repair.active ? pr.level.repair.progress : null, open: pr.level.elevatorOpen } : undefined;
    return { warden: p?.glassesOn ? this.wardenSerial : undefined, liftOpen: this.items?.open, power: this.items && !this.items.powered ? this.items.gens : undefined, parking, parkingItemHeld: p && PARKING_ITEM_IDS.includes(p.prop as ParkingItemId) ? p.prop as ParkingItemId : undefined, steelRoll: this.steelRoll && this.steelRoll.until > performance.now() ? this.steelRoll : undefined, effects: this.effects(), talk: this.talkN, lift: false, mission: ms ? { kind: ms.kind, text: ms.text, line: missionLine(ms), progress: ms.progress, goal: ms.goal, done: ms.done, exit: ms.exit } : null, ascent: up ? { boarded: !!this.mp && up.boarded.includes(this.mp.id), left: Math.max(0, up.left - (performance.now() - up.at) / 1000) } : null, act: hidden || this.run ? null : this.tvs?.hint ?? this.doorAct ?? (pl ? p?.refillAct : null) ?? null, totem: this.totemHud(), needClick: this.input.needClick, bag: this.bagOpen && !this.shopOpen, shop: this.bagOpen && this.shopOpen, note: this.gadgets?.note ?? null, hint: hidden || this.run || this.tvs?.hint ? null : this.gadgets?.hint ?? this.items?.hint ?? pl?.pickups.hint ?? this.parkPick?.hint ?? null, hide: this.dying >= 0 || this.winning || this.spectating ? null : hidden ? (p!.hideState === 'hidden' ? 'leave' : null) : this.hideNear() ? 'hide' : null, breath: p?.concealed ? { air: this.breath.air, warn: this.inspected, held: this.holding } : null, drink: p?.dead ? 0 : (this.eehTyping ? p?.typeFrac : 0) || p?.drinking || p?.drinkingMonster || p?.drinkingUno || 0, drinkName: this.eehTyping ? 'REBOOTING EEH' : p?.prop === 'monster' ? 'MONSTER' : p?.prop === 'uno' ? 'UNO REVERSE' : 'ALMOND WATER', refill: p?.fill ?? 0, inv, aiming: !!p?.aiming, scoped: !!p?.scoped && !this.spectating, zoom: p?.zoom ?? 1, focus: !!this.items?.focus, tapes: this.items?.tapes ?? 0, photos: this.items?.photos ?? 0, ammo: p?.has.gun ? p.ammo : null, spare: p?.spare ?? 0, battery, time: this.t, hp: p?.hp ?? HP_MAX, hps: this.hps, spectating: this.spectating && !this.run ? (this.remotes.get(this.watching)?.name ?? '') : null, watchList: this.spectating && !this.run ? [...this.remotes.values()].map((r) => ({ name: r.name, on: r.id === this.watching && this.specView !== 'free', dead: r.dead })) : undefined, specView: this.spectating && !this.run ? this.specView : undefined };
  }

  /** Los efectos que tiene ahora el personaje, para el HUD (Effects.tsx). */
  private effects(): Hud['effects'] {
    const p = this.player, pl = this.pool instanceof PoolLevel ? this.pool : undefined, out: Hud['effects'] = [];
    if (!p || this.run) return out;
    const now = performance.now(), dead = p.dead || this.spectating;
    if (!dead) {
      if (p.pillOn) out.push({ id: 'pills', icon: 'pills', label: 'PILLS', kind: 'good', frac: (p.pillsUntil - performance.now()) / (PILLS.time * 1000) });
      if (p.glassesOn) out.push({ id: 'glasses', icon: 'glasses', label: 'X-RAY', kind: 'good', frac: p.glassesLeft / GLASSES.time });
      if (p.buffT > 0) out.push({ id: 'monster', icon: 'speed', label: 'MONSTER', kind: 'good', frac: p.buffT / (MONSTER.time * boostOf(perks, 'monster')) });
      if (now < this.immuneUntil) out.push({ id: 'immune', icon: 'shield', label: 'IMMUNE', kind: 'good', frac: (this.immuneUntil - now) / REVIVE_IMMUNE });
      if (p.concealed) out.push({ id: 'hide', icon: 'hide', label: 'HIDDEN', kind: 'good' });
      if (p.stunLeft > 0) out.push({ id: 'stun', icon: 'stun', label: 'STUNNED', kind: 'bad', frac: p.stunLeft / 3 });
      else if (p.wetLeft > 0) out.push({ id: 'wet', icon: 'wet', label: 'SOAKED', kind: 'bad', frac: p.wetLeft / 4 });
      if (p.winded) out.push({ id: 'tired', icon: 'tired', label: 'WINDED', kind: 'bad' });
      if (this.inGas()) out.push({ id: 'gas', icon: 'gas', label: 'TOXIC GAS', kind: 'bad', frac: 1 });
      if (!this.pool && p.sanity < 0.35) out.push({ id: 'panic', icon: 'panic', label: 'PANIC', kind: 'bad', frac: p.sanity / 0.35 });
      if (pl && pl.o2 < 0.4) out.push({ id: 'air', icon: 'air', label: 'LOW AIR', kind: 'bad', frac: pl.o2 / 0.4 });
      if (pl && pl.jam > 0) out.push({ id: 'jam', icon: 'nosignal', label: 'NO SIGNAL', kind: 'bad' });
    }
    return out;
  }

  /** Lo abierto que es el sitio: las celdas libres en 7 × 7 alrededor (0–1). */
  private openness(at: THREE.Vector3) {
    const m = this.world!.maze, cx = Math.floor(at.x / CELL), cz = Math.floor(at.z / CELL);
    let n = 0;
    for (let y = cz - 3; y <= cz + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) n += x >= 0 && y >= 0 && x < m.w && y < m.h ? m.open[y * m.w + x] : 0;
    return n / 49;
  }

  // los apagones: cada minuto o dos las luces tiemblan, se van unos segundos y vuelven con un golpe
  private nextOut = 70 + Math.random() * 50;
  private outT = -1;
  private blackouts(dt: number) {
    const w = this.world!;
    if (this.lightsOff) return void (w.power = 0);
    if (this.outT < 0) {
      if (this.t > this.nextOut && this.dying < 0 && !this.winning) this.outT = 0;
      return;
    }
    const was = w.power;
    this.outT += dt;
    const T = this.outT, down = 1.4, dark = 4.5;
    if (T < down) w.power = Math.random() < 0.5 ? 1 : 0.1; // tiembla
    else if (T < down + dark) w.power = 0;
    else if (T < down + dark + 0.5) w.power = Math.random() < 0.6 ? 1 : 0;
    else (w.power = 1), (this.outT = -1), (this.nextOut = this.t + 60 + Math.random() * 70);
    if (was > 0.5 !== w.power > 0.5 && Math.random() < 0.5) this.audio?.clunk(w.power > 0.5);
  }

  /** Las entidades, sus trozos, los globos sueltos y lo que se oye de ellas. */
  private monsters(dt: number) {
    const p = this.player!, w = this.world!, eye = this.camera.position, near: Record<Kind, number> = { bacteria: Infinity, partygoer: Infinity, faceling: Infinity };
    // bajo los fluorescentes (con corriente) se te ve de más lejos; con la linterna, más aún
    const c = w.cellAt(p.pos.x, p.pos.z), exposed = w.power > 0.5 && !!w.maze.lit[c.y * w.maze.w + c.x];
    const torch = p.lightOn ? this.camera.getWorldDirection(new THREE.Vector3()) : null;
    const occ = this.mp ? [] : this.hides.filter((h) => h.occ); // (en una sala las entidades las lleva el servidor)
    if (p.speed > 2 && !p.concealed) this.noises.push({ x: p.pos.x, z: p.pos.z, r: NOISE_RUN });
    const noises = this.noises;
    this.noises = [];
    for (const e of this.entities) {
      if (!e.alive || this.entFrozen) continue;
      if (e.update(dt, p.pos, eye, torch, exposed, this.god, occ, p.concealed, p.duck, p.yaw, noises) && this.dying < 0) this.hurt(e);
      near[e.kind] = Math.min(near[e.kind], e.pos.distanceTo(p.pos));
    }
    if (this.dying < 0) {
      this.audio?.near('bacteria', near.bacteria);
      this.audio?.near('partygoer', near.partygoer);
      // la cordura: a la luz se recupera; a oscuras se va (más deprisa sin linterna) y cerca de ellas, más
      const m = this.world!.maze, lit = this.world!.power > 0.5 && m.lit[Math.floor(p.pos.z / CELL) * m.w + Math.floor(p.pos.x / CELL)];
      const close = Math.min(near.bacteria, near.partygoer);
      let d = (lit ? 1 / 90 : p.lightOn ? -1 / 240 : -1 / 70) - (close < 10 ? (1 - close / 10) / 20 : 0);
      if (p.concealed && this.holding && d < 0) d = 0; // escondido y aguantando la respiración: la cordura no baja (aunque tengan cerca)
      p.sanity = THREE.MathUtils.clamp(p.sanity + d * dt, 0, 1);
      if (this.cheats.sanity) p.sanity = 1;
      // sin cordura se muere (como al caer): en una sala lo da por bueno el servidor
      if (this.caps.insane && p.sanity <= 0 && !this.god && !this.winning) {
        if (this.mp && this.caps.insane) (this.sendState(), this.mp.sock.emit('insane'));
        this.die();
      }
    }
    if (this.cheats.stamina) p.stamina = 1;
    if (this.cheats.ammo) (p.ammo = RIFLE_MAG), (p.squirt = 1);
    this.film.uniforms.uMad.value = this.dying < 0 ? 1 - (p.sanity) : 0;
    this.shatters = this.shatters.filter((s) => s.update(dt));
    this.booms = this.booms.filter((b) => b.update(dt));
    this.balloons = this.balloons.filter((b) => {
      b.position.y += dt * 1.6;
      b.rotation.z = Math.sin(b.position.y * 2) * 0.3;
      if (b.position.y < 9) return true;
      b.removeFromParent();
      return false;
    });
  }

  /** Un Faceling vivo (del servidor) delante y a menos de 2,2 m: con él se habla. */
  private staffNear(x: number, z: number, yaw: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    return this.entities.some((e) => {
      const dx = e.pos.x - x, dz = e.pos.z - z, d = Math.hypot(dx, dz);
      return e.kind === 'faceling' && e.alive && d < 2.2 && (d < 0.6 || (fx * dx + fz * dz) / d > 0.6);
    });
  }

  /** El nicho que tienes delante: cerca, mirándolo, por su boca y vacío (sin nadie dentro ni entrando). */
  private hideNear(): HideState | undefined {
    const p = this.player;
    if (!p || p.hideState !== 'out' || p.frozen || p.dead) return undefined;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const h of this.hides) {
      const dx = h.x - p.pos.x, dz = h.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 2.6 || (fx * dx + fz * dz) / d < 0.6) continue; // (más amplio: no hace falta apuntar al centro del armario)
      // por la boca: del lado de la salida
      if (((p.pos.x - h.x) * (h.fx - h.x) + (p.pos.z - h.z) * (h.fz - h.z)) / Math.hypot(h.fx - h.x, h.fz - h.z) < 0.6) continue;
      if (h.occ || [...this.remotes.values()].some((r) => r.hiding && Math.hypot(r.pos.x - h.x, r.pos.z - h.z) < 1)) continue;
      return h;
    }
    return undefined;
  }

  /** E: meterse en el nicho que tienes delante o salir del que estás. true si lo ha gastado (si no, abre el inventario). */
  private hideKey() {
    const p = this.player;
    if (!p || this.spectating || p.dead || p.frozen) return false;
    if (p.hideState === 'hidden') {
      p.leaveHide(this.hides[this.hideIdx]);
      this.audio?.click();
      return true;
    }
    if (p.hideState !== 'out') return true; // entrando o saliendo: espera
    const h = this.hideNear();
    if (!h) return false;
    this.hideIdx = h.idx;
    p.enterHide(h);
    this.breath.reset();
    this.audio?.click();
    return true;
  }

  /** Cada fotograma: el aire, quién me inspecciona y, en solitario, el nicho (ocupado, con mi ruido) que ven las entidades. */
  private hideFrame(dt: number, hold?: boolean) {
    const p = this.player;
    if (!p) return;
    this.noise = p.speed > 2 ? 1 : Math.max(0, this.noise - dt / 8);
    if (!this.mp) tickHides(this.hides, dt);
    const h = this.hides[this.hideIdx];
    if (p.concealed && h) {
      this.holding = this.breath.step(dt, !!hold, 1.2); // (la misma reserva que cuenta el servidor: si no, aquí se acaba antes y te delata)
      if (this.breath.gasped) this.audio?.gasp();
      if (!this.mp) {
        h.occ = { id: 'me', holding: this.holding, noise: this.noise };
        this.inspected = !!h.by;
      }
      this.audio?.hideAmb(dt, this.inspected ? 1 : 0.15, this.holding);
    } else {
      this.breath.step(dt, false);
      this.holding = false;
      if (!this.mp) {
        this.inspected = false;
        if (h) h.occ = null;
      }
      if (p.hideState === 'out') this.hideIdx = -1;
    }
  }

  /** Un tiro que mata: revienta, «Good job idiot, now what?» y otra del tipo contrario, más dura. */
  private kill(e: Entity, from: THREE.Vector3) {
    this.burst(e, from);
    unlock('idiot');
    // la siguiente, en el arranque más lejano del jugador: 15 % más rápida y un tiro más
    const m = this.world!.maze, p = this.player!.pos;
    const far = [...m.spawns].sort((a, b) => center(b).distanceTo(p) - center(a).distanceTo(p))[0];
    this.entities.push(new Entity(e.kind === 'bacteria' ? 'partygoer' : 'bacteria', this.world!, this.assets!, far, Math.min(1.2, e.speed * 1.1), e.hp0 + 1));
  }

  /** Una entidad que revienta: sus trozos salen despedidos de `from` y el globo se va al cielo. */
  private burst(e: Entity, from: THREE.Vector3) {
    const s = new Shatter(e.rig.root, from);
    (e.rig.root.parent ?? this.world?.root ?? this.scene).add(s.root); // (en las Poolrooms no hay `world`: antes esto lanzaba y dejaba a las entidades sin actualizar, congeladas)
    this.shatters.push(s);
    if (e.balloon) this.balloons.push(e.balloon), (e.balloon = undefined);
    e.dispose();
  }

  /** Una entidad te alcanza (en solitario; en una sala lo decide el servidor): quita vida y, si queda, sigue; sin vida, o escondido (sin salida), te pillan. */
  private hurt(e: Entity) {
    const p = this.player!;
    p.hp = p.concealed ? 0 : Math.max(0, p.hp - HIT_DAMAGE);
    this.audio?.cue('hurt');
    if (p.hp <= 0) this.die(e);
  }

  /** Te pillan o te caes: la cámara al suelo, la entidad baila, la cinta se come y el cuelgue falso. */
  private die(e?: Entity) {
    if (this.dying >= 0 || this.winning || (this.god && e)) return;
    this.dying = 0;
    this.killer = e;
    this.fly = undefined;
    if (this.hideIdx >= 0) (this.player!.cancelHide(this.hides[this.hideIdx]), (this.hides[this.hideIdx].occ = null), (this.hideIdx = -1)); // lo encuentran: fuera del nicho
    this.holding = false;
    this.player!.frozen = true;
    if (e) this.player!.dead = true;
    this.player!.aiming = false; // fuera el visor de la camcorder
    this.player!.zoom = 1;
    if (this.items) this.items.freeze = 0;
    if (this.bagOpen) (this.bagOpen = false), (this.input.suspend = false);
    this.input.unlock();
    // un fotograma de ahora, para los trozos congelados de la corrupción
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.snap = new THREE.WebGLRenderTarget(size.x / 2, size.y / 2);
    this.renderer.setRenderTarget(this.snap);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.vhs.uniforms.tPrev.value = this.snap.texture;
  }

  private dyingFrame(dt: number) {
    const t = (this.dying += dt), e = this.killer, p = this.player!, cam = this.camera;
    const look = (from: THREE.Vector3, to: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0)));
    if (e || this.fly) {
      const head = e ? e.rig.bone('Head')?.getWorldPosition(new THREE.Vector3()) ?? e.pos.clone().setY(e.height * 0.9) : cam.position;
      if (e && t < 0.4) {
        // se lanza a la lente: la vista se clava en su cara, se abre de golpe y tiembla
        const k = t / 0.4;
        cam.quaternion.slerp(look(cam.position, head), Math.min(1, dt * 14));
        cam.fov = THREE.MathUtils.lerp(70, 100, k * k);
        if (!this.opts.reduced) cam.position.set(p.pos.x + (Math.random() - 0.5) * 0.08 * k, p.pos.y + 1.62 + (Math.random() - 0.5) * 0.08 * k, p.pos.z + (Math.random() - 0.5) * 0.08 * k);
      } else {
        // la camcorder sale volando de las manos, dando vueltas, y cae de lado al suelo
        if (!this.fly && e) {
          const away = cam.position.clone().sub(e.pos).setY(0).normalize();
          const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar((Math.random() - 0.5) * 2);
          this.fly = { pos: cam.position.clone(), vel: away.multiplyScalar(3).add(side).setY(2.6), q: cam.quaternion.clone(), spin: new THREE.Vector3(9, 6, 11).multiplyScalar(Math.random() < 0.5 ? -1 : 1), bounced: false };
        }
        const f = this.fly!, w = this.world!;
        f.vel.y -= 9.8 * dt;
        const nx = f.pos.x + f.vel.x * dt, nz = f.pos.z + f.vel.z * dt;
        if (w.solid(nx, f.pos.z)) f.vel.x *= -0.4;
        else f.pos.x = nx;
        if (w.solid(f.pos.x, nz)) f.vel.z *= -0.4;
        else f.pos.z = nz;
        f.pos.y += f.vel.y * dt;
        if (f.pos.y < 0.12) {
          f.pos.y = 0.12;
          f.vel.y = Math.abs(f.vel.y) * 0.3;
          f.vel.x *= 0.55;
          f.vel.z *= 0.55;
          f.spin.multiplyScalar(0.4);
          if (!f.bounced) (f.bounced = true), this.audio?.step(true);
        }
        const still = f.bounced && f.vel.length() < 0.6;
        if (!still) f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)));
        else {
          // quieta en el suelo, de lado, grabando el cuerpo y lo que baila encima
          const lie = look(f.pos, p.corpse.setY(0.5)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.35));
          f.q.slerp(lie, Math.min(1, dt * 6));
        }
        cam.position.copy(f.pos);
        cam.quaternion.copy(f.q);
        cam.fov = THREE.MathUtils.lerp(cam.fov, 62, Math.min(1, dt * 4));
      }
      cam.updateProjectionMatrix();
    } else this.black = THREE.MathUtils.clamp((t - 0.6) / 2.4, 0, 1); // al vacío: se cae a negro
    this.corrupt(THREE.MathUtils.clamp((t - 0.8) / 3.8, 0, 1));
    if (t > 4.8 && this.dying < 100) {
      this.dying = 100; // una vez
      if (this.mp) return this.spectate();
      this.renderer.setAnimationLoop(null); // la imagen se queda congelada: el cuelgue
      this.onDeath?.();
    }
  }

  // ── la misión ────────────────────────────────────────────────────────────

  /** La misión de una partida en solitario: una al azar, sin dinero. */
  private soloMission(m: Maze): ActiveMission {
    const tvs = tvCount(m), kinds: MissionKind[] = ['photos', 'tapes', 'survive', ...(tvs >= 3 ? (['tvs'] as const) : [])];
    return { ...makeMission(kinds[(Math.random() * kinds.length) | 0], Math.random, 'solo', tvs), progress: 0, done: false, exit: false };
  }

  /** Solo: el progreso de la misión sale de lo que se hace aquí; al cumplirse se abre el ascensor. */
  private soloTick() {
    const m = this.mission, it = this.items;
    if (!m || m.done || !it) return;
    m.progress = Math.min(m.goal, m.kind === 'photos' ? it.photos : m.kind === 'tapes' ? it.tapes : m.kind === 'survive' ? Math.floor(this.t) : (this.tvs?.off ?? 0));
    if (m.progress >= m.goal) (m.done = m.exit = true), this.missionDone(true);
  }

  /** En una sala: la misión y el ascensor según el servidor. */
  private roomUpdate(r: RoomView) {
    this.floorNo = r.floor ?? 1;
    const was = !!this.mission?.exit, wasDone = !!this.mission?.done && this.mission.id === r.mission?.id;
    this.mission = r.mission;
    this.ascent = r.ascent ? { left: r.ascent.left, at: performance.now(), boarded: r.ascent.boarded } : null;
    if (this.parking && r.mission?.kind === 'survive') {
      const level = this.parking.level;
      level.advanceSurvival(Math.max(0, r.mission.progress - (r.mission.goal - level.survivalRemaining)));
    }
    if (this.parking && this.mp && r.ascent?.boarded.includes(this.mp.id) && !this.winning) {
      this.winning = true;
      this.player!.frozen = this.player!.lookFree = true;
      this.bagOpen = false;
      this.parking.level.boardElevator();
    }
    if (r.mission?.done && !wasDone) this.missionDone(!was);
    if (this.items && this.items.ready !== !!r.mission?.exit) dlog('mission', `exit ${!!r.mission?.exit} done ${!!r.mission?.done}`);
    if (this.items) this.items.ready = !!r.mission?.exit;
  }

  /** La misión se ha cumplido: aviso y ascensor abierto (se abre al acercarse). */
  private missionDone(first: boolean) {
    if (this.items) this.items.ready = true;
    this.note = { text: this.caps.hotel ? 'MISSION COMPLETE · TALK TO A FACELING FOR ANOTHER, OR LEAVE' : 'MISSION COMPLETE · GO TO THE ELEVATOR', until: performance.now() + 6000 };
    if (this.parking) this.parking.objectiveComplete();
    else this.audio?.done();
  }

  /** Y: suelta una unidad del objeto elegido de la barra rápida. */
  private dropSelected() {
    const id = this.player?.hot[this.player.hotSel];
    if (id && (ITEM_IDS as string[]).includes(id)) this.dropItem(id as ItemId);
  }
  /** Suelta una unidad de `id` delante de uno para los compañeros (solo en una sala): el servidor comprueba que la llevaba y la pone en el suelo para todos. */
  dropItem(id: ItemId) {
    const p = this.player, lobby = this.lobbyP, mp = lobby ? this.waitMp : this.mp;
    if (!p || !mp || (!lobby && (this.dying >= 0 || this.winning || this.spectating || p.hideState !== 'out')) || !p.owns(id)) return;
    // (en la sala de espera el servidor devuelve el inventario con `inv` y `waitRoom` lo aplica)
    mp.sock.emit('drop', id, 0, (ok) => ok && !lobby && (p.lose(id), this.poolInv()));
  }
  /** Suelta la pieza `i` del botín (en la sala de espera, sobre la báscula, se vende). El servidor manda luego lo que queda (`bag` o `inv`). */
  dropLoot(i: number) {
    const p = this.player, lobby = this.lobbyP, mp = lobby ? this.waitMp : this.mp;
    if (!p || !mp || (!lobby && (this.dying >= 0 || this.winning || this.spectating || p.hideState !== 'out'))) return;
    mp.sock.emit('drop', 'loot', i);
  }
  /** Poolrooms: lo que llevo ha cambiado (soltar, coger): el inventario de la sala, el tanque y la pistola de agua al día. */
  private poolInv() {
    const pl = this.pool, mp = this.mp, p = this.player;
    if (!(pl instanceof PoolLevel) || !mp || !p) return;
    mp.inv = p.inventory;
    pl.tank = p.tankWorn;
  }

  /** El final de una ronda ganada, igual en todos los niveles (epilogue.ts): de pie en fila donde se acabó, cada uno con su pose de victoria y las entidades bailando. */
  private epi?: { floor: number; ep: Epilogue; self?: Remote; lv?: PoolLevel; pk: boolean };
  private liveAt = new THREE.Vector3();
  private liveYaw = 0;
  /** Monta el final (false: no se puede aquí y se sigue con la pantalla de siempre). Cada nivel solo pone su escenario. */
  epilogue(r: RoundResult, me: string): boolean {
    const w = this.world, pl = this.player, pk = this.parking, lv = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (!this.mp || !r.victory || !this.assets || !pl || (!pk && !lv && !w) || (this.pool && !lv)) return false;
    // el sitio del final: uno al azar, espacioso (no donde se acabó). Cada nivel dice dónde se puede estar de pie y cuánto mide; si no hay ninguno, donde se estaba
    const y0 = this.liveAt.y;
    let arena: Arena, floor = 0, yAt = (_x: number, _z: number) => y0;
    if (pk) {
      const fl = pk.level.map.floors;
      floor = fl.reduce((b, f) => (Math.abs(f.y - y0) < Math.abs(fl[b].y - y0) ? f.index : b), 0);
      const b = fl[floor].bounds;
      arena = { x0: b.x, x1: b.x + b.w, z0: b.z, z1: b.z + b.d, ok: (x, z) => !!pk.level.fits(x, z, fl[floor].y, false) };
      yAt = () => fl[floor].y;
    } else if (lv) {
      arena = { x0: 0, x1: lv.map.w * POOL_CELL, z0: 0, z1: lv.map.h * POOL_CELL, ok: (x, z) => { if (lv.solid(x, z)) return false; const f = lv.floorAt(x, z, y0); return f != null && Math.abs(f - y0) < 0.35 && !lv.liquidAt(x, z, y0); } };
      yAt = (x, z) => lv.floorAt(x, z, y0) ?? y0;
    } else {
      const m = w!.maze;
      arena = { x0: CELL, x1: (m.w - 1) * CELL, z0: CELL, z1: (m.h - 1) * CELL, ok: (x, z) => !w!.solid(this.caps.hotel ? wrapX(x) : x, z) };
    }
    const spot = findSpot(arena);
    const from = spot ? new THREE.Vector3(spot.x, yAt(spot.x, spot.z), spot.z) : this.liveAt.clone();
    const yaw = spot ? Math.random() * Math.PI * 2 : this.liveYaw;
    const solid = spot ? (x: number, z: number) => !arena.ok(x, z) : (x: number, z: number) => (!pk && !lv ? w!.solid(this.caps.hotel ? wrapX(x) : x, z) : false);
    const stage: Stage = { scene: pk ? pk.level.scene : lv ? lv.scene : w!.root, camera: lv ? lv.camera : this.camera, solid };
    // en el parking y las Poolrooms mi cuerpo no cuelga del mundo: me hago un clon como los de los demás
    let self: Remote | undefined;
    if (pk || lv) {
      self = new Remote(this.assets);
      self.reset(me, '');
      self.setLook(this.lookOf(me));
      stage.scene.add(self.root);
    }
    const order = [me, ...Object.keys(r.victory).filter((id) => id !== me && this.remotes.has(id))].slice(0, 4);
    const actors: Actor[] = order.map((id) => {
      const rem = id === me ? self : this.remotes.get(id), em = r.victory![id] || 1;
      if (rem)
        return {
          place: (at, yaw) => ((rem.root.visible = true), rem.set({ x: at.x, y: at.y, z: at.z, yaw, pitch: 0, anim: 'Neutral Idle', light: false, held: 'none', emote: em } as PlayerState)),
          tick: (dt) => rem.update(dt),
        };
      return { place: () => {}, tick: (dt, at, yaw) => pl.showEmote(EMOTE_DEFS[em - 1].clip, _feet.copy(at), yaw, dt) }; // yo, en el laberinto: mi propio cuerpo
    });
    // lo que baila: las entidades de este nivel (y siempre el partygoer y la bacteria); las de verdad se esconden
    const kinds = [...new Set<Kind>(['partygoer', 'bacteria', ...this.entities.filter((e) => e.alive).map((e) => e.kind)])];
    for (const e of this.entities) ((e.rig.root.visible = false), e.balloon && (e.balloon.visible = false));
    pk?.enemies?.hide();
    const ep = new Epilogue(stage, this.assets, from, yaw, actors, kinds);
    this.epi = { floor, ep, self, lv, pk: !!pk };
    if (lv) {
      // el mundo de las Poolrooms deja la cámara donde está el cuerpo: se lleva ahí (de pie, sin ascensor ni desmayo)
      Object.assign(lv as unknown as Record<string, unknown>, { px: ep.c.x, py: ep.c.y, pz: ep.c.z, yaw: ep.face, pitch: -0.08, vy: 0, ride: undefined, hold: undefined, faint: 0, dead: false });
    }
    this.winning = true;
    this.black = 0;
    this.vhs.uniforms.uBlack.value = 0;
    this.vhs.enabled = false;
    this.flash.intensity = 0;
    this.input.unlock();
    this.input.suspend = true;
    return true;
  }
  private epiFrame(dt: number) {
    const e = this.epi!;
    this.t += dt;
    if (!this.player) return;
    this.world?.update(this.t, dt);
    if (e.lv) e.lv.post(dt, { ...this.input.read(), move: _none, look: _none, crouch: false, run: false }, true); // (el agua, la luz y la niebla de las Poolrooms; la cámara la pone el final)
    if (e.self) (this.player.hideHeld(), (this.player.rig.root.visible = false)); // (mi cuerpo de primera persona no pinta nada aquí: el que se ve es el clon)
    e.ep.frame(dt);
    if (e.pk) this.parking?.render(dt, this.t, this.camera, { x: e.ep.c.x, y: e.ep.c.y, z: e.ep.c.z, floor: e.floor });
    this.flash.intensity = 0;
    this.vhs.uniforms.uTime.value = this.film.uniforms.uTime.value = this.t;
    this.vhs.uniforms.uAspect.value = this.camera.aspect;
    this.composer.render(dt);
  }

  /** Dentro del ascensor: las puertas se cierran, la grabación se corta a negro y «Noclip». */
  private viaStairs = false;
  private win(stairs = false, floor?: number) {
    this.winning = true;
    this.viaStairs = stairs;
    this.player!.frozen = this.player!.lookFree = true; // quieto, pero mira alrededor: el viaje se ve desde dentro
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (pl) (pl.hold = true), (this.note = { text: 'GOING UP', until: performance.now() + 3000 });
    if (!stairs) (this.world?.cab ?? pl?.cab)?.board(); // (por la escalera no hay cabina: se corta a negro sin más)
    this.bagOpen = false;
    if (!pl) unlock('backrooms');
    this.mp?.sock.emit('ascend', this.player!.inventory, floor); // sube con lo que lleva; el servidor lo acota y cierra la ronda cuando suben todos o se acaba el tiempo
    setTimeout(() => this.onWin?.(), (stairs ? 0 : RIDE * 1000) + 2600);
  }

  // desarrollo: dos dianas quietas delante del inicio, para probar fotos y tiros sin entidades
  fakeEntities() {
    const p = this.player!, f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const mk = (d: number): Target => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), new THREE.MeshStandardMaterial({ color: 0xaa2222 }));
      m.position.copy(p.pos).addScaledVector(f, d).setY(0.9);
      this.world!.root.add(m);
      const t = { pos: m.position.clone().setY(0), height: 1.8, alive: true, hit: () => ((t.alive = false), (m.visible = false), true) };
      return t;
    };
    this.items!.targets = [...this.entities, mk(2.5), mk(4.5)];
  }

  /** La cinta se rompe (0–1): la imagen y el sonido. */
  corrupt(f: number) {
    this.corruption = f;
    this.vhs.uniforms.uCorrupt.value = f;
    this.audio?.corrupt(f);
  }

  /** Abre el inventario: el puntero queda suelto para hacer clic; la partida sigue. */
  openBag() {
    this.audio?.cue('bag');
    this.bagOpen = true;
    this.input.clear(); // el joystick y RUN del táctil se desmontan sin soltar
    this.input.suspend = true;
    this.input.unlock();
  }
  /** La tienda del Faceling: abierta, como la mochila (E o Esc la cierran). */
  shopOpen = false;
  private hallIn = false;
  private tp = 0; // los saltos de posición legítimos (se lo cuenta al servidor)
  private sentX = 0;
  /** 0 → 1 mientras la cámara se va de mis ojos a la vista de lado del Faceling (y de vuelta). */
  private shopT = 0;
  private shopV?: { x: number; z: number; dx: number; dz: number };
  openShop() {
    const p = this.player;
    this.shopV = p && this.world?.shopView(p.pos.x, p.pos.z);
    this.shopOpen = true;
    this.openBag();
  }
  /** La cámara de la tienda: al Faceling, de perfil y a la izquierda de la pantalla, mirando hacia la tienda. Va después de que el jugador ponga la suya. */
  private shopCam(dt: number) {
    const v = this.shopV, cam = this.camera;
    this.shopT = THREE.MathUtils.clamp(this.shopT + (this.shopOpen ? dt : -dt) / 0.7, 0, 1);
    if (this.player) this.player.away = this.shopT > 0.15; // (con la cámara ya en camino, fuera manos y objetos)
    if (!v || this.shopT <= 0) return;
    const e = this.shopT * this.shopT * (3 - 2 * this.shopT);
    // de frente: la cámara delante de él (hacia donde mira) y apuntando un poco a su derecha (la nuestra, mirándole), para que quede a la izquierda de la pantalla
    const tgt = new THREE.Vector3(v.x, 1.5, v.z), pos = tgt.clone().add(new THREE.Vector3(v.dx * 1.25, 0.02, v.dz * 1.25)), look = tgt.clone().add(new THREE.Vector3(v.dz * 0.5, -0.04, -v.dx * 0.5)); // (muy cerca: de la cara al pecho)
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0)));
    cam.position.lerp(pos, e);
    cam.quaternion.slerp(q, e);
  }
  buyHere(id: ItemId) {
    this.player?.receive(id);
  }
  closeBag() {
    this.audio?.cue('bagClose');
    this.bagOpen = false;
    this.shopOpen = false;
    this.input.suspend = false;
    this.input.lock();
  }

  /** Escribir en el chat: el teclado es del campo de texto, el puntero queda suelto (y soltarlo no pausa). */
  openChat() {
    this.input.clear();
    this.input.suspend = true;
    this.input.unlock();
  }
  closeChat() {
    if (this.bagOpen) return;
    this.input.suspend = false;
    this.input.lock();
  }

  /** Dentro del ascensor, cerrando la grabación. */
  get escaping() {
    return this.winning;
  }

  /** Congela la partida (el último fotograma se queda) y avisa al caparazón. */
  pause() {
    if (this.paused) return;
    this.parking?.interrupt();
    this.paused = true;
    this.input.active = false;
    this.input.clear();
    this.input.unlock();
    this.onPause?.();
  }
  resume() {
    this.paused = false;
    this.input.active = true;
    this.input.lock();
    this.parking?.audio?.resume();
    this.clock.getDelta();
  }

  // ── la sala de espera ────────────────────────────────────────────────────

  /**
   * Montar la sala de espera 3D (waiting.ts) sobre el compositor: se descargan sus modelos, se compila con los demás
   * jugadores ya dentro y empieza a pintar. Devuelve false si se canceló mientras tanto (se salió de la sala).
   */
  async enterWaiting(mp: Mp, room: RoomView) {
    this.leaveWaiting();
    const tok = ++this.waitTok;
    const free = holdStill(); // en Firefox compilar congela la página: con la pantalla quieta
    try {
      const wr = await (await import('./waiting')).WaitingRoom.load(this.assets!, this.opts.reduced);
      if (tok !== this.waitTok) return wr.dispose(), false;
      wr.resize(this.camera.aspect);
      // el clon de un jugador, dentro mientras se compila: su material estrenaría programa con el primero que llegue
      const probe = this.spare.pop() ?? new Remote(this.assets!);
      probe.reset('probe', 'probe');
      wr.scene.add(probe.root);
      await compileGently(this.renderer, wr.scene, wr.camera);
      probe.root.removeFromParent();
      this.spare.push(probe);
      if (tok !== this.waitTok) return wr.dispose(), false;
      this.waiting = wr;
      this.waitMp = mp;
      wr.spawn(Math.max(0, room.players.findIndex((p) => p.id === mp.id)));
      // el controlador de siempre, también aquí: manos con IK, linterna, objetos y barra rápida. La sala pone la posición, el salto y el agachado; el Player, lo que se ve
      const stub = { root: wr.scene, solid: (x: number, z: number) => wr.solid(x, z), furniture: () => false, voidAt: () => false } as unknown as World;
      wr.scene.add(wr.camera);
      const lp = (this.player = new Player(stub, this.assets!, wr.camera, this.flash, this.opts.reduced));
      lp.poolMode = true;
      lp.setLook(this.lookOf(mp.id)); // (mi skin en la sala de espera)
      lp.drinkOff = true;
      this.lobbyP = true;
      wr.camera.add(this.flash, this.flash.target); // (leaveWaiting la devuelve a la cámara del juego)
      await compileGently(this.renderer, wr.scene, wr.camera); // lo que trae mi Player (manos, objetos, linterna) estrenaba programas al girar la cámara: ahora, con la pantalla quieta
      if (tok !== this.waitTok) return wr.dispose(), false;
      wr.sfx = (n) => {
        const a = this.audio;
        if (n === 'creak') a?.creak();
        else if (n === 'boom') a?.boom();
        else if (n === 'alarm' || n === 'alarmoff') a?.alarm(n === 'alarm');
        else if (n === 'vend') a?.vend();
        else if (n === 'beat') a?.heartbeat(5);
        else if (n === 'steps') a?.farSteps(5);
        else if (n === 'groan') a?.groan(3);
        else (a?.click(), n === 'thunk' && a?.clunk(true));
      };
      wr.onPress = () => mp.sock.emit('start');
      wr.onComputer = (open) => {
        this.input.clear();
        this.input.suspend = open;
        if (open) this.input.unlock();
        else this.input.lock();
        this.onWaitComputer?.(open);
      };
      wr.onVend = (done) => mp.sock.emit('buy', 'water', done);
      wr.onLockers = (open) => {
        this.input.clear();
        this.input.suspend = open;
        if (open) this.input.unlock();
        else this.input.lock();
        this.onWaitLockers?.(open);
      };
      const onStashList = (l: Parameters<typeof wr.setStash>[0], mine: number) => wr.setStash(l, mine);
      mp.sock.on('stash', onStashList);
      this.offWait.push(() => mp.sock.off('stash', onStashList));
      mp.sock.emit('stashTake', -1); // (pide lo que guardan mis casilleros)
      wr.setOwners(this.lockerOwners);
      wr.onBag = () => {
        this.waitBag = true;
        this.input.clear();
        this.input.suspend = true;
        this.input.unlock();
        this.onWaitBag?.(true);
      };
      wr.onBoard = (open) => {
        this.input.clear();
        this.input.suspend = open;
        if (open) this.input.unlock();
        else this.input.lock();
        this.onWaitBoard?.(open);
      };
      this.audio ??= new GameAudio(undefined, this.muted, this.volume);
      this.audio.start();
      this.waitRoom(room);
      // los demás jugadores
      const onPlayers = (all: Record<string, PlayerState & { name: string; dead: boolean }>) => this.waitPhase !== 'playing' && this.syncRemotes(all, mp.id, wr.scene);
      mp.sock.on('players', onPlayers);
      const beat = setInterval(() => performance.now() - this.lastFrame > 150 && this.waitSend(), 1000 / 15);
      // las teclas 1–5 son los emotes equipados (no mientras se escribe)
      const emoteKey = (e: KeyboardEvent) => {
        if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT' || !/^Digit[1-5]$/.test(e.code)) return;
        const n = Number(e.code.slice(5)), lp = this.player, id = lp?.hot[n - 1];
        if (this.lobbyP && id && HOT[id]?.have(lp!.own)) return; // una ranura con objeto: la usa el Player; solo las vacías son emotes
        const em = emoteGate.equipped[n - 1];
        if (em) wr.doEmote(em);
      };
      addEventListener('keydown', emoteKey);
      const onLDrops = (list: { id: string; kind: string; x: number; z: number; q?: { r: number } }[]) => this.syncLobbyDrops(list);
      mp.sock.on('ldrops', onLDrops);
      const onSold = (s: Sold) => (this.waiting?.sold(s), this.audio?.cue('sell'));
      mp.sock.on('sold', onSold);
      this.offWait.push(() => mp.sock.off('sold', onSold));
      this.offWait.push(() => (mp.sock.off('players', onPlayers), mp.sock.off('ldrops', onLDrops), clearInterval(beat), removeEventListener('keydown', emoteKey)));
      const rp = this.composer.passes[0] as RenderPass;
      rp.scene = wr.scene;
      rp.camera = wr.camera;
      this.input.active = true;
      this.paused = false;
      this.input.clear();
      this.t = 0;
      this.sendT = 0;
      this.stepAcc = 0;
      this.clock.start();
      this.renderer.setAnimationLoop(() => this.waitFrame());
      return true;
    } finally {
      free();
    }
  }

  /** El aspecto de cada jugador, según la sala: se aplica a los que ya se ven y a los que lleguen. */
  setLooks(room: RoomView) {
    this.looks = new Map(room.players.map((p) => [p.id, p.look]));
    for (const [id, r] of this.remotes) r.setLook(this.looks.get(id) ?? DEFAULT_LOOK);
    const me = this.mp ?? this.waitMp;
    if (me) this.player?.setLook(this.lookOf(me.id));
  }

  /** Lo que la sala dice de sí misma (propietario, fase, ajustes): la pantalla del ordenador y, si empieza la partida, la entrada. */
  waitRoom(room: RoomView, inv?: Inventory | null) {
    const wr = this.waiting, mp = this.waitMp;
    if (!wr || !mp) return;
    wr.bank = room.bank;
    wr.inv = inv ?? null;
    if (inv && this.lobbyP) this.player?.apply(inv); // lo que lleva el servidor (comprado, soltado, recogido) va a las manos y la barra
    this.waitPhase = room.phase;
    wr.owner = room.ownerId === mp.id;
    wr.setBoard(room.round, room.levelId);
    const DIFF = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD', nightmare: 'NIGHTMARE' } as const;
    wr.setScreen(['BACKROOMS', `ROOM ${room.code}`, room.name.toUpperCase(), `${room.public ? 'PUBLIC' : 'PRIVATE'} ${room.players.length}/${room.max}`, `DIFFICULTY ${DIFF[room.difficulty]}`, `SEED ${room.fixedSeed || 'RANDOM'}`]);
    if (room.phase === 'starting' && !wr.entering) {
      // todos pasan a la cámara automática: los mandos quedan suspendidos
      wr.begin();
      this.paused = false;
      this.input.active = true;
      this.input.clear();
      this.input.suspend = true;
    }
  }

  /** Lo que el caparazón enseña sobre la sala de espera. */
  get waitHud() {
    const wr = this.waiting;
    return { ready: !!wr, hint: wr?.hint ?? null, label: wr?.hintLabel ?? '', notice: wr?.notice ?? '', computer: wr?.mode === 'computer', board: wr?.mode === 'board', entering: !!wr?.entering, locked: this.input.locked, free: wr?.mode === 'free' };
  }

  /** Se cumple cuando la entrada por la puerta ha terminado (enseguida si no hay sala de espera). */
  waitDone() {
    return this.waiting ? this.waiting.whenDone() : Promise.resolve();
  }

  /**
   * Durante la votación de la misión: se prepara el nivel que viene (el laberinto de la semilla y su mundo, con los materiales ya compilados en
   * la carga) para que al empezar la partida no haya tirón. Cede el hilo entre un paso y otro; resuelve cuando está.
   */
  async warmLevel(seed: number, players: number, level = 'level0', floor = 1) {
    const a = this.assets;
    if (level === 'parking') return void (await import('./parking-round'));
    if (level === 'poolrooms') return void (await loadPoolKit()); // (el nivel se arma al empezar; las piezas ya están bajadas y leídas)
    if (!a) return;
    await this.levelReady(level); // (durante la votación: los objetos y los modelos del nivel bajan mientras se vota)
    this.ready.add(level);
    const tick = () => new Promise((r) => setTimeout(r, 30));
    await tick();
    const hotel = levelCaps(level).hotel, maze = hotel ? suitesMaze(seed, floor) : generateMaze(seed, players);
    await tick();
    new World(maze, a, hotel).dispose();
    await tick();
    return mazeHash(maze); // (el servidor la compara con la suya)
  }

  closeComputer() {
    this.waiting?.closeComputer();
  }

  private lobbyP = false;
  private lobbyHid = false;
  private lobbyVis: boolean[] = [];
  /** Lo soltado en la sala de espera: id → su modelo en el suelo (lo manda el servidor con `ldrops`). */
  private lobbyDrops = new Map<string, THREE.Object3D>();
  private lobbyDropResources = new Map<string, Set<{ dispose(): void }>>();
  private lobbyClaims = new Set<string>();

  private removeLobbyDrop(id: string) {
    this.lobbyDrops.get(id)?.removeFromParent();
    this.lobbyDrops.delete(id);
    this.lobbyDropResources.get(id)?.forEach((resource) => resource.dispose());
    this.lobbyDropResources.delete(id);
  }

  /** El Player en la sala de espera: se le da mi posición, mirada y altura (la sala los lleva) y se le deja poner manos, objetos y linterna. Con la cámara de otro sitio (sentado, ante la pantalla) se esconden. */
  private lobbyHands(dt: number, c: Controls, wr: WaitingRoom) {
    const me = this.player;
    if (!me || !this.lobbyP) return;
    const items = Object.values(me.items);
    const emo = wr.emoteClip; // (con un emote, el cuerpo entero a la vista de la cámara que lo mira; sentado en el suelo ya no se esconde todo)
    if (!wr.driving && !emo) {
      if (!this.lobbyHid) (this.lobbyVis = items.map((i) => i.visible)), items.forEach((i) => (i.visible = false)), me.hideBody(), (this.lobbyHid = true);
      this.flash.intensity = 0;
      return;
    }
    if (this.lobbyHid) (items.forEach((it, k) => (it.visible = this.lobbyVis[k] ?? false)), (this.lobbyHid = false));
    const cam = wr.camera;
    if (emo) {
      // el emote se ve de frente: la sala ya puso la cámara delante; el Player solo pone el cuerpo (con su clip), sin tocar la cámara
      const first = !settings.emoteCam;
      me.showEmote(emo, _feet.set(wr.pos.x, wr.py, wr.pos.z), wr.yaw, dt, first ? _head : undefined);
      if (first) cam.position.copy(_head).addScaledVector(cam.getWorldDirection(_dir), 0.12); // (la vista sale de la cabeza del cuerpo que hace el emote)
      this.flash.intensity = 0;
      return;
    }
    me.showEmote('', _feet, 0, dt);
    me.pos.set(wr.pos.x, cam.position.y - EYE, wr.pos.z);
    me.yaw = wr.yaw;
    me.pitch = wr.pitch;
    // La mirada ya la aplicó la sala (wr.yaw/pitch): al Player no se le da otra vez (la vista se adelantaba un fotograma). Y la cámara que deja el
    // Player es la buena mientras se conduce: sus manos (IK) y los objetos que cuelgan de la cámara están calculados contra esa pose; restaurar
    // la de la sala los separaba (hasta ~12 cm al mirar abajo, más el vaivén). La sala la rehace entera cada fotograma, así que no queda nada pegado.
    me.update(dt, { ...c, jump: false, crouch: false, look: _none });
    cam.updateMatrixWorld();
    if (c.drop) this.dropSelected();
    wr.lit = me.lightOn;
    wr.held = me.hand === 'camera' || me.hand === 'gun' ? me.hand : 'none';
    this.flash.intensity = me.lightOn ? FLASH * 0.15 : 0; // (la sala es pequeña: a 0,3 de la pantalla o la mesa la linterna quemaba la imagen)
    this.lobbyPick(c, wr);
    // lo soltado levita y gira, con el brillo de su rareza
    // lo soltado cae con físicas (gravedad, rebotes, rozamiento) y se queda quieto en el suelo; el brillo de su rareza sigue latiendo
    for (const o of this.lobbyDrops.values()) {
      const f = o.userData.phys as { v: THREE.Vector3; spin: THREE.Vector3; rest: boolean } | undefined, s = Math.min(dt, 0.05);
      if (f && !f.rest) {
        f.v.y -= 9.8 * s;
        o.position.x = THREE.MathUtils.clamp(o.position.x + f.v.x * s, -WAIT_HALF.x + 0.2, WAIT_HALF.x - 0.2);
        o.position.z = THREE.MathUtils.clamp(o.position.z + f.v.z * s, -WAIT_HALF.z + 0.2, WAIT_HALF.z - 0.2);
        o.position.y += f.v.y * s;
        o.rotation.x += f.spin.x * s;
        o.rotation.y += f.spin.y * s;
        o.rotation.z += f.spin.z * s;
        if (o.position.y <= 0.08) {
          o.position.y = 0.08;
          f.v.y *= -0.38;
          f.v.x *= 0.7;
          f.v.z *= 0.7;
          f.spin.multiplyScalar(0.55);
          if (Math.abs(f.v.y) < 0.5 && Math.hypot(f.v.x, f.v.z) < 0.25) (f.rest = true), (o.rotation.x = o.rotation.z = 0);
        }
      }
      pulse(o.children.find((k) => k.userData.glow), this.t);
    }
  }

  /** G: recoger lo soltado más cercano (a menos de 2,5 m); el servidor lo da si cabe. */
  private lobbyPick(c: Controls, wr: WaitingRoom) {
    const mp = this.waitMp;
    if (!mp || !c.grab) return;
    let best = '', bd = 2.5;
    for (const [id, o] of this.lobbyDrops) {
      if (this.lobbyClaims.has(id)) continue;
      const d = Math.hypot(o.position.x - wr.pos.x, o.position.z - wr.pos.z);
      if (d < bd) (bd = d), (best = id);
    }
    if (best) {
      const tok = this.waitTok;
      this.lobbyClaims.add(best);
      void claimPickup(mp.sock, best, (ok) => {
        if (tok !== this.waitTok || this.waiting !== wr) return;
        this.lobbyClaims.delete(best);
        ok ? this.audio?.pickup() : wr.say('CANNOT CARRY MORE');
      }, 2500, () => tok === this.waitTok && this.waiting === wr && this.waitMp === mp);
    }
  }

  /** Lo soltado en el suelo de la sala de espera: los nuevos se ponen con su modelo, los que ya no están se quitan. */
  private syncLobbyDrops(list: { id: string; kind: string; x: number; z: number; q?: { r: number } }[]) {
    const wr = this.waiting, a = this.assets;
    if (!wr || !a) return;
    const here = new Set(list.map((d) => d.id));
    for (const id of this.lobbyDrops.keys()) if (!here.has(id)) this.removeLobbyDrop(id);
    const g = a.gltf;
    const model: Record<string, [THREE.Object3D | undefined, number]> = { flashlight: [g.flashlight?.scene, 0.24], camera: [g.camcorder?.scene, 0.22], gun: [g.gun?.scene, 0.72], water: [g.water?.scene, 0.17], caution: [g.duct?.scene, 0.16], radar: [g.radar?.scene, 0.2], totem: [g.totem?.scene, 0.5] };
    for (const d of list) {
      if (this.lobbyDrops.has(d.id)) continue;
      const m = model[d.kind];
      const o = d.kind === 'loot' ? lootModel(d.q?.r) : m?.[0] ? fit(m[0].clone(true), m[1]) : new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.5 }));
      const resources = new Set<{ dispose(): void }>();
      if (d.kind === 'loot' || !m?.[0]) o.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) resources.add(mesh.geometry);
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mat) => resources.add(mat));
      });
      const fx = glow(d.q?.r ?? 0);
      o.add(fx);
      resources.add(fx.material);
      o.position.set(d.x, 1.1, d.z);
      o.rotation.y = (d.x * 3.1 + d.z) % 6.28;
      const h = Math.sin(d.id.split('').reduce((a2, ch) => a2 * 31 + ch.charCodeAt(0), 7)) * 43758.5453, u = h - Math.floor(h), an = u * Math.PI * 2;
      o.userData.phys = { v: new THREE.Vector3(Math.cos(an) * 0.9, 1.6, Math.sin(an) * 0.9), spin: new THREE.Vector3((u - 0.5) * 9, (u - 0.3) * 6, (0.5 - u) * 9), rest: false };
      wr.scene.add(o);
      this.lobbyDrops.set(d.id, o);
      this.lobbyDropResources.set(d.id, resources);
    }
  }

  private waitSend() {
    const wr = this.waiting;
    if (wr && this.waitMp) this.waitMp.sock.volatile.emit('state', { ...wr.state, t: performance.now() });
  }

  private waitFrame() {
    if (this.capped()) return;
    this.vhs.uniforms.uPool.value = this.film.uniforms.uVhs.value = 0;
    const dt = Math.min(this.clock.getDelta(), 0.05), wr = this.waiting;
    this.lastFrame = performance.now();
    if (!wr) return;
    this.t += dt;
    const c = this.input.read();
    if (this.waitBag && (c.bag || c.pause)) (c.bag = c.pause = false), this.closeWaitBag(); // E o Esc cierran el inventario
    if (this.waiting?.mode === 'locker' && c.pause) (c.pause = false), this.closeComputer(); // Esc cierra los casilleros
    // pausa (Esc, el puntero soltado): la sala sigue y los demás se ven; solo se sueltan los mandos
    if (c.pause && wr.mode === 'free' && !this.paused) this.pause();
    wr.update(dt, this.paused || wr.mode === 'starting' ? { ...c, move: _none.clone(), look: _none.clone(), bag: false, run: false } : c);
    this.lobbyHands(dt, c, wr);
    // en la entrada los demás se quedan mirando la puerta
    if (wr.entering) for (const r of this.remotes.values()) ((r.yaw = Math.atan2(r.pos.x, WAIT_HALF.z + r.pos.z)), (r.pitch = 0.05));
    for (const r of this.remotes.values()) r.update(dt);
    if (wr.speed > 0) {
      this.stepAcc += wr.speed * dt;
      const len = wr.speed > 2 ? 1.1 : 0.7;
      if (this.stepAcc > len) (this.stepAcc -= len), this.audio?.step(wr.speed > 2);
    }
    this.sendT += dt;
    if (this.sendT >= 1 / 15) (this.sendT = 0), this.waitSend();
    // el zumbido sigue al fluorescente y, al cruzar la puerta, sube con el negro
    this.audio?.power(wr.power * (1 - wr.black) + wr.black * 3.5);
    this.audio?.ambient(dt, 0.15, wr.black); // el bajo que bate sube con el negro de la entrada
    const u = this.vhs.uniforms;
    // mirando por la camcorder, la cinta (VHS) y el zoom, como en la partida
    const rec = this.lobbyP && !!this.player?.aiming && !this.paused && wr.mode === 'free';
    this.vhs.enabled = wr.black > 0 || rec;
    u.uFlash.value = 0;
    u.uAspect.value = rec ? wr.camera.aspect : 1;
    u.uTime.value = this.film.uniforms.uTime.value = this.t;
    u.uBlack.value = wr.black;
    this.composer.render(dt);
  }

  /** Quita la sala de espera: el compositor vuelve a pintar la escena del juego. */
  leaveWaiting() {
    this.waitTok++; // si aún se estaba cargando, se cancela
    this.lobbyClaims.clear();
    for (const id of this.lobbyDrops.keys()) this.removeLobbyDrop(id);
    this.offWait.forEach((f) => f());
    this.offWait = [];
    this.waitMp = undefined;
    this.waitPhase = '';
    this.waitBag = false;
    const wr = this.waiting;
    if (!wr) return;
    this.waiting = undefined;
    if (this.lobbyP) {
      (this.lobbyP = false), (this.lobbyHid = false);
      this.player?.dispose();
      this.player = undefined;
      this.camera.add(this.flash, this.flash.target);
      this.flash.intensity = 0;
    }
    wr.dispose();
    for (const r of this.remotes.values()) (r.root.removeFromParent(), this.spare.push(r));
    this.remotes.clear();
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = this.scene;
    rp.camera = this.camera;
    this.vhs.enabled = false;
    this.vhs.uniforms.uBlack.value = 0;
    this.vhs.uniforms.uAspect.value = this.camera.aspect;
    this.input.suspend = false;
    this.audio?.power(1);
  }

  // ── la sala ──────────────────────────────────────────────────────────────

  /** Escuchar a la sala: los demás jugadores, el mundo (entidades y objetos) y las muertes. */
  private wire(mp: Mp, items?: Items) {
    this.mp = mp;
    const s = mp.sock;
    worldTl.reset(100); // snapshots del mundo cada 100 ms
    const onPlayers = (all: Record<string, PlayerState & { name: string; dead: boolean }>) => {
      for (const id in all) this.hps[id] = all[id].hp ?? HP_MAX;
      if (this.player && all[mp.id]?.hp !== undefined) {
        if (!this.parking && all[mp.id].hp! < this.player.hp) this.audio?.cue('hurt');
        this.player.hp = all[mp.id].hp!;
      }
      this.syncRemotes(all, mp.id, this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene));
    };
    const onWorld = (w: WorldSnapshot) => this.applyWorld(w);
    const onBlast = (m: { id: string; x: number; y: number; z: number }) => this.blastFx(m);
    s.on('blastFx', onBlast);
    const onSeal = () => this.world?.sealGrand();
    s.on('seal', onSeal);
    const onDead = (id: string) => {
      if (id !== mp.id) return this.remotes.get(id)?.die();
      if (this.parking && this.player) return void (this.player.hp = 0);
      if (this.pool instanceof PoolLevel) return this.poolDied(this.pool);
      if (this.dying >= 0 || this.winning || !this.player) return;
      dlog('death', `hide ${this.player.hideState} holding ${this.holding} air ${this.breath.air.toFixed(2)} ents ${this.entities.filter((e) => e.alive && e.pos.distanceTo(this.player!.pos) < 6).map((e) => `${e.pos.distanceTo(this.player!.pos).toFixed(1)}m`).join(',')}`);
      // quien te ha pillado: la entidad más cerca (el servidor lo sabe antes de que llegue el siguiente snapshot)
      const p = this.player.pos;
      const e = this.entities.filter((e) => e.alive && e.pos.distanceTo(p) < 5).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0];
      e?.forceAttack();
      this.die(e);
    };
    // espectador: flechas o Tab cambian de compañero
    const key = (e: KeyboardEvent) => {
      if (!this.spectating || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Tab') (e.preventDefault(), this.watch(e.code === 'ArrowLeft' ? -1 : 1));
      else if (e.code === 'KeyV') this.specView = this.specView === 'eyes' ? 'chase' : 'eyes';
      else if (e.code === 'KeyC') this.toggleFree();
      else if (/^Digit[1-3]$/.test(e.code)) {
        const live = [...this.remotes.values()].filter((r) => !r.dead), t = live[Number(e.code.slice(5)) - 1];
        if (t) this.watching = t.id;
      }
    };
    // el Tótem de la vida: un caído corre «Run for your life» (todos lo ven en el HUD) y, al acabar, vuelve junto a quien lo usó
    const onReviving = (m: { id: string; name: string; by: string }) => {
      this.runners.set(m.id, m.name);
      if (m.id === mp.id) this.beginRun(); // (el nivel rojo secreto: en cualquier nivel)
    };
    const onRunFailed = (m: { id: string; name: string }) => {
      this.runners.delete(m.id);
      this.note = { text: `${m.id === mp.id ? 'YOU' : m.name.toUpperCase()} DID NOT MAKE IT`, until: performance.now() + 4000 };
      if (m.id !== mp.id) return;
      this.endRun();
      this.black = 0;
      this.input.suspend = false;
      this.input.soft();
      this.input.lock();
    };
    const onRevived = (m: { id: string; name: string; x: number; y: number; z: number; yaw: number }) => {
      this.runners.delete(m.id);
      this.note = { text: `${m.id === mp.id ? 'YOU ARE' : m.name.toUpperCase() + ' IS'} BACK`, until: performance.now() + 4000 };
      if (m.id !== mp.id) return this.remotes.get(m.id)?.revive();
      this.endRun();
      if (this.pool instanceof PoolLevel) return this.poolRevived(this.pool, m);
      this.dying = -1;
      this.killer = undefined;
      this.spectating = false;
      this.fly = undefined;
      this.black = 0;
      this.corrupt(0);
      this.immuneUntil = performance.now() + REVIVE_IMMUNE;
      this.player?.revive(new THREE.Vector3(m.x, this.parking ? m.y : 0, m.z), m.yaw);
      if (this.parking) {
        const point = this.parking.level.fits(m.x, m.z, m.y);
        if (point) Object.assign(this.parking.position, point);
      }
      for (const r of this.remotes.values()) r.setFirstPerson(false);
      this.input.suspend = false;
      this.input.soft();
      this.input.lock();
    };
    // la sala cambia (misión, progreso, ascensor): lo que el servidor dice manda
    const onRoom = (r: RoomView) => this.roomUpdate(r);
    const onInv = (inventory: Inventory) => {
      this.player?.apply(this.parking ? this.parkingInventory(inventory) : inventory);
    };
    s.on('room', onRoom);
    s.on('inv', onInv);
    const onPickFail = (why: string) => (dlog('pickup', `REJECTED ${why} at ${this.player ? this.player.pos.x.toFixed(2) + ',' + this.player.pos.z.toFixed(2) : '?'} inv ${JSON.stringify(this.player?.inventory)}`), this.note = { text: 'CANNOT TAKE THAT · ' + why, until: performance.now() + 2000 });
    s.on('pickFail', onPickFail);
    const onRlog = (m: string) => dlog('room', String(m).slice(0, 300));
    s.on('rlog', onRlog);
    this.offNet.push(() => (s.off('pickFail', onPickFail), s.off('rlog', onRlog)));
    const onBottle = (points: { x: number; y: number; z: number }[], duration: number) => {
      const model = itemModel('beer');
      if (!points.length) return;
      const scene = this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene);
      const mesh = model ? fit(model.clone(true), .24) : new THREE.Group();
      const path = points.map(point => new THREE.Vector3(point.x, point.y, point.z));
      mesh.position.copy(path[0]);
      scene.add(mesh);
      this.throws.add({ mesh, path, duration: Math.max(1, duration * 1000), start: performance.now() });
    };
    s.on('beerThrow', onBottle);
    this.offNet.push(() => s.off('beerThrow', onBottle));
    s.on('players', onPlayers);
    s.on('world', this.worldIn = (w: WorldSnapshot) => (document.hidden ? void (this.pendingWorld = w) : onWorld(w))); // (oculta: solo se guarda el último; al volver no hay ráfaga de cientos que procesar de golpe)
    s.on('dead', onDead);
    s.on('reviving', onReviving);
    s.on('revived', onRevived);
    s.on('runFailed', onRunFailed);
    addEventListener('keydown', key);
    document.addEventListener('visibilitychange', this.onVisible);
    this.offNet.push(() => document.removeEventListener('visibilitychange', this.onVisible));
    // con la pestaña oculta o la ventana sin foco el navegador para los fotogramas: la sala sigue sabiendo dónde estoy
    const beat = setInterval(() => performance.now() - this.lastFrame > 150 && !this.spectating && this.sendState(), 1000 / 15);
    this.offNet.push(() => clearInterval(beat));
    const onFx = (fx: AdminFx) => this.adminFx(fx); // (también los jugadores normales: la carta Uno Reverse los teletransporta)
    s.on('adminFx', onFx);
    this.offNet.push(() => s.off('adminFx', onFx));
    const onTool = (m: ToolFx) => this.toolFx(m);
    s.on('toolFx', onTool);
    voice.calls = this.callPeers;
    this.offNet.push(() => (s.off('toolFx', onTool), this.callPeers.clear()));
    this.offNet.push(() => (s.off('room', onRoom), s.off('inv', onInv), s.off('players', onPlayers), s.off('world', this.worldIn!), s.off('dead', onDead), s.off('blastFx', onBlast), s.off('seal', onSeal),s.off('reviving', onReviving), s.off('revived', onRevived), s.off('runFailed', onRunFailed), removeEventListener('keydown', key)));
    if (items) {
      items.claim = (id, done) => {
        if (id.includes(':')) s.emit('lockerTake', id.split(':')[0], Number(id.split(':')[1]), done);
        else void claimPickup(s, id, (ok) => (dlog('pickup', `${id} ${ok ? 'OK' : 'NO'}`), done(ok)), 2500, () => this.mp === mp && this.items === items);
      };
      items.onPhoto = () => s.emit('photo');
      items.onSnap = () => s.emit('snap');
    }
  }

  /** Los demás jugadores según lo que dice el servidor: se crean (con un clon reutilizado, en `parent`), se mueven y se quitan los que ya no están. */
  private syncRemotes(all: Record<string, PlayerState & { name: string; dead: boolean }>, me: string, parent: THREE.Object3D) {
    if (this.epi) return; // (el final de ronda coloca a cada uno él mismo)
    const seen = new Set<string>();
    for (const [id, st] of Object.entries(all)) {
      if (id === me) continue;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        if (this.remotes.size >= 3) continue; // ≤ 4 jugadores: tres clones, reutilizados
        r = this.spare.pop() ?? new Remote(this.assets!);
        r.reset(id, st.name);
        r.setLook(this.looks.get(id) ?? DEFAULT_LOOK);
        // en la sala de espera: sombra falsa y pasos (con volumen y lado según dónde esté respecto a mí)
        r.floorShadow = !!this.waiting && parent === this.waiting.scene;
        r.stepRunSpeed = this.parking ? 4 : 2.4;
        r.onStep = this.parking
          ? (rr, run) => this.parking?.teammateStep(rr.pos, run)
          : r.floorShadow ? (rr, run) => this.remoteStep(rr, run) : undefined;
        parent.add(r.root);
        this.remotes.set(id, r);
      }
      r.set(st);
      if (st.dead) r.die();
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) (r.root.removeFromParent(), this.remotes.delete(id), this.spare.push(r));
  }

  /** El paso de otro jugador en la sala de espera: más bajo cuanto más lejos y hacia el lado en que está. */
  private remoteStep(r: Remote, run: boolean) {
    const wr = this.waiting;
    if (!wr || !this.audio) return;
    const dx = r.pos.x - wr.camera.position.x, dz = r.pos.z - wr.camera.position.z, d = Math.hypot(dx, dz);
    // a su derecha: el producto con el lado derecho de la cámara
    const right = dx * Math.cos(wr.yaw) - dz * Math.sin(wr.yaw);
    this.audio.step(run, Math.max(0, 1 - d / 7) * 0.8, d > 0.2 ? Math.max(-0.9, Math.min(0.9, right / Math.max(d, 1))) : 0);
  }

  /** Deja de escuchar a la sala y quita a los demás. */
  private stopMp() {
    this.offNet.forEach((f) => f());
    this.offNet = [];
    for (const r of this.remotes.values()) (r.root.removeFromParent(), this.spare.push(r));
    this.remotes.clear();
    this.entMap.clear();
    this.runners.clear();
    this.mp = undefined;
  }

  private resync = false;
  private pendingWorld?: WorldSnapshot;
  private worldIn?: (w: WorldSnapshot) => void;
  private onVisible = () => {
    if (document.hidden) return;
    // de vuelta: el reloj sin el parón, los efectos viejos fuera y el último estado del mundo
    this.resync = true;
    this.clock.getDelta();
    this.fxList = [];
    const w = this.pendingWorld;
    this.pendingWorld = undefined;
    if (w) this.worldIn?.(w);
    dlog('tab', 'back to the tab');
  };

  /** El snapshot del servidor: las entidades (las nuevas se crean, las que faltan han muerto) y los objetos. */
  private applyWorld(w: WorldSnapshot) {
    const world = this.world ?? this.poolWorld, mp = this.mp;
    if (this.parking && mp) {
      if (w.parking) this.parking.sync(w.parking, mp.id);
      this.parkPick?.syncDrops(w.drops ?? []);
      return;
    }
    if (!world || !mp) return;
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    const here = new Set<number>(), now = performance.now(), t = w.t ?? now;
    // al volver de otra pestaña el reloj de interpolación y los estados guardados son de antes del parón (los paquetes llegan en
    // ráfaga): se parte de cero y las entidades se colocan ya donde dice el servidor (si no, se quedaban clavadas en las paredes)
    const resync = this.resync;
    if (resync) (this.resync = false), worldTl.reset(100);
    worldTl.push(t, now); // el reloj del mundo (hora del servidor): las entidades se dibujan algo en el pasado, con el ritmo del servidor
    for (const s of w.ents) {
      here.add(s.id);
      let e = this.entMap.get(s.id);
      if (e && resync) (e.track.buf.length = 0), e.net(s, true, t);
      if (!e) {
        e = new Entity(s.kind, world, this.assets!, world.cellAt(s.x, s.z), s.speed, s.hp, true);
        e.id = s.id;
        if (s.kind === 'faceling') (world.hideStaff(s.x, s.z), world.hideWalkers());
        if (pl) e.ground = (x, z) => pl.floorY(x, z);
        e.onHit = (id) => mp.sock.emit('hit', id);
        e.net(s, true, t);
        this.entMap.set(s.id, e);
        this.entities.push(e);
      } else e.net(s, false, t);
    }
    for (const [id, e] of this.entMap)
      if (!here.has(id)) {
        e.alive = false;
        this.entMap.delete(id);
        this.entities.splice(this.entities.indexOf(e), 1);
        if (e !== this.killer) this.burst(e, this.camera.position);
        else e.dispose();
      }
    // el personal del hotel (Facelings): si uno cae, todos van a por ti
    this.eehSnap = !!w.eeh;
    const fs = w.ents.filter((s) => s.kind === 'faceling'), mad = fs.some((s) => s.state === 'chase' || s.state === 'attack');
    if (!fs.length) this.staffMad = false;
    else if (mad && !this.staffMad) {
      this.staffMad = true;
      const why = w.vengeance ? 'SOMEONE KILLED ONE OF THEM' : w.eeh || isEeh(this.mission?.kind) ? 'THE EVAPORATOR FAILED' : 'THE STAFF SPOTTED YOU';
      this.note = { text: `${why} · THE STAFF IS HUNTING YOU · HIDE IN A WARDROBE (E) AND HOLD YOUR BREATH`, until: performance.now() + 6000 };
      this.audio?.cue('hurt');
    }
    this.items?.sync(w.taken, w.tapes);
    if (this.pool instanceof PoolLevel) {
      this.pool.pickups.sync(w.taken, w.tapes);
      this.pool.syncDrops(w.drops ?? []);
      for (const d of w.drops ?? []) this.dropKind.set(d.id, d.kind);
    }
    this.items?.syncDrops(w.drops ?? []);
    this.tvs?.sync(w.tvOff ?? [], this.audio);
    this.inspected = !!w.insp?.includes(mp.id);
  }

  /** Mi propio cuerpo con mi skin: se ve al mirar hacia abajo (sin cabeza; algo atrás para que el torso no tape la cámara). */
  /** Cada fotograma en una sala: los demás, lo que yo mando (15 Hz) y, si estoy muerto, la cámara del compañero. */
  private netFrame(dt: number, c: Controls) {
    const hall = this.caps.hotel && this.player ? { x: this.player.pos.x, span: SUITE_L * CELL } : undefined;
    for (const r of this.remotes.values()) ((r.hall = hall), r.update(dt), r.talk(voice.speaking.has(r.id)));
    // el chat de voz según la distancia (voice.ts): cuánto y hacia qué lado oigo a cada compañero; muerto o espectando, a todos por igual; a los muertos que espectean, también por igual
    const me = this.player, ears = new Map<string, VoicePos>();
    if (me && !me.dead && !this.spectating) {
      for (const r of this.remotes.values()) {
        if (r.dead) continue; // (un muerto que espectea no tiene sitio en el mapa: sin entrada se oye entero y centrado, para poder hablarle)
        ears.set(r.id, { pos: [r.pos.x, r.pos.y + 1.5, r.pos.z] });
      }
      voice.pose({ pos: [me.pos.x, me.pos.y + 1.5, me.pos.z], yaw: me.yaw }, ears);
    } else voice.pose({ pos: [0, 0, 0], yaw: 0 }, ears);
    for (const e of this.entities) e.hall = e.kind === 'faceling' ? hall : undefined;
    if (!this.spectating) {
      this.sendT += dt;
      if (this.sendT >= 1 / 15) (this.sendT = 0), this.sendState();
      return;
    }
    this.specCam(dt, c);
  }

  /** La cámara del espectador (la del juego o, en las Poolrooms, la del nivel). */
  private get cam() {
    return this.pool instanceof PoolLevel ? this.pool.camera : this.camera;
  }
  private specCam(dt: number, c: Controls) {
    this.player?.hideHeld(); // los objetos que llevaba (linterna, cámara, radar...) cuelgan de la cámara: sin esto salen en la vista de quien se mira
    const cam0 = this.cam;
    if (cam0.fov !== settings.fov) (cam0.fov = settings.fov), cam0.updateProjectionMatrix(); // (morir mirando por la camcorder dejaba el zoom puesto)
    if (this.specView === 'free') return this.freeFrame(dt, c);
    const live = [...this.remotes.values()].filter((r) => !r.dead);
    let t = this.remotes.get(this.watching);
    if (!t || t.dead) t = live[0];
    this.watching = t?.id ?? '';
    if (!t) return void (this.flash.intensity = 0);
    const cam = this.cam, eye = _spec.set(t.pos.x, t.pos.y + 1.62, t.pos.z);
    const chase = this.specView === 'chase';
    for (const r of this.remotes.values()) r.setFirstPerson(r === t && !chase);
    if (!chase) {
      // por sus ojos: donde está, hacia donde mira, y con su linterna
      this.specPos.copy(eye);
      cam.position.copy(eye);
      cam.rotation.set(t.pitch, t.yaw, 0, 'YXZ');
    } else {
      // desde detrás y algo por encima, sin atravesar paredes (si choca, se acerca) y con inercia
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw), w = this.world;
      let d = 2.4;
      while (d > 0.4 && w?.solid(eye.x - fx * d, eye.z - fz * d)) d -= 0.2;
      const want = _want.set(eye.x - fx * d, eye.y + 0.5 + (2.4 - d) * 0.1, eye.z - fz * d);
      if (this.specPos.distanceTo(eye) > 6) this.specPos.copy(want);
      this.specPos.lerp(want, 1 - Math.exp(-dt * 9));
      cam.position.copy(this.specPos);
      cam.lookAt(eye.x + fx * 1.5, eye.y - 0.15, eye.z + fz * 1.5);
    }
    this.haunt(cam.position);
    cam.updateMatrixWorld();
    this.flash.intensity = t.light ? FLASH * 0.85 : 0;
  }

  /** En las Poolrooms, el cuerpo caído sigue a la cámara del espectador para que el nivel se ilumine y se dibuje donde se mira. */
  private haunt(at: THREE.Vector3) {
    if (this.pool instanceof PoolLevel) (this.pool.ghost ??= new THREE.Vector3()).set(at.x, at.y - EYE, at.z);
  }

  /** C: entra o sale de la cámara libre (entra desde donde está la cámara ahora). */
  private toggleFree() {
    if (this.specView === 'free') return void (this.specView = this.specBack);
    this.specBack = this.specView;
    this.freePos.copy(this.cam.position);
    const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
    this.freeYaw = e.y;
    this.freePitch = e.x;
    this.specView = 'free';
  }

  /** Cámara libre del espectador: vuela sin colisión (WASD hacia donde mira, Shift más rápido), dentro del área del mapa. No toca la simulación. */
  private freeFrame(dt: number, c: Controls) {
    const cam = this.cam, m = this.world?.maze;
    for (const r of this.remotes.values()) r.setFirstPerson(false); // (al pasar de mirar por unos ojos a la cámara libre, su cabeza volvía a verse… o se quedaba sin ella)
    this.freeYaw -= c.look.x;
    this.freePitch = THREE.MathUtils.clamp(this.freePitch - c.look.y, -1.55, 1.55);
    cam.rotation.set(this.freePitch, this.freeYaw, 0, 'YXZ');
    const v = (c.run ? 9 : 3.5) * dt;
    this.freePos.addScaledVector(_want.set(0, 0, -1).applyQuaternion(cam.quaternion), c.move.y * v);
    this.freePos.addScaledVector(_want.set(1, 0, 0).applyQuaternion(cam.quaternion), c.move.x * v);
    if (this.pool instanceof PoolLevel) {
      // las Poolrooms: otro tamaño de mapa y alturas por debajo de 0 (agua, túneles) y hasta las salas altas
      const b = this.pool.freeBox();
      (this.freePos.x = THREE.MathUtils.clamp(this.freePos.x, 0, b.x)), (this.freePos.z = THREE.MathUtils.clamp(this.freePos.z, 0, b.z));
      this.freePos.y = THREE.MathUtils.clamp(this.freePos.y, b.y0, b.y1);
    } else if (this.parking) {
      // el parking: varias plantas hacia abajo (y negativas) y su propio tamaño
      const mp = this.parking.level.map, b = mp.floors[0].bounds, low = mp.floors[mp.floors.length - 1].y;
      (this.freePos.x = THREE.MathUtils.clamp(this.freePos.x, b.x - 2, b.x + b.w + 2)), (this.freePos.z = THREE.MathUtils.clamp(this.freePos.z, b.z - 2, b.z + b.d + 2));
      this.freePos.y = THREE.MathUtils.clamp(this.freePos.y, low + 0.3, mp.floors[0].y + PARKING_HEIGHT + 2);
    } else {
      if (m) (this.freePos.x = THREE.MathUtils.clamp(this.freePos.x, 0, m.w * CELL)), (this.freePos.z = THREE.MathUtils.clamp(this.freePos.z, 0, m.h * CELL));
      this.freePos.y = THREE.MathUtils.clamp(this.freePos.y, 0.3, HEIGHT - 0.2);
    }
    cam.position.copy(this.freePos);
    this.specPos.copy(this.freePos);
    for (const r of this.remotes.values()) r.setFirstPerson(false);
    this.haunt(cam.position);
    cam.updateMatrixWorld();
    this.flash.intensity = 0;
  }

  private sendState(reliable = false) {
    const p = this.player;
    if (!p || !this.mp) return;
    // volatile: si el túnel va atascado, este estado se pierde en vez de encolarse (el siguiente lleva lo último); t: la hora de ahora, para que
    // los demás reconstruyan mi ritmo aunque los paquetes lleguen tarde o juntos
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (pl && this.spectating) return; // (de espectador la cámara va por el mapa: el cuerpo se queda donde cayó)
    // Las Suites: al servidor se le cuenta siempre la copia del medio del pasillo (donde están los objetos); el salto al entrar o salir del vestíbulo es un teletransporte legítimo (`tp`)
    const at = pl ? pl.state : { x: this.caps.hotel ? wrapX(p.pos.x) : p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch };
    if (Math.abs(at.x - this.sentX) > 10) this.tp++; // (un teletransporte —Uno Reverse, admin, bucle de Las Suites— se cuenta aparte: el servidor no lo recorta)
    this.sentX = at.x;
    const socket = reliable ? this.mp.sock : this.mp.sock.volatile;
    socket.emit('state', { victory: emoteGate.victory, x: at.x, tp: this.tp, y: at.y, z: at.z, yaw: at.yaw, pitch: at.pitch, anim: 'Neutral Idle', dance: p.dancing || undefined, variant: p.variant || undefined, light: p.lightOn, duck: p.duck, tank: pl ? p.tankWorn : undefined, held: p.concealed || p.hand === 'watergun' ? 'none' : p.hand, jam: pl ? Math.round(pl.jam) : undefined, hiding: p.concealed, holding: this.holding, t: performance.now() });
  }

  /** Desarrollo (consola: `__game.stateHash()`): huellas FNV-1a del mapa y de las entidades (posiciones a 1 cm) para comparar a ojo entre dos ejecuciones o dos clientes. */
  stateHash() {
    return { maze: this.world ? mazeHash(this.world.maze) : null, ents: stateHash(this.entities.map((e) => ({ id: e.id, x: e.pos.x, z: e.pos.z }))) };
  }

  /** Estado de la red para depurar (consola: `__game.netInfo()`): ping, jitter y retraso de dibujo de cada jugador y del mundo. */
  netInfo() {
    return { rtt: netStats.rtt, world: { jitter: Math.round(worldTl.jitter), delay: Math.round(worldTl.delay) }, players: [...this.remotes.values()].map((r) => ({ name: r.name, ...r.net })) };
  }

  /** Muerto del todo: pasa a mirar por los ojos de un compañero. */
  private spectate() {
    this.spectating = true;
    this.fly = undefined;
    this.black = 0;
    this.corrupt(0);
    this.vhs.uniforms.uBlack.value = 0;
    for (const cam of [this.camera, this.cam]) (cam.fov = settings.fov), cam.updateProjectionMatrix();
    this.player?.hideHeld();
    this.watching = [...this.remotes.values()].find((r) => !r.dead)?.id ?? '';
  }

  /** Al siguiente (o anterior) compañero vivo. */
  private watch(dir: number) {
    const live = [...this.remotes.values()].filter((r) => !r.dead);
    if (!live.length) return;
    const i = live.findIndex((r) => r.id === this.watching);
    this.watching = live[(i + dir + live.length * 2) % live.length].id;
  }

  // ── el Tótem de la vida ──────────────────────────────────────────────────

  /** Clic con el tótem en la mano: el selector de compañeros caídos (vacío: «NO ONE TO REVIVE», y no se gasta). El puntero queda suelto como con el inventario. */
  private openTotem(phone = false) {
    if (this.totemOpen || this.run || this.spectating || this.dying >= 0) return;
    this.totemOpen = true;
    this.phone = phone;
    this.input.clear();
    this.input.suspend = true;
    this.input.unlock();
  }
  closeTotem() {
    if (!this.totemOpen) return;
    this.totemOpen = false;
    this.input.suspend = false;
    this.input.lock();
  }
  /** Elegido un compañero: el servidor comprueba que lo llevo y que está muerto; solo entonces se gasta. */
  useTotem(id: string) {
    const p = this.player;
    if (this.phone) {
      // el Nokia: llamar a ese compañero (el servidor lo conecta y manda `toolFx` a los dos)
      this.closeTotem();
      if (p) this.mp?.sock.emit('tool', { k: 'nokia', yaw: p.yaw, pitch: p.pitch, to: id }, (r) => !r.ok && r.why && (this.note = { text: r.why, until: performance.now() + 3000 }));
      return;
    }
    this.closeTotem();
    this.mp?.sock.emit('totem', id, (ok) => {
      if (!ok || !p) return;
      p.totem = Math.max(0, p.totem - 1);
      if (!p.totem) p.gadget = 'none';
    });
  }
  /** Caídos a los que se puede revivir (los que no corren ya). */
  private deadMates() {
    return [...this.remotes.values()].filter((r) => r.dead && !this.runners.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
  }
  private totemHud(): Hud['totem'] {
    const now = performance.now(), me = this.mp?.id;
    const notes = [...this.runners].filter(([id]) => id !== me && this.remotes.has(id)).map(([, n]) => `${n.toUpperCase()} IS RUNNING FOR THEIR LIFE`);
    if (now < this.note.until) notes.push(this.note.text);
    return { pick: this.totemOpen ? (this.phone ? [...this.remotes.values()].filter((r) => !r.dead).map((r) => ({ id: r.id, name: r.name })) : this.deadMates()) : null, phone: this.phone, run: this.run?.hud ?? null, notes, immune: Math.max(0, (this.immuneUntil - now) / 1000) };
  }

  /** Empieza «Run for your life» (runlevel.ts): su escena y su cámara sustituyen a las del juego en el compositor hasta que se acaba. */
  private runMod?: typeof import('./runlevel');
  private beginRun() {
    if (this.run || !this.assets) return;
    if (!this.runMod) return void import('./runlevel').then((m) => ((this.runMod = m), this.beginRun()));
    this.totemOpen = this.bagOpen = false;
    this.input.suspend = false;
    this.audio ??= new GameAudio(undefined, this.muted, this.volume);
    const r = (this.run = new this.runMod.RunLevel(this.assets, this.audio, this.opts.reduced, this.camera.aspect));
    r.onDone = () => this.mp?.sock.emit('runDone'); // el servidor lo comprueba y manda `revived`; hasta entonces, la imagen se queda en negro
    r.onFail = () => (this.mp ? this.mp.sock.emit('runFail') : this.endRun()); // una sola oportunidad: el servidor lo da por muerto (`runFailed`)
    // el controlador de siempre (cuerpo, manos con IK, linterna, barra rápida, inventario, latas, Monster...): el nivel solo le mueve el cuerpo
    const stub = { root: r.scene, solid: () => false, furniture: () => false, voidAt: () => false } as unknown as World;
    const me = new Player(stub, this.assets, r.camera, this.flash, this.opts.reduced);
    me.load(this.mp?.inv ?? START_INV);
    this.hookGear(me);
    r.attach(me);
    r.camera.add(this.flash, this.flash.target); // (endRun la devuelve a la cámara del juego)
    this.runSaved = this.player;
    this.player = me;
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = r.scene;
    rp.camera = r.camera;
    this.flash.intensity = 0;
    this.corrupt(0);
    this.input.soft(); // el puntero se pide sin gesto: si el navegador no lo da, un clic
    this.input.lock();
  }

  /** Cada fotograma del nivel: lo lleva el cliente (Esc pausa como siempre). */
  private runFrame(dt: number, c: Controls) {
    const r = this.run!;
    // en una sala, perder el foco (otra ventana) no debe congelar la carrera: solo Esc con foco pausa
    if (c.pause && (!this.mp || document.hasFocus())) return this.pause();
    this.t += dt;
    r.update(dt, c);
    const u = this.vhs.uniforms;
    this.vhs.enabled = r.glitch > 0.01 || r.black > 0.01;
    u.uTime.value = this.film.uniforms.uTime.value = this.t;
    u.uCorrupt.value = r.glitch;
    u.uBlack.value = r.black;
    u.uFlash.value = 0;
    u.uAspect.value = this.camera.aspect;
    this.composer.render(dt);
  }

  /** Vuelve a la escena del juego. */
  private endRun() {
    const r = this.run;
    if (!r) return;
    this.run = undefined;
    this.player?.dispose();
    this.player = this.runSaved;
    this.runSaved = undefined;
    this.camera.add(this.flash, this.flash.target);
    r.dispose();
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = this.parking?.level.scene ?? this.pool?.scene ?? this.scene; // (de vuelta al nivel en el que se estaba, también las Poolrooms y el parking)
    rp.camera = this.pool?.camera ?? this.camera;
    this.vhs.enabled = false;
    this.vhs.uniforms.uCorrupt.value = this.vhs.uniforms.uBlack.value = 0;
    this.vhs.uniforms.uPool.value = this.film.uniforms.uVhs.value = 0;
    this.vhs.uniforms.uAspect.value = this.camera.aspect;
  }

  /** Desarrollo (`?pool`): el cuarto de prueba del agua de las Poolrooms (pool.ts). Sin VHS ni sala. */
  async devPool(level = false) {
    this.input.suspend = false;
    const kit = level ? await loadPoolKit() : {};
    const p = (this.pool = level ? new PoolLevel(this.camera.aspect, this.renderer, Number(new URLSearchParams(location.search).get('seed')) || 1, kit) : new PoolTest(this.camera.aspect, this.renderer));
    if (DEV_LOCAL) (window as unknown as { __pool?: PoolTest | PoolLevel }).__pool = p; // consola: __pool.splash(x, z, 1.5)
    if (p instanceof PoolLevel) this.poolFx(p);
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = p.scene;
    rp.camera = p.camera;
    this.flash.intensity = 0;
    this.vhs.enabled = false;
    this.input.soft();
    this.input.lock();
    this.input.begin();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private poolFrame(dt: number, c: Controls) {
    const pl = this.pool!, me = this.player;
    if (this.mp) {
      if (c.pause) return this.pause();
      if (this.totemOpen && c.bag) (c.bag = false), this.closeTotem(); // Esc o E cierran el selector del Tótem (como en el nivel 0)
      // el inventario: la tecla lo abre y lo cierra (como en el nivel 0; ni muerto ni subiendo)
      if (c.bag) this.bagOpen ? this.closeBag() : pl instanceof PoolLevel && (pl.dead || this.winning) ? undefined : this.openBag();
      if (pl instanceof PoolLevel) c = this.poolMatch(pl, dt, c);
    }
    if (pl instanceof PoolLevel && me) {
      // el mismo Player de siempre mueve el cuerpo (con las constantes de locomotion.ts y a través del mundo, que sabe de agua, tubos y plantas) y pone la cámara
      pl.speedK = perks.stats.speed * me.speedMul * (me.pillOn ? PILLS.speed : 1);
      pl.speedAdd = me.pillSpeed;
      pl.jumpK = me.jumpMul * (me.pillOn ? PILLS.jump : 1);
      pl.slowMul = (me.aiming ? CAM_AIM_SLOW : 1) * me.buffSpeed; // enfocar con la camcorder frena (igual que en el laberinto)
      const cc = pl.pre(dt, me.winded && c.run ? { ...c, run: false } : c); // sin aguante no se corre (el Player lo gasta)
      this.poolHands(pl, dt, cc);
      if (!pl.dead && !this.winning) pl.pickups.tick(this.t, dt, cc); // lo recogible (pickups.ts), como en el nivel 0
      pl.sqShow = me.hand === 'watergun' && !pl.dead;
      pl.sqVal = me.squirt;
      pl.post(dt, cc);
    } else pl.update(dt, c);
    if (pl instanceof PoolLevel && me) for (const e of this.entities) e.alive && e.update(dt, me.pos, pl.camera.position, null, false, true); // las entidades de la sala (el servidor las lleva)
    if (this.spectating) this.specCam(dt, c);
    // la cinta (líneas de barrido, croma) fuera del nivel: solo el grano de la película, que se mueve
    // (mirando por la cámara de fotos sí: el visor con la cinta, como en el nivel 0)
    const aim = !!me?.aiming && !this.spectating;
    this.vhs.enabled = aim;
    this.vhs.uniforms.uAspect.value = this.camera.aspect;
    this.vhs.uniforms.uTime.value = this.film.uniforms.uTime.value = this.t += dt;
    this.film.uniforms.uMad.value = 0;
    this.drawMap();
    this.shakeCam(dt);
    const t0 = performance.now();
    this.renderer.info.autoReset = false; // el compositor hace varias pasadas: se cuentan todas y se reinicia aquí
    this.renderer.info.reset();
    this.composer.render(dt);
    if (this.picSnap) {
      this.picSnap = false;
      this.pics.thumbs.push(this.shot(160, 120, 0.7));
      this.pics.full.push(this.shot(960, 720, 0.88));
    }
    // medición (paso 2 del plan): CPU de envío por fotograma, draw calls y triángulos; texto fijo arriba a la izquierda
    const s = (this.poolStat ??= { n: 0, ms: 0, el: Object.assign(document.createElement('pre'), { style: 'position:fixed;left:8px;top:8px;margin:0;color:#fff;font:12px monospace;z-index:9;pointer-events:none;text-shadow:0 0 3px #000' }) });
    if (!s.el.isConnected && !this.mp) document.body.append(s.el);
    s.n++, (s.ms += performance.now() - t0);
    if (s.n >= 30 && this.mp) s.n = s.ms = 0;
    else if (s.n >= 30) {
      const i = this.renderer.info.render;
      s.el.textContent = `render ${(s.ms / s.n).toFixed(2)} ms cpu
calls ${i.calls}  tris ${i.triangles}
fps ${(1 / Math.max(dt, 1e-3)).toFixed(0)}`;
      s.n = s.ms = 0;
    }
  }
  /** El Player de siempre en las Poolrooms: mueve el cuerpo por el mundo (`terrain`), pone la cámara, las manos, el cuerpo y la linterna. */
  private poolHands(pl: PoolLevel, dt: number, c: Controls) {
    const me = this.player;
    if (!me) return;
    me.dead = pl.dead; // muerto: el Player tumba el cuerpo donde cayó y esconde las manos (la cámara la pone entonces PoolLevel / el espectador)
    // la cámara de fotos sí se apunta (clic derecho, zoom) y dispara, salvo nadando o muerto
    const swim = pl.state.swim, cam_ok = !pl.dead && !swim && !this.winning;
    me.update(dt, { ...c, crouch: !!c.crouch && !pl.dead, aim: c.aim && cam_ok, zoom: cam_ok ? c.zoom : 0, ...(this.winning ? { slot: -1, wheel: 0, use: false, swap: false } : {}) }); // (la barra rápida y la rueda, como en el nivel 0, las lleva el Player)
    if (!cam_ok && me.aiming) (me.aiming = false), (me.zoom = 1);
    if (swim && !pl.dead) me.rig.root.visible = false;
    if (c.fire && cam_ok && me.hand === 'camera' && me.aiming && this.t - this.picAt > 0.8) {
      this.picAt = this.t;
      this.picSnap = true;
      this.audio?.shutter();
      this.mp?.sock.emit('snap');
    }
  }
  /** Lo nuevo del jugador que avisa al servidor: la Monster (se gasta) y la carta Uno Reverse (cambia de sitio con otro al azar). */
  private hookGear(p: Player) {
    // los objetos de las Suites: el clic los usa y el servidor decide (nokia: sin llamada abre la lista de compañeros; con ella, cuelga)
    p.onTool = (k) => {
      if (!this.mp) return;
      if (k === 'nokia' && !this.callPeers.size) return this.openTotem(true);
      this.mp.sock.emit('tool', { k, yaw: p.yaw, pitch: p.pitch }, (r) => {
        if (r.why && r.why !== 'WAIT') this.note = { text: r.why, until: performance.now() + 3000 };
        if (r.ok) this.audio?.cue('equip');
        if (r.used) p.lose(k);
      });
    };
    p.onGlasses = (e) => (e === 'break' ? this.mp?.sock.emit('glassesBreak') : this.mp?.sock.emit('glasses', e === 'on'));
    p.onMonster = () => (this.audio?.drink(), this.mp?.sock.emit('monster'));
    p.onUno = (done) => {
      if (!this.mp) return done(false);
      this.mp.sock.emit('uno', (ok) => (ok && this.audio?.cue('equip'), done(ok)));
    };
    p.onParkingItem = (id, done) => {
      if (!this.mp) return done(false);
      this.sendState(true);
      this.mp.sock.timeout(3000).emit('useParkingItem', id, (error, result) => {
        dlog('item', `${id} ${error ? 'ERROR ' + error.message : result ? 'ok ' + JSON.stringify(result) : 'refused'} hp ${Math.round(p.hp)}`);
        if (error || !result || this.player !== p) return done(false);
        if (id === 'pills') this.audio?.drink();
        else if (id !== 'beer') this.audio?.cue('equip');
        if (id === 'steelcard') {
          const winner = result.item ? ITEMS[result.item].name : 'ENTITY SPEED +0.5 M/S';
          const names = Object.values(ITEMS).map(item => item.name);
          const labels = Array.from({ length: 15 }, () => names[Math.floor(Math.random() * names.length)]);
          labels.push(winner);
          this.steelRoll = { winner, labels, serial: ++this.rollSerial, until: performance.now() + 4600 };
        }
        done(true);
      });
    };
  }
  /** Fotos de las Poolrooms (no hay Items allí): miniaturas y grandes, y el pedido de captura al pintar. */
  private pics = { thumbs: [] as string[], full: [] as string[] };
  private picSnap = false;
  private picAt = -9;
  private poolStat?: { n: number; ms: number; el: HTMLPreElement };

  private parkingInventory(inventory: Inventory): Inventory {
    return { ...inventory, gun: false, ammo: 0, watergun: false, tank: false }; // (el rifle y el agua no entran; la cinta, el radar y el tótem sí)
  }

  private async startParking(seed: number, mp: Mp) {
    this.stop();
    const token = this.parkingToken;
    this.seed0 = seed;
    this.caps = levelCaps('parking');
    this.hides = [];
    this.hideIdx = -1;
    this.onLevelLoad?.(.02);
    const still = holdStill();
    const look = this.lookOf(mp.id);
    let round: ParkingRound | undefined;
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const { ParkingRound } = await import('./parking-round');
      if (this.disposed || token !== this.parkingToken) return false;
      if (!mp.mission) throw new Error('The Habitable Zone room has no selected mission');
      round = this.parking = new ParkingRound(seed, parkingOptionsForMission(mp.mission), mp.index ?? 0, this.renderer, this.opts.low);
      await round.load(this.assets!, look, f => {
        if (this.parking === round) this.onLevelLoad?.(f);
      });
      if (this.parking !== round) return false;
      const { player, audio } = round.start(this.assets!, look, this.parkingInventory(mp.inv ?? START_INV), mp.life ?? 90, this.camera, this.flash, this.opts.reduced);
      this.player = player;
      this.audio = audio;
      audio.setLocalMute(this.muted);
      audio.setVolume(this.volume);
      audio.resume();
      this.mission = mp.mission ?? null;
      player.onDrink = () => {
        audio.drink();
        mp.sock.emit('drink');
      };
      this.hookGear(player);
      const pass = this.composer.passes[0] as RenderPass;
      pass.scene = round.level.scene;
      round.level.scene.add(this.camera);
      this.onLevelLoad?.(.87);
      await compileGently(this.renderer, round.level.scene, this.camera, undefined, f => {
        if (this.parking === round) this.onLevelLoad?.(.87 + f * .13);
      });
      if (this.parking !== round) return false;
      this.t = 0;
      this.paused = false;
      this.parkingBoardRequest = 0;
      this.sendT = 0;
      this.input.suspend = false;
      this.input.tabInventory = true;
      this.wire(mp);
      // lo que se suelta y se recoge del suelo, la cinta de acordonar, el radar y el tótem: los mismos prefabs que en los demás niveles, con las plantas del parking
      const pk = (this.parkPick = new ParkingPickups(round.level, this.camera, this.assets!, audio));
      pk.bind(player);
      pk.claim = (id, done) => void claimPickup(mp.sock, id, done, 2500, () => this.mp === mp && this.parkPick === pk);
      const lift = round.level.map.elevator;
      const gd = (this.gadgets = new Gadgets(round.level.terrain, player, this.camera, this.assets!, this.canvas.parentElement ?? document.body, () => [...this.remotes.values()].filter((r) => !(r.jam > 0)), () => new THREE.Vector3(lift.x, lift.y, lift.z), true));
      gd.onTotem = () => this.openTotem();
      gd.net(mp.sock);
      this.input.begin();
      this.clock.start();
      this.renderer.setAnimationLoop(() => this.frame());
      return true;
    } catch (error) {
      if (token !== this.parkingToken || this.disposed) return false;
      this.stop();
      this.onLevelLoad?.(null);
      throw error;
    } finally {
      still();
      if (this.parking === round) this.onLevelLoad?.(null);
    }
  }

  private parkingFrame(dt: number, c: Controls) {
    const round = this.parking!, player = this.player!;
    if (c.pause && !this.winning && !this.paused) this.pause();
    const active = !this.paused && !document.hidden && (!this.input.suspend || this.bagOpen);
    if (active && !this.winning && this.dying < 0) {
      if (this.bagOpen && (c.bag || c.inventory)) {
        this.input.clear();
        this.closeBag();
        c.bag = c.grab = c.bagHeld = false;
      } else if (!this.bagOpen && (c.inventory || (c.bag && !c.grab && !round.level.roomInteraction(this.camera, round.position)))) {
        // (diagnóstico: E abre la mochila solo si no hay nada que usar delante; si alguien dice que E no hace nada, esto dice por qué)
        if (c.bag && !c.inventory) {
          const lv = round.level as unknown as { performance?: { candidates: number; raycasts: number } }, fit = round.level.fits(player.pos.x, player.pos.z, player.pos.y);
          console.info('[parking] E sin nada delante', JSON.stringify({ floor: round.position.floor, fitFloor: fit?.floor ?? null, y: +player.pos.y.toFixed(2), x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), candidates: lv.performance?.candidates, raycasts: lv.performance?.raycasts }));
        }
        this.openBag();
      }
    }
    if (!active || this.bagOpen) c = { ...c, move: _none, look: _none, bag: false, grab: false, bagHeld: false, flash: false, slot: -1, wheel: 0, use: false, useHeld: false, fire: false, fireHeld: false, aim: false };
    this.t += dt;
    if (!this.winning && this.dying < 0 && !player.dead) {
      if (c.drop) this.dropSelected();
      if (this.gadgets) c = this.gadgets.update(dt, c); // cinta de acordonar y radar: se llevan los clics que gastan
      this.parkPick?.tick(this.t, dt, c);
      if (c.grab && this.parkPick?.hint) c = { ...c, grab: false }; // (G ya cogió el objeto: no es también para taquillas ni puertas)
    }
    round.setListening(!this.paused && !document.hidden);
    const aboard = round.update(dt, c, this.camera, active, this.t, action => {
      if (action.kind === 'unlock') return void (action.id && this.onLocker?.('park:' + action.id)); // taquilla con llave: el minijuego (LockerGame) y, al ganar, parkingUnlock
      this.sendState(true);
      this.mp?.sock.emit('parkingInteract', action);
    });
    if (aboard && !this.winning && this.t >= this.parkingBoardRequest) {
      this.parkingBoardRequest = this.t + .25;
      this.sendState(true);
      this.mp?.sock.emit('ascend', { ...(this.mp.inv ?? START_INV), ...player.inventory, gun: this.mp.inv?.gun ?? false, ammo: this.mp.inv?.ammo ?? 0, watergun: this.mp.inv?.watergun ?? false, tank: this.mp.inv?.tank ?? false, totem: this.mp.inv?.totem ?? 0, caution: this.mp.inv?.caution ?? false, radar: this.mp.inv?.radar ?? false });
    }
    if (player.hp <= 0 && this.dying < 0 && !this.winning) {
      player.dead = true;
      this.flash.intensity = 0;
      if (this.bagOpen) this.closeBag();
      this.dying = this.t;
    }
    if (this.dying >= 0 && !this.spectating && this.t - this.dying >= 2) this.spectate();
    this.netFrame(dt, c);
    if (this.spectating) {
      const pos = this.camera.position;
      const floor = THREE.MathUtils.clamp(Math.round((EYE - pos.y) / PARKING_HEIGHT), 0, round.level.map.floors.length - 1);
      const viewer = { x: pos.x, y: pos.y - EYE, z: pos.z, floor };
      round.render(dt, this.t, this.camera, viewer);
    } else round.render(dt, this.t, this.camera);
    if (this.winning && !this.opts.reduced) this.camera.position.y += round.level.elevatorShake;
    const uniforms = this.vhs.uniforms;
    uniforms.uTime.value = this.film.uniforms.uTime.value = this.t;
    uniforms.uAspect.value = this.camera.aspect;
    uniforms.uPool.value = 1;
    uniforms.uFlash.value = 0;
    uniforms.uCorrupt.value = this.dying >= 0 && !this.spectating ? Math.min(.9, (this.t - this.dying) * .55) : round.gaze * (this.opts.reduced ? .35 : .85);
    uniforms.uBlack.value = 0;
    this.vhs.enabled = player.aiming || uniforms.uCorrupt.value > 0 || this.winning;
    this.composer.render(dt);
  }

  private endParking() {
    this.parkingToken++;
    const round = this.parking;
    if (!round) return;
    this.parking = undefined;
    this.parkPick?.dispose();
    this.parkPick = undefined;
    this.gadgets?.dispose();
    this.gadgets = undefined;
    this.input.tabInventory = false;
    this.player?.dispose();
    this.player = undefined;
    this.audio?.dispose();
    this.audio = undefined;
    round.dispose();
    this.scene.add(this.camera);
    const pass = this.composer.passes[0] as RenderPass;
    pass.scene = this.scene;
    this.vhs.uniforms.uCorrupt.value = this.vhs.uniforms.uBlack.value = 0;
    this.onLevelLoad?.(null);
  }

  /** Una ronda de las Poolrooms con compañeros: el mapa y el movimiento son de PoolLevel; la sala (misión, ascensor, compañeros) funciona como siempre. */
  /** La carga de un nivel al empezar la ronda: cuánto lleva (0–1), o null al acabar. */
  onLevelLoad?: (f: number | null) => void;
  onLevelError?: () => void;

  private async startPool(seed: number, mp: Mp) {
    const tok = ++this.poolTok;
    this.pics = { thumbs: [], full: [] };
    this.renderer.setAnimationLoop(null);
    voice.setWorld(undefined);
    this.player = undefined;
    this.world = undefined;
    this.items = undefined;
    this.gadgets = undefined;
    this.tvs = undefined;
    this.entities = [];
    // la pantalla de carga (BootLoading, la pone Backrooms.tsx): se pinta antes de que el armado (síncrono y pesado) congele el hilo
    this.onLevelLoad?.(0.05);
    // mientras carga, el cursor es del usuario (el clic de entrar ya había capturado el puntero y no se podía mover); al acabar, buildPool lo vuelve a pedir
    // con input.begin(), y si el navegador no lo da sin un gesto sale el «CLICK TO CONTINUE» de siempre
    this.input.active = false; // (sin esto, soltar el puntero contaría como pausa)
    this.input.unlock();
    try {
      const kit = await loadPoolKit();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (tok !== this.poolTok) return;
      this.onLevelLoad?.(0.3);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await this.buildPool(seed, mp, kit, tok);
    } catch (e) {
      console.error('poolrooms', e);
    }
    if (tok === this.poolTok) this.onLevelLoad?.(null);
  }

  private async buildPool(seed: number, mp: Mp, kit: PoolKit, tok: number) {
    // latas y linternas: los modelos del nivel 0, ya bajados
    const p = new PoolLevel(this.camera.aspect, this.renderer, seed, { ...kit, water: this.assets?.gltf.water?.scene, flashlight: this.assets?.gltf.flashlight?.scene, camera: this.assets?.gltf.camcorder?.scene }, mp.mission?.kind === 'soaps'), [ox, oz] = startOffset(mp.index ?? 0);
    p.spawnAt(ox, oz);
    // el controlador de siempre (manos con IK, linterna, barra rápida, inventario) solo como figura: PoolLevel pone la posición y la física, el Player pone lo que se ve
    const stub = { root: p.scene, solid: (x: number, z: number) => p.solidAt(x, z), furniture: () => false, voidAt: (x: number, z: number) => p.wetAt(x, z) } as unknown as World; // (la cinta de acordonar solo se tiende en seco)
    this.poolWorld = { root: p.scene, cellAt: (x: number, z: number) => ({ x: Math.floor(x / CELL), y: Math.floor(z / CELL) }) } as unknown as World;
    const me = (this.player = new Player(stub, this.assets!, p.camera, this.flash, this.opts.reduced));
    me.poolMode = true;
    me.terrain = p;
    (me.yaw = p.state.yaw), (me.pitch = p.state.pitch); // (la mirada es del Player: empieza donde mira el nivel)
    me.load(mp.inv ?? START_INV);
    me.onDrink = () => (this.audio?.drink(), mp.sock.emit('drink')); // X con una lata: el servidor da la vida; aquí aguante y cordura
    this.hookGear(me);
    // mi cuerpo, manos y objetos van en la capa 1: la cámara los ve, pero la virtual del Reflector del agua (solo capa 0) no los repinta bajo el agua
    p.camera.layers.enable(1);
    me.rig.root.traverse((o) => o.layers.set(1));
    for (const it of Object.values(me.items)) it.traverse((o) => o.layers.set(1));
    p.camera.add(this.flash, this.flash.target); // la linterna pasa a la cámara del nivel (endPool la devuelve)
    this.pool = p;
    this.poolFx(p);
    this.onLevelLoad?.(0.7);
    // (compileGently y no compileAsync: también lo oculto —lo que se saca en la mano, la pistola— y en la variante del compositor; si no, cada objeto daba un
    // tirón la primera vez que se sacaba)
    const still = holdStill(); // (la pantalla de carga está quieta: sin esto, en Firefox compileGently esperaba para siempre a que lo estuviera)
    await compileGently(this.renderer, p.scene, p.camera, undefined, (f) => this.onLevelLoad?.(0.7 + 0.3 * f)).finally(still); // los programas de todo el nivel ya (sin congelar el navegador: compile() era síncrono y tardaba segundos)
    if (tok !== this.poolTok) return;
    this.mp = mp;
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = p.scene;
    rp.camera = p.camera;
    this.flash.intensity = 0;
    this.vhs.enabled = false;
    this.mission = mp.mission ?? null;
    this.audio ??= new GameAudio(undefined, this.muted, this.volume);
    this.wire(mp);
    // la cinta de acordonar y el radar (los aliados con «sin señal» no salen)
    const gd = (this.gadgets = new Gadgets(stub, me, p.camera, this.assets!, this.canvas.parentElement ?? document.body, () => (p.jam > 0 ? [] : [...this.remotes.values()].filter((r) => !(r.jam > 0))), () => new THREE.Vector3(p.exit.x, me.pos.y, p.exit.z)));
    gd.onTotem = () => this.openTotem();
    gd.net(mp.sock);
    // jabones (pickup), tanque, pistola de agua (squirt) y lo que me hacen los demás con ella (wet)
    p.tank = me.tankWorn;
    const pk = p.pickups;
    pk.bind(me);
    pk.audio = this.audio;
    pk.claim = (id, done) => void claimPickup(mp.sock, id, (ok) => {
      if (this.pool !== p) return;
      done(ok);
      if (!ok) this.note = { text: 'CANNOT TAKE THAT (ALREADY HAVE IT OR TOO FAR)', until: performance.now() + 2000 };
    }, 2500, () => this.pool === p && this.mp === mp);
    pk.onGot = () => ((mp.inv = me.inventory), (p.tank = me.tankWorn)); // (lo recogido pasa a mi inventario local; el botín lo lleva el servidor: llega con `bag`)
    me.onSquirt = (x, z, yaw) => mp.sock.volatile.emit('squirt', { x, z, yaw });
    const onWet = (m: { kind: 'wet' | 'stun'; ms: number }) => (p.hit(m.kind, m.ms), me.hit(m.kind, m.ms), this.wetFx(m.kind));
    mp.sock.on('wet', onWet);
    this.offNet.push(() => mp.sock.off('wet', onWet));
    this.input.begin();
    this.audio.start();
    this.t = 0;
    this.paused = false;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }
  private poolTok = 0;
  /** El «mundo» mínimo que piden las entidades dentro de las Poolrooms (donde pintarlas y en qué celda están). */
  private poolWorld?: World;
  private deadAt = 0;
  /** Qué es cada objeto soltado (`d…`) que hay en el nivel: los ids no lo dicen. */
  private dropKind = new Map<string, string>();
  private poolSend = 0;
  private sqSnd = 0;
  /** Ponerse (o guardar en la mochila) la bombona de buceo. */
  setTank(on: boolean) {
    if (!this.player) return;
    this.player.tankOn = on;
    this.poolInv();
  }
  /** Cada fotograma de una ronda en las Poolrooms: los demás, mi estado a 15 Hz y la salida (con la misión cumplida, al acercarse se sube). */
  private poolMatch(p: PoolLevel, dt: number, c: Controls): Controls {
    this.t += dt;
    const me = this.player, st = p.state;
    if (c.drop && !p.dead && !this.winning) this.dropSelected(); // (la barra rápida y la rueda las lleva el Player, como en el nivel 0)
    if (this.gadgets) c = this.gadgets.update(dt, c); // cinta de acordonar y radar: se llevan los clics que gastan
    // sonido: pasos en seco o chapoteo (y brazadas al nadar), el zumbido de los tubos y los ruidos lejanos
    if (st.speed > 0.4 && !st.ride && !p.dead) {
      this.stepAcc += st.speed * dt;
      const len = st.swim ? 1.4 : st.speed > 3 ? 1.1 : 0.7;
      if (this.stepAcc > len) (this.stepAcc -= len), st.wet || st.swim ? this.audio?.wade(st.speed > 3) : this.audio?.step(st.speed > 3);
    }
    this.audio?.power(0.6);
    this.audio?.ambient(dt, 0.7, 0);
    if (p.dead && !this.spectating && this.t - this.deadAt > 3.5) this.spectate(); // tras caer, a mirar por los ojos de un compañero
    this.sqSnd -= dt;
    if (me && this.cheats.ammo) me.squirt = 1;
    if (me && (me.spraying || me.refilling) && this.sqSnd <= 0) (this.sqSnd = me.spraying ? 0.12 : 0.4), me.spraying ? this.audio?.squirt() : this.audio?.refill();
    for (const r of this.remotes.values()) r.update(dt);
    this.poolSend += dt;
    if (this.poolSend >= 1 / 15) (this.poolSend = 0), this.sendState();
    const dExit = p.dead ? Infinity : Math.hypot(st.x - p.exit.x, st.z - p.exit.z), near = dExit < 2.2 && st.y < 1;
    if (this.mission?.exit && dExit < 4) p.cab.open(); // la misión está hecha: se abre al acercarse
    if (this.mission?.exit && dExit < 0.45 && st.y < 1 && !this.winning) {
      this.win();
    } else if (!this.mission?.exit && near && performance.now() > this.note.until) this.note = { text: 'THE DOOR IS SEALED · FINISH THE MISSION', until: performance.now() + 2500 };
    if (this.winning) {
      if (p.cab.rideT > RIDE) this.black = Math.min(1, this.black + dt / 1.5);
      this.vhs.enabled = true;
      this.vhs.uniforms.uBlack.value = this.black;
    }
    return c;
  }

  /** El servidor me mata (admin, tótem...): sin mandos, la cámara cae y, pasado un rato, a mirar a los compañeros. */
  private poolDied(p: PoolLevel) {
    p.dead = true;
    this.deadAt = this.t;
    this.flash.intensity = 0;
    if (this.bagOpen) this.closeBag();
    this.note = { text: 'YOU DIED', until: performance.now() + 3500 };
  }
  /** Vuelvo a la partida: en el sitio que dice el servidor, con la vista y los mandos de siempre. */
  private poolRevived(p: PoolLevel, m: { name: string; x: number; y: number; z: number; yaw: number }) {
    p.dead = false;
    p.ghost = undefined;
    p.o2 = 1;
    this.spectating = false;
    for (const r of this.remotes.values()) r.setFirstPerson(false);
    this.player?.revive(new THREE.Vector3(m.x, 0, m.z), m.yaw);
    p.teleport(m.x, m.z, m.yaw, m.y);
    this.note = { text: 'YOU ARE BACK', until: performance.now() + 4000 };
    this.immuneUntil = performance.now() + REVIVE_IMMUNE;
    this.black = 0;
    this.input.suspend = false;
    this.input.soft();
    this.input.lock();
  }

  /** Quita el nivel de las Poolrooms (si lo hay) y devuelve el compositor a la escena del juego. */
  private endPool() {
    this.poolTok++;
    const p = this.pool;
    if (!p) return;
    this.pool = undefined;
    this.poolWorld = undefined;
    this.entities.forEach((e) => e.dispose());
    this.entities = [];
    this.entMap.clear();
    this.gadgets?.dispose();
    this.gadgets = undefined;
    this.dropKind.clear();
    this.spectating = false;
    if (this.player) (this.player.dispose(), (this.player = undefined), this.camera.add(this.flash, this.flash.target)); // la linterna vuelve a la cámara del juego
    this.poolFx();
    p.dispose();
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = this.scene;
    rp.camera = this.camera;
    this.vhs.enabled = false;
    this.vhs.uniforms.uBlack.value = 0;
    this.poolStat?.el.remove();
    for (const r of this.remotes.values()) (r.root.removeFromParent(), this.spare.push(r));
    this.remotes.clear();
  }

  /** Desarrollo (`?runlevel`): el nivel sin sala ni compañeros. */
  devRun() {
    this.beginRun();
    this.run!.onDone = () => console.info('run level: done');
    this.input.begin();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ── consola de admin ─────────────────────────────────────────────────────
  // Aquí solo lo que es de este cliente (o de la partida en solitario). Lo que toca a la sala lo decide el servidor (`admin` en server/src/index.ts)
  // y llega por los canales de siempre más `adminFx` (teletransporte, objeto, curación).

  // ── los objetos de las Suites ─────────────────────────────────────────────
  private throwS = 0.6;
  private arc?: { line: THREE.Mesh; dots: THREE.Points; ring: THREE.Mesh };
  /** El arco del lanzamiento (pokeball y granada) mientras se mantiene el clic: la trayectoria con sus rebotes (shared/throw.ts, la misma del servidor). */
  private arcFrame() {
    const p = this.player, w = this.world;
    const scene = this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene);
    if (!this.arc) {
      // la trayectoria: una línea blanca ancha (Line2: el ancho se da en píxeles), puntos blancos en cada rebote y un aro donde se queda
      const line = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); // (una cinta de cuadriláteros que mira a la cámara: Line2 no se veía)
      const dots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, depthTest: false, toneMapped: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      for (const o of [line, dots, ring]) (o.frustumCulled = false), (o.renderOrder = 10), (o.visible = false);
      this.arc = { line, dots, ring };
    }
    const { line, dots, ring } = this.arc, on = !!p?.charging && !p.dead;
    for (const o of [line, dots, ring]) if (o.parent !== scene) scene.add(o); // (la trayectoria se dibuja en la escena del nivel de ahora: laberinto, Poolrooms o Habitable Zone)
    line.visible = dots.visible = ring.visible = on;
    if (!on || !p) return;
    // el trayecto, con el suelo del nivel (plantas, piscinas, garaje); la botella usa sus propias constantes (ver `useParkingItem`)
    let pts: number[], hits: [number, number, number][];
    if (p.prop === 'beer') {
      const cp = Math.cos(p.pitch), vx = -Math.sin(p.yaw) * cp * 12, vz = -Math.cos(p.yaw) * cp * 12, vy = Math.sin(p.pitch) * 12 + 2, y0 = p.pos.y + (p.duck ? 0.95 : 1.5);
      pts = [];
      hits = [];
      for (let t = 0; t <= 2; t += 0.03) {
        const y = y0 + vy * t - 8 * t * t;
        if (y < p.pos.y && t > 0) {
          hits.push([p.pos.x + vx * t, p.pos.y + 0.03, p.pos.z + vz * t]);
          break;
        }
        pts.push(p.pos.x + vx * t, y, p.pos.z + vz * t);
      }
      if (!hits.length) hits.push([pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]]);
    } else {
      const terr: { floorAt?: (x: number, z: number, y?: number) => number | null } | undefined = (this.parking?.level ?? (this.pool instanceof PoolLevel ? this.pool : w)) as { floorAt?: (x: number, z: number, y?: number) => number | null } | undefined;
      const f = flight(w ? (x, z) => w.solid(x, z) : () => false, [p.pos.x, p.pos.y + 1.5, p.pos.z], p.yaw, p.pitch, 11 * Math.sqrt(perks.stats.reach), 2.9, w && !terr?.floorAt ? undefined : (x, z, y) => terr?.floorAt?.(x, z, y) ?? null);
      pts = f.pts;
      hits = [...f.bounces, f.end];
    }
    const n = Math.min(102, pts.length / 3);
    // la cinta: dos vértices por punto, a un lado y a otro, perpendiculares al trayecto y a la vista (6 cm de ancho)
    const cam = this.camera.position, pos = new Float32Array(n * 6), idx: number[] = [], t = new THREE.Vector3(), sd = new THREE.Vector3(), to = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(n - 1, i + 1) * 3;
      t.set(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
      to.set(cam.x - pts[i * 3], cam.y - pts[i * 3 + 1], cam.z - pts[i * 3 + 2]);
      sd.crossVectors(t, to).normalize().multiplyScalar(0.035);
      pos.set([pts[i * 3] + sd.x, pts[i * 3 + 1] + sd.y, pts[i * 3 + 2] + sd.z, pts[i * 3] - sd.x, pts[i * 3 + 1] - sd.y, pts[i * 3 + 2] - sd.z], i * 6);
      if (i < n - 1 && i % 3 !== 2) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    line.geometry.dispose();
    line.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    line.geometry.setIndex(idx);
    line.geometry.computeBoundingSphere();
    const dp = dots.geometry.getAttribute('position') as THREE.BufferAttribute, nb = Math.min(12, hits.length);
    hits.slice(0, nb).forEach((b, i) => dp.setXYZ(i, b[0], b[1], b[2]));
    dp.needsUpdate = true;
    dots.geometry.setDrawRange(0, Math.max(0, nb - 1)); // (los rebotes; donde se queda lo marca el aro)
    const end = hits[hits.length - 1];
    ring.position.set(end[0], end[1] + 0.02, end[2]);
  }
  private smokeTex?: THREE.Texture;
  private smokeTexture() {
    if (!this.smokeTex) {
      const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(210,210,210,0.9)');
      g.addColorStop(1, 'rgba(210,210,210,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      this.smokeTex = new THREE.CanvasTexture(c);
    }
    return this.smokeTex;
  }
  /** Lo que ven todos de un objeto de las Suites: la bola o la granada en el aire, la nube de humo, la llamada del Nokia. */
  private toolFx(m: ToolFx) {
    const note = (text: string) => (this.note = { text, until: performance.now() + 3500 });
    if (m.k === 'note') return note(m.text);
    if (m.k === 'call') {
      m.on ? this.callPeers.add(m.peer) : this.callPeers.delete(m.peer);
      return note(m.on ? `${m.name.toUpperCase()} · CALL CONNECTED: YOU CAN HEAR EACH OTHER ANYWHERE` : `CALL WITH ${m.name.toUpperCase()} ENDED`);
    }
    if (m.k === 'bat') return void (this.audio?.cue('equip'), m.id !== this.mp?.id && this.remotes.get(m.id)?.swing());
    // el pasillo del hotel se repite y el servidor cuenta siempre en la copia del medio: el vuelo y el humo se pintan en la copia donde está quien mira
    const px = this.caps.hotel ? this.player?.pos.x ?? 0 : 0, span = SUITE_L * CELL, shift = this.caps.hotel && px < 3 * span ? (Math.max(0, Math.floor(px / span)) - 1) * span : 0;
    if (m.k === 'throw') {
      const path = shift ? m.path.map((v, i) => (i % 3 ? v : v + shift)) : m.path;
      const o = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: m.what === 'pokeball' ? 0xd32f2f : m.what === 'uno' ? 0xe0b020 : 0x59684a }));
      (this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene)).add(o);
      this.throwS = m.s;
      let t = 0;
      this.fxList.push((dt) => {
        t += dt;
        const i = Math.min(path.length / 3 - 1, Math.floor(t / FLIGHT_DT));
        o.position.set(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]);
        if (t < m.s) return true;
        o.removeFromParent();
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        return false;
      });
      return;
    }
    if (m.k === 'cards') {
      // cartas girando alrededor de la entidad inmovilizada, a varias alturas, hasta que acaba el efecto
      const sc = this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene), cols = [0xd32f2f, 0x1e63c9, 0x2e9e45, 0xe0b020], cards = Array.from({ length: 10 }, (_, i) => {
        const c = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.36), new THREE.MeshBasicMaterial({ color: cols[i % 4], side: THREE.DoubleSide }));
        sc.add(c);
        return { c, a: (i / 10) * Math.PI * 2, y: 0.25 + (i / 9) * Math.max(0.8, m.h - 0.1) };
      });
      let t = 0;
      this.fxList.push((dt) => {
        t += dt;
        for (const q of cards) {
          const a = q.a + t * 2.4, r = 0.75 + Math.sin(t * 3 + q.y * 5) * 0.06;
          q.c.position.set(m.x + shift + Math.cos(a) * r, q.y + Math.sin(t * 2 + q.a) * 0.06, m.z + Math.sin(a) * r);
          q.c.rotation.set(0, -a + Math.PI / 2, Math.sin(t * 4 + q.a) * 0.3);
        }
        if (t < m.s) return true;
        for (const q of cards) (q.c.removeFromParent(), q.c.geometry.dispose(), (q.c.material as THREE.Material).dispose());
        return false;
      });
      return;
    }
    // el humo: sprites blandos que se hinchan donde cae la granada (tras lo que tarda en llegar) y se van apagando
    const puffs = Array.from({ length: Math.round(m.r * 7) }, () => {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * m.r;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTexture(), color: 0xbfbfbf, transparent: true, depthWrite: false, opacity: 0 }));
      sp.scale.setScalar(2.2 + Math.random() * 2.2);
      (this.parking?.level.scene ?? (this.pool instanceof PoolLevel ? this.pool.scene : this.scene)).add(sp);
      return { sp, x: m.x + shift + Math.cos(a) * d, y: 0.3 + Math.random() * 2.1, z: m.z + Math.sin(a) * d, ph: Math.random() * 6 };
    });
    let t = -this.throwS; // (el humo sale cuando la granada acaba de rebotar)
    this.fxList.push((dt) => {
      t += dt;
      const a = Math.max(0, Math.min(1, t / 0.8, (m.s - t) / 3));
      for (const q of puffs) {
        (q.sp.material as THREE.SpriteMaterial).opacity = a * 0.55;
        q.sp.position.set(q.x + Math.sin(t * 0.4 + q.ph) * 0.4, q.y + Math.sin(t * 0.3 + q.ph) * 0.15, q.z + Math.cos(t * 0.35 + q.ph) * 0.4);
      }
      if (t < m.s) return true;
      for (const q of puffs) (q.sp.removeFromParent(), q.sp.material.dispose());
      return false;
    });
  }

  /** Efecto que manda el servidor a este jugador. */
  adminFx(fx: AdminFx) {
    const p = this.player, pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (fx.k === 'ammo') return void (this.cheats.ammo = fx.on); // (el servidor lo ordena a este cliente: también si está muerto)
    if (!p || p.dead) return;
    if (fx.k === 'tp') {
      const parking = this.parking;
      if (parking) {
        const position = parking.level.fits(fx.x, fx.z, fx.y);
        if (!position) return;
        Object.assign(parking.position, position);
        p.spawn(new THREE.Vector3(position.x, position.y, position.z), fx.yaw);
      } else if (pl) (pl.teleport(fx.x, fx.z, fx.yaw, fx.y), (p.yaw = fx.yaw));
      else p.spawn(new THREE.Vector3(fx.x, 0, fx.z), fx.yaw);
    } else if (fx.k === 'give') {
      if (this.parking && !['flashlight', 'water', 'camera', 'pokeball'].includes(fx.item)) return;
      p.receive(fx.item);
      this.poolInv();
    } else if (fx.k === 'take') p.lose(fx.item);
    else if (fx.k === 'push') p.shove(fx.x, fx.z);
    else ((p.hp = perks.stats.hp), (p.stamina = 1), (p.sanity = 1), pl && (pl.o2 = 1));
  }

  /** Trucos propios: velocidad x2, atravesar paredes, sin luz (y, solo, inmortal). Devuelve el estado nuevo. */
  adminToggle(op: 'speed' | 'noclip' | 'light' | 'god', on: boolean) {
    if (!this.adminOk) return;
    const p = this.player;
    if (op === 'god') this.god = on;
    if (op === 'light' && this.world) (this.lightsOff = !on), (this.world.power = on ? 1 : 0), (this.outT = -1);
    if (op === 'speed') this.cheats.speed = on ? 2 : 1;
    if (p && op === 'noclip') p.noclip = on;
  }

  /** Trucos con valor: velocidad/salto (multiplicadores), cámara lenta, cordura y aguante infinitos, luz total. */
  adminCheat(op: 'speed' | 'jump' | 'slow', v: number): void;
  adminCheat(op: 'stamina' | 'sanity' | 'bright' | 'ammo' | 'minimap', v: boolean): void;
  adminCheat(op: 'speed' | 'jump' | 'slow' | 'ammo' | 'stamina' | 'sanity' | 'bright' | 'minimap', v: number | boolean) {
    if (!this.adminOk) return;
    if (op === 'bright') {
      this.cheats.bright = !!v;
      if (v && !this.brightLight) (this.brightLight = new THREE.HemisphereLight(0xffffff, 0x9aa090, 1.6)), this.scene.add(this.brightLight);
    } else (this.cheats as Record<string, number | boolean>)[op] = v;
  }

  /** Misión EEH: al cumplirse el tiempo de fallo, un aviso (el servidor suelta las entidades). */
  private eehSnap = false;
  private eehFor = '';
  private eehRed = false;
  private staffMad = false;
  private eehVeil?: HTMLElement;
  private eehCheck() {
    const m = this.mission, fail = isEeh(m?.kind) && m!.progress >= m.goal - EEH_HOLD;
    const on = !(this.dying >= 0 || this.run || this.player?.dead) && (this.eehSnap || (fail && !m!.done)); // (muerto o en el nivel rojo, la sirena se calla)
    if (on !== this.eehRed) {
      (this.eehRed = on), this.audio?.alarm(on); // la sirena suena mientras dure el fallo
      // las luces rojas: un velo rojo que late sobre toda la pantalla
      if (on) {
        this.eehVeil = Object.assign(document.createElement('div'), { className: 'br-eeh-veil' });
        this.eehVeil.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;mix-blend-mode:multiply;background:radial-gradient(circle,rgba(255,60,50,1) 0,rgba(200,0,0,1) 70%,rgba(110,0,0,1) 100%)';
        this.eehVeil.animate([{ opacity: 0.35 }, { opacity: 0.95 }, { opacity: 0.35 }], { duration: 1400, iterations: Infinity, easing: 'ease-in-out' });
        (this.canvas.parentElement ?? document.body).append(this.eehVeil);
      } else (this.eehVeil?.remove(), (this.eehVeil = undefined));
    }
    if (on) (this.scene.fog as THREE.Fog).color.setRGB(0.25 + 0.2 * Math.sin(this.t * 4), 0.02, 0.02);
    else if (this.caps.hotel) (this.scene.fog as THREE.Fog).color.set(0x1d0c0a);
    if (!fail || this.eehFor === m!.id) return;
    this.eehFor = m!.id;
    this.note = { text: 'THE EVAPORATOR HAS FAILED · THE STAFF IS HUNTING · HIDE IN A WARDROBE (E)', until: performance.now() + 5000 };
    this.audio?.cue('hurt');
  }
  /** El rifle explota en la cara de quien dispara: bola de fuego, fogonazo, y la cámara sale volando como un ragdoll (rebota y acaba en el suelo). */
  private booms: Explosion[] = [];
  private boom(at: THREE.Vector3) {
    const e = new Explosion(at);
    (this.world?.root ?? this.pool?.scene ?? this.scene).add(e.root);
    this.booms.push(e);
    this.audio?.shot();
    this.audio?.cue('hurt');
  }
  private misfire() {
    if (this.god || !this.player || this.dying >= 0) return;
    const p = this.player, at = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
    this.boom(at);
    this.shake = 0.6;
    const el = Object.assign(document.createElement('div'), { className: 'br-wetfx' });
    el.style.cssText = 'position:fixed;inset:0;z-index:9;pointer-events:none;background:radial-gradient(circle,#fff 0,#ffcf70 45%,#ff6a20 100%)';
    (this.canvas.parentElement ?? document.body).append(el);
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' }).finished.then(() => el.remove(), () => el.remove());
    this.die();
    const a = Math.random() * Math.PI * 2, cam = this.camera;
    this.fly = { pos: cam.position.clone(), vel: new THREE.Vector3(Math.cos(a) * 6, 8, Math.sin(a) * 6), q: cam.quaternion.clone(), spin: new THREE.Vector3(14, 9, 17), bounced: false };
    cam.fov = 100;
  }
  /** `blastFx` del servidor: la explosión de otro (la mía ya se ha puesto al disparar) y él sale volando. */
  private blastFx(m: { id: string; x: number; y: number; z: number }) {
    if (m.id === this.mp?.id) return;
    this.boom(new THREE.Vector3(m.x, m.y, m.z));
    const r = this.remotes.get(m.id), a = Math.random() * Math.PI * 2;
    r?.launch(Math.cos(a), Math.sin(a));
  }
  /** Me han dado con la pistola de agua de otro: el chorro salpica la pantalla (CSS), la cámara se sacude y suena. */
  private wetEl?: HTMLDivElement;
  private shake = 0;
  private wetFx(kind: 'wet' | 'stun') {
    const el = (this.wetEl ??= Object.assign(document.createElement('div'), { className: 'br-wetfx' }));
    if (!el.isConnected) (this.canvas.parentElement ?? document.body).append(el);
    el.dataset.k = '';
    void el.offsetWidth; // (reinicia la animación aunque lleguen dos seguidas)
    el.dataset.k = kind;
    this.shake = kind === 'stun' ? 0.09 : 0.05;
    this.audio?.cue('hurt');
  }
  /** La sacudida de cámara del impacto (se apaga sola). */
  private shakeCam(dt: number) {
    if (this.shake <= 0) return;
    const c = this.cam, k = this.shake;
    c.rotation.z += (Math.random() - 0.5) * k * 2;
    c.rotation.x += (Math.random() - 0.5) * k;
    this.shake = Math.max(0, this.shake - dt * 0.12);
  }
  private minimap?: Minimap;
  /** El minimapa de admin (F9): se pinta cada fotograma si está activo y esconde su lienzo si no. */
  private drawMap() {
    const p = this.player;
    if (!this.cheats.minimap || !this.adminOk || !p) return void this.minimap?.show(false);
    const m = (this.minimap ??= new Minimap(this.canvas.parentElement ?? document.body)), pl = this.pool instanceof PoolLevel ? this.pool : undefined, w = this.world;
    m.show(true);
    const solid = pl ? (x: number, z: number) => pl.solidAt(x, z) : (x: number, z: number) => !w || w.solid(this.caps.hotel ? wrapX(x) : x, z);
    const dots = [...this.remotes.values()].filter((r) => !r.dead).map((r) => ({ x: r.pos.x, z: r.pos.z, color: '#4aa3ff' }));
    for (const e of this.entities) e.alive && dots.push({ x: e.pos.x, z: e.pos.z, color: '#ff4a4a' });
    m.draw(solid, { x: p.pos.x, z: p.pos.z, yaw: p.yaw }, dots);
  }

  /** Lo que el panel enseña como activo (el juego puede haberlo reiniciado: nueva partida, nuevo jugador). */
  adminState() {
    return { ...this.cheats, noclip: !!this.player?.noclip, light: !this.lightsOff, god: this.god };
  }

  /** Marcadores de posición: dónde estoy / ir a un sitio guardado (solo en solitario: en una sala el servidor manda la posición). */
  adminPos() {
    const p = this.player;
    return p ? { x: p.pos.x, z: p.pos.z, yaw: p.yaw } : null;
  }
  adminGoto(m: { x: number; z: number; yaw: number }) {
    if (!this.adminOk) return;
    if (!this.mp) this.player?.spawn(new THREE.Vector3(m.x, 0, m.z), m.yaw);
  }

  /**
   * Captura de lo que se ve (sin el panel) al portapapeles, con la semilla y la posición exactas como texto. Devuelve ese texto.
   * Sin contexto seguro (http por IP) no hay portapapeles de imágenes: baja el PNG y copia solo el texto.
   */
  async adminShot() {
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined, p = this.player;
    const s = pl ? pl.state : p ? { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: 0 } : { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const seed = pl ? pl.seed : this.seed0, f = (n: number) => n.toFixed(3);
    const txt = `seed ${seed}  level ${this.mp?.level ?? (this.parking ? 'parking' : pl ? 'poolrooms' : 'level0')}
x ${f(s.x)}  y ${f(s.y)}  z ${f(s.z)}  yaw ${f(s.yaw)}  pitch ${f(s.pitch)}`;
    this.composer.render(0);
    const png = new Promise<Blob>((ok, no) => this.renderer.domElement.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/png'));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([txt], { type: 'text/plain' }) })]);
    } catch {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await png), download: `backrooms-${seed}.png` }), t = Object.assign(document.createElement('textarea'), { value: txt });
      a.click(), URL.revokeObjectURL(a.href);
      document.body.append(t), t.select(), document.execCommand('copy'), t.remove();
    }
    return txt;
  }

  /** Un volcado del estado del juego para depurar (pestaña DEBUG de F9): ascensor, inventario, recogibles cercanos, escondite y compañeros. */
  adminDump() {
    const p = this.player, it = this.items, f = (n: number) => n.toFixed(2), out: string[] = [];
    if (p) out.push(`pos ${f(p.pos.x)},${f(p.pos.y)},${f(p.pos.z)} yaw ${f(p.yaw)} hide ${p.hideState} holding ${this.holding} air ${f(this.breath.air)}`);
    if (p) out.push(`inv ${JSON.stringify(p.inventory)}${this.mp ? `
server-synced inv ${JSON.stringify(this.mp.inv)}` : ''}`);
    if (it && p) {
      const e = this.world?.maze.elevator, d = this.world && e ? Math.hypot(p.pos.x - this.world.elevator.position.x, p.pos.z - this.world.elevator.position.z) : NaN;
      out.push(`elevator ready ${it.ready} powered ${it.powered} gens ${it.gens.on}/${it.gens.n} open ${it.open} worldOpen ${this.world?.elevatorOpen} dist ${f(d)} mission ${JSON.stringify(this.mission)}`);
      out.push('near pickups: ' + (it.debugNear(p.pos, 4) || 'none'));
    }
    for (const [id, r] of this.remotes) out.push(`remote ${r.name || id} pos ${f(r.pos.x)},${f(r.pos.z)} emote ${r.emote} visible ${r.root.visible && !!r.root.parent} dead ${r.dead} hiding ${r.hiding}`);
    return out.join('\n');
  }

  /** Dónde y con qué se renderiza, para acompañar a los errores de render (errlog.ts): nivel, semilla, posición, GPU, pasadas y carga de la escena. */
  adminDiag() {
    const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'), i = this.renderer.info, f = (n: number) => n.toFixed(2);
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined, p = this.player;
    const s = pl ? pl.state : p ? { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw } : undefined;
    return [
      `level ${this.mp?.level ?? (this.parking ? 'parking' : pl ? 'poolrooms' : 'level0')}  seed ${pl ? pl.seed : this.seed0}${s ? `  pos ${f(s.x)} ${f(s.y)} ${f(s.z)}  yaw ${f(s.yaw)}` : ''}`,
      `gpu ${gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)}  ${gl.getParameter(gl.VERSION)}${gl.isContextLost() ? '  CONTEXT LOST' : ''}  gl.getError ${gl.getError()}`,
      `canvas ${this.canvas.width}x${this.canvas.height}  dpr ${devicePixelRatio}  low ${this.opts.low}  resScale ${settings.resScale}  ao ${!!this.fx?.ao.enabled}  smaa ${!!this.fx?.smaa.enabled}`,
      `programs ${i.programs?.length ?? '-'}  geometries ${i.memory.geometries}  textures ${i.memory.textures}  calls ${i.render.calls}  tris ${i.render.triangles}`,
      `ua ${navigator.userAgent}`,
    ].join('\n');
  }

  /** Interruptores de rendimiento de las Poolrooms (para ver qué pasada pesa): AO, SMAA y sombra del sol. Devuelve el estado. */
  adminPerf(k?: 'ao' | 'smaa' | 'sun') {
    if (!this.adminOk) return { ao: false, smaa: false, sun: false };
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined, fx = this.fx;
    if (k === 'ao' && fx) fx.ao.enabled = !fx.ao.enabled;
    if (k === 'smaa' && fx) fx.smaa.enabled = !fx.smaa.enabled;
    if (k === 'sun' && pl) pl.sun.castShadow = !pl.sun.castShadow;
    return { ao: !!fx?.ao.enabled, smaa: !!fx?.smaa.enabled, sun: !!pl?.sun.castShadow };
  }

  /** Desarrollo: el nivel de una partida en solitario (?suites). */
  private devLevel?: string;
  /** Benchmark (bench.ts): una partida en solitario con las entidades quietas y el jugador llevado por un recorrido fijo; al acabar da los FPS medios y el p95 de los fotogramas. */
  bench?: { t: number; dts: number[]; path: THREE.Vector3[]; len: number; done: (fps: number, p95: number) => void };
  static readonly BENCH_WARM = 3;
  static readonly BENCH_RUN = 8;
  runBench(done: (fps: number, p95: number) => void) {
    // (start() espera lo que el menú dejó para después: el banco no puede leer `world` hasta que esté)
    if (!this.ready.has('level0')) return void (this.levelReady('level0') ?? Promise.resolve()).then(() => (this.ready.add('level0'), this.runBench(done)));
    this.start(1);
    this.entFrozen = true;
    const m = this.world!.maze, rnd = ((a) => () => ((a = (a * 1664525 + 1013904223) >>> 0), a / 2 ** 32))(7);
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && !!m.open[y * m.w + x] && !m.voids.some((v) => v.x === x && v.y === y);
    let c = { x: m.start.x, y: m.start.y }, prev = { x: -1, y: -1 };
    const cells = [c];
    for (let i = 0; i < 80; i++) {
      const opts = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter((n) => free(n.x, n.y));
      const fwd = opts.filter((n) => !(n.x === prev.x && n.y === prev.y));
      const pick = (fwd.length ? fwd : opts)[(rnd() * (fwd.length || opts.length)) | 0];
      if (!pick) break;
      (prev = c), (c = pick), cells.push(c);
    }
    const path = cells.map((q) => center(q));
    this.bench = { t: 0, dts: [], path, len: 0, done };
  }
  /** 0 a 1: cuánto lleva el recorrido (para la barra). */
  get benchProgress() {
    return this.bench ? Math.min(1, this.bench.t / (BackroomsGame.BENCH_WARM + BackroomsGame.BENCH_RUN)) : 0;
  }
  private benchTick(dt: number) {
    const b = this.bench, p = this.player;
    if (!b || !p || this.dying >= 0) return;
    this.paused = false;
    if (dt > 0.5) return; // (la carga del principio no es del recorrido)
    b.t += dt;
    p.frozen = true;
    // por la ruta a 3,2 m/s (de ida y vuelta si se acaba), mirando hacia donde va y barriendo de lado a lado
    const total = b.path.length - 1, s = (b.t * 3.2) / CELL, f = s % (2 * total), at = f > total ? 2 * total - f : f, i = Math.min(Math.floor(at), total - 1), k = at - i;
    const a = b.path[i], n = b.path[i + 1] ?? a, dir = f > total ? -1 : 1, tx = (n.x - a.x) * dir, tz = (n.z - a.z) * dir;
    p.pos.set(a.x + (n.x - a.x) * k, 0, a.z + (n.z - a.z) * k);
    if (tx || tz) p.yaw = Math.atan2(-tx, -tz) + Math.sin(b.t * 1.4) * 0.7;
    if (b.t > BackroomsGame.BENCH_WARM) b.dts.push(dt);
    if (b.t >= BackroomsGame.BENCH_WARM + BackroomsGame.BENCH_RUN) {
      const sorted = [...b.dts].sort((x, y) => x - y), sum = b.dts.reduce((x, y) => x + y, 0);
      this.bench = undefined;
      b.done(b.dts.length / Math.max(sum, 1e-6), (sorted[Math.floor(sorted.length * 0.95)] ?? 1) * 1000);
    }
  }

  devSuites() {
    this.devLevel = 'suites';
    this.start(1);
  }

  /** Solo: regenerar el mapa con otra semilla (el nivel actual). */
  adminLevel0(seed = (Math.random() * 2 ** 31) | 0) {
    if (!this.adminOk) return;
    this.start(seed);
  }

  /** Solo: «Run for your life» en medio de la partida (o sin ella): al llegar a la meta se vuelve. */
  adminRun() {
    if (!this.adminOk) return;
    if (this.run) return;
    this.beginRun();
    const r = this.run as RunLevel | undefined; // (beginRun la crea: TS no lo sabe)
    if (r) r.onDone = r.onFail = () => this.endRun();
    if (!this.player) (this.input.begin(), this.clock.start(), this.renderer.setAnimationLoop(() => this.frame()));
  }

  /** Solo: curar, matar, completar la misión, teletransportarse, objetos y entidades. */
  adminSolo(op: 'heal' | 'kill' | 'mission' | 'tvs' | 'start' | 'elevator' | 'clear' | 'freeze' | 'thaw' | { item: ItemId } | { spawn: Kind }) {
    if (!this.adminOk) return;
    const p = this.player, w = this.world;
    if (!p || !w) return;
    if (op === 'heal') (p.hp = perks.stats.hp), (p.stamina = 1), (p.sanity = 1);
    else if (op === 'kill') this.die();
    else if (op === 'mission') {
      const m = this.mission;
      if (m && !m.done) (m.done = m.exit = true), (m.progress = m.goal), this.missionDone(true);
    } else if (op === 'tvs') this.tvs?.sync([...Array(this.mission?.goal ?? 0).keys()], this.audio);
    else if (op === 'start' || op === 'elevator') p.spawn(center(op === 'start' ? w.maze.start : w.maze.elevator), p.yaw);
    else if (typeof op === 'object' && 'spawn' in op) {
      const m = w.maze, e = new Entity(op.spawn, w, this.assets!, m.spawns[(Math.random() * m.spawns.length) | 0] ?? m.spawns[0]);
      this.entities.push(e);
      this.items!.targets = this.entities;
    } else if (op === 'clear') (this.entities.forEach((e) => e.dispose()), (this.entities = []), (this.items!.targets = this.entities));
    else if (op === 'freeze' || op === 'thaw') this.entFrozen = op === 'freeze';
    else if (canHold(p.inventory, op.item)) p.receive(op.item);
  }

  private gpu?: string;
  /** El modelo de GPU (tipo de dispositivo; va en los informes de fallo). */
  private gpuName() {
    if (this.gpu === undefined) {
      const gl = this.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown').slice(0, 80);
    }
    return this.gpu;
  }
  /** Lo que acompaña a un informe de fallo (telemetry.ts): nivel, semilla y dónde estaba el jugador. Nada personal. */
  crashContext() {
    const p = this.player?.pos;
    return { level: this.mp?.level ?? (this.parking ? 'parking' : 'level0'), floor: this.floorNo, seed: this.seed0, gpu: this.gpuName(), quality: settings.quality, res: Math.round(this.drs * 100) / 100, renderMs: Math.round(this.renderMs * 10) / 10, mp: !!this.mp, pos: p ? [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10] : null };
  }

  /** Solo: lo que enseña el panel de depuración. */
  adminInfo() {
    const m = this.mission;
    return { level: this.parking ? 'parking' : 'level0', seed: this.seed0, t: Math.round(this.t), ents: this.parking?.enemies?.ai.agents.length ?? this.entities.filter((e) => e.alive).length, mission: m ? `${m.text} ${m.progress}/${m.goal}${m.done ? ' DONE' : ''}` : '-', hp: Math.round(this.player?.hp ?? 0), rtt: netStats.rtt };
  }

  /** Saca al jugador de la partida (la sala vuelve al lobby): se para todo y queda el lienzo en negro. */
  stop() {
    this.epi?.ep.dispose();
    this.epi?.self?.dispose();
    this.epi = undefined;
    this.clearXray();
    this.xray.removeFromParent();
    for (const shot of this.throws) shot.mesh.removeFromParent();
    this.throws.clear();
    this.steelRoll = undefined;
    this.renderer.setAnimationLoop(null);
    this.endParking();
    (this.eehVeil?.remove(), (this.eehVeil = undefined), (this.eehRed = false));
    this.audio?.alarm(false);
    this.camOff();
    this.world?.setWatch(undefined);
    this.endRun();
    this.endPool();
    this.totemOpen = false;
    this.leaveWaiting();
    this.stopMp();
    this.input.active = false;
    this.input.clear();
    this.input.unlock();
    this.entities.forEach((e) => e.dispose());
    this.entities = [];
    this.shatters.forEach((s) => s.dispose());
    this.shatters = [];
    this.balloons.forEach((b) => b.removeFromParent());
    this.balloons = [];
    this.audio?.dispose();
    this.audio = undefined;
    this.player?.dispose();
    this.items?.dispose();
    this.world?.dispose();
    this.gadgets?.dispose();
    this.gadgets = undefined;
    this.tvs?.dispose();
    this.tvs = undefined;
    this.mission = this.ascent = null;
    this.player = this.world = this.items = undefined;
    this.spectating = false;
    this.dying = -1;
    this.winning = false;
    this.bagOpen = false;
    this.corrupt(0);
    this.vhs.uniforms.uBlack.value = 0;
    this.vhs.enabled = false;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.flash.intensity = 0;
    this.composer.render(0);
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.endParking();
    this.eehVeil?.remove();
    this.endPool();
    this.endRun();
    this.stopMp();
    this.spare.forEach((r) => r.dispose());
    for (const off of this.offs) off();
    this.input.dispose();
    this.leaveWaiting();
    this.entities.forEach((e) => e.dispose());
    this.shatters.forEach((s) => s.dispose());
    this.snap?.dispose();
    this.audio?.dispose();
    this.xrayMaterial.dispose();
    this.composer.dispose();
    this.gadgets?.dispose();

    this.player?.dispose();
    this.items?.dispose();
    this.world?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// HMR: lo que cuelga de game.ts (mundo, entidades, audio, shaders...) no se parcha en caliente: un cambio ahí recarga la página entera (el navegador libera
// el contexto WebGL, el socket y los listeners de golpe) en vez de dejar una escena a medias; Backrooms.tsx sí se refresca solo (su limpieza llama a dispose)
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
