import * as THREE from 'three';
import type { ParkingCue } from './parking-audio';
import { ParkingAtmosphere } from './parking-atmosphere';
import { parkingLampState } from './parking-lighting';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { PARKING_HEIGHT as H, PARKING_SLAB, parkingContains, parkingFits, parkingDoorBlocks, parkingLeafBlocks, parkingWorkbench, parkingArea, parkingFloorLabel, parkingGeneratorBounds, type ParkingRoom, type ParkingMap, type ParkingFloor, type ParkingPoint, type ParkingRect } from '@backrooms/shared';

type Placement = { x: number; y: number; z: number; yaw?: number; sx?: number; sy?: number; sz?: number };
type Part = { name?: string; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };
type Hinge = { id: string; kind: 'room' | 'locker'; floor: number; hinge: THREE.Object3D; sign: number; current: number; target: number; blocks: (p: ParkingPoint, open: number, radius: number) => boolean };
type ParkingLamp = Placement & { floor: number; stable: boolean; id: number };

/** Primer pase de entorno: el contrato y la colisión están en shared/parking; aquí solo se dibuja. */
export class ParkingLevel {
  readonly scene = new THREE.Scene();
  onSound?: (cue: ParkingCue, position?: ParkingPoint) => void;
  private decks: THREE.Group[] = [];
  private resources = new Set<{ dispose(): void }>();
  private lights: THREE.PointLight[] = [];
  private lightSlots: { current?: ParkingLamp; target?: ParkingLamp; gain: number }[] = [];
  private floorLamps: ParkingLamp[][] = [];
  private lampOutputs = new Float32Array();
  private illuminationTime=-Infinity;
  private illuminationOutputs=new Map<number,number>();
  private lightInfluences=new Map<string,{lamp:ParkingLamp;weight:number}[]>();
  private lightingTime = 0;
  private lightSelection = { time: -Infinity, x: Infinity, z: Infinity, floor: -1 };
  private inspectedLamp?: ParkingLamp;
  private lamps: ParkingLamp[] = [];
  private tubes: { mesh: THREE.InstancedMesh; lamps: ParkingLamp[] }[] = [];
  private dust?: THREE.Points;
  private atmosphere?: ParkingAtmosphere;
  readonly damageViews: (ParkingPoint & { nx: number; nz: number })[] = [];
  readonly performance = { focusMs: 0, updateMs: 0, candidates: 0, raycasts: 0 };
  private roomInteriors: { group: THREE.Group; room: ParkingRoom; floor: number }[] = [];
  private interactionMeshes: { mesh: THREE.Mesh; source: THREE.Mesh; bounds: THREE.Box3; floor: number; dynamic: boolean; action?: string }[] = [];
  private focusRay = new THREE.Raycaster();
  private alive = true;
  private floor = -1;
  private hinges: Hinge[] = [];
  private doorStates: Record<string, number> = {};
  private storageItems = new Map<string, { mesh: THREE.Object3D; locker: Hinge; kind: 'WATER' | 'FLASHLIGHT' }>();
  readonly inventory = { WATER: 0, FLASHLIGHT: 0 };
  private lastTime = 0;
  private notice = '';
  private noticeUntil = 0;
  private generators = new Map<string, { root: THREE.Object3D; bounds: THREE.Box3; floor: number; repaired: boolean; indicator: THREE.MeshBasicMaterial }>();
  private readonly tapes = new Map<string, THREE.Group>();
  private elevatorDoors: { mesh: THREE.Mesh; direction: number }[] = [];
  private elevatorSeam?: THREE.Mesh;
  private elevatorSignal?: THREE.MeshBasicMaterial;
  private elevatorOpening = false;
  private elevatorTravel = 0;
  private survivalTime = 0;
  private repairId = '';
  private repairStarted = -1;
  private poweredFloors = new Set<number>();
  readonly repair = { active: false, progress: 0, repaired: 0, total: 0, powered: false, finished: false };

