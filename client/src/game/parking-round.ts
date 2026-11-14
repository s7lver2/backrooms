import * as THREE from 'three';
import { generateParking, parkingArea, parkingFloorLabel, parkingSpawn, SMILER_GAZE_SECONDS, type Inventory, type Look, type ParkingOptions, type ParkingPoint, type WorldSnapshot } from '@backrooms/shared';
import type { Assets } from './game';
import type { Controls } from './input';
import { EYE, Player } from './player';
import { ParkingLevel } from './parking';
import { ParkingAudio, type ParkingCue } from './parking-audio';
import { ParkingSkinwalkers } from './parking-skinwalkers';

type Request = NonNullable<ReturnType<ParkingLevel['roomInteraction']>> & { held?: boolean };

/** Habitable Zone rules and rendering, driven by BackroomsGame's input and frame loop. */
export class ParkingRound {
  readonly level: ParkingLevel;
  readonly position: ParkingPoint;
  player?: Player;
  enemies?: ParkingSkinwalkers;
  audio?: ParkingAudio;
  private disposed = false;
  private stride = 0;
  private nextAmbient = 0;
  private nextMetal = 6;
  private repairTarget?: string;
  private nextRepair = 0;
  private nextPrompt = 0;
  private encounters?: NonNullable<WorldSnapshot['parking']>;
  private lastHealth = 100;
  private listening = false;
  private spectator?: { point: ParkingPoint; yaw: number };
  prompt = '';
  gaze = 0;

  constructor(seed: number, options: ParkingOptions, slot: number, renderer: THREE.WebGLRenderer, private low: boolean) {
    const map = generateParking(seed, options);
    this.level = new ParkingLevel(map, renderer, low);
    this.position = parkingSpawn(map, slot);
  }

  async load(assets: Assets, look: Look, progress: (fraction: number) => void) {
    let loaded = 0;
    await this.level.load(() => progress(Math.min(.73, .1 + ++loaded * .035)), assets.gltf);
    if (this.disposed) return;
    progress(.8);
    const enemies = await ParkingSkinwalkers.load(this.level, look, this.position, this.low, assets.gltf.hazmat);
    if (this.disposed) enemies.dispose();
    else this.enemies = enemies;
  }

  start(assets: Assets, look: Look, inventory: Inventory, life: number, camera: THREE.PerspectiveCamera, flash: THREE.SpotLight, reduced: boolean) {
    const level = this.level;
    const player = this.player = new Player(level.terrain, assets, camera, flash, reduced);
    player.setLook(look);
    player.load(inventory);
    player.life = life;
    if (level.map.options.mission === 'survive') player.life = (level.map.options.minutes ?? 5) * 30 + 45;
    const audio = this.audio = new ParkingAudio();
    level.onSound = this.emit;
    const p = this.position;
    player.spawn(new THREE.Vector3(p.x, p.y, p.z), .45);
    return { player, audio };
  }

