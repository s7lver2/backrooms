# Backrooms: herramientas para mejorar el DESARROLLO

Informe de 15-nov-2026. Versiones, fechas, licencias y rangos de compatibilidad verificados contra el registro de npm y PyPI. Precios, políticas y servicios, por búsqueda web. No se ha tocado el repositorio: los ejemplos no están ejecutados.

---

## 1. Resumen

- **Ya:** Biome (lint, formato y reglas que atrapan errores típicos de IA), una prueba de humo con Playwright en CI y un panel lil-gui. Cada uno cabe en una tarde.
- **Después:** HMR con `dispose`, Sentry (o GlitchTip) con semilla y posición, y replay + hash de estado en `shared` para cazar desincronizaciones sin dependencias nuevas.
- **Mantenimiento:** Vite 5 no publica desde oct-2025 (última 5.4.21), mientras Vite 7.3.8 salió el 9-nov-2026. Sube a Vite 7 u 8 con Node ≥22.12. Vitest 5 exige Vite ≥6.4, así que con Vite 5 no sirve.
- **No merece la pena:** Vite+/Vite DevTools, Nx/Turbo, k6/Grafana, BrowserStack, session replay, una suite de tests formal y R3F/leva.
- **Escritorio:** si habrá Steam, Electron + Forge + steamworks.js. Tauri 2 encaja si no necesitas Steam. La firma en Windows depende del país y de si eres persona o empresa.

---

## 2. Top 10 por impacto/esfuerzo

### 1. Biome 2.6.8 en lugar de ESLint + Prettier (≈2 h)

- **Qué es:** un solo binario para lint, formato y orden de imports. Su versión 2 añade reglas con tipos sin necesitar tsc, soporte de monorepo y plugins GritQL.
- **Problema:** las IAs dejan promesas sin `await`, imports muertos y ciclos `client`↔`shared`. Las reglas `noFloatingPromises` y `noMisusedPromises` están en el dominio *types* (aún nursery). `noImportCycles` y `noUndeclaredDependencies` están en el dominio *project*. Ambos dominios escanean todo el proyecto, con coste de rendimiento.
- **Por qué no ESLint:** ESLint 10 eliminó el sistema eslintrc y typescript-eslint 8.72 solo admite TypeScript <6.1, es decir, no TS 7. Biome no depende de tsc.
- **Integración:** `npm i -D -E @biomejs/biome`, `npx biome init`, `npx biome check --write .` (un único commit de formato) y script `"lint": "biome check ."`.

### 2. Bucle de desarrollo con Vite + HMR seguro para three.js (≈3 h)

- **Problema:** `python tools/build.py` en cada cambio es lento. Un HMR ingenuo duplica escenas y pierde memoria.
- **Integración:** `vite` como bucle diario y `build.py` solo para empaquetar. Registra `import.meta.hot.dispose` para cancelar el rAF, cerrar el socket y liberar geometrías, materiales, texturas y composer (ver ejemplo B).
- **Actualiza a Vite 7 u 8:** Vite 8 salió el 12-mar-2026 con Rolldown como bundler único. Vite 8.1 (jun-2026) añade un modo de desarrollo empaquetado, experimental. Vite 7 es el salto más suave. Ambos piden Node ≥20.19 o ≥22.12.

### 3. Prueba de humo con Playwright + GitHub Actions (≈4 h, opcional)

- **Problema:** romper el arranque sin notarlo.
- **Qué comprueba:** abre `?suites&god&seed=…`, falla si hay errores de consola y comprueba `renderer.info.render.calls` contra un presupuesto.
- **WebGL en CI:** un proyecto real usa los flags `--use-angle=swiftshader`, `--enable-unsafe-swiftshader` y `--ignore-gpu-blocklist` para que el visor 3D inicialice en CI sin GPU.
- **Integración:** ver ejemplo C. El workflow usa ubuntu-latest, Node 22, `npm ci`, `tsc --noEmit`, build y `npx playwright test`.

### 4. Panel de depuración: lil-gui + Needle Inspector + Spector.js (≈2 h)

