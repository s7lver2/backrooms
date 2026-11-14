import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PARKING_ITEM_IDS } from '@backrooms/shared';

/*
 * Los modelos de los objetos nuevos (taquilla, carta Uno Reverse, lata de Monster, pokeball, granada, nokia y bate; ver public/models/items/LICENSES.txt).
 * Se bajan una vez al cargar el juego y se piden con `itemModel`; si alguno no llega, ese objeto sale con una caja.
 */
export const inventoryModels = ['uno', 'monster', 'pokeball', 'grenade', 'nokia', 'bat', ...PARKING_ITEM_IDS] as const;
const models = ['locker', ...inventoryModels] as const;
export type ItemModel = typeof models[number];
const cache = new Map<ItemModel, THREE.Object3D>();
export const itemModel = (n: ItemModel) => cache.get(n);

export async function loadItemModels() {
  const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(models.map((n) => gl.loadAsync(`/models/items/${n}.glb`).then((g) => void cache.set(n, g.scene)).catch((e) => console.warn('item model', n, e))));
}
