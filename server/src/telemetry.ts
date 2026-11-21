/*
 * Informes de fallo del servidor a GlitchTip (API tipo Sentry, sin SDK: un POST a /api/<proyecto>/store/). Solo si hay SERVER_SENTRY_DSN en el entorno.
 * Recoge excepciones sin capturar y promesas rechazadas, y `report()` para el resto. Un informe por tipo y mensaje y hora, con tope, y nada personal.
 */
import { randomUUID } from 'node:crypto';

const DSN = process.env.SERVER_SENTRY_DSN;
const MAX_PER_HOUR = 40;
const seen = new Map<string, number>();
let windowStart = Date.now(), sent = 0;

function target() {
  if (!DSN) return null;
  try {
    const u = new URL(DSN);
    const project = u.pathname.replace(/^\/+/, '');
    return { url: `${u.protocol}//${u.host}/api/${project}/store/`, key: u.username };
  } catch {
    return null;
  }
}
const T = target();

/** Manda un informe (no bloquea ni lanza nunca). `extra`: datos de apoyo (sin nada personal). */
export function report(kind: string, err: unknown, extra?: Record<string, unknown>, level: 'warning' | 'error' | 'fatal' = 'error') {
  if (!T) return;
  const now = Date.now();
  if (now - windowStart > 3600_000) (windowStart = now), (sent = 0), seen.clear();
  const e = err instanceof Error ? err : new Error(String(err));
  const key = kind + e.message.replace(/\d+/g, '#').slice(0, 160);
  if (sent >= MAX_PER_HOUR || seen.has(key)) return;
  seen.set(key, now);
  sent++;
  const body = {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: now / 1000,
    platform: 'node',
    level,
    logger: 'server',
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RELEASE,
    message: `[server:${kind}] ${e.message.split('\n')[0].slice(0, 200)}`,
    fingerprint: [key],
    tags: { kind, side: 'server' },
    extra: { stack: e.stack?.slice(0, 6000), node: process.version, uptimeS: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1048576), ...extra },
  };
  void fetch(T.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${T.key}, sentry_client=backrooms-server/1.0` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

if (T) {
  process.on('uncaughtException', (err) => report('uncaught', err, undefined, 'fatal'));
  process.on('unhandledRejection', (reason) => report('unhandled-rejection', reason));
}
