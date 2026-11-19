import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEV_LOCAL } from './devGate';
import { initTelemetry, report } from './telemetry';

/** Dirección de la versión clásica (la que usa three.js): se define en client/.env.local con VITE_LEGACY_URL. */
const LEGACY = import.meta.env.VITE_LEGACY_URL as string | undefined;

/**
 * Solo en la versión con Phoenyx (WebGPU): pantalla previa a las condiciones, cada vez que se abre el juego.
 * - Sin WebGPU: pide actualizar el navegador o jugar la versión clásica (three.js).
 * - Con WebGPU: avisa de que es inestable y de que, si se continúa, se envían datos de diagnóstico para mejorar el motor.
 * En desarrollo, /?capture (las capturas de fidelidad) no la muestra.
 */
export default function GpuNotice({ children }: { children: ReactNode }) {
  const skip = !__PHOENYX__ || (DEV_LOCAL && location.search.includes('capture'));
  const [state, setState] = useState<'check' | 'none' | 'ask' | 'ok'>(skip ? 'ok' : 'check');
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
  if (state === 'ok') return <>{children}</>;
  if (state === 'check') return <div className="br" data-screen="off" />;
  const legacy = LEGACY ? (
    <li>
      <a className="br-opt" href={LEGACY}>
        PLAY THE CLASSIC VERSION (THREE.JS)
      </a>
    </li>
  ) : null;
  if (state === 'none')
    return (
      <div className="br" data-screen="off">
        <nav className="br-menu br-terms" aria-label="WebGPU not available">
          <h1 className="br-menu__title">WEBGPU NOT AVAILABLE</h1>
          <p className="br-menu__sub">THIS VERSION OF THE GAME NEEDS WEBGPU</p>
          <dl>
            <dd>Your browser or graphics card does not support WebGPU, or it is turned off. Update your browser (a recent Chrome or Edge works) and make sure hardware acceleration is on. If it still does not work, play the classic version of the game, the one that uses three.js.</dd>
          </dl>
          <ul>{legacy ?? <li>ASK FOR THE CLASSIC VERSION (THREE.JS) LINK</li>}</ul>
        </nav>
      </div>
    );
  const go = () => {
    initTelemetry(true); // continuar = aceptar el envío de diagnóstico de esta versión
    report('webgpu-session', 'inicio', 'info', { gpu: info.current, ua: navigator.userAgent });
    setState('ok');
  };
  return (
    <div className="br" data-screen="off">
      <nav className="br-menu br-terms" aria-label="WebGPU notice">
        <h1 className="br-menu__title">WEBGPU VERSION</h1>
        <p className="br-menu__sub">READ THIS BEFORE YOU CONTINUE</p>
        <dl>
          <dt>UNSTABLE</dt>
          <dd>This version of the game runs on WebGPU with our own graphics engine. It is new and unstable: you may see glitches, freezes or crashes.</dd>
          <dt>DIAGNOSTIC DATA</dt>
          <dd>If you continue, diagnostic data (errors, browser and graphics card type, performance) will be sent to help us improve the engine. No account name, no chat, no voice.</dd>
        </dl>
        <ul>
          <li>
            <button type="button" className="br-opt" onClick={go}>
              CONTINUE
            </button>
          </li>
          {legacy}
        </ul>
      </nav>
    </div>
  );
}
