import * as THREE from 'three';
import { useSyncExternalStore } from 'react';
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
/** El renderer de Phoenyx arranca la GPU de forma asíncrona (`ready`): hasta entonces no dibuja. Después, cada captura es síncrona (render + copia en la misma tarea). */
let rigP: Promise<NonNullable<typeof rig>> | undefined;
const setup = () => (rigP ??= make());
async function make() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  await (r as unknown as { ready?: Promise<void> }).ready;
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
  const { r, scene, cam } = rig!;
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
  if (r.getContext().isContextLost()) throw new Error('icon context lost');
  return r.domElement.toDataURL('image/png');
}

/** Libera el renderer (los iconos ya son imágenes). */
function release() {
  if (!rig) return;
  rig.r.dispose();
  rig.r.forceContextLoss();
  rig = undefined;
  rigP = undefined;
}

export type IconKey = typeof inventoryModels[number] | 'flashlight' | 'camera' | 'gun' | 'tape' | 'spare' | 'ammo' | 'water' | 'caution' | 'radar' | 'totem' | 'watergun' | 'tank';

const tries = new Map<string, number>();
/** Guarda la captura de `k`; si falla (contexto perdido, modelo sin llegar) no se guarda y se reintenta en la próxima pasada (hasta 20 veces). */
function snap(k: string, src: THREE.Object3D | undefined, spin: number, tilt: number) {
  if (cache.has(k) || !src || (tries.get(k) ?? 0) >= 20) return;
  try {
    cache.set(k, shoot(src, spin, tilt));
  } catch {
    tries.set(k, (tries.get(k) ?? 0) + 1);
    release(); // (un contexto nuevo en la siguiente pasada)
  }
}

/** Los iconos se pintan en segundo plano (el renderer arranca asíncrono); los componentes se enteran con `useIcons`. */
let version = 0;
const listeners = new Set<() => void>();
const bump = () => (version++, listeners.forEach((l) => l()));
let running = false;
let want: Assets | undefined;
/** Una cosa a la vez con el renderer compartido (una pasada de iconos o el icono de un accesorio): quien termina lo libera. */
let lock: Promise<unknown> = Promise.resolve();
const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => (lock = lock.then(fn, fn)) as Promise<T>;
const idle = () => new Promise<void>((r) => setTimeout(r));

/** Una pasada: crea el renderer, captura lo que falte (soltando el hilo entre una y otra), lo libera y avisa. */
function run() {
  if (running) return;
  running = true;
  void exclusive(pass).finally(() => (running = false));
}
async function pass() {
  try {
    while (want) {
      const g = want.gltf;
      want = undefined;
      const jobs: [string, THREE.Object3D | undefined, number, number][] = [
        ['watergun', poolPart('watergun'), -0.5, 0.3],
        ['tank', poolPart('tank'), -0.6, 0.3],
        ['flashlight', g.flashlight.scene, -0.9, 0.3],
        ['camera', g.camcorder.scene, -0.6, 0.35],
        ['gun', g.gun.scene, -0.5, 0.25],
        ['tape', g.vhs.scene, -0.55, 0.5],
        ['water', g.water.scene, -0.5, 0.2],
        ['caution', g.duct.scene, -0.6, 0.5],
        ['radar', g.radar.scene, -0.4, 0.5],
        ['totem', g.totem.scene, -0.5, 0.2],
        // los modelos nuevos llegan con los demás (o después de la carga del menú)
        ...inventoryModels.map((k) => [k, itemModel(k), -0.5, k === 'monster' || k === 'glasses' || k === 'pills' || k === 'beer' ? 0.15 : 0.3] as [string, THREE.Object3D | undefined, number, number]),
      ];
      const before = cache.size;
      for (const [k, src, spin, tilt] of jobs) {
        if (cache.has(k) || !src) continue;
        if (!rig) await setup();
        snap(k, src, spin, tilt);
        await idle();
      }
      if (cache.has('flashlight')) cache.set('spare', cache.get('flashlight')!);
      if (cache.has('gun')) cache.set('ammo', cache.get('gun')!);
      release();
      if (cache.size !== before) bump();
    }
  } catch (e) {
    console.warn('icons', e);
    release();
    rigP = undefined;
  }
}

const ALL = [...inventoryModels, 'flashlight', 'camera', 'gun', 'tape', 'spare', 'ammo', 'water', 'caution', 'radar', 'totem', 'watergun', 'tank'];
/** Los iconos del equipo y de los bolsillos que ya están hechos (los demás salen vacíos y llegan solos: pide una pasada y `useIcons` repinta). */
export function gearIcons(assets: Assets): Record<IconKey, string> {
  want = assets;
  if (ALL.some((k) => !cache.has(k) && (tries.get(k) ?? 0) < 20)) void run();
  return Object.fromEntries(ALL.map((k) => [k, cache.get(k) ?? ''])) as Record<IconKey, string>;
}

/** Como `gearIcons`, pero repinta el componente cuando llegan iconos nuevos. */
export function useIcons(assets: Assets): Record<IconKey, string>;
export function useIcons(assets?: Assets | null): Record<IconKey, string> | null;
export function useIcons(assets?: Assets | null): Record<IconKey, string> | null {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => version,
  );
  return assets ? gearIcons(assets) : null;
}

/** El icono de un accesorio (sombrero, mochila): llega cuando se descarga su modelo. */
export async function cosmeticIcon(id: string): Promise<string | undefined> {
  const k = 'cos:' + id;
  if (cache.has(k)) return cache.get(k);
  const m = await model(id);
  if (!m) return undefined;
  return exclusive(async () => {
    if (cache.has(k)) return cache.get(k);
    try {
      await setup();
      cache.set(k, shoot(m, -0.6, 0.25));
    } catch (e) {
      console.warn('icon', e);
    }
    release();
    return cache.get(k);
  });
}
