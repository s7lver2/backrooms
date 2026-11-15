import { useEffect, useState } from 'react';
import { Square, Play } from 'lucide-react';
import { ic } from './ic';

/*
 * La pantalla de carga entre pantallas (menú → salas, salas → sala de espera): el OSD de un vídeo que acaba de
 * meter la cinta. ▶ PLAY arriba a la izquierda (antes, INSERTING), el contador de cinta arriba a la derecha,
 * los pasos reales de lo que se espera, una barra de bloques que solo avanza con pasos hechos (el bloque
 * siguiente parpadea: sigue vivo, pero no se inventa el avance) y una nota de las Backrooms que va cambiando.
 * Va sobre la nieve (Static), con una banda de tracking que sube.
 */

export interface Step {
  label: string;
  done: boolean;
}
const BLOCKS = 28;
const TIPS = [
  'THE HUM IS NOT THE LIGHTS.',
  'IF YOU HEAR FOOTSTEPS BEHIND YOU, DO NOT TURN. KEEP RECORDING.',
  'NOCLIP IS NOT AN EXIT. THE TAPE KEEPS ROLLING.',
  'ALMOND WATER IS SAFE. ASK NO QUESTIONS.',
  'THE CARPET IS ALWAYS DAMP. THE WALLS ARE ALWAYS YELLOW.',
  'HIDE AND HOLD YOUR BREATH. IT LISTENS FOR THE EXHALE.',
  'TAPES RECORD WHAT THE EYE REFUSES TO KEEP.',
  'EVERY ROOM LOOKS LIKE THE LAST ONE. THAT IS THE POINT.',
  'DO NOT RUN FOR LONG. IT HEARS YOUR LUNGS.',
  'A LIGHT THAT FLICKERS IS A LIGHT THAT KNOWS YOU ARE HERE.',
  'STAY WITH THE GROUP. THE GROUP IS NOT ALWAYS THE SAME SIZE.',
];
const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Loading({ title, steps }: { title: string; steps: Step[] }) {
  const [sec, setSec] = useState(0);
  const [tip, setTip] = useState(() => (Math.random() * TIPS.length) | 0);
  useEffect(() => {
    const a = setInterval(() => setSec((s) => s + 1), 1000);
    const b = setInterval(() => setTip((t) => (t + 1 + ((Math.random() * (TIPS.length - 1)) | 0)) % TIPS.length), 3600);
    return () => (clearInterval(a), clearInterval(b));
  }, []);
  const done = steps.filter((s) => s.done).length, f = done / steps.length, on = Math.round(f * BLOCKS);
  const live = steps.findIndex((s) => !s.done);
  return (
    <div className="br-ld" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
      <i className="br-ld__track" aria-hidden="true" />
      <p className="br-ld__tl" aria-hidden="true">
        {sec < 1 ? <><Square {...ic} fill="currentColor" /> INSERTING</> : <><Play {...ic} fill="currentColor" /> PLAY</>}
      </p>
      <p className="br-ld__tr" aria-hidden="true">
        SP {clock(sec)}
      </p>
      <div className="br-ld__main">
        <h2 className="br-ld__title">{title}</h2>
        <ul className="br-ld__steps">
          {steps.map((s, i) => (
            <li key={s.label} data-done={s.done || undefined} data-live={i === live || undefined}>
              <span>{s.label}</span>
              <i aria-hidden="true" />
              <span>{s.done ? 'OK' : i === live ? '···' : ''}</span>
            </li>
          ))}
        </ul>
        <div className="br-ld__bar" aria-hidden="true">
          {Array.from({ length: BLOCKS }, (_, i) => (
            <i key={i} data-on={i < on || undefined} data-live={(i === on && live >= 0) || undefined} />
          ))}
        </div>
      </div>
      <p className="br-ld__tip" key={tip} aria-hidden="true">
        <span>NOTE {String(tip + 1).padStart(2, '0')}</span> {TIPS[tip]}
      </p>
    </div>
  );
}
