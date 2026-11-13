'use client';
import { DEV_LOCAL } from '../devGate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { holdStill } from './still';
import { BackroomsGame, LOAD_PHASES, type Hud, type Inv, type LoadProgress } from './game';
import { generateMaze } from './maze';
import Touch from './Touch';
import Inventory, { type Cell } from './Inventory';
import Hotbar from './Hotbar';
import TotemUi from './Totem';
import { HOT } from './quickslots';
import { setCursors } from './cursors';
import { AMMO_PACK, DIFFICULTY, levelsOpen, type Inventory as SrvInv, type ItemId, type RoomView, type RoundResult } from '@backrooms/shared';
import { useNet, useServer } from '../net';
import { avatarUrl, useAccount } from '../account';
import { Avatar, AuthScreen, DiscordButton, AccountBox, AccountMenu, AchievementsScreen, Toasts, type AuthMode } from './Account';
import Frame from './Frame';
import SettingsPane from './Settings';
import { Crosshair } from './Crosshair';
import { onSetting, settings, useSettings } from '../settings';
import Lobby, { ServerNotice } from './Lobby';
import Computer, { guestLook } from './Computer';
import ShopGrid from './ShopGrid';
import { cleanLook } from '@backrooms/shared';
import Board, { BoardHint } from './Board';
import { DIFF } from './RoomSettings';
import End from './End';
import Loading from './Loading';
import BootLoading from './BootLoading';
import AdminConsole from './Admin';
import WaitPanel from './WaitPanel';
import { ChatInput, ChatLog, useChat } from './Chat';
import VoiceHud from './VoiceHud';
import { useVoice } from '../voice';
import LockerGame from './LockerGame';
import EmoteWheel from './EmoteWheel';
import { emoteGate } from './emotes';

/*
 * El caparazón del juego de las backrooms: la carga de los 90 (letra blanca, barra de bloques), el
 * menú (Quit se cae, Options te roba el cursor y le da a Play) y, encima de la partida, el OSD de la
 * cámara, la pausa y el cuelgue falso. El juego en sí (game.ts) no sabe de React.
 */

type Screen = 'load' | 'menu' | 'settings' | 'achv' | 'play' | 'pause' | 'dead' | 'crash' | 'lobby' | 'wait' | 'waitpause' | 'over';
type WaitHud = BackroomsGame['waitHud'];
const NO_WAIT: WaitHud = { ready: false, hint: null, label: '', notice: '', computer: false, board: false, entering: false, locked: false, free: true };

// desarrollo: el laberinto de una semilla en ASCII (S inicio, L ascensor, C cámara, P pistola, t cintas, E entidades, O huecos)
function asciiMaze(seed: number) {
  const m = generateMaze(seed), mark = new Map<number, string>();
  const put = (c: { x: number; y: number }, ch: string) => mark.set(c.y * m.w + c.x, ch);
  m.voids.forEach((c) => put(c, 'O'));
  m.tapes.forEach((c) => put(c, 't'));
  m.spawns.slice(0, 2).forEach((c) => put(c, 'E'));
  put(m.start, 'S');
  put(m.elevator, 'L');
  put(m.camera, 'C');
  if (m.pistol) put(m.pistol, 'P');
  let out = '';
  for (let y = 0; y < m.h; y++, out += '\n') for (let x = 0; x < m.w; x++) out += mark.get(y * m.w + x) ?? (m.open[y * m.w + x] ? '.' : '#');
  return out;
}

/**
 * La estática de la cinta detrás de la carga y del menú: nieve gris a 15 fps (quieta con movimiento reducido).
 * De vez en cuando, entre la nieve, se cuela una escena prerenderizada (ver game.prerender): una sala de las
 * backrooms con entidades bailando, que se sintoniza a saltos, se sostiene un instante con la banda de tracking
 * subiendo y se vuelve a perder.
 */
function Static({ still, scenes }: { still: boolean; scenes: HTMLCanvasElement[][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, x = c.getContext('2d', { willReadFrequently: true })!, W = c.width, H = c.height, img = x.createImageData(W, H);
    let id = 0, last = 0, next = 2500 + Math.random() * 3000, scene: HTMLCanvasElement[] | undefined, t0 = 0, dur = 0, prev = -1;
    const draw = (t: number) => {
      if (!still) id = requestAnimationFrame(draw);
      if (t - last < 66) return;
      last = t;
      // cuánto se ve la escena (0–1): sube y baja rápido en los extremos
      let k = 0;
      if (!still && scenes.length) {
        if (!scene && t > next) {
          let i = (Math.random() * scenes.length) | 0;
          if (i === prev) i = (i + 1) % scenes.length;
          (prev = i), (scene = scenes[i]), (t0 = t), (dur = 500 + Math.random() * 900);
        }
        if (scene) {
          const u = (t - t0) / dur;
          if (u >= 1) (scene = undefined), (next = t + 3500 + Math.random() * 6500);
          else k = Math.min(1, u * 7, (1 - u) * 7);
        }
      }
      const d = img.data, band = ((t * 0.0003) % 1) * H;
      if (scene && k > 0) {
        // la imagen, a tiras de 3 filas: al sintonizar (k < 1) y en la banda de tracking, desplazadas
        const frame = scene[Math.floor((t - t0) / 130) % scene.length];
        x.fillStyle = '#000';
        x.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y += 3) {
          const inBand = Math.abs(y - band) < 9, off = (inBand ? (Math.random() - 0.5) * 22 : 0) + (k < 1 ? (Math.random() - 0.5) * 70 * (1 - k) : 0) + (Math.random() - 0.5) * 1.5;
          x.drawImage(frame, 0, y, W, 3, off, y, W, 3);
        }
        const src = x.getImageData(0, 0, W, H).data;
        for (let i = 0; i < d.length; i += 4) {
          const n = Math.random() * 255, m = 0.35 + 0.65 * k, row = (i / 4 / W) | 0, scan = row % 3 === 0 ? 0.82 : 1;
          const v = (src[i] * m * scan) * 0.55 + (src[i + 1] * m * scan) * 0.35 + n * (1 - m) * 0.9 + (Math.random() - 0.5) * 26;
          d[i] = Math.min(255, v * 1.04 + (src[i] - v) * 0.5);
          d[i + 1] = Math.min(255, v * 1.02 + (src[i + 1] - v) * 0.5);
          d[i + 2] = Math.min(255, v * 0.9 + (src[i + 2] - v) * 0.5);
          d[i + 3] = 255;
        }
      } else {
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.random() * 255;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        // una banda de tracking más clara que sube despacio
        if (!still) for (let y = Math.max(0, (band - 5) | 0); y < Math.min(H, (band + 5) | 0); y++) for (let i = y * W * 4, e = i + W * 4; i < e; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.min(255, d[i] * 1.5 + 40);
      }
      x.putImageData(img, 0, 0);
      c.style.opacity = String(0.07 + 0.5 * k);
    };
    draw(100);
    return () => cancelAnimationFrame(id);
  }, [still, scenes]);
  return <canvas ref={ref} className="br-static" width={320} height={180} aria-hidden="true" />;
}

