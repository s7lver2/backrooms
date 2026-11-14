import * as THREE from 'three';
import { ElevatorCab } from './elevator';
import type { Terrain } from './terrain';
import { Rig } from './rig';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, SUITE_L, SUITE_UNIT, ZONE, hasPanel, type Cell, type Maze, type PropKind } from './maze';
import type { Assets } from './game';
import { bakeLight, lightmapped, LM } from './lightmap';
import { buildPits, PIT_EDGE } from './pit';

/*
 * El laberinto en 3D. Paredes, suelo, techo y fluorescentes van instanciados (cuatro dibujos para
 * todo); las piezas de backrooms_vr2, también, una malla instanciada por cada malla de la pieza.
 * Las luces son siempre las mismas (las pone game.ts): aquí solo se dice dónde están las lámparas.
 */

export const HEIGHT = 2.7;
/** Lo que gira la hoja de una puerta abierta de las Suites (rad). */
const SWING = 1.75;
const PROP_FAR = 24;
/** El mobiliario de las suites: qué modelo, a qué medida (el lado `axis` mide `size` m), a qué altura cuelga (`mount`: el centro; si no, al suelo) y lo que no se atraviesa (círculos `r` en [lateral, hacia donde mira]). */
const SUITE_PROPS: Partial<Record<PropKind, { key: 'suites/bed' | 'suites/sofa' | 'suites/luggage' | 'suites/bin' | 'suites/mirror' | 'suites/plant' | 'suites/chair' | 'suites/wardrobe' | 'suites/table' | 'suites/secretary' | 'suites/panel' | 'suites/trolley'; turn?: number; tint?: number; axis: 'x' | 'y' | 'z'; size: number; mount?: number; r?: number; at?: [number, number][] }>> = {
  bed: { key: 'suites/bed', axis: 'z', size: 2.25, r: 0.62, at: [[0, -0.8], [0, 0], [0, 0.8]] },
  sofa: { key: 'suites/sofa', axis: 'x', size: 1.9, r: 0.5, at: [[-0.45, 0], [0.45, 0]] },
  luggage: { key: 'suites/luggage', axis: 'y', size: 0.78, r: 0.3, at: [[0, 0]] },
  plant: { key: 'suites/plant', axis: 'y', size: 1.3, r: 0.3, at: [[0, 0]] },
  bin: { key: 'suites/bin', axis: 'y', size: 0.4 },
  trolley: { key: 'suites/trolley', turn: Math.PI / 2, axis: 'y', size: 1.8, r: 0.4, at: [[0, -0.3], [0, 0.3]] }, // (el modelo es largo en z)
  mirror: { key: 'suites/mirror', axis: 'y', size: 1.2, mount: 1.5 },
  wardrobe: { key: 'suites/wardrobe', axis: 'y', size: 2.2, tint: 0x9a6c52, r: 0.5, at: [[-0.4, 0], [0.4, 0]] },
  wingchair: { key: 'suites/chair', axis: 'y', size: 1.05, r: 0.4, at: [[0, 0]] },
  reception: { key: 'suites/secretary', axis: 'x', size: 5.2, r: 0.55, at: [[-2.2, 0], [-1.1, 0], [0, 0], [1.1, 0], [2.2, 0]] },
  panel: { key: 'suites/panel', axis: 'y', size: 0.8, mount: 1.4 },
  bistro: { key: 'suites/table', axis: 'y', size: 0.75, r: 0.3, at: [[0, 0]] },
};
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
export const center = (c: Cell, y = 0) => new THREE.Vector3(c.x * CELL + CELL / 2, y, c.y * CELL + CELL / 2);

/**
 * Un glb como mallas instanciadas en `mats`: una por material, con todas sus mallas fundidas (la
 * puerta de backrooms_vr2 son 240 trozos; sin fundir, 240 dibujos por puerta).
 */
function instanced(src: THREE.Object3D, mats: THREE.Matrix4[], fix?: (m: THREE.Material) => void, rooms = false) {
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
  // por trozos de 9 m: cada uno con su esfera, para que el frustum descarte lo que no se ve (una sola cubría todo el mapa y se dibujaba siempre)
  const chunks = new Map<string, THREE.Matrix4[]>();
  for (const m of mats) {
    const x = m.elements[12], z = m.elements[14];
    // las suites (Las Suites): un trozo por habitación (el pasillo, z de 12 a 15 m, va por trozos de 9 m); `World.update` la oculta con la puerta cerrada y lejos de ella
    const k = rooms && x < 72 && (z < 12 || z >= 15) ? `r${Math.floor(x / 6)},${z < 12 ? 1 : 0}` : `${Math.floor(x / 9)},${Math.floor(z / 9)}`;
    chunks.set(k, [...(chunks.get(k) ?? []), m]);
  }
  return [...byMat].flatMap(([mat, gs]) => {
    fix?.(mat);
    const geo = mergeGeometries(gs) ?? gs[0];
    return [...chunks].map(([ck, cm]) => {
      const im = new THREE.InstancedMesh(geo, mat, cm.length);
      cm.forEach((m, i) => im.setMatrixAt(i, m));
      im.computeBoundingSphere();
      if (ck[0] === 'r') im.userData.room = ck.slice(1).split(',').map(Number); // [hueco, 1 si es del lado norte]
      im.userData.cull = true; // (World.update los oculta por distancia: los modelos pesan decenas de miles de triángulos)
      return im;
    });
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
// Las Suites: el mismo juego de materiales con papel pintado rojo en las paredes y moqueta granate
const hotelMats = new WeakMap<Assets, ReturnType<typeof makeMaterials> & { runA: THREE.Material; runB: THREE.Material; runner: THREE.Material }>();
// papel pintado rojo de damasco sobre una boiserie de madera de caoba con paneles hundidos, riel y zócalo crema (una cara de pared: 1,5 × 2,7 m).
// Tres lienzos del mismo dibujo: el color, el relieve (paneles hundidos, molduras, veta, damasco) y la rugosidad (la madera barnizada brilla; el papel, no)
const WOOD = { y0: 627, y1: 872 }, FIELDS = [28, 282];
const hotelWallTex = () => {
  const mk = (h = 920) => {
    const cv = Object.assign(document.createElement('canvas'), { width: 512, height: h });
    return [cv, cv.getContext('2d')!] as const;
  };
  const [cc, c] = mk(), [cb, b] = mk(), [cr, r] = mk();
  const maps = [cc, cb, cr].map((cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    return t;
  });
  maps[0].colorSpace = THREE.SRGBColorSpace;
  // veta: trazos finos y algo ondulados, a lo largo (`vert`) o a lo ancho, en una caja
  const grain = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vert: boolean, dark: string, light: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const u = Math.random(), len = (vert ? h : w) * (0.3 + Math.random() * 0.7), o = Math.random() * ((vert ? h : w) - len), wob = Math.random() * 6 + 1, ph = Math.random() * 6;
      g.strokeStyle = Math.random() < 0.62 ? dark : light;
      g.lineWidth = 0.6 + Math.random() * 1.6;
      g.beginPath();
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, a = (vert ? y : x) + o + len * t, off = (vert ? x + u * w : y + u * h) + Math.sin(t * 5 + ph) * wob;
        k ? g.lineTo(vert ? off : a, vert ? a : off) : g.moveTo(vert ? off : a, vert ? a : off);
      }
      g.stroke();
    }
  };
  const draw = (paper?: HTMLImageElement) => {
    // ── color
    c.fillStyle = '#7a1218';
    c.fillRect(0, 0, 512, 920);
    if (paper) {
      c.save();
      c.scale(0.25, 0.25);
      c.fillStyle = c.createPattern(paper, 'repeat')!;
      c.fillRect(0, 0, 2048, 2452);
      c.restore();
    }
    c.fillStyle = '#e9e2d2';
    c.fillRect(0, 613, 512, 14);
    // madera: el marco con la veta a lo ancho; los paneles, a lo largo y algo más oscuros
    const wg = c.createLinearGradient(0, WOOD.y0, 0, WOOD.y1);
    wg.addColorStop(0, '#5a2d1a');
    wg.addColorStop(1, '#42210f');
    c.fillStyle = wg;
    c.fillRect(0, WOOD.y0, 512, WOOD.y1 - WOOD.y0);
    grain(c, 0, WOOD.y0, 512, WOOD.y1 - WOOD.y0, false, 'rgba(25,10,4,0.5)', 'rgba(150,90,50,0.35)', 190);
    for (const x of FIELDS) {
      c.fillStyle = 'rgba(30,12,5,0.22)';
      c.fillRect(x, 652, 202, 196);
      grain(c, x, 652, 202, 196, true, 'rgba(25,10,4,0.55)', 'rgba(170,105,60,0.4)', 70);
      // bisel: luz por arriba y por la izquierda
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(x, 652, 202, 6), c.fillRect(x, 652, 6, 196);
      c.fillStyle = 'rgba(255,205,150,0.28)';
      c.fillRect(x, 842, 202, 6), c.fillRect(x + 196, 652, 6, 196);
    }
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, 627, 512, 5);
    c.fillStyle = '#e9e2d2';
    c.fillRect(0, 872, 512, 48);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(0, 872, 512, 4);
    // ── relieve (claro = sale)
    b.fillStyle = '#808080';
    b.fillRect(0, 0, 512, 920);
    if (paper) {
      b.save();
      b.scale(0.25, 0.25);
      b.globalAlpha = 0.55;
      b.filter = 'grayscale(1) contrast(1.3)';
      b.fillStyle = b.createPattern(paper, 'repeat')!;
      b.fillRect(0, 0, 2048, 2452);
      b.restore();
    }
    b.fillStyle = '#c8c8c8';
    b.fillRect(0, 613, 512, 14); // el riel sale
    b.fillStyle = '#a0a0a0';
    b.fillRect(0, WOOD.y0, 512, WOOD.y1 - WOOD.y0);
    grain(b, 0, WOOD.y0, 512, WOOD.y1 - WOOD.y0, false, 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.25)', 120);
    for (const x of FIELDS) {
      const bg = b.createLinearGradient(0, 652, 0, 700); // el panel, hundido, con un bisel que baja
      b.fillStyle = '#4a4a4a';
      b.fillRect(x, 652, 202, 196);
      b.fillStyle = bg;
      grain(b, x, 652, 202, 196, true, 'rgba(0,0,0,0.4)', 'rgba(255,255,255,0.22)', 60);
      b.fillStyle = '#242424';
      b.fillRect(x, 652, 202, 8), b.fillRect(x, 652, 8, 196);
      b.fillStyle = '#d0d0d0';
      b.fillRect(x, 840, 202, 8), b.fillRect(x + 194, 652, 8, 196);
    }
    b.fillStyle = '#d8d8d8';
    b.fillRect(0, 872, 512, 48); // el zócalo sale
    b.fillStyle = '#202020';
    b.fillRect(0, 627, 512, 4);
    // ── rugosidad (claro = mate)
    r.fillStyle = '#e6e6e6';
    r.fillRect(0, 0, 512, 920);
    r.fillStyle = '#6e6e6e'; // la caoba barnizada
    r.fillRect(0, WOOD.y0, 512, WOOD.y1 - WOOD.y0);
    grain(r, 0, WOOD.y0, 512, WOOD.y1 - WOOD.y0, false, 'rgba(255,255,255,0.18)', 'rgba(0,0,0,0.18)', 80);
    r.fillStyle = '#8c8c8c';
    r.fillRect(0, 613, 512, 14), r.fillRect(0, 872, 512, 48); // la pintura crema, satinada
    maps.forEach((t) => (t.needsUpdate = true));
  };
  draw();
  const img = new Image();
  img.onload = () => draw(img);
  img.src = '/textures/suites/wallpaper_red.jpg';
  return { map: maps[0], bump: maps[1], rough: maps[2] };
};
// cuarzo rosado pulido: losetas de 0,75 m con vetas y juntas finas (una cara de 1,5 m = 2 × 2 losetas). `run`: la alfombra roja del centro, 'a' pegada al borde sur de la celda y 'b' al norte
const quartzTex = (run?: 'a' | 'b') => {
  const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = cv.getContext('2d')!;
  g.fillStyle = '#ece0dd';
  g.fillRect(0, 0, 256, 256);
  const wrap = (f: (dx: number, dy: number) => void) => [-256, 0, 256].forEach((dx) => [-256, 0, 256].forEach((dy) => f(dx, dy)));
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 20 + Math.random() * 50, c = Math.random() < 0.5 ? '255,250,248' : '214,176,176';
    wrap((dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(${c},0.22)`);
      gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  g.strokeStyle = 'rgba(170,130,130,0.3)'; // vetas
  g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * 256, y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo((x += 20 + Math.random() * 25), (y += Math.random() * 40 - 20));
    g.stroke();
  }
  g.fillStyle = 'rgba(120,90,90,0.55)'; // juntas
  for (const k of [0, 128]) (g.fillRect(k, 0, 2, 256), g.fillRect(0, k, 256, 2));
  if (run) {
    // la alfombra: 60 % de la celda pegada a un borde, granate con dos filetes dorados y un poco de pelo
    const y0 = run === 'a' ? 256 * 0.4 : 0, h = 256 * 0.6;
    g.fillStyle = '#6e1119';
    g.fillRect(0, y0, 256, h);
    for (let i = 0; i < 3000; i++) (g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,120,120' : '0,0,0'},${Math.random() * 0.14})`), g.fillRect(Math.random() * 256, y0 + Math.random() * h, 2, 2);
    g.fillStyle = '#c9a24a';
    const edge = run === 'a' ? y0 + 12 : y0 + h - 12; // el filete del borde exterior
    g.fillRect(0, edge - 2, 256, 4);
    g.fillRect(0, run === 'a' ? y0 + 22 : y0 + h - 22, 256, 2);
    g.fillStyle = '#4a0b11';
    g.fillRect(0, run === 'a' ? y0 + h - 6 : y0, 256, 6); // el centro de la alfombra
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};
// el pelo de una alfombra: tejido cruzado fino y ruido, en grises, como relieve (se repite varias veces por celda)
const pileTex = () => {
  const cv = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = cv.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 9000; i++) (g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.15 + Math.random() * 0.3})`), g.fillRect(Math.random() * 128, Math.random() * 128, 1, 2);
  for (let i = 0; i < 128; i += 4) (g.fillStyle = 'rgba(0,0,0,0.22)'), g.fillRect(i, 0, 1, 128), g.fillRect(0, i, 128, 1);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  return t;
};
// el camino de alfombra del pasillo: granate con filetes dorados a cada lado (los bordes de la textura son los del camino; se repite a lo largo)
const runnerTex = () => {
  const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = cv.getContext('2d')!;
  g.fillStyle = '#6e1119';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) (g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,110,110' : '0,0,0'},${Math.random() * 0.15})`), g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  g.fillStyle = '#c9a24a';
  for (const y of [14, 242]) g.fillRect(0, y - 3, 256, 6);
  for (const y of [28, 228]) g.fillRect(0, y - 1, 256, 2);
  g.strokeStyle = 'rgba(201,162,74,0.5)'; // rombos centrales
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 128), g.lineTo(64, 70), g.lineTo(128, 128), g.lineTo(64, 186), g.closePath();
  g.moveTo(128, 128), g.lineTo(192, 70), g.lineTo(256, 128), g.lineTo(192, 186), g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};
