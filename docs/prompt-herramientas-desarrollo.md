# Prompt: herramientas para mejorar el DESARROLLO de Backrooms (no el rendimiento)

> Este archivo es el encargo completo. Léelo entero antes de contestar. No tienes acceso al repositorio: todo lo que necesitas saber del proyecto está aquí. Si te falta algo, pregúntalo en la última sección, no lo inventes.

## Tu papel
Eres un ingeniero senior de herramientas para equipos pequeños que hacen juegos 3D en el navegador. Tu trabajo es **encontrar y evaluar herramientas, paquetes npm, extensiones y flujos** que hagan más rápido, seguro y agradable el desarrollo de este juego. Busca en la web, que tus datos estén al día (hoy es noviembre de 2026), y verifica cada recomendación: última versión, fecha de la última publicación, mantenimiento, tamaño, licencia y compatibilidad con mi stack. Si no puedes verificar algo, dilo claramente; no inventes paquetes ni versiones.

## Qué NO tienes que hacer
**El rendimiento del renderizado (draw calls, CPU de three.js, BatchedMesh, WebGPU, KTX2, etc.) ya está estudiado en otro informe.** No lo repitas. Aquí solo cuenta lo que mejora el *desarrollo*: cómo se construye, se prueba, se depura, se publica y se mantiene el juego, y cómo se crea su contenido.

## El proyecto
"Backrooms": juego de terror 3D en el navegador, para uno o varios jugadores (salas en tiempo real), con niveles (por ejemplo "Las Suites", un hotel; unas Poolrooms; un aparcamiento), entidades que persiguen al jugador, objetos, tienda, misiones, cuentas, amigos, chat y voz.

- **Monorepo npm workspaces**: `client`, `server`, `shared`.
- **Cliente**: TypeScript, Vite 5, React 18 (solo la interfaz), **three.js 0.160** con WebGLRenderer y EffectComposer (bloom, grano, VHS), gsap, socket.io-client, lucide-react. El juego en sí no usa React.
- **Servidor**: Node + Express + socket.io + better-sqlite3 + JWT.
- **`shared`**: la simulación de entidades (IA, mapas generados por semilla, reglas) corre **igual en cliente y servidor**.
- **Contenido**: modelos GLB/Sketchfab, animaciones propias (carpeta `anim` con JSON de variantes, bailes y agarres), texturas procedurales en canvas, mapas generados por código (laberintos, hoteles). Hay una carpeta `assets-src` y scripts en `tools/` (`build.py`, `package.py`, `pack_glb.py`, `anim_pack.mjs`).
- **Documentación** en `docs/`: arquitectura, especificaciones por fase, glosario y una guía para colaborar con IAs.
- **Panel de administración y depuración** dentro del juego (teletransporte, dios, noclip, capturas con semilla y posición, diagnóstico de GPU). Rutas de desarrollo tipo `?suites&god&seed=…` y un `window.__game` en consola.
- **Escritorio**: se estudia una versión Electron/Tauri (hay un documento sobre caché de shaders).
- Código y comentarios en **español**. Se trabaja en Windows 11, a veces con ayuda de IAs de programación.

## Cómo trabaja el equipo (restricciones)
- Equipo muy pequeño (1–3 personas) y proyecto personal: **lo mínimo que funcione**. Una dependencia nueva debe justificarse con el problema real que resuelve.
- **Sin suite de tests formal**: se evita el gasto en tests. Solo propón pruebas automáticas si son baratas y de alto valor (por ejemplo, una prueba de humo que arranque el juego), y márcalas como opcionales.
- **Un commit por funcionalidad terminada**, sin commits intermedios.
- Licencias compatibles con uso comercial (MIT, Apache-2.0, BSD, ISC, Zlib…). Avisa de cualquier copyleft (GPL, AGPL, MPL…).
- Todo debe funcionar en **Windows**, con Vite 5 y TypeScript, sin romper el soporte móvil y táctil.
- Descarta lo abandonado (sin publicar en 18 meses), salvo que sea estable y esté completo; dilo.

## Qué quiero que busques (por áreas)

### 1. Flujo de desarrollo diario
- Recarga en caliente fiable con three.js (que no deje fugas de memoria ni escenas duplicadas) y alternativas al arranque actual (`python tools/build.py`).
- Depuración visual: inspectores de escena three.js (por ejemplo extensiones de navegador o paneles tipo "tweakpane", "lil-gui", "leva" sin R3F), editores de parámetros en vivo para luces, materiales y niveles.
- Registro y trazas: logging estructurado en cliente y servidor, captura de errores en cliente (Sentry y alternativas autoalojadas o ligeras), reportes de fallos con la semilla y la posición del jugador.
- Linting y formato mínimos para TypeScript con monorepo (ESLint flat config, Biome u otros), y qué reglas importan de verdad en un proyecto de este tipo.
- Comprobación de tipos y de dependencias: `knip`, `depcheck`, `npm-check-updates`, auditoría de seguridad, Renovate/Dependabot.

