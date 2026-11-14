import type * as THREE from 'three';

/**
 * El contrato entre un nivel y el controlador (Player): lo que el mundo sabe decir de sí mismo. `World` (nivel 0, Suites) y `PoolLevel` (Poolrooms) lo
 * implementan; el Player (y, a medida que se unifica el motor, todo lo demás) solo debería preguntar por aquí. Ver docs/engine-unification.md.
 * Todas las coordenadas son del mundo (m); `y` son los pies.
 */
export interface Terrain {
  /** Donde cuelga la escena del nivel. */
  readonly root: THREE.Object3D;
  /** Altura del suelo en (x, z) para unos pies a altura `y` (plantas, rampas, peldaños); null: pared. */
  floorAt(x: number, z: number, y?: number): number | null;
  /** Pared o fuera del mapa en ese punto (sin tener en cuenta la altura). */
  solid(x: number, z: number): boolean;
  /** ¿Cabe un cuerpo de radio `r` con los pies en `y` en (x, z)? (paredes, columnas, mobiliario, tubos...). */
  fits(x: number, z: number, y: number, r?: number): boolean;
  /** Agua en (x, z) a esa altura: la superficie y lo honda que es (de los pies a la superficie); null: seco. */
  liquidAt(x: number, z: number, y?: number): { surface: number; depth: number } | null;
  /** Hueco al vacío en ese punto (se cae). */
  voidAt(x: number, z: number): boolean;
}
