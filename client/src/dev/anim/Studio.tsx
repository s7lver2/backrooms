import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Animator, TREE, VARIANTS, MANIFEST, guessCat, loadAnimations, type Cat } from '../../game/anim/animator';
import { DANCES } from '../../game/anim/dance';
import { grips } from '../../game/grips';
import { worn, wornModel, placeWorn } from '../../game/worn';
import { Cosmetics, PIECES } from '../../game/cosmetics';
import { DEFAULT_LOOK } from '@backrooms/shared';
import { loadPoolKit, poolPart } from '../../game/poolmap';
import { loadItemModels } from '../../game/itemModels';
import { build, reloadPack, type Pack } from '../../game/anim/core';
import { Player } from '../../game/player';
import type { Controls } from '../../game/input';
import type { World } from '../../game/world';
import type { Assets } from '../../game/game';
import { StudioCtx, useStudio, snapshot, restore, applyCarry, CAMS, CAT_COLOR, CAT_LABEL, type Api, type Live, type Mode } from './store';
import { Locomotion, Timeline } from './Dock';
import { CamBar, Mando, Help } from './Viewport';
import { VariantsPanel, IkPanel } from './Panels';
import { IkPicker } from './Grips';
import { CSS } from './css';

/*
 * Estudio de animación (solo con `npm run dev`, abrir /?anim). Una pantalla:
 *  · izquierda: biblioteca de clips con una miniatura de cada uno (pasa el ratón para verlo moverse; arrástralos a donde los quieras usar);
 *  · centro: el jugador de verdad (con sus manos, linterna y rifle) en tercera persona: W/S andar, A/D girar, Shift correr, C agacharse, Espacio saltar;
 *  · abajo: según el modo, la línea de tiempo de los bailes (arrastrar clips, recortar, solapar) o el mapa de estados del movimiento;
 *  · derecha: los ajustes de lo que hay seleccionado.
 * Ctrl+Z / Ctrl+Y deshacen y rehacen; Ctrl+S guarda todo en src/game/anim/*.json.
 */

const post = async (file: string, data: unknown) => (await fetch('/__grips?file=' + file, { method: 'POST', body: JSON.stringify(data, null, 2) + '\n' })).ok;
const MODES: [Mode, string, string][] = [
  ['library', 'CLIPS', 'browse and tag every clip'],
  ['locomotion', 'MOVEMENT', 'how the character walks, runs, crouches, jumps'],
  ['dances', 'DANCES', 'build victory dances from clips'],
  ['variants', 'VARIANTS', 'cosmetic versions of movement clips'],
  ['ik', 'IK', 'test hands, feet and torso aiming'],
];