- **Problema:** retocar luces, niebla y bloom a golpe de recarga.
- **lil-gui 0.21.0:** panel con `?debug` para luces, niebla, bloom y grano, y un botón «copiar JSON» para pegar los valores en el código.
- **Needle Inspector:** extensión gratuita de Chrome que inspecciona y edita cualquier escena three.js y admite MCP para depuración con IA. Licencia y versión sin verificar.
- **Spector.js 0.9.33:** capturas de un frame WebGL. stats-gl, solo si quieres FPS en pantalla.

### 5. Sentry (o GlitchTip) con semilla y posición (≈2 h)

- **Problema:** «se me colgó en el hotel» sin datos reproducibles.
- **Integración:** `@sentry/browser` y `@sentry/node` 11.12.0 con `Sentry.setContext('game', { level, seed, pos })` refrescado cada segundo y `sendDefaultPii: false`. Para sourcemaps, `@sentry/vite-plugin`.
- **Coste:** el plan Developer gratis incluye 5.000 errores/mes y un usuario; Team parte de 26 $/mes.
- **Alternativa autoalojada:** GlitchTip es open source (MIT), compatible con la API de Sentry y autoalojable. Su plan alojado gratis da 1.000 eventos/mes.
- **Privacidad:** hay cuentas y voz, así que revisar el RGPD antes de enviar datos de jugadores.

### 6. Replay de entradas + detector de desincronización en `shared` (≈6 h, sin dependencias)

- **Problema:** que cliente y servidor diverjan sin que nadie lo vea.
- **Grabación:** guarda `{seed, ticks:[{t, playerId, input}]}` y reprodúcelo con `?replay=archivo.json`.
- **Hash de estado:** FNV-1a sobre posiciones cuantizadas cada 30 ticks. El cliente envía el hash y el servidor, si no coincide, emite `desync` y registra semilla y tick.
- **Barandillas de determinismo:** en `shared/tsconfig` usa `"lib": ["ES2022"]` y `"types": []` para que no compile con DOM ni Node. Prohíbe `Math.random` y `Date.now` en `shared` con un plugin GritQL de Biome.
- **Prueba de CI:** con `node --test`, ejecuta la simulación dos veces con la misma semilla y compara hashes.

### 7. Simulación de red + bots de carga con socket.io-client (≈4 h)

- **Latencia y jitter:** una bandera de desarrollo `LAG_MS=80 JITTER_MS=40` que retrasa los `emit` del servidor (~25 líneas).
- **Pérdida real:** a nivel TCP. Toxiproxy es un binario único con API HTTP para inyectar latencia y cortes. En Windows, clumsy es la opción habitual.
- **Aviso sobre DevTools:** informes antiguos indican que la limitación de red del navegador no afecta a los WebSockets. No verificado en el Chrome actual.
- **Bots:** `tools/bots.mjs` crea 10–50 clientes que entran en salas y mide el tiempo de tick. Artillery solo si se quieren rampas de carga.

### 8. Puerta de calidad para GLB + manifiesto de assets (≈3 h)

- **Qué es:** `npx @gltf-transform/cli inspect modelo.glb` (4.5.1) y `validate`, más un `tools/check_glb.mjs` con `@gltf-transform/core`. Falla si hay más de N materiales o huesos, texturas >2048 o altura fuera de rango (escala).
- **Integración:** engánchalo a `pack_glb.py`.
- **Hashes:** genera `assets-manifest.json` con sha1 y tamaño. Los archivos de `public/` no llevan hash en Vite, así que cárgalos por manifiesto o con `?v=hash`.

### 9. Higiene de dependencias (≈2 h)

- **Cooldown de versiones nuevas:** `min-release-age=3` en `.npmrc`. npm lo trae desde la 11.10.0 (feb-2026). Una fuente dice que algunas versiones de npm 11 lo ignoran, así que hay que probar que funciona.
- **Dependabot en vez de Renovate:** Dependabot espera ya tres días antes de abrir PRs de versiones nuevas. Renovate (AGPL-3.0, Node ≥24.11) pide infraestructura.
- **En CI:** `npm audit --omit=dev`, y `npx knip` (6.45.1) una vez al mes para detectar código y dependencias muertas.

