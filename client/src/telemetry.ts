/*
 * Informes de fallo a GlitchTip (compatible con la API de Sentry). Solo si hay VITE_SENTRY_DSN (client/.env.local) Y el jugador lo ha aceptado
 * en las condiciones (consent.ts). Sin datos personales: sin PII por defecto, sin replay ni trazas; cada informe lleva nivel, planta, semilla
 * y posición (Game.crashContext). El SDK se carga en diferido: sin DSN o sin permiso no pesa nada.
 */
import { getConsent } from './consent';
import { dlogLines } from './dlog';

/** Solo se recoge en las dos versiones publicadas (la clásica y la nueva): ni localhost, ni previews, ni copias en otros dominios. */
const HOSTS = ['legacybackrooms.s7lver.xyz', 'backrooms.s7lver.xyz'];
export const telemetryHost = () => HOSTS.includes(location.hostname);

/** Qué significa cada tipo de informe y por dónde empezar a mirar (va en cada informe). */
const KINDS: Record<string, string> = {
  nan: 'La posición del jugador dejó de ser un número finito: física, colisión o un teletransporte corrupto.',
  oob: 'El jugador está muy lejos del mapa: se salió de la colisión o una posición se corrompió.',
  hitch: 'Un fotograma tardó más de 1 s (carga de un nivel o modelo, GC, shader que compila, GPU bloqueada o pestaña en segundo plano).',
  slow: 'Ritmo sostenido por debajo de 20 fps durante 12 s: mira gpu, quality, res y renderMs del contexto.',
  level: 'Un nivel no pudo cargarse; el jugador se queda sin mapa.',
  'console.error': 'El juego escribió un console.error (los errores de shader de three salen aquí).',
  'console.warn': 'Aviso de render (three/WebGL/texturas/glb) escrito en consola.',
  webgl: 'Se perdió o recuperó el contexto WebGL: el driver de la GPU lo tiró (memoria, reinicio del driver, otra pestaña).',
  engine: 'Error o aviso del motor Phoenyx (WebGPU, renderer en Rust/wasm): shader, pipeline, textura o panic.',
  'engine-device': 'WebGPU: el dispositivo GPU se perdió o la validación falló (device lost / uncaptured error).',
  'webgpu-session': 'Inicio de una sesión Phoenyx/WebGPU (informativo): en qué GPU y navegador corre el motor.',
};

/** El entorno de la sesión: navegador, pantalla, memoria y GPU (adaptador WebGPU si lo hay). Sin nada personal. */
const env: Record<string, unknown> = {};
type Adapter = { info?: Record<string, string>; features?: Set<string>; limits?: Record<string, number> } | null;
function gather() {
  try {
    const n = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } };
    Object.assign(env, {
      engine: 'phoenyx (WebGPU)',
      host: location.hostname,
      ua: n.userAgent,
      platform: (n as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? n.platform,
      lang: n.language,
      cores: n.hardwareConcurrency,
      memGB: n.deviceMemory,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
      zoom: Math.round((outerWidth / innerWidth) * 100) / 100,
      net: n.connection ? `${n.connection.effectiveType} ${n.connection.downlink}Mb/s rtt${n.connection.rtt}${n.connection.saveData ? ' saveData' : ''}` : undefined,
      secure: isSecureContext,
      webgpu: !!(n as unknown as { gpu?: unknown }).gpu,
      sw: !!n.serviceWorker?.controller,
      standalone: matchMedia('(display-mode: standalone)').matches,
    });
    const gpu = (n as unknown as { gpu?: { requestAdapter(): Promise<Adapter> } }).gpu;
    void gpu
      ?.requestAdapter()
      .then((a) => {
        if (!a) return void (env.adapter = 'none');
        const i = a.info ?? {};
        env.adapter = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ') || 'unknown';
        env.gpuFeatures = a.features?.size;
        env.maxTexture2D = a.limits?.maxTextureDimension2D;
        env.maxBuffer = a.limits?.maxBufferSize;
      })
      .catch(() => (env.adapter = 'error'));
  } catch {
    /* sin entorno */
  }
}

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
  if (!DSN || on || !telemetryHost() || !(force || getConsent()?.reports)) return;
  on = true;
  gather();
  void import('@sentry/browser').then((S) => {
    sdk = S;
    S.init({
      dsn: DSN,
      tracesSampleRate: 0,
      release: import.meta.env.VITE_RELEASE as string | undefined,
      environment: location.hostname === 'backrooms.s7lver.xyz' ? 'phoenyx' : 'legacy',
      initialScope: { tags: { engine: 'phoenyx' } },
      integrations: (d) => d.filter((i) => i.name !== 'Breadcrumbs'), // (sin migas de pan: llevan URLs y entradas del jugador)
      beforeSend(e) {
        try {
          const g = ctx?.() as { level?: string; quality?: string } | undefined;
          e.contexts = { ...e.contexts, game: g as Record<string, unknown>, env: { ...env, visible: document.visibilityState, online: navigator.onLine, uptimeS: Math.round(performance.now() / 1000), viewport: `${innerWidth}x${innerHeight}` } };
          e.tags = { ...e.tags, level: String(g?.level ?? '-'), quality: String(g?.quality ?? '-'), adapter: String(env.adapter ?? '-').slice(0, 60) };
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
  const recent = dlogLines().slice(-12); // (las últimas acciones del juego: recogidas, ascensor, misión...)
  const send = () =>
    sdk?.withScope((sc) => {
      sc.setLevel(level);
      sc.setTag('kind', kind);
      sc.setFingerprint([key]);
      sc.setExtras({ what: KINDS[kind] ?? kind, detail: msg.slice(0, 4000), ...extra, ...(ctx?.() as Record<string, unknown> | undefined), recentEvents: recent });
      sdk?.captureMessage(`[${kind}] ${msg.split('\n')[0].slice(0, 200)}`);
    });
  if (sdk) send();
  else queue.push(send);
}

// vigilante de fotogramas: tirones, ritmo bajo sostenido y posición corrupta (se llama una vez por fotograma desde el juego)
let slowT = 0, slowN = 0, slowSum = 0;
export function bugWatch(dt: number, paused: boolean, pos?: { x: number; y: number; z: number }) {
  if (!on || paused || document.hidden) return (slowT = slowN = slowSum = 0);
  if (pos && !(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z))) report('nan', 'player position is not finite', 'error');
  else if (pos && Math.abs(pos.x) + Math.abs(pos.z) > 1e5) report('oob', 'player far outside the map', 'error', { x: Math.round(pos.x), z: Math.round(pos.z) });
  if (dt > 20) return; // (volver de una pestaña en segundo plano o de la suspension: no es un tiron del juego)
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