// el relieve del cuarzo: las juntas, hundidas; las vetas, apenas marcadas; un poro fino (en la misma disposición de losetas que `quartzTex`)
const quartzBump = () => {
  const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = cv.getContext('2d')!;
  g.fillStyle = '#b0b0b0';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) (g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.12})`), g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * 256, y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo((x += 20 + Math.random() * 25), (y += Math.random() * 40 - 20));
    g.stroke();
  }
  g.fillStyle = '#101010'; // juntas
  for (const k of [0, 128]) (g.fillRect(k, 0, 3, 256), g.fillRect(0, k, 256, 3));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
// el hormigón de la escalera de servicio: gris, con poros, manchas de humedad y las marcas de los encofrados
const concreteTex = () => {
  const mk = (bump: boolean) => {
    const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = cv.getContext('2d')!;
    g.fillStyle = bump ? '#a0a0a0' : '#7e7d78';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) (g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.14})`), g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    if (!bump) for (let i = 0; i < 7; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 30 + Math.random() * 50, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,36,28,0.16)'), gr.addColorStop(1, 'rgba(40,36,28,0)'), (g.fillStyle = gr), g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    g.fillStyle = bump ? '#303030' : 'rgba(0,0,0,0.28)'; // juntas del encofrado
    g.fillRect(0, 0, 256, 2), g.fillRect(0, 0, 2, 256);
    for (const [x, y] of [[32, 32], [96, 32], [160, 32], [224, 32]]) (g.beginPath(), g.arc(x, y + 96, 3, 0, 7), g.fill()); // los agujeros de los tirantes
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (!bump) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(false), bump: mk(true) };
};
// alfombra roja de las suites: granate liso con pelo y una cenefa dorada fina
const redCarpetTex = () => {
  const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = cv.getContext('2d')!;
  g.fillStyle = '#6b1018';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) (g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,110,110' : '0,0,0'},${Math.random() * 0.14})`), g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
};
const hotelMaterials = (a: Assets) => {
  if (!hotelMats.has(a)) {
    const textile = (map: THREE.Texture) => lit(new THREE.MeshStandardMaterial({ map, bumpMap: pileTex(), bumpScale: 2.2, roughness: 1, metalness: 0 }));
    const quartz = (map: THREE.Texture) => lit(new THREE.MeshStandardMaterial({ map, bumpMap: quartzBump(), bumpScale: 1.6, roughness: 0.16, metalness: 0.12 }));
    hotelMats.set(a, {
      ...materials(a),
      wallMat: (() => {
        const t = hotelWallTex();
        return lit(new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 3, roughnessMap: t.rough, roughness: 1, metalness: 0.02 }));
      })(),
      floorMat: textile(redCarpetTex()), // las suites: alfombra roja de pelo
      runner: textile(runnerTex()),
      runA: quartz(quartzTex()),
      runB: quartz(quartzTex()),
      ceilMat: quartz(quartzTex()), // techo de cuarzo
    });
  }
  return hotelMats.get(a)!;
};
const yaw = (dx: number, dz: number) => Math.atan2(-dz, dx); // gira +x local hacia (dx, dz)
const place = (p: THREE.Vector3, ry: number, s = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(s, s, s));

/** Piezas de servicio del hotel hechas a mano (el cuadro eléctrico, el carro de limpieza y el carrito de maletas): su "frente" es +z local y su eje largo, x. */
const serviceProp = (kind: 'cart') => {
  const g = new THREE.Group(), mat = (color: number, metal = 0.1, rough = 0.6) => lit(new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  };
  const wheel = (x: number, z: number, m: THREE.Material) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10).rotateX(Math.PI / 2), m);
    c.position.set(x, 0.06, z);
    g.add(c);
  };
  if (kind === 'cart') {
    const body = mat(0x3a5a78, 0.2, 0.55), grey = mat(0x8a8d8f, 0.5, 0.5), dark = mat(0x222222, 0.2, 0.7);
    box(0.95, 0.05, 0.55, 0, 0.3, 0, grey);
    box(0.9, 0.5, 0.5, 0, 0.62, 0, body);
    box(0.42, 0.12, 0.3, -0.2, 0.93, 0, mat(0xe8e4da, 0, 0.9));
    box(0.42, 0.1, 0.3, -0.2, 1.04, 0, mat(0xe0dccf, 0, 0.9));
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.26, 12), mat(0xe0b020, 0, 0.6));
    bucket.position.set(0.28, 1.0, 0);
    g.add(bucket);
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat(0x151515, 0, 0.5));
    bag.scale.set(0.8, 1.2, 0.8);
    bag.position.set(0.58, 0.8, 0);
    g.add(bag);
    box(0.03, 0.55, 0.03, -0.48, 1.05, -0.2, grey), box(0.03, 0.55, 0.03, -0.48, 1.05, 0.2, grey), box(0.03, 0.03, 0.43, -0.48, 1.32, 0, grey);
    for (const x of [-0.42, 0.42]) for (const z of [-0.22, 0.22]) wheel(x, z, dark);
  }
  return g;
};

export class World implements Terrain {
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

  /** El color de los fluorescentes encendidos (el hotel, más cálido). */
  private warm = new THREE.Color(1, 0.96, 0.82);
  /** Las motas de polvo (Las Suites) y el reflejo del suelo pulido. */
  private dust?: THREE.Points;
  private dustMat?: THREE.ShaderMaterial;
  private skyMat?: THREE.ShaderMaterial;
  private hallFx?: (t: number) => void;
  /** Las luces de cada cuadro eléctrico (rojas: sin activar; verdes: con corriente). */
  readonly genLeds: THREE.MeshBasicMaterial[] = [];
  /** Lo que respira de la luz del hotel (se ve en `update`). */
  private glow?: { cove: THREE.MeshBasicMaterial; ceil: THREE.MeshBasicMaterial; wall: THREE.MeshBasicMaterial; halo: THREE.MeshBasicMaterial; wash: THREE.MeshBasicMaterial };
  private rf?: Reflector;
  /** Las puertas de las suites que se abren (Las Suites): empiezan cerradas; `tgt` 1 es abierta, `cur` el giro (0 a 1). */
  private doors: { x: number; z: number; nx: number; nz: number; leaf?: THREE.Object3D; cell: number; cur: number; tgt: number; swing?: (k: number) => void; grand?: boolean; y?: number; stair?: number }[] = [];
  /** Las celdas de los ascensores de adorno (Las Suites repite el pasillo): no se entra. */
  private decoys = new Set<number>();

