import { useEffect, useState, type ReactNode } from 'react';
import Frame from './Frame';
import { Crosshair } from './Crosshair';
import { benchState, lastBench, startBench } from '../bench';
import { DEFAULTS, FPS_CAPS, PRESETS, applyPreset, presetOf, setSetting, useSettings, type Settings } from '../settings';
import { Circle } from 'lucide-react';
import { ic } from './ic';
import StoragePane from './Storage';
import { voice, voiceMic } from '../voice';
import { E2ee, FX_PRESETS } from '@phoenyx/voice';

/*
 * SETTINGS: una pestaña por bloque (audio, controles, imagen, accesibilidad) a todo el ancho y en dos columnas: a la izquierda
 * la lista de ajustes (nombre, una línea de qué hace y el control: barra larga con su valor o un interruptor) y a la derecha
 * el panel del ajuste elegido (por el ratón o el foco) con su descripción y una vista previa. Se guardan solos (localStorage,
 * ver settings.ts); RESET devuelve el bloque —o todo— a lo de fábrica.
 */

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

interface Row {
  id: string;
  label: string;
  desc: string; // una línea, bajo el nombre
  long: string; // el panel de la derecha
  num?: { k: NumKey; min: number; max: number; step: number; unit: string; scale: number; labels?: string[]; drop?: true };
  flag?: BoolKey | 'mute' | 'fullscreen';
  act?: 'bench'; // un botón en vez de un ajuste
  preset?: true; // la barra de perfiles: no es un ajuste, fija los demás (ver PRESETS)
}

// los ajustes de varios pasos: nombre y qué hace cada uno (el número guardado es la posición); el juego lee el número
const CHOICES: Record<'quality' | 'shadows' | 'texFilter' | 'fpsLimit' | 'warmup' | 'drawDist' | 'lights', readonly (readonly [string, string])[]> = {
  quality: [['AUTO', 'LOW ON PHONES AND TABLETS'], ['LOW', 'NO SHADOWS, NO GLOW, 60% RESOLUTION'], ['HIGH', 'EVERYTHING ON']],
  shadows: [['OFF', 'NO SHADOWS AT ALL'], ['LOW', 'SMALL, SOFTER SHADOW MAPS'], ['HIGH', 'FULL LOOK']],
  texFilter: [['OFF', 'FASTEST, BLURRIER AT A SLANT'], ['2X', ''], ['4X', ''], ['8X', 'SHARPEST AT A SLANT']],
  fpsLimit: [['30', 'HALF THE WORK, COOLER LAPTOP'], ['45', ''], ['60', ''], ['OFF', 'AS FAST AS THE SCREEN ALLOWS']],
  drawDist: [['SHORT', 'FOG CLOSES IN, FASTEST'], ['NORMAL', 'NOTHING BEHIND THE FOG'], ['FAR', 'DRAWS EVERYTHING']],
  lights: [['NONE', 'FLATTEST, FASTEST'], ['2', 'TWO LIGHTS AROUND YOU'], ['4', 'FOUR LIGHTS, FULL GLOW']],
  warmup: [['LAZY', 'NOTHING UP FRONT'], ['QUICK', 'ONLY WHAT YOU SEE'], ['FULL', 'EVERYTHING BEFORE YOU PLAY']],
};
const lab = (k: keyof typeof CHOICES) => CHOICES[k].map((c) => c[0]);

const pct = (k: NumKey): Row['num'] => ({ k, min: 0, max: 1, step: 0.05, unit: '%', scale: 100 });

