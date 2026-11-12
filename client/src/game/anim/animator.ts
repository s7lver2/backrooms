import * as THREE from 'three';
import { Machine, Pose, build, lerpPose, loadPack, type Ctx, type Node, type NodeDef, type Pack } from './core';
import { DANCES } from './dance';
import { IKStack } from './ikstack';
import treeJson from './tree.json';
import variantsJson from './variants.json';
import dancesJson from './dances.json';
import manifestJson from './manifest.json';

/*
 * El Animator: evalúa el árbol (tree.json) cada fotograma con sus parámetros, mezcla encima lo que se
 * reproduce suelto (bailes, recargas, muerte…), pone el resultado en los huesos y pasa la pila de IK.
 * Los datos (árbol, bailes, variantes, categorías de clips) son JSON que edita la herramienta (?anim).
 */

export interface TreeDef {
  params: Record<string, number>;
  slots: Record<string, string>;
  root: NodeDef;
}
export interface Variant {
  id: string;
  name: string;
  /** Qué clip sustituye a cada nombre lógico del árbol (p. ej. walk → «Strut Walking»). */
  slots: Record<string, string>;
}
export type Cat = 'tree' | 'dance' | 'part' | 'variant' | 'action';

export const TREE = treeJson as unknown as TreeDef;
export const VARIANTS = variantsJson as unknown as Variant[];
export const MANIFEST = manifestJson as Record<string, Cat>;
Object.assign(DANCES, dancesJson);

/** Una categoría a ojo por el nombre del clip, para los que se añaden solos (se puede cambiar en Anim Studio). */
export const guessCat = (n: string): Cat =>
  /dance|samba|macarena|twist|hip ?hop|moonwalk|can can|belly|shuffle|breakdance|salsa|robot|swing|capoeira|flair/i.test(n)
    ? 'dance'
    : /walk|run|jog|idle|crouch|jump|fall|roll|sprint|strut|stand/i.test(n)
      ? 'tree'
      : /death|dying|reload|hit|react|shoot|attack|punch|kick|pick up|drink/i.test(n)
        ? 'action'
        : 'part';

/** Máscaras por hueso: a qué huesos afecta una capa. */
const MASKS: Record<string, (n: string) => boolean> = {
  all: () => true,
  upper: (n) => /^(Spine|Neck|Head|(Left|Right)(Shoulder|Arm|ForeArm|Hand))/.test(n),
  arms: (n) => /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)/.test(n),
  head: (n) => /^(Neck|Head)/.test(n),
  lower: (n) => /^(Hips|(Left|Right)(UpLeg|Leg|Foot|Toe))/.test(n),
};

interface Over {
  node: Node;
  fadeIn: number;
  fadeOut: number;
  t: number;
  hold: boolean;
  out: boolean;
  w: number;
}

export class Animator {
  readonly p: Record<string, number> = { ...TREE.params };
  readonly slots: Record<string, string> = { ...TREE.slots };
  readonly ik: IKStack;
  readonly ctx: Ctx;
  variant = '';
  /** Nombre del clip que domina ahora (para el aviso de red antiguo y para depurar). */
  current = '';
  private tree: Node;
  private bones: (THREE.Bone | undefined)[];
  private hips?: THREE.Bone;
  private hipsI = 0;
  private airK = 0;
  private upK = 0;
  private scale: number;
  /** El Armature del GLB está girado (Blender): la cadera, que lleva ese giro, pide la pose del FBX con él descontado. */
  private pInv = new THREE.Quaternion();
  private bind = new THREE.Vector3();
  private pool: Pose[] = [];
  private pose: Pose;
  private over?: Over;
  /** Los huesos que el paquete no anima (dedos…) vuelven a su reposo cada fotograma: si no, se quedan como los dejó el IK de antes. */
  private free: { b: THREE.Bone; q: THREE.Quaternion }[] = [];
  /** Si es true, update() no pasa el IK: lo pasa quien llama (ik.run) cuando ya tiene los objetivos de este fotograma. */
  deferIk = false;

  constructor(readonly root: THREE.Object3D, readonly pack: Pack) {
    this.bones = pack.bones.map((n) => root.getObjectByName('mixamorig' + n) as THREE.Bone | undefined);
    this.hipsI = pack.bones.indexOf('Hips');
    this.hips = this.bones[this.hipsI];
    if (this.hips) {
      const q = new THREE.Quaternion();
      for (let o = this.hips.parent; o && o !== root; o = o.parent) q.premultiply(o.quaternion);
      this.pInv.copy(q).invert();
      this.bind.copy(this.hips.position).applyQuaternion(q); // la cadera en reposo, en el espacio del FBX (y arriba)
    }
    this.scale = this.hips ? this.bind.y / pack.hipsBindY : 1; // (el FBX va en cm, como el modelo: la altura de cadera da la escala)
    const nb = pack.bones.length;
    this.pose = new Pose(nb);
    const masks: Record<string, Float32Array> = {};
    for (const [k, f] of Object.entries(MASKS)) masks[k] = Float32Array.from(pack.bones, (n) => (f(n) ? 1 : 0));
    this.ctx = { p: this.p, slots: this.slots, pack, masks, tmp: () => this.pool.pop() ?? new Pose(nb), free: (x) => this.pool.push(x) };
    this.tree = build(TREE.root);
    const driven = new Set(this.bones.filter(Boolean));
    root.traverse((o) => (o as THREE.Bone).isBone && !driven.has(o as THREE.Bone) && this.free.push({ b: o as THREE.Bone, q: o.quaternion.clone() }));
    this.ik = new IKStack(root, (n) => root.getObjectByName('mixamorig' + n) as THREE.Bone | undefined);
  }