export default function Studio() {
  const box = useRef<HTMLDivElement>(null);
  const [S, setS] = useState<Live>();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>('library');
  const [sel, setSel] = useState('');
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  const [packVer, setPackVer] = useState(0);
  const hist = useRef<{ stack: string[]; at: number; saved: string }>({ stack: [], at: -1, saved: '' });
  const sRef = useRef<Live>();
  const keys = useRef(new Set<string>());
  // el reparto de las zonas (se recuerda entre sesiones)
  const [lay, setLay] = useState<{ lib: number; side: number; dock: number }>(() => {
    try {
      return { lib: 230, side: 320, dock: 300, ...JSON.parse(localStorage.getItem('anim-studio-layout') ?? '{}') };
    } catch {
      return { lib: 230, side: 320, dock: 300 };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('anim-studio-layout', JSON.stringify(lay));
    } catch {
      /* sin almacenamiento */
    }
  }, [lay]);
  /** Arrastrar una barra para cambiar el tamaño de una zona. */
  const split = (key: 'lib' | 'side' | 'dock', sign: 1 | -1, axis: 'x' | 'y', min: number, max: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const p0 = axis === 'x' ? e.clientX : e.clientY, v0 = lay[key];
    const mv = (ev: PointerEvent) => setLay((l) => ({ ...l, [key]: Math.max(min, Math.min(max, v0 + sign * ((axis === 'x' ? ev.clientX : ev.clientY) - p0))) }));
    const up = () => (removeEventListener('pointermove', mv), removeEventListener('pointerup', up));
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };
  const apiRef = useRef<Api & { undo: () => void; redo: () => void; save: () => void }>();

  // ── el visor: el Player de verdad con un mundo falso ──
  useEffect(() => {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    box.current!.append(r.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15181b);
    const gridH = new THREE.GridHelper(8, 16, 0x555a60, 0x2a2e33);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.7), gridH);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 60), eye = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
    cam.position.set(2.2, 1.6, 3.4);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.target.set(0, 1, 0);
    const resize = () => {
      const w = box.current!.clientWidth, h = box.current!.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box.current!);

    const ik = { foot: false, bump: 0.15, aim: false, yaw: 0, pitch: 0, handL: false, handR: false, tx: 0.3, ty: 1.3, tz: 0.5 };
    const terrain = (x: number, z: number) => (ik.foot ? Math.max(0, Math.sin(x * 5) * 0.5 + 0.2) * ik.bump * Math.max(0, Math.sin(z * 4 + 1)) : 0);
    const bumps = new THREE.Mesh(new THREE.PlaneGeometry(6, 6, 90, 90).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a4a44, wireframe: true }));
    bumps.visible = false;
    scene.add(bumps);
    const setTerrain = () => {
      bumps.visible = ik.foot;
      const a = bumps.geometry.getAttribute('position');
      for (let i = 0; i < a.count; i++) a.setY(i, terrain(a.getX(i), a.getZ(i)));
      a.needsUpdate = true;
    };
    const marks = [0xff6644, 0x44aaff].map((c) => new THREE.Mesh(new THREE.SphereGeometry(0.035), new THREE.MeshBasicMaterial({ color: c, depthTest: false })));
    marks.forEach((m) => (m.renderOrder = 9));
    scene.add(...marks);
    scene.add(eye); // (los objetos de la mano cuelgan de esta cámara: sin esto no se ven desde fuera)

    let alive = true, raf = 0, last = performance.now();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const names = ['hazmat', 'flashlight', 'camcorder', 'gun', 'duct', 'radar', 'totem', 'water', 'vhs'] as const;
    Promise.all([...names.map((n) => loader.loadAsync(`/models/backrooms/${n}.glb`)), loadAnimations(), loadPoolKit(), loadItemModels()]).then(async (all) => {
      if (!alive) return;
      const gl = all.slice(0, names.length) as Awaited<ReturnType<typeof loader.loadAsync>>[], pack = all[names.length] as Pack;
      const gltf = Object.fromEntries(names.map((n, i) => [n, gl[i]]));
      // (el kit de las Poolrooms trae el jabón y la bombona)
      const world = { root: new THREE.Group(), solid: () => false, furniture: () => false, voidAt: () => false } as unknown as World;
      scene.add(world.root);
      const player = new Player(world, { gltf } as unknown as Assets, eye, new THREE.SpotLight(), true);
      player.spawn(new THREE.Vector3(), 0);
      const A = player.rig.animator!;
      const live: Live = { A, player, pack, manual: false, hold: 'flashlight', gear: '', first: false, gripAim: false, tank: false, piece: '', ik, danceOn: false, setTerrain, cam, ctl: { speed: 1.6, auto: 'off', turn: 0.8, treadmill: false, timeScale: 1, paused: false, step: false, joy: { x: 0, y: 0 }, crouch: false, jump: false, skeleton: false, grid: true }, setCam: () => {}, reset: () => {} };
      A.ik.ground = (x, z) => (ik.foot ? terrain(x, z) : null);
      const fwd = new THREE.Vector3();
      A.ik.aim = { weight: 1, dir: () => (ik.aim ? fwd.set(Math.sin(ik.yaw), Math.sin(ik.pitch), Math.cos(ik.yaw)).normalize() : null) };
      const reach = (side: 'Left' | 'Right', k: 'handL' | 'handR') => ({ chain: `${side}Arm` as const, weight: 1, target: () => (ik[k] ? { pos: new THREE.Vector3((side === 'Left' ? 1 : -1) * ik.tx, ik.ty, ik.tz) } : null) });
      A.ik.goals.push(reach('Left', 'handL'), reach('Right', 'handR'));
      for (const n of pack.clips.keys()) MANIFEST[n] ??= guessCat(n); // (clips que llegaron con el servidor parado: se etiquetan a ojo)
      sRef.current = live;
      (window as unknown as { __studio: Live }).__studio = live;
      setS(live);
      hist.current = { stack: [snapshot()], at: 0, saved: snapshot() };

      const WALK = 1.6, RUN = 3.6; // (los del Player)
      const pm = live.ctl, tw = { t: 1, fp: new THREE.Vector3(), ft: new THREE.Vector3(), tp: new THREE.Vector3(), tt: new THREE.Vector3() };
      const scroll = new THREE.Vector2();
      let lastPos = player.pos.clone();
      /** Los ángulos predefinidos, relativos a hacia dónde mira el personaje. */
      live.setCam = (name) => {
        live.first = name === 'first';
        if (live.first) return setTick((n) => n + 1);
        const y = player.yaw, f = new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y)), rt = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y)), P = pm.treadmill ? new THREE.Vector3() : player.pos.clone();
        const T = P.clone().add(new THREE.Vector3(0, 1, 0)), at = (v: THREE.Vector3, o: THREE.Vector3) => T.clone().add(v).add(o);
        let tt = T, pp = at(f.clone().multiplyScalar(3.2), new THREE.Vector3(0, 0.4, 0));
        if (name === 'back') pp = at(f.clone().multiplyScalar(-3.2), new THREE.Vector3(0, 0.4, 0));
        else if (name === 'side') pp = at(rt.clone().multiplyScalar(3.2), new THREE.Vector3(0, 0.3, 0));
        else if (name === 'three') pp = at(f.clone().multiplyScalar(2.4).add(rt.clone().multiplyScalar(2.4)), new THREE.Vector3(0, 0.6, 0));
        else if (name === 'top') (tt = P.clone().add(new THREE.Vector3(0, 0.8, 0))), (pp = tt.clone().add(new THREE.Vector3(0, 4.2, 0)).addScaledVector(f, -0.01));
        else if (name === 'hands') (tt = P.clone().add(new THREE.Vector3(0, 1.15, 0)).addScaledVector(f, 0.4)), (pp = tt.clone().addScaledVector(f, 1.1).addScaledVector(rt, 0.7).add(new THREE.Vector3(0, 0.25, 0)));
        else if (name === 'item') {
          const it = player.items[(live.gear && live.gear in player.items ? live.gear : player.hand !== 'none' ? player.hand : 'flashlight') as 'gun'], at0 = it.getWorldPosition(new THREE.Vector3());
          (tt = at0), (pp = at0.clone().addScaledVector(f, 0.55).addScaledVector(rt, 0.35).add(new THREE.Vector3(0, 0.15, 0)));
        } else if (name === 'feet') (tt = P.clone().add(new THREE.Vector3(0, 0.2, 0))), (pp = tt.clone().addScaledVector(f, 1.6).addScaledVector(rt, 0.9).add(new THREE.Vector3(0, 0.5, 0)));
        tw.fp.copy(cam.position), tw.ft.copy(ctl.target), tw.tp.copy(pp), tw.tt.copy(tt), (tw.t = 0);
      };
      live.reset = () => {
        player.spawn(new THREE.Vector3(), 0);
        pm.joy.x = pm.joy.y = 0;
        lastPos = player.pos.clone();
        scroll.set(0, 0);
        live.setCam('three');
      };
      live.setCam('three');
      // la bombona a la espalda (su sitio: worn.json)
      const tankSrc = poolPart('tank'), tankObj = tankSrc ? wornModel(tankSrc) : undefined;
      if (tankObj) scene.add(tankObj);
      // accesorios nuevos: cada .glb de public/models/cosmetics sin entrada en pieces.json aparece solo (con medidas por defecto; se guarda con Ctrl+S)
      fetch('/__grips').then((r) => r.json()).then((ids: string[]) => {
        for (const id of ids) PIECES[id] ??= { slot: 'head', size: 0.3, scale: 1, up: 0.1, fwd: 0, side: 0, rx: 0, ry: 0, rz: 0 };
        setPackVer((n) => n + 1);
      }).catch(() => {});
      const spine = player.rig.bone('Spine2');
      const cos = new Cosmetics(player.rig.root); // sombreros y mochilas (pieces.json)
      scene.add(cos.root);
      const skel = new THREE.SkeletonHelper(player.rig.root);
      (skel.material as THREE.LineBasicMaterial).depthTest = false;
      skel.renderOrder = 8;
      skel.visible = false;
      scene.add(skel);

      const frame = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        let dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const real = dt;
        gridH.visible = pm.grid;
        if (tankObj) tankObj.visible = live.tank && !!spine;
        skel.visible = pm.skeleton;
        if (!pm.paused || pm.step) {
          if (pm.step) (dt = 1 / 30), (pm.step = false);
          else dt *= pm.timeScale;
          const k = keys.current, c = ctrl();
          // lo que se pide: teclado, palanca virtual o caminar solo (a la velocidad del control)
          let fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0), turn = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0), v = k.has('shift') ? RUN : WALK;
          if (pm.auto !== 'off') (fwd = 1), (v = pm.speed), (turn = 0);
          else if (Math.abs(pm.joy.y) > 0.05) (fwd = Math.sign(pm.joy.y)), (v = Math.abs(pm.joy.y) * RUN);
          turn += pm.joy.x;
          c.move.set(0, v > 0.01 ? fwd * Math.min(1, v / (v > WALK * 1.02 ? RUN : WALK)) : 0);
          c.run = v > WALK * 1.02 && fwd !== 0;
          c.look.x = turn * dt * 2.2 + (pm.auto === 'circle' ? pm.turn * dt : 0);
          c.crouch = pm.crouch || k.has('c');
          c.aim = live.gripAim;
          c.jump = pm.jump || k.has(' ');
          pm.jump = false;
          k.delete(' '); // (un salto por pulsación)
          if (live.manual) player.rig.update(dt);
          else player.update(dt, c);
        }
        if (!live.first || live.piece) for (const n of ['Head', 'Neck']) player.rig.bone(n)?.scale.setScalar(1); // (en primera persona encoge su cabeza; en tercera se ve entera)
        const pc = PIECES[live.piece];
        cos.set({ ...DEFAULT_LOOK, head: pc?.slot === 'head' ? live.piece : '', back: pc?.slot === 'back' ? live.piece : '' });
        cos.update(0, true);
        marks.forEach((m, i) => ((m.visible = ik[i ? 'handR' : 'handL']), m.position.set((i ? -1 : 1) * ik.tx, ik.ty, ik.tz)));
        // cinta andadora: el personaje se queda en el centro y el suelo se desliza; si no, la cámara lo sigue
        const d = player.pos.clone().sub(lastPos);
        if (pm.treadmill && !ik.foot) {
          scroll.x -= d.x, scroll.y -= d.z;
          gridH.position.set(scroll.x % 0.5, 0, scroll.y % 0.5);
          player.pos.x = player.pos.z = 0;
        } else (cam.position.add(d), ctl.target.add(d), gridH.position.set(0, 0, 0));
        lastPos = player.pos.clone();
        if (tw.t < 1) {
          tw.t = Math.min(1, tw.t + real / 0.4);
          const e = tw.t * tw.t * (3 - 2 * tw.t);
          cam.position.lerpVectors(tw.fp, tw.tp, e);
          ctl.target.lerpVectors(tw.ft, tw.tt, e);
        }
        if (tankObj && spine && live.tank) placeWorn(tankObj, worn.tank, player.rig.root, spine);
        ctl.update();
        r.render(scene, live.first ? eye : cam);
      };
      raf = requestAnimationFrame(frame);
      makeThumbs(gl[0] as never, pack, (m) => alive && setThumbs((p) => ({ ...p, ...m })));
      // clips nuevos mientras trabajas (soltaste un FBX en la carpeta): se recogen solos
      const onPack = async () => {
        const before = new Set(pack.clips.keys());
        if (!(await reloadPack())) return setMsg('new bones in the skeleton: reload the page');
        const fresh = [...pack.clips.keys()].filter((n) => !before.has(n)), gone = [...before].filter((n) => !pack.clips.has(n));
        for (const n of fresh) MANIFEST[n] ??= guessCat(n);
        if (fresh.length) makeThumbs(gl[0] as never, pack, (m) => alive && setThumbs((p) => ({ ...p, ...m })), fresh);
        setPackVer((n) => n + 1);
        if (fresh.length || gone.length) setMsg(`${fresh.length ? '+' + fresh.length + ' new clip' + (fresh.length > 1 ? 's' : '') + ' (tagged automatically, check them)' : ''}${gone.length ? ' −' + gone.length + ' removed' : ''}`);
        setTimeout(() => setMsg(''), 6000);
      };
      import.meta.hot?.on('anim-pack-updated', onPack);
    });
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'z') return e.preventDefault(), apiRef.current!.undo();
      if (e.ctrlKey && k === 'y') return e.preventDefault(), apiRef.current!.redo();
      if (e.ctrlKey && k === 's') return e.preventDefault(), void apiRef.current!.save();
      const L = sRef.current;
      if (L && !e.ctrlKey && !e.altKey) {
        const cam = CAMS[+k - 1];
        if (cam && /^[1-9]$/.test(k)) return L.setCam(cam[0]), setTick((n) => n + 1);
        if (k === 'p') return void ((L.ctl.paused = !L.ctl.paused), setTick((n) => n + 1));
        if (k === '.') return void ((L.ctl.paused = true), (L.ctl.step = true));
        if (k === 'r') return L.reset();
        if (k === '?' || (k === 'h' && !e.shiftKey)) return void window.dispatchEvent(new Event('st-help'));
      }
      keys.current.add(k === ' ' ? ' ' : e.shiftKey ? 'shift' : k);
      if (e.shiftKey) keys.current.add('shift');
      if (k === ' ') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.current.delete(k);
      if (k === 'shift') keys.current.delete('shift');
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      ro.disconnect();
      r.dispose();
      r.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── datos: editar, deshacer, guardar ──
  const edit = useCallback((fn?: () => void, rebuild = false) => {
    fn?.();
    if (rebuild) sRef.current?.A.rebuild();
    const h = hist.current, s = snapshot();
    if (s !== h.stack[h.at]) (h.stack.length = h.at + 1), h.stack.push(s), (h.at = h.stack.length - 1);
    setTick((n) => n + 1);
  }, []);
  const undoTo = (to: number) => {
    const h = hist.current;
    if (to < 0 || to >= h.stack.length) return;
    h.at = to;
    restore(h.stack[to]);
    sRef.current?.A.rebuild();
    sRef.current?.A.setVariant(sRef.current.A.variant);
    setTick((n) => n + 1);
  };
  const save = async () => {
    const res = await Promise.all([post('tree', TREE), post('variants', VARIANTS), post('dances', DANCES), post('manifest', MANIFEST), post('grips', grips), post('worn', worn), post('pieces', PIECES)]);
    if (res.every(Boolean)) (hist.current.saved = snapshot()), setMsg('saved ✓');
    else setMsg('ERROR saving');
    setTimeout(() => setMsg(''), 2500);
    setTick((n) => n + 1);
  };
  // al salir de IK el personaje vuelve a llevar lo de la pestaña de movimiento; al entrar, el objeto de agarres que hubiera
  useEffect(() => {
    const L = sRef.current;
    if (!L) return;
    if (mode !== 'ik') (L.gear = ''), (L.gripAim = false), (L.first = false), (L.tank = false), (L.piece = '');
    applyCarry(L);
  }, [mode, S]);
  const preview = useCallback((clip: string | null, rate = 1) => {
    const L = sRef.current;
    if (!L || L.danceOn) return;
    if (clip) L.A.playOverClip(clip, rate);
    else L.A.stopOver();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clips = useMemo(() => (S ? [...S.pack.clips.keys()].sort() : []), [S, packVer]);
  const dirty = !!S && snapshot() !== hist.current.saved;
  const api: Api & { undo: () => void; redo: () => void; save: () => void } = { S, clips, thumbs, mode, setMode, sel, setSel, edit, preview, tick, undo: () => undoTo(hist.current.at - 1), redo: () => undoTo(hist.current.at + 1), save };
  apiRef.current = api;

  return (
    <StudioCtx.Provider value={api}>
      <style>{CSS}</style>
      <div className="st" data-mode={mode} style={{ gridTemplateColumns: `${lay.lib}px 5px 1fr 5px ${lay.side}px`, ['--dockh' as string]: `${lay.dock}px` }}>
        <header className="st-top">
          <b className="st-logo">ANIM STUDIO</b>
          {MODES.map(([m, label, hint]) => (
            <button key={m} className="st-tab" data-on={mode === m || undefined} title={hint} onClick={() => setMode(m)}>{label}</button>
          ))}
          <span className="st-grow" />
          <span className="st-msg">{msg}</span>
          <button onClick={api.undo} title="Ctrl+Z">↶</button>
          <button onClick={api.redo} title="Ctrl+Y">↷</button>
          <button className="st-save" data-dirty={dirty || undefined} onClick={save} title="Ctrl+S">{dirty ? 'SAVE ●' : 'SAVED'}</button>
        </header>
        {mode === 'ik' ? <IkPicker /> : <Library />}
        <div className="st-sp v" style={{ gridColumn: 2 }} onPointerDown={split('lib', 1, 'x', 150, 520)} />
        <div className="st-center">
          <div className="st-view" ref={box}>
            {S && (
              <>
                <CamBar />
                <Mando />
              </>
            )}
          </div>
          {(mode === 'dances' || mode === 'locomotion') && S && <div className="st-sp h" onPointerDown={split('dock', -1, 'y', 140, 700)} />}
          {mode === 'dances' && S && <Timeline />}
          {mode === 'locomotion' && S && <Locomotion />}
        </div>
        <div className="st-sp v" style={{ gridColumn: 4 }} onPointerDown={split('side', -1, 'x', 240, 640)} />
        <aside className="st-side">
          {!S ? <p>loading character and clips…</p> : mode === 'library' ? <ClipInfo /> : mode === 'locomotion' ? <LocoSide /> : mode === 'dances' ? <DanceSide /> : mode === 'variants' ? <VariantsPanel /> : <IkPanel />}
        </aside>
        <Help />
      </div>
    </StudioCtx.Provider>
  );
}

function ctrl(): Controls {
  return { move: new THREE.Vector2(), look: new THREE.Vector2(), run: false, jump: false, flash: false, grab: false, bag: false, aim: false, zoom: 0, fire: false, reload: false, swap: false, slot: -1, wheel: 0, use: false, pause: false };
}

/** Una miniatura por clip: el personaje en el instante 35 % del clip, pintado con otro renderizador pequeño. */
async function makeThumbs(hazmat: { scene: THREE.Object3D }, pack: Pack, push: (m: Record<string, string>) => void, only?: string[]) {
  const W = 112, H = 148;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  r.setSize(W, H);
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x1c2024);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x445, 2));
  const root = clone(hazmat.scene);
  root.traverse((o) => ((o as THREE.Mesh).isMesh && (o.frustumCulled = false)));
  sc.add(root);
  const A = new Animator(root, pack), cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 30);
  cam.position.set(1.5, 1.2, 3.2);
  cam.lookAt(0, 0.95, 0);
  let batch: Record<string, string> = {};
  let i = 0;
  for (const name of only ?? [...pack.clips.keys()]) {
    A.playOver(build({ type: 'clip', clip: name, freeze: 0.35 }), { fadeIn: 0.001, hold: true });
    A.update(0.05);
    r.render(sc, cam);
    batch[name] = r.domElement.toDataURL('image/jpeg', 0.75);
    if (++i % 6 === 0) {
      push(batch);
      batch = {};
      await new Promise((f) => requestAnimationFrame(f));
    }
  }
  push(batch);
  r.dispose();
}