const SECTIONS = {
  AUDIO: [
    { id: 'mute', label: 'MUTE', desc: 'All sound off', long: 'Silences the whole game. The volumes below stay where you left them.', flag: 'mute' },
    { id: 'volume', label: 'MASTER VOLUME', desc: 'Everything you hear', long: 'The overall level of the game, menu included.', num: pct('volume') },
    { id: 'sfx', label: 'EFFECTS', desc: 'Footsteps, shots, entities', long: 'Sounds that happen at a moment: footsteps, the camera, the rifle, whatever is hunting you. Lowering it makes the Backrooms quieter, not safer.', num: pct('sfx') },
    { id: 'voiceMode', label: 'VOICE CHAT', desc: 'Talk to your room', long: 'Hear and talk to the other players in your room. PUSH TO TALK: hold V. OPEN MIC: always transmitting (the browser asks for the microphone). Voices go straight between players.', num: { k: 'voiceMode', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: ['OFF', 'PUSH TO TALK [V]', 'OPEN MIC'] } },
    { id: 'voiceVol', label: 'VOICE VOLUME', desc: 'How loud your mates are', long: 'The level of the other players voices. Above 100% they are boosted (with a limiter so they do not distort).', num: { k: 'voiceVol', min: 0, max: 3, step: 0.05, unit: '%', scale: 100 } },
    { id: 'voiceLock', label: 'ENCRYPTED VOICE', desc: 'Only your room can listen', long: 'Encrypts the voice from your microphone to the other players, so nobody in between (not even the server) can listen. ON: encrypts with everyone who can and talks in the clear with the rest. STRICT: you only talk to and hear players whose voice is encrypted. Hover ENCRYPTED in the room to see a security code per player: if you both read the same number, nobody is listening in the middle. Takes effect when you enter a room.', num: { k: 'voiceLock', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: ['OFF', 'ON', 'STRICT'] } },
    { id: 'voice3d', label: 'VOICE 3D', desc: 'Voices placed in the space', long: 'How the other players voices sound in the world. FLAT: everyone the same, centred. LOW: quieter with distance and panned left or right. MEDIUM: also real 3D positioning (headphones help) and echo. HIGH: walls muffle and quiet voices and the echo follows the size of the room you are in.', num: { k: 'voice3d', min: 0, max: 3, step: 1, unit: '', scale: 1, labels: ['FLAT', 'LOW', 'MEDIUM', 'HIGH'] } },
    { id: 'micDev', label: 'MICROPHONE', desc: 'Which one you talk into', long: 'Choose the microphone here, in the game, instead of in the browser. The browser asks for permission once (ALLOW below); after that everything is set here. The list shows after you allow it.', num: { k: 'micDev', min: 0, max: 0, step: 1, unit: '', scale: 1, labels: ['DEFAULT'], drop: true } },
    { id: 'micGain', label: 'MIC GAIN', desc: 'How strong your voice goes out', long: 'Boosts or lowers what your microphone picks up before it is sent. Watch the meter while you talk: it should reach about three quarters on a normal sentence.', num: { k: 'micGain', min: 0, max: 3, step: 0.05, unit: '%', scale: 100 } },
    { id: 'micGate', label: 'NOISE GATE', desc: 'Cuts the room noise when you are quiet', long: 'The microphone only opens when your voice passes this level, so keyboard, fans and breathing do not go out. 0 is off. Set it just above the meter while you stay silent.', num: { k: 'micGate', min: 0, max: 0.15, step: 0.005, unit: '%', scale: 667 } },
    { id: 'micFx', label: 'VOICE EFFECT', desc: 'Change how you sound', long: 'The others hear your voice with this effect. DEEP and DEMON lower it, CHIPMUNK raises it, ROBOT and RADIO colour it. Use TEST and HEAR YOURSELF to try them.', num: { k: 'micFx', min: 0, max: FX_PRESETS.length - 1, step: 1, unit: '', scale: 1, labels: FX_PRESETS.map((n) => n.toUpperCase()) } },
    { id: 'ambient', label: 'AMBIENT', desc: 'Lights, vents, tape hiss', long: 'The constant bed: the fluorescent hum, the ventilation and the hiss of the tape.', num: pct('ambient') },
  ],
  CONTROLS: [
    { id: 'sens', label: 'MOUSE SENSITIVITY', desc: 'How far the view turns', long: 'Multiplier on how far the view turns for each pixel the mouse moves.', num: { k: 'sens', min: 0.2, max: 3, step: 0.1, unit: 'x', scale: 1 } },
    { id: 'invertY', label: 'INVERT Y', desc: 'Mouse up looks down', long: 'Flips the vertical look: pushing the mouse forward looks down, like a flight stick.', flag: 'invertY' },
  ],
  VIDEO: [
    { id: 'preset', label: 'PRESET', desc: 'One switch for the graphics', long: 'Sets every graphics option at once, from POTATO (anything to make it run) to HIGH, including the overall profile that drops shadows and glow on weak machines. Touch one by hand and it reads CUSTOM.', preset: true },
    { id: 'bench', label: 'BENCHMARK', desc: 'Find the best settings for this computer', long: 'Plays a short fixed route on a real level with each preset, from HIGH down, and keeps the first one that runs smoothly (about 55 fps or more). The page reloads for each test, so it takes about a minute. ESC cancels and brings your settings back.', act: 'bench' },
    { id: 'fullscreen', label: 'FULLSCREEN', desc: 'Fill the whole screen', long: 'Esc leaves fullscreen and pauses the game.', flag: 'fullscreen' },
    { id: 'brightness', label: 'BRIGHTNESS', desc: 'Lift or darken the picture', long: 'The Backrooms are meant to be dim: raise it only if you cannot see.', num: { k: 'brightness', min: 0.6, max: 1.6, step: 0.05, unit: '%', scale: 100 } },
    { id: 'ui', label: 'UI SIZE', desc: 'Size of menus and HUD', long: 'Scales the whole interface, independent of the browser zoom.', num: { k: 'ui', min: 0.7, max: 1.5, step: 0.05, unit: '%', scale: 100 } },
    { id: 'fov', label: 'FIELD OF VIEW', desc: 'How much you see', long: 'Wider shows more of the room and bends the edges.', num: { k: 'fov', min: 60, max: 110, step: 5, unit: '°', scale: 1 } },
    { id: 'vhs', label: 'VHS EFFECT', desc: 'Tape noise, bleed and tracking', long: 'How much tape shows in the picture. A corrupted tape always shows.', num: pct('vhs') },
    { id: 'crosshair', label: 'CROSSHAIR', desc: 'A dot at the centre', long: 'Shows where you are looking. It hides when you aim.', flag: 'crosshair' },
    { id: 'fps', label: 'SHOW FPS', desc: 'A frame counter, top right', long: 'Frames per second, on every screen.', flag: 'fps' },
    { id: 'resScale', label: 'RESOLUTION SCALE', desc: 'Lower is faster', long: 'Fewer pixels, softer picture, more frames. The best single fix for a weak graphics card.', num: { k: 'resScale', min: 0.35, max: 1, step: 0.05, unit: '%', scale: 100 } },
    { id: 'fpsLimit', label: 'FPS LIMIT', desc: 'Cap the frame rate', long: 'A lower cap keeps a slow computer steady and a laptop cool.', num: { k: 'fpsLimit', min: 0, max: 3, step: 1, unit: '', scale: 1, labels: lab('fpsLimit') } },
    { id: 'shadows', label: 'SHADOWS', desc: 'Flashlight and sun shadows', long: 'OFF is the biggest saving on a slow graphics card.', num: { k: 'shadows', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('shadows') } },
    { id: 'bloom', label: 'LIGHT GLOW', desc: 'Halo around bright lights', long: 'The soft halo around the fluorescent panels.', flag: 'bloom' },
    { id: 'texFilter', label: 'TEXTURE FILTERING', desc: 'Sharpness at a slant', long: 'Keeps floors and walls sharp far away. Costs little.', num: { k: 'texFilter', min: 0, max: 3, step: 1, unit: '', scale: 1, labels: lab('texFilter') } },
    { id: 'autoRes', label: 'AUTO RESOLUTION', desc: 'Drops pixels when it lags', long: 'Watches the frame rate and lowers the picture resolution by itself, down to 35%, when the computer cannot keep up. If it still crawls it also turns off glow, dust, shadows and extra lights. Turn it off to keep a fixed RESOLUTION SCALE.', flag: 'autoRes' },
    { id: 'drawDist', label: 'DRAW DISTANCE', desc: 'How far the world is drawn', long: 'SHORT closes the fog in and skips everything far away: a big gain on weak machines. NORMAL skips only what the fog already hides.', num: { k: 'drawDist', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('drawDist') } },
    { id: 'lights', label: 'EXTRA LIGHTS', desc: 'Lights that glow on the surfaces', long: 'Real lights that follow you and shine on the quartz and the walls. Every one costs on every surface: NONE is a big saving on a slow graphics card.', num: { k: 'lights', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('lights') } },
    { id: 'film', label: 'FILM GRAIN', desc: 'Grain and colour grading pass', long: 'A full-screen pass that adds the tape grain, the warm tint of the hotel and the colour drain when your sanity drops. Off saves a whole pass on a slow graphics card.', flag: 'film' },
    { id: 'dust', label: 'DUST', desc: 'Motes floating in the air', long: 'The specks that catch the light. Pure atmosphere: off on a weak computer.', flag: 'dust' },
    { id: 'poolAO', label: 'AMBIENT OCCLUSION', desc: 'Poolrooms corner shading', long: 'Soft shading in the corners of the Poolrooms. The heaviest effect: turn it off first.', flag: 'poolAO' },
    { id: 'poolAA', label: 'SMOOTH EDGES', desc: 'Poolrooms anti-aliasing', long: 'Smooths jagged edges in the Poolrooms.', flag: 'poolAA' },
    { id: 'warmup', label: 'SHADER WARM-UP', desc: 'Loading time vs. stutter', long: 'FULL loads longest and never stutters. LAZY loads fastest and hitches the first time each thing appears.', num: { k: 'warmup', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('warmup') } },
  ],
  ACCESSIBILITY: [
    { id: 'reduceMotion', label: 'REDUCE MOTION', desc: 'No sway, shake or flicker', long: 'Stills the camera sway, the tape bands and the flicker. Also on if your system asks for it.', flag: 'reduceMotion' },
    { id: 'recordReplays', label: 'SAVE REPLAYS', desc: 'Keep a replay of every round', long: 'Records each round in this browser so you can watch it again. Replays never leave your device and only the last 10 are kept (starred ones stay).', flag: 'recordReplays' },
    { id: 'emoteCam', label: 'THIRD-PERSON EMOTES', desc: 'Camera swings round on emotes', long: 'OFF: you stay in first person while you emote and only the others see you. ON: the camera moves in front of you so you can watch yourself.', flag: 'emoteCam' },
    { id: 'toggleBreath', label: 'TOGGLE BREATH HOLD', desc: 'Press once, not hold', long: 'Hiding in a niche and an entity looks in: press SPACE once to hold your breath and again to let go, instead of keeping the key down.', flag: 'toggleBreath' },
  ],
} satisfies Record<string, Row[]>;
type Section = keyof typeof SECTIONS | 'STORAGE';
const TABS = [...Object.keys(SECTIONS), 'STORAGE'] as Section[];
const BLOCKS = 24;

