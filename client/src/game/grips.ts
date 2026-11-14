import raw from './grips.json';

/*
 * Cómo se agarra cada objeto: dónde va la muñeca de cada mano, cómo se orienta la mano y cuánto se cierra
 * cada dedo, y dónde va el objeto respecto a la vista. Son datos (grips.json), no código: la herramienta de
 * desarrollo (dev/anim/Grips.tsx, abrir con ?anim y la pestaña IK) los retoca viendo el resultado y los guarda.
 */

export type V3 = [number, number, number];
export interface Hand {
  /** La muñeca, en el espacio del objeto (metros). */
  pos: V3;
  /** La orientación de la mano respecto al objeto (grados, XYZ). */
  rot: V3;
  /** Cuánto se cierra cada dedo (radianes): pulgar, índice, corazón, anular, meñique. */
  curl: [number, number, number, number, number];
  /** Cuánto se abre el pulgar hacia fuera (radianes). */
  spread: number;
  /** Hacia dónde apunta el codo: un desplazamiento desde el hombro, en el espacio de la vista. */
  pole: V3;
}
export interface View {
  /** Dónde va el objeto respecto a la vista y cómo se gira (grados). */
  pos: V3;
  rot: V3;
  /** Camcorder, rifle y pistola de agua: dónde va al apuntar (clic derecho). */
  aim?: V3;
}
export interface GearGrips {
  view: View;
  left?: Hand;
  right?: Hand;
}
/** Lo que se agarra: los tres de siempre más lo que se saca de la barra rápida (cinta, radar y tótem, con la derecha). */
export type GripId = 'flashlight' | 'camera' | 'gun' | 'caution' | 'radar' | 'totem' | 'watergun' | 'water' | 'monster' | 'uno' | 'soap' | 'tape' | 'ammo' | import('@backrooms/shared').ParkingItemId;
export type GripSet = Record<GripId, GearGrips>;

/** Lo guardado en grips.json; `grips` es la copia viva (la herramienta la modifica y el jugador la lee cada fotograma). */
export const DEFAULT_GRIPS = raw as unknown as GripSet;
// los objetos nuevos que aún no tienen agarre propio en grips.json parten del de la lata (la herramienta los guarda al pulsar SAVE)
for (const k of ['monster', 'uno', 'glasses', 'pills', 'steelcard', 'beer'] as const) DEFAULT_GRIPS[k] ??= structuredClone(DEFAULT_GRIPS.water);
export const grips: GripSet = structuredClone(DEFAULT_GRIPS);
