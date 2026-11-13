import { DEV_LOCAL } from '../devGate';
import * as THREE from 'three';
import { glow, lootModel, pulse } from './rarityFx';
import { loadItemModels } from './itemModels';
import { perks } from './perks';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { compileGently } from './compile';
import { CELL, SUITE_L, generateMaze, suitesMaze, wrapX } from './maze';
import { World, center, HEIGHT } from './world';
import { FLASH } from './lightmap';
import { Input, type Controls } from './input';
import { Player, EYE, fit, CAM_AIM_SLOW, WALK, RUN, JUMP } from './player';
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
import { Gadgets, ROLL } from './gadgets';
import { loadAnimations } from './anim/animator';
import { RunLevel, type RunHud } from './runlevel';
import { PoolTest } from './pool';
import { PoolLevel, loadPoolKit, type PoolKit } from './poolmap';
import { WaitingRoom } from './waiting';
import { Tvs } from './mission';
import { holdStill } from './still';
import { netStats, type Sock } from '../net';
import { worldTl } from './interp';
import { ANISO, FPS_CAPS, settings } from '../settings';
import { watchCanvas } from '../errlog';
import { gearIcons } from './invIcons';
import { prepAvatar } from './InvAvatar';
import { WAIT_HALF, type Sold } from '@backrooms/shared';
import { AMMO_PACK, canHold, ITEM_IDS, START_INV, type AdminFx, makeMission, missionLine, tvCount, type ActiveMission, type Inventory, type ItemId, type MissionKind, type Maze, type LevelCaps, levelCaps, NOISE_RUN, NOISE_SHOT, type Noise } from '@backrooms/shared';
import { Breath, DEFAULT_LOOK, HIT_DAMAGE, HP_MAX, REVIVE_IMMUNE, totemSpot, type Look, hideStates, tickHides, startOffset, type HideState, type PlayerState, type RoomView, type WorldSnapshot } from '@backrooms/shared';

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
  left: 'none' | 'flashlight';
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
}

/** Lo que el OSD enseña, leído desde React diez veces por segundo. */
export interface Hud {
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
  /** Tras subir el primero al ascensor: si yo ya subí y los segundos que quedan para cerrar la ronda. Null si nadie ha subido. */
  ascent: { boarded: boolean; left: number } | null;
  /** La tienda del Faceling está abierta (Las Suites). */
  shop: boolean;
  /** Lo que haría G ahora si no es recoger algo («TURN OFF TV»). */
  act: string | null;
  /** El Tótem de la vida: el selector (compañeros caídos a los que se puede revivir; null cerrado), el nivel «Run for your life» si lo estoy corriendo, los avisos y los segundos de inmunidad que quedan. */
  totem: { pick: { id: string; name: string }[] | null; run: RunHud | null; notes: string[]; immune: number };
}

const _spec = new THREE.Vector3(), _want = new THREE.Vector3(), _none = new THREE.Vector2();

/*
 * Las backrooms: el juego de juegos/backrooms.exe. Sin React; el caparazón (Backrooms.tsx) lo carga,
 * lo arranca y lee su estado para el OSD.
 */

const DIR = '/models/backrooms/';
/** Segundos de viaje dentro del ascensor (ya con las puertas cerradas) antes de que la grabación se corte a negro. */
const RIDE = 3.5;
export const MODELS = ['hazmat', 'bacteria', 'partygoer', 'balloon', 'camcorder', 'vhs', 'gun', 'flashlight', 'water', 'elevator', 'vent', 'socket', 'exit', 'door', 'armchair', 'cabinet', 'shelf', 'chair', 'chair2', 'desk', 'crt', 'lamp', 'duct', 'radar', 'totem', 'hospital/stretcher', 'hospital/stools', 'hospital/curtain', 'hospital/extinguisher', 'hospital/cupboard', 'hospital/clock', 'hospital/exitdoor', 'hospital/locker', 'hospital/drip', 'hospital/wheelchair', 'hospital/shelf', 'suites/door', 'suites/bed', 'suites/sofa', 'suites/secretary', 'suites/faceling', 'suites/chair', 'suites/wardrobe', 'suites/table', 'suites/luggage', 'suites/bin', 'suites/mirror', 'suites/plant', 'suites/panel'] as const;
export type ModelName = (typeof MODELS)[number];
export const TEXTURES = ['wall', 'carpet', 'ceiling'] as const;

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

/** Descarga todo, con el progreso en bytes (aproximado: lo que diga cada respuesta). */
export async function loadAssets(progress: (f: number) => void): Promise<Assets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const urls = [...MODELS.map((m) => DIR + m + '.glb'), ...TEXTURES.map((t) => DIR + 'tex/' + t + '.webp')];  const got = new Map<string, number>(), total = new Map<string, number>();
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
    loadItemModels(),
    ...MODELS.map((m) => loader.loadAsync(DIR + m + '.glb', on(DIR + m + '.glb')).then((g) => void (gltf[m] = g))),
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
  return { gltf, tex };
}

/**
 * El juego. `load` lo descarga todo y compila los materiales con un laberinto de prueba (los de cada
 * partida comparten programas: no se vuelve a compilar al darle a Play); `start` monta una partida.
 */
export class BackroomsGame {
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
  readonly cheats = { ammo: false, stamina: false, sanity: false, speed: 1, jump: 1, bright: false, slow: 1 };
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
  private pool?: PoolTest | PoolLevel;
  private fx?: { ao: GTAOPass; smaa: SMAAPass };
  private bloom?: UnrealBloomPass;
  private nextDraw = 0;

  /** El halo de los fluorescentes, en vivo (en calidad baja no hay: nada que hacer). */
  setBloom(on: boolean) {
    if (this.bloom) this.bloom.enabled = on;
  }