const show = (n: NonNullable<Row['num']>, v: number) => n.labels?.[Math.round(v)] ?? `${n.unit === 'x' ? (v * n.scale).toFixed(1) : Math.round(v * n.scale)}${n.unit}`;

/** La lista de micrófonos (se rellena al dar permiso). */
function useMicDevices() {
  const [n, setN] = useState(0);
  useEffect(() => {
    void voiceMic.query();
    return voiceMic.onChange(() => setN((x) => x + 1));
  }, []);
  void n;
  return voiceMic.devices;
}

/** La vista previa de los ajustes del micrófono: permiso, medidor en vivo, la puerta y escucharse a uno mismo. */
function MicCaption() {
  const [, bump] = useState(0);
  useEffect(() => voiceMic.onChange(() => bump((x) => x + 1)), []);
  const [on, setOn] = useState(false), [hear, setHear] = useState(false), [lv, setLv] = useState({ level: 0, open: false });
  useEffect(() => {
    if (!on) return;
    void voice.test(true, hear);
    const id = setInterval(() => setLv(voice.micMeter()), 60);
    return () => (clearInterval(id), void voice.test(false));
  }, [on, hear]);
  const st = voiceMic.state;
  if (st === 'unavailable') return <p className="br-big">NEEDS HTTPS<span className="br-lobby__dim br-big__s"> · the browser only offers the microphone on secure pages</span></p>;
  if (st === 'denied')
    return (
      <p className="br-big">
        BLOCKED<span className="br-lobby__dim br-big__s"> · allow the microphone with the lock icon next to the address, then reload</span>
      </p>
    );
  if (st !== 'granted')
    return (
      <>
        <button type="button" className="br-opt" onClick={() => void voice.allowMic()}>ALLOW MICROPHONE</button>
        <p className="br-lobby__dim">The browser asks once. Then you pick the device and tune it here.</p>
      </>
    );
  return (
    <>
      <Meter v={on ? lv.level : 0} />
      <p className="br-big">
        {on ? (lv.open ? 'VOICE GOES OUT' : 'GATE CLOSED') : 'READY'}
        <span className="br-lobby__dim br-big__s"> · {voiceMic.devices.length} MICROPHONE{voiceMic.devices.length === 1 ? '' : 'S'}</span>
      </p>
      <p>
        <button type="button" className="br-opt" onClick={() => setOn(!on)}>{on ? 'STOP TEST' : 'TEST'}</button>
        <button type="button" className="br-opt" onClick={() => (setHear(!hear), on || setOn(true))}>HEAR YOURSELF: {hear ? 'ON' : 'OFF'}</button>
      </p>
    </>
  );
}