### 10. Flujo con IA: hooks, MCP y registro de decisiones (≈3 h)

- **Hooks con lefthook 2.2.2:** ejecuta `python tools/check_staged_files.py`, `biome check --staged` y `tsc --noEmit`. Se prefiere a Husky porque ejecuta cualquier comando en paralelo y no es un script de Node.
- **MCP:** `chrome-devtools-mcp` 1.13.0 (Apache-2.0) deja que el agente abra el juego, lea la consola y capture pantallas. `@upstash/context7-mcp` 4.7.0 da documentación actual de three y Vite. `@playwright/mcp` 0.0.85 es opcional.
- **Decisiones:** `docs/DECISIONES.md` con «decisión / por qué / no tocar sin…», enlazado desde el archivo de contexto de la IA.

---

## 3. Tablas por área

**Leyenda.** Tamaño = instalado en npm (no peso en el bundle). Compat. = Vite 5 / TS / three 0.160 / Windows. «indep.» = no depende de Vite ni three. «?» = no verificado. Versión y fecha salen del registro de npm.

### Área 1 · Flujo diario

| Herramienta | Para qué | Versión | Últ. pub. | Tamaño / coste | Licencia | Enlace | Riesgo | Compat. |
|---|---|---|---|---|---|---|---|---|
| Biome | lint + formato + imports | 2.6.8 | nov-26 | 1,1 MB + binario | MIT/Apache-2.0 | biomejs.dev | Bajo | indep.; TS ✓ sin tsc; Win ✓ |
| ESLint (no recomendado) | lint | 10.15.0 | nov-26 | 3 MB | MIT | eslint.org | Medio | typescript-eslint solo TS <6.1 |
| vite-plugin-checker (opcional) | typecheck en overlay | 1.0.0 | nov-26 | 0,5 MB | MIT | npmjs.com/package/vite-plugin-checker | Medio | Vite ≥5.4.21 ✓; Node ^22.22 o ≥24.11 |
| lil-gui | parámetros en vivo | 0.21.0 | oct-25 | 226 KB | MIT | lil-gui.georgealways.com | Bajo | indep.; Win ✓ |
| Tweakpane (descartado) | idem | 4.0.5 | nov-24 | 447 KB | MIT | tweakpane.github.io | Bajo | >18 meses, estable |
| Needle Inspector | inspector Chrome de escena | ? | ? | gratis | ? | engine.needle.tools | Medio | cualquier three; solo Chrome |
| Spector.js | captura de frame WebGL | 0.9.33 | sep-26 | 1,4 MB | MIT | npmjs.com/package/spectorjs | Bajo | WebGL ✓ |
| stats-gl (opcional) | FPS / ms CPU-GPU | 4.2.3 | jul-26 | 4,5 MB | MIT | npmjs.com/package/stats-gl | Bajo | indep. |
| @sentry/browser + node | errores con contexto | 11.12.0 | nov-26 | gratis 5.000/mes, 1 usuario | MIT (SDK) | sentry.io | Bajo | Node ≥20.19 |
| GlitchTip | alternativa autoalojada | ? | — | gratis self-host | MIT | glitchtip.com | Medio | indep. |
| pino + pino-pretty | log JSON servidor | 10.4.0 / 13.2.0 | oct-26 | 706 KB | MIT | getpino.io | Bajo | Win ✓ |
| knip | código y deps muertos | 6.45.1 | nov-26 | 1,6 MB | ISC | knip.dev | Bajo | Node ^20.19/≥22.12 |
| Dependabot | PRs de actualización | servicio | — | gratis | — | docs.github.com | Bajo | indep. |
| Renovate (alternativa) | idem | 44.239.1 | nov-26 | — | AGPL-3.0 | docs.renovatebot.com | Medio | Node ^24.11 |
| depcheck (descartado) | deps sin uso | 1.4.7 | oct-23 | — | MIT | — | Alto (abandonado) | knip lo cubre |
| lefthook | hooks de git | 2.2.2 | oct-26 | 28 KB | MIT | github.com/evilmartians/lefthook | Bajo | Win ? |
| Vite (actualizar) | dev server / build | 7.3.8 · 8.3.8 | nov-26 | — | MIT | vite.dev | Medio (migración) | desde 5.4.21 (oct-25) |