  constructor(readonly map: ParkingMap, private renderer: THREE.WebGLRenderer, private low = false) {
    const fog = new THREE.Color(0x181e1b);
    this.scene.background = fog;
    this.scene.fog = new THREE.Fog(fog, 3, 20);
    this.scene.add(new THREE.HemisphereLight(0xd5dcd5, 0x333a35, .11));
    // El número de luces es constante: nada de una PointLight por fluorescente.
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xe0e5df, 0, 14, 2); this.scene.add(l); this.lights.push(l); this.lightSlots.push({gain:0}); }
  }

  private own<T extends { dispose(): void }>(r: T): T { this.resources.add(r); return r; }
  private material(options: THREE.MeshStandardMaterialParameters) { return this.own(new THREE.MeshStandardMaterial(options)); }

  async load(progress: (text: string) => void) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), tex = new THREE.TextureLoader();
    const names: Record<string, string> = {
      lamp: 'parking/fluorescent-kit.glb', pipe: 'parking/pipe-kit.glb', duct: 'parking/duct-detailed-kit.glb',
      car: 'parking/car.glb',
      storage: 'parking/interactive-locker.glb', pillar: 'parking/garage-pillar.glb', water: 'backrooms/water.glb', flashlight: 'backrooms/flashlight.glb', shelf: 'backrooms/shelf.glb', chest: 'parking/tool-chest.glb', table: 'backrooms/desk.glb', chair: 'parking/office-chair.glb', elevator: 'backrooms/elevator.glb',
      box: 'parking/electrical-box.glb', cone: 'parking/traffic-cone.glb', barrier: 'parking/weathered-barrier.glb', trash: 'parking/damaged-trash-can.glb', sign: 'parking/emergency-light.glb',
    };
    if (this.map.options.mission === 'generators') names.generator = 'parking/generator-repair.glb';
    const assets: Record<string, GLTF> = {};
    let completed = 0;
    const track = (asset: GLTF) => asset.scene.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      this.own(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.own(m); for (const value of Object.values(m)) if (value instanceof THREE.Texture) this.own(value);
      }
    });
    try {
      await Promise.all(Object.entries(names).map(async ([key, file]) => {
        const g = await loader.loadAsync('/models/' + file); track(g); assets[key] = g;
        progress(`LOADING MODELS ${++completed}/${Object.keys(names).length}`);
      }));
      const loadSurface = async (name: string) => {
        const [map, normalMap, roughnessMap] = await Promise.all(['diff', 'nor_gl', 'rough'].map(k => tex.loadAsync(`/models/parking/textures/${name}-${k}.webp`).then(t => this.own(t))));
        for (const t of [map, normalMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.setScalar(name === 'asphalt_02' ? 1 / 3 : 1 / 2.71); t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); }
        map.colorSpace = THREE.SRGBColorSpace;
        if (name === 'asphalt_02') return this.own(new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0, specularIntensity: 0, clearcoat: 0, normalScale: new THREE.Vector2(.55,.55) }));
        const concrete = this.own(new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, color: 0xe4e5e3, roughness: 1, metalness: 0, specularIntensity: .12, envMapIntensity: 0, normalScale: new THREE.Vector2(.4,.4) }));
        concrete.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor,.85);'); }; return concrete;
      };
      const [asphalt, wall] = await Promise.all(['asphalt_02', 'concrete_wall_008'].map(loadSurface));
      if (!this.alive) return;
      progress('ASSEMBLING PARKING DECKS');
      const ceilingMaterial = wall, paintDecal = this.decalMaterial();
      const yellow = this.material({ color: 0x9b883c, roughness: .85 });
      const paint = this.material({ color: 0x505e59, roughness: .9 });
      const glass = this.own(new THREE.MeshPhysicalMaterial({ color: 0x9aaea3, transparent: true, opacity: .18, roughness: .25, side: THREE.DoubleSide, depthWrite: false }));
      const prototype = (g: GLTF, names: string[] | null, height: number | null, axis: 'x' | 'y' | 'z' = 'y') => this.parts(g, names, height, axis);
      const fixture = prototype(assets.lamp, ['pCube17_lambert1_0', 'pCylinder27_lambert1_0', 'pCylinder30_lambert1_0', 'pCylinder31_lambert1_0'], 1.25, 'x');
      const tube = fixture.find(p => p.name === 'pCylinder30_lambert1_0');
      if (tube) tube.material = this.own(new THREE.MeshBasicMaterial({ color: 0xb4bdb4, fog: true, toneMapped: false }));
      const pipe = prototype(assets.pipe, ['Pipe_6_M_Pipes_0'], .18);
      const duct = prototype(assets.duct, ['modular_airduct_rectangular_01_double_01_modular_airduct_rectangular_01_parts01_0', 'modular_airduct_rectangular_01_double_01_modular_airduct_rectangular_01_parts02_0'], .55, 'x');
      const propParts = { cone: prototype(assets.cone, null, null), barrier: prototype(assets.barrier, null, null), trash: prototype(assets.trash, null, null) };
      const sign = prototype(assets.sign, null, null);
      const car = prototype(assets.car, null, 4.5, 'z');
      const pillar = this.concretePillar(assets.pillar, wall);
      const shelf = prototype(assets.shelf, null, 1.65), chest = prototype(assets.chest, null, .85);
      const table = prototype(assets.table, null, .8);
      const chair = prototype(assets.chair, null, .95);

      const box = prototype(assets.box, null, .65), boxBounds = new THREE.Box3();
      for (const p of box) { p.geometry.computeBoundingBox(); boxBounds.union(p.geometry.boundingBox!); }
      const elevator = prototype(assets.elevator, ['BASE_01_0', 'R_01_0', 'L_01_0'], 2.8);
      // El modelo original queda intacto en disco; las instancias solo cambian de posición.
      const generator = assets.generator ? this.parts(assets.generator, null, null) : null;
      const paper = this.labelTexture();
      const doorPaint = this.material({ color: 0x56635d, metalness: .16, roughness: .8 }), hardware = this.material({ color: 0x8a9590, metalness: .6, roughness: .45 }), gasket = this.material({ color: 0x1d2823, roughness: 1 });
      const roomFinishes = { break: this.material({ color: 0x77857b, roughness: .85 }), maintenance: this.material({ color: 0x67747b, roughness: .85 }) }, roomTrim = this.material({ color: 0x303b38, roughness: .7 });
      for (const f of this.map.floors) {
        const group = new THREE.Group(); group.name = `B${f.index + 1}`; this.scene.add(group); this.decks.push(group);
        const floorGeo = this.deckGeometry(f.index, false);
        const deck = new THREE.Mesh(floorGeo, [asphalt,wall]); deck.userData.parkingDeck = true; deck.position.y = f.y - PARKING_SLAB; group.add(deck);
        // La planta superior ya forma el techo: solo completar su huella desplazada.
        for (const bounds of this.ceilingInfill(f.index)) {
          const ceiling = new THREE.Mesh(this.deckGeometry(f.index, true, bounds), [asphalt,ceilingMaterial]);
          ceiling.position.y = f.y + H - PARKING_SLAB; group.add(ceiling);
        }
        const structures: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [];
        const details: typeof structures = [], roomPaint: typeof structures = [];
        const add = (r: ParkingRect, h: number, y = f.y) => structures.push({ x: r.x + r.w / 2, y: y + h / 2, z: r.z + r.d / 2, w: r.w, h, d: r.d });
        const b = f.bounds;
        add({ x: b.x - .15, z: b.z, w: .3, d: b.d }, H - PARKING_SLAB); add({ x: b.x + b.w - .15, z: b.z, w: .3, d: b.d }, H - PARKING_SLAB);
        add({ x: b.x, z: b.z - .15, w: b.w, d: .3 }, H - PARKING_SLAB); add({ x: b.x, z: b.z + b.d - .15, w: b.w, d: .3 }, H - PARKING_SLAB);
        this.place(group, pillar, f.pillars.map(p => ({ x: p.x + p.w / 2, y: f.y, z: p.z + p.d / 2 })));
        const plate = this.material({ color: 0x303936, metalness: .3, roughness: .72 });
        this.place(group, [{ geometry: this.own(new THREE.BoxGeometry(.64,.94,.015)), material: plate }], f.pillars.map(p => ({ x:p.x+p.w/2,y:f.y+1.7,z:p.z+p.d+.0085 })));
        for (const [i, area] of [1,2,3].entries()) this.place(group, [{ geometry: this.own(new THREE.PlaneGeometry(.6,.9)), material: this.own(new THREE.MeshPhysicalMaterial({ map: paper[f.index][i], roughness: .7, metalness: .08, specularIntensity: .15, envMapIntensity: 0, clearcoat: .08, clearcoatRoughness: .65, fog: true })) }], f.pillars.filter(p => parkingArea(f,p.x+p.w/2)===area).map(p=>({x:p.x+p.w/2,y:f.y+1.7,z:p.z+p.d+.0175})));
        const bolts: Placement[]=[]; for(const p of f.pillars)for(const dx of [-.276,.276])for(const dy of [-.416,.416])bolts.push({x:p.x+p.w/2+dx,y:f.y+1.7+dy,z:p.z+p.d+.020});
        this.place(group,[{geometry:this.own(new THREE.CylinderGeometry(.006,.006,.004,6).rotateX(Math.PI/2)),material:plate}],bolts);
        for (const beam of f.beams) structures.push({ x: beam.x + beam.w / 2, y: f.y + H - PARKING_SLAB - .2, z: beam.z + beam.d / 2, w: beam.w, h: .4, d: beam.d });
        for (const r of f.walls) {
          if (r.hidden) continue;
          if (r.window) {
            const windowWidth = Math.min(1.1, r.d - .2), start = r.z + (r.d - windowWidth) / 2;
            add({ ...r, d: start - r.z }, H - PARKING_SLAB);
            add({ ...r, z: start + windowWidth, d: r.z + r.d - start - windowWidth }, H - PARKING_SLAB);
            add({ ...r, z: start, d: windowWidth }, 1.1);
            add({ ...r, z: start, d: windowWidth }, H - PARKING_SLAB - 2.1, f.y + 2.1);
            const pane = new THREE.Mesh(this.own(new THREE.BoxGeometry(r.w, 1, windowWidth)), glass);
            pane.position.set(r.x + r.w / 2, f.y + 1.6, start + windowWidth / 2); group.add(pane);
            this.boxes(group, [{ x: r.x + r.w / 2, y: f.y + 1.1, z: start + windowWidth / 2, w: r.w + .03, h: .06, d: windowWidth }, { x: r.x + r.w / 2, y: f.y + 2.1, z: start + windowWidth / 2, w: r.w + .03, h: .06, d: windowWidth }], paint);
          } else add(r, H - PARKING_SLAB);
        }
        this.unionBoxes(group, structures, wall); this.addDamage(group, f, wall, fixture); this.boxes(group, details, yellow); this.projectBayDecals(group, deck, f, paintDecal);
        const fixtures: Placement[] = [];
        for (const light of f.fixtures) {
          fixtures.push({ x: light.x, y: f.y + H - PARKING_SLAB - .18, z: light.z });
          this.lamps.push({ x: light.x, y: f.y + H - PARKING_SLAB - .4, z: light.z, floor: f.index, stable: light.stable, id: this.lamps.length });
        }
        for (const room of f.rooms) {
          const roomsGroup = new THREE.Group(); group.add(roomsGroup);
          this.roomInteriors.push({ group: roomsGroup, room, floor: f.index });
          const x = room.x + room.w / 2, z = room.z + room.d / 2;
          roomPaint.push({ x, y: f.y + .0005, z, w: room.w - .2, h: .001, d: room.d - .2 });
          const finish = roomFinishes[room.kind], bench = parkingWorkbench(room), benchX = bench.x + bench.w / 2, benchZ = bench.z + bench.d / 2;
          const trim = roomTrim;
          const back = room.door.x + room.door.inward * 5.8;
          this.boxes(roomsGroup, [
            { x: back, y: f.y + .55, z, w: .045, h: 1.1, d: 5.6 },
            { x, y: f.y + .55, z: room.z + .2, w: 5.6, h: 1.1, d: .045 },
            { x, y: f.y + .55, z: room.z + 5.8, w: 5.6, h: 1.1, d: .045 },
          ], finish);
          this.boxes(roomsGroup, [
            { x: back, y: f.y + .07, z, w: .07, h: .14, d: 5.6 },
            { x, y: f.y + .07, z: room.z + .23, w: 5.6, h: .14, d: .07 },
            { x, y: f.y + .07, z: room.z + 5.77, w: 5.6, h: .14, d: .07 },
          ], trim);
          this.place(roomsGroup, table, [{ x: x - .4, y: f.y, z: room.z + 5.15 }, { x: x + .4, y: f.y, z: room.z + 5.15 }]);
          this.place(roomsGroup, chair, [{ x, y: f.y, z: room.z + 4.15, yaw: Math.PI }]);
          if (room.kind === 'maintenance') {
            this.place(roomsGroup, chest, [{ x: benchX, y: f.y + .75, z: benchZ }]);
            const benchSolids = [{ x: benchX, y: f.y + .72, z: benchZ, w: 1.1, h: .06, d: .65 }];
            for (const dx of [-.45, .45]) for (const dz of [-.24, .24]) benchSolids.push({ x: benchX + dx, y: f.y + .3455, z: benchZ + dz, w: .05, h: .689, d: .05 });
            this.boxes(roomsGroup, benchSolids, roomTrim);
            this.place(roomsGroup, box, [{ x: benchX, y: f.y + 1.85, z: room.z + .2245 - boxBounds.min.x, yaw: -Math.PI / 2 }]);
          } else this.place(roomsGroup, shelf, [{ x: benchX, y: f.y, z: benchZ }]);
          this.boxes(roomsGroup, [{ x: room.door.x, y: f.y + (2.3 + H - PARKING_SLAB) / 2, z: room.door.z, w: .36, h: H - PARKING_SLAB - 2.3, d: 1.4 }], wall);
          this.boxes(roomsGroup, [
            { x: room.door.x, y: f.y + 1.15, z: room.door.z - .677, w: .4, h: 2.3, d: .046 },
            { x: room.door.x, y: f.y + 1.15, z: room.door.z + .677, w: .4, h: 2.3, d: .046 },
            { x: room.door.x, y: f.y + 2.285, z: room.door.z, w: .4, h: .03, d: 1.4 },
          ], trim);
          this.boxes(roomsGroup, [
            { x: room.door.x - room.door.inward * .004, y: f.y + 1.145, z: room.door.z - .646, w: .007, h: 2.25, d: .016 },
            { x: room.door.x - room.door.inward * .004, y: f.y + 1.145, z: room.door.z + .646, w: .007, h: 2.25, d: .016 },
            { x: room.door.x - room.door.inward * .004, y: f.y + 2.264, z: room.door.z, w: .007, h: .012, d: 1.3 },
          ], gasket);
          const doorRoot = new THREE.Group(), pivot = new THREE.Group();
          doorRoot.position.set(room.door.x, f.y, room.door.z - .65); doorRoot.rotation.y = -Math.PI / 2;
          doorRoot.add(pivot); this.utilityDoor(pivot, room.door.inward, doorPaint, hardware); roomsGroup.add(doorRoot); doorRoot.userData.parkingAction = room.id; doorRoot.userData.parkingDynamic = true;
          this.hinges.push({ id: room.id, kind: 'room', floor: f.index, hinge: pivot, sign: room.door.inward, current: 0, target: 0, blocks: (p, open, radius) => parkingDoorBlocks(room, p.x, p.z, open, radius) });
          this.doorStates[room.id] = 0;
          for (const [i, locker] of (room.lockers ?? []).entries()) {
            const root = assets.storage.scene.clone(true); root.position.set(locker.x, f.y + .001, locker.z); root.rotation.y = locker.yaw;
            root.userData.parkingAction = locker.id; roomsGroup.add(root); root.updateMatrixWorld(true);
            const leaf = root.getObjectByName('LockerDoor')!; leaf.userData.parkingDynamic = true;
            const h = root.localToWorld(leaf.position.clone());
            const hinge: Hinge = { id: locker.id, kind: 'locker', floor: f.index, hinge: leaf, sign: 1, current: 0, target: 0, blocks: (p, open, radius) => {
              const angle = locker.yaw + open * Math.PI / 2;
              return parkingLeafBlocks(p.x, p.z, h.x, h.z, -.414 * Math.cos(angle), .414 * Math.sin(angle), radius + .025);
            } };
            this.hinges.push(hinge);
            const kind = i % 2 ? 'FLASHLIGHT' : 'WATER', id = `${locker.id}-item`;
            const items = this.parts(kind === 'WATER' ? assets.water : assets.flashlight, null, kind === 'WATER' ? .24 : .17, kind === 'WATER' ? 'y' : 'x');
            const item = new THREE.Group(); item.position.set(0, i % 2 ? .94 : .49, .025); root.add(item);
            this.place(item, items, [{ x: 0, y: 0, z: 0 }]); item.userData.parkingAction = id; item.userData.parkingDynamic = true;
            this.storageItems.set(id, { mesh: item, locker: hinge, kind });
          }
          this.batchRoomStatics(roomsGroup);
        }
        this.boxes(group, roomPaint, paint);
        const lampMeshes = this.place(group, fixture, fixtures);
        const these = this.lamps.filter(l => l.floor === f.index);
        lampMeshes.filter(m => m.material === tube?.material).forEach(mesh => this.tubes.push({ mesh, lamps: these }));
        this.addServices(group, f, pipe, duct);
        for (const kind of ['cone', 'barrier', 'trash'] as const) this.place(group, propParts[kind], f.props.filter(p => p.kind === kind).map(p => ({ x: p.x + p.w / 2, z: p.z + p.d / 2, y: f.y, yaw: p.yaw })));
        this.place(group, car, f.cars.map(c => { const bay = f.bays.find(b => b.id === c.bayId)!; return { x: bay.cx, z: bay.cz, yaw: bay.yaw, y: f.y }; }));
        if (generator) for (const objective of this.map.objectives.filter(o => o.floor === f.index)) {
          const root = new THREE.Group(); root.position.set(objective.x, objective.y, objective.z); root.userData.parkingAction = objective.id; group.add(root);
          this.place(root, generator, [{ x: 0, y: 0, z: 0 }]); root.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(root), indicator = this.own(new THREE.MeshBasicMaterial({ color: 0xa06a32, fog: true }));
          const lamp = new THREE.Mesh(this.own(new THREE.SphereGeometry(.035, 8, 6)), indicator); lamp.position.set(0, .9, bounds.max.z - objective.z + .025); root.add(lamp);
          this.generators.set(objective.id, { root, bounds, floor: f.index, repaired: false, indicator });
        }
      }
      this.buildElevator(elevator, wall);
      this.repair.total = this.generators.size;
      if (this.map.options.mission === 'tapes') {
        const tapes = await loader.loadAsync('/models/backrooms/vhs.glb'); track(tapes);
        if (this.alive) {
          const parts = prototype(tapes, null, .25, 'x');
          for (const objective of this.map.objectives) {
            const root = new THREE.Group();
            root.userData.parkingAction = objective.id;
            this.decks[objective.floor].add(root);
            this.place(root, parts, [objective]);
            this.tapes.set(objective.id, root);
          }
        }
      }
      if (!this.alive) return;
      for (const link of this.map.links) {
        const group = this.decks[link.top], y = -link.top * H, mid = new THREE.Vector3(link.x + link.w / 2, y - H / 2, link.z + link.d / 2);
        const clearance = 2.65;
        const prism = (bottom: number, height: number, z: number, depth: number, material: THREE.Material) => {
          const shape = new THREE.Shape([
            new THREE.Vector2(link.x, y + bottom), new THREE.Vector2(link.x + link.w, y - H + bottom),
            new THREE.Vector2(link.x + link.w, y - H + bottom + height), new THREE.Vector2(link.x, y + bottom + height),
          ]);
          const geometry = this.slabSurfaces(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0,0,z),material===asphalt);
          group.add(new THREE.Mesh(geometry,[asphalt,wall]));
        };
        prism(-PARKING_SLAB, PARKING_SLAB, link.z, link.d, asphalt);
        prism(clearance, PARKING_SLAB, link.z - .15, link.d + .3, wall);
        // Caja arquitectónica exterior: tapa la cuña del techo y protege todo el hueco.
        const top = y + H - PARKING_SLAB, bottom = y - H - PARKING_SLAB;
        const shell = [];
        for (const z of [link.z, link.z + link.d]) shell.push({ x: mid.x, y: (top + bottom) / 2, z, w: link.w, h: top - bottom, d: .3 });
        shell.push({ x: link.x, y: y - H / 2 - PARKING_SLAB, z: mid.z, w: .3, h: H, d: link.d },
          { x: link.x, y: (y + clearance + top) / 2, z: mid.z, w: .3, h: top - y - clearance, d: link.d },
          { x: link.x + link.w, y: (y - H + clearance + top) / 2, z: mid.z, w: .3, h: top - (y - H + clearance), d: link.d });
        this.unionBoxes(group, shell, wall);
        const trims = [];
        for (const [x, feet] of [[link.x, y], [link.x + link.w, y - H]]) {
          for (const z of [link.z + .16, link.z + link.d - .16]) trims.push({ x, y: feet + clearance / 2, z, w: .34, h: clearance, d: .08 });
          trims.push({ x, y: feet + clearance - .04, z: mid.z, w: .34, h: .08, d: link.d - .24 });
          this.place(group, sign, [{ x: x + (x === link.x ? -.2 : .2), y: feet + clearance + .1, z: mid.z }]);
        }
        this.boxes(group, trims, yellow);
        if (link.kind === 'stairs') {
          const steps = [];
          for (let i = 0; i < 24; i++) steps.push({ x: link.x + (i + .5) * link.w / 24, y: y - i * H / 24 - .1, z: mid.z, w: link.w / 24, h: .2, d: link.d });
          this.boxes(group, steps, wall);
        }

      }
      this.floorLamps = this.map.floors.map(f=>this.lamps.filter(l=>l.floor===f.index));
      this.lampOutputs = new Float32Array(this.lamps.length);
      this.addDust();
      this.indexInteractionMeshes();
      this.atmosphere = new ParkingAtmosphere(this.map,this.scene,this.low);
    } finally { if (!this.alive) this.releaseResources(); }
  }

  private buildElevator(parts: Part[], wall: THREE.Material) {
    const e = this.map.elevator;
    const root = new THREE.Group();
    root.position.set(e.x, e.y, e.z);
    root.rotation.y = e.yaw;
    this.decks[e.floor].add(root);

    const bounds = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      bounds.union(part.geometry.boundingBox!);
    }
    const facade = new THREE.Group();
    facade.position.z = .19 - bounds.max.z;
    facade.userData.parkingAction = 'elevator';
    root.add(facade);
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.name = part.name ?? '';
      facade.add(mesh);
      if (part.name === 'R_01_0' || part.name === 'L_01_0') {
        mesh.userData.parkingDynamic = true;
        this.elevatorDoors.push({ mesh, direction: part.name === 'R_01_0' ? -1 : 1 });
      }
    }
    const steel = this.material({ color: 0x555d58, roughness: .75, metalness: .18 });
    const trim = this.material({ color: 0x292e2c, roughness: .85 });
    const add = (name: string, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, h, d)), material);
      mesh.name = name; mesh.position.set(x, y, z); root.add(mesh);
      return mesh;
    };
    // The authored leaves leave an 8 mm seam. Treat it as part of the closed door for center-ray interaction and LOS.
    this.elevatorSeam = add('Elevator door seam', this.own(new THREE.MeshBasicMaterial({ visible: false })), 0, 1.24, .06, .024, 2.3, .014);
    this.elevatorSeam.userData.parkingAction = 'elevator';
    add('Elevator header', wall, 0, (2.8 + H - PARKING_SLAB) / 2, 0, e.footprint.d, H - PARKING_SLAB - 2.8, .36);
    for (const side of [-1, 1]) {
      add('Cabin side', steel, side * 1.07, 1.22, -1.29, .16, 2.44, 2.22);
      add('Door pocket', trim, side * 1.46, 1.22, -.17, 1.12, 2.44, .14);
      add('Door pocket cap', trim, side * 1.95, 1.22, .035, .14, 2.44, .28);
      add('Cabin bumper', trim, side * .974, .24, -1.34, .04, .1, 2.05);
    }
    add('Cabin rear', steel, 0, 1.22, -2.43, 2.3, 2.44, .14);
    add('Cabin ceiling', steel, 0, 2.48, -1.27, 2.3, .13, 2.45);
    add('Cabin floor', trim, 0, .018, -1.22, 1.99, .036, 2.29);
    add('Cabin lamp', this.own(new THREE.MeshBasicMaterial({ color: 0x8c9684 })), 0, 2.397, -1.26, .67, .035, .18);
    const panel = add('Elevator call panel', trim, 1.12, 1.4, .208, .16, .36, .07);
    panel.userData.parkingAction = 'elevator';
    this.elevatorSignal = this.own(new THREE.MeshBasicMaterial({ color: 0x8e4837 }));
    const signal = add('Elevator status light', this.elevatorSignal, 1.12, 1.46, .249, .054, .07, .014);
    signal.userData.parkingAction = 'elevator';
  }

  get tapesCollected() { return this.map.options.mission === 'tapes' ? this.map.objectives.length - this.tapes.size : 0; }
  get survivalRemaining() { return Math.max(0, (this.map.options.minutes ?? 5) * 60 - this.survivalTime); }
  get elevatorOpen() { return this.elevatorTravel === 1; }
  get elevatorUnlocked() {
    if (this.map.options.mission === 'generators') return this.repair.powered;
    if (this.map.options.mission === 'tapes') return this.tapesCollected === this.map.objectives.length;
    return this.survivalRemaining === 0;
  }
  get pressure() {
    if (this.map.options.mission === 'tapes') return this.tapesCollected / this.map.objectives.length;
    if (this.map.options.mission === 'survive') return this.survivalTime / ((this.map.options.minutes ?? 5) * 60);
    return 0;
  }
  advanceSurvival(seconds: number) {
    if (this.map.options.mission === 'survive' && !this.repair.finished)
      this.survivalTime += Math.min(seconds, this.survivalRemaining);
  }
  retrySurvival() {
    if (this.map.options.mission !== 'survive') return;
    this.survivalTime = 0;
    this.elevatorOpening = false;
    this.elevatorTravel = 0;
    if (this.elevatorSeam) this.elevatorSeam.visible = true;
    for (const door of this.elevatorDoors) door.mesh.position.x = 0;
  }
  enterElevator(previous: ParkingPoint, next: ParkingPoint) {
    const e = this.map.elevator;
    if (this.repair.finished || this.elevatorTravel < 1 || next.floor !== e.floor || previous.floor !== e.floor) return false;
    if ((previous.x - e.x) * e.inward < -.85 || (next.x - e.x) * e.inward >= -.85 || Math.abs(next.z - e.z) > .67) return false;
    this.repair.finished = true;
    this.onSound?.('escaped');
    this.notice = 'ESCAPED THROUGH THE ELEVATOR';
    this.noticeUntil = Infinity;
    return true;
  }

  tapeView(index: number) {
    const remaining = this.map.objectives.filter(o => this.tapes.has(o.id));
    const objective = remaining[index % remaining.length];
    if (!objective) return;
    const target = new THREE.Vector3(objective.x, objective.y + .06, objective.z);
    for (const [dx, dz] of [[.95, 0], [-.95, 0], [0, .95], [0, -.95]]) {
      const position = this.fits(objective.x + dx, objective.z + dz, objective.y);
      if (position?.floor === objective.floor && this.lineOfSight({ ...position, y: position.y + 1.65 }, { ...objective, y: target.y })) return { position, target };
    }
  }

  fits(x: number, z: number, feet: number, player = true) {
    const e = this.map.elevator, depth = (x - e.x) * e.inward, lateral = Math.abs(z - e.z);
    // The generated wall keeps NPC navigation closed. Only this cabin corridor overrides it for the player.
    if (Math.abs(feet - e.y) < .8 && depth < .38 && depth > -2.75 && lateral < 2.2) {
      if (player && this.elevatorTravel === 1 && depth > -2.10 && lateral < .67) return { x, z, y: e.y, floor: e.floor };
      return null;
    }
    const p = parkingFits(this.map, x, z, feet, .25, this.doorStates);
    return p && !this.hinges.some(h => h.kind === 'locker' && h.floor === p.floor && h.blocks(p, h.current, .25)) && ![...this.generators.values()].some(g => g.floor === p.floor && parkingContains({ x: g.bounds.min.x, z: g.bounds.min.z, w: g.bounds.max.x-g.bounds.min.x, d: g.bounds.max.z-g.bounds.min.z },x,z,.25)) ? p : null;
  }

  lockerView(room: ParkingRoom, leaf = false) {
    const locker = room.lockers?.[0]; if (!locker) return;
    const hinge = this.hinges.find(h => h.id === locker.id), item = this.storageItems.get(`${locker.id}-item`);
    if (leaf && hinge) return new THREE.Box3().setFromObject(hinge.hinge).getCenter(new THREE.Vector3());
    if (hinge && hinge.current > .8 && item) return new THREE.Box3().setFromObject(item.mesh).getCenter(new THREE.Vector3());
    return new THREE.Vector3(locker.x, this.map.floors[hinge?.floor ?? 0].y + 1.05, locker.z);
  }

  doorView(room: ParkingRoom) {
    const h = this.hinges.find(h => h.id === room.id), leaf = h?.hinge.getObjectByName('UtilityLeaf');
    return leaf ? new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3()) : undefined;
  }

  private indexInteractionMeshes() {
    this.scene.updateMatrixWorld(true);
    for (const [floor, deck] of this.decks.entries()) deck.traverse(object => {
      const source = object as THREE.Mesh; if (!source.isMesh) return;
      let action: string | undefined, dynamic = false, ancestor: THREE.Object3D | null = source;
      while (ancestor) { action ??= ancestor.userData.parkingAction; dynamic ||= !!ancestor.userData.parkingDynamic; ancestor = ancestor.parent; }
      const instances = source as THREE.InstancedMesh;
      for (let i = 0; i < (instances.isInstancedMesh ? instances.count : 1); i++) {
        const mesh = new THREE.Mesh(source.geometry, source.material); mesh.matrixAutoUpdate = false;
        mesh.matrixWorld.copy(source.matrixWorld);
        if (instances.isInstancedMesh) { const m = new THREE.Matrix4(); instances.getMatrixAt(i,m); mesh.matrixWorld.multiply(m); }
        source.geometry.computeBoundingBox();
        this.interactionMeshes.push({ mesh, source, bounds: source.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld), floor, dynamic, action: instances.isInstancedMesh ? source.userData.parkingActions?.[i] ?? action : action });
      }
    });
  }

  lineOfSight(a: ParkingPoint,b: ParkingPoint) {
    const origin=new THREE.Vector3(a.x,a.y,a.z),delta=new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z),length=delta.length();if(length<.05)return true;
    const ray=new THREE.Raycaster(origin,delta.multiplyScalar(1/length),.04,length-.08);
    for(const entry of this.interactionMeshes){if(!entry.source.visible)continue;if(entry.floor<Math.min(a.floor,b.floor)-1||entry.floor>Math.max(a.floor,b.floor)+1)continue;
      const mats=Array.isArray(entry.mesh.material)?entry.mesh.material:[entry.mesh.material];if(mats.every(m=>m.transparent&&m.opacity<.3))continue;
      if(entry.dynamic){entry.source.updateWorldMatrix(true,false);entry.mesh.matrixWorld.copy(entry.source.matrixWorld);entry.bounds.copy(entry.source.geometry.boundingBox!).applyMatrix4(entry.mesh.matrixWorld);}
      if(entry.bounds.distanceToPoint(origin)>length||!ray.ray.intersectsBox(entry.bounds))continue;if(ray.intersectObject(entry.mesh,false).length)return false;
    }return true;
  }
  private lampOutput(lamp: ParkingLamp) {
    if (this.map.options.mission === 'generators')
      return this.floorPowered(lamp.floor) ? parkingLampState(this.map.seed,lamp.id,true,this.lightingTime).output : lamp.stable ? .08 : 0;
    const output = parkingLampState(this.map.seed,lamp.id,lamp.stable,this.lightingTime).output;
    if (this.map.options.mission !== 'tapes' || lamp.stable || this.tapesCollected < 3) return output;
    // Short deterministic faults on a minority of circuits. The visible tubes, shafts and darkness query share the output.
    const circuit = Math.floor(lamp.id / 3);
    if ((circuit + this.map.seed) % 7 !== 0) return output;
    const phase = (this.lightingTime + (circuit * 5.71) % 23) % 23;
    if (phase < .12 || (phase > .24 && phase < .35)) return output * .1;
    return this.tapesCollected >= 6 && phase > 1 && phase < 1 + this.pressure ? 0 : output;
  }

  illumination(p:ParkingPoint) {
    const floor=this.map.floors[p.floor];if(floor.rooms.some(r=>parkingContains(r,p.x,p.z,.35)))return 1;
    if(this.map.options.mission==='generators'&&!this.floorPowered(p.floor))return 0;
    const key=`${p.floor}/${p.x.toFixed(3)}/${p.z.toFixed(3)}`;let influences=this.lightInfluences.get(key);
    if(!influences){influences=[];for(const lamp of this.floorLamps[p.floor]??[]){const distance=Math.hypot(lamp.x-p.x,lamp.z-p.z);if(distance>=11)continue;if(floor.rooms.some(r=>parkingContains(r,lamp.x,lamp.z)))continue;
      const dx=lamp.x-p.x,dz=lamp.z-p.z,blocked=floor.walls.some(w=>{if(w.hidden)return false;let near=0,far=1;for(const [origin,delta,min,max] of [[p.x,dx,w.x,w.x+w.w],[p.z,dz,w.z,w.z+w.d]]){if(Math.abs(delta)<.000001){if(origin<=min||origin>=max)return false;}else{const a=(min-origin)/delta,b=(max-origin)/delta;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}}return near<far&&far>.001&&near<.999;});
      if(!blocked)influences.push({lamp,weight:(1-distance/11)**2});}
      if(this.lightInfluences.size>20000)this.lightInfluences.clear();this.lightInfluences.set(key,influences);
    }
    if(this.illuminationTime!==this.lightingTime){this.illuminationTime=this.lightingTime;this.illuminationOutputs.clear();}
    let result=0;for(const {lamp,weight} of influences){let output=this.illuminationOutputs.get(lamp.id);if(output===undefined){output=this.lampOutput(lamp);this.illuminationOutputs.set(lamp.id,output);}result+=weight*output;}return Math.min(1,result);
  }
  routeBrightness(p: ParkingPoint) { return this.floorPowered(p.floor)&&(this.floorLamps[p.floor]??[]).some(l=>(l.x-p.x)**2+(l.z-p.z)**2<25)?1:0; }

  private focus(camera: THREE.Camera, p: ParkingPoint) {
    const started = performance.now(), ray = this.focusRay; ray.setFromCamera(new THREE.Vector2(), camera); ray.far = 2.25;
    let nearest: { distance: number; id?: string } | undefined; this.performance.candidates = 0; this.performance.raycasts = 0;
    for (const entry of this.interactionMeshes) {
      if (entry.floor !== p.floor) continue;
      let visible = true, ancestor: THREE.Object3D | null = entry.source;
      while (ancestor) { if (!ancestor.visible) { visible = false; break; } ancestor = ancestor.parent; }
      if (!visible) continue;
      if (entry.dynamic) { entry.source.updateWorldMatrix(true,false); entry.mesh.matrixWorld.copy(entry.source.matrixWorld); entry.bounds.copy(entry.source.geometry.boundingBox!).applyMatrix4(entry.mesh.matrixWorld); }
      this.performance.candidates++;
      if (entry.bounds.distanceToPoint(ray.ray.origin) > ray.far || !ray.ray.intersectsBox(entry.bounds)) continue;
      this.performance.raycasts++;
      const hit = ray.intersectObject(entry.mesh,false)[0];
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = { distance: hit.distance, id: entry.action };
    }
    this.performance.focusMs = performance.now() - started;
    const id = nearest?.id;
    if (id) {
      const generator = this.generators.get(id);
      if (generator && generator.floor === p.floor) return { id, label: generator.repaired ? `GENERATOR ACTIVE - FLOOR ${parkingFloorLabel(generator.floor)} POWER ON` : 'HOLD E - ACTIVATE GENERATOR - 8 SECONDS' };
      if (id === 'elevator') return { id, label: !this.elevatorUnlocked ? 'ELEVATOR LOCKED - COMPLETE THE OBJECTIVE' : this.elevatorOpening ? (this.elevatorTravel === 1 ? 'STEP INTO THE ELEVATOR' : 'ELEVATOR OPENING') : 'E - OPEN ELEVATOR' };
      if (this.tapes.has(id)) return { id, label: 'E - COLLECT VHS TAPE' };
      const item = this.storageItems.get(id);
      if (item && item.locker.floor === p.floor && item.locker.current > .8) return { id, label: `E · TAKE ${item.kind} · PREVIEW STORAGE` };
      const hinge = this.hinges.find(h => h.id === id && h.floor === p.floor);
      if (hinge) return { id, label: `E · ${hinge.target ? 'CLOSE' : 'OPEN'} ${hinge.kind === 'room' ? 'ROOM DOOR' : 'LOCKER'}` };
      return;
    }
  }

  prompt(camera: THREE.Camera, p: ParkingPoint) { return this.lastTime < this.noticeUntil ? this.notice : this.focus(camera, p)?.label ?? ''; }

  interact(camera: THREE.Camera, p: ParkingPoint) {
    const target = this.focus(camera, p); if (!target) return;
    if (this.generators.has(target.id)) return;
    if (target.id === 'elevator') {
      if (!this.elevatorUnlocked) this.onSound?.('blocked', this.map.elevator);
      if (this.elevatorUnlocked && !this.elevatorOpening) {
        this.elevatorOpening = true;
        this.onSound?.('elevatorMotor', this.map.elevator);
        if (this.elevatorSeam) this.elevatorSeam.visible = false;
      }
      return;
    }
    const tape = this.tapes.get(target.id);
    if (tape) {
      tape.traverse(object => { object.visible = false; });
      this.tapes.delete(target.id);
      this.onSound?.('tape', this.map.objectives.find(o => o.id === target.id));
      this.notice = `VHS TAPE COLLECTED - ${this.tapesCollected}/${this.map.objectives.length}`;
      this.noticeUntil = this.lastTime + 1.5;
      return;
    }
    const item = this.storageItems.get(target.id);
    if (item) { this.onSound?.('pickup', { ...p }); this.inventory[item.kind]++; item.mesh.visible = false; this.storageItems.delete(target.id); this.notice = `${item.kind} ADDED · PREVIEW STORAGE ONLY`; this.noticeUntil = this.lastTime + 2; return; }
    const h = this.hinges.find(h => h.id === target.id)!;
    if (h.target && Array.from({ length: 12 }, (_, i) => h.current * i / 11).some(open => h.blocks(p, open, .3))) {
      this.onSound?.('blocked', p); this.notice = 'STEP CLEAR TO CLOSE'; this.noticeUntil = this.lastTime + 1.5; return;
    }
    h.target = 1 - h.target;
    this.onSound?.(h.kind === 'room' ? 'roomDoor' : 'lockerDoor', this.hingeSoundPosition(h));
  }

  private hingeSoundPosition(h: Hinge): ParkingPoint {
    const position = h.hinge.getWorldPosition(new THREE.Vector3());
    return { x: position.x, y: this.map.floors[h.floor].y + 1.2, z: position.z, floor: h.floor };
  }

  audioFootstep(p: ParkingPoint, run: boolean) {
    const link = this.map.links.find(l => (l.top === p.floor || l.bottom === p.floor) && parkingContains(l,p.x,p.z));
    this.onSound?.(link?.kind ?? (run ? 'sprint' : 'walk'));
    if (this.atmosphere?.wetAt(p)) this.onSound?.('splash');
  }

  audioEnvironment(p: ParkingPoint) {
    const room = this.map.floors[p.floor].rooms.some(r => parkingContains(r,p.x,p.z));
    let lighting = 0, engine = 0;
    for (const slot of this.lightSlots) {
      if (!slot.current || slot.current.floor !== p.floor) continue;
      const lamp = slot.current;
      const distance = Math.hypot(lamp.x-p.x,lamp.z-p.z);
      lighting = Math.max(lighting,(this.lampOutputs[lamp.id] ?? 0) * slot.gain / (1 + (distance/6)**2));
    }
    if (!room) for (const g of this.generators.values()) {
      if (!g.repaired || g.floor !== p.floor) continue;
      const distance = Math.hypot(g.root.position.x-p.x,g.root.position.z-p.z);
      engine = Math.max(engine, 1 / (1 + (distance/3)**2));
    }
    return { room, lighting, engine };
  }

  generatorView(index: number) {
    const list=[...this.generators.entries()],entry=list[index%list.length];if(!entry)return;
    const [id,g]=entry,c=g.bounds.getCenter(new THREE.Vector3()),target=new THREE.Vector3(c.x,g.bounds.min.y+.85,c.z);
    for(const [x,z] of [[c.x,g.bounds.max.z+1.1],[c.x,g.bounds.min.z-1.1],[g.bounds.max.x+1.1,c.z],[g.bounds.min.x-1.1,c.z]]) {
      const p=this.fits(x,z,this.map.floors[g.floor].y);if(p?.floor===g.floor)return {id,position:p,target};
    }
  }
  floorPowered(floor: number) { return this.map.options.mission!=='generators'||this.poweredFloors.has(floor); }

  holdRepair(camera: THREE.Camera, p: ParkingPoint, now: number, held: boolean) {
    const focus=held?this.focus(camera,p):undefined,generator=focus?this.generators.get(focus.id):undefined;
    if(!focus||!generator||generator.repaired) { this.repairId='';this.repairStarted=-1;this.repair.progress=0;this.repair.active=false;return; }
    const starting = this.repairId !== focus.id;
    if (starting) {
      this.repairId = focus.id;
      this.repairStarted = now;
    }
    const previousProgress = this.repair.progress;
    this.repair.active=true;this.repair.progress=THREE.MathUtils.clamp((now-this.repairStarted)/8,0,1);
    const playToolClick = starting || Math.floor(this.repair.progress * 6) > Math.floor(previousProgress * 6);
    if (this.repair.progress < 1) {
      if (playToolClick) this.onSound?.('repairTool', { x: generator.root.position.x, y: p.y+.65, z: generator.root.position.z, floor: p.floor });
      return;
    }
    this.onSound?.('generatorStart', { x: generator.root.position.x, y: p.y+.65, z: generator.root.position.z, floor: p.floor });
    generator.repaired=true;generator.indicator.color.setHex(0x75946e);this.poweredFloors.add(generator.floor);
    this.repair.repaired++;this.repair.active=false;this.repair.powered=this.repair.total>0&&this.repair.repaired===this.repair.total;
    this.notice=`GENERATOR ACTIVATED · FLOOR ${parkingFloorLabel(generator.floor)} POWER RESTORED`;this.noticeUntil=this.lastTime+3;
  }

  private addServices(parent: THREE.Object3D, floor: ParkingFloor, pipe: Part[], duct: Part[]) {
    const bounds = (parts: Part[]) => {
      const box = new THREE.Box3();
      for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
      return box.getSize(new THREE.Vector3());
    };
    const pipeSize = bounds(pipe), ductSize = bounds(duct);
    const metal = this.material({ color: 0x697170, metalness: .75, roughness: .6 });
    const pipeMaterial = Array.isArray(pipe[0].material) ? pipe[0].material[0] : pipe[0].material;
    const ductMaterial = Array.isArray(duct[0].material) ? duct[0].material[0] : duct[0].material;
    const ceiling = floor.y + H - PARKING_SLAB;
    const pipes: Placement[] = [], ducts: Placement[] = [], pipeGeometry: THREE.BufferGeometry[] = [];
    const supports: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [], backing: typeof supports = [];
    const cylinder = (radius: number, a: THREE.Vector3, b: THREE.Vector3) => {
      const delta = b.clone().sub(a), mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 12));
      mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); mesh.updateMatrix(); pipeGeometry.push(mesh.geometry.applyMatrix4(mesh.matrix));
    };
    for (const service of floor.services) {
      if (service.kind === 'pipe') {
        const start = service.x + .3, end = service.x + service.w - .3, z = service.z + service.d / 2;
        const bottom = ceiling - .65, center = bottom + pipeSize.y / 2;
        const count = Math.ceil((end - start) / pipeSize.x), step = (end - start) / count;
        pipes.push(...Array.from({ length: count }, (_, i) => ({ x: start + (i + .5) * step, y: bottom, z, sx: step / pipeSize.x })));
        // Núcleo continuo bajo las juntas; codos ascendentes terminan en anclajes del techo.
        cylinder(.077, new THREE.Vector3(start, center, z), new THREE.Vector3(end, center, z));
        for (const [x, direction] of [[start, -1], [end, 1]]) {
          const elbow = new THREE.Mesh(new THREE.TorusGeometry(.18, .09, 8, 12, Math.PI / 2));
          elbow.position.set(x, center + .18, z); elbow.rotation.z = direction === -1 ? Math.PI : -Math.PI / 2; elbow.updateMatrix(); pipeGeometry.push(elbow.geometry.applyMatrix4(elbow.matrix));
          cylinder(.09, new THREE.Vector3(x + direction * .18, center + .18, z), new THREE.Vector3(x + direction * .18, ceiling, z));
          supports.push({ x: x + direction * .18, y: ceiling - .025, z, w: .23, h: .05, d: .23 });
        }
        for (let x = start + .5; x < end; x += 2) {
          supports.push({ x, y: bottom - .025, z, w: .08, h: .05, d: .4 });
          for (const side of [-1, 1]) supports.push({ x, y: (bottom + ceiling) / 2, z: z + side * .16, w: .025, h: ceiling - bottom, d: .025 });
        }
      } else {
        const x = service.x + service.w / 2, bottom = ceiling - .7;
        const count = Math.ceil(service.d / ductSize.z), step = service.d / count;
        ducts.push(...Array.from({ length: count }, (_, i) => ({ x, y: bottom, z: service.z + (i + .5) * step, sz: step / ductSize.z })));
        // El cuerpo interior cierra cualquier panel de inspección y las tapas cierran ambos extremos.
        backing.push({ x, y: bottom + ductSize.y / 2, z: service.z + service.d / 2, w: ductSize.x - .06, h: ductSize.y - .06, d: service.d - .04 });
        for (const z of [service.z + .015, service.z + service.d - .015]) supports.push({ x, y: bottom + ductSize.y / 2, z, w: ductSize.x - .04, h: ductSize.y - .04, d: .03 });
        for (let z = service.z + .3; z < service.z + service.d - .1; z += 1.5) {
          supports.push({ x, y: bottom - .04, z, w: .68, h: .05, d: .06 });
          for (const side of [-1, 1]) supports.push({ x: x + side * .31, y: (bottom + ceiling) / 2, z, w: .025, h: ceiling - bottom, d: .025 });
        }
      }
    }
    this.place(parent, pipe, pipes); this.place(parent, duct, ducts);
    this.boxes(parent, supports, metal); this.boxes(parent, backing, ductMaterial);
    if (pipeGeometry.length) {
      const merged = this.own(mergeGeometries(pipeGeometry)!); pipeGeometry.forEach(g => g.dispose());
      parent.add(new THREE.Mesh(merged, pipeMaterial));
    }
  }

  private hash(n: number) { const h = Math.sin(n * 12.9898 + this.map.seed * .01) * 43758.5453; return h - Math.floor(h); }
  private blockedDecor(f: ParkingFloor, r: ParkingRect) {
    return this.map.links.some(l => (l.top === f.index || l.bottom === f.index) && l.x < r.x + r.w + .4 && l.x + l.w + .4 > r.x && l.z < r.z + r.d + .4 && l.z + l.d + .4 > r.z) || f.rooms.some(room => parkingContains(room, r.x + r.w / 2, r.z + r.d / 2, 1)) || (f.index === this.map.elevator.floor && parkingContains(this.map.elevator.clearance, r.x + r.w / 2, r.z + r.d / 2));
  }

  private ceilingInfill(floor: number): ParkingRect[] {
    const b = this.map.floors[floor].bounds;
    if (floor === 0) return [b];
    const above = this.map.floors[floor - 1].bounds;
    const left = Math.max(b.x, above.x), right = Math.min(b.x + b.w, above.x + above.w);
    const north = Math.max(b.z, above.z), south = Math.min(b.z + b.d, above.z + above.d);
    if (left >= right || north >= south) return [b];
    return [
      { x: b.x, z: b.z, w: b.w, d: north - b.z },
      { x: b.x, z: south, w: b.w, d: b.z + b.d - south },
      { x: b.x, z: north, w: left - b.x, d: south - north },
      { x: right, z: north, w: b.x + b.w - right, d: south - north },
    ].filter(r => r.w > .001 && r.d > .001);
  }

  private deckGeometry(floor: number, ceiling: boolean, bounds?: ParkingRect) {
    const b = bounds ?? this.map.floors[floor].bounds;
    const shape = new THREE.Shape([new THREE.Vector2(b.x, -b.z), new THREE.Vector2(b.x + b.w, -b.z), new THREE.Vector2(b.x + b.w, -b.z - b.d), new THREE.Vector2(b.x, -b.z - b.d)]);
    for (const l of this.map.links.filter(l => (ceiling ? l.bottom === floor : l.top === floor) && l.x >= b.x && l.z >= b.z && l.x + l.w <= b.x + b.w && l.z + l.d <= b.z + b.d)) {
      // Contorno horario, huecos antihorarios: normales hacia el interior del hueco.
      shape.holes.push(new THREE.Path([new THREE.Vector2(l.x, -l.z), new THREE.Vector2(l.x, -l.z - l.d), new THREE.Vector2(l.x + l.w, -l.z - l.d), new THREE.Vector2(l.x + l.w, -l.z)]));
    }
    const y = this.map.floors[floor].y + (ceiling ? H : 0) - PARKING_SLAB;
    return this.slabSurfaces(new THREE.ExtrudeGeometry(shape,{depth:PARKING_SLAB,bevelEnabled:false}).rotateX(-Math.PI/2),!ceiling,y);
  }

  private slabSurfaces(source: THREE.BufferGeometry, drivable: boolean, yOffset = 0) {
    const geometry = source.index ? source.toNonIndexed() : source, p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    const vertices: number[][]=[[],[]], normals: number[][]=[[],[]], uvs: number[][]=[[],[]];
    for(let i=0;i<p.count;i+=3){const side=drivable&&n.getY(i)>.5?0:1;
      for(let j=i;j<i+3;j++){const x=p.getX(j),y=p.getY(j),z=p.getZ(j);vertices[side].push(x,y,z);normals[side].push(n.getX(j),n.getY(j),n.getZ(j));uvs[side].push(Math.abs(n.getY(j))>.5?x:Math.abs(n.getX(j))>Math.abs(n.getZ(j))?z:x,Math.abs(n.getY(j))>.5?-z:y+yOffset);}
    }
    const result=this.own(new THREE.BufferGeometry());result.setAttribute('position',new THREE.Float32BufferAttribute([...vertices[0],...vertices[1]],3));result.setAttribute('normal',new THREE.Float32BufferAttribute([...normals[0],...normals[1]],3));result.setAttribute('uv',new THREE.Float32BufferAttribute([...uvs[0],...uvs[1]],2));
    if(vertices[0].length)result.addGroup(0,vertices[0].length/3,0);if(vertices[1].length)result.addGroup(vertices[0].length/3,vertices[1].length/3,1);
    if(geometry!==source)geometry.dispose();source.dispose();return result;
  }

  private utilityDoor(parent: THREE.Object3D, inward: number, paint: THREE.Material, hardware: THREE.Material) {
    const sheet = new THREE.Group(); sheet.position.z = inward * .03; parent.add(sheet);
    const shape = new THREE.Shape([new THREE.Vector2(.004, .009), new THREE.Vector2(1.296, .009), new THREE.Vector2(1.296, 2.262), new THREE.Vector2(.004, 2.262)]);
    const geometry = this.own(new THREE.ExtrudeGeometry(shape, { depth: .037, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 1, steps: 1 }).translate(0, 0, -.0185));
    const leaf = new THREE.Mesh(geometry, paint); leaf.name = 'UtilityLeaf'; sheet.add(leaf);
    const pieces: THREE.BufferGeometry[] = [];
    const cylinder = (radius: number, length: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z') => {
      const g = new THREE.CylinderGeometry(radius, radius, length, 12);
      if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2);
      pieces.push(g.translate(x, y, z));
    };
    for (const side of [-1, 1]) {
      cylinder(.028, .006, 1.2, 1.08, side * .026, 'z');
      cylinder(.009, .035, 1.2, 1.08, side * .045, 'z');
      cylinder(.008, .14, 1.135, 1.08, side * .062, 'x');
      pieces.push(new THREE.BoxGeometry(1.12, .3, .002).translate(.65, .22, side * .024));
    }
    const merged = this.own(mergeGeometries(pieces)!); pieces.forEach(g => g.dispose()); sheet.add(new THREE.Mesh(merged, hardware));
    const barrels = [ .23, 1.1, 2.05 ].map(y => new THREE.CylinderGeometry(.013, .013, .09, 12).translate(0, y, 0));
    // Bisagras sobre el eje fijo, no sobre el centro del panel ni el origen de decodificación.
    const hinges = this.own(mergeGeometries(barrels)!); barrels.forEach(g => g.dispose()); parent.add(new THREE.Mesh(hinges, hardware));
  }

  private concretePillar(asset: GLTF, concrete: THREE.Material): Part[] {
    // Normalizar el conjunto una sola vez conserva la altura original del tramo superior.
    const assembly = this.parts(asset, ['Object_13', 'Object_14'], null), lower = assembly.filter(p => p.name === 'Object_13'), upper = assembly.filter(p => p.name === 'Object_14');
    upper[0].geometry.computeBoundingBox(); const cut = upper[0].geometry.boundingBox!.min.y;
    const sourceTop = upper[0].geometry.boundingBox!.max.y;
    for (const part of lower) {
      const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone(), p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
      const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
      for (let i = 0; i < p.count; i += 3) {
        const vertices = [i, i + 1, i + 2].map(j => ({ p: new THREE.Vector3().fromBufferAttribute(p, j), n: new THREE.Vector3().fromBufferAttribute(n, j), uv: new THREE.Vector2(uv.getX(j), uv.getY(j)) }));
        const clipped: typeof vertices = [];
        for (let j = 0; j < vertices.length; j++) {
          const a = vertices[j], b = vertices[(j + 1) % vertices.length], inside = a.p.y <= cut, next = b.p.y <= cut;
          if (inside) clipped.push(a);
          if (inside !== next) { const t = (cut - a.p.y) / (b.p.y - a.p.y); clipped.push({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: a.uv.clone().lerp(b.uv, t) }); }
        }
        for (let j = 1; j < clipped.length - 1; j++) for (const v of [clipped[0], clipped[j], clipped[j + 1]]) { positions.push(...v.p.toArray()); normals.push(...v.n.toArray()); uvs.push(...v.uv.toArray()); }
      }
      const clipped = this.own(new THREE.BufferGeometry()); clipped.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); clipped.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); clipped.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); part.geometry = clipped; g.dispose();
    }
    for (const part of upper) {
      const p = part.geometry.getAttribute('position'), n = part.geometry.getAttribute('normal'), uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) p.setY(i, cut + (p.getY(i) - cut) * (H - PARKING_SLAB + .01 - cut) / (sourceTop - cut));
      part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere();
      for (let i = 0; i < p.count; i++) { uv[i * 2] = Math.abs(n.getX(i)) > Math.abs(n.getZ(i)) ? p.getZ(i) : p.getX(i); uv[i * 2 + 1] = p.getY(i); }
      part.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); part.geometry.deleteAttribute('tangent'); part.material = concrete;
    }
    return [...lower, ...upper];
  }

  private batchRoomStatics(parent: THREE.Object3D) {
    parent.updateMatrixWorld(true);
    const geometry = new Map<THREE.Material, THREE.BufferGeometry[]>(), bodies = new Map<string, { source: THREE.Mesh; matrices: THREE.Matrix4[]; ids: string[] }>();
    const remove: THREE.Object3D[] = [];
    const visit = (object: THREE.Object3D, action?: string) => {
      if (object.userData.parkingDynamic) return;
      action = object.userData.parkingAction ?? action;
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material)) {
        if (action) {
          const key = mesh.geometry.uuid + mesh.material.uuid;
          let batch = bodies.get(key); if (!batch) bodies.set(key, batch = { source: mesh, matrices: [], ids: [] });
          batch.matrices.push(mesh.matrixWorld.clone()); batch.ids.push(action);
        } else {
          const instanced = mesh as THREE.InstancedMesh, count = instanced.isInstancedMesh ? instanced.count : 1;
          for (let i = 0; i < count; i++) {
            const matrix = mesh.matrixWorld.clone(); if (instanced.isInstancedMesh) { const instance = new THREE.Matrix4(); instanced.getMatrixAt(i, instance); matrix.multiply(instance); }
            const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
            for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
            for (const key of ['position', 'normal', 'uv']) {
              const a = g.getAttribute(key); if (!a) { g.setAttribute(key, new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * (key === 'uv' ? 2 : 3)), key === 'uv' ? 2 : 3)); continue; }
              const values = new Float32Array(a.count * a.itemSize);
              for (let j = 0; j < a.count; j++) { values[j * a.itemSize] = a.getX(j); values[j * a.itemSize + 1] = a.getY(j); if (a.itemSize > 2) values[j * a.itemSize + 2] = a.getZ(j); }
              g.setAttribute(key, new THREE.Float32BufferAttribute(values, a.itemSize));
            }
            g.applyMatrix4(matrix); if (!geometry.has(mesh.material)) geometry.set(mesh.material, []); geometry.get(mesh.material)!.push(g);
          }
        }
        remove.push(mesh);
      }
      for (const child of object.children) visit(child, action);
    };
    visit(parent); remove.forEach(o => o.removeFromParent());
    for (const [material, pieces] of geometry) { const merged = this.own(mergeGeometries(pieces)!); pieces.forEach(g => g.dispose()); parent.add(new THREE.Mesh(merged, material)); }
    for (const batch of bodies.values()) {
      const mesh = new THREE.InstancedMesh(batch.source.geometry, batch.source.material, batch.matrices.length); batch.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.userData.parkingActions = batch.ids; mesh.computeBoundingSphere(); this.own(mesh); parent.add(mesh);
    }
  }

  private unionBoxes(parent: THREE.Object3D, boxes: { x: number; y: number; z: number; w: number; h: number; d: number }[], material: THREE.Material) {
    if (!boxes.length) return;
    const coordinates = (axis: 'x' | 'y' | 'z', size: 'w' | 'h' | 'd') => [...new Set(boxes.flatMap(b => [b[axis] - b[size] / 2, b[axis] + b[size] / 2]).map(v => Math.round(v * 1e5) / 1e5))].sort((a, b) => a - b);
    const xs = coordinates('x', 'w'), ys = coordinates('y', 'h'), zs = coordinates('z', 'd'), nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
    const index = (x: number, y: number, z: number) => (x * ny + y) * nz + z, cells = new Uint8Array(nx * ny * nz);
    const nearest = (a: number[], v: number) => a.indexOf(Math.round(v * 1e5) / 1e5);
    for (const b of boxes) for (let x = nearest(xs, b.x - b.w / 2); x < nearest(xs, b.x + b.w / 2); x++) for (let y = nearest(ys, b.y - b.h / 2); y < nearest(ys, b.y + b.h / 2); y++) for (let z = nearest(zs, b.z - b.d / 2); z < nearest(zs, b.z + b.d / 2); z++) cells[index(x, y, z)] = 1;
    const positions: number[] = [], uvs: number[] = [];
    const face = (vertices: number[][], axis: number) => { for (const i of [0, 1, 2, 0, 2, 3]) { const v = vertices[i]; positions.push(...v); uvs.push(v[axis === 0 ? 2 : 0], v[axis === 1 ? 2 : 1]); } };
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
      if (!cells[index(x, y, z)]) continue;
      const a = xs[x], b = xs[x + 1], c = ys[y], d = ys[y + 1], e = zs[z], f = zs[z + 1];
      if (x === 0 || !cells[index(x - 1, y, z)]) face([[a,c,e],[a,c,f],[a,d,f],[a,d,e]], 0);
      if (x === nx - 1 || !cells[index(x + 1, y, z)]) face([[b,c,f],[b,c,e],[b,d,e],[b,d,f]], 0);
      if (y === 0 || !cells[index(x, y - 1, z)]) face([[a,c,f],[a,c,e],[b,c,e],[b,c,f]], 1);
      if (y === ny - 1 || !cells[index(x, y + 1, z)]) face([[a,d,e],[a,d,f],[b,d,f],[b,d,e]], 1);
      if (z === 0 || !cells[index(x, y, z - 1)]) face([[b,c,e],[a,c,e],[a,d,e],[b,d,e]], 2);
      if (z === nz - 1 || !cells[index(x, y, z + 1)]) face([[a,c,f],[b,c,f],[b,d,f],[a,d,f]], 2);
    }
    const geometry = this.own(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals(); parent.add(new THREE.Mesh(geometry, material));
  }

  private boxes(parent: THREE.Object3D, boxes: { x: number; y: number; z: number; w: number; h: number; d: number }[], material: THREE.Material) {
    if (!boxes.length) return;
    // UV en metros por cara; escalar instancias estiraría el hormigón.
    const pieces = boxes.map(b => {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d), uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        uv.setXY(i, uv.getX(i) * (face < 2 ? b.d : b.w), uv.getY(i) * (face === 2 || face === 3 ? b.d : b.h));
      }
      return g.translate(b.x, b.y, b.z);
    });
    const geometry = this.own(mergeGeometries(pieces)!);
    pieces.forEach(g => g.dispose()); parent.add(new THREE.Mesh(geometry, material));
  }

  private parts(g: GLTF, names: string[] | null, size: number | null, axis: 'x' | 'y' | 'z' = 'y'): Part[] {
    g.scene.updateMatrixWorld(true);
    const selected: THREE.Mesh[] = [];
    const normalized = names?.map(n => THREE.PropertyBinding.sanitizeNodeName(n));
    g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (!normalized || normalized.includes(m.name))) selected.push(m); });
    if (!selected.length) throw new Error(`Missing model component: ${names?.join(', ')}`);
    const box = new THREE.Box3(); for (const m of selected) box.union(new THREE.Box3().setFromObject(m));
    const dimensions = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const scale = size === null ? 1 : size / Math.max(dimensions[axis], .0001);
    const normalize = new THREE.Matrix4().makeScale(scale, scale, scale).setPosition(-center.x * scale, -box.min.y * scale, -center.z * scale);
    return selected.map(m => {
      const geometry = m.geometry.clone();
      // Los atributos cuantizados no admiten escribir coordenadas mundiales sin desbordarse.
      for (const key of ['position', 'normal', 'tangent']) {
        const a = geometry.getAttribute(key); if (!a) continue;
        const values = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) {
          values[i * a.itemSize] = a.getX(i); values[i * a.itemSize + 1] = a.getY(i); values[i * a.itemSize + 2] = a.getZ(i);
          if (a.itemSize === 4) values[i * a.itemSize + 3] = a.getW(i);
        }
        geometry.setAttribute(key, new THREE.Float32BufferAttribute(values, a.itemSize));
      }
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, m.matrixWorld));
      return { name: m.name, geometry: this.own(geometry), material: m.material };
    });
  }

  private place(parent: THREE.Object3D, parts: Part[], spots: Placement[]) {
    const meshes: THREE.InstancedMesh[] = []; if (!spots.length) return meshes;
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots.length), matrix = new THREE.Matrix4(); mesh.name=part.name??'';
      spots.forEach((p, i) => mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw ?? 0), new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1))));
      mesh.computeBoundingSphere(); this.own(mesh); parent.add(mesh); meshes.push(mesh);
    }
    return meshes;
  }

  private labelTexture() {
    return this.map.floors.map(f => [1,2,3].map(area => {
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768;const ctx=canvas.getContext('2d')!;
      ctx.fillStyle='#202b27';ctx.fillRect(0,0,512,768);ctx.fillStyle='#738078';
      for(const r of [[18,18,476,2],[18,748,476,2],[18,18,2,732],[492,18,2,732]])ctx.fillRect(r[0],r[1],r[2],r[3]);
      ctx.fillStyle='#e0e1d5';ctx.textAlign='center';ctx.font='600 30px sans-serif';ctx.fillText('F L O O R',256,82);
      ctx.font='700 264px sans-serif';ctx.fillText(parkingFloorLabel(f.index),256,344);
      ctx.fillStyle='#7e8a80';ctx.fillRect(62,392,388,3);ctx.fillStyle='#d9dccf';ctx.font='600 28px sans-serif';ctx.fillText('A R E A',256,460);
      ctx.font='600 164px sans-serif';ctx.fillText(String(area).padStart(2,'0'),256,636);ctx.font='20px sans-serif';ctx.fillText('PARKING',256,706);
      const t=this.own(new THREE.CanvasTexture(canvas));t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());return t;
    }));
  }

  private decalMaterial() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 512;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff';
    // Pintura con borde irregular fino; el centro permanece continuo y las texturas conservan alfa.
    for (let y = 0; y < 512; y++) { const edge = 2 + Math.sin(y*.071)*.8; ctx.fillRect(edge,y,128-edge*2,1); }
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.12)';
    for (let i = 0; i < 80; i++) ctx.fillRect(5+(i*47)%118,(i*89)%512,1,1);
    const texture = this.own(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    return this.own(new THREE.MeshPhysicalMaterial({ map: texture, color: 0xbfc0b1, transparent: false, alphaTest: .15, alphaToCoverage: !this.low, depthTest: true, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -.1, polygonOffsetUnits: -4, roughness: .78, metalness: 0, envMapIntensity: 0, specularIntensity: .12, clearcoat: 0 }));
  }

  private projectBayDecals(parent: THREE.Object3D, deck: THREE.Mesh, floor: ParkingFloor, material: THREE.Material) {
    const rectangles = new Map<string,{ x:number; z:number; w:number; d:number }>();
    const add = (x:number,z:number,w:number,d:number) => rectangles.set(`${x.toFixed(4)}/${z.toFixed(4)}/${w}/${d}`,{x,z,w,d});
    for (const bay of floor.bays) { for (const x of [bay.cx-1.5,bay.cx+1.5]) add(x,bay.cz-Math.cos(bay.yaw)*.025,.1,bay.d-.05); add(bay.cx,bay.cz+Math.cos(bay.yaw)*bay.d/2,3,.1); }
    const coverage: ParkingRect[]=[];
    for(const r of rectangles.values()){
      let pieces: ParkingRect[]=[{x:r.x-r.w/2,z:r.z-r.d/2,w:r.w,d:r.d}];
      for(const old of coverage)pieces=pieces.flatMap(p=>{const l=Math.max(p.x,old.x),t=Math.max(p.z,old.z),right=Math.min(p.x+p.w,old.x+old.w),bottom=Math.min(p.z+p.d,old.z+old.d);if(right-l<1e-6||bottom-t<1e-6)return[p];return[{x:p.x,z:p.z,w:l-p.x,d:p.d},{x:right,z:p.z,w:p.x+p.w-right,d:p.d},{x:l,z:p.z,w:right-l,d:t-p.z},{x:l,z:bottom,w:right-l,d:p.z+p.d-bottom}].filter(v=>v.w>1e-6&&v.d>1e-6);});
      coverage.push(...pieces);
    }
    deck.updateWorldMatrix(true,false);
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
    for (const r of coverage) {
      // U siempre cruza los 10 cm del trazo; no estirar el alfa del borde a un testero de 3 m.
      const horizontal=r.w>r.d;
      const decal = new DecalGeometry(deck,new THREE.Vector3(r.x+r.w/2,floor.y+.01,r.z+r.d/2),new THREE.Euler(-Math.PI/2,0,horizontal?Math.PI/2:0),new THREE.Vector3(horizontal?r.d:r.w,horizontal?r.w:r.d,.06));
      const p = decal.getAttribute('position'), n = decal.getAttribute('normal'), uv = decal.getAttribute('uv');
      for (let i=0;i<p.count;i+=3) {
        if ([i,i+1,i+2].some(j=>n.getY(j)<.999)) continue;
        const area = Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i)));
        if (area < 1e-9) continue;
        for (const j of [i,i+1,i+2]) { positions.push(p.getX(j),p.getY(j)+.0025,p.getZ(j)); normals.push(0,1,0); uvs.push(uv.getX(j),uv.getY(j)); }
      }
      decal.dispose();
    }
    if (!positions.length) return;
    const geometry = this.own(new THREE.BufferGeometry()); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    const mesh = new THREE.Mesh(geometry,material); mesh.userData.parkingPaint = true; mesh.userData.projectedDecal = true; mesh.userData.projectors = coverage.length; mesh.userData.coverage = coverage; mesh.renderOrder = 2; parent.add(mesh);
  }

  atmosphereView(floor: number) { return this.atmosphere?.inspect(floor); }

  private addDamage(parent: THREE.Group, floor: ParkingFloor, concrete: THREE.MeshPhysicalMaterial, fixture: Part[]) {
    const surfaces = floor.walls.filter(w=>!w.hidden&&!w.window&&Math.max(w.w,w.d)>=9);
    const positions: number[]=[], normals: number[]=[], uvs: number[]=[], cracks: number[]=[], chips: Placement[]=[];
    for(const [i,w] of surfaces.entries()) {
      if(this.hash(i*97+floor.index*31)>.22)continue;
      const alongZ=w.d>w.w,cx=alongZ?w.x+w.w+.004:w.x+w.w*.45,cz=alongZ?w.z+w.d*.45:w.z+w.d+.004,y=floor.y+1.1;
      this.damageViews.push({x:cx,y,z:cz,floor:floor.index,nx:alongZ?1:0,nz:alongZ?0:1});
      const point=(a:number,b:number,depth:number)=>alongZ?[cx+depth,y+b,cz+a]:[cx+a,y+b,cz+depth];
      const ring=Array.from({length:48},(_,j)=>{const a=j*Math.PI/24,r=.34+this.hash(i*101+j)*.11;return [Math.cos(a)*r,Math.sin(a)*r*.7];});
      for(let j=0;j<48;j++)for(const v of (alongZ?[[0,0],ring[(j+1)%48],ring[j]]:[[0,0],ring[j],ring[(j+1)%48]])){const p=point(v[0],v[1],.003+this.hash(j+i)*.003);positions.push(...p);normals.push(alongZ?1:0,0,alongZ?0:1);uvs.push(v[0]+cx,v[1]+y);}
      for(let branch=0;branch<3;branch++){const angle=branch*2.1+i;let a=Math.cos(angle)*.32,b=Math.sin(angle)*.24;for(let j=0;j<3;j++){const na=a+Math.cos(angle)*.075+(this.hash(i*31+j+branch)-.5)*.035,nb=b+Math.sin(angle)*.055+(this.hash(i*47+j)-.5)*.025;cracks.push(...point(a,b,.010),...point(na,nb,.010));a=na;b=nb;}}
      for(let j=0;j<3;j++)chips.push({x:cx+(alongZ?.12+j*.06:(j-1)*.18),y:floor.y+.025,z:cz+(alongZ?(j-1)*.18:.12+j*.06),yaw:this.hash(i+j)*6.28,sx:.07+this.hash(i*11+j)*.08,sy:.025,sz:.05+this.hash(i*13+j)*.07});
      if(i%3===0)this.place(parent,fixture.map(p=>({...p,material:(p.material as THREE.MeshBasicMaterial).isMeshBasicMaterial?this.own(new THREE.MeshBasicMaterial({color:0x4d534b,fog:true})):p.material})),[{x:cx+(alongZ?.4:0),y:floor.y+.06,z:cz+(alongZ?0:.4),yaw:.35,sx:.55,sy:.55,sz:.55}]);
    }
    if(!positions.length)return;
    const g=this.own(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    const material=this.own(concrete.clone());material.color.setHex(0xe2ddd0);material.side=THREE.FrontSide;material.roughness=1;const mesh=new THREE.Mesh(g,material);mesh.userData.parkingDamage=true;parent.add(mesh);
    const lines=this.own(new THREE.BufferGeometry());lines.setAttribute('position',new THREE.Float32BufferAttribute(cracks,3));parent.add(new THREE.LineSegments(lines,this.own(new THREE.LineBasicMaterial({color:0x4f554b,transparent:true,opacity:.4,fog:true}))));
    this.place(parent,[{geometry:this.own(new THREE.DodecahedronGeometry(1,0)),material}],chips);
  }

  private addDust() {
    const count = this.low ? 100 : 420, points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { points[i * 3] = this.hash(i * 5) * 30 - 15; points[i * 3 + 1] = this.hash(i * 7) * 3.5; points[i * 3 + 2] = this.hash(i * 13) * 30 - 15; }
    const g = this.own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(points, 3));
    this.dust = new THREE.Points(g, this.own(new THREE.PointsMaterial({ color: 0xbcc9ab, size: .025, transparent: true, opacity: .18, depthWrite: false })));
    this.scene.add(this.dust);
  }

  private readonly playDrip = (p: ParkingPoint) => this.onSound?.('drip', p);

  update(time: number, p: ParkingPoint, lightingTime = time) {
    this.lightingTime = lightingTime;
    const started = performance.now();
    const dt = Math.min(.05, Math.max(0, time - this.lastTime)); this.lastTime = time;
    if (this.elevatorOpening && this.elevatorTravel < 1) {
      this.elevatorTravel = Math.min(1, this.elevatorTravel + dt / .85);
      for (const door of this.elevatorDoors) door.mesh.position.x = door.direction * .94 * THREE.MathUtils.smoothstep(this.elevatorTravel, 0, 1);
      if (this.elevatorTravel === 1) this.onSound?.('elevatorOpen', this.map.elevator);
    }
    this.elevatorSignal?.color.setHex(this.elevatorUnlocked ? 0x80a574 : 0x8e4837);
    for (const h of this.hinges) {
      if (h.current === h.target) continue;
      const next = THREE.MathUtils.clamp(h.current + Math.sign(h.target - h.current) * dt * 1.8, Math.min(h.current, h.target), Math.max(h.current, h.target));
      if (h.floor === p.floor && h.blocks(p, next, .28) && !h.blocks(p, h.current, .28)) continue;
      h.current = next; h.hinge.rotation.y = h.sign * next * Math.PI / 2;
      if (next === h.target) this.onSound?.(h.kind === 'room' ? 'roomLatch' : 'lockerLatch', this.hingeSoundPosition(h));
      if (h.kind === 'room') this.doorStates[h.id] = next;
    }
    for (const interior of this.roomInteriors) {
      const r = interior.room, dx = Math.max(r.x-p.x,0,p.x-r.x-r.w), dz = Math.max(r.z-p.z,0,p.z-r.z-r.d);
      interior.group.visible = interior.floor === p.floor && dx*dx+dz*dz < 18*18;
    }
    this.updateLighting(time,dt,p);
    const color = new THREE.Color();
    for (const batch of this.tubes) {
      if (batch.lamps[0]?.floor !== p.floor) continue;
      for (let i = 0; i < batch.lamps.length; i++) { color.setScalar(this.lampOutputs[batch.lamps[i].id]); batch.mesh.setColorAt(i, color); }
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
    if (this.floor !== p.floor) {
      this.floor = p.floor;
      // Las rampas de la planta anterior también se ven desde su llegada.
      this.decks.forEach((g, i) => g.visible = Math.abs(i - p.floor) <= 1);

    }
    if (this.dust) { this.dust.position.set(p.x, -p.floor * H, p.z); this.dust.rotation.y=time*.006; }
    if(this.atmosphere){
      this.atmosphere.onDrip = this.playDrip;
      this.atmosphere.update(time,p,this.lampOutputs);
    }
    this.performance.updateMs = performance.now() - started;
  }

  lightingView(floor: number, index: number) {
    const lamps=this.floorLamps[floor]??[],faulty=lamps.filter(l=>parkingLampState(this.map.seed,l.id,l.stable,0).faulty),steady=lamps.filter(l=>!parkingLampState(this.map.seed,l.id,l.stable,0).faulty&&!l.stable);
    this.inspectedLamp=(index%2?steady[Math.floor(index/2)%steady.length]:faulty[Math.floor(index/2)%faulty.length])??lamps[0];
    return this.inspectedLamp;
  }
  lightingStatus() {
    const l=this.inspectedLamp;if(!l)return '';
    const state=parkingLampState(this.map.seed,l.id,l.stable,this.lightingTime),slot=this.lightSlots.find(s=>s.current===l);
    return `FIXTURE ${l.id} ${state.label} ${Math.round(state.output*100)}%${state.faulty?` NEXT ${state.next.toFixed(1)} S`:''} | POOL ${slot?Math.round(slot.gain*100):0}%`;
  }
  private updateLighting(time: number, dt: number, p: ParkingPoint) {
    const lamps=this.floorLamps[p.floor]??[];
    for(const l of lamps)this.lampOutputs[l.id]=this.lampOutput(l);
    const last=this.lightSelection, floorChanged=last.floor!==p.floor;
    if(floorChanged||time-last.time>.2||Math.hypot(p.x-last.x,p.z-last.z)>1) {
      const floor=this.map.floors[p.floor], room=floor.rooms.find(r=>parkingContains(r,p.x,p.z));
      const clear=(lamp:ParkingLamp)=>{
        const owner=floor.rooms.find(r=>parkingContains(r,lamp.x,lamp.z));
        if(room?.id!==owner?.id)return false;
        const dx=lamp.x-p.x,dz=lamp.z-p.z;
        return !floor.walls.some(w=>{if(w.hidden)return false;let near=0,far=1;for(const [origin,delta,min,max] of [[p.x,dx,w.x,w.x+w.w],[p.z,dz,w.z,w.z+w.d]]){if(Math.abs(delta)<1e-6){if(origin<=min||origin>=max)return false;}else{const a=(min-origin)/delta,b=(max-origin)/delta;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}}return near<far&&far>.001&&near<.999;});
      };
      const chosen=lamps.filter(l=>Math.hypot(l.x-p.x,l.z-p.z)<18).sort((a,b)=>(a.x-p.x)**2+(a.z-p.z)**2-(b.x-p.x)**2-(b.z-p.z)**2).filter(clear).slice(0,4);
      const assigned=new Set<ParkingLamp>();
      for(const slot of this.lightSlots){if(floorChanged){slot.current=undefined;slot.target=undefined;slot.gain=0;}if(slot.current&&chosen.includes(slot.current)){slot.target=slot.current;assigned.add(slot.current);}else slot.target=undefined;}
      for(const lamp of chosen)if(!assigned.has(lamp)){const slot=this.lightSlots.find(s=>!s.target);if(slot){slot.target=lamp;assigned.add(lamp);}}
      this.lightSelection={time,x:p.x,z:p.z,floor:p.floor};
    }
    this.lightSlots.forEach((slot,i)=>{
      if(slot.current!==slot.target){slot.gain=Math.max(0,slot.gain-dt/ .18);if(slot.gain===0){slot.current=slot.target;if(slot.current)this.lights[i].position.set(slot.current.x,slot.current.y,slot.current.z);}}
      else slot.gain=Math.min(1,slot.gain+dt/ .25);
      const lamp=slot.current;this.lights[i].intensity=lamp?this.lampOutputs[lamp.id]*slot.gain*(lamp.stable?11.5:10.5):0;
      this.lights[i].color.setHex(lamp?.stable?0xe7e3d7:0xe0e5df);
    });
    if(this.dust)(this.dust.material as THREE.PointsMaterial).opacity=.12+.06*this.lightSlots.reduce((sum,s)=>sum+(s.current?this.lampOutputs[s.current.id]*s.gain:0),0)/4;
  }

  private releaseResources() { for (const r of this.resources) r.dispose(); this.resources.clear(); }
  dispose() { this.atmosphere?.dispose(); this.alive = false; this.releaseResources(); this.scene.clear(); }
}