  /** El tope de fotogramas (ajuste FPS LIMIT): true si a este fotograma le toca saltarse el dibujo. */
  private capped() {
    const cap = FPS_CAPS[settings.fpsLimit] ?? 0;
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
    this.flash.shadow.camera.far = 22;
    this.flash.shadow.bias = -0.002;
    this.input = new Input(canvas);
    // la imagen: escena, el halo de los fluorescentes (no en calidad baja), color de pantalla, el grano y,
    // mirando por la cámara, la cinta encima
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!opts.low) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.92);
      this.bloom.enabled = settings.bloom;
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.film);
    this.composer.addPass(this.vhs);
    this.film.uniforms.uMove.value = opts.reduced ? 0 : 1;
    const u = this.vhs.uniforms;
    u.uMove.value = opts.reduced ? 0 : 1;
    u.uLow.value = opts.low ? 1 : 0;
    u.tPrev.value = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    u.tPrev.value.needsUpdate = true;
    this.scene.background = new THREE.Color(0x17130a);
    this.scene.fog = new THREE.Fog(0x17130a, 2.5, 19);
    this.scene.add(this.hemi, this.camera, this.dust, ...this.points);
    this.dust.frustumCulled = false;
    this.camera.add(this.flash, this.flash.target);
    // sale de la lente de la linterna (en la mano izquierda), hacia el centro de la vista
    this.flash.position.set(-0.13, -0.16, -0.5);
    this.flash.target.position.set(0, -0.3, -6);
    const resize = () => {
      // como mucho a 1080 líneas (y a la mitad en calidad baja): el grano y la cinta lo ablandan igual
      const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight, pr = Math.min(devicePixelRatio, 1080 / h) * (opts.low ? 0.6 : 1) * settings.resScale;
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
    this.offs.push(() => removeEventListener('resize', resize));
  }

  /** Quitar o devolver el sonido (vale también antes de empezar: se aplica al crear el audio). */
  setVolume(v: number) {
    this.volume = v;
    this.audio?.setVolume(v);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.audio?.setMuted(m);
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
    await loadAnimations().catch((e) => console.error('animations', e)); // (el paquete de animaciones del jugador: sin él, los clips del modelo)
    at(1, 2 / 6);
    await loadPoolKit(); // (el tanque y la pistola de agua salen de ahí; sin él no tienen icono)
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
    new Items(w, this.assets, p, this.camera); // y lo que se recoge (cintas, cámara y rifle en el suelo)
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
    this.stills = this.prerender(w, p, es);
    es.forEach((e) => e.dispose());
    p.dispose();
    w.dispose();
    at(3, 1);
  }

  /**
   * Las escenas de la nieve del menú, pintadas una vez con el mapa de prueba ya compilado: salas y pasillos
   * vistos desde el suelo, con una a tres entidades bailando; cada escena son 3 fotogramas de su baile, a
   * 320×180, que el menú saca de vez en cuando entre la nieve.
   */
  private prerender(w: World, p: Player, es: Entity[]) {
    const m = w.maze, cam = this.camera, out: HTMLCanvasElement[][] = [];
    p.rig.root.visible = false;
    for (const it of Object.values(p.items)) it.visible = false;
    this.vhs.enabled = false;
    const extra = (['bacteria', 'partygoer'] as Kind[]).map((k, i) => new Entity(k, w, this.assets!, m.spawns[i] ?? m.start));
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
    for (let tries = 0; out.length < 7 && tries < 400; tries++) {
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
      const n = 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
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
      for (let f = 0; f < 3; f++) {
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
    this.seed0 = seed;
    this.fadeIn = this.waiting ? 0.9 : 0; // de la sala de espera a la partida: el negro de la entrada se abre
    this.leaveWaiting();
    this.stopMp();
    this.entities.forEach((e) => e.dispose());
    this.shatters.forEach((s) => s.dispose());
    this.shatters = [];
    this.spectating = false;
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
    (this.scene.fog as THREE.Fog).far = this.caps.hotel ? 24 : 19;
    (this.scene.fog as THREE.Fog).color.set(this.caps.hotel ? 0x1d0c0a : 0x17130a);
    this.points.forEach((l) => l.color.set(this.caps.hotel ? 0xffd2a0 : 0xffefc6)); // las luces puntuales que dan el brillo al cuarzo: cálidas en el hotel
    if (this.bloom) (this.bloom.strength = this.caps.hotel ? 0.62 : 0.55), (this.bloom.threshold = this.caps.hotel ? 0.9 : 0.92), (this.bloom.radius = this.caps.hotel ? 0.9 : 0.6);
    // desarrollo: &god, inmortal
    this.god = !mp && DEV_LOCAL && new URLSearchParams(location.search).has('god');
    const w = (this.world = new World(this.caps.hotel ? suitesMaze(seed, mp?.floor) : generateMaze(seed, mp?.players ?? 1), this.assets!, this.caps.hotel));
    w.maze.totem = totemSpot(w.maze, seed, mp?.players ?? 1); // el Tótem de la vida, si toca (como en el servidor)
    this.scene.add(w.root);
    const m = w.maze, s = m.start;
    this.hides = hideStates(m);
    const p = (this.player = new Player(w, this.assets!, this.camera, this.flash, this.opts.reduced));
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
    if (!mp && DEV_LOCAL && new URLSearchParams(location.search).has('totem')) m.totem = { x: s.x + side[0], y: s.y + side[1] }; // desarrollo: &totem pone el tótem junto al inicio
    p.onFall = () => {
      if (this.mp && this.caps.fall) (this.sendState(), this.mp.sock.emit('fell'));
      this.die();
    };
    this.audio ??= new GameAudio(undefined, this.muted, this.volume);
    // la misión: la del servidor o, solo, una al azar (las cintas solo se colocan si la misión es encontrarlas)
    this.mission = mp ? (mp.mission ?? null) : this.soloMission(m);
    const it = (this.items = new Items(w, this.assets!, p, this.camera, this.audio, this.mission?.kind === 'tapes'));
    it.onWin = (stairs) => this.win(stairs);
    it.onLocker = (id) => this.onLocker?.(id);
    it.ready = !!this.mission?.done;
    if (this.mission?.kind === 'tvs') {
      this.tvs = new Tvs(w, this.assets!, this.mission.goal);
      if (mp) this.tvs.claim = (i, done) => mp.sock.emit('tv', i, done);
    }
    this.gadgets = new Gadgets(w, p, this.camera, this.assets!, this.canvas.parentElement ?? document.body, () => this.remotes.values());
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
      const onWet = (m: { kind: 'wet' | 'stun'; ms: number }) => p.hit(m.kind, m.ms);
      mp.sock.on('wet', onWet);
      this.offNet.push(() => mp.sock.off('wet', onWet));
    }
    it.onKill = (t, from) => this.kill(t as Entity, from);
    if (mp) {
      it.peers = () => [...this.remotes.values()].filter((r) => !r.dead && !r.hiding).map((r) => ({ id: r.id, at: r.pos.clone().setY(r.pos.y + 1) }));
      it.onShootPlayer = (id) => mp.sock.emit('shoot', id);
      it.onShot = () => mp.sock.emit('bang');
    } else it.onShot = () => this.noises.push({ x: p.pos.x, z: p.pos.z, r: NOISE_SHOT });
    this.input.begin();
    this.audio.start();
    this.t = 0;
    this.paused = false;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    if (this.capped()) return;
    const dt = Math.min(this.clock.getDelta(), 0.05) * (this.mp ? 1 : this.cheats.slow); // (cámara lenta: solo en solitario)
    this.lastFrame = performance.now();
    // en una sala la pausa no detiene el mundo (los demás siguen jugando): solo se sueltan los mandos
    if (this.paused && (!this.mp || this.run)) return;
    const c = this.input.read();
    if (this.run) return this.runFrame(dt, c);
    this.vhs.uniforms.uPool.value = this.film.uniforms.uVhs.value = this.pool instanceof PoolLevel ? 1 : 0; // (el aspecto de cinta de las Poolrooms: sin amarillo, con barrido y croma)
    this.film.uniforms.uWarm.value = this.caps.hotel && !this.run ? 1 : 0; // (Las Suites: el color cálido del hotel)
    if (this.pool) return this.poolFrame(dt, c);
    if (this.totemOpen && c.bag) (c.bag = false), this.closeTotem(); // Esc o E cierran el selector del Tótem
    // el inventario: E lo abre y lo cierra (Escape también lo cierra, sin pausar)
    if (this.dying < 0 && !this.winning && c.bag) {
      if (this.bagOpen) this.closeBag();
      else if (!this.hideKey()) this.openBag();
    }
    if (c.pause && this.dying < 0 && !this.winning) {
      if (this.bagOpen) (this.bagOpen = false), (this.input.suspend = false); // una pausa de verdad también lo cierra
      return this.pause();
    }
    this.t += dt;
    if (this.player) (this.player.speedMul = this.cheats.speed), (this.player.jumpMul = this.cheats.jump);
    if (this.brightLight) this.brightLight.visible = this.cheats.bright;
    if (!this.spectating || this.player?.dead) this.player?.update(dt, c);
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
      if (this.world && this.caps.hotel && this.player && !this.player.dead && !this.tvs?.hint && !this.items?.hint) {
        const d = this.world.nearDoor(this.player.pos.x, this.player.pos.z, this.player.yaw); // Las Suites: G abre y cierra las puertas de las suites
        if (d) ((this.doorAct = d.tgt ? 'CLOSE DOOR' : 'OPEN DOOR'), cc.grab && (this.world.toggleDoor(d), (cc = { ...cc, grab: false })));
      }
      if (this.world && this.mp && this.caps.hotel && this.player && !this.player.dead && !this.doorAct && !this.tvs?.hint && !this.items?.hint && !this.items?.close() && this.world.nearCounter(this.player.pos.x, this.player.pos.z, this.player.yaw)) {
        this.doorAct = 'TALK TO THE FACELING'; // Las Suites: la tienda de recepción
        if (cc.grab) (this.openShop(), (cc = { ...cc, grab: false }));
      }
      if (this.world && this.caps.hotel && this.player && !this.doorAct && this.items && !this.items.hint) {
        const it = this.items, e = this.world.maze.elevator, q = this.player.pos, gs = it.gens;
        if (q.y > 2.2 && !it.ready) this.doorAct = 'FLOOR DOOR LOCKED · FINISH THE MISSION';
        else if (e && Math.hypot(q.x - (e.x + 0.5) * CELL, q.z - (e.y + 0.5) * CELL) < 3) {
          if (!it.powered) this.doorAct = `ELEVATOR HAS NO POWER · SWITCH ON THE PANELS ${gs.on}/${gs.n}`;
          else if (!it.ready) this.doorAct = 'ELEVATOR OFFLINE · FINISH THE MISSION';
        }
      }
      this.items?.update(this.t, dt, cc);
      if (cc.drop) this.dropSelected();
    }
    if (!this.mp) this.soloTick();
    this.hideFrame(dt, c.hold);
    this.monsters(dt);
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
    const inv: Inv = { left: p?.left ?? 'none', belt: p?.belt ?? 'none', stamina: p?.stamina ?? 1, sanity: p?.sanity ?? 1, escaped: this.winning, hand: p?.hand ?? 'none', camera: !!p?.has.camera, gun: !!p?.has.gun, ammo: p?.ammo ?? 0, spare: p?.spare ?? 0, tapes: this.items?.tapes ?? 0, photos: this.items?.photos ?? 0, thumbs: this.items?.thumbs ?? this.pics.thumbs, full: this.items?.full ?? this.pics.full, flashOn: !!p?.flashOn, battery, charge: p?.charge ?? 1, spares: p?.spares ?? 0, uno: !!p?.uno, monster: p?.monster ?? 0, rainbow: !!p?.rainbow, water: p?.water ?? 0, hot: p?.hot ?? [], hotSel: p?.hotSel ?? 0, gadget: p?.gadget ?? 'none', totem: p?.totem ?? 0, radar: !!p?.radar, caution: !!p?.caution, tape: (this.gadgets?.left ?? ROLL) / ROLL };
    // la pistola de agua y el tanque se conservan en el nivel 0 (aunque no sirvan allí): siguen en la mochila y en la ranura de equipo
    const gear = p?.inventory;
    if (gear) Object.assign(inv, { tank: gear.tank, tankOn: p!.tankOn, watergun: gear.watergun, squirt: p!.squirt });
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (pl && this.mp?.inv?.watergun) Object.assign(inv, { watergun: true, squirt: pl.squirtLeft, hand: pl.gunOn ? 'watergun' : 'none' });
    if (pl && this.mp?.inv?.tank) inv.tank = true;
    const hidden = !!p && p.hideState !== 'out';
    const ms = this.mission, up = this.ascent;
    return { mission: ms ? { kind: ms.kind, text: ms.text, line: missionLine(ms), progress: ms.progress, goal: ms.goal, done: ms.done } : null, ascent: up ? { boarded: !!this.mp && up.boarded.includes(this.mp.id), left: Math.max(0, up.left - (performance.now() - up.at) / 1000) } : null, act: hidden || this.run ? null : this.tvs?.hint ?? this.doorAct ?? pl?.act ?? null, totem: this.totemHud(), needClick: this.input.needClick, bag: this.bagOpen && !this.shopOpen, shop: this.bagOpen && this.shopOpen, note: this.gadgets?.note ?? null, hint: hidden || this.run || this.tvs?.hint ? null : this.gadgets?.hint ?? this.items?.hint ?? pl?.hint ?? null, hide: this.dying >= 0 || this.winning || this.spectating ? null : hidden ? (p!.hideState === 'hidden' ? 'leave' : null) : this.hideNear() ? 'hide' : null, breath: p?.concealed ? { air: this.breath.air, warn: this.inspected, held: this.holding } : null, drink: p?.dead ? 0 : p?.drinking || p?.drinkingMonster || p?.drinkingUno || 0, drinkName: p?.prop === 'monster' ? 'MONSTER' : p?.prop === 'uno' ? 'UNO REVERSE' : 'ALMOND WATER', refill: pl?.fill ?? 0, inv, aiming: !!p?.aiming, scoped: !!p?.scoped && !this.spectating, zoom: p?.zoom ?? 1, focus: !!this.items?.focus, tapes: this.items?.tapes ?? 0, photos: this.items?.photos ?? 0, ammo: p?.has.gun ? p.ammo : null, spare: p?.spare ?? 0, battery, time: this.t, hp: p?.hp ?? HP_MAX, hps: this.hps, spectating: this.spectating && !this.run ? (this.remotes.get(this.watching)?.name ?? '') : null, watchList: this.spectating && !this.run ? [...this.remotes.values()].map((r) => ({ name: r.name, on: r.id === this.watching && this.specView !== 'free', dead: r.dead })) : undefined, specView: this.spectating && !this.run ? this.specView : undefined };
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
    const p = this.player!, w = this.world!, eye = this.camera.position, near = { bacteria: Infinity, partygoer: Infinity };
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
    if (this.cheats.ammo) (p.ammo = AMMO_PACK), (p.squirt = 1);
    this.film.uniforms.uMad.value = this.dying < 0 ? 1 - (p.sanity) : 0;
    this.shatters = this.shatters.filter((s) => s.update(dt));
    this.balloons = this.balloons.filter((b) => {
      b.position.y += dt * 1.6;
      b.rotation.z = Math.sin(b.position.y * 2) * 0.3;
      if (b.position.y < 9) return true;
      b.removeFromParent();
      return false;
    });
  }

  /** El nicho que tienes delante: cerca, mirándolo, por su boca y vacío (sin nadie dentro ni entrando). */
  private hideNear(): HideState | undefined {
    const p = this.player;
    if (!p || p.hideState !== 'out' || p.frozen || p.dead) return undefined;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const h of this.hides) {
      const dx = h.x - p.pos.x, dz = h.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 2.4 || (fx * dx + fz * dz) / d < 0.8) continue;
      // por la boca: del lado de la salida
      if (((p.pos.x - h.x) * (h.fx - h.x) + (p.pos.z - h.z) * (h.fz - h.z)) / CELL < 0.6 * CELL * 0.5) continue;
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
      this.holding = this.breath.step(dt, !!hold);
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
    this.world!.root.add(s.root);
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
    if (e) {
      const head = e.rig.bone('Head')?.getWorldPosition(new THREE.Vector3()) ?? e.pos.clone().setY(e.height * 0.9);
      if (t < 0.4) {
        // se lanza a la lente: la vista se clava en su cara, se abre de golpe y tiembla
        const k = t / 0.4;
        cam.quaternion.slerp(look(cam.position, head), Math.min(1, dt * 14));
        cam.fov = THREE.MathUtils.lerp(70, 100, k * k);
        if (!this.opts.reduced) cam.position.set(p.pos.x + (Math.random() - 0.5) * 0.08 * k, p.pos.y + 1.62 + (Math.random() - 0.5) * 0.08 * k, p.pos.z + (Math.random() - 0.5) * 0.08 * k);
      } else {
        // la camcorder sale volando de las manos, dando vueltas, y cae de lado al suelo
        if (!this.fly) {
          const away = cam.position.clone().sub(e.pos).setY(0).normalize();
          const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar((Math.random() - 0.5) * 2);
          this.fly = { pos: cam.position.clone(), vel: away.multiplyScalar(3).add(side).setY(2.6), q: cam.quaternion.clone(), spin: new THREE.Vector3(9, 6, 11).multiplyScalar(Math.random() < 0.5 ? -1 : 1), bounced: false };
        }
        const f = this.fly, w = this.world!;
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
    return { ...makeMission(kinds[(Math.random() * kinds.length) | 0], Math.random, 'solo', tvs), progress: 0, done: false };
  }

  /** Solo: el progreso de la misión sale de lo que se hace aquí; al cumplirse se abre el ascensor. */
  private soloTick() {
    const m = this.mission, it = this.items;
    if (!m || m.done || !it) return;
    m.progress = Math.min(m.goal, m.kind === 'photos' ? it.photos : m.kind === 'tapes' ? it.tapes : m.kind === 'survive' ? Math.floor(this.t) : (this.tvs?.off ?? 0));
    if (m.progress >= m.goal) (m.done = true), this.missionDone();
  }

  /** En una sala: la misión y el ascensor según el servidor. */
  private roomUpdate(r: RoomView) {
    const was = !!this.mission?.done;
    this.mission = r.mission;
    this.ascent = r.ascent ? { left: r.ascent.left, at: performance.now(), boarded: r.ascent.boarded } : null;
    if (r.mission?.done && !was) this.missionDone();
    if (this.items) this.items.ready = !!r.mission?.done;
  }

  /** La misión se ha cumplido: aviso y ascensor abierto (se abre al acercarse). */
  private missionDone() {
    if (this.items) this.items.ready = true;
    this.note = { text: 'MISSION COMPLETE · GO TO THE ELEVATOR', until: performance.now() + 6000 };
    this.audio?.done();
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
    if (!mp.inv.watergun) pl.gunOn = false;
    pl.hasGun = !!mp.inv.watergun;
  }

  /** Dentro del ascensor: las puertas se cierran, la grabación se corta a negro y «Noclip». */
  private viaStairs = false;
  private win(stairs = false) {
    this.winning = true;
    this.viaStairs = stairs;
    this.player!.frozen = this.player!.lookFree = true; // quieto, pero mira alrededor: el viaje se ve desde dentro
    if (!stairs) this.world?.cab.board(); // (por la escalera no hay cabina: se corta a negro sin más)
    this.bagOpen = false;
    unlock('backrooms');
    this.mp?.sock.emit('ascend', this.player!.inventory); // sube con lo que lleva; el servidor lo acota y cierra la ronda cuando suben todos o se acaba el tiempo
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
      const wr = await WaitingRoom.load(this.assets!, this.opts.reduced);
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
      wr.sfx = (n) => {
        const a = this.audio;
        if (n === 'creak') a?.creak();
        else if (n === 'boom') a?.boom();
        else if (n === 'alarm' || n === 'alarmoff') a?.alarm(n === 'alarm');
        else if (n === 'vend') a?.vend();
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
      // las teclas 1–4 son los emotes (no mientras se escribe)
      const emoteKey = (e: KeyboardEvent) => {
        if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT' || !/^Digit[1-4]$/.test(e.code)) return;
        const n = Number(e.code.slice(5)), lp = this.player, id = lp?.hot[n - 1];
        if (this.lobbyP && id && HOT[id]?.have(lp!.own)) return; // una ranura con objeto: la usa el Player; solo las vacías son emotes
        wr.doEmote(n);
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
    const DIFF = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' } as const;
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
    if (level === 'poolrooms') return void (await loadPoolKit()); // (el nivel se arma al empezar; las piezas ya están bajadas y leídas)
    if (!a) return;
    const tick = () => new Promise((r) => setTimeout(r, 30));
    await tick();
    const hotel = levelCaps(level).hotel, maze = hotel ? suitesMaze(seed, floor) : generateMaze(seed, players);
    await tick();
    new World(maze, a, hotel).dispose();
    await tick();
  }

  closeComputer() {
    this.waiting?.closeComputer();
  }

  private lobbyP = false;
  private lobbyHid = false;
  private lobbyVis: boolean[] = [];
  /** Lo soltado en la sala de espera: id → su modelo en el suelo (lo manda el servidor con `ldrops`). */
  private lobbyDrops = new Map<string, THREE.Object3D>();

  /** El Player en la sala de espera: se le da mi posición, mirada y altura (la sala los lleva) y se le deja poner manos, objetos y linterna. Con la cámara de otro sitio (sentado, ante la pantalla) se esconden. */
  private lobbyHands(dt: number, c: Controls, wr: WaitingRoom) {
    const me = this.player;
    if (!me || !this.lobbyP) return;
    const items = Object.values(me.items);
    if (!wr.driving || this.paused) {
      if (!this.lobbyHid) (this.lobbyVis = items.map((i) => i.visible)), items.forEach((i) => (i.visible = false)), (me.rig.root.visible = false), (this.lobbyHid = true);
      this.flash.intensity = 0;
      return;
    }
    if (this.lobbyHid) (items.forEach((it, k) => (it.visible = this.lobbyVis[k] ?? false)), (this.lobbyHid = false));
    const cam = wr.camera;
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
    this.flash.intensity = me.lightOn ? FLASH * 0.6 : 0;
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
      const d = Math.hypot(o.position.x - wr.pos.x, o.position.z - wr.pos.z);
      if (d < bd) (bd = d), (best = id);
    }
    if (best) mp.sock.emit('pickup', best, (ok: boolean) => (ok ? this.audio?.pickup() : wr.say('CANNOT CARRY MORE')));
  }

  /** Lo soltado en el suelo de la sala de espera: los nuevos se ponen con su modelo, los que ya no están se quitan. */
  private syncLobbyDrops(list: { id: string; kind: string; x: number; z: number; q?: { r: number } }[]) {
    const wr = this.waiting, a = this.assets;
    if (!wr || !a) return;
    const here = new Set(list.map((d) => d.id));
    for (const [id, o] of this.lobbyDrops) if (!here.has(id)) (o.removeFromParent(), this.lobbyDrops.delete(id));
    const g = a.gltf;
    const model: Record<string, [THREE.Object3D | undefined, number]> = { flashlight: [g.flashlight?.scene, 0.24], camera: [g.camcorder?.scene, 0.22], gun: [g.gun?.scene, 0.72], water: [g.water?.scene, 0.17], caution: [g.duct?.scene, 0.16], radar: [g.radar?.scene, 0.2], totem: [g.totem?.scene, 0.5] };
    for (const d of list) {
      if (this.lobbyDrops.has(d.id)) continue;
      const m = model[d.kind];
      const o = d.kind === 'loot' ? lootModel(d.q?.r) : m?.[0] ? fit(m[0].clone(true), m[1]) : new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.5 }));
      o.add(glow(d.q?.r ?? 0));
      o.position.set(d.x, 1.1, d.z);
      o.rotation.y = (d.x * 3.1 + d.z) % 6.28;
      const h = Math.sin(d.id.split('').reduce((a2, ch) => a2 * 31 + ch.charCodeAt(0), 7)) * 43758.5453, u = h - Math.floor(h), an = u * Math.PI * 2;
      o.userData.phys = { v: new THREE.Vector3(Math.cos(an) * 0.9, 1.6, Math.sin(an) * 0.9), spin: new THREE.Vector3((u - 0.5) * 9, (u - 0.3) * 6, (0.5 - u) * 9), rest: false };
      wr.scene.add(o);
      this.lobbyDrops.set(d.id, o);
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
    // pausa (Esc, el puntero soltado): la sala sigue y los demás se ven; solo se sueltan los mandos
    if (c.pause && wr.mode === 'free' && !this.paused) this.pause();
    wr.update(dt, this.paused || wr.mode === 'starting' ? { ...c, move: _none.clone(), look: _none.clone(), bag: false, run: false } : c);
    this.lobbyHands(dt, c, wr);
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
    this.vhs.enabled = wr.black > 0;
    u.uAspect.value = 1;
    u.uTime.value = this.film.uniforms.uTime.value = this.t;
    u.uBlack.value = wr.black;
    this.composer.render(dt);
  }

  /** Quita la sala de espera: el compositor vuelve a pintar la escena del juego. */
  leaveWaiting() {
    this.waitTok++; // si aún se estaba cargando, se cancela
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
      for (const o of this.lobbyDrops.values()) o.removeFromParent();
      this.lobbyDrops.clear();
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
        if (all[mp.id].hp! < this.player.hp) this.audio?.cue('hurt');
        this.player.hp = all[mp.id].hp!;
      }
      this.syncRemotes(all, mp.id, this.pool instanceof PoolLevel ? this.pool.scene : this.scene);
    };
    const onWorld = (w: WorldSnapshot) => this.applyWorld(w);
    const onDead = (id: string) => {
      if (id !== mp.id) return this.remotes.get(id)?.die();
      if (this.pool instanceof PoolLevel) return this.poolDied(this.pool);
      if (this.dying >= 0 || this.winning || !this.player) return;
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
      if (m.id === mp.id && !this.pool) this.beginRun(); // (el Run for your life es del nivel 0)
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
      if (this.pool instanceof PoolLevel) return this.poolRevived(this.pool, m);
      this.endRun();
      this.dying = -1;
      this.killer = undefined;
      this.spectating = false;
      this.fly = undefined;
      this.black = 0;
      this.corrupt(0);
      this.immuneUntil = performance.now() + REVIVE_IMMUNE;
      this.player?.revive(new THREE.Vector3(m.x, 0, m.z), m.yaw);
      for (const r of this.remotes.values()) r.setFirstPerson(false);
      this.input.suspend = false;
      this.input.soft();
      this.input.lock();
    };
    // la sala cambia (misión, progreso, ascensor): lo que el servidor dice manda
    const onRoom = (r: RoomView) => this.roomUpdate(r);
    s.on('room', onRoom);
    s.on('players', onPlayers);
    s.on('world', onWorld);
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
    this.offNet.push(() => (s.off('room', onRoom), s.off('players', onPlayers), s.off('world', onWorld), s.off('dead', onDead), s.off('reviving', onReviving), s.off('revived', onRevived), s.off('runFailed', onRunFailed), removeEventListener('keydown', key)));
    if (items) (items.claim = (id, done) => s.emit('pickup', id, done)), (items.onPhoto = () => s.emit('photo'));
  }

  /** Los demás jugadores según lo que dice el servidor: se crean (con un clon reutilizado, en `parent`), se mueven y se quitan los que ya no están. */
  private syncRemotes(all: Record<string, PlayerState & { name: string; dead: boolean }>, me: string, parent: THREE.Object3D) {
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
        r.onStep = r.floorShadow ? (rr, run) => this.remoteStep(rr, run) : undefined;
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
  private onVisible = () => {
    if (!document.hidden) this.resync = true;
  };

  /** El snapshot del servidor: las entidades (las nuevas se crean, las que faltan han muerto) y los objetos. */
  private applyWorld(w: WorldSnapshot) {
    const world = this.world ?? this.poolWorld, mp = this.mp;
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
    this.items?.sync(w.taken, w.tapes);
    if (this.pool instanceof PoolLevel) {
      this.pool.sync(w.taken);
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
    for (const r of this.remotes.values()) r.update(dt);
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

  private sendState() {
    const p = this.player;
    if (!p || !this.mp) return;
    if (this.pool instanceof PoolLevel) return this.poolState(this.pool);
    // volatile: si el túnel va atascado, este estado se pierde en vez de encolarse (el siguiente lleva lo último); t: la hora de ahora, para que
    // los demás reconstruyan mi ritmo aunque los paquetes lleguen tarde o juntos
    // Las Suites: al servidor se le cuenta siempre la copia del medio del pasillo (donde están los objetos); el salto al entrar o salir del vestíbulo es un teletransporte legítimo (`tp`)
    const sx = this.caps.hotel ? wrapX(p.pos.x) : p.pos.x;
    if (Math.abs(sx - this.sentX) > 10) this.tp++;
    this.sentX = sx;
    this.mp.sock.volatile.emit('state', { x: sx, tp: this.tp, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, anim: 'Neutral Idle', dance: p.dancing || undefined, variant: p.variant || undefined, light: p.lightOn, duck: p.duck, held: p.concealed || p.hand === 'watergun' ? 'none' : p.hand, hiding: p.concealed, holding: this.holding, t: performance.now() });
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
  private openTotem() {
    if (this.totemOpen || this.run || this.spectating || this.dying >= 0) return;
    this.totemOpen = true;
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
    return { pick: this.totemOpen ? this.deadMates() : null, run: this.run?.hud ?? null, notes, immune: Math.max(0, (this.immuneUntil - now) / 1000) };
  }

  /** Empieza «Run for your life» (runlevel.ts): su escena y su cámara sustituyen a las del juego en el compositor hasta que se acaba. */
  private beginRun() {
    if (this.run || !this.assets) return;
    this.totemOpen = this.bagOpen = false;
    this.input.suspend = false;
    this.audio ??= new GameAudio(undefined, this.muted, this.volume);
    const r = (this.run = new RunLevel(this.assets, this.audio, this.opts.reduced, this.camera.aspect));
    r.onDone = () => this.mp?.sock.emit('runDone'); // el servidor lo comprueba y manda `revived`; hasta entonces, la imagen se queda en negro
    r.onFail = () => (this.mp ? this.mp.sock.emit('runFail') : this.endRun()); // una sola oportunidad: el servidor lo da por muerto (`runFailed`)
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
    r.dispose();
    const rp = this.composer.passes[0] as RenderPass;
    rp.scene = this.scene;
    rp.camera = this.camera;
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
      // el inventario: la tecla lo abre y lo cierra (como en el nivel 0; ni muerto ni subiendo)
      if (c.bag) this.bagOpen ? this.closeBag() : pl instanceof PoolLevel && (pl.dead || this.winning) ? undefined : this.openBag();
      if (pl instanceof PoolLevel) c = this.poolMatch(pl, dt, c);
    }
    if (pl instanceof PoolLevel && me) (pl.walkSp = WALK * perks.stats.speed * me.speedMul), (pl.runSp = RUN * perks.stats.speed * me.speedMul), (pl.jumpV = JUMP * me.jumpMul); // (las del Player: el mismo personaje en todos los niveles)
    pl.update(dt, me?.winded && c.run ? { ...c, run: false } : c); // sin aguante no se corre (el Player lo gasta en poolHands)
    this.poolHands(pl, dt, c);
    if (pl instanceof PoolLevel && me) for (const e of this.entities) e.alive && e.update(dt, me.pos, pl.camera.position, null, false, true); // las entidades de la sala (el servidor las lleva)
    if (this.spectating) this.specCam(dt, c);
    // la cinta (líneas de barrido, croma) fuera del nivel: solo el grano de la película, que se mueve
    // (mirando por la cámara de fotos sí: el visor con la cinta, como en el nivel 0)
    const aim = !!me?.aiming && !this.spectating;
    this.vhs.enabled = aim;
    this.vhs.uniforms.uAspect.value = this.camera.aspect;
    this.vhs.uniforms.uTime.value = this.film.uniforms.uTime.value = this.t += dt;
    this.film.uniforms.uMad.value = 0;
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
  /** Las manos y la linterna del Player encima de la cámara del nivel: se le da mi posición y mirada, se le deja pintar y se devuelve la cámara tal como la dejó PoolLevel. */
  private handY?: number;
  private poolHands(pl: PoolTest | PoolLevel, dt: number, c: Controls) {
    const me = this.player;
    if (!me || !(pl instanceof PoolLevel)) return;
    const cam = pl.camera, pos = cam.position.clone(), rot = cam.rotation.clone(), st = pl.state;
    // el mismo Player de siempre: PoolLevel pone la física (posición, salto, nado) y se la pasa; el Player lleva el cuerpo (pasos a la velocidad real, salto, agachado) y las manos
    me.ext = { speed: st.swim ? 0 : st.speed, air: st.air, vy: st.vy };
    pl.slowMul = (me.aiming ? CAM_AIM_SLOW : 1) * me.buffSpeed; // enfocar con la camcorder frena (igual que en el laberinto)
    // (la altura se suaviza: PoolLevel sube peldaños y flota con sacudidas que, pegadas a las manos, las hacían temblar)
    const ty = cam.position.y - EYE + me.duckLift;
    this.handY = this.handY === undefined || Math.abs(this.handY - ty) > 0.5 ? ty : this.handY + (ty - this.handY) * (st.air ? 1 : Math.min(1, dt * 9)); // (en el aire sin suavizar: si no, los brazos iban por detrás de lo que llevan en la mano)
    // muerto, el cuerpo se queda tumbado donde cayó (st sigue a la cámara del espectador: ver haunt)
    const dp = pl.dead ? this.deathAt : undefined;
    me.pos.set(dp?.x ?? st.x, dp ? dp.y : this.handY, dp?.z ?? st.z); // (la vista agachada ya la baja PoolLevel: se le suma lo que el Player baja la suya)
    me.yaw = dp?.yaw ?? st.yaw;
    me.pitch = st.pitch;
    me.dead = pl.dead; // muerto: el Player tumba el cuerpo y esconde las manos
    // el salto lo hace PoolLevel (el Player lo ve en st.air); la barra rápida y la rueda las lleva poolMatch
    // la cámara de fotos sí se apunta (clic derecho, zoom) y dispara, salvo nadando o muerto
    const cam_ok = !pl.dead && !st.swim && !this.winning;
    // (sin `look`: la mirada ya es la de PoolLevel; si el Player la sumara otra vez, las manos irían un fotograma por delante de la cámara)
    me.update(dt, { ...c, look: _none, jump: false, crouch: !!c.crouch && !st.swim && !pl.dead, aim: c.aim && cam_ok, zoom: cam_ok ? c.zoom : 0, slot: -1, wheel: 0, use: false, swap: false });
    if (!cam_ok && me.aiming) (me.aiming = false), (me.zoom = 1);
    if (st.swim && !pl.dead) me.rig.root.visible = false;
    if (c.fire && cam_ok && me.hand === 'camera' && me.aiming && this.t - this.picAt > 0.8) {
      this.picAt = this.t;
      this.picSnap = true;
      this.audio?.shutter();
    }
    cam.position.copy(pos);
    cam.rotation.copy(rot);
    cam.updateMatrixWorld();
  }
  /** Lo nuevo del jugador que avisa al servidor: la Monster (se gasta) y la carta Uno Reverse (cambia de sitio con otro al azar). */
  private hookGear(p: Player) {
    p.onMonster = () => (this.audio?.drink(), this.mp?.sock.emit('monster'));
    p.onUno = (done) => {
      if (!this.mp) return done(false);
      this.mp.sock.emit('uno', (ok) => (ok && this.audio?.cue('equip'), done(ok)));
    };
  }
  /** Fotos de las Poolrooms (no hay Items allí): miniaturas y grandes, y el pedido de captura al pintar. */
  private pics = { thumbs: [] as string[], full: [] as string[] };
  private picSnap = false;
  private picAt = -9;
  private poolStat?: { n: number; ms: number; el: HTMLPreElement };

  /** Una ronda de las Poolrooms con compañeros: el mapa y el movimiento son de PoolLevel; la sala (misión, ascensor, compañeros) funciona como siempre. */
  /** La carga de un nivel al empezar la ronda: cuánto lleva (0–1), o null al acabar. */
  onLevelLoad?: (f: number | null) => void;

  private async startPool(seed: number, mp: Mp) {
    const tok = ++this.poolTok;
    this.pics = { thumbs: [], full: [] };
    this.renderer.setAnimationLoop(null);
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
    const gd = (this.gadgets = new Gadgets(stub, me, p.camera, this.assets!, this.canvas.parentElement ?? document.body, () => (p.jam > 0 ? [] : [...this.remotes.values()].filter((r) => !(r.jam > 0)))));
    gd.onTotem = () => this.openTotem();
    gd.net(mp.sock);
    // jabones (pickup), tanque, pistola de agua (squirt) y lo que me hacen los demás con ella (wet)
    p.tank = me.tankWorn;
    p.hasGun = !!mp.inv?.watergun; // (quien entra ya con la pistola: sin esto no podía recargarla con ella guardada)
    p.claim =(id, done) => mp.sock.emit('pickup', id, (ok: boolean) => (done(ok), ok || (this.note = { text: 'CANNOT TAKE THAT (ALREADY HAVE IT OR TOO FAR)', until: performance.now() + 2000 })));
    // lo recogido (latas w, linternas f, tanque k, pistola p) pasa a mi inventario local; los jabones no cuentan
    p.onTake = (id) => {
      const kind = id[0] === 'd' ? (this.dropKind.get(id) as ItemId | undefined) : ({ w: 'water', f: 'flashlight', c: 'camera', k: 'tank', p: 'watergun' } as const)[id[0] as 'w'];
      if (!kind || (kind as string) === 'loot') return; // (el botín lo lleva el servidor: llega con `bag`)
      me.receive(kind);
      mp.inv = me.inventory;
      p.tank = me.tankWorn;
      p.hasGun = !!mp.inv.watergun;
    };
    p.onSquirt = (x, z, yaw) => mp.sock.volatile.emit('squirt', { x, z, yaw });
    const onWet = (m: { kind: 'wet' | 'stun'; ms: number }) => p.hit(m.kind, m.ms);
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
  /**
   * La barra rápida en las Poolrooms: la del jugador, salvo la pistola de agua, que aquí la lleva PoolLevel (`gunOn`). Su ranura es la que tenga en la barra,
   * como cualquier otro objeto; con ella fuera no hay nada más en la mano, y al sacar otra cosa (o elegir una ranura vacía) se guarda. `toggle`: usar la ranura
   * (tecla, X, clic) guarda lo que ya está fuera; la rueda solo saca.
   */
  poolHot(i: number, toggle = true) {
    const p = this.pool, me = this.player;
    if (!(p instanceof PoolLevel) || !me || i >= perks.stats.hot) return; // (solo las ranuras que dan las mejoras)
    me.hotSel = i;
    if (me.hot[i] === 'watergun' && this.mp?.inv?.watergun) {
      p.gunOn = toggle ? !p.gunOn : true;
      if (p.gunOn) me.empty();
      if (toggle) this.audio?.click();
    } else (p.gunOn = false), toggle ? me.useHot(i) : me.pickHot(i);
  }
  /** Ponerse (o guardar en la mochila) la bombona de buceo. */
  setTank(on: boolean) {
    if (!this.player) return;
    this.player.tankOn = on;
    this.poolInv();
  }
  /** ¿Se está jugando dentro de las Poolrooms con compañeros? (la barra rápida lo usa) */
  get inPool() {
    return this.pool instanceof PoolLevel;
  }

  /** Cada fotograma de una ronda en las Poolrooms: los demás, mi estado a 15 Hz y la salida (con la misión cumplida, al acercarse se sube). */
  private poolMatch(p: PoolLevel, dt: number, c: Controls): Controls {
    this.t += dt;
    const me = this.player, st = p.state;
    if (!p.dead && !this.winning) {
      if (c.slot >= 0) this.poolHot(c.slot);
      else if (c.use) this.poolHot(me?.hotSel ?? 0);
      const slots = perks.stats.hot;
      if (c.wheel && me && slots) this.poolHot((Math.min(me.hotSel, slots - 1) + Math.sign(c.wheel) + slots) % slots, false);
      if (c.drop) this.dropSelected();
    }
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
    if (this.cheats.ammo) p.squirtLeft = 1;
    if ((p.jetting || p.refilling) && this.sqSnd <= 0) (this.sqSnd = p.jetting ? 0.12 : 0.4), p.jetting ? this.audio?.squirt() : this.audio?.refill();
    for (const r of this.remotes.values()) r.update(dt);
    this.poolSend += dt;
    if (this.poolSend >= 1 / 15) (this.poolSend = 0), this.poolState(p);
    const dExit = p.dead ? Infinity : Math.hypot(st.x - p.exit.x, st.z - p.exit.z), near = dExit < 2.2 && st.y < 1;
    if (this.mission?.done && dExit < 4) p.cab.open(); // la misión está hecha: se abre al acercarse
    if (this.mission?.done && dExit < 0.45 && st.y < 1 && !this.winning) {
      this.winning = true;
      p.hold = true;
      p.cab.board();
      this.mp?.sock.emit('ascend', this.player?.inventory ?? this.mp.inv ?? START_INV); // lo que lleva el Player de verdad (mp.inv solo se refresca al recoger)
      this.note = { text: 'GOING UP', until: performance.now() + 3000 };
      setTimeout(() => this.onWin?.(), RIDE * 1000 + 2600);
    } else if (!this.mission?.done && near && performance.now() > this.note.until) this.note = { text: 'THE DOOR IS SEALED · FINISH THE MISSION', until: performance.now() + 2500 };
    if (this.winning) {
      if (p.cab.rideT > RIDE) this.black = Math.min(1, this.black + dt / 1.5);
      this.vhs.enabled = true;
      this.vhs.uniforms.uBlack.value = this.black;
    }
    return c;
  }

  /** Mi estado para la sala (15 Hz y, con la pestaña oculta, el latido de wire). */
  private poolState(p: PoolLevel) {
    if (!this.mp || this.spectating) return;
    const st = p.state;
    this.mp.sock.volatile.emit('state', { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch, anim: 'Neutral Idle', dance: this.player?.dancing || undefined, variant: this.player?.variant || undefined, light: !!this.player?.lightOn, duck: !!this.player?.duck, tank: !!this.player?.tankWorn, held: 'none', jam: Math.round(p.jam), t: performance.now() });
  }

  /** El servidor me mata (admin, tótem...): sin mandos, la cámara cae y, pasado un rato, a mirar a los compañeros. */
  private deathAt?: { x: number; y: number; z: number; yaw: number };
  private poolDied(p: PoolLevel) {
    this.deathAt = { x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.yaw };
    p.dead = true;
    p.gunOn = false;
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

  /** Efecto que manda el servidor a este jugador. */
  adminFx(fx: AdminFx) {
    const p = this.player, pl = this.pool instanceof PoolLevel ? this.pool : undefined;
    if (fx.k === 'ammo') return void (this.cheats.ammo = fx.on); // (el servidor lo ordena a este cliente: también si está muerto)
    if (!p || p.dead) return;
    if (fx.k === 'tp') pl ? pl.teleport(fx.x, fx.z, fx.yaw, fx.y) : p.spawn(new THREE.Vector3(fx.x, 0, fx.z), fx.yaw);
    else if (fx.k === 'give') (p.receive(fx.item), this.poolInv());
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
  adminCheat(op: 'stamina' | 'sanity' | 'bright' | 'ammo', v: boolean): void;
  adminCheat(op: 'speed' | 'jump' | 'slow' | 'ammo' | 'stamina' | 'sanity' | 'bright', v: number | boolean) {
    if (!this.adminOk) return;
    if (op === 'bright') {
      this.cheats.bright = !!v;
      if (v && !this.brightLight) (this.brightLight = new THREE.HemisphereLight(0xffffff, 0x9aa090, 1.6)), this.scene.add(this.brightLight);
    } else (this.cheats as Record<string, number | boolean>)[op] = v;
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
    const txt = `seed ${seed}  level ${this.mp?.level ?? (pl ? 'poolrooms' : 'level0')}
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

  /** Dónde y con qué se renderiza, para acompañar a los errores de render (errlog.ts): nivel, semilla, posición, GPU, pasadas y carga de la escena. */
  adminDiag() {
    const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'), i = this.renderer.info, f = (n: number) => n.toFixed(2);
    const pl = this.pool instanceof PoolLevel ? this.pool : undefined, p = this.player;
    const s = pl ? pl.state : p ? { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw } : undefined;
    return [
      `level ${this.mp?.level ?? (pl ? 'poolrooms' : 'level0')}  seed ${pl ? pl.seed : this.seed0}${s ? `  pos ${f(s.x)} ${f(s.y)} ${f(s.z)}  yaw ${f(s.yaw)}` : ''}`,
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
      if (m && !m.done) (m.done = true), (m.progress = m.goal), this.missionDone();
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

  /** Solo: lo que enseña el panel de depuración. */
  adminInfo() {
    const m = this.mission;
    return { level: 'level0', seed: this.seed0, t: Math.round(this.t), ents: this.entities.filter((e) => e.alive).length, mission: m ? `${m.text} ${m.progress}/${m.goal}${m.done ? ' DONE' : ''}` : '-', hp: Math.round(this.player?.hp ?? 0), rtt: netStats.rtt };
  }

  /** Saca al jugador de la partida (la sala vuelve al lobby): se para todo y queda el lienzo en negro. */
  stop() {
    this.renderer.setAnimationLoop(null);
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
    this.renderer.setAnimationLoop(null);
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
    this.composer.dispose();
    this.gadgets?.dispose();

    this.player?.dispose();
    this.world?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
