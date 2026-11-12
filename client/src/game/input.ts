import * as THREE from 'three';
import { settings } from '../settings';

/*
 * Los controles del juego, de donde vengan: teclado y ratón (con el puntero bloqueado) o los
 * controles táctiles (Touch.tsx llama a stick/drag/press/hold). El juego lee una vez por fotograma.
 * Lo que suelta el puntero (Escape, cambiar de pestaña, una ventana del sistema) o el botón de atrás
 * del móvil pide pausa.
 */

export interface Controls {
  move: THREE.Vector2; // x a la derecha, y hacia delante, en [-1, 1]
  look: THREE.Vector2; // radianes este fotograma
  run: boolean;
  jump: boolean;
  flash: boolean; // pulsaciones: true solo el fotograma en que se pulsan
  grab: boolean; // G: recoger
  bag: boolean; // E: el inventario
  aim: boolean; // clic derecho mantenido: mirar por la cámara
  zoom: number; // la rueda mirando por la cámara (pasos)
  fire: boolean;
  reload: boolean;
  swap: boolean;
  /** Y: soltar una unidad del objeto elegido de la barra. */
  drop?: boolean;
  /** Barra de acceso rápido: la ranura (0–3) cuya tecla se ha pulsado este fotograma (-1 ninguna), los pasos de rueda y X (usar la elegida). */
  slot: number;
  wheel: number;
  use: boolean;
  pause: boolean;
  /** Space mantenido (contener la respiración en un escondite). */
  hold?: boolean;
  /** C o Ctrl izquierdo mantenido: agacharse (solo lo usa el nivel «Run for your life»; allí Shift/RUN también agacha). */
  crouch?: boolean;
  /** Clic izquierdo y G mantenidos (el chorro de la pistola de agua y la recarga). */
  fireHeld?: boolean;
  grabHeld?: boolean;
  /** La ranura (0–3) cuya tecla sigue pulsada (-1 ninguna) y X mantenida: beber una lata pide mantener. */
  slotHeld?: number;
  useHeld?: boolean;
}
export type Pulse = 'jump' | 'flash' | 'grab' | 'bag' | 'fire' | 'reload' | 'swap' | 'use' | 'pause' | 'drop';