function Meter({ v }: { v: number }) {
  const on = Math.round(v * BLOCKS);
  return (
    <p className="br-meter" aria-hidden="true">
      {'▮'.repeat(on)}
      <span className="br-lobby__dim">{'▮'.repeat(BLOCKS - on)}</span>
    </p>
  );
}

/** Los ajustes que se ven: su vista previa es el monitor de la camcorder, con la imagen tal como la dejan los ajustes de ahora. */
const VISUAL = new Set([...SECTIONS.VIDEO.map((r) => r.id).filter((id) => id !== 'bench'), 'sens', 'invertY', 'reduceMotion']);

/**
 * El monitor: un pasillo dibujado en perspectiva (o un pasillo de las Poolrooms, en sus dos ajustes) al que se le aplican en vivo el campo de
 * visión, el brillo, la resolución, la cinta, las sombras, el halo, el punto de mira... Con el ratón encima se gira la vista con la
 * sensibilidad (y la inversión) de verdad.
 */
function Monitor({ s, id }: { s: Settings; id: string }) {
  const [v, setV] = useState({ x: 0, y: 0 });
  const pool = id === 'poolAO' || id === 'poolAA', low = s.quality === 1, sh = low ? 0 : s.shadows, cap = FPS_CAPS[s.fpsLimit] ?? 0;
  const k = 1 / Math.tan((s.fov * Math.PI) / 360), cx = 120 - v.x, cy = 90 - v.y, w = 38 * k, h = 28 * k;
  // un punto del pasillo: u (-1 izquierda ... 1 derecha), q (-1 techo ... 1 suelo), t (0 aquí ... 1 al fondo)
  const P = (u: number, q: number, t: number) => `${120 + u * 120 + (cx + u * w - 120 - u * 120) * t},${90 + q * 90 + (cy + q * h - 90 - q * 90) * t}`;
  const quad = (...p: [number, number, number][]) => p.map((a) => P(...a)).join(' ');
  const C = pool ? { back: '#dfe7e6', side: '#c0cdcc', ceil: '#eef3f2', floor: '#4fa3b8', post: '#aebdbc' } : { back: '#a8923a', side: '#8c782c', ceil: '#c9b765', floor: '#655524', post: '#7a6826' };
  const clamp = (n: number, m: number) => Math.max(-m, Math.min(m, n)), fog = [0.9, 0.5, 0][s.drawDist] ?? 0.5;
  return (
    <div className="br-mon" data-sway={!s.reduceMotion || undefined} data-drs={(id === 'autoRes' && s.autoRes) || undefined} style={{ ['--a' as string]: s.vhs }} onMouseMove={(e) => (([mx, my]) => setV((o) => ({ x: clamp(o.x + mx * 0.35 * s.sens, 75), y: clamp(o.y + my * 0.35 * s.sens * (s.invertY ? -1 : 1), 45) })))([e.movementX, e.movementY])} aria-hidden="true">
      <svg viewBox="0 0 240 180" shapeRendering={pool && !s.poolAA ? 'crispEdges' : 'auto'} style={{ filter: `brightness(${s.brightness}) blur(${(1 - s.resScale * (low ? 0.6 : 1)) * 2.5}px)` }}>
        <polygon points={quad([-1, -1, 0], [1, -1, 0], [1, -1, 1], [-1, -1, 1])} fill={C.ceil} />
        <polygon points={quad([-1, 1, 0], [1, 1, 0], [1, 1, 1], [-1, 1, 1])} fill={C.floor} />
        {/* las juntas del suelo: de lejos se emborronan sin filtrado de texturas */}
        {[0, 1].map((far) => (
          <g key={far} stroke="#000" strokeOpacity="0.3" style={far ? { filter: `blur(${(3 - s.texFilter) * 0.6}px)` } : undefined}>
            {[0.12, 0.26, 0.4].map((t) => <polyline key={t} points={quad([-1, 1, t + far * 0.45], [1, 1, t + far * 0.45])} />)}
          </g>
        ))}
        <polygon points={quad([-1, -1, 0], [-1, 1, 0], [-1, 1, 1], [-1, -1, 1])} fill={C.side} />
        <polygon points={quad([1, -1, 0], [1, 1, 0], [1, 1, 1], [1, -1, 1])} fill={C.side} />
        <polygon points={quad([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1])} fill={C.back} />
        {pool && s.poolAO && !low && (
          <g fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="10" style={{ filter: 'blur(4px)' }}>
            <polygon points={quad([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1])} />
            {[-1, 1].flatMap((u) => [-1, 1].map((q) => <polyline key={`${u}${q}`} points={quad([u, q, 0], [u, q, 1])} />))}
          </g>
        )}
        <polygon points={quad([-0.35, -1, 0.3], [0.35, -1, 0.3], [0.35, -1, 0.7], [-0.35, -1, 0.7])} fill="#fffbe6" style={s.bloom && !low ? { filter: 'drop-shadow(0 0 7px #fff3b0) drop-shadow(0 0 14px #fff3b0)' } : undefined} />
        {sh > 0 && <polygon points={quad([0.35, 1, 0.55], [0.7, 1, 0.55], [0.3, 1, 0.2], [-0.3, 1, 0.2])} fill="#000" fillOpacity={sh > 1 ? 0.6 : 0.32} style={{ filter: `blur(${sh > 1 ? 0.6 : 3.5}px)` }} />}
        <polygon points={quad([0.35, -1, 0.55], [0.7, -1, 0.55], [0.7, 1, 0.55], [0.35, 1, 0.55])} fill={C.post} />
        {/* DRAW DISTANCE: la niebla se cierra (corta) o se aleja (lejos) */}
        {fog > 0 && (
          <g fill={pool ? '#cfe0e0' : '#17130a'}>
            <polygon points={quad([-1, -1, 0.5], [1, -1, 0.5], [1, 1, 0.5], [-1, 1, 0.5], [-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1])} fillOpacity={fog * 0.45} fillRule="evenodd" />
            <polygon points={quad([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1])} fillOpacity={fog * 0.55} />
          </g>
        )}
        {/* EXTRA LIGHTS: charcos de luz de las lamparas cercanas */}
        {[[-0.5, 0.5], [0.5, 0.35], [-0.4, 0.8], [0.45, 0.9]].slice(0, [0, 2, 4][s.lights] ?? 4).map(([u, t]) => {
          const [gx, gy] = P(u, 1, t).split(',');
          return <ellipse key={`${u}${t}`} cx={gx} cy={gy} rx={34 * (1 - t * 0.5)} ry={11 * (1 - t * 0.5)} fill="#ffe9a0" fillOpacity="0.28" style={{ filter: 'blur(4px)' }} />;
        })}
        {s.crosshair && <circle cx="120" cy="90" r="2.4" fill="#f2f1ea" stroke="#000" />}
      </svg>
      {s.dust && !low && [8, 21, 34, 47, 59, 72, 85, 15, 66].map((x, i) => <i key={x} className="br-mon__dust" style={{ left: `${x}%`, animationDelay: `${-i * 0.9}s`, animationDuration: `${6 + (i % 3) * 2}s` }} />)}
      {s.film && <div className="br-mon__grain" />}
      <div className="br-mon__osd" style={{ transform: `scale(${s.ui})`, transformOrigin: '0 0', width: `${100 / s.ui}%` }}>
        <span className="br-mon__rec"><Circle {...ic} fill="currentColor" /> REC</span>
        {s.fps && <span>{cap || 60} FPS</span>}
      </div>
      {id === 'autoRes' && <p className="br-mon__foot">{s.autoRes ? 'RESOLUTION FOLLOWS THE FRAME RATE' : 'ALWAYS FULL RESOLUTION'}</p>}
      {id === 'warmup' && <p className="br-mon__foot">LOAD {'▮'.repeat(s.warmup + 1)}<span className="br-lobby__dim">{'▮'.repeat(2 - s.warmup)}</span> · HITCH {'▮'.repeat(2 - s.warmup)}<span className="br-lobby__dim">{'▮'.repeat(s.warmup + 1)}</span></p>}
      {id === 'fullscreen' && !document.fullscreenElement && <p className="br-mon__win">BACKROOMS<span>_ □ ×</span></p>}
      {id === 'fpsLimit' && <i className="br-mon__pip" style={{ animationTimingFunction: cap ? `steps(${Math.round(cap * 1.2)})` : 'linear' }} />}
    </div>
  );
}

