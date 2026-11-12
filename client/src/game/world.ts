import * as THREE from 'three';
import { ElevatorCab } from './elevator';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, ZONE, hasPanel, type Cell, type Maze, type PropKind } from './maze';
import type { Assets } from './game';
import { bakeLight, lightmapped, LM } from './lightmap';
import { buildPits, PIT_EDGE } from './pit';

/*
 * El laberinto en 3D. Paredes, suelo, techo y fluorescentes van instanciados (cuatro dibujos para
 * todo); las piezas de backrooms_vr2, también, una malla instanciada por cada malla de la pieza.
 * Las luces son siempre las mismas (las pone game.ts): aquí solo se dice dónde están las lámparas.
 */

export const HEIGHT = 2.7;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export const center = (c: Cell, y = 0) => new THREE.Vector3(c.x * CELL + CELL / 2, y, c.y * CELL + CELL / 2);

/**
 * Un glb como mallas instanciadas en `mats`: una por material, con todas sus mallas fundidas (la
 * puerta de backrooms_vr2 son 240 trozos; sin fundir, 240 dibujos por puerta).
 */
function instanced(src: THREE.Object3D, mats: THREE.Matrix4[], fix?: (m: THREE.Material) => void) {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material, g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    // vienen cuantizadas (Int16 normalizado, entre -1 y 1): a Float32 antes de moverlas, o lo que pase de 1 se recorta
    for (const [k, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
      if (a.array instanceof Float32Array && !a.normalized && !(a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
      const f = new Float32Array(a.count * a.itemSize), get = [a.getX, a.getY, a.getZ, a.getW];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = get[c].call(a, i);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
    g.applyMatrix4(mesh.matrixWorld);
    byMat.set(mat, [...(byMat.get(mat) ?? []), g.index ? g.toNonIndexed() : g]);
  });
  return [...byMat].map(([mat, gs]) => {
    fix?.(mat);
    const im = new THREE.InstancedMesh(mergeGeometries(gs) ?? gs[0], mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    return im;
  });
}

const UP = new THREE.Vector3(0, 1, 0);

// la suciedad, pintada a mano en un lienzo: regueros de agua que bajan desde el techo
function streakTex() {
  const cv = Object.assign(document.createElement('canvas'), { width: 64, height: 256 }), x = cv.getContext('2d')!;
  const top = x.createLinearGradient(0, 0, 0, 70);
  top.addColorStop(0, 'rgba(70,52,20,0.16)');
  top.addColorStop(1, 'rgba(70,52,20,0)');
  x.fillStyle = top;
  x.fillRect(0, 0, 64, 70);
  for (let i = 0; i < 7; i++) {
    const px = 6 + Math.random() * 52, len = 60 + Math.random() * 190, w = 2 + Math.random() * 5;
    const gr = x.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(70,52,20,0.14)');
    gr.addColorStop(1, 'rgba(70,52,20,0)');
    x.fillStyle = gr;
    x.fillRect(px, 0, w, len);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// el difusor de un panel fluorescente: dos tubos que se adivinan, la rejilla prismática y el borde algo más oscuro
function panelTex() {
  const cv = Object.assign(document.createElement('canvas'), { width: 128, height: 64 }), x = cv.getContext('2d')!;
  x.fillStyle = '#d9d6cc';
  x.fillRect(0, 0, 128, 64);
  for (const y of [20, 44]) {
    const g = x.createLinearGradient(0, y - 11, 0, y + 11);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, y - 11, 128, 22);
  }
  x.strokeStyle = 'rgba(120,118,104,0.35)';
  x.lineWidth = 1;
  for (let i = 8; i < 128; i += 8) (x.beginPath(), x.moveTo(i + 0.5, 0), x.lineTo(i + 0.5, 64), x.stroke());
  for (let j = 8; j < 64; j += 8) (x.beginPath(), x.moveTo(0, j + 0.5), x.lineTo(128, j + 0.5), x.stroke());
  const e = x.createLinearGradient(0, 0, 0, 64);
  e.addColorStop(0, 'rgba(60,55,40,0.5)');
  e.addColorStop(0.12, 'rgba(60,55,40,0)');
  e.addColorStop(0.88, 'rgba(60,55,40,0)');
  e.addColorStop(1, 'rgba(60,55,40,0.5)');
  x.fillStyle = e;
  x.fillRect(0, 0, 128, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const decal = (map: THREE.Texture) => lit(new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));

// los materiales, uno por juego de assets y compartidos por todos los laberintos: si cada partida
// trajera los suyos, al desechar el anterior se borrarían sus programas y habría que recompilar
const mats = new WeakMap<Assets, ReturnType<typeof makeMaterials>>();
const makeMaterials = (a: Assets) => ({
  wallMat: lit(new THREE.MeshStandardMaterial({ map: a.tex.wall, roughness: 0.92 })),
  floorMat: lit(new THREE.MeshStandardMaterial({ map: a.tex.carpet, roughness: 1, color: 0xb8a888 })),
  ceilMat: lit(new THREE.MeshStandardMaterial({ map: a.tex.ceiling, roughness: 0.95 })),
  pitMat: lit(new THREE.MeshStandardMaterial({ map: a.tex.wall, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })),
  frameMat: lit(new THREE.MeshStandardMaterial({ color: 0x8e8a7c, roughness: 0.55, metalness: 0.35 })),
  panelMat: new THREE.MeshBasicMaterial({ color: 0xffffff, map: panelTex(), fog: false }),
  metalMat: new THREE.MeshStandardMaterial({ color: 0x9c9a90, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, emissive: 0x2a2820 }),
  streak: decal(streakTex()),
  // los escondites: el marco, sucio y oscuro, y el polvo del suelo del nicho
  hideMat: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 })),
  dustMat: lit(new THREE.MeshStandardMaterial({ color: 0x1b170f, roughness: 1, transparent: true, opacity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })),
});
/** La altura de la boca de un nicho: se entra agachado (encima, un dintel de pared). */
export const HIDE_H = 1.25;
const lit = <M extends THREE.Material>(m: M) => (lightmapped(m), m);
const materials = (a: Assets) => mats.get(a) ?? (mats.set(a, makeMaterials(a)), mats.get(a)!);
const yaw = (dx: number, dz: number) => Math.atan2(-dz, dx); // gira +x local hacia (dx, dz)
const place = (p: THREE.Vector3, ry: number, s = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(s, s, s));

export class World {
  readonly root = new THREE.Group();
  readonly elevator: THREE.Object3D;
  /** El lado abierto del ascensor (hacia donde mira). */
  readonly elevatorFront: THREE.Vector3;
  /** La cabina del ascensor por dentro. */
  readonly cab: ElevatorCab;
  /** Con las puertas cerradas, la cabina es pared. */
  elevatorOpen = false;
  private lampPos: THREE.Vector3[];
  private lamps: THREE.InstancedMesh;
  private flicker: { i: number; phase: number; lamp: number; g: number }[] = [];
  private panelOn: boolean[] = [];
  private lampLevel: Float32Array;
  /** Lo que no se atraviesa: círculos en el suelo (sillones, archivadores, estantes y mesas). */
  private blockers: { x: number; z: number; r: number }[] = [];
  private voidSet: Set<number>;
  /** La corriente: 1 normal, 0 en un apagón (la lleva game.ts). */
  power = 1;
  private shownPower = -1;
  private pitGeos: THREE.BufferGeometry[] = [];

  constructor(readonly maze: Maze, assets: Assets) {
    const { w, h, open } = maze;
    const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !!open[y * w + x];
    const voids = new Set(maze.voids.map((v) => v.y * w + v.x));
    const { wallMat, floorMat, ceilMat, pitMat, panelMat, metalMat, streak, frameMat, hideMat, dustMat } = materials(assets);
    // los nichos de las paredes: siguen siendo pared en `open`, pero se dibujan huecos (las paredes de alrededor, con su cara hacia dentro)
    const hideCells = new Set(maze.hides.map((q) => q.cell.y * w + q.cell.x));
    const passable = (x: number, y: number) => isOpen(x, y) || hideCells.has(y * w + x);

    // paredes: solo los bloques que tocan algún suelo (los de dentro no se ven)
    const DIRS8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const narrow: { x: number; y: number; c: { x: number; z: number }; pv: number[][] }[] = [];
    const walls: THREE.Matrix4[] = [], floors: THREE.Matrix4[] = [], ceils: THREE.Matrix4[] = [], lintels: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = center({ x, y });
        if (hideCells.has(y * w + x)) {
          // el nicho: suelo y, encima de la boca, un dintel (el techo del nicho)
          floors.push(m.clone().makeTranslation(c.x, 0, c.z));
          lintels.push(m.clone().makeTranslation(c.x, (HIDE_H + HEIGHT) / 2, c.z));
          continue;
        }
        if (!open[y * w + x]) {
          if (DIRS.some(([dx, dy]) => passable(x + dx, y + dy))) walls.push(m.clone().makeTranslation(c.x, HEIGHT / 2, c.z));
          continue;
        }
        ceils.push(m.clone().makeTranslation(c.x, HEIGHT, c.z));
        if (voids.has(y * w + x)) continue;
        // las pasarelas de las salas de pozos: el hueco se come PIT_EDGE de cada lado, el suelo se recorta en trocitos de 12,5 cm
        const pv = maze.zone[y * w + x] === ZONE.pits ? DIRS8.filter(([dx, dy]) => voids.has((y + dy) * w + x + dx)) : [];
        if (pv.length) narrow.push({ x, y, c, pv });
        else floors.push(m.clone().makeTranslation(c.x, 0, c.z));
      }
    const box = new THREE.BoxGeometry(CELL, HEIGHT, CELL);
    const floorG = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
    const ceilG = new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2);
    const inst = (g: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[]) => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, ms.length));
      im.count = ms.length;
      ms.forEach((x, i) => im.setMatrixAt(i, x));
      im.computeBoundingSphere();
      this.root.add(im);
      return im;
    };
    // la linterna proyecta sombra (en escritorio): las paredes la tapan, todo la recibe
    Object.assign(inst(box, wallMat, walls), { castShadow: true, receiveShadow: true });
    Object.assign(inst(new THREE.BoxGeometry(CELL, HEIGHT - HIDE_H, CELL), wallMat, lintels), { castShadow: true, receiveShadow: true });
    inst(floorG, floorMat, floors).receiveShadow = true;
    if (narrow.length) {
      const S = 12, q = CELL / S, pos: number[] = [], uv: number[] = [];
      for (const n of narrow)
        for (let i = 0; i < S; i++)
          for (let j = 0; j < S; j++) {
            const px = n.c.x - CELL / 2 + (i + 0.5) * q, pz = n.c.z - CELL / 2 + (j + 0.5) * q;
            // fuera si cae dentro de algún hueco vecino ensanchado
            if (n.pv.some(([dx, dy]) => Math.abs(px - (n.c.x + dx * CELL)) < CELL / 2 + PIT_EDGE && Math.abs(pz - (n.c.z + dy * CELL)) < CELL / 2 + PIT_EDGE)) continue;
            const x0 = n.c.x - CELL / 2 + i * q, z0 = n.c.z - CELL / 2 + j * q;
            pos.push(x0, 0, z0, x0, 0, z0 + q, x0 + q, 0, z0, x0 + q, 0, z0, x0, 0, z0 + q, x0 + q, 0, z0 + q);
            for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 0], [0, 1], [1, 1]]) uv.push((i + a) / S, 1 - (j + b) / S);
          }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, floorMat);
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.pitGeos.push(g);
    }
    inst(ceilG, ceilMat, ceils).receiveShadow = true;
    // los huecos: moqueta rasgada, canto de hormigón, hierros, cascotes y un pozo que se oscurece (ver pit.ts)
    const pit = buildPits(maze.voids, (c) => maze.zone[c.y * w + c.x] === ZONE.pits);
    for (const [g, mat] of [[pit.junk, pitMat], [pit.lip, floorMat]] as const)
      if (g) {
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.pitGeos.push(g);
      }

    // el desgaste: regueros de agua por las paredes, repartidos con un hash de la celda (siempre igual)
    const hash = (x: number, y: number, k: number) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
    const streaks: THREE.Matrix4[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!open[y * w + x] || voids.has(y * w + x)) continue;
        const c = center({ x, y });
        DIRS.forEach(([dx, dy], k) => {
          if (passable(x + dx, y + dy) || hash(x, y, 10 + k) > 0.09) return;
          // contra esa pared, mirando hacia dentro de la celda, colgando del techo
          const p = new THREE.Vector3(c.x + dx * (CELL / 2 - 0.004), HEIGHT - 0.9, c.z + dy * (CELL / 2 - 0.004));
          streaks.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-dx, -dy)), new THREE.Vector3(0.6 + hash(x, y, 20 + k) * 0.6, 1, 1)));
        });
      }
    inst(new THREE.PlaneGeometry(0.7, 1.8), streak, streaks);

    // el marco de cada nicho (a ras de la pared, algo saliente): dintel con franjas de peligro, dos postes, un umbral roto, una rejilla
    // de ventilación encima de la boca y la hoja de una puerta de servicio abierta a medias, descolgada de su bisagra
    if (maze.hides.length) {
      const part = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
        const ng = g.toNonIndexed(), n = ng.getAttribute('position').count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([r, gr, b], i * 3);
        ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return ng;
      };
      const bar = (wd: number, ht: number, dp: number, x: number, y: number, z: number, c: number[]) => part(new THREE.BoxGeometry(wd, ht, dp).translate(x, y, z), c[0], c[1], c[2]);
      const iron = [0.17, 0.15, 0.11], yellow = [0.42, 0.34, 0.08], black = [0.05, 0.05, 0.04], door = [0.14, 0.2, 0.17];
      const parts = [
        bar(CELL + 0.2, 0.18, 0.1, 0, HIDE_H - 0.04, 0.05, iron),
        bar(0.14, HIDE_H, 0.1, -(CELL / 2 - 0.05), HIDE_H / 2, 0.05, iron),
        bar(0.14, HIDE_H, 0.1, CELL / 2 - 0.05, HIDE_H / 2, 0.05, iron),
        bar(CELL - 0.2, 0.05, 0.14, 0, 0.025, 0.07, iron),
        // franjas amarillas y negras en el dintel
        ...Array.from({ length: 10 }, (_, i) => bar(0.11, 0.13, 0.012, -0.63 + i * 0.14, HIDE_H - 0.04, 0.106, i % 2 ? black : yellow)),
        // la rejilla de ventilación: marco y cinco lamas
        bar(0.6, 0.2, 0.05, 0, HIDE_H + 0.22, 0.03, iron),
        ...Array.from({ length: 5 }, (_, i) => bar(0.54, 0.014, 0.07, 0, HIDE_H + 0.15 + i * 0.037, 0.04, black)),
      ];
      // la hoja: bisagra en el poste derecho, abierta unos 50° hacia fuera, con la esquina de abajo caída
      const leaf = part(new THREE.BoxGeometry(0.62, HIDE_H - 0.12, 0.035).translate(-0.31, (HIDE_H - 0.12) / 2 + 0.04, 0), door[0], door[1], door[2]);
      leaf.rotateZ(0.05).rotateY(0.9).translate(CELL / 2 - 0.12, 0, 0.1);
      parts.push(leaf);
      const hideG = mergeGeometries(parts)!;
      const frames: THREE.Matrix4[] = [], dusts: THREE.Matrix4[] = [];
      for (const q of maze.hides) {
        const c = center(q.cell), [dx, dy] = DIRS[q.side];
        frames.push(place(new THREE.Vector3(c.x + dx * (CELL / 2), 0, c.z + dy * (CELL / 2)), Math.atan2(dx, dy)));
        for (let i = 0; i < 2; i++) {
          const a = hash(q.cell.x, q.cell.y, 40 + i) * 6.28, r = 0.12 + hash(q.cell.x, q.cell.y, 50 + i) * 0.4;
          dusts.push(new THREE.Matrix4().compose(new THREE.Vector3(c.x + Math.cos(a) * r, 0.012, c.z + Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(1 + hash(q.cell.x, q.cell.y, 60 + i), 1, 1 + hash(q.cell.x, q.cell.y, 70 + i) * 0.6)));
        }
      }
      Object.assign(inst(hideG, hideMat, frames), { receiveShadow: true, castShadow: true });
      inst(new THREE.CircleGeometry(0.32, 12).rotateX(-Math.PI / 2), dustMat, dusts);
    }

    // los fluorescentes: un panel cada dos celdas (3 m); los de `maze.lamps` encendidos, el resto
    // apagados, y uno de cada nueve encendidos parpadea
    const lit = new Set(maze.lamps.map((c) => c.y * w + c.x));
    const panels: { c: Cell; on: boolean }[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (open[y * w + x] && hasPanel(maze, x, y)) panels.push({ c: { x, y }, on: lit.has(y * w + x) });
    const panelG = new THREE.BoxGeometry(1.2, 0.05, 0.6);
    this.lamps = inst(panelG, panelMat, panels.map((p) => m.clone().makeTranslation(center(p.c).x, HEIGHT - 0.03, center(p.c).z)));
    // y alguno de los apagados se ha soltado de un lado y cuelga torcido
    panels.forEach((p, i) => {
      if (p.on || (p.c.x * 7 + p.c.y * 13) % 11 !== 3) return;
      const c = center(p.c), tilt = new THREE.Matrix4().makeRotationZ(0.5 * ((p.c.x & 2) - 1));
      this.lamps.setMatrixAt(i, new THREE.Matrix4().makeTranslation(c.x + 0.25, HEIGHT - 0.32, c.z).multiply(tilt));
    });
    this.panelOn = panels.map((p) => p.on);
    this.lampPos = [];
    panels.forEach((p, i) => {
      if (!p.on) return;
      if (i % 9 === 4) this.flicker.push({ i, phase: i * 1.7, lamp: this.lampPos.length, g: this.flicker.length % 4 });
      this.lampPos.push(center(p.c, HEIGHT - 0.25));
    });
    this.lampLevel = new Float32Array(this.lampPos.length).fill(1);
    // un haz tenue bajo cada fluorescente fijo (los que parpadean no): la luz cortando el aire con polvo
    const shaftG = new THREE.CylinderGeometry(0.42, 0.85, HEIGHT - 0.2, 12, 1, true);
    const sp = shaftG.attributes.position, sc = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      const k = THREE.MathUtils.clamp(sp.getY(i) / (HEIGHT - 0.2) + 0.5, 0, 1) ** 1.6; // 1 arriba, 0 abajo
      sc.set([0.5 * k, 0.42 * k, 0.26 * k], i * 3);
    }
    shaftG.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    // el borde se funde con el ángulo de visión (de frente se ve, de canto no): sin filo de cono
    const shaftMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 color;
        varying vec3 vC;
        varying float vF;
        void main() {
          mat4 mm = modelViewMatrix;
          #ifdef USE_INSTANCING
            mm = modelViewMatrix * instanceMatrix;
          #endif
          vec4 mv = mm * vec4(position, 1.0);
          vec3 n = normalize(mat3(mm) * normal);
          vF = pow(abs(dot(n, normalize(-mv.xyz))), 2.2);
          vC = color;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        varying float vF;
        void main() { gl_FragColor = vec4(vC * vF * 0.13, 1.0); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shafts = panels.flatMap((p, i) => (p.on && i % 9 !== 4 && p.c.x % 2 === 0 ? [m.clone().makeTranslation(center(p.c).x, HEIGHT / 2 - 0.05, center(p.c).z)] : []));
    inst(shaftG, shaftMat, shafts).renderOrder = 2;
    // la luz: los paneles fijos y, aparte, los que parpadean (cada uno con su grupo)
    bakeLight(maze, this.flicker.map((f) => ({ c: panels[f.i].c, g: f.g })));
    this.paint();
    // el marco de cada panel: un fluorescente empotrado en el techo, no una caja pegada (los que cuelgan torcidos dejan su marco vacío)
    const fw = 1.32, fd = 0.72, bar = 0.05, fh = 0.07;
    const frameG = mergeGeometries([
      new THREE.BoxGeometry(fw, fh, bar).translate(0, 0, (fd - bar) / 2),
      new THREE.BoxGeometry(fw, fh, bar).translate(0, 0, -(fd - bar) / 2),
      new THREE.BoxGeometry(bar, fh, fd - 2 * bar).translate((fw - bar) / 2, 0, 0),
      new THREE.BoxGeometry(bar, fh, fd - 2 * bar).translate(-(fw - bar) / 2, 0, 0),
      // las dos barras que parten el difusor en tres y la pestaña que lo une al techo
      new THREE.BoxGeometry(0.02, 0.03, fd - 2 * bar).translate(-fw / 6, -0.02, 0),
      new THREE.BoxGeometry(0.02, 0.03, fd - 2 * bar).translate(fw / 6, -0.02, 0),
      new THREE.BoxGeometry(fw + 0.16, 0.012, 0.05).translate(0, 0.03, (fd + 0.05) / 2),
      new THREE.BoxGeometry(fw + 0.16, 0.012, 0.05).translate(0, 0.03, -(fd + 0.05) / 2),
      new THREE.BoxGeometry(0.05, 0.012, fd).translate((fw + 0.05) / 2 + 0.04, 0.03, 0),
      new THREE.BoxGeometry(0.05, 0.012, fd).translate(-(fw + 0.05) / 2 - 0.04, 0.03, 0),
    ].map((g) => g.toNonIndexed()))!;
    inst(frameG, frameMat, panels.map((p) => m.clone().makeTranslation(center(p.c).x, HEIGHT - 0.035, center(p.c).z))).receiveShadow = true;

    // las piezas (los sillones, archivadores, estantes y mesas, además, no se atraviesan: ver furniture)
    this.voidSet = voids;
    const byKind = new Map<PropKind, THREE.Matrix4[]>();
    // mobiliario contra la pared: `depth` lo que ocupa hacia dentro; lo de encima de una mesa (tele, lámpara) sube a su altura
    const FURN: Partial<Record<PropKind, { depth: number; r: number; y?: number; side?: boolean }>> = {
      cabinet: { depth: 0.87, r: 0.45 },
      desk: { depth: 0.46, r: 0.4 },
      shelf: { depth: 0.38, r: 0.55, side: true }, // el lado largo, a lo largo de la pared
      crt: { depth: 0.46, r: 0, y: 0.9 },
      lamp: { depth: 0.46, r: 0, y: 0.9 },
    };
    for (const p of maze.props) {
      const c = center(p.cell), [dx, dy] = DIRS[p.rot] ?? DIRS[0], f = FURN[p.kind];
      let mat: THREE.Matrix4;
      if (p.kind === 'vent') mat = place(new THREE.Vector3(c.x, HEIGHT - 0.07, c.z), Math.PI, 1);
      else if (p.kind === 'armchair') (mat = place(c, (p.rot * Math.PI) / 2 + 0.3)), this.blockers.push({ x: c.x, z: c.z, r: 0.6 });
      else if (p.kind === 'chair' || p.kind === 'chair2') mat = place(c, p.rot * 1.7 + hash(p.cell.x, p.cell.y, 90) * 1.2);
      else if (f) {
        // contra la pared (+z local mira al cuarto; el estante, de lado: +x local mira a la pared)
        const off = CELL / 2 - f.depth / 2 - 0.02, pos = new THREE.Vector3(c.x + dx * off, f.y ?? 0, c.z + dy * off);
        mat = place(pos, f.side ? yaw(dx, dy) : Math.atan2(-dx, -dy));
        if (f.r) this.blockers.push({ x: c.x + dx * off, z: c.z + dy * off, r: f.r });
      }
      else if (p.kind === 'exit') continue; // va con el ascensor
      // la puerta viene entreabierta (la hoja, 5° girada): se endereza y se aparta 4 cm de la pared,
      // o un canto se metía detrás del papel
      else if (p.kind === 'door') mat = place(new THREE.Vector3(c.x + dx * (CELL / 2 - 0.04), 0, c.z + dy * (CELL / 2 - 0.04)), yaw(dx, dy) + 0.0877);
      else mat = place(new THREE.Vector3(c.x + dx * (CELL / 2 - 0.02), p.kind === 'socket' ? 0.3 : 0, c.z + dy * (CELL / 2 - 0.02)), yaw(dx, dy));
      byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), mat]);
    }
    const fix = (k: PropKind) => (mat: THREE.Material) => {
      if (k === 'socket' || k === 'door' || k === 'shelf' || k === 'lamp') mat.side = THREE.DoubleSide;
      lightmapped(mat);
    };
    for (const [k, ms] of byKind) for (const im of instanced(assets.gltf[k].scene, ms, fix(k))) (im.receiveShadow = true), (im.castShadow = k === 'cabinet' || k === 'shelf' || k === 'desk'), this.root.add(im);

    // el ascensor: su celda (un callejón) es la cabina, de metal; las puertas, en la boca de la celda
    // mirando afuera, con pared a los lados y encima. El modelo trae dos puertas juntas: se queda con una
    const e = maze.props.find((p) => p.kind === 'exit')!;
    const [ox, oy] = DIRS[e.rot] ?? DIRS[0];
    this.elevatorFront = new THREE.Vector3(ox, 0, oy);
    const el = assets.gltf.elevator.scene.clone(true);
    el.getObjectByName('Null_1')?.removeFromParent();
    for (const n of ['R', 'L']) el.getObjectByName(n)?.removeFromParent(); // del modelo solo queda el marco: las hojas son las de la cabina
    let bb = new THREE.Box3().setFromObject(el);
    // la puerta a escala de una persona (1,8 m de alto, ojos a 1,62): unos 2,15 m de hueco, y que quepa en la celda
    // el ancho lo limita la celda (1,5 m): llena casi todo; la altura se estira hasta 2,45 m (hasta 1,35× lo proporcional)
    const kx = (CELL * 0.97) / (bb.max.x - bb.min.x), ky = Math.min(2.45 / bb.max.y, kx * 1.35);
    el.scale.set(Math.min(kx, ky), ky, Math.min(kx, ky));
    bb = new THREE.Box3().setFromObject(el);
    const mid = bb.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    el.position.set(-mid.x, 0, -bb.max.z); // la cara de las puertas en la boca, el resto hacia dentro
    holder.add(el);
    const ec = center(maze.elevator);
    holder.position.set(ec.x + ox * (CELL / 2), 0, ec.z + oy * (CELL / 2));
    holder.rotation.y = Math.atan2(ox, oy); // +z local hacia el lado abierto
    this.root.add(holder);
    // el marco: pared a los dos lados de las puertas y encima, hasta llenar la boca
    const dw = bb.max.x - bb.min.x, dh = bb.max.y, side = (CELL - dw) / 2;
    const slab = (wd: number, ht: number, x: number, y: number) => {
      if (wd <= 0.01 || ht <= 0.01) return;
      const s = new THREE.Mesh(new THREE.BoxGeometry(wd, ht, 0.12), wallMat);
      s.position.set(x, y, -0.06);
      holder.add(s);
    };
    slab(side, HEIGHT, -(dw + side) / 2, HEIGHT / 2);
    slab(side, HEIGHT, (dw + side) / 2, HEIGHT / 2);
    slab(dw, HEIGHT - dh, 0, (HEIGHT + dh) / 2);
    // la cabina (el prefab de elevator.ts) ocupa la celda, detrás del marco del modelo; cerrada hasta cumplir la misión
    this.cab = new ElevatorCab(CELL - 0.04, CELL - 0.14, HEIGHT - 0.04, 0, true);
    this.cab.group.position.z = -0.1;
    holder.add(this.cab.group);
    this.elevator = holder;
    const sign = assets.gltf.exit.scene.clone(true);
    sign.scale.setScalar(2.2);
    sign.position.set(0, Math.min(HEIGHT - 0.4, bb.max.y + 0.08), 0.02);
    holder.add(sign);
  }

  /** Celda de un punto del mundo. */
  cellAt(x: number, z: number): Cell {
    return { x: Math.floor(x / CELL), y: Math.floor(z / CELL) };
  }
  /** Pared (o fuera del mapa) en ese punto. */
  solid(x: number, z: number) {
    const c = this.cellAt(x, z), { w, h, open } = this.maze;
    if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h || !open[c.y * w + c.x]) return true;
    return !this.elevatorOpen && c.x === this.maze.elevator.x && c.y === this.maze.elevator.y;
  }
  /** Un sillón a menos de `r` de ese punto (cada uno, un círculo de 0,6 m en el centro de su celda). */
  furniture(x: number, z: number, r: number) {
    return this.blockers.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + r) ** 2);
  }
  /** Lo cerca que se está de un hueco (0 a más de 5 m, 1 al borde): para el soplo de aire que sale de él. */
  pitNear(x: number, z: number) {
    let d = Infinity;
    for (const v of this.maze.voids) d = Math.min(d, Math.hypot((v.x + 0.5) * CELL - x, (v.y + 0.5) * CELL - z));
    return THREE.MathUtils.clamp(1 - (d - CELL / 2) / 5, 0, 1);
  }
  /** Hueco de una sala de pozos en ese punto: justo lo que se ve sin suelo (PIT_EDGE incluido). A pie no se entra (ver Player.update): solo se cae saltando. */
  pitAt(x: number, z: number) {
    const w = this.maze.w, E = PIT_EDGE;
    for (const dx of [-E, 0, E]) for (const dz of [-E, 0, E]) {
      const c = this.cellAt(x + dx, z + dz), i = c.y * w + c.x;
      if (this.voidSet.has(i) && this.maze.zone[i] === ZONE.pits) return true;
    }
    return false;
  }
  /** Hueco al vacío en ese punto. */
  voidAt(x: number, z: number) {
    const w = this.maze.w, E = PIT_EDGE;
    const at = (dx: number, dz: number) => {
      const c = this.cellAt(x + dx, z + dz);
      return c.y * w + c.x;
    };
    if (this.voidSet.has(at(0, 0))) return true;
    // los huecos de las salas de pozos invaden la pasarela PIT_EDGE (el suelo está recortado igual): se cae si el centro pisa ese borde
    for (const dx of [-E, 0, E]) for (const dz of [-E, 0, E]) {
      const i = at(dx, dz);
      if (this.voidSet.has(i) && this.maze.zone[i] === ZONE.pits) return true;
    }
    // el resto: solo se cae al pisar el borde de verdad (5 cm; antes 20 y el hueco «se comía» el suelo visible)
    const M = 0.05;
    return [[M, 0], [-M, 0], [0, M], [0, -M]].some(([dx, dz]) => this.voidSet.has(at(dx, dz)));
  }
  /** Las cuatro lámparas encendidas más cercanas (para las cuatro luces que se mueven con el jugador), con lo que dan ahora (0–1). */
  lightsNear(p: THREE.Vector3, n = 4) {
    return this.lampPos
      .map((pos, i) => ({ pos, level: this.lampLevel[i] * this.power, d: pos.distanceToSquared(p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  }

  // los colores de los paneles: encendidos según la corriente, apagados grises
  private paint() {
    // los apagados no dan luz pero tampoco brillan a oscuras: en un apagón se oscurecen con todo
    const on = new THREE.Color(1, 0.96, 0.82), off = new THREE.Color(0.32, 0.3, 0.24).multiplyScalar(0.2 + 0.8 * this.power), c = new THREE.Color();
    this.panelOn.forEach((o, i) => this.lamps.setColorAt(i, o ? c.lerpColors(off, on, this.power) : off));
    this.lamps.instanceColor!.needsUpdate = true;
    this.shownPower = this.power;
  }

  update(t: number, dt: number) {
    this.cab.update(dt);
    LM.uLmGain.value = 0.06 + 0.94 * this.power;
    if (this.power !== this.shownPower) this.paint();
    // parpadeo de tubo viejo: casi siempre bien, y a ratos una racha de apagarse y encenderse a saltos
    const on = new THREE.Color(1, 0.96, 0.82), off = new THREE.Color(0.32, 0.3, 0.24).multiplyScalar(0.2 + 0.8 * this.power), c = new THREE.Color();
    // cada grupo de tubos (ver lightmap: las paredes de alrededor parpadean con ellos) tiene su racha
    const lv = [0, 1, 2, 3].map((g) => {
      const ph = g * 2.3 + 0.7;
      const burst = Math.sin(t * 0.37 + ph * 5) + Math.sin(t * 0.91 + ph) > 1.2;
      const k = Math.floor(t * 18 + ph * 10), r = Math.abs(Math.sin(k * 12.9898 + ph) * 43758.5453) % 1;
      return burst && r < 0.55 ? 0.08 : 1;
    });
    LM.uFlick.value.set(lv[0], lv[1], lv[2], lv[3]);
    for (const f of this.flicker) {
      this.lampLevel[f.lamp] = lv[f.g];
      this.lamps.setColorAt(f.i, c.lerpColors(off, on, lv[f.g] * this.power));
    }
    if (this.flicker.length) this.lamps.instanceColor!.needsUpdate = true;
  }

  dispose() {
    // las geometrías son de este laberinto; los materiales, compartidos (ver `materials`), se quedan
    this.root.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.geometry.dispose(), im.dispose();
      else if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.Mesh).geometry.type !== 'BufferGeometry') (o as THREE.Mesh).geometry.dispose();
    });
    for (const g of this.pitGeos) g.dispose();
    this.cab.dispose();
    this.root.removeFromParent();
  }
}