### 2. Creación de contenido (niveles, modelos, animaciones)
- **Editores de niveles o de mapas** que puedan trabajar con mapas generados por código (rejillas, habitaciones, puertas, props), o formas baratas de visualizar y editar un mapa en 2D antes de generarlo en 3D.
- **Visores y validadores de GLB** (glTF Validator, gltf-viewer, Blender add-ons, glTF-Transform en modo inspección) para detectar modelos con demasiados materiales, escalas incorrectas o huesos de más antes de que lleguen al juego.
- **Herramientas de animación**: previsualizador de clips y retargeting (Mixamo, Blender), editores de IK o de poses, importación de variantes.
- **Tooling de audio**: edición, normalización y empaquetado de efectos de sonido; generación de sonidos de ambiente.
- Pipelines de assets automáticos: de `assets-src` a `public` con optimización, versionado y hashes.

### 3. Multijugador: depuración y calidad
- Cómo **reproducir partidas** (grabar y repetir entradas con la misma semilla), simular **latencia y pérdida de paquetes** y probar varias sesiones locales a la vez.
- Herramientas de inspección de socket.io (el admin UI oficial, Wireshark/Chrome DevTools), paneles de métricas del servidor (prom-client, Grafana Cloud gratis, etc.).
- Pruebas de carga baratas del servidor (artillery, k6) con salas simuladas.
- Cómo mantener `shared` determinista entre cliente y servidor: detectar divergencias entre simulaciones (hashes de estado, "desync detectors").

### 4. Calidad y publicación
- **Integración continua barata** (GitHub Actions u otra): typecheck, build y una prueba de humo con Playwright (abrir el juego, comprobar que carga sin errores de consola).
- Un **presupuesto de rendimiento en CI** (número de dibujos por escena con `renderer.info`) que falle si se supera. Solo la idea y la herramienta; el rendimiento en sí ya está estudiado.
- **Despliegue**: opciones para alojar cliente y servidor (Fly.io, Railway, Render, VPS, Cloudflare), con WebSocket, SQLite persistente y costes aproximados para un proyecto personal.
- **Versionado y registro de cambios** automáticos (changesets, release-please) y publicación de versión de escritorio (Electron Forge, electron-builder, actualizaciones automáticas, firma de código en Windows, Steam).
- **Accesibilidad, internacionalización y compatibilidad**: herramientas para probar en móviles reales y en varios navegadores (BrowserStack, Playwright, Chrome remote debugging), y librerías ligeras de i18n si el juego se traduce.

### 5. Trabajo con IA
Parte del código lo escriben asistentes de IA. Busca herramientas o prácticas que reduzcan errores en ese flujo: servidores MCP útiles para un proyecto Node/three.js, reglas de lint que atrapen errores típicos de IA, plantillas de contexto del proyecto, comprobaciones previas al commit (hay un script `check_staged_files.py`), y cómo documentar decisiones para que las IAs no las rompan.

## Formato de respuesta (obligatorio)
1. **Resumen de 5 líneas**: lo que más ayudaría ya, y lo que no merece la pena.
2. **Top 10 por impacto/esfuerzo**, en orden, cada uno con: qué es, qué problema resuelve en *este* proyecto, esfuerzo estimado en horas y cómo se integra (comando o pasos concretos).
3. **Una tabla por área** (las cinco de arriba) con columnas: herramienta · para qué · versión actual · última publicación · tamaño o coste · licencia · enlace · riesgo (bajo/medio/alto) · compatibilidad con Vite 5, TypeScript, three 0.160 y Windows.
4. **Lo que NO recomiendas**, aunque parezca atractivo, y por qué (por ejemplo, por ser demasiado pesado para un proyecto personal).
5. **Ejemplos mínimos** (≤30 líneas, TypeScript o configuración) de los tres primeros del Top 10.
6. **Orden de adopción propuesto** en tres tandas: «hoy», «este mes», «cuando haga falta».
7. **Dudas** que necesites resolver conmigo antes de recomendar más.
8. Un apartado final **«Fuentes y límites»**: qué verificaste y qué no.

Escribe en español, con tono directo y sin relleno. Si dos herramientas hacen lo mismo, recomienda una y justifica la elección en una frase.