/** El texto de la vista previa del ajuste elegido (bajo el monitor, si lo lleva). */
function Caption({ row, s, muted }: { row: Row; s: Settings; muted: boolean }): ReactNode {
  switch (row.id) {
    case 'voiceLock':
      return (
        <p className="br-big">
          {['OFF', 'ON', 'STRICT'][Math.round(s.voiceLock)]}
          <span className="br-lobby__dim br-big__s"> · {['VOICE GOES AS IT IS', 'ENCRYPTED WITH EVERYONE WHO CAN', 'ONLY ENCRYPTED VOICE, NO FALLBACK'][Math.round(s.voiceLock)]}{E2ee.supported ? '' : ' · THIS BROWSER CANNOT ENCRYPT'}</span>
        </p>
      );
    case 'voice3d': {
      const d = ['EVERYONE THE SAME, CENTRED', 'DISTANCE AND LEFT/RIGHT', 'DISTANCE, 3D POSITION AND ECHO', 'ALSO WALLS AND ROOM SIZE'][Math.round(s.voice3d)] ?? '';
      return (
        <p className="br-big">
          {['FLAT', 'LOW', 'MEDIUM', 'HIGH'][Math.round(s.voice3d)]}
          <span className="br-lobby__dim br-big__s"> · {d}</span>
        </p>
      );
    }
    case 'micDev':
    case 'micGain':
    case 'micGate':
    case 'micFx':
      return <MicCaption />;
    case 'mute':
      return <p className="br-big">{muted ? 'SOUND OFF' : 'SOUND ON'}</p>;
    case 'volume':
    case 'sfx':
    case 'ambient':
      return <Meter v={muted ? 0 : s[row.id] * (row.id === 'volume' ? 1 : s.volume)} />;
    case 'sens':
      return (
        <p className="br-big">
          100 PX = {Math.round(100 * 0.0022 * s.sens * (180 / Math.PI) * 10) / 10}°
          <span className="br-lobby__dim br-big__s"> of turn · move the mouse over the picture</span>
        </p>
      );
    case 'invertY':
      return (
        <p className="br-big">
          MOUSE ↑ = LOOK {s.invertY ? 'DOWN ↓' : 'UP ↑'}
          <span className="br-lobby__dim br-big__s"> · try it on the picture</span>
        </p>
      );
    case 'vhs':
      return <p className="br-big">{s.vhs ? `${Math.round(s.vhs * 100)}% TAPE` : 'CLEAN PICTURE'}</p>;
    case 'fov':
      return (
        <p className="br-big">
          {s.fov}°<span className="br-lobby__dim br-big__s"> · {s.fov < 70 ? 'TELE' : s.fov > 90 ? 'FISHEYE' : 'WIDE'}</span>
        </p>
      );
    case 'resScale':
    case 'ui':
    case 'brightness':
      return <p className="br-big">{Math.round(s[row.id] * 100)}%</p>;
    case 'shadows':
    case 'texFilter':
    case 'fpsLimit':
    case 'warmup':
    case 'drawDist':
    case 'lights': {
      const c = CHOICES[row.id][Math.round(s[row.id])] ?? CHOICES[row.id][0];
      return (
        <p className="br-big">
          {c[0]}
          {c[1] && <span className="br-lobby__dim br-big__s"> · {c[1]}</span>}
        </p>
      );
    }
    case 'bench': {
      const l = lastBench();
      return (
        <p className="br-big">
          {l ? PRESETS[l.preset]?.[0] ?? 'CUSTOM' : 'NOT RUN YET'}
          <span className="br-lobby__dim br-big__s"> · {l ? `${l.fps} FPS ON ${new Date(l.at).toLocaleDateString()}` : 'FINDS THE BEST PRESET FOR THIS COMPUTER'}</span>
        </p>
      );
    }
    case 'preset': {
      const c = PRESETS[presetOf(s)] ?? ['CUSTOM', 'SET BY HAND'];
      return (
        <p className="br-big">
          {c[0]}
          <span className="br-lobby__dim br-big__s"> · {c[1]}</span>
        </p>
      );
    }
    case 'bloom':
    case 'autoRes':
    case 'film':
    case 'dust':
    case 'poolAO':
    case 'poolAA':
      return <p className="br-big">{s[row.id] ? 'ON' : 'OFF'}</p>;
    case 'fullscreen':
      return <p className="br-big">{document.fullscreenElement ? 'FULLSCREEN' : 'WINDOWED'}</p>;
    case 'crosshair':
      return (
        <p className="br-big">
          {s.crosshair ? <Crosshair /> : null} {s.crosshair ? 'ON' : 'OFF'}
        </p>
      );
    case 'fps':
      return <p className="br-big">{s.fps ? '60 FPS' : 'HIDDEN'}</p>;
    case 'reduceMotion':
      return <p className="br-big">{s.reduceMotion ? 'STILL' : 'FULL MOTION'}</p>;
    case 'recordReplays':
      return <p className="br-big">{s.recordReplays ? 'RECORDING' : 'OFF'}</p>;
    case 'emoteCam':
      return <p className="br-big">{s.emoteCam ? 'THIRD PERSON' : 'FIRST PERSON'}</p>;
    case 'toggleBreath':
      return <p className="br-big">SPACE · {s.toggleBreath ? 'PRESS TO HOLD, PRESS TO LET GO' : 'KEEP PRESSED'}</p>;
  }
  return null;
}