### Área 2 · Contenido

| Herramienta | Para qué | Versión | Últ. pub. | Tamaño / coste | Licencia | Enlace | Riesgo | Compat. |
|---|---|---|---|---|---|---|---|---|
| glTF-Transform CLI | inspect, validate, scripts de auditoría | 4.5.1 | sep-26 | 440 KB + core 1,8 MB | MIT | gltf-transform.dev | Bajo | indep.; Win ✓ |
| gltf-validator (npm) | validación Khronos | 2.0.0-dev.3.10 | oct-24 | 383 KB | Apache-2.0 | npmjs.com/package/gltf-validator | Medio | >18 meses; usarlo vía `gltf-transform validate` |
| LDtk | editor 2D de rejillas, exporta JSON | ? | ? | gratis, uso comercial libre, enfocado a 2D | open source (licencia ?) | ldtk.io | Medio | indep.; Win ✓ |
| Tiled | editor de mapas por tiles | 1.11.2 (lo último que vi) | ene-25 | gratis | ? (aviso: puede ser copyleft) | mapeditor.org | Medio | indep. |
| Visor 2D propio `?mapviewer` | dibuja el mapa por semilla en un canvas | — | — | 0 deps | — | — | Bajo | usa `shared` |
| Rokoko (plugin Blender) | retargeting de clips | ? | ? | gratis | ? | rokoko.com | Medio | Blender 4.2–5.x |
| Mixamo | clips y autorig | — | — | gratis con Adobe ID, sigue funcionando pero en modo mantenimiento | licencia Adobe | mixamo.com | Medio | exporta FBX |
| Quaternius UAL 1–2 | biblioteca de animaciones CC0, más de 250 clips | — | — | gratis | CC0 | quaternius.com | Bajo | retargeting |
| ffmpeg-normalize | normaliza SFX por LUFS | 1.44.0 | nov-26 | necesita ffmpeg | MIT | pypi.org/project/ffmpeg-normalize | Bajo | encaja con Python; Win ✓ |
| zzfx | sonidos procedurales mínimos | 1.4.0 | oct-26 | 30 KB | MIT | npmjs.com/package/zzfx | Bajo | indep. |
| sharp (opcional) | redimensionar texturas | 0.35.5 | sep-26 | 962 KB + nativo | Apache-2.0 | sharp.pixelplumbing.com | Bajo | Win ✓ |
| audiosprite (descartado) | sprites de audio | 0.7.2 | ene-20 | — | sin licencia | — | Alto | abandonado |

### Área 3 · Multijugador

| Herramienta | Para qué | Versión | Últ. pub. | Tamaño / coste | Licencia | Enlace | Riesgo | Compat. |
|---|---|---|---|---|---|---|---|---|
| node:test | prueba de determinismo | incluido | — | 0 | — | nodejs.org | Bajo | Win ✓ |
| Replay + hash (propio) | desync detector | — | — | 0 deps | — | — | Bajo | usa `shared` |
| @socket.io/admin-ui | panel de sockets y salas | 0.5.1 | oct-22 | 4,8 MB | MIT | socket.io/docs/v4/admin-ui | Medio | >18 meses, estable; solo dev y con auth |
| Toxiproxy | latencia y cortes TCP | ? | ? | gratis | ? | github.com/Shopify/toxiproxy | Medio | Win ? |
| clumsy | jitter y pérdida en Windows | ? | ? | gratis | ? | jagt.github.io/clumsy | Medio | Win ✓ |
| Artillery | carga con engine socket.io | 2.0.34 | ago-26 | 1,6 MB | MPL-2.0 (copyleft de archivo) | artillery.io | Medio | socket.io de primera clase |
| k6 (descartado) | carga | 2.2.0 | ago-26 | gratis (nube de pago) | AGPL-3.0 | k6.io | Alto (licencia) | binario Go |
| @prometheus-io/client | métricas `/metrics` | 0.16.1 | ago-26 | 185 KB | Apache-2.0 | npmjs.com/package/@prometheus-io/client | Medio | Node ^22/^24/≥26 |
| prom-client (descartado) | idem | 15.1.3 | jun-24 | — | Apache-2.0 | — | Medio | el paquete pasó a llamarse @prometheus-io/client |

