import { DEV_LOCAL } from '../devGate';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ACHIEVEMENTS, COSMETICS, DEFAULT_LOOK, cleanLook, cosmetic, levelsOpen, type CosmeticDef, type Look, type RoomView, type Slot } from '@backrooms/shared';
import type { Inventory } from '@backrooms/shared';
import type { Sock } from '../net';
import type { Assets } from './game';
import Shop from './Shop';
import Upgrades from './Upgrades';
import type { Account } from '../account';
import RoomSettingsPanel from './RoomSettings';
import { Cosmetics } from './cosmetics';
import { Thumbs, type ThumbSpec } from './wardThumbs';

/*
 * La pantalla del ordenador de la sala de espera: un terminal CRT sobre la imagen (la cámara ya se ha acercado
 * a su pantalla). Arranca con unas líneas de BIOS y tiene tres pestañas: ROOM (los ajustes), SHOP (la tienda, con el dinero común) y WARDROBE (el armario:
 * una vista previa 3D del avatar, que gira, y COLOR / HEAD / BACK; lo bloqueado dice qué logro falta). Con cuenta, el
 * armario se guarda en el servidor (POST /api/loadout) y los demás lo ven; de invitado, solo los colores gratis, en local.
 * Se maneja con ratón o teclado: Tab, flechas, Intro; Escape o E (fuera de un campo de texto) cierran.
 */

const BOOT = ['BACKROOMS BIOS V2.04 (C) 1994', 'CPU 486DX2-66 .......... OK', 'MEMORY TEST 4096K .... OK', 'DETECTING DRIVES A: B: C:', 'TAPE DECK ............ READY', 'LOADING BACKROOMS-OS...'];

const GUEST_KEY = 'br-look';
/** El color que un invitado dejó en este navegador (solo uno gratis). */
export function guestLook(): Look {
  try {
    const c = cosmetic('color', JSON.parse(localStorage.getItem(GUEST_KEY) ?? '{}').color);
    if (c && !c.need) return { ...DEFAULT_LOOK, color: c.id };
  } catch {}
  return DEFAULT_LOOK;
}

/** El avatar girando en un lienzo pequeño: el rig hazmat clonado, con su aspecto puesto (tinte y accesorios, ver cosmetics.ts). */
function Preview({ gltf, look, reduced }: { gltf?: GLTF; look: Look; reduced: boolean }) {
  const cv = useRef<HTMLSpanElement>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  useEffect(() => {
    const box = cv.current;
    if (!box || !gltf) return;
    // un lienzo nuevo cada vez: tras forceContextLoss el de antes devolvería un contexto perdido (cuadrado negro)
    const canvas = Object.assign(document.createElement('canvas'), { className: 'br-ward__cv' });
    canvas.setAttribute('aria-label', 'Avatar preview');
    canvas.setAttribute('role', 'img');
    box.appendChild(canvas);
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 0.75, 0.1, 20);
    // el lienzo ocupa lo que le deja el terminal: el tamaño y la proporción siguen a la caja
    const resize = () => {
      const w = canvas.clientWidth || 240, h = canvas.clientHeight || 320;
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    cam.position.set(0, 1.0, 4.6);
    cam.lookAt(0, 0.9, 0);
    scene.add(new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 1.6));
    const key = new THREE.DirectionalLight(0xfff0d0, 2.2);
    key.position.set(2, 3, 3);
    scene.add(key);
    const pivot = new THREE.Group();
    const root = clone(gltf.scene);
    root.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.frustumCulled = false)));
    const cos = new Cosmetics(root); // los accesorios van en el mundo, junto al cuerpo: dentro del mismo pivote
    pivot.add(root);
    scene.add(cos.root); // coordenadas de mundo: fuera del pivote que gira
    pivot.rotation.y = -0.5;
    scene.add(pivot);
    if (DEV_LOCAL) Object.assign(window, { __pivot: pivot });
    const mixer = new THREE.AnimationMixer(root);
    const clip = gltf.animations.find((c) => c.name === 'Neutral Idle') ?? gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    const draw = () => {
      cos.set(lookRef.current);
      pivot.updateMatrixWorld(true);
      cos.update(0);
      r.render(scene, cam);
    };
    mixer.update(0.01);
    draw();
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      mixer.update(dt);
      if (!reduced) pivot.rotation.y += dt * 0.7;
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mixer.stopAllAction();
      cos.dispose(); // sus materiales son copias; la geometría y las texturas son del juego
      r.dispose();
      r.forceContextLoss();
      canvas.remove();
    };
  }, [gltf, reduced]);
  return gltf ? <span ref={cv} style={{ display: 'contents' }} /> : <p className="br-lobby__dim">NO PREVIEW</p>;
}

