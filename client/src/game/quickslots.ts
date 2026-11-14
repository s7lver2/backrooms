import type { Player } from './player';
import type { IconKey } from './invIcons';
import { AMMO_PACK } from '@backrooms/shared';

/*
 * La barra de acceso rápido: 4 ranuras (teclas 1–4; la rueda cambia la elegida, X usa la elegida) con el id de un objeto.
 * Para añadir uno (cinta de acordonar, radar...) basta una entrada en HOT: cómo se llama, su icono, si se tiene, cuántos hay
 * y qué pasa al usarlo (`use`: sacarlo, o guardarlo si ya está en la mano) y cómo se sabe que está en la mano (`held`). Es la parte de cliente de la
 * ficha de cada objeto (ITEMS, en shared/missions.ts).
 */

export const HOT_SLOTS = 4;

/** Lo que se gasta, en fracción (0–1); solo el Inv del HUD lo trae. */
export interface Fracs {
  charge: number;
  battery: number;
  tape: number;
  ammo: number;
  /** Depósito de la pistola de agua. */
  squirt?: number;
}

/** Lo que hace falta saber de lo que se lleva (lo cumplen Player y el Inv del HUD). */
export interface Own {
  water: number;
  totem: number;
  radar: boolean;
  camera: boolean;
  gun: boolean;
  caution: boolean;
  /** Poolrooms: la pistola de agua. */
  watergun?: boolean;
  uno?: boolean;
  monster?: number;
}

export interface HotDef {
  name: string;
  icon: IconKey;
  have(o: Own): boolean;
  /** Lo que queda (0–1) de lo que se gasta: carga, rollo, cargador. */
  frac?(o: Fracs): number | undefined;
  /** Cuántos hay, si se cuentan. */
  count?(o: Own): number;
  /** Lo que pasa al usarlo (número de la ranura, X, clic en la barra). */
  use(p: Player): void;
  /** ¿Está ya en la mano? (elegir su ranura con la rueda lo saca si no lo está) */
  held(p: Player): boolean;
  /** Una línea para el detalle. */
  info: string;
}

const gear = (g: 'camera' | 'gun', name: string, info: string): HotDef => ({
  name,
  icon: g,
  have: (o) => o[g],
  frac: g === 'camera' ? (o) => o.battery : (o) => o.ammo / AMMO_PACK,
  info,
  use: (p) => (p.hand === g ? p.hold('none') : void p.place('right', g)),
  held: (p) => p.hand === g,
});

export const HOT: Record<string, HotDef> = {
  camera: gear('camera', 'CAMCORDER', 'Take it in hand, or put it away.'),
  gun: gear('gun', 'RIFLE', 'Take it in hand, or put it away.'),
  caution: {
    name: 'CAUTION TAPE',
    icon: 'caution',
    have: (o) => o.caution,
    frac: (o) => o.tape,
    use: (p) => p.equipGadget('caution'),
    held: (p) => p.gadget === 'caution',
    info: 'Click the floor to mark where the tape starts, click again for where it ends. Right click cancels. G on a tape peels it off.',
  },
  radar: {
    name: 'RADAR',
    icon: 'radar',
    have: (o) => o.radar,
    use: (p) => p.equipGadget('radar'),
    held: (p) => p.gadget === 'radar',
    info: 'A hologram over the device shows where your teammates are. There is only one on the map.',
  },
  totem: {
    name: 'TOTEM OF LIFE',
    icon: 'totem',
    have: (o) => o.totem > 0,
    count: (o) => o.totem,
    use: (p) => p.equipGadget('totem'),
    held: (p) => p.gadget === 'totem',
    info: 'Take it in hand and click to bring back a fallen teammate. They have to run for their life first.',
  },
  watergun: {
    name: 'WATER GUN',
    icon: 'watergun',
    have: (o) => !!o.watergun,
    frac: (o) => o.squirt,
    use: (p) => (p.hand === 'watergun' ? p.hold('none') : p.hold('watergun')),
    held: (p) => p.hand === 'watergun',
    info: 'Hold the left click to spray. Hold G at a drinking fountain in the Poolrooms to refill it; it cannot be refilled in the Backrooms.',
  },
  uno: {
    name: 'UNO REVERSE',
    icon: 'uno',
    have: (o) => !!o.uno,
    use: (p) => p.equipUno(),
    held: (p) => p.prop === 'uno',
    info: 'Take it in hand and hold the key (or the left click) to play it: you swap places with a random teammate. One use: the card is gone after.',
  },
  monster: {
    name: 'MONSTER',
    icon: 'monster',
    have: (o) => (o.monster ?? 0) > 0,
    count: (o) => o.monster ?? 0,
    use: (p) => p.equipMonster(),
    held: (p) => p.prop === 'monster',
    info: 'Take it in hand and hold the key (or the left click) for 3 seconds to drink. Then 5 seconds of +40% speed and endless stamina.',
  },
  water: {
    name: 'ALMOND WATER',
    icon: 'water',
    have: (o) => o.water > 0,
    count: (o) => o.water,
    use: (p) => p.equipWater(),
    held: (p) => p.prop === 'water',
    info: 'Take it in hand and press the key (or the left click) to drink it at once. Restores 40% health, stamina and sanity.',
  },
};