export default function SettingsPane({ muted, toggleSound, onBack }: { muted: boolean; toggleSound: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<Section>(() => {
    try {
      if (sessionStorage.getItem('br-bench-open')) return (sessionStorage.removeItem('br-bench-open'), 'VIDEO'); // (acaba de terminar el benchmark: el resultado está en VIDEO)
    } catch {}
    return 'AUDIO';
  });
  const [pick, setPick] = useState<Record<string, string>>({});
  const s = useSettings();
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const devs = useMicDevices();
  const rows: Row[] = tab === 'STORAGE' ? [] : (SECTIONS[tab] as Row[]).map((r) => (r.id === 'micDev' && r.num ? { ...r, num: { ...r.num, max: devs.length, labels: ['DEFAULT', ...devs.map((d) => d.label.toUpperCase() || 'MIC')] } } : r));
  const row = rows.find((r) => r.id === pick[tab]) ?? rows[0];
  const pi = presetOf(s), pv = pi < 0 ? PRESETS.length : pi; // (el último paso de la barra es CUSTOM)
  const keys = (tab === 'VIDEO' ? ['quality' as keyof Settings] : []).concat(rows.flatMap((r) => (r.num ? [r.num.k] : r.flag && r.flag !== 'mute' && r.flag !== 'fullscreen' ? [r.flag] : [])));
  const reset = (ks: (keyof Settings)[]) => ks.forEach((k) => setSetting(k, DEFAULTS[k] as never));

  if (tab === 'STORAGE')
    return (
      <Frame title="SETTINGS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
        <StoragePane />
      </Frame>
    );
  return (
    <Frame title="SETTINGS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
      <div className="br-set2" role="tabpanel" aria-label={tab}>
        <ul
          className="br-set2__list"
          onKeyDown={(e) => {
            // ↑ ↓ pasan de un ajuste a otro (en una barra, además, cambiarían su valor)
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const all = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button')], i = all.indexOf(document.activeElement as HTMLElement);
            all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
            e.preventDefault();
          }}
        >
          {rows.map((r) => {
            const f = r.flag, on = f === 'mute' ? muted : f === 'fullscreen' ? full : f ? s[f] : false;
            return (
              <li key={r.id} className="br-row" data-sel={r === row || undefined} onMouseEnter={() => setPick({ ...pick, [tab]: r.id })} onFocus={() => setPick({ ...pick, [tab]: r.id })}>
                <span className="br-row__l">
                  <span className="br-row__t">
                    {r.label}
                  </span>
                  <span className="br-row__d">{r.desc}</span>
                </span>
                {r.act === 'bench' ? (
                  <span className="br-row__c">
                    <button type="button" className="br-opt" disabled={!!benchState()} onClick={startBench}>
                      RUN
                    </button>
                  </span>
                ) : r.preset ? (
                  <span className="br-row__c">
                    <input type="range" className="br-range" aria-label={r.label} min={0} max={PRESETS.length} step={1} value={pv} onChange={(e) => applyPreset(Number(e.target.value))} />
                    <output className="br-row__v">{PRESETS[pv]?.[0] ?? 'CUSTOM'}</output>
                  </span>
                ) : r.num?.drop ? (
                  <span className="br-row__c">
                    <select className="br-sel" aria-label={r.label} value={Math.min(Math.round(s[r.num.k]), r.num.labels!.length - 1)} onChange={(e) => setSetting(r.num!.k, Number(e.target.value))}>
                      {r.num.labels!.map((l, i) => (
                        <option key={i} value={i}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : r.num?.labels ? (
                  <span className="br-row__c br-row__c--seg" role="radiogroup" aria-label={r.label}>
                    {r.num.labels.map((l, i) => (
                      <button key={l} type="button" className="br-seg" role="radio" aria-checked={Math.round(s[r.num!.k]) === i} onClick={() => setSetting(r.num!.k, i)}>
                        {l}
                      </button>
                    ))}
                  </span>
                ) : r.num ? (
                  <span className="br-row__c">
                    <input type="range" className="br-range" aria-label={r.label} min={r.num.min} max={r.num.max} step={r.num.step} value={s[r.num.k]} onChange={(e) => setSetting(r.num!.k, Number(e.target.value))} />
                    <output className="br-row__v">{show(r.num, s[r.num.k])}</output>
                  </span>
                ) : (
                  <button type="button" className="br-opt br-row__sw" role="switch" aria-checked={on} aria-label={r.label} onClick={() => (f === 'mute' ? toggleSound() : f === 'fullscreen' ? void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}) : f && setSetting(f, !s[f]))}>
                    {on ? 'ON' : 'OFF'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <aside className="br-set2__side" aria-live="polite">
          <p className="br-set2__h">{row.label}</p>
          <p>{row.long}</p>
          <div className="br-set2__prev">
            {VISUAL.has(row.id) && <Monitor s={s} id={row.id} />}
            <Caption row={row} s={s} muted={muted} />
          </div>
        </aside>
        <div className="br-pane__foot">
          <button type="button" className="br-opt" onClick={() => reset(keys)} disabled={keys.every((k) => s[k] === DEFAULTS[k])}>
            RESET {tab}
          </button>
          <button type="button" className="br-opt" onClick={() => reset(Object.keys(DEFAULTS) as (keyof Settings)[])}>
            RESET ALL
          </button>
          <span className="br-lobby__dim br-lobby__keys">↑ ↓ SELECT · ◀ ▶ CHANGE · SAVED IN THIS BROWSER · ESC BACK</span>
        </div>
      </div>
    </Frame>
  );
}