  private readonly emit = (cue: ParkingCue, source?: ParkingPoint) => {
    if (!this.audio || !this.listening || document.hidden) return;
    if (!source) {
      const footstep = cue === 'walk' || cue === 'sprint' || cue === 'stairs' || cue === 'ramp' || cue === 'splash';
      return this.audio.play(cue, footstep ? .68 : 1, 0, false, footstep);
    }
    const p = this.spectator?.point ?? this.position;
    if (p.floor !== source.floor) return;
    const dx = source.x - p.x, dz = source.z - p.z;
    const y = source.y + (source.y <= this.level.map.floors[source.floor].y + .1 ? .8 : 0);
    const distance = Math.hypot(dx, dz, y - p.y - EYE);
    if (distance > 24) return;
    const yaw = this.spectator?.yaw ?? this.player?.yaw ?? 0;
    const pan = THREE.MathUtils.clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(2, Math.hypot(dx, dz)), -1, 1);
    const blocked = distance > 2.4 && !this.level.lineOfSight({ ...p, y: p.y + EYE }, { ...source, y });
    const falloff = cue === 'smiler' || cue === 'chase' || cue === 'transform' ? 8 : 5;
    this.audio.play(cue, (blocked ? .45 : 1) / (1 + (distance / falloff) ** 2), pan, blocked, true);
  };

  teammateStep(position: THREE.Vector3, run: boolean) {
    const floor = this.level.fits(position.x, position.z, position.y)?.floor;
    if (floor !== undefined) this.level.audioFootstep({ x: position.x, y: position.y, z: position.z, floor }, run, true);
  }

  objectiveComplete() { this.emit('unlock'); }

  update(dt: number, c: Controls, camera: THREE.PerspectiveCamera, active: boolean, time: number, request: (action: Request) => void) {
    const player = this.player!, p = this.position, level = this.level;
    const playing = active && player.hp > 0 && !level.repair.finished;
    const prev = { ...p };
    player.update(dt, c);
    const feet = player.pos;
    const position = level.fits(feet.x, feet.z, feet.y);
    if (position) Object.assign(p, position);
    const pressed = playing && (c.bag || c.grab);
    const held = playing && c.bagHeld;
    const focus = pressed || held ? level.roomInteraction(camera, p) : undefined;
    const repair = held && focus?.kind === 'repair' ? focus.id : undefined;
    if (repair !== this.repairTarget) {
      if (this.repairTarget) request({ kind: 'repair', id: this.repairTarget, held: false });
      this.repairTarget = repair;
      this.nextRepair = 0;
    }
    if (repair && time >= this.nextRepair) {
      request({ kind: 'repair', id: repair, held: true });
      this.nextRepair = time + .12;
    }
    if (pressed && focus && focus.kind !== 'repair') request(focus);
    const distance = Math.hypot(p.x - prev.x, p.z - prev.z);
    this.stride += distance;
    const running = player.speed > 4;
    const stepLength = running ? 1.45 : 1.08;
    if (playing && this.stride >= stepLength) {
      level.audioFootstep(p, running);
      this.stride -= stepLength;
    }
    if (c.flash && playing) this.emit('flashlight');
    if (player.hp < this.lastHealth) this.emit(player.hp > 0 ? 'hurt' : 'death');
    this.lastHealth = player.hp;
    if (time >= this.nextPrompt) {
      this.prompt = player.hp && !level.repair.finished ? level.prompt(camera, p) : '';
      this.nextPrompt = time + .09;
    }
    const e = level.map.elevator;
    return playing && level.elevatorOpen && p.floor === e.floor && (p.x - e.x) * e.inward < -.85 && Math.abs(p.z - e.z) < .67;
  }

  interrupt() {
    this.listening = false;
    this.audio?.stopCues();
    this.audio?.environment(false);
  }

  sync(state: NonNullable<WorldSnapshot['parking']>, id: string) {
    this.level.syncRoom(state, id);
    this.encounters = state;
    this.enemies?.syncNetwork(state.skinwalkers);
    const smilers = this.enemies?.smilers;
    smilers?.ai.setCursedTapes(state.tapes.length);
    smilers?.ai.setRepairedGenerators(state.repaired.length);
    smilers?.ai.setSurvivalElapsed(state.survivalElapsed ?? 0);
    smilers?.syncNetwork(state.smilers);
    const gazeLimit = smilers?.ai.gazeLimitSeconds ?? SMILER_GAZE_SECONDS;
    const gazeSeconds = state.gaze[id] ?? 0;
    this.gaze = gazeSeconds >= gazeLimit ? 1 : Math.floor(gazeSeconds) / gazeLimit;
  }

  setListening(enabled: boolean) {
    if (!enabled && this.listening) this.interrupt();
    this.listening = enabled;
  }

  render(dt: number, time: number, camera: THREE.PerspectiveCamera, viewer = this.position) {
    this.spectator = viewer === this.position ? undefined : {
      point: viewer, yaw: new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y,
    };
    const level = this.level;
    level.update(time, viewer);
    this.enemies?.updateNetwork(dt, { pos: viewer, eye: camera.position, beam: null, noise: 0, alive: !!this.player?.hp });
    if (this.encounters) {
      this.audio?.encounters(this.encounters.skinwalkers, this.encounters.smilers, viewer, this.emit);
    }
    if (time < this.nextAmbient) return;
    const mix = level.audioEnvironment(viewer);
    this.audio?.environment(this.listening, mix.room, mix.lighting, mix.engine);
    this.nextAmbient = time + .075;
    if (!this.listening || mix.room || time < this.nextMetal) return;
    const nearby = level.map.floors[viewer.floor].services.filter(s => {
      const distance = Math.hypot(s.x + s.w / 2 - viewer.x, s.z + s.d / 2 - viewer.z);
      return distance > 5 && distance < 21;
    });
    const service = nearby[Math.floor(Math.random() * nearby.length)];
    if (service) this.emit(level.pressure > .35 && Math.random() < level.pressure ? 'metal' : 'pipe', {
      x: service.x + service.w / 2, z: service.z + service.d / 2, y: level.map.floors[viewer.floor].y + 2.8, floor: viewer.floor,
    });
    this.nextMetal = time + (9 + Math.random() * 12) * (1 - .6 * level.pressure);
  }

  get floorLabel() {
    const f = this.level.map.floors[this.position.floor];
    return `FLOOR ${parkingFloorLabel(f.index)} · AREA ${String(parkingArea(f, this.position.x)).padStart(2, '0')}`;
  }

  get pendingFloors() {
    return this.level.map.options.mission === 'generators' ? this.level.map.floors.filter(f => !this.level.floorPowered(f.index)).map(f => parkingFloorLabel(f.index)).join(', ') : '';
  }

  dispose() {
    this.disposed = true;
    this.enemies?.dispose();
    this.level.dispose();
  }
}
