import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEV_LOCAL } from './devGate';
import { initTelemetry, report } from './telemetry';
import './game/backrooms.css';
import './GpuNotice.css';

/** Dirección de la versión clásica (la que usa three.js): se define en client/.env.local con VITE_LEGACY_URL. */
const LEGACY = import.meta.env.VITE_LEGACY_URL as string | undefined;

/** El logotipo de Phoenyx (de momento, una interrogación en el mismo cuadro que el avatar de invitado del menú). */
const Brand = () => (
  <div className="gn__brand">
    <span className="br-avatar" aria-hidden="true">
      ?
    </span>
    <span className="gn__word">PHOENYX</span>
  </div>
);

/**
 * Solo en la versión con Phoenyx (WebGPU): pantalla previa a las condiciones, cada vez que se abre el juego.
 * - Sin WebGPU: pide actualizar el navegador o jugar la versión clásica (three.js).
 * - Con WebGPU: avisa de que es nueva e inestable y de que, si se continúa, se envían datos de diagnóstico para mejorar el motor.
 * En desarrollo, /?capture (las capturas de fidelidad) no la muestra.
 */
export default function GpuNotice({ children }: { children: ReactNode }) {
  const skip = !__PHOENYX__ || (DEV_LOCAL && location.search.includes('capture'));
  const [state, setState] = useState<'check' | 'none' | 'ask' | 'leave' | 'ok'>(skip ? 'ok' : 'check');
  const info = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (state !== 'check') return;
    void (async () => {
      try {
        const a = await (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, unknown>; features?: Iterable<string> } | null> } }).gpu?.requestAdapter();
        if (a) info.current = { ...a.info, features: a.features ? [...a.features] : [] };
        setState(a ? 'ask' : 'none');
      } catch {
        setState('none');
      }
    })();
  }, [state]);
  useEffect(() => {
    if (state !== 'leave') return;
    const t = setTimeout(() => setState('ok'), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000);
    return () => clearTimeout(t);
  }, [state]);
  if (state === 'ok') return <>{children}</>;
  if (state === 'check') return <div className="br" data-screen="off" />;
  const legacy = LEGACY ? (
    <a className="br-opt" href={LEGACY}>
      PLAY THE CLASSIC VERSION (THREE.JS)
    </a>
  ) : null;
  if (state === 'none')
    return (
      <div className="br" data-screen="off" role="alert">
        <div className="gn">
          <h1 className="gn__title">
            <b>WEBGPU</b> NOT AVAILABLE
          </h1>
          <ul className="gn__list">
            <li>
              <b className="gn__tag--warn">WHAT TO DO</b>
              <span>Update your browser (a recent Chrome or Edge works) and turn on hardware acceleration. Still nothing? Play the classic version of the game, the one that uses three.js.</span>
            </li>
          </ul>
          <div className="gn__btns">{legacy ?? <span className="br-lobby__dim">ASK FOR THE CLASSIC VERSION LINK (THREE.JS)</span>}</div>
          <Brand />
        </div>
      </div>
    );
  const go = () => {
    initTelemetry(true); // continuar = aceptar el envío de diagnóstico de esta versión
    report('webgpu-session', 'inicio', 'info', { gpu: info.current, ua: navigator.userAgent });
    setState('leave');
  };
  return (
    <div className="br" data-screen="off">
      <div className={`gn${state === 'leave' ? ' gn--leave' : ''}`}>
        <h1 className="gn__title">
          THIS VERSION USES <b>WEBGPU</b>
        </h1>
        <ul className="gn__list">
          <li>
            <b className="gn__tag--new">NEW ENGINE</b>
            <span>It runs on Phoenyx, our own graphics engine.</span>
          </li>
          <li>
            <b className="gn__tag--warn">UNSTABLE</b>
            <span>You may see glitches, freezes or crashes.</span>
          </li>
          <li>
            <b className="gn__tag--data">DIAGNOSTICS</b>
            <span>If you continue, we send diagnostic data to help improve the engine. No account, chat or voice.</span>
          </li>
        </ul>
        <div className="gn__btns">
          <button type="button" className="br-opt" onClick={go} disabled={state === 'leave'} autoFocus>
            CONTINUE
          </button>
          {legacy}
        </div>
        <Brand />
      </div>
    </div>
  );
}
