import * as THREE from 'three';
import { fit } from './player';
import { model } from './cosmetics';

/*
 * Las miniaturas del armario: un solo renderer WebGL pequeño, compartido, que pinta cada objeto (un sombrero, la mochila, un
 * muñeco con el tinte) girando despacio y copia el resultado al lienzo 2D de su cajita. Se pausa si la pestaña está oculta
 * o las cajitas fuera de pantalla; con movimiento reducido pinta una vez, quieto. Lo bloqueado se pinta como una silueta.
 */

export type ThumbSpec = { kind: 'color'; hex: string } | { kind: 'model'; id: string } | { kind: 'none' };

const SIZE = 128; // px del lienzo del renderer y de cada cajita
const DARK = 0x4a473d; // la silueta de lo bloqueado

interface Entry {
  cv: HTMLCanvasElement;
  obj?: THREE.Object3D;
  own: THREE.Material[];
  phase: number;
  on: boolean; // su cajita está a la vista dentro del panel
}

/** El muñeco simple de un color: torso, cabeza y una visera, para que se note que gira. */
function dummy(hex: string | null, own: THREE.Material[]) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: hex ?? DARK, roughness: 0.6 });
  const dark = hex ? new THREE.MeshStandardMaterial({ color: 0x1b1a14, roughness: 0.4 }) : skin;
  own.push(skin, dark);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 4, 14), skin);
  body.position.y = -0.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), skin);
  head.position.y = 0.38;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.1), dark);
  visor.position.set(0, 0.4, 0.17);
  const geo = [body.geometry, head.geometry, visor.geometry];
  g.add(body, head, visor);
  g.userData.dispose = () => geo.forEach((x) => x.dispose());
  return g;
}

export class Thumbs {
  private r?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private entries = new Map<HTMLCanvasElement, Entry>();
  private raf = 0;
  private visible = true;
  private io?: IntersectionObserver;
  private cio?: IntersectionObserver; // por cajita: solo se pintan las que se ven
  private byCv = new Map<Element, Entry>();
  private last = 0;
  private dead = false;

  constructor(private reduced: boolean, watch?: Element | null) {
    this.cam.position.set(0, 0.45, 3.3);
    this.cam.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 1.7));
    const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
    key.position.set(2, 3, 3);
    this.scene.add(key);
    if (watch && 'IntersectionObserver' in window) {
      this.io = new IntersectionObserver((e) => void (this.visible = e.some((x) => x.isIntersecting)));
      this.io.observe(watch);
    }
    if ('IntersectionObserver' in window)
      this.cio = new IntersectionObserver((es) => es.forEach((x) => { const e = this.byCv.get(x.target); if (e) e.on = x.isIntersecting; }), { root: watch ?? null });
    // estáticas: pintar todas cada frame con el renderer de Phoenyx era el lag del armario
  }

  /** Una cajita: se pinta con su especificación. Devuelve la función que la quita. `dark`: bloqueada, solo silueta. */
  add(cv: HTMLCanvasElement, spec: ThumbSpec, dark: boolean) {
    const e: Entry = { cv, own: [], phase: this.entries.size * 0.9, on: !this.cio };
    this.entries.set(cv, e);
    this.byCv.set(cv, e);
    this.cio?.observe(cv);
    if (spec.kind === 'color') e.obj = dummy(dark ? null : spec.hex, e.own);
    else if (spec.kind === 'model') {
      void model(spec.id).then((src) => {
        if (!src || this.dead || this.entries.get(cv) !== e) return;
        const o = fit(src.clone(true), 1.05);
        if (dark) {
          const m = new THREE.MeshBasicMaterial({ color: DARK });
          e.own.push(m);
          o.traverse((x) => void ((x as THREE.Mesh).isMesh && ((x as THREE.Mesh).material = m)));
        }
        e.obj = o;
        this.draw(e, 0.6);
      });
    }
    if (e.obj) this.draw(e, 0.6);
    return () => {
      this.entries.delete(cv);
      this.byCv.delete(cv);
      this.cio?.unobserve(cv);
      e.own.forEach((m) => m.dispose());
      (e.obj?.userData.dispose as (() => void) | undefined)?.();
    };
  }

  private draw(e: Entry, angle: number) {
    if (!e.obj) return;
    const r = (this.r ??= (() => {
      const x = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      x.outputColorSpace = THREE.SRGBColorSpace;
      x.toneMapping = THREE.ACESFilmicToneMapping;
      x.setPixelRatio(1);
      x.setSize(SIZE, SIZE, false);
      return x;
    })());
    const ctx = e.cv.getContext('2d');
    if (!ctx) return;
    e.obj.rotation.y = angle;
    this.scene.add(e.obj);
    r.render(this.scene, this.cam);
    this.scene.remove(e.obj);
    ctx.clearRect(0, 0, e.cv.width, e.cv.height);
    ctx.drawImage(r.domElement, 0, 0, e.cv.width, e.cv.height);
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden || now - this.last < 66) return; // ~15 fps
    this.last = now;
    for (const e of this.entries.values()) if (e.on && e.obj) this.draw(e, now / 1800 + e.phase);
  };

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
    this.cio?.disconnect();
    this.entries.forEach((e) => e.own.forEach((m) => m.dispose()));
    this.entries.clear();
    this.r?.dispose();
    this.r?.forceContextLoss();
  }
}