### Área 4 · Calidad y publicación

| Herramienta | Para qué | Versión | Últ. pub. | Tamaño / coste | Licencia | Enlace | Riesgo | Compat. |
|---|---|---|---|---|---|---|---|---|
| Playwright | humo + emulación móvil | 1.65.1 | nov-26 | 5 MB + Chromium | Apache-2.0 | playwright.dev | Bajo | Node ≥20; Win ✓ |
| @axe-core/playwright (opcional) | accesibilidad de la UI React | 4.14.0 | oct-26 | 48 KB | MPL-2.0 | npmjs.com/package/@axe-core/playwright | Bajo | Node ≥22.12 |
| release-please | changelog desde commits | 17.11.2 | ago-26 | gratis | Apache-2.0 | github.com/googleapis/release-please | Bajo | Node ≥22 |
| @changesets/cli (descartado) | idem | 3.0.3 | sep-26 | gratis | MIT | — | Bajo | pide un archivo por cambio |
| Electron + Forge | escritorio con Steam | 45.3.2 / 8.0.1 | nov-26 / sep-26 | Chromium propio | MIT | electronjs.org | Medio | Forge: Node ≥22.13 |
| electron-builder (alternativa) | empaquetado | 26.18.0 | oct-26 | — | MIT | electron.build | Bajo | — |
| Tauri CLI | escritorio ligero | 2.12.4 | oct-26 | — | Apache-2.0/MIT | v2.tauri.app | Medio | WebView2 en Windows, otros motores en macOS y Linux |
| Azure Artifact Signing | firma en Windows | servicio | — | ≈9,99 $/mes; organizaciones de EE. UU., Canadá, UE y Reino Unido; personas solo EE. UU. y Canadá | — | learn.microsoft.com | Medio (elegibilidad) | Win ✓ |
| Certificado OV | firma alternativa | — | — | 150–300 $/año | — | — | Bajo | Win ✓ |
| steamworks.js | logros, overlay, nube | 0.4.0 | ago-24 | 8,8 MB | MIT | npmjs.com/package/steamworks.js | Medio | >18 meses; incluye helper de overlay para Electron |
| Fly.io | servidor + volumen | servicio | — | ver sección 4 y Dudas | — | fly.io | Medio | WebSocket ✓ |
| Hetzner CX23 | VPS fijo | servicio | — | 5,49 €/mes (2 vCPU, 4 GB) tras la subida de jun-26 | — | hetzner.com | Medio | un blog reporta los planes CX no pedibles en oct-26 |
| Railway | alternativa PaaS | servicio | — | 20 $/vCPU/mes, 10 $/GB RAM, 0,15 $/GB volumen | — | railway.com | Medio | — |
| i18next | traducción cuando haga falta | 27.1.2 | nov-26 | 599 KB | MIT | i18next.com | Bajo | indep. |
| Paraglide JS | alternativa con claves tipadas | 3.2.2 | nov-26 | 4,5 MB | MIT | inlang.com | Medio | peer vite ≥5 ✓ |

### Área 5 · Trabajo con IA

| Herramienta | Para qué | Versión | Últ. pub. | Tamaño / coste | Licencia | Enlace | Riesgo | Compat. |
|---|---|---|---|---|---|---|---|---|
| chrome-devtools-mcp | agente abre el juego, lee consola, captura | 1.13.0 | nov-26 | 16 MB | Apache-2.0 | npmjs.com/package/chrome-devtools-mcp | Medio | Node ^20.19/≥22.12; Win ? |
| @upstash/context7-mcp | documentación actual de librerías | 4.7.0 | nov-26 | 249 KB | MIT | npmjs.com/package/@upstash/context7-mcp | Bajo | Win ? |
| @playwright/mcp | agente maneja Playwright | 0.0.85 | nov-26 | 96 KB | Apache-2.0 | npmjs.com/package/@playwright/mcp | Medio (0.0.x) | Win ? |
| Reglas de Biome (`noFloatingPromises`, `noImportCycles`) | atrapar errores de IA | en Biome 2.6.8 | — | 0 | MIT/Apache-2.0 | biomejs.dev | Bajo | ver Top 1 |
| dependency-cruiser (opcional) | fronteras `client`/`server`/`shared` | 18.7.2 | nov-26 | 1 MB | MIT | npmjs.com/package/dependency-cruiser | Bajo | Win ? |
| zod (opcional) | validar payloads de socket.io | 4.6.7 | oct-26 | 6 MB | MIT | zod.dev | Bajo | TS ✓ |

