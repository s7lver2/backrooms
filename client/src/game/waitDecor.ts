import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LEVELS, WAIT_HALF } from '@backrooms/shared';
import { fit } from './hospital';
import { Dust, MONO, bagTex, clamp, decal, hash, softTex, type Bag, type Box } from './waitKit';

/*
 * El decorado de la sala de espera: pósters y avisos de «seguridad» pintados en lienzos, una máquina expendedora
 * con su luz, una pizarra con garabatos, cables y tuberías, manchas de humedad y desgaste (decals), una moqueta,
 * tablones, un cubo, una papelera, un extintor y una lámpara de pie que se enciende y se apaga. La luz: haces
 * tenues bajo los dos fluorescentes con polvo flotando, el brillo verdoso de la máquina y la balizas del botón.
 * Solo dos luces reales propias (la máquina y la lámpara): el resto, materiales sin iluminar y gradientes aditivos.
 */

const H = WAIT_HALF;
const SX = H.x / 3, SZ = H.z / 2.5; // cuánto creció la sala respecto a la original (3 × 2,5): lo que tenía coordenadas sueltas se estira con ella
const BW = 768, BH = 508;

/** La pizarra: el número de ronda y el nivel al que lleva la puerta (nombre, título y una línea de ambiente), a tiza. La misión se vota al cruzar la puerta. */
function paintBoard(x: CanvasRenderingContext2D, round: number, levelId: string) {
  const lv = LEVELS[levelId] ?? LEVELS.level0;
  x.fillStyle = '#d4d3c6';
  x.fillRect(0, 0, BW, BH);
  for (let n = 0; n < 700; n++) {
    x.fillStyle = `rgba(80,76,60,${hash(n) * 0.12})`;
    x.fillRect(hash(n * 3) * BW, hash(n * 5) * BH, 2 + hash(n) * 30, 2 + hash(n + 1) * 4);
  }
  x.lineCap = 'round';
  x.textBaseline = 'alphabetic';
  x.textAlign = 'left';
  x.fillStyle = x.strokeStyle = '#1c3a6b';
  x.lineWidth = 4;
  x.font = `bold 30px ${MONO}`;
  x.fillText(`ROUND ${round}`, 36, 62);
  x.fillStyle = '#8a1f1a';
  x.font = `bold 22px ${MONO}`;
  x.textAlign = 'right';
  x.fillText("DON'T LOOK UP", BW - 36, 60);
  x.fillStyle = x.strokeStyle = '#1c3a6b';
  x.textAlign = 'left';
  x.font = `bold 20px ${MONO}`;
  x.fillText('TODAY THE DOOR GOES TO', 36, 150);
  x.font = `bold 108px ${MONO}`;
  x.fillText(lv.name, 36, 262);
  x.lineWidth = 5;
  x.beginPath();
  x.moveTo(40, 284);
  x.lineTo(40 + x.measureText(lv.name).width * 0.98, 281);
  x.stroke();
  x.fillStyle = '#8a1f1a';
  x.font = `bold 40px ${MONO}`;
  x.fillText(lv.title, 36, 340);
  x.fillStyle = '#1c3a6b';
  x.font = `bold 21px ${MONO}`;
  const words = lv.blurb.split(' ');
  let line = '', y = 392;
  for (const w of words) {
    if ((line + w).length > 42) (x.fillText(line.trim(), 36, y), (y += 28), (line = ''));
    line += w + ' ';
  }
  x.fillText(line.trim(), 36, y);
  x.font = `bold 18px ${MONO}`;
  x.fillText('MISSION IS VOTED AT THE DOOR', 36, BH - 28);
}
const HEIGHT = 2.6;
export const TUBE_Z = [-0.7, 1.25] as const;

type Mat = THREE.Material;

