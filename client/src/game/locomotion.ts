import * as THREE from 'three';

/**
 * El movimiento del personaje, una sola vez para todos los niveles (ver docs/engine-unification.md). Lo usan el Player (nivel 0, Suites) y PoolLevel
 * (Poolrooms): las constantes y las reglas comunes están aquí; lo propio de cada mundo (paredes, agua, plantas) lo dice su `Terrain`.
 */
/** Andar y correr (m/s), salto (m/s de salida: sube 0,9 m), gravedad (m/s²) y altura de los ojos de pie (m). */
export const WALK = 1.7, RUN = 3.85, JUMP = Math.sqrt(2 * 9.8 * 0.9), G = 9.8, EYE = 1.62;
/** Cuánto baja la vista al agacharse, y lo que frena. */
export const CROUCH_DROP = 0.6, CROUCH_SLOW = 0.5;

/** Agachado de verdad: correr (Shift) manda sobre agacharse. */
export const ducking = (crouch?: boolean, run?: boolean) => !!crouch && !run;

/**
 * Hacia dónde y cuánto se mueve el cuerpo en un paso: la dirección de los mandos, sin ir más rápido en diagonal, con la fuerza del mando
 * (analógico); `speed` en m/s. Devuelve el desplazamiento (x, z) de `dt` segundos.
 */
export function planar(yaw: number, move: THREE.Vector2, speed: number, dt: number, out = new THREE.Vector2()) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const x = -sy * move.y + cy * move.x, z = -cy * move.y - sy * move.x, l = Math.hypot(x, z);
  if (l < 1e-6) return out.set(0, 0);
  const k = (Math.min(1, move.length()) / l) * speed * dt;
  return out.set(x * k, z * k);
}
