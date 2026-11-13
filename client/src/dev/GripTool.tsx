import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { DEFAULT_LOOK } from '@backrooms/shared';
import { Player } from '../game/player';
import { aim } from '../game/rig';
import { loadAnimations } from '../game/anim/animator';
import { grips, DEFAULT_GRIPS, type GripId, type Hand, type V3 } from '../game/grips';
import { Cosmetics, PIECES, DEFAULT_PIECES, BONE, type Piece } from '../game/cosmetics';
import type { Controls } from '../game/input';
import type { World } from '../game/world';
import type { Assets } from '../game/game';

/*
 * Herramienta de desarrollo (solo con `npm run dev`, abrir /?grips): el jugador de verdad con un mundo falso,
 * para colocar a ojo lo que lleva el avatar.
 *  · GRIPS: cada objeto en las manos (muñeca, orientación de la mano, cada dedo, codo, dónde va respecto a la vista).
 *    «FROM OLD» parte de cómo lo agarraba el IK viejo; «MIRROR» copia una mano a la otra.
 *  · ACCESSORIES: sombreros y mochilas sobre el avatar (tamaño, desplazamiento, giro), con un gizmo para arrastrarlos.
 *    Las piezas salen de pieces.json: añadir una entrada ahí la añade aquí.
 * «SAVE» escribe src/game/grips.json y src/game/pieces.json, que es lo que lee el juego. Ctrl+Z / Ctrl+Y deshacen y rehacen.
 */

type Gear = GripId;
const GEARS: Gear[] = ['flashlight', 'camera', 'gun', 'caution', 'radar', 'totem', 'watergun'];
const GADGETS: Gear[] = ['caution', 'radar', 'totem']; // los de la barra rápida: Player.gadget, con la derecha
// cómo apuntaba los dedos el IK viejo (en el espacio de la vista), para «FROM OLD»
const OLD: Partial<Record<Gear, Partial<Record<'left' | 'right', V3>>>> = {
  flashlight: { left: [0.5, -0.15, -0.85] },
  camera: { right: [-0.1, 0, -1], left: [0.85, 0.25, -0.45] },
  gun: { right: [-0.55, -0.45, -0.7], left: [0.7, 0.35, -0.6] },
};
// los campos de una pieza: nombre, etiqueta, rango y paso
const PIECE_FIELDS: [Exclude<keyof Piece, 'slot'>, string, number, number, number][] = [
  ['size', 'size (m)', 0.05, 1.2, 0.005],
  ['scale', 'scale ×', 0.2, 3, 0.01],
  ['up', 'up (m)', -0.5, 0.8, 0.002],
  ['fwd', 'forward (m)', -0.6, 0.6, 0.002],
  ['side', 'side (m)', -0.5, 0.5, 0.002],
  ['rx', 'rot x (deg)', -180, 180, 1],
  ['ry', 'rot y (deg)', -180, 180, 1],
  ['rz', 'rot z (deg)', -180, 180, 1],
];
const D = Math.PI / 180;
const isGear = (id: string): id is Gear => (GEARS as string[]).includes(id);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const label = (id: string) => id.replace(/_/g, ' ');
type View = 'front' | 'side' | 'back' | 'top';
const VIEWS: [View, string][] = [['front', '1 front'], ['side', '2 side'], ['top', '3 top'], ['back', '4 back']];

/** Un deslizador con campo numérico: con el campo enfocado, la rueda y las flechas lo mueven (Shift = fino, Alt = grueso). */
function Num({ label: name, v, min, max, step, on }: { label: string; v: number; min: number; max: number; step: number; on: (n: number) => void }) {
  const box = useRef<HTMLInputElement>(null);
  const cur = useRef({ v, on });
  cur.current = { v, on };
  const nudge = (dir: number, e: { shiftKey: boolean; altKey: boolean }) => cur.current.on(r3(cur.current.v + dir * step * (e.shiftKey ? 0.1 : e.altKey ? 10 : 1)));
  useEffect(() => {
    const el = box.current!;
    const wheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      nudge(e.deltaY < 0 ? 1 : -1, e);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [step]);
  return (
    <label className="gt-row">
      <span>{name}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(+e.target.value)} />
      <input
        ref={box}
        type="number"
        min={min}
        max={max}
        step={step}
        value={r3(v)}
        onChange={(e) => on(+e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey) (e.preventDefault(), nudge(e.key === 'ArrowUp' ? 1 : -1, e));
        }}
      />
    </label>
  );
}

