# Prompt: buscar herramientas y paquetes npm para Backrooms

Copia todo lo de debajo de la línea y pégalo en la IA (mejor una con búsqueda web).

---

Eres un ingeniero senior de rendimiento y herramientas para juegos 3D en el navegador. Ayúdame a encontrar **paquetes npm, librerías y herramientas de desarrollo** que mejoren mi proyecto. Busca en la web, que tus datos estén al día, y verifica cada paquete (última versión, última publicación, mantenimiento, tamaño, licencia).

## El proyecto
"Backrooms": juego de terror 3D multijugador en el navegador, monorepo npm workspaces (`client`, `server`, `shared`).
- **Cliente**: TypeScript, Vite 5, React 18, **three.js 0.160** (WebGLRenderer + EffectComposer: bloom, film, VHS, OutputPass), gsap, socket.io-client, lucide-react. Sin motor de física: colisiones propias en rejilla.
- **Servidor**: Node + Express + socket.io + better-sqlite3 + JWT. La simulación de entidades vive en `shared` y corre igual en cliente y servidor.
- Se juega en escritorio y móvil/táctil, y quiero que corra en más dispositivos (portátiles con gráfica integrada, móviles de gama media).
- Se estudia una versión de escritorio (Electron/Tauri).

## El problema principal
Nivel -20 ("Las Suites", un hotel): ~50 fps de media, objetivo 120–180. Está **limitado por la CPU al enviar dibujos**, no por la GPU: unos 14–18 ms de CPU por fotograma sin importar resolución, bloom ni reflejos; ~26 µs por draw call; ~6 llamadas GL por draw. Ya hemos hecho: fusión de mallas estáticas por material (`mergeGeometries`), `InstancedMesh`, culling por distancia/habitación, iluminación horneada con un parche de `onBeforeCompile`, pocas luces dinámicas, resolución dinámica. Quedan ~300 draw calls, y el objetivo son 150–200. Lo que queda: personajes con piel (SkinnedMesh), carteles, puertas con texturas únicas, cámaras, decoración variada.

## Qué necesito (por categorías)
1. **Reducir draw calls y coste de CPU en three.js**: `BatchedMesh` (¿en qué versión de three es estable y merece la pena subir de la 0.160?), alternativas de batching, atlas de texturas, fusión de SkinnedMesh / instancing de personajes animados (VAT, animación en GPU), LOD automático, occlusion/portal culling para interiores (hoteles, pasillos con puertas), `three-mesh-bvh`, `three-pathfinding`.
2. **Texturas y carga**: KTX2/Basis (`ktx-parse`, loaders), compresión de GLTF (`gltf-transform`, meshopt, draco), generadores de atlas, optimización automática de modelos en el build.
3. **Render moderno**: ¿merece la pena **WebGPURenderer** (three) para este caso limitado por CPU? Madurez, compatibilidad de navegadores, qué se rompe con `onBeforeCompile`/EffectComposer. Alternativas (`postprocessing` de pmndrs vs EffectComposer de three: cuál es más ligero).
4. **Medición y diagnóstico**: `stats-gl`, `r3f-perf`, Spector.js, herramientas de trazas de GPU/CPU, benchmarks automatizados en CI, medidores de frame pacing.
5. **Build y bundle**: plugins de Vite (visualizer, compresión, code-splitting, precarga), `vite-plugin-glsl`, minificación de shaders.
6. **Multijugador/servidor**: interpolación y predicción de red, snapshots comprimidos (`msgpack`, `flatbuffers`, `bitecs`), mejor rendimiento de socket.io (uWebSockets.js, `@socket.io/…`), compresión por permessage-deflate.
7. **Física y colisiones** (si hay algo mejor que lo propio): `rapier` (WASM), `cannon-es`, `three-mesh-bvh` para raycasts rápidos.
8. **Escritorio**: Electron vs Tauri vs NW.js para un juego WebGL: flags de rendimiento, caché de shaders persistente, integración con Steam (`steamworks.js`).
9. **Audio y UX** (secundario): Howler, Tone, spatial audio ligero.

## Restricciones
- Nada de dependencias grandes si un trozo pequeño lo resuelve. Valoro lo mínimo que funcione.
- Licencias compatibles con uso comercial (MIT, Apache-2.0, BSD…); indica la licencia de cada una.
- Todo debe funcionar con Vite + TypeScript y no romper el soporte móvil.
- Descarta lo abandonado (sin publicar en 18 meses) salvo que sea estable y esté completo; dilo.

## Formato de respuesta
1. **Top 5 por impacto/esfuerzo** para bajar los draw calls y la CPU del nivel -20, en orden, con una frase del porqué y el esfuerzo estimado (horas).
2. Una **tabla** por categoría: paquete · para qué · versión actual · última publicación · tamaño gzip · licencia · enlace · riesgo (bajo/medio/alto) · "¿encaja con three 0.160 o exige subir?".
3. Lo que **NO** recomiendas aunque parezca atractivo, y por qué.
4. Para los 3 primeros, un **ejemplo mínimo de integración** (≤30 líneas, TypeScript).
5. Dudas que necesites resolver conmigo antes de recomendar nada más.

No inventes paquetes ni versiones: si no estás seguro de que existe, dilo.
