import * as THREE from 'three';
import type { Assets } from './game';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { model } from './cosmetics';
import { poolPart } from './poolmap';
import { inventoryModels, itemModel } from './itemModels';

/*
 * Los iconos del inventario: capturas de los modelos del juego. Un renderer WebGL pequeño y desechable pinta cada
 * objeto una vez, con cámara ortográfica y fondo transparente, y se guarda como imagen (dataURL) en memoria.
 */

const SIZE = 160;
const cache = new Map<string, string>();

let rig: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera } | undefined;
function setup() {
  if (rig) return rig;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.setPixelRatio(1);
  r.setSize(SIZE, SIZE, false);
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 1.6));
  const key = new THREE.DirectionalLight(0xfff0d0, 2.6);
  key.position.set(2, 3, 3);
  scene.add(key);
  return (rig = { r, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50) });
}

/** Una captura de este objeto (una copia suya), de tres cuartos y encuadrada con un margen. */
function shoot(src: THREE.Object3D, spin = -0.7, tilt = 0.4) {
  const { r, scene, cam } = setup();
  const pivot = new THREE.Group();
  pivot.add(skClone(src)); // (SkeletonUtils: el tótem lleva piel)
  pivot.rotation.set(tilt, spin, 0, 'YXZ');
  scene.add(pivot);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const half = Math.max(s.x, s.y, s.z) * 0.62;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
  // la cámara fuera del objeto, sea cual sea su escala (un modelo enorme, como la pistola de agua, quedaba cortado por el plano cercano)
  const d = Math.max(s.x, s.y, s.z) * 1.5 + 1;
  cam.near = d * 0.01;
  cam.far = d * 4;
  cam.updateProjectionMatrix();
  cam.position.set(c.x, c.y, c.z + d);
  cam.lookAt(c);
  r.render(scene, cam);
  scene.remove(pivot);
  return r.domElement.toDataURL('image/png');
}

/** Libera el renderer (los iconos ya son imágenes). */
function release() {
  if (!rig) return;
  rig.r.dispose();
  rig.r.forceContextLoss();
  rig = undefined;
}

export type IconKey = typeof inventoryModels[number] | 'flashlight' | 'camera' | 'gun' | 'tape' | 'spare' | 'ammo' | 'water' | 'caution' | 'radar' | 'totem' | 'watergun' | 'tank';

/** Los iconos del equipo y de los bolsillos; se hacen la primera vez y se guardan. */
export function gearIcons(assets: Assets): Record<IconKey, string> {
  // lo de las Poolrooms llega cuando se baja su kit
  for (const [k, spin] of [['watergun', -0.5], ['tank', -0.6]] as const) {
    const o = poolPart(k);
    if (o && !cache.has(k)) (cache.set(k, shoot(o, spin, 0.3)), release());
  }
  if (!cache.has('flashlight')) {
    const g = assets.gltf;
    const flash = shoot(g.flashlight.scene, -0.9, 0.3);
    cache.set('flashlight', flash);
    cache.set('spare', flash);
    cache.set('camera', shoot(g.camcorder.scene, -0.6, 0.35));
    const gun = shoot(g.gun.scene, -0.5, 0.25);
    cache.set('gun', gun);
    cache.set('ammo', gun);
    cache.set('tape', shoot(g.vhs.scene, -0.55, 0.5));
    cache.set('water', shoot(g.water.scene, -0.5, 0.2));
    release();
    cache.set('caution', shoot(g.duct.scene, -0.6, 0.5));
    cache.set('radar', shoot(g.radar.scene, -0.4, 0.5));
    cache.set('totem', shoot(g.totem.scene, -0.5, 0.2));
  }
  // los modelos nuevos llegan con los demás al cargar
  for (const k of inventoryModels) {
    const o = itemModel(k);
    if (o && !cache.has(k)) (cache.set(k, shoot(o, -0.5, k === 'uno' || k === 'steelcard' ? 0.3 : 0.15)), release());
  }
  return Object.fromEntries([...inventoryModels, 'flashlight', 'camera', 'gun', 'tape', 'spare', 'ammo', 'water', 'caution', 'radar', 'totem', 'watergun', 'tank'].map((k) => [k, cache.get(k) ?? ''])) as Record<IconKey, string>;
}

/** El icono de un accesorio (sombrero, mochila): llega cuando se descarga su modelo. */
export async function cosmeticIcon(id: string): Promise<string | undefined> {
  const k = 'cos:' + id;
  if (cache.has(k)) return cache.get(k);
  const m = await model(id);
  if (!m) return undefined;
  cache.set(k, shoot(m, -0.6, 0.25));
  release();
  return cache.get(k);
}