const snap = () => JSON.stringify({ g: grips, p: PIECES });
const eachPiece = (f: (id: string, p: Piece) => void) => Object.entries(PIECES).forEach(([id, p]) => f(id, p));

export default function GripTool() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string>('gun');
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [aimOn, setAimOn] = useState(false);
  const [first, setFirst] = useState(false);
  const [help, setHelp] = useState(false);
  const [keep, setKeep] = useState(true); // al mover el objeto, las manos se quedan donde están
  const [, tick] = useState(0);
  const [msg, setMsg] = useState('');
  const api = useRef({ legacy: () => {}, view: (_v: View) => {}, frame: () => {}, bump: () => {} });
  const live = useRef({ sel, aimOn, first });
  live.current = { sel, aimOn, first };
  const side_ = useRef(side);
  side_.current = side;

  // lo guardado en disco (para saber qué cambió) y el historial de deshacer
  const base = useRef({ g: Object.fromEntries(GEARS.map((g) => [g, JSON.stringify(DEFAULT_GRIPS[g])])) as Record<string, string>, p: Object.fromEntries(Object.entries(DEFAULT_PIECES).map(([k, v]) => [k, JSON.stringify(v)])) });
  const hist = useRef({ stack: [snap()], i: 0, key: '', t: 0 });
  const bump = () => tick((n) => n + 1);
  const dirty = (id: string) => (isGear(id) ? JSON.stringify(grips[id]) !== base.current.g[id] : JSON.stringify(PIECES[id]) !== base.current.p[id]);
  const anyDirty = GEARS.some(dirty) || Object.keys(PIECES).some(dirty);
  /** Guarda el estado en el historial; las ediciones seguidas del mismo control (un deslizador) se funden en una. */
  const commit = (key = '') => {
    const h = hist.current, s = snap(), now = performance.now();
    if (s === h.stack[h.i]) return;
    h.stack.length = h.i + 1;
    if (key && key === h.key && now - h.t < 700 && h.i > 0) h.stack[h.i] = s;
    else (h.stack.push(s), (h.i = h.stack.length - 1));
    if (h.stack.length > 300) (h.stack.shift(), h.i--);
    h.key = key;
    h.t = now;
  };
  const edit = (key: string, f: () => void) => (f(), commit(key), bump());
  const restore = (s: string) => {
    const o = JSON.parse(s) as { g: typeof grips; p: Record<string, Piece> };
    for (const g of GEARS) {
      for (const k of Object.keys(grips[g])) delete (grips[g] as unknown as Record<string, unknown>)[k];
      Object.assign(grips[g], structuredClone(o.g[g]));
    }
    for (const [id, p] of Object.entries(o.p)) Object.assign(PIECES[id] ?? (PIECES[id] = p), p);
    bump();
  };
  const undo = () => {
    const h = hist.current;
    if (h.i > 0) (h.i--, (h.key = ''), restore(h.stack[h.i]), setMsg('undo'));
  };
  const redo = () => {
    const h = hist.current;
    if (h.i < h.stack.length - 1) (h.i++, (h.key = ''), restore(h.stack[h.i]), setMsg('redo'));
  };

  useEffect(() => {
    let alive = true, raf = 0;
    const r = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d1c1a);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.4), sun, new THREE.GridHelper(4, 16, 0x555555, 0x333333));
    const orbit = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    orbit.position.set(1.1, 1.75, 0.8);
    const ctl = new OrbitControls(orbit, r.domElement);
    ctl.target.set(0.05, 1.4, -0.3);
    const eyeCam = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
    scene.add(eyeCam);
    // el gizmo de arrastre de las piezas: un objeto auxiliar en la posición de la pieza; al moverlo se calculan los desplazamientos en el marco del cuerpo
    const proxy = new THREE.Object3D();
    const tc = new TransformControls(orbit, r.domElement);
    tc.setSize(0.8);
    tc.attach(proxy);
    tc.visible = tc.enabled = false;
    let dragging = false;
    tc.addEventListener('dragging-changed', (e) => ((dragging = !!(e as unknown as { value: boolean }).value), (ctl.enabled = !dragging)));
    const axes = new THREE.AxesHelper(0.18); // el marco del cuerpo: +z (azul) es hacia donde mira
    (axes.material as THREE.Material).depthTest = false;
    axes.renderOrder = 10;
    axes.visible = false;
    scene.add(proxy, tc, axes);
    const resize = () => {
      const w = box.current!.clientWidth, h = box.current!.clientHeight;
      r.setSize(w, h, false);
      orbit.aspect = eyeCam.aspect = w / h;
      orbit.updateProjectionMatrix();
      eyeCam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box.current!);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const names = ['hazmat', 'flashlight', 'camcorder', 'gun', 'duct', 'radar', 'totem'] as const;
    let player: Player | undefined, cos: Cosmetics | undefined, last = performance.now();
    const bodyQ = new THREE.Quaternion(), bone = new THREE.Vector3(), off = new THREE.Vector3(), delta = new THREE.Vector3();
    /** Dónde está ahora la pieza: el hueso más su desplazamiento en el marco del cuerpo (lo mismo que hace Cosmetics.update). */
    const anchor = (id: string, out: THREE.Vector3) => {
      const p = PIECES[id], body = player!.rig.root;
      body.updateWorldMatrix(true, false);
      body.getWorldQuaternion(bodyQ);
      body.getObjectByName(BONE[p.slot])?.getWorldPosition(bone);
      return out.copy(bone).add(delta.set(p.side, p.up, p.fwd).applyQuaternion(bodyQ));
    };
    tc.addEventListener('objectChange', () => {
      const id = live.current.sel;
      if (!dragging || isGear(id) || !PIECES[id]) return;
      const p = PIECES[id];
      anchor(id, off); // actualiza `bone` y `bodyQ`
      const d = proxy.position.clone().sub(bone).applyQuaternion(bodyQ.clone().invert());
      p.side = r3(d.x);
      p.up = r3(d.y);
      p.fwd = r3(d.z);
      api.current.bump();
    });
    api.current.view = (name) => {
      if (!player) return;
      const t = ctl.target, dist = Math.max(0.5, orbit.position.distanceTo(t));
      player.rig.root.getWorldQuaternion(bodyQ);
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQ).setY(0).normalize();
      const dir = name === 'front' ? f : name === 'back' ? f.clone().negate() : name === 'side' ? new THREE.Vector3(f.z, 0, -f.x) : new THREE.Vector3(0.001, 1, 0.001);
      orbit.position.copy(t).addScaledVector(dir.normalize(), dist);
      if (name !== 'top') orbit.position.y += dist * 0.12;
      ctl.update();
    };
    api.current.frame = () => {
      const id = live.current.sel;
      if (!player) return;
      if (isGear(id)) {
        ctl.target.set(0.05, 1.4, -0.3);
        orbit.position.set(1.1, 1.75, 0.8);
      } else if (PIECES[id]) {
        ctl.target.copy(anchor(id, off));
        orbit.position.copy(ctl.target).add(new THREE.Vector3(0, 0.1, 0).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQ).setY(0).normalize(), 1.1));
      }
      ctl.update();
    };
    api.current.bump = () => (commit('drag'), tick((n) => n + 1));

    Promise.all([...names.map((n) => loader.loadAsync(`/models/backrooms/${n}.glb`)), loadAnimations().catch(() => undefined)]).then((gl) => {
      if (!alive) return;
      const gltf = Object.fromEntries(names.map((n, i) => [n, gl[i]])); // (el último de gl es el paquete de animaciones: hace falta antes de crear el Player)
      const world = { root: new THREE.Group(), solid: () => false, furniture: () => false, voidAt: () => false } as unknown as World;
      scene.add(world.root);
      player = new Player(world, { gltf } as unknown as Assets, eyeCam, new THREE.SpotLight(), true);
      player.spawn(new THREE.Vector3(), 0);
      cos = new Cosmetics(player.rig.root);
      scene.add(cos.root);
      api.current.legacy = () => {
        const p = player!, { sel: g } = live.current;
        if (!isGear(g)) return;
        const h = grips[g][side_.current];
        if (!h) return;
        const item = p.items[g], hand = p.rig.bone(side_.current === 'left' ? 'LeftHand' : 'RightHand');
        if (!hand) return;
        h.rot = [0, 0, 0];
        const qi = item.getWorldQuaternion(new THREE.Quaternion());
        let want: THREE.Quaternion;
        if (g === 'flashlight') {
          // la linterna se cogía en puño: la mano con los dedos hacia delante y la palma hacia dentro, respecto al objeto
          const y = new THREE.Vector3(0.2, 0, -1).normalize(), z = new THREE.Vector3(1, 0, 0), x = y.clone().cross(z).normalize(), zz = x.clone().cross(y);
          want = qi.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, zz)));
        } else {
          p.update(0, ctrl(live.current.aimOn));
          const mid = p.rig.bone(side_.current === 'left' ? 'LeftHandMiddle1' : 'RightHandMiddle1');
          aim(hand, mid!, new THREE.Vector3(...OLD[g]![side_.current]!).applyQuaternion(eyeCam.quaternion).normalize());
          want = hand.getWorldQuaternion(new THREE.Quaternion());
        }
        const rel = qi.invert().multiply(want), e = new THREE.Euler().setFromQuaternion(rel, 'XYZ');
        h.rot = [Math.round(e.x / D), Math.round(e.y / D), Math.round(e.z / D)];
        commit();
        tick((n) => n + 1);
      };
      api.current.frame();
    });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { sel: s, aimOn: a, first: f } = live.current;
      if (player && cos) {
        const gear = isGear(s);
        player.left = gear ? 'flashlight' : 'none';
        player.hold(s === 'camera' || s === 'gun' || s === 'watergun' ? s : 'none');
        player.gadget = GADGETS.includes(s as Gear) ? (s as 'caution') : 'none';
        player.update(dt, ctrl(a && (s === 'camera' || s === 'gun' || s === 'watergun')));
        // en primera persona el jugador encoge su cabeza; para colocar un sombrero hay que verla
        if (!gear) for (const n of ['Head', 'Neck']) player.rig.bone(n)?.scale.setScalar(1);
        const piece = gear ? undefined : PIECES[s];
        cos.set({ ...DEFAULT_LOOK, head: piece?.slot === 'head' ? s : '', back: piece?.slot === 'back' ? s : '' });
        cos.update(0, true);
        tc.visible = tc.enabled = axes.visible = !!piece && !f;
        if (piece) {
          if (!dragging) anchor(s, proxy.position);
          axes.position.copy(proxy.position);
          axes.quaternion.copy(bodyQ);
        }
      }
      ctl.update();
      r.render(scene, f ? eyeCam : orbit);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      tc.dispose();
      ctl.dispose();
      cos?.dispose();
      r.dispose();
    };
  }, []);

  const hasHand = (g: Gear, s: 'left' | 'right') => !!grips[g][s];
  const gear: Gear = isGear(sel) ? sel : 'gun';
  const piece: Piece | undefined = isGear(sel) ? undefined : PIECES[sel];
  const h = grips[gear][side] ?? grips[gear][side === 'left' ? 'right' : 'left'];
  const hand = grips[gear][side] ? side : side === 'left' ? 'right' : 'left';
  const setV3 = (key: string, a: V3, i: number, n: number) => edit(key, () => (a[i] = n));
  const view = grips[gear].view;
  // mueve el objeto (su pos/rot en la vista); con `keep` las manos no se mueven: su agarre, que va en el espacio del objeto, se reexpresa en el nuevo
  const setView = (key: string, a: V3, i: number, n: number, moves = true) =>
    edit(key, () => {
      const mat = () => new THREE.Matrix4().compose(new THREE.Vector3(...view.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(view.rot[0] * D, view.rot[1] * D, view.rot[2] * D)), new THREE.Vector3(1, 1, 1));
      const m0 = mat();
      a[i] = n;
      if (!keep || !moves) return;
      const to = mat().invert().multiply(m0), qt = new THREE.Quaternion().setFromRotationMatrix(to);
      for (const hd of [grips[gear].left, grips[gear].right]) {
        if (!hd) continue;
        const p = new THREE.Vector3(...hd.pos).applyMatrix4(to);
        hd.pos = [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
        const e = new THREE.Euler().setFromQuaternion(qt.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(hd.rot[0] * D, hd.rot[1] * D, hd.rot[2] * D))), 'XYZ');
        hd.rot = [+(e.x / D).toFixed(1), +(e.y / D).toFixed(1), +(e.z / D).toFixed(1)];
      }
    });

  const select = (id: string) => {
    setSel(id);
    setAimOn(false);
    if (isGear(id)) setSide(hasHand(id, side) ? side : side === 'left' ? 'right' : 'left');
    else setFirst(false);
    live.current.sel = id;
    api.current.frame();
  };
  const ids = [...GEARS, ...Object.keys(PIECES)];
  const step = (d: number) => select(ids[(ids.indexOf(sel) + d + ids.length) % ids.length]);

  const save = async () => {
    const out: string[] = [];
    const post = async (file: 'grips' | 'pieces', data: unknown) => (await fetch('/__grips?file=' + file, { method: 'POST', body: JSON.stringify(data, null, 2) + '\n' })).ok;
    try {
      if (GEARS.some(dirty)) {
        if (!(await post('grips', grips))) throw new Error('grips');
        GEARS.forEach((g) => (base.current.g[g] = JSON.stringify(grips[g])));
        out.push('grips.json');
      }
      if (Object.keys(PIECES).some(dirty)) {
        if (!(await post('pieces', PIECES))) throw new Error('pieces');
        eachPiece((id, p) => (base.current.p[id] = JSON.stringify(p)));
        out.push('pieces.json');
      }
      setMsg(out.length ? 'saved ' + out.join(' + ') : 'nothing to save');
    } catch (e) {
      setMsg('save failed: ' + (e as Error).message + ' (restart the dev server?)');
    }
    bump();
  };
  const revert = () =>
    edit('', () => {
      if (isGear(sel)) {
        const d = structuredClone(DEFAULT_GRIPS[sel]);
        for (const k of Object.keys(grips[sel])) delete (grips[sel] as unknown as Record<string, unknown>)[k];
        Object.assign(grips[sel], d);
      } else if (PIECES[sel]) Object.assign(PIECES[sel], DEFAULT_PIECES[sel]);
      setMsg('reverted ' + label(sel) + ' to the saved file');
    });
  const mirror = () => {
    const g = grips[gear], from = g[side], to = side === 'left' ? 'right' : 'left';
    if (!from || !g[to]) return;
    edit('', () => {
      g[to] = { pos: [-from.pos[0], from.pos[1], from.pos[2]], rot: [from.rot[0], -from.rot[1], -from.rot[2]], curl: [...from.curl], spread: from.spread, pole: [-from.pole[0], from.pole[1], from.pole[2]] };
      setMsg(`${side} hand mirrored onto the ${to} hand`);
    });
  };
  const copy = (all: boolean) => {
    const data = all ? { grips, pieces: PIECES } : isGear(sel) ? { [sel]: grips[sel] } : { [sel]: PIECES[sel] };
    navigator.clipboard?.writeText(JSON.stringify(data, null, 2)).then(() => setMsg(all ? 'copied everything' : 'copied ' + label(sel)));
  };

  // atajos: se leen siempre las funciones de la última pasada
  const fns = useRef({ undo, redo, save, step, view: (_v: View) => {}, orbitToggle: () => {} });
  fns.current = { undo, redo, save, step, view: (v) => api.current.view(v), orbitToggle: () => setFirst(!first) };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'number';
      const f = fns.current, k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') (e.preventDefault(), e.shiftKey ? f.redo() : f.undo());
        else if (k === 'y') (e.preventDefault(), f.redo());
        else if (k === 's') (e.preventDefault(), void f.save());
        return;
      }
      if (typing || e.altKey) return;
      if (k === '[') f.step(-1);
      else if (k === ']') f.step(1);
      else if (k === 'o') f.orbitToggle();
      else if (k === 'h') setHelp((x) => !x);
      else if ('1234'.includes(k) && k) f.view(VIEWS[+k - 1][0]);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  // avisar si se cierra la pestaña con cambios sin guardar
  useEffect(() => {
    const bye = (e: BeforeUnloadEvent) => anyDirty && e.preventDefault();
    addEventListener('beforeunload', bye);
    return () => removeEventListener('beforeunload', bye);
  });

  const objBtn = (id: string, text: string, tag?: string) => (
    <button key={id} type="button" data-on={sel === id || undefined} onClick={() => select(id)} title={id}>
      {text}
      {tag && <small>{tag}</small>}
      {dirty(id) && <i className="gt-dot" title="unsaved" />}
    </button>
  );

  return (
    <div className="gt">
      <div ref={box} className="gt-view">
        <canvas ref={canvas} />
        <div className="gt-hint">drag to orbit · wheel to zoom · {piece ? 'drag the gizmo to move the piece' : 'sliders on the right'}</div>
      </div>
      <aside className="gt-panel">
        <div className="gt-top">
          <b>{anyDirty ? '● UNSAVED CHANGES' : 'ALL SAVED'}</b>
          <span>
            <button type="button" disabled={hist.current.i === 0} onClick={undo} title="Ctrl+Z">
              UNDO
            </button>
            <button type="button" disabled={hist.current.i >= hist.current.stack.length - 1} onClick={redo} title="Ctrl+Y">
              REDO
            </button>
            <button type="button" data-on={help || undefined} onClick={() => setHelp(!help)} title="H">
              ?
            </button>
          </span>
        </div>
        {help && (
          <div className="gt-help">
            <p>
              <b>Ctrl+Z / Ctrl+Y</b> undo / redo · <b>Ctrl+S</b> save · <b>[ ]</b> previous / next object · <b>1–4</b> front, side, top, back · <b>O</b> orbit / first person · <b>H</b> this help
            </p>
            <p>Click a number field, then use the wheel or ↑/↓: <b>Shift</b> = fine, <b>Alt</b> = coarse (×10). Pieces: drag the arrows in the view to move them (the gizmo works in world axes, the numbers are in the body's frame: +z blue is forward).</p>
            <p>Saving writes src/game/grips.json and src/game/pieces.json; the game picks them up on the next load. A new accessory only needs an entry in pieces.json (plus its cosmetic in shared/src/progress.ts and its .glb in public/models/cosmetics).</p>
          </div>
        )}
        <h3>grips</h3>
        <div className="gt-objs">{GEARS.map((g) => objBtn(g, g))}</div>
        <h3>accessories</h3>
        <div className="gt-objs">{Object.entries(PIECES).map(([id, p]) => objBtn(id, label(id), p.slot))}</div>

        <h3>camera</h3>
        <div className="gt-tabs">
          {VIEWS.map(([v, t]) => (
            <button key={v} type="button" onClick={() => api.current.view(v)}>
              {t}
            </button>
          ))}
          <button type="button" data-on={first || undefined} onClick={() => setFirst(!first)}>
            {first ? 'first person' : 'orbit'}
          </button>
        </div>

        {piece ? (
          <>
            <h3>{label(sel)} · {piece.slot === 'head' ? 'hat' : 'backpack'}</h3>
            <div className="gt-tabs">
              {([['head', 'hat (head)'], ['back', 'backpack (back)']] as const).map(([s, t]) => (
                <button key={s} type="button" data-on={piece.slot === s || undefined} onClick={() => edit(sel + 'slot', () => (piece.slot = s))}>
                  {t}
                </button>
              ))}
            </div>
            {PIECE_FIELDS.map(([k, name, min, max, st]) => (
              <Num key={k} label={name} v={piece[k]} min={min} max={max} step={st} on={(n) => edit(sel + k, () => (piece[k] = n))} />
            ))}
          </>
        ) : (
          <>
            <div className="gt-tabs">
              {(['left', 'right'] as const).map((s) => (
                <button key={s} type="button" disabled={!hasHand(gear, s)} data-on={hand === s || undefined} onClick={() => setSide(s)}>
                  {s} hand
                </button>
              ))}
              {hasHand(gear, 'left') && hasHand(gear, 'right') && (
                <button type="button" onClick={mirror} title={`copy the ${hand} hand onto the other, mirrored`}>
                  mirror → {hand === 'left' ? 'right' : 'left'}
                </button>
              )}
              {(gear === 'camera' || gear === 'gun' || gear === 'watergun') && (
                <button type="button" data-on={aimOn || undefined} onClick={() => (setAimOn(!aimOn), setFirst(true))}>
                  aiming (right click)
                </button>
              )}
            </div>
            {h && !aimOn && (
              <>
                <h3>wrist (item space, m)</h3>
                {(['x', 'y', 'z'] as const).map((k, i) => (
                  <Num key={k} label={k} v={(h as Hand).pos[i]} min={-0.4} max={0.4} step={0.001} on={(n) => setV3(`${gear}${hand}pos${i}`, (h as Hand).pos, i, n)} />
                ))}
                <h3>hand orientation (deg)</h3>
                {(['x', 'y', 'z'] as const).map((k, i) => (
                  <Num key={k} label={k} v={(h as Hand).rot[i]} min={-180} max={180} step={1} on={(n) => setV3(`${gear}${hand}rot${i}`, (h as Hand).rot, i, n)} />
                ))}
                <h3>fingers (rad)</h3>
                {['thumb', 'index', 'middle', 'ring', 'pinky'].map((k, i) => (
                  <Num key={k} label={k} v={(h as Hand).curl[i]} min={-0.6} max={1.8} step={0.01} on={(n) => edit(`${gear}${hand}curl${i}`, () => ((h as Hand).curl[i] = n))} />
                ))}
                <Num label="thumb out" v={(h as Hand).spread} min={-1} max={1} step={0.01} on={(n) => edit(`${gear}${hand}spread`, () => ((h as Hand).spread = n))} />
                <h3>elbow (view space, m)</h3>
                {(['x', 'y', 'z'] as const).map((k, i) => (
                  <Num key={k} label={k} v={(h as Hand).pole[i]} min={-1.2} max={1.2} step={0.01} on={(n) => setV3(`${gear}${hand}pole${i}`, (h as Hand).pole, i, n)} />
                ))}
              </>
            )}
            <h3>{aimOn ? 'at the eye (view space, m)' : 'item in view (view space, m)'}</h3>
            {(['x', 'y', 'z'] as const).map((k, i) => {
              const a = aimOn && view.aim ? view.aim : view.pos;
              return <Num key={k} label={k} v={a[i]} min={-0.6} max={0.3} step={0.001} on={(n) => setView(`${gear}view${aimOn}${i}`, a, i, n, !aimOn)} />;
            })}
            <label style={{ display: 'block', margin: '4px 0' }}>
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> hands stay put when moving the item
            </label>
            {!aimOn && (
              <>
                <h3>item rotation (deg)</h3>
                {(['x', 'y', 'z'] as const).map((k, i) => (
                  <Num key={k} label={k} v={view.rot[i]} min={-180} max={180} step={1} on={(n) => setView(`${gear}viewrot${i}`, view.rot, i, n)} />
                ))}
              </>
            )}
          </>
        )}

        <div className="gt-tabs gt-actions">
          <button type="button" data-hot={anyDirty || undefined} onClick={() => void save()} title="Ctrl+S">
            SAVE
          </button>
          {(sel === 'camera' || sel === 'gun') && (
            <button type="button" onClick={() => (api.current.legacy(), bump(), setMsg('hand orientation taken from the old IK'))}>
              FROM OLD
            </button>
          )}
          <button type="button" disabled={!dirty(sel)} onClick={revert}>
            REVERT {label(sel)}
          </button>
          <button type="button" onClick={() => copy(false)}>
            COPY JSON
          </button>
          <button type="button" onClick={() => copy(true)}>
            COPY ALL
          </button>
        </div>
        <p className="gt-msg">{msg}</p>
      </aside>
      <style>{CSS}</style>
    </div>
  );
}

