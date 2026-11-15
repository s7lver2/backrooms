/*
 * Informes de fallo a GlitchTip (compatible con la API de Sentry). Solo si hay VITE_SENTRY_DSN (client/.env.local) Y el jugador lo ha aceptado
 * en las condiciones (consent.ts). Sin datos personales: sin PII por defecto, sin replay ni trazas; cada informe lleva nivel, planta, semilla
 * y posición (Game.crashContext). El SDK se carga en diferido: sin DSN o sin permiso no pesa nada.
 */
import { getConsent } from './consent';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
let ctx: (() => unknown) | undefined;

/** El juego dice de dónde sacar el contexto de un fallo (se llama al crearlo). */
export function setCrashContext(f: () => unknown) {
  ctx = f;
}

export function initTelemetry() {
  if (!DSN || !getConsent()?.reports) return;
  void import('@sentry/browser').then((S) => {
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
  });
}