---

## 4. Lo que NO se recomienda

- **Vite+ 1.0 y Vite DevTools:** Vite+ llegó a 1.0 en oct-2026, pero cambiar la cadena entera no resuelve ningún problema del proyecto. `@vitejs/devtools` está en 0.8.x y su integración nativa llegó con Vite 8.
- **Nx, Turborepo, wireit:** excesivos para tres workspaces.
- **k6 y Grafana:** k6 es AGPL-3.0, y para un Prometheus completo con `@prometheus-io/client` no hay tráfico que lo justifique. Basta un endpoint `/debug/metrics` en JSON.
- **BrowserStack y similares:** Playwright con emulación de móvil, más un teléfono real en la misma red con Chrome remote debugging, cubren lo mismo gratis. El coste de BrowserStack no está verificado.
- **Session replay de Sentry, tracing y profiling:** no aportan para un juego y suben el coste.
- **Suite de tests formal (Vitest, Jest, Storybook):** contradice las restricciones del equipo.
- **R3F y leva:** obligarían a reescribir el juego sobre React.
- **Cloudflare para el servidor:** `better-sqlite3` es un módulo nativo. No probado en Workers, y lo habitual sería reescribir el servidor sobre otro almacenamiento.
- **`ffmpeg-static`:** es GPL-3.0. Usar el ffmpeg del sistema solo en desarrollo.
- **Elección de alojamiento:** Fly.io para el servidor. Un shared-cpu-1x de 256 MB cuesta 2,19 $/mes y la RAM extra, 6 $/GB; no hay plan gratuito, 1 GB sale a 6,70 $ y los volúmenes a 0,15 $/GB. Calcula entre 7 y 8 $/mes con una sola máquina y un volumen. Los snapshots de volumen cuestan 0,08 $/GB. Hetzner es la alternativa si se prefiere coste fijo y administrar el servidor.
- **SQLite en una sola instancia:** no escalar horizontalmente. Para copias de seguridad, `db.backup()` de better-sqlite3, que no necesita dependencias nuevas.

**Avisos de licencia (casi todo es solo de desarrollo):**

- MPL-2.0: Artillery y axe-core.
- AGPL-3.0: k6 y Renovate.
- GPL-3.0: ffmpeg-static.
- FSL-1.1-MIT: `@sentry/cli`.
- Sin verificar: el editor Tiled.
- gsap, que ya está en el stack, usa la licencia propia «no charge» de GSAP, no MIT. Conviene leerla antes de vender.

---

## 5. Ejemplos mínimos

### A. `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.6.8/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["client/src/**", "server/src/**", "shared/src/**", "tools/**/*.mjs"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "rules": {
      "recommended": true,
      "nursery": {
        "noFloatingPromises": "error",
        "noMisusedPromises": "error",
        "noImportCycles": "warn"
      },
      "correctness": {
        "noUnusedImports": "warn",
        "noUnusedVariables": "warn",
        "useExhaustiveDependencies": "warn"
      },
      "suspicious": { "noExplicitAny": "warn" }
    }
  }
}
```

Las reglas nursery pueden cambiar de grupo en versiones futuras. Si `biome check` protesta, mirar el aviso.

### B. HMR seguro (`client/src/main.ts`)

```ts
import * as THREE from 'three';
import { createGame } from './game/createGame'; // devuelve { scene, renderer, composer, dispose }

let game = createGame(document.getElementById('app')!);

