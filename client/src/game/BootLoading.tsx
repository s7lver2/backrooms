import { useEffect, useRef, useState } from 'react';

/*
 * La carga inicial (antes del título): centrada, sobre negro liso (sin nieve) y con lo mínimo: el título, una barra de
 * bloques, la fase en curso con el porcentaje y un aviso de lo que se hace. `progress` ha de ser un avance real
 * (ver Game.load y LOAD_PHASES): la barra no inventa nada. Si tarda más de la cuenta o se queda sin avanzar, sale una
 * alerta con un botón para recargar la página. La carga entre salas es otra pantalla (Loading.tsx).
 */

const BLOCKS = 28;
/** Segundos en total a partir de los cuales se avisa de que tarda, y segundos sin que la barra se mueva (esta alerta manda sobre la otra). */
export const SLOW_S = 30,
  STALL_S = 15;

/** La alerta que toca (o ninguna): sin avisos si ya terminó o falló, que tienen su propio mensaje. */
export function bootAlert(elapsed: number, idle: number, progress: number, failed: boolean): { text: string; hint: string } | undefined {
  if (failed || progress >= 1) return undefined;
  const hint = 'IT MAY STILL FINISH · RELOAD IF IT STAYS STUCK';
  if (idle >= STALL_S) return { text: `NO PROGRESS FOR ${Math.floor(idle)} S`, hint };
  if (elapsed >= SLOW_S) return { text: 'TAKING LONGER THAN USUAL', hint };
  return undefined;
}

export default function BootLoading({ title, label, progress, error, over }: { title: string; label: string; progress: number; error?: string; over?: boolean }) {
  const t0 = useRef(performance.now()), moved = useRef(performance.now());
  const [now, setNow] = useState(() => performance.now());
  // cada vez que la barra avanza se anota cuándo; el reloj solo despierta la alerta (una vez por segundo)
  useEffect(() => void (moved.current = performance.now()), [progress]);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const f = Math.max(0, Math.min(1, progress)), pct = Math.round(f * 100), on = Math.round(f * BLOCKS);
  const alert = bootAlert(Math.max(0, now - t0.current) / 1000, Math.max(0, now - moved.current) / 1000, f, !!error);
  return (
    <div className="br-boot" data-over={over || undefined} role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="br-boot__box">
        <h2 className="br-boot__title">{title}</h2>
        <div className="br-boot__bar" aria-hidden="true">
          {Array.from({ length: BLOCKS }, (_, i) => (
            <i key={i} data-on={i < on || undefined} data-live={(i === on && f < 1 && !error) || undefined} />
          ))}
        </div>
        {error ? (
          <div className="br-boot__alert" role="alert">
            <p>{error}</p>
            <small>PRESS ANY KEY</small>
          </div>
        ) : (
          <>
            <p className="br-boot__row" aria-hidden="true">
              <span>{label}</span>
              <span>{String(pct).padStart(3, ' ')}%</span>
            </p>
            <p className="br-boot__note">PRELOADING SHADERS AND GEOMETRY</p>
            {alert && (
              <div className="br-boot__alert" role="alert">
                <p>{alert.text}</p>
                <small>{alert.hint}</small>
                <button type="button" className="br-boot__btn" onClick={() => location.reload()}>
                  RELOAD
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