// ── biblioteca ────────────────────────────────────────────────────────────

const CATS: Cat[] = ['tree', 'dance', 'part', 'variant', 'action'];

function Library() {
  const { S, clips, thumbs, sel, setSel, preview, mode } = useStudio();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat | 'all'>('all');
  const list = clips.filter((c) => (cat === 'all' || (MANIFEST[c] ?? 'part') === cat) && c.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="st-lib">
      <input className="st-search" placeholder="search clips…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="st-chips">
        {(['all', ...CATS] as const).map((c) => (
          <button key={c} data-on={cat === c || undefined} style={c === 'all' ? undefined : { ['--c' as string]: CAT_COLOR[c] }} onClick={() => setCat(c)}>{c === 'all' ? 'all' : CAT_LABEL[c]}</button>
        ))}
      </div>
      <p className="st-hint">{S ? 'hover to see it move · drag onto the timeline, a slot or a blend marker' : ''}</p>
      <div className="st-cards">
        {list.map((c) => (
          <div
            key={c}
            className="st-card"
            data-on={sel === c || undefined}
            draggable
            onDragStart={(e) => (e.dataTransfer.setData('text/clip', c), (e.dataTransfer.effectAllowed = 'copy'))}
            onMouseEnter={() => mode !== 'dances' && preview(c)}
            onMouseLeave={() => mode !== 'dances' && preview(sel || null)}
            onClick={() => (setSel(c), preview(c))}
          >
            <img src={thumbs[c]} alt="" draggable={false} />
            <span className="st-dot" style={{ background: CAT_COLOR[MANIFEST[c] ?? 'part'] }} />
            <b>{c}</b>
            <small>{S?.pack.clips.get(c)?.dur.toFixed(1)}s</small>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ClipInfo() {
  const { S, sel, edit, preview } = useStudio();
  const [rate, setRate] = useState(1);
  if (!S || !sel) return <p className="st-hint">Pick a clip on the left. Tag it so you know what it is for:</p>;
  const k = S.pack.clips.get(sel)!;
  return (
    <div>
      <h3>{sel}</h3>
      <p className="st-hint">{k.dur.toFixed(2)} s · {k.bones.length} bones</p>
      <h4>what is it?</h4>
      <div className="st-chips big">
        {CATS.map((c) => (
          <button key={c} data-on={(MANIFEST[sel] ?? 'part') === c || undefined} style={{ ['--c' as string]: CAT_COLOR[c] }} onClick={() => edit(() => (MANIFEST[sel] = c))}>{CAT_LABEL[c]}</button>
        ))}
      </div>
      <p className="st-hint">
        <b style={{ color: CAT_COLOR.tree }}>movement</b>: goes in the walking tree · <b style={{ color: CAT_COLOR.dance }}>dance</b>: a full victory dance · <b style={{ color: CAT_COLOR.part }}>dance part</b>: a piece to assemble in DANCES · <b style={{ color: CAT_COLOR.variant }}>variant</b>: a cosmetic version of a movement · <b style={{ color: CAT_COLOR.action }}>action</b>: reload, death…
      </p>
      <h4>speed</h4>
      <input type="range" min={0.25} max={2} step={0.05} value={rate} onChange={(e) => (setRate(+e.target.value), preview(sel, +e.target.value))} /> ×{rate}
    </div>
  );
}

function LocoSide() {
  const { S, edit } = useStudio();
  if (!S) return null;
  const A = S.A;
  return (
    <div>
      <h3>Test the movement</h3>
      <p className="st-hint">Click the 3D view, then: <kbd>W</kbd>/<kbd>S</kbd> walk · <kbd>A</kbd>/<kbd>D</kbd> turn · <kbd>Shift</kbd> run · <kbd>C</kbd> crouch · <kbd>Space</kbd> jump.</p>
      <h4>in their hands</h4>
      <div className="st-chips big">
        {(['none', 'rifle', 'flashlight'] as const).map((h) => (
          <button key={h} data-on={S.hold === h || undefined} onClick={() => ((S.hold = h), applyCarry(S), edit())}>{h}</button>
        ))}
      </div>
      <h4>values (live)</h4>
      <label className="st-chk"><input type="checkbox" checked={S.manual} onChange={(e) => ((S.manual = e.target.checked), edit())} /> set them by hand</label>
      {Object.keys(TREE.params).map((k) => (
        <div className="st-row" key={k}>
          <span className="st-w">{k}</span>
          <input type="range" disabled={!S.manual} min={k === 'vy' ? -8 : 0} max={k === 'speed' ? 6.5 : k === 'vy' ? 8 : 1} step={k === 'speed' || k === 'vy' ? 0.05 : 0.01} value={A.p[k] ?? 0} onChange={(e) => ((A.p[k] = +e.target.value), edit())} />
          <span>{(A.p[k] ?? 0).toFixed(2)}</span>
        </div>
      ))}
      <h4>slots</h4>
      <p className="st-hint">Names the tree uses for its clips. Drag a clip from the library onto a slot to replace it.</p>
      <Slots />
    </div>
  );
}

export function Slots({ target = TREE.slots, onDrop }: { target?: Record<string, string>; onDrop?: (slot: string, clip: string) => void }) {
  const { thumbs, edit, S } = useStudio();
  return (
    <div className="st-slots">
      {Object.entries(target).map(([slot, clip]) => (
        <div
          key={slot}
          className="st-slot"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const c = e.dataTransfer.getData('text/clip');
            if (!c) return;
            if (onDrop) onDrop(slot, c);
            else edit(() => ((TREE.slots[slot] = c), S && (S.A.slots[slot] = c)));
          }}
        >
          <img src={thumbs[clip]} alt="" />
          <b>{slot}</b>
          <small>{clip}</small>
        </div>
      ))}
    </div>
  );
}

function DanceSide() {
  const { S, edit, clips } = useStudio();
  const ids = Object.keys(DANCES);
  void S, void edit, void clips;
  return (
    <div>
      <h3>Victory dances</h3>
      <p className="st-hint">{ids.length} dance{ids.length === 1 ? '' : 's'}. Build them on the timeline below: drag clips from the library into it, drag the right edge of a block to trim it, drag its left edge to overlap it with the previous one (crossfade).</p>
      <p className="st-hint">Use clips tagged <b style={{ color: CAT_COLOR.dance }}>dance</b> and <b style={{ color: CAT_COLOR.part }}>dance part</b>.</p>
    </div>
  );
}
