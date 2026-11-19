/*
 * Informes de fallo a GlitchTip (compatible con la API de Sentry). Solo si hay VITE_SENTRY_DSN (client/.env.local) Y el jugador lo ha aceptado
 * en las condiciones (consent.ts). Sin datos personales: sin PII por defecto, sin replay ni trazas; cada informe lleva nivel, planta, semilla
 * y posición (Game.crashContext). El SDK se carga en diferido: sin DSN o sin permiso no pesa nada.
 */
import { getConsent } from './consent';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
let ctx: (() => unknown) | undefined;
type Sentry = typeof import('@sentry/browser');
let sdk: Sentry | undefined;
let on = false;
const queue: (() => void)[] = [];
const seen = new Set<string>();
let sent = 0;
const MAX_REPORTS = 25; // por sesión: un bug que se repite no inunda el proyecto

/** El juego dice de dónde sacar el contexto de un fallo (se llama al crearlo). */
export function setCrashContext(f: () => unknown) {
  ctx = f;
}

/** `force`: el jugador aceptó el envío de diagnóstico por otra vía (el aviso de la versión WebGPU, GpuNotice.tsx). */
export function initTelemetry(force = false) {
  if (!DSN || on || !(force || getConsent()?.reports)) return;
  on = true;
  void import('@sentry/browser').then((S) => {
    sdk = S;
    S.init({
      dsn: DSN,
      tracesSampleRate: 0,
      release: import.meta.env.VITE_RELEASE as string | undefined,
      environment: import.meta.env.MODE,
      integrations: (d) => d.filter((i) => i.name !== 'Breadcrumbs'), // (sin migas de pan: llevan URLs y entradas del jugador)
      beforeSend(e) {
        try {
          e.contexts = { ...e.contexts, game: ctx?.() as Record<string, unknown> };
        } catch {
          /* sin contexto */
        }
        if (e.user) delete e.user;
        return e;
      },
    });
    queue.splice(0).forEach((f) => f());
  });
}

/**
 * Un fallo que no tumba el juego (aviso de three, textura que no carga, tirón, posición NaN...): un informe por tipo y mensaje y sesión,
 * con un tope por sesión. Sin permiso o sin DSN no hace nada. `extra` va como datos del informe (sin nada personal).
 */
export function report(kind: string, msg: string, level: 'info' | 'warning' | 'error' = 'warning', extra?: Record<string, unknown>) {
  if (!on || sent >= MAX_REPORTS) return;
  const key = kind + msg.replace(/\d+(\.\d+)?/g, '#').slice(0, 160); // (los números varían: «12 ms» y «15 ms» son el mismo tirón)
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  const send = () => sdk?.withScope((sc) => (sc.setLevel(level), sc.setTag('kind', kind), sc.setFingerprint([key]), sc.setExtras({ ...extra, ...(ctx?.() as Record<string, unknown> | undefined) }), sdk?.captureMessage(`[${kind}] ${msg.slice(0, 500)}`)));
  if (sdk) send();
  else queue.push(send);
}

// vigilante de fotogramas: tirones, ritmo bajo sostenido y posición corrupta (se llama una vez por fotograma desde el juego)
let slowT = 0, slowN = 0, slowSum = 0;
export function bugWatch(dt: number, paused: boolean, pos?: { x: number; y: number; z: number }) {
  if (!on || paused || document.hidden) return (slowT = slowN = slowSum = 0);
  if (pos && !(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z))) report('nan', 'player position is not finite', 'error');
  else if (pos && Math.abs(pos.x) + Math.abs(pos.z) > 1e5) report('oob', 'player far outside the map', 'error', { x: Math.round(pos.x), z: Math.round(pos.z) });
  if (dt > 1) return report('hitch', `frame stall of ${Math.round(dt * 1000)} ms`, 'warning', { ms: Math.round(dt * 1000) });
  slowT += dt;
  slowN++;
  slowSum += dt;
  if (slowT >= 12) {
    const fps = slowN / slowSum;
    if (fps < 20) report('slow', `sustained low fps (${Math.round(fps)})`, 'warning', { fps: Math.round(fps) });
    slowT = slowN = slowSum = 0;
  }
}
