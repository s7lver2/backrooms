import { useEffect, useState, type ReactNode } from 'react';
import Frame from './Frame';
import { Crosshair } from './Crosshair';
import { DEFAULTS, FPS_CAPS, PRESETS, applyPreset, presetOf, setSetting, useSettings, type Settings } from '../settings';

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
  num?: { k: NumKey; min: number; max: number; step: number; unit: string; scale: number; labels?: string[] };
  flag?: BoolKey | 'mute' | 'fullscreen';
  preset?: true; // la barra de perfiles: no es un ajuste, fija los demás (ver PRESETS)
}

// los ajustes de varios pasos: nombre y qué hace cada uno (el número guardado es la posición); el juego lee el número
const CHOICES: Record<'quality' | 'shadows' | 'texFilter' | 'fpsLimit' | 'warmup', readonly (readonly [string, string])[]> = {
  quality: [['AUTO', 'LOW ON PHONES AND TABLETS'], ['LOW', 'NO SHADOWS, NO GLOW, 60% RESOLUTION'], ['HIGH', 'EVERYTHING ON']],
  shadows: [['OFF', 'NO SHADOWS AT ALL'], ['LOW', 'SMALL, SOFTER SHADOW MAPS'], ['HIGH', 'FULL LOOK']],
  texFilter: [['OFF', 'FASTEST, BLURRIER AT A SLANT'], ['2X', ''], ['4X', ''], ['8X', 'SHARPEST AT A SLANT']],
  fpsLimit: [['30', 'HALF THE WORK, COOLER LAPTOP'], ['45', ''], ['60', ''], ['OFF', 'AS FAST AS THE SCREEN ALLOWS']],
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
    { id: 'voiceVol', label: 'VOICE VOLUME', desc: 'How loud your mates are', long: 'The level of the other players voices.', num: pct('voiceVol') },
    { id: 'ambient', label: 'AMBIENT', desc: 'Lights, vents, tape hiss', long: 'The constant bed: the fluorescent hum, the ventilation and the hiss of the tape.', num: pct('ambient') },
  ],
  CONTROLS: [
    { id: 'sens', label: 'MOUSE SENSITIVITY', desc: 'How far the view turns', long: 'Multiplier on how far the view turns for each pixel the mouse moves.', num: { k: 'sens', min: 0.2, max: 3, step: 0.1, unit: 'x', scale: 1 } },
    { id: 'invertY', label: 'INVERT Y', desc: 'Mouse up looks down', long: 'Flips the vertical look: pushing the mouse forward looks down, like a flight stick.', flag: 'invertY' },
  ],
  VIDEO: [
    { id: 'preset', label: 'PRESET', desc: 'One switch for the graphics', long: 'Sets every graphics option at once, from POTATO (anything to make it run) to HIGH. Touch one by hand and it reads CUSTOM.', preset: true },
    { id: 'fullscreen', label: 'FULLSCREEN', desc: 'Fill the whole screen', long: 'Esc leaves fullscreen and pauses the game.', flag: 'fullscreen' },
    { id: 'brightness', label: 'BRIGHTNESS', desc: 'Lift or darken the picture', long: 'The Backrooms are meant to be dim: raise it only if you cannot see.', num: { k: 'brightness', min: 0.6, max: 1.6, step: 0.05, unit: '%', scale: 100 } },
    { id: 'ui', label: 'UI SIZE', desc: 'Size of menus and HUD', long: 'Scales the whole interface, independent of the browser zoom.', num: { k: 'ui', min: 0.7, max: 1.5, step: 0.05, unit: '%', scale: 100 } },
    { id: 'fov', label: 'FIELD OF VIEW', desc: 'How much you see', long: 'Wider shows more of the room and bends the edges.', num: { k: 'fov', min: 60, max: 110, step: 5, unit: '°', scale: 1 } },
    { id: 'vhs', label: 'VHS EFFECT', desc: 'Tape noise, bleed and tracking', long: 'How much tape shows in the picture. A corrupted tape always shows.', num: pct('vhs') },
    { id: 'crosshair', label: 'CROSSHAIR', desc: 'A dot at the centre', long: 'Shows where you are looking. It hides when you aim.', flag: 'crosshair' },
    { id: 'fps', label: 'SHOW FPS', desc: 'A frame counter, top right', long: 'Frames per second, on every screen.', flag: 'fps' },
    { id: 'quality', label: 'GRAPHICS', desc: 'The overall profile', long: 'LOW drops shadows, glow and effects and draws at 60% resolution. AUTO picks LOW on phones and tablets.', num: { k: 'quality', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('quality') } },
    { id: 'resScale', label: 'RESOLUTION SCALE', desc: 'Lower is faster', long: 'Fewer pixels, softer picture, more frames. The best single fix for a weak graphics card.', num: { k: 'resScale', min: 0.35, max: 1, step: 0.05, unit: '%', scale: 100 } },
    { id: 'fpsLimit', label: 'FPS LIMIT', desc: 'Cap the frame rate', long: 'A lower cap keeps a slow computer steady and a laptop cool.', num: { k: 'fpsLimit', min: 0, max: 3, step: 1, unit: '', scale: 1, labels: lab('fpsLimit') } },
    { id: 'shadows', label: 'SHADOWS', desc: 'Flashlight and sun shadows', long: 'OFF is the biggest saving on a slow graphics card.', num: { k: 'shadows', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('shadows') } },
    { id: 'bloom', label: 'LIGHT GLOW', desc: 'Halo around bright lights', long: 'The soft halo around the fluorescent panels.', flag: 'bloom' },
    { id: 'texFilter', label: 'TEXTURE FILTERING', desc: 'Sharpness at a slant', long: 'Keeps floors and walls sharp far away. Costs little.', num: { k: 'texFilter', min: 0, max: 3, step: 1, unit: '', scale: 1, labels: lab('texFilter') } },
    { id: 'poolAO', label: 'AMBIENT OCCLUSION', desc: 'Poolrooms corner shading', long: 'Soft shading in the corners of the Poolrooms. The heaviest effect: turn it off first.', flag: 'poolAO' },
    { id: 'poolAA', label: 'SMOOTH EDGES', desc: 'Poolrooms anti-aliasing', long: 'Smooths jagged edges in the Poolrooms.', flag: 'poolAA' },
    { id: 'warmup', label: 'SHADER WARM-UP', desc: 'Loading time vs. stutter', long: 'FULL loads longest and never stutters. LAZY loads fastest and hitches the first time each thing appears.', num: { k: 'warmup', min: 0, max: 2, step: 1, unit: '', scale: 1, labels: lab('warmup') } },
  ],
  ACCESSIBILITY: [
    { id: 'reduceMotion', label: 'REDUCE MOTION', desc: 'No sway, shake or flicker', long: 'Stills the camera sway, the tape bands and the flicker. Also on if your system asks for it.', flag: 'reduceMotion' },
    { id: 'toggleBreath', label: 'TOGGLE BREATH HOLD', desc: 'Press once, not hold', long: 'Hiding in a niche and an entity looks in: press SPACE once to hold your breath and again to let go, instead of keeping the key down.', flag: 'toggleBreath' },
  ],
} satisfies Record<string, Row[]>;
type Section = keyof typeof SECTIONS;
const TABS = Object.keys(SECTIONS) as Section[];
const BLOCKS = 24;