export function disposeScene(g: ReturnType<typeof createGame>) {
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
  g.composer.dispose();
  g.renderer.renderLists.dispose();
  g.renderer.dispose();
  g.renderer.forceContextLoss();
  g.renderer.domElement.remove();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();      // cancela rAF, quita listeners, cierra socket
    disposeScene(game);
  });
  import.meta.hot.accept();
}
```

Supone que `createGame` devuelve esos campos. Ajustar nombres al código real.

### C. Prueba de humo (`playwright.config.ts` y `tests/smoke/boot.spec.ts`)

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run build -w client && npm run preview -w client -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
});

// tests/smoke/boot.spec.ts
import { test, expect } from '@playwright/test';
test('Las Suites arranca sin errores y respeta el presupuesto', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?suites&god&seed=123');
  await page.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 45_000 });
  await page.waitForTimeout(2000);
  const calls = await page.evaluate(() => (window as any).__game.renderer.info.render.calls);
  expect(errors).toEqual([]);
  expect(calls).toBeLessThan(400); // ajustar al presupuesto real
});
```

Supone que `window.__game` expone `ready` y `renderer`, y que el cliente tiene un script `preview`.

---

## 6. Orden de adopción

- **Hoy:** Biome, lefthook con `check_staged_files.py`, panel lil-gui, Needle Inspector y Spector.js, Sentry (o GlitchTip), `min-release-age` y Dependabot, y `docs/DECISIONES.md`.
- **Este mes:** subir a Vite 7 u 8, HMR con `dispose`, prueba de humo + CI, replay + hash de estado, simulación de red + bots, puerta GLB + manifiesto, visor 2D de mapas y despliegue en Fly.io.
- **Cuando haga falta:**
  - empaquetado de escritorio (Electron + Forge, o Tauri), firma en Windows y Steam
  - i18next y accesibilidad con axe
  - Artillery, métricas Prometheus y release-please
  - LDtk, Rokoko y BrowserStack

**Steam:**

- La cuota de Steam Direct es de 100 $ por juego y se recupera al llegar a 1.000 $ de ingresos.
- La página de tienda debe verse como «próximamente» al menos dos semanas, y la revisión del build tarda entre 3 y 5 días laborables.
- Con Steam, la actualización la hace Steam, así que no hace falta `electron-updater`.
- Con Tauri no hay runtime de Node, así que las llamadas a Steam irían por el lado Rust.

---

## 7. Dudas

1. ¿Qué hace exactamente `tools/build.py`? ¿Es solo para empaquetar o también para desarrollo? Decide cuánto se puede sustituir por `vite`.
2. ¿Qué versión de Node, TypeScript y npm se usan? Varias herramientas piden Node ≥22.12 y `min-release-age` necesita npm ≥11.10.
3. ¿El repositorio está en GitHub, público o privado? Los minutos de Actions de un repositorio privado no están verificados.
4. ¿`window.__game` expone `ready`, `renderer` y la semilla? Se supone en el ejemplo C y en el contexto de Sentry.
5. ¿Hay Steam o venta directa, y es persona física o empresa? La firma de Windows depende de eso y del país.
6. ¿Cuántos jugadores concurrentes se esperan? Decide si 512 MB–1 GB en una sola máquina basta.
7. ¿Hay presupuesto para Sentry de pago, o se prefiere GlitchTip autoalojado?
8. ¿Cuál es la prioridad en móvil: táctil jugable o solo no romper?
9. ¿Se traducirá el juego? Si no, no tocar i18n.

---

## 8. Fuentes y límites

**Verificado:**

- Versión, fecha de publicación, licencia, `engines`, `peerDependencies` y avisos de deprecación de unos 100 paquetes, leídos del registro de npm y PyPI el 15-nov-2026. Incluye que Vite 5 no tiene versiones desde oct-2025 y que `prom-client` está marcado como reemplazado.
- Anuncios de Vite 8 y 8.1, ESLint 10, Biome 2 y las reglas de sus dominios *types* y *project*.
- Precios de Fly.io, Hetzner, Railway y Sentry, y la elegibilidad de la firma en Windows.
- Condiciones de Steam y las comparativas de carga y red.