  /** Reconstruye el árbol desde TREE (la herramienta lo llama tras editarlo). */
  rebuild() {
    this.tree = build(TREE.root);
  }

  setVariant(id: string) {
    this.variant = id;
    Object.assign(this.slots, TREE.slots);
    Object.assign(this.slots, VARIANTS.find((v) => v.id === id)?.slots);
  }

  /** Reproduce encima del árbol un baile (id de dances.json), un clip suelto o un nodo; `hold` lo deja en el último fotograma. */
  playOver(what: string | Node, o: { fadeIn?: number; fadeOut?: number; hold?: boolean } = {}) {
    const node = typeof what === 'string' ? build(DANCES[what] ? { type: 'dance', id: what } : { type: 'clip', clip: what, loop: false }) : what;
    node.reset();
    this.over = { node, fadeIn: o.fadeIn ?? 0.25, fadeOut: o.fadeOut ?? 0.25, t: 0, hold: !!o.hold, out: false, w: this.over?.w ?? 0 };
    this.current = typeof what === 'string' ? what : 'over';
  }
  /** Un clip en bucle encima del árbol, a la velocidad `rate` (la herramienta lo usa para verlos). */
  playOverClip(name: string, rate = 1) {
    this.playOver(build({ type: 'clip', clip: name, rate, loop: true }), { hold: true });
    this.current = name;
  }
  stopOver() {
    if (this.over) this.over.out = true;
  }
  get playing() {
    return !!this.over;
  }
  /** La primera máquina de estados del árbol (la de movimiento): la herramienta muestra en cuál está. */
  get machine(): Machine | undefined {
    const find = (n: Node): Machine | undefined => (n instanceof Machine ? n : n.children().map(find).find(Boolean));
    return find(this.tree);
  }
  /** El nodo que se reproduce encima (la herramienta lo usa para avanzar o rebobinar un baile). */
  get overNode() {
    return this.over?.node;
  }

  update(dt: number) {
    const c = this.ctx;
    this.tree.update(dt, c);
    this.tree.eval(this.pose, c);
    const o = this.over;
    if (o) {
      o.node.update(dt, c);
      if (o.node.ended && !o.hold) o.out = true;
      o.w = o.out ? o.w - dt / Math.max(0.01, o.fadeOut) : o.w + dt / Math.max(0.01, o.fadeIn);
      o.w = Math.min(1, o.w);
      if (o.w <= 0 && o.out) this.over = undefined;
      else {
        const p = c.tmp(), b = c.tmp();
        o.node.eval(p, c);
        b.copy(this.pose);
        lerpPose(this.pose, b, p, o.w * o.w * (3 - 2 * o.w));
        c.free(p), c.free(b);
      }
    }
    this.apply();
    if (!this.deferIk) this.ik.run(dt);
  }

  private apply() {
    const P = this.pose;
    for (const f of this.free) f.b.quaternion.copy(f.q);
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (b && P.has[i]) b.quaternion.set(P.q[i * 4], P.q[i * 4 + 1], P.q[i * 4 + 2], P.q[i * 4 + 3]);
    }
    const h = this.hips;
    if (h) {
      if (P.has[this.hipsI]) h.quaternion.premultiply(this.pInv);
      // en el aire la cadera no sube con la animación: la altura del salto ya la pone el juego (si no, el cuerpo sube dos veces y se separa de la cámara y las manos)
      this.airK += (Math.min(1, this.p.air || 0) - this.airK) * 0.3;
      this.upK = this.p.air ? 1 : Math.max(0, this.upK - 0.06); // (entra de golpe y sale despacio: con la mezcla de la cadera se veía un instante al saltar y al caer)
      if (P.has[this.hipsI]) h.quaternion.slerp(this.pInv, this.upK * 0.85); // y el tronco va derecho: el clip de caída lo echa hacia delante y en primera persona se ve el cuerpo volcarse
      if (P.hy) h.position.set(this.bind.x, (P.hy + (this.pack.hipsBindY - P.hy) * this.airK) * this.scale, this.bind.z).applyQuaternion(this.pInv); // (en el sitio: x y z de la cadera quietas, la posición la lleva el juego)
    }
    this.root.updateWorldMatrix(true, true);
  }
}

let ready: Promise<Pack> | undefined;
/** Los datos pesados (clips) de las animaciones del jugador; se bajan una vez. */
export const loadAnimations = () => (ready ??= loadPack());
