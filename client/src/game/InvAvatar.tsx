import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DEFAULT_LOOK, type Look } from '@backrooms/shared';
import type { Assets } from './game';
import { Cosmetics } from './cosmetics';
import { fit } from './player';

/*
 * El personaje del inventario: el hazmat con su aspecto (tinte y accesorios) en un lienzo propio, girando despacio o
 * arrastrando con el ratón. Lo que se equipa se ve: la linterna en la mano izquierda, la camcorder o el rifle en la
 * derecha y, en el cinturón, la otra pieza. Un renderer pequeño; se pausa si la pestaña está oculta.
 * El renderer y el personaje se crean una vez (en la carga) y se reutilizan: clonar el esqueleto, crear un contexto WebGL
 * y compilar los shaders al abrir el inventario congelaba el juego ~0,1-0,2 s.
 */

export interface Worn {
  left: 'none' | 'flashlight' | 'glasses';
  hand: 'none' | 'camera' | 'gun';
  belt: 'none' | 'camera' | 'gun';
}

const _q = new THREE.Quaternion(), _f = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), _v = new THREE.Vector3();

let shared: { r: THREE.WebGLRenderer; canvas: HTMLCanvasElement } | undefined;
export function avatarRenderer() {
  if (shared?.r.getContext().isContextLost()) (shared = undefined), (built = undefined);
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.className = 'iv-avatar';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Your character. Drag to turn.');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    shared = { r, canvas };
  }
  return shared;
}

function build(assets: Assets) {
  const { r } = avatarRenderer();
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(28, 0.6, 0.1, 30);
  cam.position.set(0, 1.0, 4.1);
  cam.lookAt(0, 0.9, 0);
  scene.add(new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 1.6));
  const key = new THREE.DirectionalLight(0xfff0d0, 2.2);
  key.position.set(2, 3, 3);
  scene.add(key);

  const gltf = assets.gltf.hazmat;
  const pivot = new THREE.Group();
  const root = clone(gltf.scene);
  root.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.frustumCulled = false)));
  const cos = new Cosmetics(root);
  pivot.add(root);
  scene.add(cos.root); // los accesorios se colocan en coordenadas de mundo: fuera del pivote (que gira), si no se giran dos veces
  pivot.rotation.y = -0.45;
  scene.add(pivot);

  // lo que se lleva: las mismas piezas y tamaños que ve el resto de jugadores (remote.ts)
  const items = {
    flashlight: fit(assets.gltf.flashlight.scene.clone(true), 0.26, Math.PI),
    camera: fit(assets.gltf.camcorder.scene.clone(true), 0.2, Math.PI / 2),
    gun: fit(assets.gltf.gun.scene.clone(true), 0.72, Math.PI),
  };
  items.flashlight.getObjectByName('Circle_6')?.removeFromParent();
  scene.add(items.flashlight, items.camera, items.gun); // en mundo, como los accesorios
  const bone = (n: string) => root.getObjectByName('mixamorig' + n) as THREE.Bone | undefined;
  const B = { L: bone('LeftHand'), R: bone('RightHand'), H: bone('Hips') };

  const mixer = new THREE.AnimationMixer(root);
  const clip = gltf.animations.find((c) => c.name === 'Neutral Idle') ?? gltf.animations[0];
  if (clip) mixer.clipAction(clip).play();

  // a la pieza se le da la orientación del cuerpo (+z delante) y se la pone en el hueso, algo hacia delante
  const place = (it: THREE.Object3D, b: THREE.Bone | undefined, on: boolean, fwd: number, side = 0, up = 0) => {
    it.visible = on && !!b;
    if (!it.visible) return;
    root.getWorldQuaternion(_q);
    b!.getWorldPosition(it.position);
    it.position.add(_v.set(side, up, fwd).applyQuaternion(_q));
    it.quaternion.copy(_q).multiply(_f);
  };
  const draw = (lk: Look, w: Worn) => {
    cos.set(lk);
    pivot.updateMatrixWorld(true);
    place(items.flashlight, B.L, w.left === 'flashlight', 0.1);
    // la camcorder y el rifle: en la mano si es lo que se lleva, si no a la cadera (lo que cuelga del cinturón)
    if (w.hand === 'camera') place(items.camera, B.R, true, 0.12);
    else place(items.camera, B.H, w.belt === 'camera', 0.05, -0.28, -0.05);
    if (w.hand === 'gun') place(items.gun, B.R, true, 0.25);
    else place(items.gun, B.H, w.belt === 'gun', -0.14, 0.26, 0.0);
    cos.update(0);
    r.render(scene, cam);
  };
  mixer.update(0.01);
  return { cam, pivot, mixer, draw };
}

let built: { assets: Assets; av: ReturnType<typeof build> } | undefined;

/** El personaje listo, con todas las piezas visibles en un primer dibujo para compilar sus shaders, antes de abrir el inventario. */
export function prepAvatar(assets: Assets) {
  avatarRenderer();
  if (built?.assets !== assets) {
    const av = build(assets);
    av.draw(DEFAULT_LOOK, { left: 'flashlight', hand: 'gun', belt: 'camera' });
    built = { assets, av };
  }
  return built.av;
}

export default function InvAvatar({ assets, look, worn, reduced, active }: { assets: Assets; look: Look; worn: Worn; reduced: boolean; active: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const live = useRef({ look, worn });
  live.current = { look, worn };

  useEffect(() => {
    const box = host.current;
    if (!box || !active) return;
    const av = prepAvatar(assets), { cam, pivot, mixer } = av;
    const { r, canvas } = avatarRenderer();
    box.appendChild(canvas);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // arrastrar para girarlo
    let drag: { x: number; a: number } | null = null, touched = false;
    const down = (e: PointerEvent) => ((drag = { x: e.clientX, a: pivot.rotation.y }), (touched = true), canvas.setPointerCapture(e.pointerId));
    const move = (e: PointerEvent) => drag && (pivot.rotation.y = drag.a + (e.clientX - drag.x) * 0.012);
    const up = () => (drag = null);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      mixer.update(dt);
      if (!reduced && !drag && !touched) pivot.rotation.y += dt * 0.5;
      av.draw(live.current.look, live.current.worn);
    };
    loop(last);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.remove(); // (el personaje y el renderer se quedan para la próxima vez)
    };
  }, [assets, reduced, active]);

  return <span ref={host} style={{ display: 'contents' }} />;
}