/** El contador de fotogramas (ajuste SHOW FPS): arriba a la derecha, sobre todo lo demás. */
function Fps() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let f = 0, last = performance.now(), id = 0;
    const tick = (t: number) => {
      f++;
      if (t - last >= 500) (setN(Math.round((f * 1000) / (t - last))), (f = 0), (last = t));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return <p className="br-fps" aria-hidden="true">{n} FPS</p>;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const two = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** El visor de la camcorder (solo mirando por ella): REC y el contador, la batería, la fecha (de 1994), el zoom, el recuadro de enfoque y las fotos. */
function Osd({ hud }: { hud: Hud }) {
  const d = new Date(), t = hud.time;
  const bars = Math.ceil(hud.battery * 4);
  return (
    <div className="br-osd" aria-live="off">
      <p className="br-osd__tl">
        <span className="br-osd__rec">● REC</span> {two(t / 3600)}:{two((t / 60) % 60)}:{two(t % 60)}
      </p>
      <p className="br-osd__tr" aria-label={`battery ${Math.round(hud.battery * 100)}%`}>
        {'▮'.repeat(bars)}
        <span className="br-osd__dim">{'▮'.repeat(4 - bars)}</span>
      </p>
      <p className="br-osd__bl">
        {MONTHS[d.getMonth()]} {two(d.getDate())} 1994 {two(d.getHours())}:{two(d.getMinutes())}:{two(d.getSeconds())}
      </p>
      <p className="br-osd__br">
        x{hud.zoom.toFixed(1)}
        <br />
        PHOTOS {hud.photos}
        {hud.mission?.kind === 'photos' ? `/${hud.mission.goal}` : ''}
      </p>
      <div className="br-osd__focus" data-on={hud.focus || undefined} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

/** La misión de la ronda, siempre en pantalla (sin mirar por la cámara): el objetivo, su progreso en bloques («PHOTOS 1/3», «TVS 2/4») y, si se gasta, la linterna y el aguante. */
/** El inventario del servidor como lo espera el menú de la mochila (en la sala de espera no hay jugador: manos y cinturón quedan vacíos). */
function waitInv(s: SrvInv, hot: (string | null)[] = ['caution', null, null, null], left: 'none' | 'flashlight' = s.spares ? 'flashlight' : 'none'): Inv {
  return { hand: 'none', left, belt: 'none', stamina: 1, sanity: 1, escaped: false, camera: s.camera, gun: s.gun, ammo: Math.min(s.ammo, AMMO_PACK), spare: Math.max(0, s.ammo - AMMO_PACK), tapes: 0, photos: 0, thumbs: [], full: [], flashOn: false, battery: 1, charge: 1, spares: s.spares, uno: s.uno, monster: s.monster, water: s.water, totem: s.totem, radar: s.radar, caution: s.caution, tank: s.tank, tankOn: true, watergun: s.watergun, tape: 1, hot, hotSel: 0, gadget: 'none' };
}

/** La misión de la ronda, siempre en pantalla (sin mirar por la cámara): el objetivo, su progreso en bloques («PHOTOS 1/3», «TVS 2/4») y, si se gasta, la linterna y el aguante. */
function Mission({ hud, room }: { hud: Hud; room: RoomView | null }) {
  const i = hud.inv, m = hud.mission, up = hud.ascent;
  const aboard = (room?.ascent?.boarded ?? []).map((id) => room?.players.find((p) => p.id === id)?.name || 'ANON');
  const goal = !m ? '' : m.done ? (room?.levelId === 'suites' ? 'ELEVATOR OR STAIRS OPEN' : 'ELEVATOR OPEN') : m.kind === 'photos' && !i.camera ? 'FIND A CAMCORDER' : m.text;
  const blocks = (n: number, of: number) => (
    <>
      {'▮'.repeat(n)}
      <span className="br-osd__dim">{'▮'.repeat(of - n)}</span>
    </>
  );
  return (
    <div className="br-mission" aria-live="polite">
      {room?.levelId === 'suites' && room.floor && <p className="br-osd__dim">FLOOR {room.floor} / 5</p>}
      {m && (
        <p className={m.done ? 'br-lift__t' : undefined} data-urgent={(m.done && !!up && !up.boarded) || undefined}>
          {goal}
        </p>
      )}
      {m?.done && (
        <div className="br-lift">
          <p>{up ? `${up.boarded ? 'YOU ARE ABOARD. WAITING FOR THE OTHERS. ' : 'CLOSES IN '}${Math.ceil(up.left)}S` : 'GET EVERYONE IN BEFORE IT CLOSES'}</p>
          {aboard.length > 0 && <p className="br-osd__dim">ABOARD {aboard.join(', ')}</p>}
        </div>
      )}
      {m && !m.done && (
        <p aria-label={m.line}>
          {m.line} {m.kind === 'survive' ? blocks(Math.round((m.progress / m.goal) * 10), 10) : blocks(m.progress, m.goal)}
        </p>
      )}
      {(i.charge < 0.99 || i.spares > 0) && (
        <p className="br-mission__stamina" data-low={i.charge < 0.2 || undefined}>
          {i.charge <= 0 ? (i.spares ? 'LIGHT DEAD [F] NEW FLASHLIGHT' : 'LIGHT DEAD') : <>LIGHT {blocks(Math.round(i.charge * 10), 10)}</>}
          {i.spares > 0 && i.charge > 0 ? ` +${i.spares}` : ''}
        </p>
      )}
      {i.hand === 'gun' && (
        <p className="br-mission__stamina" data-low={i.ammo + i.spare === 0 || undefined} aria-label={`Rifle: ${i.ammo} in the magazine, ${i.spare} in reserve`}>
          AMMO {blocks(i.ammo, AMMO_PACK)} {i.ammo}/{i.spare}
        </p>
      )}
      {(i.stamina < 0.99 || i.rainbow) && <p className="br-mission__stamina" data-rainbow={i.rainbow || undefined} data-low={(!i.rainbow && i.stamina < 0.25) || undefined}>STAMINA {blocks(Math.round(i.stamina * 10), 10)}</p>}
    </div>
  );
}

/** Un jugador del equipo: su foto, nombre, si cayó y (en partida) su vida 0–100. */
interface Mate {
  id: string;
  name: string;
  avatar: string;
  dead: boolean;
  hp?: number;
}

/** El equipo, arriba a la derecha: foto, nombre y barra de vida de cada jugador (los caídos, apagados). Sin `hp`, solo la lista (sala de espera). */
function Team({ mates, me }: { mates: Mate[]; me: string }) {
  const v = useVoice();
  return (
    <ul className="br-team" aria-label="Team">
      {mates.map((m) => {
        const hp = m.hp === undefined ? undefined : m.dead ? 0 : Math.max(0, Math.min(100, Math.round(m.hp)));
        const n = Math.ceil((hp ?? 0) / 10);
        return (
          <li key={m.id} data-dead={m.dead || undefined} data-low={(hp !== undefined && hp <= 30 && !m.dead) || undefined} data-me={m.id === me || undefined}>
            <Avatar src={avatarUrl(m.avatar)} name={m.name} />
            <span className="br-team__n">
              {m.name}
              {v.speaking.has(m.id) && (
                <svg className="br-team__spk" viewBox="0 0 16 16" aria-label="speaking">
                  <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
                  <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              )}
            </span>
            {hp !== undefined && (
              <span className="br-team__hp" role="img" aria-label={m.dead ? 'down' : `health ${hp}%`}>
                {'▮'.repeat(n)}
                <span className="br-osd__dim">{'▮'.repeat(10 - n)}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** `on`, pero sin apagarse antes de que hayan pasado `ms` desde que se encendió: para que la pantalla de carga se llegue a ver. */
function useHold(on: boolean, ms: number) {
  const [hold, setHold] = useState(false);
  const t0 = useRef(0);
  useEffect(() => {
    if (on) return (t0.current = performance.now()), setHold(true);
    const id = setTimeout(() => setHold(false), Math.max(0, ms - (performance.now() - t0.current)));
    return () => clearTimeout(id);
  }, [on, ms]);
  return on || hold;
}

export default function Backrooms({ onQuit, onWin }: { onQuit: () => void; onWin: () => void }) {
  const [screen, setScreen] = useState<Screen>('load');
  const [lvl, setLvl] = useState<number | null>(null); // la carga de un nivel al empezar la ronda (las Poolrooms): tapa el HUD
  const [loadP, setLoadP] = useState<LoadProgress>({ f: 0, phase: 0, pf: 0 }); // el avance real de la carga (ver Game.load)
  const [failed, setFailed] = useState(false);
  const [quitGone, setQuitGone] = useState(false);
  const [muted, setMuted] = useState(false);
  const [touch, setTouch] = useState(false);
  const [hand, setHand] = useState<'none' | 'camera' | 'gun'>('none');
  const [hud, setHud] = useState<Hud>();
  // los números del error, inventados una vez
  const [crashCode] = useState(() => ((Math.random() * 0xffffff) | 0).toString(16).toUpperCase().padStart(6, '0'));
  const [crashFrame] = useState(() => 1000 + ((Math.random() * 90000) | 0));
  // la sala: el socket solo existe mientras se está en el multijugador
  const [mp, setMp] = useState(false);
  const net = useNet(mp);
  const acct = useAccount();
  const [acctOpen, setAcctOpen] = useState(false); // el popup de la cuenta (SIGN IN / REGISTER / SIGN OUT)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null); // el popup de inicio de sesión: abierto con su modo, o cerrado
  const [welcome, setWelcome] = useState(false); // el aviso de la primera vez sin sesión
  const [pauseSettings, setPauseSettings] = useState(false); // los ajustes abiertos desde el menú de pausa
  const [toasts, setToasts] = useState<{ id: number; key: string }[]>([]);
  const server = useServer(net.sock);
  const msgs = useChat(net.sock);
  const [chat, setChat] = useState(false);
  const [won, setWon] = useState(false);
  const [notice, setNotice] = useState('');
  // la sala de espera 3D (game.ts/waiting.ts): lista, el ordenador abierto y lo que se lee de ella 10 veces por segundo
  const [waitReady, setWaitReady] = useState(false);
  const [computer, setComputer] = useState(false);
  const [board, setBoard] = useState(false);
  const [waitBag, setWaitBag] = useState(false);
  const bag = useRef<(Cell | null)[]>([]); // disposición de la mochila: solo dura la sesión
  const [wh, setWh] = useState<WaitHud>(NO_WAIT);
  const roomRef = useRef(net.room);
  roomRef.current = net.room;
  const invRef = useRef(net.inv);
  invRef.current = net.inv;
  const [result, setResult] = useState<RoundResult | null>(null);
  const mpRef = useRef(false);
  mpRef.current = mp;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const chatRef = useRef(false);
  chatRef.current = chat;
  const endRef = useRef<(r: RoundResult) => void>(() => {});
  const game = useRef<BackroomsGame>();
  const gl = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLCanvasElement>(null);
  const quit = useRef<HTMLButtonElement>(null);
  const reduced = useRef(false);
  const showFps = useSettings().fps;
  const showCross = useSettings().crosshair;
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const quitRef = useRef(onQuit);
  quitRef.current = onQuit;
  const adminRef = useRef(false);
  adminRef.current = !!acct.me?.admin;
  useEffect(() => void (game.current && (game.current.adminOn = !!acct.me?.admin)), [acct.me?.admin]);
  useEffect(() => void (game.current && (game.current.myLook = acct.me ? cleanLook(acct.me.loadout) : guestLook())), [acct.me]); // mi skin, para mi propio cuerpo
  const [locker, setLocker] = useState<string | null>(null); // la taquilla que se está abriendo (id)
  // la rueda de emotes (mantener B en la sala de espera) y los emotes que abren mis logros
  const [wheel, setWheel] = useState(false);
  const haveAch = useMemo(() => new Set(Object.keys(acct.me?.achievements ?? {})), [acct.me?.achievements]);
  useEffect(() => void (emoteGate.have = haveAch), [haveAch]);
  const pickEmote = useCallback((n: number) => {
    setWheel(false);
    game.current?.setLockerUi(false);
    if (n) game.current?.emote(n);
  }, []);
  useEffect(() => {
    if (screen !== 'wait' || !mp) return;
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'KeyB' || e.repeat || !game.current?.waitHud.free || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      game.current?.setLockerUi(true);
      setWheel(true);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [screen, mp]);
  const winRef = useRef(onWin);
  winRef.current = onWin;

  // la carga: mientras, la pantalla está quieta (en Firefox se compila aquí, ver still.ts)
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches || settings.reduceMotion || (DEV_LOCAL && new URLSearchParams(location.search).has('reduced'));
    const dev = DEV_LOCAL ? new URLSearchParams(location.search) : null;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    // GRAPHICS (ajustes): 0 automático (bajo en táctiles), 1 siempre bajo, 2 siempre alto
    const low = settings.quality === 1 || (settings.quality !== 2 && coarse) || !!dev?.has('low');
    setTouch(coarse);
    setCursors(root.current!);
    // el lienzo se crea aquí y no en el JSX: al salir se pierde su contexto, y el doble montaje de
    // StrictMode (en desarrollo) necesita uno nuevo
    const cv = Object.assign(document.createElement('canvas'), { className: 'br-gl' });
    cv.setAttribute('aria-hidden', 'true');
    gl.current!.prepend(cv);
    const g = (game.current = new BackroomsGame(cv, { low, reduced: reduced.current }));
    // el sonido quitado se recuerda (una comodidad de quien juega: si el navegador no deja guardar, no pasa nada)
    try {
      const m = localStorage.getItem('br-muted') === '1';
      g.setMuted(m);
      setMuted(m);
    } catch {}
    g.adminOn = adminRef.current;
    g.setVolume(settings.volume);
    onSetting('volume', (v) => g.setVolume(v));
    onSetting('sfx', () => g.audio?.setMix());
    onSetting('ambient', () => g.audio?.setMix());
    g.vhs.uniforms.uAmount.value = settings.vhs;
    onSetting('vhs', (v) => (g.vhs.uniforms.uAmount.value = v));
    // gráficos: la escala de resolución rehace el tamaño del lienzo y el brillo es un filtro de la página
    onSetting('resScale', () => dispatchEvent(new Event('resize')));
    onSetting('bloom', (v) => g.setBloom(v));
    const bright = () => void (g.canvas.style.filter = settings.brightness === 1 ? '' : `brightness(${settings.brightness})`);
    bright();
    onSetting('brightness', bright);
    // desarrollo local (no por túnel ni en producción, ver devGate.ts): __game y __maze(semilla) en la consola
    if (dev) Object.assign(window, { __game: g, __maze: (seed: number) => console.info(asciiMaze(seed)) });
    g.onPause = () => alive && setScreen(g.waiting ? 'waitpause' : 'pause');
    g.onDeath = () => alive && setScreen('crash');
    g.onLevelLoad = (f) => alive && setLvl(f);
    g.onLocker = (id) => (g.setLockerUi(true), setLocker(id));
    g.onWin = () => mpRef.current || winRef.current(); // en una sala la ronda la cierra el servidor (over), no subir al ascensor
    const free = holdStill();
    let alive = true;
    g.load((p) => alive && setLoadP(p))
      .then(async () => {
        if (!alive) return;
        await new Promise((r) => setTimeout(r, 400)); // un instante al 100 % antes de pasar al título
        if (alive) setScreen('menu');
        if (alive && (dev?.has('pool') || dev?.has('poolmap'))) (setScreen('play'), g.devPool(dev.has('poolmap')));
        else if (alive && dev?.has('suites')) (setScreen('play'), g.devSuites());
        else if (alive && dev?.has('runlevel')) (setScreen('play'), g.devRun()); // desarrollo: ?runlevel arranca «Run for your life» sin sala
      })
      .catch((e) => (console.error('load failed', e), alive && setFailed(true)))
      .finally(free);
    return () => {
      alive = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      free();
      g.dispose();
      cv.remove();
    };
  }, []);

  // si no carga: cualquier tecla o toque vuelve al escritorio
  useEffect(() => {
    if (!failed) return;
    const back = () => quitRef.current();
    const id = setTimeout(() => (addEventListener('keydown', back), addEventListener('pointerdown', back)), 400);
    return () => {
      clearTimeout(id);
      removeEventListener('keydown', back);
      removeEventListener('pointerdown', back);
    };
  }, [failed]);

  // lo que el OSD y los controles táctiles leen del juego, diez veces por segundo (el visor sale al subir la cámara)
  useEffect(() => {
    if (screen !== 'play') return;
    // solo se vuelve a pintar el árbol si algo visible cambió (números redondeados; el reloj solo cuenta con el visor)
    let prev = '';
    const id = setInterval(() => {
      const hd = game.current?.player?.hand ?? 'none';
      setHand(hd === 'watergun' ? 'none' : hd);
      const h = game.current?.hud;
      const key = JSON.stringify(h, (k, v) => (k === 'time' && !h?.aiming ? 0 : (k === 'thumbs' || k === 'full') && Array.isArray(v) ? v.length : typeof v === 'number' ? Math.round(v * 200) : v));
      if (key === prev) return;
      prev = key;
      setHud(h);
    }, 100);
    return () => clearInterval(id);
  }, [screen]);

  // Esc: en la pantalla de título vuelve al escritorio; en las salas, los logros y los ajustes, a la pantalla de título (sin un popup abierto)
  useEffect(() => {
    if (!['menu', 'lobby', 'achv', 'settings'].includes(screen) || authMode || acctOpen || welcome) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (screen === 'menu') return quitRef.current();
      if (screen === 'lobby') setMp(false);
      setScreen('menu');
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [screen, authMode, acctOpen, welcome]);

  // la primera vez que se llega al título sin sesión (y con servidor, para poder entrar): una invitación a iniciar sesión; se recuerda que ya salió
  useEffect(() => {
    if (screen !== 'menu' || acct.status !== 'guest') return;
    try {
      if (localStorage.getItem('br-welcome')) return;
      localStorage.setItem('br-welcome', '1');
    } catch {
      return; // sin almacenamiento no se puede recordar: mejor no insistir
    }
    setWelcome(true);
  }, [screen, acct.status]);

  useEffect(() => {
    if (!welcome) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), setWelcome(false));
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [welcome]);

  // Esc en la pausa: con los ajustes abiertos, los cierra; si no, sale de la pausa y sigue la partida
  useEffect(() => {
    if (screen !== 'pause' && screen !== 'waitpause') return setPauseSettings(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      if (pauseSettings) return setPauseSettings(false);
      game.current?.input.soft(); // Esc no es un gesto: si el navegador no da el puntero, no vuelve a pausar
      screen === 'pause' ? resumeRef.current() : resumeWaitRef.current();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [screen, pauseSettings]);

  // el cuelgue falso: el último fotograma congelado y temblando, la pantalla de error y, a los 3,5 s,
  // de vuelta al escritorio
  useEffect(() => {
    if (screen !== 'crash') return;
    const id = setTimeout(() => quitRef.current(), 4400);
    return () => clearTimeout(id);
  }, [screen]);

  // el puntero, siempre dentro del clic (fuera de un gesto el navegador lo niega); sin pantalla completa automática
  const enter = useCallback(() => {
    game.current?.input.lock();
  }, []);

  const resume = useCallback(() => {
    enter();
    game.current!.resume();
    setScreen('play');
  }, [enter]);

  const start = useCallback(() => {
    if (started.current) return; // un clic en Play mientras Options lleva el cursor
    started.current = true;
    if (cursor.current) cursor.current.style.display = 'none';
    // desarrollo: &seed=N fija el laberinto
    const fixed = DEV_LOCAL ? Number(new URLSearchParams(location.search).get('seed')) : 0;
    game.current!.myLook = acct.me ? cleanLook(acct.me.loadout) : guestLook();
    game.current!.start(fixed || (Math.random() * 2 ** 31) | 0);
    setScreen('play');
  }, []);

  // PLAY lleva a las salas; en desarrollo, con &seed=N sigue yendo directo a una partida en solitario
  const playClick = useCallback(() => {
    if (DEV_LOCAL && new URLSearchParams(location.search).get('seed')) return (enter(), start());
    setNotice('');
    setMp(true);
    setScreen('lobby');
  }, [enter, start]);

  // ── el multijugador ──────────────────────────────────────────────────────

  // el final de una partida de sala: se para el juego y sale la pantalla de siempre; INSERT TAPE vuelve al lobby de la sala
  endRef.current = (r: RoundResult) => {
    game.current?.stop();
    setChat(false);
    setWon(r.won);
    setResult(r);
    setScreen('over');
  };

  // salir de la partida (la pausa, EXIT): directo a la pantalla de título
  const leaveMp = useCallback(() => {
    net.sock?.emit('leave');
    game.current?.stop();
    started.current = false;
    setMp(false);
    setChat(false);
    setScreen('menu');
  }, [net.sock]);

  // con sala (al entrar o al volver de la partida): la sala de espera 3D; sin ella, la lista
  const inWait = screen === 'wait' || screen === 'waitpause';
  const loadingRoom = useHold(inWait && !waitReady, 2400); // la carga de la sala, que dure lo bastante para verse
  useEffect(() => {
    if (screen === 'lobby' && net.room) setScreen('wait');
    else if (inWait && !net.room) setScreen('lobby');
  }, [screen, inWait, net.room]);

  // un logro concedido por el servidor: aviso en pantalla y la cuenta se vuelve a leer (progreso, cosméticos nuevos)
  useEffect(() => {
    const s = net.sock;
    if (!s) return;
    let n = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const on = (key: string) => {
      const id = Date.now() + n++;
      setToasts((t) => [...t.slice(-2), { id, key }]);
      const tm = setTimeout(() => (timers.delete(tm), setToasts((t) => t.filter((x) => x.id !== id))), 5000);
      timers.add(tm);
      void acct.refresh();
    };
    s.on('achievement', on);
    return () => {
      s.off('achievement', on);
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.sock]);

  // el servidor da la partida por acabada
  useEffect(() => {
    const s = net.sock;
    if (!s) return;
    const on = (r: RoundResult) => {
      if (screenRef.current !== 'play' && screenRef.current !== 'pause') return;
      endRef.current(r);
    };
    s.on('over', on);
    return () => void s.off('over', on);
  }, [net.sock]);

  // se cae la conexión a media partida
  useEffect(() => {
    if (net.link !== 'offline' || !['play', 'pause', 'wait', 'waitpause'].includes(screenRef.current)) return;
    game.current?.stop();
    setChat(false);
    setNotice('CONNECTION LOST');
    setScreen('lobby');
  }, [net.link]);

  const enterMatch = useCallback(() => {
    const room = roomRef.current, sock = net.sock;
    if (!room || !sock) return;
    enter();
    game.current!.myLook = acct.me ? cleanLook(acct.me.loadout) : guestLook();
    game.current!.start(room.seed, { sock, id: sock.id!, life: DIFFICULTY[room.difficulty].life, players: room.players.length, index: Math.max(0, room.players.findIndex((p) => p.id === sock.id)), inv: invRef.current ?? undefined, mission: room.mission, level: room.levelId, floor: room.floor, caps: room.caps });
    setNotice('');
    setComputer(false);
    setScreen('play');
  }, [net.sock, enter]);
  const enterRef = useRef(enterMatch);
  enterRef.current = enterMatch;

  // montar la sala de espera mientras se está en ella; al salir (sin ir a la partida) se para el juego
  useEffect(() => {
    const g = game.current, sock = net.sock, room = roomRef.current;
    if (!inWait || !g || !sock || !room) return;
    let alive = true;
    g.onWaitComputer = setComputer;
    g.onWaitBoard = setBoard;
    g.onWaitBag = setWaitBag;
    g.enterWaiting({ sock, id: sock.id! }, room)
      .then((ok) => alive && ok && setWaitReady(true))
      .catch((e) => {
        console.error('waiting room failed', e);
        if (!alive) return;
        sock.emit('leave');
        net.setRoom(null);
        setNotice('COULD NOT ENTER THE ROOM');
      });
    return () => {
      alive = false;
      g.onWaitComputer = undefined;
      g.onWaitBoard = undefined;
      g.onWaitBag = undefined;
      g.closeWaitBag();
      setWaitReady(false);
      setComputer(false);
      setBoard(false);
      if (screenRef.current !== 'play') g.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWait, net.sock]);

  // invitado: al entrar en una sala dice qué color gratis lleva (con cuenta, el servidor ya sabe el aspecto)
  const roomCode = net.room?.code;
  useEffect(() => {
    if (roomCode && net.sock && acct.status !== 'user') net.sock.emit('look', guestLook().color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, net.sock]);

  // el aspecto de los jugadores de la sala (también durante la partida)
  useEffect(() => {
    if (net.room) game.current?.setLooks(net.room);
  }, [net.room]);

  // lo que dice la sala (ajustes, propietario, el botón pulsado): la sala de espera lo sigue
  const phase = net.room?.phase;
  useEffect(() => {
    if (!inWait || !net.room) return;
    game.current?.waitRoom(net.room, net.inv);
    if (phase !== 'lobby') {
      game.current?.closeWaitBag();
      setChat(false);
      setComputer(false);
      setBoard(false);
      if (screenRef.current === 'waitpause') setScreen('wait');
    }
  }, [inWait, net.room, net.inv, phase, waitReady]);

  // el admin corta la ronda (vuelve el lobby sin pasar por «over»): de la partida a la sala de espera
  useEffect(() => {
    if (phase !== 'lobby' || !mpRef.current || (screenRef.current !== 'play' && screenRef.current !== 'pause')) return;
    game.current?.stop();
    setChat(false);
    setScreen('wait');
  }, [phase]);

  // empieza la partida: se espera a que la entrada por la puerta termine y se arranca
  useEffect(() => {
    if (!inWait || phase !== 'playing') return;
    let alive = true;
    game.current!.waitDone().then(() => alive && enterRef.current());
    return () => void (alive = false);
  }, [inWait, phase]);

  // la entrada por la puerta ha acabado (fase `starting`): empieza la votación de la misión y, mientras, se prepara el nivel y se avisa con `ready`
  const [doorDone, setDoorDone] = useState(false);
  const voting = phase === 'starting' && !!net.room?.vote;
  useEffect(() => {
    if (!inWait || phase !== 'starting') return void setDoorDone(false);
    let alive = true;
    game.current!.waitDone().then(() => alive && setDoorDone(true));
    return () => void (alive = false);
  }, [inWait, phase]);
  useEffect(() => {
    const room = roomRef.current, sock = net.sock;
    if (!doorDone || !voting || !room || !sock) return;
    const input = game.current!.input;
    input.suspend = input.noLock = true; // el cursor, para votar: suelto, y nada lo vuelve a capturar hasta que acabe
    input.unlock();
    let alive = true;
    const done = () => alive && sock.emit('ready', true);
    game.current!.warmLevel(room.seed, room.players.length, room.levelId, room.floor).then(done, done);
    return () => void ((alive = false), (input.suspend = input.noLock = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorDone, voting, net.sock]);

  useEffect(() => {
    if (!inWait) return;
    const id = setInterval(() => setWh(game.current?.waitHud ?? NO_WAIT), 100);
    return () => clearInterval(id);
  }, [inWait]);

  const resumeWait = useCallback(() => {
    game.current!.resume();
    setScreen('wait');
  }, []);
  // para el atajo de Esc, que se registra antes de que existan estas funciones
  const resumeRef = useRef(resume), resumeWaitRef = useRef(resumeWait);
  resumeRef.current = resume;
  resumeWaitRef.current = resumeWait;
  // salir de la sala: sin sala, el efecto de arriba vuelve a la lista y para el juego
  const leaveRoom = useCallback(() => {
    net.sock?.emit('leave');
    net.setRoom(null);
  }, [net]);

  // Intro abre el chat en la partida y en la sala de espera (y suelta el puntero para escribir)
  useEffect(() => {
    if ((screen !== 'play' && screen !== 'wait') || !mp) return;
    const key = (e: KeyboardEvent) => {
      if ((e.code !== 'Enter' && e.code !== 'NumpadEnter') || chatRef.current || game.current?.bagOpen) return;
      if (screen === 'wait' && (!game.current?.waitHud.free || (e.target as HTMLElement | null)?.tagName === 'INPUT')) return;
      e.preventDefault();
      game.current?.openChat();
      setChat(true);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [screen, mp]);
  const closeChat = useCallback(() => {
    setChat(false);
    game.current?.closeChat();
  }, []);

  // el sonido, en el menú y en la pausa
  const toggleSound = useCallback(() => {
    const m = !game.current!.muted;
    game.current!.setMuted(m);
    setMuted(m);
    try {
      localStorage.setItem('br-muted', m ? '1' : '0');
    } catch {}
  }, []);

  const openAuth = (m: AuthMode) => {
    acct.clearExpired();
    setAuthMode(m);
  };
  // de vuelta de Discord: /?discord=ok|linked|fail|taken|off. Se limpia la URL; si falló, se abre el acceso con el motivo
  useEffect(() => {
    const d = new URLSearchParams(location.search).get('discord');
    if (!d) return;
    history.replaceState(null, '', location.pathname);
    if (d === 'ok' || d === 'linked') return void acct.refresh();
    try {
      sessionStorage.setItem('br-dc', d);
    } catch {}
    setAuthMode('signin');
  }, []);

  // Quit se descuelga: gira sobre su esquina de arriba a la izquierda, se suelta y cae
  const drop = () => {
    const b = quit.current!;
    if (b.dataset.falling) return;
    b.dataset.falling = '1';
    const fall = innerHeight - b.getBoundingClientRect().top + 80;
    const tl = gsap.timeline({ onComplete: () => setQuitGone(true) });
    if (reduced.current) tl.to(b, { y: fall, duration: 0.7, ease: 'power2.in' });
    else
      tl.set(b, { transformOrigin: '0% 0%' })
        .to(b, { rotation: 38, duration: 0.5, ease: 'back.out(3)' })
        .to(b, { rotation: 24, duration: 0.25, ease: 'sine.inOut' })
        .to(b, { y: fall, rotation: 70, x: 30, duration: 0.8, ease: 'power2.in' });
  };

  return (
    <div ref={root} className="br" data-screen={screen}>
      {(screen === 'menu' || screen === 'settings' || screen === 'achv' || (screen === 'lobby' && !net.room)) && <Static still={reduced.current} scenes={game.current?.stills ?? []} />}
      <div ref={gl} className="br-stage" />
      {lvl != null && screen !== 'load' && <BootLoading over title="POOLROOMS" label="BUILDING THE LEVEL" progress={lvl} />}
      {screen === 'load' && <BootLoading title="BACKROOMS" label={LOAD_PHASES[loadP.phase].label} progress={loadP.f} error={failed ? 'FAILED TO LOAD' : undefined} />}
      {screen === 'menu' && (
        <nav className="br-menu" aria-label="Backrooms">
          <p className="br-menu__ch">CH 03</p>
          <h1 className="br-menu__title">BACKROOMS</h1>
          <p className="br-menu__sub">LEVEL 0 &nbsp; SP &nbsp; 1994</p>
          <ServerNotice server={server} />
          {acct.expired && (
            <p className="br-notice" role="alert" data-bad>
              ● SESSION EXPIRED · SIGN IN AGAIN
            </p>
          )}
          <ul>
            <li>
              <button type="button" className="br-opt" onClick={playClick} autoFocus>
                PLAY
              </button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => setScreen('achv')}>
                ACHIEVEMENTS
              </button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => setScreen('settings')}>
                SETTINGS
              </button>
            </li>
            {!quitGone && (
              <li>
                <button ref={quit} type="button" className="br-opt" onClick={drop}>
                  EXIT
                </button>
              </li>
            )}
          </ul>
          <AccountBox acct={acct} onClick={() => setAcctOpen(true)} />
        </nav>
      )}
      {screen === 'achv' && <AchievementsScreen acct={acct} onSignIn={() => openAuth('signin')} onBack={() => setScreen('menu')} />}
      {screen === 'settings' && <SettingsPane muted={muted} toggleSound={toggleSound} onBack={() => setScreen('menu')} />}
      {wheel && <EmoteWheel have={haveAch} onPick={pickEmote} />}
      {locker && (
        <LockerGame
          id={locker}
          sock={net.sock}
          assets={game.current?.assets}
          onTake={(it) => it.kind !== 'loot' && game.current?.player?.receive(it.kind)}
          onClose={() => (setLocker(null), game.current?.setLockerUi(false))}
        />
      )}
      {net.room && (screen === 'wait' || screen === 'waitpause' || screen === 'play' || screen === 'pause') && <VoiceHud room={net.room} me={net.me} />}
      {screen === 'lobby' && !net.room && (
        <Frame title="ROOMS" onBack={() => (setMp(false), setScreen('menu'))}>
          <Lobby net={net} error={notice} server={server} account={acct.me?.username} onSolo={() => (enter(), start())} />
        </Frame>
      )}
      {acctOpen && !authMode && (
        <div className="br-modal">
          <AccountMenu acct={acct} onAuth={(m) => (setAcctOpen(false), openAuth(m))} onClose={() => setAcctOpen(false)} />
        </div>
      )}
      {welcome && !authMode && (
        <div className="br-modal">
          <div className="br-dialog br-dialog--acct" role="dialog" aria-modal="true" aria-labelledby="br-wel-t">
            <p className="br-lobby__head" id="br-wel-t">SAVE YOUR PROGRESS</p>
            <p>YOU ARE PLAYING AS A GUEST. SIGN IN OR REGISTER TO KEEP YOUR ACHIEVEMENTS, STATS AND LOOK.</p>
            <ul className="br-lobby__opts">
              <li>
                <DiscordButton />
              </li>
              <li>
                <button type="button" className="br-opt" autoFocus onClick={() => (setWelcome(false), openAuth('signin'))}>SIGN IN / REGISTER</button>
              </li>
              <li>
                <button type="button" className="br-opt" onClick={() => setWelcome(false)}>LATER</button>
              </li>
            </ul>
            <p className="br-lobby__dim br-lobby__keys">ESC LATER</p>
          </div>
        </div>
      )}
      {authMode && (
        <div className="br-modal">
          <AuthScreen acct={acct} mode={authMode} onClose={() => setAuthMode(null)} />
        </div>
      )}
      <Toasts items={toasts} />
      {loadingRoom && <Static still={reduced.current} scenes={game.current?.stills ?? []} />}
      {loadingRoom && (
        <Loading
          title={net.room ? `TAPE ${String(net.room.tape).padStart(3, '0')}` : 'ENTERING'}
          steps={[
            { label: 'SERVER LINK', done: net.link === 'online' },
            { label: 'ROOM JOINED', done: !!net.room },
            { label: 'LOADING THE ROOM', done: waitReady },
          ]}
        />
      )}

      {screen === 'wait' && waitReady && !loadingRoom && net.room && (
        <>
          {!board && phase !== 'starting' && <WaitPanel room={net.room} me={net.me} sock={net.sock} />}
          <ServerNotice server={server} />
          {!wh.computer && !wh.board && !waitBag && !wh.entering && (
            <p className="br-hint" data-bad={wh.notice ? '' : undefined}>
              {wh.notice
                ? wh.notice
                : wh.label
                  ? `[${touch ? 'BAG' : 'E'}] ${wh.label}`
                  : !touch && !wh.locked && wh.free
                    ? 'CLICK TO TAKE CONTROL'
                    : ''}
            </p>
          )}
          {!touch && !chat && !wh.computer && !wh.board && !wh.entering && <p className="br-wait__keys br-lobby__dim">WASD MOVE · SHIFT RUN · SPACE JUMP · C CROUCH · E USE/BAG · G PICK UP · Y DROP · R READY · 1-4 ITEMS · HOLD B EMOTES · V VOICE · ENTER CHAT · ESC PAUSE</p>}
          {!waitBag && !wh.computer && !wh.board && !wh.entering && game.current?.player && game.current.assets && (
            <Hotbar inv={game.current.hud.inv} assets={game.current.assets} onUse={(i) => { const pl = game.current?.player; if (pl) (pl.hotSel = i), pl.useHot(i); }} />
          )}
        </>
      )}
      {screen === 'wait' && computer && net.room && <Computer room={net.room} me={net.me} sock={net.sock} hazmat={game.current?.assets?.gltf.hazmat} assets={game.current?.assets} inv={net.inv} reduced={reduced.current} acct={acct} onClose={() => game.current?.closeComputer()} />}
      {screen === 'wait' && waitBag && net.inv && game.current?.assets && (
        <Inventory
          open
          inv={game.current.player ? game.current.hud.inv : waitInv(net.inv)}
          assets={game.current.assets}
          look={net.room?.players.find((p) => p.id === net.me)?.look}
          reduced={reduced.current}
          onPlace={(s, g) => game.current?.player?.place(s, g)}
          onLight={() => game.current?.player?.toggleLight()}
          bag={bag}
          onHot={(i, id) => game.current?.player?.assign(i, id)}
          onUse={(id) => {
            const p = game.current?.player;
            if (p && HOT[id]?.have(p.own)) HOT[id].use(p);
          }}
          onDrop={(id, i) => (id === 'loot' ? game.current?.dropLoot(i ?? 0) : game.current?.dropItem(id as ItemId))}
          onClose={() => game.current?.closeWaitBag()}
        />
      )}
      {screen === 'wait' && board && net.room?.phase === 'lobby' && <BoardHint onClose={() => game.current?.closeComputer()} />}
      {screen === 'wait' && doorDone && net.room?.phase === 'starting' && net.room.vote && <Board room={net.room} me={net.me} sock={net.sock} />}
      {screen === 'wait' && touch && game.current && !computer && !wh.entering && <Touch input={game.current.input} hand="none" aiming={false} />}
      {screen === 'waitpause' && (
        <div className="br-pause" role="dialog" aria-labelledby="br-pause-t">
          <p className="br-pause__head" id="br-pause-t">
            PAUSE <span aria-hidden="true">❚❚</span>
          </p>
          <ul>
            <li>
              <button type="button" className="br-opt" onClick={resumeWait} autoFocus>
                RESUME
              </button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => setPauseSettings(true)}>
                SETTINGS
              </button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={leaveRoom}>
                LEAVE ROOM
              </button>
            </li>
          </ul>
        </div>
      )}
      {screen === 'over' && <End win={won} result={result} me={net.me} onInsert={() => setScreen('lobby')} />}
      {(screen === 'play' || screen === 'pause') && hud?.aiming && <Osd hud={hud} />}
      {screen === 'play' && hud?.scoped && !hud.bag && <div className="br-scope" aria-hidden="true" />}
      {screen === 'play' && hud?.spectating != null && (
        <div className="br-spectate" role="status">
          <p className="br-spectate__rec">
            <span aria-hidden="true">●</span> SPECTATING · {hud.specView === 'chase' ? 'CHASE CAM' : hud.specView === 'free' ? 'FREE CAM' : 'POV'}
          </p>
          <ul className="br-spectate__list">
            {hud.watchList?.map((w, i) => (
              <li key={w.name + i} data-on={w.on || undefined} data-dead={w.dead || undefined}>
                CH{i + 2} {w.name.toUpperCase()}
                {w.dead && ' · OUT'}
              </li>
            ))}
            {!hud.watchList?.some((w) => !w.dead) && <li data-dead>NO SIGNAL</li>}
          </ul>
          <p className="br-spectate__keys">← → SWITCH · V VIEW · C FREE CAM{hud.specView === 'free' ? ' · WASD FLY · SHIFT FAST' : ''}</p>
        </div>
      )}
      {acct.me?.admin && (screen === 'play' || screen === 'wait') && <AdminConsole game={game} sock={net.sock} room={net.room} me={net.me} />}
      {(screen === 'play' || screen === 'wait') && mp && net.sock && (
        <div className="br-chatbox">
          <ChatLog msgs={msgs} fade={!chat} max={6} />
          {chat && <ChatInput sock={net.sock} onClose={closeChat} />}
        </div>
      )}
      {screen === 'play' && hud && !hud.aiming && !hud.bag && hud.spectating == null && !hud.totem.run && <Mission hud={hud} room={net.room} />}
      {screen === 'play' && hud && !hud.aiming && !hud.bag && (
        <Team
          me={net.room ? net.me : 'me'}
          mates={
            net.room
              ? net.room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, dead: p.dead, hp: p.id === net.me ? hud.hp : hud.hps[p.id] ?? 100 }))
              : [{ id: 'me', name: acct.me?.username ?? 'YOU', avatar: acct.me?.avatar ?? '', dead: hud.hp <= 0, hp: hud.hp }]
          }
        />
      )}
      {screen === 'play' && hud && !hud.bag && !hud.aiming && hud.spectating == null && game.current?.assets && (
        <Hotbar
          inv={hud.inv}
          assets={game.current.assets}
          onUse={(i) => {
            const pl = game.current?.player;
            if (!pl || game.current?.inPool) return void game.current?.poolHot(i);
            pl.hotSel = i;
            pl.useHot(i);
          }}
        />
      )}
      {screen === 'play' && hud && (
        <TotemUi hud={hud} touch={touch} avatars={Object.fromEntries((net.room?.players ?? []).map((p) => [p.id, p.avatar]))} onPick={(id) => game.current?.useTotem(id)} onClose={() => game.current?.closeTotem()} />
      )}
      {screen === 'play' && hud?.note && !hud.bag && <p className="br-click">{hud.note}</p>}
      {screen === 'play' && hud?.needClick && !hud.bag && <p className="br-click">CLICK TO CONTINUE</p>}
      {screen === 'play' && hud?.hint && !hud.bag && !hud.aiming && hud.spectating == null && (
        <p className="br-hint">
          [{touch ? 'GRAB' : 'G'}] PICK UP {hud.hint.toUpperCase()}
        </p>
      )}
      {screen === 'play' && hud?.act && !hud.bag && !hud.aiming && hud.spectating == null && (
        <p className="br-hint">
          [{touch ? 'GRAB' : 'G'}] {hud.act}
        </p>
      )}
      {screen === 'play' && hud?.hide && !hud.bag && !hud.aiming && hud.spectating == null && (
        <p className="br-hint">
          [{touch ? 'BAG' : 'E'}] {hud.hide === 'hide' ? 'HIDE' : 'LEAVE'}
        </p>
      )}
      {screen === 'play' && hud && hud.drink > 0 && !hud.bag && hud.spectating == null && (
        <div className="br-drink" role="status" aria-label={`Drinking ${Math.round(hud.drink * 100)}%`}>
          <p>ALMOND WATER</p>
          <div className="br-breath__bar">
            <i style={{ width: `${Math.round(hud.drink * 100)}%` }} />
          </div>
        </div>
      )}
      {screen === 'play' && hud && hud.refill > 0 && !hud.bag && hud.spectating == null && (
        <div className="br-drink" role="status" aria-label={`Refilling ${Math.round(hud.refill * 100)}%`}>
          <p>REFILLING WATER GUN</p>
          <div className="br-breath__bar">
            <i style={{ width: `${Math.round(hud.refill * 100)}%` }} />
          </div>
        </div>
      )}
      {screen === 'play' && hud?.breath && !hud.bag && hud.spectating == null && (
        <div className="br-breath" data-warn={hud.breath.warn || undefined} role="status">
          <p className="br-breath__t">{hud.breath.warn ? 'HOLD [SPACE]' : hud.breath.held ? 'HOLDING BREATH' : 'HIDING'}</p>
          <div className="br-breath__bar">
            <i style={{ width: `${Math.round(hud.breath.air * 100)}%` }} />
          </div>
        </div>
      )}
      {screen === 'play' && hud?.shop && net.room && game.current?.assets && (
        <ShopGrid seed={net.room.seed} floor={net.room.floor} open={levelsOpen(net.room.players.map((p) => p.ups))} bank={net.room.bank} inv={game.current.player?.inventory ?? null} sock={net.sock} assets={game.current.assets} onBought={(id) => game.current?.buyHere(id)} />
      )}
      {screen === 'play' && hud && game.current?.assets && (
        <Inventory
          open={!!hud.bag && !hud.shop}
          inv={hud.inv}
          assets={game.current.assets!}
          look={net.room?.players.find((p) => p.id === net.me)?.look}
          reduced={reduced.current}
          onPlace={(s, g) => game.current!.player?.place(s, g)}
          onLight={() => game.current!.player?.toggleLight()}
          bag={bag}
          onHot={(i, id) => game.current!.player?.assign(i, id)}
          onUse={(id) => {
            const p = game.current!.player;
            if (p && HOT[id]?.have(p.own)) HOT[id].use(p);
          }}
          onDrop={(id, i) => (id === 'loot' ? game.current!.dropLoot(i ?? 0) : game.current!.dropItem(id as ItemId))}
          onTank={(on) => game.current!.setTank(on)}
          onClose={() => game.current!.closeBag()}
        />
      )}
      {screen === 'play' && touch && game.current && !hud?.bag && <Touch input={game.current.input} hand={hand} aiming={!!hud?.aiming} />}
      {screen === 'pause' && (
        <div className="br-pause" role="dialog" aria-labelledby="br-pause-t">
          <p className="br-pause__head" id="br-pause-t">
            PAUSE <span aria-hidden="true">❚❚</span>
          </p>
          <ul>
            <li>
              <button type="button" className="br-opt" onClick={resume} autoFocus>
                RESUME
              </button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => setPauseSettings(true)}>
                SETTINGS
              </button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={leaveMp}>
                EXIT
              </button>
            </li>
          </ul>
        </div>
      )}
      {pauseSettings && (screen === 'pause' || screen === 'waitpause') && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0b0b0a' }}>
          <SettingsPane muted={muted} toggleSound={toggleSound} onBack={() => setPauseSettings(false)} />
        </div>
      )}
      {screen === 'crash' && (
        <div className="br-crash" role="alert">
          <p className="br-crash__head">RECORDING CORRUPTED</p>
          <p>TAPE ERROR 0x{crashCode}</p>
          <p>head 2 lost tracking at frame {crashFrame}</p>
          <p className="br-crash__dim">the tape was eaten.</p>
        </div>
      )}
      {showCross && ((screen === 'play' && hud && !hud.aiming && !hud.scoped && !hud.bag && hud.spectating == null && hud.hide !== 'leave') || (screen === 'wait' && waitReady && !wh.computer && !wh.entering)) && <Crosshair fixed />}
      {showFps && <Fps />}
      <canvas ref={cursor} className="br-cursor" aria-hidden="true" />
    </div>
  );
}
