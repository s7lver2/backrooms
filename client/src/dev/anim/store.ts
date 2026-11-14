import { createContext, useContext } from 'react';
import type * as THREE from 'three';
import { DANCES, type DanceDef } from '../../game/anim/dance';
import { TREE, VARIANTS, MANIFEST, type Animator, type Variant } from '../../game/anim/animator';
import type { Pack } from '../../game/anim/core';
import type { Player } from '../../game/player';
import { grips, type GripId, type GripSet } from '../../game/grips';
import { worn, type WornItem } from '../../game/worn';
import { PIECES, type Piece } from '../../game/cosmetics';

/** Lo que comparten el visor y los paneles: el jugador de verdad, su Animator y el paquete. */
export interface Live {
  A: Animator;
  player: Player;
  pack: Pack;
  /** Parámetros a mano (sin mover al jugador). */
  manual: boolean;
  /** Qué lleva en las manos. */
  hold: 'none' | 'rifle' | 'flashlight';
  /** Terreno de prueba, torso y manos del IK. */
  ik: { foot: boolean; bump: number; aim: boolean; yaw: number; pitch: number; handL: boolean; handR: boolean; tx: number; ty: number; tz: number };
  /** El objeto de la pestaña de agarres que lleva el personaje ('' = el de la pestaña de movimiento). */
  gear: '' | GripId;
  /** Vista en primera persona (la del juego) y apuntar con clic derecho. */
  first: boolean;
  gripAim: boolean;
  /** Se ve la bombona a la espalda (para colocarla). */
  tank: boolean;
  /** El sombrero o la mochila (de pieces.json) que lleva puesto para colocarlo ('' = ninguno). */
  piece: string;
  /** El mando de pruebas: velocidad, caminar solo, cinta andadora, cámara lenta, pausa… */
  ctl: Mando;
  /** Pone la cámara en un ángulo predefinido (relativo a hacia dónde mira el personaje). */
  setCam: (name: CamName) => void;
  /** Vuelve el personaje al centro, quieto. */
  reset: () => void;
  /** Hay un baile reproduciéndose desde la línea de tiempo (el visor no debe pisarlo). */
  danceOn: boolean;
  setTerrain: () => void;
  cam: THREE.PerspectiveCamera;
}
export type CamName = 'front' | 'side' | 'back' | 'top' | 'three' | 'hands' | 'feet' | 'first' | 'item';
export const CAMS: [CamName, string, string][] = [
  ['front', 'Front', '1'], ['three', '3/4', '2'], ['side', 'Side', '3'], ['back', 'Back', '4'], ['top', 'Top', '5'], ['hands', 'Hands', '6'], ['feet', 'Feet', '7'], ['first', 'First person', '8'], ['item', 'Item', '9'],
];
/** El mando de pruebas del visor. */
export interface Mando {
  /** Velocidad objetivo (m/s) cuando se camina solo o con el control deslizante. */
  speed: number;
  /** Caminar solo: recto o en círculo (con `turn` rad/s). */
  auto: 'off' | 'straight' | 'circle';
  turn: number;
  /** Cinta andadora: el personaje no se aleja del centro (el suelo se desliza). */
  treadmill: boolean;
  /** Cámara lenta (0,05–2). */
  timeScale: number;
  paused: boolean;
  /** Avanzar un solo fotograma (con la pausa). */
  step: boolean;
  /** Palanca virtual: x gira, y avanza (−1…1). */
  joy: { x: number; y: number };
  crouch: boolean;
  jump: boolean;
  skeleton: boolean;
  grid: boolean;
}
export type Mode = 'library' | 'locomotion' | 'dances' | 'variants' | 'ik';
export interface Api {
  S?: Live;
  clips: string[];
  thumbs: Record<string, string>;
  mode: Mode;
  setMode: (m: Mode) => void;
  /** Clip seleccionado en la biblioteca. */
  sel: string;
  setSel: (c: string) => void;
  /** Cambia datos (árbol, bailes, variantes, categorías): hace lo de `fn`, lo apunta para deshacer y repinta. */
  edit: (fn?: () => void, rebuild?: boolean) => void;
  /** Una vista previa suelta: el clip en bucle en el visor (null = quitarla). */
  preview: (clip: string | null, rate?: number) => void;
  tick: number;
}
export const StudioCtx = createContext<Api>(null!);
export const useStudio = () => useContext(StudioCtx);

// ── deshacer / rehacer ────────────────────────────────────────────────────

export const snapshot = () => JSON.stringify({ tree: TREE, variants: VARIANTS, dances: DANCES, manifest: MANIFEST, grips, worn, pieces: PIECES });
export function restore(s: string) {
  const d = JSON.parse(s) as { tree: typeof TREE; variants: Variant[]; dances: Record<string, DanceDef>; manifest: typeof MANIFEST; grips: GripSet; worn: Record<'tank', WornItem>; pieces: Record<string, Piece> };
  for (const [id, p] of Object.entries(d.pieces)) Object.assign(PIECES[id] ?? (PIECES[id] = p), p);
  Object.assign(TREE, d.tree);
  VARIANTS.splice(0, VARIANTS.length, ...d.variants);
  for (const k of Object.keys(DANCES)) delete DANCES[k];
  Object.assign(DANCES, d.dances);
  for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
  Object.assign(MANIFEST, d.manifest);
  Object.assign(worn.tank, d.worn.tank);
  for (const g of Object.keys(d.grips) as GripId[]) {
    for (const k of Object.keys(grips[g])) delete (grips[g] as unknown as Record<string, unknown>)[k];
    Object.assign(grips[g], d.grips[g]);
  }
}

export const CAT_COLOR: Record<string, string> = { tree: '#4a8f72', dance: '#c0793c', part: '#a05fb0', variant: '#3c8fc0', action: '#b04f4f' };
export const CAT_LABEL: Record<string, string> = { tree: 'movement', dance: 'dance', part: 'dance part', variant: 'variant', action: 'action' };

/** Lo que lleva el personaje en las manos: el objeto de la pestaña de agarres si hay uno elegido, y si no, lo del modo de movimiento. */
export function applyCarry(S: Live) {
  const p = S.player, g = S.gear;
  if (g) {
    p.left = 'flashlight';
    p.hold(g === 'camera' || g === 'gun' || g === 'watergun' ? g : 'none');
    p.gadget = g === 'caution' || g === 'radar' || g === 'totem' ? g : 'none';
    if (g === 'monster') (p.monster = Math.max(p.monster, 1)), p.equipMonster(); // (su modelo se pone al sacarla)
    if (g === 'uno') (p.uno = true), p.equipUno();
    if (g === 'pokeball' || g === 'nokia' || g === 'bat') (p[g] = true), p.equipTool(g);
    if (g === 'grenade') (p.grenade = Math.max(p.grenade, 1)), p.equipTool('grenade');
    p.prop = g === 'water' || g === 'monster' || g === 'uno' || g === 'pokeball' || g === 'grenade' || g === 'nokia' || g === 'bat' || g === 'soap' || g === 'tape' || g === 'ammo' ? g : 'none';
  } else {
    p.gadget = 'none';
    p.prop = 'none';
    p.hold(S.hold === 'rifle' ? 'gun' : 'none');
    p.left = S.hold === 'none' ? 'none' : 'flashlight';
  }
}