**No verificado:**

- Licencias y versiones actuales de Needle Inspector, GlitchTip, Toxiproxy, clumsy, LDtk, Tiled, Rokoko y Auto-Rig Pro. La API de GitHub bloqueó por límite de peticiones, así que no se pudieron leer sus fechas de publicación.
- Si el limitador de red de Chrome sigue sin afectar a WebSockets: se basa en informes antiguos.
- El precio de Render, los minutos gratuitos de GitHub Actions y el coste de BrowserStack.
- El comportamiento en Windows 11 de lefthook, Toxiproxy y los servidores MCP. Los requisitos de Node sí se vieron.
- El peso en bundle de Sentry y stats-gl: la columna «tamaño» es de instalación, no de bundle.
- Compatibilidad exacta con three 0.160: las herramientas de la lista no dependen de esa versión. Si se usa `@types/three`, debe coincidir con 0.160. La última de three es 0.187.
- Los tres ejemplos no se han ejecutado contra el repositorio.

**Fuentes de calidad desigual:** varias comparativas de precios y guías de Steam o Mixamo son blogs de terceros o de proveedores. Conviene contrastar con las páginas oficiales antes de decidir. Hay informes contradictorios sobre si `min-release-age` funciona en todas las versiones de npm 11.

### Fuentes web consultadas

- Vite 8: https://vite.dev/blog/announcing-vite8
- Vite 8.1: https://main.vitejs.dev/blog/announcing-vite8-1
- Vite+ 1.0: https://infoq.com/news/2026/10/cloudflare-viteplus-stable
- ESLint 10: https://infoq.com/news/2026/04/eslint-10-release
- Biome 2.6: https://biomejs.dev/zh-cn/blog/authors/emanuele-stoppa/
- Biome, dominios del linter: https://biomejs.dev/ru/linter/domains y https://biomejs.dev/pt-br/linter/domains
- Needle Inspector: https://engine.needle.tools/docs/three/needle-devtools-for-threejs-chrome-extension.md
- Playwright con SwiftShader: https://github.com/reeper316099/VariantScope/wiki/5.2-Web-E2E-Tests
- Sentry y alternativas: https://dupple.com/learn/best-free-error-tracking-tools y https://sentry.devcloudsoftware.com/blog/best-sentry-alternatives-2026
- Fly.io: https://fly.io/pricing-update/ , https://devtoolpicks.com/blog/best-fly-io-alternatives-indie-hackers-2026 y https://www.budgetforge.dev/tools/fly-io-pricing-2026
- Railway: https://findstack.com/resources/railway-vs-fly-io
- Hetzner: https://www.bitdoze.com/hetzner-cloud-review/ y https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans
- Firma de código en Windows: https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options y https://electronforge.io/guides/code-signing/code-signing-windows
- Red y WebSockets: https://medium.com/@ngzhian/chrome-offline-network-emulation-and-websocket-6ecc914e2308 y https://dev.to/instatunnel/stop-testing-on-perfect-networks-implementing-chaos-tunnels-for-resilient-uis-51oe
- Carga (k6 y Artillery): https://qaskills.sh/compare/k6-vs-artillery y https://devtoollab.com/blog/best-load-testing-tools
- Mixamo y animaciones: https://app.cinevva.com/guides/mixamo-to-blender-2026 y https://app.cinevva.com/guides/free-character-animations-rigging
- Cooldown de dependencias: https://news.lavx.hu/article/the-race-to-cool-down-dependencies-how-package-managers-are-fighting-supply-chain-attacks , https://simonwillison.net/tags/dependency-cooldowns/ y https://github.com/gabrielstuff/package-cooldown
- Steam con three.js: https://www.summerengine.com/es/make-great-games/threejs-game-on-steam
- LDtk y Tiled: https://www.itechguides.com/products/ldtk/ y https://thorbjorn.itch.io/tiled/devlog/98679/issues-view-more-useful-export-workflow-improved-and-more
- prom-client → @prometheus-io/client: https://raw.githubusercontent.com/prometheus/client_js/HEAD/CHANGELOG.md