function ctrl(aim: boolean): Controls {
  return { move: new THREE.Vector2(), look: new THREE.Vector2(), run: false, jump: false, flash: false, grab: false, bag: false, aim, zoom: 0, fire: false, reload: false, swap: false, slot: -1, wheel: 0, use: false, pause: false };
}

const CSS = `
.gt { position: fixed; inset: 0; display: flex; background: #1d1c1a; color: #d8d4c8; font: 12px/1.4 ui-monospace, Consolas, monospace; }
.gt-view { flex: 1; min-width: 0; position: relative; }
.gt-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gt-hint { position: absolute; left: 10px; bottom: 8px; color: #8f8a7c; pointer-events: none; }
.gt-panel { width: 360px; overflow-y: auto; padding: 12px 14px 24px; background: #252320; border-left: 1px solid #3a3733; }
.gt-panel h3 { margin: 14px 0 4px; font-size: 11px; font-weight: 600; color: #8f8a7c; text-transform: uppercase; letter-spacing: 0.06em; }
.gt-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.gt-top b { font-size: 11px; letter-spacing: 0.06em; color: #8f8a7c; }
.gt-top b:first-child { color: inherit; }
.gt-top span { display: flex; gap: 4px; }
.gt-row { display: grid; grid-template-columns: 78px 1fr 64px; gap: 8px; align-items: center; margin: 2px 0; }
.gt-row input[type="number"] { width: 100%; background: #1d1c1a; color: inherit; border: 1px solid #3a3733; padding: 2px 4px; font: inherit; }
.gt-row input[type="number"]:focus { outline: 1px solid #d8d4c8; }
.gt-tabs, .gt-objs, .gt-top span { }
.gt-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.gt-objs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.gt-panel button { background: #1d1c1a; color: inherit; border: 1px solid #3a3733; padding: 4px 8px; font: inherit; cursor: pointer; text-align: left; position: relative; }
.gt-panel button:hover:not(:disabled) { border-color: #8f8a7c; }
.gt-panel button[data-on] { background: #d8d4c8; color: #1d1c1a; }
.gt-panel button[data-hot] { border-color: #d8d4c8; }
.gt-panel button:disabled { opacity: 0.35; cursor: default; }
.gt-panel button small { margin-left: 6px; opacity: 0.55; font-size: 10px; text-transform: uppercase; }
.gt-dot { position: absolute; right: 5px; top: 5px; width: 6px; height: 6px; background: #e8a33d; border-radius: 50%; }
.gt-help { background: #1d1c1a; border: 1px solid #3a3733; padding: 4px 10px; margin-bottom: 6px; color: #b5b0a2; }
.gt-help p { margin: 6px 0; }
.gt-actions { margin-top: 16px; }
.gt-msg { margin: 8px 0 0; color: #8f8a7c; min-height: 1.4em; }
`;