  /** Quién hay en el mundo (el jugador y los compañeros): una puerta no se cierra encima de nadie (se quedaba la gente atrapada dentro de la pared). */
  occupants?: () => { x: number; z: number }[];
  private hotel: boolean;
  private assets: Assets;
  /** Facelings que pasean por el pasillo del hotel (cosmético: se calculan del reloj de la partida, así que casi coinciden en todos los clientes). Uno por copia del pasillo. */
  private walkers: { rigs: Rig[]; groups: THREE.Group[]; blk: { x: number; z: number; r: number }[]; phase: number; dir: number; z: number; v: number }[] = [];
  constructor(readonly maze: Maze, assets: Assets, hotel = false) {
    this.hotel = hotel;
    this.assets = assets;
    const { w, h, open } = maze;
    const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !!open[y * w + x];
    const voids = new Set(maze.voids.map((v) => v.y * w + v.x));
    if (hotel) this.warm.setRGB(1, 0.84, 0.58);
    const cw = hotel ? SUITE_L * 3 : w; // el pasillo del hotel (las copias); el vestíbulo, más allá, es de alfombra
    const hm = hotel ? hotelMaterials(assets) : undefined, { wallMat, floorMat, ceilMat, pitMat, panelMat, metalMat, streak, frameMat, hideMat, dustMat } = hm ?? materials(assets);
    // los nichos de las paredes: siguen siendo pared en `open`, pero se dibujan huecos (las paredes de alrededor, con su cara hacia dentro)
    const hideCells = new Set(maze.hides.filter((q) => !q.at).map((q) => q.cell.y * w + q.cell.x));
    const passable = (x: number, y: number) => isOpen(x, y) || hideCells.has(y * w + x);

    // paredes: solo los bloques que tocan algún suelo (los de dentro no se ven)
    const DIRS8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const narrow: { x: number; y: number; c: { x: number; z: number }; pv: number[][] }[] = [];
    const walls: THREE.Matrix4[] = [], floors: THREE.Matrix4[] = [], ceils: THREE.Matrix4[] = [], lintels: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const holes = new Set<number>(), shaft = new Set(maze.props.filter((p) => p.kind === 'stairs').flatMap((p) => [-1, 0, 1].flatMap((dx) => [1, 2, 3, 4, 5, 6].map((r) => r * w + p.cell.x + dx)))); // (la escalera de servicio es un hueco alto: sin techo bajo)
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
          // (el hotel: tabiques finos, una losa de 30 cm pegada a cada cara que da a un sitio abierto; el resto del bloque, hueco, que no se ve ni se pisa)
          if (hotel) {
            for (const [dx, dy] of DIRS) if (passable(x + dx, y + dy)) walls.push(new THREE.Matrix4().compose(new THREE.Vector3(c.x + dx * (CELL / 2 - 0.15), HEIGHT / 2, c.z + dy * (CELL / 2 - 0.15)), new THREE.Quaternion(), new THREE.Vector3(dx ? 0.3 / CELL : 1, 1, dy ? 0.3 / CELL : 1)));
          } else if (DIRS.some(([dx, dy]) => passable(x + dx, y + dy))) walls.push(m.clone().makeTranslation(c.x, HEIGHT / 2, c.z));
          continue;
        }
        if (!(hotel && x >= SUITE_L * 3 + 4 && x <= SUITE_L * 3 + 9 && y >= 6 && y <= 11) && !shaft.has(y * w + x)) ceils.push(m.clone().makeTranslation(c.x, HEIGHT, c.z)); // (el salón de recepción: un hueco de 9 × 9 m en el centro, con la cúpula)
        if (voids.has(y * w + x) || holes.has(y * w + x)) continue;
        // las pasarelas de las salas de pozos: el hueco se come PIT_EDGE de cada lado, el suelo se recorta en trocitos de 12,5 cm
        const pv = maze.zone[y * w + x] === ZONE.pits ? DIRS8.filter(([dx, dy]) => voids.has((y + dy) * w + x + dx)) : [];
        if (pv.length) narrow.push({ x, y, c, pv });
        else floors.push(m.clone().makeTranslation(c.x, 0, c.z));
      }
    if (hotel) for (let y = 4; y <= 13; y++) { const e = center({ x: w, y }); walls.push(m.clone().makeTranslation(e.x, HEIGHT / 2, e.z)); } // la pared del fondo del vestíbulo (fuera de la cuadrícula: si no, se ve el cielo)
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
    if (hm) {
      // el pasillo (filas 8 y 9): cuarzo con la alfombra roja por el centro; el resto, alfombra roja
      const rowOf = (mm: THREE.Matrix4) => Math.floor(new THREE.Vector3().setFromMatrixPosition(mm).z / CELL);
      for (const [rows, mat] of [[[8], hm.runA], [[9], hm.runB]] as const) inst(floorG, mat, floors.filter((f) => rows.includes(rowOf(f) as never) && new THREE.Vector3().setFromMatrixPosition(f).x < cw * CELL)).receiveShadow = true;
      inst(floorG, floorMat, floors.filter((f) => ![8, 9].includes(rowOf(f)) || new THREE.Vector3().setFromMatrixPosition(f).x >= cw * CELL)).receiveShadow = true;
      // el camino de alfombra (1,8 m, un pelín sobre el cuarzo) y, bajo él, el reflejo suave del pulido: un Reflector como el del agua de las Poolrooms, casi transparente
      const rm = hm.runner as THREE.MeshStandardMaterial;
      rm.map!.repeat.set((cw * CELL) / 1.8, 1);
      const runner = new THREE.Mesh(new THREE.PlaneGeometry(cw * CELL, 1.8).rotateX(-Math.PI / 2), rm);
      runner.position.set((cw * CELL) / 2, 0.006, 13.5);
      runner.receiveShadow = true;
      this.root.add(runner);
      const shader = {
        name: 'SuitesFloor',
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
        vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; void main() { vUv = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tDiffuse; varying vec4 vUv; void main() { vec4 b = texture2DProj(tDiffuse, vUv); gl_FragColor = vec4(b.rgb, 0.22);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      };
      this.rf = new Reflector(new THREE.PlaneGeometry(cw * CELL, 3), { textureWidth: 512, textureHeight: 512, clipBias: 0.003, shader });
      const rmat = this.rf.material as THREE.ShaderMaterial;
      rmat.transparent = true;
      rmat.depthWrite = false;
      this.rf.rotation.x = -Math.PI / 2;
      this.rf.position.set((cw * CELL) / 2, 0.003, 13.5);
      this.rf.renderOrder = 1;
      this.root.add(this.rf);
    } else inst(floorG, floorMat, floors).receiveShadow = true;
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
    inst(new THREE.PlaneGeometry(0.7, 1.8), streak, hotel ? [] : streaks);

    // el marco de cada nicho (a ras de la pared, algo saliente): dintel con franjas de peligro, dos postes, un umbral roto, una rejilla
    // de ventilación encima de la boca y la hoja de una puerta de servicio abierta a medias, descolgada de su bisagra
    if (maze.hides.some((q) => !q.at)) {
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
        if (q.at) continue;
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
    const panelG = hotel ? new THREE.CylinderGeometry(0.14, 0.14, 0.04, 20) : new THREE.BoxGeometry(1.2, 0.05, 0.6); // (el hotel: focos redondos empotrados)
    this.lamps = inst(panelG, panelMat, panels.map((p) => m.clone().makeTranslation(center(p.c).x, HEIGHT - 0.03, center(p.c).z)));
    // y alguno de los apagados se ha soltado de un lado y cuelga torcido
    panels.forEach((p, i) => {
      if (p.on || (p.c.x * 7 + p.c.y * 13) % 11 !== 3) return;
      const c = center(p.c), tilt = new THREE.Matrix4().makeRotationZ(0.5 * ((p.c.x & 2) - 1));
      this.lamps.setMatrixAt(i, new THREE.Matrix4().makeTranslation(c.x + 0.25, HEIGHT - 0.32, c.z).multiply(tilt));
    });
    const hall = (c: Cell) => (hotel && c.x >= SUITE_L * 3 + 4 && c.x <= SUITE_L * 3 + 9 && c.y >= 6 && c.y <= 11) || shaft.has(c.y * w + c.x); // bajo la cúpula (y en la escalera)
    panels.forEach((p, i) => hall(p.c) && this.lamps.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0))); // (su luz sigue: lo que cambia es que no cuelgan focos de la cúpula)
    this.panelOn = panels.map((p) => p.on);
    this.lampPos = [];
    panels.forEach((p, i) => {
      if (!p.on) return;
      if (!hotel && i % 9 === 4) this.flicker.push({ i, phase: i * 1.7, lamp: this.lampPos.length, g: this.flicker.length % 4 });
      this.lampPos.push(center(p.c, HEIGHT - 0.25));
    });
    this.lampLevel = new Float32Array(this.lampPos.length).fill(1);
    // un haz tenue bajo cada fluorescente fijo (los que parpadean no): la luz cortando el aire con polvo
    const shaftG = hotel ? new THREE.CylinderGeometry(0.14, 0.62, HEIGHT - 0.2, 14, 1, true) : new THREE.CylinderGeometry(0.42, 0.85, HEIGHT - 0.2, 12, 1, true);
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
    const shafts = panels.flatMap((p, i) => (p.on && i % 9 !== 4 && p.c.x % 2 === 0 && !hall(p.c) ? [m.clone().makeTranslation(center(p.c).x, HEIGHT / 2 - 0.05, center(p.c).z)] : []));
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
    inst(frameG, frameMat, (hotel ? [] : panels).map((p) => m.clone().makeTranslation(center(p.c).x, HEIGHT - 0.035, center(p.c).z))).receiveShadow = true;

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
    const grandoors: Maze['props'] = [], stairsAt: { x: number; z: number }[] = [], suiteDoors: Maze['props'] = [], suiteFurn = new Map<PropKind, THREE.Matrix4[]>(), stands: THREE.Matrix4[] = [], lampMs: THREE.Matrix4[] = [];
    /** Un Faceling de pie en (x, z), de cara a (dx, dz) (el modelo mira a +z). */
    const addStaff = (x: number, z: number, dx: number, dz: number) => {
      const rig = new Rig(assets.gltf['suites/faceling']), h = new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3()).y, g = new THREE.Group();
      rig.root.scale.setScalar(1.75 / h);
      g.add(rig.root);
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(dx, dz);
      rig.action('idle')?.play();
      this.root.add(g);
      this.staff.push(rig);
      this.blockers.push({ x, z, r: 0.3 });
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
      else if (p.kind === 'grandoor') { grandoors.push(p); continue; }
      else if (p.kind === 'exit') continue; // va con el ascensor
      else if (p.kind === 'stairs') { stairsAt.push(c); continue; }
      else if (p.kind === 'cart') {
        const g = serviceProp(p.kind);
        g.position.set(c.x + (p.off?.[0] ?? 0), 0, c.z + (p.off?.[1] ?? 0));
        g.rotation.y = Math.atan2(dx, dy);
        this.root.add(g);
        for (const t of [-0.3, 0.3]) this.blockers.push({ x: g.position.x + t * Math.cos(g.rotation.y), z: g.position.z - t * Math.sin(g.rotation.y), r: 0.42 });
        continue;
      }
      else if (p.kind === 'faceling') {
        const fx = c.x + (p.off?.[0] ?? 0), fz = c.z + (p.off?.[1] ?? 0); // un Faceling suelto: su "mostrador" es el aire que tiene delante (la tienda funciona igual)
        this.counters.push({ x: fx + dx * 0.95, z: fz + dy * 0.95, dx, dy });
        addStaff(fx, fz, dx, dy);
        continue;
      }
      else if (p.kind === 'nightstand' || p.kind === 'tlamp') {
        const ry = Math.atan2(dx, dy), pos = new THREE.Vector3(c.x + (p.off?.[0] ?? 0), 0, c.z + (p.off?.[1] ?? 0));
        if (p.kind === 'nightstand') (stands.push(place(pos.clone().setY(0.25), ry)), lampMs.push(place(pos.clone().setY(0.5), ry)), this.blockers.push({ x: pos.x, z: pos.z, r: 0.26 }));
        else lampMs.push(place(pos.clone().setY(0.9), ry));
        continue;
      }
      else if (SUITE_PROPS[p.kind]) {
        const t = SUITE_PROPS[p.kind]!, ry = Math.atan2(dx, dy) + (t.turn ?? 0), pos = new THREE.Vector3(c.x + (p.off?.[0] ?? 0), t.mount ?? 0, c.z + (p.off?.[1] ?? 0));
        suiteFurn.set(p.kind, [...(suiteFurn.get(p.kind) ?? []), place(pos, ry, 1)]);
        if (p.kind === 'panel') {
          const gi = Math.max(0, maze.gens?.findIndex((q) => q.y === p.cell.y && (q.x - p.cell.x) % SUITE_L === 0) ?? 0); // (qué cuadro es: sus luces las comparten las tres copias)
          this.genLeds[gi] ??= new THREE.MeshBasicMaterial({ color: 0xff3322 });
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), this.genLeds[gi]);
          lamp.position.set(pos.x + dx * 0.14, 1.88, pos.z + dy * 0.14);
          lamp.rotation.y = ry;
          this.root.add(lamp);
        }
        if (p.kind === 'reception') {
          this.counters.push({ x: pos.x, z: pos.z, dx, dy });
          addStaff(pos.x - dx * 0.95, pos.z - dy * 0.95, dx, dy); // el Faceling de recepción, detrás del mostrador
        }
        for (const [lx, lz] of t.at ?? []) this.blockers.push({ x: pos.x + lx * Math.cos(ry) + lz * Math.sin(ry), z: pos.z - lx * Math.sin(ry) + lz * Math.cos(ry), r: t.r! });
        continue;
      } else if (p.kind === 'suitedoor' || (hotel && (p.kind === 'door' || p.kind === 'steeldoor'))) {
        suiteDoors.push(p);
        continue;
      }
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
    for (const [k, ms] of byKind) for (const im of instanced(assets.gltf[k as Exclude<PropKind, 'suitedoor' | 'bed' | 'sofa' | 'luggage' | 'bin' | 'mirror' | 'plant' | 'nightstand' | 'tlamp' | 'wardrobe' | 'wingchair' | 'bistro' | 'reception' | 'stairs' | 'steeldoor' | 'grandoor' | 'faceling' | 'trolley' | 'cart' | 'panel'>].scene, ms, fix(k))) (im.receiveShadow = true), (im.castShadow = k === 'cabinet' || k === 'shelf' || k === 'desk'), this.root.add(im);

    // la puerta doble del vestíbulo (dos hojas de caoba con paneles y tiradores de latón, en un marco con dintel): cada celda lleva su hoja; se abren juntas
    if (grandoors.length) {
      const wood = new THREE.MeshStandardMaterial({ color: 0x3d1d12, roughness: 0.42, metalness: 0.05 }), panel = new THREE.MeshStandardMaterial({ color: 0x55291a, roughness: 0.38 });
      const brassD = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.75, roughness: 0.3 }), trim = new THREE.MeshStandardMaterial({ color: 0xefe6d0, roughness: 0.5 });
      [wood, panel, brassD, trim].forEach((m) => lightmapped(m));
      const sc = Object.assign(document.createElement('canvas'), { width: 256, height: 48 }), sx = sc.getContext('2d')!;
      sx.fillStyle = '#c9a24a';
      sx.fillRect(0, 0, 256, 48);
      sx.fillStyle = '#2a1d08';
      sx.font = 'bold 28px serif';
      sx.textAlign = 'center';
      sx.textBaseline = 'middle';
      sx.fillText('LAS SUITES', 128, 26);
      const stx = new THREE.CanvasTexture(sc);
      stx.colorSpace = THREE.SRGBColorSpace;
      const box = (g: THREE.Group, bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material) => {
        const o = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
        o.position.set(x, y, z);
        o.castShadow = o.receiveShadow = true;
        g.add(o);
        return o;
      };
      grandoors.forEach((p, i) => {
        const c = center(p.cell), left = i % 2 === 0, g = new THREE.Group(); // (el de la celda de arriba es la hoja izquierda mirando hacia el pasillo)
        g.position.set(c.x + CELL / 2, 0, c.z); // el plano de la puerta: el borde de la celda hacia el salón (z local = hacia el salón)
        g.rotation.y = Math.PI / 2;
        // el marco: jambas y dintel de moldura clara a todo el ancho de la celda (la mitad del hueco) y encima el rótulo, solo en la primera
        const outer = left ? 1 : -1, sideX = outer * (CELL / 2 - 0.06); // (local +x = norte)
        box(g, 0.12, 2.5, 0.3, sideX, 1.25, -0.1, trim);
        box(g, CELL, 0.3, 0.3, 0, 2.55, -0.1, trim);
        // la hoja, con su gozne en la jamba exterior: tablero, dos paneles en relieve y un tirador de latón en el canto del centro
        const piv = new THREE.Group(), lw = CELL - 0.16, dir = -outer; // la hoja se extiende hacia el centro del hueco
        piv.position.set(sideX, 0, 0);
        const leaf = new THREE.Group();
        leaf.position.set(dir * (lw / 2 + 0.06), 0, 0);
        box(leaf, lw, 2.4, 0.06, 0, 1.2, 0, wood);
        for (const py of [0.85, 1.75]) box(leaf, lw - 0.36, py === 0.85 ? 1.15 : 0.8, 0.02, 0, py, 0.035, panel);
        const handle = box(leaf, 0.05, 0.5, 0.05, dir * (lw / 2 - 0.12), 1.1, 0.07, brassD);
        handle.castShadow = false;
        piv.add(leaf);
        g.add(piv);
        if (left) {
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.2), new THREE.MeshBasicMaterial({ map: stx }));
          plate.position.set(-outer * CELL / 2, 2.55, 0.06);
          g.add(plate);
        }
        this.root.add(g);
        this.grandGroups.push(g);
        this.sealWall = () => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, HEIGHT, 2 * CELL), wallMat);
          m.position.set((p.cell.x + 0.5) * CELL, HEIGHT / 2, (grandoors[0].cell.y + 1) * CELL);
          this.root.add(m);
        };
        this.doors.push({ x: c.x + CELL / 2, z: c.z, nx: 1, nz: 0, cell: p.cell.y * w + p.cell.x, cur: 0, tgt: 0, grand: true, swing: (k) => (piv.rotation.y = dir * 1.6 * k) });
      });
    }
    // el vestíbulo es un edificio normal (techo plano), con una gran cúpula de cristal en el centro (sobre un hueco de 9 × 9 m) y, al otro lado, un cielo que no es de este mundo
    if (hotel) {
      const XM = (SUITE_L * 3 + 7) * CELL, ZM = 9 * CELL, HA = 4.5, HD = 3.2, N = 24; // centro y media anchura del hueco; altura de la cúpula
      const dome = (u: number, v: number) => new THREE.Vector3(XM + u * HA, HEIGHT + HD * Math.cos((Math.PI * u) / 2) * Math.cos((Math.PI * v) / 2), ZM + v * HA);
      const pos: number[] = [], idx: number[] = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(...dome(-1 + (2 * i) / N, -1 + (2 * j) / N).toArray());
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      gg.setIndex(idx);
      const glass = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0xbfd2ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      glass.renderOrder = 3;
      this.root.add(glass);
      const brassV = new THREE.MeshStandardMaterial({ color: 0xb8923a, metalness: 0.75, roughness: 0.35 });
      lightmapped(brassV);
      // las costillas (cada 1,125 m en los dos sentidos) y el reborde que la une al techo
      for (let k = 0; k <= 8; k++) {
        const t = -1 + k / 4;
        for (const alongU of [true, false]) {
          const pts = Array.from({ length: N + 1 }, (_, i) => dome(alongU ? -1 + (2 * i) / N : t, alongU ? t : -1 + (2 * i) / N));
          this.root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 6), brassV));
        }
      }
      for (const [bx, bz, bw, bd] of [[XM, ZM - HA, 2 * HA + 0.3, 0.3], [XM, ZM + HA, 2 * HA + 0.3, 0.3], [XM - HA, ZM, 0.3, 2 * HA], [XM + HA, ZM, 0.3, 2 * HA]] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.16, bd), brassV);
        m.position.set(bx, HEIGHT + 0.05, bz);
        this.root.add(m);
      }
      // el cielo: una esfera enorme que solo se ve por la cúpula (el techo la tapa en el resto). Degradado enfermizo, una luna gigante con anillo, cortinas de aurora y estrellas
      const sky = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 } },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          varying vec3 vD; uniform float uT;
          float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            vec3 d = normalize(vD); float el = clamp(d.y, 0.0, 1.0);
            vec3 col = mix(vec3(0.72, 0.88, 1.0), vec3(0.16, 0.46, 0.92), pow(el, 0.6)); // azul de postal: demasiado limpio para ser verdad
            vec2 p = d.xz / (d.y + 0.25) * 1.6 + vec2(uT * 0.004, 0.0); // nubes planas de dibujo, casi quietas
            float c = smoothstep(0.55, 0.62, n(p * 1.3) * 0.65 + n(p * 3.1) * 0.35);
            col = mix(col, vec3(1.0), c * 0.9 * smoothstep(0.05, 0.3, el));
            col = floor(col * 9.0 + 0.5) / 9.0; // posterizado: se ven las bandas
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      this.skyMat = sky;
      const dm = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), sky);
      dm.position.set(XM, HEIGHT, ZM);
      dm.renderOrder = -10;
      dm.frustumCulled = false;
      this.root.add(dm);
      // la luz que baja por la cúpula: haces verdosos y manchas claras en el suelo
      const gc = Object.assign(document.createElement('canvas'), { width: 64, height: 128 }), gx = gc.getContext('2d')!, gr = gx.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(225,240,255,0.22)'), gr.addColorStop(1, 'rgba(225,240,255,0)');
      gx.fillStyle = gr;
      gx.fillRect(0, 0, 64, 128);
      const hx = gx.createLinearGradient(0, 0, 64, 0);
      hx.addColorStop(0, 'rgba(0,0,0,1)'), hx.addColorStop(0.5, 'rgba(0,0,0,0)'), hx.addColorStop(1, 'rgba(0,0,0,1)');
      gx.globalCompositeOperation = 'destination-out';
      gx.fillStyle = hx;
      gx.fillRect(0, 0, 64, 128);
      const beamM = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 });
      const pc = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), px = pc.getContext('2d')!, pg = px.createRadialGradient(32, 32, 0, 32, 32, 32);
      pg.addColorStop(0, 'rgba(225,240,255,0.25)'), pg.addColorStop(0.7, 'rgba(225,240,255,0.08)'), pg.addColorStop(1, 'rgba(225,240,255,0)');
      px.fillStyle = pg;
      px.fillRect(0, 0, 64, 64);
      const patchM = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const floorPatch = new THREE.Mesh(new THREE.PlaneGeometry(2 * HA + 2, 2 * HA + 2).rotateX(-Math.PI / 2), patchM);
      floorPatch.position.set(XM, 0.012, ZM);
      floorPatch.renderOrder = 2;
      this.root.add(floorPatch);
      // motas de polvo flotando en la luz fría de la cúpula, y la mancha del suelo respira
      const mp = new Float32Array(300 * 3).map((_, i) => (i % 3 === 1 ? Math.random() * HEIGHT : (Math.random() * 2 - 1) * HA * 1.2));
      const mg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(mp, 3));
      const motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xe6f0ff, size: 0.012, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      motes.position.set(XM, 0, ZM);
      motes.frustumCulled = false;
      this.root.add(motes);
      this.hallFx = (t) => {
        motes.rotation.y = t * 0.02;
        motes.position.y = Math.sin(t * 0.15) * 0.15;
        patchM.opacity = 0.8 + 0.2 * Math.sin(t * 0.4);
      };
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4, beam = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 4.6), beamM);
        beam.position.set(XM + Math.cos(a) * 1.8, 2.3, ZM + Math.sin(a) * 1.8);
        beam.rotation.set(0, -a + Math.PI / 2, 0);
        beam.renderOrder = 2;
        this.root.add(beam);
      }
    }
    // la escalera de servicio (solo personal): de hormigón, con las paredes pintadas de claro y un zócalo oscuro, barandillas de tubo y los carteles de planta y salida.
    // Es de verdad: un tramo de 9 peldaños sube por la izquierda a un descansillo, y otro vuelve por la derecha hasta un rellano a una planta de altura (2,7 m), en un hueco alto.
    // Se pisa peldaño a peldaño (ver floorAt); arriba del todo, con la misión hecha, se pasa de planta
    if (stairsAt.length) {
      const FL = maze.floor ?? 1;
      const ct = concreteTex(), conc = new THREE.MeshStandardMaterial({ map: ct.map, bumpMap: ct.bump, bumpScale: 2.4, roughness: 0.96 });
      const paint = conc.clone(), dado = conc.clone(), rail = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.8, roughness: 0.38 });
      paint.color.set(0xe2e0d6);
      dado.color.set(0x77766f);
      [conc, paint, dado, rail].forEach((m) => lightmapped(m));
      [conc, paint, dado].forEach((m) => ((m.emissiveMap = m.map), m.emissive.set(0x8a826e))); // (el hueco es alto y sin focos: luz propia, que se vea la escalera)
      const RISE = 0.15, TREAD = 0.3, N = 9, Z0 = 7.5, ZT = Z0 - N * TREAD, H1 = RISE * N, TOP = 2 * H1, HW = 2.25, SH = 2 * HEIGHT + 0.3; // SH: el techo del hueco
      const tiled = (g: THREE.BufferGeometry, w: number, h: number) => (g.attributes.uv.array.forEach((_, i, a) => (a[i] *= (i % 2 ? h : w) / 1.5)), g);
      const signTex = (txt: string, bg: string, size = 30) => {
        const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 96 }), g = cv.getContext('2d')!;
        g.fillStyle = bg;
        g.fillRect(0, 0, 256, 96);
        g.strokeStyle = '#f2f2ea';
        g.lineWidth = 4;
        g.strokeRect(4, 4, 248, 88);
        g.fillStyle = '#f2f2ea';
        g.font = `bold ${size}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(txt, 128, 50);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: t });
      };
      const floorSign = (n: number) => signTex(`FLOOR ${n}`, '#0c3a22'), staffSign = signTex('STAFF ONLY', '#6a1c14'), exitSign = signTex('EXIT', '#0f6a35', 44);
      const floorNum = (n: number) => {
        const cv = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = cv.getContext('2d')!;
        g.fillStyle = '#1b2f86';
        g.fillRect(0, 0, 128, 128);
        g.strokeStyle = '#f2f2ea';
        g.lineWidth = 5;
        g.strokeRect(6, 6, 116, 116);
        g.fillStyle = '#f2f2ea';
        g.font = 'bold 96px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(n), 64, 68);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: t });
      };
      const _u = new THREE.Vector3(0, 1, 0);
      const LV = 5, base = (k: number) => -(FL - 1) * TOP + k * TOP; // el suelo del nivel k (0-4: las plantas 1-5; el 5, la azotea): la planta de ahora queda a y = 0
      const y0 = base(0), SHT = base(LV) + TOP + 0.3, WH = SHT - y0; // el hueco va del suelo de la planta 1 al techo de la azotea
      for (const c of stairsAt) {
        // todo el hueco se funde por material al final (eran ~1000 mallas por escalera: un dibujo cada una)
        const bucket = new Map<THREE.Material, THREE.BufferGeometry[]>();
        const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, mat: THREE.Material = conc, q?: THREE.Quaternion) => {
          g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q ?? new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
          bucket.set(mat, [...(bucket.get(mat) ?? []), g.index ? g : g.toNonIndexed()]);
        };
        /** Un tubo de metal entre dos puntos. */
        const bar = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r = 0.02) => {
          const d = new THREE.Vector3(bx - ax, by - ay, bz - az);
          add(new THREE.CylinderGeometry(r, r, d.length(), 8), (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rail, new THREE.Quaternion().setFromUnitVectors(_u, d.normalize()));
        };
        /** Una barandilla sobre la línea de peldaños: pasamanos y barra intermedia, y barrotes cada 45 cm. `y(z)`: la altura del suelo bajo ella. */
        const guard = (x: number, zA: number, zB: number, y: (z: number) => number) => {
          bar(x, y(zA) + 0.95, zA, x, y(zB) + 0.95, zB, 0.026);
          bar(x, y(zA) + 0.5, zA, x, y(zB) + 0.5, zB, 0.014);
          const n = Math.max(2, Math.round(Math.abs(zA - zB) / 0.45));
          for (let i = 0; i <= n; i++) {
            const z = zA + ((zB - zA) * i) / n;
            bar(x, y(z), z, x, y(z) + 0.95, z, 0.012);
          }
        };
        const xl = c.x - 1.5, xr = c.x + 1.5; // el centro de la columna del primer tramo (sube al norte) y el del segundo (vuelve al sur)
        const steel = new THREE.MeshStandardMaterial({ color: 0x55695c, metalness: 0.5, roughness: 0.5, emissive: 0x1d2a22 });
        lightmapped(steel);
        // un nivel por planta, apilados: tramo izquierdo (sube al norte), descansillo, tramo derecho (vuelve al sur) y el rellano de la planta de arriba, con su puerta
        for (let k = 0; k < LV; k++) {
          const b = base(k), hL = (z: number) => b + (z <= ZT ? H1 : z >= Z0 ? 0 : RISE * Math.ceil((Z0 - z) / TREAD)), hR = (z: number) => b + (z <= ZT ? H1 : z >= Z0 ? TOP : H1 + RISE * Math.ceil((z - ZT) / TREAD));
          for (let i = 1; i <= N; i++) {
            add(tiled(new THREE.BoxGeometry(CELL, 0.3, TREAD), CELL, 0.3), xl, b + RISE * i - 0.15, Z0 - TREAD * (i - 0.5)); // peldaños como losas
            add(tiled(new THREE.BoxGeometry(CELL, 0.3, TREAD), CELL, 0.3), xr, b + H1 + RISE * i - 0.15, ZT + TREAD * (i - 0.5));
          }
          add(tiled(new THREE.BoxGeometry(2 * HW, 0.3, ZT - 1.5), 2 * HW, 0.3), c.x, b + H1 - 0.15, (ZT + 1.5) / 2); // el descansillo
          guard(c.x - 0.78, Z0 - 0.05, ZT + 0.05, hL);
          guard(c.x + 0.78, ZT + 0.05, Z0 - 0.05, hR);
          bar(c.x - 0.78, b + H1 + 0.95, ZT + 0.1, c.x + 0.78, b + H1 + 0.95, ZT + 0.1, 0.026);
          bar(c.x - 0.78, b + H1 + 0.5, ZT + 0.1, c.x + 0.78, b + H1 + 0.5, ZT + 0.1, 0.014);
          add(new THREE.PlaneGeometry(0.62, 0.62), c.x, b + H1 + 1.7, 1.52, floorNum(k + 1)); // el número de la planta de este nivel, como en las escaleras de verdad
        }
        for (let k = 0; k <= LV; k++) {
          const b = base(k);
          if (k !== FL - 1) add(tiled(new THREE.BoxGeometry(2 * HW, 0.3, 10.5 - Z0), 2 * HW, 0.3), c.x, b - 0.15, (Z0 + 10.5) / 2); // el rellano de la planta (el de la planta de ahora es el suelo de siempre)
          if (k < LV && k !== FL - 1) {
            // la puerta de esa planta: la de servicio de verdad (el modelo de las puertas del hotel, de acero), que se abre con G solo si la misión está cumplida
            const ds = assets.gltf['suites/door'].scene, db = new THREE.Box3().setFromObject(ds), dk = 2.1 / (db.max.y - db.min.y), dmid = db.getCenter(new THREE.Vector3()), dd = ds.clone(true), dg = new THREE.Group();
            dd.scale.setScalar(dk);
            dd.position.set(-dmid.x * dk, -db.min.y * dk - 0.015, -db.max.z * dk);
            dd.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              const dm = (mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone()) as THREE.MeshStandardMaterial;
              dm.color.set(0x7d858b);
              Object.assign(dm, { metalness: 0.7, roughness: 0.38 });
              lightmapped(dm);
            });
            dg.add(dd);
            dg.position.set(xr, b, 10.5);
            this.root.add(dg);
            this.doors.push({ x: xr, z: 10.5, nx: 0, nz: -1, leaf: (dd.getObjectByName('Plane001') ?? dd.getObjectByName('Plane.001')) ?? undefined, cell: -1, cur: 0, tgt: 0, y: b, stair: k + 1 });
            add(new THREE.PlaneGeometry(1.2, 0.45).rotateY(Math.PI), xr, b + 2.35, 10.49, floorSign(k + 1));
            this.stairDoors.push({ n: k + 1, x: xr, z: 10.3, y: b });
          }
          if (k < LV) (bar(c.x - 0.78, b + 0.95, Z0 + 0.05, c.x + 0.78, b + 0.95, Z0 + 0.05, 0.026), bar(c.x - 0.78, b + 0.5, Z0 + 0.05, c.x + 0.78, b + 0.5, Z0 + 0.05, 0.014)); // la barandilla del borde del hueco
        }
        // el cuarto: suelo, techo alto y paredes pintadas con su zócalo
        add(tiled(new THREE.PlaneGeometry(2 * HW, 3).rotateX(-Math.PI / 2), 2 * HW, 3), c.x, 0.006, (Z0 + 10.5) / 2);
        if (FL > 1) add(tiled(new THREE.PlaneGeometry(2 * HW, Z0 - 1.5).rotateX(-Math.PI / 2), 2 * HW, Z0 - 1.5), c.x, y0 + 0.006, (Z0 + 1.5) / 2); // el fondo del hueco
        else add(tiled(new THREE.PlaneGeometry(CELL, Z0 - 1.5).rotateX(-Math.PI / 2), CELL, Z0 - 1.5), c.x, 0.006, (Z0 + 1.5) / 2);
        add(tiled(new THREE.PlaneGeometry(2 * HW, 9).rotateX(Math.PI / 2), 2 * HW, 9), c.x, SHT - 0.006, 6, paint);
        for (let k = 0; k <= LV; k++) for (const z of [3.4, 8.2]) add(new THREE.PlaneGeometry(1.5, 0.5).rotateX(Math.PI / 2), c.x, base(k) + TOP - 0.016, z, new THREE.MeshBasicMaterial({ color: 0xfff2d0 })); // los plafones de cada nivel
        for (const [sx, rot] of [[-1, Math.PI / 2], [1, -Math.PI / 2]] as const) {
          add(tiled(new THREE.PlaneGeometry(9, WH).rotateY(rot), 9, WH), c.x + sx * (HW - 0.006), y0 + WH / 2, 6, paint);
          for (let k = 0; k <= LV; k++) add(tiled(new THREE.PlaneGeometry(9, 1.05).rotateY(rot), 9, 1.05), c.x + sx * (HW - 0.012), base(k) + 0.525, 6, dado);
        }
        add(tiled(new THREE.PlaneGeometry(2 * HW, WH), 2 * HW, WH), c.x, y0 + WH / 2, 1.506, paint);
        add(tiled(new THREE.PlaneGeometry(2 * HW, SHT - HEIGHT).rotateY(Math.PI), 2 * HW, SHT - HEIGHT), c.x, (SHT + HEIGHT) / 2, 10.494, paint); // sobre la pared de la puerta
        if (FL > 1) add(tiled(new THREE.PlaneGeometry(2 * HW, -y0).rotateY(Math.PI), 2 * HW, -y0), c.x, y0 / 2, 10.494, paint); // y bajo el suelo de la planta de ahora
        add(new THREE.PlaneGeometry(0.9, 0.34), c.x, 1.8, 1.52, staffSign);
        add(new THREE.PlaneGeometry(0.5, 0.19), c.x, 2.5, 1.52, exitSign);
        // lo que no se pisa: el borde del hueco entre los dos tramos (para no caer ni colarse)
        for (let z = ZT + 0.1; z < Z0 + 0.1; z += 0.45) (this.blockers.push({ x: c.x - 0.75, z, r: 0.3 }), this.blockers.push({ x: c.x + 0.75, z, r: 0.3 }));
        for (let x = c.x - 0.75; x <= c.x + 0.76; x += 0.375) this.blockers.push({ x, z: Z0 - 0.05, r: 0.3 });
        for (const [mat, gs] of bucket) {
          const m = new THREE.Mesh(mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)))!, mat);
          m.receiveShadow = true;
          m.castShadow = mat === rail;
          this.root.add(m);
        }
        this.stairs.push({ xl: c.x - HW, xm0: c.x - 0.75, xm1: c.x + 0.75, xr: c.x + HW, z0: 1.5, z1: 10.5, ZT, Z0, RISE, H1, TOP, y0, LV });
      }
    }
    // las mesillas de noche y las lámparas de mesa (hechas aquí: una caja de madera, una base de latón y una pantalla que brilla)
    if (stands.length || lampMs.length) {
      const woodM = new THREE.MeshStandardMaterial({ color: 0x4a2616, roughness: 0.45, metalness: 0.05 }), brassL = new THREE.MeshStandardMaterial({ color: 0xb8923a, metalness: 0.7, roughness: 0.35 }), shadeM = new THREE.MeshStandardMaterial({ color: 0xf1dcae, emissive: 0xffc47a, emissiveIntensity: 0.55, roughness: 0.9, side: THREE.DoubleSide });
      lightmapped(woodM), lightmapped(brassL);
      if (stands.length) {
        const body = mergeGeometries([new THREE.BoxGeometry(0.46, 0.5, 0.4).toNonIndexed(), new THREE.BoxGeometry(0.5, 0.03, 0.44).translate(0, 0.265, 0).toNonIndexed()])!;
        Object.assign(inst(body, woodM, stands), { castShadow: true, receiveShadow: true });
      }
      inst(mergeGeometries([new THREE.CylinderGeometry(0.07, 0.09, 0.03, 14).translate(0, 0.015, 0), new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8).translate(0, 0.14, 0)].map((g) => g.toNonIndexed()))!, brassL, lampMs);
      inst(new THREE.CylinderGeometry(0.1, 0.17, 0.2, 16, 1, true).translate(0, 0.3, 0), shadeM, lampMs);
    }
    // el mobiliario de las suites, a su medida (cada modelo se normaliza: centrado, apoyado en el suelo o colgado, y escalado por el lado que importa)
    for (const [kind, ms] of suiteFurn) {
      const t = SUITE_PROPS[kind]!, src = assets.gltf[t.key].scene, box = new THREE.Box3().setFromObject(src), sz = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3()), k = t.size / sz[t.axis];
      const norm = new THREE.Group(), inner = src.clone(true);
      inner.scale.setScalar(k);
      inner.position.set(-mid.x * k, t.mount !== undefined ? -mid.y * k : -box.min.y * k, -mid.z * k);
      if (kind === 'mirror') {
        // el modelo trae solo los cristales (con una textura de prueba): se pintan con un reflejo falso, y se les pone un marco dorado detrás
        const gc = Object.assign(document.createElement('canvas'), { width: 64, height: 128 }), gx = gc.getContext('2d')!, gr = gx.createLinearGradient(0, 0, 64, 128);
        gr.addColorStop(0, '#9fb4b8'), gr.addColorStop(0.45, '#5d7479'), gr.addColorStop(1, '#2b3a3e');
        gx.fillStyle = gr;
        gx.fillRect(0, 0, 64, 128);
        gx.fillStyle = 'rgba(255,255,255,0.22)';
        for (const [o, wd] of [[10, 8], [34, 3]]) (gx.beginPath(), gx.moveTo(o, 0), gx.lineTo(o + wd, 0), gx.lineTo(o + wd - 40, 128), gx.lineTo(o - 40, 128), gx.fill());
        const glass = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc) }), gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.65, roughness: 0.35 });
        lightmapped(gold);
        inner.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material = glass)));
        const frame = inner.clone(true);
        frame.scale.setScalar(k * 1.1);
        frame.position.set(-mid.x * k * 1.1, -mid.y * k * 1.1, -mid.z * k * 1.1 - 0.012);
        frame.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material = gold)));
        norm.add(frame);
      }
      norm.add(inner);
      for (const im of instanced(norm, ms, (mat) => ((mat.side = THREE.DoubleSide), t.tint && (mat as THREE.MeshStandardMaterial).color.set(t.tint), lightmapped(mat)), this.hotel)) ((im.receiveShadow = kind !== 'wardrobe'), (im.castShadow = kind === 'bed' || kind === 'sofa'), this.root.add(im)); // (el armario, de dos caras y casi cerrado, se rayaba con sus propias sombras)
    }

    // las puertas de las suites (Las Suites), blancas con su moldura. Cerradas: a ras de la cara de la pared. Abiertas: la hoja girada hacia dentro y el hueco enmarcado
    // con jambas blancas (así no queda ninguna puerta pegada al aire)
    if (suiteDoors.length) {
      const src = assets.gltf['suites/door'].scene, bb0 = new THREE.Box3().setFromObject(src), k = 2.1 / (bb0.max.y - bb0.min.y), mid0 = bb0.getCenter(new THREE.Vector3()), dw = (bb0.max.x - bb0.min.x) * k;
      const white = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.6 }), brassM = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.5, metalness: 0.5 });
      const steelM = new THREE.MeshStandardMaterial({ color: 0x6c7278, metalness: 0.75, roughness: 0.4 }); // las puertas de servicio: de acero
      lightmapped(white), lightmapped(steelM);
      const jw = (CELL - dw) / 2; // lo que llena la jamba a cada lado del hueco de la puerta
      for (const p of suiteDoors) {
        const steel = p.kind === 'steeldoor', open = p.kind !== 'suitedoor', frameM = steel ? steelM : white, d = src.clone(true), c = center(p.cell), [dx, dy] = DIRS[p.rot] ?? DIRS[0], g = new THREE.Group();
        d.scale.set(k, k, open ? k : k * 0.3); // cerrada: aplastada de fondo, el marco no sale del tabique
        d.position.set(-mid0.x * k, -bb0.min.y * k - 0.015, -bb0.max.z * k * (open ? 1 : 0.3));
        d.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            const dm = (mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone()) as THREE.MeshStandardMaterial; // (propio: la de acero no tiñe las blancas)
            dm.color.set(steel ? 0x7d858b : 0xfaf6ee);
            if (steel) Object.assign(dm, { metalness: 0.7, roughness: 0.38 });
            lightmapped(dm);
            mesh.receiveShadow = true;
          }
        });
        g.add(d);
        if (open) {
          const leaf = d.getObjectByName('Plane001') ?? d.getObjectByName('Plane.001');
          this.doors.push({ x: c.x + dx * (CELL / 2), z: c.z + dy * (CELL / 2), nx: dx, nz: dy, leaf: leaf ?? undefined, cell: p.cell.y * w + p.cell.x, cur: 0, tgt: 0 }); // (cerrada al empezar)
          for (const sx of [-1, 1]) {
            const jam = new THREE.Mesh(new THREE.BoxGeometry(jw, HEIGHT, 0.3), frameM);
            jam.position.set(sx * (dw / 2 + jw / 2), HEIGHT / 2, -0.15);
            g.add(jam);
          }
          const head = new THREE.Mesh(new THREE.BoxGeometry(CELL, HEIGHT - 2.1, CELL), frameM);
          head.position.set(0, (HEIGHT + 2.1) / 2, -CELL / 2);
          g.add(head);
        } else {
          for (const [bw, bh, bx, by] of [[0.09, 2.2, -(dw / 2 + 0.045), 1.1], [0.09, 2.2, dw / 2 + 0.045, 1.1], [dw + 0.18, 0.09, 0, 2.145]] as const) {
            const m2 = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.07), white);
            m2.position.set(bx, by, -0.02);
            g.add(m2);
          }
          const sill = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.18, 0.012, 0.09), brassM); // el umbral
          sill.position.set(0, 0.006, 0);
          g.add(sill);
        }
        const cv = Object.assign(document.createElement('canvas'), { width: 128, height: 64 }), x = cv.getContext('2d')!;
        x.fillStyle = '#b8923a';
        x.fillRect(0, 0, 128, 64);
        x.strokeStyle = '#6e5420';
        x.lineWidth = 4;
        x.strokeRect(2, 2, 124, 60);
        x.fillStyle = '#2a1d08';
        x.font = 'bold 40px serif';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(String((this.maze.floor ?? 1) * 100 + (p.cell.y > 9 ? 50 : 0) + ((p.cell.x % SUITE_L) / SUITE_UNIT | 0) + 1), 64, 34);
        const tx = new THREE.CanvasTexture(cv);
        tx.colorSpace = THREE.SRGBColorSpace;
        const bc = Object.assign(document.createElement('canvas'), { width: 128, height: 64 }), bx = bc.getContext('2d')!; // relieve: el número y el borde salen
        bx.fillStyle = '#505050';
        bx.fillRect(0, 0, 128, 64);
        bx.strokeStyle = '#e0e0e0';
        bx.lineWidth = 4;
        bx.strokeRect(2, 2, 124, 60);
        bx.fillStyle = '#ffffff';
        bx.font = 'bold 40px serif';
        bx.textAlign = 'center';
        bx.textBaseline = 'middle';
        bx.fillText(String((this.maze.floor ?? 1) * 100 + (p.cell.y > 9 ? 50 : 0) + ((p.cell.x % SUITE_L) / 5 | 0) + 1), 64, 34);
        const pm = new THREE.MeshStandardMaterial({ map: tx, bumpMap: new THREE.CanvasTexture(bc), bumpScale: 3, metalness: 0.5, roughness: 0.4 });
        lightmapped(pm);
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), pm);
        plate.position.set(open ? dw / 2 + jw / 2 : 0, open ? 1.5 : 1.66, open ? 0.01 : 0.04); // abierta: en la jamba
        if (steel) {
          // en vez del número, un cartel rojo sobre el marco
          const sc = Object.assign(document.createElement('canvas'), { width: 256, height: 64 }), sx = sc.getContext('2d')!;
          sx.fillStyle = '#7a1a12';
          sx.fillRect(0, 0, 256, 64);
          sx.strokeStyle = '#f2f2ea';
          sx.lineWidth = 4;
          sx.strokeRect(3, 3, 250, 58);
          sx.fillStyle = '#f2f2ea';
          sx.font = 'bold 34px sans-serif';
          sx.textAlign = 'center';
          sx.textBaseline = 'middle';
          sx.fillText('STAFF ONLY', 128, 34);
          const st = new THREE.CanvasTexture(sc);
          st.colorSpace = THREE.SRGBColorSpace;
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.175), new THREE.MeshBasicMaterial({ map: st }));
          sign.position.set(0, 2.4, 0.012);
          g.add(sign);
        } else if (p.cell.x < SUITE_L * 3) g.add(plate); // (la puerta doble del vestíbulo no lleva número)
        if (open) {
          g.position.set(c.x + dx * (CELL / 2), 0, c.z + dy * (CELL / 2));
          g.rotation.y = Math.atan2(dx, dy); // +z local, hacia el pasillo
        } else {
          g.position.set(c.x + dx * (CELL / 2 - 0.05), 0, c.z + dy * (CELL / 2 - 0.05));
          g.rotation.y = Math.atan2(-dx, -dy);
        }
        if (p.cell.x < SUITE_L * 3) this.doorGroups.push(g); // (las del hotel se ocultan lejos de la vista)
        this.root.add(g);
        if (open) {
          g.updateMatrixWorld(true);
          for (const sx of [-1, 1]) for (const z of [-0.2, -0.75, -1.3]) {
            const v = g.localToWorld(new THREE.Vector3(sx * (dw / 2 + jw / 2), 0, z));
            this.blockers.push({ x: v.x, z: v.z, r: jw / 2 }); // la jamba no se atraviesa
          }
        }
      }
    }

    // los apliques de pared (uno por tabique) y los carteles de salida del pasillo (el hotel): hechos aquí y con el cartel `exit` del juego
    if (hotel) {
      const brass = new THREE.MeshStandardMaterial({ color: 0xb8923a, metalness: 0.7, roughness: 0.35 }), glow = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
      const plateG = new THREE.BoxGeometry(0.09, 0.26, 0.03), shadeG = new THREE.CylinderGeometry(0.06, 0.1, 0.22, 12, 1, true).translate(0, 0.02, 0.1), armG = new THREE.BoxGeometry(0.03, 0.03, 0.1).translate(0, -0.08, 0.06);
      const wallAt = (x: number, row: number, f: (g: THREE.Group) => void) => {
        const south = row === 9, g = new THREE.Group(), c = center({ x, y: row });
        g.position.set(c.x, 0, c.z + (south ? CELL / 2 - 0.03 : -(CELL / 2 - 0.03)));
        g.rotation.y = south ? Math.PI : 0; // +z local, hacia el pasillo
        f(g);
        this.root.add(g);
      };
      for (let x = 0; x < cw; x++) {
        if (x % 8 === 4) for (const row of [8, 9]) wallAt(x, row, (g) => {
          const plate = new THREE.Mesh(plateG, brass), arm = new THREE.Mesh(armG, brass), shade = new THREE.Mesh(shadeG, glow);
          shade.material.side = THREE.DoubleSide;
          g.add(plate, arm, shade);
          g.children.forEach((o) => (o.position.y += 1.85));
        });
        if (x % SUITE_L === 8) wallAt(x, 8, (g) => {
          const sign = assets.gltf.exit.scene.clone(true);
          sign.scale.setScalar(2.2);
          sign.position.set(0, 2.32, 0.02);
          g.add(sign);
        });
      }
    }

    // el aire del hotel: el resplandor de cada aplique (un halo y la luz que sube por la pared) y motas de polvo a la luz
    if (hotel) {
      const rad = (stops: [number, string][], cw = 128, ch = 128) => {
        const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch }), x = c.getContext('2d')!, gr = x.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, cw / 2);
        stops.forEach(([o, col]) => gr.addColorStop(o, col));
        x.fillStyle = gr;
        x.fillRect(0, 0, cw, ch);
        return new THREE.CanvasTexture(c);
      };
      const glowMat = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
      const halo = glowMat(rad([[0, 'rgba(255,214,140,0.9)'], [0.25, 'rgba(255,190,110,0.35)'], [1, 'rgba(255,170,90,0)']])), wash = glowMat(rad([[0, 'rgba(255,200,120,0.55)'], [1, 'rgba(255,160,80,0)']]));
      const haloG = new THREE.PlaneGeometry(0.7, 0.7), washG = new THREE.PlaneGeometry(1.5, 2.4).translate(0, 0.9, 0);
      for (let x = 4; x < cw; x += 8)
        for (const row of [8, 9]) {
          const south = row === 9, c = center({ x, y: row }), z = c.z + (south ? CELL / 2 - 0.012 : -(CELL / 2 - 0.012)), hh = new THREE.Mesh(haloG, halo), ww = new THREE.Mesh(washG, wash);
          for (const o of [hh, ww]) (o.position.set(c.x, o === hh ? 1.9 : 1.35, z), (o.rotation.y = south ? Math.PI : 0), (o.renderOrder = 3), this.root.add(o));
        }
      // la luz del techo, de cornisa: dos tiras cálidas continuas en las esquinas del techo, que bañan el techo y la parte alta de las paredes
      const ramp = (a: number) => {
        const c = Object.assign(document.createElement('canvas'), { width: 4, height: 128 }), x = c.getContext('2d')!, gr = x.createLinearGradient(0, 0, 0, 128);
        gr.addColorStop(0, `rgba(255,205,140,${a})`);
        gr.addColorStop(0.35, `rgba(255,180,100,${a * 0.35})`);
        gr.addColorStop(1, 'rgba(255,160,80,0)');
        x.fillStyle = gr;
        x.fillRect(0, 0, 4, 128);
        return new THREE.CanvasTexture(c);
      };
      const addMat = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const L = cw * CELL, ceilWash = addMat(ramp(0.34)), wallWash = addMat(ramp(0.2)), coveM = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
      this.glow = { cove: coveM, ceil: ceilWash, wall: wallWash, halo, wash };
      for (const north of [true, false]) {
        const edge = north ? 12 : 15, sg = north ? 1 : -1;
        const cove = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.08).rotateX(Math.PI / 2), coveM); // la tira
        cove.position.set(L / 2, HEIGHT - 0.012, edge + sg * 0.2);
        const cw = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.3).rotateX(Math.PI / 2), ceilWash); // el baño del techo (más brillante junto al borde)
        cw.position.set(L / 2, HEIGHT - 0.008, edge + sg * 0.67);
        if (north) cw.rotation.y = Math.PI;
        const ww = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.1), wallWash); // el baño de la pared
        ww.position.set(L / 2, HEIGHT - 0.55, edge + sg * 0.014);
        if (!north) ww.rotation.y = Math.PI;
        for (const o of [cove, cw, ww]) ((o.renderOrder = 3), this.root.add(o));
      }
      // el polvo: motas de tamaños y fases distintos, que derivan despacio y solo se ven dentro del haz de cada foco (cada 3 m); lejos y pegadas a la cámara se funden
      const rooms = maze.rooms, N = 700 + rooms.length * 26, pos = new Float32Array(N * 3), seed = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const r = i >= 700 ? rooms[(i - 700) % rooms.length] : undefined; // el pasillo, y unas pocas motas por habitación
        pos.set(r ? [(r.x + Math.random() * r.w) * CELL, 0.2 + Math.random() * 2.3, (r.y + Math.random() * r.h) * CELL] : [Math.random() * cw * CELL, 0.2 + Math.random() * 2.3, 11.6 + Math.random() * 3.8], i * 3);
        seed[i] = Math.random();
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      this.dustMat = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          uniform float uT; attribute float aSeed; varying float vA;
          void main() {
            vec3 p = position + vec3(sin(uT * 0.21 + aSeed * 40.0) * 0.18 + uT * 0.012, sin(uT * 0.17 + aSeed * 23.0) * 0.1 - uT * 0.006 * aSeed, cos(uT * 0.19 + aSeed * 31.0) * 0.14);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float lamp = abs(mod(p.x - 0.75 + 1.5, 3.0) - 1.5);
            float cone = exp(-lamp * lamp * 1.6) * smoothstep(0.0, 1.2, p.y);
            float d = -mv.z;
            vA = (0.05 + 0.95 * cone) * smoothstep(1.2, 3.0, d) * (1.0 - smoothstep(8.0, 14.0, d)) * (0.4 + 0.6 * (0.5 + 0.5 * sin(uT * (0.7 + aSeed) + aSeed * 50.0)));
            gl_PointSize = (0.8 + aSeed * 1.2) * 11.0 / d;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vA;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * smoothstep(1.0, 0.0, r) * vA * 0.5, 1.0);
          }`,
      });
      this.dust = new THREE.Points(pg, this.dustMat);
      this.dust.frustumCulled = false;
      this.root.add(this.dust);
    }

    // el ascensor: su celda (un callejón) es la cabina, de metal; las puertas, en la boca de la celda
    // mirando afuera, con pared a los lados y encima. El modelo trae dos puertas juntas: se queda con una
    const exits = maze.props.filter((p) => p.kind === 'exit'), e = exits.find((p) => p.cell.x === maze.elevator.x && p.cell.y === maze.elevator.y) ?? exits[0];
    const [ox, oy] = DIRS[e.rot] ?? DIRS[0];
    this.elevatorFront = new THREE.Vector3(ox, 0, oy);
    // la cabina nueva (el prefab de elevator.ts, la misma que en las Poolrooms) llena la celda; su puerta queda a ras de la boca; cerrada hasta cumplir la misión
    const holder = new THREE.Group(), ec = center(maze.elevator);
    holder.position.set(ec.x + ox * (CELL / 2), 0, ec.z + oy * (CELL / 2));
    holder.rotation.y = Math.atan2(ox, oy); // +z local hacia el lado abierto
    this.root.add(holder);
    this.cab = new ElevatorCab(CELL, CELL - 0.04, HEIGHT - 0.04, 0, true);
    holder.add(this.cab.group);
    this.elevator = holder;
    const sign = assets.gltf.exit.scene.clone(true);
    sign.scale.setScalar(2.2);
    sign.position.set(0, 2.45, 0.02);
    holder.add(sign);
    // los ascensores de adorno (el mismo marco y puertas cerradas, sin luz): el pasillo de las Suites se repite y no puede haber uno solo
    for (const d of exits) {
      if (d === e) continue;
      const g = holder.clone(true), dc = center(d.cell), [dx, dy] = DIRS[d.rot] ?? DIRS[0];
      const lights: THREE.Object3D[] = [];
      g.traverse((o) => (o as THREE.Light).isLight && lights.push(o));
      lights.forEach((o) => o.removeFromParent()); // (aparte: quitarlas dentro del recorrido lo rompe)
      g.position.set(dc.x + dx * (CELL / 2), 0, dc.z + dy * (CELL / 2));
      this.root.add(g);
      this.decoys.add(d.cell.y * w + d.cell.x);
    }
  }

  /** La puerta que se abre o cierra con G: a menos de 1,6 m de su umbral (lado del pasillo) y delante de ti (`yaw`: 0 mira a -z). */
  nearDoor(x: number, z: number, yaw: number, y = 0) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: (typeof this.doors)[number] | undefined, bd = 1.6;
    for (const d of this.doors) {
      const px = d.x + d.nx * 0.3 - x, pz = d.z + d.nz * 0.3 - z, dist = Math.hypot(px, pz);
      if (Math.abs((d.y ?? 0) - y) < 1.2 && dist < bd && (px * fx + pz * fz) / Math.max(dist, 0.01) > 0.35) (best = d), (bd = dist);
    }
    return best;
  }
  /** Abre o cierra una puerta; devuelve si queda abierta. */
  toggleDoor(d: { tgt: number; x: number; z: number; y?: number }) {
    const open = d.tgt ? 0 : 1, span = SUITE_L * CELL;
    // las copias del pasillo (Las Suites) se ven igual: la misma puerta de cada copia se abre y se cierra a la vez, para que el bucle no se note
    for (const o of this.doors) if ((o.y ?? 0) !== (d.y ?? 0)) continue; else if (o.grand ? !!(d as { grand?: boolean }).grand : o.z === d.z && Math.abs(Math.round((o.x - d.x) / span) * span - (o.x - d.x)) < 1e-6) o.tgt = open;
    return !!(d.tgt = open);
  }

  /** Celda de un punto del mundo. */
  cellAt(x: number, z: number): Cell {
    return { x: Math.floor(x / CELL), y: Math.floor(z / CELL) };
  }
  /** Pared (o fuera del mapa) en ese punto. */
  solid(x: number, z: number) {
    const c = this.cellAt(x, z), { w, h, open } = this.maze;
    if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h || !open[c.y * w + c.x]) return true;
    return this.decoys.has(c.y * w + c.x) || this.doors.some((d) => d.cell === c.y * w + c.x && d.cur < 0.7) || (!this.elevatorOpen && c.x === this.maze.elevator.x && c.y === this.maze.elevator.y);
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
    const on = this.warm, off = new THREE.Color(0.32, 0.3, 0.24).multiplyScalar(0.2 + 0.8 * this.power), c = new THREE.Color();
    this.panelOn.forEach((o, i) => this.lamps.setColorAt(i, o ? c.lerpColors(off, on, this.power) : off));
    this.lamps.instanceColor!.needsUpdate = true;
    this.shownPower = this.power;
  }

  /** Los Facelings que pasean por el pasillo: tres, cada uno por su carril y a su paso, y uno por cada copia del pasillo (se repite cada `SUITE_L`). */
  private addWalkers() {
    for (const [phase, dir, z, v] of [[0.15, 1, 12.75, 1.0]]) {
      const w: (typeof this.walkers)[number] = { rigs: [], groups: [], blk: [], phase, dir, z, v };
      for (let k = 0; k < 3; k++) {
        const rig = new Rig(this.assets.gltf['suites/faceling']), h = new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3()).y, g = new THREE.Group(), b = { x: 0, z, r: 0.3 };
        rig.root.scale.setScalar(1.75 / h);
        g.add(rig.root);
        rig.action('walk')?.play();
        this.root.add(g);
        this.blockers.push(b);
        w.rigs.push(rig), w.groups.push(g), w.blk.push(b);
      }
      this.walkers.push(w);
    }
  }
  /** El personal del hotel (los Facelings): su animación. */
  private staff: Rig[] = [];
  /** Un Faceling de verdad (del servidor) ocupa ese sitio: se quita el de adorno. */
  hideStaff(x: number, z: number) {
    for (const r of this.staff) {
      const g = r.root.parent;
      if (g && Math.abs(g.position.z - z) < 0.6 && Math.abs(((g.position.x - x + SUITE_L * CELL / 2) % (SUITE_L * CELL) + SUITE_L * CELL) % (SUITE_L * CELL) - SUITE_L * CELL / 2) < 0.6) g.visible = false; // (cualquier copia del pasillo)
    }
  }
  private walkersOff = false;
  /** Los que paseaban por el pasillo (de adorno) se van cuando el personal se vuelve contra ti. */
  hideWalkers() {
    this.walkersOff = true;
    for (const w of this.walkers) w.groups.forEach((g) => (g.visible = false));
  }
  /** Las escaleras de servicio (Las Suites): dónde están y sus medidas. */
  private stairs: { xl: number; xm0: number; xm1: number; xr: number; z0: number; z1: number; ZT: number; Z0: number; RISE: number; H1: number; TOP: number; y0: number; LV: number }[] = [];
  /** Las puertas de las plantas en el hueco de la escalera de servicio: planta, sitio y altura del rellano. Cruzarla (con la salida abierta) lleva a esa planta. */
  readonly stairDoors: { n: number; x: number; z: number; y: number }[] = [];
  /** La altura del suelo bajo (x, z) estando a altura `y`: el más alto que se alcanza de un paso (el hueco de la escalera tiene los niveles apilados). */
  floorAt(x: number, z: number, y = 0): number {
    for (const s of this.stairs) {
      if (x < s.xl || x > s.xr || z < s.z0 || z > s.z1) continue;
      let best = -Infinity, low = Infinity;
      const take = (h: number) => {
        if (h < low) low = h;
        if (h <= y + 0.5 && h > best) best = h;
      };
      for (let k = 0; k <= s.LV; k++) {
        const b = s.y0 + k * s.TOP;
        if (z >= s.Z0) take(b); // el rellano de la planta (todo el ancho)
        else if (k < s.LV) {
          if (z <= s.ZT) take(b + s.H1); // el descansillo
          else if (x >= s.xm0 && x <= s.xm1) continue; // el hueco
          else take(x < s.xm0 ? b + s.RISE * Math.ceil((s.Z0 - z) / 0.3) : b + s.H1 + s.RISE * Math.ceil((z - s.ZT) / 0.3)); // los dos tramos
        }
      }
      return best > -Infinity ? best : low === Infinity ? s.y0 : low;
    }
    return 0;
  }
  /** Terrain: cabe un cuerpo de radio r (sin pared ni mueble; la altura no cuenta aquí). */
  fits(x: number, z: number, _y: number, r = 0.3) {
    return !this.solid(x, z) && !this.furniture(x, z, r);
  }
  /** Terrain: aquí no hay agua. */
  liquidAt(_x: number, _z: number, _y?: number): { surface: number; depth: number } | null {
    return null;
  }
  private grandGroups: THREE.Object3D[] = [];
  private sealWall?: () => void;
  /** La puerta doble del vestíbulo desaparece: queda pared lisa y ya no se vuelve (el bucle del pasillo queda cerrado). */
  sealGrand() {
    if (!this.sealWall) return;
    this.grandGroups.forEach((g) => (g.visible = false));
    for (const d of this.doors) if (d.grand) this.maze.open[d.cell] = 0;
    this.doors = this.doors.filter((d) => !d.grand);
    this.sealWall(), (this.sealWall = undefined);
  }
  /** Cierra la puerta doble del vestíbulo (a la espalda de quien acaba de entrar). */
  closeGrand() {
    for (const o of this.doors) if (o.grand) o.tgt = 0;
  }
  /** Los mostradores de recepción (Las Suites): sitio y hacia dónde dan. */
  private counters: { x: number; z: number; dx: number; dy: number }[] = [];
  /** El mostrador más cercano a (x, z): el sitio del Faceling y hacia dónde mira (para la cámara de la tienda). */
  shopView(x: number, z: number) {
    const c = [...this.counters].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    return c && { x: c.x - c.dx * 0.95, z: c.z - c.dy * 0.95, dx: c.dx, dz: c.dy };
  }
  /** ¿Estoy mirando a un Faceling, a ≤ 2,6 m y del lado del cliente? (si no, el G es de lo que haya a mano) */
  nearCounter(x: number, z: number, yaw: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    return this.counters.some((c) => {
      const px = c.x - c.dx * 0.95 - x, pz = c.z - c.dy * 0.95 - z, d = Math.hypot(px, pz);
      return d < 2.6 && (x - c.x) * c.dx + (z - c.z) * c.dy > 0.3 && (px * fx + pz * fz) / Math.max(d, 0.01) > 0.6;
    });
  }
  /** ¿Estoy mirando a un Faceling que pasea, a ≤ 2,6 m? */
  nearWalker(x: number, z: number, yaw: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    return this.walkers.some((w) => w.blk.some((b) => {
      const px = b.x - x, pz = w.z - z, d = Math.hypot(px, pz);
      return d < 2.6 && (px * fx + pz * fz) / Math.max(d, 0.01) > 0.6;
    }));
  }
  /** Dónde está la cámara (la pone el juego): lo instanciado a más de PROP_FAR m no se dibuja. */
  viewer?: THREE.Vector3;
  private cullable?: THREE.InstancedMesh[];
  private doorGroups: THREE.Object3D[] = [];
  private roomDoor?: Map<number, (typeof this.doors)[number]>;
  update(t: number, dt: number) {
    const v = this.viewer;
    if (v) {
      this.cullable ??= this.root.children.filter((o) => o.userData.cull) as THREE.InstancedMesh[];
      if (this.hotel) this.roomDoor ??= new Map(this.doors.filter((d) => d.cell >= 0 && !d.grand && !d.y).map((d) => [d.cell, d]));
      for (const im of this.cullable) {
        const b = im.boundingSphere!, r = im.userData.room as number[] | undefined;
        let show = Math.hypot(b.center.x - v.x, b.center.z - v.z) - b.radius < PROP_FAR;
        if (show && r && this.roomDoor) {
          // una habitación solo se dibuja si estás dentro o su puerta está abierta (y no a más de 14 m)
          const inside = v.x > r[0] * 6 + 1.3 && v.x < r[0] * 6 + 6.2 && (r[1] ? v.z < 12.2 : v.z > 14.8);
          show = inside || ((this.roomDoor.get((r[1] ? 7 : 10) * this.maze.w + r[0] * 4 + 2)?.cur ?? 0) > 0.02 && Math.hypot(b.center.x - v.x, b.center.z - v.z) - b.radius < 14);
        }
        im.visible = show;
      }
      for (const g of this.doorGroups) g.visible = Math.hypot(g.position.x - v.x, g.position.z - v.z) < 20;
    }
    this.cab.update(dt);
    if (this.hotel && !this.walkers.length && !this.walkersOff && this.assets.gltf['suites/faceling']) this.addWalkers();
    const span = SUITE_L * CELL;
    for (const w of this.walkers) {
      const x = (((w.phase * span + w.dir * w.v * t) % span) + span) % span;
      w.groups.forEach((g, k) => (g.position.set(x + k * span, 0, w.z), (g.rotation.y = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2), (w.blk[k].x = x + k * span)));
      w.rigs.forEach((r) => r.update(dt));
    }
    for (const s of this.staff) s.update(dt);
    if (this.dustMat) this.dustMat.uniforms.uT.value = t;
    if (this.skyMat) this.skyMat.uniforms.uT.value = t;
    this.hallFx?.(t);
    if (this.glow) {
      // el hotel respira: la luz sube y baja un par de por cientos, despacio, y los apliques tienen su propia respiración
      const k = 1 + 0.025 * Math.sin(t * 0.55) + 0.015 * Math.sin(t * 1.7 + 1.3), a = 1 + 0.06 * Math.sin(t * 0.9 + 2.0) + 0.03 * Math.sin(t * 3.1);
      this.glow.ceil.opacity = k, this.glow.wall.opacity = k, this.glow.cove.color.setRGB(1, 0.85, 0.63).multiplyScalar(k);
      this.glow.halo.opacity = 0.8 * a, this.glow.wash.opacity = 0.8 * a;
    }
    const occ = this.occupants?.() ?? [], mod = (a: number, n: number) => ((a % n) + n) % n;
    for (const d of this.doors) {
      if (d.tgt === 0 && d.cur > 0 && occ.length) {
        // cerrándose con alguien en su celda (de cualquier copia del pasillo): se vuelve a abrir
        const dx = d.cell % this.maze.w, dy = Math.floor(d.cell / this.maze.w);
        if (occ.some((o) => Math.floor(o.z / CELL) === dy && (this.hotel ? mod(Math.floor(o.x / CELL), SUITE_L) === mod(dx, SUITE_L) : Math.floor(o.x / CELL) === dx))) this.toggleDoor(d);
      }
      d.cur = Math.max(0, Math.min(1, d.cur + Math.sign(d.tgt - d.cur) * Math.min(Math.abs(d.tgt - d.cur), dt * 1.5)));
      if (d.leaf) d.leaf.rotation.z = SWING * (d.cur * d.cur * (3 - 2 * d.cur)); // (con suavizado)
      d.swing?.(d.cur * d.cur * (3 - 2 * d.cur));
    }
    LM.uLmGain.value = 0.06 + 0.94 * this.power;
    if (this.power !== this.shownPower) this.paint();
    // parpadeo de tubo viejo: casi siempre bien, y a ratos una racha de apagarse y encenderse a saltos
    const on = this.warm, off = new THREE.Color(0.32, 0.3, 0.24).multiplyScalar(0.2 + 0.8 * this.power), c = new THREE.Color();
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
    this.rf?.dispose();
    this.cab.dispose();
    this.root.removeFromParent();
  }
}

