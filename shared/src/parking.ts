import type { SkinAgent } from './parking-skinwalker-ai';
import type { Smiler } from './parking-smiler-ai';
/** Parking por semilla: plantas desplazadas, reservas arquitectónicas y navegación en metros. */
export const PARKING_HEIGHT = 4.2;
export const PARKING_SLAB = .65;
export const PARKING_CELL = 3;
export type ParkingMission = 'tapes' | 'generators' | 'survive';
export type ParkingMinutes = 5 | 10 | 15;
export interface ParkingOptions { mission: ParkingMission; minutes?: ParkingMinutes }
export interface ParkingPoint { x: number; y: number; z: number; floor: number }
export interface ParkingRect { x: number; z: number; w: number; d: number }
export interface ParkingWall extends ParkingRect { window?: boolean; hidden?: boolean }
export interface ParkingRoom extends ParkingRect {
  id: string; kind: 'break' | 'maintenance'; lockers?: { id: string; x: number; z: number; yaw: number }[]; door: { x: number; z: number; inward: 1 | -1 };
}
export interface ParkingLink extends ParkingRect { id: string; kind: 'ramp' | 'stairs'; top: number; bottom: number }
export interface ParkingBay extends ParkingRect { id: string; cx: number; cz: number; yaw: number }
export interface ParkingCar { x: number; z: number; yaw: number; bayId: string }
export interface ParkingProp extends ParkingRect { kind: 'cone' | 'barrier' | 'trash'; yaw: number }
export interface ParkingFixture { x: number; z: number; stable: boolean }
export interface ParkingService extends ParkingRect { kind: 'pipe' | 'duct'; length: number }
export interface ParkingFloor {
  index: number; y: number; bounds: ParkingRect; rooms: ParkingRoom[]; pillars: ParkingRect[]; walls: ParkingWall[];
  furniture: ParkingRect[]; cars: ParkingCar[]; bays: ParkingBay[]; beams: ParkingRect[]; fixtures: ParkingFixture[]; services: ParkingService[]; props: ParkingProp[];
}
export interface ParkingNode extends ParkingPoint { edges: number[] }
export interface ParkingMap {
  seed: number; options: ParkingOptions; size: number; floors: ParkingFloor[]; links: ParkingLink[];
  spawn: ParkingPoint; elevator: ParkingPoint & { clearance: ParkingRect; footprint: ParkingRect; inward: 1 | -1; yaw: number };
  objectives: (ParkingPoint & { id: string })[]; nav: ParkingNode[];
}
export const parkingContains = (r: ParkingRect, x: number, z: number, margin = 0) => x >= r.x - margin && z >= r.z - margin && x <= r.x + r.w + margin && z <= r.z + r.d + margin;
export const parkingOverlap = (a: ParkingRect, b: ParkingRect, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.z < b.z + b.d + gap && a.z + a.d + gap > b.z;
const around = (x: number, z: number, w: number, d = w): ParkingRect => ({ x: x - w / 2, z: z - d / 2, w, d });
function random(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generateParking(seed: number, options: ParkingOptions): ParkingMap {
  const rnd = random(seed), int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const shuffle = <T,>(list: T[]) => { for (let i = list.length - 1; i > 0; i--) { const j = int(0, i); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const minutes = options.mission === 'survive' ? options.minutes ?? 5 : 5, tier = minutes === 15 ? 2 : minutes === 10 ? 1 : 0;
  const base = 90 + tier * 18, rolledCount = int(3 + tier * 2, 5 + tier * 2), size = base + 18;
  const count = options.mission === 'generators' ? 5 : rolledCount;
  const floors: ParkingFloor[] = Array.from({ length: count }, (_, index) => ({
    index, y: -index * PARKING_HEIGHT,
    bounds: { x: int(0, 6) * 3, z: int(0, 6) * 3, w: base - int(0, 2) * 3, d: base - int(0, 2) * 3 },
    rooms: [], pillars: [], walls: [], furniture: [], cars: [], bays: [], beams: [], fixtures: [], services: [], props: [],
  }));
  const links: ParkingLink[] = [];
  for (let f = 0; f < count - 1; f++) {
    const a = floors[f].bounds, b = floors[f + 1].bounds;
    const left = Math.max(a.x, b.x), right = Math.min(a.x + a.w, b.x + b.w), north = Math.max(a.z, b.z), south = Math.min(a.z + a.d, b.z + b.d);
    for (const kind of ['ramp', 'stairs'] as const) {
      const w = kind === 'ramp' ? 24 : 10.8, d = kind === 'ramp' ? 5 : 2.4;
      const candidates: ParkingRect[] = [];
      for (let z = north + 9; z <= south - d - 7; z += 8) for (let x = left + 9; x <= right - w - 9; x += 3) {
        const r = { x, z, w, d };
        if (!links.some(l => (l.top === f || l.bottom === f || l.top === f + 1 || l.bottom === f + 1) && parkingOverlap(l, r, 2))) candidates.push(r);
      }
      if (!candidates.length) throw new Error(`No collision-free parking ${kind} connection at floor ${f}`);
      const chosen = shuffle(candidates)[0]; links.push({ ...chosen, id: `${kind === 'ramp' ? 'r' : 's'}${f}`, kind, top: f, bottom: f + 1 });
    }
  }
  const first = floors[0].bounds;
  const spawn: ParkingPoint = { x: first.x + first.w / 2, z: first.z + first.d / 2, y: 0, floor: 0 };
  const exitFloor = int(1, count - 1), exitBounds = floors[exitFloor].bounds;
  const exits: { x: number; z: number; inward: 1 | -1 }[] = [];
  for (const inward of [1, -1] as const) for (let z = exitBounds.z + 12; z <= exitBounds.z + exitBounds.d - 12; z += 3) {
    const x = inward === 1 ? exitBounds.x + 6 : exitBounds.x + exitBounds.w - 6;
    const clear = around(x + inward * 2, z, 9);
    if (exitFloor === 0 && Math.hypot(x - spawn.x, z - spawn.z) < 18) continue;
    if (!links.some(l => (l.top === exitFloor || l.bottom === exitFloor) && parkingOverlap(l, clear, 1))) exits.push({ x, z, inward });
  }
  if (!exits.length) throw new Error('No wall recess available for parking elevator');
  const exit = exits[int(0, exits.length - 1)];
  const elevator = { ...exit, floor: exitFloor, y: floors[exitFloor].y, yaw: exit.inward * Math.PI / 2,
    clearance: around(exit.x + exit.inward * 2, exit.z, 9),
    footprint: { x: exit.inward === 1 ? exit.x - .36 : exit.x, z: exit.z - 1.275, w: .36, d: 2.55 } };
  const map: ParkingMap = { seed: seed >>> 0, options: { mission: options.mission, minutes }, size, floors, links, spawn, elevator, objectives: [], nav: [] };
  for (const floor of floors) {
    const f = floor.index, b = floor.bounds, active = links.filter(l => l.top === f || l.bottom === f);
    const reserved = (r: ParkingRect, gap = .6) => active.some(l => parkingOverlap(l, r, gap)) || (f === exitFloor && parkingOverlap(r, elevator.clearance, gap)) || (f === 0 && parkingOverlap(r, around(spawn.x, spawn.z, 6), gap));
    const candidates: ParkingRoom[] = [];
    if (options.mission !== 'survive') for (let z = b.z + 8; z < b.z + b.d - 9; z += 8) for (const right of [false, true]) {
      const x = right ? b.x + b.w - 6 : b.x, room: ParkingRoom = { id: '', x, z, w: 6, d: 6, kind: rnd() < .5 ? 'break' : 'maintenance', door: { x: right ? x : x + 6, z: z + 3, inward: right ? 1 : -1 } };
      if (!reserved(room, 1)) candidates.push(room);
    }
    const target = options.mission === 'survive' ? 0 : int(2, 7);
    floor.rooms = shuffle(candidates).slice(0, target).map((r, i) => ({ ...r, id: `room-${f}-${i}` }));
    if (options.mission !== 'survive' && floor.rooms.length < 2) throw new Error('Insufficient safe-room recesses');
    // Fachada continua: los cuartos quedan dentro del muro de servicios, no como cajas sueltas.
    for (const side of [1, -1] as const) {
      const x = side === 1 ? b.x + 6 : b.x + b.w - 6;
      const rooms = floor.rooms.filter(r => Math.abs(r.door.x - x) < .01).sort((a, c) => a.z - c.z);
      const gaps = rooms.map(r => ({ start: r.z, end: r.z + r.d }));
      if (f === exitFloor && elevator.inward === side) gaps.push({ start: elevator.z - 1.275, end: elevator.z + 1.275 });
      const facade = (start: number, end: number) => {
        for (let z = start; z < end; z += 18) floor.walls.push({ x: x - .18, z, w: .36, d: Math.min(12, end - z) });
      };
      gaps.sort((a, c) => a.start - c.start); let at = b.z;
      for (const gap of gaps) { if (gap.start > at) facade(at, gap.start); at = Math.max(at, gap.end); }
      if (at < b.z + b.d) facade(at, b.z + b.d);
    }
    for (const r of floor.rooms) {
      const t = .36, x = r.door.x;
      floor.walls.push({ x: r.x - t / 2, z: r.z - t / 2, w: 6 + t, d: t }, { x: r.x - t / 2, z: r.z + 6 - t / 2, w: 6 + t, d: t },
        { x: x - t / 2, z: r.z, w: t, d: 2.3, window: true }, { x: x - t / 2, z: r.z + 3.7, w: t, d: 2.3 });
      r.lockers = Array.from({ length: r.kind === 'maintenance' ? 4 : 3 }, (_, i) => ({ id: `${r.id}-locker-${i}`, x: r.door.x + r.door.inward * 5.4, z: r.z + .9 + i * .62, yaw: -r.door.inward * Math.PI / 2 }));
      for (const l of r.lockers) floor.furniture.push(around(l.x, l.z, .5, .5));
      floor.furniture.push(around(r.x + 3, r.z + 5.15, 1.7, .9), around(r.x + 3, r.z + 4.15, .7));
      floor.furniture.push(parkingWorkbench(r));
    }
    if (f === exitFloor) {
      const e = elevator;
      // Puerta cerrada en el plano de fachada; la cabina queda detrás del muro.
      floor.walls.push({ x: e.x - .12, z: e.z - 1.275, w: .24, d: 2.55, hidden: true });
    }
    // Islas cortas con giros, pasos anchos y circuitos alrededor de cada grupo de plazas.
    for (let x = b.x + 21; x < b.x + b.w - 18; x += 24) for (let z = b.z + 12; z < b.z + b.d - 18; z += 24) {
      const vertical = rnd() < .55, length = int(3, 6) * 3;
      const r = { x, z, w: vertical ? .36 : length, d: vertical ? length : .36 };
      if (r.x + r.w > b.x + b.w - 9 || r.z + r.d > b.z + b.d - 6 || reserved(r, 2)) continue;
      floor.walls.push(r);
      if (rnd() < .5) {
        const turn = { x, z, w: vertical ? 6 : .36, d: vertical ? .36 : 6 };
        if (!reserved(turn, 2)) floor.walls.push(turn);
      }
    }
    for (let x = b.x + 12; x < b.x + b.w - 9; x += 9) for (let z = b.z + 9; z < b.z + b.d - 6; z += 9) {
      const p = around(x, z, .75); if (!reserved(p, 1) && !floor.walls.some(w => parkingOverlap(w, p, .4))) floor.pillars.push(p);
    }
    for (let z = b.z + 9; z < b.z + b.d; z += 9) {
      let spans = [[b.x + 6, b.x + b.w - 6]];
      for (const l of active) if (z >= l.z - .6 && z <= l.z + l.d + .6) spans = spans.flatMap(([a, c]) => [[a, Math.min(c, l.x - .6)], [Math.max(a, l.x + l.w + .6), c]].filter(([start, end]) => end > start));
      for (const [a, c] of spans) floor.beams.push({ x: a, z: z - .24, w: c - a, d: .48 });
    }
    const blocked = (r: ParkingRect, gap = .4) => reserved(r, gap) || floor.walls.some(w => parkingOverlap(w, r, gap)) || floor.pillars.some(p => parkingOverlap(p, r, gap));
    for (let lane = b.z + 12; lane < b.z + b.d - 9; lane += 18) for (const side of [-1, 1]) for (let x = b.x + 12; x < b.x + b.w - 9; x += 3) {
      const z = lane + side * 5.6, r = around(x, z, 2.85, 5.2);
      if (r.z < b.z + 1 || r.z + r.d > b.z + b.d - 1 || blocked(r)) continue;
      floor.bays.push({ ...r, id: `bay-${f}-${floor.bays.length}`, cx: x, cz: z, yaw: side === 1 ? 0 : Math.PI });
    }
    const carCandidates = shuffle([...floor.bays]), carTarget = int(2, 3 + tier);
    for (const bay of carCandidates) {
      if (floor.cars.length >= carTarget) break;
      if (floor.cars.some(c => Math.hypot(c.x - bay.cx, c.z - bay.cz) < 12)) continue;
      floor.cars.push({ x: bay.cx, z: bay.cz, yaw: bay.yaw, bayId: bay.id });
    }
    const propBays = shuffle(floor.bays.filter(bay => floor.cars.every(c => Math.hypot(c.x - bay.cx, c.z - bay.cz) > 5)));
    for (const [i, kind] of (['barrier', 'cone', 'trash'] as const).entries()) {
      const bay = propBays[i]; if (!bay) continue;
      const r = around(bay.cx, bay.cz, kind === 'barrier' ? 2.05 : .62, kind === 'barrier' ? .86 : .62);
      floor.props.push({ ...r, kind, yaw: 0 }); floor.furniture.push(r);
    }
    for (let x = b.x + 12; x < b.x + b.w - 7; x += 9) for (let z = b.z + 12; z < b.z + b.d - 7; z += 9) {
      if (!blocked(around(x, z, 1.6, .5), .5) && rnd() > .12 + f * .01) floor.fixtures.push({ x, z, stable: false });
    }
    for (const r of floor.rooms) floor.fixtures.push({ x: r.x + 3, z: r.z + 3, stable: true });
    const ceilingClear = (r: ParkingRect) => !blocked(r, .7) && !floor.beams.some(w => parkingOverlap(w, r, .4)) && !floor.fixtures.some(l => parkingOverlap(around(l.x, l.z, 1.6, .6), r, .4)) && !floor.services.some(s => parkingOverlap(s, r, .5));
    for (let x = b.x + 16; x < b.x + b.w - 12; x += 18) for (let z = b.z + 14; z < b.z + b.d - 8; z += 9) {
      const pipe = around(x, z, 7.2, .6);
      if (ceilingClear(pipe)) floor.services.push({ ...pipe, kind: 'pipe', length: 7.2 });
      const duct = around(x + 5, z, .75, 5.4);
      if (ceilingClear(duct)) floor.services.push({ ...duct, kind: 'duct', length: 5.4 });
    }
  }
  // El inicio se mueve a una celda realmente libre; las plantas no comparten el mismo origen.
  const b = floors[0].bounds;
  outer: for (let distance = 0; distance < 12; distance += 3) for (const [dx, dz] of [[distance, 0], [-distance, 0], [0, distance], [0, -distance]]) {
    const p = parkingFits(map, b.x + b.w / 2 + dx, b.z + b.d / 2 + dz, 0); if (p) { Object.assign(spawn, p); break outer; }
  }
  buildNavigation(map);
  const reached = parkingReachable(map, nearestParkingNode(map, spawn));
  const free = map.nav.filter((n, i) => reached.has(i) && Math.abs(n.y - floors[n.floor].y) < .01 && n.x > floors[n.floor].bounds.x + 8 && n.x < floors[n.floor].bounds.x + floors[n.floor].bounds.w - 8 && !links.some(l => (l.top === n.floor || l.bottom === n.floor) && parkingContains(l, n.x, n.z, 1.5)) && !(n.floor === exitFloor && parkingContains(elevator.clearance, n.x, n.z)));
  const total = options.mission === 'tapes' ? 8 : options.mission === 'generators' ? count : 0;
  const grid = options.mission === 'generators' ? new Map(map.nav.map((n, i) => [`${n.floor}/${n.x}/${n.z}`, i])) : undefined;
  const ring = [[-3,-3],[0,-3],[3,-3],[3,0],[3,3],[0,3],[-3,3],[-3,0]];
  for (let i = 0; i < total; i++) {
    const floor = i % count, candidates = free.filter(n => {
      if (n.floor !== floor || !map.objectives.every(o => o.floor !== floor || Math.hypot(o.x - n.x, o.z - n.z) >= 9)) return false;
      if (options.mission !== 'generators') return true;
      const f = floors[floor], footprint = parkingGeneratorBounds(n);
      if (floor === 0 && Math.hypot(n.x - spawn.x, n.z - spawn.z) < 4) return false;
      if ([...f.walls, ...f.pillars, ...f.furniture, ...f.cars.map(c => around(c.x, c.z, 2.1, 4.7))].some(r => parkingOverlap(r, footprint, .8))) return false;
      // A connected ring leaves a detour around the occupied grid cell and four open repair approaches.
      const neighbors = ring.map(([dx,dz]) => grid?.get(`${floor}/${n.x+dx}/${n.z+dz}`));
      return neighbors.every((index, j) => index !== undefined && reached.has(index) && map.nav[index].edges.includes(neighbors[(j+1)%ring.length] ?? -1));
    });
    if (!candidates.length) throw new Error(`No reachable parking objective on floor ${floor}`);
    const p = candidates[int(0, candidates.length - 1)]; map.objectives.push({ x: p.x, y: p.y, z: p.z, floor: p.floor, id: `${options.mission === 'tapes' ? 't' : 'g'}${i}` });
    if (options.mission === 'generators') floors[floor].furniture.push(parkingGeneratorBounds(p));
  }
  if (options.mission === 'generators') {
    map.nav.length = 0;
    buildNavigation(map);
  }
  const finalReach = options.mission === 'generators' ? parkingReachable(map, nearestParkingNode(map, spawn)) : reached;
  for (const objective of map.objectives) {
    const approach = options.mission === 'generators' ? { ...objective, z: objective.z + 3 } : objective;
    if (!finalReach.has(nearestParkingNode(map, approach))) throw new Error(`Parking objective ${objective.id} approach unreachable`);
  }
  const approach = { ...elevator, x: elevator.x + elevator.inward * 2 };
  if (!parkingFits(map, approach.x, approach.z, approach.y) || !finalReach.has(nearestParkingNode(map, approach))) throw new Error('Parking elevator approach unreachable');
  return map;
}

export function parkingSurface(map: ParkingMap, x: number, z: number, feet: number): ParkingPoint | null {
  let best: ParkingPoint | null = null, distance = Infinity;
  for (const l of map.links) if (parkingContains(l, x, z)) {
    const t = Math.max(0, Math.min(1, (x - l.x) / l.w)), y = -l.top * PARKING_HEIGHT - t * PARKING_HEIGHT;
    if (Math.abs(y - feet) < .8 && Math.abs(y - feet) < distance) { best = { x, z, y, floor: t < .5 ? l.top : l.bottom }; distance = Math.abs(y - feet); }
  }
  for (const f of map.floors) {
    if (!parkingContains(f.bounds, x, z, -.45) || map.links.some(l => parkingContains(l, x, z) && (l.top === f.index || l.bottom === f.index))) continue;
    if (Math.abs(f.y - feet) < .8 && Math.abs(f.y - feet) < distance) { best = { x, z, y: f.y, floor: f.index }; distance = Math.abs(f.y - feet); }
  }
  return best;
}
export function parkingFits(map: ParkingMap, x: number, z: number, feet: number, radius = .25, doors?: Readonly<Record<string, number>>): ParkingPoint | null {
  const p = parkingSurface(map, x, z, feet); if (!p) return null;
  const f = map.floors[p.floor];
  if (doors && f.rooms.some(r => parkingDoorBlocks(r, x, z, doors[r.id] ?? 0, radius))) return null;
  if ([...f.walls, ...f.pillars, ...f.furniture].some(r => parkingContains(r, x, z, radius)) || f.cars.some(c => parkingContains(around(c.x, c.z, 2.1, 4.7), x, z, radius))) return null;
  if (map.links.some(l => (l.top === p.floor || l.bottom === p.floor) && x > l.x && x < l.x + l.w && (Math.abs(z - l.z) < radius + .14 || Math.abs(z - l.z - l.d) < radius + .14))) return null;
  for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) {
    const corner = parkingSurface(map, x + dx, z + dz, p.y); if (!corner || Math.abs(corner.y - p.y) > .4) return null;
  }
  return p;
}
/** Banco en la pared opuesta al conjunto de taquillas, también en cuartos reflejados. */
export function parkingGeneratorBounds(p: { x: number; z: number }): ParkingRect {
  return { x: p.x - 1.1, z: p.z - .75, w: 2.2, d: 1.5 };
}
export function parkingWorkbench(room: ParkingRoom): ParkingRect {
  return { x: room.door.x + room.door.inward * 1.4 - .55, z: room.z + .325, w: 1.1, d: .65 };
}
/** Sectores estables de oeste a este, compartidos por señalización y visor. */
export const parkingFloorLabel = (floor: number) => String.fromCharCode(65 + floor);
export function parkingArea(floor: ParkingFloor, x: number) {
  return Math.max(1, Math.min(3, 1 + Math.floor((x - floor.bounds.x) / floor.bounds.w * 3)));
}
/** Hoja real del cuarto; sin estado dinámico la navegación evalúa puertas transitables. */
export function parkingDoorBlocks(room: ParkingRoom, x: number, z: number, open: number, radius = .25) {
  const angle = open * room.door.inward * Math.PI / 2;
  return parkingLeafBlocks(x, z, room.door.x, room.door.z - .65, Math.sin(angle) * 1.3, Math.cos(angle) * 1.3, radius + .055);
}
export function parkingLeafBlocks(x: number, z: number, hx: number, hz: number, dx: number, dz: number, radius: number) {
  const t = Math.max(0, Math.min(1, ((x - hx) * dx + (z - hz) * dz) / Math.max(.0001, dx * dx + dz * dz)));
  return Math.hypot(x - hx - t * dx, z - hz - t * dz) < radius;
}
export function nearestParkingNode(map: ParkingMap, p: ParkingPoint) {
  let best = -1, d = Infinity;
  map.nav.forEach((n, i) => { if (n.floor !== p.floor) return; const q = (n.x - p.x) ** 2 + (n.y - p.y) ** 2 + (n.z - p.z) ** 2; if (q < d) { best = i; d = q; } }); return best;
}
export function parkingReachable(map: ParkingMap, start: number) {
  const visited = new Set<number>(); if (start < 0) return visited;
  const queue = [start]; visited.add(start);
  for (let i = 0; i < queue.length; i++) for (const e of map.nav[queue[i]].edges) if (!visited.has(e)) { visited.add(e); queue.push(e); } return visited;
}
function buildNavigation(map: ParkingMap) {
  const grid = new Map<string, number>(), add = (p: ParkingPoint) => (map.nav.push({ ...p, edges: [] }), map.nav.length - 1);
  const join = (a: number, b: number) => { if (!map.nav[a].edges.includes(b)) map.nav[a].edges.push(b); if (!map.nav[b].edges.includes(a)) map.nav[b].edges.push(a); };
  const clear = (a: ParkingPoint, b: ParkingPoint) => {
    const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / .25);
    for (let i = 0; i <= steps; i++) { const t = i / Math.max(steps, 1); if (!parkingFits(map, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, a.y + (b.y - a.y) * t, .2)) return false; } return true;
  };
  for (const f of map.floors) for (let x = f.bounds.x + 1.5; x < f.bounds.x + f.bounds.w; x += 3) for (let z = f.bounds.z + 1.5; z < f.bounds.z + f.bounds.d; z += 3) {
    if (map.links.some(l => (l.top === f.index || l.bottom === f.index) && parkingContains(l, x, z, .3))) continue;
    const p = parkingFits(map, x, z, f.y); if (p) grid.set(`${f.index}/${x}/${z}`, add(p));
  }
  for (const i of grid.values()) {
    const a = map.nav[i]; for (const [dx, dz] of [[3, 0], [0, 3]]) { const j = grid.get(`${a.floor}/${a.x + dx}/${a.z + dz}`); if (j !== undefined && clear(a, map.nav[j])) join(i, j); }
  }
  const attach = (i: number) => { const n = map.nav[i]; for (const j of grid.values()) if (map.nav[j].floor === n.floor && Math.hypot(map.nav[j].x - n.x, map.nav[j].z - n.z) < 5 && clear(n, map.nav[j])) join(i, j); };
  const e = map.elevator, approach = parkingFits(map, e.x + e.inward * 2, e.z, e.y);
  if (approach) attach(add(approach));
  for (const f of map.floors) for (const r of f.rooms) {
    const inside = add({ x: r.door.x + r.door.inward * .7, z: r.door.z, y: f.y, floor: f.index });
    const outside = add({ x: r.door.x - r.door.inward * .7, z: r.door.z, y: f.y, floor: f.index });
    if (clear(map.nav[inside], map.nav[outside])) join(inside, outside); attach(inside); attach(outside);
  }
  for (const l of map.links) {
    const start = add({ x: l.x - .6, z: l.z + l.d / 2, y: -l.top * PARKING_HEIGHT, floor: l.top }); attach(start); let previous = start;
    for (let step = 0; step <= 24; step++) { const t = step / 24, i = add({ x: l.x + t * l.w, z: l.z + l.d / 2, y: -l.top * PARKING_HEIGHT - t * PARKING_HEIGHT, floor: t < .5 ? l.top : l.bottom }); join(previous, i); previous = i; }
    const end = add({ x: l.x + l.w + .6, z: l.z + l.d / 2, y: -l.bottom * PARKING_HEIGHT, floor: l.bottom }); join(previous, end); attach(end);
  }
}

export type ParkingInteraction = { kind: 'tape' | 'repair' | 'elevator' | 'door' | 'loot'; id?: string; held?: boolean };
export interface ParkingSnapshot {
  repaired: string[];
  tapes: string[];
  survivalElapsed?: number;
  repair?: { id: string; by: string; seconds: number };
  elevatorOpenedAt: number | null;
  doors: Record<string, number>;
  looted: string[];
  skinwalkers: Pick<SkinAgent,'id'|'pos'|'yaw'|'state'|'beast'|'transform'|'attackAt'|'moving'|'fakeTask'>[];
  smilers: Smiler[];
  gaze: Record<string,number>;
}

export function parkingSpawn(map: ParkingMap, slot: number): ParkingPoint {
  if (!slot) return { ...map.spawn };
  const angle = slot * 2.3999632297;
  for (const radius of [1.25, .65]) {
    const point = parkingFits(map, map.spawn.x + Math.cos(angle) * radius, map.spawn.z + Math.sin(angle) * radius, map.spawn.y);
    if (point) return point;
  }
  return { ...map.spawn };
}
