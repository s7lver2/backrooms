// Service worker del juego: lo que se instaló desde SETTINGS > STORAGE (cachés br-pack-*) se sirve desde el disco; todo lo demás va a la red como siempre.
// No toca las navegaciones (index.html siempre fresco: los archivos con hash de un paquete son inmutables, la página no) ni las peticiones con Range (audio).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || r.mode === 'navigate' || r.headers.has('range') || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    (async () => {
      for (const k of await caches.keys()) {
        if (!k.startsWith('br-pack-')) continue;
        const hit = await (await caches.open(k)).match(r);
        if (hit) return hit;
      }
      return fetch(r);
    })(),
  );
});