const Lock = () => (
  <svg className="br-box__lock" viewBox="0 0 12 14" width="14" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6V4a3 3 0 0 1 6 0v2" />
    <rect x="1" y="6" width="10" height="7" fill="currentColor" />
  </svg>
);

/** Una miniatura orbitando en su cajita (ver wardThumbs.ts). */
function Thumb({ hub, spec, dark }: { hub?: Thumbs; spec: ThumbSpec; dark: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const key = spec.kind === 'color' ? spec.hex : spec.kind === 'model' ? spec.id : '';
  useEffect(() => {
    if (!hub || !cv.current || spec.kind === 'none') return;
    return hub.add(cv.current, spec, dark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, key, dark]);
  return spec.kind === 'none' ? <span className="br-box__none" aria-hidden="true">∅</span> : <canvas ref={cv} className="br-box__cv" width={128} height={128} aria-hidden="true" />;
}

const SLOTS: [Slot, string][] = [['color', 'COLOR'], ['head', 'HEAD'], ['back', 'BACK']];
const need = (c: CosmeticDef) => ACHIEVEMENTS.find((a) => a.key === c.need)?.name ?? '';

function Wardrobe({ gltf, reduced, acct, sock }: { gltf?: GLTF; reduced: boolean; acct: Account; sock?: Sock }) {
  const signed = acct.status === 'user';
  const [look, setLook] = useState<Look>(() => (acct.me ? cleanLook(acct.me.loadout) : guestLook()));
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const [info, setInfo] = useState('');
  const slots = useRef<HTMLDivElement>(null);
  const [hub, setHub] = useState<Thumbs>();
  useEffect(() => {
    const h = new Thumbs(reduced, slots.current);
    setHub(h);
    return () => (h.dispose(), setHub(undefined));
  }, [reduced]);
  const unlocked = new Set(acct.me?.unlocked ?? []);
  const has = (c: CosmeticDef) => !c.need || (signed && unlocked.has(`${c.slot}:${c.id}`));
  const say = (m: string, isBad = false) => (setMsg(m), setBad(isBad));
  const pick = async (slot: Slot, id: string) => {
    const next = { ...look, [slot]: id };
    const c = cosmetic(slot, id);
    if (c && !has(c)) return say(signed ? `LOCKED · EARN ${need(c)}` : 'LOCKED · SIGN IN', true);
    setLook(next);
    if (signed) {
      try {
        await acct.saveLoadout(next);
        say('SAVED');
      } catch (e) {
        setLook(look);
        say(String((e as Error).message || 'COULD NOT SAVE').toUpperCase(), true);
      }
    } else {
      // invitado: un color gratis, solo en este navegador (y la sala lo enseña a los demás)
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify({ color: next.color }));
      } catch {}
      sock?.emit('look', next.color);
      say('SAVED ON THIS BROWSER · SIGN IN TO KEEP MORE');
    }
  };
  const key = (e: KeyboardEvent<HTMLDivElement>, ids: string[], cur: number, slot: Slot) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const n = (cur + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
    void pick(slot, ids[n]);
  };
  const cur = cosmetic('color', look.color);
  return (
    <div className="br-ward">
      <div className="br-ward__view">
        <Preview gltf={gltf} look={look} reduced={reduced} />
        <p className="br-lobby__dim br-ward__cap">PREVIEW · {cur?.name ?? ''}</p>
      </div>
      <div className="br-ward__slots" ref={slots}>
        {SLOTS.map(([slot, label]) => {
          const opts = COSMETICS.filter((c) => c.slot === slot), ids = slot === 'color' ? opts.map((c) => c.id) : ['', ...opts.map((c) => c.id)];
          const idx = Math.max(0, ids.indexOf(look[slot]));
          const got = opts.filter(has).length;
          return (
            <div className="br-ward__row" key={slot}>
              <p className="br-ward__h">
                <span>{label}</span>
                <span className="br-lobby__dim">
                  {got}/{opts.length} UNLOCKED
                </span>
              </p>
              <div className="br-boxes" role="radiogroup" aria-label={label} onKeyDown={(e) => key(e, ids, idx, slot)}>
                {ids.map((id, i) => {
                  const c = cosmetic(slot, id), locked = !!c && !has(c), on = i === idx;
                  const name = c?.name ?? 'NONE';
                  const why = locked ? (signed ? `EARN ${need(c!)}` : 'SIGN IN') : '';
                  const spec: ThumbSpec = !c ? { kind: 'none' } : slot === 'color' ? { kind: 'color', hex: c.hex! } : { kind: 'model', id };
                  const tip = `${name}${why ? ' · LOCKED · ' + why : ''}`;
                  return (
                    <button key={id || 'none'} type="button" role="radio" aria-checked={on} aria-disabled={locked || undefined} aria-label={tip} title={tip} tabIndex={on ? 0 : -1} data-nav data-locked={locked || undefined} className="br-box" onMouseEnter={() => setInfo(tip)} onMouseLeave={() => setInfo('')} onFocus={() => setInfo(tip)} onBlur={() => setInfo('')} onClick={() => void pick(slot, id)}>
                      <Thumb hub={hub} spec={spec} dark={locked} />
                      {locked && <Lock />}
                      <span className="br-box__name">{name}</span>
                      {why && <span className="br-box__why">{why}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="br-lobby__sub" role={bad ? 'alert' : 'status'} data-bad={bad || undefined}>
          {info || msg || (signed ? 'PICK WHAT YOU WEAR. THE OTHERS IN THE ROOM SEE IT.' : 'GUEST: ONLY THE FREE COLORS. SIGN IN TO UNLOCK MORE.')}
        </p>
      </div>
    </div>
  );
}

const PHASE: Record<RoomView['phase'], string> = { lobby: 'WAITING IN THE LOBBY', starting: 'VOTING', playing: 'IN PROGRESS', over: 'TAPE ENDED' };

/** El resumen de la sala, a la derecha del terminal: código, estado y quién hay conectado (con su color). */
function Summary({ room, me }: { room: RoomView; me: string }) {
  const empty = Math.max(0, room.max - room.players.length);
  return (
    <aside className="br-sum" aria-label="Room summary">
      <p className="br-lobby__dim">ROOM CODE</p>
      <p className="br-sum__code">{room.code}</p>
      <p>
        <span className="br-lobby__dim">TAPE </span>
        {String(room.tape).padStart(3, '0')} · {room.public ? 'PUBLIC' : 'PRIVATE'}
      </p>
      <p>
        <span className="br-lobby__dim">STATUS </span>
        {PHASE[room.phase]}
      </p>
      <p className="br-lobby__dim" style={{ marginTop: '0.6em' }}>
        CONNECTED {room.players.length}/{room.max}
      </p>
      <ul className="br-sum__list">
        {room.players.map((p) => (
          <li key={p.id}>
            <span className="br-sum__sw" style={{ background: cosmetic('color', p.look.color)?.hex ?? '#fff' }} aria-hidden="true" />
            <span className="br-sum__n">{p.name || 'ANON'}</span>
            <span className="br-sum__tag">
              {p.id === room.ownerId ? 'OWNER' : ''}
              {p.id === room.ownerId && p.id === me ? ' · ' : ''}
              {p.id === me ? 'YOU' : ''}
            </span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`e${i}`} data-empty>
            <span className="br-sum__sw" aria-hidden="true" />
            <span className="br-sum__n">WAITING FOR PLAYER…</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

type Tab = 'room' | 'shop' | 'ups' | 'ward';

export default function Computer({ room, me, sock, hazmat, assets, inv, reduced = false, acct, onClose }: { room: RoomView; me: string; sock?: Sock; hazmat?: GLTF; assets?: Assets; inv: Inventory | null; reduced?: boolean; acct: Account; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('room');
  const [boot, setBoot] = useState(reduced ? BOOT.length + 1 : 0); // líneas de BIOS ya escritas; > BOOT.length = arrancado
  const root = useRef<HTMLDivElement>(null);
  const booted = boot > BOOT.length;
  useEffect(() => {
    if (booted) return;
    const t = setTimeout(() => setBoot((n) => n + 1), boot < BOOT.length ? 150 : 450);
    return () => clearTimeout(t);
  }, [boot, booted]);
  // el foco: en el terminal mientras arranca (para saltar con una tecla) y luego en la pestaña
  useEffect(() => {
    if (!booted) root.current?.focus();
    else root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [booted]);
  const tabs: [Tab, string][] = [['room', 'ROOM'], ['shop', 'SHOP'], ['ups', 'UPGRADES'], ['ward', 'WARDROBE']];
  const nav = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') return void (e.preventDefault(), onClose());
    if (!booted) return void (e.preventDefault(), setBoot(BOOT.length + 1)); // cualquier tecla se salta el arranque
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // arriba y abajo recorren lo que se puede pulsar
      const all = [...(root.current?.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"], [data-nav][tabindex="0"], .br-field, .br-pc__close, .br-set .br-opt') ?? [])];
      const i = all.indexOf(t), n = all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
      if (n) (e.preventDefault(), n.focus());
    }
  };
  const tabKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tabs[(tabs.findIndex(([k]) => k === tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0];
    setTab(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`#br-tab-${next}`)?.focus());
  };
  return (
    <div className="br-pc" role="dialog" aria-label="Computer" onKeyDown={nav} onClick={() => !booted && setBoot(BOOT.length + 1)}>
      <div className="br-pc__screen" ref={root} tabIndex={-1}>
        <p className="br-pc__bar">
          <span>TERMINAL · ROOM {room.code}</span>
          <span className="br-lobby__dim">
            BANK ${room.bank} · {room.players.length}/{room.max} CONNECTED
          </span>
        </p>
        {!booted ? (
          <div className="br-pc__boot" aria-live="polite">
            {BOOT.slice(0, boot).map((l) => (
              <p key={l}>{l}</p>
            ))}
            <p className="br-pc__cur" aria-hidden="true">
              {boot >= BOOT.length ? 'STARTING' : ''}
            </p>
            <p className="br-lobby__dim br-pc__skip">PRESS ANY KEY</p>
          </div>
        ) : (
          <>
            <nav className="br-pc__tabs" role="tablist" aria-label="Sections" onKeyDown={tabKey}>
              {tabs.map(([k, label]) => (
                <button key={k} id={`br-tab-${k}`} type="button" role="tab" aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className="br-opt br-pc__tab" onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </nav>
            <div role="tabpanel" aria-labelledby={`br-tab-${tab}`} className="br-pc__panel">
              {tab === 'room' ? (
                <div className="br-roomgrid">
                  <RoomSettingsPanel room={room} me={me} sock={sock} />
                  <Summary room={room} me={me} />
                </div>
              ) : tab === 'shop' ? (
                <Shop bank={room.bank} inv={inv} sock={sock} assets={assets} open={room.openLevels ? new Set(room.openLevels) : levelsOpen(room.players.map((p) => p.ups))} />
              ) : tab === 'ups' ? (
                <Upgrades bank={room.bank} ups={room.players.find((p) => p.id === me)?.ups ?? {}} sock={sock} assets={assets} />
              ) : (
                <Wardrobe gltf={hazmat} reduced={reduced} acct={acct} sock={sock} />
              )}
            </div>
            <ul className="br-lobby__opts">
              <li>
                <button type="button" className="br-opt br-pc__close" onClick={onClose}>
                  CLOSE [ESC]
                </button>
              </li>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
