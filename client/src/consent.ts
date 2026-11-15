/*
 * Condiciones de servicio y consentimiento (Terms.tsx). Se guardan en localStorage con la versión del texto: si TERMS_VERSION sube,
 * se vuelven a pedir. `reports` = el jugador acepta enviar informes de fallo anónimos (telemetry.ts); es opcional.
 */
export const TERMS_VERSION = 1;
const KEY = 'br-consent';

export interface Consent {
  v: number;
  reports: boolean;
  at: number;
}

export function getConsent(): Consent | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Consent | null;
    return c && c.v === TERMS_VERSION ? c : null;
  } catch {
    return null;
  }
}

export function setConsent(reports: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: TERMS_VERSION, reports, at: Date.now() } satisfies Consent));
  } catch {
    /* sin almacenamiento: se vuelve a pedir en la próxima visita */
  }
}