const MOUSE = 0.0022; // radianes por píxel de ratón
const TOUCH = 0.006; // por píxel de dedo
const SPIKE = 500; // píxeles de ratón en un solo evento: más que esto no es una mano
const LOOK_CAP = 0.35; // radianes de giro máximos por fotograma
const LOOK_DROP = 1; // lo acumulado que sobra por encima de esto se tira
/** Teclas que el juego se queda mientras se juega (Keyboard Lock): sin ellas, Ctrl+W (agacharse + avanzar) cierra la pestaña, Ctrl+S guarda la página, etc. Escape no va: sigue pausando y sacando de pantalla completa. */
const LOCKED_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyG', 'KeyX', 'KeyY', 'KeyC', 'KeyT', 'KeyN', 'KeyP', 'KeyL', 'KeyH',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Space', 'Tab', 'F5',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
];
type KeyboardLockApi = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
const kbd = () => (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;

export class Input {
  private keys = new Set<string>();
  private look = new THREE.Vector2();
  private stickV = new THREE.Vector2();
  private pulses = new Set<Pulse>();
  private holds = new Set<'run' | 'aim'>();
  private zoomV = 0;
  private toggled = false;
  private fireDown = false;
  private offs: (() => void)[] = [];
  private wasLocked = false;
  private lockedAt = 0; // cuándo se capturó el puntero (los primeros ms traen un salto falso)
  // reanudar con Esc: el navegador no lo cuenta como gesto y no deja recapturar el puntero. Mientras dure `soft` un fallo al
  // capturarlo no pausa (pausar ahí era el bucle: Esc reanuda, falla el puntero, pausa otra vez): se pide un clic (`needClick`)
  private soft_ = false;
  private guardUntil = 0; // justo tras reanudar no se admite ninguna pausa (repetición de Esc, pointerlockchange tardío)
  private checkAt = 0; // si pasado esto sigue sin puntero, hace falta un clic
  /** Se juega sin el puntero capturado: el primer clic lo captura (HUD: "click to continue"). */
  needClick = false;
  private wheelV = 0;
  private slotV = -1;
  private asked = -1e9; // cuándo se pidió el puntero por última vez (pedirlo dos veces seguidas da error)
  /** Si hay que leer (en pausa o en el menú no: nada se acumula). */
  active = false;
  /** Con el inventario abierto el puntero va suelto: soltarlo no pausa y un clic no lo vuelve a bloquear. */
  private suspend_ = false;
  /** Quien más suelta el puntero (la consola de admin) lo hace con su propia llave: lo que haga el juego con `suspend` no la pisa ni la deja colgada. */
  private ext = new Set<string>();
  get suspend() {
    return this.suspend_ || this.ext.size > 0;
  }
  set suspend(v: boolean) {
    this.suspend_ = v;
  }
  /** Nadie captura el puntero (la votación de la misión): ni un clic, ni cerrar el chat, ni un pedido anterior que el navegador concede tarde. */
  noLock = false;
  block(key: string) {
    this.ext.add(key);
  }
  unblock(key: string) {
    this.ext.delete(key);
  }

  constructor(readonly el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      addEventListener(t, f as EventListener, o);
      this.offs.push(() => removeEventListener(t, f as EventListener, o));
    };
    const doc = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(t, f as EventListener);
      this.offs.push(() => document.removeEventListener(t, f as EventListener));
    };
    const KEYS: Record<string, Pulse> = { Space: 'jump', KeyF: 'flash', KeyG: 'grab', KeyE: 'bag', KeyR: 'reload', KeyQ: 'swap', KeyX: 'use', KeyY: 'drop' };
    on('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement | null)?.tagName === 'INPUT') return; // escribiendo (el chat): no es para el juego
      if (e.repeat) return; // (la repetición de Esc tras reanudar volvía a pausar)
      // tras reanudar con Esc el navegador no da el puntero hasta un gesto: cualquier otra tecla lo es
      if (this.needClick && e.code !== 'Escape' && !this.suspend) this.lock(true);
      if (e.code === 'Escape') return this.pulses.add(this.suspend ? 'bag' : 'pause'); // con el inventario abierto, lo cierra
      if (/^Digit[1-4]$/.test(e.code)) this.slotV = +e.code.slice(5) - 1;
      this.keys.add(e.code);
      // contener la respiración alternando (ajuste): Space la pone y la quita; entrar o salir de un escondite (E) la suelta
      if (e.code === 'Space') this.toggled = settings.toggleBreath && !this.toggled;
      else if (e.code === 'KeyE') this.toggled = false;
      const p = KEYS[e.code];
      if (p) this.pulses.add(p), e.preventDefault();
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('mousemove', (e) => {
      if (!this.locked) return;
      // los saltos falsos del ratón (Chrome da un golpe enorme al capturar el puntero y a veces después de un parón de la
      // página, sobre todo en equipos o conexiones lentas): se ignoran los 150 ms tras capturar y los deltas imposibles
      if (performance.now() - this.lockedAt < 150 || Math.abs(e.movementX) > SPIKE || Math.abs(e.movementY) > SPIKE) return;
      this.look.x += e.movementX * MOUSE * settings.sens;
      this.look.y += e.movementY * MOUSE * settings.sens * (settings.invertY ? -1 : 1);
    });
    on('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 2 && this.locked) return void this.holds.add('aim');
      if (e.button !== 0) return;
      if (this.locked) (this.pulses.add('fire'), (this.fireDown = true));
      else if (!this.suspend && matchMedia('(pointer: fine)').matches) this.soft_ = true, this.lock(true);
    });
    // al volver a la ventana (Alt+Tab) no hay puntero y el navegador no lo da sin un gesto: se pide un clic en vez de quedarse en un limbo
    on('focus', () => {
      if (this.active && !this.suspend && !this.locked && matchMedia('(pointer: fine)').matches) (this.soft_ = true), (this.needClick = true);
    });
    on('mouseup', (e) => (e.button === 2 ? this.holds.delete('aim') : e.button === 0 && (this.fireDown = false)));
    // el clic derecho es de la cámara, no del menú del navegador
    on('contextmenu', (e) => this.active && e.preventDefault());
    // la rueda: cambia de ranura de la barra o, mirando por la cámara, el zoom
    on(
      'wheel',
      (e) => {
        if (!this.active || !this.locked || Math.abs(e.deltaY) <= 4) return;
        if (this.holds.has('aim')) this.zoomV -= Math.sign(e.deltaY);
        else this.wheelV += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    // lo que se lleva el puntero o la pestaña: pausa
    doc('pointerlockchange', () => {
      this.asked = -1e9;
      // un puntero que llega cuando ya no se juega (se pidió con el clic de entrar y la carga del nivel empezó antes de que el navegador lo diera): se devuelve
      if (this.locked && (!this.active || this.noLock)) return void document.exitPointerLock();
      if (this.locked) (this.lockedAt = performance.now()), (this.needClick = this.soft_ = false), this.grabKeyboard();
      else this.freeKeyboard();
      if (this.wasLocked && !this.locked && this.active && !this.suspend) this.pulses.add('pause');
      this.wasLocked = this.locked;
    });
    // Ctrl+W (agacharse + avanzar), Ctrl+T, Ctrl+N...: el navegador se los queda aunque se juegue. Keyboard Lock los deja pasar al juego (Chrome/Edge:
    // los atajos reservados como Ctrl+W solo se capturan en pantalla completa); donde no hay (o no basta), al menos se pide confirmación antes de cerrar la pestaña
    on('beforeunload', (e) => {
      if (!this.active) return;
      e.preventDefault();
      e.returnValue = '';
    });
    // el navegador no da el puntero (pedido muy pronto tras soltarlo, o sin un clic): sin ratón no se juega
    doc('pointerlockerror', () => ((this.asked = -1e9), this.fail()));
    // salir de pantalla completa (Escape con el inventario abierto, el gesto de atrás en el móvil): pausa
    doc('fullscreenchange', () => !document.fullscreenElement && this.active && this.pulses.add('pause'));
    on('blur', () => this.active && this.pulses.add('pause'));
    doc('visibilitychange', () => document.hidden && this.active && this.pulses.add('pause'));
    on('popstate', () => {
      if (!this.active) return;
      this.pulses.add('pause');
      history.pushState({ backrooms: 1 }, ''); // que el siguiente atrás vuelva a pausar, no a salir
    });
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }

  /** Bloquear el puntero (solo con ratón; en táctil no hace falta). */
  lock(gesture = false) {
    // (un clic o una tecla del usuario salta la espera: si el navegador se tragó el pedido anterior sin avisar, no se quedaba sin puntero)
    if (this.noLock || !matchMedia('(pointer: fine)').matches || this.locked || (!gesture && performance.now() - this.asked < 1000)) return;
    this.asked = performance.now();
    try {
      // movimiento crudo (sin aceleración del sistema: en Opera/Chrome con ratones de alta frecuencia el giro iba a saltos);
      // si el navegador no admite la opción (Firefox) o la rechaza, se pide normal
      const raw = () => this.el.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown as Promise<void> | undefined;
      const plain = () => this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      const r = raw();
      r?.catch?.(() => {
        try {
          plain()?.catch?.(() => this.fail());
        } catch {
          this.fail();
        }
      });
    } catch {
      this.fail();
    }
  }

  /** El navegador no da el puntero: tras reanudar con Esc se pide un clic; si no, sin ratón no se juega (pausa). */
  private fail() {
    if (!this.active) return;
    // nunca pausa por esto: cerrar el ordenador, el inventario o el chat con Esc (que no es un gesto) pedía el puntero y, al
    // fallar, pausaba el juego. Ahora se sigue jugando y el primer clic o tecla lo captura (CLICK TO CONTINUE)
    this.soft_ = true;
    this.needClick = true;
  }

  /** Reanudar con Esc (llamar antes de reanudar): se sigue jugando aunque no haya puntero y el primer clic lo captura (ver mousedown). */
  soft() {
    this.soft_ = true;
    this.guardUntil = performance.now() + 500;
    this.checkAt = performance.now() + 700;
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
    this.freeKeyboard();
  }

  /** Se queda las teclas del juego (ver LOCKED_KEYS). Si el navegador no lo admite o lo rechaza, no pasa nada. */
  private grabKeyboard() {
    try {
      kbd()?.lock?.(LOCKED_KEYS)?.catch?.(() => {});
    } catch {
      /* sin Keyboard Lock */
    }
  }
  private freeKeyboard() {
    try {
      kbd()?.unlock?.();
    } catch {
      /* sin Keyboard Lock */
    }
  }

  /** Empieza la partida: atrás del móvil pausa en vez de salir. */
  begin() {
    this.active = true;
    history.pushState({ backrooms: 1 }, '');
    this.lock();
  }

  // los controles táctiles
  stick(x: number, y: number) {
    this.stickV.set(x, y);
  }
  drag(dx: number, dy: number) {
    this.look.x += dx * TOUCH;
    this.look.y += dy * TOUCH;
  }
  press(p: Pulse) {
    if (this.active) this.pulses.add(p);
  }
  hold(name: 'run' | 'aim', on: boolean) {
    if (on) this.holds.add(name);
    else this.holds.delete(name);
  }

  read(): Controls {
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const move = new THREE.Vector2(kx, ky).add(this.stickV);
    if (move.lengthSq() > 1) move.normalize();
    const p = this.pulses;
    const c: Controls = {
      move,
      look: this.look.clone(),
      run: k.has('ShiftLeft') || k.has('ShiftRight') || this.holds.has('run'),
      jump: p.has('jump'),
      flash: p.has('flash'),
      grab: p.has('grab'),
      bag: p.has('bag'),
      aim: this.holds.has('aim'),
      zoom: this.zoomV,
      fire: p.has('fire'),
      reload: p.has('reload'),
      swap: p.has('swap'),
      drop: p.has('drop'),
      slot: this.slotV,
      wheel: this.wheelV,
      use: p.has('use'),
      pause: p.has('pause') && performance.now() >= this.guardUntil,
      hold: settings.toggleBreath ? this.toggled : k.has('Space'),
      crouch: k.has('KeyC') || k.has('ControlLeft'),
      fireHeld: this.fireDown,
      grabHeld: k.has('KeyG'),
      slotHeld: [0, 1, 2, 3].find((i) => k.has('Digit' + (i + 1))) ?? -1,
      useHeld: k.has('KeyX'),
    };
    // el giro de un fotograma tiene tope: tras un parón de la página (red lenta, GC) el ratón acumulado no se aplica de
    // golpe, sino repartido en los fotogramas siguientes; lo que pase de 1 rad se descarta (era un salto falso)
    const cap = (v: number) => Math.max(-LOOK_CAP, Math.min(LOOK_CAP, v));
    c.look.set(cap(this.look.x), cap(this.look.y));
    this.look.sub(c.look);
    if (Math.abs(this.look.x) > LOOK_DROP || Math.abs(this.look.y) > LOOK_DROP) this.look.set(0, 0);
    this.zoomV = 0;
    this.wheelV = 0;
    this.slotV = -1;
    // vigilante: se juega (sin pausa, inventario ni chat) y no hay puntero, y nadie lo está pidiendo: hace falta un clic.
    // Cubre los casos raros (Alt+Tab, Esc repetido, un pedido perdido) que ningún otro camino atrapaba
    if (this.active && !this.suspend && !this.locked && !this.needClick && performance.now() - this.asked > 1200 && performance.now() >= this.guardUntil && matchMedia('(pointer: fine)').matches) (this.soft_ = true), (this.needClick = true);
    // reanudado con Esc y 0,7 s después sigue sin puntero: hace falta un clic
    if (this.checkAt && performance.now() >= this.checkAt) {
      this.checkAt = 0;
      if (this.soft_ && !this.locked && !this.suspend && matchMedia('(pointer: fine)').matches) this.needClick = true;
    }
    p.clear();
    return c;
  }

  /** Al pausar: lo pulsado se suelta (si no, al volver se seguiría andando solo). */
  clear() {
    this.keys.clear();
    this.toggled = false;
    this.holds.clear();
    this.pulses.clear();
    this.needClick = this.soft_ = false;
    this.checkAt = 0;
    this.wheelV = 0;
    this.slotV = -1;
    this.look.set(0, 0);
    this.stickV.set(0, 0);
  }

  dispose() {
    this.unlock();
    for (const off of this.offs) off();
  }
}