const show = (n: NonNullable<Row['num']>, v: number) => n.labels?.[Math.round(v)] ?? `${n.unit === 'x' ? (v * n.scale).toFixed(1) : Math.round(v * n.scale)}${n.unit}`;

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
const VISUAL = new Set([...SECTIONS.VIDEO.map((r) => r.id), 'sens', 'invertY', 'reduceMotion']);

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
  const clamp = (n: number, m: number) => Math.max(-m, Math.min(m, n));
  return (
    <div className="br-mon" data-sway={!s.reduceMotion || undefined} style={{ ['--a' as string]: s.vhs }} onMouseMove={(e) => (([mx, my]) => setV((o) => ({ x: clamp(o.x + mx * 0.35 * s.sens, 75), y: clamp(o.y + my * 0.35 * s.sens * (s.invertY ? -1 : 1), 45) })))([e.movementX, e.movementY])} aria-hidden="true">
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
        {s.crosshair && <circle cx="120" cy="90" r="2.4" fill="#f2f1ea" stroke="#000" />}
      </svg>
      <div className="br-mon__osd">
        <span className="br-mon__rec">● REC</span>
        {s.fps && <span>{cap || 60} FPS</span>}
      </div>
      {id === 'warmup' && <p className="br-mon__foot">LOAD {'▮'.repeat(s.warmup + 1)}<span className="br-lobby__dim">{'▮'.repeat(2 - s.warmup)}</span> · HITCH {'▮'.repeat(2 - s.warmup)}<span className="br-lobby__dim">{'▮'.repeat(s.warmup + 1)}</span></p>}
      {id === 'fullscreen' && !document.fullscreenElement && <p className="br-mon__win">BACKROOMS<span>_ □ ×</span></p>}
      {id === 'fpsLimit' && <i className="br-mon__pip" style={{ animationTimingFunction: cap ? `steps(${Math.round(cap * 1.2)})` : 'linear' }} />}
    </div>
  );
}

/** El texto de la vista previa del ajuste elegido (bajo el monitor, si lo lleva). */
function Caption({ row, s, muted }: { row: Row; s: Settings; muted: boolean }): ReactNode {
  switch (row.id) {
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
    case 'quality':
    case 'shadows':
    case 'texFilter':
    case 'fpsLimit':
    case 'warmup': {
      const c = CHOICES[row.id][Math.round(s[row.id])] ?? CHOICES[row.id][0];
      return (
        <p className="br-big">
          {c[0]}
          {c[1] && <span className="br-lobby__dim br-big__s"> · {c[1]}</span>}
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
    case 'toggleBreath':
      return <p className="br-big">SPACE · {s.toggleBreath ? 'PRESS TO HOLD, PRESS TO LET GO' : 'KEEP PRESSED'}</p>;
  }
  return null;
}

export default function SettingsPane({ muted, toggleSound, onBack }: { muted: boolean; toggleSound: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<Section>('AUDIO');
  const [pick, setPick] = useState<Record<string, string>>({});
  const s = useSettings();
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const rows: Row[] = SECTIONS[tab];
  const row = rows.find((r) => r.id === pick[tab]) ?? rows[0];
  const pi = presetOf(s), pv = pi < 0 ? PRESETS.length : pi; // (el último paso de la barra es CUSTOM)
  const keys = rows.flatMap((r) => (r.num ? [r.num.k] : r.flag && r.flag !== 'mute' && r.flag !== 'fullscreen' ? [r.flag] : []));
  const reset = (ks: (keyof Settings)[]) => ks.forEach((k) => setSetting(k, DEFAULTS[k] as never));

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
                {r.preset ? (
                  <span className="br-row__c">
                    <input type="range" className="br-range" aria-label={r.label} min={0} max={PRESETS.length} step={1} value={pv} onChange={(e) => applyPreset(Number(e.target.value))} />
                    <output className="br-row__v">{PRESETS[pv]?.[0] ?? 'CUSTOM'}</output>
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
