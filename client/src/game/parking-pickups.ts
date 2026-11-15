import * as THREE from 'three';
import type { Drop } from '@backrooms/shared';
import { CELL } from './maze';
import type { Assets } from './game';
import type { ParkingLevel } from './parking';
import { PickupField, type PickupHost } from './pickups';
import { dropModels } from './items';
import type { GameAudio } from './audio';

/*
 * Los objetos del suelo de la Habitable Zone: el mismo PickupField de siempre (pickups.ts), con las plantas. Lo soltado trae la altura de los pies de quien lo
 * soltó (`Drop.y`) y cae hasta ahí, chocando con lo que dice el nivel (`fits`). Las taquillas, las cintas de la misión y los generadores siguen siendo de
 * parking.ts (puertas con colisión y el protocolo `parkingInteract`): no son pickups sueltos.
 */
export class ParkingPickups extends PickupField {
  constructor(level: ParkingLevel, camera: THREE.Camera, private assets: Assets, audio?: GameAudio) {
    const host: PickupHost = {
      root: level.scene,
      solid: (x, z, y) => y !== undefined && !level.fits(x, z, y, false), // (el suelo que dice `y`; sin altura no hay paredes que valgan)
      cellAt: (x, z) => ({ x: Math.floor(x / CELL), y: Math.floor(z / CELL) }),
    };
    super(host, camera, audio);
  }

  /** Los objetos soltados que hay ahora en el suelo (lista del servidor). */
  override syncDrops(list: Drop[]) {
    super.syncDrops(list, dropModels(this.assets));
  }
}
