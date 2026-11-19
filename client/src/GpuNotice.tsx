import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEV_LOCAL } from './devGate';
import { initTelemetry, report } from './telemetry';
import './game/backrooms.css';
import './GpuNotice.css';

/** Dirección de la versión clásica (la que usa three.js): se define en client/.env.local con VITE_LEGACY_URL. Solo se ofrece si no hay WebGPU. */
const LEGACY = import.meta.env.VITE_LEGACY_URL as string | undefined;

// chip, triángulo de aviso, barras de telemetría, pantalla sin señal
const ICON = {
  engine: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  warn: 'M12 3L2 20h20zM12 10v5M12 17.5v.5',
  data: 'M4 20V14M10 20V9M16 20V12M22 20V4M2 22h22',
  off: 'M3 5h18v12H3zM8 21h8M12 17v4M3 3l18 18',
};

/** Marco de visor de camcorder: esquinas, REC y un dato a la derecha; Phoenyx solo como pie ("built with"). */
/** El título, letra a letra (cada una entra con su retraso). */
const Word = ({ text }: { text: string }) => (
  <span className="gn__word" aria-label={text}>
    {[...text].map((c, k) => (
      <span key={k} aria-hidden="true" style={{ '--k': k } as React.CSSProperties}>
        {c}
      </span>
    ))}
  </span>
)

const Viewfinder = ({ right, children, leave }: { right: string; children: ReactNode; leave?: boolean }) => (
  <div className="br" data-screen="off">
    <div className={`gn${leave ? ' gn--leave' : ''}`}>
      <i className="gn__c gn__c--tl" />
      <i className="gn__c gn__c--tr" />
      <i className="gn__c gn__c--bl" />
      <i className="gn__c gn__c--br" />
      <span className="gn__rec">
        <i /> REC
      </span>
      <span className="gn__right">{right}</span>
      {children}
      <a className="gn__built" href="https://github.com/s7lver2/phoenyx" target="_blank" rel="noreferrer">
        <img src="/brand/phoenyx-64.png" srcSet="/brand/phoenyx-32.png 1x, /brand/phoenyx-64.png 2x" width="22" height="22" alt="" aria-hidden="true" />
        BUILT WITH PHOENYX
      </a>
    </div>
  </div>
);

const Row = ({ icon, tag, cls, i, children }: { icon: string; tag: string; cls: string; i: number; children: ReactNode }) => (
  <li style={{ '--i': i } as React.CSSProperties}>
    <span className={`gn__box ${cls}`}>
      <svg className="gn__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
        <path d={icon} />
      </svg>
    </span>
    <span>
      <b className={cls}>{tag}</b>
      <span>{children}</span>
    </span>
  </li>
);

/**
 * Solo en la versión con Phoenyx (WebGPU): pantalla previa a las condiciones, cada vez que se abre el juego.
 * - Sin WebGPU: explica por qué (navegador o tarjeta) y ofrece reintentar o la versión clásica (three.js).
 * - Con WebGPU: avisa de que es nueva e inestable y de que, si se continúa, se envían datos de diagnóstico. Sin enlace a la clásica.
 * En desarrollo, /?capture (las capturas de fidelidad) no la muestra.
 */
export default function GpuNotice({ children }: { children: ReactNode }) {
  const skip = !__PHOENYX__ || (DEV_LOCAL && location.search.includes('capture'));
  const [state, setState] = useState<'check' | 'none' | 'ask' | 'leave' | 'ok'>(skip ? 'ok' : 'check');
  const info = useRef<Record<string, unknown>>({});
  const [why, setWhy] = useState<'api' | 'adapter'>('adapter');
  const [gpu, setGpu] = useState('');
  useEffect(() => {
    if (state !== 'check') return;
    void (async () => {
      try {
        const g = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, unknown>; features?: Iterable<string> } | null> } }).gpu;
        if (!g) setWhy('api'); // el navegador no expone WebGPU (versión antigua, o la página no es https)
        const a = await g?.requestAdapter();
        if (a) {
          info.current = { ...a.info, features: a.features ? [...a.features] : [] };
          const i = a.info ?? {};
          setGpu(String(i.description || i.vendor || i.architecture || 'GPU OK'));
        }
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
  if (state === 'none')
    return (
      <Viewfinder right="NO SIGNAL">
        <h1 className="gn__title">
          <Word text="BACKROOMS" />
          <small>NEEDS WEBGPU</small>
        </h1>
        <ul className="gn__list" role="alert">
          <Row icon={ICON.off} i={0} tag={why === 'api' ? 'BROWSER' : 'GRAPHICS CARD'} cls="gn__tag--warn">
            {why === 'api' ? 'This browser has no WebGPU. Use a recent Chrome, Edge or Firefox, and open the page over https.' : 'WebGPU is there but no graphics card answered. Turn on hardware acceleration and update your graphics driver.'}
          </Row>
        </ul>
        <div className="gn__btns">
          <button type="button" className="br-opt" onClick={() => location.reload()} autoFocus>
            TRY AGAIN
          </button>
          {LEGACY ? (
            <a className="br-opt" href={LEGACY}>
              CLASSIC VERSION
            </a>
          ) : null}
        </div>
      </Viewfinder>
    );
  const go = () => {
    initTelemetry(true); // continuar = aceptar el envío de diagnóstico de esta versión
    report('webgpu-session', 'inicio', 'info', { gpu: info.current, ua: navigator.userAgent });
    setState('leave');
  };
  return (
    <Viewfinder right={gpu || 'WEBGPU'} leave={state === 'leave'}>
      <h1 className="gn__title">
        <Word text="BACKROOMS" />
      </h1>
      <ul className="gn__list">
        <Row icon={ICON.engine} i={0} tag="NEW ENGINE" cls="gn__tag--new">
          Runs on Phoenyx, our own graphics engine.
        </Row>
        <Row icon={ICON.warn} i={1} tag="UNSTABLE" cls="gn__tag--warn">
          You may see glitches, freezes or crashes.
        </Row>
        <Row icon={ICON.data} i={2} tag="DIAGNOSTICS" cls="gn__tag--data">
          Continuing sends diagnostic data to improve the engine.
        </Row>
      </ul>
      <div className="gn__btns">
        <button type="button" className="br-opt" onClick={go} disabled={state === 'leave'} autoFocus>
          CONTINUE
        </button>
      </div>
    </Viewfinder>
  );
}