export class Decor {
  readonly boxes: Box[] = [];
  /** Dónde se apunta para usar la máquina y la lámpara, y hasta dónde llega el brazo. */
  readonly vendAt = new THREE.Vector3(2.2, 1.1, -1.15);
  readonly lampAt = new THREE.Vector3(H.x - 0.38, 1.3, -H.z + 0.38);
  lampOn = true;
  private board!: THREE.CanvasTexture;
  private lampLight = new THREE.PointLight(0xfff0c8, 3.2, 6, 1.4);
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3cf, toneMapped: false });
  private lampHalo: THREE.Sprite;
  private vendLight = new THREE.PointLight(0xbff0d6, 1.5, 4.2, 1.5);
  private vendMat = new THREE.MeshBasicMaterial({ color: 0xcfcfc4 });
  private vendGlow: THREE.MeshBasicMaterial;
  private beacon = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  private beaconHalo: THREE.Sprite;
  private beams: THREE.MeshBasicMaterial[] = [];
  private dustA: Dust;
  private dustB: Dust;
  private can: THREE.Object3D;
  private canAt = -1e9;
  private blob: THREE.MeshBasicMaterial;
  private lampBlend = 1;

  constructor(readonly scene: THREE.Scene, private bag: Bag, private reduced: boolean, vend?: GLTF, canGlb?: GLTF, wbGlb?: GLTF) {
    const S = scene;
    const std = (color: number, rough = 0.8, metal = 0) => {
      const x = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      bag.own.push(x);
      return x;
    };
    const basic = (map: THREE.Texture, extra: THREE.MeshBasicMaterialParameters = {}) => {
      const x = new THREE.MeshBasicMaterial({ map, ...extra });
      bag.own.push(x);
      return x;
    };
    // un decal: textura con alfa, sin escribir profundidad y algo despegado para que no parpadee
    const stain = (map: THREE.Texture, color = 0xffffff, opacity = 1) =>
      basic(map, { color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const blobTex = softTex(bag, 0.75, 0.38);
    this.blob = new THREE.MeshBasicMaterial({ map: blobTex, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    bag.own.push(this.blob);
    const add = (...o: THREE.Object3D[]) => S.add(...o);
    const box = (w: number, h: number, d: number, mat: Mat, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, y, z);
      add(b);
      return b;
    };

    // ── la moqueta, el desgaste del suelo y la humedad ───────────────────────────
    const rugTex = bagTex(bag, 256, 160, (x) => {
      x.fillStyle = '#4b4128';
      x.fillRect(0, 0, 256, 160);
      for (let n = 0; n < 3500; n++) {
        x.fillStyle = `rgba(${hash(n) < 0.5 ? '20,14,6' : '120,100,55'},${0.05 + hash(n + 7) * 0.12})`;
        x.fillRect(hash(n * 3) * 256, hash(n * 5) * 160, 1 + hash(n + 2) * 2, 1 + hash(n + 4) * 2);
      }
      x.strokeStyle = '#7d6a38';
      x.lineWidth = 4;
      x.strokeRect(10, 10, 236, 140);
      x.strokeStyle = '#2b2414';
      x.lineWidth = 2;
      x.strokeRect(20, 20, 216, 120);
      x.fillStyle = 'rgba(30,22,8,0.5)'; // un diseño de rombos, gastado
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        x.moveTo(40 + i * 34, 80);
        x.lineTo(57 + i * 34, 52);
        x.lineTo(74 + i * 34, 80);
        x.lineTo(57 + i * 34, 108);
        x.fill();
      }
    });
    const rug = decal(2.7 * SX, 1.7 * SZ, std(0xffffff, 1), [0.25 * SX, 0.003, 0.45 * SZ], -Math.PI / 2, 0);
    (rug.material as THREE.MeshStandardMaterial).map = rugTex;
    rug.renderOrder = 0;
    add(rug);
    const scuff = bagTex(bag, 128, 256, (x) => {
      for (let n = 0; n < 60; n++) {
        x.fillStyle = `rgba(30,22,8,${0.04 + hash(n + 9) * 0.1})`;
        x.beginPath();
        x.ellipse(20 + hash(n) * 88, 20 + hash(n * 2) * 216, 4 + hash(n + 3) * 18, 3 + hash(n + 5) * 10, hash(n + 6) * 3, 0, 7);
        x.fill();
      }
    });
    add(decal(1.6, 3.2, stain(scuff), [0.1 * SX, 0.006, -0.7 * SZ], -Math.PI / 2, 0), decal(1.3, 1.9, stain(scuff), [-1.7 * SX, 0.006, -0.2 * SZ], -Math.PI / 2, 0.4), decal(1.2, 1.6, stain(scuff, 0xb09a60), [1.9 * SX, 0.006, 0.4 * SZ], -Math.PI / 2, 1.3));
    const blotch = bagTex(bag, 128, 128, (x) => {
      for (let k = 0; k < 4; k++) {
        const cx = 40 + hash(k + 1) * 48, cy = 40 + hash(k + 8) * 48, r = 26 + hash(k + 3) * 22;
        const g = x.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        g.addColorStop(0, `rgba(60,42,10,${0.22 + hash(k) * 0.15})`);
        g.addColorStop(0.8, 'rgba(60,42,10,0.18)');
        g.addColorStop(1, 'rgba(60,42,10,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 128, 128);
      }
    });
    const dm = stain(blotch);
    add(
      decal(1.8, 1.5, dm, [-2.1 * SX, HEIGHT - 0.004, 1.8 * SZ], Math.PI / 2, 0),
      decal(1.2, 1.2, dm, [2.2 * SX, HEIGHT - 0.004, -0.2 * SZ], Math.PI / 2, 1),
      decal(1.1, 1.1, dm, [0.9 * SX, HEIGHT - 0.004, -2.0 * SZ], Math.PI / 2, 2),
    );
    const streak = bagTex(bag, 64, 128, (x) => {
      for (let i = 0; i < 9; i++) {
        const px = 6 + hash(i + 4) * 52, len = 40 + hash(i) * 88;
        const g = x.createLinearGradient(0, 0, 0, len);
        g.addColorStop(0, 'rgba(58,40,10,0.5)');
        g.addColorStop(1, 'rgba(58,40,10,0)');
        x.fillStyle = g;
        x.fillRect(px, 0, 2 + hash(i + 1) * 5, len);
      }
    });
    const sm = stain(streak);
    add(
      decal(0.7, 1.7, sm, [-2.4 * SX, 1.75, H.z - 0.012], 0, Math.PI), decal(0.8, 1.9, sm, [1.9 * SX, 1.7, H.z - 0.012], 0, Math.PI),
      decal(0.7, 1.7, sm, [-H.x + 0.012, 1.75, 1.7 * SZ], 0, Math.PI / 2), decal(0.8, 1.6, sm, [-2.7 * SX, 1.8, -H.z + 0.012], 0, 0),
    );
    // la mugre de abajo, en las cuatro paredes
    const grime = bagTex(bag, 256, 64, (x) => {
      const g = x.createLinearGradient(0, 64, 0, 0);
      g.addColorStop(0, 'rgba(25,18,6,0.7)');
      g.addColorStop(1, 'rgba(25,18,6,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 64);
      for (let n = 0; n < 140; n++) {
        x.fillStyle = `rgba(25,18,6,${hash(n) * 0.25})`;
        x.fillRect(hash(n * 3) * 256, 64 - hash(n * 7) * 40, 2 + hash(n) * 14, 2);
      }
    });
    const gm = stain(grime);
    add(
      decal(H.x * 2, 0.55, gm, [0, 0.38, H.z - 0.012], 0, Math.PI), decal(H.z * 2, 0.55, gm, [-H.x + 0.012, 0.38, 0], 0, Math.PI / 2),
      decal(H.z * 2, 0.55, gm, [H.x - 0.012, 0.38, 0], 0, -Math.PI / 2), decal(H.x - 0.7, 0.55, gm, [(-H.x - 0.55) / 2, 0.38, -H.z + 0.012], 0, 0),
      decal(H.x - 0.7, 0.55, gm, [(H.x + 0.55) / 2, 0.38, -H.z + 0.012], 0, 0),
    );
    // el charco, bajo la tubería que gotea
    const puddleTex = bagTex(bag, 128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 6, 64, 64, 60);
      g.addColorStop(0, 'rgba(18,15,8,0.85)');
      g.addColorStop(0.7, 'rgba(24,19,9,0.6)');
      g.addColorStop(1, 'rgba(24,19,9,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
    });
    add(decal(1.5, 1.2, stain(puddleTex), [-H.x + 0.8, 0.008, H.z - 0.55], -Math.PI / 2, 0.5));

    // ── pósters y avisos ───────────────────────────────────────────────────────
    const paper = (map: THREE.Texture) => basic(map, { color: 0xc9c3a8 });
    const poster = (w: number, h: number, draw: (x: CanvasRenderingContext2D, W: number, H: number) => void, pos: [number, number, number], ry: number, rz = 0) => {
      const W = Math.round(w * 400), HH = Math.round(h * 400);
      const t = bagTex(bag, W, HH, (x) => {
        draw(x, W, HH);
        for (let n = 0; n < 400; n++) {
          x.fillStyle = `rgba(30,20,5,${hash(n) * 0.09})`;
          x.fillRect(hash(n * 3) * W, hash(n * 5) * HH, 1 + hash(n) * 3, 1 + hash(n + 2) * 3);
        }
      });
      add(decal(w, h, paper(t), pos, 0, ry, rz));
    };
    // la ruta de salida: verde, con el hombrecillo y la flecha
    poster(0.5, 0.7, (x, W, HH) => {
      x.fillStyle = '#1d5a3a';
      x.fillRect(0, 0, W, HH);
      x.strokeStyle = '#e8e6d4';
      x.lineWidth = 5;
      x.strokeRect(8, 8, W - 16, HH - 16);
      x.fillStyle = '#e8e6d4';
      x.font = `bold 34px ${MONO}`;
      x.textAlign = 'center';
      x.fillText('EXIT ROUTE', W / 2, 62);
      x.beginPath();
      x.arc(W / 2 + 8, 112, 14, 0, 7); // la cabeza
      x.fill();
      x.lineWidth = 9;
      x.lineCap = 'round';
      x.strokeStyle = '#e8e6d4';
      for (const [a, b, c, d] of [[W / 2, 135, W / 2 - 14, 190], [W / 2 - 14, 190, W / 2 - 40, 222], [W / 2 - 14, 190, W / 2 + 10, 232], [W / 2, 140, W / 2 + 36, 160], [W / 2, 140, W / 2 - 30, 156]]) (x.beginPath(), x.moveTo(a, b), x.lineTo(c, d), x.stroke());
      x.fillRect(W / 2 - 80, 255, 120, 16);
      x.beginPath();
      x.moveTo(W / 2 + 36, 238);
      x.lineTo(W / 2 + 80, 263);
      x.lineTo(W / 2 + 36, 288);
      x.fill();
      x.font = `bold 16px ${MONO}`;
      x.fillText('FOLLOW THE ARROWS', W / 2, 322);
      x.fillText('LEVEL 0 · NO ENTRY', W / 2, 346);
    }, [-H.x + 0.012, 1.45, 1.55 * SZ], Math.PI / 2, 0.02);
    // no calzar la puerta
    poster(0.34, 0.46, (x, W, HH) => {
      x.fillStyle = '#d8d2b8';
      x.fillRect(0, 0, W, HH);
      x.strokeStyle = '#b3261a';
      x.lineWidth = 9;
      x.beginPath();
      x.arc(W / 2, 70, 44, 0, 7);
      x.stroke();
      x.fillStyle = '#26221a';
      x.fillRect(W / 2 - 18, 44, 36, 52);
      x.strokeStyle = '#b3261a';
      x.beginPath();
      x.moveTo(W / 2 - 34, 38);
      x.lineTo(W / 2 + 34, 102);
      x.stroke();
      x.fillStyle = '#26221a';
      x.font = `bold 21px ${MONO}`;
      x.textAlign = 'center';
      x.fillText('DO NOT', W / 2, 148);
      x.fillText('PROP DOOR', W / 2, 172);
      x.font = `bold 11px ${MONO}`;
      x.fillText('FIRE DOOR · KEEP CLOSED', W / 2, 198);
      x.fillText('IT KNOWS WHEN IT IS OPEN', W / 2, 213);
    }, [0.93, 1.5, -H.z + 0.012], 0, -0.015);
    // la tabla de turnos
    poster(0.7, 0.5, (x, W, HH) => {
      x.fillStyle = '#d9d5c0';
      x.fillRect(0, 0, W, HH);
      x.fillStyle = '#26221a';
      x.font = `bold 22px ${MONO}`;
      x.fillText('WAITING ROOM · SHIFTS', 14, 32);
      x.lineWidth = 2;
      x.strokeStyle = '#26221a';
      const rows = [['MON', 'M. VOSS', '06-14'], ['TUE', 'J. ORTEGA', '14-22'], ['WED', 'M. VOSS', '22-06'], ['THU', '(CROSSED OUT)', '--'], ['FRI', 'NOBODY', '--'], ['SAT', 'NOBODY', '--'], ['SUN', 'DO NOT COME', '--']];
      x.font = `bold 15px ${MONO}`;
      rows.forEach((r, i) => {
        const y = 62 + i * 32;
        x.strokeRect(10, y - 20, W - 20, 30);
        x.fillText(r[0], 20, y);
        x.fillText(r[1], 90, y);
        x.fillText(r[2], W - 80, y);
        if (i === 3) (x.beginPath(), x.moveTo(90, y - 6), x.lineTo(W - 90, y - 6), x.stroke());
      });
    }, [-H.x + 0.012, 1.55, -1.65 * SZ], Math.PI / 2, -0.012);
    // una placa de «prohibido» en la pared de la puerta (la del extintor va debajo)
    const note = bagTex(bag, 128, 96, (x) => {
      x.fillStyle = '#e8d34a';
      x.fillRect(0, 0, 128, 96);
      x.fillStyle = '#15130c';
      x.font = `bold 18px ${MONO}`;
      x.textAlign = 'center';
      x.fillText('FIRE', 64, 36);
      x.fillText('EXTINGUISHER', 64, 62);
    });
    add(decal(0.2, 0.15, paper(note), [-H.x + 0.012, 1.3, -H.z + 0.35], 0, Math.PI / 2));

    // la pizarra: marco, bandeja y garabatos
    const board = bagTex(bag, BW, BH, (x) => paintBoard(x, 1, 'level0'));
    this.board = board;
    const bm = basic(board, { color: 0xdcd6c0 });
    let bz = H.z - 0.02;
    if (wbGlb) {
      // el modelo de la pizarra (3 × 1,76 × 0,12 m, girado 162° en el archivo): se endereza, se escala a 1,9 m de ancho y se apoya en la pared; el lienzo va delante, en su zona útil
      const m = wbGlb.scene.clone(true);
      m.rotation.y = 2.8274;
      m.updateMatrixWorld(true);
      const b0 = new THREE.Box3().setFromObject(m), k = 1.9 / (b0.max.x - b0.min.x);
      m.scale.setScalar(k);
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3());
      m.position.set(-1.1 - c.x, 1.5 - c.y, H.z - 0.005 - b.max.z);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh, mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mesh.isMesh || !mat?.isMeshStandardMaterial) return;
        const own = (mesh.material = mat.clone());
        own.roughness = 0.9;
        own.metalness = 0;
        if (own.map) (own.emissiveMap = own.map), own.emissive.setScalar(0.3);
        bag.own.push(own);
      });
      add(m);
      bz = H.z - 0.005 - (b.max.z - b.min.z) + 0.004; // la cara de delante
      add(decal(1.56, 1.03, bm, [-1.1, 1.5, bz - 0.006], 0, Math.PI));
    } else {
      add(decal(1.3, 0.86, bm, [-1.1, 1.5, bz - 0.01], 0, Math.PI));
      const frameB = std(0x8c887a, 0.5, 0.5);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.07), frameB);
      tray.position.set(-1.1, 1.06, bz - 0.04);
      add(tray);
      for (const [w, h, x, y] of [[1.36, 0.03, 0, 0.44], [1.36, 0.03, 0, -0.44], [0.03, 0.9, -0.67, 0], [0.03, 0.9, 0.67, 0]] as const) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), frameB);
        f.position.set(-1.1 + x, 1.5 + y, bz);
        add(f);
      }
    }

    // ── la máquina expendedora ───────────────────────────────────────────────
    const vz = -1.15;
    let fx = H.x - 0.8, depth = 0.8; // el frente de la máquina (x) y su fondo; con el modelo, lo que midan
    if (vend) {
      const m = vend.scene;
      m.rotation.y = -Math.PI / 2; // el frente del modelo mira a +z; aquí, a -x (hacia la sala)
      m.updateMatrixWorld(true);
      const b0 = new THREE.Box3().setFromObject(m), k = 1.85 / (b0.max.y - b0.min.y);
      m.scale.setScalar(k);
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3());
      depth = b.max.x - b.min.x;
      fx = H.x - depth;
      m.position.set(fx - b.min.x, -b.min.y, vz - c.z);
      add(m);
    } else add(box(0.8, 1.85, 0.92, std(0x3a2a26, 0.6, 0.3), H.x - 0.4, 0.925, vz));
    this.vendAt.x = fx;
    // el brillo en el suelo y la luz
    this.vendGlow = new THREE.MeshBasicMaterial({ map: softTex(bag, 0.8, 0.35), color: 0xaee8cf, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    bag.own.push(this.vendGlow, this.vendMat);
    add(decal(2.0, 2.4, this.vendGlow, [fx - 0.7, 0.011, vz], -Math.PI / 2, 0));
    this.vendLight.position.set(fx - 0.35, 1.3, vz);
    add(this.vendLight);
    const trayM = std(0x14120e, 0.7, 0.3); // (la papelera lo usa)
    // la lata de Almond Water cae al suelo, delante
    this.can = new THREE.Group();
    if (canGlb) {
      // el mismo modelo y los mismos retoques que la lata del mapa (items.ts): mate y casi sin brillo propio; tumbada, de lado
      const m = fit(canGlb, 0.17, 'y');
      m.traverse((o) => {
        const mesh = o as THREE.Mesh, mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mesh.isMesh || !mat?.isMeshStandardMaterial) return;
        const own = (mesh.material = mat.clone());
        own.color.multiplyScalar(0.7), (own.roughness = 1), (own.metalness = 0);
        if (own.map) (own.emissiveMap = own.map), own.emissive.setScalar(0.04);
        else own.emissive.copy(own.color).multiplyScalar(0.056);
        bag.own.push(own);
      });
      const r = new THREE.Box3().setFromObject(m);
      m.position.set(0, -(r.max.y - r.min.y) / 2, 0); // centrada: gira sobre su medio
      const lay = new THREE.Group().add(m);
      lay.rotation.x = Math.PI / 2;
      this.can.add(lay);
    }
    this.can.visible = false;
    add(this.can);
    this.boxes.push({ x0: fx, x1: H.x, z0: vz - 0.5, z1: vz + 0.5 });
    this.shadowUnder(this.boxes[0]);

    // ── la papelera, el cubo y los tablones ─────────────────────────────────
    const tin = std(0x55564f, 0.5, 0.5);
    const binG = new THREE.CylinderGeometry(0.18, 0.15, 0.42, 14, 1, true);
    const bin = new THREE.Mesh(binG, tin);
    const bx = H.x - 0.28;
    bin.position.set(bx, 0.21, 0.1);
    (tin as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    add(bin, new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.01, 14), trayM).translateX(bx).translateY(0.35).translateZ(0.1));
    this.boxes.push({ x0: bx - 0.18, x1: bx + 0.18, z0: -0.08, z1: 0.28 });
    this.shadowUnder(this.boxes[1]);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 14, 1, true), std(0x3d5560, 0.5, 0.4));
    (bucket.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const ux = -H.x + 0.6, uz = H.z - 0.5;
    bucket.position.set(ux, 0.15, uz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14).rotateX(-Math.PI / 2), basic(softTex(bag, 1, 1), { color: 0x2a2412 }));
    water.position.set(ux, 0.19, uz);
    add(bucket, water);
    this.shadowAt(ux, uz, 0.55, 0.55);
    const wood = bagTex(bag, 128, 32, (x) => {
      x.fillStyle = '#6d5532';
      x.fillRect(0, 0, 128, 32);
      for (let n = 0; n < 40; n++) {
        x.fillStyle = `rgba(30,20,6,${0.1 + hash(n) * 0.25})`;
        x.fillRect(0, hash(n * 3) * 32, 128, 1);
      }
    });
    const plank = std(0xffffff, 0.9);
    (plank as THREE.MeshStandardMaterial).map = wood;
    // un montón en el suelo (contra la pared norte) y dos apoyados en ella
    const planks: [number, number, number, number, number, number, number][] = [[-3.6, 0.02, -H.z + 0.5, 1.1, 0.04, 0.15, 0.1], [-3.55, 0.06, -H.z + 0.53, 1.0, 0.04, 0.14, -0.06], [-3.63, 0.1, -H.z + 0.47, 1.05, 0.04, 0.15, 0.03]];
    for (const [x, y, z, w, h, d, r] of planks) {
      const p = box(w, h, d, plank, x, y, z);
      p.rotation.y = r;
    }
    for (const [x, r] of [[-4.0, 0.22], [-3.85, 0.17]] as const) {
      const p = box(0.14, 1.4, 0.035, plank, x, 0.7 * Math.cos(r) + 0.02, -H.z + 0.04 + 0.7 * Math.sin(r)); // (la base en el suelo y la cabeza apoyada en la pared)
      p.rotation.x = -r;
    }
    this.boxes.push({ x0: -4.3, x1: -3.0, z0: -H.z, z1: -H.z + 0.7 });
    this.shadowUnder(this.boxes[2]);

    // ── el extintor ──────────────────────────────────────────────────────────
    const red = std(0xa41d16, 0.45, 0.2);
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 12), red);
    const ez = -H.z + 0.35;
    ext.position.set(-H.x + 0.1, 0.78, ez);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.1, 8), tin);
    top.position.set(-H.x + 0.1, 1.04, ez);
    const strap = box(0.04, 0.03, 0.17, tin, -H.x + 0.04, 0.95, ez);
    add(ext, top, strap);

    // ── la lámpara de pie ───────────────────────────────────────────────────
    const lx = this.lampAt.x, lz = this.lampAt.z;
    add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.03, 14), tin).translateX(lx).translateY(0.015).translateZ(lz),
      new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6), tin).translateX(lx).translateY(0.78).translateZ(lz),
      box(0.1, 0.95, 0.1, std(0x45443a, 0.6, 0.4), lx, 1.55, lz),
    );
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.8, 8), this.lampMat);
    tube.position.set(lx - 0.055, 1.55, lz);
    add(tube);
    this.lampLight.position.set(lx - 0.35, 1.7, lz + 0.15);
    add(this.lampLight);
    this.lampHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(bag, 0.8, 0.3), color: 0xffe8b0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lampHalo.scale.set(0.9, 1.6, 1);
    this.lampHalo.position.set(lx - 0.07, 1.55, lz);
    add(this.lampHalo);
    bag.own.push(this.lampMat, this.lampHalo.material);
    this.boxes.push({ x0: lx - 0.17, x1: lx + 0.17, z0: lz - 0.17, z1: lz + 0.17 });
    this.shadowAt(lx, lz, 0.5, 0.5);

    // ── cables y tuberías ────────────────────────────────────────────────────
    const rubber = std(0x0e0d09, 0.5, 0.1);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const cables = [
      // a lo largo del techo, con su comba, y bajando por la pared
      [V(-H.x, HEIGHT - 0.04, -2.66), V(-2.2, HEIGHT - 0.1, -2.6), V(0, HEIGHT - 0.12, -2.64), V(2.2, HEIGHT - 0.1, -2.6), V(H.x, HEIGHT - 0.04, -2.7)],
      [V(-H.x, HEIGHT - 0.03, -2.38), V(-2.0, HEIGHT - 0.08, -2.3), V(0.2, HEIGHT - 0.1, -2.34), V(2.4, HEIGHT - 0.08, -2.4), V(H.x, HEIGHT - 0.03, -2.46)],
      // del techo al botón
      [V(1.62, HEIGHT, -H.z + 0.04), V(1.66, 2.1, -H.z + 0.05), V(1.58, 1.4, -H.z + 0.06), V(1.55, 1.15, -H.z + 0.18)],
      // del ordenador al enchufe
      [V(-H.x + 0.45, 0.75, -0.3), V(-H.x + 0.55, 0.3, -0.1), V(-H.x + 0.95, 0.02, 0.3), V(-H.x + 0.45, 0.02, 0.55), V(-H.x + 0.02, 0.28, 0.7)],
      // por la pared oeste
      [V(-H.x + 0.03, 2.3, -H.z), V(-H.x + 0.04, 2.28, 0), V(-H.x + 0.03, 2.35, 1.4), V(-H.x + 0.03, 2.3, H.z)],
      // de la máquina a la pared
      [V(H.x - 0.05, 1.0, -0.65), V(H.x - 0.04, 0.5, -0.45), V(H.x - 0.03, 0.2, -0.1)],
    ];
    const tubes = cables.map((pts, i) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, i < 2 ? 0.014 : 0.01, 5, false).toNonIndexed());
    add(new THREE.Mesh(mergeGeometries(tubes)!, rubber));
    // tubería: a lo largo de la pared sur arriba, y bajando por la esquina sureste del oeste
    const rust = std(0x6a5a3a, 0.55, 0.6);
    const pipe = (len: number, r: number, rot: [number, number, number], pos: [number, number, number]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), rust);
      p.rotation.set(...rot);
      p.position.set(...pos);
      add(p);
    };
    pipe(H.x * 2, 0.05, [0, 0, Math.PI / 2], [0, 2.38, H.z - 0.07]);
    pipe(HEIGHT, 0.045, [0, 0, 0], [-H.x + 0.07, HEIGHT / 2, H.z - 0.07]);
    pipe(0.9, 0.025, [0, 0, Math.PI / 2], [1.2, 2.18, H.z - 0.04]);
    for (const [x, y, z] of [[-H.x + 0.07, 2.38, H.z - 0.07], [-H.x + 0.07, 0.1, H.z - 0.07]]) add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), rust).translateX(x).translateY(y).translateZ(z));
    for (const x of [-2, 0, 2]) add(box(0.05, 0.04, 0.1, tin, x, 2.38, H.z - 0.04));
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 14), red);
    wheel.position.set(-0.9, 2.18, H.z - 0.08);
    add(wheel);

    // ── luz: haces bajo los tubos, polvo, baliza del botón ────────────────────────
    for (const z of TUBE_Z) {
      const cone = new THREE.ConeGeometry(1.15, 2.3, 20, 1, true);
      const pos = cone.getAttribute('position'), col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = clamp(pos.getY(i) / 2.3 + 0.5, 0, 1); // 1 en la punta, 0 en la base
        col.fill(t * t, i * 3, i * 3 + 3);
      }
      cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const bm = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffe9b0, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      bag.own.push(bm, cone);
      const c = new THREE.Mesh(cone, bm);
      c.position.set(0, HEIGHT - 0.06 - 1.15, z);
      c.renderOrder = 2;
      this.beams.push(bm);
      add(c);
    }
    this.dustA = new Dust(bag, reduced ? 60 : 130, new THREE.Vector3(-H.x + 0.2, 0.15, -H.z + 0.2), new THREE.Vector3(H.x - 0.2, 2.5, H.z - 0.2), 0.03, 0.35);
    this.dustB = new Dust(bag, reduced ? 20 : 50, new THREE.Vector3(-0.9, 0.4, -1.6), new THREE.Vector3(0.9, 2.5, 0.2), 0.045, 0.6);
    add(this.dustA.points, this.dustB.points);
    const bd = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), this.beacon);
    bd.position.set(1.5, 1.62, -H.z + 0.04);
    this.beaconHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(bag, 1, 0.4), color: 0xff2a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.beaconHalo.scale.setScalar(0.4);
    this.beaconHalo.position.set(1.5, 1.62, -H.z + 0.1);
    add(bd, this.beaconHalo);
    bag.own.push(this.beacon, this.beaconHalo.material);
    this.can.userData.rest = new THREE.Vector3(fx - 0.14, 0.036, vz);
  }

  // ── sombras falsas ─────────────────────────────────────────────────────────

  /** Un blob oscuro en el suelo bajo una caja de colisión (algo más grande que ella). */
  shadowUnder(b: Box) {
    this.shadowAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0 + 0.5, b.z1 - b.z0 + 0.5);
  }
  shadowAt(x: number, z: number, w: number, d: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), this.blob);
    m.position.set(x, 0.009, z);
    m.renderOrder = 1;
    this.scene.add(m);
    this.bag.own.push(m.geometry);
  }
  /** El material del blob (el que se pone bajo el jugador). */
  get blobMaterial() {
    return this.blob;
  }

  // ── interacciones ──────────────────────────────────────────────────────────

  toggleLamp() {
    return (this.lampOn = !this.lampOn);
  }

  /** Saca una lata: cae a la bandeja. */
  dispense(age: number) {
    this.canAt = age;
  }
  get dispensing() {
    return this.can.visible;
  }

  /**
   * Cada fotograma. `p`: lo encendido que está cada fluorescente (0–1); `pressed`: el botón ya se pulsó;
   * `blackout`: 0–1, la sala a oscuras (la máquina vacila).
   */
  /** Repinta la pizarra con las misiones y los votos. */
  setBoard(round: number, levelId: string) {
    paintBoard((this.board.image as HTMLCanvasElement).getContext('2d')!, round, levelId);
    this.board.needsUpdate = true;
  }

  update(dt: number, age: number, p: [number, number], pressed: boolean, blackout: number) {
    // los haces y el polvo siguen a los tubos
    this.beams.forEach((b, i) => (b.opacity = 0.07 * p[i]));
    const lit = Math.max(p[0], p[1]);
    this.dustA.opacity(0.2 + 0.2 * lit);
    this.dustB.opacity(0.5 * p[0]);
    if (!this.reduced) (this.dustA.update(dt, age), this.dustB.update(dt, age));
    // la máquina: un zumbido de luz, y vacila cuando se va la corriente
    const flick = blackout > 0 && hash(Math.floor(age * 11)) < 0.3 * blackout ? 0.45 : 1;
    const v = (this.reduced ? 1 : 0.94 + 0.06 * Math.sin(age * 40)) * flick;
    this.vendMat.color.setScalar(0.82 * v);
    this.vendLight.intensity = 1.5 * v;
    this.vendGlow.opacity = 0.5 * v;
    // la lámpara de pie se enciende y se apaga con un parpadeo corto
    this.lampBlend += ((this.lampOn ? 1 : 0) - this.lampBlend) * Math.min(1, dt * 14);
    const lamp = this.lampBlend * (this.lampOn && !this.reduced && hash(Math.floor(age * 9)) < 0.03 ? 0.5 : 1);
    this.lampLight.intensity = 3.2 * lamp;
    this.lampMat.color.setRGB(0.1 + 0.9 * lamp, 0.1 + 0.9 * lamp * 0.95, 0.08 + 0.7 * lamp * 0.8);
    this.lampHalo.material.opacity = 0.5 * lamp;
    // la baliza del botón: parpadea una vez cada 1,2 s y, pulsado, fija
    const on = pressed || age % 1.2 < 0.2;
    this.beacon.color.setScalar(on ? 1 : 0.12).multiply(_red);
    this.beaconHalo.material.opacity = on ? 0.9 : 0.05;
    // la lata: cae desde la ranura (tras el golpe del motor), rebota y se queda un rato
    const t = age - this.canAt;
    const c = this.can;
    c.visible = t > 0.55 && t < 6.5;
    if (c.visible) {
      const k = t - 0.6, rest = c.userData.rest as THREE.Vector3;
      const fall = clamp(k / 0.22, 0, 1);
      const y = k < 0 ? 0.62 : fall < 1 ? 0.62 - (0.62 - rest.y) * fall * fall : rest.y + Math.max(0, 0.05 * Math.sin((k - 0.22) * 18) * Math.exp(-(k - 0.22) * 6));
      c.position.set(rest.x - 0.02 * (1 - fall), y, rest.z);
      c.rotation.z = (1 - fall) * 0.6;
    }
  }
}

const _red = new THREE.Color(0xff2a1a);
