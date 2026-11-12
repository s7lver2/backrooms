# Backrooms: hoja de ruta

Web aparte (antes era el easter egg de `s7lver2/webpage`, que queda congelado). Monorepo: `client/` (Vite + three), `server/` (Node + Socket.IO), `shared/` (tipos y puertos). Puertos fijos: cliente 5180, servidor 5181.

## Mejoras del juego base (en curso)
- [x] Mover el juego a este repo
- [x] Botón de sonido en el menú y en la pausa (se recuerda)
- [x] Escenas prerenderizadas en la estática del menú (salas con entidades bailando)
- [x] Fotos del inventario: clic para ampliar y descargar
- [x] Linterna con batería corta (90 s) y linternas de repuesto por el mapa
- [ ] Iluminación más realista (luz de área, parpadeo que afecta a las paredes, marcos de panel)
- [x] Agujeros del suelo (y salas de pozos: rejilla de fosos o campo con puente en cruz)
- [x] Mapa más pequeño y legible: zonas con forma y tono de luz propios (pozos, cubículos, oficinas, estanterías), más bucles; mobiliario con modelos de `/assets-src` (ver `client/public/models/CREDITS.md`)
- [ ] Pasillo elevado sobre un foso (la colisión actual solo tiene suelo a y=0)
- [ ] Props reutilizados de los modelos de `/galery`
- [ ] IK de manos nuevo + herramienta dev de agarres
- [ ] Animación de entrada (la tele) más trabajada

## Ideas anotadas (sin empezar)
1. **Cuentas**: usuario y contraseña, guardadas con hash (argon2id o bcrypt, nunca cifrado reversible), sesión por cookie httpOnly. La cuenta guarda logros y cosméticos.
2. **Pantalla principal nueva**: login/registro, ropero (cosméticos) y el resto del menú.
3. **Salas públicas y privadas**. Al unirse, una sala de espera con un ordenador: ahí se cambia el color de los cosméticos y se añaden props (conseguidos con logros). Cuando el dueño de la sala pulsa un botón, se abre una puerta a las backrooms, animación de cámara entrando y todos aparecemos dentro.
4. **Chat** en la sala de espera y en la partida.
5. **Niveles**: poolrooms y otros iconos (se diseñan poco a poco). Objetivo: exploración y llegar a un nivel final pasando antes por otros. Se mantiene la procedimentalidad, pero con niveles más grandes y más ricos.
6. **Hosting gratis** para el multijugador (ver abajo).
7. **Caché de shaders persistente** (solo en una app de escritorio, con caché de GPU propia y tamaño limitado; en la web no es posible): ver `docs/shader-cache-escritorio.md`. Ya hecho: ajuste SHADER WARM-UP (completo / rápido / perezoso).

## Notas de hosting
- Vercel sirve bien el cliente estático, pero sus funciones no mantienen WebSockets abiertos: el servidor de salas va en otro sitio.
- Candidatos gratis para el servidor en tiempo real: Cloudflare Workers + Durable Objects, Render (plan gratis, se duerme), una VM Always Free de Oracle, o el PC propio con un túnel de Cloudflare. Pendiente de decidir.
- Cuentas y logros: una base gratis (Upstash Redis, ya usada en el portfolio, o Turso/Neon).

## Bucle por rondas (hecho: servidor, protocolo y HUD mínimo)
- Dentro de una sala, en memoria del servidor: pizarra con 3 misiones votadas (fotos, cintas, sobrevivir, apagar teles), dinero común, tienda en el ordenador, inventario por jugador que se conserva si se sube vivo al ascensor, objetos soltados con Y, cobro o penalización del 25 % al acabar la ronda. Protocolo en `shared/src/missions.ts` y `shared/src/index.ts`.
- Pendiente (UI): pizarra y voto, tienda en el ordenador, arrastrar fuera del inventario para soltar, HUD de dinero.
